<script lang="ts">
  import type { UserCommand } from '../../src/engine/types';
  import type { AnyResearchProject } from '../../src/research/contracts/loop';
  import type { MonitorActivitySnapshot } from '../../src/server/monitor-activity';
  import Icon from '../Icon.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import { modifiedHypothesisHistory, type ModifiedHypothesisStatus } from './modified-history';

  let { project, commandHistory, activity, connected }: {
    project: AnyResearchProject;
    commandHistory: readonly UserCommand[];
    activity?: MonitorActivitySnapshot;
    connected: boolean;
  } = $props();
  let entries = $derived(modifiedHypothesisHistory(project, commandHistory, { activity, connected }));
  // Native details owns disclosure. Only user toggles mount full Markdown; data updates never open or focus it.
  let expanded = $state<Record<string, boolean>>({});
  let disclosure = $state<HTMLDetailsElement>();
  let trigger = $state<HTMLElement>();
  export function reveal() {
    if (disclosure) disclosure.open = true;
    trigger?.focus({ preventScroll: true });
    const pane = disclosure?.closest('aside');
    if (pane && disclosure) pane.scrollTo({ top: Math.max(0, pane.scrollTop + disclosure.getBoundingClientRect().top - pane.getBoundingClientRect().top - 56), behavior: 'auto' });
  }
  const statusClasses: Record<ModifiedHypothesisStatus, string> = {
    'in progress': 'bg-info-soft text-info',
    'in queue': 'bg-warning-soft text-warning',
    history: 'bg-idle-soft text-muted',
  };
  const statusDescriptions: Record<ModifiedHypothesisStatus, string> = {
    'in progress': 'Included in the current Theorist planning batch.',
    'in queue': 'Waiting for Theorist planning; no live planning is confirmed for this modification.',
    history: 'Previously processed command, no longer awaiting planning. This does not indicate a research outcome.',
  };
  const timeFormat = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function shortTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : timeFormat.format(date);
  }
</script>

<details bind:this={disclosure} class="group/modified-history my-0 min-w-0 rounded-lg border border-line bg-surface" aria-label="Modified hypothesis">
  <summary bind:this={trigger} class="flex min-h-8 min-w-0 list-none items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-ink [&::-webkit-details-marker]:hidden">
    <span class="-rotate-90 text-muted group-open/modified-history:rotate-0"><Icon name="chevronDown" size={14} /></span>
    <span class="min-w-0">Modified hypothesis</span>
    {#if project.userInputWarnings?.length}<span class="ml-auto text-warning" title={project.userInputWarnings.join('\n')} aria-label="Some saved inputs need review">!</span>{/if}
    <span class="ml-auto text-micro font-normal tabular-nums text-muted" aria-label={`${entries.length} modifications`}>{entries.length}</span>
  </summary>
  {#if project.userInputWarnings?.length}<div class="px-2 pb-2 text-xs text-warning" role="status">{#each project.userInputWarnings as warning}<p class="m-0! mb-1!">{warning}</p>{/each}</div>{/if}
  {#if entries.length}
    <ol class="m-0! list-none space-y-2 px-2 pb-2" aria-label="Modifications, oldest first">
      {#each entries as entry, index (entry.id)}
        <li class="m-0 min-w-0">
          <details class="group/modification my-0 min-w-0 rounded-control border border-line bg-canvas" data-modification-id={entry.id} ontoggle={event => expanded[entry.id] = event.currentTarget.open}>
            <summary class="min-w-0 list-none p-2 text-xs text-ink [&::-webkit-details-marker]:hidden" title={`#${index + 1} · ${entry.createdAt}`}>
              <span class="line-clamp-2 wrap-anywhere whitespace-pre-wrap leading-relaxed group-open/modification:hidden"><span class={`mr-1.5 inline-block rounded-full px-1.5 py-0.5 align-baseline text-micro font-medium leading-none ${statusClasses[entry.status]}`} title={entry.detail ?? statusDescriptions[entry.status]}>{entry.status}</span>{entry.content}</span>
              <span class="hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 group-open/modification:flex">
                <span class={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium leading-tight ${statusClasses[entry.status]}`} title={entry.detail ?? statusDescriptions[entry.status]}>{entry.status}</span>
                <span class="text-micro tabular-nums text-muted">#{index + 1}</span>
                <time class="text-micro tabular-nums text-muted" datetime={entry.createdAt}>{shortTime(entry.createdAt)}</time>
                <span class="ml-auto text-muted"><Icon name="chevronDown" size={12} /></span>
              </span>
            </summary>
            {#if expanded[entry.id]}
              <div class="m-0! min-w-0 border-t border-line px-2 py-2 [&_.markdown-view]:text-xs [&_.markdown-view]:leading-relaxed [&_.markdown-view_p]:text-xs [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
                {#if entry.detail}<p class="m-0! mb-2! text-micro text-muted">{entry.detail}</p>{/if}
                <MarkdownView content={entry.content} />
              </div>
            {/if}
          </details>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="m-0! px-3 pb-3 text-xs text-muted">No modifications yet.</p>
  {/if}
</details>
