<script lang="ts">
  import type { LoopView } from './loop-view';
  import type { DiagramView } from './diagram-view';
  import MonitorNode from './MonitorNode.svelte';
  import { routeDiagram, type NodeBox, type DiagramGeometry } from './diagram-layout';
  import MonitorEdge from './MonitorEdge.svelte';
  let { view, diagram, background, learning=false }: { learning?:boolean; background?:{reports:boolean;map:boolean}; view: LoopView; diagram: DiagramView } = $props();
  let host: HTMLDivElement;
  let geometry = $state<DiagramGeometry>({ width: 0, height: 0, points: {} });
  const placement = (branch: DiagramView['branches'][number]) => branch.placementId ?? (branch.kind === 'documents' ? branch.sourceId : branch.targetId);
  $effect(() => {
    const element = host, ids = diagram.nodes.map(node => node.id).join('|') + diagram.branches.map(placement).join('|');
    if (!element) return;
    let frame = 0;
    function measure() {
      const root = element.getBoundingClientRect(), points: Record<string, NodeBox> = {};
      for (const item of element.querySelectorAll<HTMLElement>('[data-monitor-node]')) {
        const r = item.getBoundingClientRect();
        points[item.dataset.monitorNode!] = { x: r.x - root.x + r.width / 2, y: r.y - root.y + r.height / 2, left: r.left - root.left, right: r.right - root.left, top: r.top - root.top, bottom: r.bottom - root.top };
      }
      geometry = { width: root.width, height: root.height, points };
    }
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(element);
    for (const item of element.querySelectorAll('[data-monitor-node]')) observer.observe(item);
    frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  });
  let routes = $derived(routeDiagram(diagram, geometry));
</script>
<section class="min-w-0 rounded-xl border border-line bg-surface px-2 py-3" aria-label={`${view.title} monitor`}>
  <div class="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-1 px-1">
    <strong class="text-xs">{view.title}</strong>
    {#if view.stale}<span class="text-micro text-muted" role="status" title={view.progress}>Status unavailable</span>{:else if view.control}<span class="text-micro text-muted" role="status" title={view.control}>{view.control.startsWith('Stop') ? 'Stopping' : 'Pause queued'}</span>{:else if !view.live}<span class="text-micro text-muted" role="status" title={view.progress}>{view.current}</span>{/if}
  </div>
  <div class="relative min-w-0 px-2" bind:this={host}>
    {#if geometry.width}
      <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible" width={geometry.width} height={geometry.height} aria-hidden="true">
        <defs><marker id="research-monitor-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 L6 4 L1 7" fill="none" stroke="context-stroke" stroke-width="1" /></marker></defs>
        {#each routes.main as edge (edge.id)}<MonitorEdge path={edge.path} active={edge.active} />{/each}
        {#each routes.feeders as edge (edge.id)}<MonitorEdge path={edge.path} dashed arrow={false} label={edge.label} />{/each}
        {#each routes.stems as edge (edge.id)}<MonitorEdge path={edge.path} dashed bridge arrow={false} />{/each}
        {#each routes.inputs as edge (edge.id)}<MonitorEdge path={edge.path} dashed bridge={edge.id === 'documents'} active={edge.active} label={edge.label} />{/each}
        {#each routes.outputs as edge (edge.id)}<MonitorEdge path={edge.path} dashed bridge active={edge.active} motion={edge.id !== 'user-input'} label={edge.label} />{/each}
        <MonitorEdge path={routes.repeat} dashed label="Continue / refine at the next planning boundary." />
      </svg>
    {/if}
    {#each diagram.nodes as node (node.id)}
      <div class="grid min-w-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-x-4 py-1">
        <div class="min-w-0"><MonitorNode {node} active={diagram.activeIds.includes(node.id)} /></div>
        <div></div>
      </div>
      {#each diagram.branches.filter(branch => placement(branch) === node.id) as branch (branch.id)}
        <div class="grid min-w-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-x-4">
          <div></div>
          <div class="min-w-0"><MonitorNode node={{...branch, detail: `${branch.detail} Trigger: ${branch.condition}.`}} active={branch.running} dashed /></div>
        </div>
      {/each}
    {/each}
  </div>
  {#if diagram.version===4 && view.version===3}
    <section class="post-report" aria-label="Post-report research">
      <div class="background-box" class:working={background?.reports||background?.map||learning} role="status">
        <strong>Background monitor</strong>
        <span>{!background&&!learning?'Unavailable':[learning?'Skill / Strategy learning':null,background?.reports?'Report research':null,background?.map?'Map maintenance':null].filter(Boolean).join(' · ')||'Idle'}</span>
      </div>
      <h3>After a public report</h3>
      <ol><li>Report research</li><li>Independent review</li><li>Publish finding or theory</li></ol>
    </section>
  {/if}
</section>
<style>
.post-report{border-top:1px solid var(--color-line);margin-top:.65rem;padding:.6rem .35rem 0}
.post-report h3{margin:0 0 .5rem;color:var(--color-muted);font-size:.72rem;font-weight:500}
.post-report ol{margin:0;padding:0;list-style:none;display:grid;gap:5px}
.post-report li{border-inline-start:2px solid var(--color-accent);padding:4px 8px;background:var(--color-tint);color:var(--color-ink);font-size:.75rem}
.background-box{display:grid;gap:3px;border:1px solid var(--color-line);border-radius:8px;padding:8px;margin:0 0 8px;font-size:.78rem}.background-box span{color:var(--color-muted)}.background-box.working{border-color:var(--color-success);background:var(--color-success-soft)}.working strong::before{content:"";display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--color-success)}
</style>