<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { ProjectSummary, UnavailableProject } from '../api';
  import UnavailableSessions from './UnavailableSessions.svelte';
  import { sessionHistory, type HistorySession } from './session-history';
  import SessionActions from './SessionActions.svelte';

  let { projects, unavailableProjects = [], selectedId, search = '', busy = false, onselect, onaction, groups=[], onmove, catalog, outline }: {
    outline?:import('svelte').Snippet; groups?:string[]; onmove?:(id:string,group:string)=>Promise<void>; catalog?:readonly ProjectSummary[];
    projects: readonly ProjectSummary[];
    unavailableProjects?: readonly UnavailableProject[];
    selectedId?: string;
    search?: string;
    busy?: boolean;
    onselect: (id: string) => void | Promise<void>;
    onaction: (id: string, action: 'archive' | 'restore' | 'export' | 'delete') => void;
  } = $props();
  let roots = $derived(sessionHistory(projects.filter(project => !project.archived), search, catalog??projects));
  let archived = $derived(sessionHistory(projects.filter(project => project.archived), search, catalog??projects));
</script>

{#snippet session(node: HistorySession, child = false)}
  <li class="min-w-0">
    <div class="session-row relative flex min-w-0 items-center rounded-control" class:bg-selected={selectedId === node.project.id}>
      {#if child}<span aria-hidden="true" class="pointer-events-none absolute top-1/2 -left-2.5 w-2.5 border-t border-line"></span>{/if}
      <button type="button" class="project-button min-w-0 flex-1" class:chosen={selectedId === node.project.id}
        aria-current={selectedId === node.project.id ? 'page' : undefined}
        aria-label={`${node.label}${node.project.status === 'running' ? ' · Running' : ''}`} title={node.label} disabled={busy}
        draggable={!busy} ondragstart={e=>{e.dataTransfer?.setData('application/x-carnot-session',node.project.id)}}
        data-session-id={node.project.id} data-fork-parent={node.project.fork?.parentSessionId}
        data-fork-checkpoint={node.project.fork?.checkpointId}
        data-search-context={!node.matches || undefined}
        onclick={() => onselect(node.project.id)}>
        <Icon name={node.project.fork ? 'tree' : 'chat'} size={16} />
        <span class="truncate" class:text-muted={!node.matches}>{node.project.name}</span>
        {#if node.project.status === 'running'}<span class="running-dot" aria-hidden="true"></span>{/if}
      </button>
      <SessionActions {groups} group={node.project.group} onmove={onmove?(group)=>onmove!(node.project.id,group):undefined} name={node.project.name} archived={node.project.archived} running={node.project.status === 'running'} disabled={busy} onaction={action => onaction(node.project.id, action)} />
    </div>
    {#if outline && selectedId===node.project.id}<details class="inline-outline"><summary>Sections</summary>{@render outline()}</details>{/if}
    {#if node.children.length}
      <ul class="my-0 ml-4 flex min-w-0 list-none flex-col gap-0.5 border-l border-line py-0 pr-0 pl-2.5">
        {#each node.children as child (child.project.id)}{@render session(child, true)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<nav aria-label="Research projects">
  <ul class="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
    {#each roots as root (root.project.id)}{@render session(root)}{/each}
  </ul>
</nav>
{#if projects.some(project => project.archived)}
  <details class="mt-2" data-archived-sessions>
    <summary class="cursor-pointer px-2.5 py-2 text-xs text-muted">Archive <span class="count">{projects.filter(project => project.archived).length}</span></summary>
    <nav aria-label="Archived research projects"><ul class="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">{#each archived as root (root.project.id)}{@render session(root)}{/each}</ul></nav>
    {#if !archived.length}<p class="sidebar-empty">No matching archived sessions</p>{/if}
  </details>
{/if}
<UnavailableSessions projects={unavailableProjects} />
{#if !projects.length && !unavailableProjects.length}<p class="sidebar-empty">No sessions yet</p>
{:else if !roots.length && projects.some(project => !project.archived)}<p class="sidebar-empty">No matching sessions</p>{/if}
