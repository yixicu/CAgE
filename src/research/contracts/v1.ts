import type { UserCommand, UserCommandState, PlanningSelection } from './user-commands.js';
export type { UserCommand, UserCommandState, PlanningSelection } from './user-commands.js';
import type { ForkManifest } from './lineage.js';
import type { SessionPresentation } from '../../presentation/session-presentation.js';
import type { ChapterRef, ProofContext, PathReport, ComponentDelivery } from './documents.js';
/** Versioned provider-independent contracts. Engine alone owns scientific state. */
import type { BoundaryView, ResourceRef } from '../../learning/research-data.js';
import type { Continuation, PlanningChange, ResearchComposition, ResearchReceipt, ResourceReadRef, ScientificReview } from './review.js';
export const RESEARCH_STAGES = ['INTAKE', 'PLAN', 'PRIORITIZE', 'DISPATCH', 'VERIFY', 'SYNTHESIZE', 'REVIEW', 'CHECKPOINT', 'DECIDE'] as const;
export const WORKER_PROTOCOL = ['FORMULATE', 'DERIVE', 'CHALLENGE', 'CHECK', 'REFLECT', 'RETURN'] as const;
export type ResearchStage = typeof RESEARCH_STAGES[number];
export type WorkerStep = typeof WORKER_PROTOCOL[number];
export type ResearchRole = 'theorist' | 'worker' | 'moderator' | 'literature';
export type Effort = 'shallow' | 'deep';
export type VerificationMode = 'compatibility' | 'contradiction' | 'exploratory';
export type Conclusion = 'compatible' | 'conditionally_compatible' | 'contradictory' | 'inconclusive';
export type ExecutionStatus = 'completed' | 'interrupted' | 'failed';
export type RoundDecision = 'continue' | 'refine' | 'pause' | 'complete' | 'stop';
export type Criterion = string;
export type Weights = Record<Criterion, number>;
export interface ModelSelection { provider: string; modelId: string; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }
export interface CapacityPolicyV3 { revision: 'v3-capacity-1'; controlsEnabled: boolean; settingsVersion: string }
export interface RoleBudget { capacityPolicy?: CapacityPolicyV3; maxTurns: number; maxToolCalls: number; timeoutMs: number; softDeadlineAt?: number; maxTokens?: number; maxCostUsd?: number }
export interface ResearchConfig {
  maxWorkers: number; maxRounds: number; maxBranches: number; moderatorEnabled: boolean; literatureEnabled: boolean;
  workerBudgets: Record<Effort, RoleBudget>; roleBudget: RoleBudget;
  defaultModel?: ModelSelection; roleModels?: Partial<Record<ResearchRole, ModelSelection>>;
}
export interface SourceRevisionRef { id: string; path: string; revision: string; fingerprint?: string; external?: boolean }
export interface CitationRef { sourceId: string; locator: string; quote?: string; verified?: boolean }
export interface EvidenceCard { claim: string; citation: CitationRef; conditions: string[]; conflicts: string[] }
export interface ResearchBrief { promptRevision?:'categorized-v1'; componentIssues?: import("./review.js").ComponentIssue[]; adoptedChapters?: import("./documents.js").ChapterRef[]; dependencyUse?: {reuse:string;recheck:string}; proofContext?: ProofContext; conventionVersion?: string;
  branchId: string; parentId?: string; rootHypothesisRevision: string; inputRevision: string; hypothesis: string; question: string;
  targetTheory?: string; mode: VerificationMode; effort: Effort; assumptions: string[]; frozenSourceRefs: SourceRevisionRef[]; budget: RoleBudget;
  wayId?: string; assignment?: string; skillRefs?: ResourceRef[]; continuation?: Continuation; decisionVersion?: number; workingHypothesis?: PlanningChange;
}
export interface BranchResult { componentDelivery?: ComponentDelivery; chapters?: ChapterRef[]; pathReport?: PathReport;
  branchId: string; executionStatus: ExecutionStatus; conclusion?: Conclusion; assumptions: string[];
  applicability: string; derivationRef?: string; derivationMarkdown?: string; citations: CitationRef[]; strongestObjection?: string;
  unresolvedQuestions: string[]; proposedFollowups: string[]; verificationQuality?: string; errorSummary?: string;
  conflictingPropositions?: string[]; derivationChain?: string[]; protocol?: WorkerStep[]; evidenceWarnings?: string[];
  stepNotes?: { step: WorkerStep; notes: string }[];
}
export interface FrontierCandidate { dependencyChapters?: import("./documents.js").ChapterRef[]; dependencyUse?: {reuse:string;recheck:string}; proofContext?: ProofContext; conventionVersion?: string;
  id: string; parentId: string; question: string; targetTheory?: string; mode: VerificationMode; effort: Effort;
  assumptions: string[]; scores: Weights; rationales: Record<Criterion, string>; dedupeKey: string; exceptionReason?: string;
  wayId?: string; assignment?: string; allocation?: 'dispatch' | 'defer'; skillRefs?: ResourceRef[]; continuation?: Continuation;
}
export interface FrontierItem extends FrontierCandidate { priority: number; state: 'pending' | 'active' | 'completed' | 'deferred'; hypothesisRevision: string }
export interface FrontierPolicy { weights: Weights; version: number; effectiveFromRound: number; changeReason?: string; changedBy?: 'moderator'; applicability?: string; boundary?: BoundaryView }
export interface HypothesisNode {
  id: string; parentId?: string; hypothesisRevision: string; question: string; targetTheory?: string; mode?: VerificationMode; effort?: Effort;
  status: 'pending' | 'active' | Conclusion | 'needs_review' | 'interrupted' | 'failed'; executionStatus?: ExecutionStatus; conclusion?: Conclusion; priority?: number; resultPath?: string; relatedNodeIds?: string[];
}
export interface ResearchExperience { round: number; kind: 'routing' | 'strategy' | 'candidate_skill'; context: string; lesson: string; limitations: string; status: 'unreviewed' }
/** Read-only context from a committed earlier project; never a verified or active Skill. */
export interface RecalledExperience {
  readonly sourceProjectId: string; readonly sourceProjectName: string; readonly sourceContentRevision: string; readonly sourceHypothesisRevision: string;
  readonly experience: Readonly<ResearchExperience & { kind: 'routing' | 'strategy' }>;
}
export interface LoopProvenance { researchLoopVersion: string; workerProtocolVersion: string }
export interface LoopSelection { from: string; to: string; at: string; previousRevision: string; afterRound: number }
export interface RoundRecord {
  promptRevision?:'categorized-v1';
  /** Missing only on legacy v1 records. */
  loop?: LoopProvenance;
  number: number; id: string; hypothesisRevision: string; inputRevision: string; stages: ResearchStage[]; branchIds: string[];
  decision?: RoundDecision; reason?: string; summary: string; userVisible: boolean; completedAt?: string;
  research?: ResearchReceipt;
  /** Saved at CHECKPOINT so crash recovery can execute DECIDE without repeating model calls. */
  decisionContext?: { review: ReviewOutput; failed: boolean; control: { stop: boolean; pause: boolean; refine: boolean } };
}
export interface ResearchProject {
  fork?: ForkManifest;
  schemaVersion: 1; researchLoopVersion: string; workerProtocolVersion: string; id: string; name: string; nameSource?: 'user' | 'theorist'; presentation?: SessionPresentation & { hypothesisRevision: string };
  hypothesis: string; hypothesisRevision: string; contentRevision: string; sources: SourceRevisionRef[]; startedAt?: string;
  config: ResearchConfig; status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'failed'; stage: ResearchStage;
  round: number; frontier: FrontierItem[]; graph: HypothesisNode[]; results: BranchResult[]; summary: string;
  policies: FrontierPolicy[]; rounds: RoundRecord[]; processedCommandIds: string[]; refinements: string[];
  experiences: ResearchExperience[]; evidence: EvidenceCard[]; lastError?: string; loopSelections?: LoopSelection[];
  hypothesisId?: string; previousHypothesisId?: string; targetKey?: string; workingHypothesis?: PlanningChange; researchTags?: string[];
  plannedRefinementCount?: number; pendingModificationIds?: string[];
  commandStates?: Record<string, UserCommandState>; userInputWarnings?: string[];
}
export type ResearchView = ResearchProject;
export interface FrozenInputs { contentRevision: string; hypothesisRevision: string; sources: SourceRevisionRef[] }
export interface InFlightRound { promptRevision?:'categorized-v1'; planningSelection?: PlanningSelection; workerProgress?: Record<string,{step:WorkerStep;notes:string}[]>; loop?: LoopProvenance; projectId: string; round: number; stage: ResearchStage; briefs: ResearchBrief[]; startedAt: string }
/** Commands are a separate durable journal: checkpoints must never overwrite concurrently enqueued commands. */
export interface ResearchStore {
  loadProject(projectId: string): Promise<ResearchProject>;
  commitCheckpoint(project: ResearchProject): Promise<ResearchProject>;
  enqueueCommand(command: UserCommand): Promise<void>;
  listCommands(projectId: string): Promise<UserCommand[]>;
  freezeInputs(project: ResearchProject): Promise<FrozenInputs>;
  saveInFlight(record: InFlightRound): Promise<void>;
  loadInFlight(projectId: string): Promise<InFlightRound | undefined>;
  clearInFlight(projectId: string): Promise<void>;
  searchExperiences?(query: string, excludeProjectId: string, limit: number): Promise<RecalledExperience[]>;
}
export interface PlanOutput { presentation?: unknown; researchTags?:string[]; candidates: FrontierCandidate[]; rationale: string; planningChange?: PlanningChange }
export interface SynthesisOutput { summary: string; disagreements: string[]; unresolvedQuestions: string[]; relatedNodes?: { from: string; to: string }[] }
export interface ReviewOutput {
  decision: 'continue' | 'pause' | 'complete'; reason: string; nextQuestions: string[];
  experiences?: { kind: ResearchExperience['kind']; context: string; lesson: string; limitations: string }[];
  researchReview?: ScientificReview;
}
export interface ModeratorOutput { notes: string[]; deferredBranchIds?: string[]; weightProposal?: { weights: Weights; reason: string; applicability: string } }
export interface LiteratureOutput { evidence: EvidenceCard[]; limitations: string[] }
export interface WorkerStepOutput { step: WorkerStep; notes: string; result?: BranchResult }
export type AgentTask = 'plan' | 'synthesize' | 'review' | 'moderate_plan' | 'moderate_review' | 'literature' | 'worker_step';
export interface AgentSessionSpec {
  promptRevision?:'categorized-v1';
  /** Legacy external adapters may omit this only for v1; engine-created sessions always pin it. */
  loop?: LoopProvenance;
  id: string; projectId: string; role: ResearchRole; model?: ModelSelection; budget: RoleBudget;
  /** Worker context contains ONLY its own frozen brief; no project, graph, sibling tasks/results. */
  context: { brief: ResearchBrief } | { project: ResearchProject; recalledExperiences?: RecalledExperience[]; researchBoundary?: BoundaryView };
}
export interface AgentSession { id: string }
export interface AgentInvocation { promptRevision?:'categorized-v1'; task: AgentTask; input: unknown; step?: WorkerStep }
/** Adapter owns Pi sessions + explicit restricted tools; engine validates every unknown model response. */
export interface AgentRuntime { savedChapters?(sessionId: string, attemptId: string): Promise<ChapterRef[]>;
  loadedResourceRefs?(session:AgentSession):ResourceReadRef[];
  createSession(spec: AgentSessionSpec): Promise<AgentSession>;
  invoke(session: AgentSession, invocation: AgentInvocation): Promise<unknown>;
  closeSession(session: AgentSession): Promise<void>;
}
export type ResearchCompositionV1 = ResearchComposition<ResearchProject>;
export interface ResearchEvent {
  type: 'project.updated' | 'round.stage' | 'worker.status' | 'checkpoint.committed' | 'research.finished' | 'research.warning';
  projectId: string; round: number; stage?: ResearchStage; branchId?: string; status?: string; userVisible?: boolean; message?: string;
}
/** Safe runtime errors carry execution meaning without provider payloads or credentials. */
export class AgentExecutionError extends Error {
  constructor(message: string, readonly executionStatus: 'interrupted' | 'failed' = 'failed') { super(message); this.name = 'AgentExecutionError'; }
}
