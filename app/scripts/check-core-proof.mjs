import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const dir=await fs.mkdtemp(path.join(tmpdir(),'cage-core-replay-'));

process.env.PI_CODING_AGENT_DIR=path.join(dir,'agent');
const {createApp}=await import('../dist/server/app.js');
const {maintenanceNodeTools}=await import('../dist/learning/maintenance-node-tools.js');
const {stableHash}=await import('../dist/learning/research-hash.js');
let browser, page, progressError;
let app=await createApp({dataRoot:dir});
try {
const api=async(method,url,payload)=>{const r=await app.inject({method,url,payload,headers:{'x-carnot-token':app.carnot.requestToken}});assert.ok(r.statusCode<300,r.body);return r.json()};
const lib=app.carnot.store.library;
const nodes=maintenanceNodeTools(lib);
const execute=async(name,input)=>nodes.find(t=>t.name==='maintenance_'+name).execute('fixture-'+name,input);
const shared=await execute('list_nodes',{scope:'shared-library'});
assert.equal(shared.content.length,2);
const core=JSON.parse(shared.content[1].text);
assert.equal(core.total,77);
assert.equal(core.scope,'core-map');
const selected=core.nodes[0];
const item=await execute('read_node',{scope:'core-map',id:selected.id,version:selected.version,revision:core.revision});
assert.ok(item.content[0].text.length>100);
await execute('create_node',{scope:'core-map',revision:core.revision,kind:'concept',title:'Offline regression node',body:'Definition for an offline fixture.',assumptions:[]});
await app.carnot.shutdown();
app=await createApp({dataRoot:dir});
assert.equal((await api('GET','/api/research/core-map')).entries.length,78);
const title='有限深方势阱偶宇称态的边界匹配';
const declaration={action:'complete',route:{methodKey:'matching',description:title,reason:'Finite potential step.',resourceRefs:[]},outcome:{resultKind:'supported-result',scope:'root',gaps:[],dependencyArtifactIds:[],reason:'Matched the boundary conditions.',reproducible:true}};
const answer='Inside the well the even solution is A cos(kx). Outside it is B exp(-kappa(x-a)). Continuity at a gives B=A cos(ka). Derivative matching gives Ak sin(ka)=kappa B. Eliminating B yields k tan(ka)=kappa.';
const empty=process.argv.includes('--empty');
const route={mode:'lexical',query:'Schrodinger',branch:'Strategy',selection:1,relation:'related',direction:'outgoing',offset:0,limit:10,view:'directory',clusterRef:'Strategy',maxNodes:10};
const lookup={mode:'lexical',query:'Schrodinger',selection:'quantum',relation:'related',direction:'outgoing',offset:0,limit:10};
const queries=[['retrieve_knowledge',route],['retrieve_knowledge',{...route,mode:'directory'}],['lookup_map_knowledge',lookup],
 ['retrieve_knowledge',{...route,mode:'directory'}],['lookup_map_knowledge',{...lookup,mode:'exact'}],['retrieve_knowledge',{...route,mode:'directory'}]];
let sequence=0,seen=[],titleRequested=false;
const text=(part,phase)=>({type:'message',role:'assistant',id:'msg_'+sequence,phase,content:[{type:'output_text',text:part}]});
const call=(name,args)=>({type:'function_call',id:'fc_'+sequence,call_id:'call_'+sequence,name,arguments:JSON.stringify(args)});
globalThis.fetch=async(input,init)=>{
 const body=JSON.parse(init?.body??await input.text());
 const names=(body.tools??[]).map(t=>t.name);
 const turn=++sequence;seen.push(names);
 if(turn===1)titleRequested=JSON.stringify(body).includes('In route.description, give a short session title');

 if(turn>10)return new Response(null,{status:400});
 const output=[];
 if(turn===1)output.push(text('I will derive it.','commentary'));
 if(turn<=queries.length)output.push(call(...queries[turn-1]));
 else if(turn===7){output.push(text('Next I will match the waves.'),call('submit_research_result',declaration));}
 else if(turn===8)output.push(text(empty?'':answer,'final_answer'));
 else output.push(call('submit_research_result',declaration));
 if(page&&turn===8){
   try {
     const progress=page.getByRole('region',{name:/research progress/i});
     const toggle=progress.locator('button[aria-expanded]').first();
     await toggle.waitFor({timeout:15000});
     if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
     await progress.getByText('Next I will match the waves.',{exact:false}).last().waitFor({timeout:8000});
     assert.ok((await progress.innerText()).includes('I will derive it.'));
     console.log('PASS live Research progress while manuscript request is pending');
   } catch(error) { progressError=error; }
 }
 const events=[];
 output.forEach((item,output_index)=>{
 events.push({type:'response.output_item.added',output_index,item:{...item,...(item.type==='message'?{content:[]}:{arguments:''})}});
 events.push(item.type==='message'?{type:'response.output_text.delta',output_index,delta:item.content[0].text}:{type:'response.function_call_arguments.delta',output_index,delta:item.arguments});
 events.push({type:'response.output_item.done',output_index,item});
 });
 events.push({type:'response.completed',response:{id:'resp_'+turn,status:'completed',output,usage:{input_tokens:150,output_tokens:50,total_tokens:200}}});
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
};
await api('POST','/api/providers/key',{provider:'openai',key:'fixture-only'});
await api('PUT','/api/preferences',{defaultModel:{provider:'openai',modelId:'gpt-6.1-sol',thinkingLevel:'medium'}});
const input={name:'New research',researchLoopVersion:'4.0',hypothesis:'推导有限深方势阱中偶宇称束缚态满足的匹配条件。'};
const manual=await api('POST','/api/projects',{...input,nameSource:'user',requestId:'title-retry'});
const p=await api('POST','/api/projects',{...input,requestId:'title-retry'});
assert.equal(manual.nameSource,'user');
assert.notEqual(p.id,manual.id);
assert.equal(p.nameSource,undefined);
if(process.argv.includes('--ui')){
 const {chromium}=await import('@playwright/test');
 browser=await chromium.launch({env:{...process.env,LOCALAPPDATA:dir,APPDATA:dir,USERPROFILE:dir}});
 page=await browser.newPage();
 await page.goto(await app.listen({host:'127.0.0.1',port:0}));
 const sidebar=page.getByRole('button',{name:'Toggle sidebar'});
 if(await sidebar.getAttribute('aria-expanded')==='false')await sidebar.click();
 await page.getByRole('navigation',{name:'Research projects'}).locator('[data-session-id="'+p.id+'"]').click();
 await page.waitForURL(url=>url.hash==='#'+p.id);
 const started=page.waitForResponse(response=>response.url().endsWith('/api/projects/'+p.id+'/start'));
 await page.getByRole('button',{name:'Start research',exact:true}).click();
 assert.ok((await started).ok());
}else await api('POST','/api/projects/'+p.id+'/start',{});
for(let n=0;n<300&&(await app.carnot.activeProjectIds()).includes(p.id);n++)await new Promise(r=>setTimeout(r,100));
const result=await api('GET','/api/projects/'+p.id);
if(progressError)throw progressError;

assert.equal(result.status,empty?'paused':'completed',result.lastError);
assert.ok(titleRequested);
assert.deepEqual(seen[7],[]);
if(!empty)assert.deepEqual(seen[8],['submit_research_result']);
const logs=await fs.readdir(path.join(dir,'pi/v21-call-journal'));
const rows=(await fs.readFile(path.join(dir,'pi/v21-call-journal',logs[0],'capture.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(rows.filter(row=>row.kind==='v3-knowledge-retrieval'&&!row.result.directedRouteFeedback).length,4);
const reads=rows.filter(row=>row.tool==='lookup_map_knowledge'&&row.type==='knowledge-map-tool-result');
assert.equal(reads.length,2);
assert.ok(reads[0].result.total>0);
const activity=await api('GET','/api/projects/'+p.id+'/activity');
assert.deepEqual(activity.commentary.map(n=>n.text),['I will derive it.','Next I will match the waves.']);
const raw=await Promise.all((await fs.readdir(path.join(dir,'raw-answers')).catch(error=>{if(error.code==='ENOENT')return [];throw error})).map(async f=>JSON.parse(await fs.readFile(path.join(dir,'raw-answers',f),'utf8'))));
if(empty)assert.ok(raw.every(r=>r.ref.completeness!=='complete'));else assert.ok(raw.some(r=>r.body===answer));
if (!empty) {
  assert.equal(result.name,title);
  assert.equal(result.nameSource,'theorist');
  assert.equal((await app.carnot.store.loadProject(p.id)).name,title);
  assert.equal((await api('GET','/api/bootstrap')).projects.find(row=>row.id===p.id).name,title);
  if(page){
    await page.locator('.workspace-title').filter({hasText:title}).waitFor();
    await page.getByRole('navigation',{name:'Research projects'}).getByRole('button',{name:title,exact:true}).waitFor();
    await browser.close(); browser=undefined;
  }
  await app.carnot.shutdown(); app=await createApp({dataRoot:dir});
  const reopened=await api('GET','/api/projects/'+p.id);
  assert.equal(reopened.name,title);
  const renamed=await api('PUT','/api/projects/'+p.id+'/name',{name:'New research',expectedRevision:reopened.contentRevision});
  assert.equal(renamed.nameSource,'user');
  assert.equal((await api('GET','/api/bootstrap')).projects.find(row=>row.id===p.id).name,'New research');
  console.log('PASS first Theorist title, history, restart and manual rename');
} else {
  assert.equal(result.name,'New research');
}
console.log(empty?'PASS empty reply pauses with the partial draft':'PASS six queries, core maintenance, restart, manuscript delivery and archival');
}finally{await browser?.close();await app.carnot.shutdown();await fs.rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150})}
