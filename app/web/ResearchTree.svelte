<script lang="ts">
  import LogicBlock from './LogicBlock.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import Icon from './Icon.svelte';
  import { compactNodeTitle, type TreeNodeView } from './tree-view';
  let { nodes, title = 'Hypothesis tree', onopen }: { nodes: TreeNodeView[]; title?: string; onopen: (path: string) => void } = $props();
  let selected = $state('');
  let hovered = $state('');
  let collapsed = $state<string[]>([]);
  let roots = $derived(nodes.filter(node => !node.parentId || !nodes.some(parent => parent.id === node.parentId)));
  let detail = $derived(nodes.find(node => node.id === selected));
  let preview = $derived(nodes.find(node => node.id === hovered));
  function toggle(id: string) { collapsed = collapsed.includes(id) ? collapsed.filter(item => item !== id) : [...collapsed, id]; }
  const executionLabel = (tone: TreeNodeView['tone']) => ({ idle: 'Not running', running: 'Execution running', success: 'Execution completed', failed: 'Execution failed', review: 'Execution needs review' })[tone];
</script>
{#snippet branch(node: TreeNodeView, ancestors: string[])}
  {@const children = nodes.filter(item => item.parentId === node.id && ![...ancestors, node.id].includes(item.id))}
  <li>
    <div class="tree-junction">
      <button class={`graph-node tone-${node.tone}`} class:chosen={selected === node.id}
        data-node-id={node.id} aria-label={`${node.title} — ${node.status}`} aria-expanded={selected === node.id}
        aria-describedby={`execution-${node.id}`}
        onmouseenter={() => hovered = node.id} onmouseleave={() => hovered = ''}
        onfocus={() => hovered = node.id} onblur={() => hovered = ''}
        onclick={() => selected = selected === node.id ? '' : node.id}>
        <span class="node-state" aria-hidden="true">{#if node.tone === 'success'}<Icon name="check" size={12} />{:else if node.tone === 'failed'}<Icon name="close" size={12} />{:else if node.tone === 'running'}<Icon name="play" size={11} />{:else if node.tone === 'review'}<Icon name="pause" size={11} />{:else}<span class="node-dot"></span>{/if}</span><span class="node-caption">{compactNodeTitle(node.caption || node.title)}</span>
      </button>
      <span id={`execution-${node.id}`} class="visually-hidden">{executionLabel(node.tone)}. Open details for the scientific conclusion and evidence.</span>
      {#if children.length}<button class="tree-toggle" aria-label={`${collapsed.includes(node.id) ? 'Expand' : 'Collapse'} ${node.title}`} aria-expanded={!collapsed.includes(node.id)} onclick={() => toggle(node.id)}>{collapsed.includes(node.id) ? '＋' : '−'}</button>{/if}
    </div>
    {#if children.length && !collapsed.includes(node.id)}<ul>{#each children as child (child.id)}{@render branch(child, [...ancestors, node.id])}{/each}</ul>{/if}
  </li>
{/snippet}
<section class="tree-panel">
  <div class="section-heading"><h2>{title}</h2><span class="count">{nodes.length}</span></div>
  <div class="tree-scroll" role="region" aria-label="Research branches">
    {#if roots.length}<ul class="branch-map">{#each roots as root (root.id)}{@render branch(root, [])}{/each}</ul>{:else}<p class="empty-message">No branches yet.</p>{/if}
  </div>
  {#if preview}<div class="node-preview" role="tooltip"><strong>{preview.title}</strong><p>{preview.summary}</p><small>{executionLabel(preview.tone)} · {preview.status}</small></div>{/if}
  {#if detail}<article class="node-details">
    <div class="section-heading"><h3>{detail.title}</h3><button class="icon-button" aria-label="Close branch details" onclick={() => selected = ''}>×</button></div>
    <div class="flex flex-wrap gap-1.5 mb-3">{#each detail.tags || [] as tag}<span class={`state-tag tone-${tag.tone}`} title={tag.category} aria-label={`${tag.category}: ${tag.label}`}>{tag.label}</span>{/each}</div>
    <LogicBlock conditions={detail.conditions?.map(text => ({kind:'if',text}))} claim={detail.finding || detail.title} label="result" otherwise={detail.obstacles} />
    {#if detail.steps?.length}<details class="disclosure-list"><summary>Derivation <span class="count">{detail.steps.length}</span></summary><ol class="logic-steps">{#each detail.steps as step}<li><span class="logic-key action-key">then</span><MarkdownView content={step} /></li>{/each}</ol></details>{/if}
    <details class="disclosure-list"><summary>Sources & scope</summary><dl>{#each detail.details.filter(field => !['Status','Execution','Scientific conclusion','Evidence','Assumptions','Review note'].includes(field.label)) as field}<dt>{field.label}</dt><dd>{field.text}</dd>{/each}</dl></details>
    {#if detail.path}<button class="text-button" onclick={() => onopen(detail.path!)}>Open derivation →</button>{/if}
  </article>{/if}
</section>
