<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from './api';
  let current=$state<number>();
  let latest=$state<{version:number;sha256:string}>();
  let busy=$state(true);
  let message=$state('');
  let keptLocal=$state(0);
  let needsAccess=$state(false);
  let token=$state('');
  onMount(async()=>{
    try{const status=await api.coreMapStatus();current=status.currentVersion;keptLocal=status.keptLocal;}
    catch{message='Could not read the installed Core map version.';}
    finally{busy=false;}
  });
  async function run(install:boolean){
    if(busy)return;
    busy=true;
    message=install?'Verifying and applying the Core map…':'Checking GitHub…';
    try{
      if(install&&latest){
        const status=await api.installCoreMap(latest.version,latest.sha256,token.trim()||undefined);
        current=status.currentVersion;
        keptLocal=status.keptLocal;
        message='Core map updated.';
        latest=undefined;token='';
      }else{
        latest=undefined;
        const result=await api.checkCoreMap(token.trim()||undefined);
        current=result.currentVersion;keptLocal=result.keptLocal;
        latest=result.available?result.release:undefined;
        message=latest?'Version '+latest.version+' is available.':'Your Core map is up to date.';
        if(!latest)token='';
      }
    }catch(error){
      if(error instanceof ApiError&&[401,403,404].includes(error.status))needsAccess=true;
      latest=undefined;
      message=error instanceof Error?error.message:'Could not update the Core map.';
    }finally{busy=false;}
  }
</script>

<section class="settings-panel" aria-labelledby="core-map-updates">
  <h2 id="core-map-updates">Core map updates</h2>
  <p class="muted small">{current===undefined?'Reading installed version…':current?'Installed version '+current:'Core map package is not installed'} · yixicu/CAgE</p>
  {#if keptLocal}<p class="muted small">Preserved local edits on {keptLocal} {keptLocal===1?'node':'nodes'}.</p>{/if}
  {#if needsAccess}
    <label for="core-map-token">GitHub access token</label>
    <input id="core-map-token" type="password" autocomplete="off" spellcheck="false" bind:value={token} />
    <p class="muted small">Private repository access requires a token with Contents read permission. It is used for this update only.</p>
  {/if}
  <div class="actions">
    <button disabled={busy} onclick={()=>run(false)}>Check for map updates</button>
    {#if latest}<button class="primary" disabled={busy} onclick={()=>run(true)}>{current?'Update':'Install'} Core map</button>{/if}
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  label,input{display:block;margin-top:8px}
  input{width:min(100%,32rem)}
</style>
