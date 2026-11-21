import {observationSourceBody,observationSummary} from './map-observation.js';
import {stableHash} from './research-hash.js';
import {mapSourceKey,sameMapRef,validateKnowledgeMap,MapError,type KnowledgeMapState,type MapEntry,type MapSource,type MapUser,type MapRef,type MapSourceRef} from './knowledge-map.js';
import type {MapSeedInput} from './knowledge-map-store.js';

type Seed = MapSeedInput['entries'][number];
export interface CoreRelease {version:number;blob:string;sha256:string}
interface InstalledNode {key:string;ref:MapRef;hash:string;removed?:true;local?:true}
export interface CoreInstallation {version:number;sha256:string;nodes:InstalledNode[]}
export const coreActor:MapUser={purpose:'map-user',ownerId:'local-user',projectId:'shared-core-map'};
const legacyId='bundled-core-v1';
// Retain the published legacy digest even after newer optional bundles ship.
export const legacyCore:CoreRelease={version:1,blob:'2d13c099d707d06154f065fee0f688a883fc5b06',sha256:'1ee6a2d253196b2d31d614ab0f1aff7192cf81519e41e2568319bf41d88bb7fc'};

export function seedRecord(seed:Seed,ref:MapRef,actor:MapUser,requestId:string,index:number,reviewedPremise?:string){
 const body=seed.observation?observationSourceBody(seed.body,seed.observation):seed.body+(seed.proof?'\n\nSupplied argument:\n'+seed.proof:'');
 const sourceRef:MapSourceRef={kind:'user-seed',id:'seed_source_'+stableHash([actor.ownerId,requestId,index]),version:1,bodyHash:stableHash(body),ownerId:actor.ownerId,projectId:actor.projectId};
 const entry:MapEntry={ref,ownerId:actor.ownerId,kind:seed.kind,title:seed.title,...(seed.nodeType?{nodeType:seed.nodeType}:{}),...(seed.summary?{summary:seed.summary}:{}),...(seed.observation?{observation:structuredClone(seed.observation),summary:seed.summary??observationSummary(seed.observation)}:{}),aliases:seed.aliases??[],domain:seed.domain??[],body:seed.body,assumptions:seed.assumptions??[],definition:seed.kind==='concept'&&(!seed.nodeType||seed.nodeType==='definition'),status:'active',createdFrom:[sourceRef]};
 const source:MapSource={ref:sourceRef,body,status:'active',entryRefs:[ref],origin:{requestId,seed:structuredClone(seed),...(reviewedPremise?{reviewedPremise}:{})}};
 return {entry,source};
}

/** A prior installation can be migrated even if its installer data file has since been removed. */
export function recoverCoreSeeds(state:KnowledgeMapState){
 if(state.corePackage||!state.receipts['seed:'+legacyId])return;
 const entries=state.sources.filter(source=>source.ref.projectId===coreActor.projectId&&source.ref.ownerId===coreActor.ownerId&&(source.origin as {requestId?:string})?.requestId===legacyId).map(source=>(source.origin as {seed:Seed}).seed);
 if(stableHash(entries)===legacyCore.sha256)return entries;
}

function publisherReview(state:KnowledgeMapState,entry:MapEntry,seed:Seed,source:MapSource,version:number){
 entry.coreReview={version,key:seed.key!};
 if(entry.kind!=='observation'&&!(entry.kind==='theorem'&&seed.proof?.trim()))return;
 const id='core_review_'+stableHash([entry.ref,source.ref]);
 state.supports.push({id,statement:entry.ref,sources:[source.ref],argument:seed.proof??source.body,assumptions:entry.assumptions,prerequisites:[],
  status:entry.kind==='observation'?'observed':'proved',review:{id,body:'Reviewed in the published CAgE Core map v'+version+'.',candidateHash:stableHash(entry.ref),sourceHashes:[source.ref.bodyHash]}});
}

function retirePublication(state:KnowledgeMapState,entry:MapEntry){
 entry.status='withdrawn';
 const refs=new Set(entry.createdFrom.map(mapSourceKey));
 for(const source of state.sources)if(refs.has(mapSourceKey(source.ref)))source.status='withdrawn';
}

function locallyChanged(state:KnowledgeMapState,node:InstalledNode,entry:MapEntry){
 return !!(entry.reviewDecision||entry.maintenanceWithdrawal||entry.observationChange||entry.scientificWithdrawal||
  (!node.removed&&entry.status==='withdrawn')||state.entries.some(e=>e.ref.id===entry.ref.id&&e.ref.version>entry.ref.version)||
  state.supports.some(s=>sameMapRef(s.statement,entry.ref)&&(!s.id.startsWith('core_review_')||!['proved','observed'].includes(s.status)))||
  state.profiles.some(p=>p.accepted.some(ref=>sameMapRef(ref,entry.ref))));
}

export function applyCorePackage(state:KnowledgeMapState,release:CoreRelease,seeds:Seed[]){
 const installed=state.corePackage;
 if(installed&&installed.version>=release.version){
  if(installed.version===release.version&&installed.sha256!==release.sha256)throw new MapError('CONFLICT','Core map contents changed without a new version.');
  return installed;
 }
 if(stableHash(seeds)!==release.sha256)throw new MapError('INVALID_INPUT','Core map checksum does not match the publication.');
 const keys=new Set(seeds.map(seed=>seed.key));
 if(!seeds.length||keys.size!==seeds.length||seeds.some(s=>!s.key?.trim()||s.acceptAsFoundation||s.replaces||s.relations?.some(link=>!keys.has(link.target)||s.key===link.target)))throw new MapError('INVALID_INPUT','Core map has an invalid key, relation or foundation request.');
 const hasLegacy=!!state.receipts['seed:'+legacyId];
 const legacy=release.version===1&&!installed&&hasLegacy&&!!recoverCoreSeeds(state);
 const requestId=release.version===1&&(!hasLegacy||legacy)?legacyId:'core-package-v'+release.version;
 const nodes=new Map((installed?.nodes??[]).map(n=>[n.key,n]));
 const effective=new Map<string,MapEntry>();
 for(const node of nodes.values()){
  const entry=state.entries.find(e=>sameMapRef(e.ref,node.ref));
  if(!entry)throw new MapError('CONFLICT','A managed Core map reference is missing.');
  if(locallyChanged(state,node,entry))node.local=true;
  if(!keys.has(node.key)&&!node.local&&!node.removed){retirePublication(state,entry);node.removed=true;}
 }
 for(const [index,seed] of seeds.entries()){
  const key=seed.key!,node=nodes.get(key),hash=stableHash(seed);
  const previous=node&&state.entries.find(e=>sameMapRef(e.ref,node.ref));
  if(previous&&node&&(node.local||!node.removed&&node.hash===hash)){if(previous.status==='active')effective.set(key,previous);continue;}
  if(previous)retirePublication(state,previous);
  const ref:MapRef={store:'map',id:node?.ref.id??(requestId===legacyId?'seed_'+stableHash([coreActor.ownerId,requestId,index]):'core_'+stableHash(key)),version:(node?.ref.version??0)+1,bodyHash:stableHash(seed.body)};
  const {entry,source}=seedRecord(seed,ref,coreActor,requestId,index);
  const record:InstalledNode={key,ref,hash};
  nodes.set(key,record);
  if(legacy){
   const old=state.entries.find(e=>sameMapRef(e.ref,ref)),origin=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(source.ref));
   if(!old||!origin||!origin.entryRefs?.some(r=>sameMapRef(r,ref)))throw new MapError('CONFLICT','Legacy Core map identity changed.');
   if(locallyChanged(state,record,old)||stableHash(old)!==stableHash(entry)||stableHash(origin)!==stableHash(source)){record.local=true;continue;}
   publisherReview(state,old,seed,origin,release.version);effective.set(key,old);
  }else{
   if(state.entries.some(e=>e.ref.id===ref.id&&e.ref.version===ref.version))throw new MapError('CONFLICT','Core map identity is already used by a local node.');
   state.entries.push(entry);state.sources.push(source);state.conversions.push({sourceKey:mapSourceKey(source.ref),state:'converted',entryRefs:[ref]});
   publisherReview(state,entry,seed,source,release.version);effective.set(key,entry);
  }
 }
 const managedIds=new Set([...nodes.values()].map(n=>n.ref.id));
 const localIds=new Set([...nodes.values()].filter(n=>n.local).map(n=>n.ref.id));
 const publisherRelation=(reviewId:string)=>reviewId==='seed:'+legacyId||/^core-package-v[0-9]+$/.test(reviewId);
 for(const edge of state.relations)if(managedIds.has(edge.from.id)&&managedIds.has(edge.to.id)&&publisherRelation(edge.reviewId)&&!localIds.has(edge.from.id)&&!localIds.has(edge.to.id))edge.status='withdrawn';
 for(const seed of seeds){
  const from=effective.get(seed.key!);if(!from||localIds.has(from.ref.id))continue;
  for(const link of seed.relations??[]){
   const to=effective.get(link.target);if(!to||localIds.has(to.ref.id))continue;
   const id='relation_'+stableHash([from.ref,to.ref,link.kind,link.direction]),prior=state.relations.find(e=>e.id===id);
   if(prior){if(publisherRelation(prior.reviewId))prior.status='active';}
   else state.relations.push({id,from:from.ref,to:to.ref,kind:link.kind,basis:link.basis,direction:link.direction,status:'active',reviewId:requestId===legacyId?'seed:'+legacyId:requestId,sources:from.createdFrom});
  }
 }
 state.corePackage={version:release.version,sha256:release.sha256,nodes:[...nodes.values()]};
 state.version++;validateKnowledgeMap(state);return state.corePackage;
}
