/** Heterogeneous navigation. Exact source authorization and scientific review belong to the owning stores. */
import {stableHash} from './research-hash.js';
import {catalogTermsV3,catalogQueryTermWeightV3} from './hierarchical-catalog-v3.js';

export type KnowledgeKind='method-skill'|'failure-skill'|'specific-strategy'|'finding'|'theory';
export interface KnowledgeRef {store:'library'|'theory';id:string;version:number;bodyHash:string}
export interface KnowledgeAssociations {object?:string[];method?:string[];process?:string[]}
export interface KnowledgeNode {scientificStatus?:'candidate'|'supported';ref:KnowledgeRef;kind:KnowledgeKind;title:string;summary:string;conditions:string[];associations?:KnowledgeAssociations;status:'active'|'withdrawn'}
export interface StrategyStep {id:string;skill:KnowledgeRef;conditions:string[]}
export interface StrategyComposition {id:string;strategy:KnowledgeRef;steps:StrategyStep[]}
export interface TheoryBinding {id:string;theory:KnowledgeRef;subject:KnowledgeRef;argument:string;conditions:string[];status:'active'|'withdrawn'}
export type KnowledgeRelation='same-object'|'same-method'|'similar-process'|'shared-theory';
export interface KnowledgeLink {id:string;from:KnowledgeRef;to:KnowledgeRef;relation:KnowledgeRelation;basis:string;conditions:string[];theory?:KnowledgeRef;status:'active'|'withdrawn'}
export interface KnowledgeNetworkState {recipe:'knowledge-network-v1';revision:number;nodes:KnowledgeNode[];compositions:StrategyComposition[];bindings:TheoryBinding[];links:KnowledgeLink[];receipts:Record<string,string>}
export type KnowledgePurpose='method-learning'|'strategy-learning'|'theory-study'|'network-review'|'host-projection';
export interface KnowledgeProposal {
 owner:KnowledgeRef;purpose:KnowledgePurpose;allowedRefs:KnowledgeRef[];reviewed:boolean;receiptId:string;expectedRevision:number;
 nodes?:KnowledgeNode[];
 composition?:{strategy:KnowledgeRef;steps:{skill:KnowledgeRef;conditions:string[]}[]};
 bindings?:{theory:KnowledgeRef;subject:KnowledgeRef;argument:string;conditions:string[];status?:'active'|'withdrawn'}[];
 links?:{from:KnowledgeRef;to:KnowledgeRef;relation:KnowledgeRelation;basis:string;conditions:string[];theory?:KnowledgeRef;status?:'active'|'withdrawn'}[];
}
export interface KnowledgeQuery {text?:string;seeds?:KnowledgeRef[];associations?:KnowledgeAssociations;offset?:number;limit?:number;global?:boolean}
export interface KnowledgeMatchReason {kind:'seed'|'association'|'direct'|'fof'|'shared-theory'|'theory-binding'|'composition'|'lexical';candidateOnly:boolean;via?:KnowledgeRef[];relation?:KnowledgeRelation;direction?:'outgoing'|'incoming';association?:string}
export interface KnowledgeCandidate {selection:number;node:KnowledgeNode;score:number;reasons:KnowledgeMatchReason[]}
export interface KnowledgeSelection {recipe:'knowledge-network-v1';revision:number;nodes:KnowledgeCandidate[];links:KnowledgeLink[];bindings:TheoryBinding[];compositions:StrategyComposition[];total:number;nextOffset?:number;truncated:boolean;work:{postingsVisited:number;edgesVisited:number;expanded:number;bodyReads:0};notice:string}
export interface PreparedKnowledgeNetwork {
 state:KnowledgeNetworkState;nodes:ReadonlyMap<string,KnowledgeNode>;postings:ReadonlyMap<string,ReadonlyMap<string,number>>;
 associations:ReadonlyMap<string,ReadonlySet<string>>;adjacency:ReadonlyMap<string,readonly KnowledgeLink[]>;
 subjectBindings:ReadonlyMap<string,readonly TheoryBinding[]>;theoryBindings:ReadonlyMap<string,readonly TheoryBinding[]>;
 compositions:ReadonlyMap<string,StrategyComposition>;skillStrategies:ReadonlyMap<string,readonly StrategyComposition[]>;
}
export const KNOWLEDGE_RELATION_WEIGHTS=Object.freeze({'same-object':0.35,'same-method':0.70,'similar-process':0.80,'shared-theory':0.85});
export const knowledgeRefKey=(ref:KnowledgeRef):string=>JSON.stringify([ref.store,ref.id,ref.version,ref.bodyHash]);
export const emptyKnowledgeNetwork=():KnowledgeNetworkState=>({recipe:'knowledge-network-v1',revision:0,nodes:[],compositions:[],bindings:[],links:[],receipts:{}});
/** New route-cluster view excludes cases before indexing, expansion or binding. Stored history remains intact. */
export function routeClusterView(state:KnowledgeNetworkState):KnowledgeNetworkState {
 const nodes=state.nodes.filter(n=>n.kind!=='finding'),keys=new Set(nodes.map(n=>knowledgeRefKey(n.ref))),has=(ref:KnowledgeRef)=>keys.has(knowledgeRefKey(ref));
 return {...structuredClone(state),nodes:structuredClone(nodes),links:state.links.filter(l=>has(l.from)&&has(l.to)&&(!l.theory||has(l.theory))),bindings:state.bindings.filter(b=>has(b.theory)&&has(b.subject)),compositions:state.compositions.filter(c=>has(c.strategy)&&c.steps.every(s=>has(s.skill)))};
}
const fail=(condition:unknown,message:string):void=>{if(!condition)throw new Error(`Invalid knowledge network: ${message}`);};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:readonly string[])=>Object.keys(v).every(k=>allowed.includes(k));
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const texts=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(text);
export function validKnowledgeRef(v:unknown):v is KnowledgeRef {return record(v)&&keys(v,['store','id','version','bodyHash'])&&(v.store==='library'||v.store==='theory')&&text(v.id)&&Number.isSafeInteger(v.version)&&Number(v.version)>0&&typeof v.bodyHash==='string'&&/^[a-f0-9]{64}$/u.test(v.bodyHash);}
const refs=(v:unknown):v is KnowledgeRef[]=>Array.isArray(v)&&v.every(validKnowledgeRef);
const associations=(v:unknown):v is KnowledgeAssociations=>record(v)&&keys(v,['object','method','process'])&&Object.values(v).every(texts);
const active=(v:{status:string})=>v.status==='active';
const same=(a:KnowledgeRef,b:KnowledgeRef)=>knowledgeRefKey(a)===knowledgeRefKey(b);
const sameFamily=(a:KnowledgeRef,b:KnowledgeRef)=>a.store===b.store&&a.id===b.id;
const kindAllowed=(kind:KnowledgeKind,purpose:KnowledgePurpose)=>purpose==='host-projection'||purpose==='network-review'||purpose==='method-learning'&&['method-skill','failure-skill'].includes(kind)||purpose==='strategy-learning'&&kind==='specific-strategy'||purpose==='theory-study'&&['theory','finding'].includes(kind);
const bindingId=(theory:KnowledgeRef,subject:KnowledgeRef)=>'binding_'+stableHash([theory,subject]);
const linkId=(from:KnowledgeRef,to:KnowledgeRef,relation:KnowledgeRelation,theory?:KnowledgeRef)=>'link_'+stableHash([[knowledgeRefKey(from),knowledgeRefKey(to)].sort(),relation,theory]);
const compositionId=(strategy:KnowledgeRef)=>'composition_'+stableHash(strategy);
const validStatus=(v:unknown)=>v==='active'||v==='withdrawn';

/** Validates technical shape and references, never the mathematical argument. */
export function validateKnowledgeNetwork(value:unknown):asserts value is KnowledgeNetworkState {
 fail(record(value),'state object');const s=value as KnowledgeNetworkState;
 fail(keys(value as Record<string,unknown>,['recipe','revision','nodes','compositions','bindings','links','receipts'])&&s.recipe==='knowledge-network-v1'&&Number.isSafeInteger(s.revision)&&s.revision>=0,'recipe/revision');
 fail([s.nodes,s.compositions,s.bindings,s.links].every(Array.isArray)&&record(s.receipts)&&Object.values(s.receipts).every(text),'collections');
 const nodes=new Map<string,KnowledgeNode>(),identities=new Map<string,string>();
 for(const n of s.nodes){
  fail(record(n)&&keys(n as unknown as Record<string,unknown>,['ref','kind','title','summary','conditions','associations','status','scientificStatus'])&&validKnowledgeRef(n.ref),'node reference');
  fail(['method-skill','failure-skill','specific-strategy','finding','theory'].includes(n.kind)&&text(n.title)&&typeof n.summary==='string'&&texts(n.conditions)&&validStatus(n.status)&&(n.associations===undefined||associations(n.associations)),'node metadata');
  fail(n.scientificStatus===undefined||['candidate','supported'].includes(n.scientificStatus),'scientific qualification');
  fail((n.ref.store==='theory')===['finding','theory'].includes(n.kind),'node store/kind');
  const key=knowledgeRefKey(n.ref),identity=JSON.stringify([n.ref.store,n.ref.id,n.ref.version]);
  fail(!nodes.has(key)&&(!identities.has(identity)||identities.get(identity)===n.ref.bodyHash),'duplicate or changed immutable node');
  nodes.set(key,n);identities.set(identity,n.ref.bodyHash);
 }
 const node=(ref:KnowledgeRef)=>validKnowledgeRef(ref)?nodes.get(knowledgeRefKey(ref)):undefined;
 const ids=new Set<string>();
 for(const c of s.compositions){
  fail(record(c)&&keys(c as unknown as Record<string,unknown>,['id','strategy','steps'])&&validKnowledgeRef(c.strategy)&&c.id===compositionId(c.strategy)&&!ids.has(c.id)&&node(c.strategy)?.kind==='specific-strategy'&&Array.isArray(c.steps),'composition');ids.add(c.id);
  for(const [i,step] of c.steps.entries())fail(record(step)&&keys(step as unknown as Record<string,unknown>,['id','skill','conditions'])&&validKnowledgeRef(step.skill)&&['method-skill','failure-skill'].includes(node(step.skill)?.kind??'')&&step.id==='step_'+stableHash([c.strategy,i,step.skill])&&texts(step.conditions),'ordered Skill occurrence');
 }
 ids.clear();
 for(const b of s.bindings){
  fail(record(b)&&keys(b as unknown as Record<string,unknown>,['id','theory','subject','argument','conditions','status'])&&validKnowledgeRef(b.theory)&&validKnowledgeRef(b.subject)&&b.id===bindingId(b.theory,b.subject)&&!ids.has(b.id),'binding identity');ids.add(b.id);
  fail(node(b.theory)?.kind==='theory'&&!!node(b.subject)&&!same(b.theory,b.subject)&&text(b.argument)&&texts(b.conditions)&&validStatus(b.status),'binding content');
 }
 ids.clear();
 for(const l of s.links){
  fail(record(l)&&keys(l as unknown as Record<string,unknown>,['id','from','to','relation','basis','conditions','theory','status'])&&validKnowledgeRef(l.from)&&validKnowledgeRef(l.to)&&!!node(l.from)&&!!node(l.to)&&!same(l.from,l.to)&&Object.hasOwn(KNOWLEDGE_RELATION_WEIGHTS,l.relation),'link endpoints/relation');
  fail((l.theory===undefined||validKnowledgeRef(l.theory))&&l.id===linkId(l.from,l.to,l.relation,l.theory)&&!ids.has(l.id)&&text(l.basis)&&texts(l.conditions)&&validStatus(l.status),'link content');ids.add(l.id);
  fail(node(l.from)!.kind===node(l.to)!.kind||['similar-process','shared-theory'].includes(l.relation),'cross-type link basis');
  fail(l.relation==='shared-theory'?!!l.theory&&node(l.theory)?.kind==='theory':l.theory===undefined,'shared theory reference');
  // Withdrawn bindings may invalidate old links without deleting scientific history.
  if(l.relation==='shared-theory')fail(s.bindings.some(b=>same(b.theory,l.theory!)&&same(b.subject,l.from))&&s.bindings.some(b=>same(b.theory,l.theory!)&&same(b.subject,l.to)),'shared theory requires two exact bindings');
 }
}

/** Author grants and reviewed flags are supplied by the owning runtime, never trusted from model text. */
export function applyKnowledgeProposal(state:KnowledgeNetworkState,p:KnowledgeProposal):KnowledgeNetworkState {
 validateKnowledgeNetwork(state);
 fail(record(p)&&keys(p as unknown as Record<string,unknown>,['owner','purpose','allowedRefs','reviewed','receiptId','expectedRevision','nodes','composition','bindings','links'])&&validKnowledgeRef(p.owner)&&refs(p.allowedRefs),'proposal/grants');
 fail(['method-learning','strategy-learning','theory-study','network-review','host-projection'].includes(p.purpose)&&typeof p.reviewed==='boolean'&&text(p.receiptId)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0,'proposal controls');
 const allowed=new Set(p.allowedRefs.map(knowledgeRefKey));const permitted=(r:KnowledgeRef)=>validKnowledgeRef(r)&&allowed.has(knowledgeRefKey(r));
 fail(permitted(p.owner),'owner not granted');
 fail((p.nodes===undefined||Array.isArray(p.nodes))&&(p.bindings===undefined||Array.isArray(p.bindings))&&(p.links===undefined||Array.isArray(p.links)),'proposal collections');
 const host=p.purpose==='host-projection';
 fail(!host||(!p.composition&&!p.bindings?.length&&!p.links?.length),'host projection cannot author science');
 fail(host||p.reviewed,'scientific navigation requires review');
 for(const n of p.nodes??[]){fail(record(n)&&validKnowledgeRef(n.ref)&&permitted(n.ref),'node outside grant');fail(host||same(n.ref,p.owner),'author cannot rewrite another node');fail(!host||n.associations===undefined,'host projection cannot invent reviewed associations');}
 for(const b of p.bindings??[])fail(record(b)&&permitted(b.theory)&&permitted(b.subject),'binding outside grant');
 for(const l of p.links??[])fail(record(l)&&permitted(l.from)&&permitted(l.to)&&(l.theory===undefined||permitted(l.theory)),'link outside grant');
 if(p.composition)fail(record(p.composition)&&validKnowledgeRef(p.composition.strategy)&&permitted(p.composition.strategy)&&Array.isArray(p.composition.steps)&&p.composition.steps.every(s=>record(s)&&permitted(s.skill)),'composition outside grant');
 const {expectedRevision:_revision,...identity}=p;const hash=stableHash(identity);
 if(Object.hasOwn(state.receipts,p.receiptId)){fail(state.receipts[p.receiptId]===hash,'changed receipt replay');return structuredClone(state);}
 fail(state.revision===p.expectedRevision,'stale expected revision');
 const next=structuredClone(state);
 for(const n of p.nodes??[]){
  const old=next.nodes.find(v=>same(v.ref,n.ref));
  fail(!next.nodes.some(v=>sameFamily(v.ref,n.ref)&&v.ref.version===n.ref.version&&!same(v.ref,n.ref)),'immutable body hash changed');
  fail(!old||old.kind===n.kind,'node kind changed');
  const incoming=structuredClone(n);
  if(host&&old?.associations)incoming.associations=structuredClone(old.associations);
  if(old)next.nodes[next.nodes.indexOf(old)]=incoming;else next.nodes.push(incoming);
 }
 const owner=next.nodes.find(n=>same(n.ref,p.owner));fail(owner&&kindAllowed(owner.kind,p.purpose),'author purpose/owner mismatch');
 const currentNode=(r:KnowledgeRef)=>next.nodes.find(n=>same(n.ref,r)&&active(n));
 if(p.composition){
  fail(keys(p.composition as unknown as Record<string,unknown>,['strategy','steps'])&&p.purpose==='strategy-learning'&&same(p.composition.strategy,p.owner)&&currentNode(p.owner)?.kind==='specific-strategy','composition owner');
  const steps=p.composition.steps.map((step,i)=>{fail(keys(step as unknown as Record<string,unknown>,['skill','conditions'])&&texts(step.conditions)&&['method-skill','failure-skill'].includes(currentNode(step.skill)?.kind??''),'composition step');return {id:'step_'+stableHash([p.owner,i,step.skill]),skill:structuredClone(step.skill),conditions:[...step.conditions]};});
  const c={id:compositionId(p.owner),strategy:structuredClone(p.owner),steps};next.compositions=next.compositions.filter(v=>v.id!==c.id);next.compositions.push(c);
 }
 for(const input of p.bindings??[]){
  fail(keys(input as unknown as Record<string,unknown>,['theory','subject','argument','conditions','status'])&&['theory-study','network-review'].includes(p.purpose),'binding author');
  fail(p.purpose==='theory-study'?same(input.theory,p.owner):same(input.theory,p.owner)||same(input.subject,p.owner),'binding must concern owner');
  fail(currentNode(input.theory)?.kind==='theory'&&currentNode(input.theory)?.scientificStatus!=='candidate'&&currentNode(input.subject)&&!same(input.theory,input.subject),'binding live endpoints');
  const b:TheoryBinding={...structuredClone(input),id:bindingId(input.theory,input.subject),status:input.status??'active'};next.bindings=next.bindings.filter(v=>v.id!==b.id);next.bindings.push(b);
 }
 for(const input of p.links??[]){
  fail(keys(input as unknown as Record<string,unknown>,['from','to','relation','basis','conditions','theory','status'])&&(same(input.from,p.owner)||same(input.to,p.owner)),'link must concern owner');
  fail(currentNode(input.from)&&currentNode(input.to),'link live endpoints');
  if(input.relation==='shared-theory'&&input.status!=='withdrawn')fail(input.theory&&currentNode(input.theory)?.kind==='theory'&&[input.from,input.to].every(ref=>next.bindings.some(b=>active(b)&&same(b.theory,input.theory!)&&same(b.subject,ref))),'shared theory bindings are unavailable');
  const l:KnowledgeLink={...structuredClone(input),id:linkId(input.from,input.to,input.relation,input.theory),status:input.status??'active'};next.links=next.links.filter(v=>v.id!==l.id);next.links.push(l);
 }
 next.revision++;Object.defineProperty(next.receipts,p.receiptId,{value:hash,enumerable:true,writable:true,configurable:true});validateKnowledgeNetwork(next);return next;
}

const append=<T>(map:Map<string,T[]>,key:string,value:T)=>{const values=map.get(key)??[];values.push(value);map.set(key,values);};
const associationKey=(kind:string,value:string)=>JSON.stringify([kind,value]);
export function prepareKnowledgeNetwork(state:KnowledgeNetworkState,previous?:PreparedKnowledgeNetwork):PreparedKnowledgeNetwork {
 validateKnowledgeNetwork(state);const snapshot=structuredClone(state),nodes=new Map(snapshot.nodes.map(n=>[knowledgeRefKey(n.ref),n]));
 const postings=new Map([...previous?.postings??[]].map(([k,v])=>[k,new Map(v)])),associationIndex=new Map([...previous?.associations??[]].map(([k,v])=>[k,new Set(v)])),adjacency=new Map([...previous?.adjacency??[]].map(([k,v])=>[k,[...v]])),subjectBindings=new Map([...previous?.subjectBindings??[]].map(([k,v])=>[k,[...v]])),theoryBindings=new Map([...previous?.theoryBindings??[]].map(([k,v])=>[k,[...v]])),compositions=new Map(previous?.compositions),skillStrategies=new Map([...previous?.skillStrategies??[]].map(([k,v])=>[k,[...v]]));
 const changedNodes=new Set([...nodes.keys(),...previous?.nodes.keys()??[]].filter(key=>stableHash(nodes.get(key)??null)!==stableHash(previous?.nodes.get(key)??null)));
 const remove=<T extends {id:string}>(map:Map<string,T[]>,key:string,id:string)=>{const remaining=map.get(key)?.filter(v=>v.id!==id);if(remaining?.length)map.set(key,remaining);else map.delete(key);};
 const changes=<T extends {id:string}>(old:readonly T[],next:readonly T[])=>{const before=new Map(old.map(v=>[v.id,v])),after=new Map(next.map(v=>[v.id,v]));return {removed:old.filter(v=>stableHash(v)!==stableHash(after.get(v.id)??null)),added:next.filter(v=>stableHash(v)!==stableHash(before.get(v.id)??null))};};
 // Retokenize only changed metadata; exact snapshot arrays remain the canonical representation.
 for(const key of changedNodes){
  const prior=previous?.nodes.get(key);if(prior){
   for(const term of catalogTermsV3([prior.title,prior.summary,...prior.conditions].join(' '))){const values=postings.get(term);values?.delete(key);if(!values?.size)postings.delete(term);}
   for(const [kind,values] of Object.entries(prior.associations??{}))for(const value of values){const k=associationKey(kind,value),ids=associationIndex.get(k);ids?.delete(key);if(!ids?.size)associationIndex.delete(k);}
  }
  const n=nodes.get(key);if(!n||!active(n))continue;
  for(const [value,weight] of [[n.title,3],[n.summary,1],[n.conditions.join(' '),1]] as const)for(const term of catalogTermsV3(value)){if(!catalogQueryTermWeightV3(term))continue;const values=postings.get(term)??new Map<string,number>();values.set(key,Math.max(values.get(key)??0,weight));postings.set(term,values);}
  for(const [kind,values] of Object.entries(n.associations??{}))for(const value of values){const k=associationKey(kind,value),ids=associationIndex.get(k)??new Set<string>();ids.add(key);associationIndex.set(k,ids);}
 }
 const links=changes(previous?.state.links??[],snapshot.links),bindings=changes(previous?.state.bindings??[],snapshot.bindings),routes=changes(previous?.state.compositions??[],snapshot.compositions);
 for(const l of links.removed){remove(adjacency,knowledgeRefKey(l.from),l.id);remove(adjacency,knowledgeRefKey(l.to),l.id);}
 for(const l of links.added)if(active(l)){append(adjacency,knowledgeRefKey(l.from),l);append(adjacency,knowledgeRefKey(l.to),l);}
 for(const b of bindings.removed){remove(subjectBindings,knowledgeRefKey(b.subject),b.id);remove(theoryBindings,knowledgeRefKey(b.theory),b.id);}
 for(const b of bindings.added)if(active(b)){append(subjectBindings,knowledgeRefKey(b.subject),b);append(theoryBindings,knowledgeRefKey(b.theory),b);}
 for(const c of routes.removed){compositions.delete(knowledgeRefKey(c.strategy));for(const step of c.steps)remove(skillStrategies,knowledgeRefKey(step.skill),c.id);}
 for(const c of routes.added){compositions.set(knowledgeRefKey(c.strategy),c);for(const step of c.steps)if(!skillStrategies.get(knowledgeRefKey(step.skill))?.some(s=>s.id===c.id))append(skillStrategies,knowledgeRefKey(step.skill),c);}
 return {state:snapshot,nodes,postings,associations:associationIndex,adjacency,subjectBindings,theoryBindings,compositions,skillStrategies};
}

/** Indexed discovery only. Host must reauthorize the exact selection again before opening its canonical body. */
export function queryKnowledge(input:KnowledgeNetworkState|PreparedKnowledgeNetwork,q:KnowledgeQuery,allowedRefs:readonly KnowledgeRef[]):KnowledgeSelection {
 const p='state'in input?input:prepareKnowledgeNetwork(input);fail(record(q)&&keys(q as unknown as Record<string,unknown>,['text','seeds','associations','offset','limit','global'])&&(q.text===undefined||typeof q.text==='string')&&(q.seeds===undefined||refs(q.seeds))&&(q.associations===undefined||associations(q.associations))&&(q.global===undefined||typeof q.global==='boolean'),'query');
 fail(refs(allowedRefs),'query grants');const offset=q.offset??0,limit=q.limit??24;fail(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=256,'query page');
 const allowed=new Set(allowedRefs.map(knowledgeRefKey));const visible=(r:KnowledgeRef)=>allowed.has(knowledgeRefKey(r))&&p.nodes.get(knowledgeRefKey(r))?.status==='active';
 const visibleKey=(key:string)=>allowed.has(key)&&p.nodes.get(key)?.status==='active';
 const validBinding=(b:TheoryBinding)=>p.nodes.get(knowledgeRefKey(b.theory))?.scientificStatus!=='candidate'&&active(b)&&visible(b.theory)&&visible(b.subject);
 const validLink=(l:KnowledgeLink)=>active(l)&&visible(l.from)&&visible(l.to)&&(l.relation!=='shared-theory'||!!l.theory&&visible(l.theory)&&[l.from,l.to].every(r=>p.subjectBindings.get(knowledgeRefKey(r))?.some(b=>validBinding(b)&&same(b.theory,l.theory!))));
 const validComposition=(c:StrategyComposition)=>visible(c.strategy)&&c.steps.every(s=>visible(s.skill));
 const found=new Map<string,{score:number;reasons:KnowledgeMatchReason[]}>();
 const work={postingsVisited:0,edgesVisited:0,expanded:0,bodyReads:0 as const};
 const add=(key:string,score:number,reason:KnowledgeMatchReason)=>{if(!visibleKey(key))return;const row=found.get(key)??{score:0,reasons:[]};row.score=Math.max(row.score,score);if(!row.reasons.some(r=>stableHash(r)===stableHash(reason)))row.reasons.push(reason);found.set(key,row);};
 const inferredSeeds=new Set<string>();
 const seeds=(q.seeds??[]).filter(visible);const seedsByKey=new Map(seeds.map(s=>[knowledgeRefKey(s),s]));
 if(q.global){for(const key of allowed)if(visibleKey(key))add(key,0,{kind:'lexical',candidateOnly:true});}
 else{
  const queryTerms=[...new Set(catalogTermsV3(q.text??''))].filter(t=>catalogQueryTermWeightV3(t)>0),lexical=new Map<string,number>();
  for(const term of queryTerms){const hits=p.postings.get(term);if(!hits)continue;const eligible=[...hits].filter(([key])=>visibleKey(key));const rarity=1/(1+Math.log(1+eligible.length));for(const [key,w] of eligible){work.postingsVisited++;lexical.set(key,(lexical.get(key)??0)+catalogQueryTermWeightV3(term)*w*rarity);}}
  const maxLex=Math.max(1,...lexical.values());for(const [key,score] of lexical)add(key,0.25*score/maxLex,{kind:'lexical',candidateOnly:true});
  if(!seeds.length)for(const [key] of [...lexical].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3)){
   const ref=p.nodes.get(key)!.ref;seeds.push(ref);seedsByKey.set(key,ref);inferredSeeds.add(key);
  }
  const requested:KnowledgeAssociations={...q.associations};
  for(const seed of seeds){const node=p.nodes.get(knowledgeRefKey(seed))!;for(const kind of ['object','method','process'] as const)requested[kind]=[...new Set([...(requested[kind]??[]),...(node.associations?.[kind]??[])])];}
  for(const [kind,values] of Object.entries(requested))for(const value of values){for(const key of p.associations.get(associationKey(kind,value))??[]){if(!visibleKey(key))continue;work.postingsVisited++;add(key,(kind==='object'?0.35:kind==='method'?0.70:0.80)*(inferredSeeds.size?0.25:1),{kind:'association',candidateOnly:true,association:associationKey(kind,value)});}}
  for(const [key,seed] of seedsByKey){
   const inferred=inferredSeeds.has(key),relevance=inferred?(found.get(key)?.score??0):1;
   if(!inferred)add(key,1,{kind:'seed',candidateOnly:false});work.expanded++;
   for(const l of p.adjacency.get(key)??[]){if(!validLink(l))continue;work.edgesVisited++;const target=same(l.from,seed)?l.to:l.from,targetKey=knowledgeRefKey(target),weight=KNOWLEDGE_RELATION_WEIGHTS[l.relation];add(targetKey,weight*relevance,{kind:'direct',candidateOnly:inferred,via:[seed],relation:l.relation});
    const outgoing=(p.adjacency.get(targetKey)??[]).filter(validLink),penalty=1/(1+Math.log(1+outgoing.length));
    for(const next of outgoing){work.edgesVisited++;const dest=same(next.from,target)?next.to:next.from;if(same(dest,seed))continue;add(knowledgeRefKey(dest),Math.min(weight,KNOWLEDGE_RELATION_WEIGHTS[next.relation])*0.5*penalty*relevance,{kind:'fof',candidateOnly:true,via:[seed,target]});}
   }
   for(const b of p.subjectBindings.get(key)??[]){if(!validBinding(b))continue;work.edgesVisited++;add(knowledgeRefKey(b.theory),0.85*relevance,{kind:'theory-binding',candidateOnly:inferred,via:[seed],direction:'incoming'});
    for(const peer of p.theoryBindings.get(knowledgeRefKey(b.theory))??[]){if(!validBinding(peer)||same(peer.subject,seed))continue;work.edgesVisited++;add(knowledgeRefKey(peer.subject),0.85*relevance/(1+Math.log(1+(p.theoryBindings.get(knowledgeRefKey(b.theory))??[]).filter(validBinding).length)),{kind:'shared-theory',candidateOnly:true,via:[seed,b.theory],relation:'shared-theory'});}
   }
   for(const b of p.theoryBindings.get(key)??[]){if(!validBinding(b))continue;work.edgesVisited++;add(knowledgeRefKey(b.subject),0.85*relevance,{kind:'theory-binding',candidateOnly:inferred,via:[seed],direction:'outgoing'});}
   const own=p.compositions.get(key);if(own&&validComposition(own))for(const step of own.steps)add(knowledgeRefKey(step.skill),0.8*relevance,{kind:'composition',candidateOnly:inferred,via:[seed],direction:'outgoing'});
   for(const c of p.skillStrategies.get(key)??[])if(validComposition(c))add(knowledgeRefKey(c.strategy),0.8*relevance,{kind:'composition',candidateOnly:inferred,via:[seed],direction:'incoming'});
  }
 }
 const ordered=[...found].sort((a,b)=>q.global?a[0].localeCompare(b[0]):b[1].score-a[1].score||a[0].localeCompare(b[0]));
 const page=ordered.slice(offset,offset+limit);const included=new Set([...page.map(([key])=>key),...seedsByKey.keys()]);
 const nodes=page.map(([key,value],i)=>({selection:offset+i+1,node:structuredClone(p.nodes.get(key)!),score:value.score,reasons:structuredClone(value.reasons)}));
 return {recipe:'knowledge-network-v1',revision:p.state.revision,nodes,
  links:p.state.links.filter(l=>validLink(l)&&included.has(knowledgeRefKey(l.from))&&included.has(knowledgeRefKey(l.to))).map(l=>structuredClone(l)),
  bindings:p.state.bindings.filter(b=>validBinding(b)&&included.has(knowledgeRefKey(b.theory))&&included.has(knowledgeRefKey(b.subject))).map(b=>structuredClone(b)),
  compositions:p.state.compositions.filter(c=>validComposition(c)&&included.has(knowledgeRefKey(c.strategy))).map(c=>structuredClone(c)),
  total:ordered.length,...(offset+page.length<ordered.length?{nextOffset:offset+page.length}:{}),truncated:offset>0||offset+page.length<ordered.length,work,
  notice:'Navigation is not proof. Lexical, association and friend-of-friend matches are comparison candidates only. Composition order is authored, not ranked. Exact source bodies require a separate authorized read.'};
}
