import { Type } from 'typebox';
import { ChapterRefSchema, type ChapterRef } from '../research/contracts/documents.js';
import { stableHash } from '../learning/research-hash.js';

// Metadata belongs to the immutable host record, not a model transcription.
export const ChapterSelectionSchema = Type.Object({ ...ChapterRefSchema.properties,
  title: Type.Optional(ChapterRefSchema.properties.title),
  summary: Type.Optional(ChapterRefSchema.properties.summary),
  complete: Type.Optional(ChapterRefSchema.properties.complete),
}, { additionalProperties: false });
const identity = ['sessionId', 'attemptId', 'chapterId', 'hypothesisRevision', 'conventionVersion', 'contentHash'] as const;

/** Resolve only inside this invocation's authorized set; never search storage. */
export function selectGrantedChapter(value: unknown, grants: readonly ChapterRef[]): ChapterRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const selected = value as Record<string, unknown>;
  const matches = grants.filter(ref => identity.every(key => typeof selected[key] === 'string' && selected[key] === ref[key]));
  if (!matches.length || matches.some(ref => stableHash(ref) !== stableHash(matches[0]))) return undefined;
  return structuredClone(matches[0]);
}
