<script lang="ts">
  import MarkdownView from '../MarkdownView.svelte';
  import Icon from '../Icon.svelte';
  import { sessionScrollbar } from '../themes/session-presentation';
  let { text, expanded = $bindable(true) }: { text: string; expanded?: boolean } = $props();
  const id = $props.id();
</script>
<div class="min-w-0">
  <div id={id} hidden={!expanded} class={`${sessionScrollbar} text-base leading-relaxed wrap-anywhere max-h-[min(28dvh,240px)] overflow-auto`}><MarkdownView content={text} /></div>
  <div class="relative mt-2 border-b border-line pb-2">
    <button type="button" class="absolute left-1/2 -bottom-3.5 min-h-7 h-7 w-12 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-0 text-muted hover:text-accent" aria-label={expanded ? 'Collapse hypothesis' : 'Expand hypothesis'} aria-expanded={expanded} aria-controls={id} onclick={() => expanded = !expanded}><Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={15} /></button>
  </div>
</div>
