import { Type, type Static, type TSchema } from 'typebox';
import type { ResearchProject } from '../research/contracts/v1.js';

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$' });
const text = Type.String({ minLength: 1, maxLength: 4000 });
// Preserve a valid V1 REVIEW reason without truncating scientific qualifications.
const reason = Type.String({ minLength: 1, maxLength: 1000000 });
const revision = Type.String({ pattern: '^[0-9a-f]{40}$' });
const hash = Type.String({ pattern: '^[0-9a-f]{64}$' });
export const ContentSchema = object({ context: text, lesson: text, limitations: text });
const SourceSchema = object({ projectId: id, contentRevision: revision, experienceIndex: Type.Integer({ minimum: 0 }) });
const CaseSchema = object({ projectId: id, contentRevision: revision, round: Type.Integer({ minimum: 1 }), assessment: text, assessedBy: Type.Union([Type.Literal('user'), Type.Literal('test_operator')]) });
const ScopeSchema = object({ terms: Type.Array(Type.String({ minLength: 3, maxLength: 80 }), { minItems: 1, maxItems: 8, uniqueItems: true }) });
export const ReviewInputSchema = object({ id, expectedRevision: hash, candidate: SourceSchema, cases: Type.Array(CaseSchema, { minItems: 2, maxItems: 8 }), scope: ScopeSchema });
export const VerdictSchema = object({ approved: Type.Boolean(), reason, limitations: Type.Array(text, { minItems: 1, maxItems: 8 }) });
const EvidenceSchema = object({ ...CaseSchema.properties, hypothesisRevision: revision, branchIds: Type.Array(id, { minItems: 1 }), roundSummaryHash: hash });
const SkillSchema = object({ id, version: hash, content: ContentSchema, scope: ScopeSchema, source: SourceSchema, sourceRound: Type.Integer({ minimum: 1 }), evidence: Type.Array(EvidenceSchema, { minItems: 2, maxItems: 8 }), review: object({ id, at: text, owner: Type.Literal('theorist'), reason, limitations: Type.Array(text, { minItems: 1, maxItems: 8 }) }), enabled: Type.Boolean() });
const OperationSchema = object({ id, inputDigest: hash, candidate: SourceSchema, cases: Type.Array(CaseSchema, { minItems: 2, maxItems: 8 }), scope: ScopeSchema, status: Type.Union([Type.Literal('pending'), Type.Literal('approved'), Type.Literal('rejected'), Type.Literal('failed')]), createdAt: text, finishedAt: Type.Optional(text), reason, skillId: Type.Optional(id) });
export const StateSchema = object({ schemaVersion: Type.Literal(1), revision: hash, skills: Type.Array(SkillSchema), operations: Type.Array(OperationSchema) });

export type V1SkillSource = Static<typeof SourceSchema>;
export type V1SkillCase = Static<typeof CaseSchema>;
export type V1SkillReviewInput = Static<typeof ReviewInputSchema>;
export type V1SkillVerdict = Static<typeof VerdictSchema>;
export type ReviewedV1Skill = Static<typeof SkillSchema>;
export type V1SkillOperation = Static<typeof OperationSchema>;
export type V1SkillState = Static<typeof StateSchema>;
export interface V1SkillCandidate { source: V1SkillSource; round: number; hypothesisRevision: string; content: Static<typeof ContentSchema> }
export interface V1SkillEvidence extends Static<typeof EvidenceSchema> { hypothesis: string; summary: string; results: { branchId: string; conclusion: string; assumptions: string[]; applicability: string; derivation: string; verificationQuality: string }[] }
export interface V1SkillReviewContext { project: ResearchProject; candidate: V1SkillCandidate; scope: V1SkillReviewInput['scope']; cases: V1SkillEvidence[] }
export interface V1SkillReader {
  loadProject(projectId: string): Promise<unknown>;
  readRevision(projectId: string, revision: string, filename: string): Promise<Uint8Array>;
}
/** The caller deliberately invokes the existing Pi Theorist; this service never dispatches a model. */
export type V1SkillReviewer = (context: V1SkillReviewContext) => Promise<V1SkillVerdict>;
export interface V1SkillResource {
  kind: 'reviewed_v1_skill'; id: string; version: string;
  content: ReviewedV1Skill['content']; scope: ReviewedV1Skill['scope']; review: ReviewedV1Skill['review'];
  sources: { projectId: string; contentRevision: string; hypothesisRevision: string; round: number }[];
}
