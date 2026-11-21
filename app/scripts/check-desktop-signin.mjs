import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const dir = await mkdtemp(join(tmpdir(), 'cage-signin-'));
process.env.PI_CODING_AGENT_DIR = join(dir,'agent');
const { createApp } = await import('../dist/server/app.js');
const realFetch = globalThis.fetch;
let launches = 0, authorization;
const app = await createApp({ dataRoot:dir, desktopVersion:'0.2.10', openProviderBrowser:async url => {
  authorization = new URL(url);
  assert.equal(authorization.origin,'https://auth.openai.com');
  launches++;
  if (launches === 1) throw Error('Fixture: no default handler');
}});
const browser = await chromium.launch({env:{...process.env,LOCALAPPDATA:dir,APPDATA:dir,USERPROFILE:dir}});
try {
  const origin = await app.listen({host:'127.0.0.1',port:0});
  globalThis.fetch = (url, options) => {
    if (new URL(url).hostname !== 'auth.openai.com') return realFetch(url,options);
    assert.match(new URL(url).pathname,/token$/);
    const account = Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'test'}})).toString('base64url');
    return Promise.resolve(Response.json({access_token:'test.'+account+'.test',refresh_token:'test',id_token:'test',scope:'chatgpt.tokens.use.direct',expires_in:600}));
  };
  const page = await browser.newPage();
  await page.addInitScript(()=>window.__CARNOT_DESKTOP_VERSION__='0.2.10');
  await page.goto(origin);
  const sidebar = page.getByRole('button',{name:'Toggle sidebar'});
  if(await sidebar.getAttribute('aria-expanded')==='false') await sidebar.click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Models & connections'}).click();
  const provider = page.getByLabel('Provider',{exact:true});
  for (const id of ['openai','openai-codex']) {
    const before = launches;
    await provider.selectOption(id);
    await page.getByRole('button',{name: /^Sign in with /}).click();
    const box = page.locator('.oauth-box');
    await box.getByRole('button',{name: /Open in default browser/}).waitFor();
    assert.equal(launches,before+1);
    if (id==='openai') {
      await box.getByText(/default browser could not open/).waitFor();
      await box.getByRole('button',{name: /Open in default browser/}).click();
      assert.equal(launches,before+2);
    }
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('state',authorization.searchParams.get('state'));
    callback.searchParams.set('client_id','issued-test-client');
    callback.searchParams.set('code','fixture-code');
    if (id==='openai') {
      const response = await realFetch(callback);
      assert.equal(response.status,200);
    } else {
      await box.getByRole('textbox').fill(callback.href);
      await box.getByRole('button',{name:'Continue sign-in'}).click();
    }
    await box.getByRole('heading',{name: /sign-in: connected/}).waitFor();
    console.log('PASS '+id+' browser request and '+(id==='openai'?'loopback callback':'manual redirect'));
  }
} finally {
  globalThis.fetch = realFetch;
  await browser.close(); await app.carnot.shutdown(); await app.close();
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
