<script lang="ts">
  import type { ResearchProjectV2 } from '../src/research/contracts/v2';
  import type { UserCommand } from '../src/engine/types';
  import { proposalIsStale, queuedProposalIds } from './research-view-v2';
  import MarkdownView from './MarkdownView.svelte';
  let { project, commands, disabled, onaccept }: { project: ResearchProjectV2; commands: UserCommand[]; disabled: boolean; onaccept: (proposalId: string) => Promise<void> } = $props();
  let saving = $state('');
  let error = $state('');
  let queued = $derived(queuedProposalIds(commands));
  async function accept(id: string) {
    if (saving || disabled) return;
    saving = id; error = '';
    try { await onaccept(id); } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not queue acceptance. Reload the current project before trying again.'; }
    finally { saving = ''; }
  }
  const implication = { hypothesis_implies_target: 'Current hypothesis implies candidate; the candidate alone does not establish the original.', target_implies_hypothesis: 'Candidate implies the current hypothesis under the stated premises.', equivalent: 'Proposed equivalence under the stated premises.', counterexample: 'Proposed counterexample; applicability must be reviewed.' };
</script>
{#if project.reconstructionProposals?.length}
  <details><summary>Proposed hypothesis revisions ({project.reconstructionProposals.length})</summary>
    <p class="muted small">Review the candidate, premises and implication before accepting. Acceptance is queued for a safe Epoch boundary; when idle, it applies before the next Epoch after Start. The original hypothesis remains in revision history.</p>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    {#each project.reconstructionProposals as proposal (proposal.id)}
      {@const stale = proposalIsStale(proposal, project.hypothesisRevision)}
      <article class="worker-card"><strong>{proposal.kind} · {proposal.candidateVersion}</strong><MarkdownView content={proposal.hypothesis} /><p>{proposal.reason}</p><p><strong>Logical direction:</strong> {implication[proposal.implication]}</p>
        {#if proposal.assumptions.length}<ul>{#each proposal.assumptions as assumption}<li>{assumption}</li>{/each}</ul>{/if}
        <p class="muted small">Source hypothesis {proposal.sourceHypothesisRevision.slice(0, 10)}.</p>
        {#if proposal.status === 'accepted'}<p class="notice">Accepted at Epoch {proposal.acceptedAtEpoch ?? 'boundary'}.</p>
        {:else if queued.has(proposal.id)}<p class="notice">Acceptance queued. Active Worker inputs remain unchanged.</p>
        {:else if stale}<p class="notice">Stale proposal: its source hypothesis has changed. Request a new proposal for the current version.</p>
        {:else}<button type="button" disabled={disabled || !!saving} onclick={() => accept(proposal.id)}>{saving === proposal.id ? 'Queuing…' : 'Queue acceptance of this hypothesis'}</button>{/if}
      </article>
    {/each}
  </details>
{/if}
