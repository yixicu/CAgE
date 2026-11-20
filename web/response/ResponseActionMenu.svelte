<script lang="ts">
  import Icon from '../Icon.svelte';
  import ResponseActionStatus from './ResponseActionStatus.svelte';
  import type { ResponseActionController } from './response-actions.svelte';
  let { actions }: { actions: ResponseActionController } = $props();
  let open = $state(false), root = $state<HTMLDivElement>(), trigger = $state<HTMLElement>();
  $effect(() => { actions.identity; open = false; });
  function close(restore = false) { open = false; if (restore) trigger?.focus({ preventScroll: true }); }
  function outside(event: Event) { if (open && event.target instanceof Node && !root?.contains(event.target)) close(); }
  function escape(event: KeyboardEvent) { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }
  function run(action: () => unknown) { close(true); void action(); }
</script>
<svelte:document onpointerdown={outside} onfocusin={outside} onkeydown={escape} />
<div class="relative ml-auto shrink-0 font-ui normal-case tracking-normal" bind:this={root}>
  <details bind:open class="m-0">
    <summary class="icon-button inline-flex items-center justify-center rounded-control hover:bg-hover list-none [&::-webkit-details-marker]:hidden" bind:this={trigger} aria-label={`Actions for ${actions.label}`} title={`Actions for ${actions.label}`} onclick={() => { if (!open) actions.dismissStatus(); }}><Icon name="more" size={18} /></summary>
    <div class="absolute right-0 top-full z-30 mt-2 grid w-60 max-w-[calc(100vw-2rem)] gap-1 rounded-control border border-line bg-surface p-2 shadow-md">
      <p class="m-0 px-2 py-1 text-xs text-muted">{actions.label}</p>
      <button class="justify-start" type="button" disabled={!actions.canRead || !!actions.pending} onclick={() => run(() => actions.copy('menu'))}>Copy Markdown</button>
      <button class="justify-start" type="button" disabled={!actions.canRead || !!actions.pending} onclick={() => run(() => actions.exportMarkdown('menu'))}>Export Markdown</button>
      <button class="justify-start" type="button" disabled={!actions.canFork || actions.disabled || !!actions.pending} title={actions.canFork ? `Create an independent session from ${actions.label}` : 'Only an own saved checkpoint can be branched'} onclick={() => run(() => actions.branch('menu'))}>Branch</button>
      <button class="justify-start" type="button" disabled={!actions.canReview} title={actions.canReview ? `Review ${actions.label}` : 'Only an own saved checkpoint can be reviewed'} onclick={() => run(() => actions.showReview(true))}>Review</button>
    </div>
  </details>
  {#if actions.statusSource === 'menu' && (actions.notice || actions.error)}
    <div class="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-control border border-line bg-surface p-3 shadow-md"><ResponseActionStatus {actions} source="menu" /></div>
  {/if}
</div>
