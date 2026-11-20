import { Type,type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ValidationError } from '../../contracts/errors.js';
import { ConfigSchema } from '../v2/schemas.js';
import { ResourceRefSchema,BoundaryViewSchema,DecisionFileSchema } from '../../contracts/review.js';
import { CommandStatesSchema,PlanningSelectionSchema } from '../../contracts/user-commands.js';
import { ForkManifestV0Schema } from '../../contracts/lineage.js';
import { StoredPresentationSchema } from '../../../presentation/session-presentation.js';
import { TagsSchemaV21,validTagsV21 } from '../v21/tags.js';
import type { ResearchProjectV0,ResearchConfigV0,InFlightEpochV0,SolveResultV0,RawAnswerRefV0 } from '../../contracts/v0.js';
export const obj=(p:Record<string,TSchema>)=>Type.Object(p,{additionalProperties:false});
const text=Type.String({minLength:1,maxLength:1000000}),strings=Type.Array(text),opt=Type.Optional;
const en=(v:string[])=>Type.Union(v.map(x=>Type.Literal(x))),hash=Type.String({pattern:'^[a-f0-9]{64}$'}),integer=Type.Integer({minimum:0}),refs=Type.Array(ResourceRefSchema);
export const SourceSchemaV0=obj({id:text,path:text,revision:text,fingerprint:opt(text),external:opt(Type.Boolean())});
const interpretation={domain:strings,conditions:strings,symbols:Type.Record(Type.String(),text),strength:text,returnToRoot:text,completionCriteria:strings,obligations:Type.Array(obj({id:text,statement:text}))};
export const RootInterpretationSchemaV0=obj(interpretation);
export const RootSchemaV0=obj({...interpretation,hypothesisId:text,revision:text,semanticRevision:Type.Integer({minimum:1}),originalText:text,previousId:opt(text),sourceCommandId:opt(text)});
const proposal={methodKey:text,direction:text,conditions:strings,unknownBridges:strings,returnToRoot:text,resourceRefs:refs,p:Type.Number({minimum:0,maximum:1}),estimateReason:text};
export const PlanSchemaV0=obj({rootInterpretation:opt(RootInterpretationSchemaV0),rootChange:opt(obj({sourceCommandId:text,targetText:text,interpretation:RootInterpretationSchemaV0})),candidates:Type.Array(obj(proposal)),blockers:strings});
const candidate=obj({...proposal,id:text});
export const SelectionSchemaV0=obj({modelChoice:opt(obj({selectedIndex:Type.Union([integer,Type.Null()]),inputHash:hash,callId:text,reason:text})),planHash:hash,candidates:Type.Array(candidate),selectedWayId:Type.Union([text,Type.Null()]),maxScore:Type.Union([Type.Number({minimum:0,maximum:1}),Type.Null()]),tieRule:Type.Literal('first-in-plan'),selectedAt:text});
export const SolveOutcomeSchemaV0=obj({verdict:en(['open','solved','refuted']),selectedWayId:text,rootId:text,rootRevision:text,obligations:Type.Array(obj({id:text,status:en(['satisfied','inapplicable','open']),reason:text,evidence:Type.Array(text,{minItems:1})})),conditions:strings,conditionChecks:Type.Array(obj({condition:text,basis:en(['root-context','established','unresolved']),reason:text,evidence:Type.Array(text,{minItems:1})})),gaps:strings,selfCheck:text,summary:text,reproducible:Type.Boolean(),reproducibility:text,dependencySourceIds:opt(strings),tags:TagsSchemaV21,outline:Type.Array(text,{minItems:1})});
export const SingleOutcomeSchemaV0=obj({
 rootInterpretation:opt(RootInterpretationSchemaV0),rootChange:opt(PlanSchemaV0.properties.rootChange),
 candidates:Type.Array(obj({method:text,p:Type.Number({minimum:0,maximum:1}),reason:text,conditions:strings,unknownBridges:strings,resourceRefs:refs})),
 selectedIndex:Type.Union([integer,Type.Null()]),choiceReason:text,verdict:en(['open','solved','refuted']),
 obligations:SolveOutcomeSchemaV0.properties.obligations,conditionChecks:SolveOutcomeSchemaV0.properties.conditionChecks,
 gaps:strings,selfCheck:text,summary:text,reproducible:Type.Boolean(),reproducibility:text,dependencySourceIds:opt(strings),tags:TagsSchemaV21,outline:Type.Array(text,{minItems:1})
});
export const ProofOutcomeSchemaV0=obj({
 candidates:Type.Array(obj({method:text,p:Type.Number({minimum:0,maximum:1})})),
 selectedIndex:Type.Union([integer,Type.Null()]),verdict:en(['open','solved','refuted']),
 gaps:strings,extraAssumptions:strings,usedResourceIds:opt(strings),inapplicableObligationIds:opt(strings),reproducible:Type.Boolean(),subject:opt(Type.String({minLength:1,maxLength:180,pattern:'^[^:⩴︓﹕：]+$'})),rootReplacement:opt(text)
});
const owner={binding:opt(Type.Literal('call-input')),owner:text,projectId:text,epochId:text,attemptId:text,callId:text,rootId:text,rootRevision:text,planHash:hash,routeId:text,inputHash:hash,protocolVersion:Type.Literal('v0-native-1')};
const completeness=en(['complete','partial','empty']);
export const RawAnswerRefSchemaV0=obj({...owner,id:text,bodyHash:hash,byteLength:integer,completeness});
const usage=obj({turns:integer,toolCalls:integer,tokens:opt(Type.Number({minimum:0})),costUsd:opt(Type.Number({minimum:0})),tokensKnown:Type.Boolean(),costKnown:Type.Boolean()});
export const TechnicalSchemaV0=obj({executionStatus:en(['completed','failed','interrupted']),completeness,stopReason:opt(Type.String()),rawStopReason:opt(Type.String()),errorCategory:opt(text),usage:opt(usage)});
export const SolveResultSchemaV0=obj({outcome:SolveOutcomeSchemaV0,answerRef:RawAnswerRefSchemaV0,technical:TechnicalSchemaV0});
const model=obj({provider:text,modelId:text,thinkingLevel:opt(en(['off','minimal','low','medium','high','xhigh']))});
const roles=obj({theorist:opt(model),worker:opt(model),moderator:opt(model),literature:opt(model)});
export const FrozenSourceSchemaV0=obj({ref:SourceSchemaV0,body:Type.String(),bodyHash:hash});
const resourceBody=obj({ref:ResourceRefSchema,body:Type.String(),bodyHash:hash});
export const SnapshotSchemaV0=obj({promptRevision:opt(Type.Literal('categorized-v1')),policyAssessment:opt(Type.Literal('criteria-before-probability-v1')),id:text,number:Type.Integer({minimum:1}),root:RootSchemaV0,rootInterpretationPending:Type.Boolean(),inputRevision:text,sources:Type.Array(FrozenSourceSchemaV0),resources:refs,resourceCatalog:Type.Array((BoundaryViewSchema.properties.skills as {items:TSchema}).items),decision:opt(DecisionFileSchema),modelConfig:obj({defaultModel:opt(model),roleModels:opt(roles)}),config:ConfigSchema,startedAt:text});
export const InputSchemaV0=obj({responseMode:opt(Type.Literal('proof-first')),projectId:text,epochId:text,callId:text,snapshot:SnapshotSchemaV0,planningSelection:opt(PlanningSelectionSchema),plan:opt(PlanSchemaV0),selection:opt(SelectionSchemaV0),loadedResources:refs,resourceBodies:Type.Array(resourceBody),history:opt(Type.Array(obj({epochId:text,root:RootSchemaV0,sources:Type.Array(SourceSchemaV0),evidenceStatus:Type.Literal('historical-only'),premisesChanged:Type.Boolean(),plan:opt(PlanSchemaV0),selection:opt(SelectionSchemaV0),solve:opt(SolveResultSchemaV0),body:opt(Type.String())})))});
export const PinSchemaV0=obj({revision:en(['v0-operation-1','v0-operation-2','v0-operation-3','v0-operation-4']),task:en(['v0_plan','v0_solve','v0_single']),schemaDigest:hash,inputHash:hash});
const call=obj({id:text,task:en(['v0_plan','v0_solve','v0_single']),status:en(['not-started','pending','completed','uncertain']),input:InputSchemaV0,inputHash:hash,operation:PinSchemaV0,result:opt(Type.Unknown()),usage:opt(usage),loadedResources:opt(refs),recoveryGeneration:integer});
export const ArchiveSelectionSchemaV0=obj({operationId:text,projectId:text,epochId:text,root:RootSchemaV0,way:candidate,planHash:hash,answerRef:RawAnswerRefSchemaV0,outcome:SolveOutcomeSchemaV0,possibleDependencySources:Type.Array(SourceSchemaV0),expectedRevision:opt(integer)});
const proof=obj({sessionId:text,caseId:text,hypothesisId:text,hypothesisRevision:text,revision:integer,semanticRevision:integer,contentHash:text});
const archive=obj({operationId:text,selectionHash:hash,status:en(['pending','saved']),selection:ArchiveSelectionSchemaV0,proofRef:opt(proof),error:opt(text),retries:integer});
const phase=en(['idle','planning','solving','archiving','checkpoint']);
const epochProps={executionMode:opt(en(['single-request','proof-first'])),metadataStatus:opt(en(['assessed','unassessed'])),projectId:text,epoch:Type.Integer({minimum:1}),phase,snapshot:SnapshotSchemaV0,planningSelection:opt(PlanningSelectionSchema),loadedResources:refs,calls:Type.Array(call),plan:opt(PlanSchemaV0),selection:opt(SelectionSchemaV0),solve:opt(SolveResultSchemaV0),archive:opt(archive),technicalAnswers:opt(Type.Array(obj({answerRef:RawAnswerRefSchemaV0,technical:TechnicalSchemaV0}))),cancelled:opt(Type.Boolean()),scientificCommitted:opt(Type.Boolean()),startedAt:text};
export const InFlightSchemaV0=obj({schemaVersion:Type.Literal(4),loop:obj({researchLoopVersion:Type.Literal('0'),workerProtocolVersion:Type.Literal('v0-native-1')}),...epochProps});
const epoch=obj({...epochProps,id:text,completedAt:text,foregroundCompletedAt:opt(text),decision:en(['continue','pause','complete','stop']),reason:text});
export const ProjectSchemaV0=obj({schemaVersion:Type.Literal(4),researchLoopVersion:Type.Literal('0'),workerProtocolVersion:Type.Literal('v0-native-1'),contractVersion:Type.Literal('v0-test-1'),id:text,name:text,nameSource:opt(en(['user','theorist'])),presentation:opt(StoredPresentationSchema),originalHypothesis:text,hypothesis:text,hypothesisRevision:text,hypothesisId:text,contentRevision:text,sources:Type.Array(SourceSchemaV0),config:ConfigSchema,status:en(['idle','running','paused','completed','stopped','failed']),phase,epoch:integer,summary:Type.String(),startedAt:opt(text),lastError:opt(text),processedCommandIds:strings,refinements:strings,pendingModificationIds:opt(strings),commandStates:opt(CommandStatesSchema),userInputWarnings:opt(strings),plannedRefinementCount:opt(integer),fork:opt(ForkManifestV0Schema),root:RootSchemaV0,rootInterpretationPending:Type.Boolean(),scientificVerdict:en(['open','solved','refuted']),archiveStatus:en(['none','pending','saved']),epochs:Type.Array(epoch),activeEpoch:opt(InFlightSchemaV0)});
export function parseV0<T>(schema:TSchema,value:unknown,label:string):T {if(!Value.Check(schema,value))throw new ValidationError(label);return structuredClone(value) as T;}
export const parseConfig=(value:unknown):ResearchConfigV0=>parseV0(ConfigSchema,value,'V0 config');
export function parseProject(value:unknown):ResearchProjectV0 {const p=parseV0<ResearchProjectV0>(ProjectSchemaV0,value,'V0 project');if(p.root.hypothesisId!==p.hypothesisId||p.root.revision!==p.hypothesisRevision||p.root.originalText!==p.hypothesis)throw new ValidationError('V0 root identity');if(!p.rootInterpretationPending&&(!p.root.obligations.length||!p.root.completionCriteria.length||new Set(p.root.obligations.map(o=>o.id)).size!==p.root.obligations.length))throw new ValidationError('V0 committed root obligations');for(const e of p.epochs)storedEpoch(e);if(p.activeEpoch)storedEpoch(p.activeEpoch);return p;}
export function parseInFlight(value:unknown):InFlightEpochV0 {const m=parseV0<InFlightEpochV0>(InFlightSchemaV0,value,'V0 marker');storedEpoch(m);return m;}
export function parseSolveResult(value:unknown):SolveResultV0 {const r=parseV0<SolveResultV0>(SolveResultSchemaV0,value,'V0 solve result');if(!validTagsV21(r.outcome.tags))throw new ValidationError('V0 tags');if(r.answerRef.completeness!==r.technical.completeness)throw new ValidationError('V0 completeness binding');return r;}
export const parseRawAnswerRef=(value:unknown):RawAnswerRefV0=>parseV0(RawAnswerRefSchemaV0,value,'V0 raw answer reference');
function storedEpoch(e:InFlightEpochV0|import('../../contracts/v0.js').EpochRecordV0):void {if(e.executionMode==='proof-first'?(e.calls.length>1||e.calls.some(c=>c.task!=='v0_single'||c.operation.revision!==(e.snapshot.policyAssessment==='criteria-before-probability-v1'?'v0-operation-4':'v0-operation-3')||c.input.responseMode!=='proof-first')):e.executionMode==='single-request'?(e.calls.length>1||e.calls.some(c=>c.task!=='v0_single'||c.operation.revision!=='v0-operation-2')):e.calls.some(c=>c.task==='v0_single'||c.operation.revision!=='v0-operation-1'))throw new ValidationError('V0 execution mode/call mismatch');if(e.epoch!==e.snapshot.number||e.projectId!==e.calls[0]?.input.projectId&&e.calls.length)throw new ValidationError('V0 epoch identity');if(e.solve)parseSolveResult(e.solve);}
