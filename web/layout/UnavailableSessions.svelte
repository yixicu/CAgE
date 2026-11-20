<script lang="ts">
  import type { UnavailableProject } from '../api';
  let { projects = [] }: { projects?: readonly UnavailableProject[] } = $props();
</script>
{#if projects.length}
  <details class="mx-2 my-2 min-w-0 rounded-control border border-warning/35 bg-warning-soft/40" aria-label="Unavailable sessions">
    <summary class="flex min-h-8 cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-warning">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
      <span>Unavailable</span><span class="ml-auto tabular-nums">{projects.length}</span>
    </summary>
    <ul class="m-0 list-none space-y-2 px-2 pb-2 text-xs">
      {#each projects as project (project.id)}
        <li class="min-w-0 border-t border-warning/20 pt-2">
          <p class="m-0 wrap-anywhere font-medium text-ink">{project.name || project.id}</p>
          {#if project.name}<p class="m-0 mt-1 wrap-anywhere text-micro text-muted">{project.id}</p>{/if}
          <p class="m-0 mt-1 leading-relaxed text-muted">{project.message}</p>
        </li>
      {/each}
    </ul>
  </details>
{/if}
