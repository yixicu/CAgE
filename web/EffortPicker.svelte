<script lang="ts">
  import type { ModelSelection } from '../src/engine/types';
  let {value, onchange}:{value:ModelSelection; onchange:(value:ModelSelection)=>void}=$props();
  const levels=['off','minimal','low','medium','high','xhigh'] as const;
  let details:HTMLDetailsElement;
  let index=$derived(Math.max(0,levels.indexOf(value.thinkingLevel??'off')));
  let draft=$state(0);
</script>
<svelte:window onpointerdown={e=>{if(details?.open&&!details.contains(e.target as Node))details.open=false}} onkeydown={e=>{if(e.key==='Escape'&&details?.open){details.open=false;details.querySelector('summary')?.focus()}}}/>
<details class="effort" bind:this={details} ontoggle={()=>{if(details.open)draft=index}}>
  <summary aria-label="Thinking effort">Effort · {levels[index]}</summary>
  <div class="slider"><output>{levels[draft]}</output><input type="range" aria-label="Thinking effort level" aria-valuetext={levels[draft]} min="0" max={levels.length-1} step="1" bind:value={draft} onchange={()=>onchange({...value,thinkingLevel:levels[draft]})}/></div>
</details>
<style>
.effort{position:relative;margin:0!important;align-self:end}.effort summary{white-space:nowrap;list-style:none;cursor:pointer;border:1px solid var(--color-line);border-radius:7px;padding:5px 9px;background:var(--color-surface);font-size:.78rem}.slider{position:absolute;z-index:20;inset:auto 0 calc(100% + 5px) auto;width:166px;max-width:70vw;border:1px solid var(--color-line);border-radius:9px;background:var(--color-surface);box-shadow:0 3px 14px var(--color-scrim);padding:8px 12px}.slider output{font-size:.75rem;color:var(--color-muted)}.slider input{display:block;width:100%;margin:2px 0;padding:0;accent-color:var(--color-accent)}
</style>