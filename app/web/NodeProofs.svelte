<script lang="ts">
  import { onMount } from 'svelte';
  import type { MapRef, MapSupport, MapNodeDocument, ProofLink } from '../src/learning/knowledge-map';
  import { api } from './api';
  import MarkdownView from './MarkdownView.svelte';

  let {projectId,ref,initial,fallback,theorem=false,historical=false,onopen}:{
    projectId:string; ref:MapRef; initial?:MapNodeDocument; theorem?:boolean;historical?:boolean;
    fallback:{supports?:MapSupport[];suppliedProof?:{argument:string}};
    onopen:(doc:MapNodeDocument)=>void
  }=$props();
  let current=$state<MapNodeDocument>(),error=$state(''),loading=$state(true);
  const controller=new AbortController();
  let visit=0;
  onMount(()=>{
    if(initial){current=initial;loading=false}
    else api.nodeDocument(projectId,ref,controller.signal).then(doc=>{current=doc})
      .catch(()=>{if(!controller.signal.aborted)error='Current proof could not be loaded.'})
      .finally(()=>{loading=false});
    return ()=>controller.abort();
  });
  const rows=$derived.by(()=>{
    const live=current?.node??fallback;
    const result=(live.supports??[]).filter(s=>s.argument).map(s=>({
      label:!current&&historical?'Proof at citation':s.status==='proved'?'Proof':'Supporting argument · '+s.status,
      argument:s.argument,conditions:s.assumptions??[],links:current?.links.filter(link=>link.supportId===s.id)??[]
    }));
    if(live.suppliedProof&&!result.some(row=>row.argument===live.suppliedProof!.argument))
      result.push({label:'Supplied proof',argument:live.suppliedProof.argument,conditions:[],links:[]});
    if(current&&historical){
      const saved=[...(fallback.supports??[]).map(s=>s.argument),fallback.suppliedProof?.argument];
      for(const argument of saved)if(argument&&!result.some(row=>row.argument===argument))
        result.push({label:'Proof at citation',argument,conditions:[],links:[]});
    }
    return result;
  });
  function names(links:ProofLink[]){
    const result=new Map<string,string>();
    for(const link of links)for(const key of [link.title,link.selection,link.basisSelection]){
      if(key)result.set(key,result.has(key)&&result.get(key)!==link.selection?'':link.selection);
    }
    return result;
  }
  async function open(link:ProofLink){
    const id=++visit;
    try{
      const doc=await api.nodeDocument(projectId,link.ref,controller.signal);
      if(id===visit&&!controller.signal.aborted)onopen(doc);
    }catch{if(id===visit&&!controller.signal.aborted)error='This prerequisite version could not be opened.'}
  }
  function follow(node:HTMLElement,links:ProofLink[]){
    function click(event:MouseEvent){
      const anchor=event.target instanceof Element?event.target.closest<HTMLElement>('[data-proof-link]'):null;
      if(!anchor)return;
      event.preventDefault();
      const link=links.find(l=>l.selection===anchor.dataset.proofLink);
      if(link)void open(link);
    }
    node.addEventListener('click',click);
    return {update(next:ProofLink[]){links=next},destroy(){node.removeEventListener('click',click)}};
  }
</script>
{#each rows as row}
<section class="node-proof" use:follow={row.links}>
  <h4>{row.label}</h4><MarkdownView content={row.argument} proofNames={names(row.links)}/>
  {#if row.conditions.length}<details><summary>Proof conditions</summary>{#each row.conditions as condition}<MarkdownView content={condition}/>{/each}</details>{/if}
  {#if row.links.length}<div class="premises"><span>Prerequisites</span>
    {#each row.links as link}<a href={'#cage-node-'+link.selection} data-proof-link={link.selection}>{link.title} <small>v{link.ref.version}</small></a>{/each}
  </div>{/if}
</section>
{/each}
{#if error}<p class="note" role="status">{error}</p>
{:else if theorem&&!rows.length}<p class="note">{loading?'Loading proof…':'No proof is available for this version.'}</p>{/if}
<style>
.node-proof{border-top:1px solid var(--color-line);margin-top:1rem;padding-top:.7rem}
h4{margin:0 0 .35rem;font-size:.94rem;color:var(--color-ink)}
.premises{display:flex;flex-wrap:wrap;gap:.25rem .7rem;align-items:baseline;margin-top:.6rem;font-size:.86rem}
.premises span,.note,small{color:var(--color-muted)}
.node-proof :global(a[data-proof-link]){color:var(--color-link);text-decoration:underline;text-underline-offset:.16em;cursor:pointer}
</style>