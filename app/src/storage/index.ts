import {RawAnswerStoreV0Impl} from './raw-answers-v0.js';
import {validateV0Transition} from './v0-codec.js';
import type {ResearchProjectV0,InFlightEpochV0} from '../research/contracts/v0.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveDataRoot} from './data-root.js';
export {defaultDataRoot} from './data-root.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { FrozenInputs, RecalledExperience, SourceRevisionRef, UserCommand } from '../engine/types.js';
import type { AnyResearchProject as ResearchProject, AnyInFlight as InFlightRound, ApplicationResearchStore as ResearchStore } from '../research/contracts/loop.js';
import { parseResearchInFlight as parseInFlight, parseResearchProject as parseProject, ResearchVersionError } from '../research/index.js';
import type { EvolutionPublication, EvolutionReviewOperation, GlobalEvolutionState, InFlightEpoch, ResearchProjectV2 } from '../research/contracts/v2.js';
import { parseEvolutionPublication, parseGlobalEvolutionState, assertEvolutionPublication } from '../research/versions/v2/evolution.js';
import { verifyTrialSources } from '../research/versions/v2/learning.js';
import { assertSafeRelative, RestrictedFileGateway } from '../tools/files.js';
import { atomicWriteGuarded, atomicWrite, ensureDirectory, exists, readJson } from './atomic.js';
import { parseCommand } from '../research/versions/v1/schemas.js';
import { commandRefinementKind, commandStateProjection, compareCommandOrder } from '../research/user-commands.js';
import { GitRevisions } from './git-revisions.js';
import { isStorageAccessError } from './errors.js';
import { acquireWriterLease, releaseWriterLease } from './writer-lease.js';
import { ProofChapters } from './proof-chapters.js';
import { ForkError, assertFork, makeManifest, projectRecords, resolveInherited, withoutArchiveReceipt } from './fork-lineage.js';
import type { ForkSource, InheritedResearchView } from '../research/contracts/lineage.js';
import { stableHash } from '../learning/research-hash.js';
import { createResearchProject } from '../research/index.js';
import { RawAnswerStore } from './raw-answers.js';
import { validateV21Transition } from './v21-codec.js';
import type { ResearchProjectV21, InFlightEpochV21 } from '../research/contracts/v21.js';
import { ResearchLibrary } from '../learning/research-library.js';

class SupersededOptionalCheckpoint extends Error {}
interface Pointer { schemaVersion: 1; revision: string; previousRevision?: string; planningRevision?: string }
interface PlanningJournal { journalVersion: 1; planningRevision: string; record?: InFlightRound }
interface SourceGrant { id: string; path: string; originalPath?: string; fingerprint: string; revision: string; copy: boolean; blob: string; external: boolean }
export interface StoreOptions { sourceRoot?: string; beforePublish?: (revision: string) => Promise<void> }
export class ConflictError extends Error { readonly code = 'REVISION_CONFLICT'; constructor(message = 'This document changed. Reload the latest revision before saving.') { super(message); this.name = 'ConflictError'; } }
export class SourceChangedError extends Error { readonly code = 'SOURCE_CHANGED'; constructor() { super('The authorized source changed after freezing. Reimport it before the next round.'); this.name = 'SourceChangedError'; } }
export class SourceGrantError extends Error { readonly code = 'SOURCE_NOT_GRANTED'; constructor() { super('This source revision has no explicit project grant.'); this.name = 'SourceGrantError'; } }
export class ProjectBusyError extends Error { readonly code = 'PROJECT_BUSY'; constructor() { super('The project has active research; queue a refinement or wait for the round boundary.'); this.name = 'ProjectBusyError'; } }
function id(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value)) throw new Error('Invalid local project or record identifier.'); return value; }
function hypothesisBlobId(text: string): string { return createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'); }
function fingerprint(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function isNotePath(value: string): boolean { return /^notes\/[^/\\]+\.md$/iu.test(value) && !value.split(/[\\/]/u).includes('..') && !value.includes('\0'); }
function noteId(filename: string): string { return `note_${fingerprint(new TextEncoder().encode(filename)).slice(0, 24)}`; }
function noteReferences(notes: Record<string, string>, revision: string): SourceRevisionRef[] { return Object.entries(notes).map(([filename, content]) => ({ id: noteId(filename), path: filename, revision, fingerprint: fingerprint(new TextEncoder().encode(content)), external: false })); }
const recallStopwords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with', 'research', 'hypothesis', 'theory', 'result', 'results']);
function recallTerms(text: string, limit: number): Set<string> { return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((term) => !recallStopwords.has(term)).slice(0, limit)); }
function json(value: unknown): string { return JSON.stringify(value, null, 2) + '\n'; }
function validateProject(value: unknown): asserts value is ResearchProject {
  parseProject(value);
  const p = value as ResearchProject;
  // Bundles own data shape and science; storage retains only safe identifiers and uniqueness.
  id(p.id);
  if (p.fork) { assertFork(p.fork); if (p.id !== `fork_${stableHash([p.fork.parent.sessionId, p.fork.operationId]).slice(0,40)}`) throw new ForkError('Fork grants belong to a different child session.'); }
  if(p.schemaVersion===4) {for(const epoch of p.epochs)id(epoch.id);return;}
  if (p.schemaVersion === 3) {
    for (const item of [...p.ways, ...p.questions, ...p.answers]) id(item.id);
    return;
  }
  for (const result of p.results) id(result.branchId);
  for (const node of p.graph) id(node.id);
  if (new Set(p.results.map((result) => result.branchId)).size !== p.results.length) throw new Error('Duplicate branch results cannot be committed.');
  if (new Set(p.graph.map((node) => node.id)).size !== p.graph.length) throw new Error('Duplicate graph nodes cannot be committed.');
  if (p.schemaVersion === 2) {
    const proposals = p.reconstructionProposals ?? [];
    if (new Set(proposals.map(proposal => proposal.id)).size !== proposals.length) throw new Error('Duplicate reconstruction proposal identities.');
    for (const proposal of proposals) { id(proposal.id); if (proposal.candidateVersion !== hypothesisBlobId(proposal.hypothesis)) throw new Error('Reconstruction candidate version does not match its exact hypothesis bytes.'); }
  }
}

/** One local writer, content-addressed Git objects, one atomic authoritative pointer. */
export class FileResearchStore implements ResearchStore {
  library!: ResearchLibrary;
  rawAnswers!: RawAnswerStore;
  rawAnswersV0!: RawAnswerStoreV0Impl;
  private readonly pending = new Map<string, Promise<unknown>>();
  private closed = false;
  private constructor(readonly dataRoot: string, private readonly options: StoreOptions, private readonly lockToken: string) {}
  static async open(dataRoot?:string, options: StoreOptions = {}): Promise<FileResearchStore> {
    const canonical = await resolveDataRoot(dataRoot,options.sourceRoot);
    await ensureDirectory(canonical);
    const token = await acquireWriterLease(canonical);
    const store = new FileResearchStore(canonical, options, token);
    try {
      await ensureDirectory(path.join(canonical, 'projects'));
      store.library = await ResearchLibrary.open(path.join(canonical, 'learning'));
      store.rawAnswersV0=new RawAnswerStoreV0Impl(path.join(canonical,'raw-answers-v0'),async grant=>{
        if(grant.readerProjectId===grant.ref.projectId)return true;
        const project=await store.loadProject(grant.readerProjectId);
        return grant.purpose==='inherited-draft'&&project.fork?.version===3&&Boolean(project.fork.v0RawAnswers?.some(ref=>isDeepStrictEqual(ref,grant.ref)));
      });
      store.rawAnswers = new RawAnswerStore(path.join(canonical, 'raw-answers'), async grant => {
        if (grant.readerProjectId === grant.ref.projectId) return true;
        const project = await store.loadProject(grant.readerProjectId);
        return grant.purpose === 'inherited-draft' && project.fork?.version === 2
          && Boolean(project.fork.rawAnswers?.some(ref => isDeepStrictEqual(ref, grant.ref)));
      });
    } catch (error) { await store.close(); throw error; }
    return store;
  }
  private root(projectId: string): string { return path.join(this.dataRoot, 'projects', id(projectId)); }
  private git(projectId: string): GitRevisions { return new GitRevisions(this.root(projectId)); }
  private async serial<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Research storage is closed.');
    id(projectId);
    const previous = this.pending.get(projectId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(action);
    this.pending.set(projectId, operation);
    try { return await operation; } finally { if (this.pending.get(projectId) === operation) this.pending.delete(projectId); }
  }
  private async pointer(projectId: string): Promise<Pointer | undefined> {
    const filename = path.join(this.root(projectId), 'checkpoint.json');
    if (!await exists(filename)) return undefined;
    const pointer = await readJson<Pointer>(filename);
    if (pointer.schemaVersion !== 1 || !/^[0-9a-f]{40}$/u.test(pointer.revision) || (pointer.planningRevision !== undefined && !/^[0-9a-f]{40}$/u.test(pointer.planningRevision))) throw new Error('Invalid checkpoint pointer. Recovery requires inspection.');
    return pointer;
  }
  private async readNotes(projectId: string, revision?: string): Promise<Record<string, string>> {
    if (!revision) return {};
    let bytes: Uint8Array;
    try { bytes = await this.git(projectId).read(revision, 'notes.json'); }
    catch (error) { if ((error as { code?: string }).code === 'NotFoundError' && !await this.git(projectId).hasRootFile(revision, 'notes.json')) return {}; throw error; }
    const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!manifest || typeof manifest !== 'object' || !('schemaVersion' in manifest) || manifest.schemaVersion !== 1 || !('paths' in manifest) || !Array.isArray(manifest.paths) || manifest.paths.some((filename: unknown) => typeof filename !== 'string' || !isNotePath(filename))) throw new Error('Invalid managed-note manifest.');
    const notes: Record<string, string> = {};
    for (const filename of manifest.paths as string[]) notes[filename] = new TextDecoder().decode(await this.git(projectId).read(revision, filename));
    return notes;
  }
  private async loadAt(projectId: string, revision: string): Promise<ResearchProject> {
    const project: unknown = JSON.parse(new TextDecoder().decode(await this.git(projectId).read(revision, 'project.json')));
    validateProject(project);
    if (project.id !== projectId) throw new Error('Checkpoint project identity mismatch.');
    if ((project.schemaVersion === 2 || project.schemaVersion === 3 || project.schemaVersion === 4) && project.activeEpoch !== undefined) throw new Error('Transient Epoch projection cannot be authoritative persisted state.');
    // Derivations live in their own reusable Git blobs, never duplicated in evolving project JSON.
    for (const result of project.schemaVersion === 3 || project.schemaVersion === 4 ? [] : project.results) if (result.derivationRef === `branches/${result.branchId}.md`) result.derivationMarkdown = new TextDecoder().decode(await this.git(projectId).read(revision, result.derivationRef));
    if (project.schemaVersion === 2) {
      const accepted = new Map(project.results.map(result => [result.taskId, result]));
      for (const epoch of project.epochs) for (const task of epoch.tasks) if (task.result?.derivationRef && accepted.has(task.id)) task.result.derivationMarkdown = accepted.get(task.id)!.derivationMarkdown;
    }
    project.sources = [...project.sources.filter((source) => !isNotePath(source.path)), ...noteReferences(await this.readNotes(projectId, revision), revision)];
    return { ...project, contentRevision: revision };
  }
  private async loadProjectUnlocked(projectId: string): Promise<ResearchProject> {
    let current: Pointer | undefined;
    let pointerError: unknown;
    try { current = await this.pointer(projectId); } catch (error) { if (error instanceof ResearchVersionError || isStorageAccessError(error)) throw error; pointerError = error; }
    if (current) {
      try { return await this.loadAt(projectId, current.revision); } catch (error) { if (error instanceof ResearchVersionError || isStorageAccessError(error)) throw error; pointerError = error; }
    }
    const backup = await readJson<Pointer>(path.join(this.root(projectId), 'checkpoint.previous.json')).catch(error => { if (isStorageAccessError(error)) throw error; return undefined; });
    const candidates = [current?.previousRevision, backup?.revision, backup?.previousRevision].filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value));
    for (const revision of [...new Set(candidates)]) {
      let recovered: ResearchProject;
      try { recovered = await this.loadAt(projectId, revision); } catch (error) { if (error instanceof ResearchVersionError || isStorageAccessError(error)) throw error; continue; }
      recovered.status = 'paused';
      recovered.lastError = 'Recovered the last valid committed checkpoint after detecting an invalid newest checkpoint. Uncommitted work was not accepted; review before explicitly resuming.';
      // A recovery is itself a new atomic commit, based only on the verified valid ancestor.
      // The serial writer owns this repair; subsequent edits compare against its real pointer.
      const recoveredPointer = [current, backup].find(item => item?.revision === revision);
      return this.commit(recovered, { schemaVersion: 1, revision, ...(recoveredPointer?.planningRevision ? { planningRevision: recoveredPointer.planningRevision } : {}) });
    }
    if (pointerError) throw new Error('No valid committed checkpoint could be recovered. Preserve this project directory and inspect its history.', { cause: pointerError });
    throw new Error('Research project not found.');
  }
  async loadProject(projectId: string): Promise<ResearchProject> { return this.serial(projectId, () => this.loadProjectUnlocked(projectId)); }
  async createProject(project: ResearchProject): Promise<ResearchProject> {
    validateProject(project);
    return this.serial(project.id, async () => {
      if (await this.pointer(project.id)) throw new ConflictError('A project with this identifier already exists.');
      await ensureDirectory(this.root(project.id)); await this.git(project.id).initialize();
      return this.commit(project, undefined);
    });
  }
  /** Resolve only the selected completed output in authoritative Git ancestry. */
  private async forkCut(parent: ResearchProject, checkpointId: string): Promise<ResearchProject> {
    let revision: string | undefined = parent.contentRevision;
    let candidate: ResearchProject | undefined, successor: ResearchProject | undefined, newer: ResearchProject | undefined;
    let steps = 0;
    while (revision && steps++ < 10000) {
      const saved = await this.loadAt(parent.id, revision);
      const record = projectRecords(saved).find(item => item.id === checkpointId);
      if (record?.completedAt && record.decision && !projectRecords(saved).some(item => item.number > record.number)) { candidate = saved; successor = newer; }
      else if (candidate) break;
      newer = saved; revision = await this.git(parent.id).parent(revision);
    }
    if (revision && steps >= 10000) throw new ForkError('The saved checkpoint history exceeds the bounded lookup. No fork was created.');
    if (!candidate) throw new ForkError('This response has no verified completed output checkpoint to fork.');
    if (successor && isDeepStrictEqual(withoutArchiveReceipt(candidate), withoutArchiveReceipt(successor))) candidate = successor;
    return candidate;
  }
  private async immutableSource(grant: ForkSource): Promise<Uint8Array> {
    const ref = grant.original;
    if (grant.backing === 'note' && isNotePath(ref.path)) return this.readSource(grant.ownerSessionId, ref);
    if (grant.backing === 'frozen' && /^[0-9a-f]{40}$/.test(ref.revision)) return this.readSource(grant.ownerSessionId, ref);
    if (grant.backing !== 'import') throw new SourceGrantError();
    const saved = (await this.sourceGrants(grant.ownerSessionId)).find(item => item.id === ref.id && item.path === ref.path && item.revision === ref.revision && item.fingerprint === ref.fingerprint && item.copy);
    if (!saved || saved.blob !== path.join('source-blobs', saved.fingerprint) || !/^[a-f0-9]{64}$/.test(saved.fingerprint)) throw new ForkError('A source has no saved immutable bytes. Re-select a fully saved checkpoint; the live external file was not read.');
    const bytes = new Uint8Array(await fs.readFile(path.join(this.root(grant.ownerSessionId), saved.blob)));
    if (fingerprint(bytes) !== saved.fingerprint) throw new SourceChangedError();
    return bytes;
  }
  private async readInheritedSource(projectId: string, reference: SourceRevisionRef): Promise<Uint8Array> {
    const pointer = await this.pointer(projectId); if (!pointer) throw new SourceGrantError();
    // Avoid reentering the project serial queue from freezeInputs.
    const project = await this.loadAt(projectId, pointer.revision);
    const manifest = project.fork; if (!manifest) throw new SourceGrantError(); assertFork(manifest);
    const grant = manifest.sources.find(item => isDeepStrictEqual(item.alias, reference));
    if (!grant) throw new SourceGrantError();
    return this.immutableSource(grant);
  }
  async readInherited(projectId: string): Promise<InheritedResearchView | undefined> {
    const project = await this.loadProject(projectId);
    return project.fork ? resolveInherited(project.fork, { load: (owner, revision) => this.loadAt(owner, revision), source: grant => this.immutableSource(grant) }) : undefined;
  }
  async createFork(parentId: string, input: { checkpointId: string; expectedRevision: string; operationId: string }, assertIdle?: () => void): Promise<ResearchProject> {
    id(input.checkpointId); id(input.operationId);
    const childId = `fork_${stableHash([parentId, input.operationId]).slice(0, 40)}`;
    return this.serial(parentId, async () => {
      if (await this.pointer(childId)) {
        const existing = await this.loadProject(childId);
        if (existing.fork?.parent.sessionId !== parentId || existing.fork.parent.checkpointId !== input.checkpointId || existing.fork.operationId !== input.operationId) throw new ConflictError('Fork request identity was already used for another checkpoint.');
        return existing;
      }
      assertIdle?.();
      const parent = await this.loadProjectUnlocked(parentId);
      if (parent.contentRevision !== input.expectedRevision) throw new ConflictError();
      if (parent.status === 'running' || await this.loadInFlight(parentId)) throw new ProjectBusyError();
      const commands = await this.listCommands(parentId);
      // Receiving an instruction is not the same as applying it at a planning boundary.
      const commandStates = commandStateProjection(parent, commands);
      if (commands.some(command => !parent.processedCommandIds.includes(command.id))
        || parent.pendingModificationIds?.length
        || Object.values(commandStates).some(state => state.status === 'pending' || state.status === 'planning')) throw new ForkError('Resolve queued parent instructions before forking a saved checkpoint.');
      const cut = await this.forkCut(parent, input.checkpointId);
      const historicalSources = cut.schemaVersion === 2 ? cut.epochs.flatMap(epoch => epoch.snapshot.sources).filter(ref => !isNotePath(ref.path)) : [];
      const candidates = new Map([...cut.sources.filter(ref => isNotePath(ref.path) || !historicalSources.some(saved => saved.id === ref.id)), ...historicalSources].map(ref => [stableHash(ref), ref]));
      const sources: ForkSource[] = [];
      for (const original of candidates.values()) {
        if (cut.fork?.sources.some(grant => isDeepStrictEqual(grant.alias, original))) continue;
        const token = stableHash([cut.id, original]);
        const alias: SourceRevisionRef = {id:`inherited_${token.slice(0,40)}`,path:`inherited/${token.slice(0,24)}/${path.basename(original.path)}`,revision:`fork:${token}`,fingerprint:original.fingerprint,external:false};
        const backing = isNotePath(original.path) ? 'note' : /^[0-9a-f]{40}$/.test(original.revision) ? 'frozen' : 'import';
        const grant: ForkSource = {alias,ownerSessionId:cut.id,original:structuredClone(original),backing};
        await this.immutableSource(grant); sources.push(grant);
      }
      const manifest = makeManifest(cut, input.checkpointId, input.operationId, sources);
      // Verify dependencies before making a new History entry. No bodies are copied.
      for (const grant of manifest.sources) await this.immutableSource(grant);
      const chapters = new ProofChapters(path.join(this.dataRoot, 'pi', 'proof-chapters'));
      for(const ref of manifest.v0RawAnswers??[])await this.rawAnswersV0.read(ref,{readerProjectId:ref.projectId,readerRole:'theorist',purpose:'archive',ref});
      for (const ref of manifest.rawAnswers ?? []) await this.rawAnswers.read(ref, {readerProjectId:ref.projectId,readerRole:'theorist',purpose:'archive',ref});
      for (const ref of manifest.chapters) await chapters.read(ref);
      for (const ref of manifest.proofs) await this.library.proofReader([ref]).read(ref);
      await resolveInherited(manifest, {load:(owner,revision)=>this.loadAt(owner,revision),source:grant=>this.immutableSource(grant)});
      const child = createResearchProject({id:childId,name:`${cut.name.slice(0,120)} · branch`,hypothesis:cut.hypothesis,researchLoopVersion:cut.researchLoopVersion});
      if (manifest.origins.some(origin => origin.sessionId === childId)) throw new ForkError('Fork lineage cannot contain its new child.');
      child.fork = manifest; child.nameSource = 'user'; child.sources = manifest.sources.map(grant => structuredClone(grant.alias));
      if ((child.schemaVersion === 3 && cut.schemaVersion === 3)||(child.schemaVersion===4&&cut.schemaVersion===4)) {
        child.root = structuredClone(cut.root); child.hypothesisId = cut.hypothesisId;
        child.config.userDomainPreferences = structuredClone(cut.config.userDomainPreferences);
      } else if (child.schemaVersion !== 3 && child.schemaVersion !== 4 && cut.schemaVersion !== 3 && cut.schemaVersion !== 4) {
      child.hypothesisId = cut.hypothesisId; child.targetKey = cut.targetKey;
      if (cut.workingHypothesis) child.workingHypothesis = structuredClone(cut.workingHypothesis);
      if (cut.researchTags) child.researchTags = [...cut.researchTags];
      if (child.schemaVersion === 2 && cut.schemaVersion === 2) child.config.userDomainPreferences = structuredClone(cut.config.userDomainPreferences);
      }
      return this.createProject(child);
    });
  }
  async listProjects(onUnavailable?: (projectId: string, error: unknown) => void | Promise<void>): Promise<ResearchProject[]> {
    const entries = await fs.readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true });
    const projects: ResearchProject[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(entry.name)) continue;
      if (!onUnavailable) {
        // Legacy strict consumers list published projects only. Application
        // inventories also inspect incomplete publications so they stay visible.
        const files = await fs.readdir(this.root(entry.name));
        if (!files.includes('checkpoint.json') && !files.includes('checkpoint.previous.json')) continue;
      }
      try { projects.push(await this.loadProject(entry.name)); }
      catch (error) {
        // Only explicitly fault-isolating application views may omit a project.
        // Incomplete directories remain visible to that caller, never recreated.
        if (!onUnavailable) throw error;
        await onUnavailable(entry.name, error);
      }
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }
  private files(project: ResearchProject, notes: Record<string, string>): Record<string, string> {
    const metadata = structuredClone(project);
    if (metadata.schemaVersion === 2 || metadata.schemaVersion === 3 || metadata.schemaVersion === 4) delete metadata.activeEpoch;
    if (metadata.schemaVersion === 3 || metadata.schemaVersion === 4) {
      metadata.sources = metadata.sources.filter(source => !isNotePath(source.path));
      return { 'project.json': json(metadata), 'hypothesis.md': metadata.hypothesis, 'summary.md': metadata.summary,
        'sources.json': json(metadata.sources), 'notes.json': json({ schemaVersion: 1, paths: Object.keys(notes).sort() }),
        'execution/epochs.json': json(metadata.epochs), ...notes };
    }
    metadata.sources = metadata.sources.filter((source) => !isNotePath(source.path));
    for (const result of metadata.results) { if (result.derivationMarkdown !== undefined) result.derivationRef = `branches/${result.branchId}.md`; delete result.derivationMarkdown; }
    if (metadata.schemaVersion === 2) {
      const accepted = new Map(metadata.results.map(result => [result.taskId, result]));
      for (const epoch of metadata.epochs) for (const task of epoch.tasks) {
        const result = accepted.get(task.id);
        if (task.result && result?.derivationRef) { task.result.derivationRef = result.derivationRef; delete task.result.derivationMarkdown; }
      }
    }
    if (project.schemaVersion === 3 || project.schemaVersion === 4) throw new ResearchVersionError();
    const files: Record<string, string> = { 'project.json': json(metadata), 'hypothesis.md': project.hypothesis, 'summary.md': project.summary,
      'graph.json': json(project.schemaVersion === 1 ? { schemaVersion: 1, nodes: project.graph, frontier: project.frontier, policies: project.policies } : { schemaVersion: 2, nodes: project.graph }),
      'sources.json': json(metadata.sources), 'notes.json': json({ schemaVersion: 1, paths: Object.keys(notes).sort() }), ...(project.schemaVersion === 1 ? { 'memory/experiences.json': json(project.experiences) } : { 'execution/epochs.json': json(metadata.schemaVersion === 2 ? metadata.epochs : []), 'policy/snapshots.json': json(project.policies), 'memory/way-skills.json': json(project.waySkills), 'memory/way-traces.json': json(project.waySkillTraces), 'memory/strategy-traces.json': json(project.strategyTraces) }), ...notes };
    for (const result of project.results) {
      id(result.branchId);
      files[`branches/${result.branchId}.md`] = result.derivationMarkdown ?? `# ${result.branchId}\n\nExecution: ${result.executionStatus}\n\n${result.pathReport ? [result.pathReport.method, ...result.pathReport.keySteps, result.pathReport.result, ...result.pathReport.obstacles, 'Detailed derivations are retained as frozen chapter references.'].join('\n\n') : result.errorSummary ?? 'No inline derivation was saved.'}\n`;
    }
    return files;
  }
  private async baseMatches(projectId: string, offered: string, actual?: string): Promise<boolean> {
    if (!actual) return !offered || offered === 'initial';
    if (offered === actual) return true;
    if (!/^[0-9a-f]{40}$/u.test(offered)) return false;
    const input = await readJson<{ base: string }>(path.join(this.root(projectId), 'input-snapshots', `${offered}.json`)).catch(() => undefined);
    return input?.base === actual;
  }
  private async commit(project: ResearchProject, pointer?: Pointer, editedNotes?: Record<string, string>, selectUnstarted = false, planning?: InFlightEpoch | InFlightEpochV21 | InFlightEpochV0, guard?:()=>boolean): Promise<ResearchProject> {
    validateProject(project);
    if (!await this.baseMatches(project.id, project.contentRevision, pointer?.revision)) throw new ConflictError();
    if (pointer) {
      const prior = await this.loadAt(project.id, pointer.revision);
      if (!isDeepStrictEqual(prior.fork, project.fork)) throw new ConflictError('Fork read grants are immutable.');
      if (prior.startedAt && project.startedAt !== prior.startedAt) throw new ConflictError('The first-start marker cannot be removed or changed.');
      if (prior.schemaVersion !== project.schemaVersion && !selectUnstarted) throw new ResearchVersionError();
    }
    const saved = structuredClone(project);
    if (saved.schemaVersion === 2 || saved.schemaVersion === 3 || saved.schemaVersion === 4) delete saved.activeEpoch;
    saved.processedCommandIds = [...new Set(saved.processedCommandIds)];
    if (saved.schemaVersion !== 3 && saved.schemaVersion !== 4) saved.hypothesisRevision = hypothesisBlobId(saved.hypothesis);
    if (saved.schemaVersion !== 3 && saved.schemaVersion !== 4) {
    for (const result of saved.results) if (result.derivationMarkdown !== undefined) result.derivationRef = `branches/${result.branchId}.md`;
    const rootNode = saved.graph.find((node) => !node.parentId && node.question === saved.hypothesis);
    if (rootNode) rootNode.hypothesisRevision = saved.hypothesisRevision;
    }
    const files = this.files(saved, editedNotes ?? await this.readNotes(saved.id, pointer?.revision));
    if (planning) files['planning-in-flight.json'] = json(planning);
    const revision = await this.git(project.id).commit(files, pointer?.revision, saved.schemaVersion === 1 ? `Checkpoint round ${saved.round}: ${saved.stage}` : `Checkpoint Epoch ${saved.epoch}: ${saved.phase}`);
    const staged = await this.loadAt(saved.id, revision); // Validate the staged immutable record before publication.
    await this.options.beforePublish?.(revision);
    const next: Pointer = { schemaVersion: 1, revision, ...(pointer ? { previousRevision: pointer.revision } : {}),
      ...(planning ? { planningRevision: revision } : pointer?.planningRevision ? { planningRevision: pointer.planningRevision } : {}) };
    if (pointer) await atomicWrite(path.join(this.root(saved.id), 'checkpoint.previous.json'), json(pointer));
    if(guard){if(!await atomicWriteGuarded(path.join(this.root(saved.id),'checkpoint.json'),json(next),guard))throw new SupersededOptionalCheckpoint();}
    else await atomicWrite(path.join(this.root(saved.id), 'checkpoint.json'), json(next));
    // Projections are conveniences only. All reads resolve the committed pointer, including after a crash.
    for (const [filename, content] of Object.entries(files)) await atomicWrite(path.join(this.root(saved.id), filename), content).catch(() => undefined);
    return staged;
  }
  async commitGuardedCheckpointV21(project:ResearchProjectV21,guard:()=>boolean):Promise<ResearchProjectV21|undefined>{return this.serial(project.id,async()=>{try{const saved=await this.commit(project,await this.pointer(project.id),undefined,false,undefined,guard);if(saved.schemaVersion!==3)throw new ResearchVersionError();return saved;}catch(error){if(error instanceof SupersededOptionalCheckpoint)return undefined;throw error;}});}
  async commitCheckpoint(project: ResearchProject): Promise<ResearchProject> { return this.serial(project.id, async () => this.commit(project, await this.pointer(project.id))); }
  /** Adoption and recovery provenance share one publication point; mutable journal writes cannot split them. */
  async commitPlanningCheckpoint(project: ResearchProjectV2, marker: InFlightEpoch): Promise<ResearchProjectV2> {
    const record = parseInFlight(marker);
    return this.serial(project.id, async () => {
      if (!('schemaVersion' in record) || record.schemaVersion !== 2 || record.projectId !== project.id || record.sealed || record.tasks.length || !record.planningChange) throw new ConflictError('Planning adoption requires its unsealed recovery record.');
      const prior = await this.loadProjectUnlocked(project.id);
      if (!await this.loadInFlight(project.id)) throw new ConflictError('Planning adoption requires its existing preparation record.');
      await this.validateInFlightTransition(record, prior);
      const change = record.planningChange;
      if (!change.selection || !change.fromHypothesisId || !change.toHypothesisId
        || change.fromHypothesisRevision !== prior.hypothesisRevision || change.fromHypothesisId !== (prior.hypothesisId ?? `h_${prior.hypothesisRevision}`)
        || change.toHypothesisId !== project.hypothesisId || change.previousHypothesisId !== project.previousHypothesisId
        || change.selection.commandIds.some(commandId => { const receipt = project.commandStates?.[commandId]; return receipt?.status !== 'applied' || receipt.boundaryId !== record.snapshot.id || receipt.hypothesisRevision !== change.toHypothesisRevision; })) throw new ConflictError('Planning adoption requires exact hypothesis identities and command receipts.');
      if (hypothesisBlobId(project.hypothesis) !== record.planningChange.toHypothesisRevision) throw new ConflictError('Adopted hypothesis does not match planning recovery provenance.');
      const saved = await this.commit(project, await this.pointer(project.id), undefined, false, record);
      if (saved.schemaVersion !== 2) throw new ResearchVersionError();
      return saved;
    });
  }
  async commitPlanningCheckpointV21(project: ResearchProjectV21, marker: InFlightEpochV21): Promise<ResearchProjectV21> {
    return this.serial(project.id, async () => {
      const prior = await this.loadProjectUnlocked(project.id);
      if (prior.schemaVersion !== 3 || marker.projectId !== project.id || marker.sealed || marker.tasks.length) throw new ConflictError('Invalid V2.1 planning checkpoint.');
      const previous = await this.loadInFlight(project.id);
      validateV21Transition(prior, marker, previous);
      if (!previous) throw new ConflictError('Planning requires durable preparation.');
      const saved = await this.commit(project, await this.pointer(project.id), undefined, false, marker);
      if (saved.schemaVersion !== 3) throw new ResearchVersionError();
      return saved;
    });
  }
  async commitPlanningCheckpointV0(project:ResearchProjectV0,marker:InFlightEpochV0):Promise<ResearchProjectV0> {
    return this.serial(project.id,async()=>{
      const prior=await this.loadProjectUnlocked(project.id),previous=await this.loadInFlight(project.id);
      if(prior.schemaVersion!==4||marker.selection||marker.solve)throw new ConflictError('Invalid V0 planning checkpoint.');
      validateV0Transition(prior,marker,previous);
      const saved=await this.commit(project,await this.pointer(project.id),undefined,false,marker);
      if(saved.schemaVersion!==4)throw new ResearchVersionError();return saved;
    });
  }
  async selectUnstartedVersion(project: ResearchProject, expectedRevision: string): Promise<ResearchProject> {
    return this.serial(project.id, async () => {
      const prior = await this.loadProjectUnlocked(project.id);
      if (prior.contentRevision !== expectedRevision) throw new ConflictError();
      const hasHistory = prior.schemaVersion === 1 ? prior.round > 0 || prior.rounds.length > 0 : prior.epoch > 0 || prior.epochs.length > 0;
      if (prior.fork || prior.startedAt || prior.status !== 'idle' || hasHistory || (prior.schemaVersion === 4 ? prior.epochs.length : prior.schemaVersion === 3 ? prior.answers.length : prior.results.length) || await this.loadInFlight(project.id)) throw new ConflictError('Research mode is fixed after its first start.');
      const hasNewHistory = project.schemaVersion === 1 ? project.round > 0 || project.rounds.length > 0 : project.epoch > 0 || project.epochs.length > 0;
      if (project.startedAt || project.status !== 'idle' || hasNewHistory || (project.schemaVersion === 4 ? project.epochs.length : project.schemaVersion === 3 ? project.answers.length : project.results.length) || project.hypothesis !== prior.hypothesis || project.name !== prior.name) throw new ConflictError('Only an unchanged, unstarted research input may select its mode.');
      project.contentRevision = expectedRevision;
      project.sources = structuredClone(prior.sources);
      return this.commit(project, await this.pointer(project.id), undefined, true);
    });
  }
  async enqueueCommand(command: UserCommand): Promise<void> {
    command = parseCommand(command); id(command.id); id(command.projectId);
    await this.serial(command.projectId, async () => {
      await this.loadProjectUnlocked(command.projectId);
      const filename = path.join(this.root(command.projectId), 'commands', `${command.id}.json`);
      const commands = await this.listCommands(command.projectId);
      const existing = commands.find(item => item.id === command.id || (command.requestId && item.requestId === command.requestId));
      if (existing) {
        const matches = existing.id === command.id && existing.kind === command.kind && existing.payload === command.payload
          && existing.requestId === command.requestId && existing.refinementKind === command.refinementKind
          && (command.sequence === undefined || existing.sequence === command.sequence)
          && (command.requestId !== undefined || existing.createdAt === command.createdAt);
        if (!matches) throw new ConflictError('Command request identifier already has different content.');
        return;
      }
      // This local writer lock is the ordering authority. Client clocks and UUID order are irrelevant.
      const sequence = commands.reduce((maximum, item) => Math.max(maximum, item.sequence ?? 0), commands.length) + 1;
      if (!Number.isSafeInteger(sequence)) throw new ConflictError('The command sequence is exhausted.');
      await atomicWrite(filename, json({ ...command, sequence }));
    });
  }
  async listCommands(projectId: string): Promise<UserCommand[]> {
    const root = path.join(this.root(projectId), 'commands');
    const entries = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const result = await Promise.all(entries.filter((entry) => /^[a-zA-Z0-9_-]+\.json$/u.test(entry)).map(async entry => {
      const command = parseCommand(await readJson<unknown>(path.join(root, entry)));
      if (command.projectId !== projectId || entry !== `${command.id}.json`) throw new Error('Invalid persisted command journal.');
      return command;
    }));
    const sequences = result.flatMap(command => command.sequence === undefined ? [] : [command.sequence]);
    const requests = result.flatMap(command => command.requestId === undefined ? [] : [command.requestId]);
    if (new Set(sequences).size !== sequences.length || new Set(requests).size !== requests.length) throw new Error('Duplicate persisted command ordering or request identity.');
    return result.sort((a, b) => Number(b.kind === 'stop') - Number(a.kind === 'stop') || compareCommandOrder(a, b));
  }
  async freezeInputs(project: ResearchProject): Promise<FrozenInputs> {
    return this.serial(project.id, async () => {
      const pointer = await this.pointer(project.id);
      if (!pointer || !await this.baseMatches(project.id, project.contentRevision, pointer.revision)) throw new ConflictError();
      // A staged input commit is immutable, but is not a completed checkpoint.
      const notes = await this.readNotes(project.id, pointer.revision);
      const revision = await this.git(project.id).commit(this.files(project, notes), pointer.revision, project.schemaVersion === 1 ? `Frozen inputs for round ${project.round}` : `Frozen inputs for Epoch ${project.epoch}`);
      const sources = [...project.sources.filter((source) => !isNotePath(source.path)), ...noteReferences(notes, revision)];
      if (project.schemaVersion === 1) {
        await atomicWrite(path.join(this.root(project.id), 'input-snapshots', `${revision}.json`), json({ base: pointer.revision }));
        for (const source of sources) await this.readSource(project.id, source);
      } else {
        // V2 freezes actual authorized bytes even for live external grants. Only this Epoch's
        // revision-bound references use the cache; future Epochs still validate the live grant.
        const frozenSources: (SourceRevisionRef & { blob: string })[] = [];
        for (let index = 0; index < sources.length; index++) {
          const source = sources[index]!;
          if (project.fork?.sources.some(grant => isDeepStrictEqual(grant.alias, source))) { await this.readInheritedSource(project.id, source); continue; }
          const bytes = await this.readSource(project.id, source);
          if (isNotePath(source.path)) continue;
          const hash = fingerprint(bytes); const blob = `source-blobs/${hash}`;
          if (!await exists(path.join(this.root(project.id), blob))) await atomicWrite(path.join(this.root(project.id), blob), bytes);
          const frozen = { ...source, revision, fingerprint: hash };
          sources[index] = frozen; frozenSources.push({ ...frozen, blob });
        }
        await atomicWrite(path.join(this.root(project.id), 'input-snapshots', `${revision}.json`), json({ base: pointer.revision, frozenSources }));
      }
      return { contentRevision: revision, hypothesisRevision: project.schemaVersion === 3 || project.schemaVersion === 4 ? project.root.revision : await this.git(project.id).blobId(revision, 'hypothesis.md'), sources };
    });
  }
  private async validateInFlightTransition(record: InFlightRound, project: ResearchProject): Promise<void> {
    if(project.schemaVersion===4||('schemaVersion' in record&&record.schemaVersion===4)) {
      if(project.schemaVersion!==4||!('schemaVersion' in record)||record.schemaVersion!==4)throw new ResearchVersionError();
      validateV0Transition(project,record,await this.loadInFlight(record.projectId));return;
    }
    if (project.schemaVersion === 3 || ('schemaVersion' in record && record.schemaVersion === 3)) {
      if (project.schemaVersion !== 3 || !('schemaVersion' in record) || record.schemaVersion !== 3) throw new ResearchVersionError();
      const prior = await this.loadInFlight(record.projectId);
      validateV21Transition(project, record, prior);
      return;
    }
    if ((project.schemaVersion === 2) !== ('schemaVersion' in record)) throw new ResearchVersionError();
    if ('schemaVersion' in record) {
      const selection = record.planningSelection, change = record.planningChange;
      if (selection) {
        const commands = await this.listCommands(record.projectId), byId = new Map(commands.map(command => [command.id, command]));
        const hypothesis = selection.hypothesisCommandId ? byId.get(selection.hypothesisCommandId) : undefined;
        if (selection.boundaryId !== record.snapshot.id || selection.blockedReason
          || selection.commandIds.some(commandId => byId.get(commandId)?.kind !== 'refine')
          || (hypothesis && commandRefinementKind(hypothesis) === 'annotation')
          || selection.annotationCommandIds.some((commandId, index) => { const command = byId.get(commandId); return !command || commandRefinementKind(command) !== 'annotation' || command.payload !== selection.pendingAnnotations[index]; })
          || (hypothesis && !selection.reconstruction && hypothesis.payload !== selection.pendingModifications[0])) throw new ConflictError('Planning selection must match exact submitted command bytes.');
        if (selection.reconstruction) {
          const proposal = project.schemaVersion === 2 ? project.reconstructionProposals?.find(item => item.id === selection.reconstruction!.proposalId) : undefined;
          if (!hypothesis || commandRefinementKind(hypothesis) !== 'accept_reconstruction' || !proposal
            || proposal.hypothesis !== selection.reconstruction.hypothesis || proposal.sourceHypothesisRevision !== selection.reconstruction.sourceHypothesisRevision
            || proposal.kind !== selection.reconstruction.kind || proposal.implication !== selection.reconstruction.implication
            || proposal.reason !== selection.reconstruction.reason || !isDeepStrictEqual(proposal.assumptions, selection.reconstruction.assumptions)) throw new ConflictError('Reconstruction selection must match the exact saved proposal.');
        }
      }
      if (change?.selection && (!selection || !isDeepStrictEqual(change.selection, selection) || !isDeepStrictEqual(change.commandIds, selection.commandIds)
        || (change.change.kind !== 'working' && !selection.hypothesisCommandId)
        || (selection.reconstruction && change.change.hypothesis !== selection.reconstruction.hypothesis))) throw new ConflictError('Planning provenance must identify the captured selection.');
      const previous = await this.loadInFlight(record.projectId);
      if (previous) {
        if (!('schemaVersion' in previous) || previous.schemaVersion !== 2 || previous.snapshot.id !== record.snapshot.id) throw new ConflictError('An unfinished Epoch cannot be replaced.');
        if (previous.sealed && !record.sealed) throw new ConflictError('A sealed Epoch cannot return to preparation.');
        if (previous.planningSelection && !isDeepStrictEqual(previous.planningSelection, record.planningSelection)) throw new ConflictError('Captured planning inputs cannot be changed.');
        if (!previous.planningSelection && record.planningSelection && (previous.sealed || previous.tasks.length)) throw new ConflictError('Planning inputs must be captured before Worker dispatch.');
        if (previous.planningChange && json(previous.planningChange) !== json(record.planningChange ?? null)) throw new ConflictError('Accepted planning provenance cannot be replaced.');
        let allowed = previous.sealed || !record.sealed ? previous.snapshot : { ...previous.snapshot, ...(record.snapshot.problem ? { problem: record.snapshot.problem } : {}), strategy: record.snapshot.strategy, ...(record.snapshot.routingStrategy ? { routingStrategy: record.snapshot.routingStrategy } : {}) };
        if (record.planningChange && !previous.sealed && record.sealed) {
          const change = record.planningChange;
          if (previous.tasks.length || record.tasks.length || change.fromHypothesisRevision !== previous.snapshot.hypothesisRevision || change.toHypothesisRevision !== record.snapshot.hypothesisRevision
            || hypothesisBlobId(record.snapshot.hypothesis) !== change.toHypothesisRevision) throw new ConflictError('Planning may refreeze only before Worker dispatch.');
          const commands = await this.listCommands(record.projectId);
          if (change.commandIds.some(id => !commands.some(command => command.id === id && command.kind === 'refine'))
            || (change.change.kind !== 'working' && !change.commandIds.length)) throw new ConflictError('A new root requires a queued user modification.');
          if (change.change.kind === 'working' && (change.fromHypothesisRevision !== change.toHypothesisRevision || !['equivalent', 'sufficient', 'counterexample'].includes(change.change.logicalRelation))) throw new ConflictError('A working proposition must retain the root and a valid implication.');
          if (change.change.kind !== 'working' && change.change.hypothesis !== record.snapshot.hypothesis) throw new ConflictError('Planning target does not match frozen hypothesis.');
          const frozenRevision = await this.git(record.projectId).blobId(record.snapshot.inputRevision, 'hypothesis.md');
          const sourceIdentity = (sources: SourceRevisionRef[]) => sources.map(({ revision: _revision, ...source }) => source);
          if (frozenRevision !== record.snapshot.hypothesisRevision || json(sourceIdentity(previous.snapshot.sources)) !== json(sourceIdentity(record.snapshot.sources))) throw new ConflictError('Planning cannot change authorized source bytes.');
          allowed = { ...allowed, hypothesis: record.snapshot.hypothesis, hypothesisRevision: record.snapshot.hypothesisRevision,
            inputRevision: record.snapshot.inputRevision, sources: record.snapshot.sources,
            ...(record.snapshot.workingHypothesis ? { workingHypothesis: record.snapshot.workingHypothesis } : {}) };
          if (!record.snapshot.workingHypothesis) delete allowed.workingHypothesis;
        } else if (!previous.sealed && !record.sealed && !previous.planningChange && record.planningChange) {
          // Optional literature may journal calls between planning and the one final seal.
          // Only provenance is staged here; the snapshot must remain byte-identical.
          const change = record.planningChange, commands = await this.listCommands(record.projectId);
          if (previous.tasks.length || record.tasks.length || change.fromHypothesisRevision !== previous.snapshot.hypothesisRevision
            || change.commandIds.some(id => !commands.some(command => command.id === id && command.kind === 'refine'))
            || (change.change.kind === 'working' ? change.toHypothesisRevision !== change.fromHypothesisRevision : !change.commandIds.length || hypothesisBlobId(change.change.hypothesis) !== change.toHypothesisRevision)) throw new ConflictError('Invalid pending planning provenance.');
        } else if (json(previous.planningChange ?? null) !== json(record.planningChange ?? null)) throw new ConflictError('Planning provenance is frozen after sealing.');
        if (!isDeepStrictEqual(allowed, record.snapshot)) throw new ConflictError('Frozen Epoch inputs cannot change during preparation or execution.');
      }
    }
  }
  async saveInFlight(record: InFlightRound): Promise<void> {
    record = parseInFlight(record);
    await this.serial(record.projectId, async () => {
      const project = await this.loadProjectUnlocked(record.projectId);
      await this.validateInFlightTransition(record, project);
      const pointer = await this.pointer(record.projectId);
      const journal: PlanningJournal | InFlightRound = pointer?.planningRevision
        ? { journalVersion: 1, planningRevision: pointer.planningRevision, record } : record;
      await atomicWrite(path.join(this.root(record.projectId), 'in-flight.json'), json(journal));
    });
  }
  async loadInFlight(projectId: string): Promise<InFlightRound | undefined> {
    const pointer = await this.pointer(projectId);
    const filename = path.join(this.root(projectId), 'in-flight.json');
    // The writer can clear the completed journal while a snapshot is opening it.
    const raw = await readJson<unknown>(filename).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    let value: unknown;
    if (raw && typeof raw === 'object' && 'journalVersion' in raw) {
      const journal = raw as PlanningJournal;
      if (journal.journalVersion !== 1 || !/^[0-9a-f]{40}$/.test(journal.planningRevision)) throw new Error('Invalid planning recovery journal.');
      if (pointer?.planningRevision === journal.planningRevision) {
        if (!journal.record) return undefined; // A durable tombstone prevents revival of the embedded record.
        value = journal.record;
      }
    } else if (!pointer?.planningRevision) value = raw;
    if (value === undefined && pointer?.planningRevision) {
      value = JSON.parse(new TextDecoder().decode(await this.git(projectId).read(pointer.planningRevision, 'planning-in-flight.json')));
    }
    if (value === undefined) return undefined;
    const record = parseInFlight(value);
    if (record.projectId !== projectId) throw new Error('Invalid recovery journal.');
    return record;
  }
  async clearInFlight(projectId: string): Promise<void> {
    await this.serial(projectId, async () => {
      const pointer = await this.pointer(projectId), filename = path.join(this.root(projectId), 'in-flight.json');
      if (pointer?.planningRevision) await atomicWrite(filename, json({ journalVersion: 1, planningRevision: pointer.planningRevision } satisfies PlanningJournal));
      else await fs.unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    });
  }
  async workerWorkspace(projectId: string, sessionId: string): Promise<string> { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,239}$/u.test(sessionId)) throw new Error('Invalid private session identifier.'); const directory = path.join(this.root(projectId), 'workers', sessionId); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); return directory; }
  async readRevision(projectId: string, revision: string, filename: string): Promise<Uint8Array> { return this.git(projectId).read(revision, assertSafeRelative(filename)); }
  async listDocuments(projectId: string): Promise<{ path: string; revision: string }[]> {
    const project = await this.loadProject(projectId);
    return ['hypothesis.md', 'summary.md', ...(project.schemaVersion === 3 || project.schemaVersion === 4 ? [] : project.results).map((result) => `branches/${result.branchId}.md`), ...project.sources.filter((source) => isNotePath(source.path)).map((source) => source.path)].map((filename) => ({ path: filename, revision: project.contentRevision }));
  }
  async readDocument(projectId: string, filename: string, revision?: string): Promise<Uint8Array> { return this.readRevision(projectId, revision ?? (await this.loadProject(projectId)).contentRevision, filename); }
  async reviseDocument(projectId: string, edit: { path: string; content: string; expectedRevision: string }): Promise<ResearchProject> {
    assertSafeRelative(edit.path);
    return this.serial(projectId, async () => {
      const project = await this.loadProjectUnlocked(projectId);
      if (project.contentRevision !== edit.expectedRevision) {
        await atomicWrite(path.join(this.root(projectId), 'conflicts', `${randomUUID()}.json`), json({ ...edit, createdAt: new Date().toISOString() }));
        throw new ConflictError('Your edit conflicts with a newer revision. The submitted version was retained for recovery.');
      }
      if (project.status === 'running' || await this.loadInFlight(projectId)) throw new ProjectBusyError();
      if (edit.path.startsWith('branches/')) throw new ConflictError('Saved Worker results are read-only. Use project notes or Modify hypothesis to request a correction.');
      const notes = await this.readNotes(projectId, project.contentRevision);
      if (edit.path === 'hypothesis.md') {
        const hasHistory = project.schemaVersion === 1 ? project.round > 0 || project.rounds.length > 0 : project.epoch > 0 || project.epochs.length > 0;
        if (project.startedAt || project.status !== 'idle' || hasHistory || (project.schemaVersion === 4 ? project.epochs.length : project.schemaVersion === 3 ? project.answers.length : project.results.length)) throw new ConflictError('The started hypothesis is read-only. Use Modify hypothesis so Theorist can classify the change at the next planning boundary.');
        project.hypothesis = edit.content; project.hypothesisRevision = hypothesisBlobId(edit.content);
        const root = { id: 'root', hypothesisRevision: project.hypothesisRevision, question: project.hypothesis, status: 'pending' as const };
        if(project.schemaVersion===4) {project.originalHypothesis=edit.content;project.root.originalText=edit.content;project.root.revision=project.hypothesisRevision;project.root.hypothesisId=`h_${project.hypothesisRevision}`;project.hypothesisId=project.root.hypothesisId;project.rootInterpretationPending=true;} else if (project.schemaVersion === 3) {
          project.originalHypothesis = edit.content; project.root.originalText = edit.content;
          project.root.workingText = edit.content; project.root.revision = project.hypothesisRevision;
          project.root.hypothesisId = `h_${project.hypothesisRevision}`; project.hypothesisId = project.root.hypothesisId;
        } else {
        project.graph = project.schemaVersion === 1 ? [root] : [{ ...root, assumptions: [] }];
        delete project.hypothesisId; delete project.previousHypothesisId; delete project.targetKey; delete project.workingHypothesis;
        }
      }
      else if (edit.path === 'summary.md') project.summary = edit.content;
      else if (isNotePath(edit.path)) {
        // Every prior branch had this shared source in its frozen grant. Conservatively flag those results.
        if (notes[edit.path] !== undefined && notes[edit.path] !== edit.content) for (const node of project.schemaVersion === 3 || project.schemaVersion === 4 ? [] : project.graph) if (node.parentId) node.status = 'needs_review';
        notes[edit.path] = edit.content;
      }
      else throw new Error('Only an unstarted hypothesis, summary or managed notes/*.md can be edited. Saved Worker results are read-only.');
      return this.commit(project, await this.pointer(projectId), notes);
    });
  }
  private async sourceGrants(projectId: string): Promise<SourceGrant[]> { const filename = path.join(this.root(projectId), 'source-grants.json'); return await exists(filename) ? readJson<SourceGrant[]>(filename) : []; }
  private async addSource(projectId: string, input: { name: string; bytes: Uint8Array; originalPath?: string; copy: boolean }): Promise<SourceRevisionRef> {
    const name = path.basename(input.name);
    if (name !== input.name || !/\.(md|markdown|txt|pdf)$/iu.test(name)) throw new Error('Sources must be explicitly selected Markdown, text or PDF files.');
    const project = await this.loadProjectUnlocked(projectId);
    const hash = fingerprint(input.bytes); const blob = path.join('source-blobs', hash);
    const grants = await this.sourceGrants(projectId);
    // A lost upload response may be retried. Reuse only the same copied upload,
    // never an external-path grant or a source belonging to another project.
    const matching = input.copy && !input.originalPath ? grants.filter(grant => grant.copy && !grant.external && !grant.originalPath
      && grant.fingerprint === hash && grant.revision === `sha256:${hash}`
      && grant.path === `sources/${grant.id}/${name}` && grant.blob === blob) : [];
    const existing = matching.find(grant => project.sources.some(source => source.id === grant.id)) ?? matching[0];
    if (existing) {
      if (fingerprint(new Uint8Array(await fs.readFile(path.join(this.root(projectId), existing.blob)))) !== hash) throw new SourceChangedError();
      const reference: SourceRevisionRef = { id: existing.id, path: existing.path, revision: existing.revision, fingerprint: hash, external: false };
      const published = project.sources.find(source => source.id === existing.id);
      if (published) { if (!isDeepStrictEqual(published, reference)) throw new SourceGrantError(); return reference; }
      // The grant/blob may have been staged before checkpoint publication failed.
      if (project.status === 'running' || await this.loadInFlight(projectId)) throw new ProjectBusyError();
      project.sources.push(reference); await this.commit(project, await this.pointer(projectId)); return reference;
    }
    if (project.status === 'running' || await this.loadInFlight(projectId)) throw new ProjectBusyError();
    const sourceId = randomUUID();
    if (input.copy && !await exists(path.join(this.root(projectId), blob))) await atomicWrite(path.join(this.root(projectId), blob), input.bytes);
    const grant: SourceGrant = { id: sourceId, path: `sources/${sourceId}/${name}`, ...(input.originalPath ? { originalPath: input.originalPath } : {}), fingerprint: hash, revision: `sha256:${hash}`, copy: input.copy, blob, external: Boolean(input.originalPath) };
    grants.push(grant);
    await atomicWrite(path.join(this.root(projectId), 'source-grants.json'), json(grants));
    const reference: SourceRevisionRef = { id: grant.id, path: grant.path, revision: grant.revision, fingerprint: hash, external: grant.external };
    project.sources.push(reference); await this.commit(project, await this.pointer(projectId)); return reference;
  }
  async importSource(projectId: string, source: { name: string; bytes: Uint8Array; mime?: string }): Promise<SourceRevisionRef> { return this.serial(projectId, () => this.addSource(projectId, { name: source.name, bytes: source.bytes, copy: true })); }
  /** The calling API must obtain explicit selection of this exact path before invoking this method. */
  async authorizeSource(projectId: string, absolutePath: string, options: { copy?: boolean } = {}): Promise<SourceRevisionRef> {
    if (!path.isAbsolute(absolutePath)) throw new Error('External authorization requires an absolute selected path.');
    return this.serial(projectId, async () => {
      const directory = await this.workerWorkspace(projectId, 'source-import');
      const reader = await RestrictedFileGateway.create({ role: 'theorist', workspaceRoot: directory, readableRoots: [absolutePath], writableRoots: [] });
      return this.addSource(projectId, { name: path.basename(absolutePath), bytes: await reader.read(absolutePath), originalPath: await fs.realpath(absolutePath), copy: options.copy !== false });
    });
  }
  async readSource(projectId: string, reference: SourceRevisionRef): Promise<Uint8Array> {
    if (reference.revision.startsWith('fork:')) return this.readInheritedSource(projectId, reference);
    if (isNotePath(reference.path)) {
      if (reference.id !== noteId(reference.path) || !/^[0-9a-f]{40}$/u.test(reference.revision)) throw new SourceGrantError();
      const notes = await this.readNotes(projectId, reference.revision);
      if (notes[reference.path] === undefined) throw new SourceGrantError();
      const bytes = new TextEncoder().encode(notes[reference.path]);
      if (fingerprint(bytes) !== reference.fingerprint) throw new SourceGrantError();
      return bytes;
    }
    if (/^[0-9a-f]{40}$/u.test(reference.revision)) {
      const frozen = await readJson<{ frozenSources?: (SourceRevisionRef & { blob: string })[] }>(path.join(this.root(projectId), 'input-snapshots', `${reference.revision}.json`)).catch(() => undefined);
      const source = frozen?.frozenSources?.find(item => item.id === reference.id && item.path === reference.path && item.revision === reference.revision && item.fingerprint === reference.fingerprint && item.external === reference.external);
      if (!source || !source.fingerprint || !/^[a-f0-9]{64}$/u.test(source.fingerprint) || source.blob !== `source-blobs/${source.fingerprint}`) throw new SourceGrantError();
      const bytes = new Uint8Array(await fs.readFile(path.join(this.root(projectId), source.blob)));
      if (fingerprint(bytes) !== source.fingerprint) throw new SourceChangedError();
      return bytes;
    }
    const grant = (await this.sourceGrants(projectId)).find((item) => item.id === reference.id && item.path === reference.path && item.revision === reference.revision && item.fingerprint === reference.fingerprint);
    if (!grant) throw new SourceGrantError();
    let bytes: Uint8Array;
    if (grant.copy) bytes = new Uint8Array(await fs.readFile(path.join(this.root(projectId), grant.blob)));
    else {
      if (!grant.originalPath) throw new Error('External source path is missing.');
      const reader = await RestrictedFileGateway.create({ role: 'theorist', workspaceRoot: await this.workerWorkspace(projectId, 'source-import'), readableRoots: [grant.originalPath], writableRoots: [] });
      bytes = await reader.read(grant.originalPath);
    }
    if (fingerprint(bytes) !== grant.fingerprint) throw new SourceChangedError();
    return bytes;
  }
  /** Bounded local recall of unreviewed traces. Does not recover, modify or run another project. */
  async searchExperiences(query: string, excludeProjectId: string, limit = 5): Promise<RecalledExperience[]> {
    if (this.closed) throw new Error('Research storage is closed.');
    id(excludeProjectId);
    const count = Number.isFinite(limit) ? Math.min(5, Math.max(0, Math.floor(limit))) : 0;
    const terms = recallTerms(query.slice(0, 512), 32);
    if (!count || !terms.size) return [];
    const entries = (await fs.readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== excludeProjectId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(entry.name))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).slice(0, 50);
    const matches: { score: number; record: RecalledExperience; order: number }[] = [];
    for (const entry of entries) {
      try {
        // Never call loadProject here: its explicit recovery path may write a repaired checkpoint.
        const pointer = await this.pointer(entry.name);
        if (!pointer) continue;
        const bytes = await this.git(entry.name).read(pointer.revision, 'project.json');
        if (bytes.byteLength > 1024 * 1024) continue;
        const project = parseProject(JSON.parse(new TextDecoder().decode(bytes)));
        if (project.id !== entry.name || project.schemaVersion !== 1) continue;
        for (const [order, experience] of project.experiences.slice(0, 100).entries()) {
          if (experience.status !== 'unreviewed' || (experience.kind !== 'routing' && experience.kind !== 'strategy')) continue;
          if ([experience.context, experience.lesson, experience.limitations].some((text) => text.length > 2000)) continue;
          const premise = project.rounds.find((round) => round.number === experience.round)?.hypothesisRevision;
          if (!premise || !/^[0-9a-f]{40}$/u.test(premise)) continue;
          const words = recallTerms(`${experience.context} ${experience.lesson} ${experience.limitations}`, 1000);
          const score = [...terms].filter((term) => words.has(term)).length;
          if (!score) continue;
          matches.push({ score, order, record: { sourceProjectId: project.id, sourceProjectName: project.name,
            sourceContentRevision: pointer.revision, sourceHypothesisRevision: premise,
            experience: { ...experience, kind: experience.kind } } });
        }
      } catch { /* Invalid/unavailable committed records are omitted; recall never repairs or retries them. */ }
    }
    return matches.sort((a, b) => b.score - a.score || (a.record.sourceProjectId < b.record.sourceProjectId ? -1 : a.record.sourceProjectId > b.record.sourceProjectId ? 1 : 0) || a.order - b.order)
      .slice(0, count).map(({ record }) => structuredClone(record));
  }
  /** Read only committed case snapshots; never repair another project or expose cases to Workers. */
  async listResearchCases(): Promise<ResearchProjectV2[]> {
    if (this.closed) throw new Error('Research storage is closed.');
    const entries = (await fs.readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
    const cases: ResearchProjectV2[] = [];
    for (const entry of entries) {
      try {
        const pointer = await this.pointer(entry.name); if (!pointer) continue;
        const project = await this.loadAt(entry.name, pointer.revision);
        if (project.schemaVersion === 2) cases.push(project);
      } catch { /* An unavailable case cannot supply evidence; never auto-repair while reviewing. */ }
    }
    return cases;
  }
  private parseEvolutionOperation(value: unknown): EvolutionReviewOperation {
    if (!value || typeof value !== 'object') throw new Error('Invalid evolution review operation.');
    const op = value as Record<string, unknown>;
    if (Object.keys(op).some(key => !['id', 'projectId', 'inputDigest', 'status', 'createdAt', 'publicationId'].includes(key)) || typeof op.id !== 'string' || typeof op.projectId !== 'string' || typeof op.inputDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(op.inputDigest) || !['pending', 'completed', 'failed'].includes(String(op.status)) || typeof op.createdAt !== 'string' || !Number.isFinite(Date.parse(op.createdAt)) || (op.status === 'completed' ? typeof op.publicationId !== 'string' : op.publicationId !== undefined)) throw new Error('Invalid evolution review operation.');
    id(op.id); id(op.projectId); if (typeof op.publicationId === 'string') id(op.publicationId);
    return structuredClone(value) as EvolutionReviewOperation;
  }
  async loadEvolutionReviewOperation(operationId: string): Promise<EvolutionReviewOperation | undefined> {
    if (this.closed) throw new Error('Research storage is closed.');
    const filename = path.join(this.evolutionRoot(), 'operations', `${id(operationId)}.json`);
    if (!await exists(filename)) return undefined;
    const operation = this.parseEvolutionOperation(await readJson<unknown>(filename));
    if (operation.id !== operationId) throw new Error('Evolution operation identity mismatch.');
    return operation;
  }
  async saveEvolutionReviewOperation(input: EvolutionReviewOperation): Promise<void> {
    const operation = this.parseEvolutionOperation(input);
    await this.serial('evolution-registry', async () => {
      const previous = await this.loadEvolutionReviewOperation(operation.id);
      if (previous) {
        if (json(previous) === json(operation)) { if (operation.status === 'pending') throw new ConflictError('Evolution review is already claimed; do not repeat potentially paid work.'); return; }
        if (previous.status !== 'pending' || operation.status === 'pending' || previous.projectId !== operation.projectId || previous.inputDigest !== operation.inputDigest || previous.createdAt !== operation.createdAt) throw new ConflictError('Evolution operation cannot be replaced or retried.');
      } else if (operation.status !== 'pending') throw new Error('Evolution review must be journaled before paid work.');
      const project = await this.loadProjectUnlocked(operation.projectId);
      if (project.schemaVersion !== 2) throw new ResearchVersionError();
      if (operation.status === 'completed') {
        const state = await this.loadEvolutionUnlocked();
        if (!state.history.some(item => item.id === operation.publicationId)) throw new Error('Evolution operation cannot complete without a published review.');
      }
      await atomicWrite(path.join(this.evolutionRoot(), 'operations', `${operation.id}.json`), json(operation));
    });
  }
  private evolutionRoot(): string { return path.join(this.dataRoot, 'evolution'); }
  private async evolutionPointer(): Promise<Pointer | undefined> {
    const filename = path.join(this.evolutionRoot(), 'checkpoint.json');
    if (!await exists(filename)) return undefined;
    const pointer = await readJson<Pointer>(filename);
    if (pointer.schemaVersion !== 1 || !/^[0-9a-f]{40}$/u.test(pointer.revision)) throw new Error('Invalid evolution checkpoint pointer; review the saved history before resuming.');
    return pointer;
  }
  private async loadEvolutionUnlocked(): Promise<GlobalEvolutionState> {
    const pointer = await this.evolutionPointer();
    if (!pointer) return { schemaVersion: 2, revision: 'initial', history: [], activeWaySkillVersions: {} };
    const bytes = await new GitRevisions(this.evolutionRoot()).read(pointer.revision, 'evolution.json');
    return { ...parseGlobalEvolutionState(JSON.parse(new TextDecoder().decode(bytes))), revision: pointer.revision };
  }
  async loadEvolutionState(): Promise<GlobalEvolutionState> {
    return this.serial('evolution-registry', () => this.loadEvolutionUnlocked());
  }
  /** Atomic review history publication, based on immutable reviewed case revisions, never model scores alone. */
  async publishEvolution(input: EvolutionPublication, expectedRevision: string): Promise<GlobalEvolutionState> {
    const publication = parseEvolutionPublication(input);
    return this.serial('evolution-registry', async () => {
      const previous = await this.loadEvolutionUnlocked();
      const duplicate = previous.history.find(item => item.id === publication.id);
      if (duplicate) { if (json(duplicate) !== json(publication)) throw new ConflictError('Evolution publication ID already has different content.'); return previous; }
      if (previous.revision !== expectedRevision) throw new ConflictError('Evolution history changed; review the current version before publishing.');
      if (previous.history.length >= 1000) throw new Error('Evolution history review limit reached. Archive through a separately reviewed process.');
      const cases: ResearchProjectV2[] = [];
      const seen = new Set<string>();
      for (const item of publication.review.cases) {
        const key = `${item.projectId}\0${item.sourceRevision}`; if (seen.has(key)) continue; seen.add(key);
        if (!/^[0-9a-f]{40}$/u.test(item.sourceRevision)) throw new Error('Evolution cases require committed Git revision provenance.');
        const project = await this.loadAt(id(item.projectId), item.sourceRevision);
        if (project.schemaVersion !== 2) throw new ResearchVersionError();
        cases.push(project);
      }
      assertEvolutionPublication(publication, previous, cases);
      if (publication.waySkill && publication.review.action === 'approve') await verifyTrialSources(publication.waySkill.id, cases, (projectId, revision) => this.loadAt(id(projectId), revision));
      const next = structuredClone(previous); next.history.push(publication);
      if (publication.review.action !== 'reject') {
        if (publication.policy) next.activePolicyVersion = publication.policy.version;
        if (publication.waySkill) next.activeWaySkillVersions[publication.waySkill.id] = publication.waySkill.version;
      }
      const root = this.evolutionRoot(); await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const git = new GitRevisions(root); await git.initialize();
      const pointer = await this.evolutionPointer();
      const revision = await git.commit({ 'evolution.json': json(next) }, pointer?.revision, `Reviewed ${publication.review.target} ${publication.review.action}: ${publication.review.candidateVersion}`);
      parseGlobalEvolutionState(JSON.parse(new TextDecoder().decode(await git.read(revision, 'evolution.json'))));
      await this.options.beforePublish?.(revision);
      if (pointer) await atomicWrite(path.join(root, 'checkpoint.previous.json'), json(pointer));
      await atomicWrite(path.join(root, 'checkpoint.json'), json({ schemaVersion: 1, revision, ...(pointer ? { previousRevision: pointer.revision } : {}) }));
      return { ...next, revision };
    });
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; await Promise.allSettled(this.pending.values());
    await this.library?.close();
    await releaseWriterLease(this.dataRoot, this.lockToken);
  }
}
export { GitRevisions } from './git-revisions.js';
