import {stableHash} from './research-hash.js';
import type {ProofRef, ResourceMeta} from './research-data.js';
import type {KnowledgeNodeV3, KnowledgeQueryV3, KnowledgeEdgeV3} from '../research/versions/v3/knowledge.js';

/** Navigation only. A pin/card is not a body delivery or a scientific authority grant. */
export type CatalogAnalyzerV3='surface-v1'|'descriptors-v2';
export interface CatalogPinV3 {recipe:'hierarchy-index-v1';revision:string;indexHash:string}
export interface CatalogQueryV3 extends KnowledgeQueryV3 {facets?:string[]}
export interface CatalogEntryV3 {id:string;node:KnowledgeNodeV3;meta?:ResourceMeta;score:number}
export interface CatalogSelectionV3 {
 pin:CatalogPinV3;candidates:CatalogEntryV3[];nextOffset?:number;omittedRefCount:number;omittedRefs:string[];
 oversizedRefs:string[];total:number;truncated:boolean;edges:KnowledgeEdgeV3[];backlinks:{nodeId:string;from:string;relation:KnowledgeEdgeV3['relation']}[];
 work:{postingsVisited:number;candidatesScored:number;entriesVisited:number;eligibilityChecks:number;edgesVisited:number;bodyReads:0};
}
export interface CatalogMaterialV3 {pin:CatalogPinV3;node:KnowledgeNodeV3;meta?:ResourceMeta;body?:string;bodyHash?:string}
export interface CatalogInputV3 {generation:number;resources:ResourceMeta[];nodes:KnowledgeNodeV3[];supports:Record<string,ProofRef>;edges?:KnowledgeEdgeV3[]}
export interface CatalogBodyTermsV3 {hash:string;terms:string[]}
export interface IndexedEntryV3 {descriptorGroup?:string;id:string;node:KnowledgeNodeV3;meta?:ResourceMeta;support?:ProofRef;sourceHash:string;bodyHash?:string;bodyTerms?:string[];terms:Record<string,number>;facets:string[]}
export interface CatalogIndexV3 {analyzer?:CatalogAnalyzerV3;recipe:'hierarchy-index-v1';generation:number;sourceHash:string;entries:IndexedEntryV3[];edges:KnowledgeEdgeV3[]}
export interface PreparedCatalogIndexV3 {
 index:CatalogIndexV3;entries:ReadonlyMap<string,IndexedEntryV3>;ordinals:ReadonlyMap<string,number>;
 postings:ReadonlyMap<string,ReadonlyMap<string,number>>;facets:ReadonlyMap<string,readonly string[]>;adjacency:ReadonlyMap<string,readonly KnowledgeEdgeV3[]>;
}
export class CatalogUnavailableErrorV3 extends Error {
 readonly code='CATALOG_UNAVAILABLE';
 constructor(message:string,options?:ErrorOptions){super(message,options);this.name='CatalogUnavailableErrorV3';}
}
export class CatalogQueryBudgetErrorV3 extends Error {
 readonly code='CATALOG_QUERY_BUDGET';
 constructor(readonly minimumChars:number){super(`Catalog navigation metadata needs at least ${minimumChars} bytes; retry with a larger maxChars window.`);this.name='CatalogQueryBudgetErrorV3';}
}
export const catalogResourceIdV3=(ref:{id:string;version:number})=>`resource:${ref.id}:${ref.version}`;
export const catalogBodyKeyV3=(ref:{id:string;version:number})=>`${ref.id}:${ref.version}`;
export const catalogTermsV3=(text:string):string[]=>[...new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+|[∀∃¬]/gu)??[])].sort();
const lowSurfaceTerms=new Set('and or if then for when where with from into under over as on in a which whose'.split(' '));
const surfaceWeight=(term:string)=>lowSurfaceTerms.has(term)||/^\d+$/u.test(term)||/^[\p{L}](?:_[\p{L}\p{N}]+)?$/u.test(term)?0.05:1;
const descriptorText=(value:string)=>value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu,' ');
const ignored=new Set('the an is are was were be been being this that these those it its they their them we our you your he his she her of to by at'.split(' '));
/** Shared lexical weight; this is retrieval relevance, never applicability. */
export const catalogQueryTermWeightV3=(term:string):number=>ignored.has(term)?0:surfaceWeight(term);
export function validCatalogPinV3(value:unknown):value is CatalogPinV3 {
 const pin=value as CatalogPinV3;return !!pin&&pin.recipe==='hierarchy-index-v1'&&/^[a-f0-9]{40}$/u.test(pin.revision)&&/^[a-f0-9]{64}$/u.test(pin.indexHash)&&Object.keys(pin).sort().join(',')==='indexHash,recipe,revision';
}
export function resourceCatalogNodeV3(meta:ResourceMeta):KnowledgeNodeV3 {
 const id=catalogResourceIdV3(meta);return {id,kind:meta.kind==='specific-strategy'?'strategy':'way-skill',title:meta.title??meta.name,summary:meta.description,keywords:[...meta.tags],conditions:[...meta.conditions],risk:['Navigation only; judge applicability and read the exact resource before use.'],sourceRef:id,authorityRef:{id:meta.id,version:meta.version},status:'active'};
}
/** Runs at publication/freeze/recovery, never in a query. No stop-word removal from source descriptors. */
export function buildCatalogIndexV3(input:CatalogInputV3,options:{previous?:CatalogIndexV3;bodyTerms?:ReadonlyMap<string,CatalogBodyTermsV3>;analyzer?:CatalogAnalyzerV3;legacyShape?:boolean}={}):CatalogIndexV3 {
 const analyzer=options.analyzer??'descriptors-v2';
 if(analyzer!=='surface-v1'&&analyzer!=='descriptors-v2')throw new CatalogUnavailableErrorV3('Unknown frozen catalog analyzer.');
 const old=new Map((options.previous?.analyzer??'surface-v1')===analyzer?options.previous?.entries.map(entry=>[entry.id,entry]):[]);const entries:IndexedEntryV3[]=[];
 const add=(node:KnowledgeNodeV3,meta?:ResourceMeta,support?:ProofRef)=>{
  const id=node.id,sourceHash=stableHash({node,meta,support}),prior=old.get(id);
  if(prior?.sourceHash===sourceHash){entries.push(prior);return;}
  const terms:Record<string,number>=Object.create(null);
  const append=(text:string,weight:number)=>{for(const term of catalogTermsV3(text))terms[term]=Math.max(terms[term]??0,weight);};
  append(node.title,5);append(node.summary,3);append(node.keywords.join(' '),4);append(node.conditions.join(' '),3);if(!meta||analyzer==='surface-v1')append(node.risk.join(' '),0.25);
  if(meta)append(meta.semanticKey,2);
  let body:CatalogBodyTermsV3|undefined;
  if(meta?.catalogBodyHashV3){
   body=options.bodyTerms?.get(catalogBodyKeyV3(meta))??(prior?.bodyHash===meta.catalogBodyHashV3&&prior.bodyTerms?{hash:prior.bodyHash,terms:prior.bodyTerms}:undefined);
   if(!body||body.hash!==meta.catalogBodyHashV3||!Array.isArray(body.terms)||body.terms.some(term=>typeof term!=='string'))throw new CatalogUnavailableErrorV3('Missing or mismatched exact publication body terms.');
   for(const term of body.terms)terms[term]=Math.max(terms[term]??0,0.2);
  }
  const descriptorGroup=stableHash({kind:meta?.kind??node.kind,description:descriptorText(meta?.description??node.summary),conditions:node.conditions.map(descriptorText),tags:[...node.keywords].map(descriptorText).sort()});
  entries.push({...(analyzer==='descriptors-v2'?{descriptorGroup}:{}),id,node:structuredClone(node),...(meta?{meta:structuredClone(meta)}:{}),...(support?{support:structuredClone(support)}:{}),sourceHash,...(body?{bodyHash:body.hash,bodyTerms:[...new Set(body.terms)].sort()}:{}),terms,facets:meta?[meta.kind,...meta.tags]:[node.kind,...node.keywords.filter(term=>/^(subject|specialization):/u.test(term))]});
 };
 for(const meta of input.resources)if(meta.enabled&&meta.status==='valid')add(resourceCatalogNodeV3(meta),meta);
 const ids=new Set(entries.map(entry=>entry.id));
 for(const node of input.nodes)if(node.status==='active'&&!ids.has(node.id)){add(node,undefined,input.supports[node.id]);ids.add(node.id);}
 entries.sort((a,b)=>a.id.localeCompare(b.id));
 const edges=(input.edges??[]).filter(edge=>ids.has(edge.from)&&ids.has(edge.to)).map(edge=>structuredClone(edge)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {...(options.legacyShape?{}:{analyzer}),recipe:'hierarchy-index-v1',generation:input.generation,sourceHash:stableHash(input),entries,edges};
}
/** One validation/postings build per immutable pin. Host must check indexHash and authoritative binding first. */
export function prepareCatalogIndexV3(index:CatalogIndexV3):PreparedCatalogIndexV3 {
 if(index.analyzer!==undefined&&index.analyzer!=='surface-v1'&&index.analyzer!=='descriptors-v2'||index.recipe!=='hierarchy-index-v1'||!Number.isSafeInteger(index.generation)||!Array.isArray(index.entries))throw new CatalogUnavailableErrorV3('Malformed catalog index.');
 const entries=new Map<string,IndexedEntryV3>(),ordinals=new Map<string,number>(),postings=new Map<string,Map<string,number>>(),facets=new Map<string,string[]>();
 for(const [ordinal,entry] of index.entries.entries()){
  if(!entry||entry.id!==entry.node?.id||entries.has(entry.id)||typeof entry.terms!=='object'||!Array.isArray(entry.facets))throw new CatalogUnavailableErrorV3('Malformed catalog entry.');
  entries.set(entry.id,entry);ordinals.set(entry.id,ordinal);
  for(const [term,weight] of Object.entries(entry.terms)){if(!Number.isFinite(weight)||weight<=0)throw new CatalogUnavailableErrorV3('Malformed catalog posting.');let posting=postings.get(term);if(!posting)postings.set(term,posting=new Map());posting.set(entry.id,weight);}
  for(const facet of entry.facets){let posting=facets.get(facet);if(!posting)facets.set(facet,posting=[]);posting.push(entry.id);}
 }
 const adjacency=new Map<string,KnowledgeEdgeV3[]>();
 for(const edge of index.edges){if(!entries.has(edge.from)||!entries.has(edge.to))throw new CatalogUnavailableErrorV3('Malformed catalog edge.');for(const id of new Set([edge.from,edge.to])){let links=adjacency.get(id);if(!links)adjacency.set(id,links=[]);links.push(edge);}}
 return {index,entries,ordinals,postings,facets,adjacency};
}
const upperBound=(sorted:readonly number[],value:number)=>{let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>>1;if(sorted[mid]!<=value)lo=mid+1;else hi=mid;}return lo;};
/** Sparse ranked union followed by deterministic global fallback. Facets never exclude a global hit. */
export function queryCatalogIndexV3(prepared:PreparedCatalogIndexV3,pin:CatalogPinV3,query:CatalogQueryV3,available:(entry:IndexedEntryV3)=>boolean=()=>true):CatalogSelectionV3 {
 const modern=prepared.index.analyzer==='descriptors-v2';
 const maxNodes=Number.isInteger(query.maxNodes)?Math.max(1,Math.min(32,query.maxNodes!)):12;
 const maxChars=Number.isInteger(query.maxChars)?Math.max(512,Math.min(262144,query.maxChars!)):32768;
 const offset=Number.isSafeInteger(query.offset)&&query.offset!>=0?query.offset!:0;
 const ranks=new Map<string,number>();let postingsVisited=0;
 const work:CatalogSelectionV3['work']={postingsVisited:0,candidatesScored:0,entriesVisited:0,eligibilityChecks:0,edgesVisited:0,bodyReads:0},eligibility=new Map<string,boolean>();
 const eligible=(entry:IndexedEntryV3)=>{let live=eligibility.get(entry.id);if(live===undefined){work.entriesVisited++;work.eligibilityChecks++;live=available(entry);eligibility.set(entry.id,live);}return live;};
 for(const term of catalogTermsV3(String(query.query??'').slice(0,16384))){if(ignored.has(term))continue;const posting=prepared.postings.get(term);if(!posting)continue;
  const rarity=(1+Math.log(1+prepared.entries.size/posting.size))*(modern?surfaceWeight(term):1);
  for(const [id,weight] of posting){postingsVisited++;ranks.set(id,(ranks.get(id)??0)+weight*rarity);}
 }
 for(const facet of query.facets??[])for(const id of prepared.facets.get(facet)??[]){postingsVisited++;ranks.set(id,(ranks.get(id)??0)+2);}
 for(const ref of [...(query.refs??[]),...(query.goalIds??[])]){const id=prepared.entries.has(ref)?ref:(prepared.entries.has(`resource:${ref}`)?`resource:${ref}`:undefined);if(id)ranks.set(id,1e9);}
 const explicit=new Set([...(query.refs??[]),...(query.goalIds??[])].map(ref=>prepared.entries.has(ref)?ref:`resource:${ref}`));
 const maxHops=Number.isInteger(query.maxHops)?Math.max(0,Math.min(3,query.maxHops!)):1;
 let frontier=[...ranks.keys()];const expanded=new Set<string>();
 for(let hop=0;hop<maxHops&&frontier.length;hop++){const next:string[]=[];for(const id of frontier){if(expanded.has(id))continue;expanded.add(id);if(!eligible(prepared.entries.get(id)!))continue;for(const edge of prepared.adjacency.get(id)??[]){work.edgesVisited++;const target=edge.from===id?edge.to:edge.from;if(!eligible(prepared.entries.get(target)!))continue;if(!ranks.has(target)){ranks.set(target,1/(hop+2));next.push(target);}}}frontier=next;}
 let ranked=[...ranks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 if(modern){const seen=new Map<string,number>();for(const [id,score] of ranked){if(explicit.has(id)||!eligible(prepared.entries.get(id)!))continue;const group=prepared.entries.get(id)!.descriptorGroup??id,count=seen.get(group)??0;seen.set(group,count+1);ranks.set(id,score/(count+1));}ranked=[...ranks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}
 const blocked=ranked.map(([id])=>prepared.ordinals.get(id)!).sort((a,b)=>a-b);
 const idAt=(position:number)=>{if(position<ranked.length)return ranked[position]![0];const wanted=position-ranked.length;let lo=wanted,hi=Math.min(prepared.entries.size-1,wanted+blocked.length);while(lo<hi){const mid=Math.floor((lo+hi)/2);if(mid-upperBound(blocked,mid)<wanted)lo=mid+1;else hi=mid;}return prepared.index.entries[lo]!.id;};
 const result:CatalogSelectionV3={pin:structuredClone(pin),candidates:[],omittedRefCount:0,omittedRefs:[],oversizedRefs:[],total:prepared.entries.size,truncated:false,edges:[],backlinks:[],work};
 work.postingsVisited=postingsVisited;work.candidatesScored=ranks.size;
 const bytes=()=>Buffer.byteLength(JSON.stringify(result));
 const setPage=(position:number)=>{
  result.omittedRefCount=Math.max(0,result.total-position);
  result.truncated=position<result.total||result.oversizedRefs.length>0;
  if(position<result.total)result.nextOffset=position;else delete result.nextOffset;
 };
 const delivered:{kind:'card'|'oversized';position:number;id:string}[]=[];
 let position=offset;setPage(position);
 while(position<result.total){
  if(result.candidates.length>=maxNodes)break;
  const id=idAt(position),entry=prepared.entries.get(id)!;
  if(!eligible(entry)){position++;setPage(position);continue;}
  const card:CatalogEntryV3={id,node:entry.node,...(entry.meta?{meta:entry.meta}:{}),score:ranks.get(id)??0};
  result.candidates.push(structuredClone(card));setPage(position+1);
  if(bytes()<=maxChars){delivered.push({kind:'card',position,id});position++;continue;}
  result.candidates.pop();setPage(position);
  if(delivered.length)break;
  // A large metadata card remains discoverable via an exact node/resource reference.
  // One reference page always advances, or explicitly reports an insufficient envelope budget.
  result.oversizedRefs.push(id);setPage(position+1);
  if(bytes()>maxChars)throw new CatalogQueryBudgetErrorV3(bytes());
  delivered.push({kind:'oversized',position,id});position++;break;
 }
 setPage(position);
 if(result.oversizedRefs.length)result.truncated=true;
 if(position<result.total){for(let i=position;i<Math.min(result.total,position+16);i++){result.omittedRefs.push(idAt(i));if(bytes()>maxChars){result.omittedRefs.pop();break;}}}
 const included=new Set(result.candidates.map(entry=>entry.id)),links=new Set<KnowledgeEdgeV3>();
 for(const id of included)for(const edge of prepared.adjacency.get(id)??[]){work.edgesVisited++;if(included.has(edge.from)&&included.has(edge.to))links.add(edge);}
 for(const edge of links){result.edges.push(structuredClone(edge));result.backlinks.push({nodeId:edge.to,from:edge.from,relation:edge.relation});if(bytes()>maxChars){result.edges.pop();result.backlinks.pop();result.truncated=true;}}
 // Eligibility/edge counters can gain digits after an earlier card was selected.
 while(bytes()>maxChars&&result.omittedRefs.length)result.omittedRefs.pop();
 while(bytes()>maxChars&&result.edges.length){result.edges.pop();result.backlinks.pop();result.truncated=true;}
 while(bytes()>maxChars&&delivered.length){const removed=delivered.pop()!;if(removed.kind==='card')result.candidates.pop();else result.oversizedRefs.pop();position=removed.position;setPage(position);result.edges=[];result.backlinks=[];result.omittedRefs=[];}
 if(bytes()>maxChars||position===offset&&position<result.total&&!delivered.length)throw new CatalogQueryBudgetErrorV3(bytes()+(position<result.total?Buffer.byteLength(JSON.stringify(idAt(position)))+4:0));
 return result;
}
