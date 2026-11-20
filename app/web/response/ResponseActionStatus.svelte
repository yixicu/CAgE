<script lang="ts">
  import type { ResponseActionController } from './response-actions.svelte';
  let { actions, source }: { actions: ResponseActionController; source: 'menu' | 'footer' } = $props();
</script>
{#if actions.statusSource === source && (actions.notice || actions.error)}
  <div class="mt-2 text-xs font-ui normal-case tracking-normal">
    <div class="flex items-start gap-2">
      {#if actions.error}<p class="notice error m-0 flex-1" role="alert">{actions.error}</p>{:else}<p class="text-muted m-0 flex-1" role="status">{actions.notice}</p>{/if}
      <button class="icon-button shrink-0" type="button" aria-label="Dismiss action message" onclick={() => actions.dismissStatus()}>×</button>
    </div>
    {#if actions.exportFailed}
      <button class="mt-2 text-xs" type="button" disabled={!!actions.pending} onclick={() => actions.exportMarkdown(source, true)}>Download instead</button>
      <p class="text-xs text-muted mt-2 mb-0">The browser controls the download folder; enable “Ask where to save” to choose a location.</p>
    {/if}
  </div>
{/if}
