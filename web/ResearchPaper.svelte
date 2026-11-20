<script lang="ts">
  import { researchPaper } from '../src/presentation/research-paper';
  import MarkdownView from './MarkdownView.svelte';
  import Icon from './Icon.svelte';
  let { content }: { content: string } = $props();
  let paper = $derived(researchPaper(content));
  const missing = {
    summary: 'A structured summary was not supplied.',
    proof: 'No structured derivation was supplied in this response.',
    restriction: 'Restrictions were not supplied; applicability remains unspecified.',
    reference: '',
  };
</script>
<div class="research-paper w-full max-w-none min-w-0 text-base leading-[1.75] [&_.markdown-view_h1]:text-2xl [&_.markdown-view_h2]:text-xl [&_.markdown-view_h3]:text-lg" aria-label="Research paper">
  {#if paper.original}
    <section class="paper-section paper-summary" aria-label="Saved response"><MarkdownView content={paper.original} paperMath /></section>
  {:else}
  {#each paper.sections as section (section.id)}
    <details class={`paper-section paper-${section.id} group/section [scroll-margin-top:var(--hypothesis-scroll-offset,145px)]`} aria-label={section.title} open>
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 mb-4 text-2xl leading-snug font-normal text-[color:var(--color-title)] [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <h2 class="m-0 text-2xl leading-snug font-normal">{section.title}</h2><span class="shrink-0 text-muted transition-transform group-open/section:rotate-180 motion-reduce:transition-none"><Icon name="chevronDown" size={14} /></span>
      </summary>
      {#if section.content}<MarkdownView content={section.content} paperMath />{:else}<p class="paper-missing">{missing[section.id]}</p>{/if}
    </details>
  {/each}
  {/if}
</div>
<style>
  .research-paper :global(.math-block) { padding: 0 .375rem; margin: 1.25rem 0; background: transparent; }
</style>
