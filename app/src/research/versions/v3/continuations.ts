import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AnswerDeliveryV21, RawAnswerRefV21 } from '../../contracts/v21.js';
import type { OptionalProofArtifactV21 } from '../v21/optional-types.js';

const hash = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const complete = (a: OptionalProofArtifactV21): boolean => a.technical.executionStatus === 'completed'
  && a.technical.completeness === 'complete' && a.originalRef.completeness === 'complete'
  && Number.isSafeInteger(a.originalRef.byteLength) && a.originalRef.byteLength > 0;

/** A delivered own draft is manuscript lineage, never a positively established lemma. */
export function isOwnContinuationV3(current: OptionalProofArtifactV21, prior: OptionalProofArtifactV21): boolean {
  const a = current.originalRef, b = prior.originalRef;
  return ['v3-operation-5','v3-operation-6','v4-proof-3','v4-proof-4','v4-proof-5'].includes(current.operationRevision??'') && prior.operationRevision === current.operationRevision
    && current.authorRole === 'theorist' && prior.authorRole === 'theorist' && current.id !== prior.id
    && a.id !== b.id && a.callId !== b.callId && isDeepStrictEqual(current.root, prior.root)
    && a.owner === b.owner && a.projectId === b.projectId && a.owner === a.projectId
    && a.hypothesisId === current.root.hypothesisId && a.hypothesisRevision === current.root.revision
    && b.hypothesisId === current.root.hypothesisId && b.hypothesisRevision === current.root.revision
    && complete(prior) && ['unreviewed', 'deferred'].includes(prior.qualification)
    && prior.control.outcome.resultKind === 'open' && (!prior.acceptedOutcome || prior.acceptedOutcome.resultKind === 'open')
    && current.exposureArtifactIds.includes(prior.id)
    && !!current.originalExposureRefs?.some(ref => isDeepStrictEqual(ref, b));
}

/** Preserve the model's declared order and IDs; classify only exact available host artifacts. */
export function classifyContinuationsV3(current: OptionalProofArtifactV21, all: readonly OptionalProofArtifactV21[]): string[] {
  return current.control.outcome.dependencyArtifactIds.filter(id => {
    const prior = all.find(a => a.id === id);
    return !!prior && isOwnContinuationV3(current, prior);
  });
}

/** Only exact, actually delivered, fully reconstructed UTF-8 originals establish continuity exposure. */
export function fullOriginalRefsV3(deliveries: readonly AnswerDeliveryV21[], artifacts: readonly OptionalProofArtifactV21[]): RawAnswerRefV21[] {
  const refs: RawAnswerRefV21[] = [];
  for (const artifact of artifacts) {
    if (!complete(artifact) || refs.some(ref => isDeepStrictEqual(ref, artifact.originalRef))) continue;
    const ref = artifact.originalRef;
    const chunks = deliveries.filter(d => isDeepStrictEqual(d.answerRef, ref)).map(delivery => {
      const { startByte: start, endByte: end, body } = delivery;
      if (typeof body !== 'string') throw new Error('Invalid original delivery body.');
      const bytes = Buffer.from(body, 'utf8');
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start
        || end > ref.byteLength || bytes.length !== end - start || bytes.toString('utf8') !== body
        || hash(bytes) !== delivery.excerptHash) throw new Error('Invalid original delivery range or hash.');
      return { start, end, bytes };
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    let covered = 0;
    for (const chunk of chunks) { if (chunk.start > covered) break; covered = Math.max(covered, chunk.end); }
    if (covered !== ref.byteLength) continue;
    const original = Buffer.alloc(ref.byteLength);
    let written = 0;
    for (const chunk of chunks) {
      const overlap = Math.max(0, Math.min(written, chunk.end) - chunk.start);
      if (!original.subarray(chunk.start, chunk.start + overlap).equals(chunk.bytes.subarray(0, overlap))) {
        throw new Error('Conflicting original delivery bytes.');
      }
      chunk.bytes.copy(original, chunk.start); written = Math.max(written, chunk.end);
    }
    if (hash(original) !== ref.bodyHash) throw new Error('Original delivery whole-body hash mismatch.');
    refs.push(structuredClone(ref));
  }
  return refs;
}
