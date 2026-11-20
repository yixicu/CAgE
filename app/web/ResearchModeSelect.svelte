<script lang="ts">
  import { tick } from 'svelte';
  import { researchModes, type ResearchMode } from './research-mode';
  import { developerMode } from './developer-mode';
  let { value, disabled = false, locked = false, onchange }: {
    value: ResearchMode | '4.0'; disabled?: boolean; locked?: boolean; onchange: (value: ResearchMode) => void | Promise<void>;
  } = $props();
  async function choose(event: Event) {
    const input = event.currentTarget as HTMLSelectElement;
    try { await onchange(input.value as ResearchMode); }
    finally { await tick(); input.value = value; }
  }
</script>

<select class="inline-select w-auto shrink-0" aria-label="Research mode" value={value} disabled={disabled || locked} title={locked ? 'Mode is fixed after the first start.' : 'Choose a research mode before starting.'} onchange={choose}>
  {#each researchModes.filter(mode => $developerMode || mode.version === '4.0' || mode.version === value) as mode}<option value={mode.version} disabled={!$developerMode && mode.version !== '4.0'}>{mode.label}</option>{/each}
</select>
