import { knowledgeRefKey, type KnowledgeNetworkState, type KnowledgeRef, type KnowledgeSelection } from './knowledge-network.js';
import { mapHandle } from './knowledge-map.js';
import { stableHash } from './research-hash.js';

export interface DirectedRouteQuery {
 mode:'directory'|'branch'|'exact'|'lexical'|'relations';
 query?:string; branch?:string; selection?:number; relation?:string; direction?:'incoming'|'outgoing'; offset?:number; limit?:number;
}
export class DirectedRouteInputError extends Error {}
export function validateDirectedRouteQuery(q:DirectedRouteQuery){
 const fields:Record<DirectedRouteQuery['mode'],string[]>={directory:[],branch:['branch'],exact:['query'],lexical:['query'],relations:['selection','relation','direction']};
 const keys=fields[q.mode];
 if(!keys||Object.keys(q).some(k=>!['mode','offset','limit',...keys].includes(k)))throw new DirectedRouteInputError('Choose a single route lookup mode and supply only its fields.');
 if(q.mode==='branch'&&!kinds.some(k=>k===q.branch)||['lexical','exact'].includes(q.mode)&&!q.query?.trim()||q.mode==='relations'&&!(Number.isSafeInteger(q.selection)&&q.selection!>0))throw new DirectedRouteInputError('Supply a listed branch, an exact or partial name, or a returned relation anchor for this mode.');
}
type RoutePath={relation:string;direction:'outgoing'|'incoming';basis:string;conditions:string[];step?:number;via?:KnowledgeRef};
export interface DirectedRouteSelection extends KnowledgeSelection {
 mode:DirectedRouteQuery['mode'];directory?:{branch:string;count:number}[];paths?:RoutePath[];
}
const folded=(s:string)=>s.normalize('NFKC').trim().toLowerCase();
const same=(a:KnowledgeRef,b:KnowledgeRef)=>knowledgeRefKey(a)===knowledgeRefKey(b);
const kinds=['method-skill','failure-skill','specific-strategy','theory'] as const;

/** Resolve only the requested page against frozen exact versions and current visibility. */
export function directedRouteSelection(frozen:KnowledgeNetworkState,q:DirectedRouteQuery,allowedRefs:readonly KnowledgeRef[],current:KnowledgeNetworkState):DirectedRouteSelection {
 validateDirectedRouteQuery(q);
 const offset=q.offset??0,limit=q.limit??12;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DirectedRouteInputError('Invalid route page');
 const granted=new Set(allowedRefs.map(knowledgeRefKey));
 const active=new Set(current.nodes.filter(n=>n.status==='active').map(n=>knowledgeRefKey(n.ref)));
 const rows=frozen.nodes.map((node,i)=>({node,selection:i+1})).filter(({node})=>node.kind!=='finding'&&node.status==='active'&&granted.has(knowledgeRefKey(node.ref))&&active.has(knowledgeRefKey(node.ref)));
 const byKey=new Map(rows.map(r=>[knowledgeRefKey(r.node.ref),r]));
 const selection:DirectedRouteSelection={mode:q.mode,recipe:frozen.recipe,revision:frozen.revision,nodes:[],links:[],bindings:[],compositions:[],total:0,truncated:false,work:{postingsVisited:0,edgesVisited:0,expanded:0,bodyReads:0},notice:'Names and navigation identify possible reads. Open the relevant version and check its conditions.'};
 const page=<T>(entries:T[])=>{selection.total=entries.length;selection.truncated=offset+limit<entries.length;if(selection.truncated)selection.nextOffset=offset+limit;return entries.slice(offset,offset+limit);};
 if(q.mode==='directory'){
  selection.directory=page(kinds.map(branch=>({branch,count:rows.filter(r=>r.node.kind===branch).length})).filter(x=>x.count));return selection;
 }
 if(q.mode!=='relations'){
  const query=folded(q.query??'');
  const found=rows.filter(({node})=>q.mode==='branch'?node.kind===q.branch:q.mode==='exact'?folded(node.title)===query:folded(node.title).includes(query));
  selection.nodes=page(found.sort((a,b)=>a.node.title.localeCompare(b.node.title,'en')||a.selection-b.selection)).map(row=>({...row,score:0,reasons:[]}));
  return selection;
 }
 const anchor=rows.find(r=>r.selection===q.selection)?.node.ref;
 if(!anchor)throw new DirectedRouteInputError('Route anchor outside the current grant');
 const edges:{row:typeof rows[number];path:RoutePath;id:string}[]=[];
 const add=(ref:KnowledgeRef,path:RoutePath,id:string)=>{
  const row=byKey.get(knowledgeRefKey(ref));
  if(row&&(!q.relation||q.relation===path.relation)&&(!q.direction||q.direction===path.direction))edges.push({row,path,id});
 };
 const liveBindings=new Set(current.bindings.filter(b=>b.status==='active').map(b=>stableHash(b)));
 const bindings=frozen.bindings.filter(b=>b.status==='active'&&liveBindings.has(stableHash(b))&&byKey.get(knowledgeRefKey(b.theory))?.node.scientificStatus==='supported'&&byKey.has(knowledgeRefKey(b.subject)));
 const liveLinks=new Set(current.links.filter(l=>l.status==='active').map(l=>stableHash(l)));
 for(const link of frozen.links){
  if(link.status!=='active'||!liveLinks.has(stableHash(link))||!same(link.from,anchor)&&!same(link.to,anchor))continue;
  if(link.relation==='shared-theory'&&(!link.theory||![link.from,link.to].every(ref=>bindings.some(b=>same(b.theory,link.theory!)&&same(b.subject,ref)))))continue;
  const forward=same(link.from,anchor);
  add(forward?link.to:link.from,{relation:link.relation,direction:forward?'outgoing':'incoming',basis:link.basis,conditions:link.conditions,...(link.theory?{via:link.theory}:{})},link.id);
 }
 for(const b of bindings){
  if(!same(b.theory,anchor)&&!same(b.subject,anchor))continue;
  const forward=same(b.theory,anchor);
  add(forward?b.subject:b.theory,{relation:'theory-binding',direction:forward?'outgoing':'incoming',basis:b.argument,conditions:b.conditions},b.id);
 }
 const liveCompositions=new Set(current.compositions.map(c=>stableHash(c)));
 for(const c of frozen.compositions){
  if(!liveCompositions.has(stableHash(c))||!byKey.has(knowledgeRefKey(c.strategy)))continue;
  for(const [i,step] of c.steps.entries()){
   if(!same(c.strategy,anchor)&&!same(step.skill,anchor))continue;
   const forward=same(c.strategy,anchor);
   add(forward?step.skill:c.strategy,{relation:'composition',direction:forward?'outgoing':'incoming',basis:'Ordered Strategy step',conditions:step.conditions,step:i+1},c.id);
  }
 }
 edges.sort((a,b)=>a.path.relation.localeCompare(b.path.relation)||a.path.direction.localeCompare(b.path.direction)||a.id.localeCompare(b.id)||(a.path.step??0)-(b.path.step??0));
 const slice=page(edges);selection.paths=slice.map(e=>e.path);selection.nodes=slice.map(({row})=>({...row,score:0,reasons:[]}));
 selection.work.edgesVisited=edges.length;return selection;
}
export function directedRoutePresentation(selection:DirectedRouteSelection){
 return {mode:selection.mode,...(selection.directory?{directory:selection.directory}:{}),entries:selection.nodes.map(({selection:handle,node},i)=>({selection:handle,ref:node.ref,name:node.title,kind:node.kind,...(node.ref.store==='theory'?{qualification:node.scientificStatus,mapSelection:mapHandle({...node.ref,store:'theory'})}:{}),...(selection.paths?.[i]?{path:selection.paths[i]}:{})})),total:selection.total,nextOffset:selection.nextOffset,notice:selection.notice};
}
