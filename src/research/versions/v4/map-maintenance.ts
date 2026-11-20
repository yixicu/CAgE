import type {ScientificToolNotice} from '../../../runtime/native-handoff.js';
import {readAlternateMethod,type AlternateMethodRead} from './alternate-method.js';
import type {ModelSelection,RoleBudget} from '../../../engine/types.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import {mapSourceKey,observationSeed,MAP_RECIPE,MapError,mapReadFeedback,mapHandle,sameMapRef,type MapCandidateDraft,type MapGrant,type MapOpenResult,type MapOutbox,type MapQuery,type MapRef,type MapReviewDecision,type MapReviewedProposal,type MapSource,type MapView,type MapSelection} from '../../../learning/knowledge-map.js';
import {mapBasisChoices,retainMapOpenBases} from '../../../learning/knowledge-map-support.js';
import {stableHash} from '../../../learning/research-hash.js';
import {getV4Coordinator} from './coordinator.js';
import {retainedMapPage} from './map-research.js';
import {projectMapReadRecord,type MapReadRecord} from './map-reader.js';
import type {TheoryRequestV4} from './moderator.js';

export interface AuthoredMapWrite {entries:MapDraftInput[];opened:MapOpenResult[]}
import type {MapNodeType,AuthoredRelation} from '../../../learning/map-node-fields.js';
export interface MapDraftInput {nodeType?:MapNodeType;placement?:MapPlacement;kind:'concept'|'theorem'|'observation';title:string;summary?:string;body:string;aliases?:string[];domain?:string[];assumptions?:string[];supportAssumptions?:string[];argument?:string;status:'definition'|'proved'|'pending'|'observed';existing?:string;sources?:number[];prerequisites?:{selection:string;role:'established'|'assumption';discharges?:{condition:string;argument:string}[]}[];memberships?:string[];relations?:AuthoredRelation<string>[]}
export type MapPlacement = {kind:'nearby';anchor:string;reason:string}|{kind:'new-field';field:string;reason:string;premise?:string};
export interface MapDomainRequest {proposalHash:string;fields:string[];premises?:{field:string;statement:string}[];sourceDecision?:'conditional'|'unsupported';reason:string;candidateIds:string[];revisionTaskId?:string;revisionNote?:string;acceptedFields?:string[];decision?:'approve'|'decline'}
export interface MapAlternateRoute {question:string;report:string;fields:string[];result?:string;model?:ModelSelection}
export type OriginalReportBasis = {status:'supported';body:string}|({status:'material-gap'} & import('../../../learning/report-assessment.js').ReportObjection);
export interface MapMaintenanceReply extends ScientificToolNotice { reportBasis?:OriginalReportBasis; method?:AlternateMethodRead; source?:number; objection?:import('../../../learning/report-assessment.js').ReportObjection;action:'skip-unavailable'|'read-method'|'archive-objection'|'lookup'|'open'|'refresh'|'read-batch'|'proposal'|'review'|'finish';body:string;reads?:import('../../../learning/knowledge-map.js').MapReadCall[];query?:MapQuery;selection?:string;detail?:'proof';entries?:MapDraftInput[];decisions?:{selection:string;status:MapReviewDecision['status'];body:string;placement?:MapPlacement}[]}
export interface MapMaintenanceTask extends ScientificToolNotice {
 singleAuthor?:true;authored?:true;authoredParents?:Record<string,Pick<MapOpenResult,'ref'|'aliases'|'domain'|'assumptions'>>;
 alternateMethod?:AlternateMethodRead;methodResult?:Awaited<ReturnType<typeof readAlternateMethod>>;
 domainAdmission?:true;projection?:MapOutbox['projection'];domainRequest?:MapDomainRequest;
 revisionScope?:{originTaskId:string;targets:MapCandidateDraft[];declinedFields:string[]};supersededCandidates?:string[];localPublication?:{ids:string[];version:number;refs?:Record<string,MapRef>;reviewId?:string};placements?:Record<string,MapPlacement>;alternateRoute?:MapAlternateRoute;
 reportBasisReview?:'original-report-v1';reportBasis?:OriginalReportBasis;
 pendingReviewObjection?:import('../../../learning/report-assessment.js').ReportObjection;
 nodeWriting?:'formula-summary-v1'|'structured-map-v2';
 refutationEvidence?:true;
 modelDirectedKnowledge?:true;
 nativeHandoff?:'native-handoff-v1';nativeReply?:import('../../../runtime/native-handoff.js').NativeHandoffState;nativeReplies?:import('../../../runtime/native-handoff.js').NativeHandoffState[];
 id:string;intentId:string;recipe:typeof MAP_RECIPE;ownerId:string;projectId:string;sourceKeys:string[];model:ModelSelection;budget:RoleBudget;
 waitingForReport?:string;phase:'extract'|'review'|'publish'|'alternate';status:'awaiting-assessment'|'awaiting-consent'|'ready'|'sending'|'uncertain'|'completed'|'failed'|'stopped';lease?:string;attemptSent?:boolean;
 phaseOpened?:string[];
 presentation?:'layered-map-v1';proofSelections?:string[];sources?:MapSource[];view?:MapView;openViews?:Record<string,MapView>;selection?:MapSelection;query?:MapQuery;opened:MapOpenResult[];candidates:MapCandidateDraft[];decisions:MapReviewDecision[];
 history:{action:string;body:string}[];sends:{at:string;usage?:{tokens?:number;costUsd?:number}}[];receipt?:MapMaintenanceReply;readBatchCursor?:number;readResults?:MapReadRecord[];currentReadResults?:unknown[];error?:string;rejectedReceipt?:boolean;publication?:unknown;
}
export interface MapMaintenanceContext {task:MapMaintenanceTask;purpose:'map-maintenance'|'map-review'}
export interface MapRuntime {invokeTheoryV4?(request:TheoryRequestV4):Promise<unknown>}
const running=new Map<string,Promise<void>>();
const wake=new Set<string>();
const latest=new Map<string,Parameters<typeof startMapMaintenance>[0]>();
export function createMapTask(intent:MapOutbox,model:ModelSelection,budget:RoleBudget):MapMaintenanceTask {
 const opened=structuredClone(intent.authored?.opened??intent.projection?.decision?.opened??[]);
 // Preserve only the exact edit target and inherited statement metadata. Evidence still has to reopen.
 const parents=opened.filter(o=>o.ref&&intent.authored?.entries.some(entry=>entry.existing===o.selection));
 const authoredParents=Object.fromEntries(parents.map(({selection,ref,aliases,domain,assumptions})=>[selection,{ref,aliases,domain,assumptions}]));
 const receipt:MapMaintenanceReply|undefined=intent.authored?{action:'proposal',body:'Apply the scientific author’s saved map changes.',entries:structuredClone(intent.authored.entries)}:
  intent.projection?.decision?{action:'review',body:intent.projection.decision.placement.reason,decisions:[{selection:'canonical',status:'pending',body:intent.projection.decision.placement.reason,placement:structuredClone(intent.projection.decision.placement)}]}:undefined;
 return {...(parents.length?{authoredParents}:{}),...(intent.singleAuthor?{singleAuthor:true}:{}),...(receipt?{authored:true,receipt,phaseOpened:opened.map(o=>o.selection)}:{}),...(intent.domainAdmission?{domainAdmission:true,reportBasisReview:'original-report-v1' as const}:{}),...(intent.projection?{projection:structuredClone(intent.projection)}:{}),...(intent.refutationEvidence?{refutationEvidence:true}:{}),...(intent.modelDirectedKnowledge?{modelDirectedKnowledge:true,nodeWriting:'structured-map-v2' as const}:{}),id:'map_task_'+stableHash([intent.id,MAP_RECIPE]),intentId:intent.id,recipe:MAP_RECIPE,ownerId:intent.ownerId,projectId:intent.projectId,sourceKeys:intent.sourceKeys,model:structuredClone(model),budget:{...structuredClone(budget),maxTokens:undefined,maxCostUsd:undefined},phase:intent.projection?'review':'extract',status:'ready',nativeHandoff:'native-handoff-v1',presentation:'layered-map-v1',proofSelections:[],opened,candidates:[],decisions:[],history:[],sends:[]};
}
export function reviewsOriginalReport(task:MapMaintenanceTask){
 const source=task.sources?.[0];
 return !!(!task.authored&&task.reportBasisReview&&task.domainAdmission&&!task.revisionScope&&!task.projection&&!task.alternateRoute&&task.sources?.length===1&&source?.ref.kind==='proof-report'&&(source.origin as {outcome?:string})?.outcome==='supported-result');
}
export const mapTaskGrant=(task:MapMaintenanceTask):MapGrant=>({...(task.refutationEvidence?{refutationEvidence:true}:{}),purpose:task.phase==='review'||task.phase==='publish'?'map-review':'map-maintenance',ownerId:task.ownerId,projectId:task.projectId,taskId:task.id,profileId:task.view?.profile.id??'profile_'+stableHash([task.ownerId,task.projectId])});
function selectedRef(task:MapMaintenanceTask,selection:string):MapRef {
 const open=task.opened.find(o=>o.selection===selection&&o.ref);if(!open?.ref)throw new MapError('FORBIDDEN','Map relation or supplement requires an opened exact entry');return open.ref;
}
function makeCandidates(task:MapMaintenanceTask,inputs:MapDraftInput[]):MapCandidateDraft[]{
 const target=(selection:string):MapRef|string=>/^candidate_[1-9][0-9]*$/.test(selection)&&Number(selection.slice(10))<=inputs.length?selection:selectedRef(task,selection);
 return inputs.map((input,i)=>{
  const parent=input.existing?(task.opened.find(o=>o.selection===input.existing&&o.ref)??task.authoredParents?.[input.existing]):undefined;
  const existing=input.existing?(parent?.ref??selectedRef(task,input.existing)):undefined;
  const sourceSelections=input.sources??(task.sources?.length===1?[1]:[]);
  if(!sourceSelections.length)throw new MapError('INVALID_INPUT','Select the exact public source supporting this entry');
  const sources=sourceSelections.map(selection=>{const source=task.sources?.[selection-1];if(!source)throw new MapError('FORBIDDEN','Unknown public source selection');return source.ref;});
  if(existing?.store==='theory')throw new MapError('FORBIDDEN','Maintenance cannot edit canonical theory bodies');
  const prerequisites=(input.prerequisites??[]).map(p=>{
   if(!task.modelDirectedKnowledge)return {ref:selectedRef(task,p.selection),role:p.role};
   const discharges=p.discharges?.length?{discharges:structuredClone(p.discharges)}:{};
   if(/^candidate_[1-9][0-9]*$/.test(p.selection))return {ref:target(p.selection),role:p.role,...discharges};
   const opened=task.opened.find(o=>o.selection===p.selection||mapBasisChoices(o).some(c=>c.selection===p.selection));
   if(!opened?.ref)throw new MapError('FORBIDDEN','Prerequisite requires an opened statement or a same-proposal candidate');
   const choices=mapBasisChoices(opened),chosen=choices.find(c=>c.selection===p.selection);
   if(p.role==='established'&&choices.length>1&&!chosen)throw new MapError('INVALID_INPUT','Select the argument with the applicable premise conditions');
   return {ref:opened.ref,role:p.role,...(p.role==='established'&&chosen?{basis:chosen.basis}:{}),...discharges};
  });
  let observation;
  if(input.kind==='observation'){
   const source=task.sources?.[sourceSelections[0]!-1];
   const value=source&&observationSeed(source);
   if(!task.refutationEvidence||sourceSelections.length!==1||!source||!value||!existing||!source.entryRefs?.some(ref=>sameMapRef(ref,existing)))throw new MapError('INVALID_INPUT','Select the original measurement source and open its exact observation entry');
   if(!['observed','pending'].includes(input.status)||prerequisites.length||input.argument?.trim())throw new MapError('INVALID_INPUT','An observation requires measurement evidence');
   observation=structuredClone(value);
  }else if(input.status==='observed')throw new MapError('INVALID_INPUT','Only observations can receive measurement qualification');
  return {id:'candidate_'+(i+1),kind:input.kind,...(input.nodeType?{nodeType:input.nodeType}:{}),...(observation?{observation}:{}),title:input.title,...(task.nodeWriting&&input.summary?.trim()?{summary:input.summary.trim()}:{}),body:input.body,aliases:input.aliases??parent?.aliases??[],domain:input.domain??parent?.domain??[],assumptions:input.assumptions??parent?.assumptions??[],definition:input.status==='definition',...(existing?{existing}:{}),sources,argument:input.argument??'',prerequisites,...(task.modelDirectedKnowledge&&input.supportAssumptions?{supportAssumptions:input.supportAssumptions}:{}),requestedStatus:input.status==='observed'?'observed':input.status==='proved'?'proved':'pending',memberships:(input.memberships??[]).map(target),...(input.relations?{relations:input.relations.map(r=>({...r,target:target(r.target)}))}:{})};
 });
}
type ReviewInput=NonNullable<MapMaintenanceReply['decisions']>[number];
function classifyMapPlacement(task:MapMaintenanceTask,decisions:ReviewInput[]){
 const placements:Record<string,MapPlacement>={};
 for(const decision of decisions){
  if(decision.status==='reject'||decision.status==='revise')continue;
  const candidate=task.candidates.find(c=>c.id===decision.selection);
  const seeded=candidate?.existing&&candidate.sources.some(ref=>task.sources?.some(s=>{
   const seed=(s.origin as {seed?:{kind:string;body:string;title:string;proof?:string;assumptions?:string[]}}|undefined)?.seed;
   return s.ref.kind==='user-seed'&&s.ref.bodyHash===ref.bodyHash&&s.entryRefs?.some(r=>sameMapRef(r,candidate.existing!))&&seed?.kind===candidate.kind&&seed.title===candidate.title&&seed.body===candidate.body&&(!candidate.argument.trim()||candidate.argument.trim()===seed.proof?.trim())&&stableHash(seed.assumptions??[])===stableHash(candidate.assumptions);
  }));
  if(seeded)continue;
  const placement=decision.placement;
  if(!placement?.reason?.trim())throw new MapError('INVALID_INPUT','Explain how this entry extends the map or which new field it introduces');
  if(placement.kind==='nearby'){
   const anchor=task.opened.find(o=>o.ref&&o.selection===placement.anchor);
   if(!anchor||!task.phaseOpened?.includes(placement.anchor))throw new MapError('INVALID_INPUT','Open the exact scientific anchor before placing this entry');
  }else if(placement.kind!=='new-field'||!placement.field.trim())throw new MapError('INVALID_INPUT','Identify the new field that needs consent');
  placements[decision.selection]=structuredClone(placement);
 }
 task.placements=placements;
 const remote=Object.entries(placements).filter((e):e is [string,Extract<MapPlacement,{kind:'new-field'}>]=>e[1].kind==='new-field'&&!previouslyDeclined(task,e[1].field));
 if(remote.length){
  const proposalHash=stableHash([task.projectId,task.id,task.sourceKeys,task.projection,task.candidates,decisions]);
  const premises=remote.flatMap(([,placement])=>placement.premise?.trim()?[{field:placement.field,statement:placement.premise}]:[]);
  task.domainRequest={proposalHash,...(premises.length?{premises}:{}),candidateIds:remote.map(([id])=>id),fields:[...new Set(remote.map(([,p])=>p.field))],reason:remote.map(([id,p])=>(task.candidates.find(c=>c.id===id)?.title??task.projection?.entry.title??id)+': '+p.reason).join('\n')};
 }
}
function dependentCandidates(task:MapMaintenanceTask,roots:Iterable<string>){
 const held=new Set(roots);
 let changed=true;
 while(changed){
  changed=false;
  for(const c of task.candidates){
   const linked=c.prerequisites.map(p=>p.ref).filter((r):r is string=>typeof r==='string');
   if(!held.has(c.id)&&linked.some(id=>held.has(id))){held.add(c.id);changed=true;}
  }
 }
 return held;
}
function previouslyDeclined(task:MapMaintenanceTask,field:string){
 return task.revisionScope?.declinedFields.some(value=>value.trim().toLowerCase()===field.trim().toLowerCase());
}
function heldCandidates(task:MapMaintenanceTask,includeSuperseded=true){
 const request=task.domainRequest,accepted=request?.acceptedFields??(request?.decision==='approve'?request.fields:[]);
 const ids=Object.entries(task.placements??{}).filter(([,p])=>p.kind==='new-field'&&(!accepted.includes(p.field)||previouslyDeclined(task,p.field))).map(([id])=>id);
 return dependentCandidates(task,includeSuperseded?[...ids,...task.supersededCandidates??[]]:ids);
}
export function createMapRevision(parent:MapMaintenanceTask):MapMaintenanceTask {
 const request=parent.domainRequest;
 if(!request?.decision||!parent.supersededCandidates?.length)throw new MapError('CONFLICT','No decided supplements require renewed review');
 const stale=dependentCandidates(parent,parent.supersededCandidates),denied=heldCandidates(parent,false);
 const targets=parent.candidates.filter(c=>stale.has(c.id)&&!denied.has(c.id)&&parent.decisions.some(d=>d.candidateId===c.id&&d.status!=='reject'));
 if(!targets.length)throw new MapError('CONFLICT','No approved supplement remains to revise');
 const intent:MapOutbox={id:parent.intentId,ownerId:parent.ownerId,projectId:parent.projectId,recipe:parent.recipe,state:'admitted',sourceKeys:parent.sourceKeys,singleAuthor:parent.singleAuthor,modelDirectedKnowledge:parent.modelDirectedKnowledge,refutationEvidence:parent.refutationEvidence,domainAdmission:true};
 const revision=createMapTask(intent,parent.model,parent.budget);
 revision.id='map_task_'+stableHash([parent.id,request.proposalHash,targets]);
 const accepted=request.acceptedFields??(request.decision==='approve'?request.fields:[]);
 revision.revisionScope={originTaskId:parent.id,targets:structuredClone(targets),declinedFields:[...new Set([...(parent.revisionScope?.declinedFields??[]),...request.fields.filter(f=>!accepted.includes(f))])]};
 return revision;
}
function checkRevisionTargets(task:MapMaintenanceTask,candidates:MapCandidateDraft[]){
 if(!task.revisionScope)return;
 const remaining=[...task.revisionScope.targets];
 for(const candidate of candidates){
  const i=remaining.findIndex(target=>target.kind===candidate.kind&&target.title===candidate.title&&target.existing?.id===candidate.existing?.id);
  if(i<0)throw new MapError('FORBIDDEN','Revise only the assigned claims and their exact supplement parent identities');
  remaining.splice(i,1);
 }
}
export function beginAlternate(task:MapMaintenanceTask){
 task.phase='alternate';task.status='ready';task.opened=[];task.phaseOpened=[];task.proofSelections=[];
 delete task.query;delete task.selection;delete task.view;delete task.openViews;delete task.readResults;delete task.currentReadResults;
}
async function prepare(task:MapMaintenanceTask,library:ResearchLibrary){
 if(task.phase!=='alternate')task.sources=await library.knowledgeMap.sourceBatch(task.sourceKeys,task.ownerId,task.projectId);
 if(task.phase==='alternate'&&task.alternateMethod)task.methodResult=await readAlternateMethod(task.alternateMethod,library);
 const grant=mapTaskGrant(task);
 // Retained reads keep their original source boundary across refresh and independent review.
 if(task.presentation&&task.view){task.openViews??={};for(const open of task.opened)task.openViews[open.selection]??=structuredClone(task.view);}
 if(!task.view||task.view.grant.purpose!==grant.purpose)task.view={...await library.freezeKnowledgeMap(grant),presentation:task.presentation,...(task.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{})};
 // Reopen exact historical handles and reject source withdrawal before exposing retained science.
 const reopened:MapOpenResult[]=[];
 for(const open of task.opened){const view=task.openViews?.[open.selection]??(!open.ref||task.view.refs.some(ref=>sameMapRef(ref,open.ref!))?task.view:await library.freezeKnowledgeMap({...grant,allowedRefs:[open.ref]}));try{reopened.push(retainMapOpenBases(open,await library.openKnowledgeMap(view,open.ref?mapHandle(open.ref):open.selection,view.grant)));}catch(error){if(!task.modelDirectedKnowledge||!mapReadFeedback(error))throw error;}}
 task.opened=reopened;
 if(task.authored&&task.phase!=='alternate'||task.phase==='publish')return;
 task.currentReadResults=await Promise.all((task.readResults??[]).map(r=>projectMapReadRecord(library,r)));
 if(task.modelDirectedKnowledge){const page=await retainedMapPage(task.selection,task.query,q=>library.queryKnowledgeMap(task.view!,q,task.view!.grant));Object.assign(task,page);}else task.selection=await library.queryKnowledgeMap(task.view,task.query??{query:(task.sources??[]).map(s=>s.body).join(' ').slice(0,16000),mode:'candidates'},task.view.grant);
}
async function apply(task:MapMaintenanceTask,reply:MapMaintenanceReply,library:ResearchLibrary){
 if(reply?.action==='read-method'&&task.phase==='alternate'&&reply.method?.query){
  task.alternateMethod={query:reply.method.query,open:reply.method.open,revision:task.alternateMethod?.revision};
  task.status='ready';delete task.receipt;return;
 }
 if(!reply||!['lookup','open','refresh','proposal','review','finish'].includes(reply.action)||typeof reply.body!=='string')throw new MapError('INVALID_INPUT','Invalid map native result');
 const previousPhase=task.phase;const grant=mapTaskGrant(task);if(!task.view)throw new MapError('FORBIDDEN','Missing map view');
 let feedback:MapReadRecord['feedback'];try{
 if(reply.action==='lookup'){const query=reply.query??{query:reply.body};task.selection=await library.queryKnowledgeMap(task.view,query,task.view.grant);task.query=query;}
 if(reply.action==='open'){
  if(reply.detail!==undefined&&reply.detail!=='proof')throw new MapError('INVALID_INPUT','Invalid map read detail');
  const opened=await library.openKnowledgeMap(task.view,reply.selection??'',task.view.grant);task.opened=task.opened.filter(o=>o.selection!==opened.selection);task.opened.push(opened);
  if((task.modelDirectedKnowledge||task.domainAdmission)&&!task.phaseOpened?.includes(opened.selection))(task.phaseOpened??=[]).push(opened.selection);
  if(task.presentation){task.openViews??={};task.openViews[opened.selection]=structuredClone(task.view);}
  if(reply.detail==='proof'&&!task.proofSelections?.includes(opened.selection))(task.proofSelections??=[]).push(opened.selection);
 }
 if(reply.action==='refresh'){task.view={...await library.freezeKnowledgeMap(grant),presentation:task.presentation,...(task.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{})};task.selection=undefined;if(task.modelDirectedKnowledge)delete task.query;}
 }catch(error){feedback=task.modelDirectedKnowledge?mapReadFeedback(error):undefined;if(!feedback)throw error;}
 if(task.phase==='alternate'&&!['lookup','open','refresh','finish'].includes(reply.action))throw new MapError('FORBIDDEN','Alternative research may only read evidence and report its result');
 let decisions=reply.decisions;
 if(reply.action==='proposal'){
  if(task.phase!=='extract'||!Array.isArray(reply.entries))throw new MapError('FORBIDDEN','Only maintenance proposes entries');
  const candidates=makeCandidates(task,reply.entries);checkRevisionTargets(task,candidates);task.candidates=candidates;task.decisions=[];if(task.singleAuthor){
   decisions=reply.entries.map((entry,i)=>({selection:candidates[i]!.id,status:entry.status,body:entry.placement?.reason||(entry.kind==='observation'?reply.body:'Qualification submitted with the cited public source.'),placement:entry.placement}));
  }else task.phase=task.candidates.length?'review':'publish';
 }
 if(task.phase==='alternate'&&reply.action==='finish'){
  if(!task.alternateRoute||!reply.body.trim())throw new MapError('INVALID_INPUT','State the result or remaining obstacle of the alternative attempt');
  task.alternateRoute.result=reply.body;task.status='completed';task.history.push({action:'alternate-result',body:reply.body});delete task.receipt;return;
 }
 if(task.singleAuthor&&reply.action==='finish'&&task.phase==='extract')decisions=[];
 if(reply.action==='review'||task.singleAuthor&&['proposal','finish'].includes(reply.action)){
  if(reply.action==='review'&&task.phase!=='review'||!Array.isArray(decisions))throw new MapError('FORBIDDEN','A qualification is required for each submitted entry');
  const reviewIds=task.projection?['canonical']:task.candidates.map(c=>c.id);
  if(decisions.length!==reviewIds.length||new Set(decisions.map(d=>d.selection)).size!==reviewIds.length||decisions.some(d=>!reviewIds.includes(d.selection)))throw new MapError('INVALID_INPUT','Review each exact candidate once');
  if(task.projection&&decisions[0]?.status!=='pending')throw new MapError('INVALID_INPUT','Return the canonical theory placement with pending status');
  if(reviewsOriginalReport(task)){
   const basis=reply.reportBasis;
   if(!basis?.body?.trim()||!['supported','material-gap'].includes(basis.status)||basis.status==='material-gap'&&(!basis.claim?.trim()||!basis.inference?.trim()))throw new MapError('INVALID_INPUT','Assess whether the original report establishes its conclusion and identify any material unsupported inference');
  }else if(reply.reportBasis)throw new MapError('FORBIDDEN','Only the assigned original report can receive a basis assessment');
  if(task.domainAdmission&&!decisions.some(d=>d.status==='revise'))classifyMapPlacement(task,decisions);
  task.decisions=task.projection?[]:decisions.map(d=>{const candidate=task.candidates.find(c=>c.id===d.selection);if(!candidate)throw new MapError('FORBIDDEN','Unknown candidate');const p=task.placements?.[d.selection];return {candidateId:candidate.id,candidateHash:stableHash(candidate),status:d.status,body:d.body,...(p?.kind==='nearby'?{anchor:{ref:selectedRef(task,p.anchor),basis:p.reason}}:{})};});
  if(reply.reportBasis){
   task.reportBasis=structuredClone(reply.reportBasis);
   if(reply.reportBasis.status==='material-gap'){
    const {claim,inference,body}=reply.reportBasis;
    task.pendingReviewObjection={claim,inference,body};
   }
  }
  task.phase=task.decisions.some(d=>d.status==='revise')?'extract':'publish';
 }
 if(reply.action==='finish'&&!task.singleAuthor){if(task.phase!=='extract')throw new MapError('FORBIDDEN','Review must decide each candidate');task.candidates=[];task.decisions=[];task.phase='publish';}
 if((task.modelDirectedKnowledge||task.domainAdmission)&&task.phase!==previousPhase){task.phaseOpened=[];delete task.query;delete task.selection;}
 if(task.presentation&&task.phase!==previousPhase){task.proofSelections=[];delete task.readResults;delete task.currentReadResults;}
 task.history.push({action:reply.action,body:reply.body});task.status='ready';delete task.receipt;return feedback;
}
async function referArchiveObjection(task:MapMaintenanceTask,library:ResearchLibrary,coordinator:ReturnType<typeof getV4Coordinator>,selection:number|undefined,objection:MapMaintenanceReply['objection']){
 const source=task.sources?.[(selection??0)-1],report=source?.origin as import('./post-report.js').ReportEvidenceV45|undefined;
 if(!task.domainAdmission||task.revisionScope||task.projection||task.alternateRoute||task.sources?.length!==1||source?.ref.kind!=='proof-report'||!report||report.scope.projectId!==task.projectId||report.artifactId!==source.ref.id||report.bodyHash!==source.ref.bodyHash||!objection?.body.trim()||!objection.claim.trim()||!objection.inference.trim())throw new MapError('FORBIDDEN','The objection must address the exact assigned proof report');
 const update=await library.assessArchivedReport(report,objection);
 if(update.status==='pending')await coordinator.queueArchiveReview(report,update);
 task.status='awaiting-assessment';task.waitingForReport=report.artifactId;
}
async function settleMapAssessment(coordinator:ReturnType<typeof getV4Coordinator>,library:ResearchLibrary,task:MapMaintenanceTask){
 if(task.status!=='awaiting-assessment'||!task.waitingForReport)return task;
 const row=library.reportAssessment(task.projectId,task.waitingForReport);
 if(!row||row.status==='pending'||row.status==='queued')return task;
 return coordinator.settleMapAssessment(task.id,row);
}
/** Seed admission and saved reports share this queue; neither starts the original proof. */
export async function admitMapMaintenance(options:{dataRoot:string;library:ResearchLibrary;ownerId:string;projectId:string;model:ModelSelection;budget:RoleBudget}){
 const coordinator=getV4Coordinator(options.dataRoot);
 for(const intent of await options.library.knowledgeMap.outbox(options.ownerId,options.projectId)){
  const registered=await coordinator.registerMapTask(createMapTask(intent,options.model,options.budget));
  const task=await settleMapAssessment(coordinator,options.library,registered);
  await options.library.knowledgeMap.markOutbox(intent.id,task.status==='completed'?'completed':'admitted',task.id);
 }
}
export function startMapMaintenance(options:{dataRoot:string;library:ResearchLibrary;runtime:MapRuntime;projectId:string;signal?:AbortSignal;onError?:(error:unknown)=>void}):void {
 const key=options.dataRoot+'|'+options.projectId;latest.set(key,options);wake.add(key);if(running.has(key))return;
 const work=(async()=>{while(!options.signal?.aborted&&wake.delete(key))await drainMapMaintenance(options);})().catch(error=>options.onError?.(error)).finally(()=>{running.delete(key);const next=latest.get(key);if(wake.has(key)&&next&&!next.signal?.aborted)startMapMaintenance(next);else latest.delete(key);});running.set(key,work);
}
export const isMapMaintenanceRunning=(dataRoot:string,projectId:string)=>running.has(dataRoot+'|'+projectId);
export async function waitMapMaintenance(dataRoot:string,projectId:string){const key=dataRoot+'|'+projectId;while(running.has(key))await running.get(key);}
export async function drainMapMaintenance(options:{dataRoot:string;library:ResearchLibrary;runtime:MapRuntime;projectId:string;signal?:AbortSignal}){
 const coordinator=getV4Coordinator(options.dataRoot);
 while(!options.signal?.aborted){
  const task=await coordinator.claimMapTask(options.projectId,!options.runtime.invokeTheoryV4);if(!task)return;
  let received=false;
  try{
   if(task.pendingReviewObjection){
    await referArchiveObjection(task,options.library,coordinator,1,task.pendingReviewObjection);
    delete task.pendingReviewObjection;
    await coordinator.saveMapTask(task);
    const settled=await settleMapAssessment(coordinator,options.library,task);
    if(settled.status==='completed')await options.library.knowledgeMap.markOutbox(task.intentId,'completed',task.id);
    continue;
   }
   if(task.receipt?.action!=='archive-objection')await prepare(task,options.library);await coordinator.saveMapTask(task);
   if(task.phase==='publish'){
    const request=task.domainRequest;
    const held=heldCandidates(task);
    const remaining=task.candidates.filter(c=>!held.has(c.id)&&(!task.localPublication?.ids.includes(c.id)||task.decisions.find(d=>d.candidateId===c.id)?.status==='reject'));
    const selected=new Set(remaining.map(c=>c.id));
    const decisions=task.decisions.filter(d=>selected.has(d.candidateId));
    const prior=task.localPublication;
    const priorEntries=prior?.reviewId?task.candidates.flatMap(candidate=>{const ref=prior.refs?.[candidate.id],decision=task.decisions.find(d=>d.candidateId===candidate.id);return ref&&decision?[{candidate,ref,decision,reviewId:prior.reviewId!}]:[];}):[];
    const proposal:MapReviewedProposal={...(task.authored?{authored:true}:{}),...(task.domainAdmission?{exactReview:true}:{}),...(request||task.revisionScope?{withheldCandidateIds:[...held],priorEntries}:{}),...(task.refutationEvidence?{refutationEvidence:true}:{}),...(task.modelDirectedKnowledge?{modelDirectedKnowledge:true as const}:{}),id:task.id+':'+stableHash([remaining,decisions]),ownerId:task.ownerId,projectId:task.projectId,expectedVersion:task.view!.mapVersion,candidates:remaining,decisions,reviewId:task.id+(task.singleAuthor?':author:':':review:')+stableHash(decisions),sourceKeys:task.sourceKeys};
    try{
     if(task.projection&&!held.has('canonical')){
      const source=task.sources?.[0];if(!source)throw new MapError('STALE_SOURCE','Projected theory source unavailable');
      const p=task.placements?.canonical;
      const anchor=p?.kind==='nearby'?selectedRef(task,p.anchor):undefined;
      task.publication=await options.library.knowledgeMap.projectTheory(task.projection.entry,{...source,body:''},task.projection.intentId,task.modelDirectedKnowledge,task.refutationEvidence,undefined,anchor&&p?{ref:anchor,basis:p.reason}:undefined);
     }
     if(remaining.length||(!task.projection&&!request&&!task.localPublication)){
      for(const d of decisions)if(d.anchor&&!task.opened.some(o=>o.ref&&sameMapRef(o.ref,d.anchor!.ref)))throw new MapError('STALE_SOURCE','Reviewed scientific anchor was withdrawn');
      const receipt=await options.library.publishKnowledgeMap(proposal,{...mapTaskGrant(task),purpose:'map-review'},()=>options.signal?.throwIfAborted());
      task.publication=receipt;
      if(request&&!request.decision){const retained=remaining.filter(c=>decisions.find(d=>d.candidateId===c.id)?.status!=='reject');task.localPublication={ids:remaining.map(c=>c.id),version:receipt.version,reviewId:proposal.reviewId,refs:Object.fromEntries(retained.map((c,i)=>[c.id,receipt.entries[i]!]))};}
     }
     if(request&&!request.decision)task.status='awaiting-consent';
     else if(request?.decision&&task.alternateRoute){
      beginAlternate(task);
     }else task.status='completed';
     await coordinator.saveMapTask(task);
     if(task.status==='completed'&&!task.revisionScope)await options.library.knowledgeMap.markOutbox(task.intentId,'completed',task.id);
    }
    catch(error){
     if(!(error instanceof MapError)||error.code!=='CONFLICT')throw error;
     if(task.domainRequest){
      if(!error.candidateId)throw error;
      (task.supersededCandidates??=[]).push(error.candidateId);
      const titles=task.candidates.filter(c=>task.supersededCandidates!.includes(c.id)).map(c=>c.title);
      task.domainRequest.revisionNote='The parent changed before publication. Review these supplements against the current statement: '+titles.join(', ')+'. Their dependent entries remain withheld.';
      task.history.push({action:'superseded-supplement',body:task.domainRequest.revisionNote});
     }else if(task.authored){
      task.status='failed';task.error='A source or parent changed after the scientific author submitted this write. The original submission is preserved.';
      await coordinator.saveMapTask(task);continue;
     }else{
      delete task.placements;task.phase=task.projection?'review':'extract';task.view=undefined;task.phaseOpened=[];
      task.history.push({action:'reconcile',body:'The map or reviewed parent changed. Compare retained claims with current versions and revise only the affected proposal.'});
     }
     task.status='ready';await coordinator.saveMapTask(task);
    }
    continue;
   }
   if(!task.receipt){
    if(task.authored&&task.phase!=='alternate')throw new MapError('INVALID_INPUT','Saved scientific write has no publication decision');
    if(task.nativeHandoff&&!task.nativeReply){task.nativeReply={callId:task.id+'_'+task.sends.length};await coordinator.saveMapTask(task);}
    const response=await options.runtime.invokeTheoryV4!({revision:'v4-operation-5',purpose:task.phase==='review'?'challenge':'assess',mapMaintenance:{task:structuredClone(task),purpose:task.phase==='review'?'map-review':'map-maintenance'},stages:[],previous:undefined,projectId:task.projectId,callId:task.nativeReply?.callId??task.id+'_'+task.sends.length,model:task.phase==='alternate'?task.alternateRoute?.model??task.model:task.model,budget:task.budget,knownTheories:[],signal:options.signal,
     ...(task.nativeHandoff?{nativeHandoff:{version:task.nativeHandoff,state:task.nativeReply,save:async(state:import('../../../runtime/native-handoff.js').NativeHandoffState)=>{await coordinator.saveMapNativeReply(task.id,state);task.nativeReply=structuredClone(state);}}}:{}),
     onDispatch:async()=>{task.attemptSent=true;task.sends.push({at:new Date().toISOString()});await coordinator.saveMapTask(task);},
     onUsage:async usage=>{if(task.sends.at(-1))task.sends.at(-1)!.usage=usage;if(task.nativeReply)await coordinator.recordMapUsage(task.id,task.nativeReply.callId,usage);else await coordinator.saveMapTask(task);}}) as MapMaintenanceReply;
    received=true;task.receipt=structuredClone(response);options.signal?.throwIfAborted();await coordinator.saveMapTask(task);
   }
   if(task.receipt!.maintenanceReferral)task.maintenanceReferral=true;
   if(task.receipt!.toolFeedback)task.toolFeedback=task.receipt!.toolFeedback;
   if(task.receipt!.action==='skip-unavailable'){
    if(task.receipt!.body.trim())task.history.push({action:'skip-unavailable',body:task.receipt!.body});
    task.status='ready';delete task.receipt;
   }else if(task.receipt!.action==='archive-objection'){
    if(task.phase==='review'&&reviewsOriginalReport(task))throw new MapError('INVALID_INPUT','Include the original report assessment with the candidate decisions');
    const r=task.receipt!;
    await referArchiveObjection(task,options.library,coordinator,r.source,r.objection);
    task.history.push({action:'archive-objection',body:r.body});delete task.receipt;
   }else if(task.receipt!.action==='read-batch'){
    const receipt=structuredClone(task.receipt!);if(!receipt.reads?.length||receipt.reads.some(r=>!['lookup','open','refresh'].includes(r.action)))throw new MapError('INVALID_INPUT','Read batch contains a non-read action');
    if(task.readBatchCursor===undefined){task.readBatchCursor=0;task.readResults=[];}
    for(;task.readBatchCursor<receipt.reads.length;){const read=receipt.reads[task.readBatchCursor]!;const feedback=await apply(task,{...read,body:'Native read '+read.toolCallId},options.library);task.receipt=receipt;task.status='sending';task.readResults!.push({call:read,...(feedback?{feedback}:{}),result:feedback?undefined:read.action==='open'?task.opened.find(o=>o.selection===read.selection):read.action==='lookup'?task.selection:{revision:task.view?.revision},view:structuredClone(task.view!)});task.readBatchCursor++;await coordinator.saveMapTask(task);}
    delete task.receipt;delete task.readBatchCursor;task.status='ready';
   }else{const receipt=task.receipt!;task.readResults=undefined;const feedback=await apply(task,receipt,options.library);if(task.presentation&&['lookup','open','refresh'].includes(receipt.action))task.readResults=[{call:{toolCallId:'single',action:receipt.action as 'lookup'|'open'|'refresh',query:receipt.query,selection:receipt.selection,detail:receipt.detail},...(feedback?{feedback}:{}),result:feedback?undefined:receipt.action==='open'?task.opened.find(o=>o.selection===receipt.selection):receipt.action==='lookup'?task.selection:{revision:task.view?.revision},view:structuredClone(task.view!)}];}
   if(task.nativeReply){(task.nativeReplies??=[]).push(task.nativeReply);delete task.nativeReply;}
   await coordinator.saveMapTask(task);
   const settled=await settleMapAssessment(coordinator,options.library,task);
   if(settled.status==='completed'&&!task.revisionScope)await options.library.knowledgeMap.markOutbox(task.intentId,'completed',task.id);
  }catch(error){if(options.signal?.aborted){await coordinator.releaseInterruptedMapTask(task);return;}
   if(error instanceof MapError&&error.code==='STALE_SOURCE'&&task.domainAdmission&&!task.projection&&!task.revisionScope&&!task.alternateRoute&&task.sourceKeys.length===1){
    const row=options.library.reportUpdates(task.projectId).findLast(r=>r.status!=='confirmed'&&mapSourceKey({kind:'proof-report',id:r.artifactId,version:1,bodyHash:r.bodyHash,ownerId:task.ownerId,projectId:task.projectId})===task.sourceKeys[0]);
    if(row&&options.library.reportAssessment(task.projectId,row.artifactId)?.status!=='confirmed'){
     task.status='awaiting-assessment';task.waitingForReport=row.artifactId;await coordinator.saveMapTask(task);
     const settled=await settleMapAssessment(coordinator,options.library,task);
     if(settled.status==='completed')await options.library.knowledgeMap.markOutbox(task.intentId,'completed',task.id);
     continue;
    }
   }
   if(task.phase==='publish'&&task.alternateRoute&&error instanceof MapError&&error.code==='STALE_SOURCE'){
    task.history.push({action:'source-withdrawn',body:'The source or anchor lost qualification. Treat the old report as disputed history. Rebuild the argument from available evidence.'});
    beginAlternate(task);await coordinator.saveMapTask(task);continue;
   }
   task.rejectedReceipt=!!task.receipt&&error instanceof MapError&&['INVALID_INPUT','FORBIDDEN'].includes(error.code);task.error=error instanceof Error?error.message:'Map maintenance unavailable';task.status=error instanceof MapError&&['INVALID_INPUT','FORBIDDEN','STALE_SOURCE'].includes(error.code)?'failed':task.receipt||task.pendingReviewObjection?'ready':task.nativeReply?.repairSent&&!task.nativeReply.repair||task.attemptSent&&!received&&!task.sends.at(-1)?.usage&&!task.nativeReply?.original?'uncertain':'failed';await coordinator.saveMapTask(task);if(task.status==='ready')return;}
 }
}
