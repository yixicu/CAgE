import { Value } from 'typebox/value';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import { ForkManifestSchema, ForkManifestV21Schema, ForkManifestV0Schema, type ForkManifest, type ForkOrigin, type ForkSource, type InheritedResearchView } from '../research/contracts/lineage.js';
import { stableHash } from '../learning/research-hash.js';
import { endedAttempts as v1Attempts } from '../research/versions/v1/engine.js';
import { endedAttempts as v2Attempts } from '../research/versions/v2/engine.js';
import { epochOutput } from '../presentation/checkpoint-output.js';

export class ForkError extends Error { readonly code = 'FORK_UNAVAILABLE'; }
export const projectAttempts = (project: AnyResearchProject) => project.schemaVersion === 1 ? v1Attempts(project) : project.schemaVersion === 2 ? v2Attempts(project) : [];
export const projectRecords = (project: AnyResearchProject) => project.schemaVersion === 1 ? project.rounds : project.schemaVersion === 2 ? project.epochs : project.epochs.map(epoch=>({...epoch,number:epoch.epoch,research:undefined}));
export const inheritedAttemptId = (owner: string, id: string, version: string) => `inherited_${stableHash([owner,id,version]).slice(0,48)}`;
const unique = <T>(items: readonly T[]) => [...new Map(items.map(item => [stableHash(item),item])).values()];
/** Refinement history also contains received inputs intended for a later boundary. */
function appliedRefinements(project: AnyResearchProject): string[] {
  const states = new Map(Object.values(project.commandStates ?? {}).flatMap(state => state.refinementIndex === undefined ? [] : [[state.refinementIndex, state] as const]));
  return project.refinements.filter((_, index) => {
    const state = states.get(index);
    return state ? state.status === 'applied' : index < (project.plannedRefinementCount ?? 0);
  });
}
export function assertFork(manifest: ForkManifest): void {
  const { id, ...body } = manifest;
  if(manifest.version===3) {
    if(!Value.Check(ForkManifestV0Schema,manifest)||stableHash(body)!==id||new Set(manifest.v0RawAnswers?.map(ref=>ref.id)).size!==manifest.v0RawAnswers?.length||new Set(manifest.sources.map(item=>item.alias.id)).size!==manifest.sources.length||manifest.v0RawAnswers?.some(ref=>ref.owner!==ref.projectId||!manifest.origins.some(origin=>origin.sessionId===ref.projectId)))throw new ForkError('Invalid exact V0 fork manifest.');
    return;
  }
  if (manifest.version === 2) {
    if (!Value.Check(ForkManifestV21Schema,manifest) || stableHash(body)!==id || manifest.parent.loopVersion!=='2.1' || manifest.origins.some(origin=>origin.loopVersion!=='2.1')
      || !Array.isArray(manifest.rawAnswers) || new Set(manifest.rawAnswers.map(ref=>ref.id)).size!==manifest.rawAnswers.length || new Set(manifest.sources.map(item=>item.alias.id)).size!==manifest.sources.length || manifest.attempts.length || manifest.chapters.length
      || manifest.rawAnswers.some(ref=>ref.workerProtocolVersion!=='2.1'||ref.owner!==ref.projectId||!manifest.origins.some(origin=>origin.sessionId===ref.projectId)))
      throw new ForkError('Invalid exact V2.1 fork manifest.');
    return;
  }
  if (!Value.Check(ForkManifestSchema,manifest) || stableHash(body) !== id || new Set(manifest.attempts.map(item=>item.id)).size !== manifest.attempts.length
    || new Set(manifest.sources.map(item=>item.alias.id)).size !== manifest.sources.length || manifest.origins.some(origin=>origin.loopVersion!==manifest.parent.loopVersion)) throw new ForkError('The saved fork manifest is invalid. Preserve the original files for recovery.');
}
export interface ForkReader { load: (owner: string, revision: string) => Promise<AnyResearchProject>; source: (grant: ForkSource) => Promise<Uint8Array> }
export function makeManifest(parent: AnyResearchProject, checkpointId: string, operationId: string, sources: ForkSource[]): ForkManifest {
  const record = projectRecords(parent).find(item=>item.id===checkpointId);
  if (!record?.completedAt || projectRecords(parent).some(item=>item.number>record.number)) throw new ForkError('Choose an exact completed saved checkpoint.');
  const origin: ForkOrigin = {sessionId:parent.id,revision:parent.contentRevision,checkpointId,number:record.number,loopVersion:parent.schemaVersion===1?'1.0':parent.schemaVersion===2?'2.0':parent.schemaVersion===4?'0':'2.1'};
  if(parent.schemaVersion===4) {
    const previous=parent.fork;if(previous)assertFork(previous);
    const body={version:3 as const,operationId,parent:origin,origins:unique([...(previous?.origins??[]),origin]),attempts:[],chapters:[],
      proofs:unique([...(previous?.proofs??[]),...parent.epochs.flatMap(epoch=>epoch.archive?.status==='saved'&&epoch.archive.proofRef?[epoch.archive.proofRef]:[])]),
      v0RawAnswers:unique([...(previous?.v0RawAnswers??[]),...parent.epochs.flatMap(epoch=>epoch.solve?[epoch.solve.answerRef]:[])]),sources:unique([...(previous?.sources??[]),...sources])};
    const manifest={...body,id:stableHash(body)};assertFork(manifest);return manifest;
  }
  if(parent.schemaVersion===3) {
    const previous=parent.fork;
    if(previous) assertFork(previous);
    const body={version:2 as const,operationId,parent:origin,origins:unique([...(previous?.origins??[]),origin]),
      attempts:[],chapters:[],proofs:unique([...(previous?.proofs??[]),...parent.epochs.flatMap(epoch=>epoch.archives.flatMap(archive=>archive.status==='saved'&&archive.proofRef?[archive.proofRef]:[]))]),
      rawAnswers:unique([...(previous?.rawAnswers??[]),...parent.answers.map(answer=>answer.answerRef)]), sources:unique([...(previous?.sources??[]),...sources])};
    const manifest={...body,id:stableHash(body)}; assertFork(manifest); return manifest;
  }
  const ownAttempts = projectAttempts(parent);
  const previous = parent.fork;
  if (previous) assertFork(previous);
  const attempts = unique([...(previous?.attempts??[]),...ownAttempts.map(item=>({id:inheritedAttemptId(parent.id,item.id,item.version),ownerSessionId:parent.id,revision:parent.contentRevision,originalId:item.id,version:item.version}))]);
  const chapters = unique([...(previous?.chapters??[]),...ownAttempts.flatMap(item=>item.chapters??[]),...projectRecords(parent).flatMap(item=>item.research?.review?.proof?.chapters??[])]);
  const proofs = unique([...(previous?.proofs??[]),...projectRecords(parent).flatMap(item=>[...(item.research?.boundary.proofs?.map(p=>p.ref)??[]),...(item.research?.proofArchive?.status==='saved'&&item.research.proofArchive.ref?[item.research.proofArchive.ref]:[]),...(item.research?.review?.unchangedProof?[item.research.review.unchangedProof]:[])])]);
  const body = {version:1 as const,operationId,parent:origin,origins:unique([...(previous?.origins??[]),origin]),attempts,chapters,proofs,sources:unique([...(previous?.sources??[]),...sources])};
  const manifest = {...body,id:stableHash(body)}; assertFork(manifest); return manifest;
}
export async function resolveInherited(manifest: ForkManifest, reader: ForkReader): Promise<InheritedResearchView> {
  assertFork(manifest);
  const projects = new Map<string,AnyResearchProject>();
  for (const origin of manifest.origins) {
    const project = await reader.load(origin.sessionId,origin.revision);
    const record = projectRecords(project).find(item=>item.id===origin.checkpointId);
    // Schema3 V3 keeps the existing protocol-2.1 fork manifest, as makeManifest records.
    const originLoop = project.schemaVersion === 3 ? '2.1' : project.researchLoopVersion;
    if (!record?.completedAt || record.number!==origin.number || projectRecords(project).some(item=>item.number>origin.number) || originLoop!==origin.loopVersion) throw new ForkError('An inherited checkpoint does not match its immutable origin.');
    projects.set(`${origin.sessionId}:${origin.revision}`,project);
  }
  for(const ref of manifest.rawAnswers??[]) {
    const matching=[...projects.values()].some(project=>project.schemaVersion===3 && project.id===ref.projectId && project.answers.some(answer=>stableHash(answer.answerRef)===stableHash(ref)));
    if(!matching) throw new ForkError('Inherited raw reference was not in the selected checkpoint.');
  }
  for(const ref of manifest.v0RawAnswers??[]) {
    if(![...projects.values()].some(project=>project.schemaVersion===4&&project.id===ref.projectId&&project.epochs.some(epoch=>epoch.solve&&stableHash(epoch.solve.answerRef)===stableHash(ref))))throw new ForkError('Inherited V0 original was not in selected checkpoint.');
  }
  const attempts = manifest.attempts.map(grant=>{
    const project = projects.get(`${grant.ownerSessionId}:${grant.revision}`);
    const found = project && projectAttempts(project).find(item=>item.id===grant.originalId&&item.version===grant.version);
    if (!found || inheritedAttemptId(grant.ownerSessionId,grant.originalId,grant.version)!==grant.id) throw new ForkError('An inherited research path no longer matches its exact saved reference.');
    return {...structuredClone(found),id:grant.id};
  });
  const parent = projects.get(`${manifest.parent.sessionId}:${manifest.parent.revision}`);
  if (!parent) throw new ForkError('The inherited parent checkpoint is unavailable.');
  const outputs = await Promise.all([...projects.values()].flatMap(project=>projectRecords(project).filter(record=>record.completedAt).map(async record=>{
    let hypothesis = record.research?.hypothesis??('snapshot' in record?('root' in record.snapshot?record.snapshot.root.originalText:record.snapshot.hypothesis):undefined);
    if (!hypothesis && 'inputRevision' in record) { try { hypothesis = (await reader.load(project.id,record.inputRevision)).hypothesis; } catch { /* Missing historical premise stays unavailable, never the current target. */ } }
    return {sessionId:project.id,id:record.id,number:record.number,label:`${project.schemaVersion===1?'Round':'Epoch'} ${record.number}`,content:(project.schemaVersion===3||project.schemaVersion===4)?('reason' in record?record.reason??'':''):'tasks' in record?epochOutput(record as Parameters<typeof epochOutput>[0]).content:'summary' in record?record.summary??'':'',time:record.completedAt!,hypothesis};
  }))); 
  const inheritedProjects = [...projects.values()];
  const refinements = inheritedProjects.flatMap(appliedRefinements);
  const limitations: string[] = [];
  if (attempts.some(attempt=>attempt.executionStatus!=='completed') || inheritedProjects.some(project=>projectRecords(project).some(record=>record.research?.review?.failures?.length))) limitations.push('Saved public reports and chapters are available. Separate historical failure-library bodies are not inherited because this checkpoint has no exact version references for them.');
  if (refinements.length < inheritedProjects.reduce((count, project) => count + project.refinements.length, 0)) limitations.push('Only user refinements with saved evidence of application are inherited. Pending or historically unverified inputs remain in the parent history.');
  // No live or arbitrary source lookup is performed by the view. Readers resolve each exact alias on demand.
  return {manifestId:manifest.id,v0RawAnswers:structuredClone(manifest.v0RawAnswers??[]),rawAnswers:structuredClone(manifest.rawAnswers??[]),limitations,attemptOrigins:Object.fromEntries(manifest.attempts.map(item=>[item.id,{sessionId:item.ownerSessionId,attemptId:item.originalId}])),attempts,chapters:structuredClone(manifest.chapters),proofs:structuredClone(manifest.proofs),sources:manifest.sources.map(item=>structuredClone(item.alias)),
    context:{...(parent.schemaVersion===2?{userDomainPreferences:structuredClone(parent.config.userDomainPreferences)}:{}),hypothesis:parent.hypothesis,summary:outputs.map(item=>`${item.label}\n${item.content}`).join('\n\n'),graph:inheritedProjects.flatMap(project=>(project.schemaVersion===3||project.schemaVersion===4?[]:project.graph).map(node=>({...structuredClone(node),ownerSessionId:project.id}))),refinements,outputs}};
}
/** Compare only to allow the immediate archival-receipt commit, not later user edits. */
export function withoutArchiveReceipt(project: AnyResearchProject): unknown {
  const copy=structuredClone(project); copy.contentRevision='';
  // Managed-note refs are projected at each output commit; their byte fingerprint is the identity.
  for (const source of copy.sources) if (/^notes\/[^/\\]+\.md$/i.test(source.path)) source.revision='';
  if(copy.schemaVersion===4) {for(const epoch of copy.epochs)delete epoch.archive;return copy;}
  if(copy.schemaVersion===3) { for(const epoch of copy.epochs) epoch.archives=[]; return copy; }
  for(const record of projectRecords(copy)) if(record.research) delete record.research.proofArchive;
  return copy;
}
