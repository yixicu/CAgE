<script lang="ts">
  import SourceText from "../SourceText.svelte";
  import type { LoopView } from './loop-view';
  let { view }: { view: LoopView } = $props();
</script>
<div class="min-w-0 text-xs leading-relaxed" role="status" aria-live="polite" aria-atomic="true">
  <span class="inline-flex max-w-full items-start gap-2">
    <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" class:bg-accent={view.live} class:bg-muted={!view.live} aria-hidden="true"></span>
    <span class="min-w-0 break-words">
      {#if view.previous && view.live}<span class="text-muted" title="Previous reported operation; not a scientific verdict"><SourceText text={view.previous} /> → </span>{/if}
      <span><SourceText text={view.progress} /></span>
      {#if view.receipt && !view.live}<span class="text-muted"> · {view.receipt}</span>{/if}
    </span>
  </span>
</div>
