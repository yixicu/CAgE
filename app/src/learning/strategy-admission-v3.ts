/** Structural edges nominate a review; only the Moderator judges common science. */
import {stableHash} from './research-hash.js';
import type {MethodLinkV3,RouteTemplateV3} from './method-network-v3.js';
import type {ProofRecord,ProofRef,ResearchLibraryState,ResourceRef,ReviewCase} from './research-data.js';
export type StrategyAdmissionRecipeV3='structural-review-v1';
export interface StructuralReviewV3 {
 recipe:StrategyAdmissionRecipeV3;anchorResourceId:string;
 routes:RouteTemplateV3[];links:MethodLinkV3[];owners:{ref:ResourceRef;hash:string}[];
 proofs:ProofRef[];parentStrategies:ResourceRef[];notice:string;
}
export interface StructuralNominationV3 {cases:ReviewCase[];descriptor:StructuralReviewV3}
export function nominateStructuralReviewV3(state:ResearchLibraryState, qualified:Map<string,ProofRecord[]>, key:(p:ProofRecord)=>string, threshold:number,limit:number):StructuralNominationV3|undefined {
 const publication=state.methodNetworkV3;if(!publication)return;
 const excluded=new Set<string>();
 for(const receipt of state.receipts)if(receipt.purpose==='v2-strategy'){const proof=state.proofs[receipt.sourceId];if(proof)excluded.add(key(proof));}
 for(const operation of Object.values(state.operations))if(operation.purpose==='v2-strategy'&&['queued','running','paused','failed'].includes(operation.status))for(const item of operation.cases){const proof=state.proofs[item.ref.caseId];if(proof)excluded.add(key(proof));}
 const previousAnchors=new Set(Object.values(state.operations).filter(operation=>operation.structuralAdmission&&['completed','no-change'].includes(operation.status)).map(operation=>operation.structuralAdmission!.anchorResourceId));
 const routes=publication.routes.filter(route=>route.status==='active'&&qualified.has(route.resourceRef.id)&&state.resources[route.resourceRef.id]?.version===route.resourceRef.version).sort((a,b)=>Number(previousAnchors.has(b.resourceRef.id))-Number(previousAnchors.has(a.resourceRef.id))||a.resourceRef.id.localeCompare(b.resourceRef.id));
 const byRef=new Map(routes.map(route=>[`${route.id}:${route.version}`,route]));
 const adjacency=new Map<string,MethodLinkV3[]>();
 for(const link of publication.links)if(link.relation==='structural-similarity'&&(link.score??1)>=.5&&byRef.has(`${link.from.id}:${link.from.version}`)&&byRef.has(`${link.to.id}:${link.to.version}`))for(const ref of [link.from,link.to]){const list=adjacency.get(ref.id)??[];list.push(link);adjacency.set(ref.id,list);}
 for(const anchor of routes){
  const links=(adjacency.get(anchor.id)??[]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,8);
  if(!links.length)continue;
  const members=new Map([[anchor.id,anchor]]);for(const link of links)for(const ref of [link.from,link.to]){const route=byRef.get(`${ref.id}:${ref.version}`)!;members.set(route.id,route);}
  const proofs=new Map<string,ProofRecord>();for(const route of members.values())for(const proof of qualified.get(route.resourceRef.id)??[]){const identity=key(proof);if(!excluded.has(identity)&&!proofs.has(identity))proofs.set(identity,proof);}
  if(proofs.size<threshold)continue;
  const chosen=[...proofs.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.caseId.localeCompare(b.caseId)).slice(0,limit);
  if(chosen.length<threshold)continue;
  const refs=chosen.map(({sessionId,caseId,hypothesisId,hypothesisRevision,revision,semanticRevision,contentHash})=>({sessionId,caseId,hypothesisId,hypothesisRevision,revision,semanticRevision,contentHash}));
  const parents=new Map<string,ResourceRef>();for(const operation of Object.values(state.operations))if(operation.structuralAdmission?.anchorResourceId===anchor.resourceRef.id&&['completed','no-change'].includes(operation.status)){
   const receipt=state.appliedUpdates[operation.id],meta=receipt?.kind==='resource'?state.resources[receipt.id]:undefined;
   if(meta?.kind==='specific-strategy'&&meta.enabled&&meta.status==='valid'&&meta.version>=receipt!.version)parents.set(meta.id,{id:meta.id,version:meta.version});
  }
  const descriptor:StructuralReviewV3={recipe:'structural-review-v1',anchorResourceId:anchor.resourceRef.id,routes:structuredClone([...members.values()]),links:structuredClone(links),owners:[...new Map([...members.values()].flatMap(route=>[route.resourceRef,...route.sourceRefs,...route.alternatives]).concat(links.flatMap(link=>link.sourceRefs)).map(ref=>[`${ref.id}:${ref.version}`,ref])).values()].map(ref=>({ref:structuredClone(ref),hash:stableHash(state.resources[ref.id])})),proofs:refs,parentStrategies:[...parents.values()],notice:'Structural links nominate comparison, not applicability or common proof. Compare original proofs, common steps and incompatible conditions; no-change is valid. Only these new independent proofs count as direct evidence.'};
  return {cases:refs.map(ref=>({ref,groupKeys:[`structural:${anchor.resourceRef.id}`]})),descriptor};
 }
}
export function structuralDescriptorCurrentV3(state:ResearchLibraryState, descriptor:StructuralReviewV3):boolean {
 if(descriptor.recipe!=='structural-review-v1'||!descriptor.routes.length||!descriptor.routes.some(route=>route.resourceRef.id===descriptor.anchorResourceId))return false;
 const network=state.methodNetworkV3;if(!network)return false;
 return descriptor.routes.every(route=>network.routes.some(current=>current.id===route.id&&stableHash(current)===stableHash(route)))
  &&descriptor.links.every(link=>network.links.some(current=>current.id===link.id&&stableHash(current)===stableHash(link)))
  &&descriptor.owners.every(owner=>stableHash(state.resources[owner.ref.id])===owner.hash&&state.resources[owner.ref.id]?.version===owner.ref.version);
}
