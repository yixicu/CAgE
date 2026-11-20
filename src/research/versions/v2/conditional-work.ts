import type { EpochTask, PossibleWay, ResearchBriefV2, WorkerResult } from '../../contracts/v2.js';
import type { ScientificReview } from '../../contracts/review.js';
import { stableHash } from '../../../learning/research-hash.js';
import type { ProofComponent, ChapterRef } from '../../contracts/documents.js';
import { chapterKey } from '../../proof-components.js';
import { deliveredComponents } from '../../component-delivery.js';

/** Frozen scientific contracts, scoped to one way/revision; no semantic-equivalence guessing. */
export const interfaceVersion = (way: Pick<PossibleWay, 'id' | 'hypothesisRevision'>, item: NonNullable<PossibleWay['proofInterfaces']>[number]): string =>
  stableHash([way.id, way.hypothesisRevision, item.id, item.statement, item.conditions, item.symbols]);

export type ComponentInterfaceSelectionRule = 'invalid-interface-selection' | 'missing-assigned-premises';
/** Fixed two-family diagnostic metadata; changing submitted IDs never creates another recovery lane. */
export function componentInterfaceSelectionDetails(rule: unknown) {
  const missing = rule === 'missing-assigned-premises';
  return [{ path: missing ? '/component/usesPremises' : '/component', keyword: missing ? 'missing-assigned-premises' : 'invalid-interface-selection',
    expected: missing ? 'all-assigned-premise-ids' : 'unique-frozen-interface-ids',
    message: missing ? 'List every assigned conditional premise ID in component.usesPremises.' : 'Select only unique frozen premise/assigned interface IDs inside component.' }];
}
export class ComponentInterfaceSelectionError extends Error {
  constructor(readonly rule: ComponentInterfaceSelectionRule, message: string) { super(message); this.name = 'ComponentInterfaceSelectionError'; }
}
/** Display only trusted frozen menu IDs, never submitted unknown values or scientific body text. */
function interfaceMenu(ids: readonly string[]): string {
  const shown: string[] = []; let size = 2;
  for (const id of ids) { const bytes = JSON.stringify(id).length + 1; if (shown.length >= 32 || size + bytes > 16000) break; shown.push(id); size += bytes; }
  return JSON.stringify(shown) + (shown.length < ids.length ? ` (showing ${shown.length}/${ids.length}; consult get_module_contract)` : '');
}
export function bindComponentInterfaces(component: ProofComponent, way: Pick<PossibleWay, 'conditionalPremises' | 'proofInterfaces'>): ProofComponent {
  const bound = structuredClone(component), premises = way.conditionalPremises ?? [], interfaces = way.proofInterfaces ?? [];
  const used = bound.usesPremises ?? [], fulfilled = bound.fulfillsInterfaces ?? [];
  if (new Set(used).size !== used.length || new Set(fulfilled).size !== fulfilled.length
    || used.some(id => !premises.some(p => p.sourceInterfaceId === id))
    || fulfilled.some(id => !interfaces.some(item => item.id === id))) throw new ComponentInterfaceSelectionError('invalid-interface-selection', `Select only unique frozen premise/assigned interface IDs. /component/usesPremises required IDs: ${interfaceMenu(premises.flatMap(p => p.sourceInterfaceId ? [p.sourceInterfaceId] : []))}. /component/fulfillsInterfaces allowed IDs: ${interfaceMenu(interfaces.map(item => item.id))}. Unknown or duplicate submitted IDs remain rejected; only declare interfaces actually fulfilled.`);
  if (premises.some(p => p.sourceInterfaceId && !used.includes(p.sourceInterfaceId)))
    throw new ComponentInterfaceSelectionError('missing-assigned-premises', `List every assigned conditional premise ID; independent work needs an explicit Theorist scope change. /component/usesPremises required IDs: ${interfaceMenu(premises.flatMap(p => p.sourceInterfaceId ? [p.sourceInterfaceId] : []))}; missing IDs: ${interfaceMenu(premises.flatMap(p => p.sourceInterfaceId && !used.includes(p.sourceInterfaceId) ? [p.sourceInterfaceId] : []))}. /component/fulfillsInterfaces allowed IDs: ${interfaceMenu(interfaces.map(item => item.id))}; select only those actually fulfilled.`);
  // Old tasks have no ID protocol. Preserve their frozen assumptions programmatically, never infer equivalence.
  const inherited = premises.filter(p => !p.sourceInterfaceId || used.includes(p.sourceInterfaceId)).flatMap(p => [p.statement, ...(p.conditions ?? [])]);
  bound.conditions = [...new Set([...bound.conditions, ...inherited, ...interfaces.filter(item => fulfilled.includes(item.id)).flatMap(item => item.conditions)])];
  return bound;
}

/** Logical assumptions are not runtime data dependencies or grants to sibling workspaces. */
export function conditionalPlanIssues(ways: readonly PossibleWay[]): string[] {
  const byId = new Map(ways.map(way => [way.id, way])), issues: string[] = [];
  const interfaceIds = new Set<string>();
  for (const way of ways) for (const item of way.proofInterfaces ?? []) {
    if (interfaceIds.has(item.id)) issues.push(`${way.id}/proofInterfaces/${item.id}/id: duplicate interface ID in this plan.`);
    if (item.version !== interfaceVersion(way, item)) issues.push(`${way.id}/proofInterfaces/${item.id}/version: host version does not match the frozen interface; do not rename its ID to repair a version conflict.`);
    interfaceIds.add(item.id);
  }
  const active = new Set<string>(), done = new Set<string>();
  const visit = (way: PossibleWay): void => {
    if (active.has(way.id)) { issues.push('Conditional proof contracts must be acyclic.'); return; }
    if (done.has(way.id)) return;
    active.add(way.id);
    const seen = new Set<string>();
    for (const premise of way.conditionalPremises ?? []) {
      const source = byId.get(premise.sourceWayId);
      const contract = source?.proofInterfaces?.find(item => item.id === premise.sourceInterfaceId);
      const identity = `${premise.sourceWayId}:${premise.sourceInterfaceId ?? 'legacy'}`;
      const matches = premise.sourceInterfaceId ? contract && premise.version === contract.version && premise.statement === contract.statement && stableHash(premise.conditions ?? null) === stableHash(contract.conditions) && stableHash(premise.symbols ?? null) === stableHash(contract.symbols) : source?.targetProposition === premise.statement;
      if (!source || source.id === way.id || seen.has(identity)
        || source.hypothesisRevision !== way.hypothesisRevision || !matches
        || way.proofContext?.scope !== 'module' || source.proofContext?.scope !== 'module') {
        issues.push(`${way.id}: conditional premise needs a unique frozen interface from another current module (or exact legacy target) and local scope.`); continue;
      }
      seen.add(identity); visit(source);
    }
    active.delete(way.id); done.add(way.id);
  };
  ways.forEach(visit); return issues;
}

export type ConditionalTask = Pick<EpochTask, 'id' | 'epochId'> & {
  way: Pick<PossibleWay, 'id' | 'conditionalPremises' | 'proofInterfaces'>;
  brief: Pick<ResearchBriefV2, 'rootHypothesisRevision'>;
  result?: Pick<WorkerResult, 'executionStatus' | 'chapters' | 'componentDelivery'>;
};
/** Related chapter interfaces (including recovery drafts), never bodies, scores or trace histories. */
export function conditionalTaskIndex(tasks: readonly EpochTask[]): ConditionalTask[] {
  const relevant = new Set<string>();
  for (const task of tasks) if (task.way.conditionalPremises?.length) {
    relevant.add(task.id);
    for (const premise of task.way.conditionalPremises) {
      const source = tasks.find(item => item.epochId === task.epochId && item.way.id === premise.sourceWayId);
      if (source) relevant.add(source.id);
    }
  }
  // Include only connected descendants/ancestors, so an indirect use cannot hide a conditional premise.
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) for (const ref of task.result?.chapters ?? []) for (const dep of ref.component?.dependencies ?? []) {
      if ((relevant.has(task.id) || relevant.has(dep.attemptId)) && tasks.some(item => item.id === dep.attemptId)) {
        if (!relevant.has(task.id) || !relevant.has(dep.attemptId)) changed = true;
        relevant.add(task.id); relevant.add(dep.attemptId);
      }
    }
  }
  return tasks.filter(task => relevant.has(task.id)).map(task => ({id:task.id, epochId:task.epochId,
    way:{id:task.way.id, conditionalPremises:task.way.conditionalPremises, proofInterfaces:task.way.proofInterfaces},
    brief:{rootHypothesisRevision:task.brief.rootHypothesisRevision},
    ...(task.result ? {result:{executionStatus:task.result.executionStatus, chapters:task.result.chapters, componentDelivery:task.result.componentDelivery}} : {})}));
}

/** Preserve selected dependency conditions; only an explicit source+child connection discharges a frozen claim. */
export function bindConnectingConditions(component: ProofComponent, tasks: readonly ConditionalTask[], granted: readonly ChapterRef[]): ProofComponent {
  const bound = structuredClone(component);
  const selected = bound.dependencies.map(dep => granted.find(ref => chapterKey(ref) === chapterKey(dep))).filter((ref): ref is ChapterRef => Boolean(ref?.component));
  const discharged = new Set<string>(), requiredSourceConditions = new Set<string>();
  for (const child of selected) {
    const task = tasks.find(item => item.id === child.attemptId);
    for (const premise of task?.way.conditionalPremises ?? []) {
      if (premise.sourceInterfaceId && !child.component?.usesPremises?.includes(premise.sourceInterfaceId)) continue;
      const source = tasks.find(item => item.epochId === task!.epochId && item.way.id === premise.sourceWayId && item.brief.rootHypothesisRevision === task!.brief.rootHypothesisRevision);
      if (source?.result?.executionStatus !== 'completed') continue;
      const connected = deliveredComponents(source.result).filter(parent => selected.some(ref => chapterKey(ref) === chapterKey(parent))
        && parent.component && !parent.component.unresolved.length && (premise.sourceInterfaceId
          ? parent.component.fulfillsInterfaces?.includes(premise.sourceInterfaceId) && source.way.proofInterfaces?.some(item => item.id === premise.sourceInterfaceId && item.version === premise.version && item.statement === premise.statement)
          : parent.component.statement === premise.statement));
      if (connected.length) {
        discharged.add(premise.statement);
        // Exact immutable parent assumptions are host metadata, not model transcription work.
        if (task?.result?.executionStatus === 'completed' && !child.component!.unresolved.length
          && deliveredComponents(task.result).some(ref => chapterKey(ref) === chapterKey(child)))
          for (const parent of connected) for (const condition of parent.component!.conditions) requiredSourceConditions.add(condition);
      }
    }
  }
  bound.conditions = [...new Set([...bound.conditions, ...selected.flatMap(ref => ref.component!.conditions).filter(condition => !discharged.has(condition)), ...requiredSourceConditions])];
  return bound;
}

/** Reject unsupported conditional discharge, including inline final-manuscript submissions. */
export interface ConditionalClosureDiagnostic { rule: 'conditional-draft' | 'conditional-premise-use' | 'conditional-discharge'; message: string; obligationKey: string; missingConditions?: string[] }
/** Stable host-frozen obligation identity, never a model bridge/call/body or changing missing-text list. */
function conditionalDiagnostic(task: ConditionalTask, rule: ConditionalClosureDiagnostic['rule'], message: string, missingConditions?: string[]): ConditionalClosureDiagnostic {
  return { rule, message, obligationKey: stableHash([task.epochId, task.id, task.brief.rootHypothesisRevision,
    (task.way.conditionalPremises ?? []).map(premise => [premise.sourceWayId, premise.sourceInterfaceId ?? null, premise.version ?? null])]),
    ...(missingConditions?.length ? { missingConditions } : {}) };
}
/** Existing engine callers retain their string API and the same single validation algorithm. */
export function conditionalClosureIssue(tasks: readonly ConditionalTask[], review: ScientificReview): string | undefined {
  return conditionalClosureDiagnostic(tasks, review)?.message;
}
export function conditionalClosureDiagnostic(tasks: readonly ConditionalTask[], review: ScientificReview): ConditionalClosureDiagnostic | undefined {
  const proof = review.proof;
  if (!proof) return;
  const conditional = tasks.filter(task => task.way.conditionalPremises?.length);
  if (!conditional.length) return;
  const evidence = [...(proof.evidenceChapters ?? []), ...(proof.chapters ?? [])];
  // Unused historical routes must not block a genuinely independent proof.
  if (!evidence.length) return;
  const all = new Map<string, ChapterRef>();
  for (const task of tasks) if (task.result?.executionStatus === 'completed')
    for (const ref of task.result.chapters ?? []) all.set(chapterKey(ref), ref);
  for (const ref of evidence) all.set(chapterKey(ref), ref);
  const used = new Set<string>();
  const visit = (ref: ChapterRef): void => {
    const key = chapterKey(ref); if (used.has(key)) return; used.add(key);
    for (const dep of ref.component?.dependencies ?? []) { const parent = all.get(chapterKey(dep)); if (parent) visit(parent); }
  };
  evidence.forEach(visit);
  for (const task of conditional) for (const child of all.values()) {
    if (child.attemptId !== task.id || !used.has(chapterKey(child))) continue;
    if (!deliveredComponents(task.result ?? {}).some(ref => chapterKey(ref) === chapterKey(child)) || !child.component)
      return conditionalDiagnostic(task, 'conditional-draft', `Conditional task ${task.id} cannot supply a legacy, unselected or failed draft as final evidence.`);
    if (task.way.conditionalPremises?.some(p => p.sourceInterfaceId && !child.component!.usesPremises?.includes(p.sourceInterfaceId))) return conditionalDiagnostic(task, 'conditional-premise-use', `Conditional task ${task.id} lacks an explicit premise-use declaration.`);
    const premises = (task.way.conditionalPremises ?? []).filter(p => !p.sourceInterfaceId || child.component!.usesPremises?.includes(p.sourceInterfaceId));
    if (!premises.length) continue;
    const requirements = premises.map(premise => {
      const source = tasks.find(item => item.epochId === task.epochId && item.way.id === premise.sourceWayId
        && item.brief.rootHypothesisRevision === task.brief.rootHypothesisRevision);
      return source?.result?.executionStatus === 'completed' ? deliveredComponents(source.result).filter(ref =>
        ref.component && (premise.sourceInterfaceId
          ? ref.component.fulfillsInterfaces?.includes(premise.sourceInterfaceId) && source.way.proofInterfaces?.some(item => item.id === premise.sourceInterfaceId && item.version === premise.version && item.statement === premise.statement)
          : ref.component.statement === premise.statement) && !ref.component.unresolved.length && used.has(chapterKey(ref))) : [];
    });
    const remaining = child.component.conditions.filter(condition => !premises.some(p => p.statement === condition));
    const missingConditions = new Set<string>();
    const bridge = evidence.find(ref => {
      const component = ref.component;
      if (ref.attemptId === task.id || tasks.some(item => item.id === ref.attemptId) || !component || component.unresolved.length
        || !component.dependencies.some(dep => chapterKey(dep) === chapterKey(child)) || !remaining.every(condition => component.conditions.includes(condition))) return false;
      const directlyConnected = (parent: ChapterRef) => component.dependencies.some(dep => chapterKey(dep) === chapterKey(parent));
      // Diagnostics only: do not reveal condition text for incomplete/unknown connections or alter acceptance.
      const allConnected = requirements.every(sources => sources.some(directlyConnected));
      const fulfilled = requirements.map(sources => {
        const gaps = new Set<string>();
        const satisfied = sources.some(parent => {
          if (!directlyConnected(parent)) return false;
          const missing = parent.component!.conditions.filter(condition => !component.conditions.includes(condition));
          for (const condition of missing) gaps.add(condition);
          return !missing.length;
        });
        if (allConnected && !satisfied) for (const condition of gaps) missingConditions.add(condition);
        return satisfied;
      });
      return fulfilled.every(Boolean);
    });
    if (!bridge) return conditionalDiagnostic(task, 'conditional-discharge', `Conditional discharge for ${task.id} needs completed sources explicitly fulfilling every used frozen interface, and a Theorist connecting component referencing those versions and preserving remaining conditions.`, [...missingConditions]);
  }
}
