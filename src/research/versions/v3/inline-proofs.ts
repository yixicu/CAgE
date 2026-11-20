import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { RawAnswerRefV21, RootV21 } from '../../contracts/v21.js';
import type { OptionalProofArtifactV21 } from '../v21/optional-types.js';

export interface InlineProofsInputV3 {
  artifacts: readonly OptionalProofArtifactV21[];
  cards: readonly Record<string, unknown>[];
  reviewedArtifactIds: readonly string[];
  projectId: string;
  root: RootV21;
  readOriginal: (ref: RawAnswerRefV21) => Promise<string>;
  maxBytes?: number;
  pendingReviewOnly?: boolean;
}
export interface InlineProofsResultV3 {
  cards: Record<string, unknown>[];
  bytes: number;
  maxBytes: number;
  omittedRefs: string[];
}

function complete(artifact: OptionalProofArtifactV21): boolean {
  return artifact.technical.executionStatus === 'completed' && artifact.technical.completeness === 'complete'
    && artifact.originalRef.completeness === 'complete' && Number.isSafeInteger(artifact.originalRef.byteLength)
    && artifact.originalRef.byteLength > 0;
}

/** Prepare exact context only. The runtime owns exposure grants after actual dispatch. */
export async function inlineProofsV3(input: InlineProofsInputV3): Promise<InlineProofsResultV3> {
  const maxBytes = input.maxBytes ?? 32768;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid inline original byte budget.');
  const root = structuredClone(input.root), projectId = input.projectId;
  const artifacts = new Map<string, OptionalProofArtifactV21>(), cards = new Map<string, Record<string, unknown>>();
  for (const artifact of structuredClone(input.artifacts)) {
    const previous = artifacts.get(artifact.id);
    if (previous && !isDeepStrictEqual(previous, artifact)) throw new Error('Conflicting duplicate artifact identity.');
    if (!previous) artifacts.set(artifact.id, artifact);
  }
  for (const card of structuredClone(input.cards)) {
    if (typeof card.id !== 'string' || !card.id) throw new Error('Artifact metadata card requires an exact identity.');
    const previous = cards.get(card.id);
    if (previous && !isDeepStrictEqual(previous, card)) throw new Error('Conflicting duplicate metadata card.');
    if (!previous) cards.set(card.id, card);
  }
  // Supplied metadata cannot smuggle an old or unvalidated inline original into this result.
  for (const card of cards.values()) {
    delete card.body; delete card.inlineProofPurpose; delete card.originalOmitted;
  }
  const all = [...artifacts.values()], reviewed = new Set(input.reviewedArtifactIds);
  const workers = all.filter(artifact => artifact.authorRole === 'auxiliary-worker' || artifact.authorRole === 'way-worker');
  const own = all.filter(artifact => artifact.authorRole === 'theorist' && complete(artifact))
    .reduce<OptionalProofArtifactV21 | undefined>((latest, artifact) => !latest || Date.parse(artifact.createdAt) >= Date.parse(latest.createdAt) ? artifact : latest, undefined);
  const pending = workers.filter(artifact => !reviewed.has(artifact.id));
  const latest = own ? [own] : [];
  const candidates = input.pendingReviewOnly ? [...latest, ...pending]
    : [...pending, ...latest, ...workers.filter(artifact => reviewed.has(artifact.id))];
  const omittedRefs: string[] = [];
  let bytes = 0;
  for (const artifact of candidates) {
    const card = cards.get(artifact.id), ref = artifact.originalRef;
    const omit = (reason: string): void => { omittedRefs.push(artifact.id); if (card) card.originalOmitted = reason; };
    if (!card) { omit('Original omitted because its metadata card is absent.'); continue; }
    if (!complete(artifact)) { omit('Original is not technically complete or is empty.'); continue; }
    if (ref.projectId !== projectId || ref.owner !== projectId || ref.hypothesisId !== root.hypothesisId
      || ref.hypothesisRevision !== root.revision || !isDeepStrictEqual(artifact.root, root)) {
      throw new Error('Inline original scope does not match the exact project and current root.');
    }
    if (!isDeepStrictEqual(card.originalRef, ref)) throw new Error('Metadata original reference does not match the exact artifact.');
    if (ref.byteLength > maxBytes - bytes) { omit('Whole original omitted by the inline byte budget; read its exact originalRef.'); continue; }
    const body = await input.readOriginal(structuredClone(ref));
    if (typeof body !== 'string') throw new Error('Raw answer integrity mismatch: original body is not text.');
    const raw = Buffer.from(body, 'utf8');
    if (raw.toString('utf8') !== body || raw.length !== ref.byteLength || createHash('sha256').update(raw).digest('hex') !== ref.bodyHash) {
      throw new Error('Raw answer integrity mismatch: exact UTF-8 bytes or hash changed.');
    }
    card.body = body;
    card.inlineProofPurpose = artifact.authorRole === 'theorist' ? 'own-continuity' : 'worker-review';
    bytes += raw.length;
  }
  return { cards: [...cards.values()], bytes, maxBytes, omittedRefs };
}
