import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = await mkdtemp(join(tmpdir(), 'cage-firecrawl-'));
process.env.PI_CODING_AGENT_DIR = join(dir, 'agent');
const { createApp } = await import('../dist/server/app.js');
const endpoint = '/api/plugins/firecrawl';
let responses = 0, continued = false;
let pdfSource, imageRequested=false, imageDelivered=false;
// A born-digital page with a binary header exercises the original-byte and text hashes.
function pdfFixture(){
  const stream='BT /F1 18 Tf 12 100 Td (Equation X) Tj ET\n';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream'];
  let body='%PDF-1.4\n%\xff\xfe\n'; const positions=[];
  for(const [i,obj] of objects.entries()){positions.push(body.length);body+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';}
  const xref=body.length;body+='xref\n0 6\n0000000000 65535 f \n'+positions.map(p=>String(p).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(body+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF','latin1');
}
const modelServer = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'theorist' }] })); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const names = (input.tools ?? []).map(tool => tool.function.name);
  const schema = input.tools?.find(tool => tool.function.name === 'submit_research_result')?.function.parameters;
  let name, args, text;
  if (names.includes('web_search') && !continued && !input.messages.some(m => m.role === 'tool')) {
    assert.ok(names.includes('open_web_result'));
    name = 'web_search'; args = { query: 'test reference' };
  } else if (names.includes('read_document') && !imageRequested) {
    imageRequested=true; name='read_document'; args={source:pdfSource,page:1,image:true};
  } else if (names.includes('web_search') && input.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('temporarily unavailable'))) {
    imageDelivered=JSON.stringify(input.messages).includes('data:image/png;base64,iVBOR');
    continued = true;
    text = 'By elementary addition, one plus one equals two.';
    name = 'submit_research_result'; args = { action: 'complete', route: {methodKey:'direct',description:'addition',reason:'direct',resourceRefs:[]},
      outcome: {scope:'root',resultKind:'supported-result',gaps:[],dependencyArtifactIds:[],reason:text,reproducible:true}, workers:[], adoptions:[] };
  } else if (schema?.properties.derivedMetadata) {
    name = 'submit_research_result'; args = {action:'no-change',derivedMetadata:[]};
  } else if (names.includes('finish_research')) {
    name = 'finish_research'; args = {body:'No further findings.'};
  } else {
    console.error('Unexpected fixture model call', names);
    res.writeHead(400); res.end(); return;
  }
  const id = 'call_' + ++responses;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({id,object:'chat.completion.chunk',model:input.model,
    choices:[{index:0,delta,finish_reason}]}) + '\n\n');
  send({role:'assistant'});
  if (text) send({content:text});
  send({tool_calls:[{index:0,id,type:'function',function:{name,arguments:''}}]});
  send({tool_calls:[{index:0,function:{arguments:JSON.stringify(args)}}]});
  send({}, 'tool_calls'); res.end('data: [DONE]\n\n');
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
process.env.CARNOT_SUBAGENT_URL = 'http://127.0.0.1:' + modelServer.address().port + '/v1';
const realFetch = globalThis.fetch;
let provider = () => { throw Error('Unexpected Firecrawl call'); };
globalThis.fetch = (url, options) => ['api.firecrawl.dev','api.exa.ai','api.tavily.com'].includes(new URL(url).hostname) ? provider(String(url), options) : realFetch(url, options);
let app;
try {
  const dataRoot = join(dir, 'workspace');
  app = await createApp({ dataRoot });
  async function api(method, url, payload) {
    const response = await app.inject({method,url,payload,headers:{'x-carnot-token':app.carnot.requestToken}});
    assert.ok(response.statusCode < 300, response.body); return response.json();
  }
  const project = await api('POST','/api/projects',{name:'Offline web test',hypothesis:'Show one plus one equals two.',researchLoopVersion:'4.0'});
  const uploaded=await api('POST','/api/projects/'+project.id+'/sources',{mode:'import',name:'equation.pdf',mime:'application/pdf',contentBase64:pdfFixture().toString('base64')});
  pdfSource=uploaded.sources[0].id;
  if (process.argv.includes('--ui')) {
    const {chromium} = await import('@playwright/test');
    const origin = await app.listen({host:'127.0.0.1',port:0});
    const browser = await chromium.launch({env:{...process.env,LOCALAPPDATA:dir,APPDATA:dir,USERPROFILE:dir}});
    try {
      const page = await browser.newPage({viewport:{width:1440,height:900}});
      page.on('pageerror', error => console.error('UI error',error.message));
      await page.goto(origin);
      const navigation = page.getByRole('button',{name:'Toggle sidebar'});
      if (await navigation.getAttribute('aria-expanded') === 'false') await navigation.click();
      await page.getByRole('button',{name:'Settings',exact:true}).click({timeout:8000}).catch(async error => {
        console.error('Initial window', (await page.locator('body').innerText()).slice(0,1600)); throw error;
      });
      await page.getByRole('button',{name:'Plugins & general'}).click();
      const card = page.locator('article').filter({hasText:'Web search'});
      await card.getByRole('button',{name:'Install bundled plugin'}).click();
      assert.equal(await card.getByRole('link').getAttribute('href'),'https://www.firecrawl.dev/app/api-keys');
      for (const [id, label] of [['tavily','Tavily'],['exa','Exa'],['firecrawl','Firecrawl']]) {
        await card.getByLabel('Search provider').selectOption(id);
        await card.getByLabel(label+' API key').waitFor();
      }
      await card.getByLabel('Firecrawl API key').fill('fc-ui-fixture');
      await card.getByRole('button',{name:'Save key'}).click(); await card.getByText('Key saved',{exact:true}).waitFor();
      assert.equal(await card.getByLabel('Firecrawl API key').inputValue(),'');
      await card.getByRole('button',{name:'Enable',exact:true}).click();
      await card.getByText('Project exceptions', {exact:false}).click();
      await card.getByRole('checkbox').check();
      await card.getByText('Project exceptions (1)').waitFor();
      assert.equal(app.carnot.plugins.toolsFor(project.id,'theorist').length,0);
      await card.getByRole('checkbox').uncheck();
      await card.getByText('Project exceptions (0)').waitFor();
      await card.getByRole('button',{name:'Remove key'}).click(); await card.getByText('No key saved',{exact:true}).waitFor();
      assert.equal(app.carnot.plugins.toolsFor(project.id,'theorist').length,2);
      console.log('PASS plugin settings install, key save/remove and V4 grant');
    } finally { await browser.close(); }
  }
  const model = { provider:'cage-subagents', modelId:'theorist', thinkingLevel:'off' };
  await api('PUT','/api/projects/'+project.id+'/config',{config:{...project.config,defaultModel:model,roleModels:{theorist:model}}});
  await api('POST', endpoint+'/install', {}); await api('POST', endpoint+'/enable', {});
  await api('PUT', endpoint+'/grants', {projectId:project.id,role:'theorist',capabilities:['tool.firecrawl-search']});
  const tools = () => app.carnot.plugins.toolsFor(project.id,'theorist');
  let [search, open] = tools();
  const query = {query:'test reference'}, key = 'fc-fixture-only';
  assert.equal((await search.execute('a',query)).details.status,'unavailable');
  assert.deepEqual(await api('PUT',endpoint+'/credential',{key}), {configured:true});
  assert.equal((await app.inject({method:'GET',url:endpoint+'/credential'})).statusCode,403);
  await app.carnot.shutdown(); app = await createApp({dataRoot});
  [search,open] = tools();
  assert.deepEqual(await api('GET',endpoint+'/credential'),{configured:true});
  assert.equal(app.carnot.plugins.toolsFor('other','theorist').length,2);
  assert.equal(app.carnot.plugins.toolsFor('other','worker').length,0);
  const url = 'https://example.org/study';
  let calls = 0;
  provider = (target, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer '+key);
    const body = JSON.parse(options.body);
    if (target.endsWith('/search')) {
      assert.equal(body.query,query.query);
      return Response.json({success:true,data:{web:[{url,title:'Study',description:'A clue'}]}});
    }
    assert.equal(body.url,url); return Response.json({success:true,data:{markdown:'Source passage.'}});
  };
  assert.equal((await search.execute('b',query)).details.results[0].url,url);
  assert.equal((await open.execute('c',{url})).details.text,'Source passage.');
  assert.equal((await open.execute('d',{url:'https://example.org/unseen'})).details.status,'unavailable');
  assert.equal(calls,2);
  for (const name of ['tavily','exa']) {
    await api('PUT',endpoint+'/provider',{provider:name});
    assert.equal((await search.execute('old',query)).details.status,'unavailable');
    await api('PUT','/api/plugins/'+name+'/credential',{key:'test-'+name});
    [search,open]=tools();
    provider=(target,options)=>{
      assert.equal(new URL(target).hostname,'api.'+name+(name==='exa'?'.ai':'.com'));
      assert.equal(name==='exa'?options.headers['x-api-key']:options.headers.Authorization,(name==='exa'?'':'Bearer ')+'test-'+name);
      if (target.endsWith('/search')) return Response.json({results:[{url,title:'Study',content:'snippet',highlights:['snippet']}]});
      assert.ok(target.endsWith(name==='exa'?'/contents':'/extract'));
      return Response.json({results:[{url,text:'Original',raw_content:'Original'}]});
    };
    assert.equal((await search.execute('s',query)).details.results[0].snippet,'snippet');
    assert.equal((await open.execute('o',{url})).details.text,'Original');
  }
  await api('PUT',endpoint+'/grants',{projectId:project.id,role:'theorist',capabilities:[]});
  await app.carnot.shutdown(); app=await createApp({dataRoot});
  assert.equal(app.carnot.plugins.discover().find(p=>p.id==='firecrawl').provider,'exa');
  assert.equal(tools().length,0);
  assert.equal(app.carnot.plugins.toolsFor('new-project','theorist').length,2);
  await api('PUT',endpoint+'/grants',{projectId:project.id,role:'theorist',capabilities:['tool.firecrawl-search']});
  await api('PUT',endpoint+'/provider',{provider:'firecrawl'});
  [search,open]=tools();

  for (const status of [401,402,429,503]) {
    provider = () => new Response('sensitive diagnostic', {status});
    const failure = await search.execute('e',query);
    assert.equal(failure.details.status,'unavailable'); assert.doesNotMatch(JSON.stringify(failure),/sensitive diagnostic|fc-fixture/);
  }
  provider = () => { throw new TypeError('offline'); };
  assert.equal((await search.execute('f',query)).details.status,'unavailable');
  provider = () => { throw new DOMException('deadline','TimeoutError'); };
  assert.equal((await search.execute('timeout',query)).details.status,'unavailable');
  await api('DELETE',endpoint+'/credential');
  assert.deepEqual(await api('GET',endpoint+'/credential'),{configured:false});
  await app.carnot.runtime.auth.saveApiKey('cage-subagents','fixture-model');
  await app.carnot.engine.start(project.id);
  const saved = await app.carnot.store.loadProject(project.id);
  assert.ok(continued, 'Expected model continuation: '+JSON.stringify(saved.lastError??saved.status));
  assert.ok(imageDelivered,'The model transport must receive actual PDF page pixels');
  assert.ok(!saved.lastError, JSON.stringify(saved.lastError));
  assert.match(JSON.stringify(saved), /By elementary addition/);
  await api('POST',endpoint+'/disable',{});
  assert.equal((await search.execute('g',query)).details.status,'unavailable');
  console.log('PASS credentials, grants, source reading, failures, model continuation, revocation');
} finally {
  await app?.carnot.shutdown(); globalThis.fetch = realFetch;
  modelServer.closeAllConnections(); await new Promise(resolve=>modelServer.close(resolve));
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
