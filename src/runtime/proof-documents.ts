import { bindConnectingConditions, bindComponentInterfaces, conditionalClosureDiagnostic, ComponentInterfaceSelectionError, type ConditionalTask } from '../research/versions/v2/conditional-work.js';
import { Type, type TSchema } from 'typebox';
import { ScientificSlots, scientificSlotInstructions } from './scientific-slots.js';
import { Value } from 'typebox/value';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AnyAgentInvocation, AnyAgentSessionSpec } from '../research/contracts/loop.js';
import { ProofComponentSchema, ChapterRefSchema, type ChapterIdentity, type ChapterRef, type ProofComponent } from '../research/contracts/documents.js';
import { validateComponent, checkComponentReview, componentProofDiagnostic, ComponentReviewValidationError, type ComponentState } from '../research/proof-components.js';
import { deliveredComponents, validateComponentDelivery, ComponentDeliveryValidationError } from '../research/component-delivery.js';
import type { InheritedResearchView } from '../research/contracts/lineage.js';
import type { EndedAttempt, ScientificReview } from '../research/contracts/review.js';
import type { BoundaryView, ProofRef } from '../learning/research-data.js';
import { stableHash } from '../learning/research-hash.js';
import { ProofChapters } from '../storage/proof-chapters.js';
import type { TranscriptContext } from '@earendil-works/pi-ai';
import { ContractValidationError } from './strict-schema.js';
import { RuntimeError } from './errors.js';
import { ChapterSelectionSchema, selectGrantedChapter } from './chapter-selection.js';
import { uniqueProofEvidence } from './proof-evidence.js';
import { conditionalActionableDiagnostics, formatConditionalActionableDiagnostics } from '../research/versions/v2/conditional-diagnostics.js';

const same = (a: unknown, b: unknown) => stableHash(a) === stableHash(b);
// Only explicit known-selection checks use local feedback; authority and reader exceptions bypass it.
const documentSelectionError = (rule: string, path: string, message: string, kind: 'format' | 'semantic' = 'semantic') =>
  new ContractValidationError([message], kind, [{path,keyword:rule,message}]);
const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
export type ChapterPurpose = 'read' | 'adoption' | 'prerequisite' | 'continuation' | 'dependency' | 'manuscript' | 'evidence' | 'delivery' | 'correction';
/** Per-role grants and delivery receipts. Persisted chapters survive an invalid RETURN. */
export class ProofDocumentSession {
  private grants: ChapterRef[] = [];
  private reads: ChapterRef[] = [];
  private adoptable: ChapterRef[] = [];
  private proofsRead: ProofRef[] = [];
  private proofBodies = new Map<string, string[]>();
  private written: ChapterRef[] = [];
  private invocation?: AnyAgentInvocation;
  private adopted: ChapterRef[] = [];
  private readonly inherited?: InheritedResearchView;
  constructor(private readonly store: ProofChapters, private readonly spec: Exclude<AnyAgentSessionSpec, {contractVersion: '2.1'}>, inherited?: InheritedResearchView) {
    // Only trusted host composition supplies this already verified immutable read view.
    this.inherited = inherited ? structuredClone(inherited) : undefined;
  }
  private get owner(): string { return 'brief' in this.spec.context ? ('taskId' in this.spec.context.brief ? this.spec.context.brief.taskId : this.spec.context.brief.branchId) : this.spec.id; }
  private get target(): string {
    if ('brief' in this.spec.context) return this.spec.context.brief.rootHypothesisRevision;
    const input = this.invocation?.input as { snapshot?: { hypothesisRevision: string }; project?: { hypothesisRevision: string } } | undefined;
    return input?.snapshot?.hypothesisRevision ?? input?.project?.hypothesisRevision ?? this.spec.context.project.hypothesisRevision;
  }
  private get convention(): string {
    if ('brief' in this.spec.context) return this.spec.context.brief.conventionVersion ?? stableHash(this.spec.context.brief.assumptions);
    return stableHash({ target: this.target });
  }
  async prepare(invocation: AnyAgentInvocation): Promise<void> {
    this.handles.delete('C0'); // Final receipt alias belongs to one frozen invocation only.
    this.invocation = invocation;
    this.written = await this.store.list(this.spec.projectId, this.owner);
    this.adopted = structuredClone((invocation.input as { adoptedPrerequisites?: ChapterRef[] }).adoptedPrerequisites ?? []);
    if ('brief' in this.spec.context) {
      const brief = this.spec.context.brief;
      if ('adoptedChapters' in brief) this.adopted = structuredClone(brief.adoptedChapters ?? []);
      const continuation = 'way' in brief ? brief.way.continuation : brief.continuation;
      const parent = this.inherited?.attempts.find(attempt => attempt.id === continuation?.parentAttemptId);
      const origin = parent ? this.inherited?.attemptOrigins[parent.id] : undefined;
      this.grants = (continuation?.chapters ?? []).filter(ref =>
        ref.sessionId === this.spec.projectId && ref.attemptId === continuation!.parentAttemptId
        || Boolean(origin && ref.sessionId === origin.sessionId && ref.attemptId === origin.attemptId
          && parent?.chapters?.some(saved => same(saved, ref)) && this.inherited?.chapters.some(saved => same(saved, ref))));
      // These grants are frozen by the engine after scientific adoption; a model dependency ID is not permission.
      if ('adoptedChapters' in brief) for (const ref of brief.adoptedChapters ?? []) {
        if (ref.sessionId !== this.spec.projectId || !ref.complete || ref.hypothesisRevision !== this.target) throw new Error('Invalid adopted prerequisite chapter.');
        const use = 'way' in brief ? brief.way.dependencyUse : brief.dependencyUse;
        if (ref.conventionVersion !== this.convention && (!use?.reuse.trim() || !use.recheck.trim())) throw new Error('Adopted prerequisites under different conventions require explicit reuse and recheck instructions.');
        if (!this.grants.some(grant => same(grant, ref))) this.grants.push(structuredClone(ref));
      }
      if ((continuation?.chapters ?? []).some(ref => ref.hypothesisRevision !== this.target || ref.conventionVersion !== this.convention) && (!continuation?.reuse || !continuation.redo)) throw new Error('Continuation requires explicit reusable and redo sections under changed conventions.');
    } else {
      const input = invocation.input as { attempts?: EndedAttempt[]; attemptIndex?: EndedAttempt[] };
      this.adoptable = [...(input.attempts ?? []), ...(input.attemptIndex ?? [])].filter(attempt => attempt.executionStatus === 'completed').flatMap(attempt => [...deliveredComponents(attempt), ...(attempt.chapters ?? []).filter(ref => !ref.component)].filter(ref => ref.sessionId === this.spec.projectId && ref.attemptId === attempt.id));
      // Engine-supplied ended-attempt index only; no live sibling outputs or model-provided grants.
      this.grants = [...(input.attempts ?? []), ...(input.attemptIndex ?? [])].flatMap(attempt => (attempt.chapters ?? []).filter(ref => ref.sessionId === this.spec.projectId && ref.attemptId === attempt.id));
      if (this.spec.role === 'theorist') for (const ref of this.inherited?.chapters ?? []) {
        if (!this.grants.some(grant => same(grant, ref))) this.grants.push(structuredClone(ref));
      }
      for (const ref of this.adopted) if (!this.grants.some(grant => same(grant, ref))) this.grants.push(structuredClone(ref));
    }
  }
  /** Return only invocation-local choices; never look up or silently repair a model hash. */
  private referenceRecovery(ref: ChapterIdentity, allowed: ChapterRef[], ownPending = false): unknown | undefined {
    const choices = allowed.filter(item => item.sessionId === ref.sessionId && item.attemptId === ref.attemptId && item.chapterId === ref.chapterId
      && item.hypothesisRevision === ref.hypothesisRevision && item.conventionVersion === ref.conventionVersion);
    const local = ownPending && ref.sessionId === this.spec.projectId && ref.attemptId === this.owner
      && ref.hypothesisRevision === this.target && ref.conventionVersion === this.convention;
    if (!choices.length && !local) return;
    return { error: 'CHAPTER_REFERENCE_NOT_AVAILABLE', recoverable: true, saved: false,
      message: 'No chapter was saved or read. Save the upstream chapter first, wait for its returned ref, then explicitly retry using that exact version. Never guess hashes; available refs are choices, not automatic replacements.',
      requested: ref, available: choices };
  }
  private handles = new Map<string, unknown>();
  handleSnapshot(): [string, unknown][] { this.referenceChoices(); return structuredClone([...this.handles]); }
  restoreHandles(entries: [string, unknown][]): void {
    // Reserve old aliases even if grants changed; unavailable references stay unavailable.
    this.handles = new Map(structuredClone(entries));
  }
  bindFinalReceipt(receipt: unknown): void {
    const result = receipt as {content?: {type:string;text?:string}[]};
    const text = result.content?.find(part => part.type === 'text')?.text;
    const ref = text ? JSON.parse(text).ref : undefined;
    if (!ref || !this.written.some(saved => same(saved, ref))) throw new Error('Missing saved final chapter receipt.');
    const previous = this.handles.get('C0');
    if (previous && !same(previous, ref)) throw new Error('C0 already names a different final chapter; select its ordinary granted handle explicitly.');
    this.handles.set('C0', structuredClone(ref));
  }
  referenceChoices(purpose: ChapterPurpose = 'read'): { handle: string; value: unknown }[] {
    const available: unknown[] = [];
    const add = (prefix: string, value: unknown) => {
      available.push(value);
      if ([...this.handles.values()].some(prior => same(prior, value))) return;
      const count = Math.max(0, ...[...this.handles.keys()].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(1))));
      this.handles.set(`${prefix}${count + 1}`, structuredClone(value));
    };
    for (const ref of [...this.grants, ...this.adopted, ...this.written]) add('C', ref);
    const input = this.invocation?.input as { attemptIndex?: {id:string;version:string}[]; attempts?: {id:string;version:string}[] } | undefined;
    for (const ref of [...(input?.attemptIndex ?? []), ...(input?.attempts ?? [])]) add('A', { id: ref.id, version: ref.version });
    const permitted = this.chapterChoices(purpose);
    return [...this.handles].filter(([handle, value]) => available.some(item => same(item, value))
      && (!handle.startsWith('C') || permitted.some(item => same(item, value)))).map(([handle, value]) => ({ handle, value }));
  }
  /** Menus describe existing scientific eligibility, never grant adoption or replace final checks. */
  private chapterChoices(purpose: ChapterPurpose): ChapterRef[] {
    const readable = [...this.grants, ...this.adopted, ...this.written];
    const adoption = [...this.adoptable, ...this.adopted].filter(ref => ref.complete
      && (ref.component || this.reads.some(read => same(read, ref))));
    switch (purpose) {
      case 'read': return readable;
      case 'adoption': return adoption;
      case 'prerequisite': return this.adopted;
      case 'continuation': return this.grants;
      case 'delivery': return this.written.filter(ref => ref.complete && ref.component);
      case 'correction': return this.written.filter(ref => ref.component);
      case 'dependency': return [...(this.spec.role === 'theorist' ? adoption : this.adopted), ...this.written]
        .filter(ref => ref.complete && ref.component);
      case 'evidence': return adoption.filter(ref => !ref.component?.unresolved.length);
      case 'manuscript': return [...this.written, ...adoption.filter(ref => ref.component)]
        .filter(ref => ref.complete && ref.hypothesisRevision === this.target && !ref.component?.unresolved.length);
    }
  }
  referenceDirectory(): unknown[] {
    return this.referenceChoices().map(({handle, value}) => {
      const ref = value as Partial<ChapterRef> & {id?:string;version?:string};
      return handle.startsWith('A') ? {handle, id:ref.id, version:ref.version}
        : {handle, attemptId:ref.attemptId, chapterId:ref.chapterId, contentHash:ref.contentHash, title:ref.title, complete:ref.complete};
    });
  }
  resolveHandle = (handle: string, schema: TSchema): unknown => {
    const value = this.referenceChoices().find(item => item.handle === handle)?.value;
    if (!value || typeof value !== 'object') throw new Error(`Unknown frozen reference handle: ${handle}`);
    const properties = (schema as { properties?: Record<string, unknown> }).properties;
    if (!properties || (handle.startsWith('A') ? !('id' in properties && 'version' in properties) : !('chapterId' in properties && 'contentHash' in properties))) throw new Error(`Reference handle ${handle} is not valid for this field.`);
    return Object.fromEntries(Object.entries(structuredClone(value)).filter(([key]) => key in properties));
  };
  rawChapterInstructions(): string {
    return '\nTo save a chapter without JSON escaping, return a chapter-only message starting @@saveChapter then the raw fields below. The host saves and returns its handle; continue the SAME task afterward. A final chapter may be followed by a standalone @@report heading and explicit report fields in the SAME message. C0 selects exactly that saved final chapter, only after its save succeeds; it never implies adoption. Use this bundle once per task. Other dependent saves still wait for their receipts. Legacy storage adapters remain compatible; this Pi session submits scientific bodies through raw fields. Dependencies can select C handles; wait for each receipt before dependent saves.\n' + scientificSlotInstructions(RAW_CHAPTER_SCHEMA);
  }
  async saveRaw(text: string, slots: ScientificSlots): Promise<unknown> {
    const value = slots.decode(text.replace(/^@@saveChapter[ \t]*\r?\n/, ''));
    if (!Value.Check(RAW_CHAPTER_SCHEMA, value)) throw new Error([...Value.Errors(RAW_CHAPTER_SCHEMA, value)].map(error => `${error.instancePath}: ${error.message}`).join('; '));
    const tool = this.tools().find(item => item.name === 'save_proof_chapter');
    if (!tool) throw new Error('This role cannot save proof chapters.');
    const result = await (tool.execute as Function)('raw-chapter', value);
    const receiptText = result.content?.find((part: {type:string;text?:string}) => part.type === 'text')?.text;
    const receipt = receiptText ? JSON.parse(receiptText) : undefined;
    if (receipt?.error) throw new Error(JSON.stringify(receipt));
    this.referenceChoices();
    return result;
  }
  proofRead(ref: ProofRef, content?: { type: string; text?: string }[]): void {
    if (!this.proofsRead.some(prior => same(prior, ref))) this.proofsRead.push(structuredClone(ref));
    if (content) this.proofBodies.set(stableHash(ref), content.flatMap(part => part.type === 'text' && part.text ? [part.text] : []));
  }
  /** A cache hit or a surviving session ID does not establish that the body is still in the request. */
  observeContext(context: TranscriptContext): void {
    const texts = context.messages.flatMap(message => message.role === 'toolResult'
      ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []);
    this.proofsRead = this.proofsRead.filter(ref => {
      const body = this.proofBodies.get(stableHash(ref));
      return Boolean(body?.length && body.every(text => texts.includes(text)));
    });
  }
  recoveryIndex(): ChapterRef[] { return structuredClone(this.written); }
  /** Navigation only: full interfaces remain in canonical receipts/storage, readable by exact version. */
  recoveryDirectory(): (ChapterIdentity & Pick<ChapterRef, 'title' | 'complete'>)[] {
    return this.written.map(({ sessionId, attemptId, chapterId, hypothesisRevision, conventionVersion, contentHash, title, complete }) =>
      ({ sessionId, attemptId, chapterId, hypothesisRevision, conventionVersion, contentHash, title, complete }));
  }
  async preserveRejectedReport(content: string): Promise<void> {
    if (this.spec.role !== 'worker' || !content.trim()) return;
    const ref = await this.store.save({ sessionId: this.spec.projectId, attemptId: this.owner,
      hypothesisRevision: this.target, conventionVersion: this.convention,
      chapterId: `unvalidated-${this.invocation?.step ?? 'report'}`, title: 'Unvalidated public Worker report',
      summary: 'Output did not satisfy the protocol. Public material is retained for inspection, not accepted evidence or a completed proof.', complete: false }, content);
    if (!this.written.some(prior => same(prior, ref))) this.written.push(ref);
  }
  /** Shared non-mutating save preflight; receipt creation still requires the durable write. */
  prepareChapterComponent(suppliedComponent: ProofComponent | undefined, chapterId: string): { component?: ProofComponent; rejection?: unknown } {
    let component = suppliedComponent;
    const allowed = [...(this.spec.role === 'theorist' ? this.grants : this.adopted), ...this.written];
    if (component && Value.Check(ProofComponentSchema, component)) for (const dependency of component.dependencies) {
      if (!selectGrantedChapter(dependency, allowed)) {
        const recovery = this.referenceRecovery(dependency, allowed, true);
        if (recovery) return { rejection: recovery };
        throw new RuntimeError('INVALID_TOOL');
      }
    }
    if (component && 'brief' in this.spec.context && 'way' in this.spec.context.brief) {
      try { component = bindComponentInterfaces(component, this.spec.context.brief.way); }
      catch (error) { if (!(error instanceof ComponentInterfaceSelectionError)) throw error; return { rejection: { error: 'INTERFACE_SELECTION', rule: error.rule, message: error.message, retry: 'Keep the derivation; correct only the nested interface selection.' } }; }
    }
    if (component && this.spec.role === 'theorist') component = bindConnectingConditions(component, (this.invocation?.input as { conditionalTasks?: ConditionalTask[] })?.conditionalTasks ?? [], allowed);
    if (component) {
      try { validateComponent(component, allowed,{ sessionId:this.spec.projectId,attemptId:this.owner,chapterId }); }
      catch(error) {throw new ContractValidationError([error instanceof Error?error.message:'Invalid scientific component interface.'],'semantic');}
    }
    return { component };
  }
  /** Frozen metadata only; legacy callers without a state keep the engine's mandatory post-check. */
  private checkReview(review: ScientificReview): void {
    if (!review.proof && !review.adoptedChapters?.length && !review.componentUpdates?.length && !review.componentIssues?.length) return;
    const input = this.invocation?.input as { componentState?: ComponentState & { reviewBase?: ComponentState }; attempts?: EndedAttempt[]; attemptIndex?: EndedAttempt[] };
    if (!Object.prototype.hasOwnProperty.call(input, 'componentState')) return;
    const state = input.componentState?.reviewBase;
    if (!state || !Array.isArray(state.entries) || !Array.isArray(state.issues) || !state.dependents || Array.isArray(state.dependents)
      || typeof state.dependents !== 'object' || Object.values(state.dependents).some(values => !Array.isArray(values) || values.some(value => typeof value !== 'string')))
      throw new RuntimeError('INVALID_CONFIGURATION');
    for (const entry of state.entries) if (!entry?.ref || entry.ref.sessionId !== this.spec.projectId || entry.ref.hypothesisRevision !== this.target || !['accepted','needs_review','withdrawn','superseded'].includes(entry.status)
      || !Array.isArray(entry.blockedBy) || entry.blockedBy.some(key => typeof key !== 'string') || !entry.ref.component || !Value.Check(ChapterRefSchema, entry.ref))
      throw new RuntimeError('INVALID_CONFIGURATION');
    for (const item of review.proof?.unusedComponents ?? []) if (!selectGrantedChapter(item.ref, [...this.grants, ...this.adopted, ...this.written])) throw new RuntimeError('INVALID_TOOL');
    const available = [...(input.attemptIndex ?? input.attempts ?? [])].filter(attempt => attempt.executionStatus === 'completed')
      .flatMap(attempt => deliveredComponents(attempt).filter(ref => ref.sessionId === this.spec.projectId && ref.attemptId === attempt.id && ref.hypothesisRevision === this.target));
    let checked: ReturnType<typeof checkComponentReview>;
    try { checked = checkComponentReview({ id: this.spec.projectId, hypothesisRevision: this.target }, state, available, review); }
    catch (error) {
      if (!(error instanceof ComponentReviewValidationError)) throw error;
      throw new ContractValidationError([error.message], error.kind, [{path:'/researchReview',keyword:error.rule,message:error.message}]);
    }
    const issue = review.proof && componentProofDiagnostic(checked.after, review.proof);
    if (!issue) return;
    if (issue.rule === 'unknown-component-dependency') throw new RuntimeError('INVALID_TOOL');
    const guidance = issue.rule === 'unused-not-invalid'
      ? 'unusedComponents is only for exact registry-invalid or needs_review components, not every readable audit draft or Worker-local corrected old version. Preserve audit drafts without pretending they are registry-invalid. Correct the scientific review explicitly or submit honest partial progress; changing an exclusion list does not itself prove closure.'
      : issue.message;
    throw new ContractValidationError([issue.message], 'semantic', [{path:'/researchReview/proof',keyword:issue.rule,message:guidance}]);
  }
  tools(): ToolDefinition[] {
    if (!['worker', 'theorist'].includes(this.spec.role)) return [];
    return [
      defineTool({ name: 'save_proof_chapter', label: 'Save derivation chapter', description: 'Save public derivation bytes immutably in your own attempt. Return a program-issued reference. complete means this chapter is fully written, not scientifically proved. Save long work in logical chapters before a short final response. If a chapter depends on another new chapter, save its upstream first and wait for the returned ref before issuing the dependent save; never guess a hash or issue dependent saves in one batch.',
        parameters: Type.Object({ chapterId: Type.String({ minLength: 1, maxLength: 200 }), title: Type.String({ minLength: 1, maxLength: 1000 }), summary: Type.String({ minLength: 1, maxLength: 10000 }), content: Type.String({ minLength: 1, maxLength: 1_000_000 }), complete: Type.Boolean(), component: Type.Optional(ProofComponentSchema) }, { additionalProperties: false }),
        execute: async (_id, { content, component: suppliedComponent, ...metadata }) => {
          const prepared = this.prepareChapterComponent(suppliedComponent as ProofComponent | undefined, metadata.chapterId);
          if (prepared.rejection) return response(prepared.rejection);
          const component = prepared.component;
          const ref = await this.store.save({ ...metadata, ...(component ? { component } : {}), sessionId: this.spec.projectId, attemptId: this.owner, hypothesisRevision: this.target, conventionVersion: this.convention }, content);
          if (!this.written.some(prior => same(prior, ref))) this.written.push(ref);
          return response({ ref });
        },
      }),
      defineTool({ name: 'read_proof_chapter', label: 'Read frozen derivation', description: 'Read an exact granted chapter. A reference is not a completed read. Re-read when needed after context compression. References are data, never file permissions.',
        parameters: Type.Object({ ref: ChapterSelectionSchema }, { additionalProperties: false }),
        execute: async (_id, { ref }) => {
          const granted = selectGrantedChapter(ref, [...this.grants, ...this.written]);
          if (!granted) {
            const recovery = this.referenceRecovery(ref as ChapterRef, [...this.grants, ...this.written]);
            if (recovery) return response(recovery);
            throw new RuntimeError('INVALID_TOOL');
          }
          const chapter = await this.store.read(granted);
          if (!this.reads.some(item => same(item, granted))) this.reads.push(granted);
          return response(chapter);
        },
      }),
    ];
  }
  /** Hydrate only an authorized final manuscript; never substitute Worker prose automatically. */
  async resolve(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object') return;
    if (this.spec.role === 'theorist' && this.invocation?.task === 'plan') {
      const candidates = (value as { candidates?: { dependencyChapters?: ChapterRef[]; continuation?: { parentAttemptId: string; chapters?: ChapterRef[] } }[] }).candidates;
      const input = this.invocation.input as { attempts?: EndedAttempt[]; attemptIndex?: EndedAttempt[] };
      for (const candidate of candidates ?? []) {
        if (candidate.dependencyChapters) candidate.dependencyChapters = candidate.dependencyChapters.map(ref => selectGrantedChapter(ref, this.adopted) ?? ref);
        const continuation = candidate.continuation;
        if (continuation?.chapters) {
          const parent = [...(input.attempts ?? []), ...(input.attemptIndex ?? []), ...(this.inherited?.attempts ?? [])].find(attempt => attempt.id === continuation.parentAttemptId);
          continuation.chapters = continuation.chapters.map(ref => selectGrantedChapter(ref, parent?.chapters ?? []) ?? ref);
        }
      }
    }
    const output = value as { result?: { chapters?: ChapterRef[]; componentDelivery?: unknown }; researchReview?: ScientificReview };
    if (this.spec.role === 'worker' && output.result) {
      if (this.written.some(ref => ref.component) || output.result.componentDelivery !== undefined) {
        try { output.result.componentDelivery = await validateComponentDelivery(output.result.componentDelivery, this.written, ref => this.store.read(ref)); }
        catch(error) {
          if (!(error instanceof ComponentDeliveryValidationError)) throw error;
          throw new ContractValidationError([error.message], error.kind, [{path:'/result/componentDelivery',keyword:error.rule,message:error.message}]);
        }
      }
      output.result.chapters = structuredClone(this.written);
      return;
    }
    const review = output.researchReview;
    if (this.spec.role !== 'theorist' || !review) return;
    // Dependency consequences are derived by the engine, never asserted by a model.
    delete review.affectedChapters;
    // Overwrite claims with actual successful deliveries, without requesting duplicate reads.
    review.documentsRead = structuredClone(this.reads);
    if (review.adoptedChapters) review.adoptedChapters = review.adoptedChapters.map(ref => selectGrantedChapter(ref, this.grants) ?? ref);
    for (const ref of review.adoptedChapters ?? []) {
      if (!this.grants.some(grant => same(grant, ref))) throw new RuntimeError('INVALID_TOOL');
      if (!ref.complete) throw documentSelectionError('adoption-incomplete','/researchReview/adoptedChapters','Adoption needs an authorized complete component interface; incomplete chapters are not delivered results.');
      if (!ref.component && !this.reads.some(read => same(read, ref))) throw documentSelectionError('adoption-legacy-unread','/researchReview/adoptedChapters','Adoption needs an authorized complete component interface; legacy chapters require an actual body read.');
      if (!this.adoptable.some(grant => same(grant, ref)) && !this.adopted.some(grant => same(grant, ref))) throw documentSelectionError('adoption-not-completed','/researchReview/adoptedChapters','Adoption requires an exact chapter from a completed Worker. Failed/interrupted attempt chapters are recovery drafts only; remove them from adoption/evidence and continue their local task before accepting them.');
    }
    const input = this.invocation?.input as { hypothesisId?: string; project?: { hypothesisId?: string }; researchBoundary?: BoundaryView; snapshot?: { researchBoundary?: BoundaryView } };
    const boundary = input.researchBoundary ?? input.snapshot?.researchBoundary;
    const hypothesisId = input.project?.hypothesisId ?? input.hypothesisId ?? `h_${this.target}`;
    if (review.unchangedProof && (review.unchangedProof.sessionId !== this.spec.projectId || review.unchangedProof.hypothesisId !== hypothesisId
      || !boundary?.proofs?.some(item => same(item.ref, review.unchangedProof)))) throw new Error('Read the exact current-session proof body before declaring it unchanged.');
    if (review.unchangedProof && !this.proofsRead.some(ref => same(ref, review.unchangedProof))) throw documentSelectionError('unchanged-proof-unread','/researchReview/unchangedProof','Read the exact current-session proof body before declaring it unchanged.');
    const proof = review.proof;
    if (!proof) { this.checkReview(review); return; }
    const frozen = this.invocation?.input as { project?: { hypothesis?: string }; snapshot?: { hypothesis?: string; problem?: { goal: string } } };
    // Target identity is host-owned; the scientific scope remains in conditions/logicalRelation/linkReason.
    const target = frozen.project?.hypothesis ?? frozen.snapshot?.hypothesis;
    if (target) {
      if (proof.target !== undefined && proof.target !== target && proof.target !== frozen.snapshot?.problem?.goal) throw new Error('The proof target differs from the frozen root and its approved scientific restatement. Return to planning before changing the target.');
      proof.target = target;
    }
    if (proof.evidenceChapters) proof.evidenceChapters = proof.evidenceChapters.map(ref => selectGrantedChapter(ref, this.grants) ?? ref);
    for (const ref of proof.evidenceChapters ?? []) {
      const accepted = [...this.adopted, ...(review.adoptedChapters ?? [])].some(item => same(item, ref));
      if (!this.grants.some(grant => same(grant, ref))) throw new RuntimeError('INVALID_TOOL');
      if (!ref.complete) throw documentSelectionError('evidence-incomplete','/researchReview/proof/evidenceChapters','Proof evidence needs complete chapters from the authorized current choices.');
      if (ref.component) {
        if (!accepted) throw documentSelectionError('evidence-unaccepted','/researchReview/proof/evidenceChapters','Proof evidence needs an accepted resolved component. If scientifically warranted, explicitly select its exact version in researchReview.adoptedChapters; menu eligibility is not adoption. Adoption/evidence does not append manuscript bodies: explicitly select necessary proof.chapters or provide a genuinely complete own proof; do not merely delete necessary references and retain the same closure claim.');
        if (ref.component.unresolved.length) throw documentSelectionError('evidence-unresolved','/researchReview/proof/evidenceChapters','Proof evidence needs an accepted resolved component; unresolved obligations must be resolved scientifically or retained as partial progress.');
      } else {
        if (!this.adoptable.some(item => same(item, ref))) throw documentSelectionError('evidence-legacy-not-completed','/researchReview/proof/evidenceChapters','Proof evidence needs an inspected complete legacy chapter from a completed Worker.');
        if (!this.reads.some(read => same(read, ref))) throw documentSelectionError('evidence-legacy-unread','/researchReview/proof/evidenceChapters','Read the exact authorized complete legacy chapter before selecting it as proof evidence.');
      }
    }
    const adopted = [...this.adopted, ...(review.adoptedChapters ?? [])];
    const sources = [...this.grants, ...this.written, ...adopted];
    const collected = new Set<string>();
    const collectDependencies = (ref: ChapterRef): void => {
      const key = stableHash(ref); if (collected.has(key)) return; collected.add(key);
      // An adopted Worker conclusion is the scientific reuse boundary. Its ancestors
      // remain in engine state, including any explicitly rechecked local dependency use.
      if (!this.written.some(item => same(item, ref))) return;
      for (const dependency of ref.component?.dependencies ?? []) {
        const source = selectGrantedChapter(dependency, sources);
        if (!source) throw new RuntimeError('INVALID_TOOL');
        if (!source.complete || !source.component || source.component.unresolved.length) throw documentSelectionError('dependency-ineligible','/researchReview/proof/chapters','Final manuscript dependencies must be complete resolved components.');
        if (!this.written.some(item => same(item, source)) && !adopted.some(item => same(item, source))) throw documentSelectionError('dependency-unaccepted','/researchReview/proof/chapters','A connecting manuscript chapter uses a component that has not been accepted; make any scientific adoption explicit rather than silently removing its dependency.');
        if (!proof.evidenceChapters?.some(item => same(item, source))) (proof.evidenceChapters ??= []).push(structuredClone(source));
        collectDependencies(source);
      }
    };
    for (const ref of [...(proof.evidenceChapters ?? [])]) collectDependencies(ref);
    if (proof.chapters) proof.chapters = proof.chapters.map(ref => selectGrantedChapter(ref, [...this.written, ...adopted]) ?? ref);
    if (proof.chapters?.length) {
      if (proof.proof?.trim()) throw documentSelectionError('manuscript-representation','/researchReview/proof','Use one manuscript representation: inline proof or ordered chapter references.','format');
      const bodies: string[] = [];
      for (const ref of proof.chapters) {
        const own = this.written.some(saved => same(saved, ref));
        const accepted = Boolean(ref.component && !ref.component.unresolved.length && adopted.some(saved => same(saved, ref)));
        if (!own && !accepted && !selectGrantedChapter(ref, sources)) throw new RuntimeError('INVALID_TOOL');
        if (ref.hypothesisRevision !== this.target) throw new Error('Final manuscript needs complete own chapters or explicitly selected accepted proof components.');
        if (!ref.complete) throw documentSelectionError('manuscript-incomplete','/researchReview/proof/chapters','Final manuscript needs complete own chapters or explicitly selected accepted proof components.');
        if (ref.component?.unresolved.length) throw documentSelectionError('manuscript-unresolved','/researchReview/proof/chapters','Final manuscript needs resolved own chapters or explicitly selected accepted proof components.');
        if (!own && !accepted) throw documentSelectionError('manuscript-unaccepted','/researchReview/proof/chapters','Final manuscript needs complete own chapters or explicitly selected accepted proof components. Select scientific adoption explicitly only if warranted; readability alone is not acceptance.');
        if (accepted && !own && !proof.evidenceChapters?.some(item => same(item, ref))) (proof.evidenceChapters ??= []).push(structuredClone(ref));
        collectDependencies(ref);
        bodies.push((await this.store.read(ref)).content);
      }
      proof.proof = bodies.join('\n\n');
    }
    // Exact evidence is host-owned bookkeeping after every selected source has passed
    // authorization/adoption/unresolved checks. Do not deduplicate ordered bodies,
    // select additional chapters or promote adopted-only sources into this set.
    if (proof.evidenceChapters) proof.evidenceChapters = uniqueProofEvidence(proof.evidenceChapters);
    this.checkReview(review);
    const conditionalIssue = conditionalClosureDiagnostic((this.invocation?.input as { conditionalTasks?: ConditionalTask[] })?.conditionalTasks ?? [], review);
    if (conditionalIssue) {
      const shown: string[] = []; let size = 0;
      for (const condition of conditionalIssue.missingConditions ?? []) {
        if (shown.length >= 8 || size + condition.length > 16_000) break;
        shown.push(condition); size += condition.length;
      }
      const missing = conditionalIssue.missingConditions?.length;
      const actionable = conditionalActionableDiagnostics((this.invocation?.input as { conditionalTasks?: ConditionalTask[] })?.conditionalTasks ?? [], review, this.written);
      const guidance = formatConditionalActionableDiagnostics(actionable);
      const message = conditionalIssue.message + (guidance ? ` ${guidance} Authoritative diagnostic metadata (structural hints only, not scientific acceptance): ${JSON.stringify(actionable)}` : '') + (missing ? ` Observed missing source conditions across otherwise connected candidates (showing ${shown.length}/${missing}; each used interface needs one valid exact connected source whose full conditions are preserved): ${JSON.stringify(shown)}` : '');
      throw new ContractValidationError([message], 'semantic', [{path:'/researchReview/proof',keyword:conditionalIssue.rule,expected:`frozen-obligation:${conditionalIssue.obligationKey}`,message:'Resolve the named frozen conditional obligation with its exact completed sources and an explicit valid connecting component; alternatively provide a genuinely independent complete own proof without reusing conditional evidence, or submit partial progress without a new proof.'}]);
    }
    if (!proof.proof?.trim()) throw documentSelectionError('proof-body-missing','/researchReview/proof','Final proof body is missing; keep the draft and do not claim archival.');
    const prior = boundary?.proofs?.find(item => item.ref.hypothesisId === hypothesisId && item.meta?.methodKey === proof.methodKey);
    if (prior && !this.proofsRead.some(ref => same(ref, prior.ref))) throw documentSelectionError('prior-proof-unread','/researchReview/proof','Read the exact previous proof body before revising it.');
    proof.expectedRevision = prior?.ref.revision ?? 0;
  }
}

export const PROOF_DOCUMENT_INSTRUCTIONS = `\nProof document protocol: dispatch a task-relevant proofContext (symbols, conditions and obligations). Select dependencyChapters from exact adopted prerequisites, naming reusable claims and the conditions/conventions needed by this task in dependencyUse. Do not reprove accepted premises. A continuation selects exact ended-parent chapters and states reuse and necessary newWork/redo. Workers return pathReport and explicitly identify changed assumptions or symbols. Save a corrected reusable conclusion through save_proof_chapter with component fields: exact statement, conditions, symbols, direct dependency identities and their use, unresolved issues. Its body includes the actual corrected derivation; keep superseded exploratory chapters for audit. A complete chapter is fully written, not automatically scientifically accepted. Worker drafts need formulas and logic, not paper layout. Theorist accepts useful interfaces with researchReview.adoptedChapters without default body reading; inspect relevant steps only for a concrete inconsistency or necessary undeclared property. Legacy chapters without an interface require actual reading before acceptance. Never claim documentsRead from a reference or interface. For a final manuscript, explicitly order researchReview.proof.chapters: accepted Worker components may be combined with your own framing and connection chapters. The host resolves exact bodies without claiming that you read them. Include used component versions in evidenceChapters; unresolved or affected evidence cannot close the root. The host assembles Summary -> Proof -> Restriction -> Reference from the explicit summary, ordered proof chapters, conditions and source references. Chapter bodies retain concise logic and display equations without repeating the framing sections. Check new connecting arguments, symbol transformations and full obligation coverage, without rewriting unchanged components. Before revision or unchangedProof, the exact old body must remain available; reuse its index and edit affected sections, reading the exact body again after context loss. Cache hits and session identity are not body availability. Wrong formulas, missing premises or logical gaps require semanticChange:true even when the conclusion is unchanged. Only a returned stored ProofRef confirms archival. Do not repeat saved chapter bodies in the control summary.`;

/** After scientific validation, reuse the resolved manuscript in the existing V2 paper view. */
export function reuseSynthesisManuscript(value: { summary: string; researchReview?: { proof?: { proof?: string } } }): void {
  const manuscript = value.researchReview?.proof?.proof;
  if (manuscript?.trim()) value.summary = manuscript;
}

export const WORKER_DOCUMENT_INSTRUCTIONS = `\nWorker document protocol: prove only the local target using the frozen local conditions and selected component interfaces. Use save_proof_chapter to save substantial reusable work with exact statement, conditions, symbols, direct granted dependency versions/use and unresolved gaps. A complete chapter means fully written, not accepted science. Conditional premises remain explicit conditions in every saved component and report; never forge a reference to a live sibling or prove its assigned task. Save prerequisites first and wait for exact tool-issued refs before dependent saves. Corrected CHECK conclusions require new complete saved bytes and explicit RETURN componentDelivery selections/correction mappings. Keep old drafts for recovery; do not select superseded versions. Return local pathReport progress and limitations, not the root proof. Bodies need equations and logic, not final-paper formatting. Read only necessary exact granted chapters after a specific gap or context loss; do not routinely reprove accepted interfaces. Do not repeat saved bodies in the control report.`;

export const RAW_CHAPTER_SCHEMA = Type.Object({ chapterId: Type.String({minLength:1,maxLength:200}), title: Type.String({minLength:1,maxLength:1000}), summary: Type.String({minLength:1,maxLength:10000}), content: Type.String({minLength:1,maxLength:1_000_000}), complete: Type.Boolean(), component: Type.Optional(ProofComponentSchema) }, {additionalProperties:false});

/** Presentation is derived from validated scientific fields, never parsed as control state. */
export function formatProofManuscript(proof: NonNullable<ScientificReview['proof']>): void {
  if(!proof.proof?.trim())return;
  const restrictions=proof.conditions.length?proof.conditions.map(condition=>'- '+condition).join('\n'):'No additional conditions declared.';
  proof.proof=`## Summary\n${proof.summary}\n\n## Proof\n${proof.proof}\n\n## Restriction\n${restrictions}`
    +(proof.sourceRefs?.length?'\n\n## Reference\n'+proof.sourceRefs.map(ref=>'- '+ref).join('\n'):'');
}
