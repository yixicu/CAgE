<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../Icon.svelte';
  import { feedbackOptions, localFeedbackKey, readLocalFeedback, saveLocalFeedback, type LocalVote } from './local-feedback';
  let { projectId, pageId, fingerprint, disabled = false }: { projectId: string; pageId: string; fingerprint: string; disabled?: boolean } = $props();
  let selected = $state<string[]>([]), vote = $state<LocalVote>(), error = $state(''), saved = $state(false);
  let key = $derived(localFeedbackKey(projectId, pageId));
  $effect(() => {
    const currentKey = key, currentFingerprint = fingerprint;
    untrack(() => {
      vote = undefined; selected = []; error = ''; saved = false;
      try { const record = readLocalFeedback(window.localStorage, currentKey, currentFingerprint); if (record) { vote = record.vote; selected = record.options; saved = true; } }
      catch { error = 'Browser storage is unavailable. Feedback cannot be saved here.'; }
    });
  });
  function save(value = vote) {
    if (disabled || !value) return;
    vote = value; saved = false; error = '';
    try { saveLocalFeedback(window.localStorage, key, fingerprint, value, selected); saved = true; }
    catch { error = 'Not saved. Browser storage is unavailable or full.'; }
  }
</script>
<section aria-label="Local response feedback" class="mt-3">
  <p class="text-xs text-muted">Local feedback; no agent learning. Saved on this browser only.</p>
  <div class="flex flex-wrap items-center gap-2">
    <button class="icon-button" class:chosen={vote === 'good'} aria-label="Good" aria-pressed={vote === 'good'} {disabled} onclick={() => save('good')}><Icon name="thumbsUp" size={16} /></button>
    <button class="icon-button" class:chosen={vote === 'bad'} aria-label="Bad" aria-pressed={vote === 'bad'} {disabled} onclick={() => save('bad')}><Icon name="thumbsDown" size={16} /></button>
    {#if saved}<span class="text-xs text-success" role="status">Saved on this browser</span>{/if}
  </div>
  <div class="flex flex-wrap gap-2 mt-3">{#each feedbackOptions as option}<button class="feedback-chip" class:chosen={selected.includes(option)} aria-pressed={selected.includes(option)} {disabled} onclick={() => { selected = selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option]; saved = false; }}>{option}</button>{/each}</div>
  <button class="mt-3" disabled={disabled || !vote} onclick={() => save()}>Save details</button>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
</section>
