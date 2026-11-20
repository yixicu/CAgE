import type {ScientificToolNotice} from '../../../runtime/native-handoff.js';
import { stableHash } from '../../../learning/research-hash.js';
import type {OptionalProofArtifactV21} from '../v21/optional-types.js';
import type { V4Scope } from './coordinator.js';

export interface ReportEvidenceV45 {
  scope: V4Scope; artifactId: string; body: string; bodyHash: string; proofOutline?:string;
  outcome: string; refutationKind?:'counterexample'|'contradiction'; empiricalEvidence?:true; pendingBranches: {id:string;state:string}[];
  supplements?:{artifactId:string;body:string;status:'unassessed'}[];
  related?:ReportEvidenceV45[];
}
/** Only the public outcome classification crosses from the completed proof. */
export function reportOutcomeV45(artifact:OptionalProofArtifactV21):Pick<ReportEvidenceV45,'outcome'|'refutationKind'|'empiricalEvidence'> {
 const outcome=artifact.control.outcome.resultKind;
 const empirical=artifact.resultContract==='scoped-refutation-v1'&&(outcome==='empirical-exclusion'||(outcome==='open'&&(artifact.mapKnowledge?.some(r=>r.kind==='observation'&&artifact.control.outcome.knowledgeRefs?.includes(r.selection))||artifact.control.adoptions.some(a=>a.status==='valid'&&a.outcome.resultKind==='empirical-exclusion'))));
 return {outcome,...(artifact.control.outcome.refutationKind?{refutationKind:artifact.control.outcome.refutationKind}:{}),...(empirical?{empiricalEvidence:true}: {})};
}
export interface ResearchReplyV45 extends ScientificToolNotice {
 contextPages?:{ref:string;offset:number;workingNote?:string}[];
 scientificSummary?:string;
 mapChanges?:import('./scientific-map-write.js').ScientificMapChanges;
 mapCard?:{title:string;summary:string;domain:string[]};
 mapWriteReads?:import('../../../learning/knowledge-map.js').MapOpenResult[];
 placement?:import('./map-maintenance.js').MapPlacement;
 objection?:import('../../../learning/report-assessment.js').ReportObjection; decision?:import('../../../learning/report-assessment.js').ReportDecision; routeQuery?:import('../../../learning/directed-route.js').DirectedRouteQuery; action:'read-context-page'|'skip-unavailable'|'archive-objection'|'archive-decision'|'finish'|'continue'|'review'|'publish'|'read'|'query-knowledge'|'open-knowledge'|'bind-knowledge'|'relate-theory'|'revise'|'lookup-map'|'open-map'|'refresh-map'|'save-map-result'|'read-map-batch'|'read-batch'|'save-and-review'; body:string;nativeCallIds?:[string,string];nativeCallId?:string;readCalls?:{toolCallId:string;request:ResearchReplyV45}[];mapRead?:import('./map-reader.js').MapReadRecord;readBatchId?:string;reads?:import('../../../learning/knowledge-map.js').MapReadCall[]; mapQuery?:import('../../../learning/knowledge-map.js').MapQuery;mapSelection?:string;detail?:'proof';map?:MapStudyContext;kind?:'finding'|'theory';qualification?:'candidate'|'supported';selection?:number;offset?:number;conditions?:string[];relation?:'revises'|'narrows';knowledge?:import('./knowledge-study.js').KnowledgeStudyV4 }
export interface MapStudyContext {phase?:'research'|'review';lastRead?:import('./map-reader.js').MapReadRecord;presentation?:'layered-map-v1';proofSelections?:string[];readResults?:unknown[];query?:import('../../../learning/knowledge-map.js').MapQuery;profile:import('../../../learning/knowledge-map.js').FoundationProfile;revision:string;opened:import('../../../learning/knowledge-map.js').MapOpenResult[];selection?:import('../../../learning/knowledge-map.js').MapSelection}
export interface PostReportStudyV45 extends ScientificToolNotice {
  contextCompaction?:'staged-context-v1';
  archiveReview?:import('../../../learning/report-assessment.js').ReportUpdate;
  scientificMapWrites?:true;
  mapNodeWriting?:'structured-map-v2';
  domainAdmission?:true;
  refutationEvidence?:true;
  modelDirectedKnowledge?:true;
  nativeHandoff?:'native-handoff-v1';
  nativeReply?:import('../../../runtime/native-handoff.js').NativeHandoffState;
  nativeReplies?:import('../../../runtime/native-handoff.js').NativeHandoffState[];
  retryRequests?:string[];
  readBatch?:{id:string;hash:string;cursor:number;results:{toolCallId:string;request:ResearchReplyV45;result:unknown;mapRead?:import('./map-reader.js').MapReadRecord}[]};
  currentReadResults?:unknown[];
  map?:MapStudyContext;
  knowledge?:import('./knowledge-study.js').KnowledgeStudyV4;
  id:string; report:ReportEvidenceV45; phase:'research'|'review';
  status:'ready'|'sending'|'uncertain'|'completed'|'failed'|'stopped';
  responses:ResearchReplyV45[]; sends:{at:string;usage?:{tokens?:number;costUsd?:number}}[];
  receipt?:ResearchReplyV45; error?:string;
  attemptSent?:boolean;
  availableSources?:ReportEvidenceV45[];
  publication?:{placement?:import('./map-maintenance.js').MapPlacement;qualification?:'candidate'|'supported';kind:'finding'|'theory';body:string;review:string;sourceHash:string};
}
export function reportStudyId(scope:V4Scope,artifactId:string,bodyHash:string){return 'report_'+stableHash([scope,artifactId,bodyHash]);}
export function reportStudyV45(report:ReportEvidenceV45):PostReportStudyV45 {
  if(!report.body.trim()||stableHash(report.body)!==report.bodyHash)throw Error('Invalid public report evidence');
  return {id:reportStudyId(report.scope,report.artifactId,report.bodyHash),report:structuredClone(report),phase:'research',status:'ready',responses:[],sends:[]};
}
export function isPublicResearchReply(study:PostReportStudyV45,reply:ResearchReplyV45){return reply.action==='save-map-result'||(study.nativeHandoff==='native-handoff-v1'&&reply.action==='review')||(study.scientificMapWrites===true&&reply.action==='finish'&&!!reply.mapChanges);}
export function savedPublicResearchId(study:PostReportStudyV45,body:string):string|undefined {
  const index=study.responses.findIndex(r=>isPublicResearchReply(study,r)&&r.body===body);
  return index<0?undefined:study.id+':public:'+index;
}
export function applyResearchReplyV45(study:PostReportStudyV45,reply:ResearchReplyV45):void {
  if(reply?.action==='read-context-page'){
    if(study.contextCompaction!=='staged-context-v1'||!reply.contextPages?.length||reply.contextPages.some(page=>!Number.isSafeInteger(page.offset)||page.offset<0||!page.ref))throw Error('Invalid Moderator context page');
    study.responses.push({action:reply.action,body:'Requested context page',contextPages:structuredClone(reply.contextPages)});
    study.status='ready';delete study.receipt;return;
  }
  if(reply?.mapChanges&&(!study.scientificMapWrites||study.archiveReview||study.phase!=='research'||!['save-map-result','review','finish'].includes(reply.action)))throw Error('Map change outside the public scientific handoff.');
  if(reply?.mapWriteReads?.length&&!reply.mapChanges&&!reply.placement)throw Error('Unbound scientific map read receipt.');
  if(reply?.placement&&(!study.scientificMapWrites||!study.map||study.phase!=='review'||study.archiveReview||reply.action!=='publish'))throw Error('Theory placement requires its publishing review.');
  if(reply?.maintenanceReferral)study.maintenanceReferral=true;
  if(reply?.toolFeedback)study.toolFeedback=reply.toolFeedback;
  if(reply?.action==='skip-unavailable'){
    if(reply.body.trim())study.responses.push({action:reply.action,body:reply.body});
    study.status='ready';delete study.receipt;return;
  }
  if(reply?.action==='archive-objection'||reply?.action==='archive-decision'){
    if(!study.domainAdmission||study.report.outcome!=='supported-result')throw Error('Archived argument assessment outside this task');
    if(reply.action==='archive-objection'){
      if(study.archiveReview||!reply.objection?.claim?.trim()||!reply.objection.inference?.trim()||!reply.objection.body?.trim())throw Error('Identify the exact claim and unsupported inference');
    }else if(study.phase!=='review'||!study.archiveReview||!reply.decision?.body?.trim()||!['conditional','unsupported','confirmed'].includes(reply.decision.status)||reply.decision.status==='conditional'&&!reply.decision.condition?.trim())throw Error('An independent archive assessment is required');
    study.responses.push(structuredClone(reply));study.status='completed';delete study.receipt;return;
  }
  if(study.archiveReview&&!['lookup-map','open-map','refresh-map','read-map-batch','read-batch','query-knowledge','open-knowledge'].includes(reply?.action))throw Error('Resolve the frozen archive objection before closing its review');
  if(reply?.action==='save-and-review'){
    const ids=reply.nativeCallIds;
    if(study.phase!=='research'||!study.map||!reply.map||!ids||ids.length!==2||ids.some(id=>typeof id!=='string'||!id.trim())||ids[0]===ids[1]||!['finding','theory'].includes(reply.kind??''))throw Error('Invalid public-save and review combination');
    // Both effects share one coordinator commit; no intermediate save-only state is exposed.
    const next=structuredClone(study);
    applyResearchReplyV45(next,{action:'save-map-result',body:reply.body,map:reply.map,nativeCallId:ids[0]});
    applyResearchReplyV45(next,{action:'review',body:reply.body,kind:reply.kind,nativeCallId:ids[1]});
    Object.assign(study,next);delete study.receipt;return;
  }
  if(!reply||typeof reply.body!=='string'||!reply.body.trim()||!['finish','continue','review','publish','read','query-knowledge','open-knowledge','bind-knowledge','relate-theory','revise','lookup-map','open-map','refresh-map','save-map-result','read-map-batch','read-batch'].includes(reply.action))throw Error('Invalid native research result');
  if(['lookup-map','open-map','refresh-map','save-map-result','read-map-batch'].includes(reply.action)){if(!study.map||!reply.map||reply.action==='save-map-result'&&study.phase!=='research')throw Error('Map action requires current role authority');study.map=structuredClone(reply.map);}
  if(['query-knowledge','open-knowledge','bind-knowledge','relate-theory'].includes(reply.action)){
    if(!study.knowledge||!reply.knowledge||study.phase!=='research'&&!['query-knowledge','open-knowledge'].includes(reply.action))throw Error('Knowledge action requires a frozen research grant');
    study.knowledge=structuredClone(reply.knowledge);
  }
  if(reply.action==='revise'){if(!study.knowledge||study.phase!=='review')throw Error('Revision requires an independent review');study.phase='research';}
  if(reply.action==='read'){
    const source=study.availableSources?.[(reply.selection??0)-1];if(!source||study.phase!=='research')throw Error('Invalid source selection');
    study.report.related??=[];if(!study.report.related.some(r=>r.artifactId===source.artifactId&&r.scope.projectId===source.scope.projectId))study.report.related.push(structuredClone(source));
  }
  if(reply.action==='review'&&(study.phase!=='research'||!['finding','theory'].includes(reply.kind??'')))throw Error('Invalid review request');
  if(reply.action==='publish'){
    const candidate=study.responses.findLast(r=>r.action==='review');
    if(study.phase!=='review'||!candidate?.kind)throw Error('Publication requires an independent review context');
    study.publication={...(reply.placement?{placement:structuredClone(reply.placement)}:{}),...(study.knowledge?{qualification:reply.qualification==='supported'?'supported' as const:'candidate' as const}:{}),kind:candidate.kind,body:candidate.body,review:reply.body,sourceHash:study.report.bodyHash};
  }
  const {knowledge:_hostKnowledge,map:_hostMap,mapRead:_hostRead,toolFeedback:_feedback,maintenanceReferral:_referral,...scientificReply}=reply;
  study.responses.push(structuredClone(scientificReply));
  study.status=['continue','review','read','query-knowledge','open-knowledge','bind-knowledge','relate-theory','revise','lookup-map','open-map','refresh-map','save-map-result','read-map-batch','read-batch'].includes(reply.action)?'ready':'completed';
  if(reply.action==='review')study.phase='review';
  if((reply.action==='review'||reply.action==='revise')&&(study.map?.presentation==='layered-map-v1'||study.knowledge?.presentation==='layered-map-v1'))clearResearchReadContext(study);
  delete study.receipt;
}

export function clearResearchReadContext(study:PostReportStudyV45){
 delete study.readBatch;delete study.currentReadResults;
 if(study.modelDirectedKnowledge){if(study.map){delete study.map.query;delete study.map.selection;}if(study.knowledge){delete study.knowledge.routeQuery;delete study.knowledge.readNotice;study.knowledge.phaseOpened=[];}}
 if(study.map){delete study.map.readResults;delete study.map.lastRead;study.map.proofSelections=[];}
 if(study.knowledge){study.knowledge.proofRefs=[];delete study.knowledge.lastRead;}
}
