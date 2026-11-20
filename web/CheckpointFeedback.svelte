<script lang="ts">
  import { untrack } from 'svelte';
  import type { EpochRecord } from '../src/research/contracts/v2';
  import type { FeedbackTarget } from './api';
  import Icon from './Icon.svelte';
  let { epoch, disabled, onsave }: { epoch: EpochRecord; disabled: boolean; onsave: (assessment: string, informationValue: number, target: FeedbackTarget) => Promise<void> } = $props();
  const options = ['Way selection good', 'Logic clear', 'Conditions complete', 'Needs another way', 'Logic gap', 'Missing conditions'];
  let selected = $state<string[]>([]), vote = $state<'good' | 'bad'>(), saving = $state(false), error = $state(''), saved = $state(false);
  let loadedEpoch = '';
  $effect(() => { const id = epoch.id; if (loadedEpoch === id) return; loadedEpoch = id; const review = untrack(() => epoch.userReview); selected = options.filter(item => review?.assessment.includes(item)); vote = review ? review.informationValue >= .5 ? 'good' : 'bad' : undefined; saved = false; error = ''; });
  async function submit(value = vote) {
    if (disabled || saving || !value) return;
    vote = value; saving = true; error = ''; saved = false;
    try { await onsave([value === 'good' ? 'Good' : 'Bad', ...selected].join(' · '), value === 'good' ? 1 : 0, {}); saved = true; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Assessment could not be saved.'; }
    finally { saving = false; }
  }
</script>
<section class="checkpoint-feedback" aria-label="Review checkpoint">
  <p class="text-xs text-muted mb-3">{epoch.research?.proofArchive?.status === 'saved' && epoch.research.proofArchive.ref ? 'Submitting feedback also requests a Moderator review of this archived proof using the configured model budget.' : 'Saves feedback only. No model is called; Moderator review requires an archived proof.'}</p>
  <div class="feedback-toolbar">
    <button class="icon-button" class:chosen={vote === 'good'} aria-label="Good" aria-pressed={vote === 'good'} title="Good" disabled={disabled || saving} onclick={() => submit('good')}><Icon name="thumbsUp" size={16} /></button>
    <button class="icon-button" class:chosen={vote === 'bad'} aria-label="Bad" aria-pressed={vote === 'bad'} title="Bad" disabled={disabled || saving} onclick={() => submit('bad')}><Icon name="thumbsDown" size={16} /></button>
    {#if saving}<span class="muted text-xs" role="status">Saving…</span>{:else if saved}<span class="text-success text-xs" role="status">Saved</span>{/if}
  </div>
  <div class="feedback-options"><div class="flex flex-wrap gap-2">{#each options as option}<button class="feedback-chip" class:chosen={selected.includes(option)} aria-pressed={selected.includes(option)} disabled={disabled || saving} onclick={() => { selected = selected.includes(option) ? selected.filter(item => item !== option) : [...selected,option]; saved = false; }}>{option}</button>{/each}</div>
    <button class="mt-3" disabled={disabled || saving || !vote} onclick={() => submit()}>Save details</button>
  </div>
  {#if error}<p class="notice error" role="alert">Not saved. {error}</p>{/if}
</section>
