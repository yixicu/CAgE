<script lang="ts">
  import type { ResearchProject } from '../api';
  import type { CheckpointPage } from '../checkpoint-view';
  import { browserExportHost, saveResponse, type DisplayedOriginal } from './export-response';
  import { defaultHandoffTask, projectHandoff } from './project-handoff';

  let { project, page, original, disabled = false }: { project: ResearchProject; page?: CheckpointPage; original?: DisplayedOriginal; disabled?: boolean } = $props();
  let task = $state(defaultHandoffTask);
  let pending = $state(false), notice = $state(''), error = $state(''), exportFailed = $state(false);
  const unavailable = $derived(disabled || (!!original && original.content === undefined));
  const selection = $derived(`${project.id}:${page?.id ?? ''}:${original?.key ?? ''}`);
  $effect(() => { selection; notice = ''; error = ''; exportFailed = false; });

  async function handoff(action: 'copy' | 'save', downloadOnly = false) {
    if (pending || unavailable) return;
    const identity = selection;
    const snapshot = projectHandoff(project, page, original, task);
    pending = true; notice = ''; error = ''; exportFailed = false;
    try {
      let message: string;
      if (action === 'copy') {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Export the handoff instead.');
        await navigator.clipboard.writeText(snapshot.content);
        message = 'Handoff copied. Paste it into the receiving assistant’s conversation.';
      } else {
        const host = browserExportHost();
        if (downloadOnly) delete host.pick;
        const result = await saveResponse(snapshot, host);
        message = result === 'saved' ? 'Handoff saved as Markdown.' : result === 'download-started' ? 'Handoff download started. Your browser controls the save location.' : '';
      }
      if (selection === identity) notice = message;
    } catch (cause) {
      if (selection === identity) { error = cause instanceof Error ? cause.message : 'Handoff was not completed. Try again.'; exportFailed = action === 'save'; }
    } finally { pending = false; }
  }
</script>

<section class="font-ui" aria-label="Project export and handoff">
  <p class="text-sm text-muted my-2">Includes current project context and {original?.label ?? page?.label ?? 'no saved response'}. Other responses and source files are not attached.</p>
  <label class="block text-sm" for="handoff-task">Task for the receiving assistant</label>
  <textarea id="handoff-task" class="w-full my-2" rows="3" bind:value={task}></textarea>
  <div class="flex flex-wrap gap-2" aria-busy={pending}>
    <button type="button" class="min-h-11" disabled={unavailable || pending} onclick={() => handoff('copy')}>Copy handoff</button>
    <button type="button" class="min-h-11" disabled={unavailable || pending} onclick={() => handoff('save')}>Export handoff Markdown</button>
    {#if exportFailed}<button type="button" class="min-h-11" disabled={unavailable || pending} onclick={() => handoff('save', true)}>Download instead</button>{/if}
  </div>
  {#if unavailable}<p class="text-sm text-muted mt-2" role="status">Waiting for the project and selected original to be available. If loading failed, retry or select another saved response.</p>{/if}
  {#if pending || notice}<p class="text-sm mt-2" role="status">{pending ? 'Preparing handoff…' : notice}</p>{/if}
  {#if error}<p class="text-sm mt-2" role="alert">{error}</p>{/if}
</section>
