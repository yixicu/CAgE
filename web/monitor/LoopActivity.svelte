<script lang="ts">
  import type { AnyResearchProject } from '../../src/research/contracts/loop';
  import type { LoopView } from './loop-view';
  import { researchProgress } from './research-progress';
  import MonitorButton from './MonitorButton.svelte';
  import Icon from '../Icon.svelte';
  let { project, view, hasOutput = false, number, onmonitor }: {
    project: AnyResearchProject; view: LoopView; hasOutput?: boolean; number?: number; onmonitor: () => void;
  } = $props();
  let progress = $derived(researchProgress(project, number ?? view.number));
  let current = $derived((number ?? view.number) === view.number);
  let scopeKey = $derived(`${project.id}:${project.schemaVersion}:${number ?? view.number}`);
  let open = $state(true), lastScope = '', hadOutput = false;
  $effect(() => {
    if (lastScope !== scopeKey) { lastScope = scopeKey; open = !hasOutput && !progress.saved; hadOutput = hasOutput; return; }
    if (hasOutput && !hadOutput) open = false;
    hadOutput = hasOutput;
  });
</script>
<section class="my-4 rounded-lg bg-tint/25 px-3 py-2 text-xs" aria-label={`${progress.scope} research progress`}>
  <div class="flex items-center gap-2">
    <button class="group flex min-h-7 min-w-0 flex-1 items-center justify-start gap-2 border-0 p-0 text-left text-xs hover:bg-transparent" type="button" aria-expanded={open} aria-label={`${progress.scope} · Research progress${current && view.live ? ` · ${view.current}` : ''}`} onclick={() => open = !open}>
      <span class="shrink-0 text-muted"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} /></span>
      <span class="min-w-0 text-muted">{progress.scope} · {!open && current && view.live ? view.current : `Research progress${!open && progress.milestones.length ? ` · ${progress.milestones.length}` : ''}`}</span>
    </button>
    <MonitorButton onclick={onmonitor} />
  </div>
  {#if open}
    <ol class="m-0 mt-2 list-none space-y-2 border-l border-line pl-3">
      {#each progress.milestones as milestone (milestone.id)}
        <li class="relative m-0 min-w-0" data-milestone-id={milestone.id}>
          <span class="absolute -left-3.75 top-1.5 h-1.25 w-1.25 rounded-full bg-line-strong" aria-hidden="true"></span>
          <details class="group/milestone min-w-0">
            <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden" title={milestone.text}>
              <span class="line-clamp-2 wrap-anywhere text-xs leading-relaxed group-open/milestone:line-clamp-none"><span class="mr-1.5 text-muted">{milestone.label}</span><span class="text-ink">{milestone.text}</span></span>
            </summary>
            {#if milestone.detail}<p class="m-0 mt-1 whitespace-pre-line wrap-anywhere text-xs leading-relaxed text-muted">{milestone.detail}</p>{/if}
          </details>
        </li>
      {/each}
    </ol>
    {#if current && !progress.saved && (view.live || !hasOutput)}
      <p class="m-0 mt-2 flex items-start gap-2 rounded-control bg-accent/5 px-2 py-1.5 text-xs leading-relaxed" class:text-accent={view.live} class:text-muted={!view.live} role="status" aria-live="polite">
        <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" class:bg-accent={view.live} class:bg-muted={!view.live} aria-hidden="true"></span>
        <span>{view.stale ? 'Connection unavailable · showing last reported progress' : view.current}{view.control ? ` · ${view.control}` : ''}</span>
      </p>
    {:else if !progress.milestones.length}<p class="m-0 mt-2 text-xs text-muted">No saved milestones for this {view.boundary.toLowerCase()}.</p>{/if}
  {/if}
</section>
