<script lang="ts">
  import { untrack } from 'svelte';
  import type { ResearchRole } from '../src/engine/types';
  import type { DomainBelief } from '../src/research/contracts/v2';
  import type { ResearchConfig } from './api';
  import type { ModelDescriptor } from './api';
  import ModelPicker from './ModelPicker.svelte';
  import BudgetFields from './BudgetFields.svelte';
  let { config, models, running, onsave, domains = [], version }: {
    config: ResearchConfig; version?: '0' | '1.0' | '2.0' | '2.1' | '3.0' | '4.0'; domains?: DomainBelief[]; models: ModelDescriptor[]; running: boolean; onsave: (config: ResearchConfig) => Promise<void>;
  } = $props();
  let draft = $state<ResearchConfig>(untrack(() => ({...JSON.parse(JSON.stringify(config)),...(version==='3.0'&&'maxEpochs'in config?{budgetControlEnabled:config.budgetControlEnabled??true}:{})})));
  const budgetsOff = $derived(version === '3.0' && 'budgetControlEnabled' in draft && draft.budgetControlEnabled === false);
  let saving = $state(false);
  let error = $state('');
  const roles: ResearchRole[] = ['theorist', 'worker', 'literature'];
  async function save(event: SubmitEvent) {
    event.preventDefault(); saving = true; error = '';
    try { await onsave(JSON.parse(JSON.stringify(draft))); } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save settings.'; } finally { saving = false; }
  }
</script>
<section class="settings-panel">
  <h2>Research settings</h2>
  {#if running}<p class="notice">Research is active. Settings can be saved after the current run pauses or stops.</p>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  <form onsubmit={save}>
    <fieldset disabled={running || saving} class="flat-fieldset">
      {#if version !== '4.0'}<details><summary>Per-role model overrides</summary>
        {#each (version === '0' ? roles.filter(role => role === 'theorist') : (version === '2.1' || version === '3.0') ? roles.filter(role => role !== 'literature') : roles) as role}
          <ModelPicker label={role} value={draft.roleModels?.[role]} {models} inherit onchange={value => { draft.roleModels ??= {}; if (value) draft.roleModels[role] = value; else delete draft.roleModels[role]; }} />
        {/each}
      </details>{/if}
      {#if version === '3.0' && 'maxEpochs' in draft}
        <label><input type="checkbox" bind:checked={draft.budgetControlEnabled} /> Enable call, tool and time budgets</label>
        <p class="muted small">Default ON. OFF retains thresholds but disables these quotas and time advisories for new boundaries. STOP, provider capacity and separate token/cost ceilings still apply.</p>
      {/if}
      <div class="settings-grid">
        {#if version !== '0'}<label>Maximum parallel Workers<input type="number" min="1" max={'maxEpochs' in draft ? 3 : 20} required bind:value={draft.maxWorkers} /></label>{/if}
        {#if 'maxEpochs' in draft}<label>Maximum Epochs<input type="number" min="1" max="1000" required disabled={budgetsOff} bind:value={draft.maxEpochs} /></label>{:else}<label>Maximum rounds<input type="number" min="1" max="1000" required bind:value={draft.maxRounds} /></label>
        <label>Maximum branches<input type="number" min="1" max="10000" required bind:value={draft.maxBranches} /></label>{/if}
      </div>
      {#if 'maxEpochs' in draft}
        <h3>Time target</h3>
        <p class="muted small">Requests wrap-up; running work is not interrupted. Separate token/cost ceilings remain independent.</p>
        <div class="settings-grid">
          <label>Run soft time target (ms)<input type="number" min="1" required disabled={budgetsOff} bind:value={draft.epochBudget.timeoutMs} /></label>
        </div>
        {#if version === '3.0'}
          <label>Model tasks per Epoch<input type="number" min="1" max="100" required disabled={budgetsOff} bind:value={draft.epochBudget.maxTasks} /></label>
          <label>Epoch token ceiling<input type="number" min="0" required bind:value={draft.epochBudget.maxTokens} /></label>
          <label>Epoch cost ceiling USD<input type="number" min="0" step="0.01" required bind:value={draft.epochBudget.maxCostUsd} /></label>
          <BudgetFields label="Theorist / learning" controls disabled={budgetsOff} bind:budget={draft.roleBudget} />
          <BudgetFields label="Shallow Worker" controls disabled={budgetsOff} bind:budget={draft.workerBudgets.shallow} />
          <BudgetFields label="Deep Worker" controls disabled={budgetsOff} bind:budget={draft.workerBudgets.deep} />
        {/if}
        {#if version !== '0' && domains.length}<h3>Domain allocation</h3>
        <p class="muted small">Multipliers affect allocation in the next Epoch, not scientific evidence or global beliefs. 1 keeps the default; 0 reduces this domain's allocation.</p>
        {#each domains as domain (domain.id)}
          <label>{domain.label} multiplier<input type="number" min="0" max="10" step="0.1" value={draft.userDomainPreferences[domain.id] ?? 1} onchange={event => { if ('userDomainPreferences' in draft) draft.userDomainPreferences[domain.id] = Number(event.currentTarget.value); }} /></label>
        {/each}{/if}
      {/if}
      <div class="switches">

        {#if version !== '0' && version !== '2.1' && version !== '3.0' && version !== '4.0'}<label><input type="checkbox" bind:checked={draft.literatureEnabled} /> Enable Literature Researcher (local sources)</label>{/if}
      </div>

      {#if !('maxEpochs' in draft)}<BudgetFields label="Run soft time target" bind:budget={draft.roleBudget} />{/if}
      <button class="primary" type="submit">{saving ? 'Saving…' : 'Save settings'}</button>
    </fieldset>
  </form>
</section>
