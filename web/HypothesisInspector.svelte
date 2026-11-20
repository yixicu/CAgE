<script lang="ts">
  import type { ResearchProject } from './api';
  import LogicBlock from './LogicBlock.svelte';
  import MarkdownView from './MarkdownView.svelte';
  let { project }: { project: ResearchProject } = $props();
  let organized = $derived(project.presentation?.hypothesisRevision === project.hypothesisRevision ? project.presentation : undefined);
</script>
<details class="inspector-hypothesis disclosure-list rounded-control bg-surface/65 px-3 py-2 border-0 [&>summary]:text-xs">
  <summary>Hypothesis</summary>
  <LogicBlock conditions={organized?.conditions} claim={organized?.claim || project.hypothesis} unknown={!organized} />
  {#if organized}<details><summary>Original premise</summary><MarkdownView content={project.hypothesis} /></details>{/if}
</details>
