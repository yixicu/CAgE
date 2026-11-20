import { Value } from 'typebox/value';
import { ComponentDeliverySchema, type ChapterRef, type ComponentDelivery } from './contracts/documents.js';
import { stableHash } from '../learning/research-hash.js';
import type { ChapterIdentity } from './contracts/documents.js';
const chapterKey = (ref: ChapterIdentity) => stableHash([ref.sessionId, ref.attemptId, ref.chapterId, ref.hypothesisRevision, ref.conventionVersion, ref.contentHash]);

/** Explicit local format/scientific rejection; unknown identities and reader failures remain fatal. */
export class ComponentDeliveryValidationError extends Error {
  constructor(readonly rule: 'delivery-shape' | 'duplicate-selection' | 'selected-component-ineligible' | 'correction-component-ineligible' | 'correction-same-version' | 'correction-reason' | 'duplicate-correction-source' | 'superseded-selected' | 'correction-cycle' | 'final-replacement-unselected' | 'unchanged-correction-body' | 'superseded-dependency' | 'missing-local-prerequisite', message: string, readonly kind: 'format' | 'semantic' = 'semantic') { super(message); this.name = 'ComponentDeliveryValidationError'; }
}

type Result = { chapters?: readonly ChapterRef[]; componentDelivery?: ComponentDelivery };
/** Old persisted results remain readable; new runtime returns require an explicit manifest. */
export function deliveredComponents(result: Result): ChapterRef[] {
  const selected = result.componentDelivery && new Set(result.componentDelivery.chapters.map(chapterKey));
  return (result.chapters ?? []).filter(ref => ref.complete && ref.component && (!selected || selected.has(chapterKey(ref))));
}

/** Validate provenance and actual revision bytes, never decide whether a scientific claim is true. */
export async function validateComponentDelivery(value: unknown, written: readonly ChapterRef[], read: (ref: ChapterRef) => Promise<{ content: string }>): Promise<ComponentDelivery> {
  if (!Value.Check(ComponentDeliverySchema, value)) throw new ComponentDeliveryValidationError('delivery-shape', 'Saved components require componentDelivery with explicit chapters and corrections (use [] only when checked and none).', 'format');
  const delivery = value as ComponentDelivery, byKey = new Map(written.map(ref => [chapterKey(ref), ref]));
  // Authority is checked for the entire well-shaped request before any correctable scientific rule.
  for (const identity of delivery.chapters) if (!byKey.has(chapterKey(identity))) throw new Error('Delivery references must name exact component versions saved by this Worker.');
  for (const correction of delivery.corrections) if (!byKey.has(chapterKey(correction.previous)) || !byKey.has(chapterKey(correction.replacement))) throw new Error('Correction references must name exact component versions saved by this Worker.');
  const selected = new Set<string>(), replaced = new Set<string>();
  const replacements = new Map(delivery.corrections.map(item => [chapterKey(item.previous), chapterKey(item.replacement)]));
  for (const identity of delivery.chapters) {
    const key = chapterKey(identity), ref = byKey.get(key);
    if (selected.has(key)) throw new ComponentDeliveryValidationError('duplicate-selection', 'Delivery selects unique exact complete component versions saved by this Worker.');
    if (!ref?.complete || !ref.component) throw new ComponentDeliveryValidationError('selected-component-ineligible', 'Delivery selects unique exact complete component versions saved by this Worker.');
    selected.add(key);
  }
  for (const correction of delivery.corrections) {
    const oldKey = chapterKey(correction.previous), newKey = chapterKey(correction.replacement);
    const previous = byKey.get(oldKey), replacement = byKey.get(newKey);
    if (!previous?.component || !replacement?.component || !replacement.complete) throw new ComponentDeliveryValidationError('correction-component-ineligible', 'A correction needs exact distinct saved component versions and a scientific reason.');
    if (oldKey === newKey) throw new ComponentDeliveryValidationError('correction-same-version', 'A correction needs exact distinct saved component versions and a scientific reason.');
    if (!correction.reason.trim()) throw new ComponentDeliveryValidationError('correction-reason', 'A correction needs exact distinct saved component versions and a scientific reason.');
    if (replaced.has(oldKey)) throw new ComponentDeliveryValidationError('duplicate-correction-source', 'A correction needs exact distinct saved component versions and a scientific reason.');
    if (selected.has(oldKey)) throw new ComponentDeliveryValidationError('superseded-selected', 'Deliver the corrected replacement, not its superseded draft.');
    const chain = new Set([oldKey]); let final = newKey;
    while (replacements.has(final)) {
      if (chain.has(final)) throw new ComponentDeliveryValidationError('correction-cycle', 'Correction replacements must not cycle.');
      chain.add(final); final = replacements.get(final)!;
    }
    if (!selected.has(final)) throw new ComponentDeliveryValidationError('final-replacement-unselected', 'Deliver the final corrected replacement, not an intermediate draft.');
    const [before, after] = await Promise.all([read(previous), read(replacement)]);
    if (before.content.trim() === after.content.trim()) throw new ComponentDeliveryValidationError('unchanged-correction-body', 'A scientific correction must be written into a revised proof body, not only its interface or CHECK ledger.');
    replaced.add(oldKey);
  }
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (replaced.has(key)) throw new ComponentDeliveryValidationError('superseded-dependency', 'A delivered component still depends on a superseded draft; correct the affected local proof first.');
    if (byKey.has(key) && !selected.has(key)) throw new ComponentDeliveryValidationError('missing-local-prerequisite', 'Explicitly deliver every local component used by the selected proof, including its prerequisite versions; omitted drafts cannot be accepted implicitly.');
    if (seen.has(key)) return;
    seen.add(key);
    for (const dependency of byKey.get(key)?.component?.dependencies ?? []) visit(chapterKey(dependency));
  };
  for (const key of selected) visit(key);
  return structuredClone(delivery);
}
