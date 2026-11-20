import {stableHash} from './research-hash.js';
import {requireData,type ProofRef,type ResourceMeta,type ResourceRef} from './research-data.js';
export interface MethodPublicationV3 {recipe:'method-support-v1';independentRebuild?:{justification:string}}
export interface MethodSupportV3 {
 recipe:'method-support-v1';mode:'revise'|'independent-rebuild';parent?:ResourceRef;
 justification?:string;directSourceRefs:ProofRef[];
}
export interface ResolvedMethodSupportV3 {refs:ProofRef[];unverified?:string}
export function dedupeMethodSourcesV3(refs:readonly ProofRef[]):ProofRef[] {
 return [...new Map(refs.map(ref=>[stableHash(ref),structuredClone(ref)])).values()];
}
/** Immutable same-ID ancestry only. Cached references never cache current proof validity. */
export class MethodSupportResolverV3 {
 private cache=new Map<string,ResolvedMethodSupportV3>();
 private key(meta:ResourceMeta){return stableHash([meta.id,meta.version,meta.kind,meta.semanticKey,meta.sourceRefs,meta.methodSupport]);}
 get(meta:ResourceMeta){return this.cache.get(this.key(meta));}
 async resolve(meta:ResourceMeta,read:(ref:ResourceRef)=>Promise<ResourceMeta>):Promise<ResolvedMethodSupportV3> {
  const key=this.key(meta),cached=this.cache.get(key);if(cached)return cached;
  let result:ResolvedMethodSupportV3;
  try {
   requireData(meta.kind==='method-skill'&&Number.isSafeInteger(meta.version)&&meta.version>=1,'Invalid method support identity.');
   requireData(meta.sourceRefs.every(ref=>!('kind'in ref)),'Method support needs proof references.');
   const marker=meta.methodSupport;
   if(marker){
    requireData(marker.recipe==='method-support-v1'&&['revise','independent-rebuild'].includes(marker.mode),'Unsupported method support marker.');
    requireData(Array.isArray(marker.directSourceRefs)&&marker.directSourceRefs.every(ref=>!('kind'in ref)&&meta.sourceRefs.some(s=>stableHash(s)===stableHash(ref))),'Invalid direct method support.');
    requireData(meta.version===1?!marker.parent:marker.parent?.id===meta.id&&marker.parent.version===meta.version-1,'Method support parent mismatch.');
    if(marker.mode==='independent-rebuild')requireData(typeof marker.justification==='string'&&marker.justification.trim().length>0&&marker.justification.length<=4000&&stableHash(dedupeMethodSourcesV3(meta.sourceRefs as ProofRef[]))===stableHash(dedupeMethodSourcesV3(marker.directSourceRefs)),'Independent rebuild needs exact direct support and whole-card justification.');
   }
   let refs=meta.sourceRefs as ProofRef[];
   if(meta.version>1&&marker?.mode!=='independent-rebuild'){
    const parent=await read({id:meta.id,version:meta.version-1});
    requireData(parent.id===meta.id&&parent.version===meta.version-1&&parent.kind===meta.kind&&parent.semanticKey===meta.semanticKey,'Method support history mismatch.');
    const inherited=await this.resolve(parent,read);requireData(!inherited.unverified,inherited.unverified??'Unverified method ancestry.');
    refs=[...inherited.refs,...refs];
   }
   result={refs:dedupeMethodSourcesV3(refs)};
  } catch(error){result={refs:[],unverified:error instanceof Error?error.message:'Method support history is unavailable.'};}
  this.cache.set(key,result);return result;
 }
}
