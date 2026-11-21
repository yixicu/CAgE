<script lang="ts">
 import {onMount} from 'svelte';
 import {api,type ReportUpdate,type ReportPublication,type DomainRequest,type ReviewedPremiseOrigin} from '../api';
 import ReportUpdateView from './ReportUpdateView.svelte';
 import ResearchPaper from '../ResearchPaper.svelte';
 let {projectId,epochs,onreports,onmaintenance}:{onmaintenance:()=>void;projectId:string;epochs:{id:string;number:number}[];onreports:(rows:ReportUpdate[],publications:ReportPublication[])=>void}=$props();
 let updates=$state<ReportUpdate[]>([]), requests=$state<DomainRequest[]>([]);
 let referrals=$state<{id:string;origin:string;epochId?:string}[]>([]);
 let pending=$state(''), error=$state(''), readError=$state('');
 let refresh=async()=>{};
 onMount(()=>{
  const controller=new AbortController(); let generation=0, timer:ReturnType<typeof setTimeout>;
  refresh=async()=>{
   const current=++generation; clearTimeout(timer);
   try{
    const [reports,domains]=await Promise.all([api.reportUpdates(projectId,controller.signal),api.domainRequests(projectId,controller.signal)]);
    if(!controller.signal.aborted&&current===generation){referrals=reports.referrals??[];updates=reports.updates;onreports(reports.updates,reports.publications??[]);requests=domains.requests;readError='';}
   }catch(cause){if(!controller.signal.aborted&&current===generation)readError=cause instanceof Error?cause.message:'Updates unavailable.';}
   finally{if(!controller.signal.aborted&&current===generation)timer=setTimeout(()=>{if(document.hidden)onVisibility();else void refresh();},10000);}
  };
  const onVisibility=()=>{if(!document.hidden)void refresh();};
  document.addEventListener('visibilitychange',onVisibility);void refresh();
  return ()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility);};
 });
 async function reviewSupplement(item:DomainRequest){
  pending=item.taskId;error='';
  try{await api.retryMapTask(projectId,item.revisionTaskId??item.taskId);await refresh();}
  catch(cause){error=cause instanceof Error?cause.message:'Review could not be started.';}
  finally{pending='';}
 }
 async function acceptPremise(statement:string,origin:ReviewedPremiseOrigin){
  pending='foundation';error='';
  try{await api.acceptPremise(projectId,statement,origin);await refresh();}
  catch(cause){error=cause instanceof Error?cause.message:'Foundation could not be saved.';}
  finally{pending='';}
 }
 async function decide(item:DomainRequest,decision:'approve'|'decline',acceptedFields?:string[]){
  if(decision==='approve'&&acceptedFields?.length===0){error='Select a field to approve, or decline the addition.';return;}
  pending=item.taskId;error='';
  try{await api.decideDomain(projectId,item.taskId,item.proposalHash,decision,acceptedFields);await refresh();}
  catch(cause){error=cause instanceof Error?cause.message:'Decision could not be saved.';}
  finally{pending='';}
 }
</script>
{#if readError}<p role="status">{readError}</p>{/if}
{#if referrals.length}
 <p class="notice">{[...new Set(referrals.map(r=>r.origin+(r.epochId?' · Round '+(epochs.find(e=>e.id===r.epochId)?.number??r.epochId):'')))].join(', ')}: A system operation was skipped. <button onclick={onmaintenance}>Open Maintenance Assistant</button></p>
{/if}
{#each updates as update (update.id + ':' + update.revision)}
 <article><h3>Report update · {epochs.find(e=>e.id===update.epochId)?.number??update.epochId}</h3><ReportUpdateView {update} />
  {#if update.foundationChoice==='accepted'}<p>Condition accepted as a project foundation</p>
  {:else if update.foundationChoice==='available'&&update.condition}
   <button disabled={!!pending} onclick={()=>acceptPremise(update.condition!,{kind:'archive',updateId:update.id,revision:update.revision})}>Accept this condition as a project foundation</button>
  {/if}
 </article>
{/each}
{#each requests as item (item.taskId)}
 <section class="notice">
  <h3>{item.fields.join(', ')}</h3><p>{item.reason}</p>
  {#if item.revisionNote}
   <p role="status">{item.revisionNote}</p>
   {#if item.revisionStatus}<p>Supplement review · {item.revisionStatus}</p>{/if}
   {#if item.status==='completed'&&(!item.revisionTaskId||item.revisionStatus==='failed'||item.revisionStatus==='stopped')}
    <button disabled={!!pending} onclick={()=>reviewSupplement(item)}>Review updated supplement</button>
   {/if}
  {/if}
  {#if item.question}<p>{item.question}</p>{/if}
  {#if item.sourceDecision}<p>Independent archive review · {item.sourceDecision}. The original argument remains withdrawn.</p>{/if}
  {#each item.premises??[] as premise}
   <p>Proposed foundation · {premise.field}</p><ResearchPaper content={premise.statement}/>
   {#if premise.accepted}<p>Accepted as a project foundation</p>
   {:else}<button disabled={!!pending} onclick={()=>acceptPremise(premise.statement,{kind:'field',taskId:item.taskId,proposalHash:item.proposalHash,field:premise.field})}>Accept only this statement as a project foundation</button>{/if}
  {/each}
  {#if !item.decision&&item.status==='awaiting-consent'}
   <form onsubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget).getAll('field').map(String);void decide(item,'approve',fields);}}>
    {#if item.fields.length>1}
     <fieldset><legend>Approve the selected fields and decline the rest</legend>
      {#each item.fields as field}<label><input type="checkbox" name="field" value={field} /> {field}</label>{/each}
     </fieldset>
    {:else}<input type="hidden" name="field" value={item.fields[0]} />{/if}
    <button type="submit" disabled={!!pending}>{item.fields.length>1?'Save field choices':'Approve field'}</button>
    <button type="button" disabled={!!pending} onclick={()=>decide(item,'decline')}>Decline all</button>
   </form>
  {:else if item.decision}
   <p>{item.decision==='approve'?'Approved · '+(item.acceptedFields??item.fields).join(', '):'Addition declined'}</p>
   {#if item.alternative}<ResearchPaper content={item.alternative}/>{:else if item.question&&(item.decision==='decline'||item.acceptedFields&&item.acceptedFields.length<item.fields.length)}<p>Alternative route · {item.status}</p>{/if}
  {/if}
 </section>
{/each}
{#if error}<p role="alert">{error}</p>{/if}
