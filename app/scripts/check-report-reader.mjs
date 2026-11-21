import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '@playwright/test';

export async function checkReportReader(app,id,root,api){
  const {publications}=await api('GET','/api/projects/'+id+'/v4/report-updates');
  assert.ok(publications.some(p=>p.role==='theorist'&&p.kind==='Skill'&&p.title==='Factor-of-two decomposition'));
  const browser=await chromium.launch({env:{...process.env,LOCALAPPDATA:root,APPDATA:root,USERPROFILE:root}});
  const page=await browser.newPage({viewport:{width:1480,height:920},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const shot=async name=>{if(process.env.CAGE_READER_SHOTS){await mkdir(process.env.CAGE_READER_SHOTS,{recursive:true});await page.screenshot({path:join(process.env.CAGE_READER_SHOTS,name+'.png'),animations:'disabled'});}};
  const left=page.getByRole('button',{name:'Toggle sidebar'}),right=page.getByRole('button',{name:'Toggle research tree'});
  async function show(toggle,wanted){if((await toggle.getAttribute('aria-expanded')==='true')!==wanted)await toggle.click();}
  const width=()=>page.locator('.conversation').evaluate(n=>n.getBoundingClientRect().width);
  async function fits(){
    await page.waitForFunction(()=>{
      const c=document.querySelector('.conversation')?.getBoundingClientRect(),dock=document.querySelector('.reader-dock-inner')?.getBoundingClientRect();
      const p=document.querySelector('.main-scroll')?.getBoundingClientRect();
      return c&&dock&&p&&c.left>=p.left-1&&c.right<=p.right+1&&Math.abs(c.width-dock.width)<2&&Math.abs(c.left-dock.left)<2;
    });
  }
  try{
    await page.goto(await app.listen({host:'127.0.0.1',port:0})+'/#'+id);
    await show(left,true);
    await show(right,true);
    const outline=page.getByRole('navigation',{name:'Report outline'}),toggle=outline.getByRole('button',{name:/Report outline/});
    await toggle.waitFor();const dismiss=page.getByRole('button',{name:'Dismiss learning failure'});if(await dismiss.isVisible())await dismiss.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();
    await outline.getByRole('button',{name:'Expand Factorization'}).click();
    const heading=outline.getByRole('button',{name:'Extracting the factor',exact:true});
    await heading.click();await page.waitForFunction(()=>document.activeElement?.textContent==='Extracting the factor');
    assert.equal(await heading.getAttribute('aria-current'),'location');
    await fits();await shot('report-outline');
    await page.locator('.main-scroll').evaluate(el=>{
      const h=[...el.querySelectorAll('[data-current-report] h3')].find(e=>e.textContent==='The converse');
      el.scrollBy(0,h.getBoundingClientRect().top-el.getBoundingClientRect().top-el.querySelector('.hypothesis-heading').getBoundingClientRect().height-16);
    });
    await outline.locator('button[aria-current="location"]').filter({hasText:'The converse'}).waitFor();
    const citation=page.locator('[data-current-report] a[data-map-citation]').first();
    await outline.getByRole('button',{name:'Factorization',exact:true}).click();await citation.click();
    const card=page.getByRole('dialog').filter({has:page.locator('.node-type')});await card.getByText('theorem',{exact:true}).waitFor();await card.getByText('Approved',{exact:true}).waitFor();
    await card.getByRole('heading',{name:'Proof',exact:true}).waitFor();
    await card.getByText(/Substitution gives n² = 4k²/).waitFor();
    await card.getByRole('button',{name:'Show on map'}).waitFor();
    const edit=card.getByRole('button',{name:'Change review status'});
    assert.equal(await edit.getAttribute('title'),'Change');
    assert.equal((await edit.innerText()).trim(),'');
    assert.equal(await card.getByText(/cited as pending/i).count(),0);
    assert.equal(await card.getByText('Theorist review',{exact:true}).isVisible(),false);
    await shot('node-type');
    await card.getByText('Version details',{exact:true}).click();
    await card.getByText('Theorist review',{exact:true}).waitFor();
    await shot('node-version-details');
    await page.keyboard.press('Escape');
    const footer=page.getByLabel('Report publications');await footer.scrollIntoViewIfNeeded();await footer.getByText('Factor-of-two decomposition').waitFor();
    await shot('report-publication');
    await page.locator('.main-scroll').evaluate(n=>n.scrollTo(0,0));
    const grip=page.getByRole('slider',{name:'Reading width'});await grip.focus();await page.keyboard.press('End');
    await fits();const both=await width();
    await show(left,false);await show(right,false);await page.waitForFunction(w=>document.querySelector('.conversation').getBoundingClientRect().width>w+200,both);
    const box=await grip.boundingBox(),before=await width();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-105,box.y+box.height/2,{steps:8});await page.mouse.up();
    assert.ok(await width()<before-100);await fits();
    const pref=await grip.getAttribute('aria-valuenow');
    await show(right,true);await show(left,true);
    for(const side of ['left','right']){
      const h=page.locator('[data-resize-side="'+side+'"]');await h.focus();await page.keyboard.press('End');await fits();
      await page.keyboard.press('Home');await fits();
    }
    assert.equal(await grip.getAttribute('aria-valuenow'),pref);
    await show(left,false);await heading.click();await fits();await shot('reading-width');
    await page.reload();await grip.waitFor();assert.equal(await grip.getAttribute('aria-valuenow'),pref);
    await page.setViewportSize({width:760,height:850});await fits();assert.equal(await grip.isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS real publication, nested headings, jump/scroll, citation type, drag, both panels, restore and narrow viewport');
  }catch(e){console.error({url:page.url(),errors,text:(await page.locator('body').innerText()).slice(-2700)});throw e;}finally{await browser.close();}
}
