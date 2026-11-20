import type { ResearchProjectV0, InFlightEpochV0, AgentSessionSpecV0, AgentInvocationV0, ResearchEventV0, ResearchConfigV0, ResearchStoreV0, AgentRuntimeV0, ResearchCompositionV0 } from './v0.js';
import type { ResearchProjectV21, InFlightEpochV21, AgentSessionSpecV21, AgentInvocationV21, ResearchEventV21, ResearchConfigV21, ResearchStoreV21, AgentRuntimeV21, ResearchCompositionV21 } from './v21.js';
import type { AgentInvocation, AgentRuntime, AgentSessionSpec, InFlightRound, ResearchConfig, ResearchEvent, ResearchProject, ResearchStore, UserCommand } from './v1.js';

/** Application port version 1. Scientific behavior belongs exclusively to a selected bundle. */
export interface ResearchLoop {
  start(projectId: string): Promise<void>;
  enqueue(command: UserCommand): Promise<void>;
  getSnapshot(projectId: string, saved?: ResearchProject): Promise<ResearchProject>;
  reconcile(projectId: string): Promise<ResearchProject>;
  isActive(projectId?: string): boolean;
  subscribe(listener: (event: ResearchEvent) => void): () => void;
  shutdown(): Promise<void>;
}
export interface NewResearchProject { id: string; name: string; hypothesis: string; config?: Partial<ResearchConfig>; researchLoopVersion?: string }
export interface ResearchLoopBundle {
  readonly version: string;
  readonly workerProtocolVersion: string;
  readonly contractVersion: '1';
  readonly projectSchemaVersion: 1;
  /** Explicit allowlist, never a best-effort migration. Target validation must also succeed. */
  readonly acceptsSelectionFrom: readonly string[];
  assertBoundary(project: ResearchProject, marker: InFlightRound | undefined, purpose: 'execute' | 'select'): void;
  validateInvocation(spec: AgentSessionSpec, invocation: AgentInvocation): void;
  create(store: ResearchStore, runtime: AgentRuntime, composition?: import('./v1.js').ResearchCompositionV1): ResearchLoop;
  createProject(input: NewResearchProject): ResearchProject;
  parseProject(value: unknown): ResearchProject;
  parseConfig(value: unknown): ResearchConfig;
  parseInFlight(value: unknown): InFlightRound;
  roleSystemPrompt(spec: AgentSessionSpec): string;
  taskPrompt(invocation: AgentInvocation): string;
}

/** Trusted application composition seam; never exposed through the API or plugin host. */
export type ResearchLoopResolver = (version: string) => AnyResearchLoopBundle;

import type { AgentInvocationV2, AgentRuntimeV2, AgentSessionSpecV2, InFlightEpoch, ResearchConfigV2, ResearchEventV2, ResearchProjectV2, ResearchStoreV2, ResearchLoopComposition } from './v2.js';
export type AnyResearchProject = ResearchProject | ResearchProjectV2 | ResearchProjectV21 | ResearchProjectV0;
export type AnyInFlight = InFlightRound | InFlightEpoch | InFlightEpochV21 | InFlightEpochV0;
export type AnyAgentSessionSpec = AgentSessionSpec | AgentSessionSpecV2 | AgentSessionSpecV21 | AgentSessionSpecV0;
export type AnyAgentInvocation = AgentInvocation | AgentInvocationV2 | AgentInvocationV21 | AgentInvocationV0;
export type AnyResearchEvent = ResearchEvent | ResearchEventV2 | ResearchEventV21 | ResearchEventV0;
export interface AnyAgentRuntime {
  reconcileV0?: AgentRuntimeV0['reconcileV0'];
  retainedV0Answer?: AgentRuntimeV0['retainedV0Answer'];
  cancelSession?: AgentRuntimeV0['cancelSession'];
  reconcileV21?: AgentRuntimeV21['reconcileV21'];
  systemChangeSkipped?: AgentRuntimeV21['systemChangeSkipped'];
  loadedAnswerDeliveries?: AgentRuntimeV21['loadedAnswerDeliveries'];
  loadedResourceRefs?: AgentRuntimeV21['loadedResourceRefs'];
  savedChapters?: AgentRuntime['savedChapters'];
  createSession(spec: AnyAgentSessionSpec): ReturnType<AgentRuntime['createSession']>;
  invoke(session: Parameters<AgentRuntime['invoke']>[0], invocation: AnyAgentInvocation): Promise<unknown>;
  closeSession(session: Parameters<AgentRuntime['closeSession']>[0]): Promise<void>;
  getUsage?: AgentRuntimeV2['getUsage'];
}
export interface NewResearchProjectV2 { id: string; name: string; hypothesis: string; config?: Partial<ResearchConfigV2>; researchLoopVersion: '2.0' }
export interface ApplicationResearchLoop {
  wakeReport?(scope:import('../versions/v4/coordinator.js').V4Scope):Promise<void>;
  start(projectId: string): Promise<void>;
  enqueue(command: UserCommand): Promise<void>;
  getSnapshot(projectId: string, saved?: AnyResearchProject): Promise<AnyResearchProject>;
  reconcile(projectId: string): Promise<AnyResearchProject>;
  isActive(projectId?: string): boolean;
  subscribe(listener: (event: AnyResearchEvent) => void): () => void;
  shutdown(): Promise<void>;
}
export interface ResearchLoopV2 {
  start(projectId: string): Promise<void>;
  enqueue(command: UserCommand): Promise<void>;
  getSnapshot(projectId: string, saved?: ResearchProjectV2): Promise<ResearchProjectV2>;
  reconcile(projectId: string): Promise<ResearchProjectV2>;
  isActive(projectId?: string): boolean;
  subscribe(listener: (event: ResearchEventV2) => void): () => void;
  shutdown(): Promise<void>;
}
export interface ResearchLoopBundleV2 {
  readonly version: '2.0'; readonly workerProtocolVersion: '2.0'; readonly contractVersion: '2'; readonly projectSchemaVersion: 2;
  readonly acceptsSelectionFrom: readonly string[];
  assertBoundary(project: ResearchProjectV2, marker: InFlightEpoch | undefined, purpose: 'execute' | 'select'): void;
  validateInvocation(spec: AgentSessionSpecV2, invocation: AgentInvocationV2): void;
  create(store: ResearchStoreV2, runtime: AgentRuntimeV2, composition?: ResearchLoopComposition): ResearchLoopV2;
  createProject(input: NewResearchProjectV2): ResearchProjectV2;
  parseProject(value: unknown): ResearchProjectV2;
  parseConfig(value: unknown): ResearchConfigV2;
  parseInFlight(value: unknown): InFlightEpoch;
  roleSystemPrompt(spec: AgentSessionSpecV2): string;
  taskPrompt(invocation: AgentInvocationV2): string;
}
export type AnyResearchLoopBundle = ResearchLoopBundle | ResearchLoopBundleV2 | ResearchLoopBundleV21 | ResearchLoopBundleV0;
/** Physical store port; version adapters validate before returning scientific records. */
export interface ApplicationResearchStore {
  commitPlanningCheckpointV0?: ResearchStoreV0['commitPlanningCheckpoint'];
  commitPlanningCheckpoint?: ResearchStoreV2['commitPlanningCheckpoint'];
  commitGuardedCheckpointV21?: ResearchStoreV21['commitGuardedCheckpoint'];
  commitPlanningCheckpointV21?: ResearchStoreV21['commitPlanningCheckpoint'];
  /** Explicit empty-session selection, never conversion of research history. */
  selectUnstartedVersion?(project: AnyResearchProject, expectedRevision: string): Promise<AnyResearchProject>;
  loadProject(projectId: string): Promise<AnyResearchProject>;
  commitCheckpoint(project: AnyResearchProject): Promise<AnyResearchProject>;
  enqueueCommand(command: UserCommand): Promise<void>;
  listCommands(projectId: string): Promise<UserCommand[]>;
  freezeInputs(project: AnyResearchProject): ReturnType<ResearchStore['freezeInputs']>;
  saveInFlight(record: AnyInFlight): Promise<void>;
  loadInFlight(projectId: string): Promise<AnyInFlight | undefined>;
  clearInFlight(projectId: string): Promise<void>;
  searchExperiences?: ResearchStore['searchExperiences'];
  listResearchCases?: ResearchStoreV2['listResearchCases'];
  loadEvolutionState?: ResearchStoreV2['loadEvolutionState'];
  publishEvolution?: ResearchStoreV2['publishEvolution'];
  saveEvolutionReviewOperation?: ResearchStoreV2['saveEvolutionReviewOperation'];
  loadEvolutionReviewOperation?: ResearchStoreV2['loadEvolutionReviewOperation'];
}

export interface NewResearchProjectV21 { id:string;name:string;hypothesis:string;config?:Partial<ResearchConfigV21>;researchLoopVersion:'2.1'|'3.0'|'4.0' }
export interface ResearchLoopV21 { wakeReport?(scope:import('../versions/v4/coordinator.js').V4Scope):Promise<void>;start(id:string):Promise<void>;enqueue(command:UserCommand):Promise<void>;getSnapshot(id:string,saved?:ResearchProjectV21):Promise<ResearchProjectV21>;reconcile(id:string):Promise<ResearchProjectV21>;isActive(id?:string):boolean;subscribe(listener:(event:ResearchEventV21)=>void):()=>void;shutdown():Promise<void> }
export interface ResearchLoopBundleV21 {
 readonly version:'2.1'|'3.0'|'4.0';readonly workerProtocolVersion:'2.1';readonly contractVersion:'2.1';readonly projectSchemaVersion:3;readonly acceptsSelectionFrom:readonly string[];
 assertBoundary(project:ResearchProjectV21,marker:InFlightEpochV21|undefined,purpose:'execute'|'select'):void;
 validateInvocation(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):void;
 create(store:ResearchStoreV21,runtime:AgentRuntimeV21,composition?:ResearchCompositionV21):ResearchLoopV21;
 createProject(input:NewResearchProjectV21):ResearchProjectV21;parseProject(value:unknown):ResearchProjectV21;parseConfig(value:unknown):ResearchConfigV21;parseInFlight(value:unknown):InFlightEpochV21;
 roleSystemPrompt(spec:AgentSessionSpecV21):string;taskPrompt(invocation:AgentInvocationV21):string;
}

export interface NewResearchProjectV0 { id:string;name:string;hypothesis:string;config?:Partial<ResearchConfigV0>;researchLoopVersion:'0' }
export interface ResearchLoopV0 { start(id:string):Promise<void>;enqueue(command:UserCommand):Promise<void>;getSnapshot(id:string,saved?:ResearchProjectV0):Promise<ResearchProjectV0>;reconcile(id:string):Promise<ResearchProjectV0>;isActive(id?:string):boolean;subscribe(listener:(event:ResearchEventV0)=>void):()=>void;shutdown():Promise<void> }
export interface ResearchLoopBundleV0 {
 readonly version:'0';readonly workerProtocolVersion:'v0-native-1';readonly contractVersion:'v0-test-1';readonly projectSchemaVersion:4;readonly acceptsSelectionFrom:readonly string[];
 assertBoundary(project:ResearchProjectV0,marker:InFlightEpochV0|undefined,purpose:'execute'|'select'):void;
 validateInvocation(spec:AgentSessionSpecV0,invocation:AgentInvocationV0):void;
 create(store:ResearchStoreV0,runtime:AgentRuntimeV0,composition?:ResearchCompositionV0):ResearchLoopV0;
 createProject(input:NewResearchProjectV0):ResearchProjectV0;parseProject(value:unknown):ResearchProjectV0;parseConfig(value:unknown):ResearchConfigV0;parseInFlight(value:unknown):InFlightEpochV0;
 roleSystemPrompt(spec:AgentSessionSpecV0):string;taskPrompt(invocation:AgentInvocationV0):string;
}
