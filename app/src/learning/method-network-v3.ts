/** Versioned method navigation. Cards are neither evidence nor complete body exposure. */
import {stableHash} from './research-hash.js';
import {catalogTermsV3,catalogQueryTermWeightV3,catalogResourceIdV3,type CatalogIndexV3,type IndexedEntryV3,type CatalogEntryV3,type CatalogQueryV3} from './hierarchical-catalog-v3.js';
import type {ResourceRef} from './research-data.js';

export interface RouteRefV3 {id:string;version:number}
export interface RouteTemplateV3 extends RouteRefV3 {
 resourceRef:ResourceRef;title:string;summary:string;transformation:string;topics:string[];conditions:string[];
 outputs:string[];checks:string[];failures:string[];roles:{name:string;kind:'input'|'output';description:string}[];
 alternatives:ResourceRef[];sourceRefs:ResourceRef[];status:'active'|'withdrawn';supersedes?:RouteRefV3[];
}
export type MethodRelationV3='structural-similarity'|'topic-similarity'|'complements'|'requires'|'supports'|'refutes';
export interface MethodLinkV3 extends RouteRefV3 {
 from:RouteRefV3;to:RouteRefV3;relation:MethodRelationV3;basis:string;bridgeConditions:string[];sourceRefs:ResourceRef[];score?:number;
}
export interface NetworkPublicationV3 {
 recipe:'method-network-v1';version:number;routes:RouteTemplateV3[];links:MethodLinkV3[];receipts:Record<string,string>;
 rejections?:Record<string,{hash:string;reason:string}>;
}
export type NetworkRetrievalRevisionV3='query-relevance-v2'|'query-relevance-v3';
export interface NetworkPinV3 {retrievalRevision?:NetworkRetrievalRevisionV3;recipe:'method-network-v1';revision:string;catalogHash:string;networkHash:string}
export interface NetworkQueryV3 extends CatalogQueryV3 {clusterRef?:string;view?:'clusters'|'routes'|'global'|'directory'|'family'}
export interface RouteCardV3 {
 ref:RouteRefV3;resourceRef:ResourceRef;title:string;summary:string;transformation:string;conditions:string[];outputs:string[];
 checks:string[];failures:string[];roles:RouteTemplateV3['roles'];alternatives:ResourceRef[];applicability:'unknown';
}
export interface ClusterCardV3 {
 id:string;revision:string;scale:'neighborhood';title:string;routes:RouteCardV3[];memberCount:number;
 links:MethodLinkV3[];applicability:'unknown';notice:string;
}
export interface NetworkSelectionV3 {
 pin:NetworkPinV3;clusters:ClusterCardV3[];uncovered:CatalogEntryV3[];routes:RouteCardV3[];nextOffset?:number;
 truncated:boolean;noFit:boolean;oversizedRefs:string[];work:{postingsVisited:number;candidatesScored:number;entriesVisited:number;eligibilityChecks:number;edgesVisited:number;expandedObjects:number;bodyReads:0};notice:string;
}
interface ClusterIndexV3 {id:string;seed:string;members:string[];revision:string;terms:string[];contributors:ResourceRef[]}
export interface NetworkIndexV3 {
 recipe:'method-network-v1';catalogHash:string;publication:NetworkPublicationV3;catalog:CatalogIndexV3;clusters:ClusterIndexV3[];
}
export interface PreparedNetworkV3 {
 routeWeights:ReadonlyMap<string,Readonly<Record<string,number>>>;index:NetworkIndexV3;hash:string;routes:ReadonlyMap<string,RouteTemplateV3>;resourceRoutes:ReadonlyMap<string,readonly string[]>;routeIds:ReadonlyMap<string,string>;entries:ReadonlyMap<string,IndexedEntryV3>;
 clusters:ReadonlyMap<string,ClusterIndexV3>;memberships:ReadonlyMap<string,readonly string[]>;
 roleRoutePostings:ReadonlyMap<string,readonly string[]>;routePostings:ReadonlyMap<string,readonly string[]>;clusterPostings:ReadonlyMap<string,readonly string[]>;
 resourcePostings:ReadonlyMap<string,readonly string[]>;adjacency:ReadonlyMap<string,readonly MethodLinkV3[]>;
}
export const NETWORK_BUDGET_V3=Object.freeze({postings:4096,seeds:64,neighbors:8,hops:2,expanded:256,edges:2048,eligibility:512,clusters:4,previews:3});
const relations:MethodRelationV3[]=['structural-similarity','topic-similarity','complements','requires','supports','refutes'];
const refKey=(ref:RouteRefV3)=>`${ref.id}:${ref.version}`;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const check=(condition:unknown,message:string):void=>{if(!condition)throw new Error(`Invalid method network: ${message}`);};
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const text=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const strings=(v:unknown)=>Array.isArray(v)&&v.every(text);
const ref=(v:unknown):v is RouteRefV3=>object(v)&&keys(v,['id','version'])&&text(v.id)&&Number.isSafeInteger(v.version)&&Number(v.version)>0;
const refs=(v:unknown)=>Array.isArray(v)&&v.every(ref)&&new Set(v.map(refKey)).size===v.length;
export const emptyMethodNetworkV3=():NetworkPublicationV3=>({recipe:'method-network-v1',version:0,routes:[],links:[],receipts:{}});
export function validNetworkPinV3(value:unknown):value is NetworkPinV3 {
 return object(value)&&keys(value,['recipe','revision','catalogHash','networkHash','retrievalRevision'])&&(value.retrievalRevision===undefined||value.retrievalRevision==='query-relevance-v2'||value.retrievalRevision==='query-relevance-v3')&&value.recipe==='method-network-v1'&&typeof value.revision==='string'&&/^[a-f0-9]{40}$/u.test(value.revision)&&typeof value.catalogHash==='string'&&/^[a-f0-9]{64}$/u.test(value.catalogHash)&&typeof value.networkHash==='string'&&/^[a-f0-9]{64}$/u.test(value.networkHash);
}
/** Shape and exact-reference validation only; the publisher must additionally qualify its scientific sources. */
export function validateNetworkPublicationV3(value:unknown,catalog?:CatalogIndexV3):asserts value is NetworkPublicationV3 {
 check(object(value),'publication object');const p=value as Record<string,unknown>;
 check(keys(p,['recipe','version','routes','links','receipts','rejections'])&&p.recipe==='method-network-v1'&&Number.isSafeInteger(p.version)&&Number(p.version)>=0,'recipe/version');
 check(Array.isArray(p.routes)&&p.routes.length<=10000&&Array.isArray(p.links)&&p.links.length<=50000,'route/link arrays');
 check(object(p.receipts)&&Object.values(p.receipts).every(text),'receipts');
 if(p.rejections!==undefined)check(object(p.rejections)&&Object.values(p.rejections).every(r=>object(r)&&keys(r,['hash','reason'])&&text(r.hash)&&text(r.reason)),'rejections');
 const routeIds=new Set<string>(),routeKeys=new Set<string>(),entryIds=catalog?new Set(catalog.entries.map(e=>e.id)):undefined;
 const resourceRefs=(items:ResourceRef[])=>{if(entryIds)for(const r of items)check(entryIds.has(catalogResourceIdV3(r)),'unknown exact resource reference');};
 for(const raw of p.routes as unknown[]){
  check(object(raw),'route object');const r=raw as unknown as RouteTemplateV3;
  check(keys(raw as Record<string,unknown>,['id','version','resourceRef','title','summary','transformation','topics','conditions','outputs','checks','failures','roles','alternatives','sourceRefs','status','supersedes']),'route fields');
  check(ref({id:r.id,version:r.version})&&!routeIds.has(r.id),'route identity');routeIds.add(r.id);routeKeys.add(refKey(r));
  check(ref(r.resourceRef)&&text(r.title)&&text(r.summary)&&text(r.transformation),'route content');
  check([r.topics,r.conditions,r.outputs,r.checks,r.failures].every(strings)&&refs(r.alternatives)&&refs(r.sourceRefs)&&r.sourceRefs.length>0,'route descriptors/sources');
  check(Array.isArray(r.roles)&&r.roles.every(role=>object(role)&&keys(role,['name','kind','description'])&&text(role.name)&&['input','output'].includes(role.kind)&&text(role.description)),'roles');
  check(new Set(r.roles.map(role=>role.name)).size===r.roles.length,'duplicate role name');
  check(['active','withdrawn'].includes(r.status)&&(r.supersedes===undefined||refs(r.supersedes)),'route state/lineage');
  if(r.status==='active')resourceRefs([r.resourceRef,...r.sourceRefs,...r.alternatives]);
 }
 const linkIds=new Set<string>();
 for(const raw of p.links as unknown[]){
  check(object(raw),'link object');const l=raw as unknown as MethodLinkV3;
  check(keys(raw as Record<string,unknown>,['id','version','from','to','relation','basis','bridgeConditions','sourceRefs','score']),'link fields');
  check(ref({id:l.id,version:l.version})&&!linkIds.has(l.id),'link identity');linkIds.add(l.id);
  check(ref(l.from)&&ref(l.to)&&routeKeys.has(refKey(l.from))&&routeKeys.has(refKey(l.to))&&refKey(l.from)!==refKey(l.to),'link endpoints');
  check(relations.includes(l.relation)&&text(l.basis)&&strings(l.bridgeConditions)&&refs(l.sourceRefs)&&l.sourceRefs.length>0,'link descriptors');
  check(l.score===undefined||Number.isFinite(l.score)&&l.score>=0&&l.score<=1,'link score');
  resourceRefs(l.sourceRefs);
 }
}
const terms=(r:RouteTemplateV3)=>catalogTermsV3([r.title,r.summary,r.transformation,...r.topics,...r.conditions,...r.outputs,...r.checks,...r.failures].join('\n'));
/** Publication-time work may traverse metadata; queries never read resource bodies. */
export function buildMethodNetworkV3(publication:NetworkPublicationV3,catalog:CatalogIndexV3):NetworkIndexV3 {
 validateNetworkPublicationV3(publication);
 const catalogHash=stableHash(catalog),available=new Set(catalog.entries.map(e=>e.id));
 // A normal update may withdraw an old owner. Retain its immutable record but omit it from current views.
 const active=publication.routes.filter(r=>r.status==='active'&&[r.resourceRef,...r.sourceRefs,...r.alternatives].every(ref=>available.has(catalogResourceIdV3(ref))));
 const routeTerms=new Map(active.map(r=>[refKey(r),terms(r)]));
 const routeMap=new Map(active.map(r=>[refKey(r),r])),neighbors=new Map<string,string[]>(),endpointPairs=new Map<string,MethodLinkV3[]>();
 const pairKey=(a:string,b:string)=>JSON.stringify(a<b?[a,b]:[b,a]);
 for(const link of publication.links){const key=pairKey(refKey(link.from),refKey(link.to));let links=endpointPairs.get(key);if(!links)endpointPairs.set(key,links=[]);links.push(link);}
 for(const l of [...publication.links].sort((a,b)=>(b.score??0)-(a.score??0)||a.id.localeCompare(b.id))){
  if(l.relation!=='structural-similarity'||(l.score??1)<0.5||!routeMap.has(refKey(l.from))||!routeMap.has(refKey(l.to))||!l.sourceRefs.every(ref=>available.has(catalogResourceIdV3(ref))))continue;
  for(const [a,b] of [[refKey(l.from),refKey(l.to)],[refKey(l.to),refKey(l.from)]]){let list=neighbors.get(a!);if(!list)neighbors.set(a!,list=[]);if(list.length<NETWORK_BUDGET_V3.neighbors&&!list.includes(b!))list.push(b!);}
 }
 const clusters=active.sort((a,b)=>refKey(a).localeCompare(refKey(b))).map(seed=>{
  const key=refKey(seed),members=[key,...neighbors.get(key)??[]].sort();
  const boundLinks:MethodLinkV3[]=[];
  for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++)boundLinks.push(...endpointPairs.get(pairKey(members[a]!,members[b]!))??[]);
  boundLinks.sort((a,b)=>a.id.localeCompare(b.id));
  return {id:`cluster:${seed.id}:${seed.version}`,seed:key,members,revision:stableHash({recipe:'method-network-v1',members:members.map(k=>routeMap.get(k)),links:boundLinks,catalogHash}),terms:[...new Set(members.flatMap(k=>routeTerms.get(k)!))].sort(),contributors:[...new Map(boundLinks.flatMap(l=>l.sourceRefs).map(ref=>[refKey(ref),ref])).values()]};
 });
 return {recipe:'method-network-v1',catalogHash,publication:structuredClone(publication),catalog:structuredClone(catalog),clusters};
}
const addPosting=(map:Map<string,string[]>,term:string,id:string)=>{let values=map.get(term);if(!values)map.set(term,values=[]);values.push(id);};
export function prepareMethodNetworkV3(index:NetworkIndexV3):PreparedNetworkV3 {
 check(index.recipe==='method-network-v1'&&index.catalogHash===stableHash(index.catalog),'index binding');
 const expected=buildMethodNetworkV3(index.publication,index.catalog),expectedHash=stableHash(expected),hash=stableHash(index);check(expectedHash===hash,'derived view integrity');
 return prepareNetworkMapsV3(index,hash);
}
/** Validate canonical sources once; a derived view must match that exact result before map construction. */
export function buildMethodNetworkPreparationV3(publication:NetworkPublicationV3,catalog:CatalogIndexV3) {
 const canonical=buildMethodNetworkV3(publication,catalog),hash=stableHash(canonical);
 return Object.freeze({hash,prepare(derived?:NetworkIndexV3):PreparedNetworkV3 {
  if(derived!==undefined)check(stableHash(derived)===hash,'derived view integrity');
  return prepareNetworkMapsV3(derived??canonical,hash);
 }});
}
/** Callers above establish integrity; this helper is never an exported trust bypass. */
function prepareNetworkMapsV3(index:NetworkIndexV3,hash:string):PreparedNetworkV3 {
 const routes=new Map(index.publication.routes.map(r=>[refKey(r),r])),entries=new Map(index.catalog.entries.map(e=>[e.id,e])),clusters=new Map(index.clusters.map(c=>[c.id,c]));
 const resourceRoutes=new Map<string,string[]>(),routeIds=new Map<string,string>();
 for(const [key,r] of routes){addPosting(resourceRoutes,catalogResourceIdV3(r.resourceRef),key);routeIds.set(r.id,key);}
 const roleRoutePostings=new Map<string,string[]>(),routeWeights=new Map<string,Record<string,number>>();
 const memberships=new Map<string,string[]>(),routePostings=new Map<string,string[]>(),clusterPostings=new Map<string,string[]>(),resourcePostings=new Map<string,string[]>(),adjacency=new Map<string,MethodLinkV3[]>();
 for(const c of index.clusters){for(const t of c.terms)addPosting(clusterPostings,t,c.id);for(const member of c.members)addPosting(memberships,member,c.id);}
 for(const [id,r] of routes)if(r.status==='active'&&memberships.has(id)){
  const weights:Record<string,number>=Object.create(null),baseTerms=new Set<string>();
  const append=(text:string,weight:number,base=true)=>{for(const term of catalogTermsV3(text)){weights[term]=Math.max(weights[term]??0,weight);if(base)baseTerms.add(term);}};
  append(r.title,5);append(r.transformation,5);append(r.summary,3);append(r.topics.join(' '),4);
  append([...r.conditions,...r.outputs,...r.checks,...r.failures].join(' '),3);
  const legacyTerms=[...baseTerms].sort();
  for(const term of legacyTerms)addPosting(routePostings,term,id);
  const roleTerms=catalogTermsV3(r.roles.map(role=>`${role.name} ${role.description}`).join('\n'));
  for(const term of roleTerms)weights[term]=Math.max(weights[term]??0,3);routeWeights.set(id,weights);
  // Preserve the historical base-first term order; only preparation storage is shared.
  for(const term of new Set([...legacyTerms,...roleTerms]))addPosting(roleRoutePostings,term,id);
 }
 // Maps are complete before sharing: no later insertion may mutate a shared posting.
 for(const [term,legacy] of routePostings){
  const modern=roleRoutePostings.get(term);
  if(modern&&legacy.length===modern.length&&legacy.every((id,i)=>id===modern[i]))roleRoutePostings.set(term,legacy);
  Object.freeze(legacy);
 }
 for(const posting of roleRoutePostings.values())Object.freeze(posting);
 for(const e of index.catalog.entries)for(const term of Object.keys(e.terms))addPosting(resourcePostings,term,e.id);
 for(const l of index.publication.links){for(const id of [refKey(l.from),refKey(l.to)]){let links=adjacency.get(id);if(!links)adjacency.set(id,links=[]);links.push(l);}}
 for(const links of adjacency.values())links.sort((a,b)=>(b.score??0)-(a.score??0)||a.id.localeCompare(b.id));
 return {routeWeights,index,hash,routes,resourceRoutes,routeIds,entries,clusters,memberships,roleRoutePostings,routePostings,clusterPostings,resourcePostings,adjacency};
}
const card=(route:RouteTemplateV3):RouteCardV3=>({ref:{id:route.id,version:route.version},resourceRef:route.resourceRef,title:route.title,summary:route.summary,transformation:route.transformation,conditions:route.conditions,outputs:route.outputs,checks:route.checks,failures:route.failures,roles:route.roles,alternatives:route.alternatives,applicability:'unknown'});
const ignoredTerms=new Set('the a an of to is are be for and or with in on this that from'.split(' '));
/** Bounded dual-index search with global rescue. Eligibility is checked before rendering any scientific text. */
export function queryMethodNetworkV3(prepared:PreparedNetworkV3,pin:NetworkPinV3,query:NetworkQueryV3,available:(entry:IndexedEntryV3)=>boolean=()=>true,recoveryNotice='',currentFamilies?:PreparedNetworkV3['clusters']):NetworkSelectionV3 {
 return queryNetworkV3(prepared,pin,query,available,recoveryNotice,false,currentFamilies);
}
/** Learning uses the same bounded ranking/eligibility pass, without portfolio-preview selection. */
export function queryLearningMethodNetworkV3(prepared:PreparedNetworkV3,pin:NetworkPinV3,query:NetworkQueryV3,available:(entry:IndexedEntryV3)=>boolean=()=>true):NetworkSelectionV3 {
 check((pin.retrievalRevision==='query-relevance-v2'||pin.retrievalRevision==='query-relevance-v3')&&!query.view&&!query.clusterRef,'learning retrieval revision/view');
 return queryNetworkV3(prepared,pin,query,available,'',true);
}
function queryNetworkV3(prepared:PreparedNetworkV3,pin:NetworkPinV3,query:NetworkQueryV3,available:(entry:IndexedEntryV3)=>boolean,recoveryNotice:string,learning:boolean,currentFamilies?:PreparedNetworkV3['clusters']):NetworkSelectionV3 {
 check(validNetworkPinV3(pin)&&pin.networkHash===prepared.hash&&pin.catalogHash===prepared.index.catalogHash,'query pin');
 check(query.view===undefined||['clusters','routes','global','directory','family'].includes(query.view),'query view');
 const work:NetworkSelectionV3['work']={postingsVisited:0,candidatesScored:0,entriesVisited:0,eligibilityChecks:0,edgesVisited:0,expandedObjects:0,bodyReads:0};
 const result:NetworkSelectionV3={pin:structuredClone(pin),clusters:[],uncovered:[],routes:[],truncated:false,noFit:true,oversizedRefs:[],work,notice:'Navigation only; applicability is unknown. Read exact canonical bodies before use. Revise the query or use view=global with offset for rescue; no fit permits free reasoning.'+recoveryNotice};
 const budget=NETWORK_BUDGET_V3,maxBytes=Math.max(512,Math.min(262144,query.maxChars??32768)),maxNodes=Math.max(1,Math.min(32,query.maxNodes??12));
 const browsingFamily=query.view==='directory'||query.view==='family';
 const live=new Map<string,boolean>();
 const eligible=(id:string):boolean=>{if(live.has(id))return live.get(id)!;if(!browsingFamily&&work.eligibilityChecks>=budget.eligibility){result.truncated=true;return false;}work.eligibilityChecks++;work.entriesVisited++;const entry=prepared.entries.get(id),ok=!!entry&&available(entry);live.set(id,ok);return ok;};
 const liveRoutes=new Map<string,boolean>();
 const routeLive=(id:string):boolean=>{if(liveRoutes.has(id))return liveRoutes.get(id)!;const r=prepared.routes.get(id),ok=!!r&&r.status==='active'&&[r.resourceRef,...r.sourceRefs,...r.alternatives].every(ref=>eligible(catalogResourceIdV3(ref)));liveRoutes.set(id,ok);return ok;};
 const linkLive=(l:MethodLinkV3)=>routeLive(refKey(l.from))&&routeLive(refKey(l.to))&&l.sourceRefs.every(ref=>eligible(catalogResourceIdV3(ref)));
 const byteSize=()=>Buffer.byteLength(JSON.stringify(result));
 const fit=(array:unknown[],value:unknown,id:string)=>{array.push(structuredClone(value));if(byteSize()<=maxBytes-128)return true;array.pop();result.truncated=true;if(result.oversizedRefs.length<8)result.oversizedRefs.push(id);return false;};
 const offset=Number.isSafeInteger(query.offset)&&query.offset!>=0?query.offset!:0;
 if(browsingFamily){
  const family=query.view==='family';
  check(!query.query&&(family?!!query.clusterRef:query.clusterRef===undefined),'directory or exact family requested');
  const clusters=family?[prepared.clusters.get(query.clusterRef!)]:prepared.index.clusters;
  if(family&&!clusters[0]){result.notice='This frozen route family is unavailable. Browse the directory again.';return finish();}
  let at=family?0:offset;
  while(at<clusters.length&&result.clusters.length<maxNodes){
   const cluster=clusters[at++]!;
   // Authorize the contributors to membership even when opening by an old family ID.
   if(currentFamilies&&currentFamilies.get(cluster.id)?.revision!==cluster.revision)continue;
   if(!cluster.members.every(routeLive)||!cluster.contributors.every(ref=>eligible(catalogResourceIdV3(ref))))continue;
   const members=family?cluster.members.slice(offset,offset+maxNodes):[];
   const header:ClusterCardV3={id:cluster.id,revision:cluster.revision,title:prepared.routes.get(cluster.seed)!.transformation,
    scale:'neighborhood',memberCount:cluster.members.length,applicability:'unknown',routes:[],links:[],
    notice:'Authored route neighborhood. Inspect exact methods and their conditions before use.'};
   if(!fit(result.clusters,header,cluster.id)){if(!family&&result.clusters.length)at--;break;}
   if(family){
    const delivered=result.clusters[result.clusters.length-1]!,included=new Set<string>();
    let cursor=offset;
    for(const key of members){
     if(!fit(delivered.routes,card(prepared.routes.get(key)!),key)){if(!delivered.routes.length)cursor++;break;}
     included.add(key);cursor++;
    }
    for(const link of prepared.index.publication.links)if(link.relation!=='topic-similarity'&&included.has(refKey(link.from))&&included.has(refKey(link.to))&&linkLive(link))fit(delivered.links,link,link.id);
    if(cursor<cluster.members.length)result.nextOffset=cursor;
   }
  }
  if(!family&&at<clusters.length)result.nextOffset=at;
  result.truncated||=result.nextOffset!==undefined;
  result.noFit=result.clusters.length===0;
  result.notice='Frozen route-family directory. Request a family to read its routes, or browse the V4 Skill and Strategy directory.';
  return finish();
 }
 if(query.view==='global'){
  result.notice+=' This view browses the entire authorized catalog in stable order; query text is ignored. For targeted global search omit view and supply a revised query or exact refs.';
  let at=offset;
  while(at<prepared.index.catalog.entries.length&&result.uncovered.length<maxNodes&&work.eligibilityChecks<budget.eligibility){const e=prepared.index.catalog.entries[at++]!;if(!eligible(e.id))continue;if(!fit(result.uncovered,{id:e.id,node:e.node,...(e.meta?{meta:e.meta}:{}),score:0},e.id))break;}
  if(at<prepared.index.catalog.entries.length){result.nextOffset=at;result.truncated=true;}result.noFit=result.uncovered.length===0;return finish();
 }
 if(query.view==='routes'&&!query.clusterRef){
  const requested=[...new Set((query.refs??[]).flatMap(id=>prepared.routes.has(id)?[id]:prepared.routeIds.has(id)?[prepared.routeIds.get(id)!]:prepared.resourceRoutes.get(id)??[]))];
  check(requested.length>0,'route view requires an exact route reference or clusterRef');
  let at=offset;while(at<requested.length&&result.routes.length<maxNodes){const id=requested[at++]!;if(routeLive(id))fit(result.routes,card(prepared.routes.get(id)!),id);}
  if(at<requested.length){result.nextOffset=at;result.truncated=true;}result.noFit=result.routes.length===0;return finish();
 }
 if(query.clusterRef){
  const cluster=prepared.clusters.get(query.clusterRef);check(cluster,'unknown exact cluster reference');
  // Hidden seed cannot confer a meaningful shared title; callers may use global resource rescue.
  if(!routeLive(cluster!.seed))return finish();
  let at=offset;while(at<cluster!.members.length&&result.routes.length<maxNodes){const key=cluster!.members[at++]!;if(routeLive(key))fit(result.routes,card(prepared.routes.get(key)!),key);}
  if(at<cluster!.members.length){result.nextOffset=at;result.truncated=true;}result.noFit=result.routes.length===0;return finish();
 }
 const weighted=pin.retrievalRevision==='query-relevance-v3',modern=weighted||pin.retrievalRevision==='query-relevance-v2';
 const routePostings=modern?prepared.roleRoutePostings:prepared.routePostings;
 const routeRanks=new Map<string,number>(),clusterRanks=new Map<string,number>(),resourceRanks=new Map<string,number>();
 const scans=new Map<ReadonlyMap<string,readonly string[]>,number>();
 const scan=(postings:ReadonlyMap<string,readonly string[]>,ranks:Map<string,number>,term:string,weight:number)=>{
  const posting=postings.get(term)??[],isRoute=postings===routePostings;
  const rarity=weighted?(1+Math.log(1+(isRoute?prepared.routes.size:prepared.entries.size)/(posting.length||1)))*catalogQueryTermWeightV3(term):1;
  for(const id of posting){if(work.postingsVisited>=budget.postings||(scans.get(postings)??0)>=Math.floor(budget.postings/3)){result.truncated=true;break;}scans.set(postings,(scans.get(postings)??0)+1);work.postingsVisited++;const descriptorWeight=weighted?(postings===routePostings?prepared.routeWeights.get(id)?.[term]??0:prepared.entries.get(id)?.terms[term]??0):weight;ranks.set(id,(ranks.get(id)??0)+descriptorWeight*rarity);}
 };
 // Round-robin the three indices so common catalog words cannot exhaust the budget before clusters.
 for(const term of catalogTermsV3(String(query.query??'').slice(0,16384)).filter(t=>weighted?catalogQueryTermWeightV3(t)>0:!ignoredTerms.has(t)).sort((a,b)=>((routePostings.get(a)?.length??0)+(prepared.clusterPostings.get(a)?.length??0)+(prepared.resourcePostings.get(a)?.length??0))-((routePostings.get(b)?.length??0)+(prepared.clusterPostings.get(b)?.length??0)+(prepared.resourcePostings.get(b)?.length??0))||a.localeCompare(b))){if(!weighted)scan(prepared.clusterPostings,clusterRanks,term,1);scan(routePostings,routeRanks,term,2);scan(prepared.resourcePostings,resourceRanks,term,1);}
 for(const id of [...query.refs??[],...query.goalIds??[]]){
  if(prepared.routes.has(id))routeRanks.set(id,1e9);
  if(prepared.clusters.has(id))clusterRanks.set(id,1e9);
  const resourceId=prepared.entries.has(id)?id:`resource:${id}`;if(prepared.entries.has(resourceId))resourceRanks.set(resourceId,1e9);
 }
 const ranked=(ranks:Map<string,number>)=>[...ranks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 // Outgoing neighborhoods are bounded, but incoming memberships can be larger; bound query work explicitly.
 if(modern&&(routeRanks.size>budget.seeds||resourceRanks.size>budget.seeds))result.truncated=true;
 let seeds=ranked(routeRanks).slice(0,budget.seeds).map(([id])=>id);
 for(const [id,score] of ranked(resourceRanks).slice(0,budget.seeds)){
  for(const key of (prepared.resourceRoutes.get(id)??[]).slice(0,budget.neighbors)){if(seeds.length>=budget.seeds){if(modern)result.truncated=true;break;}if(!seeds.includes(key))seeds.push(key);routeRanks.set(key,Math.max(routeRanks.get(key)??0,score));}
 }
 const expanded=new Set<string>();
 for(let hop=0;hop<budget.hops&&seeds.length;hop++){
  const next:string[]=[];
  for(const id of seeds){if(expanded.has(id)||expanded.size>=budget.expanded||!routeLive(id))continue;expanded.add(id);work.expandedObjects++;
   if(modern&&(prepared.memberships.get(id)?.length??0)>budget.neighbors+1)result.truncated=true;
   for(const clusterId of (prepared.memberships.get(id)??[]).slice(0,budget.neighbors+1))clusterRanks.set(clusterId,Math.max(clusterRanks.get(clusterId)??0,routeRanks.get(id)??0.25));
   const counts=new Map<MethodRelationV3,number>();
   for(const l of prepared.adjacency.get(id)??[]){
    if(work.edgesVisited>=budget.edges){result.truncated=true;break;}work.edgesVisited++;const count=counts.get(l.relation)??0;if(count>=budget.neighbors){if(modern)result.truncated=true;continue;}counts.set(l.relation,count+1);
    if(!linkLive(l))continue;const target=refKey(l.from)===id?refKey(l.to):refKey(l.from);
    if((l.relation==='structural-similarity'||l.relation==='complements')&&!expanded.has(target)){routeRanks.set(target,Math.max(routeRanks.get(target)??0,0.25/(hop+1)));next.push(target);}
   }
  }if(modern&&new Set(next).size>budget.expanded-expanded.size)result.truncated=true;seeds=[...new Set(next)].slice(0,budget.expanded-expanded.size);
 }
 if(modern&&seeds.some(id=>!expanded.has(id)))result.truncated=true;
 work.candidatesScored=routeRanks.size+clusterRanks.size+resourceRanks.size;
 if(learning){
  const matches=ranked(routeRanks).slice(0,budget.seeds);if(routeRanks.size>budget.seeds)result.truncated=true;
  let at=offset;
  while(at<matches.length&&result.routes.length<maxNodes){const [id]=matches[at++]!;if(routeLive(id))fit(result.routes,card(prepared.routes.get(id)!),id);}
  if(at<matches.length){result.nextOffset=at;result.truncated=true;}
  result.noFit=result.routes.length===0;return finish();
 }
 const deliveredResources=new Set<string>(),memberSignatures=new Set<string>();
 const uniqueMemberships=new Set<string>();
 const pool=ranked(clusterRanks).filter(([id])=>{const signature=prepared.clusters.get(id)?.members.join('|');if(!signature||uniqueMemberships.has(signature))return false;uniqueMemberships.add(signature);return true;}).slice(0,budget.seeds),candidates:[string,number][]=[];
 if(clusterRanks.size>budget.seeds)result.truncated=true;
 const portfolioResources=new Set<string>(),portfolioTransformations=new Set<string>();
 const utility=([id,score]:[string,number])=>{const c=prepared.clusters.get(id);if(!c)return -1;const gain=c.members.filter(k=>!portfolioResources.has(catalogResourceIdV3(prepared.routes.get(k)!.resourceRef))).length;const transformation=prepared.routes.get(c.seed)!.transformation;return score*(gain/Math.max(1,c.members.length))*(portfolioTransformations.has(transformation)?0.25:1);};
 // Compute the same bounded ordering before applying offsets, so pagination never reorders a suffix.
 while(pool.length){pool.sort((a,b)=>utility(b)-utility(a)||a[0].localeCompare(b[0]));const item=pool.shift()!;candidates.push(item);const c=prepared.clusters.get(item[0]);if(c){portfolioTransformations.add(prepared.routes.get(c.seed)!.transformation);for(const key of c.members)portfolioResources.add(catalogResourceIdV3(prepared.routes.get(key)!.resourceRef));}}
 if(weighted){
  // Cover distinct exact routes before spending the wire budget on repeated link prose.
  const selected:{preview:ClusterCardV3;remaining:string[]}[]=[],deliveredRoutes=new Set<string>();
  const representedMembers=new Set<string>(),deferred:number[]=[];
  let at=offset,count=0;
  const addCluster=(id:string):boolean=>{
   const cluster=prepared.clusters.get(id);
   if(!cluster||!routeLive(cluster.seed)||!cluster.contributors.every(ref=>eligible(catalogResourceIdV3(ref))))return false;
   const members=cluster.members.filter(routeLive);if(!members.length||members.length!==cluster.members.length)return false;
   const remaining=[...members].sort((a,b)=>(routeRanks.get(b)??0)-(routeRanks.get(a)??0)||a.localeCompare(b)).filter(key=>!deliveredRoutes.has(key));
   if(!remaining.length)return false;
   const preview:ClusterCardV3={id,revision:cluster.revision,scale:'neighborhood',title:prepared.routes.get(cluster.seed)!.transformation,routes:[],memberCount:members.length,links:[],applicability:'unknown',notice:(members.length===1?'Provisional single-route navigation item; no reliable multi-route cluster yet. ':'Reviewed structural neighborhood; ')+'Shared proximity proves neither common prerequisites nor applicability. Failure hints come from individual routes; no unlisted counterexample is implied.'};
   while(remaining.length){const key=remaining.shift()!;preview.routes=[card(prepared.routes.get(key)!)];
    if(fit(result.clusters,preview,id)){const delivered=result.clusters[result.clusters.length-1]!;selected.push({preview:delivered,remaining});deliveredRoutes.add(key);deliveredResources.add(catalogResourceIdV3(prepared.routes.get(key)!.resourceRef));for(const member of members)representedMembers.add(member);count++;return true;}
   }
   return false;
  };
  // Overlapping neighborhoods are legitimate, but defer their repeated headers until
  // the initially distinct neighborhoods have had a chance to expose their cards.
  while(at<candidates.length&&selected.length<Math.min(budget.clusters,maxNodes)&&count<maxNodes){
   const position=at++,[id]=candidates[position]!,cluster=prepared.clusters.get(id);
   if(cluster?.members.some(key=>representedMembers.has(key))){deferred.push(position);continue;}
   addCluster(id);
  }
  const fillMembers=()=>{
   let pending=true;
   while(pending&&count<maxNodes){pending=false;for(const item of selected){
    while(item.remaining.length&&deliveredRoutes.has(item.remaining[0]!))item.remaining.shift();
    if(!item.remaining.length||count>=maxNodes)continue;pending=true;const key=item.remaining.shift()!;
    if(fit(item.preview.routes,card(prepared.routes.get(key)!),key)){deliveredRoutes.add(key);deliveredResources.add(catalogResourceIdV3(prepared.routes.get(key)!.resourceRef));count++;}
   }}
  };
  fillMembers();
  let deferredAt=0;
  while(deferredAt<deferred.length&&selected.length<Math.min(budget.clusters,maxNodes)&&count<maxNodes){
   addCluster(candidates[deferred[deferredAt++]!]![0]);fillMembers();
  }
  if(at<candidates.length||deferredAt<deferred.length){result.nextOffset=deferredAt<deferred.length?deferred[deferredAt]:at;result.truncated=true;}
  if(selected.some(item=>item.remaining.some(key=>!deliveredRoutes.has(key))))result.truncated=true;
  // Resources without a delivered route retain the same exact metadata rescue, within the shared card cap.
  for(const [id,score] of ranked(resourceRanks).slice(0,budget.seeds)){
   if(deliveredResources.has(id)||!eligible(id))continue;if(count>=maxNodes){result.truncated=true;break;}
   const e=prepared.entries.get(id)!;if(fit(result.uncovered,{id,node:e.node,...(e.meta?{meta:e.meta}:{}),score},id)){deliveredResources.add(id);count++;}
  }
  const deliveredLinks=new Set<string>();
  for(const item of selected)for(const route of item.preview.routes)for(const link of prepared.adjacency.get(refKey(route.ref))??[]){
   if(work.edgesVisited>=budget.edges){result.truncated=true;break;}work.edgesVisited++;
   if(deliveredLinks.has(link.id))continue;
   if(item.preview.links.length>=budget.neighbors||!deliveredRoutes.has(refKey(link.from))||!deliveredRoutes.has(refKey(link.to))){result.truncated=true;continue;}
   if(linkLive(link)&&fit(item.preview.links,link,link.id))deliveredLinks.add(link.id);
  }
  result.noFit=!result.clusters.length&&!result.uncovered.length;return finish();
 }
 let at=offset;
 while(at<candidates.length&&result.clusters.length<Math.min(budget.clusters,maxNodes)){
  const [id]=candidates[at++]!,cluster=prepared.clusters.get(id);if(!cluster||!routeLive(cluster.seed)||!cluster.contributors.every(ref=>eligible(catalogResourceIdV3(ref))))continue;
  const members=cluster.members.filter(routeLive);if(!members.length||members.length!==cluster.members.length)continue;
  const signature=members.join('|');if(memberSignatures.has(signature))continue;memberSignatures.add(signature);
  const visible=modern?[...members].sort((a,b)=>(routeRanks.get(b)??0)-(routeRanks.get(a)??0)||a.localeCompare(b)).slice(0,budget.previews):[cluster.seed,...members.filter(key=>key!==cluster.seed).sort((a,b)=>Number(prepared.routes.get(a)!.transformation===prepared.routes.get(cluster.seed)!.transformation)-Number(prepared.routes.get(b)!.transformation===prepared.routes.get(cluster.seed)!.transformation)||a.localeCompare(b))].slice(0,budget.previews),links:MethodLinkV3[]=[];
  for(const key of visible)for(const l of prepared.adjacency.get(key)??[]){if(work.edgesVisited>=budget.edges){result.truncated=true;break;}work.edgesVisited++;if(links.length<budget.neighbors&&linkLive(l)&&!links.some(x=>x.id===l.id))links.push(l);}
  const preview:ClusterCardV3={id,revision:cluster.revision,scale:'neighborhood',title:prepared.routes.get(cluster.seed)!.transformation,routes:visible.map(k=>card(prepared.routes.get(k)!)),memberCount:members.length,links,applicability:'unknown',notice:(members.length===1?'Provisional single-route navigation item; no reliable multi-route cluster yet. ':'Reviewed structural neighborhood; ')+'Shared proximity proves neither common prerequisites nor applicability. Failure hints come from individual routes; no unlisted counterexample is implied.'};
  if(fit(result.clusters,preview,id)){for(const key of visible)deliveredResources.add(catalogResourceIdV3(prepared.routes.get(key)!.resourceRef));}
 }
 if(at<candidates.length){result.nextOffset=at;result.truncated=true;}
 // Without delivered clusters, show a few explicitly unclustered candidates, never invented neighborhoods.
 if(!result.clusters.length&&resourceRanks.size>1){
  result.notice+=' Unclustered fallback; no reviewed clusters delivered. Card/byte/work limits may omit matches. Offset does not page these cards; use view=global, offset=0 or revise query.';
  const matches=ranked(resourceRanks);if(matches.length>budget.seeds)result.truncated=true;
  for(const [id,score] of matches.slice(0,budget.seeds)){
   if(deliveredResources.has(id)||!eligible(id))continue;
   if(result.uncovered.length>=Math.min(maxNodes,budget.clusters)){result.truncated=true;break;}
   const e=prepared.entries.get(id)!;fit(result.uncovered,{id,node:e.node,...(e.meta?{meta:e.meta}:{}),score},id);
  }
 }else{
  // Preserve the original single strong orphan lane when clusters are delivered (and for singletons).
  for(const [id,score] of ranked(resourceRanks).slice(0,budget.seeds)){if(deliveredResources.has(id)||!eligible(id))continue;const e=prepared.entries.get(id)!;if(fit(result.uncovered,{id,node:e.node,...(e.meta?{meta:e.meta}:{}),score},id))break;}
 }
 result.noFit=!result.clusters.length&&!result.uncovered.length;return finish();
 function finish():NetworkSelectionV3 {
  while(byteSize()>maxBytes&&result.oversizedRefs.length)result.oversizedRefs.pop();
  if(byteSize()>maxBytes)throw new Error('Method network navigation envelope exceeds maxChars; retry with a larger window.');
  return structuredClone(result);
 }
}

/** Persisted navigation has a closed technical shape; validation confers no scientific authority. */
export function validNetworkSelectionV3(value:unknown,pin?:NetworkPinV3):value is NetworkSelectionV3 {
 if(!object(value)||!keys(value,['pin','clusters','uncovered','routes','nextOffset','truncated','noFit','oversizedRefs','work','notice'])||!validNetworkPinV3(value.pin)||pin&&stableHash(value.pin)!==stableHash(pin))return false;
 const nonnegative=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
 const routeCard=(v:unknown)=>object(v)&&keys(v,['ref','resourceRef','title','summary','transformation','conditions','outputs','checks','failures','roles','alternatives','applicability'])&&ref(v.ref)&&ref(v.resourceRef)&&[v.title,v.summary,v.transformation].every(text)&&[v.conditions,v.outputs,v.checks,v.failures].every(strings)&&refs(v.alternatives)&&v.applicability==='unknown'&&Array.isArray(v.roles)&&v.roles.every(role=>object(role)&&keys(role,['name','kind','description'])&&text(role.name)&&['input','output'].includes(String(role.kind))&&text(role.description));
 const link=(v:unknown)=>object(v)&&keys(v,['id','version','from','to','relation','basis','bridgeConditions','sourceRefs','score'])&&ref({id:v.id,version:v.version})&&ref(v.from)&&ref(v.to)&&relations.includes(v.relation as MethodRelationV3)&&text(v.basis)&&strings(v.bridgeConditions)&&refs(v.sourceRefs)&&(v.score===undefined||typeof v.score==='number'&&Number.isFinite(v.score)&&v.score>=0&&v.score<=1);
 const cluster=(v:unknown)=>object(v)&&keys(v,['id','revision','scale','title','routes','memberCount','links','applicability','notice'])&&text(v.id)&&typeof v.revision==='string'&&/^[a-f0-9]{64}$/u.test(v.revision)&&v.scale==='neighborhood'&&text(v.title)&&Array.isArray(v.routes)&&v.routes.every(routeCard)&&nonnegative(v.memberCount)&&Number(v.memberCount)>=v.routes.length&&Array.isArray(v.links)&&v.links.every(link)&&v.applicability==='unknown'&&text(v.notice);
 const entry=(v:unknown)=>object(v)&&keys(v,['id','node','meta','score'])&&text(v.id)&&object(v.node)&&v.node.id===v.id&&typeof v.score==='number'&&Number.isFinite(v.score)&&(v.meta===undefined||object(v.meta)&&ref({id:v.meta.id,version:v.meta.version}));
 return Array.isArray(value.clusters)&&value.clusters.every(cluster)&&Array.isArray(value.routes)&&value.routes.every(routeCard)&&Array.isArray(value.uncovered)&&value.uncovered.every(entry)&&typeof value.truncated==='boolean'&&typeof value.noFit==='boolean'&&strings(value.oversizedRefs)&&text(value.notice)&&(value.nextOffset===undefined||nonnegative(value.nextOffset))&&object(value.work)&&keys(value.work,['postingsVisited','candidatesScored','entriesVisited','eligibilityChecks','edgesVisited','expandedObjects','bodyReads'])&&Object.values(value.work).every(nonnegative)&&value.work.bodyReads===0;
}

/** Revalidate exact immutable contributions and current authority before frozen navigation is redelivered. */
export function validateMethodNetworkSelectionV3(prepared:PreparedNetworkV3,pin:NetworkPinV3,selection:unknown,available:(entry:IndexedEntryV3)=>boolean=()=>true):asserts selection is NetworkSelectionV3 {
 check(validNetworkSelectionV3(selection,pin)&&pin.networkHash===prepared.hash&&pin.catalogHash===prepared.index.catalogHash,'frozen selection binding');
 const result=selection as NetworkSelectionV3,checked=new Set<string>();
 const resource=(r:ResourceRef)=>{const id=catalogResourceIdV3(r);if(checked.has(id))return;const entry=prepared.entries.get(id);check(entry&&available(entry),'withdrawn selection contributor');checked.add(id);};
 const route=(key:string)=>{const r=prepared.routes.get(key);check(r&&r.status==='active','missing selection route');for(const ref of [r!.resourceRef,...r!.sourceRefs,...r!.alternatives])resource(ref);return r!;};
 const routeCard=(c:RouteCardV3)=>check(stableHash(card(route(refKey(c.ref))))===stableHash(c),'changed route card');
 for(const c of result.routes)routeCard(c);
 for(const c of result.clusters){
  const indexed=prepared.clusters.get(c.id);check(indexed&&indexed.revision===c.revision,'changed cluster binding');
  // The seed and every contributor were used to derive the immutable cluster revision, even if previews were short.
  for(const key of indexed!.members)route(key);for(const ref of indexed!.contributors)resource(ref);
  check(c.title===route(indexed!.seed).transformation,'changed cluster title');
  for(const preview of c.routes){check(indexed!.members.includes(refKey(preview.ref)),'foreign cluster preview');routeCard(preview);}
  for(const link of c.links){check(prepared.index.publication.links.some(exact=>stableHash(exact)===stableHash(link)),'changed cluster link');route(refKey(link.from));route(refKey(link.to));for(const ref of link.sourceRefs)resource(ref);}
 }
 for(const e of result.uncovered){const exact=prepared.entries.get(e.id);check(exact&&available(exact)&&stableHash(exact.node)===stableHash(e.node)&&stableHash(exact.meta??null)===stableHash(e.meta??null),'changed or withdrawn uncovered card');}
}
