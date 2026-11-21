<script lang="ts">
  import {onMount,tick} from 'svelte';
  import AgentModelMenu from './AgentModelMenu.svelte';
  import type {ModelSelection} from '../src/engine/types';
  import {api,type Bootstrap} from './api';
  import type {PublicMaintenanceHistory as MaintenanceHistory,MaintenanceInput} from '../src/server/maintenance-session';
  let {bootstrap,onmodel,onsettings}:{bootstrap:Bootstrap;onmodel:(model:ModelSelection)=>Promise<void>;onsettings:()=>void}=$props();
  let projects=$derived(bootstrap.projects);
  let history=$state<MaintenanceHistory>(), projectId=$state(''), message=$state(''), allowChanges=$state(false);
  let sending=$state(false), error=$state(''), running=$derived(history?.turns.at(-1)?.status==='running');
  let note=$state<MaintenanceInput['note']>(), readingNote=$state(false), fileInput:HTMLInputElement;
  async function attach(file?:File){
    note=undefined;error='';if(!file)return;readingNote=true;
    try{if(file.size>800000)throw Error('Split the note into smaller sections.');
      const text=await file.text();if(!text.trim()||text.length>200000||text.includes('\0'))throw Error('Choose a UTF-8 text file with up to 200,000 characters.');
      note={name:file.name,text};
    }catch(e){error=String(e);fileInput.value='';}finally{readingNote=false;}
  }
  import MarkdownView from './MarkdownView.svelte';
  let log:HTMLElement;
  let follow=true;
  $effect(()=>{
    const value=history;
    if(value && follow)void tick().then(()=>{if(log && follow)log.scrollTop=log.scrollHeight});
  });
  let pending:MaintenanceInput|undefined, readSequence=0;
  async function refresh(){
    const sequence=++readSequence;
    try{const value=await api.maintenanceSession();if(sequence===readSequence){history=value;error='';}}
    catch(e){if(sequence===readSequence)error=e instanceof Error?e.message:'Could not read the maintenance session.';}
  }
  onMount(()=>{void refresh();window.addEventListener('focus',refresh);return ()=>{++readSequence;window.removeEventListener('focus',refresh);};});
  $effect(()=>{
    if(running){
      let reading=false;
      const timer=setInterval(()=>{if(!reading){reading=true;void refresh().finally(()=>{reading=false;});}},1500);
      return ()=>clearInterval(timer);
    }
  });
  async function stop(){
    const turn=history?.turns.at(-1);
    if(turn?.status!=='running')return;
    try{history=await api.stopMaintenance(turn.requestId);}catch(e){error=e instanceof Error?e.message:'Could not stop maintenance.';}
  }
  async function send(event:SubmitEvent){
    event.preventDefault();
    if(sending||running||readingNote||!message.trim())return;
    if(!pending||pending.message!==message||pending.projectId!==(projectId||undefined)||pending.allowChanges!==allowChanges||pending.note!==note)
      pending={requestId:crypto.randomUUID(),projectId:projectId||undefined,message,allowChanges,note};
    follow=true;sending=true;error='';++readSequence;
    try{history=await api.sendMaintenance(pending);message='';pending=undefined;allowChanges=false;note=undefined;fileInput.value='';}
    catch(e){error=e instanceof Error?e.message:'Could not submit the maintenance request.';}
    finally{sending=false;}
  }
</script>
<section class="maintenance-chat">
  <header><h1>Maintenance Assistant</h1></header>
  <div class="transcript" bind:this={log} onscroll={()=>follow=log.scrollHeight-log.scrollTop-log.clientHeight<48}>
    <div class="conversation-column">
      {#each history?.turns??[] as turn (turn.requestId)}
        <article>
          <div class="request"><small>{turn.projectId?(projects.find(p=>p.id===turn.projectId)?.name??turn.projectId):'Workspace'}</small><p>{turn.message}</p>
            {#if turn.note}<small>{turn.note.name}</small>{/if}
          </div>
          {#if turn.tools.length}<ol aria-label="Maintenance progress" aria-live="polite">
            {#each turn.tools as tool}<li>{tool.summary??[tool.name.replace(/^maintenance_/,'').replaceAll('_',' '),tool.target,tool.status].filter(Boolean).join(' · ')}</li>{/each}
          </ol>{/if}
          {#if turn.reply}<MarkdownView content={turn.reply}/>{/if}
          {#if turn.status!=='completed'}<small role="status">{turn.status==='interrupted'?'Interrupted. Check recorded operations before requesting more changes.':turn.status}</small>{/if}
        </article>
      {/each}
    </div>
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  <form onsubmit={send}>
    <textarea bind:value={message} aria-label="Maintenance request" placeholder="Ask about a saved round or a node…" rows="3" disabled={sending}
      onkeydown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}></textarea>
    <div class="tools"><select aria-label="Maintenance scope" bind:value={projectId} onchange={()=>allowChanges=false} disabled={sending||running}><option value="">Shared library &amp; Core map</option>{#each projects as p}<option value={p.id}>{p.name}</option>{/each}</select>
      <label><input type="checkbox" bind:checked={allowChanges} disabled={sending||running}/> Allow changes</label>
      <input hidden bind:this={fileInput} type="file" accept=".md,.markdown,.txt,.tex,.csv,.json,text/plain,text/markdown" onchange={e=>attach(e.currentTarget.files?.[0])}/>
      <button class="attach" type="button" aria-label="Attach note" title={note?.name??'Attach note'} disabled={sending||running||readingNote} onclick={()=>fileInput.click()}>+</button>
      {#if note}<small>{note.name}</small>{/if}
      <AgentModelMenu {bootstrap} maintenance disabled={sending||running} onchange={onmodel} {onsettings}/>
      {#if running}<button class="send" type="button" onclick={stop}>Stop</button>{:else}<button class="send primary" type="submit" disabled={!history||sending||readingNote||!message.trim()}>Send</button>{/if}
    </div>
  </form>
</section>
<style>
.maintenance-chat{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--color-ink)}
header,.conversation-column,form,[role=alert]{width:min(100%,740px);margin-inline:auto}
header{border-bottom:1px solid var(--color-line);padding-block:10px}h1{margin:0;font-size:1.35rem}
.transcript{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain}
article{display:grid;gap:14px;margin:24px 0 36px;overflow-wrap:anywhere}
.request{justify-self:end;max-width:86%;padding:10px 16px;border-radius:16px 16px 4px 16px;background:var(--color-selected)}
.request p{white-space:pre-wrap;margin:4px 0}.request small,li,article>small{color:var(--color-muted)}
ol{border-left:2px solid var(--color-line-strong);margin:2px 0;padding-left:18px;list-style:none;font-size:.85em}li+li{margin-top:6px}
form{padding:12px;border:1px solid var(--color-line-strong);background:var(--color-surface);border-radius:16px;box-shadow:0 4px 16px var(--color-scrim)}
textarea{width:100%;resize:vertical;max-height:28vh;border:none;background:transparent;color:inherit}
.tools,.tools label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tools label{margin:0}.tools select{max-width:45%;width:auto}.send{margin-left:auto}
.tools>button,.tools>select,.tools>label,.tools :global(.model-trigger){box-sizing:border-box;min-height:30px;height:30px;border:1px solid var(--color-line);border-radius:7px;padding:0 8px;margin:0}.tools>label{flex-wrap:nowrap}.tools .send{margin-left:auto}.tools .attach{width:30px;font-size:1.25rem}
</style>
