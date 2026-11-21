<script lang="ts">
  import { sourceParts } from './markdown';
  let { text, interactive = true }: { text: string; interactive?: boolean } = $props();
</script>
{#each sourceParts(text) as part}{#if part.href}{#if interactive}<a class="source-name" href={part.href} title={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else}<span class="source-name" title={part.href}>{part.text}</span>{/if}{:else}{part.text}{/if}{/each}
