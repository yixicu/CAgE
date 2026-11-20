import { conditionalClosureIssue, conditionalTaskIndex } from './conditional-work.js';
import { applyComponentReview, componentInput, componentIssuesFor } from '../../proof-components.js';
import { completeArchivedProof } from './completion.js';
import { pendingSynthesis, assertSynthesisRecovery, synthesisRecoveryMarker, synthesisReadVersions, hasSynthesisMaterial } from './synthesis-recovery.js';
import { parsePreparation, preparationBaseline, revisePreparedProblem, allocationHistory, adoptedPrerequisites, eligibleAdoptedChapters } from './preparation.js';
import { applyPresentation } from '../../../presentation/session-presentation.js';
import { stableHash as documentHash } from '../../../learning/research-hash.js';
import { normalizeTags } from '../../../learning/research-data.js';
import { createHash } from 'node:crypto';
import { WORKER_PROTOCOL } from '../../contracts/v1.js';
import type { AgentInvocationV2, AgentRuntimeV2, AgentSession, CrossDomainAudit, EpochRecord, EpochSnapshot, EpochTask, PossibleWay, InFlightEpoch, ResearchEventV2, ResearchProjectV2, ResearchStoreV2, ResearchLoopComposition, RoleBudget, SynthesisOutputV2, UserCommand, WorkerResult } from '../../contracts/v2.js';
import { parseCommand } from '../v1/schemas.js';
import { parseProject, parseInFlight, parseGenerateWays, parseWorkerStepV2, parseSynthesisV2, consistencyGate, parseKnowledgeRouting, parseAuditOutput, parseLiteratureV2 } from './schemas.js';
import { basePolicy, routeStrategy, applyKnowledgeRouting } from './routing.js';
import { createWaySkills } from './ways.js';
import { executionFailure, operationalLessons, publicFailureReason } from './learning-failures.js';
import { buildResearchTraces } from './evolution.js';
import { fastDecision, selectAuditPairs, auditPairsToRecords } from './decision.js';
import { inheritedContextInput, attemptInput, continuationAllowed, declaredSkillsAreLoaded, emptyBoundary, endedAttempt, explicitResult, evaluateDecision, loadResources, makeReceipt, promptProject } from '../../review.js';
import type { EndedAttempt, PlanningChange, ResearchReceipt } from '../../contracts/review.js';
import { commandRefinementKind, compareCommandOrder, finishPlanningInputs, ingestCommands, initializeCommandStates, markPlanningInputs, releasePlanningInputs, selectPlanningInputs } from '../../user-commands.js';

const copy = <T>(value: T): T => structuredClone(value);
const locks = new WeakMap<ResearchStoreV2, Set<string>>();
const LOOP = { researchLoopVersion: '2.0', workerProtocolVersion: '2.0' } as const;
function hypothesisHash(text: string): string { return createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'); }
function interrupted(error: unknown): boolean { return typeof error === 'object' && error !== null && 'executionStatus' in error && error.executionStatus === 'interrupted'; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

/** V2 is the sole scientific writer; task staging never mutates the committed graph. */
export class ResearchEngine {
  private readonly active = new Map<string, Promise<void>>();
  private readonly projects = new Map<string, ResearchProjectV2>();
  private readonly markers = new Map<string, InFlightEpoch>();
  private readonly stops = new Set<string>();
  private readonly listeners = new Set<(event: ResearchEventV2) => void>();
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly store: ResearchStoreV2, private readonly runtime: AgentRuntimeV2, private readonly composition: ResearchLoopComposition = {}) {}
  isActive(projectId?: string): boolean { return projectId ? this.active.has(projectId) : this.active.size > 0; }
  subscribe(listener: (event: ResearchEventV2) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async getSnapshot(projectId: string, saved?: ResearchProjectV2): Promise<ResearchProjectV2> {
    const project = this.isActive(projectId) ? this.projects.get(projectId) : undefined;
    const result = copy(project ?? parseProject(saved ?? await this.store.loadProject(projectId)));
    const marker = this.markers.get(projectId) ?? await this.store.loadInFlight(projectId);
    if (marker) result.activeEpoch = parseInFlight(marker);
    const live = this.projects.get(projectId);
    if (!this.isActive(projectId) && live?.status === 'failed') { result.status = 'failed'; result.lastError = live.lastError; }
    return result;
  }
  async enqueue(raw: UserCommand): Promise<void> {
    const command = parseCommand(raw);
    // No await precedes the STOP gate, including project reads and durable journal writes.
    if (command.kind === 'stop') this.stops.add(command.projectId);
    await this.store.enqueueCommand(command);
    const project = this.projects.get(command.projectId);
    if (project) this.emit(project, 'project.updated', { message: `${command.kind} queued for the safe Epoch boundary.` });
  }
  start(projectId: string): Promise<void> {
    const writers = locks.get(this.store) ?? new Set<string>(); locks.set(this.store, writers);
    if (writers.has(projectId)) return Promise.reject(new Error('A project already has an authoritative writer.'));
    writers.add(projectId);
    const work = this.run(projectId).catch(error => {
      const project = this.projects.get(projectId);
      if (project) { project.status = 'failed'; project.lastError = 'The last committed checkpoint is preserved; unfinished work requires explicit reconciliation.'; this.emit(project, 'research.warning', { message: project.lastError }); }
      throw error;
    }).finally(() => { writers.delete(projectId); this.active.delete(projectId); this.stops.delete(projectId); this.writes.delete(projectId); });
    this.active.set(projectId, work);
    return work;
  }
  async shutdown(): Promise<void> {
    const active = [...this.active];
    for (const [id] of active) this.stops.add(id);
    const journals = await Promise.allSettled(active.map(([projectId], i) => this.enqueue({ id: `shutdown_${Date.now()}_${i}`, projectId, kind: 'stop', payload: 'Backend shutdown', createdAt: new Date().toISOString() })));
    await Promise.allSettled(active.map(([, work]) => work));
    const failure = journals.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  async reconcile(projectId: string): Promise<ResearchProjectV2> {
    const writers = locks.get(this.store) ?? new Set<string>(); locks.set(this.store, writers);
    if (writers.has(projectId)) throw new Error('Cannot reconcile while research is active.');
    writers.add(projectId);
    try {
      const project = parseProject(await this.store.loadProject(projectId));
      this.projects.set(projectId, project);
      const beforeMigration = JSON.stringify(project);
      initializeCommandStates(project, await this.commandJournal(project));
      const raw = await this.store.loadInFlight(projectId);
      if (!raw) {
        this.markers.delete(projectId);
        if (completeArchivedProof(project,this.composition.isProofValid)) { Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project)))); return project; }
        if (project.status === 'running') { project.status = 'paused'; project.phase = 'idle'; project.lastError = 'Backend ended after the saved boundary. Resume explicitly; no paid work was repeated.'; Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project)))); }
        else if ((project.refinements.length || project.userInputWarnings?.length) && JSON.stringify(project)!==beforeMigration)Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
        return project;
      }
      const marker = parseInFlight(raw);
      const prior = project.epochs.find(epoch => epoch.id === marker.snapshot.id);
      if (prior && marker.synthesis && marker.synthesis.attempt > (prior.synthesis?.attempt ?? 0)) {
        assertSynthesisRecovery({...project,pendingModificationIds:[]},prior);
        if (documentHash([marker.snapshot,marker.tasks]) !== documentHash([prior.snapshot,prior.tasks])) throw new Error('Synthesis recovery journal changed frozen evidence.');
        this.markers.set(projectId,marker);
        const saved = marker.calls.find(call=>call.task==='v2_synthesize' && call.status==='completed');
        let synthesis: SynthesisOutputV2 | undefined;
        try { if (saved) synthesis = parseSynthesisV2(saved.result,marker.snapshot); } catch { /* No invalid output is promoted. */ }
        if (synthesis) {
          marker.synthesis.status='complete';
          await this.checkpoint(project,marker,synthesis,marker.tasks.some(task=>task.result&&task.result.executionStatus!=='completed'),prior.audits);
        } else {
          prior.synthesis={status:'pending',attempt:marker.synthesis.attempt};
          project.status='paused'; project.phase='idle'; project.lastError='Interrupted synthesis is pending explicit Continue; no planning or Worker will be repeated.';
          Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
          await this.store.clearInFlight(projectId); this.markers.delete(projectId);
        }
        return copy(project);
      }
      if (prior) {
        await this.store.clearInFlight(projectId); this.markers.delete(projectId);
        if (completeArchivedProof(project,this.composition.isProofValid)) Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
        if (project.status === 'running') {
          project.status = 'paused'; project.phase = 'idle';
          project.lastError = 'Recovered the saved checkpoint without repeating model calls. Select Continue again to start new research.';
          Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project))));
        }
        return project;
      }
      // Older interrupted writes may predate atomic adoption and lack the
      // provenance needed to connect a changed project root to this snapshot.
      // Keep those bytes intact instead of fabricating a mixed-identity receipt.
      if ((!marker.planningChange || marker.sealed) && project.hypothesisRevision !== marker.snapshot.hypothesisRevision
        || marker.sealed && marker.planningChange?.toHypothesisId && project.hypothesisId !== marker.planningChange.toHypothesisId)throw new Error('The saved Epoch and hypothesis differ without recoverable planning provenance. Review the preserved checkpoint and journal before resuming.');
      this.markers.set(projectId, marker);
      for (const call of marker.calls) if (call.status === 'pending') call.status = 'uncertain';
      for (const task of marker.tasks) {
        if (task.state === 'running') {
          const savedReturn = marker.calls.find(call => call.id === `${task.id}_RETURN` && call.status === 'completed');
          try { if (!savedReturn) throw new Error('Unresolved remote task.'); task.result = parseWorkerStepV2(savedReturn.result, 'RETURN', task.brief).result; if (task.result) task.result.protocol = WORKER_PROTOCOL.filter(step => marker.calls.some(call => call.id === `${task.id}_${step}` && call.status === 'completed')); task.state = 'staged'; }
          catch { task.result = this.failedResult(task, true, 'Backend ended with uncertain remote outcome. No paid call was repeated.'); task.state = 'interrupted'; }
        }
        if (task.result) task.result.chapters = await this.runtime.savedChapters?.(project.id, task.id) ?? task.result.chapters ?? [];
        if (task.state === 'ready') { task.state = 'blocked'; task.blockReason = 'Epoch interrupted before dispatch.'; }
      }
      if(!marker.sealed&&marker.planningChange) await this.recoverPlanning(project, marker);
      else if (!marker.sealed && marker.planningSelection) releasePlanningInputs(project, marker.planningSelection, 'The interrupted routing selection was not adopted; it remains available for the next explicit start.');
      marker.sealed = true;
      await this.persist(marker);
      project.epoch = marker.epoch;
      project.lastError = 'Recovered unfinished research without repeating model calls. Review the saved partial record, then select Continue again to start new research.';
      let synthesis: SynthesisOutputV2 = { summary: 'Recovered factual partial record. Theorist synthesis was not re-run. Uncertain remote calls require explicit new research authorization.', disagreements: [], unresolvedQuestions: ['Review incomplete work before starting a new Epoch.'], decision: 'pause', reason: 'Unexpected backend interruption; this was not graceful STOP.' };
      let failed = true;
      const saved = marker.calls.find(call=>call.task==='v2_synthesize' && call.status==='completed');
      try {
        if (saved) { synthesis=parseSynthesisV2(saved.result,marker.snapshot); marker.synthesis={status:'complete',attempt:marker.synthesis?.attempt??1}; failed=marker.tasks.some(task=>task.result&&task.result.executionStatus!=='completed'); }
      } catch { if(marker.synthesis)marker.synthesis.status='pending'; }
      await this.checkpoint(project, marker, synthesis, failed);
      return copy(project);
    } finally { writers.delete(projectId); this.writes.delete(projectId); this.stops.delete(projectId); }
  }
  private emit(project: ResearchProjectV2, type: ResearchEventV2['type'], details: Partial<ResearchEventV2> = {}): void {
    const event: ResearchEventV2 = { contractVersion: '2', type, projectId: project.id, epoch: project.epoch, ...details };
    for (const listener of this.listeners) { try { listener(copy(event)); } catch { /* Observers cannot alter science. */ } }
  }
  private persist(marker: InFlightEpoch): Promise<void> {
    const snapshot = copy(marker);
    const next = (this.writes.get(marker.projectId) ?? Promise.resolve()).then(() => this.store.saveInFlight(snapshot));
    this.writes.set(marker.projectId, next); return next;
  }
  private async phase(project: ResearchProjectV2, marker: InFlightEpoch, phase: InFlightEpoch['phase']): Promise<void> {
    project.phase = phase; marker.phase = phase; await this.persist(marker); this.emit(project, 'epoch.phase', { phase });
  }
  private async commands(project: ResearchProjectV2): Promise<UserCommand[]> {
    return (await this.commandJournal(project)).filter(command => !project.processedCommandIds.includes(command.id));
  }
  private async commandJournal(project: ResearchProjectV2): Promise<UserCommand[]> {
    return (await this.store.listCommands(project.id)).map(parseCommand).filter(command => command.projectId === project.id);
  }
  private applyCommands(project: ResearchProjectV2, commands: UserCommand[]): {stop:boolean;pause:boolean;refine:boolean} {
    const control = ingestCommands(project, commands);
    if (control.stop) this.stops.add(project.id);
    control.stop ||= this.stops.has(project.id);
    return control;
  }
  /** Complete a recorded adoption, never infer or repeat a paid planning call. */
  private async recoverPlanning(project: ResearchProjectV2, marker: InFlightEpoch): Promise<void> {
    const provenance = marker.planningChange!;
    if(marker.tasks.length || marker.snapshot.hypothesisRevision !== provenance.fromHypothesisRevision)throw new Error('Planning recovery cannot replace admitted Worker inputs.');
    const journal = await this.commandJournal(project);
    initializeCommandStates(project, journal);
    this.applyCommands(project, journal);
    if(provenance.commandIds.some(id=>!journal.some(command=>command.id===id&&command.kind==='refine')))throw new Error('Planning recovery is missing an authorized command.');
    const selection = provenance.selection ?? marker.planningSelection ?? {boundaryId:marker.snapshot.id,commandIds:copy(provenance.commandIds),annotationCommandIds:[],pendingModifications:[],pendingAnnotations:[]};
    if(selection.blockedReason || selection.boundaryId!==marker.snapshot.id || JSON.stringify(selection.commandIds)!==JSON.stringify(provenance.commandIds))throw new Error('Planning recovery selection does not match its recorded provenance.');
    if(selection.reconstruction && (provenance.change.kind==='working'||selection.reconstruction.hypothesis!==provenance.change.hypothesis||selection.reconstruction.assumptions.some(condition=>!provenance.change.conditions.includes(condition))))throw new Error('Planning recovery cannot substitute a different reconstruction or omit its conditions.');
    const currentId=project.hypothesisId??`h_${project.hypothesisRevision}`;
    if(project.hypothesisRevision===provenance.fromHypothesisRevision && (project.hypothesisRevision!==provenance.toHypothesisRevision || !provenance.toHypothesisId || currentId!==provenance.toHypothesisId || provenance.change.kind==='working')) {
      if(provenance.fromHypothesisId && currentId!==provenance.fromHypothesisId)throw new Error('Planning recovery source identity differs from its journal.');
      this.planningChange(project, provenance.change, provenance.change.kind!=='working' && provenance.commandIds.length>0);
    } else if(project.hypothesisRevision!==provenance.toHypothesisRevision)throw new Error('Saved planning identity does not match the durable preparation journal.');
    if(project.hypothesisRevision!==provenance.toHypothesisRevision || provenance.toHypothesisId && project.hypothesisId!==provenance.toHypothesisId || provenance.change.kind!=='working' && project.hypothesis!==provenance.change.hypothesis)throw new Error('Recovered target does not match the recorded planning result.');
    if(provenance.previousHypothesisId!==undefined && project.previousHypothesisId!==provenance.previousHypothesisId)throw new Error('Recovered hypothesis lineage does not match the recorded planning result.');
    // Recreate only supersession that precedes this captured candidate. A later
    // command is deliberately not selected or acknowledged during recovery.
    const chosen=journal.find(command=>command.id===selection.hypothesisCommandId);
    if(chosen)for(const command of journal){
      const state=project.commandStates?.[command.id];
      if(command.kind==='refine'&&commandRefinementKind(command)!=='annotation'&&state?.status==='pending'&&compareCommandOrder(command,chosen)<0)project.commandStates![command.id]={...state,status:'superseded',supersededBy:chosen.id};
    }
    if(!provenance.selection)for(const id of selection.commandIds){
      const state=project.commandStates?.[id];
      if(state&&(state.status==='legacy_unknown'||state.status==='applied'&&!state.boundaryId))project.commandStates![id]={...state,status:'planning',boundaryId:selection.boundaryId};
    }
    finishPlanningInputs(project, selection, project.hypothesisRevision);
    project.epoch=marker.epoch; project.phase='preparing';
    Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
    const inputs=await this.store.freezeInputs(copy(project)),snapshot=copy(marker.snapshot);delete snapshot.workingHypothesis;
    const generated = marker.calls.find(call => call.task === 'v2_generate_ways' && call.status === 'completed')?.result as { workingRevision?: unknown } | undefined;
    if (generated?.workingRevision) {
      const revision = generated.workingRevision as { change?: unknown };
      if (JSON.stringify(revision.change) !== JSON.stringify(provenance.change)) throw new Error('Recovered working choice differs from its accepted planning provenance.');
      const baseline = preparationBaseline(project, marker.snapshot, selection);
      if (!baseline.reusePreparedProblemAllowed) throw new Error('Recovered working choice has no eligible unchanged preparation.');
      snapshot.problem = revisePreparedProblem(baseline.priorPreparedProblem, generated.workingRevision);
    }
    marker.snapshot={...snapshot,hypothesis:project.hypothesis,hypothesisRevision:inputs.hypothesisRevision,inputRevision:inputs.contentRevision,sources:inputs.sources,...(project.workingHypothesis?{workingHypothesis:copy(project.workingHypothesis)}:{})};
  }
  private async run(projectId: string): Promise<void> {
    const project = parseProject(await this.store.loadProject(projectId)); this.projects.set(projectId, project);
    project.hypothesisId??=`h_${project.hypothesisRevision}`;
    initializeCommandStates(project, await this.commandJournal(project));
    if (await this.store.loadInFlight(projectId)) throw new Error('An unfinished Epoch requires explicit reconciliation before any new paid work.');
    const queued = await this.commands(project);
    const control = this.applyCommands(project, queued);
    if (queued.length && !this.stops.has(projectId)) {
      if (control.pause) project.status = 'paused';
      Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project))));
      if (control.pause) return;
    }
    if (this.stops.has(projectId)) { await this.boundaryStop(project); return; }
    const latestReceipt = project.epochs.at(-1)?.research;
    const awaitingArchive = Boolean(latestReceipt?.review?.proof && latestReceipt.proofArchive?.status !== 'saved');
    for(const record of project.epochs)await this.registered(project,record.research);
    if (awaitingArchive) {
      if (project.status === 'running') { project.status='paused'; project.phase='idle'; Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project)))); }
      this.emit(project,'research.finished',{status:project.status,message:'Saved synthesis submission retried; no planning or Worker was repeated.'});
      return;
    }
    if (project.status === 'completed' && project.epochs.at(-1)?.research?.proofArchive?.status === 'saved' && !project.pendingModificationIds?.length && !Object.values(project.commandStates ?? {}).some(state=>state.status==='pending'||state.status==='planning')) { this.emit(project,'research.finished',{status:project.status}); return; }
    const unfinished = project.epochs.at(-1);
    if (pendingSynthesis(unfinished)) { await this.resumeSynthesis(project, unfinished!); return; }
    if (project.epoch >= project.config.maxEpochs) {
      if(project.userInputWarnings?.length)Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
      throw new Error('Configured Epoch limit is exhausted.');
    }
    project.status = 'running'; delete project.lastError;
    const softDeadlineAt = Date.now() + project.config.epochBudget.timeoutMs;
    while (project.status === 'running') {
      await this.epoch(project, softDeadlineAt);
      if (project.status === 'running' && this.stops.has(projectId)) { await this.boundaryStop(project); break; }
    }
  }
  /** An explicit Continue resumes only the unfinished synthesis, never research dispatch. */
  private async resumeSynthesis(project: ResearchProjectV2, record: EpochRecord): Promise<void> {
    const marker = synthesisRecoveryMarker(project, record);
    const snapshot = marker.snapshot;
    const inherited = await this.composition.readInherited?.(project.id);
    const previouslyRead = synthesisReadVersions(project,snapshot);
    project.status = 'running'; delete project.lastError;
    this.markers.set(project.id, marker);
    await this.phase(project, marker, 'synthesizing');
    let theorist: AgentSession | undefined;
    let failed = marker.tasks.some(task => task.result && task.result.executionStatus !== 'completed');
    let synthesis: SynthesisOutputV2 = {summary:'',disagreements:[],unresolvedQuestions:[],decision:'pause',reason:''};
    try {
      try {
        if (this.stops.has(project.id)) throw new Error('STOP prevented synthesis recovery admission.');
        theorist = await this.runtime.createSession({loop:LOOP,contractVersion:'2',id:`${project.id}_${snapshot.id}_theorist`,projectId:project.id,role:'theorist',
          model:snapshot.modelConfig.roleModels?.theorist ?? snapshot.modelConfig.defaultModel,budget:this.synthesisBudget(snapshot),
          context:{project:copy(project),snapshot:copy(snapshot)}});
        if (this.stops.has(project.id)) throw new Error('STOP prevented synthesis recovery admission.');
        const componentProject = {...project,epochs:project.epochs.filter(epoch=>epoch.id!==snapshot.id)};
        synthesis = parseSynthesisV2(await this.invoke(marker,theorist,`synthesis_${marker.synthesis!.attempt}`,{
          task:'v2_synthesize',recoveryGeneration:marker.synthesis!.attempt,budget:this.synthesisBudget(snapshot),input:{...inheritedContextInput(inherited),conditionalTasks:conditionalTaskIndex([...project.epochs.filter(epoch=>epoch.id!==snapshot.id).flatMap(epoch=>epoch.tasks),...marker.tasks]),
            hypothesisId:project.hypothesisId??`h_${snapshot.hypothesisRevision}`,snapshot:copy(snapshot),
            adoptedPrerequisites:copy(eligibleAdoptedChapters(componentProject)),componentState:componentInput(componentProject),tasks:marker.tasks.map(({id,way,state})=>({id,way,state})),
            ...attemptInput(endedAttempts(project,marker.tasks),previouslyRead)}}),snapshot);
        marker.synthesis!.status = 'complete';
      } catch (error) {
        failed = true; synthesis.reason = publicFailureReason(error);
        synthesis.summary = `Theorist synthesis was unavailable. ${synthesis.reason} Saved Worker findings and chapters remain available for synthesis recovery.`;
        synthesis.unresolvedQuestions = ['Theorist synthesis and root-proof review remain unfinished.'];
      }
      await this.checkpoint(project,marker,synthesis,failed,copy(record.audits));
    } finally { if (theorist) await this.runtime.closeSession(theorist).catch(()=>{}); }
  }
  private async epoch(project: ResearchProjectV2, softDeadlineAt: number): Promise<void> {
    const query={sessionId:project.id,loopVersion:2 as const,hypothesis:project.hypothesis,tags:project.researchTags};
    const boundary=await this.composition.readBoundary?.(query)??emptyBoundary(2);
    const inherited=await this.composition.readInherited?.(project.id);
    const learningResources=await loadResources(this.composition,boundary,query);
    const loadedResources=learningResources.map(({meta})=>({id:meta.id,version:meta.version}));
    const previouslyRead=Object.assign({},...project.epochs.flatMap(record=>record.research?.review?.attemptsRead.map(ref=>({[ref.id]:ref.version}))??[]),('inspectedAttempts' in boundary?boundary.inspectedAttempts:undefined));
    // This read is the routing cutoff, before the preparation snapshot is frozen.
    // Later submissions remain pending for the next existing Epoch boundary.
    const journal = await this.commandJournal(project);
    initializeCommandStates(project, journal);
    const control = this.applyCommands(project, journal);
    if (control.stop || control.pause) {
      project.status = control.stop ? 'stopped' : 'paused'; project.phase = 'idle';
      Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project))));
      this.emit(project, 'research.finished', {status: project.status});
      return;
    }
    const frozen = await this.store.freezeInputs(copy(project));
    const number = project.epoch + 1;
    const selection = selectPlanningInputs(project, journal, `epoch_${number}`);
    const userDomainPreferences = copy(project.config.userDomainPreferences);
    const policy = basePolicy();
    let snapshot: EpochSnapshot = freeze(copy({ researchBoundary:{decision:boundary.decision,skills:boundary.skills,strategies:boundary.strategies,...(boundary.proofs?{proofs:boundary.proofs}:{})},loadedResources:learningResources.map(({meta})=>({id:meta.id,version:meta.version})),previouslyRead,...(project.workingHypothesis?{workingHypothesis:project.workingHypothesis}:{}),userDomainPreferences, id: `epoch_${number}`, number, hypothesis: project.hypothesis,
      hypothesisRevision: frozen.hypothesisRevision, inputRevision: frozen.contentRevision, sources: frozen.sources,
      policy, strategy: routeStrategy(policy, Object.fromEntries(Object.entries(userDomainPreferences).filter(([id]) => policy.domains.some(domain => domain.id === id)))),
      waySkills: createWaySkills(),
      modelConfig: { ...(project.config.defaultModel ? { defaultModel: project.config.defaultModel } : {}), ...(project.config.roleModels ? { roleModels: project.config.roleModels } : {}) },
      executionConfig: { maxWorkers: project.config.maxWorkers, workerBudgets: { shallow: { ...project.config.workerBudgets.shallow, softDeadlineAt }, deep: { ...project.config.workerBudgets.deep, softDeadlineAt } }, roleBudget: { ...project.config.roleBudget, softDeadlineAt } },
      budget: project.config.epochBudget, startedAt: new Date().toISOString(),
    }));
    // Only active resource guidance is projected; the saved catalogs and historical Epochs remain intact.
    const roleProject = () => ({ ...copy(project), waySkills: copy(snapshot.waySkills), policies: [copy(snapshot.policy)] });
    const marker: InFlightEpoch = { schemaVersion: 2, loop: LOOP, projectId: project.id, epoch: number, phase: 'preparing', sealed: false, snapshot, ...(!selection.blockedReason?{planningSelection:copy(selection)}:{}), tasks: [], decisions: [], calls: [], startedAt: snapshot.startedAt };
    project.epoch = number; this.markers.set(project.id, marker);
    await this.phase(project, marker, 'preparing');
    let theorist: AgentSession | undefined;
    let failed = false;
    let planningFailure: string | undefined;
    let committingPlan=false;
    let workingRevisionAllowed = false;
    let synthesis: SynthesisOutputV2 = { summary: 'No new Worker was launched.', disagreements: [], unresolvedQuestions: [], decision: 'pause', reason: 'No admissible work.' };
    try {
      if (!this.stops.has(project.id)) {
        theorist = await this.runtime.createSession({ loop: LOOP, contractVersion: '2', id: `${project.id}_${snapshot.id}_theorist`, projectId: project.id, role: 'theorist', model: snapshot.modelConfig.roleModels?.theorist ?? snapshot.modelConfig.defaultModel, budget: copy(snapshot.executionConfig.roleBudget), context: { project: roleProject(), snapshot: copy(snapshot) } });
        try {
          if (!this.stops.has(project.id)) {
            if (selection.blockedReason) throw new Error(selection.blockedReason);
            markPlanningInputs(project, selection);
            const pending=selection.pendingModifications;
            const baseline = preparationBaseline(project, snapshot, selection);
            workingRevisionAllowed = baseline.reusePreparedProblemAllowed === true;
            const proposal = workingRevisionAllowed
              ? parsePreparation({ reusePreparedProblem: true }, baseline.priorPreparedProblem)
              : parsePreparation(await this.invoke(marker, theorist, 'routing', { task: 'v2_route_knowledge', budget: this.routingBudget(snapshot), input: { preparationOnly:true, hypothesis: snapshot.hypothesis, hypothesisRevision: snapshot.hypothesisRevision, ...baseline, ...(snapshot.workingHypothesis?{workingHypothesis:copy(snapshot.workingHypothesis)}:{}), pendingModifications:pending,pendingAnnotations:selection.pendingAnnotations,...(selection.reconstruction?{selectedReconstruction:selection.reconstruction}:{}) } }));
            // Strategy is deliberately unavailable until the problem has been organized.
            if(proposal.researchTags)project.researchTags=normalizeTags(proposal.researchTags);
            if(proposal.planningChange){
              if(selection.reconstruction&&(proposal.planningChange.hypothesis!==selection.reconstruction.hypothesis||selection.reconstruction.assumptions.some(condition=>!proposal.planningChange?.conditions.includes(condition))))throw new Error('Reconstruction acceptance requires the exact selected hypothesis and conditions.');
              const planned=copy(project),fromHypothesisRevision=project.hypothesisRevision,fromHypothesisId=project.hypothesisId??`h_${fromHypothesisRevision}`;
              this.planningChange(planned,proposal.planningChange,pending.length>0);
              finishPlanningInputs(planned, selection, planned.hypothesisRevision);
              marker.planningChange={commandIds:copy(selection.commandIds),selection:copy(selection),fromHypothesisRevision,toHypothesisRevision:planned.hypothesisRevision,fromHypothesisId,toHypothesisId:planned.hypothesisId??`h_${planned.hypothesisRevision}`,...(planned.previousHypothesisId?{previousHypothesisId:planned.previousHypothesisId}:{}),change:copy(proposal.planningChange)};
              committingPlan=true;
              // Physical storage publishes H, exact accepted IDs and recovery
              // provenance in one pointer update. Minimal stores use a WAL first.
              if(this.store.commitPlanningCheckpoint)Object.assign(project,parseProject(await this.store.commitPlanningCheckpoint(planned,copy(marker))));
              else {
                await this.persist(marker);
                Object.assign(project,parseProject(await this.store.commitCheckpoint(planned)));
              }
              const revised=await this.store.freezeInputs(copy(project));
              const prior=copy(snapshot);delete prior.workingHypothesis;
              snapshot=freeze({...prior,hypothesis:project.hypothesis,hypothesisRevision:revised.hypothesisRevision,inputRevision:revised.contentRevision,sources:revised.sources,...(project.workingHypothesis?{workingHypothesis:copy(project.workingHypothesis)}:{})});
              committingPlan=false;
            }else if(pending.length)throw new Error('Pending user modification requires an explicit planning classification.');
            else if(selection.commandIds.length){
              finishPlanningInputs(project, selection, project.hypothesisRevision);
              committingPlan=true;
              Object.assign(project,parseProject(await this.store.commitCheckpoint(copy(project))));
              committingPlan=false;
            }
            applyPresentation(project, proposal.presentation, proposal.problem.goal);
            snapshot = freeze({ ...copy(snapshot), problem: proposal.problem });
          }
        } catch (error) {
          // A failed/uncertain durability operation must leave the journal for
          // reconciliation, never fall through to a checkpoint of the old H.
          if(committingPlan)throw error;
          releasePlanningInputs(project, selection, 'Planning did not produce a valid accepted classification.');
          failed=true; planningFailure = publicFailureReason(error);
          this.emit(project, 'research.warning', { message: failed?'Planning could not finish its durable input boundary; no new Worker will launch.':'Problem preparation was unavailable; no unprepared work will launch.' });
        }
        if (!failed && project.config.literatureEnabled && !this.stops.has(project.id)) {
          const additional = this.routingBudget(snapshot);
          {
            let literature: AgentSession | undefined;
            try {
              literature = await this.runtime.createSession({ loop: LOOP, contractVersion: '2', id: `${project.id}_${snapshot.id}_literature`, projectId: project.id, role: 'literature', model: snapshot.modelConfig.roleModels?.literature ?? snapshot.modelConfig.defaultModel, budget: additional, context: { project: roleProject(), snapshot: copy(snapshot) } });
              const contribution = parseLiteratureV2(await this.invoke(marker, literature, 'literature', { task: 'v2_literature', budget: additional, input: { hypothesis: snapshot.problem?.goal ?? snapshot.hypothesis, problem:copy(snapshot.problem), sources: copy(snapshot.sources), strategy: copy(snapshot.strategy), purpose:'Source-grounded input for upcoming macro routing; respect the prepared user method and execution requirements. No online search unless explicitly authorized.' } }), snapshot);
              const strategy = copy(snapshot.strategy);
              for (const anchor of contribution.anchors) if (!strategy.anchors.some(existing => existing.id === anchor.id)) { strategy.anchors.push(anchor); strategy.recommendation.anchorIds.push(anchor.id); }
              snapshot = freeze({ ...copy(snapshot), strategy });
              if (contribution.limitations.length) this.emit(project, 'research.warning', { message: 'Optional Literature contributed source-grounded anchors with recorded limitations.' });
            } catch { this.emit(project, 'research.warning', { message: 'Optional Literature was unavailable; core research continues without invented evidence.' }); }
            finally { if (literature) await this.runtime.closeSession(literature).catch(() => {}); }
          }
        }
        snapshot=freeze({...copy(snapshot),routingStrategy:copy(snapshot.strategy)});
        // Journal both existing planning calls against the preparation snapshot.
        // Freeze the organized goal and routed guidance together before admitting any Worker.
        try {
          if(failed)throw new Error('Pending modification was not planned.');
          const attempts=endedAttempts(project);
          const generated = await this.invoke(marker, theorist, 'generate', { task: 'v2_generate_ways', budget: this.planningBudget(snapshot), input: { workingRevisionAllowed, ...inheritedContextInput(inherited), project: promptProject(roleProject(),endedAttempts(project)), snapshot: copy(snapshot), learningResources, adoptedPrerequisites: copy(eligibleAdoptedChapters(project)), componentState:componentInput(project), allocationHistory:allocationHistory(project),...attemptInput(attempts,previouslyRead),operationalLessons: operationalLessons(project) } });
          if (!generated || typeof generated !== 'object' || !('routing' in generated)) throw new Error('Prepared research requires macro routing before Ways.');
          const routing = parseKnowledgeRouting(generated.routing);
          if (routing.planningChange) throw new Error('Way generation cannot change the prepared target.');
          const routed = applyKnowledgeRouting(copy(policy), routing, snapshot.sources, snapshot.userDomainPreferences ?? {});
          snapshot = freeze({...copy(snapshot), strategy:routed, routingStrategy:copy(routed)});
          // Validate the complete plan before publishing any optional working-target choice.
          const choice = (generated as { workingRevision?: unknown }).workingRevision;
          if (choice !== undefined && !workingRevisionAllowed) throw new Error('Working revision cannot override pending user input or a newly prepared target.');
          const candidateSnapshot = choice === undefined ? snapshot : freeze({ ...copy(snapshot), problem: revisePreparedProblem(snapshot.problem, choice) });
          const output = parseGenerateWays(generated, candidateSnapshot);
          snapshot = candidateSnapshot;
          if (output.workingRevision) {
            const planned = copy(project), change = output.workingRevision.change;
            this.planningChange(planned, change, false);
            snapshot = freeze({ ...copy(snapshot), workingHypothesis: copy(change) });
            const rootId = project.hypothesisId ?? `h_${project.hypothesisRevision}`;
            marker.planningChange = { commandIds: [], selection: copy(selection), fromHypothesisRevision: project.hypothesisRevision,
              toHypothesisRevision: project.hypothesisRevision, fromHypothesisId: rootId, toHypothesisId: rootId, change: copy(change) };
            committingPlan = true;
            if (this.store.commitPlanningCheckpoint) Object.assign(project, parseProject(await this.store.commitPlanningCheckpoint(planned, copy(marker))));
            else { await this.persist(marker); Object.assign(project, parseProject(await this.store.commitCheckpoint(planned))); }
            committingPlan = false;
          }
          marker.snapshot = snapshot; marker.sealed = true; await this.persist(marker);
          await this.phase(project, marker, 'generating');
          loadedResources.push(...(this.runtime.loadedResourceRefs?.(theorist)??[]));
          if(output.ways.some(way=>!declaredSkillsAreLoaded(way.skillRefs??[],boundary,loadedResources)))throw new Error('A claimed Skill body was not read.');
          const existing = new Set(project.results.filter(result => result.executionStatus === 'completed' && !result.incomplete && result.hypothesisRevision === snapshot.hypothesisRevision && project.graph.find(node => node.id === result.branchId)?.status !== 'needs_review').map(result => result.taskId));
          const current = new Set(output.ways.flatMap(way => [way.id, `${snapshot.id}_${way.id}`]));
          for (const way of output.ways) {
            const task = this.makeTask(snapshot, way, project.graph.filter(node => node.hypothesisRevision === snapshot.hypothesisRevision && (!node.parentId || node.id === way.parentId)).flatMap(node => node.assumptions));
            if (!project.graph.some(node => node.id === way.parentId && node.hypothesisRevision === snapshot.hypothesisRevision)) { task.state = 'blocked'; task.blockReason = 'Unknown hypothesis graph parent.'; }
            else if (!continuationAllowed(way.continuation,[...attempts,...(inherited?.attempts??[])])||project.graph.some(node => node.id === way.id) || !way.continuation&&project.epochs.some(epoch => epoch.tasks.some(previous => previous.result && previous.way.dedupeKey === way.dedupeKey && previous.way.hypothesisRevision === way.hypothesisRevision))) { task.state = 'blocked'; task.blockReason = 'Duplicate direction or continuation without a named prior obstacle and new work.'; }
            if (task.state === 'ready') {
              try {
                task.brief.adoptedChapters = adoptedPrerequisites(project, way);
                task.brief.componentIssues = componentIssuesFor(project, task.brief.adoptedChapters);
                const adoptedIds = new Set(task.brief.adoptedChapters.map(ref => ref.attemptId));
                if (way.dependencyTaskIds.some(id => current.has(id) || !existing.has(id) && !adoptedIds.has(id))) { task.state = 'blocked'; task.blockReason = 'Dependency needs a committed pre-Epoch result or an explicitly adopted complete prerequisite chapter.'; }
              }
              catch { task.state = 'blocked'; task.blockReason = 'Selected prerequisite chapters were not explicitly adopted at their exact current versions.'; }
            }
            marker.tasks.push(task);
          }
          // Eligibility is checked once, before spending the optional judgment.
          const ranked = await this.decideWays(marker, theorist, marker.tasks.filter(task => task.state === 'ready').map(task => task.way));
          const selected = ranked.map(way => {
            const task = marker.tasks.find(task => task.way.id === way.id)!;
            task.way = copy(way);
            task.brief = { ...task.brief, way: copy(way), effort: way.effort, budget: copy(snapshot.executionConfig.workerBudgets[way.effort]) };
            return task;
          });
          const remaining = marker.tasks.filter(task => !selected.includes(task));
          for (const task of remaining) if (task.state === 'ready') { task.state = 'blocked'; task.blockReason = this.stops.has(project.id) ? 'STOP closed admission.' : 'Theorist allocation explicitly deferred this candidate.'; }
          marker.tasks = [...selected, ...remaining];
        } catch (error) {
          if (committingPlan) throw error;
          failed = true; planningFailure ??= publicFailureReason(error); project.lastError = planningFailure;
          for (const task of marker.tasks) if (task.state === 'ready') {
            task.state = 'blocked'; task.blockReason = 'Planning or allocation could not be committed; admission closed.';
          }
        }
      }
      if (!marker.sealed) { marker.snapshot = snapshot; marker.sealed = true; await this.persist(marker); }
      await this.phase(project, marker, 'executing');
      failed = await this.dispatch(project, marker) || failed;
      const pairs = selectAuditPairs(marker.tasks, marker.snapshot.policy);
      let audits: CrossDomainAudit[] = auditPairsToRecords(pairs, marker.tasks);
      if (theorist && pairs.length) {
        try { audits = parseAuditOutput(await this.invoke(marker, theorist, 'audit', { task: 'v2_audit', budget: this.auditBudget(snapshot), input: { snapshot: copy(snapshot), pairs: copy(pairs), tasks: copy(marker.tasks.filter(task => pairs.some(pair => pair.resultIds.includes(task.id)))) } }), pairs, marker.tasks); }
        catch { this.emit(project, 'research.warning', { message: 'Cross-domain audit remains unresolved; no scored relation is treated as a scientific verdict.' }); }
      }
      await this.phase(project, marker, 'synthesizing');
      if (planningFailure && !hasSynthesisMaterial(project, marker.tasks, inherited)) {
        synthesis = { summary: `Planning did not produce an executable research plan. ${planningFailure} No usable current or historical research material was available for synthesis; no scientific verdict was inferred.`,
          disagreements: [], unresolvedQuestions: [], decision: 'pause', reason: 'Planning must be retried at a new planning boundary.' };
      } else if (theorist) {
        marker.synthesis = { status: 'pending', attempt: 1 };
        await this.persist(marker);
        const componentProject = {...project,epochs:project.epochs.filter(epoch=>epoch.id!==snapshot.id)};
        try { synthesis = parseSynthesisV2(await this.invoke(marker, theorist, 'synthesis', { task: 'v2_synthesize', recoveryGeneration: marker.synthesis.attempt, budget: this.synthesisBudget(snapshot), input: { ...inheritedContextInput(inherited), conditionalTasks:conditionalTaskIndex([...project.epochs.filter(epoch=>epoch.id!==snapshot.id).flatMap(epoch=>epoch.tasks),...marker.tasks]), hypothesisId:project.hypothesisId??`h_${snapshot.hypothesisRevision}`, snapshot: copy(snapshot), adoptedPrerequisites: copy(eligibleAdoptedChapters(componentProject)), componentState:componentInput(componentProject), tasks: marker.tasks.map(({id,way,state})=>({id,way,state})),...attemptInput(endedAttempts(project,marker.tasks),previouslyRead) } }), snapshot); marker.synthesis.status = 'complete'; }
        catch (error) { failed = true; synthesis.reason = publicFailureReason(error); synthesis.summary = `Theorist synthesis was unavailable. ${synthesis.reason} Saved Worker findings remain available, but have not been accepted as a complete proof. Review them before choosing whether to continue.`; synthesis.unresolvedQuestions = ['Theorist synthesis and root-proof review remain unfinished.']; }
      }
      await this.checkpoint(project, marker, synthesis, failed, audits,loadedResources);
    } finally { if (theorist) await this.runtime.closeSession(theorist).catch(() => {}); }
  }
  private makeTask(snapshot: EpochSnapshot, way: PossibleWay, rootAssumptions: readonly string[] = []): EpochTask {
    const id = `${snapshot.id}_${way.id}`;
    const moduleScope = way.proofContext?.scope === 'module';
    const baseConditions = moduleScope ? way.proofContext!.conditions : [...rootAssumptions, ...(snapshot.problem?.conditions ?? [])];
    const conditional = (way.conditionalPremises ?? []).map(item => item.statement);
    return { id, epochId: snapshot.id, way: copy(way), dependencyIds: copy(way.dependencyTaskIds), state: 'ready', brief: {
      ...(snapshot.problem?{constraints:copy({conditions:snapshot.problem.conditions,symbols:snapshot.problem.symbols,userStrategy:snapshot.problem.userStrategy,executionRequirements:snapshot.problem.executionRequirements})}:{}),
      taskId: id, branchId: way.id, epochId: snapshot.id, rootHypothesisRevision: snapshot.hypothesisRevision, inputRevision: snapshot.inputRevision,
      ...(way.proofContext?{proofContext:copy(way.proofContext)}:{}),conventionVersion:documentHash({target:snapshot.hypothesisRevision,context:way.proofContext??null,assumptions:[...baseConditions,...way.assumptions,...conditional,...way.changedPremises],anchors:snapshot.strategy.anchors.filter(anchor=>way.anchorIds.includes(anchor.id))}),hypothesis: snapshot.problem?.goal ?? snapshot.hypothesis, way: copy(way), question: way.question, effort: way.effort, assumptions: [...new Set([...baseConditions, ...conditional, ...way.assumptions, ...snapshot.strategy.anchors.filter(anchor => way.anchorIds.includes(anchor.id)).flatMap(anchor => anchor.assumptions), ...way.changedPremises])],
      frozenSourceRefs: copy(snapshot.sources), anchors: copy(snapshot.strategy.anchors.filter(anchor => way.anchorIds.includes(anchor.id))),
      policyVersion: snapshot.policy.version, waySkillVersion: way.waySkillVersion, budget: copy(snapshot.executionConfig.workerBudgets[way.effort]),
    } };
  }
  private async dispatch(project: ResearchProjectV2, marker: InFlightEpoch): Promise<boolean> {
    const snapshot = marker.snapshot;
    let admitted = 0;
    const running = new Map<string, Promise<{ id: string; error?: unknown }>>();
    let failure: unknown;
    const blocked = (task: EpochTask, reason: string) => { task.state = 'blocked'; task.blockReason = reason; };
    try {
      while (marker.tasks.some(task => task.state === 'ready') || running.size) {
        while (!failure && !this.stops.has(project.id) && running.size < snapshot.executionConfig.maxWorkers) {
          const task = marker.tasks.find(item => item.state === 'ready'); if (!task) break;
          if (admitted >= snapshot.executionConfig.maxWorkers && task.way.effort === 'deep' && task.way.priorityInputs.discrimination < snapshot.policy.decision.deepRefillMinValue) { blocked(task, 'Deep refill requires stronger independent research value.'); continue; }
          task.state = 'running'; task.startedAt = new Date().toISOString(); await this.persist(marker);
          if (this.stops.has(project.id)) { blocked(task, 'STOP arrived before paid dispatch.'); await this.persist(marker); break; }
          admitted++;
          running.set(task.id, this.worker(project, marker, task).then(() => ({ id: task.id }), error => ({ id: task.id, error })));
        }
        if (this.stops.has(project.id) || failure) for (const task of marker.tasks.filter(item => item.state === 'ready')) blocked(task, this.stops.has(project.id) ? 'STOP closed admission.' : 'Durable journal failure closed admission.');
        if (!running.size) break;
        const settled = await Promise.race(running.values()); running.delete(settled.id); if (settled.error) failure = settled.error;
      }
    } catch (error) { failure = error; }
    // A staging/journal error cannot orphan already admitted sessions in this process.
    const remainder = await Promise.all(running.values());
    failure ??= remainder.find(result => result.error)?.error;
    if (failure) throw failure;
    await this.persist(marker);
    return false;
  }
  private async decideWays(marker: InFlightEpoch, theorist: AgentSession, ways: PossibleWay[]): Promise<PossibleWay[]> {
    const snapshot = marker.snapshot;
    const maximumChecks = 1;
    let checks = marker.calls.filter(call=>call.task==='v2_decision_check').length;
    const fallbackBudget: RoleBudget = { ...this.planningBudget(snapshot), maxTurns: 1, maxToolCalls: 0 };
    const eligible: PossibleWay[] = [];
    // The one optional Epoch judgment goes to the highest-ranked uncertain allocation.
    const ordered=[...ways].sort((a,b)=>evaluateDecision(snapshot.researchBoundary??emptyBoundary(2),b.scores??{},b.rationales)-evaluateDecision(snapshot.researchBoundary??emptyBoundary(2),a.scores??{},a.rationales)||a.id.localeCompare(b.id));
    for (const way of ordered) {
      if (this.stops.has(marker.projectId)) break;
      if(way.allocation==='defer')continue;
      const decision = await fastDecision({ id: `${snapshot.id}_decision_${way.id}`, kind: 'effort', scores: { [way.effort]: 1, defer: 0 }, uncertainty: way.allocationUncertainty, rationale: 'Effort allocation follows the frozen Theorist plan. Allocation uncertainty is optional/unknown when absent; scientific risk does not veto exploration.' }, snapshot.policy.decision,
        checks < maximumChecks ? async (input, choices) => {
          checks++;
          return this.invoke(marker, theorist, `decision_${way.id}`, { task: 'v2_decision_check', budget: fallbackBudget, input: { decision: input, choices, policyVersion: snapshot.policy.decision.version, hypothesis: snapshot.problem?.goal ?? snapshot.hypothesis, way: copy(way), anchors: copy(snapshot.strategy.anchors.filter(a => way.anchorIds.includes(a.id))), workerBudget: copy(snapshot.executionConfig.workerBudgets[way.effort]), epochBudget: copy(snapshot.budget) } });
        } : undefined);
      decision.wayId = way.id; decision.taskId = `${snapshot.id}_${way.id}`;
      marker.decisions.push(decision); await this.persist(marker);
      if (decision.selectedAction === 'shallow' || decision.selectedAction === 'deep') eligible.push({ ...copy(way), effort: decision.selectedAction });
    }
    return eligible;
  }
  private routingBudget(snapshot: EpochSnapshot): RoleBudget { return copy(snapshot.executionConfig.roleBudget); }
  private auditBudget(snapshot: EpochSnapshot): RoleBudget { return { ...copy(snapshot.executionConfig.roleBudget), maxTurns: 1, maxToolCalls: 0 }; }
  private synthesisBudget(snapshot: EpochSnapshot): RoleBudget { return copy(snapshot.executionConfig.roleBudget); }
  private planningBudget(snapshot: EpochSnapshot): RoleBudget { return copy(snapshot.executionConfig.roleBudget); }
  private async invoke(marker: InFlightEpoch, session: AgentSession, id: string, invocation: AgentInvocationV2): Promise<unknown> {
    if (marker.calls.some(call => call.id === id)) throw new Error('A paid call ID cannot be repeated.');
    const call: InFlightEpoch['calls'][number] = { id, task: invocation.task, status: 'pending' };
    marker.calls.push(call); await this.persist(marker);
    if (this.stops.has(marker.projectId) && !['v2_worker_step', 'v2_synthesize', 'v2_audit'].includes(invocation.task)) {
      call.status = 'completed'; call.result = { skipped: 'Graceful STOP prevented new work.' }; await this.persist(marker); throw new Error('STOP closed admission.');
    }
    let result: unknown;
    try { result = await this.runtime.invoke(session, copy(invocation)); }
    catch (error) { call.status = 'uncertain'; this.captureRoleUsage(marker, session, invocation); await this.persist(marker); throw error; }
    call.status = 'completed'; call.result = copy(result);
    this.captureRoleUsage(marker, session, invocation);
    await this.persist(marker);
    return result;
  }
  private captureRoleUsage(marker: InFlightEpoch, session: AgentSession, invocation: AgentInvocationV2): void {
    if (invocation.task !== 'v2_worker_step' && this.runtime.getUsage) {
      marker.roleUsage ??= {};
      try { marker.roleUsage[invocation.task === 'v2_literature' ? 'literature' : 'theorist'] = copy(this.runtime.getUsage(session)); }
      catch { marker.roleUsage[invocation.task === 'v2_literature' ? 'literature' : 'theorist'] = { turns: 0, toolCalls: 0, tokensKnown: false, costKnown: false }; }
    }
  }
  private async worker(project: ResearchProjectV2, marker: InFlightEpoch, task: EpochTask): Promise<void> {
    let session: AgentSession | undefined;
    const protocol: WorkerResult['protocol'] = [];
    const stepNotes:NonNullable<WorkerResult['stepNotes']>=[];
    this.emit(project, 'worker.status', { taskId: task.id, status: 'running' });
    try {
      session = await this.runtime.createSession({ loop: LOOP, contractVersion: '2', id: `${project.id}_${task.id}`, projectId: project.id, role: 'worker', model: marker.snapshot.modelConfig.roleModels?.worker ?? marker.snapshot.modelConfig.defaultModel, budget: copy(task.brief.budget), context: { brief: copy(task.brief) } });
      for (const step of WORKER_PROTOCOL) {
        const output = parseWorkerStepV2(await this.invoke(marker, session, `${task.id}_${step}`, { task: 'v2_worker_step', step, input: { brief: copy(task.brief), step } }), step, task.brief);
        protocol.push(step);stepNotes.push({step,notes:output.notes}); if (output.result) task.result = output.result;
      }
      if (!task.result) throw new Error('Worker returned no structured result.');
      task.result.protocol = protocol;
      task.result.stepNotes=copy(stepNotes);
      task.state = 'staged';
    } catch (error) { task.result = this.failedResult(task, interrupted(error), executionFailure(error, session ? WORKER_PROTOCOL[protocol.length] ?? 'RETURN' : 'SESSION')); task.result.protocol = protocol;task.result.stepNotes=copy(stepNotes); task.state = interrupted(error) ? 'interrupted' : 'failed'; }
    finally {
      if (session) {
        try { if (this.runtime.getUsage) task.usage = copy(this.runtime.getUsage(session)); }
        catch { task.usage = { turns: 0, toolCalls: 0, tokensKnown: false, costKnown: false }; }
        await this.runtime.closeSession(session).catch(() => {});
      }
    }
    if (task.result) task.result.chapters = await this.runtime.savedChapters?.(project.id, task.id) ?? task.result.chapters ?? [];
    task.completedAt = new Date().toISOString(); this.updateProvisional(marker); await this.persist(marker);
    this.emit(project, 'worker.status', { taskId: task.id, status: task.state });
  }
  private updateProvisional(marker: InFlightEpoch): void {
    const staged = marker.tasks.filter(task => task.result && task.completedAt);
    marker.provisional = {
      provisional: true,
      completedTaskIds: staged.map(task => task.id),
      summary: staged.map(task => `${task.id}: execution=${task.result!.executionStatus}; conclusion=${task.result!.conclusion ?? 'unassessed'}; evidence=${task.result!.evidence}.`).join('\n'),
      constraints: staged.flatMap(task => task.result!.derivationChain.slice(0, 4).map(constraint => `${task.id}: ${constraint} [premises: ${task.result!.assumptions.join('; ')}]`)).slice(0, 1000),
      disagreements: staged.filter(task => task.result!.conclusion === 'contradictory').map(task => `${task.id}: scoped conflict ${task.result!.conflictingPropositions.join(' versus ')}; premises ${task.result!.assumptions.join('; ')}`),
      missingEvidence: [...new Set(staged.flatMap(task => task.result!.missingEvidence.map(item => `${task.id}: ${item}`)))].slice(0, 1000),
      audits: auditPairsToRecords(selectAuditPairs(staged, marker.snapshot.policy), staged),
    };
  }
  private failedResult(task: EpochTask, wasInterrupted: boolean, message: string): WorkerResult {
    return { taskId: task.id, branchId: task.brief.branchId, epochId: task.epochId, hypothesisRevision: task.brief.rootHypothesisRevision, inputRevision: task.brief.inputRevision, executionStatus: wasInterrupted ? 'interrupted' : 'failed', evidence: 'insufficient', assumptions: copy(task.brief.assumptions), applicability: '', citations: [], missingEvidence: [], idealizedConditions: [], theoryOnlyAlternatives: [], derivationChain: [], conflictingPropositions: [], checkedLimits: [], unresolvedQuestions: [task.brief.question], incomplete: true, errorSummary: message };
  }
  private async checkpoint(project: ResearchProjectV2, marker: InFlightEpoch, synthesis: SynthesisOutputV2, failed: boolean, audits: CrossDomainAudit[] = [],loadedResources=marker.snapshot.loadedResources??[]): Promise<void> {
    await this.phase(project, marker, 'gate');
    const gate = consistencyGate(marker.snapshot, marker.tasks, synthesis, audits);
    failed ||= gate.rejected.length > 0;
    const next = copy(project); delete next.activeEpoch;
    for (const result of gate.accepted) {
      if (next.results.some(existing => existing.taskId === result.taskId)) continue;
      const task = marker.tasks.find(item => item.id === result.taskId)!;
      task.result = copy(result);
      next.results.push(copy(result));
      next.graph.push({ id: result.branchId, parentId: task.way.parentId, hypothesisRevision: result.hypothesisRevision, question: task.way.question, status: result.conclusion ?? result.executionStatus, assumptions: copy(result.assumptions), implication: task.way.implication, ...(result.conclusion ? { conclusion: result.conclusion } : {}), evidence: result.evidence, executionStatus: result.executionStatus });
      task.state = result.executionStatus === 'completed' ? 'completed' : result.executionStatus;
    }
    for (const rejected of gate.rejected) { const task = marker.tasks.find(item => item.id === rejected.taskId); if (task) { task.state = 'blocked'; task.blockReason = rejected.reason; } }
    if (synthesis.reconstructionProposals?.length) {
      next.reconstructionProposals ??= [];
      for (const [index, proposal] of synthesis.reconstructionProposals.entries()) {
        if (proposal.sourceHypothesisRevision !== marker.snapshot.hypothesisRevision || proposal.hypothesis === marker.snapshot.hypothesis) continue;
        const candidateVersion = hypothesisHash(proposal.hypothesis);
        if (next.reconstructionProposals.some(existing => existing.candidateVersion === candidateVersion && existing.sourceHypothesisRevision === proposal.sourceHypothesisRevision && existing.kind === proposal.kind)) continue;
        next.reconstructionProposals.push({ ...copy(proposal), id: `${marker.snapshot.id}_reconstruction_${index}`, candidateVersion, status: 'proposed' });
      }
    }
    const traces = buildResearchTraces(marker.snapshot, marker.tasks.filter(task => gate.accepted.some(result => result.taskId === task.id)));
    for (const trace of traces.strategyTraces) { trace.decisionObservationIds = marker.decisions.filter(decision => decision.taskId === trace.taskId).map(decision => decision.id); trace.auditIds = gate.audits.filter(audit => audit.resultIds.includes(trace.taskId)).map(audit => audit.id); }
    for (const decision of marker.decisions) {
      const task = marker.tasks.find(item => item.id === decision.taskId && item.way.id === decision.wayId);
      const result = gate.accepted.find(item => item.taskId === decision.taskId);
      const rejected = gate.rejected.find(item => item.taskId === decision.taskId);
      const trace = traces.strategyTraces.find(item => item.taskId === decision.taskId);
      const limitations = ['Observed scoped execution/evidence only; not probability calibration or mathematical proof.', 'Information value, when present, is an automatic uncalibrated trace heuristic; global replay separately requires reviewed public synthesis.'];
      if (result && trace) {
        decision.outcome = {
          status: result.executionStatus === 'completed' ? 'accepted' : result.executionStatus,
          informationValue: trace.informationValue, executionStatus: result.executionStatus, evidence: result.evidence,
          ...(result.conclusion ? { conclusion: result.conclusion } : {}),
          reason: result.executionStatus === 'completed' ? `Gate accepted the scoped result: ${result.applicability.slice(0, 10000)}` : result.errorSummary ?? 'Execution did not complete; no scientific verdict inferred.',
          limitations: [...limitations, ...trace.limitations],
        };
      } else {
        decision.outcome = {
          status: rejected ? 'rejected' : decision.selectedAction === 'defer' ? 'deferred' : 'blocked',
          reason: rejected?.reason ?? task?.blockReason ?? 'No completed observation exists for this candidate.',
          limitations: [...limitations, 'This direction produced no gate-accepted result; no research utility or counterfactual scientific outcome is imputed.'],
        };
      }
    }
    next.waySkillTraces.push(...traces.waySkillTraces.filter(trace => !next.waySkillTraces.some(saved => saved.id === trace.id))); next.strategyTraces.push(...traces.strategyTraces.filter(trace => !next.strategyTraces.some(saved => saved.id === trace.id)));
    // Legacy learned WaySkills/traces remain readable history. Shared Skill learning is closure/failure owned.
    for (const audit of gate.audits) {
      const ids = audit.resultIds.map(id => gate.accepted.find(result => result.taskId === id)?.branchId).filter((id): id is string => Boolean(id));
      for (const id of ids) { const node = next.graph.find(item => item.id === id); if (node) node.relatedNodeIds = [...new Set([...(node.relatedNodeIds ?? []), ...ids.filter(other => other !== id)])]; }
    }
    const {pause} = this.applyCommands(next, await this.commands(next));
    const pendingModify=Boolean(next.pendingModificationIds?.length);
    const replacing = next.epochs.findIndex(record => record.id === marker.snapshot.id);
    const recovering = replacing >= 0;
    const decision = this.stops.has(project.id) ? 'stop' : failed || pause || next.epoch >= next.config.maxEpochs || recovering && (synthesis.decision === 'continue' || pendingModify) ? 'pause' : pendingModify?'continue':synthesis.decision === 'complete' ? 'pause' : synthesis.decision;
    const reason = decision === 'stop' ? 'Graceful STOP: admitted Workers finished their available work; available findings saved.' : pause ? 'User requested boundary pause.' : failed ? ((!marker.synthesis || synthesis.summary.startsWith('Theorist synthesis was unavailable.')) ? synthesis.reason : 'Partial findings saved; model or validation failure needs review.') : next.epoch >= next.config.maxEpochs ? 'Configured Epoch limit reached.' : pendingModify?'Queued user modification takes precedence at the next planning boundary.':synthesis.reason;
    const record: EpochRecord = { ...(recovering && next.epochs[replacing]?.userReview ? {userReview:copy(next.epochs[replacing]!.userReview!)} : {}), ...(marker.synthesis ? {synthesis:copy(marker.synthesis)} : {}), id: marker.snapshot.id, number: marker.epoch, snapshot: copy(marker.snapshot), tasks: copy(marker.tasks), decisions: copy(marker.decisions), audits: gate.audits, summary: gate.summary, userVisible: true, completedAt: new Date().toISOString(), decision, reason, committedTaskIds: gate.accepted.map(result => result.taskId) };
    const review=synthesis.researchReview;
    // A valid review may acknowledge paths and repair allocation even after an execution failure.
    // A Worker transport failure is not a scientific veto: a successfully validated
    // Theorist synthesis owns closure. Failed synthesis still cannot publish evidence.
    const scopedReview=(gate.rejected.length>0||failed&&marker.synthesis?.status!=='complete')&&review?{attemptsRead:review.attemptsRead,...(review.decisionOpportunity?{decisionOpportunity:review.decisionOpportunity}:{})}:review;
    const acknowledged = recovering ? synthesisReadVersions(project,marker.snapshot) : marker.snapshot.previouslyRead;
    if (recovering && scopedReview) {
      scopedReview.attemptsRead = [...scopedReview.attemptsRead, ...endedAttempts(next,marker.tasks)
        .filter(ref => acknowledged?.[ref.id] === ref.version && !scopedReview.attemptsRead.some(read => read.id === ref.id && read.version === ref.version))
        .map(({id,version})=>({id,version}))];
    }
    record.research=makeReceipt({id:`${project.id}_${marker.snapshot.id}${recovering ? `_synthesis_${marker.synthesis?.attempt}` : ''}`,loopVersion:2,round:marker.epoch,hypothesisId:next.hypothesisId??`h_${marker.snapshot.hypothesisRevision}`,hypothesisRevision:marker.snapshot.hypothesisRevision,hypothesis:marker.snapshot.hypothesis,...(next.previousHypothesisId?{previousHypothesisId:next.previousHypothesisId}:{}),boundary:marker.snapshot.researchBoundary??emptyBoundary(2),loadedResources:loadedResources.map(({id,version})=>({id,version})),stopRequested:this.stops.has(project.id)},endedAttempts(next,marker.tasks),scopedReview,acknowledged,project.id);
    if (record.research.review) { const issue = conditionalClosureIssue([...next.epochs.filter(epoch => epoch.id !== record.id).flatMap(epoch => epoch.tasks), ...marker.tasks], record.research.review); if (issue) { delete record.research.review.proof; record.decision = 'pause'; record.reason = issue; next.lastError = issue; } }
    if (record.research.review) { try { const componentError=applyComponentReview({...next,epochs:next.epochs.filter(old => old.id !== record.id)},record.research.review); if(componentError){record.decision='pause';record.reason=`Scientific component handoff needs correction: ${componentError}`;next.lastError=record.reason;} } catch (error) { delete record.research.review; record.research.coverageComplete=false; record.decision='pause'; record.reason=`Scientific component handoff needs correction: ${error instanceof Error ? error.message : String(error)}`; next.lastError=record.reason; } }
    if (recovering) { next.epochs[replacing] = record; next.summary = next.epochs.map(epoch => epoch.summary).join('\n\n---\n\n'); }
    else { next.epochs.push(record); next.summary += `${next.summary ? '\n\n---\n\n' : ''}${gate.summary}`; }
    next.status = record.decision === 'stop' ? 'stopped' : record.decision === 'pause' ? 'paused' : 'running'; next.phase = 'idle';
    await this.phase(project, marker, 'checkpoint');
    Object.assign(project, parseProject(await this.store.commitCheckpoint(next)));
    await this.store.clearInFlight(project.id); this.markers.delete(project.id);
    await this.registered(project,record.research);
    this.emit(project, 'checkpoint.committed', { userVisible: record.userVisible, message: project.epochs.at(-1)?.reason ?? reason });
    if (project.status !== 'running') this.emit(project, 'research.finished', { status: project.status, message: project.epochs.at(-1)?.reason ?? reason });
  }
  private async registered(project:ResearchProjectV2,receipt:ResearchReceipt|undefined):Promise<void> {
    if(!receipt)return;
    let ref: import('../../../learning/research-data.js').ProofRef | void = undefined;
    try{ref=await this.composition.afterCheckpoint?.({project:copy(project),receipt:copy(receipt),endedAttempts:endedAttempts(project)});}catch{this.emit(project,'research.warning',{message:'Saved findings and drafts remain intact; final proof submission or learning registration is pending recovery.'});}
    const saved = project.epochs.find(record => record.research?.id === receipt.id)?.research;
    if (saved?.review?.proof) {
      saved.proofArchive = ref ? {status:'saved',ref} : saved.proofArchive?.status === 'saved' ? saved.proofArchive : {status:'pending'};
      if (saved.proofArchive.status !== 'saved') this.emit(project,'research.warning',{message:'Final proof draft saved; archival has not been confirmed.'});
      completeArchivedProof(project,this.composition.isProofValid);
      Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project))));
    }
  }
  private planningChange(project:ResearchProjectV2,change:PlanningChange,modified:boolean):void {
    if(!change.linkReason.trim()||!change.hypothesis.trim()||!modified&&change.kind!=='working'||modified&&change.kind==='working'||change.kind==='working'&&!['equivalent','sufficient','counterexample'].includes(change.logicalRelation))throw new Error('Planning change requires explicit root relation and user modify precedence.');
    if(change.kind==='working'){project.workingHypothesis=copy(change);return;}
    project.hypothesisId??=`h_${project.hypothesisRevision}`;
    const revision=hypothesisHash(change.hypothesis);
    if(change.kind==='new_target'){project.previousHypothesisId=project.hypothesisId;project.hypothesisId=`h_${revision}`;}
    project.hypothesis=change.hypothesis;project.hypothesisRevision=revision;project.targetKey=change.targetKey;delete project.workingHypothesis;
    const id=`root_${revision}`;if(!project.graph.some(node=>node.id===id))project.graph.push({id,hypothesisRevision:revision,question:change.hypothesis,status:'pending',assumptions:copy(change.conditions)});
  }
  private async boundaryStop(project: ResearchProjectV2): Promise<void> {
    this.applyCommands(project, await this.commands(project));
    project.status = 'stopped'; project.phase = 'idle'; Object.assign(project, parseProject(await this.store.commitCheckpoint(copy(project))));
    this.emit(project, 'research.finished', { status: project.status });
  }
}

/** Public explicit paths only. No hidden model reasoning or other-session failures are recalled. */
export function endedAttempts(project:ResearchProjectV2,current:readonly EpochTask[]=[]):EndedAttempt[] {
  const tasks=new Map([...project.epochs.flatMap(epoch=>epoch.tasks),...current].filter(task=>task.result).map(task=>[task.id,task]));
  return [...tasks.values()].map(task=>{const result=task.result!;return endedAttempt({id:task.id,workerId:`${project.id}_${task.id}`,wayId:task.way.id,hypothesisRevision:task.brief.rootHypothesisRevision,question:task.brief.question,method:task.way.waySkillId,assumptions:copy(result.assumptions),executionStatus:result.executionStatus,...(result.conclusion?{conclusion:result.conclusion}:{}),...(result.chapters?{chapters:result.chapters}:{}),path:explicitResult(result),obstacle:result.errorSummary??result.unresolvedQuestions.join('\n'),continuation:copy(result.unresolvedQuestions)});});
}
