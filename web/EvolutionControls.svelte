<script lang="ts">
  import { onMount } from 'svelte';
  import type { ResearchProjectV2, GlobalEvolutionState, EvolutionPublication } from '../src/research/contracts/v2';
  import { api, type EvolutionCaseView, type EvolutionRequest, type EvolutionOperationView } from './api';
  import { approvedVersions, selectedCases, evolutionScope, availableScopeDomains, rememberOperation, rememberedOperation, forgetOperation, checkRememberedOperation, type CaseSelection } from './evolution-view';
  let { project, disabled, onbusy = () => {} }: { project: ResearchProjectV2; disabled: boolean; onbusy?: (busy: boolean) => void } = $props();
  let globalState = $state<GlobalEvolutionState>();
  let cases = $state<EvolutionCaseView[]>([]);
  let selection = $state<CaseSelection>({});
  let target = $state<EvolutionRequest['target']>('policy');
  let action = $state<EvolutionRequest['action']>('review');
  let rollbackVersion = $state('');
  let scopeKind = $state<'project' | 'global' | 'domain'>('project');
  let scopeDomain = $state('');
  let scopeDomains = $derived(availableScopeDomains(project));
  let scope = $derived(evolutionScope(scopeKind, project.id, scopeDomains.includes(scopeDomain) ? scopeDomain : ''));
  let loading = $state(false);
  let submitting = $state(false);
  let error = $state('');
  let operationId = $state<string>();
  let outcome = $state<EvolutionOperationView>();
  let latest = $state<EvolutionPublication>();
  let chosen = $derived(selectedCases(cases, selection, target));
  let rollbackVersions = $derived(approvedVersions(globalState, target));
  let eligible = $derived(cases.filter(item => (target === 'policy' ? item.reviewedPolicyTraceCount + (item.reviewedAuditCount || 0) : item.reviewedWaySkillTraceCount) > 0));
  let model = $derived(project.config.roleModels?.[target === 'policy' ? 'moderator' : 'theorist'] || project.config.defaultModel);
  let reason = $derived(!globalState ? 'Load learning records first.' : disabled || project.phase !== 'idle' ? 'Pause research before requesting review.' : !project.epochs.some(epoch => epoch.completedAt) ? 'Complete an Epoch in this project first.' : target === 'policy' && !project.config.moderatorEnabled ? 'Enable Moderator in project settings for policy review.' : !model ? 'Choose the reviewing role’s model in project settings.' : chosen.trainingIds.length < 2 || chosen.heldOutCaseIds.length < 1 ? 'Select at least two reviewed training projects and one independent held-out project.' : action === 'review' && chosen.heldOutCaseIds.includes(project.id) ? 'The current proposal project cannot be held out.' : !scope.trim() ? 'Select an available domain for this review.' : action === 'rollback' && !rollbackVersions.includes(rollbackVersion) ? 'Select a previously approved version.' : '');
  async function checkOutcome() {
    const result = await checkRememberedOperation(project.id, api.evolutionOperation);
    if (result) { outcome = result; if (result.state) globalState = result.state; if (result.publication) latest = result.publication; }
  }
  async function load() {
    if (loading || submitting) return;
    loading = true; error = '';
    try { const [history, reviewed] = await Promise.all([api.evolution(), api.evolutionCases()]); globalState = history; cases = reviewed; operationId = rememberedOperation(project.id); if (operationId) await checkOutcome(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load learning records.'; }
    finally { loading = false; }
  }
  onMount(() => { void load(); });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (reason || submitting || loading || operationId || !globalState) return;
    const id = crypto.randomUUID();
    const input: EvolutionRequest = { operationId: id, target, action, caseIds: chosen.caseIds, heldOutCaseIds: chosen.heldOutCaseIds, scope: scope.trim(), expectedRevision: globalState.revision, ...(action === 'rollback' ? { rollbackVersion } : {}) };
    // Remember before POST. Connection loss may mean the paid call already started.
    rememberOperation(project.id, id); operationId = id; outcome = undefined; submitting = true; error = ''; onbusy(true);
    try { const result = await api.reviewEvolution(project.id, input); globalState = result.state; latest = result.publication; outcome = { status: 'completed', ...result }; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The request outcome is uncertain. Check the saved operation before requesting another review.'; }
    finally { submitting = false; onbusy(false); }
  }
  async function check() {
    if (loading || submitting) return;
    loading = true; error = '';
    try { await checkOutcome(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not check this operation. No review was resubmitted.'; }
    finally { loading = false; }
  }
  function newRequest() {
    if (outcome?.status === 'pending' || !outcome || submitting) return;
    forgetOperation(project.id); operationId = undefined; outcome = undefined; latest = undefined; error = '';
    void load();
  }
</script>

<details class="evolution-controls">
  <summary>Review global learning & version history</summary>
  <p class="muted small">Theorist owns WaySkill selection; Moderator owns policy. Approved versions apply at a later Epoch boundary and never change active Worker inputs. Retrospective replay is not scientific proof.</p>
  <button type="button" disabled={loading || submitting} onclick={load}>{loading ? 'Loading…' : 'Refresh learning records'}</button>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if globalState}
    <p class="small">Published policy: {globalState.activePolicyVersion || 'Base policy'}. Published WaySkills: {Object.entries(globalState.activeWaySkillVersions).map(([id, version]) => `${id}: ${version}`).join('; ') || 'Base skills'}.</p>
    <form class="refinement-form" onsubmit={submit}>
      <fieldset class="flat-fieldset" disabled={disabled || submitting || loading || !!operationId}>
        <label>Review owner and target<select bind:value={target} onchange={() => rollbackVersion = ''}><option value="policy">Moderator · Strategy / Occam / decision policy</option><option value="way_skill">Theorist · WaySkill selection</option></select></label>
        <label>Request<select bind:value={action}><option value="review">Generate candidate and review</option><option value="rollback">Review rollback to approved version</option></select></label>
        {#if action === 'rollback'}<label>Previously approved version<select bind:value={rollbackVersion}><option value="">Select approved version</option>{#each rollbackVersions as version}<option value={version}>{version}</option>{/each}</select></label>{/if}
        <label>Where approved learning may apply<select bind:value={scopeKind}><option value="project">This project only (recommended)</option><option value="domain">A known domain</option><option value="global">All projects (global)</option></select></label>
        {#if scopeKind === 'domain'}<label>Applicable domain<select bind:value={scopeDomain}><option value="">Select a domain</option>{#each scopeDomains as domain}<option value={domain}>{domain}</option>{/each}</select></label>{/if}
        <p class="muted small">Project scope limits adoption to this project. Domain scope applies only to matching domains; global scope allows adoption across projects. Approved learning still takes effect at a later Epoch boundary.</p>
        <h3>Reviewed projects</h3>
        <p class="muted small">Select at least two training projects and one held-out project. Only explicitly assessed, committed outcomes are eligible; the backend verifies scope and replay compatibility.</p>
        {#if !eligible.length}<p class="notice">No reviewed cases for this target yet. Assess committed synthesis results in separate V2 projects first.</p>{/if}
        {#each eligible as item (item.id)}<label>{item.name} · {item.domainIds.join(', ')}<select value={selection[item.id] || ''} onchange={event => selection[item.id] = event.currentTarget.value as CaseSelection[string]}><option value="">Do not use</option><option value="training">Training</option><option value="held_out" disabled={action === 'review' && item.id === project.id}>Held out</option></select></label>{/each}
        <p class="small">{chosen.trainingIds.length} training · {chosen.heldOutCaseIds.length} held out. Model: {model ? `${model.provider} / ${model.modelId}` : 'not configured'}.</p>
        <p class="notice">Candidate generation and role review may incur model charges; usage is recorded without token or cost caps. Approval is decided by the role and replay checks; this request cannot guarantee promotion.</p>
        {#if reason}<p class="muted small">{reason}</p>{/if}
        <button class="primary" disabled={!!reason}>{submitting ? 'Review requested…' : action === 'rollback' ? 'Request rollback review' : 'Request candidate & role review'}</button>
      </fieldset>
    </form>
    {#if operationId}<p class="small">Operation {operationId} · {submitting ? 'request in progress' : outcome?.status || 'outcome not yet confirmed'}.</p><p class="muted small">Connection loss never automatically repeats a paid request. Checking this operation is read-only.</p><button type="button" disabled={loading || submitting} onclick={check}>Check review outcome</button>{#if outcome && outcome.status !== 'pending' && !submitting}<p class="muted small">A new request may make new model calls. Inspect the result and history first.</p><button type="button" disabled={loading} onclick={newRequest}>Prepare a new review request</button>{/if}{/if}
    {#if latest}<p class="notice" role="status">{latest.review.owner}: {latest.review.action} · {latest.review.candidateVersion}. {latest.review.reason}</p>{/if}
    <details><summary>Recorded decisions ({globalState.history.length})</summary>{#each [...globalState.history].reverse() as item (item.id)}<article class="worker-card"><strong>{item.review.owner} · {item.review.target} · {item.review.action}</strong><p>{item.review.previousVersion} → {item.review.candidateVersion} · later Epoch boundary</p><p>{item.review.reason}</p><p class="small">Scope: {item.review.scope}</p><p class="small">Replay: baseline {item.review.metrics.baseline.toFixed(3)} / candidate {item.review.metrics.candidate.toFixed(3)}. Held out: baseline {item.review.metrics.heldOutBaseline.toFixed(3)} / candidate {item.review.metrics.heldOutCandidate.toFixed(3)}.</p><details><summary>Replay case provenance ({item.review.cases.length})</summary>{#each item.review.cases as replayCase}<p class="small">{replayCase.projectId} · {replayCase.heldOut ? 'held out' : 'training'} · revision {replayCase.sourceRevision.slice(0, 10)}</p><p class="muted small">{replayCase.limitations.join('; ')}</p>{/each}</details><ul>{#each item.review.limitations as limitation}<li>{limitation}</li>{/each}</ul></article>{/each}</details>
  {/if}
</details>
