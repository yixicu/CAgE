import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=await mkdtemp(join(tmpdir(),'cage-annotations-'));
process.env.PI_CODING_AGENT_DIR=join(root,'agent');
const {createApp}=await import('../dist/server/app.js');
const onlyUse=process.argv.includes('--assume');
const title='Integer square parity';
const original=String.raw`## Sources
- **Integer square parity**

## Calculation
${onlyUse?'Assume the square of an even integer is even. Apply that fact to the product.':'Write the even integer as n = 2k. Substitution gives n² = 4k² = 2(2k²), which is even.'}

Only this formula needs typesetting: \(\badcommand{x}\).
`;

const declaration={action:'complete',route:{methodKey:'evolution',description:'Time evolution from the Hamiltonian',reason:'Use the evolution postulate.',resourceRefs:[]},outcome:{resultKind:'supported-result',scope:'root',gaps:[],dependencyArtifactIds:[],knowledgeRefs:['map_invalid_typo'],reason:'Applied the stated postulate.',reproducible:true}};
const dispatched=[];
let selection, failure,app;
globalThis.fetch=async (input,init)=>{
  try{
    const wire=JSON.parse(init?.body??await input.text());
    if(dispatched.length===6 && wire.tools?.some(t=>['lookup_learning_routes','finish_research'].includes(t.name))){
      // Background research/learning roles are independent of the Theorist and presentation GETs.
      return new Response(null,{status:400});
    }
    const seq=dispatched.push(wire);
    const tool=(name,args)=>({type:'function_call',id:'fc_'+seq,call_id:'call_'+seq,name,arguments:JSON.stringify(args)});
    const text=(value)=>({type:'message',role:'assistant',id:'msg_'+seq,phase:'final_answer',content:[{type:'output_text',text:value}]});
    let item;
    if(seq===1)item=tool('lookup_map_knowledge',{mode:'exact',query:title});
    else if(seq===2){
      const lookup=wire.input.findLast(i=>i.type==='function_call_output');
      const card=JSON.parse(typeof lookup.output==='string'?lookup.output:lookup.output[0].text);
      selection=card.entries.find(n=>n.title===title).selection;
      item=tool('open_map_knowledge',{selection});
    }else if(seq===3)item=text(original);
    else if(seq===4)item=tool('submit_research_result',declaration);
    else if(seq===5){
      const params=wire.tools.find(t=>t.name==='submit_research_result').parameters;
      assert.deepEqual(Object.keys(params.properties),['field_1'],JSON.stringify(wire.input.filter(i=>i.role==='user').map(i=>JSON.stringify(i.content).slice(0,140)).slice(-4)));
      assert.ok(JSON.stringify(wire).includes('outcome.knowledgeRefs.0'));
      item=tool('submit_research_result',{field_1:selection});
    }else if(seq===6){
      assert.equal(wire.tools?.length??0,0);
      assert.match(JSON.stringify(wire),/badcommand/);
      assert.match(JSON.stringify(wire),/Pending theorem/);
      item=text((onlyUse?'Q2: USE 5':'Q2: PROVED 5 5-5')+'\n'+String.raw`Q1: \(x\)`);
    }else throw Error('Unexpected provider request '+seq);
    const ev=[{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='message'?{content:[]}:{arguments:''})}},
      item.type==='message'?{type:'response.output_text.delta',output_index:0,delta:item.content[0].text}:{type:'response.function_call_arguments.delta',output_index:0,delta:item.arguments},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response:{id:'resp_'+seq,status:'completed',output:[item],usage:{input_tokens:150,output_tokens:50,total_tokens:200}}}];
    return new Response(ev.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  }catch(error){failure??=error;return new Response(null,{status:400});}
};
try{
  app=await createApp({dataRoot:root});
  const api=async(method,url,payload)=>{const r=await app.inject({method,url,payload,headers:{'x-carnot-token':app.carnot.requestToken}});assert.ok(r.statusCode<300,r.body);return r.json();};
  await api('POST','/api/providers/key',{provider:'openai',key:'fixture-only'});
  await api('PUT','/api/preferences',{defaultModel:{provider:'openai',modelId:'gpt-6.1-sol',thinkingLevel:'medium'}});
  const p=await api('POST','/api/projects',{name:'Annotation replay',researchLoopVersion:'4.0',hypothesis:'Show that the square of an even integer is even.'});
  const seeded=await api('POST','/api/research/knowledge-map/seeds',{projectId:p.id,requestId:'parity-lemma',expectedProfileVersion:0,entries:[{kind:'theorem',title,body:'The square of every even integer is even.'}]});
  const ref=seeded.entries[0].ref;
  const status=()=>api('POST','/api/research/knowledge-map/review-status',{projectId:p.id,ref});
  assert.equal((await status()).status,'pending');
  await api('POST','/api/projects/'+p.id+'/start',{});
  for(let i=0;i<300&&(await app.carnot.activeProjectIds()).includes(p.id);i++)await new Promise(r=>setTimeout(r,100));
  if(failure)throw failure;
  const project=await api('GET','/api/projects/'+p.id);
  assert.equal(project.status,'completed',JSON.stringify({error:project.lastError,turns:dispatched.length}));
  assert.equal(dispatched.length,6);
  const flow=project.epochs[0].optionalFlow;
  const a=flow.artifacts.find(a=>a.id===flow.selectedArtifactId);
  assert.deepEqual(a.control.outcome.knowledgeRefs,[selection]);
  for(let boot=0;boot<2;boot++){
    assert.equal((await status()).status,onlyUse?'pending':'approved');
    for(const path of ['answers/'+a.originalRef.id,'archives/'+encodeURIComponent(flow.archives[0].operationId)]){
      const result=await api('GET','/api/projects/'+p.id+'/'+path);
      assert.equal(result.body,original);
      assert.deepEqual(result.presentationIssues,undefined);
      assert.equal(result.citations[0].selection,selection);
      assert.ok(result.displayBody.includes('. ['+title+'](#cage-node-'+selection+')'));
      assert.ok(result.displayBody.includes(String.raw`\(x\)`));
    }
    if(!boot){await app.carnot.shutdown();app=await createApp({dataRoot:root});}
  }
  assert.equal(dispatched.length,6,JSON.stringify(dispatched.slice(6).map(w=>({tools:w.tools?.map(t=>t.name),instruction:w.instructions?.slice(0,80)}))));
  console.log('PASS exact opened citation, field-only correction, single-formula repair, inline placement, original and archive after restart');
 }catch(error){
  for(const d of await readdir(join(root,'pi/v21-call-journal')).catch(()=>[])){
    const rows=(await readFile(join(root,'pi/v21-call-journal',d,'capture.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    console.error(rows.filter(r=>r.kind==='v3-original-message'||r.kind?.includes('declaration')||r.diagnostics).map(r=>[r.kind,r.dispatch,r.correction,r.diagnostics,r.message?.content?.map(p=>p.name??p.type)]));
  }
  throw error;
}finally{await app?.carnot.shutdown();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
