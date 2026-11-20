<script lang="ts">
  import type { ModelSelection } from '../src/engine/types';
  import type { Bootstrap } from './api';
  import EffortPicker from './EffortPicker.svelte';
  import Icon from './Icon.svelte';
  let { bootstrap, mode="4.0", maintenance=false, running = false, activeModel, disabled = false, onchange, onsettings }: { bootstrap: Bootstrap; mode?:keyof Bootstrap['researchDefaults']; maintenance?:boolean; running?: boolean; activeModel?: ModelSelection; disabled?: boolean; onchange: (model: ModelSelection,role?:'theorist'|'moderator') => Promise<void>; onsettings: () => void } = $props();
  let open = $state(false);
  let saving = $state(false);
  let error = $state('');
  let container = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();
  let value = $derived(bootstrap.preferences.defaultModel);
  async function save(model: ModelSelection,role:'theorist'|'moderator') {
    saving = true; error = '';
    try { await onchange(model,role); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save model.'; }
    finally { saving = false; }
  }
  function choose(selection: string,role:'theorist'|'moderator') {
    const model = bootstrap.models.find(item => JSON.stringify([item.provider, item.id]) === selection);
    if (model) void save({ provider: model.provider, modelId: model.id, thinkingLevel: model.reasoning ? 'medium' : 'off' },role);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); open = false; trigger?.focus(); }
  }
</script>
<svelte:window onkeydown={keyboard} onpointerdown={event => { if (open && !container?.contains(event.target as Node)) open = false; }} />
<div class="model-tools" bind:this={container}>
  <button class="model-trigger" type="button" aria-label={maintenance?"Choose maintenance model":"Choose research model"} aria-expanded={open} bind:this={trigger} disabled={disabled || saving} onclick={() => open = !open}>Model<Icon name="chevronDown" size={13} /></button>
  {#if open}<section class="model-menu" aria-label="Agent models">
    {#each (maintenance||mode!=='4.0'?['theorist'] as const:['theorist','moderator'] as const) as role}
      {@const selected=maintenance?(bootstrap.preferences.maintenanceModel??value):bootstrap.researchDefaults[mode].roleModels?.[role]??value}
      <label>{maintenance?'Maintenance Assistant':role==='theorist'?'Theorist':'Moderator'}<select aria-label={maintenance?'Maintenance model':role} value={selected?JSON.stringify([selected.provider,selected.modelId]):''} disabled={disabled||saving||!bootstrap.models.length} onchange={e=>choose(e.currentTarget.value,role)}><option disabled value="">Choose model</option>{#if selected&&!bootstrap.models.some(m=>m.provider===selected.provider&&m.id===selected.modelId)}<option disabled value={JSON.stringify([selected.provider,selected.modelId])}>{selected.modelId} (offline)</option>{/if}{#each bootstrap.models as m}<option value={JSON.stringify([m.provider,m.id])}>{m.provider} / {m.name||m.id}</option>{/each}</select></label>
      {#if selected && bootstrap.models.some(m=>m.provider===selected.provider && m.id===selected.modelId && m.reasoning)}
        <fieldset disabled={saving || disabled}><EffortPicker value={selected} onchange={m=>void save(m,role)}/></fieldset>
      {/if}
    {/each}
    <button type="button" class="text-button" onclick={() => { open = false; onsettings(); }}>Model settings</button>
  </section>{/if}
  {#if error}<p class="model-error" role="alert">{error}</p>{/if}
</div>
