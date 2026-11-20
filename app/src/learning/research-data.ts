import { usesV3Proof } from '../research/versions/v3/proof-version.js';
import type {CapacityReservationV3} from './capacity-reservation.js';
import type { RawAnswerRefV0 } from '../research/contracts/v0.js';
import type { RawAnswerRefV21 } from '../research/contracts/v21.js';
import type { ChapterRef } from '../research/contracts/documents.js';
import type { OptionalAuthorV21, OptionalOutcomeV21, OptionalRouteV21 } from '../research/versions/v21/optional-types.js';
import type { RootV21 } from '../research/contracts/v21.js';

export type LoopVersion = 1 | 2;
export type SourceLoopVersion = '0' | '1.0' | '2.0' | '2.1' | '3.0' | '4.0';
/** Ownership family is not the on-disk project schema or precise execution version. */
export function learningFamily(version: SourceLoopVersion): LoopVersion {
  if (version === '1.0') return 1;
  if (version === '0' || version === '2.0' || version === '2.1' || usesV3Proof(version)) return 2;
  throw new Error('Unsupported research execution version.');
}
export type ReviewPurpose = 'v1-decision' | 'v2-strategy';
export type LearningActor = { role: 'theorist'; sessionId: string } | { role: 'moderator'; purpose: ReviewPurpose; operationId: string };
export interface ResourceRef { id: string; version: number }
export interface ProofRef {
  sessionId: string; caseId: string; hypothesisId: string; hypothesisRevision: string;
  revision: number; semanticRevision: number; contentHash: string;
}
export interface FailureRef { kind: 'failure'; id: string; sessionId: string; attemptId: string; version: number }
export type LearningSource = ProofRef | FailureRef;
/** A proof's real author is independent from the storage protocol for its exact bytes. */
export interface TheoryProofSupportV4 {
  sources: {projectId:string;artifactId:string}[];
  proofRefs: ProofRef[];
}
export interface OptionalProofProvenance {
  resultContract?: 'scoped-refutation-v1';
  modelDirectedKnowledge?:true;
  mapKnowledge?:import('./knowledge-map.js').MapOpenResult[];
  v4TheorySupport?:TheoryProofSupportV4;
  publicStage?:import('../research/versions/v4/fragments.js').PublicStageV4;
  fragmentExposureRefs?:string[];
  v3KnowledgeSources?: ProofRef[];
  operationRevision?: 'v21-operation-8' | 'v21-operation-9' | 'v3-operation-1' | 'v3-operation-2' | 'v3-operation-3' | 'v3-operation-4' | 'v3-operation-5' | 'v3-operation-6' | 'v4-proof-2' | 'v4-proof-3' | 'v4-proof-4' | 'v4-proof-5';
  conditionsRole?: 'host-root-context';
  learningEligibility?: 'eligible' | 'metadata-incomplete';
  artifactId: string; caseGroupId: string; evidenceKey: string; artifactEvidenceKey: string; evidenceRevision: number;
  authorRole: OptionalAuthorV21; originalRef: RawAnswerRefV21; root: RootV21; route: OptionalRouteV21;
  exposureArtifactIds: string[]; acceptedOutcome: OptionalOutcomeV21; adoptionReason?: string;
  originalExposureRefs?: RawAnswerRefV21[]; continuationArtifactIds?: string[];
  dependencies: ({ mapKnowledge?:import('./knowledge-map.js').MapOpenResult[]; artifactId: string; evidenceKey: string; authorRole: OptionalAuthorV21; originalRef: RawAnswerRefV21;
    publicStage?:import('../research/versions/v4/fragments.js').PublicStageV4;fragmentExposureRefs?:string[];
    exposureArtifactIds: string[]; originalExposureRefs?: RawAnswerRefV21[]; continuationArtifactIds?: string[];
  } & ({kind?:'positive-premise'|'refutation-evidence';acceptedOutcome:OptionalOutcomeV21}|{kind:'continuation'|'fragment';originalOutcome:OptionalOutcomeV21;acceptedOutcome?:never}))[];
}
/** Qualified final-route metadata only. This does not grant access to failed exploration. */
export interface OptionalCaseOutcomeSummary {
  caseGroupId: string; evidenceKeys: string[];
  routes: { artifactId: string; authorRole: OptionalAuthorV21; methodKey: string; routeReason: string;
    resultKind: Exclude<OptionalOutcomeV21['resultKind'],'open'>; refutation?: ArchivedRefutation; conditions: string[]; conditionsRole?: 'host-root-context'; exposureArtifactIds: string[];
    dependencyArtifactIds: string[]; proofRef: ProofRef }[];
}
export interface OptionalDecisionEvidence { sessionId: string; artifacts: Record<string, string> }
export interface DecisionSupport {
  version: number; parentVersion?: number; status: 'valid' | 'needs_review' | 'neutral-reset';
  proofRefs: ProofRef[]; rawEvidence?: { sessionId: string; judgments: Record<string, string> };
  optionalEvidence?: OptionalDecisionEvidence; reason?: string;
}
export interface ProofInput {
  sessionId: string; hypothesisId: string; hypothesisRevision: string; targetKey: string; target: string;
  methodKey: string; conditions: string[]; tags: string[]; summary: string; proof: string;
  rootClosed: boolean; reproducible: boolean; semanticChange: boolean;
  logicalRelation: 'direct' | 'equivalent' | 'sufficient' | 'counterexample' | 'contradiction' | 'empirical-exclusion' | 'necessary_only'; linkReason: string;
  sourceLoopVersion?: SourceLoopVersion; v0OriginalAnswers?: RawAnswerRefV0[]; originalAnswers?: RawAnswerRefV21[]; archiveOperationId?: string;
  sourceRefs?: string[]; evidenceChapters?: ChapterRef[]; previousHypothesisId?: string;
  optionalProof?: OptionalProofProvenance;
  optionalOriginalBodies?: Record<string, string>;
}
export interface ProofRecord extends ProofRef {
  proofNumber: number; targetKey: string; target: string; methodKey: string; conditions: string[]; tags: string[];
  sourceLoopVersion?: SourceLoopVersion; v0OriginalAnswers?: RawAnswerRefV0[]; originalAnswers?: RawAnswerRefV21[]; archiveOperationId?: string;
  optionalProof?: OptionalProofProvenance;
  sourceRefs: string[]; evidenceChapters?: ChapterRef[]; previousHypothesisId?: string; status: 'valid' | 'revoked' | 'needs_review';
  logicalRelation: ProofInput['logicalRelation']; linkReason: string;
  createdBy?: LearningActor; updatedBy?: LearningActor;
  createdAt: string; updatedAt: string;
}
export interface ProofDocument { meta: ProofRecord; summary: string; proof: string;
  originals?: { artifactId: string; authorRole: OptionalAuthorV21; originalRef: RawAnswerRefV21; body: string; provenanceKind?:'final-proof'|'positive-premise'|'continuation'|'refutation-evidence' }[] }

export interface ArchivedRefutation {
  relation: 'empirical-exclusion'|'contradiction'|'counterexample';
  status: ProofRecord['status'];
  reason: string;
  observations: {ref:import('./knowledge-map.js').MapRef; selection:string; measurement:import('./map-observation.js').MapObservation}[];
}

export function archivedRefutation(proof:ProofRecord):ArchivedRefutation|undefined {
  const provenance=proof.optionalProof, relation=proof.logicalRelation;
  if(provenance?.resultContract!=='scoped-refutation-v1'||(relation!=='empirical-exclusion'&&relation!=='contradiction'&&relation!=='counterexample'))return;
  const outcome=provenance.acceptedOutcome;
  const observations=(provenance.mapKnowledge??[]).flatMap(read=>read.kind==='observation'&&read.ref&&read.observation&&outcome.knowledgeRefs?.includes(read.selection)
    ?[{ref:read.ref,selection:read.selection,measurement:read.observation}]:[]);
  return {relation,status:proof.status,reason:outcome.reason,observations};
}

export function optionalArchiveRelation(outcome:OptionalOutcomeV21,contract:OptionalProofProvenance['resultContract']) {
  if(contract===undefined){
    requireData(outcome.refutationKind===undefined,'Historical refutations use the original result contract.');
    if(outcome.resultKind==='valid-refutation')return 'counterexample';
  }else{
    requireData(contract==='scoped-refutation-v1','Unknown optional archive result contract.');
    if(outcome.resultKind==='valid-refutation'){
      requireData(outcome.refutationKind==='contradiction'||outcome.refutationKind==='counterexample','Theoretical refutation requires an explicit kind.');
      return outcome.refutationKind;
    }
    requireData(outcome.refutationKind===undefined,'Only theoretical refutations have a refutation kind.');
    if(outcome.resultKind==='empirical-exclusion')return 'empirical-exclusion';
  }
  requireData(outcome.resultKind==='supported-result','Only a qualified result may enter the archive under its frozen contract.');
  return 'direct';
}
/** Derived indexing aid, never a revision of the archived scientific declaration. */
export interface DerivedProofMetadata {
  recipeVersion: 'optional-metadata-v1'; derivationId: string; proofRef: ProofRef;
  evidenceKey: string; originalHashes: string[]; tags: string[]; summary: string;
}
export interface FailureInput {
  sourceLoopVersion?: '2.1' | '3.0' | '4.0'; rawAnswer?: RawAnswerRefV21; judgmentHash?: string;
  optionalArtifact?: { artifactId:string; evidenceKey:string; originalRef:RawAnswerRefV21; authorRole:'auxiliary-worker'|'way-worker' };
  id: string; sessionId: string; attemptId: string; workerId: string; patternKey: string;
  summary: string; body: string; tags: string[]; scientific: boolean;
}
export interface FailureRecord extends FailureRef {
  sourceLoopVersion?: '2.1' | '3.0' | '4.0'; rawAnswer?: RawAnswerRefV21; judgmentHash?: string;
  optionalArtifact?: FailureInput['optionalArtifact'];
  workerId: string; patternKey: string; summary: string; tags: string[]; scientific: boolean;
  contentHash: string; updatedAt: string;
}
export type ResourceKind = 'method-skill' | 'failure-skill' | 'specific-strategy';
export interface ResourceMeta extends ResourceRef {
  maintenance?:{role:'maintenance';scope:'shared-library';callId:string;parent?:ResourceRef;retired?:true;resumeEnabled?:boolean};
  /** Exact publication body coupling for derived hierarchy-index-v1 terms; absent on legacy metadata. */
  catalogBodyHashV3?: string;
  strategySupport?: import('./strategy-support-v3.js').StrategySupportV3;
  methodSupport?: import('./method-support-v3.js').MethodSupportV3;
  kind: ResourceKind; semanticKey: string; name: string; title?: string; description: string; tags: string[]; conditions: string[];
  enabled: boolean; status: 'valid' | 'needs_review'; sourceRefs: LearningSource[]; createdAt: string; updatedAt: string;
  createdBy?: LearningActor | { role: 'user' } | {role:'maintenance';scope:'shared-library'}; updatedBy?: LearningActor | { role: 'user' } | {role:'maintenance';scope:'shared-library'};
}
export interface ResourceInput {
  id: string; kind: ResourceKind; semanticKey: string; name: string; title?: string; description: string; tags: string[];
  conditions: string[]; body: string; sourceRefs: LearningSource[]; generalizable?: boolean;
}
export interface DecisionFactor { id: string; description: string; weight: number; baseline: number }
export interface DecisionFile { loopVersion: LoopVersion; version: number; parentVersion?: number; factors: DecisionFactor[]; rules: string[] }
export interface DecisionProposal { factors: Omit<DecisionFactor, 'baseline'>[]; rules: string[] }
export interface AnomalyInput { id: string; sessionId: string; attemptId: string; summary: string; factorVersion: number; patternKey: string }
export interface AnomalyRecord extends AnomalyInput { version: number }
export interface AnomalyRef { id: string; version: number }
export interface ReviewCase { ref: ProofRef; groupKeys: string[] }
export interface WeightUpdateOutcome { status: 'applied' | 'unchanged' | 'rejected'; reason?: string; version?: number }
export interface ReviewOperation extends CapacityReservationV3 {
  strategyAdmissionRecipe?: import('./strategy-admission-v3.js').StrategyAdmissionRecipeV3;
  structuralAdmission?: import('./strategy-admission-v3.js').StructuralReviewV3;
  weightDecision?: DecisionFile; weightAnchor?: Record<string,number>;
  weightUpdate?: { inputHash: string; outcome: WeightUpdateOutcome };
  id: string; purpose: ReviewPurpose; status: 'queued' | 'running' | 'completed' | 'no-change' | 'failed' | 'paused';
  cases: ReviewCase[]; anomalies: AnomalyRef[]; delivered: string[]; processed: string[];
  expectedDecisionVersion?: number; repairResourceIds: string[]; repairKeys: Record<string, string>; createdAt: string; error?: string;
}
export interface ReviewReceipt { purpose: ReviewPurpose; groupKey: string; sourceId: string; semanticRevision: number; revision: number; operationId: string }
export interface Catalog<T> { generation: number; records: Record<string, T>; byTag: Record<string, string[]> }
export interface BoundaryView { decision: DecisionFile; skills: ResourceMeta[]; strategies: ResourceMeta[]; proofs?: { ref: ProofRef; summary: string; meta?: Pick<ProofRecord, 'targetKey' | 'methodKey' | 'conditions' | 'logicalRelation'> }[] }
export interface BoundaryQuery { sessionId: string; loopVersion: LoopVersion; hypothesis?: string; tags?: string[]; limit?: number }
export interface ArchiveSubject {
  id: string; kind: 'session' | 'attempt' | 'failure'; sessionId: string; lastActivityAt: string;
  ended: boolean; hasValidProof?: boolean; running?: boolean; queuedContinuation?: boolean;
  learningPinned?: boolean; recoveryPinned?: boolean; userPinned?: boolean; unread?: boolean;
}
export interface ArchiveState { checkedAt?: string; cold: Record<string, string>; activity?: Record<string, { fingerprint: string; lastActivityAt: string }> }
export interface ResearchLibraryState {
  knowledgeMapV4?: import('./knowledge-map.js').KnowledgeMapState;
  knowledgeNetworkV4?: import('./knowledge-network.js').KnowledgeNetworkState;
  manualNetworkReviewsV1?: Record<string, { hash: string; status: 'published' | 'no-change'; version: number }>;
  methodNetworkV3?: import('./method-network-v3.js').NetworkPublicationV3;
  methodNetworkManifestV3?: {recipe:'method-network-v1';networkHash:string;catalogHash:string};
  methodNetworkOutcomesV3?: Record<string,{hash:string;status:'published'|'rejected';reason?:string;version?:number}>;
  knowledgeV3?: import('./v3-knowledge.js').KnowledgePublicationV3;
  catalogV3?: {recipe:'hierarchy-index-v1';indexHash:string;analyzer?:import('./hierarchical-catalog-v3.js').CatalogAnalyzerV3};
  schemaVersion: 1; generation: number; proofs: Record<string, ProofRecord>; nextProof: Record<string, number>;
  failures: Record<string, FailureRecord>; resources: Record<string, ResourceMeta>;
  decisions: Record<'1' | '2', DecisionFile>; anomalies: Record<string, AnomalyRecord>; patternsV1: string[];
  operations: Record<string, ReviewOperation>; receipts: ReviewReceipt[]; archive: ArchiveState;
  invalidProofs: Record<string, 'revoked' | 'needs_review'>;
  appliedUpdates: Record<string, { kind: 'resource' | 'decision'; id: string; version: number; inputHash: string; actor?: LearningActor; sources?: LearningSource[] }>;
  inspectedAttempts: Record<string, Record<string, string>>;
  v0InvalidOriginals?: Record<string, true>;
  v21AppliedReviews?: Record<string, string[]>;
  v21ReviewEvidence?: Record<string, Record<string, string>>;
  v21OptionalEvidence?: Record<string, Record<string, string>>;
  v21OptionalAppliedEvidence?: Record<string, Record<string, string[]>>;
  reportUpdatesV4?: import('./report-assessment.js').ReportUpdate[];
  v21OptionalInvalidArtifacts?: Record<string, true>;
  v21OptionalRequalifications?: Record<string, { inputHash:string; evidenceRevision:number }>;
  strategyWeightAnchor?: Record<string,number>;
  decisionSupport?: Partial<Record<'1' | '2', Record<string, DecisionSupport>>>;
  resourceOptionalEvidence?: Record<string, OptionalDecisionEvidence>;
  optionalProofMetadata?: Record<string, DerivedProofMetadata>;
  catalogs: { proofs: Catalog<ProofRecord>; skills: Catalog<ResourceMeta>; strategies: Catalog<ResourceMeta> };
}

export class LearningDataError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'CONFLICT' | 'STALE_SOURCE' | 'NOT_FOUND', message: string) { super(message); this.name = 'LearningDataError'; }
}
export function requireData(condition: unknown, message: string, code: LearningDataError['code'] = 'INVALID_INPUT'): asserts condition {
  if (!condition) throw new LearningDataError(code, message);
}
export function safeId(value: string): string {
  requireData(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value), 'Invalid resource identity.'); return value;
}
export function requireText(value: string, label: string, max = 1_000_000): void {
  requireData(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${label}.`);
}
export function normalizeTags(tags: string[]): string[] {
  requireData(Array.isArray(tags) && tags.length <= 64, 'Invalid tags.');
  return [...new Set(tags.map(tag => {
    requireText(tag, 'tag', 200);
    const normalized = tag.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, '-');
    requireData(/^(subject|specialization|method|problem-type|pitfall):[^:]+$/u.test(normalized), 'A tag must have one supported dimension.');
    return normalized;
  }))].sort();
}
export function proofRef(record: ProofRecord): ProofRef {
  const { sessionId, caseId, hypothesisId, hypothesisRevision, revision, semanticRevision, contentHash } = record;
  return { sessionId, caseId, hypothesisId, hypothesisRevision, revision, semanticRevision, contentHash };
}
export function sourceKey(ref: ProofRef | AnomalyRef): string { return 'caseId' in ref ? `proof:${ref.caseId}:${ref.revision}:${ref.semanticRevision}` : `anomaly:${ref.id}:${ref.version}`; }
export function proofGroups(tags: string[]): string[] {
  const subjects = tags.filter(t => t.startsWith('subject:'));
  return [...new Set(subjects.flatMap(subject => [subject, ...tags.filter(t => t.startsWith('specialization:') || t.startsWith('method:')).map(tag => `${subject}|${tag}`)]))].sort();
}
export function buildCatalog<T extends { tags: string[] }>(records: Record<string, T>, generation: number): Catalog<T> {
  const byTag: Record<string, string[]> = {};
  for (const [id, record] of Object.entries(records)) for (const tag of record.tags) (byTag[tag] ??= []).push(id);
  for (const ids of Object.values(byTag)) ids.sort();
  return { generation, records: structuredClone(records), byTag };
}
export function defaultDecision(loopVersion: LoopVersion): DecisionFile {
  return { loopVersion, version: 1, rules: [], factors: [
    ['M', 'Academic or mathematical basis', 0.35], ['R', 'Relevance to the hypothesis', 0.25],
    ['D', 'Discriminative power: critical conditions, counterexamples, contradictions or competing explanations', 0.25], ['N', 'Novel uncovered direction', 0.10],
    ['E', 'Expected effort and feasibility', 0.05],
  ].map(([id, description, weight]) => ({ id: String(id), description: String(description), weight: Number(weight), baseline: Number(weight) })) };
}
export function reviseDecision(current: DecisionFile, proposal: DecisionProposal): DecisionFile {
  requireData(Array.isArray(proposal.factors) && proposal.factors.length > 0 && proposal.factors.length <= 32, 'Invalid decision factors.');
  const ids = proposal.factors.map(f => safeId(f.id));
  requireData(new Set(ids).size === ids.length, 'Duplicate factor IDs.');
  requireData(Array.isArray(proposal.rules) && proposal.rules.length <= 32 && proposal.rules.every(r => typeof r === 'string' && r.length <= 4000), 'Rules must be bounded declarative text.');
  if (current.loopVersion === 1) {
    requireData(current.factors.every(f => ids.includes(f.id)), 'V1 cannot delete factors.');
    requireData(JSON.stringify(proposal.rules) === JSON.stringify(current.rules), 'V1 maintains scoring factors, not decision rules.');
  }
  const structureChanged = ids.length !== current.factors.length || ids.some(id => !current.factors.some(f => f.id === id))
    || JSON.stringify(proposal.rules) !== JSON.stringify(current.rules)
    || current.loopVersion === 2 && proposal.factors.some(f => current.factors.find(old => old.id === f.id)?.description !== f.description);
  let sum = 0;
  const factors = proposal.factors.map(factor => {
    requireText(factor.description, 'factor description', 4000);
    requireData(Number.isFinite(factor.weight) && factor.weight >= 0 && factor.weight <= 1, 'Invalid factor weight.'); sum += factor.weight;
    const old = current.factors.find(f => f.id === factor.id);
    if (!structureChanged && old) requireData(Math.abs(factor.weight - old.baseline) <= old.baseline * 0.1 + 1e-10, 'Weight exceeds its fixed baseline by more than 10%.');
    return { ...factor, baseline: structureChanged ? factor.weight : old!.baseline };
  });
  requireData(Math.abs(sum - 1) < 1e-8, 'Decision weights must sum to one.');
  return { loopVersion: current.loopVersion, version: current.version + 1, parentVersion: current.version, factors, rules: [...proposal.rules] };
}
export function archiveCandidates(subjects: ArchiveSubject[], now: string): string[] {
  const sessions = subjects.filter(s => s.kind === 'session').length;
  const attempts = subjects.filter(s => s.kind === 'attempt').length;
  const days = sessions > 1000 || attempts > 100_000 ? 14 : sessions > 100 || attempts > 10_000 ? 30 : 90;
  const cutoff = Date.parse(now) - days * 86_400_000;
  const protectedSessions = new Set(subjects.filter(s => s.running || s.queuedContinuation || s.learningPinned || s.recoveryPinned || s.userPinned || s.unread).map(s => s.sessionId));
  const sessionTimes = new Map(subjects.filter(s => s.kind === 'session').map(s => [s.sessionId, Date.parse(s.lastActivityAt)]));
  return subjects.filter(s => s.ended && !protectedSessions.has(s.sessionId) && !(s.kind === 'session' && s.hasValidProof)
    && Date.parse(s.lastActivityAt) <= cutoff && (sessionTimes.get(s.sessionId) ?? Infinity) <= cutoff).map(s => s.id);
}

/** Operation9 and V3 share host-bound conditions and optional metadata admission. */
export function modernOptionalRevision(revision: string | undefined): boolean { return revision === 'v21-operation-9' || ['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??''); }
