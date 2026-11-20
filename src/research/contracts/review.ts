import { Type } from 'typebox';
import type { InheritedResearchView } from './lineage.js';
import { ChaptersSchema, ChapterIdentitySchema, type ChapterIdentity, type ChapterRef, type ComponentDelivery } from './documents.js';
import type { BoundaryQuery, BoundaryView, ProofInput, ProofRef, ResourceKind, ResourceMeta, ResourceRef } from '../../learning/research-data.js';

export interface AttemptRef { id: string; version: string }
export interface EndedAttempt extends AttemptRef {
  chapters?: ChapterRef[];
  componentDelivery?: ComponentDelivery;
  workerId: string; wayId: string; hypothesisRevision: string; question: string; method: string;
  assumptions: string[]; executionStatus: 'completed' | 'failed' | 'interrupted'; conclusion?: string;
  path: string; obstacle: string; continuation: string[];
}
export type ProofProposal = Omit<ProofInput, 'sessionId' | 'hypothesisId' | 'hypothesisRevision' | 'previousHypothesisId'> & { chapters?: ChapterRef[]; evidenceChapters?: ChapterRef[]; unusedComponents?: {ref:ChapterIdentity;reason:string}[]; expectedRevision?: number };
export interface ScientificReview {
  attemptsRead: AttemptRef[];
  documentsRead?: ChapterRef[]; adoptedChapters?: ChapterRef[]; unchangedProof?: ProofRef;
  proof?: ProofProposal;
  failures?: { attemptIds: string[]; patternKey: string; summary: string; tags: string[]; generalizable: boolean; scientific: boolean }[];
  anomalies?: { attemptId: string; patternKey: string; summary: string; scientific?: boolean }[];
  decisionOpportunity?: string;
  retractProofs?: {ref:ProofRef;reason:string}[];
  componentUpdates?: ComponentUpdate[];
  componentIssues?: ComponentIssue[];
  /** Host-derived exact invalidated sources; never a model's authority claim. */
  affectedChapters?: ChapterRef[];
}
export interface ComponentUpdate { ref: ChapterIdentity; action: 'withdraw' | 'supersede' | 'revalidate'; reason: string; replacement?: ChapterIdentity; semanticChange?: boolean; interfaceUnchanged?: boolean; recheckedUses?: {ref:ChapterIdentity;use:string;reason:string}[] }
export interface ComponentIssue { ref: ChapterIdentity; kind: 'clarification' | 'conflict'; use: string; question: string; evidence: string[]; resolution?: string }
export interface PlanningChange {
  kind: 'wording' | 'material' | 'new_target' | 'working'; hypothesis: string; targetKey: string;
  conditions: string[]; logicalRelation: ProofInput['logicalRelation']; linkReason: string;
}
export interface Continuation { chapters?: ChapterRef[]; reuse?: string; redo?: string; parentAttemptId: string; obstacle: string; newWork: string }
export interface LoadedResource { meta: ResourceMeta; body: string }
export interface ResourceReadRef extends ResourceRef { kind?: ResourceKind }
export interface ResearchReceipt {
  designRevision: '2026-10-15'; id: string; loopVersion: 1 | 2; round: number;
  hypothesisId: string; hypothesisRevision: string; hypothesis: string; previousHypothesisId?: string;
  boundary: BoundaryView; loadedResources?: ResourceRef[]; attempts: AttemptRef[]; review?: ScientificReview;
  proofArchive?: { status: 'saved' | 'pending'; ref?: ProofRef };
  coverageComplete: boolean; stopRequested: boolean;
}
export interface ResearchComposition<P> {
  /** Metadata-only archive validity; never expands proof text or invokes a model. */
  isProofValid?: (ref: ProofRef) => boolean;
  /** Host-only frozen fork context; never appended to owned attempts or persisted snapshots. */
  readInherited?: (projectId: string) => Promise<InheritedResearchView | undefined>;
  readBoundary?: (query: BoundaryQuery) => Promise<BoundaryView & { inspectedAttempts?: Record<string, string> }>;
  readResource?: (ref: ResourceRef, query: BoundaryQuery) => Promise<LoadedResource>;
  afterCheckpoint?: (input: { project: Readonly<P>; receipt: Readonly<ResearchReceipt>; endedAttempts: readonly EndedAttempt[] }) => Promise<ProofRef | void>;
}

const text=Type.String({minLength:1,maxLength:1_000_000}),short=Type.String({minLength:1,maxLength:10000});
const obj=(properties:Parameters<typeof Type.Object>[0])=>Type.Object(properties,{additionalProperties:false});
const en=<T extends string>(values:readonly T[])=>Type.Union(values.map(value=>Type.Literal(value)));
const strings=Type.Array(text,{maxItems:1000});
export const TagSchema=Type.String({minLength:1,maxLength:200,pattern:'^(subject|specialization|method|problem-type|pitfall):[^:]+$'});
export const TagsSchema=Type.Array(TagSchema,{maxItems:64});
export const ResourceRefSchema=obj({id:short,version:Type.Integer({minimum:1})});
export const AttemptRefSchema=obj({id:short,version:short});
export const ContinuationSchema=obj({parentAttemptId:short,obstacle:text,newWork:text,chapters:Type.Optional(ChaptersSchema),reuse:Type.Optional(text),redo:Type.Optional(text)});
export const PlanningChangeSchema=obj({kind:en(['wording','material','new_target','working']),hypothesis:text,targetKey:short,conditions:strings,logicalRelation:en(['direct','equivalent','sufficient','counterexample','necessary_only']),linkReason:text});
export const ProofProposalSchema=obj({targetKey:short,target:text,methodKey:short,conditions:strings,tags:TagsSchema,summary:text,proof:Type.Optional(text),chapters:Type.Optional({...ChaptersSchema,description:'Explicit ordered chapter bodies assembled into the final manuscript. Include all bodies necessary for the claimed proof, or supply a genuinely complete own derivation. Dependencies and evidence references do not append their bodies. Removing an ineligible necessary reference does not establish closure; resolve its obligations or submit partial progress.'}),evidenceChapters:Type.Optional({...ChaptersSchema,description:'Exact eligible provenance/evidence references, not manuscript body assembly. Necessary derivations must also be present explicitly in proof.chapters or fully rederived in an own manuscript chapter.'}),unusedComponents:Type.Optional(Type.Array(obj({ref:ChapterIdentitySchema,reason:text}))),expectedRevision:Type.Optional(Type.Integer({minimum:0})),rootClosed:Type.Boolean(),reproducible:Type.Boolean(),semanticChange:Type.Boolean(),logicalRelation:en(['direct','equivalent','sufficient','counterexample','necessary_only']),linkReason:text,sourceRefs:Type.Optional(strings)});
const proofRef=obj({sessionId:short,caseId:short,hypothesisId:short,hypothesisRevision:short,revision:Type.Integer({minimum:1}),semanticRevision:Type.Integer({minimum:1}),contentHash:short});
export const ComponentUpdateSchema=obj({ref:ChapterIdentitySchema,action:en(['withdraw','supersede','revalidate']),reason:text,replacement:Type.Optional(ChapterIdentitySchema),semanticChange:Type.Optional(Type.Boolean()),interfaceUnchanged:Type.Optional(Type.Boolean()),recheckedUses:Type.Optional(Type.Array(obj({ref:ChapterIdentitySchema,use:text,reason:text})))});
export const ComponentIssueSchema=obj({ref:ChapterIdentitySchema,kind:en(['clarification','conflict']),use:text,question:text,evidence:strings,resolution:Type.Optional(text)});
export const ScientificReviewSchema=obj({attemptsRead:Type.Array(AttemptRefSchema),documentsRead:Type.Optional(ChaptersSchema),adoptedChapters:Type.Optional(ChaptersSchema),componentUpdates:Type.Optional(Type.Array(ComponentUpdateSchema)),componentIssues:Type.Optional(Type.Array(ComponentIssueSchema)),affectedChapters:Type.Optional(ChaptersSchema),unchangedProof:Type.Optional(proofRef),proof:Type.Optional(ProofProposalSchema),failures:Type.Optional(Type.Array(obj({attemptIds:strings,patternKey:short,summary:text,tags:TagsSchema,generalizable:Type.Boolean(),scientific:Type.Boolean()}))),anomalies:Type.Optional(Type.Array(obj({attemptId:short,patternKey:short,summary:text,scientific:Type.Optional(Type.Boolean())}))),decisionOpportunity:Type.Optional(text),retractProofs:Type.Optional(Type.Array(obj({ref:proofRef,reason:text})))});
export const DecisionFileSchema=obj({loopVersion:Type.Union([Type.Literal(1),Type.Literal(2)]),version:Type.Integer({minimum:1}),parentVersion:Type.Optional(Type.Integer({minimum:1})),factors:Type.Array(obj({id:short,description:text,weight:Type.Number({minimum:0,maximum:1}),baseline:Type.Number({minimum:0,maximum:1})}),{minItems:1,maxItems:32}),rules:strings});
// Boundary data comes from the validated shared library; source refs are never grants.
const methodSupportBase={recipe:Type.Literal('method-support-v1'),parent:Type.Optional(ResourceRefSchema),directSourceRefs:Type.Array(proofRef,{minItems:1,maxItems:64})};
const methodSupport=Type.Union([obj({...methodSupportBase,mode:Type.Literal('revise')}),obj({...methodSupportBase,mode:Type.Literal('independent-rebuild'),justification:Type.String({minLength:1,maxLength:4000,pattern:'\\S'})})]);
const resourceMeta=obj({catalogBodyHashV3:Type.Optional(Type.String({pattern:'^[a-f0-9]{64}$'})),id:short,version:Type.Integer({minimum:1}),kind:en(['method-skill','failure-skill','specific-strategy']),semanticKey:short,name:text,title:Type.Optional(text),description:text,tags:strings,conditions:strings,enabled:Type.Boolean(),status:en(['valid','needs_review']),sourceRefs:Type.Array(Type.Unknown()),methodSupport:Type.Optional(methodSupport),createdBy:Type.Optional(Type.Unknown()),updatedBy:Type.Optional(Type.Unknown()),createdAt:short,updatedAt:short});
export const BoundaryViewSchema=obj({decision:DecisionFileSchema,skills:Type.Array(resourceMeta),strategies:Type.Array(resourceMeta),proofs:Type.Optional(Type.Array(obj({ref:proofRef,summary:text,meta:Type.Optional(obj({targetKey:short,methodKey:short,conditions:strings,logicalRelation:en(['direct','equivalent','sufficient','counterexample','necessary_only'])}))})))});
export const ResearchReceiptSchema=obj({designRevision:Type.Literal('2026-10-15'),id:short,loopVersion:Type.Union([Type.Literal(1),Type.Literal(2)]),round:Type.Integer({minimum:1}),hypothesisId:short,hypothesisRevision:short,hypothesis:text,previousHypothesisId:Type.Optional(short),boundary:BoundaryViewSchema,loadedResources:Type.Optional(Type.Array(ResourceRefSchema)),attempts:Type.Array(AttemptRefSchema),review:Type.Optional(ScientificReviewSchema),proofArchive:Type.Optional(obj({status:en(['saved','pending']),ref:Type.Optional(proofRef)})),coverageComplete:Type.Boolean(),stopRequested:Type.Boolean()});
