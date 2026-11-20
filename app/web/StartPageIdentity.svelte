<script lang="ts">
  import SuppliedWordmark from './SuppliedWordmark.svelte';
  /** Foreground-only lockup. Subtitle remains editable/selectable HTML text. */
  const defaultSubtitle = 'Trade independent thinking for Horcruxes... Deal.';
  let { subtitle = defaultSubtitle, showSubtitle = true }: { subtitle?: string; showSubtitle?: boolean } = $props();
</script>

<div class="relative w-fit" data-start-page-identity>
  <h1 class="m-0 leading-none" aria-label="CAgE — Carnot Agent Engine"><SuppliedWordmark decorative /></h1>
  {#if showSubtitle}
    <p class="absolute left-[3%] top-[83%] m-0 w-[53%] font-ui text-[length:calc(clamp(12px,calc(1.2vw_+_1px),16px)*var(--ui-font-scale,1))] font-light leading-[1.2] tracking-[-0.025em] text-brand" data-start-page-subtitle>
      {#if subtitle === defaultSubtitle}
        <span class="block whitespace-nowrap">Trade independent thinking</span>
        <span class="ml-[calc(16%_+_10ch)] [@media(max-width:900px)]:mt-1 block whitespace-nowrap">for Horcruxes... <span class="font-medium tracking-normal">Deal.</span></span>
      {:else}
        {subtitle}
      {/if}
    </p>
  {/if}
</div>
