import type { ChapterRef } from '../research/contracts/documents.js';
import { chapterKey } from '../research/proof-components.js';

/** Only after exact grant hydration and scientific checks; this function grants nothing.
 * Evidence is a set, while manuscript chapter ordering (and repetition) stays explicit.
 */
export function uniqueProofEvidence(refs: readonly ChapterRef[]): ChapterRef[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = chapterKey(ref);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(ref => structuredClone(ref));
}
