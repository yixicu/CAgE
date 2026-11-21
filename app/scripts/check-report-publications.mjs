import assert from 'node:assert/strict';
import {reportPublications} from '../dist/presentation/report-publications.js';
import {mapSourceKey} from '../dist/learning/knowledge-map.js';
import {reportStudyId} from '../dist/research/versions/v4/post-report.js';

const id='project-a',artifactId='artifact-1',epochId='round-1';
const scope={projectId:id,epochId,rootId:'root'};
const proofRef={sessionId:id,caseId:'proof',revision:1,semanticRevision:1,contentHash:'body'};
const artifact={id:artifactId,acceptanceCommitted:true,authorRole:'theorist',root:{revision:'root'},publicReport:{bodyHash:'hash'}};
const project={id,epochs:[{snapshot:{id:epochId},optionalFlow:{artifacts:[artifact],archives:[{artifactId,status:'saved',proofRef}]}}]};
const source=(kind,idValue)=>({kind,id:idValue,projectId:id,version:1,ownerId:'local-user',bodyHash:'hash'});
const original=source('proof-report',artifactId),later=source('public-research','study-output'),other={...original,projectId:'other'};
const entry=(name,evidence)=>({ref:{store:'map',id:name,version:1,bodyHash:name},title:name,createdFrom:[evidence]});
const direct=entry('Even-square theorem',original),after=entry('Parity definition',later),foreign=entry('unrelated',other);
const strategy={id:'strategy',name:'Parity test',kind:'specific-strategy',version:1,updatedBy:{role:'moderator'},sourceRefs:[proofRef]};
const held={...strategy,id:'skill',kind:'method-skill',updatedBy:{role:'theorist'},methodSupport:{directSourceRefs:[]}};
const receipt={kind:'resource',id:strategy.id,version:1,sources:[proofRef]};
const state={resources:{skill:held,strategy:{...strategy,version:2,updatedBy:{role:'user'}}},appliedUpdates:{update:receipt,replay:receipt},
  knowledgeMapV4:{entries:[direct,after,foreign],sources:[{ref:original},{ref:later,origin:{studyId:reportStudyId(scope,artifactId,'hash')}}],
    outbox:[{projectId:id,taskId:'task',authored:{},sourceKeys:[mapSourceKey(original)]}],
    publicationReceipts:{'task:hash':{id:'task:hash',entries:[direct.ref]}}}};
const rows=await reportPublications(project,state,async()=>strategy);
assert.deepEqual(rows.map(r=>[r.title,r.kind,r.role]),[['Even-square theorem','Knowledge node','theorist'],['Parity definition','Knowledge node','moderator'],['Parity test','Strategy','moderator']]);
assert.ok(rows.every(r=>r.projectId===id&&r.epochId===epochId&&r.artifactId===artifactId));
artifact.acceptanceCommitted=false;
assert.equal((await reportPublications(project,state,async()=>strategy)).length,0);
console.log('PASS exact report attribution, historical resource versions, replay deduplication, direct vs inherited proof sources and project isolation');
