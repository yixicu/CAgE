import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const dir = await mkdtemp(join(tmpdir(), 'cage-model-catalog-'));
process.env.PI_CODING_AGENT_DIR = join(dir, 'agent');
const { createApp } = await import('../dist/server/app.js');
const live = process.argv.includes('--live');
const originalFetch = globalThis.fetch;
let phase = 'offline', requests = 0, template;
const provider = process.argv.find(arg => arg.startsWith('--provider='))?.slice(11) ?? 'openai';
let id = live && provider === 'openai' ? 'gpt-6.2-sol' : 'catalog-fixture';
globalThis.fetch = async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : input);
  requests++;
  assert.equal(target.origin,'https://pi.dev');
  assert.equal(target.pathname,'/api/models/providers/' + provider);
  assert.equal(new Headers(init?.headers).has('authorization'), false);
  if (phase === 'offline') throw Error('Unexpected network access');
  if (phase === 'failure') return new Response(null,{status:403});
  if (live) {
    const response = await originalFetch(input,init);
    if (provider !== 'openai' && response.ok) {
      const rows = await response.clone().json();
      const models = app.carnot.runtime.models;
      const candidate = rows.find(row => row.api === template.api && row.baseUrl === template.baseUrl && !models.getModel(provider,row.id)) ?? rows.find(row => row.id === template.id);
      assert.ok(candidate);
      id = candidate.id;
    }
    return response;
  }
  return Response.json([{...template, id, name:id}],{headers:{'last-modified':new Date(Date.now()+86400000).toUTCString()}});
};
let app, browser;
async function api(method, url, payload) {
  const r = await app.inject({method,url,payload,headers:{'x-carnot-token':app.carnot.requestToken}});
  assert.ok(r.statusCode<300,r.body);
  return r.json();
}
try {
  const opts = {dataRoot:dir};
  app = await createApp(opts);
  await api('POST','/api/providers/key',{provider,key:'fixture-only'});
  let state = await api('GET','/api/bootstrap');
  assert.equal(state.models.some(m=>m.id===id),false);
  template = app.carnot.runtime.models.getModels(provider)[0];
  assert.ok(template);
  assert.equal(requests,0);
  browser = await chromium.launch({env:{...process.env,LOCALAPPDATA:dir,APPDATA:dir,USERPROFILE:dir}});
  const page = await browser.newPage();
  await page.goto(await app.listen({host:'127.0.0.1',port:0}));
  const sidebar=page.getByRole('button',{name:'Toggle sidebar'});
  if(await sidebar.getAttribute('aria-expanded')==='false')await sidebar.click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Models & connections'}).click();
  await page.getByLabel('Provider',{exact:true}).selectOption(provider);
  assert.equal(requests,0);
  phase='refresh';
  await page.getByRole('button',{name:'Refresh model list'}).click();
  await page.getByText(/catalog refreshed/).waitFor();
  const picker=page.getByLabel('CAgE default model',{exact:true});
  await picker.selectOption(JSON.stringify([provider,id]));
  await page.getByRole('button',{name:'Save models'}).click();
  await page.getByText('Model settings saved.').waitFor();
  assert.ok(requests>0);
  phase='failure';
  await page.getByRole('button',{name:'Refresh model list'}).click();
  await page.getByRole('alert').filter({hasText:'Could not refresh'}).waitFor();
  assert.equal(app.carnot.runtime.models.getModel(provider,id)?.id,id);
  await browser.close();browser=undefined;
  await app.carnot.shutdown();await app.close();app=undefined;
  requests=0;phase='offline';
  app=await createApp(opts);state=await api('GET','/api/bootstrap');
  assert.ok(state.models.some(m=>m.provider===provider&&m.id===id));
  if (live && provider === 'openai') assert.ok(state.models.some(m=>m.provider===provider&&m.id==='gpt-6.2-astra'));
  assert.equal(state.preferences.defaultModel.modelId,id);
  assert.equal(app.carnot.runtime.models.getModel(provider,id)?.id,id);
  assert.equal(requests,0);
  console.log('PASS bundled default, manual refresh, saved selection, failed refresh and offline restart:',id);
} finally {
  await browser?.close();if(app){await app.carnot.shutdown();await app.close();}
  globalThis.fetch=originalFetch;
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
