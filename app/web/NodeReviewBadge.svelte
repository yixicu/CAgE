<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './api';
  import type { MapRef, MapOpenResult, NodeReviewStatus } from '../src/learning/knowledge-map';

  let { projectId, ref, kind, qualification, onchange }: { projectId:string; ref:MapRef; kind:MapOpenResult['kind']; qualification?:MapOpenResult['qualification']; onchange?:()=>void } = $props();
  const labels:Record<NodeReviewStatus,string>={approved:'Approved',pending:'Pending review',invalid:'Invalid'};
  let review=$state<Awaited<ReturnType<typeof api.nodeReview>>>(), editing=$state(false), saving=$state(false), message=$state('');
  let choice=$state<NodeReviewStatus>('pending'), argument=$state('');
  const status=$derived(review?.status ?? (qualification==='disputed'||qualification==='withdrawn'?'invalid':qualification==='proved'||qualification==='observed'||qualification==='definition'?'approved':qualification?'pending':undefined));
  const label=$derived(review?.qualification==='withdrawn'||!review&&qualification==='withdrawn'?'Withdrawn':status?labels[status]:'Checking review…');
  const origin=$derived(review?.origin==='user'?'User review':review?.origin==='theorist'?'Theorist review':review?.origin==='core'?'Published core map':'');
  onMount(()=>{
    let live=true;
    api.nodeReview(projectId,ref).then(r=>{if(live)review=r}).catch(()=>{if(live)message='Current review status is unavailable.'});
    return ()=>{live=false};
  });
  async function save(){
    if(!review||saving)return;
    saving=true;message='';
    try{
      review=await api.setNodeReview(projectId,ref,review.token,choice,argument.trim()||undefined);
      editing=false;onchange?.();
    }catch(e){
      message=e instanceof Error?e.message:String(e);
      try{review=await api.nodeReview(projectId,ref)}catch{}
    }finally{saving=false}
  }
</script>
<section class="review" aria-label="Node review">
  <div class="row">
    <span class="review-state" data-state={status} title={[label,origin].filter(Boolean).join(' · ')}><i aria-hidden="true"></i>{label}</span>
    {#if origin}<small>{origin}</small>{/if}
    {#if review?.editable}<button type="button" aria-label="Change review status" aria-expanded={editing} onclick={()=>{editing=!editing;choice=review!.status;argument='';message=''}}>Change</button>{/if}
  </div>
  {#if editing}
    <form onsubmit={e=>{e.preventDefault();void save()}}>
      <select aria-label="Review status" bind:value={choice} disabled={saving}>
        {#each Object.entries(labels) as [value,text]}<option {value}>{text}</option>{/each}
      </select>
      {#if choice==='approved'&&kind==='theorem'}<label>Supporting argument <small>(if none is on file)</small><textarea bind:value={argument} rows="2" disabled={saving}></textarea></label>{/if}
      <button type="submit" disabled={saving||choice===review?.status}>{saving?'Saving…':'Save review'}</button>
    </form>
  {/if}
  {#if message}<small role="status">{message}</small>{/if}
</section>
<style>
  .review{padding:.4rem .8rem;flex:none;max-height:42%;overflow:auto}
  .row,form{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .review-state{display:inline-flex;align-items:center;gap:.35rem;font-weight:600;font-size:.85rem}
  i{width:.65rem;height:.65rem;border-radius:50%;background:var(--color-muted);border:1px solid color-mix(in srgb,currentColor 22%,transparent)}
  [data-state=approved] i{background:#42b477}
  [data-state=pending] i{background:#e8b742}
  [data-state=invalid] i{background:#e45b61}
  small{color:var(--color-muted)}
  button,select,textarea{font:inherit;color:inherit;background:var(--color-surface);border:1px solid var(--color-line);border-radius:.3rem}
  button,select{padding:.2rem .45rem;font-size:.82rem}
  .row button{margin-left:auto}
  form{margin-top:.5rem}
  label{width:100%;font-size:.82rem}textarea{display:block;box-sizing:border-box;width:100%;padding:.3rem}
</style>
