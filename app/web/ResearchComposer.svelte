<script lang="ts">
  import type { Bootstrap, ResearchProject } from './api';
  import type { ModelSelection } from '../src/engine/types';
  import Icon from './Icon.svelte';
  import ModelTools from './AgentModelMenu.svelte';
  import ResearchModeSelect from './ResearchModeSelect.svelte';
  import { DEFAULT_RESEARCH_MODE, researchModes, researchModeLocked, type ResearchMode } from './research-mode';
  import { developerMode } from './developer-mode';
  import { currentResearchNumber } from './research-scope';
  import { isResearchModelReady } from './composer-state';
  let { draftMode, onmode, project, bootstrap, active, busy, connected, hypothesis = $bindable(''), refinement = $bindable(''), projectName = $bindable(''), stagedFiles = [], onremovefile, onretryfiles, queuedCount = 0, onqueuehistory, modelReady, recoveryPending = false, onsubmit, onstart, onattach, onmodel, onsettings }: {
    draftMode: ResearchMode; onmode: (mode: ResearchMode) => Promise<void>;
    project?: ResearchProject; bootstrap?: Bootstrap; active: boolean; busy: boolean; connected: boolean;
    hypothesis?: string; refinement?: string; projectName?: string;
    stagedFiles?: File[]; onremovefile?: (index: number) => void; onretryfiles?: () => void;
    queuedCount?: number; onqueuehistory?: () => void; modelReady?: boolean; recoveryPending?: boolean;
    onsubmit: (event: SubmitEvent) => void; onstart: () => void; onattach: () => void;
    onmodel: (model: ModelSelection,role?:'theorist'|'moderator') => Promise<void>; onsettings: () => void;
  } = $props();
  let chosen = $derived(active ? project?.config.defaultModel : bootstrap?.preferences.defaultModel);
  let ready = $derived(modelReady ?? isResearchModelReady(bootstrap, chosen));
  let modeEnabled = $derived($developerMode || !project || !researchModeLocked(project) || (project.schemaVersion === 3 && ['3.0','4.0'].includes(project.researchLoopVersion)));
  let number = $derived(currentResearchNumber(project));
  let input = $state<HTMLTextAreaElement>();
  export function focusInput(moveCursorToEnd = false) {
    input?.focus({ preventScroll: true });
    if (input && moveCursorToEnd) input.setSelectionRange(input.value.length, input.value.length);
  }
</script>
<div class="composer-dock" class:home-composer={!project}>
  <form class={`composer border-line/70 bg-surface/95 shadow-none focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/10 ${project ? 'px-5 min-[901px]:px-7' : ''}`} onsubmit={onsubmit}>
    {#if !project}<input class="project-name-input" aria-label="Project name" bind:value={projectName} placeholder="Session title (optional)" maxlength="120" />{/if}
    {#if stagedFiles.length}
      <ul class="m-0 mb-2 flex list-none flex-wrap gap-2 p-0" aria-label="Staged source files">
        {#each stagedFiles as file, index}
          <li class="flex min-w-0 max-w-full items-center gap-1 rounded-control border border-line bg-hover px-2 py-1 text-xs text-ink">
            <Icon name="file" size={14} /><span class="min-w-0 truncate" title={file.name}>{file.name}</span>
            <button class="icon-button h-5 min-h-5 w-5 shrink-0 p-0.5" type="button" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} disabled={busy || !onremovefile} onclick={() => onremovefile?.(index)}><Icon name="close" size={13} /></button>
          </li>
        {/each}
        {#if project}<li class="m-0 flex items-center"><button class="text-button whitespace-nowrap text-xs" type="button" title="Retry saving attachments without starting research" disabled={busy || active || !onretryfiles} onclick={onretryfiles}>Retry attachments</button></li>{/if}
      </ul>
    {/if}
    <div class="flex min-w-0 items-start gap-2">
      {#if project && queuedCount > 0}
        <button class="mt-0.75 min-h-0 shrink-0 rounded-small border border-accent/60 bg-accent/10 px-2 py-0.5 text-sm font-normal leading-5 text-accent hover:bg-accent/5 max-[600px]:text-control" type="button" aria-label={`View ${queuedCount} queued submission${queuedCount === 1 ? '' : 's'}`} title="View submitted inputs waiting for planning" onclick={onqueuehistory}>{queuedCount === 1 ? 'Queue' : `Queue: ${queuedCount}`}</button>
      {/if}
      <textarea class={`min-w-0 flex-1 ${project ? 'text-sm max-[600px]:text-control' : ''}`} bind:this={input} aria-label={project?.researchLoopVersion === '4.0' ? 'Discuss or revise the proposition' : project ? 'Modify hypothesis' : 'Research hypothesis'} aria-describedby={project ? 'hypothesis-modification-hint' : undefined} value={project ? refinement : hypothesis} oninput={event => { if (project) refinement = event.currentTarget.value; else hypothesis = event.currentTarget.value; }} rows="2" placeholder={project?.researchLoopVersion === '4.0' ? 'Continue the argument, challenge a result, or revise the proposition…' : project ? 'Modify hypothesis…' : 'State your hypothesis…'} onkeydown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}></textarea>
    </div>
    {#if project}<span id="hypothesis-modification-hint" class="visually-hidden">Edit the hypothesis or describe a change for the Theorist. Your submission waits for planning at the next safe {project.schemaVersion === 1 ? 'round' : 'Epoch'} boundary; it does not immediately replace the current hypothesis. When idle, use Start or Continue to begin planning.</span>{/if}
    <div class="composer-toolbar border-line/50"><div class="inline-actions flex-wrap">
      <button class="icon-button" type="button" aria-label="Attach sources" title="Attach Markdown, text, or PDF sources" disabled={active || busy} onclick={onattach}><Icon name="plus" /></button>
      {#if $developerMode && (!project || !researchModeLocked(project))}
        <ResearchModeSelect value={researchModes.find(mode => mode.version === project?.researchLoopVersion)?.version ?? draftMode} disabled={busy} onchange={onmode}/>
      {:else}<span class="loop-badge">V{project && researchModeLocked(project)?project.researchLoopVersion:DEFAULT_RESEARCH_MODE}</span>{/if}
      {#if bootstrap}<ModelTools {bootstrap} mode={researchModes.find(m=>m.version===project?.researchLoopVersion)?.version??($developerMode?draftMode:DEFAULT_RESEARCH_MODE)} running={active} activeModel={project?.config.defaultModel} disabled={busy} onchange={onmodel} {onsettings} />{/if}
    </div><div class="inline-actions">
      {#if !active && project && (!refinement.trim() || recoveryPending)}
        {#if !modeEnabled}<span class="text-xs text-muted" title="Enable developer mode in Settings → Research">Developer mode required</span>
        {:else if recoveryPending}<button class="rounded-control border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs text-accent" type="button" aria-label="Recover saved research" title="Check and reconcile saved work without calling a model. Continue is a separate action." disabled={busy || !connected} onclick={onstart}>Recover</button>
        {:else if bootstrap && !ready}<button class="text-button whitespace-nowrap text-xs" type="button" disabled={busy} onclick={onsettings}>Connect model</button>
        {:else}<button class="send-button h-9 w-9 min-h-9 rounded-full p-2 [&_svg]:h-4 [&_svg]:w-4" type="button" aria-label={number ? 'Continue research' : 'Start research'} title={number ? 'Continue from the latest saved state' : 'Start research'} disabled={busy || !ready || !connected} onclick={onstart}><Icon name="play" size={18} /></button>{/if}
      {/if}
      {#if !project && bootstrap && !ready}
        <button class="send-button h-9 min-h-9 w-auto rounded-control px-3 text-xs whitespace-nowrap" type="submit" title="Save hypothesis and sources without starting research (Ctrl / ⌘ Enter)" disabled={busy || !connected || !hypothesis.trim()}>Save draft</button>
      {:else if !project || refinement.trim()}<button class="send-button h-9 w-9 min-h-9 rounded-full p-2 [&_svg]:h-4 [&_svg]:w-4" type="submit" aria-label={project?.researchLoopVersion === '4.0' ? 'Queue discussion turn' : project ? 'Queue hypothesis modification' : 'Start new research'} title={project ? 'Queue for the Theorist (Ctrl / ⌘ Enter)' : 'Send (Ctrl / ⌘ Enter)'} disabled={busy || !connected || !bootstrap || !(project ? refinement.trim() : hypothesis.trim())}><Icon name="arrow" size={19} /></button>{/if}
    </div></div>
  </form>
</div>
