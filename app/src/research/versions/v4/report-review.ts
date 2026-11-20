import {reportOutcomeV45} from './post-report.js';
import {digestV21} from '../v21/state.js';
import type {ResearchProjectV21} from '../../contracts/v21.js';
import {LearningDataError} from '../../../learning/research-data.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import type {ReportUpdate} from '../../../learning/report-assessment.js';
import type {MapSource} from '../../../learning/knowledge-map.js';
import {stableHash} from '../../../learning/research-hash.js';
import {reportStudyId} from './post-report.js';
import {getV4Coordinator,type V4Scope} from './coordinator.js';

export function conditionalSource(row:ReportUpdate):MapSource{
 if(row.status!=='conditional'||!row.condition||!row.review)throw Error('A reviewed conditional argument is required');
 const {projectId,epochId,rootId}=row;
 const studyId=reportStudyId({projectId,epochId,rootId},row.artifactId,row.bodyHash);
 const body=[row.claim,'Condition: '+row.condition,row.review].join('\n\n');
 return {ref:{kind:'public-research',id:row.id,version:row.revision,bodyHash:stableHash(body),ownerId:'local-user',projectId:row.projectId},status:'active',body,origin:{studyId,assessmentId:row.id,revision:row.revision,condition:row.condition}};
}

/** Replay both sides of the ledger/library handoff following a crash. */
export async function reconcileReportReviews(dataRoot:string,library:ResearchLibrary,projectId:string,scope?:V4Scope){
 const coordinator=getV4Coordinator(dataRoot);
 const studies=(scope?(await coordinator.snapshot(scope)).postReports:await coordinator.researchReports(projectId)).filter(s=>s.domainAdmission&&s.report.scope.projectId===projectId);
 if(!studies.length)return;
 for(const study of studies){
  const reply=study.responses.at(-1);
  if(reply?.action==='archive-objection'&&reply.objection){
   try{
    const row=await library.assessArchivedReport(study.report,reply.objection);
    if(row.status==='pending')await coordinator.queueArchiveReview(study.report,row);
   }catch(error){
    // A public result can precede its proof archive. The original receipt remains replayable.
    if(!(error instanceof LearningDataError&&error.code==='STALE_SOURCE'))throw error;
   }
  }
  if(reply?.action==='archive-decision'&&reply.decision&&study.archiveReview){
   const {claim,inference,body}=study.archiveReview;
   await library.assessArchivedReport(study.report,{claim,inference,body},reply.decision);
  }
 }
 const updates=library.reportUpdates(projectId);
 for(let row of updates){
  if(scope&&(scope.epochId!==row.epochId||scope.rootId!==row.rootId)||updates.findLast(r=>r.id===row.id)?.revision!==row.revision)continue;
  const base=studies.find(s=>!s.archiveReview&&s.report.artifactId===row.artifactId&&s.report.scope.epochId===row.epochId&&s.report.scope.rootId===row.rootId);
  if(!base)continue;
  if(row.status==='queued'){const {claim,inference,body}=row;row=await library.assessArchivedReport(base.report,{claim,inference,body});}
  if(library.reportAssessment(projectId,row.artifactId)?.revision!==row.revision)continue;
  if(row.status==='pending')await coordinator.queueArchiveReview(base.report,row);
  if(row.status==='conditional')await library.knowledgeMap.admit([conditionalSource(row)],'local-user',projectId,true,base.refutationEvidence,true,true);
 }
}

type Epoch = import('../../contracts/v21.js').InFlightEpochV21 | import('../../contracts/v21.js').EpochRecordV21;

function formalReports(projectId:string, epoch:Epoch) {
 if(epoch.projectId!==projectId||!epoch.snapshot.mapGapPolicy||epoch.optionalFlow?.conflictArtifactIds.length)return [];
 return (epoch.optionalFlow?.archives??[]).flatMap(receipt=>{
  const a=epoch.optionalFlow!.artifacts.find(item=>item.id===receipt.artifactId);
  const verdict=a?.acceptedOutcome, report=a?.publicReport;
  if(!a?.acceptanceCommitted||a.authorRole!=='theorist'||a.qualification!=='valid'||!report||!verdict||
   !['supported-result','valid-refutation'].includes(verdict.resultKind)||verdict.scope!=='root'||verdict.gaps.length||
   receipt.status!=='saved'||!receipt.proofRef||receipt.selection.projectId!==projectId||receipt.selection.epochId!==epoch.snapshot.id||
   a.originalRef.owner!==projectId||a.originalRef.projectId!==projectId||a.originalRef.epochId!==epoch.snapshot.id||
   a.root.revision!==epoch.snapshot.root.revision||report.bodyHash!==stableHash(report.body)||a.originalRef.bodyHash!==digestV21(report.body))return [];
  return [{ref:receipt.proofRef,caseGroup:receipt.selection.caseGroupId,evidence:{
   scope:{projectId,epochId:epoch.snapshot.id,rootId:a.root.revision},artifactId:a.id,...report,...reportOutcomeV45(a),
  }}];
 });
}

/** Refer opposing formal outcomes for independent assessment on the exact unchanged proposition. */
export async function reviewOpposedArchives(dataRoot:string,library:ResearchLibrary,project:ResearchProjectV21,epoch:Epoch){
 if(!epoch.snapshot.discussion)return;
 const current=formalReports(project.id,epoch);
 if(!current.length)return;
 const coordinator=getV4Coordinator(dataRoot);
 for(const previous of project.epochs){
  if(previous.epoch>=epoch.epoch||previous.snapshot.root.hypothesisId!==epoch.snapshot.root.hypothesisId||
   previous.snapshot.root.revision!==epoch.snapshot.root.revision||stableHash(previous.snapshot.sources)!==stableHash(epoch.snapshot.sources))continue;
  for(const prior of formalReports(project.id,previous))for(const next of current){
   if(prior.caseGroup!==next.caseGroup||prior.evidence.outcome===next.evidence.outcome)continue;
   const [supported,opposed]=prior.evidence.outcome==='supported-result'?[prior,next]:[next,prior];
   const objection={claim:epoch.snapshot.root.originalText,inference:'The archived argument and a formal refutation reach opposite conclusions on this root.',
    body:'Compare the argument with the public refutation '+opposed.evidence.artifactId+' from '+opposed.evidence.scope.epochId+':\n'+opposed.evidence.body};
   const rows=library.reportUpdates(project.id);
   const existing=rows.findLast(row=>row.artifactId===supported.evidence.artifactId&&row.bodyHash===supported.evidence.bodyHash&&row.body===objection.body&&row.claim===objection.claim&&row.inference===objection.inference);
   if(!existing&&(!library.isCurrentArchive(opposed.ref)||!library.isCurrentArchive(supported.ref)))continue;
   const row=existing??await library.assessArchivedReport(supported.evidence,objection,undefined,opposed.evidence.artifactId);
   if(row.status==='pending')await coordinator.queueArchiveReview(supported.evidence,row);
  }
 }
}
