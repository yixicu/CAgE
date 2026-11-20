import type { UserCommand } from './types.js';
import type { ResearchLoopComposition } from '../research/contracts/v2.js';
import type { AnyAgentRuntime as AgentRuntime, AnyResearchEvent as ResearchEvent, AnyResearchProject as ResearchProject, ApplicationResearchStore as ResearchStore, ApplicationResearchLoop as ResearchLoop, AnyResearchLoopBundle, AnyInFlight } from '../research/contracts/loop.js';
import { v1Store, v2Store, v21Store, v0Store, v1Loop, v2Loop, v21Loop, v0Loop } from '../research/contracts/adapters.js';
import { createResearchProject, getResearchLoop, loopForProject, parseResearchProject, ResearchSelectionError, type ResearchLoopResolver } from '../research/index.js';

// Share ownership across facade instances using the same store. No version can bypass an active writer.
const owners = new WeakMap<ResearchStore, Set<string>>();
/** Stable application-facing facade. The selected bundle owns every scientific decision. */
export class ResearchEngine implements ResearchLoop {
  private readonly loops = new Map<string, ResearchLoop>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(event: ResearchEvent) => void>();
  private readonly selected = new Map<string, ResearchLoop>();
  constructor(private readonly store: ResearchStore, private readonly runtime: AgentRuntime, private readonly resolve: ResearchLoopResolver = getResearchLoop, private readonly composition: ResearchLoopComposition & {v21?:import('../research/contracts/v21.js').ResearchCompositionV21;v0?:import('../research/contracts/v0.js').ResearchCompositionV0} = {}) {}
  private acquire(id: string): () => void {
    const busy = owners.get(this.store) ?? new Set<string>(); owners.set(this.store, busy);
    if (busy.has(id)) throw new ResearchSelectionError('RESEARCH_VERSION_BUSY', 'Research is already active or a version operation is in progress for this project.');
    busy.add(id); return () => { busy.delete(id); };
  }
  private async route(id: string, saved?: ResearchProject): Promise<ResearchLoop> {
    const running = this.selected.get(id);
    if (this.active.has(id) && running) return running;
    const project = saved ?? await this.store.loadProject(id);
    const bundle = loopForProject(project, this.resolve); bundle.parseProject(project);
    const marker = await this.store.loadInFlight(id);
    assertBoundary(bundle, project, marker, 'execute');
    const key = `${id}\0${bundle.version}`;
    let loop = this.loops.get(key);
    if (!loop) {
      loop = bundle.contractVersion === '1' ? v1Loop(bundle.create(v1Store(this.store), this.runtime, this.composition)) : bundle.contractVersion === '2' ? v2Loop(bundle.create(v2Store(this.store), this.runtime, this.composition)) : bundle.contractVersion === 'v0-test-1' ? v0Loop(bundle.create(v0Store(this.store),this.runtime,this.composition.v0)) : v21Loop(bundle.create(v21Store(this.store),this.runtime,this.composition.v21));
      loop.subscribe(event => { for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { /* Observers cannot affect research. */ } } });
      this.loops.set(key, loop);
    }
    this.selected.set(id, loop); return loop;
  }
  isActive(id?: string): boolean { return id ? this.active.has(id) : this.active.size > 0; }
  subscribe(listener: (event: ResearchEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async getSnapshot(id: string): Promise<ResearchProject> {
    const live = this.active.has(id) ? this.selected.get(id) : undefined;
    if (live) return live.getSnapshot(id);
    const saved = await this.store.loadProject(id);
    return (await this.route(id, saved)).getSnapshot(id, saved);
  }
  async enqueue(command: UserCommand): Promise<void> {
    // Preserve synchronous STOP gating once the scientific writer is active.
    const selected = this.active.has(command.projectId) ? this.selected.get(command.projectId) : undefined;
    if (selected) return selected.enqueue(command);
    await (await this.route(command.projectId)).enqueue(command);
  }
  async wakeReport(scope:import('../research/versions/v4/coordinator.js').V4Scope){
    const loop=await this.route(scope.projectId);
    await loop.wakeReport?.(scope);
  }
  async reconcile(id: string): Promise<ResearchProject> {
    if (owners.get(this.store)?.has(id)) throw new ResearchSelectionError('RESEARCH_VERSION_BUSY', 'Cannot reconcile a project while its authoritative writer is active.');
    const release = this.acquire(id);
    try { return await (await this.route(id)).reconcile(id); } finally { release(); }
  }
  start(id: string): Promise<void> {
    let release: () => void;
    try { release = this.acquire(id); } catch (error) { return Promise.reject(error); }
    const work = (async () => {
      let project = await this.store.loadProject(id);
      if (!project.startedAt) {
        project.startedAt = new Date().toISOString();
        project = await this.store.commitCheckpoint(project);
      }
      await (await this.route(id, project)).start(id);
    })().finally(() => { this.active.delete(id); release(); });
    this.active.set(id, work); return work;
  }
  async shutdown(): Promise<void> {
    const running = [...this.active.entries()];
    const journals = await Promise.allSettled(running.map(([projectId], index) => this.enqueue({ id: `shutdown_${Date.now()}_${index}`, projectId, kind: 'stop', payload: 'Full backend shutdown requested.', createdAt: new Date().toISOString() })));
    const jobs = await Promise.allSettled(running.map(([, work]) => work));
    const failures = [...journals, ...jobs].filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Research shutdown completed with preserved recovery errors.');
  }
  /** Future-execution selection only. Never restore/delete/reinterpret previously committed findings. */
  async selectVersion(id: string, version: string, expectedRevision: string): Promise<ResearchProject> {
    const release = this.acquire(id);
    try {
      const target = this.resolve(version);
      const project = parseResearchProject(await this.store.loadProject(id), this.resolve);
      if (project.contentRevision !== expectedRevision) throw new ResearchSelectionError('RESEARCH_VERSION_CONFLICT', 'The project changed. Reload its latest revision before selecting a loop.');
      const marker = await this.store.loadInFlight(id);
      if (project.status === 'running' || marker) throw new ResearchSelectionError('RESEARCH_VERSION_BUSY', 'A loop can be selected only without active or in-flight work. Reconcile with the original version first.');
      const current = loopForProject(project, this.resolve);
      assertBoundary(current, project, marker, 'select');
      if (version === project.researchLoopVersion) return project;
      if (project.startedAt || (project.schemaVersion === 4 ? project.epochs.length : project.schemaVersion === 3 ? project.answers.length : project.results.length) || (project.schemaVersion === 1 ? project.round > 0 || project.rounds.length > 0 : project.epoch > 0 || project.epochs.length > 0)) throw new ResearchSelectionError('RESEARCH_VERSION_BUSY', 'Research mode is fixed after the first start, including while paused or stopped.');
      if ((target.contractVersion !== current.contractVersion || target.version !== current.version && target.projectSchemaVersion === 3) && this.store.selectUnstartedVersion) {
        const next = createResearchProject({ id, name: project.name, hypothesis: project.hypothesis, researchLoopVersion: version });
        next.sources = structuredClone(project.sources);
        if(target.contractVersion===current.contractVersion&&target.projectSchemaVersion===current.projectSchemaVersion)next.config=structuredClone(project.config);
        next.nameSource = project.nameSource; next.presentation = structuredClone(project.presentation);
        if (project.config.defaultModel) next.config.defaultModel = structuredClone(project.config.defaultModel);
        const saved = await this.store.selectUnstartedVersion(next, expectedRevision);
        this.selected.delete(id);
        for (const key of this.loops.keys()) if (key.startsWith(`${id}\0`)) this.loops.delete(key);
        return saved;
      }
      if (target.version !== version || target.contractVersion !== current.contractVersion || target.projectSchemaVersion !== current.projectSchemaVersion || !target.acceptsSelectionFrom.includes(project.researchLoopVersion)) throw new ResearchSelectionError('RESEARCH_VERSION_INCOMPATIBLE', 'This implementation does not explicitly accept the current project version. No migration or rollback was performed.');
      const next = structuredClone(project);
      if (next.schemaVersion === 1) { next.researchLoopVersion = target.version; next.workerProtocolVersion = target.workerProtocolVersion; }
      if (next.schemaVersion === 1 && project.schemaVersion === 1) next.loopSelections = [...(next.loopSelections ?? []), { from: project.researchLoopVersion, to: target.version, at: new Date().toISOString(), previousRevision: project.contentRevision, afterRound: project.round }];
      // Validate before committing. Incompatible findings/configuration are never stripped or converted.
      target.parseProject(next);
      assertBoundary(target, next, undefined, 'select');
      const saved = await this.store.commitCheckpoint(next);
      this.selected.delete(id);
      for (const key of this.loops.keys()) if (key.startsWith(`${id}\0`)) this.loops.delete(key);
      return saved;
    } finally { release(); }
  }
}

function assertBoundary(bundle: AnyResearchLoopBundle, project: ResearchProject, marker: AnyInFlight | undefined, purpose: 'execute' | 'select'): void {
  if (bundle.contractVersion === '1') { if (project.schemaVersion !== 1 || (marker && 'schemaVersion' in marker)) throw new ResearchSelectionError('RESEARCH_VERSION_INCOMPATIBLE', 'Project and loop contracts differ.'); bundle.assertBoundary(project, marker, purpose); }
  else if(bundle.contractVersion === '2') { if (project.schemaVersion !== 2 || (marker && (!('schemaVersion' in marker)||marker.schemaVersion !== 2))) throw new ResearchSelectionError('RESEARCH_VERSION_INCOMPATIBLE', 'Project and loop contracts differ.'); bundle.assertBoundary(project, marker, purpose); }
  else if(bundle.contractVersion==='v0-test-1'){if(project.schemaVersion!==4||(marker&&(!('schemaVersion'in marker)||marker.schemaVersion!==4)))throw new ResearchSelectionError('RESEARCH_VERSION_INCOMPATIBLE','Project and loop contracts differ.');bundle.assertBoundary(project,marker,purpose);}
  else {if(project.schemaVersion!==3||(marker&&(!('schemaVersion'in marker)||marker.schemaVersion!==3)))throw new ResearchSelectionError('RESEARCH_VERSION_INCOMPATIBLE','Project and loop contracts differ.');bundle.assertBoundary(project,marker,purpose);}
}
