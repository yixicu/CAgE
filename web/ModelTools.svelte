<script lang="ts">
  import type { ModelSelection } from '../src/engine/types';
  import type { Bootstrap } from './api';
  import Icon from './Icon.svelte';
  let { bootstrap, running = false, activeModel, disabled = false, onchange, onsettings }: { bootstrap: Bootstrap; running?: boolean; activeModel?: ModelSelection; disabled?: boolean; onchange: (model: ModelSelection) => Promise<void>; onsettings: () => void } = $props();
  let open = $state(false);
  let saving = $state(false);
  let error = $state('');
  let container = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();
  let value = $derived(bootstrap.preferences.defaultModel);
  let descriptor = $derived(bootstrap.models.find(model => model.provider === value?.provider && model.id === value?.modelId));
  let encoded = $derived(value ? JSON.stringify([value.provider, value.modelId]) : '');
  let overrides = $derived(Object.values(bootstrap.researchDefaults).some(config => Object.keys(config.roleModels || {}).length > 0));
  let pending = $derived(running && JSON.stringify(activeModel) !== JSON.stringify(value));
  const efforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
  async function save(model: ModelSelection) {
    saving = true; error = '';
    try { await onchange(model); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save model.'; }
    finally { saving = false; }
  }
  function choose(selection: string) {
    const model = bootstrap.models.find(item => JSON.stringify([item.provider, item.id]) === selection);
    if (model) void save({ provider: model.provider, modelId: model.id, thinkingLevel: model.reasoning ? 'medium' : 'off' });
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); open = false; trigger?.focus(); }
  }
</script>
<svelte:window onkeydown={keyboard} onpointerdown={event => { if (open && !container?.contains(event.target as Node)) open = false; }} />
<div class="model-tools" bind:this={container}>
  <button class="model-trigger" type="button" aria-label="Choose research model" aria-expanded={open} bind:this={trigger} disabled={disabled || saving} onclick={() => open = !open}>{descriptor?.name || value?.modelId || 'Choose model'}<Icon name="chevronDown" size={13} /></button>
  {#if value}<label class="effort-control"><span class="visually-hidden">Thinking effort</span><select aria-label="Quick thinking effort" value={value.thinkingLevel || 'off'} disabled={disabled || saving || !descriptor?.reasoning} onchange={event => void save({ ...value!, thinkingLevel: event.currentTarget.value as ModelSelection['thinkingLevel'] })}>{#each efforts as effort}<option value={effort}>{effort}</option>{/each}</select></label>{/if}
  {#if pending}<span class="next-start" title="The current run keeps its frozen model. This choice applies when you continue.">Next start</span>{/if}
  {#if open}<section class="model-menu" aria-label="Quick model selection">
    <label>Model<select aria-label="Quick model" value={encoded} disabled={disabled || saving} onchange={event => choose(event.currentTarget.value)}><option value="" disabled>Choose a model</option>{#if value && !descriptor}<option value={encoded} disabled>{value.modelId} (unavailable)</option>{/if}{#each bootstrap.models as model (`${model.provider}:${model.id}`)}<option value={JSON.stringify([model.provider, model.id])}>{model.provider} / {model.name || model.id}</option>{/each}</select></label>
    {#if !bootstrap.models.length}<p>Connect a provider to choose a model.</p>{/if}
    {#if running}<p>Applies on the next start. Active research keeps its model.</p>{/if}
    {#if overrides}<p>Role-specific models remain in effect.</p>{/if}
    <button type="button" class="text-button" onclick={() => { open = false; onsettings(); }}>Model settings</button>
  </section>{/if}
  {#if error}<p class="model-error" role="alert">{error}</p>{/if}
</div>
