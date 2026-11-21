import {randomUUID} from 'node:crypto';
import {isEmpiricalMapSource} from './map-source-role.js';
import {validMapObservation,observationSourceBody,type MapObservation} from './map-observation.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {directedMapQuery} from './directed-map-query.js';
import {stableHash} from './research-hash.js';
import {directedMapQualification,mapBasisHandle,mapProofBases} from './knowledge-map-support.js';
import {MAP_RECIPE,MapError,MapReadError,reviewHold,type NodeReviewStatus,suppliedSeedProof,admitMapSources,assertMapGrant,assertMapUser,mapEvidenceHandle,mapHandle,mapProfile,mapQualification,mapRefKey,mapSourceKey,prepareKnowledgeMap,publishMapProposal,retainedMaintenanceVersions,supersedesMaintenanceVersions,queryKnowledgeMap,sameMapRef,selectMapProfile,validateKnowledgeMap,type KnowledgeMapState,type MapEntry,type MapGrant,type MapOpenResult,type MapNodeDocument,type MapPrerequisite,type MapQuery,type MapRef,type MapReviewedProposal,type MapSource,type MapSourceRef,type MapUser,type MapView} from './knowledge-map.js';

import {type AuthoredRelation,type MapNodeType} from './map-node-fields.js';

import {applyCorePackage, seedRecord, recoverCoreSeeds, type CoreRelease} from './core-package.js';

export const CORE_MAP_ID = 'shared-core-map';
export interface MapSeedInput {projectId:string;requestId:string;expectedProfileVersion:number;entries:{key?:string;summary?:string;nodeType?:MapNodeType;relations?:AuthoredRelation<string>[];kind:'concept'|'theorem'|'observation';observation?:MapObservation;replaces?:MapRef;title:string;aliases?:string[];domain?:string[];body:string;assumptions?:string[];proof?:string;acceptAsFoundation?:boolean}[]}
interface MaintenanceNodeRef {id:string;version:number}
interface MaintenanceStatement {
 title:string;body:string;kind:'concept'|'theorem';assumptions:string[];tags?:string[];summary?:string;aliases?:string[];
 nodeType?:MapNodeType;relations?:AuthoredRelation<MaintenanceNodeRef>[];proof?:string;review?:string;dependencies?:MaintenanceNodeRef[];
}
interface MaintenanceProofSubmission {
 title:string;body:string;assumptions:string[];proof:string;
 dependencies:(MaintenanceNodeRef & {title:string;body:string;assumptions:string[]})[];
}

export interface MapStoragePort {
 snapshot():Promise<{state:KnowledgeMapState;revision:string}>;
 historical(revision:string):Promise<KnowledgeMapState>;
 edit<T>(edit:(state:KnowledgeMapState)=>Promise<{state:KnowledgeMapState;value:T}>|{state:KnowledgeMapState;value:T}):Promise<T>;
 sourceValid(source:MapSource):Promise<boolean>;
 theoryBody?(ref:MapRef):Promise<string>;
}
function publishedReviewSources(state:KnowledgeMapState,projectId:string){
 const owned=new Set(state.entries.filter(e=>maintenanceMapScope(e,projectId)).map(e=>mapRefKey(e.ref)));
 return new Set(state.supports.filter(s=>s.review?.id.startsWith('theorist_review_')&&owned.has(mapRefKey(s.statement))).flatMap(s=>s.sources.map(mapSourceKey)));
}
function visibleFoundationProfile(state:KnowledgeMapState,ownerId:string,projectId:string){
 const profile=mapProfile(state,ownerId,projectId);
 profile.accepted=profile.accepted.filter(ref=>!state.entries.some(e=>sameMapRef(e.ref,ref)&&reviewHold(e)));
 return profile;
}
function pendingReviewToken(state:KnowledgeMapState,entry:MapEntry){
 const supports=state.supports.filter(s=>sameMapRef(s.statement,entry.ref)).map(s=>[s.id,s.status,s.review?.id]);
 return !supports.length?(entry.reviewDecision?.token??'initial'):stableHash([entry.reviewDecision?.token,supports]);
}
const uniqueRefs=(refs:MapRef[])=>[...new Map(refs.map(r=>[mapRefKey(r),r])).values()];
export class KnowledgeMapStore {
 constructor(private readonly port:MapStoragePort){}
 private readonly evidencePath=new AsyncLocalStorage<Set<string>>();
 /** Revalidate only cited evidence, never the complete map (which may contain this report). */
 async evidenceValid(read:MapOpenResult,ownerId:string,projectId:string,stateOverride?:KnowledgeMapState):Promise<boolean>{
  const key=stableHash([ownerId,projectId,read.selection]),path=this.evidencePath.getStore()??new Set<string>();
  if(path.has(key))return false;
  return this.evidencePath.run(new Set([...path,key]),async()=>{
   const state=stateOverride??(await this.port.snapshot()).state,profile=mapProfile(state,ownerId,projectId),sources=new Set<string>();
   const allowedSource=async(ref:MapSourceRef)=>{const source=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref));if(!source||ref.ownerId!==ownerId||ref.kind==='maintenance-proof'&&ref.projectId!==projectId&&ref.projectId!==CORE_MAP_ID||source.status!=='active')return false;const valid=await this.port.sourceValid(source);if(valid)sources.add(mapSourceKey(ref));return valid;};
   if(!read.ref){if(read.kind!=='source-evidence'||!read.sources.length||read.sources.some(r=>r.kind==='maintenance-proof'))return false;for(const ref of read.sources)if(!await allowedSource(ref))return false;return true;}
   const entry=state.entries.find(e=>sameMapRef(e.ref,read.ref!)&&e.ownerId===ownerId);
   if(!entry||entry.maintenanceDraft&&entry.maintenanceDraft.projectId!==projectId&&entry.maintenanceDraft.projectId!==CORE_MAP_ID||entry.status!=='active'||stableHash(read.body)!==entry.ref.bodyHash)return false;
   if(read.kind==='observation'||entry.kind==='observation'){
    if(entry.kind!=='observation'||read.kind!=='observation'||read.accepted||read.basis||read.bases?.length||read.qualification!=='observed'
      ||entry.observationChange||reviewHold(entry)||!validMapObservation(read.observation)||read.selection!==mapHandle(entry.ref)||stableHash(read.observation)!==stableHash(entry.observation))return false;
    const original=new Set(read.supports.filter(s=>s.status==='observed').map(s=>stableHash(s)));
    for(const support of state.supports.filter(s=>sameMapRef(s.statement,entry.ref)&&s.status==='observed'&&original.has(stableHash(s)))){
     if(support.sources.every(s=>read.sources.some(r=>mapSourceKey(r)===mapSourceKey(s)))&&(await Promise.all(support.sources.map(allowedSource))).every(Boolean))return true;
    }
    return false;
   }
   if(read.qualification==='definition'&&(!entry.definition||reviewHold(entry)))return false;
   if(read.qualification==='pending'&&reviewHold(entry)==='disputed')return false;
   if(entry.maintenanceDraft&&entry.kind==='theorem'&&!entry.createdFrom.length&&read.kind==='theorem'&&read.qualification==='pending'&&!read.basis&&!read.bases?.length&&!read.accepted&&!read.sources.length&&!read.supports.length){
    // A scoped draft can supply the statement to derive. This receipt grants no proof basis.
    return read.selection===mapHandle(entry.ref)&&stableHash(read.assumptions)===stableHash(entry.assumptions)&&
     (entry.reviewDecision?.status!=='pending'||pendingReviewToken(state,entry)===(read.reviewToken??'initial'));
   }
   if(read.basis){
    if(![mapHandle(entry.ref),mapBasisHandle(read.basis)].includes(read.selection))return false;
    const needed=new Set(read.basis.steps.map(step=>mapRefKey(step.ref)));
    const ids=new Set(read.basis.steps.map(step=>step.via));
    for(const support of state.supports)if(ids.has(support.id))for(const p of support.prerequisites)needed.add(mapRefKey(p.ref));
    for(const node of state.entries)if(needed.has(mapRefKey(node.ref))&&node.ownerId===ownerId){
     for(const source of node.createdFrom)await allowedSource(source);
     for(const support of state.supports.filter(s=>sameMapRef(s.statement,node.ref)&&ids.has(s.id)))for(const source of support.sources)await allowedSource(source);
    }
    return mapProofBases(state,entry.ref,r=>sources.has(mapSourceKey(r)),profile.accepted,
     ref=>state.entries.some(e=>sameMapRef(e.ref,ref)&&e.ownerId===ownerId&&this.eligible(e,sources,state)),read.basis).length===1;
   }
   const actualSupports=new Map(read.supports.map(s=>[s.id,s]));
   const evidenceState={...state,supports:state.supports.filter(s=>!sameMapRef(s.statement,read.ref!)||actualSupports.has(s.id)).map(s=>{const prior=actualSupports.get(s.id);return prior&&prior.status!=='proved'&&s.status==='proved'?{...s,status:prior.status}:s;})};
   const visited=new Set<string>();
   const gather=async(ref:MapRef):Promise<void>=>{
    const id=mapRefKey(ref);if(visited.has(id))return;visited.add(id);
    const node=state.entries.find(e=>sameMapRef(e.ref,ref)&&e.ownerId===ownerId);if(!node||node.status!=='active')return;
    for(const source of node.createdFrom)await allowedSource(source);
    for(const support of evidenceState.supports.filter(s=>sameMapRef(s.statement,ref)&&s.status!=='withdrawn')){for(const source of support.sources)await allowedSource(source);if(support.status==='proved')for(const parent of support.prerequisites)if(parent.role==='established')await gather(parent.ref);}
   };
   await gather(entry.ref);
   if(!this.eligible(entry,sources,evidenceState)&&!(entry.maintenanceDraft?.projectId===projectId&&read.accepted&&profile.accepted.some(ref=>sameMapRef(ref,entry.ref))))return false;
   const qualified={...evidenceState,entries:evidenceState.entries.map(e=>visited.has(mapRefKey(e.ref))&&!this.eligible(e,sources,evidenceState)?{...e,status:'withdrawn' as const}:e)};
   const current=mapQualification(qualified,entry,profile,r=>sources.has(mapSourceKey(r)));
   if((read.qualification==='proved'||read.accepted)&&!(read.qualification==='proved'&&current.qualification==='proved'||read.accepted&&current.accepted))return false;
   return true;
  });
 }

 private async validSources(state:KnowledgeMapState,ownerId:string,projectId?:string,needed?:Set<string>){const valid=new Set<string>();for(const s of state.sources)if((!needed||needed.has(mapSourceKey(s.ref)))&&s.ref.ownerId===ownerId&&(s.ref.kind!=='maintenance-proof'||projectId===undefined||s.ref.projectId===projectId||s.ref.projectId===CORE_MAP_ID)&&s.status==='active'&&await this.port.sourceValid(s))valid.add(mapSourceKey(s.ref));return valid;}
 private eligible(entry:MapEntry,sources:Set<string>,state:KnowledgeMapState){return entry.status==='active'&&(entry.createdFrom.some(s=>sources.has(mapSourceKey(s)))||state.supports.some(s=>sameMapRef(s.statement,entry.ref)&&s.status!=='withdrawn'&&s.sources.every(r=>sources.has(mapSourceKey(r)))));}
 private readable(entry:MapEntry,sources:Set<string>,state:KnowledgeMapState,grant:MapGrant){
  if(!entry.maintenanceDraft)return this.eligible(entry,sources,state);
  if(entry.maintenanceDraft.projectId!==grant.projectId&&entry.maintenanceDraft.projectId!==CORE_MAP_ID||entry.status!=='active')return false;
  if(grant.allowedRefs)return grant.allowedRefs.some(ref=>sameMapRef(ref,entry.ref));
  return !grant.allowedSourceKeys&&grant.purpose!=='map-worker';
 }
 private scopedSources(state:KnowledgeMapState,grant:MapGrant,valid:Set<string>){
  if(!grant.refutationEvidence){valid=new Set(valid);for(const source of state.sources)if(source.ref.kind==='user-seed'&&isEmpiricalMapSource(source))valid.delete(mapSourceKey(source.ref));}
  if(grant.allowedSourceKeys)return new Set(grant.allowedSourceKeys.filter(k=>valid.has(k)));
  if(!grant.allowedRefs)return grant.purpose==='map-worker'?new Set<string>():valid;
  const refs=new Set(grant.allowedRefs.map(mapRefKey));return new Set([...state.entries.filter(e=>refs.has(mapRefKey(e.ref))).flatMap(e=>e.createdFrom),...state.supports.filter(s=>refs.has(mapRefKey(s.statement))).flatMap(s=>s.sources)].map(mapSourceKey).filter(k=>valid.has(k)));
 }
 async freeze(grant:MapGrant):Promise<MapView>{
  assertMapGrant(grant);const {state,revision}=await this.port.snapshot(),profile=visibleFoundationProfile(state,grant.ownerId,grant.projectId);if(profile.id!==grant.profileId)throw new MapError('FORBIDDEN','Profile outside task grant');
  const sources=this.scopedSources(state,grant,await this.validSources(state,grant.ownerId,grant.projectId)),allowed=grant.allowedRefs&&new Set(grant.allowedRefs.map(mapRefKey)),latest=new Map<string,number>();
  for(const e of state.entries)if(e.ownerId===grant.ownerId&&this.readable(e,sources,state,grant))latest.set(e.ref.store+e.ref.id,Math.max(latest.get(e.ref.store+e.ref.id)??0,e.ref.version));
  return {presentation:'layered-map-v1',recipe:MAP_RECIPE,revision,mapVersion:state.version,profile,grant:structuredClone(grant),refs:state.entries.filter(e=>e.ownerId===grant.ownerId&&(e.kind!=='observation'||grant.refutationEvidence)&&this.readable(e,sources,state,grant)&&(allowed||e.ref.version===latest.get(e.ref.store+e.ref.id)||profile.accepted.some(ref=>sameMapRef(ref,e.ref)))&&(!allowed||allowed.has(mapRefKey(e.ref)))).map(e=>e.ref),sourceRefs:state.sources.filter(s=>sources.has(mapSourceKey(s.ref))).map(s=>s.ref)};
 }
 private async readView(view:MapView,grant:MapGrant){
  assertMapGrant(grant);if(view.recipe!==MAP_RECIPE||stableHash(view.grant)!==stableHash(grant))throw new MapError('FORBIDDEN','Map view grant changed');
  const frozen=await this.port.historical(view.revision);validateKnowledgeMap(frozen);const original=visibleFoundationProfile(frozen,grant.ownerId,grant.projectId);
  if(frozen.version!==view.mapVersion||stableHash(original)!==stableHash(view.profile))throw new MapError('FORBIDDEN','Map view is not its exact checkpoint');
  if(grant.allowedRefs&&!view.refs.every(ref=>grant.allowedRefs!.some(allowed=>sameMapRef(ref,allowed))))throw new MapError('FORBIDDEN','Frozen refs exceed task scope');
  if(!view.refs.every(ref=>frozen.entries.some(e=>sameMapRef(ref,e.ref)&&e.ownerId===grant.ownerId))||!view.sourceRefs.every(ref=>frozen.sources.some(s=>mapSourceKey(s.ref)===mapSourceKey(ref)&&s.ref.ownerId===grant.ownerId)))throw new MapError('FORBIDDEN','Unknown frozen map selection');
  const current=(await this.port.snapshot()).state,sources=this.scopedSources(current,grant,await this.validSources(current,grant.ownerId,grant.projectId)),currentProfile=visibleFoundationProfile(current,grant.ownerId,grant.projectId);
  if(view.modelDirectedKnowledge){const frozenKeys=new Set(view.sourceRefs.map(mapSourceKey));for(const key of sources)if(!frozenKeys.has(key))sources.delete(key);}
  const profile={...view.profile,accepted:view.profile.accepted.filter(ref=>currentProfile.accepted.some(now=>sameMapRef(ref,now)))};
  const authorized=new Set(view.refs.filter(ref=>current.entries.some(e=>sameMapRef(e.ref,ref)&&e.ownerId===grant.ownerId&&(e.kind!=='observation'||grant.refutationEvidence)&&this.readable(e,sources,current,grant))).map(mapRefKey));
  const qualified={...frozen,entries:frozen.entries.map(e=>{const now=current.entries.find(row=>sameMapRef(row.ref,e.ref));return now?.status==='withdrawn'?{...e,status:'withdrawn' as const}:now?.observationChange?{...e,observationChange:now.observationChange}:now&&reviewHold(now)?{...e,reviewDecision:now.reviewDecision}:e;}),supports:frozen.supports.map(s=>{const now=current.supports.find(row=>row.id===s.id);if(view.modelDirectedKnowledge&&(s.status==='proved'||s.status==='observed')&&(!now||stableHash(now)!==stableHash(s)))return {...s,status:now?.status==='disputed'?'disputed' as const:'withdrawn' as const};return now&&['withdrawn','disputed'].includes(now.status)?{...s,status:now.status}:s;})};
  const entryAllowed=(target:MapRef)=>(!grant.allowedRefs||grant.allowedRefs.some(r=>sameMapRef(r,target)))&&[qualified,current].every(state=>state.entries.some(e=>sameMapRef(e.ref,target)&&e.ownerId===grant.ownerId&&this.readable(e,sources,state,grant)));
  return {state:qualified,current,sources,profile,authorized,entryAllowed};
 }
 async query(view:MapView,query:MapQuery,grant:MapGrant){
  const checked=await this.readView(view,grant),qualifiedView={...view,profile:checked.profile};
  if(!view.modelDirectedKnowledge)return queryKnowledgeMap(prepareKnowledgeMap(checked.state),qualifiedView,query,checked.authorized,ref=>checked.sources.has(mapSourceKey(ref)));
  const allowed=(ref:MapSourceRef)=>checked.sources.has(mapSourceKey(ref));
  const state={...checked.state};
  if(query.mode==='relations'){
   const live=new Set(checked.current.relations.filter(r=>r.status==='active').map(r=>stableHash(r)));
   state.relations=state.relations.filter(r=>live.has(stableHash(r)));
   const supports=new Set(checked.current.supports.filter(s=>s.status==='proved').map(s=>stableHash(s)));
   state.supports=state.supports.map(s=>s.status==='proved'&&!supports.has(stableHash(s))?{...s,status:'withdrawn'}:s);
  }
  if(query.mode==='source'){
   state.sources=await Promise.all(state.sources.filter(s=>allowed(s.ref)).map(async s=>{
    if(!s.canonicalTheory)return s;
    const body=await this.port.theoryBody?.(s.canonicalTheory);
    if(body===undefined||stableHash(body)!==s.ref.bodyHash)throw new MapError('STALE_SOURCE','Exact canonical source unavailable');
    return {...s,body};
   }));
  }
  return directedMapQuery(state,qualifiedView,query,checked.authorized,allowed,checked.entryAllowed);
 }
 async open(view:MapView,selection:string,grant:MapGrant):Promise<MapOpenResult>{
  const checked=await this.readView(view,grant);
  const source=view.sourceRefs.find(ref=>mapEvidenceHandle(ref)===selection);
  if(source){if(source.kind==='maintenance-proof')throw new MapReadError('FORBIDDEN','Open the reviewed theorem to read its proof and premise conditions');if(!checked.sources.has(mapSourceKey(source)))throw new MapReadError('STALE_SOURCE','Public source withdrawn');const exact=checked.state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(source));if(!exact)throw new MapError('NOT_FOUND','Frozen source unavailable');return {...(grant.refutationEvidence&&isEmpiricalMapSource(exact)?{empiricalSource:true as const}:{}),selection,kind:'source-evidence',body:exact.canonicalTheory?await this.port.theoryBody!(exact.canonicalTheory):exact.body,assumptions:[],qualification:'evidence',accepted:false,supports:[],sources:[source]};}
  const ref=view.refs.find(r=>mapHandle(r)===selection);if(!ref)throw new MapReadError('FORBIDDEN','Map selection outside frozen grant');
  if(!checked.authorized.has(mapRefKey(ref)))throw new MapReadError('STALE_SOURCE','Map entry source withdrawn');
  const entry=checked.state.entries.find(e=>sameMapRef(e.ref,ref));if(!entry)throw new MapError('NOT_FOUND','Exact map version unavailable');
  const sourceAllowed=(r:MapSourceRef)=>checked.sources.has(mapSourceKey(r));
  const status=view.modelDirectedKnowledge?directedMapQualification(checked.state,entry,checked.profile,sourceAllowed,checked.entryAllowed):mapQualification(checked.state,entry,checked.profile,sourceAllowed);
  const body=entry.kind==='theory'?await this.port.theoryBody?.(entry.ref):entry.body;if(body===undefined||stableHash(body)!==entry.ref.bodyHash)throw new MapError('STALE_SOURCE','Exact canonical body unavailable');
  const suppliedProof=suppliedSeedProof(checked.state,entry,status.supports,sourceAllowed);
  return {...(entry.kind==='theorem'&&status.qualification==='pending'?{reviewToken:pendingReviewToken(checked.state,entry)}:{}),...(entry.coreReview?{coreReview:entry.coreReview}:{}),...(suppliedProof?{suppliedProof}:{}),selection,ref,kind:entry.kind,...(entry.nodeType?{nodeType:entry.nodeType}:{}),title:entry.title,aliases:entry.aliases,domain:entry.domain,body,assumptions:entry.assumptions,...(entry.observation?{observation:structuredClone(entry.observation)}:{}),...status,sources:entry.createdFrom.filter(r=>checked.sources.has(mapSourceKey(r))),...(entry.theoryQualification?{theoryQualification:entry.theoryQualification}:{})};
 }
 async acceptedFoundationBodies(actor:MapUser){
  assertMapUser(actor,actor.ownerId,actor.projectId);
  const {state}=await this.port.snapshot();
  const accepted=new Set(mapProfile(state,actor.ownerId,actor.projectId).accepted.map(mapRefKey));
  return new Set(state.entries.filter(entry=>accepted.has(mapRefKey(entry.ref))&&!entry.assumptions.length&&entry.status==='active'&&!reviewHold(entry)).map(entry=>entry.ref.bodyHash));
 }
 async acceptReviewedPremise(statement:string,origin:string,actor:MapUser,guard?:()=>void){
  const input={projectId:actor.projectId,requestId:'premise_'+stableHash([actor.ownerId,actor.projectId,statement]),entries:[{kind:'theorem' as const,title:statement,body:statement,acceptAsFoundation:true}]};
  return this.saveSeeds(input,actor,{origin,guard});
 }
 async corePackageStatus(){return (await this.port.snapshot()).state.corePackage;}
 async installCorePackage(release:CoreRelease, entries?:MapSeedInput['entries']){
  return this.port.edit(state=>{
   const seeds=entries??recoverCoreSeeds(state);
   const value=seeds?applyCorePackage(state,release,seeds):state.corePackage;
   return {state,value};
  });
 }
 async hasCoreMap(){
  const {state}=await this.port.snapshot();return !!(state.corePackage||state.receipts['seed:bundled-core-v1']);
 }
 async importSeeds(input:MapSeedInput,actor:MapUser){return this.saveSeeds(input,actor);}
 private async saveSeeds(input:Omit<MapSeedInput,'expectedProfileVersion'>&{expectedProfileVersion?:number},actor:MapUser,consent?:{origin:string;guard?:()=>void}){
  assertMapUser(actor,actor.ownerId,input.projectId);if(!input.requestId||!Array.isArray(input.entries)||!input.entries.length)throw new MapError('INVALID_INPUT','Seed entries and request identity required');
  return this.port.edit(state=>{
   consent?.guard?.();
   const receipt='seed:'+input.requestId,hash=stableHash({input,actor});if(state.receipts[receipt]&&state.receipts[receipt]!==hash)throw new MapError('CONFLICT','Changed seed request replay');
   const entries:MapEntry[]=[],sources:MapSource[]=[];
   for(const [i,seed] of input.entries.entries()){
    if(!['concept','theorem','observation'].includes(seed.kind)||!seed.title?.trim()||!seed.body?.trim())throw new MapError('INVALID_INPUT','Seed definition/statement missing');
    if(seed.kind==='observation'){
     if(!validMapObservation(seed.observation)||seed.proof!==undefined||seed.acceptAsFoundation)throw new MapError('INVALID_INPUT','Provide complete observation metadata and provenance; measurements cannot carry a proof or foundational acceptance');
    }else if(seed.observation!==undefined||seed.replaces!==undefined)throw new MapError('INVALID_INPUT','Measurement metadata and correction require an observation seed');
    const previous=seed.replaces&&state.entries.find(e=>sameMapRef(e.ref,seed.replaces!));
    if(seed.replaces&&!state.receipts[receipt]){
     if(!previous||previous.kind!=='observation'||previous.ownerId!==actor.ownerId||!previous.createdFrom.every(s=>s.projectId===actor.projectId))throw new MapError('FORBIDDEN','Correction must identify an exact observation from this project');
     if(state.entries.some(e=>e.ref.id===previous.ref.id&&e.ref.version>previous.ref.version)||entries.some(e=>e.ref.id===previous.ref.id))throw new MapError('CONFLICT','Observation correction parent changed');
    }
    const ref:MapRef={store:'map',id:seed.replaces?.id??'seed_'+stableHash([actor.ownerId,input.requestId,i]),version:(seed.replaces?.version??0)+1,bodyHash:stableHash(seed.body)};
    const row=seedRecord(seed,ref,actor,input.requestId,i,consent?.origin);
    entries.push(row.entry);sources.push(row.source);
   }
   if(consent&&state.receipts[receipt]&&!mapProfile(state,actor.ownerId,input.projectId).accepted.some(ref=>sameMapRef(ref,entries[0]!.ref)))throw new MapError('CONFLICT','This foundation was removed. Select its existing statement in the project foundation profile to accept it again.');
   if(state.receipts[receipt])return {state,value:{requestId:input.requestId,profile:mapProfile(state,actor.ownerId,input.projectId),entries:entries.map((e,i)=>({selection:i+1,ref:e.ref,kind:e.kind,title:e.title})),sourceKeys:sources.map(s=>mapSourceKey(s.ref))}};
   let next=structuredClone(state);
   for(const seed of input.entries)if(seed.replaces){
    const prior=next.entries.find(e=>sameMapRef(e.ref,seed.replaces!))!;
    prior.status='withdrawn';prior.observationChange={requestId:input.requestId,status:'withdrawn',reason:'Superseded by a corrected observation seed.'};
    for(const source of next.sources)if(prior.createdFrom.some(s=>mapSourceKey(s)===mapSourceKey(source.ref)))source.status='withdrawn';
   }
   next.entries.push(...entries);
   const keyed=new Map<string,MapEntry>();
   for(const [i,seed] of input.entries.entries())if(seed.key!==undefined){
    if(!seed.key.trim()||keyed.has(seed.key))throw new MapError('INVALID_INPUT','Seed keys must be nonblank and unique in this batch.');
    keyed.set(seed.key,entries[i]!);
   }
   for(const [i,seed] of input.entries.entries()){
    const entry=entries[i]!;
    for(const link of seed.relations??[]){
     const target=keyed.get(link.target);
     if(!target||sameMapRef(entry.ref,target.ref))throw new MapError('INVALID_INPUT','A seed relation must identify another keyed entry in this batch.');
     const id='relation_'+stableHash([entry.ref,target.ref,link.kind,link.direction]);
     if(!next.relations.some(r=>r.id===id))next.relations.push({id,from:entry.ref,to:target.ref,kind:link.kind,basis:link.basis,direction:link.direction,status:'active',reviewId:receipt,sources:entry.createdFrom});
    }
   }
   // Import has already materialized these entries. Evidence qualification is a separate user-requested operation.
   next.sources.push(...sources);
   next.conversions.push(...sources.map(source=>({sourceKey:mapSourceKey(source.ref),state:'converted' as const,entryRefs:source.entryRefs!})));
   const profile=mapProfile(next,actor.ownerId,input.projectId),accepted=uniqueRefs([...profile.accepted,...entries.filter((_,i)=>input.entries[i]!.acceptAsFoundation===true).map(e=>e.ref)]);
   next=selectMapProfile(next,{requestId:'seeds:'+input.requestId,expectedVersion:consent?profile.version:input.expectedProfileVersion!,accepted},actor);next.receipts[receipt]=hash;validateKnowledgeMap(next);
   return {state:next,value:{requestId:input.requestId,profile:mapProfile(next,actor.ownerId,input.projectId),entries:entries.map((e,i)=>({selection:i+1,ref:e.ref,kind:e.kind,title:e.title})),sourceKeys:sources.map(s=>mapSourceKey(s.ref))}};
  });
 }
 async withdrawScientificNode(source:MapSource,target:MapRef,reason:string){
  const {projectId,ownerId}=source.ref;
  if(ownerId!=='local-user'||!['proof-report','public-research'].includes(source.ref.kind)||source.status!=='active'||stableHash(source.body)!==source.ref.bodyHash||!reason.trim())
   throw new MapError('FORBIDDEN','A withdrawal requires the public scientific source and its reason.');
  return this.port.edit(async state=>{
   const receipt='scientific-withdrawal:'+mapSourceKey(source.ref),hash=stableHash([source.ref,target,reason]);
   if(state.receipts[receipt]){
    if(state.receipts[receipt]!==hash)throw new MapError('CONFLICT','Withdrawal differs from the recorded scientific handoff.');
    return {state,value:undefined};
   }
   if(!await this.port.sourceValid(source))throw new MapError('STALE_SOURCE','The public withdrawal source is unavailable.');
   const entry=state.entries.find(e=>sameMapRef(e.ref,target));
   const family=state.entries.filter(e=>e.ref.store===target.store&&e.ref.id===target.id);
   if(!entry||target.store!=='map'||entry.kind==='observation'||!family.every(e=>maintenanceMapScope(e,projectId)&&e.createdFrom.every(s=>s.kind!=='user-seed'))||
    state.profiles.some(p=>p.accepted.some(r=>family.some(e=>sameMapRef(e.ref,r))))||
    state.supports.some(s=>sameMapRef(s.statement,target)&&s.sources.some(r=>r.ownerId!==ownerId||r.projectId!==projectId||r.kind==='user-seed')))
    throw new MapError('FORBIDDEN','Withdraw an exact project-owned scientific node. User foundations, measurements and other projects retain their authority.');
   const later=family.filter(e=>e.ref.version>target.version);
   const competingMaintenance=supersedesMaintenanceVersions(entry,later,projectId);
   if(!competingMaintenance&&(entry.status!=='active'||later.length))throw new MapError('CONFLICT','The opened node has already been retired or superseded.');
   // Include earlier exact citations retained through cosmetic edits of this target.
   const next=admitMapSources(state,[source],ownerId,projectId);
   next.outbox=structuredClone(state.outbox);
   const oldRefs=retainedMaintenanceVersions(state.entries,entry).map(e=>mapRefKey(e.ref));
   for(const row of next.entries.filter(e=>oldRefs.includes(mapRefKey(e.ref))||competingMaintenance&&e.ref.id===target.id&&e.ref.version>target.version)){
    row.status='withdrawn';
    delete row.maintenanceWithdrawal;
    row.scientificWithdrawal={source:structuredClone(source.ref),reason};
    for(const ref of row.createdFrom.filter(r=>r.kind==='maintenance-proof')){
     const proof=next.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref));
     if(proof)proof.status='withdrawn';
    }
   }
   next.receipts[receipt]=hash;next.version=state.version+1;validateKnowledgeMap(next);
   return {state:next,value:undefined};
  });
 }
 async changeObservationStatus(input:{requestId:string;ref:MapRef;status:'disputed'|'withdrawn';reason:string},actor:MapUser){
  assertMapUser(actor,actor.ownerId,actor.projectId);
  if(!input.requestId?.trim()||!input.reason?.trim()||!['disputed','withdrawn'].includes(input.status))throw new MapError('INVALID_INPUT','Supply an observation status and reason');
  return this.port.edit(state=>{
   const receipt='observation-status:'+input.requestId,hash=stableHash({input,actor});
   if(state.receipts[receipt]){
    if(state.receipts[receipt]!==hash)throw new MapError('CONFLICT','Changed observation status replay');
    return {state,value:structuredClone(input)};
   }
   const next=structuredClone(state),entry=next.entries.find(e=>sameMapRef(e.ref,input.ref));
   if(entry?.kind!=='observation'||entry.ownerId!==actor.ownerId||!entry.createdFrom.every(s=>s.projectId===actor.projectId))throw new MapError('FORBIDDEN','Select an exact observation from this project');
   if(entry.status==='withdrawn'||next.entries.some(e=>e.ref.id===entry.ref.id&&e.ref.version>entry.ref.version))throw new MapError('CONFLICT','Observation already withdrawn or superseded');
   entry.observationChange={requestId:input.requestId,status:input.status,reason:input.reason};
   if(input.status==='withdrawn')entry.status='withdrawn';
   for(const support of next.supports)if(sameMapRef(support.statement,entry.ref))support.status=input.status;
   for(const source of next.sources)if(entry.createdFrom.some(s=>mapSourceKey(s)===mapSourceKey(source.ref)))source.status='withdrawn';
   next.receipts[receipt]=hash;next.version++;validateKnowledgeMap(next);return {state:next,value:structuredClone(input)};
  });
 }
 async updateProfile(input:{requestId:string;expectedVersion:number;accepted:MapRef[]},actor:MapUser){return this.port.edit(state=>{const next=selectMapProfile(state,input,actor);return {state:next,value:mapProfile(next,actor.ownerId,actor.projectId)};});}
 async admit(sources:MapSource[],ownerId:string,projectId:string,modelDirectedKnowledge?:true,refutationEvidence?:true,domainAdmission?:true,write?:true|import('./knowledge-map.js').MapOutbox['authored']){return this.port.edit(state=>{const next=admitMapSources(state,sources,ownerId,projectId,modelDirectedKnowledge,refutationEvidence,domainAdmission,write);return {state:next,value:next.outbox.filter(o=>o.ownerId===ownerId&&o.projectId===projectId&&o.state!=='completed')};});}
 async catalog(sources:MapSource[],ownerId:string,projectId:string){return this.port.edit(state=>{const next=admitMapSources(state,sources,ownerId,projectId);next.outbox=structuredClone(state.outbox);next.version=state.version;if(stableHash(next)!==stableHash(state))next.version++;return {state:next,value:sources.map(s=>mapSourceKey(s.ref))};});}
 async outbox(ownerId:string,projectId:string){const {state}=await this.port.snapshot();return structuredClone(state.outbox.filter(o=>o.ownerId===ownerId&&o.projectId===projectId&&o.state!=='completed'));}
 async sourceBatch(keys:string[],ownerId:string,projectId?:string){const {state}=await this.port.snapshot(),valid=await this.validSources(state,ownerId);return Promise.all(keys.map(async key=>{const source=state.sources.find(s=>mapSourceKey(s.ref)===key&&s.ref.ownerId===ownerId);if(!source||source.ref.kind==='maintenance-proof'&&source.ref.projectId!==projectId&&source.ref.projectId!==CORE_MAP_ID||!valid.has(key))throw new MapError('STALE_SOURCE','Maintenance public source unavailable');return {...structuredClone(source),body:source.canonicalTheory?await this.port.theoryBody!(source.canonicalTheory):source.body};}));}
 async markOutbox(id:string,status:'admitted'|'completed',taskId:string){return this.port.edit(state=>{const next=structuredClone(state),intent=next.outbox.find(o=>o.id===id);if(!intent)throw new MapError('NOT_FOUND','Map intent unavailable');if(intent.taskId&&intent.taskId!==taskId)throw new MapError('CONFLICT','Map intent task changed');if(intent.state!==status){intent.state=status;intent.taskId=taskId;for(const key of intent.sourceKeys){const row=next.conversions.find(c=>c.sourceKey===key);if(row){row.taskId=taskId;if(status==='admitted')row.state='queued';}}next.version++;}return {state:next,value:undefined};});}
 async publish(proposal:MapReviewedProposal,grant:MapGrant,guard?:()=>void){
  assertMapGrant(grant);if(grant.purpose!=='map-review'||proposal.ownerId!==grant.ownerId||proposal.projectId!==grant.projectId)throw new MapError('FORBIDDEN','Map review publication authority required');
  if(proposal.refutationEvidence&&!grant.refutationEvidence)throw new MapError('FORBIDDEN','Review grant does not permit observation publication');
  return this.port.edit(async state=>{const sources=this.scopedSources(state,grant,await this.validSources(state,grant.ownerId,grant.projectId));guard?.();const result=publishMapProposal(state,proposal,ref=>sources.has(mapSourceKey(ref)));return {state:result.state,value:result.receipt};});
 }
 async projectTheory(entry:MapEntry,source:MapSource,intentId:string,modelDirectedKnowledge?:true,refutationEvidence?:true,stageForReview?:true,anchor?:{ref:MapRef;basis:string},decision?:NonNullable<import('./knowledge-map.js').MapOutbox['projection']>['decision']){
  if(entry.kind!=='theory'||entry.ref.store!=='theory'||entry.body!==undefined||source.ref.kind!=='theory')throw new MapError('FORBIDDEN','Canonical theory projection only');
  return this.port.edit(async state=>{
   const hash=stableHash({entry,source});if(state.receipts[intentId]){if(state.receipts[intentId]!==hash)throw new MapError('CONFLICT','Changed theory projection replay');return {state,value:state.publicationReceipts![intentId]!};}
   if(!await this.port.sourceValid(source))throw new MapError('STALE_SOURCE','Theory source withdrawn');
   let next=structuredClone(state);if(next.entries.some(e=>e.ref.id===entry.ref.id&&e.ref.version===entry.ref.version&&!sameMapRef(e.ref,entry.ref)))throw new MapError('CONFLICT','Theory immutable version changed');
   if(stageForReview){
    next=admitMapSources(next,[source],source.ref.ownerId,source.ref.projectId,modelDirectedKnowledge,refutationEvidence,true);
    const intent=next.outbox.find(o=>o.sourceKeys.includes(mapSourceKey(source.ref)))!;
    intent.projection={entry:structuredClone(entry),intentId,...(decision?{decision:structuredClone(decision)}:{})};
    return {state:next,value:{id:intentId,version:next.version,entries:[],pending:true}};
   }
   if(!next.entries.some(e=>sameMapRef(e.ref,entry.ref)))next.entries.push(structuredClone(entry));
   if(anchor){
    const activeSources=await this.validSources(next,source.ref.ownerId);
    if(!next.entries.some(e=>sameMapRef(e.ref,anchor.ref)&&e.ownerId===source.ref.ownerId&&e.status==='active'&&e.createdFrom.some(s=>activeSources.has(mapSourceKey(s)))))throw new MapError('STALE_SOURCE','Scientific anchor unavailable');
    const id='relation_'+stableHash([entry.ref,anchor.ref,'related','symmetric']);
    if(!next.relations.some(r=>r.id===id))next.relations.push({id,from:entry.ref,to:anchor.ref,kind:'related',direction:'symmetric',basis:anchor.basis,status:'active',reviewId:intentId,sources:[source.ref]});
   }
   if(!next.sources.some(s=>mapSourceKey(s.ref)===mapSourceKey(source.ref)))next.sources.push(structuredClone(source));
   next=admitMapSources(next,[source],source.ref.ownerId,source.ref.projectId,modelDirectedKnowledge,refutationEvidence);next.receipts[intentId]=hash;next.version++;const receipt={id:intentId,version:next.version,entries:[entry.ref],pending:false};next.publicationReceipts??={};next.publicationReceipts[intentId]=receipt;validateKnowledgeMap(next);return {state:next,value:receipt};
  });
 }
 async reviewImport(projectId:string,target:MaintenanceNodeRef,revision:number,mode:'proof'|'transcription',verdict:'confirm'|'inconclusive',reason:string,dependencies:MaintenanceNodeRef[]=[],signal?:AbortSignal){
  return this.port.edit(async state=>{
   const entry=state.entries.find(e=>e.ref.id===target.id&&e.ref.version===target.version&&maintenanceMapScope(e,projectId));
   if(!entry||entry.status!=='active'||entry.observationChange)throw new MapError('NOT_FOUND','Active imported entry unavailable.');
   const evidence=importEvidence(state,entry);
   if(!evidence||evidence.mode!==mode||!await this.port.sourceValid(evidence.source))throw new MapError('STALE_SOURCE','Exact imported evidence unavailable for this review.');
   const prior=importReview(state,entry,evidence.source.ref);
   if(prior)return {state,value:{status:prior.status,revision:state.version,supportId:prior.id}};
   if(state.version!==revision)throw new MapError('CONFLICT','Read the current imported evidence before reviewing.');
   if(!reason.trim()||(dependencies.length&&mode==='transcription'))throw new MapError('INVALID_INPUT','Record a reason. Only proofs accept mathematical dependencies.');
   const prerequisites=dependencies.length?(await this.maintenancePremises(state,projectId,{kind:'theorem',title:entry.title,body:entry.body!,assumptions:entry.assumptions,dependencies},entry.ref.id)).prerequisites:[];
   const id='import_review_'+stableHash([entry.ref,evidence.source.ref]),status=verdict==='inconclusive'?'pending':mode==='proof'?'proved':'observed';
   signal?.throwIfAborted();
   state.supports.push({id,statement:entry.ref,sources:[evidence.source.ref],argument:evidence.argument,assumptions:entry.assumptions,prerequisites,status,
    review:{id,body:reason,candidateHash:stableHash([entry.ref,evidence.source.ref,mode]),sourceHashes:[evidence.source.ref.bodyHash]}});
   state.version++;validateKnowledgeMap(state);return {state,value:{status,revision:state.version,supportId:id}};
  });
 }
 private reviewTarget(state:KnowledgeMapState,projectId:string,ref:MapRef){
  const entry=state.entries.find(e=>sameMapRef(e.ref,ref)&&e.ownerId==='local-user');
  if(!entry||projectId===CORE_MAP_ID&&!maintenanceMapScope(entry,CORE_MAP_ID)||entry.maintenanceDraft&&!maintenanceMapScope(entry,projectId)&&!maintenanceMapScope(entry,CORE_MAP_ID))throw new MapError('NOT_FOUND','This node version is unavailable.');
  const editable=(maintenanceMapScope(entry,projectId)||maintenanceMapScope(entry,CORE_MAP_ID))&&entry.status==='active'&&!entry.observationChange&&!state.entries.some(e=>e.ownerId===entry.ownerId&&e.ref.store===ref.store&&e.ref.id===ref.id&&e.ref.version>ref.version);
  return {entry,editable};
 }
 private async nodeEvidence(state:KnowledgeMapState,projectId:string,entry:MapEntry){
  const needed=new Set<string>(),visited=new Set<string>();
  function collect(target:MapRef){
   const key=mapRefKey(target);if(visited.has(key))return;
   visited.add(key);
   const parent=state.entries.find(e=>sameMapRef(e.ref,target));
   for(const source of parent?.createdFrom??[])needed.add(mapSourceKey(source));
   for(const support of state.supports.filter(s=>sameMapRef(s.statement,target))){
    for(const source of support.sources)needed.add(mapSourceKey(source));
    for(const premise of support.prerequisites)collect(premise.ref);
   }
  }
  collect(entry.ref);
  const valid=await this.validSources(state,entry.ownerId,projectId,needed);
  const allowed=(source:MapSourceRef)=>valid.has(mapSourceKey(source));
  const profile=mapProfile(state,entry.ownerId,projectId);
  const grant:MapGrant={purpose:'map-proof',ownerId:entry.ownerId,projectId,profileId:profile.id,taskId:'inspect'};
  const visible=(r:MapRef)=>state.entries.find(e=>sameMapRef(e.ref,r)&&this.readable(e,valid,state,grant));
  return {allowed,visible,status:directedMapQualification(state,entry,profile,allowed,r=>!!visible(r))};
 }
 private async reviewInfo(state:KnowledgeMapState,projectId:string,ref:MapRef){
  const {entry,editable}=this.reviewTarget(state,projectId,ref);
  const {status:{qualification}}=await this.nodeEvidence(state,projectId,entry);
  const catalogReview=entry.reviewDecision?entry.reviewDecision.status==='approved':!!entry.coreReview;
  const metadataOnly=(entry.kind!=='theorem'||entry.nodeType==='basic-knowledge')&&entry.kind!=='observation';
  const status:NodeReviewStatus=qualification==='withdrawn'||qualification==='disputed'?'invalid':
   qualification==='proved'||qualification==='observed'||qualification==='definition'||catalogReview&&metadataOnly?'approved':'pending';
  return {status,qualification,token:stableHash([entry.ref,entry.reviewDecision,qualification,state.supports.filter(s=>sameMapRef(s.statement,entry.ref))]),editable,origin:entry.reviewDecision?.origin??(entry.coreReview?'core':undefined)};
 }
 async nodeDocument(projectId:string,ref:MapRef):Promise<MapNodeDocument>{
  const {state}=await this.port.snapshot();
  const {entry}=this.reviewTarget(state,projectId,ref);
  const {allowed,visible,status}=await this.nodeEvidence(state,projectId,entry);
  const links:MapNodeDocument['links']=[];
  for(const support of status.supports)for(const p of support.prerequisites){
   if(p.role!=='established')continue;
   const parent=visible(p.ref),basisSelection=p.basis&&mapBasisHandle(p.basis);
   if(parent&&(projectId!==CORE_MAP_ID||maintenanceMapScope(parent,CORE_MAP_ID)))links.push({supportId:support.id,ref:p.ref,title:parent.title,selection:mapHandle(p.ref),basisSelection});
  }
  const body=entry.body??await this.port.theoryBody?.(ref);
  if(body===undefined||stableHash(body)!==ref.bodyHash)throw new MapError('STALE_SOURCE','Exact node body unavailable.');
  return {node:{ref,selection:mapHandle(ref),title:entry.title,kind:entry.kind,nodeType:entry.nodeType??(entry.definition?'definition':entry.kind),
   body,assumptions:entry.assumptions,domain:entry.domain,aliases:entry.aliases,observation:entry.observation,sources:entry.createdFrom,
   ...status,suppliedProof:suppliedSeedProof(state,entry,status.supports,allowed)},links};
 }
 async nodeReview(projectId:string,ref:MapRef){return this.reviewInfo((await this.port.snapshot()).state,projectId,ref);}
 async setNodeReview(projectId:string,ref:MapRef,expected:string,status:NodeReviewStatus,argument?:string){
  return this.port.edit(async state=>{
   const {entry,editable}=this.reviewTarget(state,projectId,ref);
   if(!editable)throw new MapError('CONFLICT','Only the current, active node version can be reviewed.');
   const before=await this.reviewInfo(state,projectId,ref);
   if(before.token!==expected)throw new MapError('CONFLICT','This review changed. Reopen the node to see its current status.');
   if(before.status===status)return {state,value:before};
   const token=randomUUID();entry.reviewDecision={status,token,origin:'user'};
   if(status==='approved'&&(entry.kind==='theorem'&&entry.nodeType!=='basic-knowledge'||entry.kind==='observation')){
    const unmasked=await this.reviewInfo(state,projectId,ref);
    if(unmasked.qualification!=='proved'&&unmasked.qualification!=='observed'){
     const evidence=importEvidence(state,entry);
     let source:MapSourceRef,body:string;
     const priorConditional=evidence&&state.supports.some(s=>sameMapRef(s.statement,ref)&&s.argument===evidence.argument&&(s.prerequisites.length||s.unresolvedPrerequisites?.length||s.assumptions.some(condition=>!entry.assumptions.includes(condition))));
     if(evidence&&!priorConditional&&await this.port.sourceValid(evidence.source)){
      source=evidence.source.ref;body=evidence.argument;
     }else if(entry.kind==='theorem'&&argument?.trim()&&(!priorConditional||argument.trim()!==evidence?.argument.trim())){
      body=argument.trim();source={kind:'user-seed',id:'manual_review_'+token,version:1,bodyHash:stableHash(body),ownerId:entry.ownerId,projectId:entry.maintenanceDraft?.projectId??entry.createdFrom[0]?.projectId??projectId};
      state.sources.push({ref:source,body,status:'active',entryRefs:[ref],origin:{manualReview:token}});
     }else throw new MapError('INVALID_INPUT',entry.kind==='theorem'?'Enter the independent argument you verified for this theorem.':'The original measurement provenance must be available to approve an observation.');
     const id='manual_review_'+token;
     state.supports.push({id,statement:ref,sources:[source],argument:body,assumptions:[...entry.assumptions],prerequisites:[],status:entry.kind==='theorem'?'proved':'observed',review:{id,body:'The user reviewed this exact node version and its supporting evidence.',candidateHash:stableHash(ref),sourceHashes:[source.bodyHash]}});
    }
   }
   state.version++;validateKnowledgeMap(state);return {state,value:await this.reviewInfo(state,projectId,ref)};
  });
 }
 private async pendingTarget(state:KnowledgeMapState,projectId:string,read:MapOpenResult){
  if(read.kind!=='theorem'||read.qualification!=='pending'||!read.ref||read.selection!==mapHandle(read.ref)||stableHash(read.body)!==read.ref.bodyHash)return;
  const found=state.entries.find(e=>sameMapRef(e.ref,read.ref!));
  if(!found||found.kind!=='theorem'||found.nodeType==='basic-knowledge'||(!maintenanceMapScope(found,projectId)&&!maintenanceMapScope(found,CORE_MAP_ID)))return;
  const info=await this.reviewInfo(state,projectId,read.ref);
  if(!found.maintenanceDraft&&!await this.evidenceValid(read,found.ownerId,projectId,state))return;
  if(info.editable&&info.status==='pending'&&info.qualification==='pending'&&pendingReviewToken(state,found)===(read.reviewToken??'initial'))return found;
 }
 async pendingTheoristReview(projectId:string,read:MapOpenResult){return !!await this.pendingTarget((await this.port.snapshot()).state,projectId,read);}
 async confirmTheoristProof(projectId:string,read:MapOpenResult,report:MapSourceRef,excerpt:string,prerequisites:MapOpenResult[]=[],assumptions:string[]=[]){
  return this.port.edit(async state=>{
   const entry=await this.pendingTarget(state,projectId,read);
   if(!entry||report.kind!=='proof-report'||report.projectId!==projectId||report.ownerId!==entry.ownerId||!excerpt.trim())return {state,value:false};
   const source=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(report)&&s.status==='active');
   if(!source||stableHash(source.body)!==report.bodyHash||!source.body.includes(excerpt)||!await this.port.sourceValid(source))return {state,value:false};
   const conditions=new Set(entry.assumptions.map(s=>s.trim()));
   if(assumptions.some(s=>!conditions.has(s.trim())))return {state,value:false};
   const parents:MapPrerequisite[]=[];
   for(const p of prerequisites){
    if(!p.ref||!p.basis||!['definition','proved'].includes(p.qualification)||p.basis.assumptions.some(s=>!conditions.has(s.trim()))||p.basis.steps.some(s=>s.via==='accepted'||sameMapRef(s.ref,entry.ref))||!await this.evidenceValid(p,entry.ownerId,projectId,state))return {state,value:false};
    parents.push({ref:p.ref,role:'established',basis:p.basis});
   }
   const id='theorist_review_'+stableHash([entry.ref,report,read.reviewToken??'initial']);
   state.supports.push({id,statement:entry.ref,sources:[report],argument:excerpt,assumptions:[...entry.assumptions],prerequisites:parents,status:'proved',review:{id,body:'Theorist confirmed the cited derivation in the delivered report proves this node under its recorded conditions.',candidateHash:stableHash(entry.ref),sourceHashes:[report.bodyHash]}});
   entry.reviewDecision={status:'approved',token:id,origin:'theorist'};
   state.version++;validateKnowledgeMap(state);return {state,value:true};
  });
 }
 async inspectMaintenance(projectId:string){
  const {state,revision:checkpoint}=await this.port.snapshot(),profile=mapProfile(state,'local-user',projectId);
  const proofReports=publishedReviewSources(state,projectId);
  const valid=new Set<string>();
  for(const source of state.sources)if((source.ref.projectId===projectId||proofReports.has(mapSourceKey(source.ref)))&&source.ref.ownerId==='local-user'&&source.status==='active'&&await this.port.sourceValid(source))valid.add(mapSourceKey(source.ref));
  const allowed=(source:MapSourceRef)=>valid.has(mapSourceKey(source));
  const entries=state.entries.filter(entry=>maintenanceMapScope(entry,projectId)).map(entry=>{
   const status=mapQualification(state,entry,profile,allowed);
   const evidence=entry.status==='active'&&!entry.observationChange?importEvidence(state,entry):undefined;
   const prior=evidence&&importReview(state,entry,evidence.source.ref);
   const importedEvidence=evidence&&allowed(evidence.source.ref)?{mode:evidence.mode,source:evidence.source.ref,reviewStatus:prior?.status??'unreviewed',supportId:prior?.id,argument:evidence.argument}:undefined;
   return {...entry,...status,importedEvidence,suppliedProof:suppliedSeedProof(state,entry,status.supports,allowed)};
  });
  const visible=new Set(entries.map(e=>mapRefKey(e.ref)));
  const relations=state.relations.filter(edge=>edge.status==='active'&&visible.has(mapRefKey(edge.from))&&visible.has(mapRefKey(edge.to)));
  return {revision:state.version,checkpoint,entries,relations};
 }
 async maintenanceTheoryBody(projectId:string,ref:MapRef,revision:number){
  const snapshot=await this.inspectMaintenance(projectId);
  const entry=snapshot.entries.find(row=>sameMapRef(row.ref,ref));
  if(snapshot.revision!==revision||!entry||entry.kind!=='theory')throw new MapError('CONFLICT','Theory projection changed.');
  const body=await this.port.theoryBody?.(ref);
  if(body===undefined||stableHash(body)!==ref.bodyHash)throw new MapError('STALE_SOURCE','Exact theory body unavailable.');
  return body;
 }
 private async maintenancePremises(state:KnowledgeMapState,projectId:string,content:MaintenanceStatement,replaces?:string){
  const prerequisites:MapPrerequisite[]=[],dependencies:MaintenanceProofSubmission['dependencies']=[];
  if(!content.dependencies?.length)return {prerequisites,dependencies};
  const valid=await this.validSources(state,'local-user',projectId),reportSources=publishedReviewSources(state,projectId);
  const sourceAllowed=(s:MapSourceRef)=>(s.projectId===projectId||reportSources.has(mapSourceKey(s)))&&valid.has(mapSourceKey(s));
  const eligible=(r:MapRef)=>state.entries.some(e=>sameMapRef(r,e.ref)&&maintenanceMapScope(e,projectId)&&e.status==='active'&&e.ref.id!==replaces&&this.eligible(e,valid,state));
  const accepted=mapProfile(state,'local-user',projectId).accepted;
  for(const dep of content.dependencies){
   const entry=state.entries.find(e=>e.ref.store==='map'&&e.ref.id===dep.id&&e.ref.version===dep.version&&eligible(e.ref));
   if(!entry||entry.kind==='observation')throw new MapError('INVALID_INPUT','dependencies: select a current mathematical premise from this project.');
   const bases=mapProofBases(state,entry.ref,sourceAllowed,[],eligible);
   const basis=bases.find(b=>b.assumptions.every(condition=>content.assumptions.includes(condition)));
   if(basis)prerequisites.push({ref:entry.ref,role:'established',basis});
   else if(accepted.some(r=>sameMapRef(r,entry.ref))&&[entry.body!,...entry.assumptions].every(c=>content.assumptions.includes(c)))
    prerequisites.push({ref:entry.ref,role:'assumption'});
   else throw new MapError('INVALID_INPUT','dependencies: premise lacks a current proof under the stated conditions. Include required conditions or derive the premise within the attached proof.');
   dependencies.push({id:entry.ref.id,version:entry.ref.version,title:entry.title,body:entry.body!,assumptions:basis?.assumptions??entry.assumptions});
  }
  return {prerequisites,dependencies};
 }
 async maintainNode(projectId:string,callId:string,expectedVersion:number,change:{target?:MaintenanceNodeRef;content?:MaintenanceStatement},signal?:AbortSignal,checkpoint?:string){
  change=structuredClone(change);
  const {target,content}=change;
  const inspectTarget=(state:KnowledgeMapState)=>{
   const family=target?state.entries.filter(e=>e.ref.store==='map'&&e.ref.id===target.id):[];
   const prior=family.find(e=>e.ref.version===target?.version);
   if(target){
    if(!prior||!family.every(entry=>maintenanceMapScope(entry,projectId)))throw new MapError('FORBIDDEN','id: select a map node owned by this project.');
    if(prior.status!=='active'||family.some(e=>e.ref.version>prior.ref.version))throw new MapError('CONFLICT','version: the target changed, was retired or was superseded.');
    if(prior.kind==='observation'||state.profiles.some(p=>p.accepted.some(r=>family.some(e=>sameMapRef(e.ref,r)))))throw new MapError('FORBIDDEN','Measurements and accepted foundations require their dedicated management controls.');
    if(content&&content.kind!==prior.kind)throw new MapError('INVALID_INPUT','kind: preserve the node kind when editing.');
   }
   if(content&&!content.title.trim())throw new MapError('INVALID_INPUT','title: provide a nonblank title.');
   if(content&&!content.body.trim())throw new MapError('INVALID_INPUT','body: provide a nonblank statement.');
   if(!prior&&!content)throw new MapError('INVALID_INPUT','id: select an existing node.');
   return {prior,family};
  };
  const checkedContent=async(state:KnowledgeMapState,prior?:MapEntry)=>{
   if(content?.kind!=='theorem')return;
   if(prior&&prior.body===content.body&&stableHash(prior.assumptions)===stableHash(content.assumptions)){
    const valid=await this.validSources(state,'local-user',projectId);
    const reportSources=publishedReviewSources(state,projectId);
    const allowed=(r:MapSourceRef)=>(r.projectId===projectId||reportSources.has(mapSourceKey(r)))&&valid.has(mapSourceKey(r));
    const eligible=(r:MapRef)=>state.entries.some(e=>sameMapRef(e.ref,r)&&maintenanceMapScope(e,projectId)&&this.eligible(e,valid,state));
    const bases=mapProofBases(state,prior.ref,allowed,[],eligible);
    const active=state.supports.filter(s=>sameMapRef(s.statement,prior.ref)&&bases.some(b=>b.steps[0]?.via===s.id));
    const reviewed=active.filter(s=>(content.proof===undefined||s.argument===content.proof)
     &&(content.dependencies===undefined||stableHash(s.prerequisites.map(p=>({id:p.ref.id,version:p.ref.version})))===stableHash(content.dependencies)));
    if(reviewed.length)return {retained:reviewed,metadataOnly:reviewed.length===active.length};
   }
   if(!content.proof?.trim())throw new MapError('INVALID_INPUT','proof: attach the full proof for this statement, assumptions and dependencies.');
   if(!content.review?.trim())throw new MapError('INVALID_INPUT','review: record your check of the supplied proof and its conditions before publishing.');
   const {dependencies,prerequisites}=await this.maintenancePremises(state,projectId,content,target?.id);
   const submission:MaintenanceProofSubmission={title:content.title,body:content.body,assumptions:content.assumptions,proof:content.proof,dependencies};
   return {submission,reason:content.review,prerequisites};
  };
  return this.port.edit(async state=>{
   signal?.throwIfAborted();
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>state.version)throw new MapError('CONFLICT','revision: select an existing map revision.');
   const {prior,family}=inspectTarget(state);
   const resolveLinks=(map:KnowledgeMapState)=>(content?.relations??[]).map(link=>{
    const target=map.entries.find(e=>e.ref.id===link.target.id&&e.ref.version===link.target.version&&maintenanceMapScope(e,projectId)&&e.status==='active');
    if(!target||target.ref.id===prior?.ref.id)throw new MapError('INVALID_INPUT','relations: choose a different active target in this project.');
    return {to:target.ref,kind:link.kind,direction:link.direction,basis:link.basis};
   });
   const links=resolveLinks(state);
   const reviewed=await checkedContent(state,prior);
   if(expectedVersion!==state.version&&(prior||content?.dependencies?.length||links.length)){
    if(!checkpoint)throw new MapError('CONFLICT','revision: read the target or premises in this session before writing an older revision.');
    const previous=await this.port.historical(checkpoint);
    if(previous.version!==expectedVersion)throw new MapError('CONFLICT','revision: map checkpoint does not match.');
    const original=inspectTarget(previous).prior;
    const supportStamp=(map:KnowledgeMapState,node?:MapEntry)=>node?stableHash([node,map.supports.filter(s=>sameMapRef(s.statement,node.ref))]):undefined;
    if(stableHash(resolveLinks(previous))!==stableHash(links)||supportStamp(previous,original)!==supportStamp(state,prior)||stableHash((await checkedContent(previous,original))??null)!==stableHash(reviewed??null))
     throw new MapError('CONFLICT','Target or exact proof premises changed. Read the affected node before writing.');
   }
   signal?.throwIfAborted();
   const retained=reviewed?.retained??[],retainedSources=new Map(retained.flatMap(s=>s.sources.map(source=>[mapSourceKey(source),source] as const)));
   for(const entry of family)if(!reviewed?.metadataOnly&&entry.status==='active'){
    entry.status='withdrawn';entry.maintenanceWithdrawal={projectId,callId};
    for(const origin of entry.createdFrom)if(origin.kind==='maintenance-proof'&&!retainedSources.has(mapSourceKey(origin))){
     const source=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(origin));if(source)source.status='withdrawn';
    }
   }
   let ref=prior?.ref;
   if(content){
    const {kind,title,body,assumptions,tags}=content;
    ref={store:'map',id:prior?.ref.id??'draft_'+stableHash([projectId,callId]),version:(prior?.ref.version??0)+1,bodyHash:stableHash(body)};
    if(state.entries.some(e=>e.ref.id===ref!.id&&e.ref.version===ref!.version))throw new MapError('CONFLICT','This node creation already exists.');
    const sameStatement=prior?.body===body&&stableHash(prior.assumptions)===stableHash(assumptions);
    const summary=content.summary??(sameStatement?prior.summary:undefined);
    const createdFrom:MapSourceRef[]=[...retainedSources.values()];
    for(const support of retained)state.supports.push({...support,id:'support_'+stableHash([ref,support.id]),statement:ref});
    if(projectId===CORE_MAP_ID && kind==='concept' && !createdFrom.length){
     const source:MapSourceRef={kind:'user-seed',id:'core_edit_'+stableHash([callId,ref]),version:1,bodyHash:stableHash(body),ownerId:'local-user',projectId};
     state.sources.push({ref:source,body,status:'active',entryRefs:[ref]});
     state.conversions.push({sourceKey:mapSourceKey(source),state:'converted',entryRefs:[ref]});
     createdFrom.push(source);
    }
    if(reviewed?.submission){
     const sourceBody=JSON.stringify(reviewed.submission),candidateHash=stableHash(reviewed.submission);
     const source:MapSourceRef={kind:'maintenance-proof',id:'maintenance_proof_'+stableHash([projectId,callId,ref]),version:1,bodyHash:stableHash(sourceBody),ownerId:'local-user',projectId};
     createdFrom.push(source);
     state.sources.push({ref:source,body:sourceBody,status:'active',entryRefs:[ref]});
     state.conversions.push({sourceKey:mapSourceKey(source),state:'converted',entryRefs:[ref]});
     const reviewId='maintenance_review_'+stableHash([ref,candidateHash,reviewed.reason]);
     state.supports.push({id:'support_'+stableHash([source,reviewId]),statement:ref,sources:[source],argument:reviewed.submission.proof,
      assumptions:[...assumptions],prerequisites:reviewed.prerequisites,status:'proved',
      review:{id:reviewId,body:reviewed.reason,candidateHash,sourceHashes:[source.bodyHash]}});
    }
    const nodeType=content.nodeType??prior?.nodeType;
    state.entries.push({ref,ownerId:'local-user',kind,title,body,assumptions,...(nodeType?{nodeType}:{}),...(summary?{summary}:{}),aliases:content.aliases??prior?.aliases??[],domain:tags??prior?.domain??[],
     definition:false,status:'active',createdFrom,maintenanceDraft:{projectId,callId,...(prior?{parent:prior.ref}:{}),...(reviewed?.metadataOnly?{metadataOnly:true as const}:{})}});
    const inherited=content.relations===undefined&&prior&&sameStatement
     ?state.relations.filter(r=>r.status==='active'&&sameMapRef(r.from,prior.ref)).map(({to,kind,basis,direction,sources})=>({to,kind,basis,direction,sources}))
     :[];
    for(const link of [...inherited,...links]){
     const id='relation_'+stableHash([ref,link.to,link.kind,link.direction]);
     if(!state.relations.some(r=>r.id===id))state.relations.push({...link,id,from:ref,reviewId:callId,status:'active'});
    }
   }
   state.version++;validateKnowledgeMap(state);
   return {state,value:{scope:'project-map',ref,status:reviewed?'proved':content?'pending':'withdrawn',revision:state.version}};
  });
 }
 async inspect(actor:MapUser,refs?:MapRef[]){
  assertMapUser(actor,actor.ownerId,actor.projectId);const {state,revision}=await this.port.snapshot(),profile=mapProfile(state,actor.ownerId,actor.projectId),sources=await this.validSources(state,actor.ownerId,actor.projectId);
  return {recipe:MAP_RECIPE,revision,version:state.version,profile,entries:state.entries.filter(e=>(!refs||refs.some(ref=>sameMapRef(ref,e.ref)))&&e.ownerId===actor.ownerId&&(!e.maintenanceDraft||e.maintenanceDraft.projectId===actor.projectId||e.maintenanceDraft.projectId===CORE_MAP_ID)).map(e=>{
   const allowed=(ref:MapSourceRef)=>sources.has(mapSourceKey(ref)),status=mapQualification(state,e,profile,allowed);
   return {...structuredClone(e),nodeType:e.nodeType??(e.definition?'definition':e.kind),...status,suppliedProof:suppliedSeedProof(state,e,status.supports,allowed)};
  }),relations:state.relations.filter(r=>state.entries.some(e=>e.ownerId===actor.ownerId&&sameMapRef(e.ref,r.from))),coverage:state.conversions.filter(c=>state.sources.some(s=>s.ref.ownerId===actor.ownerId&&(s.ref.kind!=='maintenance-proof'||s.ref.projectId===actor.projectId)&&mapSourceKey(s.ref)===c.sourceKey)),outbox:state.outbox.filter(o=>o.ownerId===actor.ownerId&&o.projectId===actor.projectId)};
 }
}
export function maintenanceMapScope(entry:MapEntry,projectId:string):boolean {
 return entry.ownerId==='local-user'&&(entry.maintenanceDraft?entry.maintenanceDraft.projectId===projectId:
  entry.createdFrom.length>0&&entry.createdFrom.every(source=>source.projectId===projectId&&source.ownerId==='local-user'));
}

function importEvidence(state:KnowledgeMapState,entry:MapEntry){
 if(entry.kind!=='theorem'&&entry.kind!=='observation')return;
 for(const ref of entry.createdFrom){
  if(ref.kind!=='user-seed')continue;
  const source=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref)&&s.status==='active'&&s.entryRefs?.some(r=>sameMapRef(r,entry.ref)));
  const seed=(source?.origin as {seed?:MapSeedInput['entries'][number]}|undefined)?.seed;
  if(!source||!seed||seed.kind!==entry.kind||seed.body!==entry.body||stableHash(seed.assumptions??[])!==stableHash(entry.assumptions)||stableHash(source.body)!==ref.bodyHash)continue;
  if(entry.kind==='theorem'&&seed.proof?.trim()&&source.body===seed.body+'\n\nSupplied argument:\n'+seed.proof)return {source,mode:'proof' as const,argument:seed.proof};
  if(entry.kind==='observation'&&validMapObservation(seed.observation)&&stableHash(seed.observation)===stableHash(entry.observation)&&source.body===observationSourceBody(seed.body,seed.observation))return {source,mode:'transcription' as const,argument:source.body};
 }
}
function importReview(state:KnowledgeMapState,entry:MapEntry,source:MapSourceRef){
 return state.supports.find(s=>sameMapRef(s.statement,entry.ref)&&s.review&&s.sources.some(r=>mapSourceKey(r)===mapSourceKey(source))&&
  (s.status==='proved'||s.status==='observed'||s.status==='disputed'||s.id==='import_review_'+stableHash([entry.ref,source])));
}