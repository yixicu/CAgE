import type {ResearchProjectV21} from '../research/contracts/v21.js';
import type {ResearchLibraryState,ResourceMeta,ResourceRef,ProofRef} from '../learning/research-data.js';
import {mapRefKey,mapSourceKey} from '../learning/knowledge-map.js';
import {reportStudyId} from '../research/versions/v4/post-report.js';
import {stableHash} from '../learning/research-hash.js';

export interface ReportPublication {
  projectId:string; epochId:string; artifactId:string; role:'theorist'|'moderator';
  kind:'Skill'|'Strategy'|'Knowledge node'; title:string; version:number; id:string;
}

export async function reportPublications(project:ResearchProjectV21,state:ResearchLibraryState,readMeta:(ref:ResourceRef)=>Promise<ResourceMeta>){
  type Report={epochId:string;artifactId:string};
  const reports=new Map<string,Report>(),studies=new Map<string,Report>(),archives=new Map<string,Report>();
  for(const epoch of [...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])]){
    for(const a of epoch.optionalFlow?.artifacts??[]){
      if(!a.acceptanceCommitted||a.authorRole!=='theorist')continue;
      const report={epochId:epoch.snapshot.id,artifactId:a.id};
      reports.set(a.id,report);
      if(a.publicReport)studies.set(reportStudyId({projectId:project.id,epochId:report.epochId,rootId:a.root.revision},a.id,a.publicReport.bodyHash),report);
    }
    for(const archive of epoch.optionalFlow?.archives??[]){
      const report=reports.get(archive.artifactId);
      if(report&&archive.status==='saved'&&archive.proofRef)archives.set(stableHash(archive.proofRef),report);
    }
  }
  const rows=new Map<string,ReportPublication>();
  function add(report:Report,role:ReportPublication['role'],kind:ReportPublication['kind'],title:string,ref:ResourceRef){
    const row={...report,projectId:project.id,role,kind,title,id:ref.id,version:ref.version};
    rows.set(JSON.stringify([report.epochId,report.artifactId,kind,ref.id,ref.version]),row);
  }
  const map=state.knowledgeMapV4;
  const sources=new Map(map?.sources.filter(s=>s.ref.projectId===project.id).map(s=>[mapSourceKey(s.ref),s]));
  const tasks=new Map(map?.outbox.filter(task=>task.projectId===project.id&&task.taskId).map(task=>[task.taskId!,task]));
  const authors=new Map<string,Set<string>>();
  for(const receipt of Object.values(map?.publicationReceipts??{})){
    const task=tasks.get(receipt.id.split(':',1)[0]!);
    if(!task?.authored)continue;
    for(const ref of receipt.entries){
      const key=mapRefKey(ref),evidence=authors.get(key)??new Set<string>();
      for(const source of task.sourceKeys)evidence.add(source);
      authors.set(key,evidence);
    }
  }
  for(const entry of map?.entries??[]){
    if(entry.maintenanceDraft)continue;
    for(const ref of entry.createdFrom){
      if(ref.projectId!==project.id)continue;
      const source=sources.get(mapSourceKey(ref));
      const origin=source?.origin as {studyId?:string}|undefined;
      const report=ref.kind==='proof-report'?reports.get(ref.id):origin?.studyId?studies.get(origin.studyId):
        ref.kind==='library-proof'&&source?.origin?archives.get(stableHash(source.origin)):undefined;
      if(report)add(report,ref.kind==='proof-report'&&authors.get(mapRefKey(entry.ref))?.has(mapSourceKey(ref))?'theorist':'moderator','Knowledge node',entry.title,entry.ref);
    }
  }
  const refs=new Map<string,ResourceRef>();
  const proofReport=(s:ProofRef)=>s.sessionId===project.id?archives.get(stableHash(s)):undefined;
  for(const receipt of Object.values(state.appliedUpdates)){
    if(receipt.kind==='resource'&&receipt.sources?.some(s=>'caseId' in s&&proofReport(s)))refs.set(receipt.id+':'+receipt.version,receipt);
  }
  for(const resource of Object.values(state.resources)){
    if(resource.sourceRefs.some(s=>'caseId' in s&&proofReport(s)))refs.set(resource.id+':'+resource.version,resource);
  }
  for(const [key,evidence] of Object.entries(state.resourceOptionalEvidence??{})){
    if(evidence.sessionId!==project.id||!Object.keys(evidence.artifacts).some(id=>reports.has(id)))continue;
    const i=key.lastIndexOf(':');refs.set(key,{id:key.slice(0,i),version:Number(key.slice(i+1))});
  }
  for(const [key,ref] of refs){
    const head=state.resources[ref.id];
    const meta=head?.version===ref.version?head:await readMeta(ref);
    const actor=meta.updatedBy??meta.createdBy;
    if(actor?.role!=='theorist'&&actor?.role!=='moderator')continue;
    const kind=meta.kind==='specific-strategy'?'Strategy':'Skill';
    const targets=new Set<Report>();
    for(const s of meta.strategySupport?.directSourceRefs??meta.methodSupport?.directSourceRefs??meta.sourceRefs){
      const report='caseId' in s&&proofReport(s);if(report)targets.add(report);
    }
    const evidence=state.resourceOptionalEvidence?.[key];
    if(evidence?.sessionId===project.id)for(const id of Object.keys(evidence.artifacts)){const report=reports.get(id);if(report)targets.add(report);}
    for(const report of targets)add(report,actor.role,kind,meta.title??meta.name,meta);
  }
  return [...rows.values()];
}
