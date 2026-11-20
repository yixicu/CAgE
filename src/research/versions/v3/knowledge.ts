import {isAuthorityNavigationV3,groupAuthorityRanksV3} from './authority-navigation.js';
import { lexicalTermsLegacyV3 } from './knowledge-legacy-op1.js';
import { stableHash } from '../../../learning/research-hash.js';
import type { ResourceRef } from '../../../learning/research-data.js';
export type KnowledgeKindV3='problem-element'|'goal'|'reminder'|'method'|'way-skill'|'strategy'|'lemma'|'precondition'|'counterexample'|'operation'|'case'|'evidence'|'version';
export type KnowledgeRelationV3='related'|'requires'|'uses'|'refutes'|'derivedfrom';
export interface KnowledgeNodeV3 {id:string;kind:KnowledgeKindV3;title:string;summary:string;keywords:string[];conditions:string[];risk:string[];sourceRef:string;authorityRef?:ResourceRef;status:'active'|'candidate'|'revoked'|'needs-review'}
export interface KnowledgeEdgeV3 {from:string;to:string;relation:KnowledgeRelationV3;sourceRef:string}
export interface KnowledgeSnapshotV3 {retrievalRevision?:'english-function-words-v1'|'authority-navigation-v1'|'authority-navigation-v2';version:string;hash:string;nodes:readonly KnowledgeNodeV3[];edges:readonly KnowledgeEdgeV3[]}
export interface KnowledgeQueryV3 {query:string;refs?:string[];goalIds?:string[];maxNodes?:number;maxHops?:number;maxChars?:number;offset?:number}
export interface KnowledgeContextV3 {snapshotVersion:string;snapshotHash:string;candidates:KnowledgeNodeV3[];edges:KnowledgeEdgeV3[];backlinks:{nodeId:string;from:string;relation:KnowledgeRelationV3}[];truncated:boolean;omittedRefs:string[];omittedRefCount:number;oversizedRefs:string[];nextOffset?:number;retrievalRef:string;limits:{maxNodes:number;maxHops:number;maxChars:number}}
const kinds=new Set(['problem-element','goal','reminder','method','way-skill','strategy','lemma','precondition','counterexample','operation','case','evidence','version']);
const relations=new Set(['related','requires','uses','refutes','derivedfrom']);
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
export function freezeKnowledgeV3(nodes:readonly KnowledgeNodeV3[],edges:readonly KnowledgeEdgeV3[],version:string,retrievalRevision?:KnowledgeSnapshotV3['retrievalRevision']):KnowledgeSnapshotV3 {
 if(retrievalRevision!==undefined&&retrievalRevision!=='english-function-words-v1'&&!isAuthorityNavigationV3(retrievalRevision))throw new Error('Unknown V3 retrieval revision.');
 if(!version||version.length>256||nodes.length>10000||edges.length>50000)throw new Error('Invalid knowledge snapshot bounds.');const ids=new Set<string>();let totalBytes=0;
 for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||n.id.length>256||ids.has(n.id)||typeof n.sourceRef!=='string'||!n.sourceRef||n.sourceRef.length>512||!kinds.has(n.kind)||!['active','candidate','revoked','needs-review'].includes(n.status)||typeof n.title!=='string'||typeof n.summary!=='string'||[n.keywords,n.conditions,n.risk].some(a=>!Array.isArray(a)||a.length>128||a.some(x=>typeof x!=='string'))||JSON.stringify(n).length>65536)throw new Error('Invalid knowledge node.');if(n.authorityRef&&(typeof n.authorityRef.id!=='string'||!n.authorityRef.id||!Number.isSafeInteger(n.authorityRef.version)||n.authorityRef.version<1))throw new Error('Invalid existing method authority reference.');totalBytes+=Buffer.byteLength(JSON.stringify(n));if(totalBytes>8388608)throw new Error('Knowledge snapshot byte limit exceeded.');ids.add(n.id);}
 const canonical=new Map<string,KnowledgeEdgeV3>();for(const e of edges){if(!e||!ids.has(e.from)||!ids.has(e.to)||!relations.has(e.relation)||typeof e.sourceRef!=='string'||!e.sourceRef||e.sourceRef.length>512)throw new Error('Invalid typed knowledge edge.');const key=JSON.stringify([e.from,e.relation,e.to]);const old=canonical.get(key);if(old&&old.sourceRef!==e.sourceRef)throw new Error('Conflicting canonical link provenance.');canonical.set(key,structuredClone(e));}
 const body={version,...(retrievalRevision?{retrievalRevision}:{}),nodes:structuredClone([...nodes]).sort((a,b)=>a.id.localeCompare(b.id)),edges:[...canonical.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};return freeze({...body,hash:stableHash(body)});
}
/** Bounded whole-word surface matching; no language-specific segmentation or semantic recall. */
export const lexicalTermsV3=(s:string)=>[...new Set(s.slice(0,16384).toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[])].slice(0,128);
const limit=(n:number|undefined,fallback:number,max:number,min=0)=>Number.isInteger(n)?Math.max(min,Math.min(n!,max)):fallback;
// Ranking only: retain single-letter identifiers, negation, logical operators and quantifiers.
// Do not change source tokenization, graph construction, exact references or empty-query fallback.
export const englishFunctionWordsV3=new Set('the an is are was were be been being this that these those it its they their them we our you your he his she her of to by at'.split(' '));
/** Keyword/explicit structure only: retrieval is a navigation aid, not semantic proof validation. */
export function retrieveKnowledgeV3(snapshot:KnowledgeSnapshotV3,query:KnowledgeQueryV3):KnowledgeContextV3 {
 if(snapshot.retrievalRevision!==undefined){const {hash,...body}=snapshot;if((snapshot.retrievalRevision!=='english-function-words-v1'&&!isAuthorityNavigationV3(snapshot.retrievalRevision))||stableHash(body)!==hash)throw new Error('Invalid V3 retrieval revision or snapshot hash.');}
 return retrieveWithTerms(snapshot,query,lexicalTermsV3,snapshot.retrievalRevision?englishFunctionWordsV3:undefined);
}
/** Recovery-only recipe for a saved v3-operation-1 tool invocation. */
export function retrieveKnowledgeLegacyV3(snapshot:KnowledgeSnapshotV3,query:KnowledgeQueryV3):KnowledgeContextV3 {return retrieveWithTerms(snapshot,query,lexicalTermsLegacyV3);}
function retrieveWithTerms(snapshot:KnowledgeSnapshotV3,query:KnowledgeQueryV3,terms:(s:string)=>string[],ignoredTerms?:ReadonlySet<string>):KnowledgeContextV3 {
 const limits={maxNodes:limit(query.maxNodes,12,32,1),maxHops:limit(query.maxHops,1,3),maxChars:limit(query.maxChars,8192,16384,512)},tokens=terms(query.query.slice(0,16384));
 const nodes=new Map(snapshot.nodes.map(n=>[n.id,n])),explicit=new Set([...(query.refs??[]),...(query.goalIds??[])]),ranks=new Map<string,number>();
 for(const node of snapshot.nodes){if(tokens.length===0&&explicit.size===0&&node.authorityRef&&node.status==='active'){ranks.set(node.id,node.kind==='strategy'?2:1);continue;}const hay=terms([node.title,node.summary,...node.keywords].join(' '));const score=tokens.reduce((sum,t)=>sum+(!ignoredTerms?.has(t)&&hay.some(h=>h===t)?1:0),0);if(explicit.has(node.id))ranks.set(node.id,100000);else if(score&&node.status==='active')ranks.set(node.id,score);}
 const folded=isAuthorityNavigationV3(snapshot.retrievalRevision)?groupAuthorityRanksV3(snapshot,ranks,explicit):new Set<string>();
 let frontier=[...ranks.keys()];for(let hop=0;hop<limits.maxHops;hop++){const next:string[]=[];const frontierSet=new Set(frontier);for(const edge of snapshot.edges){let target:string|undefined;if(frontierSet.has(edge.from))target=edge.to;else if(frontierSet.has(edge.to))target=edge.from;if(target&&!folded.has(target)&&!ranks.has(target)){ranks.set(target,1/(hop+2));next.push(target);}}frontier=next;}
 const ordered=[...ranks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id])=>id);
 const result:KnowledgeContextV3={snapshotVersion:snapshot.version,snapshotHash:snapshot.hash,candidates:[],edges:[],backlinks:[],truncated:false,omittedRefs:[],omittedRefCount:0,oversizedRefs:[],retrievalRef:`knowledge:${snapshot.version}:${stableHash(query)}`,limits};
 const bytes=()=>Buffer.byteLength(JSON.stringify(result));
 const offset=limit(query.offset,0,10000);
 for(let i=offset;i<ordered.length;i++){
  const id=ordered[i]!,node=nodes.get(id)!;
  if(Buffer.byteLength(JSON.stringify(node))>limits.maxChars-768){result.truncated=true;result.omittedRefCount++;if(result.oversizedRefs.length<16)result.oversizedRefs.push(id);else{result.nextOffset=i;result.omittedRefCount+=ordered.length-i-1;break;}continue;}
  result.candidates.push(structuredClone(node));
  if(result.candidates.length>limits.maxNodes||bytes()>limits.maxChars-256){result.candidates.pop();result.truncated=true;result.omittedRefCount+=ordered.length-i;result.omittedRefs=ordered.slice(i,i+16);result.nextOffset=i;break;}
 }
 const included=new Set(result.candidates.map(n=>n.id));for(const e of snapshot.edges)if(included.has(e.from)&&included.has(e.to)){result.edges.push(structuredClone(e));result.backlinks.push({nodeId:e.to,from:e.from,relation:e.relation});if(bytes()>limits.maxChars){result.edges.pop();result.backlinks.pop();result.truncated=true;}}
 // Even the omitted-reference list is budgeted; full navigation is retained by snapshot/retrieval references.
 while(bytes()>limits.maxChars&&result.omittedRefs.length)result.omittedRefs.pop();
 while(bytes()>limits.maxChars&&result.oversizedRefs.length)result.oversizedRefs.pop();
 while(bytes()>limits.maxChars&&result.candidates.length){const removed=result.candidates.pop()!;result.nextOffset=Math.min(result.nextOffset??ordered.length,ordered.indexOf(removed.id));result.truncated=true;result.omittedRefCount++;result.edges=[];result.backlinks=[];}
 if(bytes()>limits.maxChars)throw new Error('Knowledge metadata exceeds requested context budget.');return result;
}

/** Explicit immutable-node body paging; callers keep the source/version pin. Offsets are UTF-16 string positions. */
export function readKnowledgeNodeV3(snapshot:KnowledgeSnapshotV3,id:string,options:{offset?:number;maxBytes?:number}={}) {
 const node=snapshot.nodes.find(n=>n.id===id);if(!node)throw new Error('Unknown frozen knowledge node.');
 const body=JSON.stringify(node),offset=limit(options.offset,0,body.length),maxBytes=limit(options.maxBytes,4096,8192,256);
 if(offset>0&&/[\uDC00-\uDFFF]/.test(body[offset]??'')&&/[\uD800-\uDBFF]/.test(body[offset-1]??''))throw new Error('Knowledge read offset splits a Unicode codepoint.');
 let text='',end=offset;for(const char of body.slice(offset)){if(Buffer.byteLength(text)+Buffer.byteLength(char)>maxBytes)break;text+=char;end+=char.length;}
 return {nodeId:id,snapshotVersion:snapshot.version,snapshotHash:snapshot.hash,bodyHash:stableHash(node),sourceRef:node.sourceRef,offset,end,totalCharacters:body.length,text,truncated:end<body.length,...(end<body.length?{nextOffset:end}:{})};
}
