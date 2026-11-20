<script lang="ts">
  import type { ModelSelection } from '../src/engine/types';
  import type { ModelDescriptor } from './api';
  let { label, value, models, inherit = false, onchange }: {
    label: string; value?: ModelSelection; models: ModelDescriptor[]; inherit?: boolean; onchange: (value: ModelSelection | undefined) => void;
  } = $props();
  import EffortPicker from './EffortPicker.svelte';
  let selected = $derived(value ? JSON.stringify([value.provider, value.modelId]) : '');
  function select(encoded: string) {
    if (!encoded) { onchange(undefined); return; }
    const model = models.find(item => JSON.stringify([item.provider, item.id]) === encoded);
    if (model) onchange({ provider: model.provider, modelId: model.id, thinkingLevel: model.reasoning ? 'medium' : 'off' });
  }
</script>
<div class="model-picker">
  <label>{label}
    <select aria-label={label} value={selected} onchange={event => select(event.currentTarget.value)}>
      <option value="">{inherit ? 'Inherit global model' : 'Select a model'}</option>
      {#if value && !models.some(item => item.provider === value.provider && item.id === value.modelId)}
        <option value={selected} disabled>{value.provider} / {value.modelId} (unavailable — reconnect provider)</option>
      {/if}
      {#each models as model (`${model.provider}:${model.id}`)}
        <option value={JSON.stringify([model.provider, model.id])}>{model.provider} / {model.name || model.id}</option>
      {/each}
    </select>
  </label>

  {#if value && models.some(m=>m.provider===value?.provider && m.id===value.modelId && m.reasoning)}
    <EffortPicker {value} {onchange}/>
  {/if}
  {#if !models.length}<p class="muted small">Connect a provider to see its models.</p>{/if}
</div>
