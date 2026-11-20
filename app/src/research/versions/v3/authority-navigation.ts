import {isDeepStrictEqual} from 'node:util';
import {stableHash} from '../../../learning/research-hash.js';
import {lexicalTermsV3,englishFunctionWordsV3,type KnowledgeSnapshotV3,type KnowledgeQueryV3,type KnowledgeNodeV3} from './knowledge.js';
export const AUTHORITY_NAVIGATION_V3='authority-navigation-v1' as const;
export const AUTHORITY_DELIVERY_V3='authority-navigation-v2' as const;
export const isAuthorityNavigationV3=(revision:unknown)=>revision===AUTHORITY_NAVIGATION_V3||revision===AUTHORITY_DELIVERY_V3;
/** Recognize only the exact prerequisite projection produced by freezeContextV3. */
export function hostPrerequisiteAuthorityV3(snapshot:KnowledgeSnapshotV3,node:KnowledgeNodeV3):KnowledgeNodeV3|undefined {
 if(node.kind!=='precondition'||node.status!=='active')return;
 const authority=snapshot.nodes.find(n=>n.id===node.sourceRef);
 if(!authority?.authorityRef||authority.status!=='active')return;
 const origin=`resource:${authority.authorityRef.id}:${authority.authorityRef.version}`;
 if(authority.id!==origin||authority.sourceRef!==origin||!snapshot.edges.some(e=>e.from===origin&&e.to===node.id&&e.relation==='requires'&&e.sourceRef===origin))return;
 const exact=authority.conditions.some(condition=>isDeepStrictEqual(node,{id:`precondition:${stableHash([origin,condition])}`,kind:'precondition',title:'Method prerequisite',summary:condition.slice(0,4096),keywords:lexicalTermsV3(condition),conditions:[],risk:['Applicability is unestablished until checked in this problem.',...(condition.length>4096?['Preview truncated; exact text is in the authority resource.']:[])],sourceRef:origin,status:'active'}));
 return exact?authority:undefined;
}
/** Max transfers relevance, never truth; duplicates cannot reward verbosity. */
export function groupAuthorityRanksV3(snapshot:KnowledgeSnapshotV3,ranks:Map<string,number>,explicit:ReadonlySet<string>):Set<string> {
 const folded=new Set<string>();
 for(const node of snapshot.nodes){if(explicit.has(node.id))continue;const authority=hostPrerequisiteAuthorityV3(snapshot,node);if(!authority)continue;
  if(ranks.has(node.id))ranks.set(authority.id,Math.max(ranks.get(authority.id)??0,ranks.get(node.id)!));folded.add(node.id);ranks.delete(node.id);
 }
 return folded;
}
/** Rank full frozen authority metadata before the separate retrieval byte window. */
export function rankedAuthorityNavigationV3(snapshot:KnowledgeSnapshotV3,query:KnowledgeQueryV3):KnowledgeNodeV3[] {
 const tokens=lexicalTermsV3(query.query),explicit=new Set([...(query.refs??[]),...(query.goalIds??[])]),ranks=new Map<string,number>();
 for(const node of snapshot.nodes){if(node.status!=='active')continue;const hay=lexicalTermsV3([node.title,node.summary,...node.keywords].join(' '));const score=tokens.reduce((n,t)=>n+(!englishFunctionWordsV3.has(t)&&hay.includes(t)?1:0),0);if(explicit.has(node.id))ranks.set(node.id,100000);else if(score)ranks.set(node.id,score);else if(!tokens.length&&!explicit.size&&node.authorityRef)ranks.set(node.id,node.kind==='strategy'?2:1);}
 groupAuthorityRanksV3(snapshot,ranks,explicit);
 return snapshot.nodes.filter(n=>n.authorityRef&&n.id===`resource:${n.authorityRef.id}:${n.authorityRef.version}`&&n.sourceRef===n.id&&n.status==='active'&&ranks.has(n.id)).sort((a,b)=>ranks.get(b.id)!-ranks.get(a.id)!||a.id.localeCompare(b.id));
}
