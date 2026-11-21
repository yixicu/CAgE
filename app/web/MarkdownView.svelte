<script lang="ts">
  import { renderMarkdown } from './markdown';
  let { content = '', paperMath = false, citationKeys }: { content?: string; paperMath?: boolean; citationKeys?: ReadonlySet<string> } = $props();
</script>
<div class="markdown-view">{@html renderMarkdown(content, { paperMath, citationKeys })}</div>
<style>
  .markdown-view :global(span.math-block) { display: block; max-width: 100%; overflow-x: auto; overflow-y: hidden; text-align: center; }
  .markdown-view :global(.math-block .katex-display) { min-width: max-content; }
</style>
