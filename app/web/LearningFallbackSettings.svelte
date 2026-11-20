<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type AppPreferences, type ModelDescriptor } from './api';
  import type { ModelSelection } from '../src/engine/types';
  import ModelPicker from './ModelPicker.svelte';
  let { preferences, models, onchange }: { preferences: AppPreferences; models: ModelDescriptor[]; onchange: () => Promise<void> } = $props();
  let choices = $state<(ModelSelection | undefined)[]>(untrack(() => (preferences.learningFallbackModels ?? []).map(choice => ({ ...choice }))));
  let dirty = $state(false), busy = $state(false), error = $state(''), saved = $state(false);
  $effect(() => { if (!dirty) choices = (preferences.learningFallbackModels ?? []).map(choice => ({ ...choice })); });
  let invalid = $derived(choices.some(choice => !choice || !models.some(model => model.provider === choice.provider && model.id === choice.modelId))
    || new Set(choices.map(choice => choice && JSON.stringify([choice.provider, choice.modelId]))).size !== choices.length);
  function change(next: typeof choices) { choices = next; dirty = true; saved = false; }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (invalid) return;
    busy = true; error = ''; saved = false;
    try { await api.preferences({ ...preferences, learningFallbackModels: choices as ModelSelection[] }); await onchange(); dirty = false; saved = true; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save fallback models.'; }
    finally { busy = false; }
  }
</script>
<details>
  <summary>Learning fallback models</summary>
  <form onsubmit={save} class="space-y-3">
    <p class="muted small">Authorize these models, in order, for background learning within the remaining task budget.</p>
    <fieldset class="flat-fieldset space-y-3" disabled={busy}>
      {#each choices as choice, index (index)}
        <div class="space-y-2">
          <ModelPicker label={`Fallback ${index + 1}`} value={choice} {models} onchange={value => change(choices.map((item, at) => at === index ? value : item))} />
          <div class="inline-actions">
            <button type="button" aria-label={`Move fallback ${index + 1} up`} disabled={index === 0} onclick={() => { const next = [...choices]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next); }}>↑</button>
            <button type="button" aria-label={`Move fallback ${index + 1} down`} disabled={index === choices.length - 1} onclick={() => { const next = [...choices]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; change(next); }}>↓</button>
            <button type="button" aria-label={`Remove fallback ${index + 1}`} onclick={() => change(choices.filter((_, at) => at !== index))}>Remove</button>
          </div>
        </div>
      {/each}
      <div class="inline-actions">
        <button type="button" disabled={choices.length >= models.length || !models.length} onclick={() => change([...choices, undefined])}>Add model</button>
        <button type="submit" class="primary" disabled={!dirty || invalid}>Save fallback order</button>
      </div>
    </fieldset>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    {#if saved}<p class="muted small" role="status">Fallback order saved.</p>{/if}
  </form>
</details>
