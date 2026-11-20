import { deliveredComponents } from './component-delivery.js';
import { Value } from 'typebox/value';
import { stableHash } from '../learning/research-hash.js';
import { ProofComponentSchema, type ChapterIdentity, type ChapterRef, type ProofComponent } from './contracts/documents.js';
import type { ComponentIssue, ResearchReceipt, ScientificReview } from './contracts/review.js';

type Project = { id: string; hypothesisRevision: string; rounds?: { research?: ResearchReceipt }[]; epochs?: { research?: ResearchReceipt }[];
  results: { branchId: string; taskId?: string; executionStatus: string; chapters?: ChapterRef[] }[] };
export type ComponentStatus = 'accepted' | 'needs_review' | 'withdrawn' | 'superseded';
export interface ComponentEntry { ref: ChapterRef; status: ComponentStatus; blockedBy: string[]; reason?: string; scientificallyInvalid?: boolean; reviewedUses?: {key:string;use:string;reason:string}[] }
export interface ComponentState { entries: ComponentEntry[]; issues: (ComponentIssue & { key: string })[]; dependents: Record<string, string[]> }
/** Only explicit pure selection rules are recoverable; authority/metadata errors stay ordinary errors. */
export class ComponentReviewValidationError extends Error {
  constructor(readonly rule: string, message: string, readonly kind: 'format' | 'semantic' = 'semantic') { super(message); this.name = 'ComponentReviewValidationError'; }
}
export interface ComponentProofDiagnostic { rule: string; message: string }
export const chapterKey = (ref: ChapterIdentity): string => stableHash([ref.sessionId, ref.attemptId, ref.chapterId, ref.hypothesisRevision, ref.conventionVersion, ref.contentHash]);

/** Only the caller's frozen grants and complete local chapters are allowed. No storage search. */
export function validateComponent(component: ProofComponent, allowed: readonly ChapterRef[], owner?: { sessionId: string; attemptId: string; chapterId: string }): void {
  if (!Value.Check(ProofComponentSchema, component)) throw new ComponentReviewValidationError('component-shape', 'Incomplete scientific component interface. Do not invent missing information.', 'format');
  const refs = new Map(allowed.map(ref => [chapterKey(ref), ref]));
  const seen = new Set<string>();
  for (const dependency of component.dependencies) {
    const key = chapterKey(dependency), ref = refs.get(key);
    if (!ref) throw new Error('Component dependency is not a granted complete component.');
    if (seen.has(key) || !dependency.use.trim()) throw new ComponentReviewValidationError('component-dependency-use', 'Component dependencies require unique exact versions and explicit uses.');
    seen.add(key);
    if (!ref.complete || !ref.component) throw new ComponentReviewValidationError('component-dependency-ineligible', 'Component dependency is not a granted complete component.');
    if (owner && dependency.sessionId === owner.sessionId && dependency.attemptId === owner.attemptId && dependency.chapterId === owner.chapterId) throw new ComponentReviewValidationError('component-self-dependency', 'A component cannot prove itself using its own earlier version.');
  }
  // Usually immutability already makes cycles impossible; reject malformed imported graphs too.
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new ComponentReviewValidationError('component-cycle', 'Cyclic proof dependencies are not a proof.');
    if (done.has(key)) return;
    visiting.add(key);
    for (const dep of refs.get(key)?.component?.dependencies ?? []) if (refs.has(chapterKey(dep))) visit(chapterKey(dep));
    visiting.delete(key); done.add(key);
  };
  for (const key of refs.keys()) visit(key);
}

function reviews(project: Project): ScientificReview[] {
  return [...(project.rounds ?? []), ...(project.epochs ?? [])].flatMap(record => record.research?.review ? [record.research.review] : []);
}
function replay(project: Project, additions: ScientificReview[] = [], finalize = true): ComponentState {
  return foldComponentState(project, { entries: [], issues: [], dependents: {} }, [...reviews(project), ...additions], finalize);
}
/** One event fold for history replay and a frozen current-review preview. Never mutates its seed. */
function foldComponentState(project: Pick<Project, 'id' | 'hypothesisRevision'>, seed: ComponentState, additions: ScientificReview[], finalize = true): ComponentState {
  const entries = new Map(structuredClone(seed.entries).map(entry => [chapterKey(entry.ref), entry]));
  const issues = new Map(structuredClone(seed.issues).map(issue => [issue.key, issue]));
  const dependents = structuredClone(seed.dependents);
  const invalidate = (key: string, visited = new Set<string>()): void => {
    if (visited.has(key)) return; visited.add(key);
    for (const child of dependents[key] ?? []) {
      const entry = entries.get(child)!;
      if (entry.status === 'accepted' || entry.status === 'needs_review') {
        entry.status = 'needs_review'; entry.blockedBy = [...new Set([...entry.blockedBy, key])];
        entry.reviewedUses = entry.reviewedUses?.filter(use => use.key !== key);
        invalidate(child, visited);
      }
    }
  };
  // Explicit interface-preserving revalidation terminates that propagation branch.
  const unblock = (key: string): void => {
    for (const child of dependents[key] ?? []) {
      const entry = entries.get(child)!;
      if (entry.status !== 'needs_review') continue;
      entry.blockedBy = entry.blockedBy.filter(parent => parent !== key);
      if (!entry.blockedBy.length) { entry.status = 'accepted'; unblock(child); }
    }
  };
  for (const review of additions) {
    for (const ref of review.adoptedChapters ?? []) {
      if (!ref.component || !ref.complete || ref.sessionId !== project.id || ref.hypothesisRevision !== project.hypothesisRevision) continue;
      const key = chapterKey(ref);
      // Redeclaring acceptance never resets an existing scientific invalidation.
      if (entries.has(key)) continue;
      entries.set(key, { ref: structuredClone(ref), status: 'accepted', blockedBy: [] });
      for (const dep of ref.component.dependencies) {
        const parent = chapterKey(dep); dependents[parent] = [...new Set([...(dependents[parent] ?? []), key])];
      }
    }
    for (const update of review.componentUpdates ?? []) {
      const key = chapterKey(update.ref), entry = entries.get(key);
      if (!entry) continue; // Old-target history remains recorded, but cannot affect this target.
      entry.reason = update.reason;
      if (update.action === 'revalidate') {
        entry.reviewedUses = [...(entry.reviewedUses ?? []), ...(update.recheckedUses ?? []).map(use => ({key:chapterKey(use.ref),use:use.use,reason:use.reason}))];
        entry.status = 'accepted'; entry.scientificallyInvalid = false; entry.blockedBy = []; unblock(key);
      } else {
        entry.status = update.action === 'withdraw' ? 'withdrawn' : 'superseded';
        entry.scientificallyInvalid = update.action === 'withdraw' || update.semanticChange !== false;
        if (update.action === 'withdraw' || update.semanticChange !== false) invalidate(key);
      }
    }
    for (const issue of review.componentIssues ?? []) {
      if (!entries.has(chapterKey(issue.ref))) continue;
      const key = stableHash({ ref: chapterKey(issue.ref), kind: issue.kind, use: issue.use.trim(), question: issue.question.trim() }), previous = issues.get(key);
      const newEvidence = issue.evidence.some(item => !previous?.evidence.includes(item));
      if (previous && !newEvidence && !issue.resolution) continue;
      issues.set(key, { ...structuredClone(issue), key, evidence: [...new Set([...(previous?.evidence ?? []), ...issue.evidence])],
        ...(!newEvidence && !issue.resolution && previous?.resolution ? { resolution: previous.resolution } : {}) });
      if (issue.kind === 'conflict' && !issue.resolution) {
        const refKey = chapterKey(issue.ref), entry = entries.get(refKey)!;
        if (entry.status === 'accepted' || entry.status === 'needs_review') {
          entry.status = 'needs_review'; entry.blockedBy = [...new Set([...entry.blockedBy, `issue:${key}`])];
        }
        invalidate(refKey);
      }
    }
  }
  // Resolving a dependency is not permission to ignore an independently open conflict.
  for (const issue of issues.values()) if (finalize && issue.kind === 'conflict' && !issue.resolution) {
    const key = chapterKey(issue.ref), entry = entries.get(key)!;
    if (entry.status === 'accepted') {
      entry.status = 'needs_review'; entry.blockedBy = [...new Set([...entry.blockedBy, `issue:${issue.key}`])]; invalidate(key);
    }
  }
  return { entries: [...entries.values()], issues: [...issues.values()], dependents };
}
export const componentState = (project: Project): ComponentState => replay(project);
export const eligibleComponents = (project: Project): ChapterRef[] => componentState(project).entries.filter(entry => entry.status === 'accepted').map(entry => entry.ref);
/** Accepted interfaces already travel once in adoptedPrerequisites; state is a small delta/index. */
export function componentInput(project: Project) {
  const reviewBase = replay(project, [], false), state = foldComponentState(project, reviewBase, []);
  return { ...state, reviewBase, entries: state.entries.map(entry => {
    if (entry.status === 'needs_review') return entry;
    const { component: _component, summary: _summary, ...ref } = entry.ref;
    return { ...entry, ref };
  }) };
}
export function componentIssuesFor(project: Project, refs: readonly ChapterRef[]): ComponentIssue[] {
  const keys = new Set(refs.map(chapterKey));
  return componentState(project).issues.filter(issue => keys.has(chapterKey(issue.ref))).map(({ key, ...issue }) => issue);
}

/** Pure pre-accept check. Engine and runtime supply the same frozen state and exact ended deliveries. */
export function checkComponentReview(project: Pick<Project, 'id' | 'hypothesisRevision'>, reviewBase: ComponentState, available: readonly ChapterRef[], review: ScientificReview): { after: ComponentState; affectedChapters: ChapterRef[] } {
  const before = foldComponentState(project, reviewBase, []);
  const byKey = new Map(available.map(ref => [chapterKey(ref), ref]));
  const accepted = new Map(before.entries.filter(entry => entry.status === 'accepted').map(entry => [chapterKey(entry.ref), entry.ref]));
  const candidates = (review.adoptedChapters ?? []).filter(ref => ref.component);
  // Multi-component tasks may be adopted together regardless of array order.
  for (const ref of candidates) {
    const exact = byKey.get(chapterKey(ref));
    if (!exact?.complete || stableHash(exact) !== stableHash(ref)) throw new Error('Only an exact completed Worker component may be adopted.');
    const old = before.entries.find(entry => chapterKey(entry.ref) === chapterKey(ref));
    if (old && old.status !== 'accepted') throw new ComponentReviewValidationError('adoption-invalidated', 'Invalidated components require an explicit revalidation, not repeated adoption.');
    validateComponent(ref.component!, [...accepted.values(), ...candidates.filter(local => local.attemptId === ref.attemptId)], ref);
  }
  const known = new Map([...before.entries.map(entry => [chapterKey(entry.ref), entry.ref] as const), ...candidates.map(ref => [chapterKey(ref), ref] as const)]);
  for (const [index, update] of (review.componentUpdates ?? []).entries()) {
    const key = chapterKey(update.ref), ref = known.get(key);
    const priorUpdates = foldComponentState(project, reviewBase, [{ ...review, componentUpdates: review.componentUpdates!.slice(0, index), componentIssues: [] }]);
    if (!ref) throw new Error('Component changes require a known exact version and scientific reason.');
    if (!update.reason.trim()) throw new ComponentReviewValidationError('update-reason', 'Component changes require a known exact version and scientific reason.');
    if (update.action === 'supersede') {
      if (update.replacement && !known.has(chapterKey(update.replacement))) throw new Error('Supersession requires a different accepted replacement and explicit semanticChange.');
      if (!update.replacement || chapterKey(update.replacement) === key || update.semanticChange === undefined) throw new ComponentReviewValidationError('supersession-shape', 'Supersession requires a different accepted replacement and explicit semanticChange.');
      if (!priorUpdates.entries.some(entry => chapterKey(entry.ref) === chapterKey(update.replacement!) && entry.status === 'accepted')) throw new ComponentReviewValidationError('supersession-unaccepted', 'The replacement is not an accepted component.');
    } else if (update.replacement || update.semanticChange !== undefined) throw new ComponentReviewValidationError('update-metadata', 'Replacement metadata belongs only to supersession.');
    if (update.action === 'revalidate' && update.interfaceUnchanged !== true) throw new ComponentReviewValidationError('revalidation-interface', 'Revalidation must affirm the same interface; changed claims require a new component.');
    if (update.action === 'revalidate' && priorUpdates.entries.some(entry => chapterKey(entry.ref) === key && ['withdrawn','superseded'].includes(entry.status))) throw new ComponentReviewValidationError('revalidation-retired', 'A withdrawn or superseded version requires a new corrected component, not reinstatement.');
    if (update.action === 'revalidate') {
      const old = priorUpdates.entries.find(entry => chapterKey(entry.ref) === key);
      for (const use of update.recheckedUses ?? []) {
        if (!known.has(chapterKey(use.ref)) && !ref.component!.dependencies.some(dep => chapterKey(dep) === chapterKey(use.ref))) throw new Error('Local revalidation must identify an exact declared dependency use and why the existing proof remains valid.');
        if (!use.reason.trim() || !ref.component!.dependencies.some(dep => chapterKey(dep) === chapterKey(use.ref) && dep.use === use.use)) throw new ComponentReviewValidationError('revalidation-use', 'Local revalidation must identify an exact declared dependency use and why the existing proof remains valid.');
      }
      for (const parent of old?.blockedBy.filter(key => !key.startsWith('issue:')) ?? []) if (!update.recheckedUses?.some(use => chapterKey(use.ref) === parent)) throw new ComponentReviewValidationError('revalidation-coverage', 'Explain every affected exact dependency use before revalidating unchanged proof.');
    } else if (update.recheckedUses?.length) throw new ComponentReviewValidationError('revalidation-metadata', 'Dependency-use rechecks belong only to explicit revalidation.');
  }
  for (const issue of review.componentIssues ?? []) {
    if (!known.has(chapterKey(issue.ref))) throw new Error('A clarification needs a known exact component, use and concrete question.');
    if (!issue.question.trim() || !issue.use.trim()) throw new ComponentReviewValidationError('issue-fields', 'A clarification needs a known exact component, use and concrete question.');
  }
  const after = foldComponentState(project, reviewBase, [review]);
  // Reject loops involving newly adopted components, including hand-crafted fixtures.
  const all = after.entries.map(entry => entry.ref);
  for (const ref of candidates) validateComponent(ref.component!, all, ref);
  const affectedChapters = after.entries.filter(entry => (entry.status === 'needs_review' || entry.scientificallyInvalid) &&
    (before.entries.find(old => chapterKey(old.ref) === chapterKey(entry.ref))?.status ?? 'accepted') === 'accepted').map(entry => entry.ref);
  return { after, affectedChapters };
}

/** Original closure predicates, without review mutation or IO. Unknown graph nodes are not permission. */
export function componentProofDiagnostic(after: ComponentState, proof: NonNullable<ScientificReview['proof']>): ComponentProofDiagnostic | undefined {
  const invalid = new Set(after.entries.filter(entry => entry.status === 'needs_review' || entry.scientificallyInvalid).map(entry => chapterKey(entry.ref)));
  const used = new Set<string>(), refs = new Map(after.entries.map(entry => [chapterKey(entry.ref), entry.ref]));
  const visit = (ref: ChapterRef): ComponentProofDiagnostic | undefined => {
    const key = chapterKey(ref); if (used.has(key)) return; used.add(key);
    if (invalid.has(key) || ref.component?.unresolved.length) return { rule: 'invalid-evidence', message: 'A final proof cannot use unresolved or invalidated component evidence.' };
    for (const dependency of ref.component?.dependencies ?? []) {
      const rechecked = after.entries.find(entry => chapterKey(entry.ref) === key)?.reviewedUses?.some(use => use.key === chapterKey(dependency) && use.use === dependency.use);
      if (rechecked) continue;
      const parent = refs.get(chapterKey(dependency));
      if (!parent) return { rule: 'unknown-component-dependency', message: 'Final component evidence has an unknown dependency.' };
      const issue = visit(parent); if (issue) return issue;
    }
  };
  for (const ref of [...(proof.evidenceChapters ?? []), ...(proof.chapters ?? [])]) if (ref.component) { const issue = visit(ref); if (issue) return issue; }
  const excluded = new Set<string>();
  for (const item of proof.unusedComponents ?? []) {
    const key = chapterKey(item.ref), message = 'An unused component needs a specific non-use reason and cannot also be a proof dependency.';
    if (!invalid.has(key)) return { rule: 'unused-not-invalid', message };
    if (!item.reason.trim()) return { rule: 'unused-reason', message };
    if (used.has(key)) return { rule: 'unused-used', message };
    excluded.add(key);
  }
  if (after.entries.some(entry => entry.status === 'needs_review' && !excluded.has(chapterKey(entry.ref)))) return { rule: 'remaining-needs-review', message: 'Resolve affected components or explicitly explain why they are not used in this final proof.' };
}

/** Engine-owned mutation boundary: bad review events still throw; bad closure preserves valid events. */
export function applyComponentReview(project: Project, review: ScientificReview): string | undefined {
  delete review.affectedChapters;
  const available = project.results.filter(result => result.executionStatus === 'completed')
    .flatMap(result => deliveredComponents(result).filter(ref => ref.attemptId === (result.taskId ?? result.branchId) && ref.sessionId === project.id && ref.hypothesisRevision === project.hypothesisRevision));
  const checked = checkComponentReview(project, replay(project, [], false), available, review);
  review.affectedChapters = checked.affectedChapters;
  try {
    const issue = review.proof && componentProofDiagnostic(checked.after, review.proof);
    if (issue) { delete review.proof; return issue.message; }
  } catch (error) {
    // A bad closure claim must never erase a valid withdrawal/conflict or its learning invalidation.
    delete review.proof;
    return error instanceof Error ? error.message : 'Final component evidence needs review.';
  }
}

/** Exact menu selection; graph nodes and execution labels are not adoption authority. */
export function selectComponents(project: Project, selected: readonly ChapterRef[]): ChapterRef[] {
  const allowed = new Map(eligibleComponents(project).map(ref => [chapterKey(ref), ref]));
  return selected.map(ref => {
    const saved = allowed.get(chapterKey(ref));
    if (!saved || stableHash(saved) !== stableHash(ref)) throw new Error('Dependency is not the current exact accepted component.');
    return structuredClone(saved);
  });
}
export const COMPONENT_ASSIGNMENT_INSTRUCTIONS = 'Group shared calculations and a scoped serial proof chain in one Worker; split only for useful independent parallel work, external dependencies or deliberate independent validation. One Worker may produce several reusable components. Give each obligation a primary owner; consumers cite accepted exact conclusions and check their applicability, not rederive them. A component is not automatically a separate task. Do not expand the assigned scientific goal. Same-Epoch live sibling results remain unavailable.';
