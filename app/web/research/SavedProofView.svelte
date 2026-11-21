<script lang="ts">
  import { tick } from 'svelte';
  import type { SavedProof,ReportPublication } from '../api';
  import NodeProofs from '../NodeProofs.svelte';
  import Icon from '../Icon.svelte';
  import type { MapNodeDocument, MapOpenResult } from '../../src/learning/knowledge-map';
  import NodeReviewBadge from '../NodeReviewBadge.svelte';
  import ResearchPaper from '../ResearchPaper.svelte';
  import MarkdownView from '../MarkdownView.svelte';

  let { proof, projectId, onmap, publications=[], paper = true }: { proof: SavedProof; projectId:string; onmap: (read: MapOpenResult) => void; paper?: boolean; publications?:ReportPublication[] } = $props();
  const dialogId = $props.id();
  const reads = $derived(new Map((proof.citations ?? []).filter(read => read.ref).map(read => [read.selection, read])));
  const citationKeys = $derived(new Set(reads.keys()));
  let active = $state<MapOpenResult>();
  let trigger = $state<HTMLAnchorElement>();
  let badge=$state<NodeReviewBadge>();
  let panel = $state<HTMLElement>();
  let hideTimer: ReturnType<typeof setTimeout>;
  let restoring = false;
  let pinned = false;
  let trail=$state<MapNodeDocument[]>([]), offsets:number[]=[];
  let refresh=$state(0);
  function navigate(next?:MapNodeDocument){
    const body=panel?.querySelector('.citation-body');
    pinned=true;
    panel?.focus({preventScroll:true});
    const top=next?0:offsets.pop()??0;
    if(next){offsets.push(body?.scrollTop??0);trail.push(next)}
    else trail.pop();
    void tick().then(()=>body?.scrollTo(0,top));
  }

  function close(restore = false) {
    clearTimeout(hideTimer);
    const lastTrigger = trigger;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.removeAttribute('aria-controls');
    trigger = undefined;
    active = undefined;
    trail=[];offsets=[];refresh=0;
    pinned = false;
    if (restore && lastTrigger?.isConnected) {
      restoring = true;
      lastTrigger.focus({preventScroll:true});
      restoring = false;
    }
  }
  function show(link: HTMLAnchorElement) {
    clearTimeout(hideTimer);
    if (restoring || trigger === link) return;
    const read = reads.get(link.dataset.mapCitation ?? '');
    if (!read) return;
    close();
    trigger = link;
    link.setAttribute('aria-expanded', 'true');
    link.setAttribute('aria-controls', dialogId);
    active = read;
  }
  function inside(target: EventTarget | null) {
    return target instanceof Node && (trigger?.contains(target) || panel?.contains(target));
  }
  function leave() {
    clearTimeout(hideTimer);
    if (!pinned && !inside(document.activeElement)) hideTimer = setTimeout(() => close(), 250);
  }
  function citationEvents(node: HTMLElement) {
    function linkAt(target: EventTarget | null) {
      return target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-map-citation]') : null;
    }
    const enter = (event: Event) => {
      if (panel?.contains(event.target as Node)) { clearTimeout(hideTimer); return; }
      const link = linkAt(event.target);
      if (link) show(link);
    };
    const out = (event: PointerEvent) => { if (!inside(event.relatedTarget)) leave(); };
    const blur = (event: FocusEvent) => { if (active && !inside(event.relatedTarget)) close(); };
    const click = (event: MouseEvent) => {
      const link = linkAt(event.target);
      if (!link) return;
      event.preventDefault();
      show(link);
      pinned = true;
      void tick().then(() => panel?.focus({preventScroll:true}));
    };
    const outside = (event: PointerEvent) => { if (active && !inside(event.target)) close(); };
    const key = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); close(inside(document.activeElement) === true); }
      if (event.key === 'Tab' && event.target === trigger && !event.shiftKey) {
        event.preventDefault();
        panel?.querySelector('button')?.focus();
      } else if (event.key === 'Tab' && event.shiftKey && event.target === panel?.querySelector('button')) {
        event.preventDefault();
        close(true);
      }
    };
    node.addEventListener('pointerover', enter);
    node.addEventListener('pointerout', out);
    node.addEventListener('focusin', enter);
    node.addEventListener('focusout', blur);
    node.addEventListener('click', click);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return { destroy() {
      close();
      node.removeEventListener('pointerover', enter);
      node.removeEventListener('pointerout', out);
      node.removeEventListener('focusin', enter);
      node.removeEventListener('focusout', blur);
      node.removeEventListener('click', click);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
    } };
  }
  function position(node: HTMLElement) {
    node.showPopover();
    function place() {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect(), gap = 8;
      const left = Math.max(gap, Math.min(rect.left, window.innerWidth - node.offsetWidth - gap));
      const below = rect.bottom + gap;
      const top = below + node.offsetHeight <= window.innerHeight - gap ? below : Math.max(gap, rect.top - node.offsetHeight - gap);
      node.style.left = left + 'px';
      node.style.top = top + 'px';
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return { destroy() {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    } };
  }
</script>
{#key proof}
<div use:citationEvents>
  {#if paper}<ResearchPaper content={proof.displayBody ?? proof.body} {citationKeys}/>
  {:else}<MarkdownView content={proof.displayBody ?? proof.body} {citationKeys}/>{/if}
  {#if publications.length}<footer class="publications" aria-label="Report publications">
    {#each publications as item}<p><strong>{item.role==='theorist'?'Theorist':'Moderator'}</strong> published {item.kind.toLowerCase()} <b>{item.title}</b><small>v{item.version}</small></p>{/each}
  </footer>{/if}
  {#if proof.presentationIssues?.length}
    <details class="source"><summary>Presentation notes</summary><ul>{#each proof.presentationIssues as issue}<li>{issue}</li>{/each}</ul></details>
  {/if}
  {#if proof.displayBody !== undefined || proof.presentationIssues?.length || citationKeys.size}
    <details class="source"><summary>Original Markdown</summary><pre>{proof.body}</pre></details>
  {/if}
  {#if active}
    {@const doc=trail.at(-1)}
    {@const read = doc?.node??active}
    {#key trigger}
    <div bind:this={panel} use:position popover="manual" class="citation-card" role="dialog" tabindex="-1" id={dialogId} aria-labelledby={dialogId+'-title'}>
      <header>
        {#if trail.length}<button aria-label="Back to previous node" title="Back to previous node" onclick={()=>navigate()}><Icon name="back" size={16}/></button>{/if}
        {#if read.ref}{#key read.ref}<NodeReviewBadge compact bind:this={badge} {projectId} ref={read.ref} qualification={read.qualification} kind={read.kind} nodeType={read.nodeType} onchange={()=>refresh++}/>{/key}{/if}
        <button class="close" aria-label="Close citation" onclick={() => close(true)}><Icon name="close" size={16}/></button>
      </header>
      <div class="citation-body">
        <div class="statement"><h3 id={dialogId+'-title'}>{read.title ?? 'Cited node'}</h3><MarkdownView content={read.body}/></div>
        {#if read.assumptions.length}<h4>Assumptions</h4>{#each read.assumptions as assumption}<MarkdownView content={assumption}/>{/each}{/if}
        {#if read.basis?.assumptions.length}<h4>Proof conditions</h4>{#each read.basis.assumptions as condition}<MarkdownView content={condition}/>{/each}{/if}
        {#if read.ref}{#key read.ref}{#key refresh}<NodeProofs {projectId} ref={read.ref} initial={refresh?undefined:doc} fallback={read} historical={!doc} theorem={read.kind==='theorem'} onopen={navigate}/>{/key}{/key}{/if}
        {#if read.observation}<details><summary>Reported measurement</summary>
          <dl>{#each Object.entries(read.observation) as [field,value]}<dt>{field==='sourceLocator'?'Source locator':field}</dt><dd>{Array.isArray(value)?value.join(', '):value}</dd>{/each}</dl>
        </details>{/if}
        {#if read.ref}<details><summary>Version details</summary>
          <dl>{#if badge?.reviewOrigin()}<dt>Review source</dt><dd>{badge.reviewOrigin()}</dd>{/if}<dt>Node</dt><dd>{read.ref.store}/{read.ref.id} · v{read.ref.version}</dd><dt>Body hash</dt><dd><code>{read.ref.bodyHash}</code></dd>
            {#if read.domain?.length}<dt>Fields</dt><dd>{read.domain.join(', ')}</dd>{/if}
            {#if read.aliases?.length}<dt>Aliases</dt><dd>{read.aliases.join(', ')}</dd>{/if}
          </dl>
        </details>{/if}
      </div>
      <footer><button onclick={() => onmap(read)}>Show on map <span aria-hidden="true">↗</span></button></footer>
    </div>
    {/key}
  {/if}
</div>
{/key}
<style>
  footer.publications{display:block;margin:1.2rem 0 .4rem;padding:.55rem .8rem;border:0;border-inline-start:3px solid var(--color-accent);border-radius:0 5px 5px 0;background:color-mix(in srgb,var(--color-accent) 7%,var(--color-surface));font-family:var(--font-ui)}
  .publications p{margin:.16rem 0;color:var(--color-ink);font-size:.83rem;line-height:1.5}.publications strong{color:var(--color-accent);font-weight:650}.publications b{font-weight:550}.publications small{color:var(--color-muted);margin-left:.4rem}
  :global(a[data-map-citation]) { color:var(--color-link); text-decoration:underline; text-underline-offset:.16em; cursor:pointer }
  :global(a[data-map-citation]:focus-visible),.citation-card :global(:focus-visible) { outline:2px solid var(--color-accent); outline-offset:2px }
  .citation-card { position:fixed; inset:auto; margin:0; padding:0; width:min(28rem,calc(100vw - 16px)); max-height:min(30rem,calc(100dvh - 24px)); overflow:hidden; border:1px solid var(--color-line); border-radius:10px; background:var(--color-surface); color:var(--color-ink); box-shadow:0 8px 32px var(--color-scrim) }
  .citation-card:popover-open { display:flex; flex-direction:column }
  header,footer { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; padding:.65rem .9rem }
  header{padding:.55rem .85rem .3rem;gap:.35rem;max-height:46%;overflow:auto;flex-shrink:0}
  header button{display:grid;place-items:center;min-width:28px;min-height:28px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--color-muted);cursor:pointer}
  header button:hover{color:var(--color-ink);background:var(--color-selected)}
  .close{margin-inline-start:auto}
  .source{color:var(--color-muted);font-size:.85rem}
  .statement{padding:.8rem .95rem;border:1px solid color-mix(in srgb,var(--color-accent) 18%,var(--color-line));border-radius:8px;background:color-mix(in srgb,var(--color-accent) 6%,var(--color-surface));color:color-mix(in srgb,var(--color-accent) 23%,var(--color-ink));box-shadow:0 2px 5px color-mix(in srgb,var(--color-scrim) 16%,transparent)}
  .statement h3{margin:0 0 .35rem;color:color-mix(in srgb,var(--color-accent) 38%,var(--color-ink));font-size:1.22rem;font-weight:650;line-height:1.25}
  .statement :global(.markdown-view>:first-child){margin-top:0}
  .statement :global(.markdown-view>:last-child){margin-bottom:0}
  h4{margin:.15rem 0;font-size:1rem;font-weight:600}
  .citation-body { overflow:auto; overscroll-behavior:contain; padding:.3rem .9rem .7rem; min-height:0; overflow-wrap:anywhere }
  .citation-body h4,.citation-body details,.source { margin-top:.65rem }
  .citation-body dt { margin-top:.4rem; color:var(--color-muted); text-transform:capitalize; font-size:.85em }
  .citation-body dd { margin:0 }
  footer { justify-content:flex-end; border-top:1px solid var(--color-line); font-size:.9rem }
  footer button { color:var(--color-accent) }
  summary { cursor:pointer }
  .source pre { color:var(--color-ink); white-space:pre-wrap; overflow-wrap:anywhere; font-family:monospace }
</style>
