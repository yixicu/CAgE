<script lang="ts">
  import type { AnyResearchProject } from '../../src/research/contracts/loop';
  import { researchDirections } from './directions-view';
  import MonitorButton from '../monitor/MonitorButton.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import ResearchTag from './ResearchTag.svelte';
  import { agentTag, statusTag } from './research-tags';
  let { project, onmonitor }: { project: AnyResearchProject; onmonitor: () => void } = $props();
  let directions = $derived.by(()=>{
    const rows=researchDirections(project);
    if(project.schemaVersion!==3||project.researchLoopVersion!=='4.0')return rows;
    const artifactIds=new Set([...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])].flatMap(e=>e.optionalFlow?.artifacts.map(a=>a.id)??[]));
    return rows.filter(row=>!artifactIds.has(row.id));
  });
</script>
{#if directions.length || project.researchLoopVersion!=='4.0'}
<details class="sidebar-directions mx-4.5 my-3 min-w-0 border-b border-line/60 pb-3" aria-label="Current research directions">
  <summary class="cursor-pointer">Research directions · {directions.length}</summary><div class="flex justify-end">
    
    <MonitorButton onclick={onmonitor} />
  </div>
  {#each directions as direction (direction.id)}
    {@const role = direction.agent ?? (/^Worker\b/i.test(direction.label) ? direction.label : undefined)}
    <details class="group/direction min-w-0 border-t border-line/50 py-2 first-of-type:border-0" data-direction-id={direction.id}>
      <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span class="direction-question block wrap-anywhere text-xs leading-relaxed text-ink">{direction.question}</span>
        <span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1" aria-label="Agent and direction status">
          {#if role}<ResearchTag {...agentTag(role)} kind="agent" detail={role} />{:else}<span class="min-w-0 truncate text-[11px] text-muted" title={direction.label}>{direction.label}</span>{/if}
          {#each direction.status.split(' · ').filter(Boolean) as status, index}<ResearchTag {...statusTag(status)} kind="status" detail={direction.agent && index < 2 ? `${index === 0 ? 'Execution' : 'Scientific review'}: ${status}` : status} />{/each}
        </span>
      </summary>
      <div class="mt-2 space-y-2 text-xs text-muted [&_.markdown-view]:text-xs [&_.markdown-view_p]:m-0">
        {#if role}<p class="m-0 wrap-anywhere">{direction.label}</p>{/if}
        {#if direction.target && direction.target !== direction.question}<div><span class="text-muted">Target</span><MarkdownView content={direction.target} /></div>{/if}
        {#if direction.conditions.length}<div><span class="text-muted">Conditions</span>{#each direction.conditions as condition}<MarkdownView content={condition} />{/each}</div>{/if}
        {#if (!direction.target || direction.target === direction.question) && !direction.conditions.length}<p class="m-0 text-xs">No additional target conditions recorded.</p>{/if}
      </div>
    </details>
  {:else}<p class="m-0 py-2 text-xs leading-relaxed text-muted">{project.schemaVersion === 4 ? 'Directions appear when the Theorist plans candidate Ways.' : 'Directions appear when research assigns a concrete question.'}</p>{/each}
</details>
{/if}
<style>
  details:not([open]) > summary > .direction-question {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
</style>
