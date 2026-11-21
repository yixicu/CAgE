<script lang="ts">
  import { tick } from 'svelte';
  import type { SavedProof } from '../api';
  import type { MapOpenResult } from '../../src/learning/knowledge-map';
  import NodeReviewBadge from '../NodeReviewBadge.svelte';
  import ResearchPaper from '../ResearchPaper.svelte';
  import MarkdownView from '../MarkdownView.svelte';

  let { proof, projectId, onmap, paper = true }: { proof: SavedProof; projectId:string; onmap: (read: MapOpenResult) => void; paper?: boolean } = $props();
  const dialogId = $props.id();
  const reads = $derived(new Map((proof.citations ?? []).filter(read => read.ref).map(read => [read.selection, read])));
  const citationKeys = $derived(new Set(reads.keys()));
  let active = $state<MapOpenResult>();
  let trigger = $state<HTMLAnchorElement>();
  let panel = $state<HTMLElement>();
  let hideTimer: ReturnType<typeof setTimeout>;
  let restoring = false;
  let pinned = false;

  function close(restore = false) {
    clearTimeout(hideTimer);
    const lastTrigger = trigger;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.removeAttribute('aria-controls');
    trigger = undefined;
    active = undefined;
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
  {#if proof.presentationIssues?.length}
    <details class="source"><summary>Presentation notes</summary><ul>{#each proof.presentationIssues as issue}<li>{issue}</li>{/each}</ul></details>
  {/if}
  {#if proof.displayBody !== undefined || proof.presentationIssues?.length || citationKeys.size}
    <details class="source"><summary>Original Markdown</summary><pre>{proof.body}</pre></details>
  {/if}
  {#if active}
    {@const read = active}
    {#key trigger}
    <div bind:this={panel} use:position popover="manual" class="citation-card" role="dialog" tabindex="-1" id={dialogId} aria-labelledby={dialogId+'-title'}>
      <header><div><small>{read.nodeType ?? read.kind} · v{read.ref?.version} · cited as {read.qualification}</small>
        <h3 id={dialogId+'-title'}>{read.title ?? 'Cited node'}</h3></div>
        <button aria-label="Close citation" onclick={() => close(true)}>×</button></header>
      {#if read.ref}<NodeReviewBadge {projectId} ref={read.ref} qualification={read.qualification} kind={read.kind}/>{/if}
      <div class="citation-body">
        <MarkdownView content={read.body}/>
        {#if read.assumptions.length}<h4>Assumptions</h4>{#each read.assumptions as assumption}<MarkdownView content={assumption}/>{/each}{/if}
        {#if read.basis?.assumptions.length}<h4>Proof conditions</h4>{#each read.basis.assumptions as condition}<MarkdownView content={condition}/>{/each}{/if}
        {#if read.suppliedProof}<details><summary>Supplied proof</summary><MarkdownView content={read.suppliedProof.argument}/></details>{/if}
        {#each read.supports.filter(s => s.argument && s.argument !== read.suppliedProof?.argument) as support}<details><summary>Supporting argument · {support.status}</summary><MarkdownView content={support.argument}/></details>{/each}
        {#if read.observation}<details><summary>Reported measurement</summary>
          <dl>{#each Object.entries(read.observation) as [field,value]}<dt>{field==='sourceLocator'?'Source locator':field}</dt><dd>{Array.isArray(value)?value.join(', '):value}</dd>{/each}</dl>
        </details>{/if}
        {#if read.ref}<details><summary>Version details</summary>
          <dl><dt>Node</dt><dd>{read.ref.store}/{read.ref.id} · v{read.ref.version}</dd><dt>Body hash</dt><dd><code>{read.ref.bodyHash}</code></dd>
            {#if read.domain?.length}<dt>Fields</dt><dd>{read.domain.join(', ')}</dd>{/if}
            {#if read.aliases?.length}<dt>Aliases</dt><dd>{read.aliases.join(', ')}</dd>{/if}
          </dl>
        </details>{/if}
      </div>
      <footer><button onclick={() => onmap(read)}>Show on knowledge map ↗</button></footer>
    </div>
    {/key}
  {/if}
</div>
{/key}
<style>
  :global(a[data-map-citation]) { color:var(--color-link); text-decoration:underline; text-underline-offset:.16em; cursor:pointer }
  :global(a[data-map-citation]:focus-visible),.citation-card :global(:focus-visible) { outline:2px solid var(--color-accent); outline-offset:2px }
  .citation-card { position:fixed; inset:auto; margin:0; padding:0; width:min(28rem,calc(100vw - 16px)); max-height:min(30rem,calc(100dvh - 24px)); overflow:hidden; border:1px solid var(--color-line); border-radius:10px; background:var(--color-surface); color:var(--color-ink); box-shadow:0 8px 32px var(--color-scrim) }
  .citation-card:popover-open { display:flex; flex-direction:column }
  header,footer { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; padding:.65rem .9rem }
  header { border-bottom:1px solid var(--color-line) }
  header small,.source { color:var(--color-muted); font-size:.85rem }
  header h3,h4 { margin:.15rem 0; font-size:1rem; font-weight:600 }
  header button { min-width:2rem; min-height:2rem; line-height:1; font-size:1.25rem }
  .citation-body { overflow:auto; overscroll-behavior:contain; padding:.8rem .9rem; min-height:0; overflow-wrap:anywhere }
  .citation-body h4,.citation-body details,.source { margin-top:.65rem }
  .citation-body dt { margin-top:.4rem; color:var(--color-muted); text-transform:capitalize; font-size:.85em }
  .citation-body dd { margin:0 }
  footer { justify-content:flex-end; border-top:1px solid var(--color-line); font-size:.9rem }
  footer button { color:var(--color-accent) }
  summary { cursor:pointer }
  .source pre { color:var(--color-ink); white-space:pre-wrap; overflow-wrap:anywhere; font-family:monospace }
</style>
