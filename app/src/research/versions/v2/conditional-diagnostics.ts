import type { ChapterIdentity, ChapterRef } from '../../contracts/documents.js';
import type { ScientificReview } from '../../contracts/review.js';
import type { ConditionalTask } from './conditional-work.js';
import { chapterKey } from '../../proof-components.js';
import { deliveredComponents } from '../../component-delivery.js';
import { stableHash } from '../../../learning/research-hash.js';

export const CONDITIONAL_DIAGNOSTIC_LIMITS = Object.freeze({ diagnostics: 16, sources: 16, references: 8, bytes: 24000, messageCharacters: 4000 });
export type ConditionalSourceStatus = 'source-missing' | 'source-unresolved' | 'source-resolved-not-reachable' | 'source-resolved-reachable';
export interface ConditionalSourceDiagnostic {
  sourceWayId: string;
  sourceInterfaceId?: string;
  version?: string;
  status: ConditionalSourceStatus;
  references: ChapterIdentity[];
  truncated: boolean;
}
export interface ConditionalActionableDiagnostic {
  obligationKey: string;
  child: ChapterIdentity;
  sources: ConditionalSourceDiagnostic[];
  connecting: {
    status: 'selected-structurally-compatible' | 'saved-structurally-compatible-not-selected' | 'no-structurally-compatible-saved-candidate';
    candidates: ChapterIdentity[];
    truncated: boolean;
  };
  truncated: boolean;
}
export interface ConditionalActionableDiagnostics { diagnostics: ConditionalActionableDiagnostic[]; truncated: boolean }
const identity = (ref: ChapterIdentity): ChapterIdentity => ({ sessionId: ref.sessionId, attemptId: ref.attemptId, chapterId: ref.chapterId,
  hypothesisRevision: ref.hypothesisRevision, conventionVersion: ref.conventionVersion, contentHash: ref.contentHash });
const sorted = (refs: readonly ChapterRef[]): ChapterRef[] => [...new Map(refs.map(ref => [chapterKey(ref), ref])).values()]
  .sort((a, b) => chapterKey(a).localeCompare(chapterKey(b)));
const boundedRefs = (refs: readonly ChapterRef[]): ChapterIdentity[] => sorted(refs).slice(0, CONDITIONAL_DIAGNOSTIC_LIMITS.references).map(identity);

/**
 * Read-only repair hints, never an acceptance decision or scientific-validity judgment.
 * The caller must supply only saved own candidates it is authorized to inspect. Selected
 * review refs contribute identities only; their metadata cannot override authoritative refs.
 * No bodies, summaries, dependency-use prose or linkReason are read or returned.
 */
export function conditionalActionableDiagnostics(tasks: readonly ConditionalTask[], review: ScientificReview,
  authorizedOwnCandidates: readonly ChapterRef[]): ConditionalActionableDiagnostics {
  const output: ConditionalActionableDiagnostics = { diagnostics: [], truncated: false };
  const evidence = [...(review.proof?.chapters ?? []), ...(review.proof?.evidenceChapters ?? [])];
  if (!evidence.length) return output;
  const taskIds = new Set(tasks.map(task => task.id));
  const own = sorted(authorizedOwnCandidates.filter(ref => !taskIds.has(ref.attemptId)));
  const all = new Map<string, ChapterRef>();
  for (const task of tasks) if (task.result?.executionStatus === 'completed')
    for (const ref of task.result.chapters ?? []) all.set(chapterKey(ref), ref);
  for (const ref of own) all.set(chapterKey(ref), ref);
  const selected = new Set(evidence.map(chapterKey)), reachable = new Set<string>();
  const pending = [...selected];
  while (pending.length) {
    const key = pending.pop()!;
    if (reachable.has(key)) continue;
    const ref = all.get(key);
    if (!ref) continue;
    reachable.add(key);
    for (const dep of ref.component?.dependencies ?? []) pending.push(chapterKey(dep));
  }
  const orderedTasks = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  for (const task of orderedTasks) {
    const premises = task.way.conditionalPremises ?? [];
    if (!premises.length || task.result?.executionStatus !== 'completed') continue;
    for (const child of sorted(deliveredComponents(task.result))) {
      if (!reachable.has(chapterKey(child)) || !child.component) continue;
      const usedPremises = premises.filter(p => !p.sourceInterfaceId || child.component!.usesPremises?.includes(p.sourceInterfaceId));
      if (!usedPremises.length) continue;
      // This is the historical host-frozen fingerprint, not a hash of candidates or hints.
      const obligationKey = stableHash([task.epochId, task.id, task.brief.rootHypothesisRevision,
        premises.map(p => [p.sourceWayId, p.sourceInterfaceId ?? null, p.version ?? null])]);
      const requirements = usedPremises.map(premise => {
        const sources = orderedTasks.filter(source => source.epochId === task.epochId && source.way.id === premise.sourceWayId
          && source.brief.rootHypothesisRevision === task.brief.rootHypothesisRevision && source.result?.executionStatus === 'completed');
        const matching = sorted(sources.flatMap(source => deliveredComponents(source.result!).filter(ref => ref.component && (premise.sourceInterfaceId
          ? ref.component.fulfillsInterfaces?.includes(premise.sourceInterfaceId) && source.way.proofInterfaces?.some(item => item.id === premise.sourceInterfaceId && item.version === premise.version && item.statement === premise.statement)
          : ref.component.statement === premise.statement))));
        const resolved = matching.filter(ref => !ref.component!.unresolved.length);
        const status: ConditionalSourceStatus = !matching.length ? 'source-missing' : !resolved.length ? 'source-unresolved'
          : resolved.some(ref => reachable.has(chapterKey(ref))) ? 'source-resolved-reachable' : 'source-resolved-not-reachable';
        return { premise, resolved, diagnostic: { sourceWayId: premise.sourceWayId,
          ...(premise.sourceInterfaceId ? { sourceInterfaceId: premise.sourceInterfaceId } : {}),
          ...(premise.version !== undefined ? { version: premise.version } : {}), status,
          references: boundedRefs(resolved.length ? resolved : matching), truncated: (resolved.length || matching.length) > CONDITIONAL_DIAGNOSTIC_LIMITS.references } satisfies ConditionalSourceDiagnostic };
      });
      const remaining = child.component.conditions.filter(condition => !usedPremises.some(p => p.statement === condition));
      const compatible = own.filter(ref => {
        const component = ref.component;
        if (ref.sessionId !== child.sessionId || ref.hypothesisRevision !== child.hypothesisRevision
          || !ref.complete || !component || component.unresolved.length) return false;
        const dependencies = new Set(component.dependencies.map(chapterKey));
        return dependencies.has(chapterKey(child)) && remaining.every(condition => component.conditions.includes(condition))
          && requirements.every(({ resolved }) => resolved.some(source => dependencies.has(chapterKey(source))
            && source.component!.conditions.every(condition => component.conditions.includes(condition))));
      });
      const selectedCompatible = compatible.filter(ref => selected.has(chapterKey(ref)));
      const candidates = selectedCompatible.length ? selectedCompatible : compatible;
      const diagnostic: ConditionalActionableDiagnostic = { obligationKey, child: identity(child),
        sources: requirements.map(item => item.diagnostic).slice(0, CONDITIONAL_DIAGNOSTIC_LIMITS.sources),
        connecting: { status: selectedCompatible.length ? 'selected-structurally-compatible' : compatible.length
          ? 'saved-structurally-compatible-not-selected' : 'no-structurally-compatible-saved-candidate',
          candidates: boundedRefs(candidates), truncated: candidates.length > CONDITIONAL_DIAGNOSTIC_LIMITS.references },
        truncated: requirements.length > CONDITIONAL_DIAGNOSTIC_LIMITS.sources };
      // Never truncate an exact identity or silently turn a prefix into a valid reference.
      if (output.diagnostics.length >= CONDITIONAL_DIAGNOSTIC_LIMITS.diagnostics
        || new TextEncoder().encode(JSON.stringify({ diagnostics: [...output.diagnostics, diagnostic], truncated: false })).length > CONDITIONAL_DIAGNOSTIC_LIMITS.bytes) {
        output.truncated = true; continue;
      }
      output.diagnostics.push(diagnostic);
      if (diagnostic.truncated || diagnostic.connecting.truncated || diagnostic.sources.some(source => source.truncated)) output.truncated = true;
    }
  }
  return output;
}

/** Bounded fixed-language guidance; exact candidate refs remain in the structured result. */
export function formatConditionalActionableDiagnostics(result: ConditionalActionableDiagnostics): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) {
    const states = [...new Set(diagnostic.sources.map(source => source.status))].join(', ');
    const action = diagnostic.connecting.status === 'saved-structurally-compatible-not-selected'
      ? 'An authorized saved own connecting candidate is structurally compatible but not selected. Review its science and explicitly select exact refs if appropriate.'
      : diagnostic.connecting.status === 'selected-structurally-compatible'
        ? 'A selected own connecting candidate is structurally compatible; this does not establish scientific validity or acceptance.'
        : 'No authorized saved own candidate structurally connects the exact child and every resolved frozen source while preserving conditions. Complete or review the missing connection.';
    const line = `Conditional obligation ${diagnostic.obligationKey}: ${states}. ${action}`;
    if ([...lines, line].join('\n').length > CONDITIONAL_DIAGNOSTIC_LIMITS.messageCharacters - 100) break;
    lines.push(line);
  }
  if (result.truncated || lines.length < result.diagnostics.length) lines.push('Diagnostics are bounded; inspect the authorized exact references for remaining obligations.');
  return lines.join('\n');
}
