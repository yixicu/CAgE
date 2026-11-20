<script lang="ts">
  let { side }: { side: 'left' | 'right' } = $props();
</script>
<!-- The WAI-ARIA window-splitter pattern explicitly requires a focusable separator.
     Native pointer and keyboard behavior is installed by the shell action. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable ARIA window splitter) -->
<div role="separator" tabindex="0" aria-label={side === 'left' ? 'Resize navigation sidebar' : 'Resize research inspector'} aria-orientation="vertical" aria-controls={side === 'left' ? 'workspace-sidebar' : 'workspace-inspector'} aria-valuemin={side === 'left' ? 200 : 260} aria-valuemax={side === 'left' ? 380 : 460} aria-valuenow={side === 'left' ? 244 : 340} data-resize-side={side} class={`absolute top-3 bottom-3 z-30 hidden w-3 cursor-col-resize touch-none rounded-control outline-offset-0 hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent min-[901px]:block ${side === 'left' ? 'left-[calc(var(--nav-width)-6px)]' : 'right-[calc(var(--inspector-width)-6px)]'}`}><span class="absolute inset-y-3 left-1/2 w-px bg-line/60" aria-hidden="true"></span></div>
