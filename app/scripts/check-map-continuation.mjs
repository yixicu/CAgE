import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MapReader} from '../dist/research/versions/v4/map-reader.js';
import {mapOpenPresentation,MAP_PRESENTATION} from '../dist/learning/knowledge-map-presentation.js';
import {MapError,mapHandle} from '../dist/learning/knowledge-map.js';

const dir=await mkdtemp(join(tmpdir(),'cage-core-continuation-'));
try {
 const call=id=>({id,status:'completed',task:'v21_theorist'});
 const spec={role:'theorist',projectId:'p',id:'new_session',context:{marker:{projectId:'p',calls:[call('new')]},project:{id:'p',epochs:[{id:'last',projectId:'p',calls:[call('prior')]}]},snapshot:{theoryRevision:'v4-operation-5',discussion:{turns:[{epochId:'last'}]}}}};
 assert.equal(MapReader.precedingSession(spec),'prior_session');
 spec.context.marker.calls.unshift(call('local'));
 assert.equal(MapReader.precedingSession(spec),'local_session');
 spec.context.marker.calls.shift();spec.context.snapshot.discussion.turns=[];
 assert.equal(MapReader.precedingSession(spec),undefined);
 const nodes=Array.from({length:6},(_,i)=>{
  const ref={store:'map',id:'n'+i,version:1,bodyHash:'hash'+i};
  return {selection:mapHandle(ref),ref,coreReview:{version:1,key:'core'+i},kind:i<2?'theory':'concept',title:'Node '+i,body:'Full source '+i,assumptions:[],qualification:'definition',accepted:false,supports:[],sources:[]};
 });
 const grant={ownerId:'local-user',projectId:'p',profileId:'profile_p',purpose:'map-proof'};
 let current=structuredClone(nodes),deny=new Set();
 const library={
  freezeKnowledgeMap:async g=>({grant:g,refs:current.map(n=>n.ref),profile:{accepted:[]},presentation:MAP_PRESENTATION}),
  openKnowledgeMap:async(view,selection)=>{
   const card=current.find(n=>n.selection===selection);
   if(!card||deny.has(selection))throw new MapError('FORBIDDEN','Removed');
   return structuredClone(card);
  },
  queryKnowledgeMap:async()=>({mode:'directory',entries:[],evidence:[],directory:[]})
 };
 const session=(id,prior,scope=grant)=>new MapReader(library,{...scope,taskId:id},join(dir,id),MAP_PRESENTATION,true,prior&&join(dir,prior));
 const first=session('first'),source=[],messages=[];
 for(const [i,node] of nodes.entries()){
  const detail=i===0?'proof':undefined, callId='open'+i;
  const result=await first.open(node.selection,detail);
  source.push({type:'knowledge-map-tool-result',tool:'open_map_knowledge',callId,modelDirectedKnowledge:true,view:await first.view(),input:{selection:node.selection,detail},result},{kind:'effect-completed',tool:'open_map_knowledge',callId});
  messages.push({role:'toolResult',toolCallId:callId,toolName:'open_map_knowledge',content:[{type:'text',text:JSON.stringify(mapOpenPresentation(result,detail))}]});
 }
 const original=await first.projectForeground({messages},source);
 await first.authority(original);
 await first.recordContinuedDelivery(original,async()=>{});
 async function receive(reader,budget,drop=false){
  const context=await reader.authority({messages:[]},budget),journal=[];
  await reader.recordContinuedDelivery({messages:drop?[]:[{role:'user',content:JSON.stringify({currentKnowledgeAuthority:context})}]},async e=>journal.push(e));
  return {context,journal,refs:await reader.proofReferences(journal)};
 }
 const fresh=session('next','first'),{context,refs,journal:firstDelivery}=await receive(fresh);
 assert.equal(context.opened.length,6);
 assert.equal(context.opened[0].level,'proof');
 assert.equal(context.opened[1].level,'statement');assert.equal(context.opened[1].statementAvailable,false);
 assert(refs.some(r=>r.selection===nodes[0].selection));
 assert(!refs.some(r=>r.selection===nodes[1].selection));
 assert.equal((await receive(session('overflow','first'),1)).context.priorCoreIndex.length,6);
 assert.equal((await receive(session('omitted','first'),1)).refs.length,0);
 assert.equal((await receive(session('compact','first'),Infinity,true)).refs.length,0);
 assert.equal((await receive(session('without','unknown'))).context.opened.length,0);
 assert.equal((await receive(session('another','first',{...grant,projectId:'unrelated'}))).context.opened.length,0);
 assert.equal((await receive(session('worker','first',{...grant,purpose:'map-worker'}))).context.opened.length,0);
 current[0].ref.version=2;current[0].selection=mapHandle(current[0].ref);
 current[1].qualification='pending'; deny.add(nodes[2].selection);
 assert.equal((await fresh.proofReferences(firstDelivery)).some(r=>r.selection===nodes[0].selection),false);
 const changed=await receive(session('changed','first'));
 assert.deepEqual(changed.context.opened.map(n=>n.selection),nodes.slice(3).map(n=>n.selection));
 console.log('Core continuation controls passed: six nodes, exact detail, delivery, budget, freshness, review, scope and missing cache.');
} finally {await rm(dir,{recursive:true,force:true});}
