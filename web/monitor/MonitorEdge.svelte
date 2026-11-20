<script lang="ts">
  let { path, active = false, dashed = false, label = '', arrow = true, bridge = false, motion = true }: { path: string; active?: boolean; dashed?: boolean; label?: string; arrow?: boolean; bridge?: boolean; motion?: boolean } = $props();
</script>
<g class:text-accent={active} class:text-muted={!active}>
  <title>{label}</title>
  {#if bridge}<path class="text-surface" d={path} fill="none" stroke="currentColor" stroke-width="5" />{/if}
  <path d={path} fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray={dashed ? '3 4' : undefined} marker-end={arrow ? "url(#research-monitor-arrow)" : undefined} />
  {#if active && motion}<path class="motion-reduce:hidden" d={path} fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 7"><animate attributeName="stroke-dashoffset" from="10" to="0" dur="1s" repeatCount="indefinite" /></path>{/if}
</g>
