<script lang="ts">
  import { researchPaper } from '../src/presentation/research-paper';
  import { compactNodeTitle } from './tree-view';
  let { checkpoints, summary, nodes, active, onsection, onnode, originalPages = false, displayed }: {
    checkpoints: { id: string; label: string; content: string }[]; summary: string;
    nodes: { id: string; parentId?: string; question: string; resultPath?: string }[];
    active: string;
    originalPages?: boolean; displayed?: { id: string; content?: string };
    onsection: (id: string, section?: string) => void; onnode: (id: string, path?: string) => void;
  } = $props();
  let papers = $derived(checkpoints.length ? checkpoints : summary ? [{ id: 'latest', label: 'Synthesis', content: summary }] : []);
  let roots = $derived(nodes.filter(node => !node.parentId || !nodes.some(parent => parent.id === node.parentId)));
  function sections(content: string) {
    const paper = researchPaper(content);
    return paper.original ? [{ id: 'summary', title: 'Saved response' }] : paper.sections;
  }
</script>
{#snippet branch(node: typeof nodes[number], ancestors: string[])}
  {@const children = nodes.filter(child => child.parentId === node.id && ![...ancestors, node.id].includes(child.id))}
  <li>
    {#if children.length}
      <details><summary title={node.question}>{compactNodeTitle(node.question)}</summary><ul>{#each children as child (child.id)}{@render branch(child, [...ancestors, node.id])}{/each}</ul><button onclick={() => onnode(node.id, node.resultPath)}>Open direction</button></details>
    {:else}<button title={node.question} onclick={() => onnode(node.id, node.resultPath)}><span class="truncate">{compactNodeTitle(node.question)}</span></button>{/if}
  </li>
{/snippet}
<nav class="session-outline" aria-label="Session contents">
  <ul class="outline-children">
    <li><button class:chosen={active === 'hypothesis'} aria-current={active === 'hypothesis' ? 'location' : undefined} onclick={() => onsection('hypothesis')}>Hypothesis</button></li>
    {#each papers as paper (paper.id)}
      {@const content = originalPages ? displayed?.id === paper.id ? displayed.content : undefined : paper.content}
      <li><details><summary>{paper.label}</summary><ul>{#if content === undefined}<li><button onclick={() => onsection(paper.id)}>Read response</button></li>{:else}{#each sections(content) as section (section.id)}<li><button class:chosen={active === `${paper.id}:${section.id}`} aria-current={active === `${paper.id}:${section.id}` ? 'location' : undefined} onclick={() => onsection(paper.id, section.id)}>{section.title}</button></li>{/each}{/if}</ul></details></li>
    {/each}
    {#if nodes.length > 1}<li><details><summary>Directions <span class="count">{nodes.length - roots.length}</span></summary><ul>{#each roots as root (root.id)}{#each nodes.filter(node => node.parentId === root.id) as child (child.id)}{@render branch(child, [root.id])}{/each}{/each}</ul></details></li>{/if}
  </ul>
</nav>
