/** Fresh Strategy support choices; unmarked historical resources are never migrated. */
import {stableHash} from './research-hash.js';
import {requireData,type ProofRef,type ResourceMeta,type ResourceRef} from './research-data.js';
import {isStorageAccessError} from '../storage/errors.js';
export interface StrategyPublicationV3 {recipe:'strategy-support-v1';independentRebuild?:{justification:string}}
export interface StrategySupportV3 {
 recipe:'strategy-support-v1';mode:'revise'|'independent-rebuild';parent?:ResourceRef;
 justification?:string;directSourceRefs:ProofRef[];
}
export interface ResolvedStrategySupportV3 {refs:ProofRef[];unverified?:string}
export const dedupeStrategySourcesV3=(refs:readonly ProofRef[]):ProofRef[]=>[...new Map(refs.map(ref=>[stableHash(ref),structuredClone(ref)])).values()];
const proofRefs=(refs:unknown):refs is ProofRef[]=>Array.isArray(refs)&&refs.length>0&&refs.length<=64&&refs.every(ref=>ref&&typeof ref==='object'&&!('kind'in ref)&&['sessionId','caseId','hypothesisId','hypothesisRevision','contentHash'].every(key=>typeof ref[key]==='string'&&ref[key].length>0)&&Number.isSafeInteger(ref.revision)&&ref.revision>0&&Number.isSafeInteger(ref.semanticRevision)&&ref.semanticRevision>0);
/** Cache immutable structure only. Current scientific authority is checked by the library on every use. */
export class StrategySupportResolverV3 {
 private cache=new Map<string,ResolvedStrategySupportV3>();
 private key(meta:ResourceMeta){return stableHash([meta.id,meta.version,meta.kind,meta.semanticKey,meta.sourceRefs,meta.strategySupport]);}
 get(meta:ResourceMeta){return this.cache.get(this.key(meta));}
 async resolve(meta:ResourceMeta,read:(ref:ResourceRef)=>Promise<ResourceMeta>):Promise<ResolvedStrategySupportV3> {
  const key=this.key(meta),cached=this.cache.get(key);if(cached)return cached;
  let result:ResolvedStrategySupportV3;
  try {
   requireData(meta.kind==='specific-strategy'&&Number.isSafeInteger(meta.version)&&meta.version>=1&&proofRefs(meta.sourceRefs),'Invalid Strategy support identity/sources.');
   const marker=meta.strategySupport;
   if(!marker){requireData(meta.version===1,'Legacy Strategy ancestry above version one is unverified.');result={refs:dedupeStrategySourcesV3(meta.sourceRefs as ProofRef[])};}
   else {
    requireData(marker.recipe==='strategy-support-v1'&&['revise','independent-rebuild'].includes(marker.mode)&&Object.keys(marker).every(key=>['recipe','mode','parent','justification','directSourceRefs'].includes(key)),'Invalid Strategy support marker.');
    requireData(proofRefs(marker.directSourceRefs)&&stableHash(marker.directSourceRefs)===stableHash(dedupeStrategySourcesV3(marker.directSourceRefs)),'Invalid direct Strategy support.');
    requireData(meta.version===1?marker.parent===undefined:marker.parent?.id===meta.id&&marker.parent.version===meta.version-1,'Strategy support parent mismatch.');
    let inherited:ProofRef[]=[];
    if(marker.mode==='independent-rebuild')requireData(typeof marker.justification==='string'&&marker.justification.trim().length>0&&marker.justification.length<=4000,'Independent Strategy rebuild requires whole-body justification.');
    else {
     requireData(marker.justification===undefined,'Revision cannot declare a rebuild justification.');
     if(marker.parent){const parent=await read(marker.parent);requireData(parent.id===meta.id&&parent.version===meta.version-1&&parent.kind===meta.kind&&parent.semanticKey===meta.semanticKey,'Strategy support history mismatch.');const resolved=await this.resolve(parent,read);requireData(!resolved.unverified,resolved.unverified??'Unverified Strategy ancestry.');inherited=resolved.refs;}
    }
    const refs=dedupeStrategySourcesV3([...inherited,...marker.directSourceRefs]);
    requireData(refs.length<=64&&stableHash(meta.sourceRefs)===stableHash(refs),'Strategy flattened support closure mismatch or overflow.');result={refs};
   }
  }catch(error){if(isStorageAccessError(error))throw error;result={refs:[],unverified:error instanceof Error?error.message:'Strategy support history unavailable.'};}
  this.cache.set(key,result);return result;
 }
}
