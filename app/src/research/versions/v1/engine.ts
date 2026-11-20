import { applyComponentReview, eligibleComponents, selectComponents, componentInput, componentIssuesFor } from '../../proof-components.js';
import { applyPresentation } from '../../../presentation/session-presentation.js';
import { stableHash as documentHash } from '../../../learning/research-hash.js';
import { parseBranchResult, parseBrief, parseCommand, parseLiterature, parsePlan, parseProject, parseReview, parseSynthesis, parseWorkerStep } from './schemas.js';
import { compareFrontier, rankFrontier } from './frontier.js';
import { assertTransition } from './state.js';
import { WORKER_PROTOCOL, type AgentInvocation, type AgentRuntime, type AgentSession, type BranchResult, type FrontierPolicy, type InFlightRound, type ResearchBrief, type ResearchEvent, type ResearchProject, type ResearchRole, type ResearchStage, type ResearchStore, type ReviewOutput, type RoundDecision, type RoundRecord, type UserCommand } from '../../contracts/v1.js';
import { inheritedContextInput, attemptInput, continuationAllowed, declaredSkillsAreLoaded, emptyBoundary, endedAttempt, explicitResult, evaluateDecision, hypothesisRevision, loadResources, makeReceipt, promptProject } from '../../review.js';
import type { EndedAttempt, PlanningChange, ResearchComposition, ResearchReceipt } from '../../contracts/review.js';
import { normalizeTags, type BoundaryView } from '../../../learning/research-data.js';
import { finishPlanningInputs, ingestCommands, initializeCommandStates, markPlanningInputs, releasePlanningInputs, selectPlanningInputs } from '../../user-commands.js';

const clone = <T>(value: T): T => structuredClone(value);
const safeError = (error: unknown): string => {
  if (error instanceof Error && error.name === 'ValidationError') return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const known: Record<string, string> = {
    AUTH_REQUIRED: 'Connect the selected provider in settings before starting research.',
    MODEL_REQUIRED: 'Choose a provider and model before starting research.',
    MODEL_UNAVAILABLE: 'The selected model is unavailable. Choose another model explicitly; no fallback was used.',
    BUDGET_EXHAUSTED: 'The original session budget or deadline was reached; no scientific verdict was assigned.',
    BUDGET_UNAVAILABLE: 'The selected provider cannot report the usage needed to enforce this budget.',
    TOOL_FAILED: 'A restricted tool was denied or failed; no scientific verdict was assigned.',
  };
  return known[code] ?? 'Agent execution failed. Check the selected provider, authorization and configured budget; no provider fallback was used.';
};
const executionStatus = (error: unknown): 'failed' | 'interrupted' => typeof error === 'object' && error !== null && 'executionStatus' in error && error.executionStatus === 'interrupted' ? 'interrupted' : 'failed';
const writers = new WeakMap<ResearchStore, Set<string>>();

/** Sole authoritative scientific writer. Concrete runtime, filesystem and UI stay behind ports. */
export class ResearchEngine {
  private readonly active = new Map<string, Promise<void>>();
  private readonly snapshots = new Map<string, ResearchProject>();
  private readonly stops = new Set<string>();
  private readonly softDeadlines = new Map<string, number>();
  private readonly listeners = new Set<(event: ResearchEvent) => void>();
  private readonly boundaries = new Map<string,BoundaryView>();
  constructor(private readonly store: ResearchStore, private readonly runtime: AgentRuntime, private readonly composition:ResearchComposition<ResearchProject>={}) {}
  isActive(projectId?: string): boolean { return projectId ? this.active.has(projectId) : this.active.size > 0; }
  subscribe(listener: (event: ResearchEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async getSnapshot(projectId: string, savedProject?: ResearchProject): Promise<ResearchProject> {
    const live = this.snapshots.get(projectId);
    if (this.isActive(projectId) && live) return clone(live);
    const saved = parseProject(savedProject ?? await this.store.loadProject(projectId));
    // Surface an in-process failure without presenting uncommitted results as a saved checkpoint.
    return live?.status === 'failed' ? { ...saved, status: 'failed', lastError: live.lastError ?? 'Research failed before a durable checkpoint. Explicit recovery is available.' } : saved;
  }
  /** Startup-only state reconciliation: never creates a model session or starts a research round. */
  async reconcile(projectId: string): Promise<ResearchProject> {
    const locks = writers.get(this.store) ?? new Set<string>(); writers.set(this.store, locks);
    if (locks.has(projectId) || this.active.has(projectId)) throw new Error('Cannot reconcile a project while its authoritative writer is active.');
    locks.add(projectId);
    let project: ResearchProject | undefined;
    try {
      project = parseProject(await this.store.loadProject(projectId)); this.snapshots.set(projectId, project);
      const beforeMigration = JSON.stringify(project);
      initializeCommandStates(project, await this.commandJournal(project));
      const recovered = await this.recover(project);
      if (!recovered && project.status === 'running') {
        // A process can exit after DECIDE has committed but before the next round marker exists.
        project.status = 'paused';
        project.lastError = 'The previous backend ended without an active research session. Saved findings are preserved; resume explicitly when ready.';
        Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
        this.emit(project, 'research.warning', { message: project.lastError });
        this.emit(project, 'research.finished', { status: project.status });
      } else if (!recovered && (project.refinements.length || project.userInputWarnings?.length) && JSON.stringify(project) !== beforeMigration) {
        Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
      }
      this.stops.delete(projectId);
      return clone(project);
    } catch (error) {
      if (project) { project.status = 'failed'; project.lastError = 'Saved research could not be safely reconciled. The last durable checkpoint is unchanged; recovery requires resolving the storage error.'; }
      throw error;
    } finally { locks.delete(projectId); }
  }
  async enqueue(value: UserCommand): Promise<void> {
    const command = parseCommand(value);
    const current = this.snapshots.get(command.projectId) ?? await this.store.loadProject(command.projectId);
    if (current.processedCommandIds.includes(command.id)) return;
    // STOP blocks dispatch synchronously, before durable I/O. A failed journal write remains safely stopped.
    if (command.kind === 'stop') this.stops.add(command.projectId);
    await this.store.enqueueCommand(command);
    const project = this.snapshots.get(command.projectId);
    if (project) this.emit(project, 'project.updated', { message: `${command.kind} queued for the safe round boundary.` });
  }
  start(projectId: string): Promise<void> {
    const locks = writers.get(this.store) ?? new Set<string>(); writers.set(this.store, locks);
    if (locks.has(projectId) || this.active.has(projectId)) return Promise.reject(new Error('Research is already active for this project.'));
    locks.add(projectId);
    const work = this.run(projectId).catch((error: unknown) => {
      const project = this.snapshots.get(projectId);
      if (project && project.status !== 'failed') {
        project.status = 'failed'; project.lastError = 'Research could not load or save its safe boundary. The last durable checkpoint remains available for explicit recovery.';
        this.emit(project, 'research.warning', { status: 'failed', message: project.lastError });
      }
      throw error;
    }).finally(() => { this.active.delete(projectId); this.softDeadlines.delete(projectId); locks.delete(projectId); this.stops.delete(projectId); });
    this.active.set(projectId, work);
    return work;
  }
  async shutdown(): Promise<void> {
    const running = [...this.active.entries()];
    await Promise.all(running.map(([projectId], index) => this.enqueue({ id: `shutdown_${Date.now()}_${index}`, projectId, kind: 'stop', payload: 'Full backend shutdown requested.', createdAt: new Date().toISOString() })));
    await Promise.all(running.map(([, work]) => work));
  }
  private emit(project: ResearchProject, type: ResearchEvent['type'], extra: Partial<ResearchEvent> = {}): void {
    const event: ResearchEvent = { type, projectId: project.id, round: project.round, ...extra };
    for (const listener of this.listeners) { try { listener(clone(event)); } catch { /* A subscriber cannot change or terminate research. */ } }
  }
  private async commands(project: ResearchProject): Promise<UserCommand[]> {
    return (await this.commandJournal(project)).filter((command) => !project.processedCommandIds.includes(command.id));
  }
  private async commandJournal(project: ResearchProject): Promise<UserCommand[]> {
    return (await this.store.listCommands(project.id)).map(parseCommand).filter((command) => command.projectId === project.id);
  }
  private async session(project: ResearchProject, role: ResearchRole): Promise<AgentSession> {
    return this.runtime.createSession({ promptRevision:'categorized-v1', id: `${project.id}_${role}_${project.round}`, projectId: project.id, loop: { researchLoopVersion: project.researchLoopVersion, workerProtocolVersion: project.workerProtocolVersion }, role, model: project.config.roleModels?.[role] ?? project.config.defaultModel, budget: { ...clone(project.config.roleBudget), softDeadlineAt: this.softDeadlines.get(project.id) }, context: { project: clone(project), ...(role==='theorist'?{researchBoundary:clone(this.boundaries.get(project.id)??emptyBoundary(1))}:{}) } });
  }
  private async optional(project: ResearchProject, role: 'moderator' | 'literature', invocation: AgentInvocation): Promise<unknown | undefined> {
    if (this.stops.has(project.id)) return undefined;
    let handle: AgentSession | undefined;
    try { handle = await this.session(project, role); return await this.runtime.invoke(handle, clone(invocation)); }
    catch { this.emit(project, 'research.warning', { message: `Optional ${role} was unavailable; the core research loop continues without fabricated output.` }); return undefined; }
    finally { if (handle) await this.close(handle, project); }
  }
  private async close(handle: AgentSession, project: ResearchProject): Promise<void> {
    try { await this.runtime.closeSession(handle); } catch { this.emit(project, 'research.warning', { message: 'A runtime session could not be cleanly disposed; saved research is unchanged.' }); }
  }
  private policy(project: ResearchProject): FrontierPolicy {
    const boundary=this.boundaries.get(project.id)??emptyBoundary(1);
    return {weights:Object.fromEntries(boundary.decision.factors.map(factor=>[factor.id,factor.weight])),version:boundary.decision.version,effectiveFromRound:project.round,boundary};
  }
  private attempts(project:ResearchProject):EndedAttempt[] { return endedAttempts(project); }
  private planningChange(project:ResearchProject,change:PlanningChange|undefined,modified:boolean):string|undefined {
    if(!change)return;
    if(!change.linkReason.trim()||!change.hypothesis.trim()||!modified&&change.kind!=='working'||modified&&change.kind==='working'||change.kind==='working'&&!['equivalent','sufficient','counterexample'].includes(change.logicalRelation))throw new Error('Planning change requires explicit root relation and user modify precedence.');
    if(change.kind==='working'){project.workingHypothesis=clone(change);return;}
    const oldRoot=project.graph.find(node=>!node.parentId&&node.hypothesisRevision===project.hypothesisRevision)?.id;
    project.hypothesisId??=`h_${project.hypothesisRevision}`;
    const revision=hypothesisRevision(change.hypothesis);
    if(change.kind==='new_target'){project.previousHypothesisId=project.hypothesisId;project.hypothesisId=`h_${revision}`;}
    project.hypothesis=change.hypothesis;project.hypothesisRevision=revision;project.targetKey=change.targetKey;delete project.workingHypothesis;
    const id=`root_${revision}`;if(!project.graph.some(node=>node.id===id))project.graph.push({id,hypothesisRevision:revision,question:change.hypothesis,status:'pending'});
    return oldRoot;
  }
  private async registered(project:ResearchProject,receipt:ResearchReceipt|undefined):Promise<void> {
    if(!receipt)return;
    let ref: import('../../../learning/research-data.js').ProofRef | void = undefined;
    try{ref=await this.composition.afterCheckpoint?.({project:clone(project),receipt:clone(receipt),endedAttempts:endedAttempts(project)});}catch{this.emit(project,'research.warning',{message:'Saved findings and drafts remain intact; final proof submission or learning registration is pending recovery.'});}
    const saved = project.rounds.find(record => record.research?.id === receipt.id)?.research;
    if (saved?.review?.proof) {
      saved.proofArchive = ref ? {status:'saved',ref} : {status:'pending'};
      if (!ref) this.emit(project,'research.warning',{message:'Final proof draft saved; archival has not been confirmed.'});
      Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
    }
  }
  private async recover(project: ResearchProject): Promise<boolean> {
    const checkpointRound = project.rounds.find((round) => round.number === project.round);
    if (project.stage === 'CHECKPOINT' && checkpointRound?.decisionContext) {
      const context = checkpointRound.decisionContext;
      // A durable CHECKPOINT already owns these results. Finish only its missing DECIDE stage.
      assertTransition(project.stage, 'DECIDE'); project.stage = 'DECIDE'; checkpointRound.stages.push('DECIDE');
      this.emit(project, 'round.stage', { stage: 'DECIDE' });
      const pending = await this.commands(project);
      const additional = this.applyCommands(project, pending);
      const control = { stop: context.control.stop || additional.stop, pause: context.control.pause || additional.pause, refine: context.control.refine || additional.refine };
      let [decision, reason] = this.decide(project, context.review, context.failed, control);
      if (decision === 'continue' || decision === 'refine') { decision = 'pause'; reason = 'Recovered a complete checkpoint without repeating model calls. Resume explicitly to start the next round.'; }
      checkpointRound.decision = decision; checkpointRound.reason = reason; checkpointRound.completedAt = new Date().toISOString(); delete checkpointRound.decisionContext;
      project.status = decision === 'stop' ? 'stopped' : decision === 'complete' ? 'completed' : 'paused';
      Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
      await this.store.clearInFlight(project.id);
      this.emit(project, 'research.finished', { status: project.status, message: reason });
      return true;
    }
    const orphan = await this.store.loadInFlight(project.id);
    if (!orphan) return false;
    if (orphan.round <= project.round && project.rounds.some((round) => round.number === orphan.round && round.completedAt)) { await this.store.clearInFlight(project.id); return false; }
    if (orphan.planningSelection) releasePlanningInputs(project, orphan.planningSelection, 'The interrupted plan was not adopted; it remains available for the next explicit start.');
    for (const brief of orphan.briefs) {
      if (project.results.some((result) => result.branchId === brief.branchId)) continue;
      const result: BranchResult = { branchId: brief.branchId, executionStatus: 'interrupted', assumptions: brief.assumptions, applicability: '', citations: [], unresolvedQuestions: [brief.question], proposedFollowups: [],stepNotes:clone(orphan.workerProgress?.[brief.branchId]??[]),protocol:(orphan.workerProgress?.[brief.branchId]??[]).map(note=>note.step), errorSummary: 'The backend ended before a committed result. Private notes may be recovered; no automatic retry was started.' };
      project.results.push(result);
      result.chapters = await this.runtime.savedChapters?.(project.id, brief.branchId) ?? [];
      const item = project.frontier.find((item) => item.id === brief.branchId); if (item) item.state = 'deferred';
      const node = project.graph.find((node) => node.id === brief.branchId);
      if (node) { node.status = 'interrupted'; node.executionStatus = 'interrupted'; delete node.conclusion; }
      else project.graph.push({ id: brief.branchId, parentId: brief.parentId ?? item?.parentId ?? 'root', hypothesisRevision: brief.rootHypothesisRevision, question: brief.question, ...(brief.targetTheory ? { targetTheory: brief.targetTheory } : {}), mode: brief.mode, effort: brief.effort, status: 'interrupted', executionStatus: 'interrupted' });
    }
    project.status = 'paused'; project.lastError = 'An unfinished round was recovered. Orphaned work is interrupted, not scientifically inconclusive. Review before explicitly resuming.';
    project.summary += `\n\nRecovery: ${project.lastError}`;
    const committed = await this.store.commitCheckpoint(clone(project)); Object.assign(project, committed);
    await this.store.clearInFlight(project.id);
    this.emit(project, 'research.warning', { message: project.lastError });
    this.emit(project, 'research.finished', { status: 'paused' });
    return true;
  }
  private async run(projectId: string): Promise<void> {
    const project = parseProject(await this.store.loadProject(projectId)); this.snapshots.set(projectId, project);
    this.softDeadlines.set(projectId, Date.now() + project.config.roleBudget.timeoutMs);
    initializeCommandStates(project, await this.commandJournal(project));
    if (await this.recover(project)) return;
    project.hypothesisId??=`h_${project.hypothesisRevision}`;
    for(const round of project.rounds)await this.registered(project,round.research);
    // Commands arriving while idle are already at a safe boundary and must inform the very next plan.
    const idleCommands = await this.commands(project);
    if (idleCommands.length) {
      const control = this.applyCommands(project, idleCommands);
      if (control.stop || control.pause) project.status = control.stop ? 'stopped' : 'paused';
      Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
      if (control.stop || control.pause) { this.emit(project, 'research.finished', { status: project.status }); return; }
    }
    if (project.round >= project.config.maxRounds || project.results.length >= project.config.maxBranches) {
      project.status = 'paused'; project.lastError = 'Configured round or branch budget is exhausted. Increase the budget explicitly before resuming.';
      Object.assign(project, await this.store.commitCheckpoint(clone(project))); this.emit(project, 'research.finished', { status: project.status, message: project.lastError }); return;
    }
    if ((await this.commands(project)).some((command) => command.kind === 'stop')) this.stops.add(projectId);
    delete project.lastError;
    project.status = 'running';
    try {
      let first = project.round === 0;
      while (project.status === 'running') {
        if (!first && this.stops.has(projectId)) { await this.finishBoundaryStop(project); break; }
        project.round += 1;
        const loop = { researchLoopVersion: project.researchLoopVersion, workerProtocolVersion: project.workerProtocolVersion };
        let round: RoundRecord = { promptRevision:'categorized-v1', loop, id: `round_${project.round}`, number: project.round, hypothesisRevision: project.hypothesisRevision, inputRevision: project.contentRevision, stages: [], branchIds: [], summary: '', userVisible: project.round % 3 === 0 };
        project.rounds.push(round);
        const marker: InFlightRound = { promptRevision:'categorized-v1', loop, projectId, round: project.round, stage: 'INTAKE', briefs: [], startedAt: new Date().toISOString() };
        const stage = async (next: ResearchStage) => {
          if (round.stages.length > 0 || !first) assertTransition(project.stage, next);
          project.stage = next; round.stages.push(next); marker.stage = next;
          await this.store.saveInFlight(clone(marker)); this.emit(project, 'round.stage', { stage: next });
        };
        if(!first)project.stage='DECIDE';
        await stage('INTAKE');
        first = false;
        const boundary=await this.composition.readBoundary?.({sessionId:project.id,loopVersion:1,hypothesis:project.hypothesis,tags:project.researchTags})??emptyBoundary(1);
        const inherited=await this.composition.readInherited?.(project.id);
        const learningResources=await loadResources(this.composition,boundary,{sessionId:project.id,loopVersion:1,hypothesis:project.hypothesis,tags:project.researchTags});
        const loadedResources=learningResources.map(({meta})=>({id:meta.id,version:meta.version}));
        this.boundaries.set(project.id,{decision:clone(boundary.decision),skills:clone(boundary.skills),strategies:[],...(boundary.proofs?{proofs:clone(boundary.proofs)}:{})});
        const previouslyRead=Object.assign({},...project.rounds.flatMap(record=>record.research?.review?.attemptsRead.map(ref=>({[ref.id]:ref.version}))??[]),('inspectedAttempts' in boundary?boundary.inspectedAttempts:undefined));
        await stage('PLAN');
        // This read is the PLAN cutoff. Submissions after it remain in the journal
        // for the next boundary and cannot alter this round's admitted inputs.
        const journal = await this.commandJournal(project);
        initializeCommandStates(project, journal);
        const planningControl = this.applyCommands(project, journal);
        const selection = selectPlanningInputs(project, journal, round.id);
        for (const item of project.frontier) if (item.state === 'pending' && item.hypothesisRevision !== project.hypothesisRevision) item.state = 'deferred';
        let theorist: AgentSession | undefined;
        let modelFailure = false;
        let committingPlan = false;
        let review: ReviewOutput = { decision: 'continue', reason: 'Pending frontier work remains.', nextQuestions: [] };
        try {
          if (!this.stops.has(projectId) && !planningControl.pause) {
            try {
              if (selection.blockedReason) throw new Error(selection.blockedReason);
              markPlanningInputs(project, selection);
              marker.planningSelection = clone(selection);
              await this.store.saveInFlight(clone(marker));
              theorist = await this.session(project, 'theorist');
              const pending=selection.pendingModifications,attempts=this.attempts(project);
              const plan = parsePlan(await this.runtime.invoke(theorist, { task: 'plan', input: { ...inheritedContextInput(inherited), project: promptProject(project,endedAttempts(project)), researchBoundary:clone(boundary),learningResources,pendingModifications:pending,pendingAnnotations:selection.pendingAnnotations,...(selection.reconstruction?{selectedReconstruction:selection.reconstruction}:{}),...attemptInput(attempts,previouslyRead),adoptedPrerequisites:eligibleComponents(project),componentState:componentInput(project) } }));
              loadedResources.push(...(this.runtime.loadedResourceRefs?.(theorist)??[]));
              if(plan.researchTags)project.researchTags=normalizeTags(plan.researchTags);
              if(pending.length&&!plan.planningChange)throw new Error('Pending user modification requires classification.');
              if(selection.reconstruction&&(plan.planningChange?.hypothesis!==selection.reconstruction.hypothesis||selection.reconstruction.assumptions.some(condition=>!plan.planningChange?.conditions.includes(condition))))throw new Error('Reconstruction acceptance requires the exact selected hypothesis and conditions.');
              const oldRoot=this.planningChange(project,plan.planningChange,pending.length>0);
              applyPresentation(project, plan.presentation, plan.candidates[0]?.question);
              if(oldRoot)for(const candidate of plan.candidates)if(candidate.parentId===oldRoot||candidate.parentId==='root')candidate.parentId=`root_${project.hypothesisRevision}`;
              finishPlanningInputs(project, selection, project.hypothesisRevision);
              round.hypothesisRevision = project.hypothesisRevision;
              for (const candidate of plan.candidates) { if (candidate.dependencyChapters?.length) { candidate.dependencyChapters = selectComponents(project,candidate.dependencyChapters); if (!candidate.dependencyUse?.reuse.trim() || !candidate.dependencyUse.recheck.trim()) throw new Error("Accepted dependencies require applicability and reuse instructions."); } }
              const valid = plan.candidates.filter((candidate) => project.graph.some((node) => node.id === candidate.parentId&&node.hypothesisRevision===project.hypothesisRevision) && !project.graph.some((node) => node.id === candidate.id)&&declaredSkillsAreLoaded(candidate.skillRefs??[],boundary,loadedResources)&&continuationAllowed(candidate.continuation,[...attempts,...(inherited?.attempts??[])]));
              if (valid.length !== plan.candidates.length) this.emit(project, 'research.warning', { message: 'Candidate directions with unknown parents were rejected.' });
              project.frontier.push(...rankFrontier(valid, project.frontier, this.policy(project), project.hypothesisRevision));
              if(plan.planningChange || selection.commandIds.length) {
                committingPlan = true;
                Object.assign(project,parseProject(await this.store.commitCheckpoint(clone(project))));
                // The parsed checkpoint replaces nested arrays; subsequent stage,
                // branch and receipt updates must target its current round object.
                round = project.rounds.find(item=>item.id===round.id)!;
                committingPlan = false;
              }
            } catch (error) {
              if (committingPlan) throw error;
              releasePlanningInputs(project, selection, 'Planning did not produce a valid accepted classification.');
              modelFailure = true; project.lastError = safeError(error); this.emit(project, 'research.warning', { message: project.lastError });
            }
          }
          await stage('PRIORITIZE');
          for (const item of project.frontier.filter((item) => item.state === 'pending')) {
            if(!declaredSkillsAreLoaded(item.skillRefs??[],boundary,loadedResources)){item.state='deferred';continue;}
            try{item.priority=evaluateDecision(boundary,item.scores,item.rationales);}catch{item.state='deferred';}
          }
          project.frontier.sort(compareFrontier);
          if (project.config.literatureEnabled && !planningControl.pause) {
            const output = await this.optional(project, 'literature', { task: 'literature', input: { project: promptProject(project, endedAttempts(project)) } });
            if (output !== undefined) {
              try { const literature = parseLiterature(output); for (const card of literature.evidence) { card.citation.verified = false; if (!project.evidence.some((existing) => JSON.stringify(existing) === JSON.stringify(card))) project.evidence.push(card); } }
              catch { this.emit(project, 'research.warning', { message: 'Malformed optional literature evidence was ignored.' }); }
            }
          }
          await stage('DISPATCH');
          const frozen = await this.store.freezeInputs(clone(project));
          round.hypothesisRevision = frozen.hypothesisRevision; round.inputRevision = frozen.contentRevision;
          const remaining = project.config.maxBranches - project.results.length;
          const selected = this.stops.has(projectId) || planningControl.pause || modelFailure ? [] : project.frontier.filter((item) => item.state === 'pending' && item.hypothesisRevision === frozen.hypothesisRevision && !project.results.some((result) => result.branchId === item.id)).slice(0, Math.min(project.config.maxWorkers, remaining));
          const briefs = selected.map((item) => parseBrief({ promptRevision:'categorized-v1', adoptedChapters:selectComponents(project,item.dependencyChapters??[]),componentIssues:componentIssuesFor(project,item.dependencyChapters??[]),...(item.dependencyUse?{dependencyUse:item.dependencyUse}:{}),branchId: item.id, parentId: item.parentId, rootHypothesisRevision: frozen.hypothesisRevision, inputRevision: frozen.contentRevision, hypothesis: project.hypothesis, question: item.question, ...(item.targetTheory ? { targetTheory: item.targetTheory } : {}), mode: item.mode, effort: item.effort, assumptions: item.assumptions, frozenSourceRefs: frozen.sources, budget: { ...clone(project.config.workerBudgets[item.effort]), softDeadlineAt: this.softDeadlines.get(project.id) },...(item.proofContext?{proofContext:item.proofContext}:{}),conventionVersion:documentHash({target:frozen.hypothesisRevision,assumptions:item.assumptions,context:item.proofContext??null}),wayId:item.wayId??item.id,skillRefs:item.skillRefs??[],decisionVersion:boundary.decision.version,...(item.assignment?{assignment:item.assignment}:{}),...(item.continuation?{continuation:item.continuation}:{}),...(project.workingHypothesis?{workingHypothesis:project.workingHypothesis}:{}) }));
          await stage('VERIFY');
          const tasks: Promise<BranchResult>[] = [];
          let dispatchError: unknown;
          try {
            for (const brief of briefs) {
              if (this.stops.has(projectId)) break;
              marker.briefs.push(clone(brief));
              await this.store.saveInFlight(clone(marker));
              if (this.stops.has(projectId)) { marker.briefs.pop(); await this.store.saveInFlight(clone(marker)); break; }
              const item = project.frontier.find((item) => item.id === brief.branchId)!; item.state = 'active';
              project.graph.push({ id: brief.branchId, parentId: item.parentId, hypothesisRevision: brief.rootHypothesisRevision, question: brief.question, ...(brief.targetTheory ? { targetTheory: brief.targetTheory } : {}), mode: brief.mode, effort: brief.effort, priority: item.priority, status: 'active' });
              round.branchIds.push(brief.branchId);
              tasks.push(this.worker(project, clone(brief),marker));
            }
          } catch (error) { dispatchError = error; }
          // A journal error stops further launch but cannot orphan already active sessions in-process.
          const results = await Promise.all(tasks);
          if (dispatchError) throw dispatchError;
          await stage('SYNTHESIZE');
          for (const result of results) this.promote(project, result);
          const branchSummary = results.map((result) => `- ${result.branchId}: execution=${result.executionStatus}; conclusion=${result.conclusion ?? 'not assessed'}; assumptions=${result.assumptions.join('; ') || 'none supplied'}; scope=${result.applicability || 'unfinished'}; ${result.errorSummary ?? ''}`).join('\n');
          let summary = `Round ${project.round}\n\n${branchSummary || 'No new workers were launched.'}`;
          if (theorist) {
            try {
              const attempts=this.attempts(project);
              const synthesis = parseSynthesis(await this.runtime.invoke(theorist, { task: 'synthesize', input: { ...inheritedContextInput(inherited), project: promptProject(project,endedAttempts(project)), ...attemptInput(attempts,previouslyRead),adoptedPrerequisites:eligibleComponents(project),componentState:componentInput(project) } }));
              summary = `${synthesis.summary}\n\nBranch conditions and execution:\n${branchSummary || 'No new workers were launched.'}\n\nDisagreements:\n${synthesis.disagreements.map((item) => `- ${item}`).join('\n')}\n\nUnresolved:\n${synthesis.unresolvedQuestions.map((item) => `- ${item}`).join('\n')}`;
              for (const related of synthesis.relatedNodes ?? []) {
                const from = project.graph.find((node) => node.id === related.from && node.executionStatus === 'completed');
                const to = project.graph.find((node) => node.id === related.to && node.executionStatus === 'completed');
                if (from && to && from.id !== to.id) from.relatedNodeIds = [...new Set([...(from.relatedNodeIds ?? []), to.id])];
              }
            } catch (error) { modelFailure = true; project.lastError = safeError(error); summary += '\n\nTheorist model synthesis was unavailable; this is a factual partial record, not a completed scientific synthesis.'; }
          }
          project.summary = `${project.summary}${project.summary ? '\n\n---\n\n' : ''}${summary}`; round.summary = summary;
          await stage('REVIEW');
          if (theorist) {
            try {
              const attempts=this.attempts(project);
              review = parseReview(await this.runtime.invoke(theorist, { task: 'review', input: { ...inheritedContextInput(inherited), project: promptProject(project,endedAttempts(project)), researchBoundary:clone(boundary),...attemptInput(attempts,previouslyRead),adoptedPrerequisites:eligibleComponents(project),componentState:componentInput(project) } }));
              for (const experience of review.experiences ?? []) project.experiences.push({ ...experience, round: project.round, status: 'unreviewed' });
              if (review.nextQuestions.length) project.summary += `\n\nNext-round questions:\n${review.nextQuestions.map((question) => `- ${question}`).join('\n')}`;
            } catch (error) { modelFailure = true; project.lastError = safeError(error); }
          }
          // Legacy experience records remain local audit; shared learning uses the explicit receipt.
          for (const result of results) {
            const context = `${project.hypothesisRevision}: ${project.graph.find((node) => node.id === result.branchId)?.question ?? result.branchId}`;
            const limitations = `Applies only to assumptions: ${result.assumptions.join('; ')}. ${result.verificationQuality ?? result.errorSummary ?? 'Requires review.'}`;
            project.experiences.push({ round: project.round, kind: 'routing', context, lesson: `Branch execution ${result.executionStatus}; scientific outcome ${result.conclusion ?? 'unassessed'}.`, limitations, status: 'unreviewed' });
            project.experiences.push({ round: project.round, kind: 'strategy', context, lesson: result.strongestObjection ? `Recorded challenge to address in related future work: ${result.strongestObjection}` : `Execution limitation to review before retrying: ${result.errorSummary ?? 'No completed challenge was returned.'}`, limitations, status: 'unreviewed' });
          }
          round.research=makeReceipt({id:`${project.id}_round_${project.round}`,loopVersion:1,round:project.round,hypothesisId:project.hypothesisId??`h_${project.hypothesisRevision}`,hypothesisRevision:round.hypothesisRevision,hypothesis:project.hypothesis,...(project.previousHypothesisId?{previousHypothesisId:project.previousHypothesisId}:{}),boundary:{decision:boundary.decision,skills:boundary.skills,strategies:[],...(boundary.proofs?{proofs:boundary.proofs}:{})},loadedResources:loadedResources.map(({id,version})=>({id,version})),stopRequested:this.stops.has(projectId)},this.attempts(project),modelFailure?undefined:review.researchReview,previouslyRead,project.id);
          if (round.research.review) { try { const prior = {...project,rounds:project.rounds.filter(saved => saved !== round)}; const componentError=applyComponentReview(prior,round.research.review); if(componentError){modelFailure=true;project.lastError=componentError;this.emit(project,'research.warning',{message:componentError});} } catch (error) { delete round.research.review; round.research.coverageComplete=false; modelFailure=true; project.lastError=safeError(error); this.emit(project,'research.warning',{message:project.lastError}); } }
          if(review.researchReview&&!round.research.coverageComplete)this.emit(project,'research.warning',{message:'Some explicit paths remain unread; proof and learning eligibility were not confirmed.'});
          await stage('CHECKPOINT');
          const queued = await this.commands(project);
          const checkpointControl = this.applyCommands(project, queued);
          const control = { stop: planningControl.stop || checkpointControl.stop, pause: planningControl.pause || checkpointControl.pause, refine: checkpointControl.refine };
          round.decisionContext = { review: clone(review), failed: modelFailure, control };
          Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
          this.emit(project, 'checkpoint.committed', { userVisible: round.userVisible, message: 'Round findings and queued instructions saved; research decision follows.' });
          // Scientific/control decisions occur in DECIDE, after the stage-eight checkpoint is durable.
          await stage('DECIDE');
          const lateControl = this.applyCommands(project, await this.commands(project));
          const [decision, reason] = this.decide(project, review, modelFailure, { stop: control.stop || lateControl.stop, pause: control.pause || lateControl.pause, refine: control.refine || lateControl.refine });
          const savedRound = project.rounds.find((item) => item.number === round.number)!;
          savedRound.stages = [...round.stages]; savedRound.decision = decision; savedRound.reason = reason; savedRound.completedAt = new Date().toISOString(); delete savedRound.decisionContext;
          project.status = decision === 'stop' ? 'stopped' : decision === 'pause' ? 'paused' : decision === 'complete' ? 'completed' : 'running';
          Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
          await this.store.clearInFlight(projectId);
          await this.registered(project,project.rounds.find(item=>item.number===round.number)?.research);
          this.emit(project, 'project.updated');
          if (project.status !== 'running') this.emit(project, 'research.finished', { status: project.status, message: reason });
        } finally { if (theorist) await this.close(theorist, project); }
      }
    } catch (error) {
      project.status = 'failed'; project.lastError = 'Research could not finish or commit its checkpoint. The last valid checkpoint and private notes remain recoverable.';
      this.emit(project, 'research.warning', { status: 'failed', message: project.lastError });
      throw error;
    }
  }
  private async worker(project: ResearchProject, brief: ResearchBrief, marker:InFlightRound): Promise<BranchResult> {
    let session: AgentSession | undefined;
    const protocol: typeof WORKER_PROTOCOL[number][] = [];
    const stepNotes: NonNullable<BranchResult['stepNotes']> = [];
    this.emit(project, 'worker.status', { branchId: brief.branchId, status: 'active' });
    try {
      session = await this.runtime.createSession({ ...(brief.promptRevision?{promptRevision:brief.promptRevision}:{}), id: `${project.id}_worker_${brief.branchId}`, projectId: project.id, loop: { researchLoopVersion: project.researchLoopVersion, workerProtocolVersion: project.workerProtocolVersion }, role: 'worker', model: project.config.roleModels?.worker ?? project.config.defaultModel, budget: clone(brief.budget), context: { brief: clone(brief) } });
      let result: BranchResult | undefined;
      for (const step of WORKER_PROTOCOL) {
        // STOP deliberately does not cancel already launched workers or replace their established deadline.
        const response = parseWorkerStep(await this.runtime.invoke(session, { task: 'worker_step', step, input: { brief: clone(brief), step } }), step);
        stepNotes.push({step,notes:response.notes});
        (marker.workerProgress??={})[brief.branchId]=clone(stepNotes);await this.store.saveInFlight(clone(marker));
        protocol.push(step);
        if (response.result) result = parseBranchResult(response.result, brief);
      }
      if (!result) throw new Error('Worker did not return a result.');
      result.protocol = [...protocol];
      result.stepNotes=clone(stepNotes);
      result.chapters = await this.runtime.savedChapters?.(project.id, brief.branchId) ?? result.chapters ?? [];
      const node = project.graph.find((item) => item.id === brief.branchId); if (node) node.executionStatus = result.executionStatus;
      this.emit(project, 'worker.status', { branchId: brief.branchId, status: result.executionStatus }); return result;
    } catch (error) {
      const result: BranchResult = { branchId: brief.branchId, executionStatus: executionStatus(error), assumptions: clone(brief.assumptions), applicability: '', citations: [], unresolvedQuestions: [brief.question], proposedFollowups: [], protocol,stepNotes:clone(stepNotes), errorSummary: safeError(error) };
      result.chapters = await this.runtime.savedChapters?.(project.id, brief.branchId) ?? result.chapters ?? [];
      const node = project.graph.find((item) => item.id === brief.branchId); if (node) node.executionStatus = result.executionStatus;
      this.emit(project, 'worker.status', { branchId: brief.branchId, status: result.executionStatus }); return result;
    } finally { if (session) await this.close(session, project); }
  }
  private promote(project: ResearchProject, result: BranchResult): void {
    if (project.results.some((existing) => existing.branchId === result.branchId)) return;
    project.results.push(clone(result));
    const node = project.graph.find((node) => node.id === result.branchId)!;
    node.executionStatus = result.executionStatus;
    if (result.executionStatus === 'completed' && result.conclusion) { node.conclusion = result.conclusion; node.status = result.conclusion; node.resultPath = result.derivationRef; }
    else { node.status = result.executionStatus === 'interrupted' ? 'interrupted' : 'failed'; delete node.conclusion; }
    const item = project.frontier.find((item) => item.id === result.branchId)!;
    item.state = result.executionStatus === 'completed' ? 'completed' : 'deferred';
  }
  private applyCommands(project: ResearchProject, commands: UserCommand[]): { stop: boolean; pause: boolean; refine: boolean } {
    const control = ingestCommands(project, commands);
    if (control.stop) this.stops.add(project.id);
    control.stop ||= this.stops.has(project.id);
    return control;
  }
  private decide(project: ResearchProject, review: ReviewOutput, failed: boolean, control: { stop: boolean; pause: boolean; refine: boolean }): [RoundDecision, string] {
    if (control.stop) return ['stop', 'User requested graceful stop; active Workers have returned and partial findings are saved.'];
    if (control.pause) return ['pause', 'User requested a pause at the safe round boundary.'];
    if (failed) return ['pause', 'Theorist execution or validation failed; factual partial results were preserved for review.'];
    if (project.round >= project.config.maxRounds || project.results.length >= project.config.maxBranches) return ['pause', 'Configured research round or branch budget reached.'];
    if (control.refine) return ['refine', 'Queued user refinements will inform the next plan.'];
    if (review.decision === 'pause') return ['pause', review.reason];
    if (review.decision === 'complete') return ['complete', review.reason];
    if (!project.frontier.some((item) => item.state === 'pending') && review.nextQuestions.length === 0) return ['complete', 'No high-value pending frontier or concrete next-round questions remain.'];
    return ['continue', review.reason];
  }
  private async finishBoundaryStop(project: ResearchProject): Promise<void> {
    this.applyCommands(project, await this.commands(project)); project.status = 'stopped';
    Object.assign(project, parseProject(await this.store.commitCheckpoint(clone(project))));
    this.emit(project, 'research.finished', { status: 'stopped', message: 'Graceful stop saved at the round boundary.' });
  }
}

export function endedAttempts(project:ResearchProject):EndedAttempt[] {
    return project.results.map(result=>{const item=project.frontier.find(item=>item.id===result.branchId),node=project.graph.find(node=>node.id===result.branchId);return endedAttempt({id:result.branchId,workerId:`${project.id}_worker_${result.branchId}`,wayId:item?.wayId??result.branchId,hypothesisRevision:node?.hypothesisRevision??project.hypothesisRevision,question:node?.question??result.branchId,method:item?.targetTheory??item?.mode??'explicit research',assumptions:result.assumptions,executionStatus:result.executionStatus,...(result.conclusion?{conclusion:result.conclusion}:{}),...(result.chapters?{chapters:result.chapters}:{}),path:explicitResult(result),obstacle:result.errorSummary??result.strongestObjection??'',continuation:result.proposedFollowups});});
  }
