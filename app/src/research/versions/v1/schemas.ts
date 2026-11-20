import { ComponentIssueSchema } from '../../contracts/review.js';
import { CommandStatesSchema, PlanningSelectionSchema, RefinementKindSchema, planningSelectionIsCoherent } from '../../contracts/user-commands.js';
import { ForkManifestSchema } from '../../contracts/lineage.js';
import { StoredPresentationSchema } from '../../../presentation/session-presentation.js';
import { ChaptersSchema, ProofContextSchema, PathReportSchema, ComponentDeliverySchema } from '../../contracts/documents.js';
import { ValidationError } from '../../contracts/errors.js';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { BranchResult, FrontierCandidate, InFlightRound, LiteratureOutput, ModeratorOutput, PlanOutput, RecalledExperience, ResearchBrief, ResearchConfig, ResearchProject, ReviewOutput, SynthesisOutput, UserCommand, WorkerStep, WorkerStepOutput } from '../../contracts/v1.js';
import { RESEARCH_STAGES, WORKER_PROTOCOL } from '../../contracts/v1.js';
import { BoundaryViewSchema, ContinuationSchema, PlanningChangeSchema, ResearchReceiptSchema, ResourceRefSchema, ScientificReviewSchema, TagsSchema } from '../../contracts/review.js';
const text = Type.String({ minLength: 1, maxLength: 1000000 });
const short = Type.String({ minLength: 1, maxLength: 10000 });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' });
const strings = Type.Array(text, { maxItems: 1000 });
const object = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
const enumeration = <T extends string>(values: readonly T[]) => Type.Union(values.map((v) => Type.Literal(v)));
const mode = enumeration(['compatibility', 'contradiction', 'exploratory']);
const effort = enumeration(['shallow', 'deep']);
const status = enumeration(['completed', 'interrupted', 'failed']);
const conclusion = enumeration(['compatible', 'conditionally_compatible', 'contradictory', 'inconclusive']);
const scores = Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 4 }), { maxProperties: 32 });
const rationales = Type.Record(Type.String(), short, { maxProperties: 32 });
export const BudgetSchema = object({ maxTurns: Type.Integer({ minimum: 1, maximum: 1000 }), maxToolCalls: Type.Integer({ minimum: 0, maximum: 10000 }), timeoutMs: Type.Integer({ minimum: 1, maximum: 86400000 }), softDeadlineAt: Type.Optional(Type.Number({ minimum: 0 })), maxTokens: Type.Optional(Type.Integer({ minimum: 0 })), maxCostUsd: Type.Optional(Type.Number({ minimum: 0 })) });
const model = object({ provider: short, modelId: short, thinkingLevel: Type.Optional(enumeration(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])) });
export const ConfigSchema = object({ maxWorkers: Type.Integer({ minimum: 1, maximum: 32 }), maxRounds: Type.Integer({ minimum: 1, maximum: 1000 }), maxBranches: Type.Integer({ minimum: 1, maximum: 10000 }), moderatorEnabled: Type.Boolean(), literatureEnabled: Type.Boolean(), workerBudgets: object({ shallow: BudgetSchema, deep: BudgetSchema }), roleBudget: BudgetSchema, defaultModel: Type.Optional(model), roleModels: Type.Optional(object({ theorist: Type.Optional(model), worker: Type.Optional(model), moderator: Type.Optional(model), literature: Type.Optional(model) })) });
export const SourceSchema = object({ id: short, path: text, revision: short, fingerprint: Type.Optional(short), external: Type.Optional(Type.Boolean()) });
const citation = object({ sourceId: short, locator: short, quote: Type.Optional(text), verified: Type.Optional(Type.Boolean()) });
const evidence = object({ claim: text, citation, conditions: strings, conflicts: strings });
export const BriefSchema = object({promptRevision:Type.Optional(Type.Literal('categorized-v1')),componentIssues:Type.Optional(Type.Array(ComponentIssueSchema)),adoptedChapters:Type.Optional(ChaptersSchema),dependencyUse:Type.Optional(object({reuse:text,recheck:text})),proofContext:Type.Optional(ProofContextSchema),conventionVersion:Type.Optional(Type.String()), branchId: id, parentId: Type.Optional(id), rootHypothesisRevision: short, inputRevision: short, hypothesis: text, question: text, targetTheory: Type.Optional(short), mode, effort, assumptions: strings, frozenSourceRefs: Type.Array(SourceSchema), budget: BudgetSchema, wayId: Type.Optional(id), assignment: Type.Optional(text), skillRefs: Type.Optional(Type.Array(ResourceRefSchema)), continuation: Type.Optional(ContinuationSchema), decisionVersion: Type.Optional(Type.Integer({minimum:1})), workingHypothesis: Type.Optional(PlanningChangeSchema) });
const loopProvenance = object({ researchLoopVersion: short, workerProtocolVersion: short });
export const InFlightSchema = object({ promptRevision:Type.Optional(Type.Literal('categorized-v1')), planningSelection:Type.Optional(PlanningSelectionSchema), workerProgress:Type.Optional(Type.Record(Type.String(),Type.Array(object({step:enumeration(WORKER_PROTOCOL),notes:text})))), loop: Type.Optional(loopProvenance), projectId: id, round: Type.Integer({ minimum: 1 }), stage: enumeration(RESEARCH_STAGES), briefs: Type.Array(BriefSchema, { maxItems: 32 }), startedAt: short });
const candidateProperties = {dependencyChapters:Type.Optional(ChaptersSchema),dependencyUse:Type.Optional(object({reuse:text,recheck:text})),proofContext:Type.Optional(ProofContextSchema),conventionVersion:Type.Optional(Type.String()), id, parentId: id, question: text, targetTheory: Type.Optional(short), mode, effort, assumptions: strings, scores, rationales, dedupeKey: short, exceptionReason: Type.Optional(short), wayId: Type.Optional(id), assignment: Type.Optional(text), allocation: Type.Optional(enumeration(['dispatch','defer'])), skillRefs: Type.Optional(Type.Array(ResourceRefSchema)), continuation: Type.Optional(ContinuationSchema) };
export const CandidateSchema = object(candidateProperties);
export const PlanSchema = object({ presentation:Type.Optional(Type.Unknown()), researchTags:Type.Optional(TagsSchema), candidates: Type.Array(CandidateSchema, { maxItems: 100 }), rationale: text, planningChange: Type.Optional(PlanningChangeSchema) });
export const BranchResultSchema = object({componentDelivery:Type.Optional(ComponentDeliverySchema),chapters:Type.Optional(ChaptersSchema),pathReport:Type.Optional(PathReportSchema), branchId: id, executionStatus: status, conclusion: Type.Optional(conclusion), assumptions: strings, applicability: Type.String({ maxLength: 1000000 }), derivationRef: Type.Optional(short), derivationMarkdown: Type.Optional(text), citations: Type.Array(citation), strongestObjection: Type.Optional(text), unresolvedQuestions: strings, proposedFollowups: strings, verificationQuality: Type.Optional(text), errorSummary: Type.Optional(text), conflictingPropositions: Type.Optional(strings), derivationChain: Type.Optional(strings), protocol: Type.Optional(Type.Array(enumeration(WORKER_PROTOCOL))), evidenceWarnings: Type.Optional(strings), stepNotes: Type.Optional(Type.Array(object({step:enumeration(WORKER_PROTOCOL),notes:text}))) });
export const WorkerStepSchema = object({ step: enumeration(WORKER_PROTOCOL), notes: text, result: Type.Optional(BranchResultSchema) });
export const SynthesisSchema = object({ summary: text, disagreements: strings, unresolvedQuestions: strings, relatedNodes: Type.Optional(Type.Array(object({ from: id, to: id }))) });
const experienceProperties = { kind: enumeration(['routing', 'strategy', 'candidate_skill']), context: text, lesson: text, limitations: text };
const recalledText = Type.String({ minLength: 1, maxLength: 4000 });
const committedRevision = Type.String({ pattern: '^[0-9a-f]{40}$' });
export const RecalledExperienceSchema = object({
  sourceProjectId: id, sourceProjectName: short, sourceContentRevision: committedRevision, sourceHypothesisRevision: committedRevision,
  experience: object({ round: Type.Integer({ minimum: 1 }), kind: enumeration(['routing', 'strategy']), context: recalledText, lesson: recalledText, limitations: recalledText, status: Type.Literal('unreviewed') }),
});
export const RecalledExperiencesSchema = Type.Array(RecalledExperienceSchema, { maxItems: 5 });
export const ReviewSchema = object({ decision: enumeration(['continue', 'pause', 'complete']), reason: text, nextQuestions: strings, experiences: Type.Optional(Type.Array(object(experienceProperties))), researchReview: Type.Optional(ScientificReviewSchema) });
export const ModeratorSchema = object({ notes: strings, deferredBranchIds: Type.Optional(Type.Array(id)), weightProposal: Type.Optional(object({ weights: scores, reason: text, applicability: text })) });
export const LiteratureSchema = object({ evidence: Type.Array(evidence), limitations: strings });
export const CommandSchema = object({ id, projectId: id, kind: enumeration(['refine', 'pause', 'stop']), payload: Type.String({ maxLength: 100000 }), createdAt: short, requestId:Type.Optional(id), sequence:Type.Optional(Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER})), refinementKind:Type.Optional(RefinementKindSchema) });
export const ProjectSchema = object({commandStates:Type.Optional(CommandStatesSchema),userInputWarnings:Type.Optional(strings),fork:Type.Optional(ForkManifestSchema),
  schemaVersion: Type.Literal(1), researchLoopVersion: Type.Literal('1.0'), workerProtocolVersion: Type.Literal('1.0'), id, name:short,nameSource:Type.Optional(Type.Union([Type.Literal('user'),Type.Literal('theorist')])),presentation:Type.Optional(StoredPresentationSchema), hypothesis: text, hypothesisRevision: short, contentRevision: short,
  sources: Type.Array(SourceSchema), startedAt: Type.Optional(short), config: ConfigSchema, status: enumeration(['idle', 'running', 'paused', 'completed', 'stopped', 'failed']), stage: enumeration(RESEARCH_STAGES), round: Type.Integer({ minimum: 0 }),
  frontier: Type.Array(object({ ...candidateProperties, priority: Type.Number(), state: enumeration(['pending', 'active', 'completed', 'deferred']), hypothesisRevision: short })),
  graph: Type.Array(object({ id, parentId: Type.Optional(id), hypothesisRevision: short, question: text, targetTheory: Type.Optional(short), mode: Type.Optional(mode), effort: Type.Optional(effort), status: enumeration(['pending', 'active', 'compatible', 'conditionally_compatible', 'contradictory', 'inconclusive', 'needs_review', 'interrupted', 'failed']), executionStatus: Type.Optional(status), conclusion: Type.Optional(conclusion), priority: Type.Optional(Type.Number()), resultPath: Type.Optional(short), relatedNodeIds: Type.Optional(Type.Array(id)) })),
  results: Type.Array(BranchResultSchema), summary: Type.String(), policies: Type.Array(object({ weights: scores, version: Type.Integer({ minimum: 1 }), effectiveFromRound: Type.Integer({ minimum: 1 }), changeReason: Type.Optional(text), changedBy: Type.Optional(Type.Literal('moderator')), applicability: Type.Optional(text), boundary: Type.Optional(BoundaryViewSchema) })),
  rounds: Type.Array(object({ promptRevision:Type.Optional(Type.Literal('categorized-v1')), loop: Type.Optional(loopProvenance), number: Type.Integer({ minimum: 1 }), id, hypothesisRevision: short, inputRevision: short, stages: Type.Array(enumeration(RESEARCH_STAGES)), branchIds: Type.Array(id), decision: Type.Optional(enumeration(['continue', 'refine', 'pause', 'complete', 'stop'])), reason: Type.Optional(text), summary: Type.String(), userVisible: Type.Boolean(), completedAt: Type.Optional(short), research: Type.Optional(ResearchReceiptSchema), decisionContext: Type.Optional(object({ review: ReviewSchema, failed: Type.Boolean(), control: object({ stop: Type.Boolean(), pause: Type.Boolean(), refine: Type.Boolean() }) })) })),
  processedCommandIds: Type.Array(id), refinements: Type.Array(text), experiences: Type.Array(object({ ...experienceProperties, round: Type.Integer({ minimum: 1 }), status: Type.Literal('unreviewed') })), evidence: Type.Array(evidence), lastError: Type.Optional(text),
  loopSelections: Type.Optional(Type.Array(object({ from: short, to: short, at: short, previousRevision: short, afterRound: Type.Integer({ minimum: 0 }) }))),
  hypothesisId: Type.Optional(short), previousHypothesisId: Type.Optional(short), targetKey: Type.Optional(short), workingHypothesis: Type.Optional(PlanningChangeSchema), researchTags: Type.Optional(TagsSchema), plannedRefinementCount: Type.Optional(Type.Integer({minimum:0})), pendingModificationIds: Type.Optional(Type.Array(text)),
});
export { ValidationError } from '../../contracts/errors.js';
export function validate<T>(schema: TSchema, value: unknown, label: string): T { if (!Value.Check(schema, value)) throw new ValidationError(label); return structuredClone(value) as T; }
export function parseConfig(v: unknown): ResearchConfig { const config = validate<ResearchConfig>(ConfigSchema, v, 'research configuration'); if (config.workerBudgets.shallow.maxTurns < 6 || config.workerBudgets.deep.maxTurns < 6) throw new ValidationError('six-step Worker turn budget'); return config; }
export const parseProject = (v: unknown) => validate<ResearchProject>(ProjectSchema, v, 'project schema v1');
export function parseInFlight(v: unknown): InFlightRound { const record = validate<InFlightRound>(InFlightSchema, v, 'in-flight recovery record'); if (record.planningSelection && !planningSelectionIsCoherent(record.planningSelection)) throw new ValidationError('in-flight planning selection'); return record; }
export const parseBrief = (v: unknown) => validate<ResearchBrief>(BriefSchema, v, 'research brief');
export function parseCommand(v: unknown): UserCommand { const command = validate<UserCommand>(CommandSchema, v, 'user command'); if (!Number.isFinite(Date.parse(command.createdAt)) || (command.kind === 'refine' && !command.payload.trim()) || (command.kind !== 'refine' && command.refinementKind !== undefined)) throw new ValidationError('user command timestamp or refinement'); return command; }
export const parseCandidate = (v: unknown) => validate<FrontierCandidate>(CandidateSchema, v, 'frontier candidate');
export const parsePlan = (v: unknown) => validate<PlanOutput>(PlanSchema, v, 'Theorist plan');
export const parseSynthesis = (v: unknown) => validate<SynthesisOutput>(SynthesisSchema, v, 'Theorist synthesis');
export function parseRecalledExperiences(value: unknown, currentProjectId: string): RecalledExperience[] {
  const records = validate<RecalledExperience[]>(RecalledExperiencesSchema, value, 'bounded unreviewed experience recall');
  if (records.some((record) => record.sourceProjectId === currentProjectId)) throw new ValidationError('cross-project experience provenance');
  return records.filter((record, index) => records.findIndex((other) => JSON.stringify(other) === JSON.stringify(record)) === index);
}
export const parseReview = (v: unknown) => validate<ReviewOutput>(ReviewSchema, v, 'Theorist review');
export const parseModerator = (v: unknown) => validate<ModeratorOutput>(ModeratorSchema, v, 'Moderator response');
export const parseLiterature = (v: unknown) => validate<LiteratureOutput>(LiteratureSchema, v, 'Literature response');
export function parseWorkerStep(value: unknown, step: WorkerStep): WorkerStepOutput {
  const output = validate<WorkerStepOutput>(WorkerStepSchema, value, `Worker ${step}`);
  if (output.step !== step || (step === 'RETURN' && !output.result) || (step !== 'RETURN' && output.result)) throw new ValidationError(`Worker protocol ${step}`);
  return output;
}
export function parseBranchResult(value: unknown, brief: ResearchBrief): BranchResult {
  const result = validate<BranchResult>(BranchResultSchema, value, 'branch result');
  if (result.branchId !== brief.branchId) throw new ValidationError('branch identity');
  result.assumptions = [...new Set([...brief.assumptions, ...result.assumptions])];
  if (result.executionStatus !== 'completed') {
    if (result.conclusion || !result.errorSummary) throw new ValidationError('execution failure semantics');
    return result;
  }
  if (!result.conclusion || !result.applicability.trim() || (!result.derivationMarkdown?.trim()&&!(result.chapters?.some(ref=>ref.complete)&&result.pathReport?.keySteps.length)) || !result.verificationQuality || !result.strongestObjection) throw new ValidationError('completed scientific result');
  if (result.conclusion === 'conditionally_compatible' && result.assumptions.length === 0) throw new ValidationError('compatibility conditions');
  if (result.conclusion === 'contradictory' && (!result.assumptions.length || (result.conflictingPropositions?.length ?? 0) < 2 || (result.derivationChain?.length ?? 0) < 2)) throw new ValidationError('contradiction premises and derivation');
  // A model cannot self-certify evidence. Authorized source membership is not proof of a quotation.
  result.citations = result.citations.map((item) => ({ ...item, verified: false }));
  result.evidenceWarnings = result.citations.length ? result.citations.map((item) => brief.frozenSourceRefs.some((source) => source.id === item.sourceId) ? `Citation ${item.sourceId} at ${item.locator} requires source-level review.` : `Unverified citation: ${item.sourceId} is outside the frozen authorized source set.`) : ['No external citations supplied; assess the derivation and its assumptions directly.'];
  if (result.derivationMarkdown !== undefined) result.derivationRef = `branches/${brief.branchId}.md`;
  else delete result.derivationRef;
  return result;
}
