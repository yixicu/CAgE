import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Browser fixture for the two real UI components at the proof-to-map boundary.
const ref={store:'map',id:'session-node',version:1,bodyHash:'abcdefgh'};
const read={ref,selection:'map_basis_01',title:'Historical result',body:'Exact saved theorem.',kind:'theorem',qualification:'proved',assumptions:['Positive mass.'],supports:[],sources:[],accepted:false};
const original='The original Markdown.', displayBody='By [historical result](#cage-node-map_basis_01), the bound holds. [Unverified](#cage-node-fake).';
const proof={body:original,displayBody,citations:[read],presentationIssues:['One reference could not be located.']};
const localEntry={ref,ownerId:'local-user',kind:'theorem',title:read.title,body:read.body,assumptions:[],aliases:[],domain:['math'],status:'withdrawn',createdFrom:[],definition:false};
const updated={...localEntry,ref:{...ref,version:2,bodyHash:'changed'},title:'Updated result',status:'active'};
const base={...localEntry,status:'active',ref:{...ref,id:'bound',bodyHash:'boundhash'},title:'Norm bound',body:'The norm bounds each component.'};
const axiom={...base,ref:{...ref,id:'triangle',bodyHash:'trianglehash'},title:'Triangle inequality',body:'The norm is subadditive.'};
function proofDocument(entry,next){
  const node={...read,...entry,selection:'map_'+entry.ref.id};
  if(!next)return {node,links:[]};
  const link={supportId:'s',ref:next.ref,title:next.title,selection:'map_'+next.ref.id};
  return {node:{...node,supports:[{id:'s',status:'proved',prerequisites:[{role:'established',ref:next.ref}],
    argument:'Apply [['+next.title+']] to the sum. Unbound [[Other result]] and code `[['+next.title+']]`.'}]},links:[link]};
}
const input=resolve('web/citation-browser-fixture.js'),slash=p=>p.replaceAll('\\','/');
const result=await build({configFile:false,root:process.cwd(),cacheDir:resolve('tests/.vite-citation'),logLevel:'error',plugins:[{
  name:'citation-browser-fixture',
  resolveId(id){if(slash(id)===slash(input))return slash(input)},
  load(id){if(slash(id)===slash(input))return `
    import {mount,unmount} from 'svelte';
    import Proof from './research/SavedProofView.svelte';
    import Map from './KnowledgeCanvas.svelte';
    const target=document.getElementById('root');
    const component=mount(Proof,{target,props:{projectId:'project1',proof:${JSON.stringify(proof)},onmap:async read=>{
      await unmount(component);
      mount(Map,{target,props:{citation:{projectId:'project1',read}}});
    }}});
  `},
},svelte({configFile:false})],build:{write:false,emptyOutDir:false,rollupOptions:{input},minify:false}});
const assets=new Map((Array.isArray(result)?result[0]:result).output.map(item=>[item.fileName,item]));
const script=[...assets.values()].find(item=>item.type==='chunk' && item.isEntry);
let seenMap=false,latestReview='pending';
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/research/knowledge-map/node-document'){
    let data='';req.on('data',chunk=>{data+=chunk});req.on('end',()=>{
      const {ref:r,projectId}=JSON.parse(data);assert.equal(projectId,'project1');
      const doc=r.id===axiom.ref.id?proofDocument(axiom):r.id===base.ref.id?proofDocument(base,axiom):proofDocument(r.version===1?localEntry:updated,base);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(doc));
    });return;
  }
  if(url.pathname==='/api/research/knowledge-map/review-status'){
    let data='';req.on('data',chunk=>{data+=chunk});req.on('end',()=>{
      const request=JSON.parse(data),historical=request.ref.version===1;
      assert.equal(request.projectId,'project1');
      if(req.method==='PUT'){assert.equal(historical,false);assert.equal(request.expected,'current');latestReview=request.status;}
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({status:historical?'invalid':latestReview,editable:!historical,token:'current',qualification:historical?'withdrawn':'pending'}));
    });return;
  }
  if(url.pathname==='/api/research/knowledge-map'){
    seenMap=url.searchParams.get('projectId')==='project1';
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({entries:[updated,localEntry,base,axiom],relations:[]}));return;
  }
  const asset=assets.get(url.pathname.slice(1));
  if(asset){res.setHeader('Content-Type',asset.type==='chunk'?'text/javascript':'text/css');res.end(asset.type==='chunk'?asset.code:asset.source);return}
  res.setHeader('Content-Type','text/html');
  res.end(`<html><head>${[...assets.keys()].filter(s=>s.endsWith('.css')).map(s=>'<link rel="stylesheet" href="/'+s+'">').join('')}<style>html,body,#root{height:100%;margin:0;padding:0}#root{padding:30px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/${script.fileName}"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CITATION_TEST_BROWSER});
  const page=await browser.newPage({viewport:{width:840,height:660}});
  const errors=[];page.on('pageerror',err=>{errors.push(err.message);for(const m of err.stack.matchAll(/assets\/([^:]+):(\d+):(\d+)/g)){const code=assets.get('assets/'+m[1])?.code;if(code)console.error(code.split('\n').slice(Number(m[2])-2,Number(m[2])+1).join('\n'));}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const link=page.getByRole('link',{name:'historical result'}),card=page.getByRole('dialog');
  await link.hover();await card.waitFor();
  await card.getByTitle('Withdrawn',{exact:true}).waitFor();
  assert.equal(await card.locator('.review-state').getAttribute('data-state'),'invalid');
  assert.equal(await card.locator('.node-type').innerText(),'Theorem');
  assert.match(await card.innerText(),/Exact saved theorem\./);
  assert.match(await card.innerText(),/Positive mass\./);
  assert.equal(await page.getByRole('link',{name:'Unverified'}).count(),0);
  const hoverColor=await link.evaluate(a=>getComputedStyle(a).textDecorationLine);assert.equal(hoverColor,'underline');
  await page.mouse.move(780,620);await card.waitFor({state:'hidden'});
  await link.focus();await card.waitFor();await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button',{name:'Close citation'}).evaluate(b=>b===document.activeElement),true);
  await page.keyboard.press('Escape');await card.waitFor({state:'hidden'});assert.equal(await link.evaluate(a=>a===document.activeElement),true);
  await page.getByText('Original Markdown',{exact:true}).click();assert.equal(await page.locator('pre').innerText(),original);
  await link.click();await card.waitFor();
  async function roundTrip(rootTitle){
    const inline=card.locator('.markdown-view a[data-proof-link]').first();
    await inline.hover();assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await card.getByRole('heading',{name:rootTitle}).count(),1);
    assert.equal(await card.locator('code a[data-proof-link]').count(),0);
    assert.equal(await card.getByRole('link',{name:'Other result'}).count(),0);
    await inline.click();
    await card.getByRole('heading',{name:'Norm bound'}).waitFor();
    await card.locator('.markdown-view a[data-proof-link]').click();
    await card.getByRole('heading',{name:'Triangle inequality'}).waitFor();
    const back=card.getByRole('button',{name:'Back to previous node'});
    assert.equal((await back.innerText()).trim(),'');
    await back.click();await card.getByRole('heading',{name:'Norm bound'}).waitFor();
    await back.click();await card.getByRole('heading',{name:rootTitle}).waitFor();
    assert.equal(await back.count(),0);
  }
  await roundTrip('Historical result');
  await page.getByRole('button',{name:'Show on map'}).click();
  const node=page.locator('button[data-cited=true]');await node.waitFor({timeout:3000}).catch(async e=>{console.error({errors,seenMap,body:await page.locator('body').innerText(),buttons:await page.getByRole('button').allTextContents()});throw e});
  assert.equal(seenMap,true);assert.match(await node.innerText(),/Historical result\s*· v1/);
  assert.equal(await node.evaluate(b=>b===document.activeElement),true);
  assert.match(await page.getByRole('status').innerText(),/historical version.*withdrawn/);
  assert.equal(await page.getByRole('button',{name:'theorem: Updated result'}).count(),1);
  await node.click();assert.equal(await page.getByRole('button',{name:'Edit node'}).count(),0);
  await page.getByTitle('Withdrawn',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Change review status'}).count(),0);
  await roundTrip('Historical result');
  await page.getByRole('button',{name:'Close node'}).click();
  await page.getByRole('searchbox',{name:'Search node titles'}).fill('Updated result');
  await page.getByRole('button',{name:'theorem: Updated result'}).click();
  await page.getByTitle('Pending review',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').locator('.node-type').innerText(),'Theorem');
  await page.getByRole('button',{name:'Change review status'}).click();
  await page.getByRole('combobox',{name:'Review status'}).selectOption('approved');
  await page.getByRole('button',{name:'Save review'}).click();
  await page.getByTitle('Approved',{exact:true}).waitFor();
  assert.equal(latestReview,'approved');assert.equal(await page.locator('.review-state').getAttribute('data-state'),'approved');
  assert.deepEqual(errors,[]);console.log('Passed: pointer, keyboard, citation allowlist, raw source, exact project map version and focus.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
