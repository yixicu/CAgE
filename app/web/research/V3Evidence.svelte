<script lang="ts">
  import type { EpochRecordV21, InFlightEpochV21 } from '../../src/research/contracts/v21';
  let { epoch,inline=false,knownClaims }: { inline?:boolean;knownClaims?:Set<string>;epoch: EpochRecordV21 | InFlightEpochV21 } = $props();
  const evidence = $derived(epoch.optionalFlow?.v3);
</script>
{#if evidence}
  {#snippet rows()}
    {#each evidence.workspace.records as record (record.id)}
      <details class="my-2 min-w-0 text-xs">
        <summary class="cursor-pointer wrap-anywhere">{record.kind} · {record.status}</summary>
        {#if !(record.kind==='goal' && knownClaims?.has(record.text.trim().replace(/\s+/g,' ')))}<p class="my-1 whitespace-pre-wrap wrap-anywhere">{record.text}</p>{/if}
        <p class="text-muted wrap-anywhere">{record.id} · {record.evidenceKind} · {record.branchId}</p>
        {#if record.dependsOn.length}<p class="text-muted wrap-anywhere">Depends on: {record.dependsOn.join(', ')}</p>{/if}
        <code class="block wrap-anywhere">{record.sourceRef}</code>
      </details>
    {/each}
    {#each evidence.receipts as receipt (receipt.id)}
      <details class="my-2 min-w-0 text-xs">
        <summary class="cursor-pointer wrap-anywhere">{receipt.operationId} · {receipt.status}</summary>
        <p class="my-1 whitespace-pre-wrap wrap-anywhere">{receipt.summary}</p>
        <p class="text-muted wrap-anywhere">{receipt.verification.kind} · {receipt.verification.scope}</p>
        {#if receipt.result !== undefined}<pre class="my-2 whitespace-pre-wrap wrap-anywhere">{JSON.stringify(receipt.result, null, 2)}</pre>{/if}
        {#each [...receipt.conditionalPremises, ...receipt.missingConditions, ...receipt.errors] as condition}<p class="my-1 wrap-anywhere">{condition}</p>{/each}
        <code class="block wrap-anywhere">{receipt.artifactRef}</code>
      </details>
    {/each}
    {#if !evidence.workspace.records.length && !evidence.receipts.length}<p class="my-2 text-xs text-muted">No recorded evidence yet.</p>{/if}
  {/snippet}
  {#if inline}{@render rows()}{:else}
  <details class="my-2 min-w-0 border-t border-line/50 pt-2" aria-label={`Epoch ${epoch.epoch} evidence`}>
    <summary class="cursor-pointer text-xs">Evidence <span class="text-muted">{evidence.workspace.records.length + evidence.receipts.length}</span></summary>
    {@render rows()}
  </details>
  {/if}
{/if}
