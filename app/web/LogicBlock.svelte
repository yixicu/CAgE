<script lang="ts">
  import MarkdownView from './MarkdownView.svelte';
  let { conditions = [], claim, label = 'proof', otherwise = [], unknown = false }: {
    conditions?: { kind: 'if' | 'if not'; text: string }[]; claim: string; label?: string; otherwise?: string[]; unknown?: boolean;
  } = $props();
</script>
<div class="logic-block">
  <div class="logic-premises">
    {#each conditions as condition}<div class="logic-line"><span class="logic-key">{condition.kind}</span><MarkdownView content={condition.text} /></div>
    {:else}<div class="logic-line"><span class="logic-key">if</span><span class="text-muted text-xs">{unknown ? 'See original premise' : 'None'}</span></div>{/each}
    <div class="logic-action"><span class="logic-key action-key">{label}</span><MarkdownView content={claim} /></div>
    {#if otherwise.length}<details class="logic-else"><summary><span class="logic-key">else</span> Open constraints <span class="count">{otherwise.length}</span></summary><ul>{#each otherwise as item}<li><MarkdownView content={item} /></li>{/each}</ul></details>{/if}
  </div>
</div>
