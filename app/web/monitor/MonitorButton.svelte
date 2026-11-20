<script lang="ts">
  let { onclick }: { onclick: () => void } = $props();
</script>
<button class="icon-button min-h-7 h-7 w-7 shrink-0 border-0 p-1 text-muted hover:text-accent" type="button" aria-label="Open Monitor" title="Open Monitor" onclick={onclick}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8m-4-4v4M6 11h3l2-4 3 7 2-3h2" /></svg>
</button>
