<script lang="ts">
  import type { ArchivedRefutation } from '../../src/learning/research-data';
  let { result }: { result: ArchivedRefutation } = $props();
  const labels = {'empirical-exclusion':'Empirical exclusion',contradiction:'Theoretical contradiction',counterexample:'Counterexample'};
</script>

<section class="my-3 text-sm" aria-label="Archived scientific conclusion">
  <h4>{labels[result.relation]}</h4>
  {#if result.status !== 'valid'}<p role="status">{result.status === 'needs_review' ? 'Evidence needs review' : 'Qualification revoked'}</p>{/if}
  <p class="whitespace-pre-wrap">{result.reason}</p>
  {#each result.observations as {ref, selection, measurement} (selection)}
    <details class="my-2">
      <summary>{measurement.system} · {measurement.observable} · {measurement.value} {measurement.units}</summary>
      <dl class="my-2 grid gap-1">
        <dt>Conditions</dt><dd>{measurement.conditions}</dd>
        <dt>Uncertainty</dt><dd>{measurement.uncertainty}</dd>
        <dt>Original source</dt><dd>{measurement.sourceLocator}</dd>
        {#if measurement.calibration}<dt>Calibration</dt><dd>{measurement.calibration}</dd>{/if}
        {#if measurement.reduction}<dt>Data reduction</dt><dd>{measurement.reduction}</dd>{/if}
        {#if measurement.dependencies?.length}<dt>Dependencies</dt><dd>{measurement.dependencies.join(' · ')}</dd>{/if}
        <dt>Archived map record</dt><dd class="break-all">{ref.id} · version {ref.version} · {ref.bodyHash}</dd>
      </dl>
    </details>
  {/each}
</section>
