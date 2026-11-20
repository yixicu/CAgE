<script lang="ts">
  import type { Snippet } from 'svelte';
  import MarkdownView from './MarkdownView.svelte';
  import BrandWordmark from './BrandWordmark.svelte';
  import StartPageIdentity from './StartPageIdentity.svelte';
  let { hypothesis, children, showSubtitle = false }: { hypothesis: string; children: Snippet; showSubtitle?: boolean } = $props();
  let hasDraft = $derived(!!hypothesis.trim());
</script>

<div class="entry-scene">
<section class="hypothesis-entry max-w-4xl gap-6 px-6 pt-6 pb-16 sm:px-10 lg:px-14" class:has-draft={hasDraft} aria-label="New hypothesis">
  <div class="entry-visual">
    <div class={`entry-identity text-[clamp(64px,8vw,112px)] ${hasDraft ? '' : 'top-[72%]'}`}>{#if showSubtitle}<StartPageIdentity showSubtitle={!hasDraft} />{:else}<h1 class="m-0 leading-none" aria-label="CAgE — Carnot Agent Engine"><BrandWordmark decorative /></h1>{/if}</div>
    <section class="entry-preview border-line/70 bg-surface/95 shadow-none" aria-label="Hypothesis preview" aria-hidden={!hasDraft} inert={!hasDraft}>
      <span class="entry-preview-label">Hypothesis</span>
      <div class="entry-preview-body">{#if hasDraft}<MarkdownView content={hypothesis} />{/if}</div>
    </section>
  </div>
  <div class="entry-input">{@render children()}</div>
</section>

</div>
