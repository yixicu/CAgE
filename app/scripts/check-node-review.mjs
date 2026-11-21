import assert from 'node:assert/strict';
import { KnowledgeMapStore, CORE_MAP_ID } from '../dist/learning/knowledge-map-store.js';
import { emptyKnowledgeMap, mapHandle, mapProfile } from '../dist/learning/knowledge-map.js';
import { stableHash } from '../dist/learning/research-hash.js';

let state=emptyKnowledgeMap();
const snapshots=new Map(), unavailable=new Set();
const map=new KnowledgeMapStore({
  snapshot:async()=>{const revision=String(state.version);snapshots.set(revision,structuredClone(state));return {state:structuredClone(state),revision}},
  historical:async revision=>structuredClone(snapshots.get(revision)),
  edit:async work=>{const result=await work(structuredClone(state));state=result.state;return result.value},
  sourceValid:async source=>source.status==='active'&&!unavailable.has(source.ref.id),
});
const actor=projectId=>({ownerId:'local-user',purpose:'map-user',projectId});
const project='physics';
const receipt=await map.importSeeds({projectId:CORE_MAP_ID,requestId:'case',expectedProfileVersion:0,entries:[
  {kind:'theorem',title:'Scaling',body:'A scaled bound holds.',assumptions:['Positive mass.','A normed space.']},
  {kind:'concept',title:'Norm',body:'A norm is fixed.',assumptions:['A normed space.']},
  {kind:'theorem',title:'Reviewed by hand',body:'A separate bound holds.'},
]},actor(CORE_MAP_ID));
const [target,definition,manual]=receipt.entries.map(e=>e.ref);
const grant={...actor(project),purpose:'map-proof',taskId:'proof',profileId:mapProfile(state,'local-user',project).id};
async function read(ref){const frozen={...await map.freeze(grant),modelDirectedKnowledge:true};return map.open(frozen,mapHandle(ref),grant)}
const pending=await read(target),def=await read(definition);
const premise={...def,basis:def.bases[0]};
assert.equal(await map.pendingTheoristReview(project,pending),true);
let review=await map.nodeReview(CORE_MAP_ID,target);
const old=review.token;
review=await map.setNodeReview(CORE_MAP_ID,target,review.token,'invalid');
assert.equal((await read(target)).qualification,'disputed');
await assert.rejects(map.setNodeReview(project,target,old,'approved'),/changed/);
await map.setNodeReview(project,target,review.token,'pending');
assert.equal(await map.pendingTheoristReview(project,pending),false,'pending → invalid → pending is a different review');
const fresh=await read(target),body='Scaling both sides gives the bound for positive mass.',excerpt='Scaling both sides gives the bound';
const source={kind:'proof-report',id:'published',ownerId:'local-user',projectId:project,version:1,bodyHash:stableHash(body)};
state.sources.push({ref:source,body,status:'active'});
assert.equal(await map.confirmTheoristProof(project,fresh,source,'invented'),false);
assert.equal(await map.confirmTheoristProof(project,fresh,source,excerpt,[{...fresh,basis:{steps:[{ref:target,via:'definition'}],assumptions:[]}}]),false);
unavailable.add(source.id);
assert.equal(await map.confirmTheoristProof(project,fresh,source,excerpt),false);
unavailable.clear();
assert.equal(await map.confirmTheoristProof(project,await read(manual),source,excerpt,[premise]),false,'a prerequisite may not narrow the node conditions');
assert.equal(await map.confirmTheoristProof(project,fresh,source,excerpt,[premise],['Extra restriction.']),false);
assert.equal(await map.confirmTheoristProof(project,fresh,source,excerpt,[premise]),true);
assert.equal(await map.confirmTheoristProof(project,fresh,source,excerpt),false);
const approved=await read(target);
assert.equal(approved.qualification,'proved');
assert.equal(approved.accepted,false);
assert.deepEqual(new Set(approved.bases[0].assumptions),new Set(['Positive mass.','A normed space.']));
assert.equal(approved.supports[0].argument,excerpt);
const document=await map.nodeDocument(project,target);
assert.equal(document.node.supports[0].argument,excerpt);
assert.deepEqual(document.links.map(l=>[l.supportId,l.ref,l.title]),[[approved.supports[0].id,definition,'Norm']]);
assert.equal((await map.nodeDocument(project,document.links[0].ref)).node.body,def.body);
assert.equal(await map.evidenceValid(fresh,'local-user',project),true,'pending citation remains historical after promotion');
unavailable.add(source.id);
assert.equal((await read(target)).qualification,'pending');
unavailable.clear();
const defStatus=await map.nodeReview(project,definition);
await map.setNodeReview(project,definition,defStatus.token,'invalid');
assert.equal((await read(target)).qualification,'pending','dependent proof loses an invalidated premise');
assert.equal(await map.evidenceValid(premise,'local-user',project),false);
assert.equal((await map.nodeReview(project,target)).status,'pending');
let manualStatus=await map.nodeReview(project,manual);
await assert.rejects(map.setNodeReview(project,manual,manualStatus.token,'approved'),/argument/);
manualStatus=await map.setNodeReview(project,manual,manualStatus.token,'approved','By substitution, the bound follows.');
assert.equal(manualStatus.origin,'user');
assert.equal((await read(manual)).qualification,'proved');
manualStatus=await map.setNodeReview(project,manual,manualStatus.token,'invalid');
assert.equal((await read(manual)).qualification,'disputed');
manualStatus=await map.setNodeReview(project,manual,manualStatus.token,'approved');
assert.equal((await read(manual)).qualification,'proved','restoring a valid exact proof does not need a second copy of the argument');
const draftBody='An unpublished draft statement.',draftRef={store:'map',id:'draft-proof',version:1,bodyHash:stableHash(draftBody)};
state.entries.push({ref:draftRef,ownerId:'local-user',kind:'theorem',title:'Draft',body:draftBody,assumptions:[],aliases:[],domain:[],definition:false,status:'active',createdFrom:[],maintenanceDraft:{projectId:project,callId:'create'}});
const draft=await read(draftRef);
assert.equal(draft.qualification,'pending');assert.deepEqual(draft.sources,[]);
assert.equal(await map.evidenceValid(draft,'local-user',project),true);
assert.equal(await map.evidenceValid(draft,'local-user','unrelated-project'),false);
assert.equal(await map.evidenceValid({...draft,accepted:true},'local-user',project),false);
assert.equal(await map.confirmTheoristProof(project,draft,source,excerpt),true);
assert.equal(await map.evidenceValid(draft,'local-user',project),true);
assert.equal((await read(draftRef)).qualification,'proved');
const parent=state.entries.find(e=>e.ref.id===manual.id);
state.entries.push({...parent,ref:{...manual,version:2}});
assert.equal((await map.nodeReview(project,manual)).editable,false);
await assert.rejects(map.setNodeReview(project,manual,manualStatus.token,'invalid'),/current/);
console.log('Passed node review, shared-core promotion, review races, retained conditions, invalidated premises, provenance and historical version guards.');
