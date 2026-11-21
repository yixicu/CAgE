import {loadProofNotes} from '../../../storage/proof-notes.js';
import {registerScientificSource} from './scientific-map-write.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import type {OptionalProofArtifactV21} from '../v21/optional-types.js';
import type {FileResearchStore} from '../../../storage/index.js';
import type {ResearchCompositionV21,InFlightEpochV21} from '../../contracts/v21.js';
import type {MapSource,MapRef} from '../../../learning/knowledge-map.js';
import {mapSourceKey} from '../../../learning/knowledge-map.js';
import {stableHash} from '../../../learning/research-hash.js';
import {affectedOptionalEvidenceV3} from '../v21/optional-engine.js';
import {declinedFieldOrigin} from './declined-field.js';
import type {ResearchProjectV21} from '../../contracts/v21.js';
import type {MapMaintenanceTask} from './map-maintenance.js';
import {getV4Coordinator} from './coordinator.js';
import {PublishedTheoriesV4,reportKnowledgeRef} from './published.js';
import {savedPublicResearchId,isPublicResearchReply,reportOutcomeV45,reportStudyV45,type ReportEvidenceV45} from './post-report.js';
import {conditionalSource,reconcileReportReviews} from './report-review.js';
import {matchesPendingReview,type ReportUpdate} from '../../../learning/report-assessment.js';
import {MapResearch} from './map-research.js';
import {digestV21} from '../v21/state.js';
import {knowledgeRefKey,type KnowledgeRef} from '../../../learning/knowledge-network.js';

export function reportMapSource(report:ReportEvidenceV45):MapSource{return {ref:{kind:'proof-report',id:report.artifactId,version:1,bodyHash:report.bodyHash,ownerId:'local-user',projectId:report.scope.projectId},body:report.body,status:'active',origin:structuredClone(report)};}

export async function registerReportMapSource(library:ResearchLibrary,snapshot:InFlightEpochV21['snapshot'],artifact:OptionalProofArtifactV21,report:ReportEvidenceV45,dataRoot?:string){
 const source=reportMapSource(report);
 if(snapshot.scientificMapWrites)await registerScientificSource(library,source,artifact.control.mapChanges,artifact.mapWriteReads??[],snapshot.resultContract?true:undefined);
 else await library.knowledgeMap.admit([source],'local-user',report.scope.projectId,snapshot.modelDirectedKnowledge,snapshot.resultContract?true:undefined,snapshot.mapGapPolicy?true:undefined);
 if(!dataRoot||!artifact.acceptanceCommitted||artifact.authorRole!=='theorist'||!artifact.publicReport||
    artifact.technical.executionStatus!=='completed'||artifact.publicReport.body!==report.body||artifact.originalRef.bodyHash!==digestV21(report.body))return;
 // These optional notes may be absent or unreadable after recovery. The accepted report is independent.
 const saved=await loadProofNotes(dataRoot,artifact.originalRef).catch(()=>undefined);
 if(!Array.isArray(saved?.confirmations))return;
 const opened=artifact.mapKnowledge??[],lines=report.body.split('\n');
 for(const confirmation of saved.confirmations){
  if(!confirmation||typeof confirmation!=='object')continue;
  const {selection,first,last,useLine,prerequisites,excerpt}=confirmation;
  const node=opened.find(n=>n.selection===selection);
  if(!node||![first,last,useLine].every(Number.isSafeInteger)||first<0||first>last||last>=lines.length||useLine<0||useLine>=lines.length||
    lines.slice(first,last+1).join('\n')!==excerpt||!Array.isArray(prerequisites))continue;
  const parents=opened.filter(n=>prerequisites.includes(n.selection));
  if(parents.length!==prerequisites.length)continue;
  if(await library.knowledgeMap.pendingTheoristReview(report.scope.projectId,node))
   await library.knowledgeMap.confirmTheoristProof(report.scope.projectId,node,source.ref,excerpt,parents,
    artifact.acceptedOutcome?.conditions??artifact.control.outcome.conditions??[]);
 }
}

/** Reuse the accepted-public-report and source revocation boundary, never private drafts. */
export class MapSources {
 private readonly theories:PublishedTheoriesV4;
 constructor(private readonly store:FileResearchStore,private readonly composition:ResearchCompositionV21){this.theories=new PublishedTheoriesV4(store.dataRoot);}
 async domainOrigins(project:ResearchProjectV21,tasks:MapMaintenanceTask[]){
  const wanted=new Set<string>();
  for(const task of tasks)for(const source of task.sources??[]){
   const origin=source.origin as {cardId?:string;studyId?:string}|undefined;
   if(source.ref.projectId===project.id&&origin?.cardId&&!origin.studyId)wanted.add(origin.cardId);
  }
  const cards=wanted.size?await this.theories.readReportStudies(r=>r.scope.projectId===project.id,c=>wanted.has(c.id)):[];
  const reports=new Map(cards.map(c=>[c.id,c.source]));
  const studies=tasks.length?await getV4Coordinator(this.store.dataRoot).researchReports(project.id):[];
  return new Map(tasks.map(task=>[task.id,declinedFieldOrigin(project,task,studies,reports)]));
 }
 async authorizeReport(report:ReportEvidenceV45,access?:number|ReportUpdate):Promise<boolean>{
  if(!report||stableHash(report.body)!==report.bodyHash||this.store.library.opposingReportHeld(report.scope.projectId,report.artifactId))return false;
  const assessment=this.store.library.reportAssessment(report.scope.projectId,report.artifactId);
  const qualified=assessment?.status==='conditional'&&assessment.revision===access;
  const reviewing=typeof access==='object'&&matchesPendingReview(assessment,access);
  if(assessment&&assessment.status!=='confirmed'&&!qualified&&!reviewing)return false;
  for(const related of report.related??[])if(!await this.authorizeReport(related))return false;
  const p=await this.composition.v4SourceProject?.(report.scope.projectId);if(!p)return false;
  const epoch=p.activeEpoch?.snapshot.id===report.scope.epochId?p.activeEpoch:p.epochs.find(e=>e.snapshot.id===report.scope.epochId);
  const artifact=epoch?.optionalFlow?.artifacts.find(a=>a.id===report.artifactId);
  if(!epoch||!artifact?.acceptanceCommitted||artifact.authorRole!=='theorist'||artifact.publicReport?.body!==report.body||artifact.publicReport.bodyHash!==report.bodyHash||artifact.originalRef.bodyHash!==digestV21(report.body)||artifact.root.revision!==report.scope.rootId||['rejected','needs-review'].includes(artifact.qualification))return false;
  const verdict=reportOutcomeV45(artifact);
  if(report.empiricalEvidence!==verdict.empiricalEvidence||report.refutationKind!==verdict.refutationKind)return false;
  const marker:InFlightEpochV21='loop'in epoch?epoch:{...epoch,schemaVersion:3,projectId:p.id,loop:{researchLoopVersion:p.researchLoopVersion,workerProtocolVersion:'2.1'}};
  return !(await affectedOptionalEvidenceV3(this.composition,p,marker,epoch.optionalFlow!,qualified||reviewing?artifact.id:undefined)).includes(artifact.id);
 }
 async valid(source:MapSource):Promise<boolean>{
  if(source.ref.ownerId!=='local-user'||source.status!=='active'||(!source.canonicalTheory&&stableHash(source.body)!==source.ref.bodyHash))return false;
  if(source.ref.kind==='user-seed')return true;
  if(source.ref.kind==='proof-report'){const report=source.origin as ReportEvidenceV45;return !!report&&report.artifactId===source.ref.id&&report.scope.projectId===source.ref.projectId&&report.body===source.body&&report.bodyHash===source.ref.bodyHash&&await this.authorizeReport(report);}
  if(source.ref.kind==='public-research'){
   const origin=source.origin as {studyId:string;body:string;publicationHash?:string;cardId?:string;assessmentId?:string};
   if(origin?.assessmentId){
    const row=this.store.library.reportUpdates(source.ref.projectId).findLast(r=>r.id===origin.assessmentId);
    if(!row||row.status!=='conditional'||this.store.library.reportAssessment(row.projectId,row.artifactId)?.revision!==row.revision||stableHash(conditionalSource(row))!==stableHash(source))return false;
    const base=(await getV4Coordinator(this.store.dataRoot).researchReports(row.projectId)).find(s=>!s.archiveReview&&s.domainAdmission&&s.report.scope.projectId===row.projectId&&s.report.scope.epochId===row.epochId&&s.report.artifactId===row.artifactId&&s.report.bodyHash===row.bodyHash);
    return !!base&&await this.authorizeReport(base.report,row.revision);
   }
   if(origin?.cardId){return (await this.canonicalCards(c=>c.id===origin.cardId)).some(c=>c.kind==='finding'&&c.id===origin.cardId&&c.source.scope.projectId===source.ref.projectId&&c.body===source.body);}
   const study=(await getV4Coordinator(this.store.dataRoot).researchReports()).find(s=>s.id===origin?.studyId);
   return !!study&&study.report.scope.projectId===source.ref.projectId&&await this.authorizeReport(study.report)&&(origin.publicationHash?study.publication?.kind==='finding'&&stableHash(study.publication)===origin.publicationHash&&study.publication.body===source.body:study.responses.some((r,i)=>isPublicResearchReply(study,r)&&r.body===source.body&&source.ref.id===study.id+':public:'+i));
  }
  if(source.ref.kind==='theory'){const cards=await this.canonicalCards(c=>c.id===source.ref.id);return cards.some(c=>c.kind==='theory'&&c.id===source.ref.id&&stableHash(c.body)===source.ref.bodyHash&&(!source.canonicalTheory||stableHash(reportKnowledgeRef(c))===stableHash(source.canonicalTheory)));}
  if(source.ref.kind==='library-proof'){const {empiricalEvidence,...ref}=source.origin as import('../../../learning/research-data.js').ProofRef&{empiricalEvidence?:true};if(!this.store.library.isProofValid(ref))return false;const document=await this.store.library.readFinalProof(ref,{role:'theorist',sessionId:ref.sessionId});return (empiricalEvidence===true)===(document.meta.logicalRelation==='empirical-exclusion')&&stableHash(JSON.stringify(document))===source.ref.bodyHash;}
  return false;
 }
 private async canonicalCards(select?:(card:import('./published.js').ReportTheoryCardV45)=>boolean){const cards=await this.theories.readReportStudies(r=>this.authorizeReport(r),select),index=new Map(cards.map(c=>[knowledgeRefKey(reportKnowledgeRef(c)),c]));
  const valid=async(ref:KnowledgeRef,seen=new Set<string>()):Promise<boolean>=>{if(ref.store==='library')return this.store.library.knowledgeSourceAvailable(ref);const key=knowledgeRefKey(ref),card=index.get(key);if(!card||seen.has(key))return false;for(const parent of card.knowledgeSupport??[])if(!await valid(parent,new Set([...seen,key])))return false;return true;};
  const result=[];for(const card of cards)if(await valid(reportKnowledgeRef(card)))result.push(card);return result;
 }
 async availableRouteTheories(refs:KnowledgeRef[]):Promise<KnowledgeRef[]>{
  if(!refs.length)return [];
  const wanted=new Set(refs.map(knowledgeRefKey));
  const cards=await this.canonicalCards(card=>card.kind==='theory'&&wanted.has(knowledgeRefKey(reportKnowledgeRef(card))));
  return cards.map(reportKnowledgeRef).filter(ref=>wanted.has(knowledgeRefKey(ref)));
 }
 async theoryBody(ref:MapRef){const card=(await this.canonicalCards(c=>stableHash(reportKnowledgeRef(c))===stableHash(ref))).find(c=>c.kind==='theory'&&stableHash(reportKnowledgeRef(c))===stableHash(ref));if(!card)throw Error('Canonical theory unavailable');return card.body;}
 async reconcile(projectId:string){const p=await this.composition.v4SourceProject?.(projectId);if(!p)return;
  await reconcileReportReviews(this.store.dataRoot,this.store.library,projectId);
  for(const epoch of [...p.epochs,...(p.activeEpoch?[p.activeEpoch]:[])])if(epoch.snapshot.knowledgeMapRevision)for(const a of epoch.optionalFlow?.artifacts??[])if(a.publicReport&&a.authorRole==='theorist'&&a.acceptanceCommitted){const report:ReportEvidenceV45={scope:{projectId:p.id,epochId:epoch.snapshot.id,rootId:a.root.revision},artifactId:a.id,...a.publicReport,...reportOutcomeV45(a)};if(await this.authorizeReport(report))await registerReportMapSource(this.store.library,epoch.snapshot,a,report,this.store.dataRoot);}
  const research=new MapResearch(this.store.dataRoot,this.store.library);for(const study of await getV4Coordinator(this.store.dataRoot).researchReports())if(study.map&&study.report.scope.projectId===projectId&&await this.authorizeReport(study.report))await research.reconcile(study);
  await this.theories.reconcileMapIntents(this.store.library,projectId);
  const legacy:MapSource[]=[];for(const ref of Object.values(this.store.library.snapshot().knowledgeV3?.supports??{})){if(!this.store.library.isProofValid(ref))continue;const document=await this.store.library.readFinalProof(ref,{role:'theorist',sessionId:ref.sessionId}),body=JSON.stringify(document);legacy.push({ref:{kind:'library-proof',id:ref.caseId,version:ref.revision,bodyHash:stableHash(body),ownerId:'local-user',projectId:ref.sessionId},body,status:'active',origin:document.meta.logicalRelation==='empirical-exclusion'?{...ref,empiricalEvidence:true}:ref});}
  const studies=await getV4Coordinator(this.store.dataRoot).researchReports();
  for(const card of await this.canonicalCards())if(card.kind==='finding'&&!studies.some(study=>study.id===reportStudyV45(card.source).id&&savedPublicResearchId(study,card.body)))legacy.push({ref:{kind:'public-research',id:card.id,version:1,bodyHash:stableHash(card.body),ownerId:'local-user',projectId:card.source.scope.projectId},body:card.body,status:'active',origin:{cardId:card.id,...(studies.some(s=>s.domainAdmission&&s.id===reportStudyV45(card.source).id)?{studyId:reportStudyV45(card.source).id}:{}),...(card.source.empiricalEvidence?{empiricalEvidence:true}:{})}});
  if(legacy.length)await this.store.library.knowledgeMap.catalog(legacy,'local-user',projectId);
 }
 async backfill(projectId:string,keys:string[]){
  await this.reconcile(projectId);
  const snapshot=this.store.library.snapshot();
  for(const ref of Object.values(snapshot.knowledgeV3?.supports??{})){if(!this.store.library.isProofValid(ref))continue;const document=await this.store.library.readFinalProof(ref,{role:'theorist',sessionId:ref.sessionId}),body=JSON.stringify(document);const source:MapSource={ref:{kind:'library-proof',id:ref.caseId,version:ref.revision,bodyHash:stableHash(document),ownerId:'local-user',projectId:ref.sessionId},body,status:'active',origin:document.meta.logicalRelation==='empirical-exclusion'?{...ref,empiricalEvidence:true}:ref};
   // JSON source bytes and hash use the same canonical serialized representation.
   source.ref.bodyHash=stableHash(body);if(keys.includes(mapSourceKey(source.ref)))await this.store.library.knowledgeMap.admit([source],'local-user',projectId,true,undefined,true,true);
  }
  const sources=await this.store.library.knowledgeMap.sourceBatch(keys,'local-user',projectId);
  for(const source of sources)await this.store.library.knowledgeMap.admit([source.canonicalTheory?{...source,body:''}:source],'local-user',projectId,true,undefined,true,true);
  return this.store.library.knowledgeMap.outbox('local-user',projectId);
 }
}
