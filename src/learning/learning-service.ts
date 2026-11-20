import {DirectedRouteInputError,directedRouteSelection,directedRoutePresentation,type DirectedRouteQuery} from './directed-route.js';
import {knowledgeRefKey} from './knowledge-network.js';
import {knowledgeLearningSchema,freezeKnowledgeLearning,publishKnowledgeLearning,knowledgeLearningBinding,type KnowledgeLearningView} from './knowledge-learning.js';
import { usesV3Proof } from '../research/versions/v3/proof-version.js';
import type {StrategyAdmissionRecipeV3} from './strategy-admission-v3.js';
import {networkReviewSchemaV1,type NetworkReviewContextV1,type NetworkReviewOutputV1} from './network-review-v1.js';
import {validateLearningPresentation,METHOD_RELATION_GUIDANCE_V2,METHOD_FIBER_GUIDANCE_V3,ROUTE_PROPOSAL_V4} from '../runtime/learning-presentation.js';
import {capacityOriginForReservationV3,readCapacityOriginV3} from './capacity-reservation.js';
import type {ResearchConfigV21} from '../research/contracts/v21.js';
import {freezeCapacityConfigV3,originatingBudgetV3,validateCapacityPolicyV3,budgetControlsEnabledV3} from '../research/versions/v3/capacity-policy.js';
import { KnowledgeCandidateValidationErrorV3, allowedKnowledgeKindsV3, type KnowledgeReviewRevisionV3, type KnowledgeRejectionV3 } from './v3-knowledge.js';
import {guidanceHashV3} from '../research/versions/v3/guidance-budget.js';
import { modernOptionalRevision, optionalArchiveRelation } from './research-data.js';
import type { ResearchProjectV0, EpochRecordV0 } from '../research/contracts/v0.js';
import { join } from 'node:path';
import { Type } from 'typebox';
import { atomicWrite, exists, readJson } from '../storage/atomic.js';
import type { ResearchProjectV21, EpochRecordV21 } from '../research/contracts/v21.js';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import type { EndedAttempt, ResearchReceipt } from '../research/contracts/review.js';
import { TagsSchema } from '../research/contracts/review.js';
import type { ModelSelection, RoleBudget } from '../research/contracts/v1.js';
import type { LearningAttempt, LearningCall, LearningPurpose, LearningRuntime } from '../runtime/learning-task.js';
import { learningIssues, learningRole } from '../runtime/learning-task.js';
import { LearningFallbackError } from '../runtime/learning-fallback.js';
import { ResearchLibrary } from './research-library.js';
import { LearningDataError, sourceKey, type AnomalyInput, type LearningSource, type ProofRef, type ResourceInput, type DecisionProposal, type ResourceKind, type ResourceMeta, type OptionalDecisionEvidence, type WeightUpdateOutcome } from './research-data.js';
import { invalidateReviewedEvidenceV21, optionalArtifactEvidenceKeyV21 } from './v21-checkpoint.js';
import { stableHash } from './research-hash.js';
import { digestV0, validateArchiveSelectionV0 } from '../research/versions/v0/state.js';
import { TagsSchemaV21, validTagsV21 } from '../research/versions/v21/tags.js';
import { OPTIONAL_MODE_V21, type OptionalTheoristResultV21 } from '../research/versions/v21/optional-types.js';
import { validateOptionalProofSelectionV21 } from '../research/versions/v21/optional-proof.js';

const outputBinding=(job:Job)=>stableHash({call:job.frozenCall,output:job.output,...(job.readResources!==undefined?{readResources:job.readResources}:{})});
const capacityBinding=(job:{budget:RoleBudget;promptRevision?:string;presentationRevision?:LearningCall['presentationRevision'];projectId:string;model?:ModelSelection;capacitySettings?:ResearchConfigV21})=>stableHash({budget:job.budget,promptRevision:job.promptRevision,projectId:job.projectId,model:job.model,...(job.presentationRevision?{presentationRevision:job.presentationRevision}:{}),...(job.capacitySettings?{capacitySettings:job.capacitySettings}:{})});
type Status = 'queued' | 'running' | 'completed' | 'no-change' | 'failed' | 'paused';
interface Job {
  createdAt?:string;
  maintenanceReferral?:true;
  modelDirectedKnowledge?:true;
  directedView?:Awaited<ReturnType<ResearchLibrary['freezeKnowledgeView']>>;
  directedPages?:{query:DirectedRouteQuery;hash:string}[];
  directedSelections?:number[];directedOpens?:KnowledgeLearningView['entries'];
  nativeHandoff?:'native-handoff-v1';
  knowledgeNetworkRevision?:'knowledge-network-v1';knowledgeNetworkView?:KnowledgeLearningView;knowledgeNetworkOutcome?:{status:'published'|'rejected';reason?:string};
  networkReviewRecipe?: LearningCall['networkReviewRecipe'];
  networkReviewRequest?: {id:string;version:number;expectedRevision:string;requestId:string};
  strategyAdmissionRecipe?:StrategyAdmissionRecipeV3; structuralAdmissionHash?:string;
  frozenCall?: LearningCall; outputBinding?:string; readResources?:{id:string;version:number}[];
  capacityBinding?:string;capacitySettings?:ResearchConfigV21;
  resourceReadRecipe?: 'frozen-learning-resources-v1'; resourceReadGrants?: LearningCall['resourceReadGrants'];
  methodNetworkRetrievalRevision?: LearningCall['methodNetworkRetrievalRevision'];
  methodNetworkRecipe?: LearningCall['methodNetworkRecipe']; methodNetworkParent?:number; methodNetworkParentRevision?:string; methodNetworkAllowedRefs?:{id:string;version:number}[]; methodNetworkOutcome?:{status:'published'|'rejected';reason?:string;version?:number};
  knowledgeReviewRevision?: KnowledgeReviewRevisionV3;
  knowledgeRecipe?: 'source-scoped-knowledge-v1'; knowledgeParent?: number; knowledgeOutcome?: KnowledgeRejectionV3; weightOutcome?: WeightUpdateOutcome;
  promptRevision?: 'categorized-v1' | 'compact-english-v1' | 'compact-english-v2'|'compact-english-v3'|'compact-english-v4'|'compact-english-v5'|'compact-english-v6'|'compact-english-v7'|'compact-english-v8'|'compact-english-v9'|'compact-english-v10'|'compact-english-v11'|'compact-english-v12'|'compact-english-v13'|'compact-english-v14';
  presentationRevision?: LearningCall['presentationRevision'];
  strategySupportRecipe?: LearningCall['strategySupportRecipe'];
  methodSupportRecipe?: 'method-support-v1';
  metadataRecipe?: 'optional-metadata-v1';
  methodScopeRevision?: 'explicit-applicability-v1';
  id: string; projectId: string; purpose: LearningPurpose; status: Status; input: unknown;
  model?: ModelSelection; budget: RoleBudget; sources: LearningSource[]; expectedVersion?: number;
  operationId?: string; message?: string; usage?: unknown;
  parents: Record<string, { id: string; version: number }>;
  rawEvidence?: {sessionId:string;judgments:Record<string,string>};
  optionalEvidence?: OptionalDecisionEvidence; optionalCaseGroupId?: string; publicationParentFrozen?: boolean;
  requestState?: 'not-started' | 'sent' | 'returned'; output?: unknown; attempts?: LearningAttempt[]; elapsedMs?: number;
  formatRepair?: { output: unknown; issues: string[]; usage: unknown; budget: RoleBudget; attempts?: LearningAttempt[]; elapsedMs?: number };
}
interface RegistrationFailure { id: string; projectId: string; stage: string; receipt: ResearchReceipt; code: string; message: string }
interface Ledger { proofReceipts?: Record<string, ProofRef>; schemaVersion: 1; receipts: string[]; jobs: Job[]; registrationFailures?: RegistrationFailure[]; optionalStoppedProjects?: string[]; optionalStopEpochs?: Record<string,number> }
interface Options {
  networkReviewConfig?: () => ResearchConfigV21;
  directory: string; library: ResearchLibrary; runtime: Partial<LearningRuntime>;
  moderatorModel: () => ModelSelection | undefined; foregroundBusy: () => boolean;
  changed?: () => void;
}
const text = Type.String({ minLength: 1, maxLength: 100000 });
const strings = Type.Array(text, { maxItems: 100 });
const resourceSchema = Type.Object({ semanticKey: text, name: text, description: text, tags: TagsSchema, conditions: strings, body: text }, { additionalProperties: false });
const titledResourceSchema = Type.Object({
  semanticKey:text, title:Type.String({minLength:1,maxLength:500,pattern:'\\S'}), description:text,
  tags:TagsSchema, conditions:strings, body:Type.String({minLength:1}),
}, {additionalProperties:false});
type ResourceFields = Omit<ResourceInput, 'id' | 'kind' | 'sourceRefs' | 'generalizable'>;
type SubmittedResource = Omit<ResourceFields, 'name' | 'title'> & ({name:string;title?:never} | {title:string;name?:never});
function namedResource(resource:SubmittedResource):ResourceFields {
  return resource.title!==undefined?{...resource,name:resource.title}:resource;
}
const decisionSchema = Type.Object({ factors: Type.Array(Type.Object({ id: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' }), description: Type.String({ minLength: 1, maxLength: 4000, pattern: '\\S' }), weight: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }), rules: Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 32, description: 'Scoped criteria for evaluating, ranking or allocating research effort, not concrete proof steps, solution formulas or scientific conclusions.' }) }, { additionalProperties: false });
const outputSchema = (purpose: LearningPurpose, metadataRecipe?: Job['metadataRecipe'], knowledgeRecipe?:Job['knowledgeRecipe'],promptRevision?:Job['promptRevision'],weightGrant=false,knowledgeReviewRevision?:KnowledgeReviewRevisionV3,methodNetworkRecipe?:Job['methodNetworkRecipe'],strategySupportRecipe?:Job['strategySupportRecipe'],presentationRevision?:Job['presentationRevision'],knowledgeNetworkRevision?:Job['knowledgeNetworkRevision']) => purpose === 'network-review' ? networkReviewSchemaV1 : purpose === 'proof-feedback' ? Type.Object({ assessment: Type.String({minLength:1,maxLength:4000}) }, {additionalProperties:false}) : Type.Object({
  action: Type.Union([Type.Literal('publish'), Type.Literal('no-change')]),
  ...(knowledgeNetworkRevision?{knowledgeProposal:Type.Optional(knowledgeLearningSchema)}:{}),
  ...(purpose==='method-skill'&&['compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(promptRevision??'')||purpose==='v2-strategy'&&strategySupportRecipe==='strategy-support-v1'?{independentRebuild:Type.Optional(Type.Object({justification:Type.String({minLength:1,maxLength:4000,pattern:'\\S'})},{additionalProperties:false}))}:{}),
  ...(purpose==='v2-strategy'&&['compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(promptRevision??'')?{weightUpdate:Type.Optional(Type.Unknown({description:promptRevision==='compact-english-v14'&&!weightGrant?'Not authorized: no frozen weight grant. Omit weightUpdate; any supplied candidate is rejected independently of Strategy publication.':'Optional numeric-only candidate: {weights:{M,R,D,N,E},reason:string}. Omit by default; malformed candidates are rejected independently of Strategy publication.'}))}:{}),
  ...(knowledgeRecipe?{knowledgeCandidates:Type.Optional(knowledgeReviewRevision==='exact-source-knowledge-v2'?Type.Unknown({description:'Optional array (at most 16): {kind,sourceKey,excerpt,summary?}. Choose kind only from knowledgeEligibility[sourceKey]; quote an exact 8–2000 character excerpt. Invalid optional batches are rejected independently of method publication.'}):Type.Array(Type.Object({kind:Type.Union(['reminder','application','counterexample','operation-proposal'].map(k=>Type.Literal(k))),sourceKey:text,excerpt:Type.String({minLength:8,maxLength:2000}),summary:Type.Optional(Type.String({minLength:1,maxLength:2000}))},{additionalProperties:false}),{maxItems:16}))}:{}),
  ...(methodNetworkRecipe?{networkProposal:Type.Optional(Type.Unknown({description:((['concise-learning-v4','concise-learning-v5','concise-learning-v6'].includes(presentationRevision??''))?ROUTE_PROPOSAL_V4:'Optional reviewed navigation proposal for this published resource: {route:{title,summary,transformation,topics,conditions,outputs,checks,failures,roles:[{name,kind:input|output,description}],alternatives:[{id,version}]},links?:[{to:{id,version},relation,basis,bridgeConditions,score?}]}. Use only exact frozen methodNetwork route targets and granted resource alternatives. The host binds owner/version/sources. Navigation is not evidence or applicability. Malformed proposals are rejected independently of the primary resource.'+(['method-network-learning-v2','method-network-learning-v3'].includes(methodNetworkRecipe)?' topics, conditions, outputs, checks, failures and bridgeConditions are string arrays; roles, alternatives and links are arrays of objects as nested above; empty arrays are valid.':'')+(['concise-learning-v2','concise-learning-v3'].includes(presentationRevision??'')?' '+METHOD_RELATION_GUIDANCE_V2:'')+(presentationRevision==='concise-learning-v3'?' '+METHOD_FIBER_GUIDANCE_V3:''))}))}:{}),
  ...(metadataRecipe ? {derivedMetadata: Type.Array(Type.Object({sourceKey:text,tags:TagsSchemaV21,summary:Type.String({minLength:1,maxLength:10000,pattern:'\\S'})},{additionalProperties:false}),{maxItems:64})} : {}),
  ...(purpose === 'v1-decision' || purpose === 'v2-strategy' ? { processedSources: Type.Array(text, { maxItems: 64 }) } : {}),
  ...(purpose.endsWith('decision') ? { decision: Type.Optional(decisionSchema), patterns: Type.Optional(strings) } : { resource: Type.Optional(presentationRevision==='concise-learning-v6'?titledResourceSchema:promptRevision==='compact-english-v14'?Type.Object({...resourceSchema.properties,body:Type.String({minLength:1})},{additionalProperties:false}):['compact-english-v4','compact-english-v5','compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(promptRevision??'')?Type.Object({...resourceSchema.properties,body:Type.String({minLength:1,maxLength:12000})},{additionalProperties:false}):['compact-english-v2','compact-english-v3'].includes(promptRevision??'')?Type.Object({...resourceSchema.properties,body:Type.String({minLength:1,maxLength:12000,pattern:'^(?:[^\\n]{0,240}\\n){0,99}[^\\n]{0,240}$'})},{additionalProperties:false}):resourceSchema) }),
}, { additionalProperties: false });

function unpublishedWeights(output:unknown,version:number):WeightUpdateOutcome {
  return output!==null&&typeof output==='object'&&Object.hasOwn(output,'weightUpdate')
    ?{status:'rejected',reason:'Weight changes require a published Strategy.'}
    :{status:'unchanged',version};
}

/** One durable background lane. Research checkpoints own the facts; this service owns only dispatch. */
export class LearningService {
  private ledger: Ledger = { schemaVersion: 1, receipts: [], jobs: [] };
  private writes: Promise<unknown> = Promise.resolve();
  private checkpoints: Promise<unknown> = Promise.resolve();
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private persistenceFailure?: Error;
  private blockedJobId?: string;
  private constructor(private readonly options: Options) {}
  static async open(options: Options): Promise<LearningService> {
    const service = new LearningService(options), filename = join(options.directory, 'jobs.json');
    if (await exists(filename)) {
      service.ledger = await readJson<Ledger>(filename);
      if (service.ledger.schemaVersion !== 1 || !Array.isArray(service.ledger.jobs) || !Array.isArray(service.ledger.receipts) || service.ledger.registrationFailures !== undefined && !Array.isArray(service.ledger.registrationFailures)) throw new Error('Invalid learning queue.');
      for(const job of service.ledger.jobs){validateLearningPresentation(job);
        if(job.purpose==='network-review'&&(!job.networkReviewRequest||(job.input as NetworkReviewContextV1)?.recipe!=='manual-network-review-v1'||job.operationId||job.methodNetworkRecipe||job.knowledgeRecipe||job.resourceReadRecipe))throw new Error('Invalid manual navigation review boundary.');
        if(job.strategyAdmissionRecipe!==undefined&&job.strategyAdmissionRecipe!=='structural-review-v1')throw new Error('Unsupported frozen Strategy admission recipe.');
        if(job.structuralAdmissionHash!==undefined&&(!job.operationId||job.structuralAdmissionHash!==stableHash(service.options.library.snapshot().operations[job.operationId]?.structuralAdmission)))throw new Error('Frozen structural admission binding changed.');
        if(job.methodNetworkRecipe!==undefined&&(!['method-network-learning-v1','method-network-learning-v2','method-network-learning-v3'].includes(job.methodNetworkRecipe)||job.promptRevision!=='compact-english-v14'||!['method-skill','v2-strategy'].includes(job.purpose)))throw new Error('Unsupported frozen method network learning recipe.');
        if(job.methodNetworkRecipe&&job.frozenCall&&job.methodNetworkParent===undefined)throw new Error('Missing frozen method network parent.');
        if(job.methodNetworkParent!==undefined&&(!job.methodNetworkRecipe||!Number.isSafeInteger(job.methodNetworkParent)||job.methodNetworkParent<0||!Array.isArray(job.methodNetworkAllowedRefs)))throw new Error('Invalid frozen method network learning grants.');
      }
      if(service.ledger.jobs.some(job=>job.knowledgeReviewRevision!==undefined&&(job.knowledgeReviewRevision!=='exact-source-knowledge-v2'||job.promptRevision!=='compact-english-v14'||job.knowledgeRecipe!=='source-scoped-knowledge-v1'||job.purpose!=='method-skill')))throw new Error('Unsupported frozen exact-source knowledge review.');
      if(service.ledger.jobs.some(job=>job.knowledgeRecipe!==undefined&&(job.knowledgeRecipe!=='source-scoped-knowledge-v1'||job.purpose!=='method-skill')))throw new Error('Unsupported frozen V3 knowledge recipe.');
      if (service.ledger.jobs.some(job => job.methodScopeRevision !== undefined && (job.methodScopeRevision !== 'explicit-applicability-v1' || job.purpose !== 'method-skill'))) throw new Error('Unsupported frozen method scope revision.');
      if (service.ledger.jobs.some(job => job.metadataRecipe !== undefined && job.metadataRecipe !== 'optional-metadata-v1')) throw new Error('Unsupported frozen metadata recipe.');
      if (service.ledger.jobs.some(job => job.promptRevision !== undefined && !['categorized-v1','compact-english-v1','compact-english-v2','compact-english-v3','compact-english-v4','compact-english-v5','compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision))) throw new Error('Unsupported frozen learning prompt revision.');
      if(service.ledger.jobs.some(job=>job.methodSupportRecipe!==undefined&&(job.methodSupportRecipe!=='method-support-v1'||job.purpose!=='method-skill'||!['compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision??''))))throw new Error('Unsupported frozen method support recipe.');
      if(service.ledger.jobs.some(job=>job.resourceReadRecipe!==undefined&&(job.resourceReadRecipe!=='frozen-learning-resources-v1'||!['method-skill','failure-skill','v2-strategy'].includes(job.purpose)||!['compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision??''))||job.resourceReadGrants!==undefined&&(!job.resourceReadRecipe||job.resourceReadGrants.recipe!==job.resourceReadRecipe)))throw new Error('Unsupported frozen learning resource grants.');
      for(const job of service.ledger.jobs){if(job.budget?.capacityPolicy!==undefined){validateCapacityPolicyV3(job.budget.capacityPolicy);if(job.capacityBinding!==capacityBinding(job))throw new Error('Frozen learning capacity binding mismatch.');if(job.promptRevision!=='compact-english-v14')throw new Error('Capacity policy requires v14 learning content.');}else if(job.promptRevision==='compact-english-v14'||job.capacityBinding!==undefined)throw new Error('Missing frozen v14 learning capacity.');}
      for(const job of service.ledger.jobs)if(job.frozenCall&&stableHash(job.frozenCall)!==stableHash(service.callFor(job)))throw new Error('Frozen learning call binding mismatch.');
      for(const job of service.ledger.jobs)if(job.frozenCall&&job.output!==undefined&&job.outputBinding!==outputBinding(job))throw new Error('Frozen learning output binding mismatch.');
      // Earlier v14 queue outputs did not carry consumed authority. Recover it only
      // from the same exact runtime output, never infer [] from missing history.
      for(const job of service.ledger.jobs)if(job.frozenCall&&job.output!==undefined&&job.readResources===undefined){
        const recovery=await options.runtime.recoverLearning?.(structuredClone(job.frozenCall));
        if(recovery?.status!=='publish-output'||stableHash(recovery.result.output)!==stableHash(job.output)||!recovery.result.readResources)throw new Error('Missing exact consumed learning authority; reconciliation required.');
        job.readResources=structuredClone(recovery.result.readResources);job.outputBinding=outputBinding(job);
      }
      // Durable output can be applied without another paid request; unknown calls cannot.
      for (const job of service.ledger.jobs.filter(job => job.status === 'running'||job.status==='failed'&&job.requestState==='sent'&&job.frozenCall)) {
        const operation = job.operationId ? options.library.snapshot().operations[job.operationId] : undefined;
        if (operation && ['completed', 'no-change'].includes(operation.status)) {
          job.status = operation.status as Status;
          if(['compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision??'')&&job.purpose==='v2-strategy'&&operation.weightDecision)job.weightOutcome=structuredClone(operation.weightUpdate?.outcome??unpublishedWeights(job.output,operation.weightDecision.version));
        }
        else if (job.output !== undefined || job.requestState === 'not-started') job.status = 'queued';
        else if(job.frozenCall&&options.runtime.recoverLearning){
          const recovery=await options.runtime.recoverLearning(structuredClone(job.frozenCall));
          if(recovery.status==='publish-output'){
            const result=recovery.result;if(result.maintenanceReferral)job.maintenanceReferral=true;job.output=result.output;job.usage=result.usage;job.attempts=result.attempts;job.elapsedMs=result.elapsedMs;job.requestState='returned';job.status='queued';job.readResources=structuredClone(result.readResources??[]);job.outputBinding=outputBinding(job);
          }else if(recovery.status==='known-unsent'||recovery.status==='resume-continuation')job.status='queued';
          else {job.status='failed';job.message='Interrupted model call requires reconciliation; its sent state and exact evidence are preserved.';}
          // Rearm only this exact frozen call's positively recovered reservation.
          // Unknown/admitted-without-output never enters this transition.
          if(job.status==='queued'&&operation?.status==='failed')await options.library.setReviewStatus(job.operationId!, 'paused', 'Exact frozen continuation recovered; original review reservation retained.');
        }
        else {
          job.status = 'failed'; job.message = 'Interrupted model call; consumption is unknown. Saved evidence remains available.';
          if (job.operationId) await options.library.setReviewStatus(job.operationId, 'failed', job.message);
        }
      }
      // A completed review can outlive its queue report. Restore only the durable
      // exact job receipt, without reopening a model call or republishing navigation.
      for(const job of service.ledger.jobs)if(job.methodNetworkRecipe&&!job.methodNetworkOutcome&&['completed','no-change'].includes(job.status)){
        const saved=options.library.snapshot().methodNetworkOutcomesV3?.[job.id];
        if(saved){const {hash:_hash,...outcome}=saved;job.methodNetworkOutcome=structuredClone(outcome);
          if(outcome.status==='rejected')job.message=[job.message,`Optional method network proposal rejected: ${outcome.reason}`].filter(Boolean).join(' ');
        }
      }
      // Old unfinished jobs lacked frozen resource parents; never invent those parents on restart.
      for (const job of service.ledger.jobs) job.parents ??= {};
      await service.save();
    }
    return service;
  }
  private callFor(job:Job):LearningCall {
    const schema=outputSchema(job.purpose,job.metadataRecipe,job.knowledgeRecipe,job.promptRevision,!!(job.operationId&&this.options.library.snapshot().operations[job.operationId]?.weightDecision),job.knowledgeReviewRevision,job.methodNetworkRecipe,job.strategySupportRecipe,job.presentationRevision,job.knowledgeNetworkRevision);
    const input=job.formatRepair?{frozenInput:job.input,invalidResponse:job.formatRepair.output,validationErrors:job.formatRepair.issues,
      instruction:'Repair this saved response to the current schema using the same frozen evidence. Preserve scientific content, applicability and source identity. Do not invent new findings or silently broaden scope.'}:job.input;
    return {...(job.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{}),...(job.nativeHandoff?{nativeHandoff:job.nativeHandoff}:{}),...(job.strategySupportRecipe?{strategySupportRecipe:job.strategySupportRecipe}:{}),...(job.methodNetworkRetrievalRevision?{methodNetworkRetrievalRevision:job.methodNetworkRetrievalRevision}:{}),...(job.methodNetworkRecipe?{methodNetworkRecipe:job.methodNetworkRecipe}:{}),...(job.presentationRevision?{presentationRevision:job.presentationRevision}:{}),...(job.resourceReadGrants?{resourceReadGrants:structuredClone(job.resourceReadGrants)}:{}),...(job.methodScopeRevision?{methodScopeRevision:job.methodScopeRevision}:{}),...(job.promptRevision?{promptRevision:job.promptRevision}:{}),
      id:job.id,projectId:job.projectId,purpose:job.purpose,model:job.model!,budget:job.budget,input,outputSchema:schema,
      ...(job.networkReviewRecipe?{networkReviewRecipe:job.networkReviewRecipe}:{}),
      ...(job.promptRevision==='compact-english-v14'?{continuationGeneration:job.formatRepair?1:0,sourceBinding:stableHash({...(job.knowledgeNetworkView?{knowledgeNetwork:knowledgeLearningBinding(job.knowledgeNetworkView)}:{}),...(job.directedView?{directedView:job.directedView.revision}:{}),sources:job.sources,parents:job.parents,expectedVersion:job.expectedVersion,rawEvidence:job.rawEvidence,optionalEvidence:job.optionalEvidence,operationId:job.operationId,knowledgeRecipe:job.knowledgeRecipe,knowledgeParent:job.knowledgeParent,methodSupportRecipe:job.methodSupportRecipe,metadataRecipe:job.metadataRecipe,...(job.strategySupportRecipe?{strategySupportRecipe:job.strategySupportRecipe}:{}),...(job.strategyAdmissionRecipe?{strategyAdmissionRecipe:job.strategyAdmissionRecipe}:{}),...(job.structuralAdmissionHash?{structuralAdmissionHash:job.structuralAdmissionHash}:{}),...(job.knowledgeReviewRevision?{knowledgeReviewRevision:job.knowledgeReviewRevision}:{}),...(job.methodNetworkRetrievalRevision?{methodNetworkRetrievalRevision:job.methodNetworkRetrievalRevision}:{}),...(job.methodNetworkRecipe?{methodNetworkRecipe:job.methodNetworkRecipe,methodNetworkParent:job.methodNetworkParent,...(job.methodNetworkParentRevision?{methodNetworkParentRevision:job.methodNetworkParentRevision}:{}),methodNetworkAllowedRefs:job.methodNetworkAllowedRefs}:{})})}:{})};
  }
  /** Actual dispatch rechecks displayed navigation; publication rechecks only actual scientific sources/use. */
  async validateLearningCall(call:LearningCall,readResources:readonly {id:string;version:number}[]=[],navigationDelivery=true):Promise<()=>void> {
    const job=this.ledger.jobs.find(j=>j.id===call.id&&j.projectId===call.projectId);
    if(!job||job.status!=='running'||!job.frozenCall||stableHash(job.frozenCall)!==stableHash(this.callFor(job))||stableHash({...call,model:job.frozenCall.model,budget:job.frozenCall.budget})!==stableHash(job.frozenCall))throw new Error('Frozen learning call binding mismatch.');
    if(job.structuralAdmissionHash){const operation=job.operationId&&this.options.library.snapshot().operations[job.operationId];if(!operation||stableHash(operation.structuralAdmission)!==job.structuralAdmissionHash)throw new Error('Frozen structural admission changed.');const allowOwn=!navigationDelivery&&(operation.structuralAdmission?.parentStrategies??[]).every(ref=>this.options.library.snapshot().resources[ref.id]?.version===ref.version||this.ownStrategyPublication(job,ref,this.options.library.snapshot()));await this.options.library.validateStructuralReviewV3(job.operationId!,allowOwn);}
    for(;;){
    const generation=this.options.library.snapshot().generation;
    if(job.purpose==='network-review') {
      if(readResources.length)throw new Error('Manual navigation review has no external resource-read grant.');
      await this.options.library.validateUserNetworkReview(job.input as NetworkReviewContextV1);
      const assertCurrent=()=>{if(this.options.library.snapshot().generation!==generation||job.status!=='running'||stableHash(job.frozenCall)!==stableHash(this.callFor(job)))throw new Error('Manual review authority changed before dispatch.');};
      assertCurrent();return assertCurrent;
    }
    if(this.optionalJobStopped(job))throw new Error('Project STOP prevents learning continuation.');
    this.assertOptionalAdmission(job,!navigationDelivery);
    if(job.sources.length)await this.options.library.validateSources(job.sources);
    if(job.methodNetworkRecipe&&navigationDelivery){
      const navigation=(job.input as {methodNetwork?:{routes?:import('./method-network-v3.js').RouteTemplateV3[]}}).methodNetwork;
      if(!navigation||!Array.isArray(navigation.routes))throw new Error('Missing frozen learning navigation.');
      await this.options.library.validateLearningMethodNetworkV3(navigation.routes);
    }
    if(navigationDelivery&&job.directedView&&job.directedPages?.length){
      const library=this.options.library,view=job.directedView,current=await library.freezeKnowledgeView(),allowed=await library.availableKnowledgeRefs(view.refs);
      for(const page of job.directedPages){const result=directedRoutePresentation(directedRouteSelection(view.network,page.query,allowed,current.network));if(stableHash(result)!==page.hash)throw new LearningDataError('STALE_SOURCE','An exposed route page changed before dispatch.');}
    }
    if(job.modelDirectedKnowledge&&job.directedOpens?.length){const refs=job.directedOpens.map(e=>e.node.ref);if((await this.options.library.availableKnowledgeRefs(refs)).length!==refs.length)throw new LearningDataError('STALE_SOURCE','An opened learning comparison was withdrawn.');}
    for(const ref of readResources)await this.readGrantedResource(job,ref,!navigationDelivery&&this.ownStrategyPublication(job,ref,this.options.library.snapshot()));
    // The closure is a synchronous authority fence. Transport invokes it at its
    // visibility point, without an await before publishing/sending. Any committed
    // library change or STOP invalidates the checked snapshot, including changes
    // that occurred while validation or dispatch receipts were being persisted.
    const assertCurrent=()=>{
      if(this.optionalJobStopped(job)||this.options.library.snapshot().generation!==generation||job.status!=='running'||stableHash(job.frozenCall)!==stableHash(this.callFor(job)))throw new Error('Learning admission authority changed before publication.');
    };
    // Independent map maintenance may commit during exact read validation. Recheck the same frozen inputs before issuing a new authority fence.
    if(job.modelDirectedKnowledge&&this.options.library.snapshot().generation!==generation)continue;
    assertCurrent();return assertCurrent;
    }
  }
  private save(): Promise<void> {
    const bytes = JSON.stringify(this.ledger, null, 2) + '\n';
    const write = this.writes.then(() => atomicWrite(join(this.options.directory, 'jobs.json'), bytes));
    this.writes = write.catch(() => {}); return write;
  }
  tasks(projectId?: string) {
    return [...this.ledger.jobs.filter(job => !projectId || job.projectId === projectId).map(job => {
      const blocked = this.persistenceFailure && (job.id === this.blockedJobId || ['queued', 'running'].includes(job.status));
      const message = blocked ? this.persistenceFailure!.message : job.message;
      const resource=(job.output as {resource?:SubmittedResource}|undefined)?.resource;
      const name=resource?.title??resource?.name;
      return { id: job.id, projectId: job.projectId, ...(typeof name==='string'?{name}:{}),createdAt:job.createdAt??this.options.library.learningEventTime(job.id,job.operationId), ...(job.maintenanceReferral?{maintenanceReferral:true as const}:{}),
        kind: job.purpose === 'proof-feedback' || job.purpose==='network-review' ? 'review' : job.purpose.endsWith('decision') ? 'decision' : job.purpose === 'v2-strategy' ? 'strategy' : 'skill',
        status: blocked ? job.id === this.blockedJobId ? 'failed' as const : 'paused' as const : job.status, ...(job.methodNetworkOutcome?{methodNetworkOutcome:structuredClone(job.methodNetworkOutcome)}:{}), ...(message ? { message } : {}) };
    }),
      ...(this.ledger.registrationFailures ?? []).filter(item => !projectId || item.projectId === projectId).map(item => ({ id: item.id, projectId: item.projectId, kind: 'publication', status: 'failed' as const, message: item.message }))];
  }
  async networkReviewStatus(ref:{id:string;version:number}) {
    // A status read must not overtake a trigger already preparing its durable record.
    await this.checkpoints;
    const job=this.ledger.jobs.findLast(job=>job.purpose==='network-review'&&job.networkReviewRequest?.id===ref.id&&job.networkReviewRequest.version===ref.version);
    return job?this.networkReviewView(job):null;
  }
  private networkReviewView(job:Job) {
    const request=job.networkReviewRequest!;
    const blocked=!!this.persistenceFailure&&['queued','running'].includes(job.status),message=blocked?this.persistenceFailure!.message:job.message;
    const {candidateCount,includedCount,omittedCount}=(job.input as NetworkReviewContextV1).coverage;
    return {id:job.id,resource:{id:request.id,version:request.version},status:blocked?(job.id===this.blockedJobId?'failed' as const:'paused' as const):job.status,coverage:{candidateCount,includedCount,omittedCount},...(message?{message}:{})};
  }
  requestNetworkReview(request:{id:string;version:number;expectedRevision:string;requestId:string}) {
    const action=this.checkpoints.then(async()=>{
      if(this.closing||this.persistenceFailure)throw new LearningDataError('CONFLICT','Learning is stopping or its storage needs recovery.');
      const id=stableHash(['manual-network-review-v1',request.requestId]).slice(0,40),prior=this.ledger.jobs.find(job=>job.id===id);
      if(prior){if(stableHash(prior.networkReviewRequest)!==stableHash(request))throw new LearningDataError('CONFLICT','Review request ID was reused.');return this.networkReviewView(prior);}
      const active=this.ledger.jobs.find(job=>job.purpose==='network-review'&&job.networkReviewRequest?.id===request.id&&job.networkReviewRequest.version===request.version&&['queued','running','paused'].includes(job.status));
      if(active)return this.networkReviewView(active);
      const generation=this.options.library.snapshot().generation;
      if(request.expectedRevision!==stableHash({generation}))throw new LearningDataError('CONFLICT','Library changed. Refresh before reassessing.');
      const config=this.options.networkReviewConfig?.();if(!config)throw new LearningDataError('INVALID_INPUT','Workspace learning settings are unavailable.');
      const capacitySettings=freezeCapacityConfigV3(config),model=capacitySettings.roleModels?.moderator??this.options.moderatorModel();
      if(!model||!this.options.runtime.runLearning)throw new LearningDataError('INVALID_INPUT','Configure the workspace Moderator model before reassessing.');
      const input=await this.options.library.prepareUserNetworkReview(request,generation);
      const sources=[...new Map([input.target,...input.candidates].flatMap(value=>value.meta.sourceRefs).map(source=>[stableHash(source),source])).values()];
      const job:Job={id,projectId:'knowledge_tree',purpose:'network-review',networkReviewRecipe:'manual-network-review-v1',networkReviewRequest:structuredClone(request),status:'queued',requestState:'not-started',input,sources,parents:{},promptRevision:'compact-english-v14',model:structuredClone(model),budget:structuredClone(capacitySettings.roleBudget),capacitySettings};
      job.capacityBinding=capacityBinding(job);job.frozenCall=structuredClone(this.callFor(job));job.createdAt=new Date().toISOString();this.ledger.jobs.push(job);
      await this.save();this.wake();this.options.changed?.();return this.networkReviewView(job);
    });this.checkpoints=action.catch(()=>{});return action;
  }
  /** Explicit host action: one known-invalid saved response, with its original remaining allowance. */
  retryFailedOutput(id: string): Promise<boolean> {
    const action = this.checkpoints.then(async () => {
      const job = this.ledger.jobs.find(item => item.id === id);
      if (this.closing || this.persistenceFailure || !job || job.status !== 'failed' || job.requestState !== 'returned' || job.output === undefined || job.formatRepair) return false;
      const issues = learningIssues(job.output, outputSchema(job.purpose,job.metadataRecipe,job.knowledgeRecipe,job.promptRevision,!!(job.operationId&&this.options.library.snapshot().operations[job.operationId]?.weightDecision),job.knowledgeReviewRevision,job.methodNetworkRecipe,job.strategySupportRecipe,job.presentationRevision,job.knowledgeNetworkRevision)), state = this.options.library.snapshot();
      if (!issues.length || state.appliedUpdates[job.id]) return false;
      if (job.sources.some(ref => 'kind' in ref ? state.failures[ref.id]?.version !== ref.version : state.proofs[ref.caseId]?.semanticRevision !== ref.semanticRevision || state.proofs[ref.caseId]?.status !== 'valid' || state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`])) return false;
      if (job.purpose.endsWith('decision') && state.decisions[job.purpose === 'v1-decision' ? '1' : '2'].version !== job.expectedVersion) return false;
      const budget = budgetControlsEnabledV3(job.budget.capacityPolicy)?{ ...job.budget, softDeadlineAt: job.budget.softDeadlineAt ?? Date.now() - (job.elapsedMs ?? 0) + job.budget.timeoutMs }:structuredClone(job.budget);
      if (job.operationId) await this.options.library.setReviewStatus(job.operationId, 'paused', 'Known invalid saved output explicitly scheduled for one bounded format repair.');
      job.formatRepair = { output: structuredClone(job.output), issues, usage: structuredClone(job.usage), budget: structuredClone(job.budget), elapsedMs: job.elapsedMs, ...(job.attempts ? { attempts: structuredClone(job.attempts) } : {}) };
      job.budget = budget;if(job.capacityBinding)job.capacityBinding=capacityBinding(job); job.status = 'queued'; job.requestState = 'not-started'; delete job.frozenCall; delete job.outputBinding; delete job.readResources; delete job.output; delete job.usage; delete job.message; delete job.attempts; delete job.elapsedMs;
      await this.save(); this.wake(); return true;
    });
    this.checkpoints = action.catch(() => {}); return action;
  }
  /** Explicit user assessment: only a frozen archived final proof, no exploration grants. */
  async reviewProof(project: Readonly<AnyResearchProject>, epochId: string, ref: ProofRef, assessment: string): Promise<void> {
    if (ref.sessionId !== project.id) throw new Error('Review proof must belong to this session.');
    const id = stableHash(['proof-feedback', project.id, epochId, ref, assessment]).slice(0,40);
    if (this.ledger.jobs.some(job => job.id === id)) return;
    const proof = await this.options.library.proofReader([ref]).read(ref);
    this.add({id,projectId:project.id,purpose:'proof-feedback',status:'queued',input:{proof,userAssessment:assessment},sources:[ref],
      model:project.config.roleModels?.moderator ?? this.options.moderatorModel() ?? project.config.defaultModel,
      ...(project.schemaVersion===3&&usesV3Proof(project.researchLoopVersion)?{budget:originatingBudgetV3(project.config),capacitySettings:freezeCapacityConfigV3(project.config)}:{budget:structuredClone(project.config.roleBudget)}),parents:{},requestState:'not-started'});
    await this.save(); this.wake(); this.options.changed?.();
  }
  private async saveReceipt(id:string):Promise<void> {
    this.ledger.receipts.push(id);
    try { await this.save(); } catch(error) {
      this.ledger.receipts=this.ledger.receipts.filter(receipt=>receipt!==id);
      throw error;
    }
  }
  private add(job: Job): void {
    if(this.ledger.jobs.some(prior=>prior.id===job.id))return;
    const proofs=this.options.library.snapshot().proofs;
    const sourceLoop=(job.input as {sourceLoopVersion?:unknown}|null)?.sourceLoopVersion;
    if(sourceLoop==='4.0'||job.sources.length>0&&job.sources.every(ref=>!('kind'in ref)&&proofs[ref.caseId]?.sourceLoopVersion==='4.0'))job.nativeHandoff='native-handoff-v1';
    if(job.purpose==='v2-strategy'&&job.sources.some(r=>'caseId'in r&&proofs[r.caseId]?.optionalProof?.modelDirectedKnowledge))job.modelDirectedKnowledge=true;
    if(job.modelDirectedKnowledge)job.nativeHandoff='native-handoff-v1';
    const op3=job.sources.some(ref=>!('kind'in ref)&&usesV3Proof(proofs[ref.caseId]?.sourceLoopVersion)&&['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(proofs[ref.caseId]?.optionalProof?.operationRevision??''));
    const op5=job.sources.some(ref=>!('kind'in ref)&&['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(proofs[ref.caseId]?.optionalProof?.operationRevision??''));
    const promptRevision=job.promptRevision??(job.budget?.capacityPolicy?'compact-english-v14':op5?'compact-english-v11':op3?'compact-english-v2':'compact-english-v1');
    const presentationRevision=promptRevision!=='compact-english-v14'?undefined
      :job.modelDirectedKnowledge&&['method-skill','failure-skill','v2-strategy'].includes(job.purpose)?'concise-learning-v6' as const
      :['method-skill','v2-strategy'].includes(job.purpose)?'concise-learning-v3' as const:undefined;
    const methodNetworkRecipe=promptRevision==='compact-english-v14'&&op3&&job.sources.every(ref=>!('kind'in ref)&&usesV3Proof(proofs[ref.caseId]?.sourceLoopVersion))&&['method-skill','v2-strategy'].includes(job.purpose)?'method-network-learning-v3' as const:undefined;
    const knowledgeNetworkRevision=job.modelDirectedKnowledge||methodNetworkRecipe&&job.sources.every(ref=>!('kind'in ref)&&proofs[ref.caseId]?.sourceLoopVersion==='4.0')?'knowledge-network-v1' as const:undefined;
    this.ledger.jobs.push({...job,createdAt:new Date().toISOString(),...(knowledgeNetworkRevision?{knowledgeNetworkRevision}:{}),promptRevision,...(methodNetworkRecipe&&job.purpose==='method-skill'?{strategyAdmissionRecipe:'structural-review-v1' as const}:{}),...(promptRevision==='compact-english-v14'&&job.purpose==='v2-strategy'?{strategySupportRecipe:'strategy-support-v1' as const}:{}),...(methodNetworkRecipe?{methodNetworkRecipe,methodNetworkRetrievalRevision:'query-relevance-v3' as const}:{}),...(presentationRevision?{presentationRevision}:{}),...(job.budget?.capacityPolicy?{capacityBinding:capacityBinding({...job,promptRevision,...(presentationRevision?{presentationRevision}:{})})}:{}),...(['compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(promptRevision??'')&&job.purpose==='method-skill'?{methodSupportRecipe:'method-support-v1' as const}:{}),...(['compact-english-v6','compact-english-v7','compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(promptRevision??'')&&['method-skill','failure-skill','v2-strategy'].includes(job.purpose)?{resourceReadRecipe:'frozen-learning-resources-v1' as const}:{})});
  }
  proofReceipt(id: string): ProofRef | undefined { const ref = this.ledger.proofReceipts?.[id]; return ref ? structuredClone(ref) : undefined; }
  checkpoint(input: { project: Readonly<AnyResearchProject>; receipt: Readonly<ResearchReceipt>; endedAttempts?: readonly EndedAttempt[] }): Promise<void> {
    const next = this.checkpoints.then(() => this.recordCheckpoint(input)); this.checkpoints = next.catch(() => {}); return next;
  }
  onCheckpointV0(project:Readonly<ResearchProjectV0>,epoch:Readonly<EpochRecordV0>):Promise<void> {
    const frozenProject=structuredClone(project),frozenEpoch=structuredClone(epoch);
    const action=this.checkpoints.then(async()=>{
      if(frozenProject.status==='stopped'||frozenEpoch.cancelled)return;
      const receiptId=`v0-learning-2:${frozenProject.id}:${frozenEpoch.id}`,archive=frozenEpoch.archive;
      if(this.ledger.receipts.includes(receiptId)||archive?.status!=='saved'||!archive.proofRef)return;
      validateArchiveSelectionV0(archive.selection);
      if(!archive.selection.outcome.reproducible)return;
      if(archive.selectionHash!==digestV0(archive.selection)||archive.selection.projectId!==frozenProject.id||archive.selection.epochId!==frozenEpoch.id)throw new Error('V0 learning archive identity mismatch.');
      if(!frozenEpoch.solve||frozenEpoch.solve.technical.executionStatus!=='completed'||frozenEpoch.solve.technical.completeness!=='complete'||frozenEpoch.metadataStatus==='unassessed')return;
      if(stableHash(frozenEpoch.solve.outcome)!==stableHash(archive.selection.outcome)||stableHash(frozenEpoch.solve.answerRef)!==stableHash(archive.selection.answerRef))throw new Error('V0 learning requires the exact accepted outcome.');
      const ref=archive.proofRef;
      if(!this.options.library.isProofValid(ref)||this.options.library.snapshot().proofs[ref.caseId]?.semanticRevision!==ref.semanticRevision)return;
      const source=await this.options.library.readFinalProof(ref,{role:'theorist',sessionId:frozenProject.id});
      if(source.meta.sourceLoopVersion!=='0'||source.meta.v0OriginalAnswers?.length!==1||stableHash(source.meta.v0OriginalAnswers[0])!==stableHash(archive.selection.answerRef))throw new Error('V0 learning requires exact original provenance.');
      if((archive.selection.outcome.verdict==='refuted')!==(source.meta.logicalRelation==='counterexample'))throw new Error('V0 refutation must retain counterexample archive semantics.');
      if(['solved','refuted'].includes(archive.selection.outcome.verdict)&&archive.selection.outcome.reproducible && !this.ledger.jobs.some(job=>job.purpose==='method-skill'&&job.sources.some(s=>!('kind' in s)&&s.caseId===ref.caseId&&s.semanticRevision===ref.semanticRevision)))
        this.add({id:stableHash(['v0-method',ref.caseId,ref.semanticRevision]).slice(0,40),projectId:frozenProject.id,purpose:'method-skill',status:'queued',
          input:{sourceLoopVersion:'0',proof:source,...this.skillCatalog('method-skill',source.meta.tags)},sources:[ref],model:frozenProject.config.roleModels?.theorist??frozenProject.config.defaultModel,
          budget:structuredClone(frozenProject.config.roleBudget),...(frozenProject.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(frozenProject.config)}:{}),parents:this.frozenParents(),requestState:'not-started'});
      // The archived selection/outcome is evidence, not a new foreground form.
      // Freeze the current shared parent separately from the policy actually used.
      const decision=this.options.library.snapshot().decisions['2'];
      this.add({id:stableHash(['v0-decision',ref.caseId,ref.semanticRevision]).slice(0,40),projectId:frozenProject.id,purpose:'v2-decision',status:'queued',
        input:{sourceLoopVersion:'0',decision,observedPolicy:frozenEpoch.snapshot.decision,proof:source,
          routeReceipt:frozenEpoch.selection,archivedRoute:archive.selection.way,outcome:archive.selection.outcome,
          opportunity:'Inspect whether this exact completed case reveals a general or explicitly scoped route-evaluation criterion. A single success or refutation does not calibrate p, prove comparative superiority, or justify weight changes by itself. Return no-change when evidence is insufficient.'},
        sources:[ref],expectedVersion:decision.version,model:frozenProject.config.roleModels?.theorist??frozenProject.config.defaultModel,
        budget:structuredClone(frozenProject.config.roleBudget),...(frozenProject.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(frozenProject.config)}:{}),parents:this.frozenParents(),requestState:'not-started'});
      await this.queueModerator(frozenProject,'v2-strategy');
      await this.saveReceipt(receiptId);this.wake();
    });
    this.checkpoints=action.catch(()=>{});return action;
  }
  onCheckpointV21(project:Readonly<ResearchProjectV21>, epoch:Readonly<EpochRecordV21>):Promise<void> {
    const frozenProject={...structuredClone(project),...(epoch.snapshot.capacityPolicy?{config:structuredClone(epoch.snapshot.config)}:{})},frozenEpoch=structuredClone(epoch);
    const action=this.checkpoints.then(async()=>{
      if (frozenEpoch.solverMode === OPTIONAL_MODE_V21) {
        await this.recordOptionalCheckpointV21(frozenProject,frozenEpoch);
        return;
      }
      if(frozenProject.status==='stopped'||frozenEpoch.decision==='stop')return;
      const receiptId=`v21:${frozenProject.id}:${frozenEpoch.id}`;
      if(this.ledger.receipts.includes(receiptId)||!frozenEpoch.review) return;
      const actor={role:'theorist' as const,sessionId:frozenProject.id};
      const reviewed=frozenEpoch.review.decisions;
      // Startup recovery also re-applies this idempotent gate; live Loop awaits it before archive.
      await invalidateReviewedEvidenceV21(this.options.library,frozenProject,frozenEpoch.review);
      const judgments=Object.fromEntries(reviewed.filter(decision=>!frozenEpoch.review!.invalidatedAnswerIds.includes(decision.answerId)).map(decision=>[decision.answerId,stableHash(decision)]));
      const exactRead=Object.fromEntries(frozenProject.answers.filter(answer=>reviewed.some(decision=>decision.answerId===answer.id && decision.answerHash===answer.bodyHash && decision.questionRevision===answer.questionRevision) && frozenEpoch.review!.answerDeliveries.some(delivery=>stableHash(delivery.answerRef)===stableHash(answer.answerRef)&&delivery.endByte>delivery.startByte&&delivery.body.length>0)).map(answer=>[answer.id,answer.bodyHash]));
      await this.options.library.acknowledgeAttempts(frozenProject.id,exactRead);
      const qualifiedProofs:ProofRef[]=[];
      for(const archive of frozenEpoch.archives) {
        if(archive.status!=='saved'||!archive.proofRef||!archive.selection.closure.rootClosed) continue;
        const ref=archive.proofRef;
        if(!this.options.library.isProofValid(ref)) continue;
        const source=await this.options.library.readFinalProof(ref,actor);
        if(source.meta.sourceLoopVersion!=='2.1'||!source.meta.originalAnswers?.length) throw new Error('V2.1 learning requires exact original provenance.');
        if(frozenEpoch.theoristMode==='judgment-batch-v1'){if(archive.selection.closure.reproducible!==true)continue;if(stableHash(source.meta.originalAnswers)!==stableHash(archive.selection.answers)||archive.selectionHash!==stableHash(archive.selection)||archive.selection.projectId!==frozenProject.id||archive.selection.epochId!==frozenEpoch.id)throw new Error('V2.1 qualified archive provenance mismatch.');}
        qualifiedProofs.push(ref);
        const learned=this.ledger.jobs.some(job=>job.purpose==='method-skill' && job.sources.some(s=>!('kind' in s)&&s.caseId===ref.caseId&&s.semanticRevision===ref.semanticRevision));
        if(!learned) this.add({id:stableHash(['v21-method',ref.caseId,ref.semanticRevision]).slice(0,40),projectId:frozenProject.id,purpose:'method-skill',status:'queued',
          input:{sourceLoopVersion:'2.1',proof:source,...this.skillCatalog('method-skill',source.meta.tags)},sources:[ref],
          model:frozenProject.config.roleModels?.theorist??frozenProject.config.defaultModel,budget:structuredClone(frozenProject.config.roleBudget),...(frozenProject.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(frozenProject.config)}:{}),
          parents:this.frozenParents(),requestState:'not-started'});
      }
      const jobBase={projectId:frozenProject.id,status:'queued' as const,model:frozenProject.config.roleModels?.theorist??frozenProject.config.defaultModel,
        budget:structuredClone(frozenProject.config.roleBudget),...(frozenProject.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(frozenProject.config)}:{}),parents:this.frozenParents(),requestState:'not-started' as const};
      for(const failure of frozenEpoch.review.failures??[]) {
        const answers=frozenProject.answers.filter(answer=>failure.answerIds.includes(answer.id));
        if(!failure.scientific||!failure.generalizable||answers.length!==failure.answerIds.length||new Set(answers.map(answer=>answer.attemptId)).size<2
          ||answers.some(answer=>answer.projectId!==frozenProject.id||answer.executionStatus!=='completed'||answer.completeness!=='complete'
            ||answer.hypothesisRevision!==frozenEpoch.review!.hypothesisRevision
            ||!reviewed.some(decision=>decision.answerId===answer.id&&decision.answerHash===answer.bodyHash&&decision.resultKind==='scientific-failure'&&decision.status==='rejected'))) continue;
        const sources:LearningSource[]=[];
        for(const answer of answers) sources.push(await this.options.library.recordFailure({id:`failure_${stableHash([frozenProject.id,answer.id,failure.patternKey]).slice(0,32)}`,
          sourceLoopVersion:'2.1',rawAnswer:answer.answerRef,judgmentHash:judgments[answer.id],sessionId:frozenProject.id,attemptId:answer.id,workerId:answer.attemptId,patternKey:failure.patternKey,summary:failure.summary,
          body:JSON.stringify({sourceLoopVersion:'2.1',answer,review:reviewed.find(decision=>decision.answerId===answer.id)}),tags:failure.tags,scientific:true},actor));
        this.add({...jobBase,id:stableHash(['v21-failure',sources]).slice(0,40),purpose:'failure-skill',input:{sourceLoopVersion:'2.1',pattern:failure,answers,...this.skillCatalog('failure-skill',failure.tags)},sources});
      }
      const batch=frozenEpoch.theoristMode==='judgment-batch-v1';
      if(frozenEpoch.review.decisionOpportunity||batch&&qualifiedProofs.length){
        const decision=batch?this.options.library.snapshot().decisions['2']:frozenEpoch.snapshot.decision;
        this.add({...jobBase,id:stableHash(['v21-decision',receiptId]).slice(0,40),purpose:'v2-decision',rawEvidence:{sessionId:frozenProject.id,judgments},
          input:{sourceLoopVersion:'2.1',decision,...(batch?{observedPolicy:frozenEpoch.snapshot.decision,plan:frozenEpoch.plan,qualifiedArchives:qualifiedProofs}:{}),opportunity:frozenEpoch.review.decisionOpportunity??'Inspect this exact qualified archived case for a general or scoped route/allocation criterion. Success or valid refutation alone does not calibrate probabilities or establish comparative superiority. Return no-change if insufficient.',review:frozenEpoch.review},sources:batch?qualifiedProofs:[],expectedVersion:decision.version});
      }
      await this.queueModerator(frozenProject,'v2-strategy');
      // Pending per-Way archive work must be revisited after archive-only recovery.
      if(frozenEpoch.archives.every(archive=>archive.status==='saved')) await this.saveReceipt(receiptId);
      else await this.save();
      this.wake();
    });
    this.checkpoints=action.catch(()=>{}); return action;
  }
  /** STOP pauses only unadmitted optional learning; already returned outputs stay durable. */
  async pauseOptionalProject(projectId: string, epoch?: number): Promise<void> {
    this.ledger.optionalStoppedProjects ??= [];
    if (!this.ledger.optionalStoppedProjects.includes(projectId)) this.ledger.optionalStoppedProjects.push(projectId);
    if (epoch !== undefined && Number.isSafeInteger(epoch) && epoch >= 0) {
      this.ledger.optionalStopEpochs ??= {};
      this.ledger.optionalStopEpochs[projectId] = Math.max(this.ledger.optionalStopEpochs[projectId] ?? 0,epoch);
    }
    for (const job of this.ledger.jobs) if (this.optionalJobStopped(job)
      && job.status === 'queued' && job.requestState === 'not-started') {
      job.status = 'paused'; job.message = 'Project STOP prevents new optional learning calls; saved evidence is retained.';
    }
    await this.save(); this.options.changed?.();
  }
  private optionalJobStopped(job: Job): boolean {
    if (!job.optionalCaseGroupId) return false;
    const stopped = this.ledger.optionalStoppedProjects ?? [];
    const proofs = this.options.library.snapshot().proofs;
    return stopped.includes(job.projectId) || job.sources.some(source=>!('kind' in source)
      && proofs[source.caseId]?.optionalProof && stopped.includes(source.sessionId));
  }
  private async recordOptionalCheckpointV21(project: Readonly<ResearchProjectV21>, epoch: Readonly<EpochRecordV21>): Promise<void> {
    if(epoch.snapshot.capacityPolicy)project={...project,config:structuredClone(epoch.snapshot.config)};
    const flow = epoch.optionalFlow;
    if (!flow) throw new Error('Optional learning requires its explicitly pinned flow.');
    const stopEpoch = this.ledger.optionalStopEpochs?.[project.id];
    const stillStopped = this.ledger.optionalStoppedProjects?.includes(project.id) && (stopEpoch === undefined || epoch.epoch <= stopEpoch);
    if (project.status === 'stopped' || epoch.decision === 'stop' || flow.phase === 'stopped'
      || stillStopped) {
      await this.pauseOptionalProject(project.id,epoch.epoch); return;
    }
    // An explicitly started later epoch may learn new evidence; STOP-paused jobs
    // from the earlier epoch are not silently replayed.
    if (this.ledger.optionalStoppedProjects?.includes(project.id)) {
      this.ledger.optionalStoppedProjects = this.ledger.optionalStoppedProjects.filter(id=>id!==project.id);
      await this.save();
    }
    const library = this.options.library, actor = {role:'theorist' as const,sessionId:project.id};
    if (flow.conflictArtifactIds.length) {
      await library.invalidateOptionalProofSources(flow.conflictArtifactIds,actor); return;
    }
    // An immutable open observation is available to Theorist decision learning,
    // but is never thereby promoted to a qualified proof or scientific failure.
    const reviewed = flow.artifacts.filter(artifact => artifact.qualification !== 'needs-review');
    const evidence = Object.fromEntries(reviewed.map(artifact => [artifact.id,optionalArtifactEvidenceKeyV21(artifact)]));
    await library.recordV21OptionalEvidence(project.id,evidence,actor);
    const currentEvidence = library.snapshot().v21OptionalEvidence?.[project.id] ?? {};
    const validEvidence = Object.fromEntries(Object.entries(evidence).filter(([id,hash])=>currentEvidence[id]===hash));
    await this.registerOptionalFailuresV21(project,epoch,validEvidence);
    const qualified: {ref:ProofRef; source:Awaited<ReturnType<ResearchLibrary['readFinalProof']>>}[] = [];
    for (const archive of flow.archives) {
      if (archive.status !== 'saved' || !archive.proofRef || !library.isProofValid(archive.proofRef)) continue;
      validateOptionalProofSelectionV21(archive.selection);
      if (archive.selectionHash !== stableHash(archive.selection) || archive.selection.projectId !== project.id
        || archive.selection.epochId !== epoch.id || archive.artifactId !== archive.selection.artifact.id)
        throw new Error('Optional learning archive identity mismatch.');
      const artifact = archive.selection.artifact;
      const currentArtifact=flow.artifacts.find(a=>a.id===artifact.id);
      if(!currentArtifact||currentArtifact.qualification!=='valid'||stableHash([currentArtifact.acceptedOutcome,currentArtifact.adoptionReason,currentArtifact.judgment])!==stableHash([artifact.acceptedOutcome,artifact.adoptionReason,artifact.judgment])) continue;
      if (validEvidence[artifact.id] !== optionalArtifactEvidenceKeyV21(artifact)
        || archive.selection.dependencies.some(dependency => validEvidence[dependency.id] !== optionalArtifactEvidenceKeyV21(dependency))) continue;
      const source = await library.readFinalProof(archive.proofRef,actor), provenance = source.meta.optionalProof;
      if(source.meta.status!=='valid')continue;
      if (!provenance || source.meta.sourceLoopVersion !== project.researchLoopVersion || provenance.artifactId !== artifact.id
        || provenance.caseGroupId !== archive.selection.caseGroupId || provenance.authorRole !== artifact.authorRole
        || stableHash(provenance.originalRef) !== stableHash(artifact.originalRef)
        || stableHash(provenance.acceptedOutcome) !== stableHash(artifact.acceptedOutcome)
        || provenance.resultContract!==archive.selection.resultContract
        || provenance.resultContract && source.meta.logicalRelation!==optionalArchiveRelation(provenance.acceptedOutcome,provenance.resultContract))
        throw new Error('Optional learning requires exact role-neutral archive provenance.');
      // Classification is a background responsibility, not a scientific admission
      // gate. Exact closed/reproducible provenance above remains mandatory.
      qualified.push({ref:archive.proofRef,source});
    }
    if (!qualified.length) { await this.save(); this.wake(); return; }
    // Every supplied scientific route fact must share the job's exact revocable
    // evidence support. Tombstoned or superseded observations stay audit-only.
    // No interrupted or technically failed route becomes a scientific failure.
    const pairedRouteOutcomes = flow.artifacts.flatMap((artifact,sequence) =>
      validEvidence[artifact.id] !== optionalArtifactEvidenceKeyV21(artifact) ? [] : [{
      artifactId:artifact.id,authorRole:artifact.authorRole,methodKey:artifact.route.methodKey,routeReason:artifact.route.reason,
      qualification:artifact.qualification,executionStatus:artifact.technical.executionStatus,completeness:artifact.technical.completeness,
      sequence,originalOutcome:structuredClone(artifact.control.outcome),technical:structuredClone(artifact.technical),
      scientificOutcome:artifact.acceptedOutcome ?? null,exposureArtifactIds:[...artifact.exposureArtifactIds],
      ...(artifact.adoptionReason?{adoptionReason:artifact.adoptionReason}:{}),
    }]);
    const mainSequence=flow.artifacts.filter(artifact=>artifact.authorRole==='theorist');
    const routeTransitions=mainSequence.slice(1).flatMap((artifact,index)=>{
      const previous=mainSequence[index]!;
      // Pair original adjacent main artifacts before checking support; removing
      // an unavailable middle observation must not invent a new transition.
      if (validEvidence[previous.id] !== optionalArtifactEvidenceKeyV21(previous)
        || validEvidence[artifact.id] !== optionalArtifactEvidenceKeyV21(artifact)) return [];
      return previous.route.methodKey===artifact.route.methodKey?[]:[{kind:'observed-main-method-change',fromArtifactId:previous.id,
        toArtifactId:artifact.id,fromMethodKey:previous.route.methodKey,toMethodKey:artifact.route.methodKey,
        previousOutcomeReason:previous.control.outcome.reason,previousGaps:[...previous.control.outcome.gaps],
        newRouteReason:artifact.route.reason,interpretation:'This records consecutive main-proof route choices, not a host-inferred scientific failure or causal claim.'}];
    });
    const branchStates = flow.branches.map(branch=>({id:branch.id,kind:branch.kind,state:branch.state,artifactId:branch.artifactId??null}));
    const caseGroups = new Map<string,typeof qualified>();
    for (const item of qualified) {
      const key = item.source.meta.optionalProof!.caseGroupId;
      (caseGroups.get(key) ?? (caseGroups.set(key,[]),caseGroups.get(key)!)).push(item);
    }
    const receiptId = `v21-optional-learning-2:${project.id}:${epoch.id}:${stableHash({evidenceRevision:flow.evidenceRevision,
      proofs:qualified.map(item=>item.ref),evidence:validEvidence,branchStates})}`;
    if (this.ledger.receipts.includes(receiptId)) { await this.queueModerator(project,'v2-strategy'); this.wake(); return; }
    const base = {projectId:project.id,status:'queued' as const,model:project.config.roleModels?.theorist??project.config.defaultModel,
      budget:structuredClone(project.config.roleBudget),...(project.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(project.config)}:{}),parents:this.frozenParents(),requestState:'not-started' as const,publicationParentFrozen:false};
    for (const [caseGroupId,items] of caseGroups) {
      const evidenceKeys = items.map(item=>item.source.meta.optionalProof!.evidenceKey).sort();
      const optionalEvidence = {sessionId:project.id,artifacts:validEvidence};
      const methods = new Map<string,typeof qualified>();
      for (const item of items) (methods.get(item.source.meta.methodKey) ?? (methods.set(item.source.meta.methodKey,[]),methods.get(item.source.meta.methodKey)!)).push(item);
      for (const [methodKey,proofs] of methods) {
        const methodEvidenceKeys = proofs.map(item=>item.source.meta.optionalProof!.evidenceKey).sort();
        // A new prompt revision must not re-admit the same evidence when an older
        // queued/admitted/terminal job already owns it, even after receipt recovery.
        if (this.ledger.jobs.some(job=>job.purpose==='method-skill' && job.optionalCaseGroupId===caseGroupId
          && (job.input as {proof?:{meta?:{methodKey?:string}}}).proof?.meta?.methodKey===methodKey
          && stableHash((job.input as {evidenceKeys?:string[]}).evidenceKeys??[])===stableHash(methodEvidenceKeys))) continue;
        const incompleteMetadata = proofs.filter(item=>modernOptionalRevision(item.source.meta.optionalProof?.operationRevision)
          && item.source.meta.optionalProof?.learningEligibility==='metadata-incomplete');
        const methodScopeRevision = proofs.some(item=>modernOptionalRevision(item.source.meta.optionalProof?.operationRevision)) ? 'explicit-applicability-v1' as const : undefined;
        const metadataRecipe = incompleteMetadata.length ? 'optional-metadata-v1' as const : undefined;
        const metadataSources = incompleteMetadata.filter(item=>!library.derivedProofMetadata(item.ref));
        this.add({...base,...(epoch.snapshot.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{}),...(usesV3Proof(project.researchLoopVersion)&&!epoch.snapshot.knowledgeMapRevision?{knowledgeRecipe:'source-scoped-knowledge-v1' as const}:{}),...(metadataRecipe?{metadataRecipe}:{}),...(methodScopeRevision?{methodScopeRevision}:{}),id:stableHash(['v21-optional-method',caseGroupId,methodKey,methodEvidenceKeys,...(metadataRecipe?[metadataRecipe]:[]),...(methodScopeRevision?[methodScopeRevision]:[])]).slice(0,40),
          purpose:'method-skill',optionalCaseGroupId:caseGroupId,optionalEvidence,
          input:{sourceLoopVersion:project.researchLoopVersion,solverMode:OPTIONAL_MODE_V21,caseGroupId,evidenceRevision:flow.evidenceRevision,
            evidenceKeys:methodEvidenceKeys,proof:proofs[0]!.source,qualifiedArchives:proofs.map(item=>item.source),
            ...(metadataRecipe?{metadataDerivation:{recipeVersion:metadataRecipe,sources:metadataSources.map(item=>({sourceKey:sourceKey(item.ref),ref:item.ref})),
              instruction:epoch.snapshot.modelDirectedKnowledge?'Index each archived original with supported tags and a concise case summary. Preserve its assumptions, verdict and limits. Copy sourceKey exactly. Omit a source if a contradiction prevents reliable classification. Return [] if none qualify. Indexing neither establishes the result nor requires publishing a Skill. Leave originals intact.':'In this same method-learning response derive truthful classification tags and a concise case summary from each exact archived original. This is indexing metadata, not a new proof or scientific acceptance. Preserve assumptions, solved versus refuted result and limitations. Never invent default subject tags, strengthen claims or rewrite originals. Return sourceKey exactly. If scientific contradiction prevents trustworthy classification, omit that source; an empty derivedMetadata array is valid. Method publication remains independently justified; metadata may accompany no-change.'}}:{}),
            pairedRouteOutcomes,routeTransitions,branchStates,...(epoch.snapshot.modelDirectedKnowledge?{}:this.skillCatalog('method-skill',proofs.flatMap(item=>library.derivedProofMetadata(item.ref)?.tags??item.source.meta.tags),!!metadataRecipe)),
            ...(usesV3Proof(project.researchLoopVersion)&&!epoch.snapshot.knowledgeMapRevision?{knowledgeReview:'Optionally return knowledgeCandidates with kind reminder/application/counterexample/operation-proposal, sourceKey from the supplied proof reference, an exact excerpt (8–2000 characters) from that proof as grounding, and optionally summary as a reviewed synthesis preserving source scope and risk. Exact excerpt matching verifies provenance only, never semantic applicability. These are source-scoped navigation reminders, never new theorems. A counterexample needs a valid-refutation source. Operation proposals are quarantined and never executable. Do not generalize a single case or add code.'}:{}),
            evidenceInstructions:epoch.snapshot.modelDirectedKnowledge?'Learn only from qualified final sources. Treat artifacts from one root case as correlated. Preserve each author, exposure and method scope. Exclude cancellations, technical failures and unreviewed or unattempted branches from evidence of scientific failure.':'These are correlated artifacts from one exact root case, not independent successes. Preserve each real author, exposure and method scope. Learn only from the qualified final sources. Technical failure, cancellation, unreviewed and unattempted branches are not scientific failures. Retain the existing method/WaySkill mechanism; do not invent a likelihood/profile store.'},
          sources:proofs.map(item=>item.ref)});
      }
      if(!usesV3Proof(project.researchLoopVersion)||!['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(flow.operationRevision??'')){
      const decision = library.snapshot().decisions['2'];
      this.add({...base,id:stableHash(['v21-optional-decision',caseGroupId,evidenceKeys,validEvidence,branchStates]).slice(0,40),
        purpose:'v2-decision',optionalCaseGroupId:caseGroupId,optionalEvidence,expectedVersion:decision.version,
        input:{sourceLoopVersion:project.researchLoopVersion,solverMode:OPTIONAL_MODE_V21,caseGroupId,evidenceRevision:flow.evidenceRevision,evidenceKeys,
          decision,observedPolicy:epoch.snapshot.decision,qualifiedArchives:items.map(item=>item.source),pairedRouteOutcomes,routeTransitions,branchStates,
          opportunity:'Inspect paired route selection, allocation and switching evidence within the existing shared decision mechanism. This is one root case even when two authors or methods succeeded; exposure makes results correlated. Do not label cancellations, technical failures or unattempted routes as scientific failures, invent counterfactual outcomes, or claim universal probabilities from one case. No new likelihood/profile mechanism is authorized. Preserve method recipes in method-skill and return no-change if no allocation criterion is supported.'},
        sources:items.map(item=>item.ref)});
      }
    }
    await this.queueModerator(project,'v2-strategy');
    await this.saveReceipt(receiptId); this.wake();
  }
  private async registerOptionalFailuresV21(project:Readonly<ResearchProjectV21>,epoch:Readonly<EpochRecordV21>,evidence:Record<string,string>):Promise<void> {
    const flow=epoch.optionalFlow!;
    for(const call of epoch.calls??[]) {
      if(call.task!=='v21_theorist'||call.status!=='completed')continue;
      const result=call.result as OptionalTheoristResultV21|undefined;
      if(result?.technical.executionStatus!=='completed'||result.technical.completeness!=='complete')continue;
      for(const failure of result.control.failures??[]) {
        const artifacts=flow.artifacts.filter(artifact=>failure.artifactIds.includes(artifact.id));
        if(!failure.scientific||!failure.generalizable||new Set(failure.artifactIds).size!==failure.artifactIds.length
          ||artifacts.length!==failure.artifactIds.length||new Set(artifacts.map(artifact=>artifact.originalRef.attemptId)).size<2
          ||new Set(artifacts.map(artifact=>artifact.originalRef.id)).size!==artifacts.length)continue;
        if(artifacts.some(artifact=>artifact.authorRole==='theorist'||artifact.qualification!=='rejected'||artifact.scientificFailure!==true
          ||artifact.technical.executionStatus!=='completed'||artifact.technical.completeness!=='complete'||artifact.originalRef.completeness!=='complete'
          ||artifact.originalRef.projectId!==project.id||artifact.originalRef.owner!==project.id
          ||!artifact.acceptedOutcome||!epoch.snapshot.root||stableHash(artifact.root)!==stableHash(epoch.snapshot.root)
          ||artifact.originalRef.hypothesisId!==artifact.root.hypothesisId||artifact.originalRef.hypothesisRevision!==artifact.root.revision
          ||artifact.judgment?.callId!==call.id||evidence[artifact.id]!==optionalArtifactEvidenceKeyV21(artifact)
          ||artifact.exposureArtifactIds.some(id=>failure.artifactIds.includes(id))
          ||!result.control.adoptions.some(adoption=>adoption.artifactId===artifact.id&&adoption.status==='rejected'&&adoption.scientificFailure===true
            &&stableHash(adoption.outcome)===stableHash(artifact.acceptedOutcome)&&adoption.reason===artifact.adoptionReason)))continue;
        const sources:LearningSource[]=[];
        for(const artifact of artifacts) sources.push(await this.options.library.recordFailure({
          id:`failure_${stableHash([project.id,artifact.id,failure.patternKey]).slice(0,32)}`,sessionId:project.id,
          attemptId:artifact.originalRef.attemptId,workerId:artifact.originalRef.attemptId,sourceLoopVersion:project.researchLoopVersion,
          optionalArtifact:{artifactId:artifact.id,evidenceKey:evidence[artifact.id]!,originalRef:artifact.originalRef,authorRole:artifact.authorRole as 'auxiliary-worker'|'way-worker'},
          patternKey:failure.patternKey,summary:failure.summary,tags:failure.tags,scientific:true,
          body:JSON.stringify({artifact,reviewCallId:call.id,failure})},{role:'theorist',sessionId:project.id}));
        this.add({...(['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(flow.operationRevision??'')?{promptRevision:['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(flow.operationRevision??'')?'compact-english-v14' as const:['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(flow.operationRevision??'')?'compact-english-v11' as const:'compact-english-v2' as const}:{}),...(epoch.snapshot.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{}),id:stableHash(['v21-optional-failure',sources]).slice(0,40),projectId:project.id,purpose:'failure-skill',status:'queued',
          optionalCaseGroupId:flow.archives[0]?.selection.caseGroupId??stableHash([project.id,artifacts[0]!.root]),
          optionalEvidence:{sessionId:project.id,artifacts:Object.fromEntries(artifacts.map(artifact=>[artifact.id,evidence[artifact.id]!]))},
          input:{sourceLoopVersion:project.researchLoopVersion,solverMode:OPTIONAL_MODE_V21,pattern:failure,artifacts,reviewCallId:call.id,
            ...(epoch.snapshot.modelDirectedKnowledge?{}:this.skillCatalog('failure-skill',failure.tags))},sources,model:project.config.roleModels?.theorist??project.config.defaultModel,
          budget:structuredClone(project.config.roleBudget),...(project.config.roleBudget.capacityPolicy?{capacitySettings:structuredClone(project.config)}:{}),parents:this.frozenParents(),requestState:'not-started',publicationParentFrozen:false});
      }
    }
  }
  private frozenParents(): Job['parents'] {
    return Object.fromEntries(Object.values(this.options.library.snapshot().resources).map(resource => [`${resource.kind}:${resource.semanticKey}`, { id: resource.id, version: resource.version }]));
  }
  private async register<T>(projectId: string, receipt: Readonly<ResearchReceipt>, stage: string, action: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await action();
      this.ledger.registrationFailures = this.ledger.registrationFailures?.filter(item => !(item.projectId === projectId && item.receipt.id === receipt.id && item.stage === stage));
      return result;
    }
    catch (error) {
      if (!(error instanceof LearningDataError) || !['INVALID_INPUT', 'CONFLICT', 'FORBIDDEN'].includes(error.code)) throw error;
      const id = `registration_${stableHash([projectId, receipt.id, stage]).slice(0, 32)}`;
      this.ledger.registrationFailures ??= [];
      if (!this.ledger.registrationFailures.some(item => item.id === id)) this.ledger.registrationFailures.push({ id, projectId, stage, receipt: structuredClone(receipt), code: error.code, message: `${stage} registration failed: ${error.message}` });
      await this.save(); this.options.changed?.(); return undefined;
    }
  }
  private skillCatalog(kind: 'method-skill' | 'failure-skill', tags: string[], allowUnclassified = false) {
    const matches = (entry: { tags: string[] }) => entry.tags.filter(tag => tags.includes(tag)).length;
    return {
      existingSkills: Object.values(this.options.library.snapshot().resources).filter(entry => entry.kind === kind && !entry.maintenance?.retired && (matches(entry) || allowUnclassified && !tags.length))
        .sort((a, b) => matches(b) - matches(a) || a.id.localeCompare(b.id)).slice(0, 12)
        .map(({ id, version, semanticKey, name, description, tags: scope, conditions, enabled, status }) => ({ id, version, semanticKey, name: name.slice(0, 200), description: description.slice(0, 600),
          tags: [...scope.filter(tag => tags.includes(tag)), ...scope.filter(tag => !tags.includes(tag))].slice(0, 12), conditions: conditions.slice(0, 6).map(condition => condition.slice(0, 300)), enabled, status,
          scopeTruncated: scope.length > 12 || conditions.length > 6 || conditions.some(condition => condition.length > 300) || description.length > 600 })),
      ...(allowUnclassified && !tags.length?{catalogSelection:'Unfiltered bounded metadata because this source has no classification yet. No tag match or scientific applicability is asserted; inspect exact scope before selecting a semanticKey.'}:{}),
      matchingInstructions: 'This is a bounded metadata catalog, not proof or source exploration. If a listed Skill expresses the same reusable method or corrective check, return its exact semanticKey to revise that Skill; do not create a synonym merely for a new case. Preserve its applicable scope and limitations. scopeTruncated means some metadata is omitted: do not infer that missing conditions are absent or broaden the scope; return no-change if a safe revision requires missing information. Disabled entries remain disabled after revision; their presence is not permission to adopt them. A different scientific method may have a new key. Return no-change when the supplied evidence does not justify a safe revision.',
    };
  }
  private async recordCheckpoint({ project, receipt, endedAttempts = [] }: { project: Readonly<AnyResearchProject>; receipt: Readonly<ResearchReceipt>; endedAttempts?: readonly EndedAttempt[] }): Promise<void> {
    if (this.ledger.receipts.includes(receipt.id) || !receipt.coverageComplete || !receipt.review) return;
    const { library } = this.options, actor = { role: 'theorist' as const, sessionId: project.id }, review = receipt.review;
    const model = project.config.roleModels?.theorist ?? project.config.defaultModel, budget = structuredClone(project.config.roleBudget);
    const job = (purpose: LearningPurpose, key: string, input: unknown, sources: LearningSource[], expectedVersion?: number): Job => ({
      id: stableHash([receipt.id, purpose, key]).slice(0, 40), projectId: project.id, purpose, status: 'queued', input, sources, model, budget, expectedVersion,
      parents: this.frozenParents(), requestState: 'not-started',
    });
    await library.acknowledgeAttempts(project.id, Object.fromEntries(review.attemptsRead.map(ref => [ref.id, ref.version])));
    if (review.affectedChapters?.length) {
      const affected = await this.register(project.id, receipt, 'Affected proof dependencies',
        () => library.invalidateChapterSources(review.affectedChapters!, actor));
      if (!affected) throw new Error('Proof dependency withdrawal is pending; do not publish or learn from unresolved sources.');
    }
    for (const retraction of review.retractProofs ?? []) {
      if (retraction.ref.sessionId !== project.id || !receipt.boundary.proofs?.some(item => stableHash(item.ref) === stableHash(retraction.ref))) continue;
      await this.register(project.id, receipt, 'Proof withdrawal', () => library.invalidateProof(retraction.ref, actor));
    }
    if (review.proof) {
      const prior = Object.values(library.snapshot().proofs).find(p => p.sessionId === project.id && p.hypothesisId === receipt.hypothesisId && p.methodKey === review.proof!.methodKey);
      const ref = this.proofReceipt(receipt.id) ?? await this.register(project.id, receipt, 'Final proof', () => library.publishProof({ ...review.proof!, sessionId: project.id, hypothesisId: receipt.hypothesisId,
        hypothesisRevision: receipt.hypothesisRevision, previousHypothesisId: receipt.previousHypothesisId }, actor, review.proof!.expectedRevision ?? prior?.revision ?? 0));
      if (!ref) throw new Error('Final proof is pending submission; the prior archive and new draft remain intact.');
      if (ref) {
        (this.ledger.proofReceipts ??= {})[receipt.id] = ref; await this.save();
        const source = await library.readFinalProof(ref, actor);
        // Wording-only revisions do not repeat learning; semantic source identity is stable.
        const learned = this.ledger.jobs.some(item => item.purpose === 'method-skill' && item.sources.some(s => !('kind' in s) && s.caseId === ref.caseId && s.semanticRevision === ref.semanticRevision));
        if (!learned) this.add(job('method-skill', ref.caseId, { proof: source, ...this.skillCatalog('method-skill', source.meta.tags) }, [ref]));
      }
    }
    for (const failure of review.failures ?? []) {
      const attempts = endedAttempts.filter(a => failure.attemptIds.includes(a.id));
      if (!failure.generalizable || !failure.scientific || attempts.length !== failure.attemptIds.length || new Set(attempts.map(a => a.workerId)).size < 2
        || attempts.some(attempt => attempt.executionStatus !== 'completed' || attempt.hypothesisRevision !== receipt.hypothesisRevision)) continue;
      const sources: LearningSource[] = [];
      for (const attempt of attempts) {
        const ref = await this.register(project.id, receipt, 'Scientific failure', () => library.recordFailure({ id: `failure_${stableHash([project.id, attempt.id, failure.patternKey]).slice(0, 32)}`,
          sessionId: project.id, attemptId: attempt.id, workerId: attempt.workerId, patternKey: failure.patternKey, summary: failure.summary,
          body: JSON.stringify(attempt), tags: failure.tags, scientific: true }, actor));
        if (ref) sources.push(ref);
      }
      if (sources.length !== attempts.length) continue;
      if (!this.ledger.jobs.some(item => item.purpose === 'failure-skill' && stableHash(item.sources) === stableHash(sources))) this.add(job('failure-skill', failure.patternKey, { pattern: failure, attempts, ...this.skillCatalog('failure-skill', failure.tags) }, sources));
    }
    if (receipt.loopVersion === 1 && review.anomalies?.length) {
      const events = new Map<string, AnomalyInput>(), summaries = new Map<string, Set<string>>(), previous = library.snapshot().anomalies;
      for (const item of [...review.anomalies].sort((a, b) => a.attemptId.localeCompare(b.attemptId) || a.patternKey.localeCompare(b.patternKey))) {
        const attempt = endedAttempts.find(attempt => attempt.id === item.attemptId);
        if (item.scientific !== true || attempt?.executionStatus !== 'completed') continue;
        const round = project.schemaVersion === 1 ? project.rounds.find(round => round.branchIds.includes(attempt.id)) : undefined;
        const id = `anomaly_${stableHash([project.id, round?.number ?? receipt.round, attempt.wayId]).slice(0, 32)}`;
        if (!events.has(id)) events.set(id, { id, sessionId: project.id, attemptId: previous[id]?.attemptId ?? attempt.id,
          summary: '', patternKey: previous[id]?.patternKey ?? item.patternKey, factorVersion: round?.research?.boundary.decision.version ?? receipt.boundary.decision.version });
        const notes = summaries.get(id) ?? new Set<string>(); notes.add(`${item.patternKey}: ${item.summary}`); summaries.set(id, notes);
      }
      for (const [id, event] of events) event.summary = [...summaries.get(id)!].sort().join('\n').slice(0, 6000);
      await library.recordAnomalies([...events.values()], actor);
    }
    if (receipt.loopVersion === 2 && review.decisionOpportunity) this.add(job('v2-decision', 'decision', {
      decision: receipt.boundary.decision, opportunity: review.decisionOpportunity, attempts: endedAttempts,
    }, [], receipt.boundary.decision.version));
    await this.queueModerator(project, receipt.loopVersion === 1 ? 'v1-decision' : 'v2-strategy');
    this.ledger.receipts.push(receipt.id); await this.save(); this.wake();
  }
  private async queueModerator(project: Readonly<AnyResearchProject>, purpose: 'v1-decision' | 'v2-strategy'): Promise<void> {
    return this.reserveModerator({ ...(project.schemaVersion===3&&usesV3Proof(project.researchLoopVersion)?{strategyAdmissionRecipe:'structural-review-v1' as const}:{}),projectId: project.id, model: this.options.moderatorModel(), ...(project.schemaVersion===3&&usesV3Proof(project.researchLoopVersion)?{budget:originatingBudgetV3(project.config,project.config.roleBudget.capacityPolicy),capacitySettings:freezeCapacityConfigV3(project.config)}:{budget:project.config.roleBudget}) }, purpose);
  }
  private async reserveModerator(context: Pick<Job, 'projectId' | 'model' | 'budget' | 'capacitySettings' | 'strategyAdmissionRecipe'>, purpose: 'v1-decision' | 'v2-strategy'): Promise<void> {
    // Recover the narrow crash window between the library reservation and queue publication.
    const recovered = Object.values(this.options.library.snapshot().operations).find(item => item.purpose === purpose && item.status === 'queued' && !this.ledger.jobs.some(job => job.operationId === item.id));
    const operation=recovered?? await this.options.library.prepareReview(purpose,{...(purpose==='v2-strategy'&&context.strategyAdmissionRecipe?{strategyAdmissionRecipe:context.strategyAdmissionRecipe}:{}),strategyWeights:purpose==='v2-strategy',...(context.budget.capacityPolicy?{capacityOrigin:capacityOriginForReservationV3(context)}:{})});
    if (!operation) return;
    const admissionRecipe=recovered?operation.strategyAdmissionRecipe:context.strategyAdmissionRecipe;
    const origin=readCapacityOriginV3(operation);
    if(origin)context={projectId:origin.projectId,model:origin.model,budget:origin.budget,capacitySettings:origin.settings};
    else if(recovered&&context.budget.capacityPolicy){const budget=structuredClone(context.budget);delete budget.capacityPolicy;context={...context,budget,capacitySettings:undefined};}
    const proofs=this.options.library.snapshot().proofs;
    const v8Moderator=purpose==='v2-strategy'&&!!operation.weightDecision&&operation.cases.length>0&&operation.cases.every(item=>usesV3Proof(proofs[item.ref.caseId]?.sourceLoopVersion));
    const promptRevision=context.budget.capacityPolicy?'compact-english-v14' as const:v8Moderator?'compact-english-v13' as const:operation.cases.some(item=>['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(proofs[item.ref.caseId]?.optionalProof?.operationRevision??''))?'compact-english-v7' as const:operation.cases.some(item=>usesV3Proof(proofs[item.ref.caseId]?.sourceLoopVersion)&&['v3-operation-3','v3-operation-4'].includes(proofs[item.ref.caseId]?.optionalProof?.operationRevision??''))?'compact-english-v2' as const:'compact-english-v1' as const;
    const optionalCases = operation.cases.map(item=>proofs[item.ref.caseId]?.optionalProof?.caseGroupId).filter((id):id is string=>Boolean(id));
    this.add({ ...(admissionRecipe?{strategyAdmissionRecipe:admissionRecipe}:{}),...(operation.structuralAdmission?{structuralAdmissionHash:stableHash(operation.structuralAdmission)}:{}),promptRevision, id: operation.id, operationId: operation.id, projectId: context.projectId, purpose, status: 'queued', input: {}, sources: operation.cases.map(c => c.ref),
      expectedVersion: operation.expectedDecisionVersion, model: context.model, budget: structuredClone(context.budget),...(context.capacitySettings?{capacitySettings:structuredClone(context.capacitySettings)}:{}),
      parents: this.frozenParents(), requestState: 'not-started', ...(optionalCases.length?{optionalCaseGroupId:stableHash([...new Set(optionalCases)].sort())}:{}) });
    await this.save();
  }
  wake(): void {
    if (this.closing || this.persistenceFailure || this.running || this.timer || !this.ledger.jobs.some(job => job.status === 'queued')) return;
    this.timer = setTimeout(() => { this.timer = undefined;
      if (this.options.foregroundBusy()) { this.wake(); return; }
      const job = this.ledger.jobs.find(item => item.status === 'queued');
      this.running = this.drainOne().catch(() => {
        // Failed durable bookkeeping must not crash foreground research or keep
        // dispatching paid work. Preserve the ledger/output for restart recovery.
        this.persistenceFailure = new Error('Background learning could not save its state. Automatic learning is paused; saved research is preserved. Resolve local storage and restart CAgE.');
        this.blockedJobId = job?.id;
        try { this.options.changed?.(); } catch { /* Observers cannot restart the lane. */ }
      }).finally(() => { this.running = undefined; this.wake(); });
    }, 100);
    this.timer.unref();
  }
  /** Only the exact already-published fresh Strategy output may explain its own parent advance. */
  private ownStrategyPublication(job:Job,prior:Pick<ResourceMeta,'id'|'version'>,state:ReturnType<ResearchLibrary['snapshot']>):boolean {
    if(job.strategySupportRecipe!=='strategy-support-v1'||job.purpose!=='v2-strategy'||job.requestState!=='returned'||!job.frozenCall||job.outputBinding!==outputBinding(job)||stableHash(job.frozenCall)!==stableHash(this.callFor(job)))return false;
    const output=job.output as {action?:string;resource?:SubmittedResource;processedSources?:string[];independentRebuild?:{justification:string}};
    if(output?.action!=='publish'||!output.resource||!Array.isArray(output.processedSources))return false;
    const parent=job.parents[`specific-strategy:${output.resource.semanticKey}`],receipt=state.appliedUpdates[job.id],current=state.resources[prior.id],operation=job.operationId&&state.operations[job.operationId];
    if(!parent||parent.id!==prior.id||parent.version!==prior.version||!operation||receipt?.kind!=='resource'||receipt.id!==prior.id||receipt.version!==prior.version+1||current?.version!==receipt.version||current.kind!=='specific-strategy'||!current.enabled||current.status!=='valid'||current.semanticKey!==output.resource.semanticKey)return false;
    if(output.processedSources.some(key=>!operation.delivered.includes(key)))return false;
    const sourceRefs=operation.cases.map(c=>c.ref).filter(ref=>output.processedSources!.includes(sourceKey(ref)));
    // Same closed publication payload as publishResource; no inherited refs are new direct inputs.
    const input={...namedResource(output.resource),id:parent.id,kind:'specific-strategy' as const,sourceRefs,generalizable:true};
    const actor={role:'moderator' as const,purpose:'v2-strategy' as const,operationId:job.operationId!};
    const strategySupport={recipe:job.strategySupportRecipe,...(output.independentRebuild?{independentRebuild:output.independentRebuild}:{})};
    return receipt.inputHash===stableHash({input,expectedVersion:parent.version,actor,...(job.optionalEvidence?{optionalEvidence:job.optionalEvidence}:{}),strategySupport,...(job.promptRevision==='compact-english-v14'?{contentPolicyRevision:'compact-english-v14'}:{})});
  }
  private assertOptionalAdmission(job: Job,allowAppliedPublication=false): void {
    if (!job.optionalCaseGroupId && !job.optionalEvidence) return;
    const state = this.options.library.snapshot();
    if (job.optionalEvidence && Object.entries(job.optionalEvidence.artifacts).some(([id,hash])=>state.v21OptionalEvidence?.[job.optionalEvidence!.sessionId]?.[id]!==hash)
      || job.sources.some(ref=>'kind' in ref ? state.failures[ref.id]?.version!==ref.version||!state.failures[ref.id]?.scientific
        : !this.options.library.isProofValid(ref) || state.proofs[ref.caseId]?.semanticRevision !== ref.semanticRevision))
      throw new LearningDataError('STALE_SOURCE','Optional learning evidence changed before background admission.');
    const strategies = (job.input as {strategies?:{meta:{id:string;version:number;status:string}}[]}).strategies ?? [];
    if (strategies.some(({meta})=>(!state.resources[meta.id]?.enabled || state.resources[meta.id]?.version!==meta.version || state.resources[meta.id]?.status!==meta.status)&&!(allowAppliedPublication&&this.ownStrategyPublication(job,meta,state))))
      throw new LearningDataError('STALE_SOURCE','A supplied strategy was disabled or revised before background admission.');
  }
  private async freezeKnowledgeEligibility(job:Job):Promise<void> {
    if(!job.knowledgeRecipe||job.promptRevision!=='compact-english-v14'||job.knowledgeReviewRevision||job.frozenCall||job.requestState!=='not-started'||job.formatRepair)return;
    await this.options.library.validateSources(job.sources);
    const refs=job.sources.filter((ref):ref is ProofRef=>!('kind'in ref));
    const choices=await Promise.all(refs.map(async ref=>[sourceKey(ref),allowedKnowledgeKindsV3(await this.options.library.readFinalProof(ref,{role:'theorist',sessionId:job.projectId}))] as const));
    job.input={...(job.input as Record<string,unknown>),knowledgeEligibility:Object.fromEntries(choices)};
    job.knowledgeReviewRevision='exact-source-knowledge-v2';
  }
  private async freezeMethodNetwork(job:Job):Promise<void> {
    if(!job.methodNetworkRecipe||job.methodNetworkParent!==undefined)return;
    if(job.frozenCall||job.requestState!=='not-started'||job.formatRepair)throw new Error('Missing frozen method network learning grants.');
    if(job.modelDirectedKnowledge){
      const pin=this.options.library.methodNetworkCheckpoint();
      job.methodNetworkParent=pin.version;
      job.methodNetworkParentRevision=pin.revision;
      job.methodNetworkAllowedRefs=[];
      job.input={...(job.input as Record<string,unknown>),methodNetwork:{recipe:job.methodNetworkRecipe,routes:[]}};
      return;
    }
    const refs=(job.resourceReadGrants?.resources??[]).map(({meta})=>({id:meta.id,version:meta.version}));
    const proofs=this.options.library.snapshot().proofs;
    const query=job.sources.flatMap(ref=>{if('kind'in ref)return [];const meta=proofs[ref.caseId];return meta?[meta.target,meta.methodKey,...meta.conditions,...meta.tags]:[];}).join('\n').slice(0,16384);
    const view=await this.options.library.learningMethodNetworkCandidatesV3(query,refs,job.methodNetworkRetrievalRevision);
    job.methodNetworkParent=view.version;job.methodNetworkAllowedRefs=[...new Map([...refs,...view.allowedRefs].map(ref=>[`${ref.id}:${ref.version}`,ref])).values()];
    job.input={...(job.input as Record<string,unknown>),methodNetwork:{recipe:job.methodNetworkRecipe,...view,allowedRefs:job.methodNetworkAllowedRefs,
      notice:job.presentationRevision==='concise-learning-v3'?'Optional reviewed navigation for the newly published resource. '+METHOD_RELATION_GUIDANCE_V2+' '+METHOD_FIBER_GUIDANCE_V3:job.presentationRevision==='concise-learning-v2'?'Optional reviewed navigation for the newly published resource. Use exact displayed route versions for links. '+METHOD_RELATION_GUIDANCE_V2+' Unknown applicability stays unknown. One case is not universal validation.':'Optional reviewed navigation for the newly published resource. Use exact displayed route versions for links; structure similarity, topic similarity, complementarity and evidence differ. Unknown applicability stays unknown. One case is not universal validation.'}};
  }
  private async freezeKnowledgeNetwork(job:Job):Promise<void> {
    if(!job.knowledgeNetworkRevision||job.knowledgeNetworkView)return;
    if(job.frozenCall||job.requestState!=='not-started'||job.formatRepair)throw Error('Missing frozen knowledge learning view');
    if(job.modelDirectedKnowledge){
      if((job.purpose==='method-skill'||job.purpose==='failure-skill')&&Object.keys(job.parents).length){
        const drafts=await this.options.library.maintenanceSkillCandidates(job.purpose,job.sources,job.parents);
        if(drafts.length)job.input={...(job.input as Record<string,unknown>),maintenanceDrafts:drafts,maintenanceDraftNotice:'Optional unreviewed suggestions. Rebuild any chosen card from assigned scientific evidence using its exact semanticKey.'};
      }
      const view=await this.options.library.freezeKnowledgeView();
      const refs=view.refs.filter(r=>r.store==='library');
      job.directedView={...view,refs};job.knowledgeNetworkView={recipe:'knowledge-network-v1',revision:view.revision,networkRevision:view.network.revision,entries:[]};
      job.input={...(job.input as Record<string,unknown>),routeDirectory:directedRoutePresentation(directedRouteSelection(view.network,{mode:'directory'},refs,view.network)),knowledgeNotice:job.presentationRevision==='concise-learning-v6'?'Use lookup_learning_routes and open_learning_route for exact comparisons. In an optional knowledgeProposal, cite opened selections. For a Strategy composed of Skills, put ordered Skill uses, repetitions and local conditions in knowledgeProposal.steps. Keep navigation metadata out of the card body.':(['concise-learning-v4','concise-learning-v5'].includes(job.presentationRevision??''))?'Use lookup_learning_routes to find equivalent entries, then open_learning_route to inspect exact comparisons. Cite opened selections in knowledgeProposal. For a Strategy composed of Skills, preserve step order, repetitions and local conditions.':'Choose comparisons using lookup_learning_routes and open_learning_route. Search for equivalent names before adding a new method or Strategy. Inspect complete coverage before a same-key revision. Cite opened selections for optional knowledgeProposal links or ordered Strategy steps. Derive the method from assigned evidence and preserve local conditions.'};return;
    }
    const proofs=this.options.library.snapshot().proofs;
    const query=job.sources.flatMap(ref=>'caseId'in ref?[proofs[ref.caseId]?.target??'',proofs[ref.caseId]?.methodKey??'']:[]).join(' ');
    job.knowledgeNetworkView=await freezeKnowledgeLearning(this.options.library,query,job.purpose==='v2-strategy'?'strategy-learning':'method-learning');
    job.input={...(job.input as Record<string,unknown>),knowledgeNeighborhood:job.knowledgeNetworkView,
      knowledgeNotice:'Optional knowledgeProposal uses the displayed selections. A Strategy may retain an ordered Skill sequence with repeated occurrences and local conditions. Link only a justified common object, method or process; cross-kind links require similar-process. These are navigation and composition, not truth or mandatory execution. Upstream theories and their explanations are owned by independent theory research.'};
  }
  private async freezeResourceReads(job:Job):Promise<void> {
    if(!job.resourceReadRecipe)return;
    if(job.sources.length)await this.options.library.validateSources(job.sources);
    if(job.resourceReadGrants)return;
    if(job.requestState!=='not-started'||job.formatRepair)throw new Error('Missing immutable learning resource grants.');
    const input=job.input as {existingSkills?:ResourceMeta[];strategies?:{meta:ResourceMeta}[]};
    const entries=job.purpose==='v2-strategy'?(input.strategies??[]).map(value=>value.meta):input.existingSkills??[];
    const kind=job.purpose==='v2-strategy'?'specific-strategy':job.purpose;
    const resources:NonNullable<LearningCall['resourceReadGrants']>['resources']=[];
    const unavailable:NonNullable<NonNullable<LearningCall['resourceReadGrants']>['unavailable']>=[];
    for(const entry of entries){
      const parent=job.parents[`${kind}:${entry.semanticKey}`];
      if(!parent||parent.id!==entry.id||parent.version!==entry.version)throw new Error('Learning resource is outside frozen parent versions.');
      const value=await this.options.library.optionalLearningResource(parent,job.purpose==='v2-strategy'?{role:'moderator',purpose:'v2-strategy',operationId:job.operationId!}:{role:'theorist',sessionId:job.projectId,loopVersion:2},{kind:kind as ResourceKind,semanticKey:entry.semanticKey});
      if(!value.available||entry.enabled===false||entry.status!=='valid'){unavailable.push({...parent,reason:!value.available?value.reason:entry.enabled===false?'disabled':'needs-review'});continue;}
      resources.push({meta:value.meta,body:value.body,bodyHash:guidanceHashV3(value.body)});
    }
    job.resourceReadGrants={recipe:job.resourceReadRecipe,resources,...(unavailable.length?{unavailable}:{})};
  }
  private async drainOne(): Promise<void> {
    const job = this.ledger.jobs.find(item => item.status === 'queued'); if (!job) return;
    let advancedReview = false, metadataRecorded = false;
    try {
      if (this.optionalJobStopped(job) && job.output === undefined) {
        job.status = 'paused'; job.message = 'Project STOP prevents a new optional learning call.'; await this.save(); return;
      }
      this.assertOptionalAdmission(job,true);
      // Only a never-admitted new optional amendment may select its publication
      // parent here. Observed policy and scientific evidence remain frozen.
      if (job.optionalEvidence && !job.publicationParentFrozen && job.requestState === 'not-started' && !job.formatRepair) {
        let input = job.input as Record<string,unknown>;
        if (job.metadataRecipe) {
          const derivation = input.metadataDerivation as {sources:{sourceKey:string;ref:ProofRef}[]};
          input = {...input,metadataDerivation:{...derivation,sources:derivation.sources.filter(item=>!this.options.library.derivedProofMetadata(item.ref))}};
          job.input = input;
        }
        job.parents = this.frozenParents();
        if (job.purpose === 'v2-decision') {
          const decision = this.options.library.snapshot().decisions['2'];
          job.expectedVersion = decision.version; job.input = {...input,decision};
        } else if (!job.modelDirectedKnowledge&&(job.purpose === 'method-skill' || job.purpose === 'failure-skill')) {
          const state = this.options.library.snapshot();
          const tags = job.sources.flatMap(ref=>'kind' in ref?state.failures[ref.id]?.tags??[]:this.options.library.derivedProofMetadata(ref)?.tags??state.proofs[ref.caseId]?.tags??[]);
          job.input = {...input,...this.skillCatalog(job.purpose,tags,!!job.metadataRecipe)};
        }
        if(job.knowledgeRecipe)job.knowledgeParent=this.options.library.snapshot().knowledgeV3?.version??0;
        job.publicationParentFrozen = true;
      }
      if (job.output === undefined && (!this.options.runtime.runLearning || !job.model)) throw new Error('No configured learning model. Configure the workspace provider; research evidence is preserved.');
      job.status = 'running'; await this.save(); this.options.changed?.();
      if(job.purpose==='network-review'){await this.executeNetworkReview(job);await this.save();this.options.changed?.();return;}
      if (job.operationId) {
        const operation = this.options.library.snapshot().operations[job.operationId];
        if (operation?.status !== 'running') await this.options.library.setReviewStatus(job.operationId, 'running');
        if(job.output===undefined&&!job.resourceReadGrants&&!job.frozenCall){
        const view = await this.options.library.purposeView(job.operationId,job.modelDirectedKnowledge);
        const { readProof: _reader, ...input } = view;
        const strategies = await Promise.all((view.strategies ?? []).map(meta => meta.maintenance?this.options.library.readMaintenanceStrategyForReview(meta,job.operationId!):job.strategySupportRecipe&&meta.strategySupport&&view.operation.repairResourceIds.includes(meta.id)?this.options.library.readStrategyRepairContextV3(meta,{role:'moderator',purpose:'v2-strategy',operationId:job.operationId!},job.strategySupportRecipe):this.options.library.readResource(meta, { role: 'moderator', purpose: 'v2-strategy', operationId: job.operationId! })));
        // Old reservations retain their historical presentation. When V4 evidence enters a
        // review, derive its provenance from the actual granted cases, even for mixed batches.
        const versions = [...new Set(view.outlines?.map(outline => outline.meta.sourceLoopVersion ?? null))];
        const historicalVersion = ['compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision??'') ? '3.0' : '2.1';
        const origin = !versions.includes('4.0') ? {sourceLoopVersion:historicalVersion}
          : versions.length === 1 ? {sourceLoopVersion:'4.0'} : {sourceLoopVersions:versions};
        job.input = { ...input, ...(strategies.length ? { strategies } : {}), ...(view.caseOutcomeSummaries?.length?{...origin,solverMode:OPTIONAL_MODE_V21}:{}),
          ...((['concise-learning-v4','concise-learning-v5','concise-learning-v6'].includes(job.presentationRevision??''))?{}:{processing: job.strategySupportRecipe?'Return processedSources as only the exact operation.delivered proof keys actually processed now. They are the direct sources; qualified parent Strategy support is inherited by the host, not newly processed or granted evidence. Unprocessed or newer sources remain pending.':'Return processedSources as the exact operation.delivered keys you actually considered. Unprocessed or newer sources remain pending. A published Strategy may cite only those processed final proofs.'}) };
        await this.save();
        }
      }
      if(job.capacityBinding!==undefined&&job.capacityBinding!==capacityBinding(job))throw new Error('Frozen learning capacity binding mismatch.');
      if(job.output===undefined){await this.freezeKnowledgeEligibility(job);await this.freezeResourceReads(job);await this.freezeMethodNetwork(job);await this.freezeKnowledgeNetwork(job);await this.save();}
      const schema = outputSchema(job.purpose,job.metadataRecipe,job.knowledgeRecipe,job.promptRevision,!!(job.operationId&&this.options.library.snapshot().operations[job.operationId]?.weightDecision),job.knowledgeReviewRevision,job.methodNetworkRecipe,job.strategySupportRecipe,job.presentationRevision,job.knowledgeNetworkRevision);
      if (job.output === undefined) {
        const call=this.callFor(job);
        if(job.frozenCall&&stableHash(job.frozenCall)!==stableHash(call))throw new Error('Frozen learning call binding mismatch.');
        if(job.promptRevision==='compact-english-v14')job.frozenCall=structuredClone(call);
        if (this.optionalJobStopped(job)) {
          job.status = 'paused'; job.message = 'Project STOP prevented background provider admission.'; await this.save(); return;
        }
        job.requestState = 'sent'; await this.save();
        // Runtime entry may recover cached output; only its actual dispatch validates displayed navigation.
        this.assertOptionalAdmission(job);
        if(job.frozenCall)await this.validateLearningCall(call,undefined,false);
        const result = await this.options.runtime.runLearning!(call); job.usage = result.usage; job.output = result.output; job.requestState = 'returned';
        if(result.maintenanceReferral)job.maintenanceReferral=true;
        if(job.frozenCall){job.readResources=structuredClone(result.readResources??[]);job.outputBinding=outputBinding(job);}
        if (result.attempts) job.attempts = structuredClone(result.attempts);
        if (result.elapsedMs !== undefined) job.elapsedMs = result.elapsedMs;
        await this.save();
      }
      if(job.frozenCall){if(job.outputBinding!==outputBinding(job))throw new Error('Frozen learning output binding mismatch.');await this.validateLearningCall(job.frozenCall,job.readResources,false);}
      const issues = learningIssues(job.output, schema); if (issues.length) throw new Error(`Invalid learning result: ${issues.join('; ')}`);
      if (job.purpose === 'proof-feedback') {
        job.message = (job.output as {assessment:string}).assessment; job.status = 'completed';
        await this.save(); this.options.changed?.(); return;
      }
      const publish=async()=>{
      const output = job.output as { knowledgeProposal?:unknown; networkProposal?:unknown; weightUpdate?:unknown; independentRebuild?:{justification:string}; action: 'publish' | 'no-change'; knowledgeCandidates?:unknown; derivedMetadata?: {sourceKey:string;tags:string[];summary:string}[]; resource?: SubmittedResource; decision?: DecisionProposal; patterns?: string[]; processedSources?: string[] };
      const operation = job.operationId ? this.options.library.snapshot().operations[job.operationId] : undefined;
      const processed = operation ? [...operation.anomalies, ...operation.cases.map(c => c.ref)].filter(ref => output.processedSources?.includes(sourceKey(ref))) : [];
      if (operation && (!output.processedSources || output.processedSources.some(key => !operation.delivered.includes(key)))) throw new Error('Review acknowledged an undelivered source.');
      const actor = learningRole(job.purpose) === 'theorist' ? { role: 'theorist' as const, sessionId: job.projectId } :
        { role: 'moderator' as const, purpose: job.purpose as 'v1-decision' | 'v2-strategy', operationId: job.operationId! };
      if (job.metadataRecipe) {
        if (job.purpose !== 'method-skill' || !job.optionalEvidence) throw new Error('Invalid derived metadata job.');
        const requested = (job.input as {metadataDerivation:{sources:{sourceKey:string;ref:ProofRef}[]}}).metadataDerivation.sources;
        const seen = new Set<string>();
        for (const derived of output.derivedMetadata ?? []) {
          const source = requested.find(item=>item.sourceKey===derived.sourceKey);
          if (!source || seen.has(derived.sourceKey) || !validTagsV21(derived.tags)) throw new Error('Derived metadata must identify one exact supplied qualified source.');
          seen.add(derived.sourceKey);
        }
        for (const derived of output.derivedMetadata ?? []) {
          const source = requested.find(item=>item.sourceKey===derived.sourceKey)!;
          await this.options.library.recordDerivedProofMetadata(source.ref,{tags:derived.tags,summary:derived.summary},
            {role:'theorist',sessionId:job.projectId},job.id,job.optionalEvidence);
          metadataRecorded = true;
        }
      }
      if(output.independentRebuild&&(!(job.methodSupportRecipe&&job.purpose==='method-skill'||job.strategySupportRecipe&&job.purpose==='v2-strategy')||output.action!=='publish'))throw new Error('Independent rebuild requires its frozen publication recipe.');
      let networkOwner:{id:string;version:number}|undefined;
      if (output.action === 'publish') {
        if (job.purpose.endsWith('decision')) {
          if (!output.decision) throw new Error('Decision update missing.');
          if (operation && !processed.length) throw new Error('Decision update needs actually processed evidence.');
          await this.options.library.updateDecision(job.purpose === 'v1-decision' ? 1 : 2, job.expectedVersion!, output.decision, actor, job.id, job.rawEvidence, job.purpose==='v2-decision' && job.sources.length ? job.sources.filter((source):source is ProofRef=>!('kind' in source)) : undefined, job.optionalEvidence);
        } else {
          if (!output.resource) throw new Error('Reusable resource missing.');
          const resourceKind: ResourceKind = job.purpose === 'v2-strategy' ? 'specific-strategy' : job.purpose as ResourceKind;
          const prior = job.parents[`${resourceKind}:${output.resource.semanticKey}`];
          const id = prior?.id ?? `${resourceKind}_${stableHash(output.resource.semanticKey).slice(0, 32)}`;
          const sources = operation ? processed.filter((ref): ref is ProofRef => 'caseId' in ref) : job.sources;
          const published=await this.options.library.publishResource({ ...namedResource(output.resource), id, kind: resourceKind, sourceRefs: sources, generalizable: true }, prior?.version ?? 0, actor, job.id, job.optionalEvidence,job.methodSupportRecipe?{recipe:job.methodSupportRecipe,...(output.independentRebuild?{independentRebuild:output.independentRebuild}:{})}:undefined,job.promptRevision==='compact-english-v14'?'compact-english-v14':undefined,!!job.methodNetworkRecipe,job.strategySupportRecipe?{recipe:job.strategySupportRecipe,...(output.independentRebuild?{independentRebuild:output.independentRebuild}:{})}:undefined);
          networkOwner={id:published.id,version:published.version};
        }
      }
      if(job.knowledgeNetworkRevision&&Object.hasOwn(output,'knowledgeProposal')&&!job.knowledgeNetworkOutcome){
        try{
          if(!networkOwner||!job.knowledgeNetworkView)throw new LearningDataError('INVALID_INPUT','Knowledge navigation requires a published resource and frozen view');
          const sources=(operation?processed:job.sources).filter((ref):ref is ProofRef=>'caseId'in ref);
          await publishKnowledgeLearning(this.options.library,job.modelDirectedKnowledge?{...job.knowledgeNetworkView,entries:job.directedOpens??[]}:job.knowledgeNetworkView,output.knowledgeProposal,networkOwner,{actor,jobId:job.id,sources},job.modelDirectedKnowledge);
          job.knowledgeNetworkOutcome={status:'published'};
        }catch(error){
          if(!(error instanceof LearningDataError)||!['INVALID_INPUT','FORBIDDEN','STALE_SOURCE','NOT_FOUND'].includes(error.code))throw error;
          job.knowledgeNetworkOutcome={status:'rejected',reason:error instanceof Error?error.message:'Optional knowledge navigation rejected'};
          job.message=[job.message,job.knowledgeNetworkOutcome.reason].filter(Boolean).join(' ');
        }
      }
      if(job.methodNetworkRecipe&&Object.hasOwn(output,'networkProposal')){
        if(!networkOwner)job.methodNetworkOutcome={status:'rejected',reason:'Network proposals require a published resource.'};
        else {
          if(job.methodNetworkParent===undefined||!job.methodNetworkAllowedRefs)throw new Error('Missing frozen method network publication binding.');
          const sources=(operation?processed:job.sources).filter((ref):ref is ProofRef=>'caseId'in ref);
          try{job.methodNetworkOutcome=await this.options.library.publishMethodNetworkV3({...(job.methodNetworkParentRevision?{parentRevision:job.methodNetworkParentRevision}:{}),proposal:output.networkProposal,owner:networkOwner,sources,jobId:job.id,expectedVersion:job.methodNetworkParent,actor,allowedRefs:job.modelDirectedKnowledge?(job.directedOpens??[]).map(r=>r.node.ref):job.methodNetworkAllowedRefs});}
          catch(error){
            if(!(error instanceof LearningDataError)||error.code!=='STALE_SOURCE')throw error;
            job.methodNetworkOutcome={status:'rejected',reason:error.message};
          }
        }
        if(job.methodNetworkOutcome?.status==='rejected')job.message=[job.message,`Optional method network proposal rejected: ${job.methodNetworkOutcome.reason}`].filter(Boolean).join(' ');
      }
      if(['compact-english-v8','compact-english-v9','compact-english-v10','compact-english-v11','compact-english-v12','compact-english-v13','compact-english-v14'].includes(job.promptRevision??'')&&job.purpose==='v2-strategy'){
        if(!operation?.weightDecision){if(job.promptRevision!=='compact-english-v14')throw new Error('Missing frozen V3 Strategy weight grant.');job.weightOutcome=Object.hasOwn(output,'weightUpdate')?{status:'rejected',reason:'No frozen Strategy weight grant.'}:{status:'unchanged'};}
        else job.weightOutcome=output.action==='publish'&&Object.hasOwn(output,'weightUpdate')
          ?await this.options.library.updateStrategyWeights(operation.id,operation.weightDecision.version,output.weightUpdate,processed.filter((ref):ref is ProofRef=>'caseId'in ref),job.id)
          :unpublishedWeights(output,operation.weightDecision.version);
        if(job.weightOutcome.status==='rejected')job.message=`Optional weight update rejected: ${job.weightOutcome.reason}`;
      }
      if(job.knowledgeRecipe&&Object.hasOwn(output,'knowledgeCandidates')&&(!Array.isArray(output.knowledgeCandidates)||output.knowledgeCandidates.length>0)){
        try {
          await this.options.library.publishKnowledgeV3(output.knowledgeCandidates,job.sources.filter((ref):ref is ProofRef=>!('kind'in ref)),job.id,job.knowledgeParent??0,{role:'theorist',sessionId:job.projectId},job.knowledgeReviewRevision);
        } catch(error){
          if(!(error instanceof KnowledgeCandidateValidationErrorV3))throw error;
          job.knowledgeOutcome=structuredClone(error.outcome);
          job.message=`Optional knowledge batch rejected: ${error.outcome.rejectedCount} candidates, none published. ${error.message}`;
        }
      }
      if (job.operationId && operation && !['completed', 'no-change'].includes(operation.status)) {
        await this.options.library.completeReview(job.operationId, processed, output.action === 'publish' ? 'completed' : 'no-change', output.patterns);
      }
      job.status = output.action === 'publish' ? 'completed' : 'no-change';
      advancedReview = processed.length > 0;
      };
      if(job.frozenCall)await this.options.library.withLearningPublication(async()=>{
        if(job.outputBinding!==outputBinding(job))throw new Error('Frozen learning output binding mismatch.');
        await this.validateLearningCall(job.frozenCall!,job.readResources,false);
      },publish);
      else await publish();
    } catch (error) {
      if (error instanceof LearningFallbackError) { job.usage = structuredClone(error.usage); job.attempts = structuredClone(error.attempts); if (error.elapsedMs !== undefined) job.elapsedMs = error.elapsedMs; }
      job.status = 'failed'; job.message = error instanceof Error ? error.message : 'Learning failed; research evidence is preserved.';
      if (job.operationId) await this.options.library.setReviewStatus(job.operationId, 'failed', job.message).catch(() => {});
    }
    await this.save(); this.options.changed?.();
    if (metadataRecorded || (job.metadataRecipe || job.strategyAdmissionRecipe&&job.purpose==='method-skill') && ['completed','no-change'].includes(job.status)) {
      try { await this.reserveModerator({projectId:job.projectId,model:this.options.moderatorModel(),budget:job.budget,capacitySettings:job.capacitySettings,...(job.strategyAdmissionRecipe?{strategyAdmissionRecipe:job.strategyAdmissionRecipe}:{})},'v2-strategy'); }
      catch (error) { job.message = [job.message,`Metadata saved; Moderator registration remains pending: ${error instanceof Error ? error.message : 'queue unavailable'}`].filter(Boolean).join(' '); await this.save(); }
    }
    // A concurrent checkpoint may have found this purpose already reserved. Drain its
    // remaining evidence only after a real watermark advance, never after an empty review.
    if (advancedReview && (job.purpose === 'v1-decision' || job.purpose === 'v2-strategy')) {
      try { await this.reserveModerator(job, job.purpose); }
      catch (error) { job.message = `Review completed; later review remains pending: ${error instanceof Error ? error.message : 'queue unavailable'}`; await this.save(); }
    }
  }
  private async executeNetworkReview(job:Job):Promise<void> {
    const call=this.callFor(job);
    if(!job.frozenCall||stableHash(call)!==stableHash(job.frozenCall)||job.capacityBinding!==capacityBinding(job))throw new Error('Frozen manual review binding mismatch.');
    if(job.output===undefined) {
      await this.validateLearningCall(call,[],false);
      job.requestState='sent';await this.save();
      const result=await this.options.runtime.runLearning!(call);
      if(result.maintenanceReferral)job.maintenanceReferral=true;job.output=result.output;job.usage=result.usage;job.attempts=result.attempts;job.elapsedMs=result.elapsedMs;job.readResources=structuredClone(result.readResources??[]);job.requestState='returned';job.outputBinding=outputBinding(job);await this.save();
    }
    if(job.outputBinding!==outputBinding(job)||job.readResources?.length)throw new Error('Manual review output binding mismatch.');
    const issues=learningIssues(job.output,networkReviewSchemaV1);if(issues.length)throw new Error(`Invalid navigation review: ${issues.join('; ')}`);
    const output=job.output as NetworkReviewOutputV1;
    const result=await this.options.library.publishUserNetworkReview(job.input as NetworkReviewContextV1,output,job.id);
    job.status=result.status==='published'?'completed':'no-change';job.message=output.reason;
  }

  private directedJob(call:LearningCall){
    const job=this.ledger.jobs.find(j=>j.id===call.id&&j.projectId===call.projectId&&j.status==='running');
    if(!job?.modelDirectedKnowledge||!call.modelDirectedKnowledge||!job.directedView||!job.frozenCall||stableHash({...call,model:job.frozenCall.model,budget:job.frozenCall.budget})!==stableHash(job.frozenCall))throw Error('Missing frozen learning directory grant');
    return {job,view:job.directedView};
  }
  async lookupLearningRoutes(call:LearningCall,query:DirectedRouteQuery){
    const {job,view}=this.directedJob(call),library=this.options.library;
    if(query.mode==='relations'&&!job.directedSelections?.includes(query.selection??0))throw new DirectedRouteInputError('Select an anchor from a displayed route page.');
    const current=await library.freezeKnowledgeView(),allowed=await library.availableKnowledgeRefs(view.refs);
    const result=directedRouteSelection(view.network,query,allowed,current.network);
    const presented=directedRoutePresentation(result),page={query:structuredClone(query),hash:stableHash(presented)};
    if(!job.directedPages?.some(old=>stableHash(old)===stableHash(page)))(job.directedPages??=[]).push(page);
    job.directedSelections=[...new Set([...(job.directedSelections??[]),...result.nodes.map(n=>n.selection)])];await this.save();
    return presented;
  }
  async openLearningRoute(call:LearningCall,selection:number){
    const {job,view}=this.directedJob(call),node=view.network.nodes[selection-1];
    if(!node||!job.directedSelections?.includes(selection)||!view.refs.some(ref=>knowledgeRefKey(ref)===knowledgeRefKey(node.ref)))throw new DirectedRouteInputError('Select a route from an authorized page to open.');
    const resource=await this.options.library.readKnowledgeResource(node.ref,{revision:view.revision,purpose:job.purpose==='v2-strategy'?'strategy-learning':'method-learning',allowedRefs:view.refs});
    if(!job.directedOpens?.some(r=>r.selection===selection))(job.directedOpens??=[]).push({selection,node,body:resource.body});
    const methodNetwork=this.options.library.snapshot().methodNetworkV3;
    const route=job.methodNetworkRecipe&&methodNetwork?.version===job.methodNetworkParent&&methodNetwork?.routes.find(r=>r.status==='active'&&r.resourceRef.id===node.ref.id&&r.resourceRef.version===node.ref.version);
    await this.save();return {selection,...(route?{methodRoute:{id:route.id,version:route.version}}:{}),id:node.ref.id,version:node.ref.version,semanticKey:resource.meta.semanticKey,name:node.title,...(call.presentationRevision==='concise-learning-v6'?{title:node.title}:{}),conditions:resource.meta.conditions,body:resource.body};
  }
  /** A job grants exact frozen catalog parents only, never arbitrary library access. */
  async readResource(call:LearningCall,ref:{id:string;version:number}) {
    const job=this.ledger.jobs.find(item=>item.id===call.id&&item.projectId===call.projectId&&call.purpose===item.purpose&&item.status==='running');
    const input=(call.input as {frozenInput?:unknown})?.frozenInput??call.input;
    if(!job||!job.resourceReadGrants||job.resourceReadRecipe!=='frozen-learning-resources-v1'||stableHash(call.resourceReadGrants)!==stableHash(job.resourceReadGrants)||call.promptRevision!==job.promptRevision||stableHash(input)!==stableHash(job.input))throw new Error('No active exact learning resource grant.');
    return this.readGrantedResource(job,ref);
  }
  private async readGrantedResource(job:Job,ref:{id:string;version:number},allowOwnPublication=false) {
    const grant=job.resourceReadGrants?.resources.find(value=>value.meta.id===ref.id&&value.meta.version===ref.version);
    const kind=job.purpose==='v2-strategy'?'specific-strategy':job.purpose;
    const parent=grant&&job.parents[`${kind}:${grant.meta.semanticKey}`];
    if(!grant||grant.meta.kind!==kind||!parent||parent.id!==ref.id||parent.version!==ref.version||guidanceHashV3(grant.body)!==grant.bodyHash)throw new Error('Learning resource is unavailable or outside frozen parent grants.');
    const value=await this.options.library.optionalLearningResource(ref,job.purpose==='v2-strategy'?{role:'moderator',purpose:'v2-strategy',operationId:job.operationId!}:{role:'theorist',sessionId:job.projectId,loopVersion:2},{kind:grant.meta.kind,semanticKey:grant.meta.semanticKey},allowOwnPublication);
    if(!value.available)throw new LearningDataError('STALE_SOURCE',`${kind} source authority is unavailable: ${value.reason}.`);
    if(guidanceHashV3(value.body)!==grant.bodyHash||stableHash({...value.meta,enabled:grant.meta.enabled,status:grant.meta.status})!==stableHash(grant.meta))throw new Error('Frozen learning resource integrity mismatch.');
    return {meta:value.meta,body:value.body};
  }
  /** Only exact final proofs frozen in the V2 Moderator operation can be expanded. */
  async readProof(call: LearningCall, ref: ProofRef) {
    const job = this.ledger.jobs.find(item => item.id === call.id && item.projectId === call.projectId && call.purpose === 'v2-strategy' && item.status === 'running' && item.purpose === 'v2-strategy');
    if (!job) throw new Error('No active final-proof grant.');
    if(job.structuralAdmissionHash)await this.options.library.validateStructuralReviewV3(job.operationId!);
    return this.options.library.proofReader(job.sources.filter((source): source is ProofRef => !('kind' in source))).read(ref);
  }
  async close(): Promise<void> {
    this.closing = true; if (this.timer) clearTimeout(this.timer);
    // Admitted calls finish under the soft-deadline contract; shutdown waits for them. Unstarted work stays durable for next launch.
    await this.checkpoints; await this.running; await this.writes;
    if (this.persistenceFailure) throw this.persistenceFailure;
  }
}
