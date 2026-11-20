<script lang="ts">
  import type { DiagramNode } from './diagram-view';
  let { node, active = false, dashed = false }: { node: DiagramNode; active?: boolean; dashed?: boolean } = $props();
</script>
<div data-monitor-node={node.id} class="relative mx-auto w-fit max-w-full min-w-0 rounded-lg border px-2 py-2 text-center" class:border-dashed={dashed} class:border-accent={active} class:bg-selected={active} class:border-line={!active} class:bg-surface={!active} title={`${node.owner}: ${node.detail}`} aria-label={`${node.owner}: ${node.label}`} aria-current={active && !dashed ? 'step' : undefined}>
  <span class="block break-words text-xs leading-snug font-medium">{node.label}</span>
</div>
