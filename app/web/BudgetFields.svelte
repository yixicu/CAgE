<script lang="ts">
  import type { RoleBudget } from '../src/engine/types';
  let { budget = $bindable(), label, disabled = false, controls = false }: { disabled?: boolean; controls?: boolean; budget: RoleBudget; label: string; minTurns?: number } = $props();
</script>
<fieldset class="budget-fields">
  <legend>{label}</legend>
  {#if controls}
  <label>Model calls<input type="number" min="1" max="1000" required {disabled} bind:value={budget.maxTurns} /></label>
  <label>Tool calls<input type="number" min="0" max="10000" required {disabled} bind:value={budget.maxToolCalls} /></label>
  {/if}
  <label>Soft time target (ms)<input type="number" min="1000" max="86400000" step="1000" required {disabled} bind:value={budget.timeoutMs} /></label>
{#if controls}
  <label>Token ceiling (separate)<input type="number" min="0" bind:value={budget.maxTokens} /></label>
  <label>Cost ceiling USD (separate)<input type="number" min="0" step="0.01" bind:value={budget.maxCostUsd} /></label>
  {/if}
</fieldset>
