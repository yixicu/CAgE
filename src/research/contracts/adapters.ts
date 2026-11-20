/** Checked application-to-scientific adapters. Never coerce schema 2 into a V1 record. */
import type { ResearchStore } from './v1.js';
import type { ResearchStoreV2 } from './v2.js';
import type { ApplicationResearchLoop, ApplicationResearchStore, ResearchLoop, ResearchLoopV2 } from './loop.js';
import { ResearchVersionError } from './errors.js';
export function v1Store(store: ApplicationResearchStore): ResearchStore {
  return {
    async loadProject(id) { const p = await store.loadProject(id); if (p.schemaVersion !== 1) throw new ResearchVersionError(); return p; },
    async commitCheckpoint(p) { const saved = await store.commitCheckpoint(p); if (saved.schemaVersion !== 1) throw new ResearchVersionError(); return saved; },
    enqueueCommand: c => store.enqueueCommand(c), listCommands: id => store.listCommands(id), freezeInputs: p => store.freezeInputs(p),
    saveInFlight: r => store.saveInFlight(r), clearInFlight: id => store.clearInFlight(id),
    async loadInFlight(id) { const r = await store.loadInFlight(id); if (r && 'schemaVersion' in r) throw new ResearchVersionError(); return r; },
    ...(store.searchExperiences ? { searchExperiences: (q: string, id: string, n: number) => store.searchExperiences!(q, id, n) } : {}),
  };
}
export function v2Store(store: ApplicationResearchStore): ResearchStoreV2 {
  return {
    ...(store.commitPlanningCheckpoint ? { commitPlanningCheckpoint: (project, marker) => store.commitPlanningCheckpoint!(project, marker) } : {}),
    ...(store.saveEvolutionReviewOperation ? { saveEvolutionReviewOperation: op => store.saveEvolutionReviewOperation!(op) } : {}),
    ...(store.loadEvolutionReviewOperation ? { loadEvolutionReviewOperation: id => store.loadEvolutionReviewOperation!(id) } : {}),
    ...(store.listResearchCases ? { listResearchCases: () => store.listResearchCases!() } : {}),
    ...(store.loadEvolutionState ? { loadEvolutionState: () => store.loadEvolutionState!() } : {}),
    ...(store.publishEvolution ? { publishEvolution: (p, r) => store.publishEvolution!(p, r) } : {}),
    async loadProject(id) { const p = await store.loadProject(id); if (p.schemaVersion !== 2) throw new ResearchVersionError(); return p; },
    async commitCheckpoint(p) { const saved = await store.commitCheckpoint(p); if (saved.schemaVersion !== 2) throw new ResearchVersionError(); return saved; },
    enqueueCommand: c => store.enqueueCommand(c), listCommands: id => store.listCommands(id), freezeInputs: p => store.freezeInputs(p),
    saveInFlight: r => store.saveInFlight(r), clearInFlight: id => store.clearInFlight(id),
    async loadInFlight(id) { const r = await store.loadInFlight(id); if (!r) return undefined; if (!('schemaVersion' in r) || r.schemaVersion !== 2) throw new ResearchVersionError(); return r; },
  };
}
export function v1Loop(loop: ResearchLoop): ApplicationResearchLoop {
  return { start: id => loop.start(id), enqueue: c => loop.enqueue(c), async getSnapshot(id, saved) { if (saved && saved.schemaVersion !== 1) throw new ResearchVersionError(); return loop.getSnapshot(id, saved); }, reconcile: id => loop.reconcile(id), isActive: id => loop.isActive(id), subscribe: listener => loop.subscribe(listener), shutdown: () => loop.shutdown() };
}
export function v2Loop(loop: ResearchLoopV2): ApplicationResearchLoop {
  return { start: id => loop.start(id), enqueue: c => loop.enqueue(c), async getSnapshot(id, saved) { if (saved && saved.schemaVersion !== 2) throw new ResearchVersionError(); return loop.getSnapshot(id, saved); }, reconcile: id => loop.reconcile(id), isActive: id => loop.isActive(id), subscribe: listener => loop.subscribe(listener), shutdown: () => loop.shutdown() };
}

export function v21Store(store:ApplicationResearchStore):import('./v21.js').ResearchStoreV21 {return {
 ...(store.commitGuardedCheckpointV21?{commitGuardedCheckpoint:(p,g)=>store.commitGuardedCheckpointV21!(p,g)}:{}),
 ...(store.commitPlanningCheckpointV21?{commitPlanningCheckpoint:(p,m)=>store.commitPlanningCheckpointV21!(p,m)}:{}),
 async loadProject(id){const p=await store.loadProject(id);if(p.schemaVersion!==3)throw new ResearchVersionError();return p;},
 async commitCheckpoint(p){const saved=await store.commitCheckpoint(p);if(saved.schemaVersion!==3)throw new ResearchVersionError();return saved;},
 enqueueCommand:c=>store.enqueueCommand(c),listCommands:id=>store.listCommands(id),freezeInputs:p=>store.freezeInputs(p),saveInFlight:r=>store.saveInFlight(r),clearInFlight:id=>store.clearInFlight(id),
 async loadInFlight(id){const r=await store.loadInFlight(id);if(!r)return;if(!('schemaVersion'in r)||r.schemaVersion!==3)throw new ResearchVersionError();return r;}
};}
export function v21Loop(loop:import('./loop.js').ResearchLoopV21):ApplicationResearchLoop {return {wakeReport:scope=>loop.wakeReport?.(scope)??Promise.resolve(),start:id=>loop.start(id),enqueue:c=>loop.enqueue(c),async getSnapshot(id,saved){if(saved&&saved.schemaVersion!==3)throw new ResearchVersionError();return loop.getSnapshot(id,saved);},reconcile:id=>loop.reconcile(id),isActive:id=>loop.isActive(id),subscribe:listener=>loop.subscribe(listener),shutdown:()=>loop.shutdown()};}

export function v0Store(store:ApplicationResearchStore):import('./v0.js').ResearchStoreV0 {return {
 ...(store.commitPlanningCheckpointV0?{commitPlanningCheckpoint:(p,m)=>store.commitPlanningCheckpointV0!(p,m)}:{}),
 async loadProject(id){const p=await store.loadProject(id);if(p.schemaVersion!==4)throw new ResearchVersionError();return p;},
 async commitCheckpoint(p){const saved=await store.commitCheckpoint(p);if(saved.schemaVersion!==4)throw new ResearchVersionError();return saved;},
 enqueueCommand:c=>store.enqueueCommand(c),listCommands:id=>store.listCommands(id),freezeInputs:p=>store.freezeInputs(p),saveInFlight:r=>store.saveInFlight(r),clearInFlight:id=>store.clearInFlight(id),
 async loadInFlight(id){const r=await store.loadInFlight(id);if(!r)return;if(!('schemaVersion'in r)||r.schemaVersion!==4)throw new ResearchVersionError();return r;}
};}
export function v0Loop(loop:import('./loop.js').ResearchLoopV0):ApplicationResearchLoop {return {start:id=>loop.start(id),enqueue:c=>loop.enqueue(c),async getSnapshot(id,saved){if(saved&&saved.schemaVersion!==4)throw new ResearchVersionError();return loop.getSnapshot(id,saved);},reconcile:id=>loop.reconcile(id),isActive:id=>loop.isActive(id),subscribe:listener=>loop.subscribe(listener),shutdown:()=>loop.shutdown()};}
