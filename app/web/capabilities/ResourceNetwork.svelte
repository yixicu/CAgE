<script lang="ts">
  import {dragNode} from './movable';
  import { tick, untrack } from 'svelte';
  import type { CapabilityItem, CapabilityNetwork } from '../../src/server/capabilities-types';
  import { prepareLayout } from './layout';
  import { presentResource } from './presentation';
  import { createSearchIndex, searchKeys } from './search';
  import DisciplineIcon from './DisciplineIcon.svelte';
  let { items, network, selectedKey = '', query = '', findRequest = 0, selectionRequest = 0, onselect }: { items: CapabilityItem[]; network: CapabilityNetwork; selectedKey?: string; query?: string; findRequest?: number; selectionRequest?: number; onselect: (item: CapabilityItem) => void } = $props();
  const uid = $props.id();
  let width = $state(600), height = $state(500), viewport = $state<HTMLDivElement>();
  let zoom = $state(1), initialized = false;
  let dragging = $state(false);
  let hoverKey = $state(''), keyboardKey = $state('');
  let matchIndex = $state(-1);
  let currentMatchKey = $state('');
  let offsets=$state<Record<string,{x:number;y:number}>>({}), panX=$state(0),panY=$state(0);
  const placement=$derived(prepareLayout(items,network));
  const graph=$derived(placement(Math.max(900,width),offsets));
  const planeOffset = $derived(Math.max(0, (width - graph.width * zoom) / 2));
  const routeLabels = $derived(new Map(network.routes.map(route => [`${route.resourceRef.id}@${route.resourceRef.version}`, route])));
  const previewKey = $derived(hoverKey || keyboardKey);
  const activeKey = $derived(selectedKey || previewKey);
  const neighbors = $derived(new Set(graph.edges.flatMap(edge => edge.fromKey === activeKey ? [edge.toKey] : edge.toKey === activeKey ? [edge.fromKey] : [])));
  const searchIndex = $derived(createSearchIndex(graph.nodes.map(node => ({ ...node.item, title: `${presentResource(node.item).label} ${routeLabels.get(`${node.item.id}@${node.item.version}`)?.title ?? ''} ${node.item.title}` }))));
  const matchedKeys = $derived(searchKeys(searchIndex, query));
  const matches = $derived(graph.nodes.filter(node => matchedKeys.has(node.item.key)));
  let previousQuery = '', previousFind = untrack(() => findRequest);
  
  const fitZoom = () => Math.max(.3, Math.min(1, (width - 32) / graph.width, (height - 32) / graph.height));
  function fit() { panX=0;panY=0;zoom = fitZoom(); void tick().then(() => viewport?.scrollTo({ left: 0, top: 0 })); }
  $effect(() => { if (!initialized && viewport && width > 0 && height > 0 && graph.nodes.length) { initialized = true; fit(); } });
  function changeZoom(value:number,px=width/2,py=height/2){
    const next=Math.max(.3,Math.min(1.8,value)),ratio=next/zoom;
    panX=px-(px-panX-planeOffset)*ratio-Math.max(0,(width-graph.width*next)/2);
    panY=py-(py-panY)*ratio;zoom=next;
  }
  function wheelZoom(node:HTMLElement){
    const wheel=(e:WheelEvent)=>{e.preventDefault();const r=node.getBoundingClientRect();changeZoom(zoom*Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top)};
    let x=0,y=0;
    const down=(e:PointerEvent)=>{if(e.button!==0||(e.target as Element).closest('button'))return;dragging=true;x=e.clientX;y=e.clientY;node.setPointerCapture(e.pointerId)};
    const move=(e:PointerEvent)=>{if(dragging){panX+=e.clientX-x;panY+=e.clientY-y;x=e.clientX;y=e.clientY}};
    const end=()=>{dragging=false};
    node.addEventListener('wheel',wheel,{passive:false});node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('lostpointercapture',end);
    return {destroy(){node.removeEventListener('wheel',wheel);node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('lostpointercapture',end)}}
  }
  async function reveal(key:string|undefined,focus=false,valid:()=>boolean=()=>true){
    await tick();const n=graph.nodes.find(n=>n.item.key===key);if(!n||!valid())return;
    panX=width/2-(n.x+n.width/2)*zoom-planeOffset;panY=height/2-(n.y+n.height/2)*zoom;
    if(focus)viewport?.querySelector<HTMLElement>('[data-resource-key="'+CSS.escape(n.item.key)+'"]')?.focus({preventScroll:true});
  }
  $effect(() => {
    const request = selectionRequest;
    if (!request) return;
    untrack(() => {
      const key = selectedKey;
      void reveal(key, false, () => selectionRequest === request && selectedKey === key);
    });
  });
  $effect(() => {
    const search = query.trim(), request = findRequest;
    const changed = search !== previousQuery, steps = request - previousFind;
    previousQuery = search; previousFind = request;
    if (!search) { currentMatchKey = ''; matchIndex = -1;  return; }
    untrack(() => {
      if (changed) { matchIndex = 0; currentMatchKey = matches[0]?.item.key ?? ''; void reveal(currentMatchKey); }
      if (steps) moveMatch(steps, false);
    });
  });
  function reconcileMatch(nodes: typeof matches) {
    const index = nodes.findIndex(node => node.item.key === currentMatchKey);
    if (index >= 0) matchIndex = index;
    else {
      // The current key disappeared: keep the existing bounded predecessor fallback.
      matchIndex = Math.min(Math.max(-1, matchIndex - 1), nodes.length - 1);
      currentMatchKey = nodes[matchIndex]?.item.key ?? '';
    }
  }
  $effect(() => {
    const nodes = matches;
    untrack(() => { if (query.trim()) reconcileMatch(nodes); });
  });
  function moveMatch(steps: number, focus: boolean) {
    if (!matches.length) return;
    // Inventory and key intent may share one render batch; reconcile exact identity
    // synchronously rather than stepping from an ordinal belonging to the old list.
    reconcileMatch(matches);
    const start = matchIndex < 0 ? (steps > 0 ? -1 : 0) : matchIndex;
    matchIndex = ((start + steps) % matches.length + matches.length) % matches.length;
    currentMatchKey = matches[matchIndex]!.item.key;
    void reveal(currentMatchKey, focus);
  }
</script>
{#if query.trim()}<div class="network-find-state" role="status"><span>{matchIndex >= 0 && matchIndex < matches.length ? matchIndex + 1 : 0} of {matches.length} {matches.length === 1 ? 'match' : 'matches'}</span><button type="button" class="network-find-next" disabled={!matches.length} onclick={() => moveMatch(1, true)}>Next match ↓</button></div>{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Native scroll region must be keyboard focusable for arrow-key scrolling.) -->
<div class="network-shell">
  <div class="network-zoom" role="group" aria-label="Tree zoom"><button type="button" aria-label="Zoom out" disabled={zoom <= .3} onclick={() => changeZoom(zoom - .1)}><svg data-zoom-symbol="minus" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button><button type="button" class="zoom-value" aria-label="Reset zoom to 100 percent" onclick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" disabled={zoom >= 1.8} onclick={() => changeZoom(zoom + .1)}><svg data-zoom-symbol="plus" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button><button type="button" aria-label="Fit tree" title="Fit tree" onclick={fit}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/></svg></button></div>
<div class="resource-network" class:network-dragging={dragging} bind:this={viewport} bind:clientWidth={width} bind:clientHeight={height} tabindex="0" role="region" aria-label="Knowledge tree, scroll horizontally and vertically" aria-describedby={`${uid}-instructions`} use:wheelZoom>
  <p id={`${uid}-instructions`} class="visually-hidden">Drag the background, use scrollbars or arrow keys to explore. Tab to a node and press Enter to read its exact version. Arrows show authored navigation relations, not proof or verified applicability. Dashed connections show comparison or complementarity.</p>
  <div class="network-extent" inert={!!selectedKey} style:width={`${graph.width * zoom}px`} style:height={`${graph.height * zoom}px`}>
  <div class="network-plane" style:left={`${planeOffset+panX}px`} style:top={`${panY}px`} style:width={`${graph.width}px`} style:height={`${graph.height}px`} style:transform={`scale(${zoom})`}>
    <svg class="network-lines" width={graph.width} height={graph.height} aria-hidden="true">
      <defs><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {#each graph.edges as edge (edge.key)}
        <path class:edge-comparison={!edge.directed} class:edge-refutation={edge.relation === 'refutes'} class:edge-focus={!selectedKey && (previewKey === edge.fromKey || previewKey === edge.toKey)} class:edge-selected={selectedKey === edge.fromKey || selectedKey === edge.toKey} data-edge-key={edge.key} data-relation={edge.relation} data-from-key={edge.fromKey} data-to-key={edge.toKey} d={edge.path} marker-end={edge.directed ? `url(#${uid}-arrow)` : undefined} />
      {/each}
    </svg>
    {#each graph.nodes as node (node.item.key)}
      {@const presentation = presentResource(node.item, routeLabels.get(`${node.item.id}@${node.item.version}`)?.title)}
      <button type="button" class="network-node" use:dragNode={(dx,dy)=>{const k=node.item.key,o=offsets[k];offsets[k]={x:(o?.x??0)+dx,y:(o?.y??0)+dy}}} class:locked={!!query.trim() && currentMatchKey===node.item.key} class:strategy-node={node.item.kind === 'strategy'} class:inactive-node={!node.item.enabled || !node.item.available} class:selected-node={selectedKey === node.item.key} class:neighbor-node={neighbors.has(node.item.key)} class:search-match={!!query.trim() && matchedKeys.has(node.item.key)} style:left={`${node.x}px`} style:top={`${node.y}px`} data-resource-key={node.item.key} aria-pressed={selectedKey === node.item.key} aria-label={`${presentation.fullLabel}, ${presentation.typeLabel}, version ${node.item.version}${!node.item.available ? ', unavailable' : !node.item.enabled ? ', disabled' : ''}`} title={`${presentation.fullLabel}\nv${node.item.version} · ${presentation.typeLabel}\n${node.item.description}`} onclick={() => onselect(node.item)} onfocus={() => keyboardKey = node.item.key} onblur={() => keyboardKey = ''} onpointerenter={() => hoverKey = node.item.key} onpointerleave={() => hoverKey = ''}>
        <span class="node-symbol" aria-hidden="true"><svg class="node-shape" width="76" height="76" viewBox="0 0 76 76">{#if node.item.kind === 'strategy'}<path d="M38 2 69 20v36L38 74 7 56V20Z" />{:else}<circle cx="38" cy="38" r="34" />{/if}</svg><DisciplineIcon glyph={presentation.glyph} /></span>
        <span class="node-label">{node.item.title}</span>
        {#if !node.item.available || !node.item.enabled}<span class="node-state" aria-hidden="true">{!node.item.available ? 'Unavailable' : 'Not loaded'}</span>{/if}
      </button>
    {/each}
  </div>
  </div>
</div>
<button class="network-minimap" type="button" onclick={fit} aria-label="Overview: fit entire tree" title="Fit entire tree"><svg viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">{#each graph.edges as edge (edge.key)}<path d={edge.path} fill="none" stroke="currentColor" stroke-width="2" />{/each}{#each graph.nodes as node (node.item.key)}<circle cx={node.x + node.width / 2} cy={node.y + 38} r="10" class:mini-strategy={node.item.kind === 'strategy'} />{/each}<rect x={(-panX-planeOffset)/zoom} y={-panY/zoom} width={Math.min(width / zoom, graph.width)} height={Math.min(height / zoom, graph.height)} class="mini-window" /></svg></button>
</div>
