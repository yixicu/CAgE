import type {ResearchProjectV21} from '../../contracts/v21.js';
import type {ProofDocument} from '../../../learning/research-data.js';
import {stableHash} from '../../../learning/research-hash.js';
import {digestV21} from '../v21/state.js';
import {mapSourceKey} from '../../../learning/knowledge-map.js';
import type {MapMaintenanceTask} from './map-maintenance.js';
import type {PostReportStudyV45,ReportEvidenceV45} from './post-report.js';

export function declinedFieldOrigin(project:ResearchProjectV21,task:MapMaintenanceTask,studies:PostReportStudyV45[],cards:Map<string,ReportEvidenceV45>=new Map()){
 const reports=new Map<string,Pick<ReportEvidenceV45,'scope'|'artifactId'|'bodyHash'>>();
 const archivedBodies=new Map<string,{refHash:string;body:string}>();
 const requested=new Set(task.domainRequest?.candidateIds);
 const selected=new Set(task.candidates.filter(c=>requested.has(c.id)).flatMap(c=>c.sources.map(mapSourceKey)));
 for(const source of task.sources??[]){
  if(source.ref.projectId!==project.id||selected.size&&!selected.has(mapSourceKey(source.ref)))continue;
  if(source.ref.kind==='library-proof'){
   if(stableHash(source.body)!==source.ref.bodyHash)continue;
   const doc:ProofDocument=JSON.parse(source.body), p=doc.meta.optionalProof;
   if(!p||doc.meta.sessionId!==project.id||doc.meta.caseId!==source.ref.id||doc.meta.revision!==source.ref.version)continue;
   const original=doc.originals?.find(o=>o.artifactId===p.artifactId&&stableHash(o.originalRef)===stableHash(p.originalRef));
   if(!original||digestV21(original.body)!==p.originalRef.bodyHash)continue;
   reports.set(p.artifactId,{scope:{projectId:project.id,epochId:p.originalRef.epochId,rootId:p.root.revision},artifactId:p.artifactId,bodyHash:stableHash(original.body)});
   archivedBodies.set(p.artifactId,{refHash:stableHash(p.originalRef),body:original.body});
   continue;
  }
  const origin=source.origin as {studyId?:string;report?:ReportEvidenceV45;assessmentId?:string;cardId?:string}|undefined;
  const report=source.ref.kind==='proof-report'?source.origin as ReportEvidenceV45:
   origin?.report??(origin?.cardId?cards.get(origin.cardId):undefined)??studies.find(s=>s.id===origin?.studyId||!!origin?.assessmentId&&s.archiveReview?.id===origin.assessmentId)?.report;
  if(report?.scope.projectId===project.id)reports.set(report.artifactId,report);
 }
 const epochs=project.activeEpoch?[...project.epochs,project.activeEpoch]:project.epochs;
 const questions=new Set<string>(),bodies:string[]=[];
 const epochIds=new Set<string>();
 let model;
 for(const report of reports.values()){
  const epoch=epochs.find(e=>e.snapshot.id===report.scope.epochId);
  const artifact=epoch?.optionalFlow?.artifacts.find(a=>a.id===report.artifactId&&a.root.revision===report.scope.rootId);
  if(!epoch||!artifact)continue;
  const archived=archivedBodies.get(artifact.id);
  const body=artifact.publicReport?.bodyHash===report.bodyHash?artifact.publicReport.body:
   archived&&stableHash(artifact.originalRef)===archived.refHash?archived.body:undefined;
  if(body===undefined)continue;
  epochIds.add(epoch.snapshot.id);
  questions.add(artifact.root.originalText);
  bodies.push(body);
  const models=epoch.snapshot.modelConfig??epoch.snapshot.config;
  model=models.roleModels?.theorist??models.defaultModel;
 }
 if(questions.size!==1||epochIds.size!==1)return;
 return {question:[...questions].join('\n\n'),report:bodies.join('\n\n'),model,epochIds:[...epochIds]};
}
