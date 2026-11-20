<script lang="ts">
  import type { ResearchProjectV0 } from '../../src/research/contracts/v0';
  import { api } from '../api';
  import MarkdownView from '../MarkdownView.svelte';
  let { project }: { project: ResearchProjectV0 } = $props();
  let selected = $state(''), original = $state(''), error = $state(''), loading = $state(false);
  let label = $state('Original Theorist proof');
  let epochs = $derived([...project.epochs, ...(project.activeEpoch ? [project.activeEpoch] : [])]);
  let request = 0;
  async function readOriginal(id: string, archive = false) {
    const token = ++request, projectId = project.id;
    label = archive ? 'Archived proof · exact original' : 'Original Theorist proof';
    selected = id; original = ''; error = ''; loading = true;
    try {
      const value = archive ? await api.wayArchive(projectId, id) : await api.rawAnswer(projectId, id);
      if (token === request && project.id === projectId) original = value.body;
    } catch (cause) {
      if (token === request && project.id === projectId) error = cause instanceof Error ? cause.message : 'Original proof unavailable.';
    } finally { if (token === request && project.id === projectId) loading = false; }
  }
</script>
<section aria-label="V0 Ways and original proof">
  <h3>V0 · Ways</h3>
  <p class="small">Scientific: {project.scientificVerdict}<br />Execution: {project.status}<br />Archive: {project.archiveStatus}</p>
  <p class="muted small">Plan → solve → archive. Theorist assessment is not independent mathematical verification.</p>
  {#each epochs as epoch (epoch.snapshot.id)}
    <details open>
      <summary>Epoch {epoch.epoch} · {epoch.phase}</summary>
      {#each epoch.selection?.candidates ?? [] as way (way.id)}
        <details>
          <summary>{way.direction} · {epoch.selection?.selectedWayId === way.id ? 'Selected' : 'Not selected'}</summary>
          <p class="small">Estimated p={way.p}. Heuristic, not calibrated.<br />{way.estimateReason}</p>
          <p class="small">{way.returnToRoot}</p>
          {#if way.conditions.length}<p class="small">Conditions: {way.conditions.join('; ')}</p>{/if}
          {#if way.unknownBridges.length}<p class="small">Unknown bridges: {way.unknownBridges.join('; ')}</p>{/if}
        </details>
      {/each}
      {#if epoch.selection}<p class="muted small">Selection: maximum p; exact ties use first in plan.</p>{/if}
      {#if epoch.plan?.blockers.length}<p class="small">{epoch.plan.blockers.join('; ')}</p>{/if}
      {#if epoch.solve}
        <p class="small">Technical: {epoch.solve.technical.executionStatus} · {epoch.solve.technical.completeness}<br />Scientific: {epoch.scientificCommitted ? epoch.solve.outcome.verdict : 'Not committed'}<br />Archive: {epoch.archive?.status ?? 'none'}</p>
        <button onclick={() => readOriginal(epoch.solve!.answerRef.id)}>Read original proof</button>
      {/if}
      {#each (epoch.technicalAnswers ?? []).filter(answer => answer.answerRef.id !== epoch.solve?.answerRef.id) as answer (answer.answerRef.id)}
        <p class="small">Technical-only original: {answer.technical.executionStatus} · {answer.technical.completeness}<br />No scientific outcome committed from this capture.</p>
        <button onclick={() => readOriginal(answer.answerRef.id)}>Read technical-only original</button>
      {/each}
      {#if epoch.archive?.status === 'saved' && epoch.archive.proofRef}<button onclick={() => readOriginal(epoch.archive!.operationId, true)}>Read archived proof</button>{/if}
    </details>
  {/each}
  {#if !epochs.length}<p class="muted small">No Ways planned yet.</p>{/if}
  {#if selected}<section aria-label="Original Theorist proof">
    <h4>{label}</h4>
    {#if loading}<p role="status">Loading original…</p>{:else if error}<p role="alert">{error}</p>{:else}<MarkdownView content={original} />{/if}
  </section>{/if}
</section>
