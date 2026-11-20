<script lang="ts">
  import { tick } from 'svelte';
  import { hiddenSidebarScrollbar } from './themes/session-presentation';
  import type { CheckpointPage } from './checkpoint-view';
  import type {ResearchProject} from "./api";
  import type {UserCommand} from "../src/engine/types";
  let {project,commandHistory, pages, selected, onselect }: {project:ResearchProject;commandHistory:UserCommand[]; pages: CheckpointPage[]; selected?: string; onselect: (id?: string) => void } = $props();
  let read=$state<string[]>([]),shown=$state('');
  let sessionKey=$derived(project.id);
  $effect(()=>{const id=sessionKey;shown='';try{read=JSON.parse(localStorage.getItem('cages-read:'+id)||'[]')}catch{read=[]}});
  const inputs=$derived.by(()=>{
    const rows=new Map<string,{id:string;text:string;status:string}[]>();
    if(project.schemaVersion!==3||project.researchLoopVersion!=='4.0')return rows;
    for(const cmd of commandHistory.filter(c=>c.projectId===project.id&&c.kind==='refine')){
      const epoch=[...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])].find(e=>e.planningSelection?.commandIds.includes(cmd.id)||e.snapshot.discussion?.userInputs.some(i=>i.id===cmd.id));
      const page=epoch?pages.find(p=>!p.inheritedSessionId&&p.number===epoch.epoch):pages.filter(p=>!p.inheritedSessionId&&(!p.time||p.time<=cmd.createdAt)).at(-1)??pages.filter(p=>!p.inheritedSessionId).at(-1);
      if(!page)continue;const list=rows.get(page.id)??[];list.push({id:cmd.id,text:cmd.payload,status:epoch?'Received':project.commandStates?.[cmd.id]?.status??'Queued'});rows.set(page.id,list);
    }return rows;
  });
  function select(i:number){const page=pages[i]!;onselect(i===pages.length-1?undefined:page.id);shown=page.id;const ids=inputs.get(page.id)?.map(c=>c.id)??[];if(ids.length){read=[...new Set([...read,...ids])];try{localStorage.setItem('cages-read:'+project.id,JSON.stringify(read))}catch{}}}
  function move(event: KeyboardEvent, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : event.key === 'ArrowRight' ? Math.min(index + 1, pages.length - 1) : event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : -1;
    if (next < 0) return;
    event.preventDefault();
    select(next);
    const tabs = event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') : undefined;
    tabs?.[next]?.focus({ preventScroll: true });
  }
  function keepSelectedVisible(node: HTMLDivElement, _selected?: string) {
    const reveal = () => {
      const tab = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      const item = tab.getBoundingClientRect(), viewport = node.getBoundingClientRect();
      if (item.left < viewport.left + 3) node.scrollLeft -= viewport.left + 3 - item.left;
      else if (item.right > viewport.right - 3) node.scrollLeft += item.right - viewport.right + 3;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(node);
    void tick().then(reveal);
    return { update() { void tick().then(reveal); }, destroy() { observer.disconnect(); } };
  }
</script>
{#if pages.length}
  <nav class="round-ribbon items-center bg-transparent p-0" aria-label="Research iterations">
    <div class={`round-tabs gap-0 p-0 ${hiddenSidebarScrollbar}`} role="tablist" aria-label="Saved outputs" use:keepSelectedVisible={selected}>
      {#each pages as page, index (page.id)}
        <button type="button" class={`round-tab -ml-[1.7rem] first:ml-0 first:pl-3 focus-visible:z-[2147483647]! focus-visible:outline-offset-[-2px] min-h-[1.7rem] rounded-none rounded-tr-[1.7rem] pl-[2.05rem] pr-4 py-1 text-[0.65rem] leading-tight gap-1.5 before:rounded-none before:rounded-tr-[1.7rem] before:[clip-path:none] before:ring-1 before:ring-inset before:ring-accent/75 aria-selected:text-accent aria-selected:before:bg-selected aria-selected:shadow-[inset_0_0_0_1px_var(--color-accent)] outcome-${page.outcome}`} style:z-index={pages.length - index} class:current={selected === page.id} role="tab" id={`round-tab-${page.id}`} aria-selected={selected === page.id} aria-controls="selected-research-output" tabindex={selected === page.id ? 0 : -1} onclick={() => select(index)} onkeydown={event => move(event, index)} title={`${page.outcomeLabel}${page.time ? ' · ' + new Date(page.time).toLocaleString() : ''}`} aria-label={`Epoch ${index + 1}, ${page.outcomeLabel}`} >
          <span>Epoch {index + 1}</span>{#if inputs.get(page.id)?.some(c=>!read.includes(c.id))}<i class="unread" aria-label="Unread follow-up"></i>{/if}
        </button>
      {/each}
    </div>
  </nav>
  {#if shown && inputs.get(shown)?.length}<details open class="round-inputs"><summary>Follow-ups</summary>{#each inputs.get(shown)??[] as c}<p><small>{c.status}</small> {c.text}</p>{/each}</details>{/if}
{/if}

<style>.unread{display:inline-block;width:6px;height:6px;background:var(--color-danger);border-radius:50%;position:relative}.round-inputs{max-height:10rem;overflow:auto;padding:4px 12px}.round-inputs p{white-space:pre-wrap}</style>
