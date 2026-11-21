<script lang="ts">
  import CagesEmpty from './CagesEmpty.svelte';
 import {onDestroy,onMount,untrack} from "svelte";
 import {api} from './api';
 import type {MapEntry,MapRef} from '../src/learning/knowledge-map';
 import {classifyField,FIELD_CATALOG,canonicalFieldId} from '../src/shared/knowledge-fields';
 let ready=$state(false);
 import {sphericalLayout,fieldWashes,arrowPoints,globeRadius,planarLayout} from './capabilities/map-geometry';
 import {movable,dragNode} from './capabilities/movable';
 const scientificType=(n:MapEntry)=>n.nodeType??n.kind;
 const discipline=(n:MapEntry)=>n.domain.some(t=>t.includes(':'))?classifyField(n.domain):n.domain.map(canonicalFieldId).find(Boolean)??'general';
 const strokes:Record<string,string>={prerequisite:'none','uses-definition':'2 4','upper-structure':'12 4',related:'1 6',specializes:'7 3 2 3',tests:'9 4 2 4',measures:'4 3','measured-in':'4 3 1 3','member-of':'12 3 3 3'};
 type FieldChoice=keyof typeof FIELD_CATALOG | '';
 let field=$state<FieldChoice>('');
 import MarkdownView from './MarkdownView.svelte';
 import {containDialogFocus} from './capabilities/dialog-focus';
 let typesMenu=$state<HTMLDetailsElement>(), fieldsMenu=$state<HTMLDetailsElement>();
 let result=$state<Awaited<ReturnType<typeof api.coreMap>>>(), error=$state(''), selected=$state<CoreEntry>(), draft=$state(''), expanded=$state(false),sending=$state(false),notice=$state('');
 onMount(()=>{let live=true;api.coreMap().then(value=>{if(live)result=value}).catch(e=>{if(live)error=e.message}).finally(()=>{if(live)ready=true});return ()=>{live=false};});
 type CoreEntry=Awaited<ReturnType<typeof api.coreMap>>['entries'][number];
 const key=(ref:MapRef)=>ref.store+'/'+ref.id;
 let published=$derived.by(()=>{
   const latest=new Map<string,CoreEntry>();
   for(const e of result?.entries??[])if((!latest.has(key(e.ref)) || latest.get(key(e.ref))!.ref.version<e.ref.version))latest.set(key(e.ref),e);
   return [...latest.values()].filter(e=>e.status==='active');
 });

 let editing=$state(false),filter=$state(''), offsets=$state<Record<string,{x:number;y:number}>>({});
 let inventory=$derived(published);
 let nodes=$derived(inventory.filter(n=>(!filter||scientificType(n)===filter)&&(!field||discipline(n)===field))), edges=$derived(result?.relations??[]);
 const address=(ref:MapRef)=>key(ref)+'@'+ref.version;
 let base=$derived(planarLayout(nodes.map(n=>address(n.ref)),edges.filter(e=>e.status==='active').map(e=>({from:address(e.from),to:address(e.to)})),new Map(nodes.map(n=>[address(n.ref),discipline(n)]))));
 let planar=$derived.by(()=>new Map(nodes.map(n=>{const k=address(n.ref),p=base.get(k)!;return [k,{x:p.x+(offsets[k]?.x??0),y:p.y+(offsets[k]?.y??0)}]})));
 let sphere=$state(false),longitude=$state(0),latitude=$state(0);
 const radius=$derived(globeRadius(inventory.length));
 const anchors=$derived.by(()=>{
   const groups=new Map<string,string[]>();
   for(const n of inventory){const f=discipline(n);if(!groups.has(f))groups.set(f,[]);groups.get(f)!.push(address(n.ref))}
   return sphericalLayout(groups);
 });
 let moved=$state<Record<string,{lat:number;lon:number}>>({});
 const anchor=(k:string)=>moved[k]??anchors.get(k);
 function moveOnGlobe(k:string,dx:number,dy:number){
   const p=globe.get(k);if(!p)return;
   let u=(p.x+dx-radius)/radius,v=(radius-p.y-dy)/radius;
   const magnitude=Math.hypot(u,v);if(magnitude>.9999){u*=.9999/magnitude;v*=.9999/magnitude}
   const z=Math.sqrt(Math.max(0,1-u*u-v*v)),c=Math.cos(latitude),t=Math.sin(latitude);
   moved[k]={lat:Math.asin(Math.max(-1,Math.min(1,v*c+z*t))),lon:longitude+Math.atan2(u,z*c-v*t)};
 }
 const globe=$derived.by(()=>new Map(nodes.map(n=>{
   const k=address(n.ref),a=anchor(k)!,lon=a.lon-longitude;
   const horizontal=Math.cos(a.lat)*Math.sin(lon),vertical=Math.sin(a.lat),depth=Math.cos(a.lat)*Math.cos(lon);
   const z=vertical*Math.sin(latitude)+depth*Math.cos(latitude);
   return [k,{x:radius+radius*horizontal,y:radius-radius*(vertical*Math.cos(latitude)-depth*Math.sin(latitude)),z}];
 })));
 const positions=$derived(sphere?globe:planar);
 const front=(k:string)=>!sphere||(globe.get(k)?.z??-1)>=0;
 const washes=$derived.by(()=>{
   const groups=new Map<string,{x:number;y:number}[]>();
   for(const n of nodes){const k=address(n.ref);if(!front(k))continue;
     const f=discipline(n);if(!groups.has(f))groups.set(f,[]);groups.get(f)!.push(positions.get(k)!)}
   return fieldWashes(groups);
 });
 let flight=0;
 const fieldIds=$derived([...new Set(inventory.map(discipline))].sort());
 const fieldOptions=$derived(['' as const,...fieldIds]);
 const fieldPalette=$derived.by(()=>{
   // Alternate between halves of the hue wheel so adjacent menu entries stand apart.
   const count=fieldIds.length, half=Math.ceil(count/2);
   return new Map<string,string>(fieldIds.map((id,index)=>{
     const slot=Math.floor(index/2)+(index%2)*half;
     const hue=(24+360*slot/count)%360;
     return [id,`oklch(${slot%2?0.79:0.84} 0.095 ${hue})`];
   }));
 });
 const fieldTone=(field:string)=>fieldPalette.get(field)??'var(--color-selected)';
 function stopFlight(){cancelAnimationFrame(flight)}
 function aim(k:string){
   stopFlight();
   const target=sphere?{x:radius,y:radius}:planar.get(k);
   if(!target)return;
   const startX=x,startY=y,startLon=longitude,startLat=latitude;
   const destX=width/2-scale*target.x,destY=height/2-scale*target.y;
   const a=sphere?anchor(k):undefined;
   const angle=a?a.lon-startLon:0,dlon=Math.atan2(Math.sin(angle),Math.cos(angle));
   const dlat=a?a.lat-startLat:0;
   const distance=Math.max(Math.hypot(destX-x,destY-y),Math.hypot(dlon,dlat)*radius*scale);
   const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.min(680,220+distance*.25);
   const start=performance.now();
   function step(now:number){
     const progress=duration?Math.min(1,(now-start)/duration):1;
     const t=progress*progress*(3-2*progress);
     x=startX+(destX-startX)*t;y=startY+(destY-startY)*t;
     if(a){longitude=startLon+dlon*t;latitude=startLat+dlat*t}
     if(progress<1)flight=requestAnimationFrame(step);
   }
   step(start);
 }
 onDestroy(stopFlight);
 function rotate(dx:number,dy:number){longitude-=dx/(radius*scale);latitude=Math.max(-Math.PI/2,Math.min(Math.PI/2,latitude+dy/(radius*scale)))}
 function switchView(){stopFlight();sphere=!sphere;longitude=0;latitude=0;scale=sphere?Math.min(2.5,Math.min(width,height)*.44/radius):1;if(currentMatch)aim(address(currentMatch.ref));else center(boardWidth/2,boardHeight/2)}
 function incident(r:{from:MapRef;to:MapRef}){return selected && [address(r.from),address(r.to)].includes(address(selected.ref))}
 let neighbors=$derived(new Set(edges.filter(e=>e.status==='active'&&incident(e)).flatMap(e=>[address(e.from),address(e.to)])));
 let boardWidth=$derived(sphere?2*radius:Math.max(300,...Array.from(positions.values(),p=>p.x+220))),boardHeight=$derived(sphere?2*radius:Math.max(240,...Array.from(positions.values(),p=>p.y+120)));
 let width=$state(0),height=$state(0),scale=$state(1),x=$state(0),y=$state(0);
 let query=$state(''),match=$state(0);
 const matches=$derived(query.trim()?nodes.filter(n=>n.title.toLowerCase().includes(query.trim().toLowerCase())):[]);
 const currentMatch=$derived(matches[match%matches.length]);
 function center(px:number,py:number){x=width/2-scale*px;y=height/2-scale*py}
 function overview(){stopFlight();scale=Math.min(1,(width-24)/boardWidth,(height-24)/boardHeight);center(boardWidth/2,boardHeight/2)}
 $effect(()=>{const layout=base;if(width>24&&height>24&&layout.size)untrack(()=>{const n=currentMatch;if(n)aim(address(n.ref));else center(boardWidth/2,boardHeight/2)})});
 $effect(()=>{const n=currentMatch;if(n)untrack(()=>aim(address(n.ref)));else stopFlight()});
 function next(step=1){if(matches.length){match=(match+step+matches.length)%matches.length;aim(address(matches[match]!.ref))}}
 function camera(node:HTMLElement){
   let pointer:number|undefined,left=0,top=0;
   function down(e:PointerEvent){stopFlight();if(e.button!==0||(e.target as Element).closest('button'))return;pointer=e.pointerId;left=e.clientX;top=e.clientY;node.setPointerCapture(pointer)}
   function move(e:PointerEvent){if(pointer===e.pointerId){const dx=e.clientX-left,dy=e.clientY-top;if(sphere)rotate(dx,dy);else{x+=dx;y+=dy}left=e.clientX;top=e.clientY}}
   function end(){pointer=undefined}
   function wheel(e:WheelEvent){stopFlight();e.preventDefault();const r=node.getBoundingClientRect(),px=e.clientX-r.left,py=e.clientY-r.top;
     const minimum=Math.min(.08,Math.max(1,width-24)/boardWidth,Math.max(1,height-24)/boardHeight);
     const z=Math.max(minimum,Math.min(2.5,scale*Math.exp(-e.deltaY*.0015)));x=px-(px-x)*z/scale;y=py-(py-y)*z/scale;scale=z}
   node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('lostpointercapture',end);node.addEventListener('wheel',wheel,{passive:false});
   return {destroy(){node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('lostpointercapture',end);node.removeEventListener('wheel',wheel)}}
 }
 function open(n:CoreEntry){editing=false;selected=n;draft=n.body??'';expanded=false;notice=''}
 async function submit(){
   if(!selected||sending)return;
   sending=true;
   try{await api.sendMaintenance({requestId:crypto.randomUUID(),allowChanges:true,message:`In the shared core-map, review and apply this body revision only if the exact original node version still matches. Node: ${JSON.stringify(selected.ref)}\nReplacement body:\n${draft}`});notice='Submitted for maintenance review.'}catch(e){notice=String(e)}finally{sending=false}
 }
</script>
<svelte:window onpointerdown={e=>{for(const menu of [typesMenu,fieldsMenu])if(menu?.open&&!menu.contains(e.target as Node))menu.open=false}} onkeydown={e=>{if(e.key==='Escape')for(const menu of [typesMenu,fieldsMenu])if(menu?.open){menu.open=false;menu.querySelector('summary')?.focus()}}}/>
<section class="map">{#if !ready}<p role="status">Loading map…</p>{:else if !published.length}<header><h1>Knowledge map</h1></header>{#if error}<p role="alert">{error}</p>{:else}<div class="map-empty-body"><CagesEmpty message="No basic physics knowledge map installed." /></div>{/if}{:else}<header><h1>Knowledge map</h1><button class="sphere-toggle" aria-label="Spherical view" aria-pressed={sphere} onclick={switchView}>{sphere?"Sphere":"Plane"} ⇄</button><input class="map-search" type="search" aria-label="Search node titles" placeholder="Search titles" bind:value={query} oninput={()=>match=0} onkeydown={e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();next(e.shiftKey?-1:1)}}}/>
<details class="types" bind:this={typesMenu}><summary><i data-kind={filter}></i>{filter||'All types'} ▾</summary><div>{#each ['',...new Set(inventory.map(scientificType))] as kind}<button aria-pressed={filter===kind} onclick={e=>{filter=kind;match=0;e.currentTarget.closest('details')!.open=false}}><i data-kind={kind}></i>{kind||'All types'}</button>{/each}</div></details><details class="types fields" bind:this={fieldsMenu}><summary aria-label="Scientific field" style:--field-tone={field?fieldTone(field):'var(--color-selected)'}>{field?FIELD_CATALOG[field].label:'All fields'} ▾</summary><div>{#each fieldOptions as f}<button aria-pressed={field===f} style:--field-tone={f?fieldTone(f):'var(--color-selected)'} onclick={()=>{field=f;match=0;if(fieldsMenu)fieldsMenu.open=false}}>{f?FIELD_CATALOG[f].label:'All fields'}</button>{/each}</div></details>
<span class="map-choice">Core map</span></header>
{#if error}<p role="alert">{error}</p>{:else}<div class="map-stage">{#if query.trim()}<div class="network-find-state"><span role="status">{matches.length?match%matches.length+1:0} of {matches.length} {matches.length===1?"match":"matches"}</span><button class="network-find-next" disabled={!matches.length} onclick={()=>next()}>Next match ↓</button></div>{/if}<div class="scroll" bind:clientWidth={width} bind:clientHeight={height} use:camera><div class="board" inert={!!selected} class:globe={sphere} style:transform={`translate(${x}px,${y}px) scale(${scale})`} style:width={boardWidth+'px'} style:height={boardHeight+'px'}>
<svg width="100%" height="100%" aria-hidden="true">{#if sphere}<circle class="globe-disc" cx={radius} cy={radius} r={radius-1}/>{/if}<defs><radialGradient id="globe-surface" cx="36%" cy="27%" r="78%"><stop offset="0" stop-color="var(--color-surface)"/><stop offset=".72" stop-color="var(--color-canvas)"/><stop offset="1" stop-color="var(--color-selected)"/></radialGradient><clipPath id="sphere-wash-clip"><circle cx={radius} cy={radius} r={radius-1}/></clipPath>{#each washes as wash (wash.field)}<radialGradient id={'wash-'+wash.field}><stop stop-color={fieldTone(wash.field)} stop-opacity=".48"/><stop offset=".55" stop-color={fieldTone(wash.field)} stop-opacity=".26"/><stop offset="1" stop-color={fieldTone(wash.field)} stop-opacity="0"/></radialGradient>{/each}<marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor"/></marker></defs><g clip-path={sphere?"url(#sphere-wash-clip)":undefined}>{#each washes as w (w.field)}<ellipse cx={w.x} cy={w.y} rx={w.rx} ry={w.ry} fill={"url(#wash-"+w.field+")"}/>{/each}</g>
{#each edges as r}{@const a=positions.get(key(r.from)+'@'+r.from.version)}{@const b=positions.get(key(r.to)+'@'+r.to.version)}{#if a&&b&&front(address(r.from))&&front(address(r.to))&&r.status==='active'}<polyline data-relation={r.kind} points={arrowPoints(a,b,scale,r.direction==='forward')} fill="none" stroke-dasharray={strokes[r.kind]} class:incident={incident(r)} marker-mid={r.direction==='forward'?'url(#map-arrow)':undefined}/>{/if}{/each}</svg>
{#each nodes as n}{@const pos=positions.get(address(n.ref))!}{#if front(address(n.ref))}<button class="node" style:--field-color={fieldTone(discipline(n))} data-kind={scientificType(n)} aria-label={scientificType(n)+": "+n.title} class:neighbor={neighbors.has(address(n.ref)) || n===currentMatch} use:dragNode={(dx,dy)=>{if(sphere){moveOnGlobe(address(n.ref),dx,dy);return}const k=address(n.ref),o=offsets[k];offsets[k]={x:(o?.x??0)+dx,y:(o?.y??0)+dy}}} style:left={pos.x+'px'} style:top={pos.y+'px'} onclick={()=>open(n)}><i aria-hidden="true"></i><span>{n.title}</span></button>{/if}{/each}</div></div>
{#if edges.length}<aside class="edge-key" aria-label="Relations">{#each [...new Set(edges.filter(e=>e.status==="active").map(e=>e.kind))] as kind}<span><svg width="30" height="8" aria-hidden="true"><line x1="1" y1="4" x2="29" y2="4" stroke="currentColor" stroke-dasharray={strokes[kind]}/></svg>{kind}</span>{/each}</aside>{/if}<button class="network-minimap" aria-label="Fit knowledge map" onclick={overview}><svg viewBox={`0 0 ${boardWidth} ${boardHeight}`} aria-hidden="true">{#each edges as r}{@const a=positions.get(address(r.from))}{@const b=positions.get(address(r.to))}{#if a&&b&&front(address(r.from))&&front(address(r.to))&&r.status==='active'}<line stroke-dasharray={strokes[r.kind]} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" stroke-width="4"/>{/if}{/each}{#each positions as [k,pos]}<circle cx={pos.x} cy={pos.y} r="14" opacity={front(k)?1:.2}/>{/each}<rect class="mini-window" x={-x/scale} y={-y/scale} width={width/scale} height={height/scale}/></svg></button></div>{/if}
{#if selected}<div class="sheet" use:movable={'dialog'} class:expanded role="dialog" aria-modal="true" aria-labelledby="map-title" tabindex="-1" use:containDialogFocus={()=>{if(!sending)selected=undefined}}>
<header><h2 id="map-title">{selected.title}</h2><button aria-label={editing?"Read document":"Edit node"} onclick={()=>editing=!editing}>{editing?"Read":"Edit"}</button><button aria-label="Toggle expanded editor" onclick={()=>expanded=!expanded}>⛶</button><button aria-label="Close node" disabled={sending} onclick={()=>selected=undefined}>×</button></header>
<div class:split={editing} class:reading={!editing}>{#if editing}<textarea aria-label="Node Markdown" bind:value={draft} disabled={sending||selected.body===undefined}></textarea>{/if}<article><MarkdownView content={draft}/>{#if !editing}{#each selected.assumptions as assumption}<MarkdownView content={assumption}/>{/each}{#each [...new Set([selected.suppliedProof?.argument,...(selected.supports??[]).filter(s=>s.status==='proved').map(s=>s.argument)].filter(Boolean))] as argument}<MarkdownView content={argument??''}/>{/each}{/if}</article></div><footer><span role="status">{notice}</span>{#if editing}<button disabled={sending||!draft.trim()||draft===selected.body} onclick={submit}>Submit for review</button>{/if}</footer></div>{/if}{/if}</section>
<style>
.map{font-family:"Times New Roman",serif}.scroll{flex:1;cursor:grab}.board{transform-origin:0 0}.sheet header{cursor:move}.sheet.expanded{translate:0 0!important}.map{position:relative;height:100%;min-height:0;padding:1rem;display:flex;flex-direction:column}.map header,.map footer{display:flex;align-items:center;gap:.6rem}.map h1,.map h2{margin:0 auto 0 0;font-size:1.15rem}.scroll,.split article{overflow:auto}.board{position:relative}.board svg{opacity:.5}.node,.sheet{background:var(--color-surface);color:inherit;border:1px solid var(--color-line);border-radius:12px}.node{position:absolute;display:grid;align-content:center;width:190px;height:62px;text-align:left;padding:.4rem .8rem;overflow:hidden}.sheet{position:absolute;inset:12% 5%;padding:1rem;display:flex;flex-direction:column;gap:1rem;box-shadow:0 12px 50px var(--color-scrim)}.expanded{inset:0}.split{display:grid;grid-template-columns:1fr 1fr;min-height:0;flex:1}.split>*{min-width:0;padding:1rem}.split textarea{color:inherit;background:transparent;resize:none}.map footer{justify-content:flex-end}@media(max-width:640px){.split{grid-template-columns:1fr;grid-template-rows:1fr 1fr}}

.reading{overflow:auto;line-height:1.7}.sheet:not(.expanded):has(.reading){inset:8% 3% auto auto;width:min(440px,94%);max-height:82%}.sheet header{border-bottom:1px solid var(--color-line);padding-bottom:.75rem}.board svg{opacity:1}.node{display:flex;align-items:center;gap:9px}.types i,.node i{flex:none;width:12px;height:12px;background:var(--color-info);border-radius:50%}.types i[data-kind=theorem],.node[data-kind=theorem] i{border-radius:1px;transform:rotate(45deg);background:var(--color-accent)}.types i[data-kind=observation],.node[data-kind=observation] i{border-radius:2px;background:var(--color-success)}.types i[data-kind=theory],.node[data-kind=theory] i{background:var(--color-warning);clip-path:polygon(50% 0,100% 100%,0 100%)}.node.neighbor{box-shadow:0 0 0 2px var(--color-accent),0 4px 16px var(--color-scrim)}.scroll{border:1px solid var(--color-line);border-radius:14px;background:var(--color-canvas)}.map header{padding-bottom:.5rem}
.map>header h1{white-space:nowrap}.map>header{flex-wrap:wrap}.sheet header button{flex:none}
:global(.main-scroll:has(>.map)){padding:0}.map{padding:0 10px 8px}.map>header{padding:4px 6px;min-height:36px}.map-search{width:min(160px,32vw);height:28px;padding:2px 8px}.map-stage{position:relative;flex:1;min-height:0}.map-stage .scroll{position:absolute;inset:0;overflow:clip}.map-stage .network-find-state{position:absolute;left:10px;top:8px;z-index:1;background:var(--color-surface);border-radius:6px;padding:3px 6px}.types{position:relative}.types summary,.types button{display:flex;align-items:center;gap:7px;padding:4px 8px;cursor:pointer}.types summary{list-style:none;border:1px solid var(--color-line);border-radius:6px;background:var(--color-surface)}.types div{position:absolute;right:0;min-width:130px;background:var(--color-surface);border:1px solid var(--color-line);z-index:6;border-radius:8px;box-shadow:0 5px 16px var(--color-scrim)}.types button{width:100%;text-align:left}.types i[data-kind=""]{background:var(--color-muted)}.map-stage .network-minimap{position:absolute;bottom:12px;right:12px}.sheet{z-index:5}
.map-stage .network-minimap circle{fill:var(--color-accent)}.map-stage .network-minimap line{stroke:var(--color-line-strong)}.map-stage .mini-window{stroke:var(--color-accent);stroke-width:1;vector-effect:non-scaling-stroke}.map>header{height:auto;min-height:34px;max-height:none;margin:0;padding:2px 6px;gap:6px;flex:none}.types i[data-kind=definition],.node[data-kind=definition] i{border-radius:2px;background:var(--color-warning)}.types i[data-kind=basic-knowledge],.node[data-kind=basic-knowledge] i{clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);background:var(--color-accent)}.edge-key span{display:flex;align-items:center;gap:8px;white-space:nowrap;padding:4px 8px}.globe-disc{fill:var(--color-surface);stroke:var(--color-line-strong);stroke-width:2}.sphere-toggle{font:inherit;border-radius:6px;padding:3px 7px}.sphere-toggle[aria-pressed=true]{background:var(--color-selected)}.globe .node{box-shadow:0 2px 8px var(--color-scrim)}.globe .node{font-size:calc(22px * var(--ui-font-scale,1));line-height:1.12}.globe-disc{fill:url(#globe-surface)}.globe .node.neighbor{box-shadow:0 0 0 3px var(--color-accent),0 3px 12px var(--color-scrim)}.edge-key{position:absolute;left:10px;bottom:10px;padding:4px 6px;border:1px solid var(--color-line);border-radius:6px;background:var(--color-surface);font-size:11px;line-height:1.2;pointer-events:none}.edge-key span{padding:2px 3px;gap:5px}.edge-key svg{width:24px}.map-empty-body{display:grid;place-items:center}.map-empty-body{flex:1;min-height:220px}.map>header :is(input,summary,button){box-sizing:border-box;height:28px;min-height:28px;max-height:28px;margin-block:0;padding-block:0;align-content:center}
.board polyline{stroke:var(--color-line-strong);stroke-linecap:round}.board polyline.incident{stroke:var(--color-accent);stroke-width:2}.node,.types i{--type-color:#309fdb}
[data-kind=definition]{--type-color:#ff984b}.node[data-kind=theorem],.types i[data-kind=theorem]{--type-color:#9670ed}.node[data-kind=theory],.types i[data-kind=theory]{--type-color:#f379a2}.node[data-kind=basic-knowledge],.types i[data-kind=basic-knowledge]{--type-color:#e3ae35}.node[data-kind=observation],.types i[data-kind=observation]{--type-color:#23b69a}.node[data-kind=definition],.types i[data-kind=definition]{--type-color:#ff984b}
.types i[data-kind],.board .node[data-kind] i{background:var(--type-color)}
.board .node{translate:-50% -50%;height:auto;min-height:52px;width:max-content;max-width:230px;padding:9px 13px;overflow:visible;border:3px solid color-mix(in srgb,var(--type-color) 78%,var(--color-ink));color:var(--color-ink);background:linear-gradient(135deg,color-mix(in oklab,var(--field-color) var(--node-highlight,55%),var(--color-surface)),color-mix(in oklab,var(--field-color) var(--node-shade,90%),var(--color-surface)));
 box-shadow:inset 0 1px 0 #fff5,0 2px 3px #13223825,1px 5px 10px var(--color-scrim);}
.board .node span{min-width:0;white-space:normal;overflow-wrap:anywhere;line-height:1.22}
 :global([data-theme=obsidian]) .map{--node-highlight:37%;--node-shade:22%;--field-fill:31%;--field-hover:39%}
.board .node.neighbor{box-shadow:0 0 0 3px var(--color-accent),0 4px 14px var(--color-scrim)}
.map>header{flex-wrap:nowrap;min-width:0}.map>header h1{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.map-search{min-width:0;width:auto;flex:1 1 110px;max-width:160px}.map>header .types{flex-shrink:0}

.map>header .types summary,.map>header .map-choice{box-sizing:border-box;font:inherit;font-size:var(--text-xs);height:28px;padding:0 8px;border:1px solid var(--color-line);border-radius:6px;color:var(--color-ink)}
.map>header .map-choice{flex:0 1 auto;width:auto;background-color:var(--color-surface)}.map>header .fields{min-width:0;flex:0 1 auto}.fields summary{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:26px}
.fields summary,.fields button{background-color:color-mix(in oklab,var(--field-tone) var(--field-fill,64%),var(--color-surface));transition:background-color .16s}
.fields div{overflow:auto;max-height:52vh;padding:3px;background:var(--color-surface)}
.fields button{font:inherit;font-size:var(--text-xs);border-radius:4px;margin:0;color:var(--color-ink)}
.fields button+button{margin-top:2px}
.fields button:hover,.fields button:focus-visible{background-color:color-mix(in oklab,var(--field-tone) var(--field-hover,88%),var(--color-surface))}

.map>header .types,.map>header .map-choice{width:8.2em;min-width:0;max-width:8.2em;flex:0 1 8.2em;font-size:var(--text-xs)}.types summary{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
</style>
