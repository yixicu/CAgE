<script lang="ts">
  import CheckpointFeedback from '../CheckpointFeedback.svelte';
  import LocalFeedback from './LocalFeedback.svelte';
  import ResponseActionStatus from './ResponseActionStatus.svelte';
  import type { ResponseActionController } from './response-actions.svelte';
  let { actions }: { actions: ResponseActionController } = $props();
  let reviewPanel = $state<HTMLElement>();
  $effect(() => { actions.reviewPanel = reviewPanel; return () => { if (actions.reviewPanel === reviewPanel) actions.reviewPanel = undefined; }; });
</script>
<section aria-label={`${actions.label} response actions`} class="mt-4">
  <div class="flex flex-wrap items-center gap-2">
    <button type="button" disabled={!actions.canRead || !!actions.pending} onclick={() => actions.copy()} title={`Copy ${actions.label} Markdown`}>{actions.pending === 'copy' ? 'Copying…' : 'Copy Markdown'}</button>
    <button type="button" disabled={!actions.canRead || !!actions.pending} onclick={() => actions.exportMarkdown()} title={`Export ${actions.label} as Markdown`}>{actions.pending === 'export' ? 'Exporting…' : 'Export Markdown'}</button>
    {#if actions.canFork}<button type="button" disabled={actions.disabled || !!actions.pending} onclick={() => actions.branch()} title={`Create an independent session from ${actions.label}. Inherited files stay read-only.`}>{actions.pending === 'branch' ? 'Creating branch…' : 'Branch'}</button>{/if}
    {#if actions.canReview}<button type="button" aria-expanded={actions.reviewOpen} onclick={() => actions.reviewOpen ? actions.reviewOpen = false : actions.showReview()} title={`Review ${actions.label}`}>Review</button>{/if}
  </div>
  {#if actions.canReview}
    <section hidden={!actions.reviewOpen} class="mt-3 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4" aria-label={`Review ${actions.label}`} tabindex="-1" bind:this={reviewPanel}>
      <p class="text-xs text-muted mb-2">Review {actions.label}</p>
      {#if actions.context.project?.schemaVersion === 1 && actions.context.page}
        {#key actions.identity}<LocalFeedback projectId={actions.context.project.id} pageId={actions.context.page.id} fingerprint={actions.fingerprint} disabled={actions.disabled} />{/key}
      {:else if actions.context.feedbackEpoch}
        {#key actions.identity}<CheckpointFeedback epoch={actions.context.feedbackEpoch} disabled={actions.disabled || actions.reviewSaving} onsave={(assessment, informationValue, target) => actions.saveFeedback(assessment, informationValue, target)} />{/key}
      {/if}
    </section>
  {/if}
  <ResponseActionStatus {actions} source="footer" />
</section>
