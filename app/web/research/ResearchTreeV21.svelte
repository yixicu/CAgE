<script lang="ts">
  import type { ResearchProjectV21 } from '../../src/research/contracts/v21';
  import { v21LatestReview, v21OptionalEpochs, v21DefaultOptionalOriginal } from '../research-view-v21';
  import { api } from '../api';
  import SavedProofView from './SavedProofView.svelte';
  import type { SavedProof } from '../api';
  import type { MapOpenResult } from '../../src/learning/knowledge-map';
  import ArchivedRefutationView from './ArchivedRefutationView.svelte';
  import type { ArchivedRefutation } from '../../src/learning/research-data';
  import V3Evidence from './V3Evidence.svelte';
  import ResearchTag from './ResearchTag.svelte';
  import { agentTag, proofTerms, statusTag } from './research-tags';
  let { project,reportUpdates=[],onmap }: { project: ResearchProjectV21;reportUpdates?:ReportUpdate[];onmap:(read:MapOpenResult)=>void } = $props();
  let selectionLabel = $state('Original answer');
  import ReportUpdateView from './ReportUpdateView.svelte';
  import type {ReportUpdate} from '../api';
  let loadedAssessment=$state<ReportUpdate>();
  let assessment=$derived.by(()=>{
    for(const epoch of optionalEpochs){
      const flow=epoch.optionalFlow;
      const artifactId=flow?.archives.find(a=>a.operationId===selected)?.artifactId??flow?.artifacts.find(a=>a.originalRef.id===selected)?.id;
      if(artifactId)return reportUpdates.findLast(row=>row.projectId===project.id&&row.epochId===epoch.snapshot.id&&row.artifactId===artifactId&&row.status!=='queued')??loadedAssessment;
    }
    return loadedAssessment;
  });
  let refutation=$state<ArchivedRefutation>();
  let selected = $state(''), original = $state<SavedProof>(), error = $state(''), loading = $state(false);
  let answers = $derived([...project.answers, ...(project.activeEpoch?.answers ?? [])].filter((answer, index, all) => all.findIndex(other => other.id === answer.id) === index));
  let request = 0;
  let optionalEpochs=$derived(v21OptionalEpochs(project));
  let proofGroups=$derived.by(()=>{
    const rows=optionalEpochs.flatMap(epoch=>(epoch.optionalFlow?.artifacts??[]).map(artifact=>({epoch,artifact})));
    const groups=new Map<string,typeof rows>();for(const row of rows){const label=JSON.stringify([row.artifact.root.hypothesisId,row.artifact.root.revision,row.artifact.root.workingText,row.artifact.root.conditions]);if(!groups.has(label))groups.set(label,[]);groups.get(label)!.push(row)}return groups;
  });
  const normalize=(value:string)=>value.trim().replace(/\s+/g,' ');
  function technicalOriginals(epoch:typeof optionalEpochs[number]){
    const seen=new Set(epoch.optionalFlow?.artifacts.map(a=>a.originalRef.id));
    return epoch.calls.filter(call=>{const id=call.captured?.originalRef.id;if(!id||seen.has(id))return false;seen.add(id);return true});
  }
  let defaultKey=$state('');
  $effect(()=>{const choice=v21DefaultOptionalOriginal(project);if(!['3.0','4.0'].includes(project.researchLoopVersion)&&choice&&defaultKey!==choice.key){defaultKey=choice.key;if(choice.kind==='archive')void readArchive(choice.id,choice.label);else void readAnswer(choice.id,choice.label);}else if(choice&&selected===choice.id)selectionLabel=choice.label;});
  // A project switch invalidates in-flight fetches before any other project's text can appear.
  let displayProject=$state('');
  $effect(()=>{if(displayProject!==project.id){displayProject=project.id;++request;selected='';original=undefined;error='';loading=false;defaultKey='';}});
  async function readAnswer(answerId: string, label = 'Original answer · completion not inferred') {
    refutation=undefined;loadedAssessment=undefined;
    const token = ++request, projectId = project.id;
    selectionLabel = label; selected = answerId; original = undefined; error = ''; loading = true;
    try { const value = await api.rawAnswer(projectId, answerId); if (token === request && project.id === projectId) original = value; }
    catch (cause) { if (token === request && project.id === projectId) error = cause instanceof Error ? cause.message : 'Original answer unavailable.'; }
    finally { if (token === request && project.id === projectId) loading = false; }
  }
  async function readArchive(operationId: string, label = 'Archived original · current qualification shown above') {
    refutation=undefined;loadedAssessment=undefined;
    const token = ++request, projectId = project.id;
    selectionLabel = label; selected = operationId; original = undefined; error = ''; loading = true;
    try { const value = await api.wayArchive(projectId, operationId); if (token === request && project.id === projectId) { original = value; refutation=value.refutation;loadedAssessment=value.assessment; } }
    catch (cause) { if (token === request && project.id === projectId) error = cause instanceof Error ? cause.message : 'Archive unavailable.'; }
    finally { if (token === request && project.id === projectId) loading = false; }
  }
</script>
{#snippet archiveLinks(records:ReturnType<typeof proofGroups.get>)}
  {@const archives=new Map((records??[]).flatMap(({epoch,artifact})=>(epoch.optionalFlow?.archives??[]).filter(a=>a.artifactId===artifact.id&&a.status==='saved').map(a=>[a.operationId,epoch.epoch] as const)))}
  {#if archives.size===1}{#each archives.keys() as op}<button onclick={()=>readArchive(op)}>Archive</button>{/each}
  {:else if archives.size>1}<details><summary>Archives · {archives.size}</summary>{#each archives as [op,round],i}<button onclick={()=>readArchive(op)}>Round {round} · Archive {i+1}</button>{/each}</details>{/if}
{/snippet}
<section class="mx-3 my-3 min-w-0" aria-label={project.researchLoopVersion === '3.0' ? 'V3 proofs and evidence' : 'V2.1 Ways and questions'}>
  {#if project.researchLoopVersion!=='4.0' || proofGroups.size}<h3>{['3.0','4.0'].includes(project.researchLoopVersion) ? 'Proofs' : 'Ways · Questions'}</h3>{/if}
  {#if project.researchLoopVersion==='4.0'}
    {#each proofGroups as [claim,records] (claim)}
      <details class="proof-group"><summary>{records[0]?.artifact.root.workingText} <small>· {records.length}</small></summary>
        {#each records as {artifact,epoch}}
          <div class="proof-record">{#if normalize(artifact.route.description)!==normalize(artifact.root.workingText)}<strong>{artifact.route.description}</strong>{/if}<ResearchTag {...agentTag(artifact.authorRole)} kind="agent"/><ResearchTag {...statusTag(artifact.qualification)} kind="status"/>
          <button onclick={()=>readAnswer(artifact.originalRef.id)}>Round {epoch.epoch} · Original</button>
          </div>
        {/each}
        {@render archiveLinks(records)}
      </details>
    {/each}
    {#each optionalEpochs as epoch (epoch.snapshot.id)}
    {@const flow=epoch.optionalFlow!}
    {@const originals=technicalOriginals(epoch)}
    {@const hasEvidence=!!(flow.v3?.workspace.records.length || flow.v3?.receipts.length)}
    {#if hasEvidence || originals.length || flow.notices.length || flow.conflictArtifactIds.length}<details><summary>Round {epoch.epoch} · Evidence</summary>
      {#if epoch.optionalFlow?.conflictArtifactIds.length}<p role="alert">Conflicting claims · review required</p>{/if}
      {#if hasEvidence}<V3Evidence {epoch} inline knownClaims={new Set(flow.artifacts.map(a=>normalize(a.root.workingText)))}/>{/if}
      {#each originals as call (call.id)}<button onclick={()=>readAnswer(call.captured!.originalRef.id)}>Technical original · {call.captured!.technical.executionStatus}</button>{/each}
      {#each epoch.optionalFlow?.notices??[] as notice}<p>{notice}</p>{/each}
    </details>{/if}{/each}
  {:else}
  {#each optionalEpochs as epoch (epoch.snapshot.id)}
    {@const flow=epoch.optionalFlow!}
    <details open><summary>Epoch {epoch.epoch}</summary>
      {#if flow.conflictArtifactIds.length}<p role="alert">Opposing claims for the same root require review. A previous archive is not currently qualified.</p>{/if}
      {#each flow.artifacts as artifact (artifact.id)}
        {@const archive=flow.archives.findLast(a=>a.artifactId===artifact.id&&a.status==='saved')}
        {@const agent = agentTag(artifact.authorRole)}
        <details open={project.researchLoopVersion !== '3.0'} class="my-2" data-proof-id={artifact.id}>
          <summary class="cursor-pointer list-none rounded-control py-1 [&::-webkit-details-marker]:hidden" title={artifact.route.description} aria-label={`${agent.label} proof: ${artifact.route.description}`}>
            <span class="flex min-w-0 flex-wrap gap-1"><ResearchTag {...agent} kind="agent" detail={artifact.authorRole} />{#each proofTerms(artifact.route.description) as term}<ResearchTag label={term} tone="accent" />{/each}</span>
          </summary>
        <p class="my-2 text-xs leading-relaxed wrap-anywhere">{artifact.route.description}</p>
        <p class="small">Scientific: {artifact.qualification} · Technical: {artifact.technical.executionStatus}/{artifact.technical.completeness}<br />{artifact.exposureArtifactIds.length ? 'Informed by delivered evidence.' : 'No sibling original delivered.'}{flow.selectedArtifactId===artifact.id?' · Default display':''}</p>
        <button onclick={()=>readAnswer(artifact.originalRef.id)}>Read {artifact.authorRole} original</button>
        {#if archive}<button onclick={()=>readArchive(archive.operationId)}>Read retained proof archive</button>{/if}
        </details>
      {/each}
      {#each flow.branches.filter(b=>!b.artifactId) as branch (branch.id)}
        <details class="my-2" data-proof-branch={branch.id}>
          <summary class="cursor-pointer list-none rounded-control py-1 [&::-webkit-details-marker]:hidden" title={branch.frozen.way.direction}>
            <span class="flex min-w-0 flex-wrap gap-1"><ResearchTag {...agentTag(branch.kind)} kind="agent" detail={branch.kind} />{#each proofTerms(branch.frozen.way.direction) as term}<ResearchTag label={term} tone="accent" />{/each}<ResearchTag {...statusTag(branch.state)} kind="status" /></span>
          </summary>
          <p class="my-2 text-xs leading-relaxed wrap-anywhere">{branch.frozen.way.direction}</p>
        </details>
      {/each}
      {#each epoch.calls.filter(c=>c.captured) as call (call.id)}<p class="small">Saved original · completion unassessed: {call.captured!.technical.executionStatus}/{call.captured!.technical.completeness}. No scientific qualification.</p><button onclick={()=>readAnswer(call.captured!.originalRef.id)}>Read retained technical original</button>{/each}
      {#each flow.notices as notice}<p class="muted small">{notice}</p>{/each}
      {#if project.researchLoopVersion === '3.0'}<V3Evidence {epoch} />{/if}
    </details>
  {/each}
  {#each project.ways as way (way.id)}
    <details open>
      <summary>{way.direction} · {way.utilityStatus}</summary>
      <p class="muted small">{way.purpose}</p>
      {#each way.questionIds as questionId}
        {@const question = project.questions.find(item => item.id === questionId && item.wayId === way.id)}
        {#if question}
          <details>
            <summary>Q{question.order} · {question.question}</summary>
            <p class="small">{question.purpose}</p>
            {#if question.dependencyQuestionIds.length}<p class="small muted">Dependencies: {question.dependencyQuestionIds.join(', ')}</p>{/if}
            {#each answers.filter(answer => answer.questionId === question.id && answer.questionRevision === question.revision) as answer (answer.id)}
              {@const review = v21LatestReview(project, answer.id)}
              <p class="small">Technical: {answer.executionStatus} · {answer.completeness}<br />Scientific review: {review?.status ?? 'not reviewed'}</p>
              {#if review}<p class="small">{review.conclusion}</p>{/if}
              <button onclick={() => readAnswer(answer.id)}>Read original answer</button>
            {/each}
          </details>
        {/if}
      {/each}
      {#each answers.filter(answer => answer.wayId === way.id && !project.questions.some(question => question.id === answer.questionId && question.revision === answer.questionRevision)) as answer (answer.id)}
        <p class="small muted">Earlier Question {answer.questionId} · revision {answer.questionRevision} · {answer.executionStatus} · {answer.completeness}</p>
        <button onclick={() => readAnswer(answer.id)}>Read earlier original answer</button>
      {/each}
    </details>
  {/each}
  {#each project.epochs.flatMap(epoch => epoch.archives).filter(archive => archive.status === 'saved' && archive.proofRef) as archive (archive.operationId)}
    <button onclick={() => readArchive(archive.operationId)}>Read archived Way {archive.wayId}</button>
  {/each}
  {#if !project.ways.length&&!optionalEpochs.length}<p class="muted small">No Ways planned yet.</p>{/if}
  {/if}
  {#if selected}<section aria-label="Exact original proof">
    <h4>{selectionLabel}</h4>
    {#if assessment}<ReportUpdateView update={assessment} />{/if}
    {#if refutation}<ArchivedRefutationView result={refutation} />{/if}
    {#if loading}<p role="status">Loading original…</p>{:else if error}<p role="alert">{error}</p>{:else if original}<SavedProofView projectId={project.id} proof={original} paper={false} {onmap}/>{/if}
  </section>{/if}
</section>
