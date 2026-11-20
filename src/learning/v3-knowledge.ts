import { freezeKnowledgeV3, type KnowledgeSnapshotV3, type KnowledgeNodeV3, type KnowledgeEdgeV3 } from '../research/versions/v3/knowledge.js';
import { stableHash } from './research-hash.js';
import { LearningDataError, requireData, sourceKey, type ProofDocument, type ProofRef } from './research-data.js';
export type KnowledgeKindV3='reminder'|'application'|'counterexample'|'operation-proposal';
export type KnowledgeReviewRevisionV3='exact-source-knowledge-v2';
export interface KnowledgeCandidateV3 {kind:KnowledgeKindV3;sourceKey:string;excerpt:string;summary?:string}
const knowledgeKindsV3:readonly KnowledgeKindV3[]=['reminder','application','counterexample','operation-proposal'];
/** Exact accepted root outcome only. This grants navigation, never theorem or subclaim authority. */
export function knowledgeKindAllowedV3(proof:Pick<ProofDocument,'meta'>,kind:unknown):kind is KnowledgeKindV3 {
 const provenance=proof.meta.optionalProof,outcome=provenance?.acceptedOutcome;
 return knowledgeKindsV3.includes(kind as KnowledgeKindV3)&&['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(provenance?.operationRevision??'')
  &&outcome?.scope==='root'&&outcome.reproducible===true&&Array.isArray(outcome.gaps)&&outcome.gaps.length===0
  &&(['supported-result','valid-refutation'].includes(outcome.resultKind)
    ||provenance?.resultContract==='scoped-refutation-v1'&&outcome.resultKind==='empirical-exclusion'&&proof.meta.logicalRelation==='empirical-exclusion')
  &&(kind!=='counterexample'||outcome.resultKind==='valid-refutation'&&(!provenance?.resultContract
    ||outcome.refutationKind==='counterexample'&&proof.meta.logicalRelation==='counterexample'));
}
export function allowedKnowledgeKindsV3(proof:Pick<ProofDocument,'meta'>):KnowledgeKindV3[] {
 return knowledgeKindsV3.filter(kind=>knowledgeKindAllowedV3(proof,kind));
}
export interface KnowledgeRejectionV3 {
 status:'rejected';hash:string;jobId:string;expectedVersion:number;candidates:unknown;sourceRefs:ProofRef[];
 rejectedCount:number;candidateIndex:number;reason:string;
}
/** Only candidate-local review failures may leave an otherwise valid method completed. */
export class KnowledgeCandidateValidationErrorV3 extends LearningDataError {
 constructor(readonly outcome:KnowledgeRejectionV3){super('INVALID_INPUT',outcome.reason);this.name='KnowledgeCandidateValidationErrorV3';}
}
export interface KnowledgePublicationV3 {version:number;nodes:KnowledgeNodeV3[];edges:KnowledgeEdgeV3[];supports:Record<string,ProofRef>;receipts:Record<string,string>;rejections?:Record<string,KnowledgeRejectionV3>}
export const emptyKnowledgePublicationV3=():KnowledgePublicationV3=>({version:0,nodes:[],edges:[],supports:{},receipts:{}});
/** The reviewer selects exact source-scoped passages, never grants theorem or code authority. */
export function stageKnowledgePublicationV3(current:KnowledgePublicationV3,candidates:unknown,sources:{ref:ProofRef;document:ProofDocument}[],jobId:string,expectedVersion:number,reviewRevision?:KnowledgeReviewRevisionV3):KnowledgePublicationV3 {
 requireData(!!jobId&&(reviewRevision===undefined||reviewRevision==='exact-source-knowledge-v2'),'Invalid V3 knowledge review.');
 // Historical callers retain their strict source/shape contract. Fresh v14 reviews
 // quarantine candidate-local errors only after mandatory source and parent checks.
 const quarantine=reviewRevision==='exact-source-knowledge-v2';
 if(!quarantine){
  requireData(Array.isArray(candidates)&&candidates.length<=16,'Invalid bounded V3 knowledge review.');
  for(const candidate of candidates as KnowledgeCandidateV3[]){
   const source=sources.find(s=>sourceKey(s.ref)===candidate.sourceKey);
   requireData(source&&['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(source.document.meta.optionalProof?.operationRevision??''),'Knowledge candidate needs exact reviewed V3 source.','STALE_SOURCE');
  }
 }
 const sourceRefs=sources.map(s=>s.ref),binding={jobId,candidates,sourceRefs,expectedVersion},rejectionHash=stableHash(binding);
 const rejected=current.rejections?.[jobId];
 if(rejected){
  const savedBinding={jobId:rejected.jobId,candidates:rejected.candidates,sourceRefs:rejected.sourceRefs,expectedVersion:rejected.expectedVersion};
  requireData(!current.receipts[jobId]&&rejected.hash===rejectionHash&&stableHash(savedBinding)===rejectionHash,'Changed knowledge rejection replay.','CONFLICT');
  throw new KnowledgeCandidateValidationErrorV3(structuredClone(rejected));
 }
 const hash=stableHash({candidates,sources:sourceRefs}); // Preserve historical successful receipt hashes.
 if(current.receipts[jobId]){requireData(current.receipts[jobId]===hash,'Changed knowledge publication replay.','CONFLICT');return structuredClone(current);}
 requireData(current.version===expectedVersion,'Knowledge publication parent changed.','CONFLICT');
 const check=(condition:unknown,reason:string,candidateIndex:number)=>{
  if(!condition)throw new KnowledgeCandidateValidationErrorV3({...structuredClone(binding),status:'rejected',hash:rejectionHash,rejectedCount:Array.isArray(candidates)?candidates.length:1,candidateIndex,reason});
 };
 check(Array.isArray(candidates)&&candidates.length<=16,'Knowledge candidates must be an array of at most 16 reviewed entries.',-1);
 const next=structuredClone(current);
 for(const [index,value] of (candidates as unknown[]).entries()){
  check(value!==null&&typeof value==='object'&&!Array.isArray(value),'Invalid reviewed knowledge candidate.',index);
  const candidate=value as KnowledgeCandidateV3;
  if(quarantine)check(Object.keys(candidate).every(key=>['kind','sourceKey','excerpt','summary'].includes(key)),'Unexpected reviewed knowledge candidate field.',index);
  const source=sources.find(s=>sourceKey(s.ref)===candidate.sourceKey);
  check(source,'Knowledge candidate needs an exact supplied sourceKey.',index);
  const proof=source!.document;
  check(['reminder','application','counterexample','operation-proposal'].includes(candidate.kind),'Unreviewed theorem-like or executable knowledge kind.',index);
  check(typeof candidate.excerpt==='string'&&candidate.excerpt.trim().length>=8&&candidate.excerpt.length<=2000&&proof.proof.includes(candidate.excerpt),'Knowledge reminder must quote an exact supplied source passage; ungrounded claims rejected.',index);
  check(knowledgeKindAllowedV3(proof,candidate.kind),candidate.kind==='counterexample'?'Counterexample needs a qualified refutation.':'Knowledge kind needs a qualified accepted V3 root source.',index);
  check(candidate.summary===undefined||typeof candidate.summary==='string'&&candidate.summary.trim().length>0&&candidate.summary.length<=2000,'Invalid reviewed reminder synthesis.',index);
  const id='knowledge_'+stableHash([candidate.kind,source!.ref,candidate.excerpt,candidate.summary??null]).slice(0,32),caseId='case_'+stableHash(source!.ref).slice(0,32);
  if(!next.nodes.some(n=>n.id===caseId))next.nodes.push({id:caseId,kind:'case',title:proof.meta.target.slice(0,200),summary:'One qualified source case, not a general theorem.',keywords:proof.meta.tags,conditions:proof.meta.conditions,risk:['Single-case evidence; applicability must be rechecked.'],sourceRef:candidate.sourceKey,status:'active'});
  if(!next.nodes.some(n=>n.id===id))next.nodes.push({id,kind:candidate.kind==='operation-proposal'?'operation':candidate.kind==='counterexample'?'counterexample':'reminder',title:candidate.kind+' from reviewed case',summary:candidate.summary??candidate.excerpt,keywords:proof.meta.tags,conditions:proof.meta.conditions,risk:['Reviewed case-scoped navigation reminder, not a new theorem or verified applicability.',...(candidate.kind==='operation-proposal'?['Quarantined proposal. Not a registry entry and never executable.']:[])],sourceRef:candidate.sourceKey,status:candidate.kind==='operation-proposal'?'candidate':'active'});
  next.supports[id]=structuredClone(source!.ref);next.supports[caseId]=structuredClone(source!.ref);
  if(!next.edges.some(e=>e.from===id&&e.to===caseId&&e.relation==='derivedfrom'))next.edges.push({from:id,to:caseId,relation:'derivedfrom',sourceRef:candidate.sourceKey});
 }
 next.version++;next.receipts[jobId]=hash;return next;
}
export function publicationSnapshotV3(publication:KnowledgePublicationV3,isValid:(ref:ProofRef)=>boolean):KnowledgeSnapshotV3 {
 const nodes=publication.nodes.map(node=>({...node,status:publication.supports[node.id]&&!isValid(publication.supports[node.id]!)?'revoked' as const:node.status}));
 return freezeKnowledgeV3(nodes,publication.edges,'reviewed-'+publication.version);
}
