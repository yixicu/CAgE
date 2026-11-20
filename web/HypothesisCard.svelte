<script lang="ts">
  import MarkdownView from './MarkdownView.svelte';
  import Icon from './Icon.svelte';
  let { text, expanded = $bindable(false) }: { text: string; expanded?: boolean } = $props();
</script>
<div class="hypothesis-card">
  <button class="hypothesis-preview" type="button" aria-label={expanded ? 'Collapse hypothesis' : 'Expand hypothesis'} aria-expanded={expanded} onclick={() => expanded = !expanded}>
    {#if expanded}<span class="text-xs text-muted font-ui">Collapse</span>{:else}<span class="line-clamp-2 text-left whitespace-normal wrap-anywhere"><MarkdownView content={text} /></span>{/if}<Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={15} />
  </button>
  {#if expanded}<div class="hypothesis-full"><MarkdownView content={text} /></div>{/if}
</div>
