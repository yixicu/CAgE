import type { RawAnswerRefV0 } from './v0.js';
import { Type } from 'typebox';
import type { RawAnswerRefV21 } from './v21.js';
import type { SourceRevisionRef } from './v1.js';
import type { ChapterRef } from './documents.js';
import { ChapterRefSchema } from './documents.js';
import type { EndedAttempt } from './review.js';
import type { ProofRef } from '../../learning/research-data.js';

export interface ForkOrigin { sessionId: string; revision: string; checkpointId: string; number: number; loopVersion: '0' | '1.0' | '2.0' | '2.1' }
export interface ForkAttempt { id: string; ownerSessionId: string; revision: string; originalId: string; version: string }
export interface ForkSource { alias: SourceRevisionRef; ownerSessionId: string; original: SourceRevisionRef; backing: 'note' | 'import' | 'frozen' }
/** Host-created immutable grants. References only; no inherited bodies are persisted. */
export interface ForkManifest {
  version: 1 | 2 | 3; v0RawAnswers?: RawAnswerRefV0[]; rawAnswers?: RawAnswerRefV21[]; id: string; operationId: string; parent: ForkOrigin; origins: ForkOrigin[];
  attempts: ForkAttempt[]; chapters: ChapterRef[]; proofs: ProofRef[]; sources: ForkSource[];
}
export interface InheritedOutput { sessionId: string; id: string; number: number; label: string; content: string; time: string; hypothesis?: string }
/** Transient host-resolved public context. Never persist into a checkpoint or model-owned result. */
export interface InheritedResearchView {
  manifestId: string; v0RawAnswers?: RawAnswerRefV0[]; rawAnswers?: RawAnswerRefV21[]; limitations: string[]; attemptOrigins: Record<string, { sessionId: string; attemptId: string }>; attempts: EndedAttempt[]; chapters: ChapterRef[]; proofs: ProofRef[]; sources: SourceRevisionRef[];
  context: { userDomainPreferences?: Record<string, number>; hypothesis: string; summary: string; graph: unknown[]; refinements: string[]; outputs: InheritedOutput[] };
}
const text = Type.String({ minLength: 1, maxLength: 1024 });
const id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' });
const revision = Type.String({ pattern: '^[0-9a-f]{40}$' });
const hash = Type.String({ pattern: '^[0-9a-f]{64}$' });
const obj = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
const source = obj({ id: text, path: text, revision: text, fingerprint: Type.Optional(text), external: Type.Optional(Type.Boolean()) });
const origin = obj({ sessionId: id, revision, checkpointId: id, number: Type.Integer({ minimum: 1 }), loopVersion: Type.Union([Type.Literal('1.0'), Type.Literal('2.0')]) });
const proof = obj({ sessionId: text, caseId: text, hypothesisId: text, hypothesisRevision: text, revision: Type.Integer({ minimum: 1 }), semanticRevision: Type.Integer({ minimum: 1 }), contentHash: text });
export const ForkManifestSchema = obj({ version: Type.Literal(1), id: hash, operationId: id, parent: origin,
  origins: Type.Array(origin, { minItems: 1, maxItems: 32 }),
  attempts: Type.Array(obj({ id, ownerSessionId: id, revision, originalId: text, version: text }), { maxItems: 4096 }),
  chapters: Type.Array(ChapterRefSchema, { maxItems: 8192 }), proofs: Type.Array(proof, { maxItems: 1024 }),
  sources: Type.Array(obj({ alias: source, ownerSessionId: id, original: source, backing: Type.Union([Type.Literal('note'), Type.Literal('import'), Type.Literal('frozen')]) }), { maxItems: 2048 }),
});
/** New manifest variant; the legacy schema above deliberately stays byte-for-byte scoped. */
const rawOwner = { owner:text, projectId:text, epochId:text, wayId:text, questionId:text, questionRevision:text,
  attemptId:text, callId:text, hypothesisId:text, hypothesisRevision:text, inputHash:text, scientificInputHash:text,
  workerProtocolVersion:Type.Literal('2.1') };
const rawRef = obj({...rawOwner,id:Type.String({pattern:'^raw_[0-9a-f]{64}$'}),bodyHash:hash,byteLength:Type.Integer({minimum:0}),completeness:Type.Union([Type.Literal('complete'),Type.Literal('partial'),Type.Literal('empty')])});
const originV21=obj({sessionId:id,revision,checkpointId:id,number:Type.Integer({minimum:1}),loopVersion:Type.Literal('2.1')});
export const ForkManifestV21Schema=obj({version:Type.Literal(2),id:hash,operationId:id,parent:originV21,origins:Type.Array(originV21,{minItems:1,maxItems:32}),
 attempts:Type.Array(Type.Never(),{maxItems:0}),chapters:Type.Array(Type.Never(),{maxItems:0}),proofs:Type.Array(proof,{maxItems:1024}),
 rawAnswers:Type.Array(rawRef,{maxItems:8192}),sources:Type.Array(obj({alias:source,ownerSessionId:id,original:source,backing:Type.Union([Type.Literal('note'),Type.Literal('import'),Type.Literal('frozen')])}),{maxItems:2048})});

const rawV0Ref=obj({owner:text,projectId:text,epochId:text,attemptId:text,callId:text,rootId:text,rootRevision:text,planHash:hash,routeId:text,inputHash:hash,protocolVersion:Type.Literal('v0-native-1'),id:Type.String({pattern:'^raw0_[0-9a-f]{64}$'}),bodyHash:hash,byteLength:Type.Integer({minimum:0}),completeness:Type.Union([Type.Literal('complete'),Type.Literal('partial'),Type.Literal('empty')])});
const originV0=obj({sessionId:id,revision,checkpointId:id,number:Type.Integer({minimum:1}),loopVersion:Type.Literal('0')});
export const ForkManifestV0Schema=obj({version:Type.Literal(3),id:hash,operationId:id,parent:originV0,origins:Type.Array(originV0,{minItems:1,maxItems:32}),attempts:Type.Array(Type.Never(),{maxItems:0}),chapters:Type.Array(Type.Never(),{maxItems:0}),proofs:Type.Array(proof,{maxItems:1024}),v0RawAnswers:Type.Array(rawV0Ref,{maxItems:8192}),sources:Type.Array(obj({alias:source,ownerSessionId:id,original:source,backing:Type.Union([Type.Literal('note'),Type.Literal('import'),Type.Literal('frozen')])}),{maxItems:2048})});
