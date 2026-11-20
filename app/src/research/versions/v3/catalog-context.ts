import type {NetworkPinV3,NetworkQueryV3,NetworkSelectionV3} from '../../../learning/method-network-v3.js';
/** Host-only exact catalog bindings. Metadata discovery never implies body exposure. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validCatalogPinV3,resourceCatalogNodeV3,type CatalogPinV3,type CatalogQueryV3,type CatalogSelectionV3,type CatalogMaterialV3} from '../../../learning/hierarchical-catalog-v3.js';
import type {ResourceMeta,ResourceRef} from '../../../learning/research-data.js';
import type {KnowledgeNodeV3,KnowledgeSnapshotV3} from './knowledge.js';
export type {CatalogPinV3,CatalogMaterialV3};
export interface CatalogPortV3 {
 directedRoutes?(pin:CatalogPinV3,query:import('../../../learning/directed-route.js').DirectedRouteQuery):Promise<unknown>;
 network?(pin:NetworkPinV3,query:NetworkQueryV3):Promise<NetworkSelectionV3>;
 validateNetwork?(pin:NetworkPinV3,selection:NetworkSelectionV3):Promise<void>;
 query(pin:CatalogPinV3,query:CatalogQueryV3):Promise<CatalogSelectionV3>;
 node(pin:CatalogPinV3,id:string):Promise<KnowledgeNodeV3>;
 meta(pin:CatalogPinV3,ref:ResourceRef):Promise<ResourceMeta>;
 resource(pin:CatalogPinV3,ref:ResourceRef):Promise<{meta:ResourceMeta;body:string}>;
}
export const bodyHashV3=(body:string)=>createHash('sha256').update(body,'utf8').digest('hex');
export const resourceNodeV3=resourceCatalogNodeV3;
export function validateCatalogMaterialV3(material:CatalogMaterialV3,pin:CatalogPinV3):void {
 if(!validCatalogPinV3(pin)||!isDeepStrictEqual(material.pin,pin)||!material.node||typeof material.node.id!=='string'||!material.node.id.trim()||material.node.status!=='active')throw new Error('Invalid exact catalog material binding.');
 const {meta,node,body,bodyHash}=material;
 if(meta&&(typeof meta.id!=='string'||!meta.id.trim()||!Number.isSafeInteger(meta.version)||meta.version<1))throw new Error('Invalid catalog authority identity.');
 if(meta&&node.id===`resource:${meta.id}:${meta.version}`&&!isDeepStrictEqual(node,resourceNodeV3(meta)))throw new Error('Canonical catalog authority metadata mismatch.');
 if(meta&&(!node.authorityRef||!isDeepStrictEqual(node.authorityRef,{id:meta.id,version:meta.version})||!meta.enabled||meta.status!=='valid'))throw new Error('Catalog authority metadata mismatch.');
 if(node.authorityRef&&!meta)throw new Error('Catalog authority requires exact metadata.');
 if(body!==undefined||bodyHash!==undefined){if(!meta||typeof body!=='string'||bodyHash!==bodyHashV3(body)||meta.catalogBodyHashV3&&meta.catalogBodyHashV3!==bodyHash)throw new Error('Catalog original body integrity mismatch.');}
}
export function mergeCatalogMaterialsV3(pin:CatalogPinV3,existing:readonly CatalogMaterialV3[],incoming:readonly CatalogMaterialV3[]):CatalogMaterialV3[]{
 const result:CatalogMaterialV3[]=[];const positions=new Map<string,number>();
 for(const item of [...existing,...incoming]){
  validateCatalogMaterialV3(item,pin);const at=positions.get(item.node.id);
  if(at===undefined){positions.set(item.node.id,result.length);result.push(structuredClone(item));continue;}
  const old=result[at]!;
  if(!isDeepStrictEqual(old.node,item.node)||!isDeepStrictEqual(old.meta,item.meta)||old.body!==undefined&&item.body!==undefined&&(old.body!==item.body||old.bodyHash!==item.bodyHash))throw new Error('Conflicting immutable catalog material.');
  if(old.body===undefined&&item.body!==undefined)result[at]=structuredClone(item);
 }
 return result;
}

/** Frozen resource-origin provenance for local navigation, never a body-exposure grant. */
export function resourceNavigationSourcesV3(knowledge:KnowledgeSnapshotV3):Map<string,ResourceRef[]> {
 const owners=new Map(knowledge.nodes.flatMap(node=>node.authorityRef&&node.id===`resource:${node.authorityRef.id}:${node.authorityRef.version}`?[[node.id,node.authorityRef] as const]:[]));
 const derived=new Map<string,string[]>();
 for(const edge of knowledge.edges)if(['requires','derivedfrom'].includes(edge.relation)){let origins=derived.get(edge.to);if(!origins)derived.set(edge.to,origins=[]);origins.push(edge.sourceRef);}
 const result=new Map<string,ResourceRef[]>();
 for(const node of knowledge.nodes){const refs=new Map<string,ResourceRef>();for(const origin of [node.sourceRef,...derived.get(node.id)??[]]){const owner=owners.get(origin);if(owner)refs.set(origin,owner);}if(refs.size)result.set(node.id,structuredClone([...refs.values()]));}
 return result;
}
