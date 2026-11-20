<script lang="ts">
  let { value, onselect }: {
    value: 'research' | 'monitor';
    onselect: (view: 'research' | 'monitor') => void;
  } = $props();
  const views = ['research', 'monitor'] as const;
</script>

<div class="flex w-full gap-0 bg-transparent" role="group" aria-label="Inspector view">
  {#each views as view}
    <button type="button"
      class="group relative isolate min-h-9 min-w-0 flex-1 overflow-hidden rounded-lg border-0 bg-transparent px-2 py-1.5 text-xs shadow-none hover:bg-transparent focus-visible:outline-offset-[-2px]"
      class:text-accent={value === view} class:font-semibold={value === view}
      aria-pressed={value === view} onclick={() => onselect(view)}>
      <span aria-hidden="true" class={`pointer-events-none absolute inset-0 -z-1 rounded-[inherit] bg-linear-to-t from-accent/25 via-accent/8 to-transparent transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100 ${value === view ? 'opacity-45' : 'opacity-0'}`}></span>
      <span>{view === 'research' ? 'Research' : 'Monitor'}</span>
    </button>
  {/each}
</div>
