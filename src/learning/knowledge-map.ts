import {isEmpiricalMapSource} from './map-source-role.js';
import {validMapObservation,observationSummary,observationSourceBody,type MapObservation} from './map-observation.js';
export type {MapObservation} from './map-observation.js';
import {stableHash} from './research-hash.js';
import {catalogTermsV3} from './hierarchical-catalog-v3.js';

import {publishDirectedMapSupports} from './knowledge-map-support.js';

export const MAP_RECIPE='dual-cluster-map-v1' as const;
export interface MapRef {store:'map'|'theory';id:string;version:number;bodyHash:string}
import {authoredRelationKinds,observationRelationKinds,validNodeType,type MapNodeType,type AuthoredRelation,type AuthoredRelationKind} from './map-node-fields.js';
export type MapKind='concept'|'theorem'|'theory'|'observation';
export type MapQualification='observed'|'definition'|'proved'|'accepted'|'pending'|'disputed'|'withdrawn';
export type MapPurpose='map-proof'|'map-worker'|'map-theory-study'|'map-theory-review'|'map-maintenance'|'map-review';
export interface MapGrant {refutationEvidence?:true;purpose:MapPurpose;ownerId:string;projectId:string;taskId:string;profileId:string;allowedRefs?:MapRef[];allowedSourceKeys?:string[]}
export interface MapUser {purpose:'map-user';ownerId:string;projectId:string}
export interface MapSourceRef {kind:'proof-report'|'public-research'|'library-proof'|'theory'|'user-seed'|'maintenance-proof';id:string;version:number;bodyHash:string;ownerId:string;projectId:string}
export interface MapSource {ref:MapSourceRef;body:string;canonicalTheory?:MapRef;origin?:unknown;status:'active'|'withdrawn';entryRefs?:MapRef[]}
export interface MapEntry {nodeType?:MapNodeType;scientificWithdrawal?:{source:MapSourceRef;reason:string};maintenanceDraft?:{projectId:string;callId:string;parent?:MapRef;metadataOnly?:true};maintenanceWithdrawal?:{projectId:string;callId:string};observation?:MapObservation;observationChange?:{requestId:string;status:'disputed'|'withdrawn';reason:string};ref:MapRef;ownerId:string;kind:MapKind;title:string;summary?:string;aliases:string[];domain:string[];body?:string;assumptions:string[];definition:boolean;status:'active'|'withdrawn';theoryQualification?:'candidate'|'supported';createdFrom:MapSourceRef[]}
export interface MapProofBasis {steps:{ref:MapRef;via:string}[];assumptions:string[]}
export interface MapPrerequisite {ref:MapRef;role:'established'|'assumption';basis?:MapProofBasis;discharges?:{condition:string;argument:string}[]}
export type MapDraftPrerequisite=Omit<MapPrerequisite,'ref'>&{ref:MapRef|string};
/** Exact historical versions whose proof remained live through descriptive edits. */
export function retainedMaintenanceVersions(entries:MapEntry[],entry:MapEntry):MapEntry[]{
 const chain=[entry];let current=entry;
 while(current.maintenanceDraft?.metadataOnly&&current.maintenanceDraft.parent){
  const parent=current.maintenanceDraft.parent;
  const previous=entries.find(e=>sameMapRef(e.ref,parent)&&e.ref.id===current.ref.id&&e.ref.version<current.ref.version);
  if(!previous)break;
  chain.push(previous);current=previous;
 }
 return chain;
}
export function supersedesMaintenanceVersions(entry:MapEntry,later:MapEntry[],projectId:string){
 const first=later.find(e=>e.maintenanceDraft?.metadataOnly&&e.maintenanceDraft.parent&&sameMapRef(e.maintenanceDraft.parent,entry.ref));
 return !entry.scientificWithdrawal&&(entry.maintenanceWithdrawal?.projectId===projectId||entry.status==='active'&&!!first)
  &&later.every(e=>e.maintenanceDraft?.projectId===projectId&&!e.scientificWithdrawal);
}
export interface MapSupport {id:string;statement:MapRef;sources:MapSourceRef[];argument:string;assumptions:string[];prerequisites:MapPrerequisite[];unresolvedPrerequisites?:{candidateId:string;candidateHash:string;role:MapPrerequisite['role']}[];status:'proved'|'observed'|'pending'|'disputed'|'withdrawn';review?:{id:string;body:string;candidateHash:string;sourceHashes:string[]}}
export interface FoundationProfile {id:string;ownerId:string;projectId:string;version:number;accepted:MapRef[];authorization:string}
export interface MapRelation {id:string;from:MapRef;to:MapRef;kind:AuthoredRelationKind|'member-of';basis:string;direction:'forward'|'symmetric';status:'active'|'withdrawn';reviewId:string;sources?:MapSourceRef[]}
export interface MapOutbox {singleAuthor?:true;authored?:import('../research/versions/v4/map-maintenance.js').AuthoredMapWrite;domainAdmission?:true;projection?:{entry:MapEntry;intentId:string;decision?:{placement:import('../research/versions/v4/map-maintenance.js').MapPlacement;opened:MapOpenResult[]}};refutationEvidence?:true;modelDirectedKnowledge?:true;id:string;ownerId:string;projectId:string;sourceKeys:string[];recipe:typeof MAP_RECIPE;state:'pending'|'admitted'|'completed';taskId?:string}
export interface MapConversion {sourceKey:string;state:'available'|'queued'|'pending'|'converted'|'unavailable';entryRefs:MapRef[];taskId?:string}
export interface KnowledgeMapState {recipe:typeof MAP_RECIPE;version:number;entries:MapEntry[];supports:MapSupport[];relations:MapRelation[];profiles:FoundationProfile[];sources:MapSource[];outbox:MapOutbox[];conversions:MapConversion[];receipts:Record<string,string>;publicationReceipts?:Record<string,MapPublicationReceipt>}
export interface MapView {modelDirectedKnowledge?:true;presentation?:'layered-map-v1';recipe:typeof MAP_RECIPE;revision:string;mapVersion:number;profile:FoundationProfile;grant:MapGrant;refs:MapRef[];sourceRefs:MapSourceRef[]}
export type MapNavigationKind=MapRelation['kind']|'prerequisite';
export type MapNavigationDirection='outgoing'|'incoming'|'symmetric';
export interface MapNavigationPath {kind:MapNavigationKind;direction:MapNavigationDirection;basis:string;from:string;to:string;support?:string;role?:MapPrerequisite['role'];conditions?:string[]}
export interface MapQuery {query?:string;domain?:string[];mode?:'exact'|'candidates'|'directory'|'branch'|'relations'|'lexical'|'source';selection?:string;relation?:MapNavigationKind;direction?:MapNavigationDirection;offset?:number;limit?:number}
export interface MapReadCall {detail?:'proof';toolCallId:string;action:'lookup'|'open'|'refresh';query?:MapQuery;selection?:string}
export interface MapCandidate {nodeType?:MapNodeType;summary?:string;paths?:MapNavigationPath[];statementPreview?:string;selection:string;ref:MapRef;kind:MapKind;title:string;aliases:string[];domain:string[];assumptions:string[];qualification:MapQualification;accepted:boolean;reason:'exact'|'alias'|'lexical'|'neighbor'|'branch'|'relation';score:number}
export interface MapSelection {mode?:MapQuery['mode'];directory?:{selection:string;title:string;count:number}[];recipe:typeof MAP_RECIPE;revision:string;outcome:'exact'|'candidates'|'partial'|'miss'|'incomplete';entries:MapCandidate[];evidence:{selection:string;source:MapSourceRef;conversion:MapConversion['state']}[];total:number;nextOffset?:number;truncated:boolean;coverage:{available:number;converted:number;pending:number};notice:string}
export interface MapOpenResult {suppliedProof?:{argument:string;source:MapSourceRef};nodeType?:MapNodeType;empiricalSource?:true;observation?:MapObservation;selection:string;ref?:MapRef;kind:MapKind|'source-evidence';title?:string;aliases?:string[];domain?:string[];body:string;assumptions:string[];qualification:MapQualification|'evidence';accepted:boolean;supports:MapSupport[];bases?:MapProofBasis[];separateCitations?:true;basis?:MapProofBasis;sources:MapSourceRef[];theoryQualification?:'candidate'|'supported'}
export interface MapCandidateDraft {nodeType?:MapNodeType;observation?:MapObservation;id:string;kind:'concept'|'theorem'|'observation';title:string;summary?:string;aliases:string[];domain:string[];body:string;assumptions:string[];definition:boolean;existing?:MapRef;sources:MapSourceRef[];argument:string;supportAssumptions?:string[];prerequisites:MapDraftPrerequisite[];requestedStatus:'proved'|'pending'|'observed';memberships:(MapRef|string)[];relations?:AuthoredRelation<MapRef|string>[]}
export interface MapReviewDecision {anchor?:{ref:MapRef;basis:string};candidateId:string;candidateHash:string;status:'definition'|'proved'|'observed'|'pending'|'reject'|'revise';body:string}
export interface MapReviewedProposal {authored?:true;exactReview?:true;priorEntries?:{candidate:MapCandidateDraft;decision:MapReviewDecision;ref:MapRef;reviewId:string}[];withheldCandidateIds?:string[];refutationEvidence?:true;modelDirectedKnowledge?:true;id:string;ownerId:string;projectId:string;expectedVersion:number;candidates:MapCandidateDraft[];decisions:MapReviewDecision[];reviewId:string;sourceKeys:string[];relations?:Omit<MapRelation,'id'|'reviewId'|'status'>[]}
export interface MapPublicationReceipt {id:string;version:number;entries:MapRef[];pending:boolean}
export class MapError extends Error {constructor(readonly code:'FORBIDDEN'|'CONFLICT'|'INVALID_INPUT'|'STALE_SOURCE'|'NOT_FOUND',message:string,readonly candidateId?:string){super(message);}}
/** A recoverable request or selection failure, never a journal, store or grant-integrity failure. */
export class MapReadError extends MapError {}
export function mapReadFeedback(error:unknown){
 if(error instanceof MapReadError)return {error:error.code,notice:error.message+'. Choose a new lookup or continue from available premises.'};
}
const check=(value:unknown,message:string,code:MapError['code']='INVALID_INPUT'):void=>{if(!value)throw new MapError(code,message);};
const nonblank=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(v=>typeof v==='string');
export const mapRefKey=(r:MapRef)=>JSON.stringify([r.store,r.id,r.version,r.bodyHash]);
export const mapSourceKey=(r:MapSourceRef)=>stableHash(r);
export const mapHandle=(r:MapRef)=>'map_'+stableHash(r);
export const mapEvidenceHandle=(r:MapSourceRef)=>'source_'+mapSourceKey(r);
export const emptyKnowledgeMap=():KnowledgeMapState=>({recipe:MAP_RECIPE,version:0,entries:[],supports:[],relations:[],profiles:[],sources:[],outbox:[],conversions:[],receipts:{}});
export const validMapRef=(r:unknown):r is MapRef=>!!r&&typeof r==='object'&&['map','theory'].includes((r as MapRef).store)&&nonblank((r as MapRef).id)&&Number.isSafeInteger((r as MapRef).version)&&(r as MapRef).version>0&&/^[a-f0-9]{64}$/.test((r as MapRef).bodyHash);
export const sameMapRef=(a:MapRef,b:MapRef)=>mapRefKey(a)===mapRefKey(b);
const normalize=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
export function assertMapGrant(grant:MapGrant):void {check(!!grant&&['map-proof','map-worker','map-theory-study','map-theory-review','map-maintenance','map-review'].includes(grant.purpose)&&[grant.ownerId,grant.projectId,grant.taskId,grant.profileId].every(nonblank),'Explicit map-purpose authority required','FORBIDDEN');}
export function assertMapUser(actor:MapUser,ownerId:string,projectId:string):void {check(actor?.purpose==='map-user'&&actor.ownerId===ownerId&&actor.projectId===projectId,'Map user authority differs from profile owner','FORBIDDEN');}
export function validateKnowledgeMap(state:KnowledgeMapState):void {
 check(state?.recipe===MAP_RECIPE&&Number.isSafeInteger(state.version)&&state.version>=0,'Map version');
 check([state.entries,state.supports,state.relations,state.profiles,state.sources,state.outbox,state.conversions].every(Array.isArray),'Map collections');
 const seen=new Set<string>();for(const entry of state.entries){
  check(validMapRef(entry.ref)&&nonblank(entry.ownerId)&&nonblank(entry.title)&&['concept','theorem','theory','observation'].includes(entry.kind),'Map entry');
  check(!entry.nodeType||validNodeType(entry.kind,entry.nodeType),'Node type outside its scientific kind');
  check(entry.kind==='observation'?validMapObservation(entry.observation)&&!entry.definition:entry.observation===undefined,'Map observation fields');
  check((entry.kind==='theory')===(entry.ref.store==='theory')&&strings(entry.aliases)&&strings(entry.domain)&&strings(entry.assumptions),'Map membership');
  check(entry.kind==='theory'?entry.body===undefined:typeof entry.body==='string'&&stableHash(entry.body)===entry.ref.bodyHash,'Map body owner');
  const id=JSON.stringify([entry.ref.store,entry.ref.id,entry.ref.version]);check(!seen.has(id),'Duplicate immutable entry');seen.add(id);
 }
 const exists=(ref:MapRef)=>state.entries.some(e=>sameMapRef(e.ref,ref));
 const observation=(ref:MapRef)=>state.entries.some(e=>sameMapRef(e.ref,ref)&&e.kind==='observation');
 for(const support of state.supports){
  if(observation(support.statement))check(!support.prerequisites.length&&support.status!=='proved','Observations cannot carry theorem arguments');
  if(support.status==='observed'){
   const entry=state.entries.find(e=>sameMapRef(e.ref,support.statement));
   check(entry?.kind==='observation'&&nonblank(support.review?.id)&&nonblank(support.review?.body)&&
    !!support.sources.length&&stableHash(support.review!.sourceHashes)===stableHash(support.sources.map(s=>s.bodyHash))&&
    support.sources.every(ref=>{const source=state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref));const observed=source&&observationSeed(source);
     return observed&&stableHash(observed)===stableHash(entry!.observation)&&source!.entryRefs?.some(r=>r.id===entry!.ref.id);
    }),'Missing exact reviewed measurement provenance');
  }
  check(support.prerequisites.every(p=>!observation(p.ref)),'Observation cannot be a theorem prerequisite');
  if(support.unresolvedPrerequisites?.length)check(support.status!=='proved'&&support.unresolvedPrerequisites.every(p=>nonblank(p.candidateId)&&nonblank(p.candidateHash)&&['established','assumption'].includes(p.role)),'Unresolved candidate prerequisite');
  for(const premise of support.prerequisites)if(premise.basis){
   const b=premise.basis;
   check(premise.role==='established'&&b.steps.length>0&&sameMapRef(b.steps[0]!.ref,premise.ref)&&strings(b.assumptions)&&b.steps.every(step=>validMapRef(step.ref)&&exists(step.ref)&&(step.via==='definition'||state.supports.some(s=>s.id===step.via&&sameMapRef(s.statement,step.ref)))),'Invalid recorded argument basis');
   if(premise.discharges&&support.status==='proved')check(premise.discharges.every(d=>nonblank(d.argument)&&b.assumptions.includes(d.condition)),'Discharge outside recorded argument');
  }
 }
 for(const support of state.supports){check(exists(support.statement)&&support.sources.length>0&&typeof support.argument==='string','Map support');check(support.prerequisites.every(p=>exists(p.ref)&&['established','assumption'].includes(p.role)),'Prerequisite reference');if(support.status==='proved')check(!!support.review&&nonblank(support.argument)&&!support.prerequisites.some(p=>p.role==='established'&&sameMapRef(p.ref,support.statement)),'Unreviewed or self-supported proof');}
 const byRef=new Map(state.entries.map(e=>[mapRefKey(e.ref),e]));
 for(const link of state.relations){
  const from=byRef.get(mapRefKey(link.from)),to=byRef.get(mapRefKey(link.to));
  check(from&&to&&[...authoredRelationKinds,...observationRelationKinds,'member-of'].includes(link.kind)&&nonblank(link.basis),'Map relation');
  if(['prerequisite','uses-definition','upper-structure'].includes(link.kind))
   check(link.direction==='forward'&&from!==to,'Directed node relationship requires a distinct target');
  if(link.kind==='uses-definition')check(to?.nodeType==='definition'||to?.definition,'Choose a definition as the target');
  if(link.kind==='tests'||link.kind==='measures'||link.kind==='measured-in')check(from?.kind==='observation'&&link.direction==='forward','Observation relation must identify a measurement and its target');
  if(link.kind==='member-of')check(to?.kind==='concept'||to?.kind==='theory','Membership target');
 }
 for(const profile of state.profiles)check(profile.accepted.every(ref=>exists(ref)&&!observation(ref))&&profile.version>0&&nonblank(profile.authorization),'Foundation profile');
}

/** Public source identity, not an extracting role, owns conversion idempotency. */
export function admitMapSources(state:KnowledgeMapState,sources:MapSource[],ownerId:string,projectId:string,modelDirectedKnowledge?:true,refutationEvidence?:true,domainAdmission?:true,write?:true|MapOutbox['authored']):KnowledgeMapState {
 const next=structuredClone(state),keys:string[]=[];
 for(const source of sources){check(source.ref.ownerId===ownerId&&(source.canonicalTheory?source.ref.kind==='theory'&&source.body===''&&source.canonicalTheory.bodyHash===source.ref.bodyHash:stableHash(source.body)===source.ref.bodyHash),'Public source identity','FORBIDDEN');const key=mapSourceKey(source.ref),old=next.sources.find(s=>mapSourceKey(s.ref)===key);if(old)check(stableHash(old)===stableHash(source),'Source content changed','CONFLICT');else next.sources.push(structuredClone(source));keys.push(key);if(!next.conversions.some(c=>c.sourceKey===key))next.conversions.push({sourceKey:key,state:'available',entryRefs:[]});}
 const pending=keys.filter(k=>!next.outbox.some(o=>o.sourceKeys.includes(k)));
 if(pending.length){const id='map_intent_'+stableHash([MAP_RECIPE,[...pending].sort()]);next.outbox.push({...(write?{singleAuthor:true as const}:{}),...(typeof write==='object'?{authored:structuredClone(write)}:{}),...(domainAdmission?{domainAdmission}:{}),...(refutationEvidence?{refutationEvidence}:{}),...(modelDirectedKnowledge?{modelDirectedKnowledge}:{}),id,ownerId,projectId,sourceKeys:pending,recipe:MAP_RECIPE,state:'pending'});}
 if(typeof write==='object'){
  check(keys.length===1&&sources[0]?.ref.projectId===projectId&&['proof-report','public-research'].includes(sources[0].ref.kind)&&domainAdmission&&modelDirectedKnowledge,'Scientific write requires its accepted project source','FORBIDDEN');
  const intent=next.outbox.find(o=>o.sourceKeys.includes(keys[0]!));
  check(intent?.authored&&stableHash(intent.authored)===stableHash(write),'Conflicting scientific write on the same public source','CONFLICT');
 }
 if(stableHash(next)!==stableHash(state))next.version++;
 return next;
}
export function mapProfile(state:KnowledgeMapState,ownerId:string,projectId:string):FoundationProfile {
 return structuredClone(state.profiles.find(p=>p.ownerId===ownerId&&p.projectId===projectId)??{id:'profile_'+stableHash([ownerId,projectId]),ownerId,projectId,version:0,accepted:[],authorization:'empty profile; no accepted foundations'});
}
export function selectMapProfile(state:KnowledgeMapState,input:{requestId:string;expectedVersion:number;accepted:MapRef[]},actor:MapUser):KnowledgeMapState {
 assertMapUser(actor,actor.ownerId,actor.projectId);const current=mapProfile(state,actor.ownerId,actor.projectId),receipt='profile:'+input.requestId,hash=stableHash({input,actor});
 if(state.receipts[receipt]){check(state.receipts[receipt]===hash,'Changed profile replay','CONFLICT');return structuredClone(state);}
 check(current.version===input.expectedVersion,'Foundation profile changed','CONFLICT');check(input.accepted.every(ref=>state.entries.some(e=>sameMapRef(e.ref,ref)&&e.ownerId===actor.ownerId&&(!e.maintenanceDraft||e.maintenanceDraft.projectId===actor.projectId)&&e.status==='active'&&e.kind!=='observation')),'Select an active foundational statement owned by this user','FORBIDDEN');
 const next=structuredClone(state),profile={...current,version:current.version+1,accepted:structuredClone(input.accepted),authorization:input.requestId};next.profiles=next.profiles.filter(p=>p.id!==profile.id);next.profiles.push(profile);next.receipts[receipt]=hash;next.version++;return next;
}

export function activeMapSupports(state:KnowledgeMapState,ref:MapRef,sourceAllowed:(ref:MapSourceRef)=>boolean):MapSupport[]{
 const sourceValid=(support:MapSupport)=>support.sources.every(sourceAllowed);
 const candidates=state.supports.filter(s=>s.status==='proved'&&sourceValid(s));
 const active=new Set<string>();let changed=true;
 // This invalidates recorded withdrawn prerequisites, not unrecorded mathematical assumptions.
 while(changed){changed=false;for(const s of candidates){if(active.has(s.id))continue;if(s.prerequisites.every(p=>{if(p.role==='assumption')return true;const entry=state.entries.find(e=>sameMapRef(e.ref,p.ref));if(p.basis)return !!entry&&p.basis.steps.every(step=>state.entries.some(e=>sameMapRef(e.ref,step.ref)&&e.status==='active'&&(step.via==='definition'?e.definition:active.has(step.via))));return !!entry&&entry.status==='active'&&(entry.definition||candidates.some(t=>sameMapRef(t.statement,p.ref)&&active.has(t.id)));})){active.add(s.id);changed=true;}}}
 return state.supports.filter(s=>sameMapRef(s.statement,ref)&&sourceValid(s)).map(s=>({...structuredClone(s),status:s.status==='proved'&&!active.has(s.id)?'pending':s.status}));
}
/** Source text is readable independently of its scientific review and never creates a support. */
export function suppliedSeedProof(state:KnowledgeMapState,entry:MapEntry,supports:MapSupport[],sourceAllowed:(source:MapSourceRef)=>boolean):MapOpenResult['suppliedProof']{
 if(entry.kind==='observation')return;
 for(const source of entry.createdFrom){
  if(source.kind!=='user-seed'||!sourceAllowed(source))continue;
  const record=state.sources.find(s=>s.ref.id===source.id&&s.ref.version===source.version&&mapSourceKey(s.ref)===mapSourceKey(source));
  const seed=(record?.origin as {seed?:{body?:string;proof?:string}}|undefined)?.seed;
  if(record&&typeof seed?.proof==='string'&&seed.proof.trim()&&seed.body===entry.body&&
     record.body===seed.body+'\n\nSupplied argument:\n'+seed.proof&&record.entryRefs?.some(ref=>sameMapRef(ref,entry.ref))&&
     !supports.some(s=>s.argument===seed.proof&&s.sources.some(r=>mapSourceKey(r)===mapSourceKey(source))))
   return {argument:seed.proof,source};
 }
}
export function mapQualification(state:KnowledgeMapState,entry:MapEntry,profile:FoundationProfile,sourceAllowed:(ref:MapSourceRef)=>boolean):{qualification:MapQualification;accepted:boolean;supports:MapSupport[]} {
 if(entry.kind==='observation')return observationQualification(state,entry,sourceAllowed);
 const accepted=profile.accepted.some(ref=>sameMapRef(ref,entry.ref)),supports=activeMapSupports(state,entry.ref,sourceAllowed);
 const qualification=entry.status==='withdrawn'?'withdrawn':entry.definition?'definition':supports.some(s=>s.status==='proved')?'proved':accepted?'accepted':supports.some(s=>s.status==='disputed')?'disputed':'pending';
 return {qualification,accepted,supports};
}
export function observationQualification(state:KnowledgeMapState,entry:MapEntry,sourceAllowed:(ref:MapSourceRef)=>boolean){
 const supports=state.supports.filter(s=>sameMapRef(s.statement,entry.ref)&&s.sources.every(sourceAllowed)).map(s=>structuredClone(s));
 const qualification:MapQualification=entry.status==='withdrawn'?'withdrawn':entry.observationChange?.status==='disputed'?'disputed':
  supports.some(s=>s.status==='disputed')?'disputed':supports.some(s=>s.status==='observed'&&s.review)?'observed':'pending';
 return {qualification,accepted:false,supports};
}
export function observationSeed(source:MapSource):MapObservation|undefined{
 const seed=(source.origin as {seed?:{kind?:string;body?:string;observation?:unknown}}|undefined)?.seed;
 return source.ref.kind==='user-seed'&&seed?.kind==='observation'&&typeof seed.body==='string'&&validMapObservation(seed.observation)&&
  source.body===observationSourceBody(seed.body,seed.observation)&&stableHash(source.body)===source.ref.bodyHash?seed.observation:undefined;
}
export interface PreparedMapIndex {state:KnowledgeMapState;names:Map<string,string[]>;postings:Map<string,Set<string>>;neighbors:Map<string,MapRelation[]>}
export function prepareKnowledgeMap(state:KnowledgeMapState):PreparedMapIndex {
 validateKnowledgeMap(state);const names=new Map<string,string[]>(),postings=new Map<string,Set<string>>(),neighbors=new Map<string,MapRelation[]>();
 for(const entry of state.entries){const key=mapRefKey(entry.ref);for(const name of [entry.title,...entry.aliases]){const norm=normalize(name),old=names.get(norm)??[];old.push(key);names.set(norm,old);}for(const term of new Set(catalogTermsV3([entry.title,...entry.aliases,...entry.domain,entry.body??'',...entry.assumptions].join(' ')))){const old=postings.get(term)??new Set();old.add(key);postings.set(term,old);}}
 for(const link of state.relations)for(const ref of [link.from,link.to]){const key=mapRefKey(ref),old=neighbors.get(key)??[];old.push(link);neighbors.set(key,old);}
 return {state:structuredClone(state),names,postings,neighbors};
}
export function queryKnowledgeMap(index:PreparedMapIndex,view:MapView,query:MapQuery,authorized:Set<string>,sourceAllowed:(ref:MapSourceRef)=>boolean):MapSelection {
 assertMapGrant(view.grant);if(typeof query.query!=='string')throw new MapError('INVALID_INPUT','Map query text');const queryText=query.query,offset=query.offset??0,limit=query.limit??24;check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=256,'Map pagination');
 const refs=new Set(view.refs.map(mapRefKey)),entries=new Map(index.state.entries.filter(e=>e.ownerId===view.grant.ownerId&&e.status==='active'&&authorized.has(mapRefKey(e.ref))&&refs.has(mapRefKey(e.ref))&&(!query.domain?.length||query.domain.some(d=>e.domain.some(x=>normalize(x)===normalize(d))))).map(e=>[mapRefKey(e.ref),e]));
 const hits=new Map<string,{reason:MapCandidate['reason'];score:number}>(),exact=index.names.get(normalize(query.query))??[];
 for(const key of exact)if(entries.has(key))hits.set(key,{reason:normalize(entries.get(key)!.title)===normalize(query.query)?'exact':'alias',score:1});
 for(const [key,entry] of entries)if(query.query===entry.ref.id||query.query===mapHandle(entry.ref))hits.set(key,{reason:'exact',score:1});
 const hadExact=hits.size>0;
 if(query.mode==='candidates'){
  for(const term of new Set(catalogTermsV3(query.query)))for(const key of index.postings.get(term)??[])if(entries.has(key)){const old=hits.get(key);if(old?.reason==='exact'||old?.reason==='alias')continue;hits.set(key,{reason:'lexical',score:(old?.score??0)+0.1});}
  for(const [key] of [...hits].sort((a,b)=>b[1].score-a[1].score).slice(0,3))for(const relation of index.neighbors.get(key)??[]){if(relation.status!=='active'||!entries.has(mapRefKey(relation.from))||!entries.has(mapRefKey(relation.to)))continue;const target=mapRefKey(relation.from)===key?mapRefKey(relation.to):mapRefKey(relation.from);if(!hits.has(target))hits.set(target,{reason:'neighbor',score:0.05});}
 }
 const ordered=[...hits].sort((a,b)=>b[1].score-a[1].score||a[0].localeCompare(b[0])),page=ordered.slice(offset,offset+limit);
 const result=page.map(([key,match])=>{const entry=entries.get(key)!,qualification=mapQualification(index.state,entry,view.profile,sourceAllowed);return {selection:mapHandle(entry.ref),ref:structuredClone(entry.ref),kind:entry.kind,...(entry.nodeType?{nodeType:entry.nodeType}:{}),title:entry.title,...(entry.kind!=='theory'&&entry.body?{statementPreview:entry.body.length>280?entry.body.slice(0,280)+'…':entry.body}:{}),aliases:entry.aliases,domain:entry.domain,assumptions:entry.assumptions,qualification:qualification.qualification,accepted:qualification.accepted,...match};});
 const sourceKeys=new Set(view.sourceRefs.filter(sourceAllowed).map(mapSourceKey)),coverageRows=index.state.conversions.filter(c=>sourceKeys.has(c.sourceKey));
 const evidenceMatches=index.state.sources.filter(s=>s.ref.kind!=='maintenance-proof'&&sourceKeys.has(mapSourceKey(s.ref))&&s.status==='active'&&catalogTermsV3(queryText).some(term=>catalogTermsV3(s.body).includes(term)));
 const evidence=evidenceMatches.slice(offset,offset+limit).map(s=>({selection:mapEvidenceHandle(s.ref),source:structuredClone(s.ref),conversion:index.state.conversions.find(c=>c.sourceKey===mapSourceKey(s.ref))?.state??'available' as const}));
 const truncated=offset>0||offset+limit<Math.max(ordered.length,evidenceMatches.length);
 return {recipe:MAP_RECIPE,revision:view.revision,outcome:truncated?'incomplete':result.length?result.every(r=>['pending','disputed','withdrawn'].includes(r.qualification))?'partial':hadExact?'exact':'candidates':evidence.length?'partial':'miss',entries:result,evidence,total:ordered.length+evidenceMatches.length,...(offset+limit<Math.max(ordered.length,evidenceMatches.length)?{nextOffset:offset+limit}:{}),truncated,coverage:{available:coverageRows.length,converted:coverageRows.filter(c=>c.state==='converted').length,pending:coverageRows.filter(c=>c.state!=='converted').length},notice:'Matches are scoped candidates, not applicability judgments. Read conditions and proof status. Unconverted evidence is not map knowledge; missing or truncated search does not prove universal absence.'};
}

export function publishMapProposal(state:KnowledgeMapState,proposal:MapReviewedProposal,sourceAllowed:(ref:MapSourceRef)=>boolean):{state:KnowledgeMapState;receipt:MapPublicationReceipt}{
 const hash=stableHash({...proposal,expectedVersion:undefined}),prior=state.receipts[proposal.id];
 if(prior){check(prior===hash,'Changed map publication replay','CONFLICT');check(state.publicationReceipts?.[proposal.id],'Original publication receipt unavailable','CONFLICT');return {state:structuredClone(state),receipt:structuredClone(state.publicationReceipts![proposal.id]!)};}
 check(proposal.exactReview||state.version===proposal.expectedVersion,'Map changed since scientific review','CONFLICT');check(proposal.decisions.length===proposal.candidates.length,'Every candidate requires an exact review');
 const next=structuredClone(state),published:MapRef[]=[],candidateRefs=new Map<string,MapRef>();let pending=false;
 for(const candidate of proposal.candidates){
  const decision=proposal.decisions.find(d=>d.candidateId===candidate.id);check(decision&&decision.candidateHash===stableHash(candidate)&&nonblank(decision.body),'Review does not bind exact candidate');
  check(['concept','theorem','observation'].includes(candidate.kind)&&[candidate.body,candidate.title].every(nonblank)&&strings(candidate.assumptions)&&candidate.sources.length>0,'Map candidate');
  check(candidate.sources.every(source=>source.ownerId===proposal.ownerId&&proposal.sourceKeys.includes(mapSourceKey(source))&&sourceAllowed(source)),'Candidate source unavailable','STALE_SOURCE');
  if(decision!.status==='reject')continue;
  if(decision!.status==='revise')throw new MapError('CONFLICT','Scientific revision requested');
  const documents=candidate.sources.map(ref=>state.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref)));
  for(const source of documents){const origin=source?.origin as {assessmentId?:string;condition?:string}|undefined;
   if(origin?.assessmentId)check(!!origin.condition&&candidate.kind==='theorem'&&candidate.assumptions.includes(origin.condition)&&(candidate.supportAssumptions??candidate.assumptions).includes(origin.condition),'Retain the reviewed condition on the theorem and its proof','FORBIDDEN');
  }
  const seeded=documents.filter((s):s is MapSource=>!!s&&!!observationSeed(s));
  if(decision!.status==='proved'||decision!.status==='definition')check(!documents.some(s=>s&&isEmpiricalMapSource(s)),'Empirical evidence cannot confer a mathematical proof basis','FORBIDDEN');
  if(candidate.kind==='observation'){
   check(proposal.modelDirectedKnowledge&&proposal.refutationEvidence,'Observation review requires its frozen capability','FORBIDDEN');
   check(validMapObservation(candidate.observation)&&!candidate.definition&&!candidate.prerequisites.length&&['observed','pending'].includes(candidate.requestedStatus),'Invalid observation candidate');
   check(['observed','pending','reject','revise'].includes(decision!.status),'Invalid observation review');
   check(candidate.existing&&seeded.length===candidate.sources.length&&seeded.every(source=>
    source.ref.projectId===proposal.projectId&&source.entryRefs?.some(ref=>ref.id===candidate.existing!.id)&&stableHash(observationSeed(source))===stableHash(candidate.observation)
   ),'Observation requires an exact user-supplied measurement source and its map entry','FORBIDDEN');
  }else{
   check(!candidate.observation&&decision!.status!=='observed'&&candidate.requestedStatus!=='observed'&&!seeded.length,'Measurement records cannot supply a mathematical premise','FORBIDDEN');
  }
  check(decision!.status!=='definition'||candidate.kind==='concept'&&candidate.definition&&(!candidate.nodeType||candidate.nodeType==='definition'),'Only a definition candidate can receive definition qualification');
  if(decision!.anchor)check(next.entries.some(e=>sameMapRef(e.ref,decision!.anchor!.ref)&&e.ownerId===proposal.ownerId&&e.status==='active'&&e.createdFrom.some(sourceAllowed)),'Scientific anchor withdrawn','STALE_SOURCE');
  const previous=candidate.existing?next.entries.find(e=>sameMapRef(e.ref,candidate.existing!)):undefined;
  const later=previous?next.entries.filter(e=>e.ref.id===previous.ref.id&&e.ref.version>previous.ref.version):[];
  const supersedesMaintenance=!!previous&&supersedesMaintenanceVersions(previous,later,proposal.projectId);
  if(proposal.authored&&candidate.existing){
   const family=next.entries.filter(e=>e.ref.id===candidate.existing!.id);
   const projectOwned=family.every(e=>e.ownerId===proposal.ownerId&&e.kind!=='theory'&&e.kind!=='observation'
    &&(e.maintenanceDraft?e.maintenanceDraft.projectId===proposal.projectId:e.createdFrom.length>0)
    &&e.createdFrom.every(s=>s.ownerId===proposal.ownerId&&s.projectId===proposal.projectId&&s.kind!=='user-seed'));
   const active=previous?.status==='active'&&(previous.maintenanceDraft?.projectId===proposal.projectId||previous.createdFrom.some(sourceAllowed));
   check((active||supersedesMaintenance)&&projectOwned&&!next.profiles.some(p=>p.accepted.some(r=>r.id===candidate.existing!.id)),'Scientific update requires its project-owned statement outside the foundation profile','FORBIDDEN');
  }
  if(previous?.maintenanceWithdrawal&&!supersedesMaintenance)throw new MapError('CONFLICT','Supplement target changed',candidate.id);
  if(candidate.existing)check(previous&&previous.ref.store==='map'&&previous.ownerId===proposal.ownerId&&previous.kind===candidate.kind,'Invalid supplement target','FORBIDDEN');
  if(previous?.kind==='observation'){
   check(previous.status==='active'&&!previous.observationChange,'Observation superseded or disputed','STALE_SOURCE');
   check(stableHash(candidate.observation)===stableHash(previous.observation)&&candidate.sources.every(s=>previous.createdFrom.some(r=>mapSourceKey(s)===mapSourceKey(r))),
    'A measurement review must use the exact source and transcription on the authorized seed','FORBIDDEN');
  }
  if(later.length&&!supersedesMaintenance)throw new MapError('CONFLICT','Supplement parent changed',candidate.id);
  const lastVersion=later.reduce((version,e)=>Math.max(version,e.ref.version),previous?.ref.version??0);
  const sameBody=!supersedesMaintenance&&previous&&previous.body===candidate.body&&(!candidate.observation||stableHash(previous.observation)===stableHash(candidate.observation))&&previous.title===candidate.title&&previous.definition===(decision!.status==='definition'&&candidate.kind==='concept')&&stableHash([previous.assumptions,previous.aliases,previous.domain])===stableHash([candidate.assumptions,candidate.aliases,candidate.domain]),ref:MapRef=sameBody?previous.ref:{store:'map',id:previous?.ref.id??'entry_'+stableHash([proposal.id,candidate.id]),version:lastVersion+1,bodyHash:stableHash(candidate.body)};
  if(previous&&(supersedesMaintenance||!sameBody&&previous.maintenanceDraft?.metadataOnly)){
   const versions=[...retainedMaintenanceVersions(next.entries,previous),...later];
   for(const entry of versions){
    entry.status='withdrawn';
    for(const ref of entry.createdFrom.filter(r=>r.kind==='maintenance-proof')){
     const source=next.sources.find(s=>mapSourceKey(s.ref)===mapSourceKey(ref));
     if(source)source.status='withdrawn';
    }
   }
  }
  // A reviewed index summary can change between map snapshots without invalidating proofs of the same statement.
  const summary=candidate.observation?(candidate.summary??previous?.summary??observationSummary(candidate.observation)):candidate.summary;
  if(sameBody&&summary)previous.summary=summary;
  if(sameBody&&candidate.nodeType)previous.nodeType=candidate.nodeType;
  if(previous?.kind==='observation'&&!sameBody)previous.status='withdrawn';
  if(!sameBody)next.entries.push({ref,ownerId:proposal.ownerId,kind:candidate.kind,title:candidate.title,...((candidate.nodeType??previous?.nodeType)?{nodeType:candidate.nodeType??previous?.nodeType}:{}),...(summary?{summary}:{}),...(candidate.observation?{observation:structuredClone(candidate.observation)}:{}),aliases:candidate.aliases,domain:candidate.domain,body:candidate.body,assumptions:candidate.assumptions,definition:decision!.status==='definition'&&candidate.kind==='concept',status:'active',createdFrom:structuredClone(candidate.sources)});
  if(!proposal.modelDirectedKnowledge){
   const prerequisites=candidate.prerequisites as MapPrerequisite[];
   check(candidate.supportAssumptions===undefined&&prerequisites.every(p=>p.basis===undefined&&p.discharges===undefined),'Argument choices require their frozen publication capability');
   check(prerequisites.every(p=>validMapRef(p.ref)&&next.entries.some(e=>sameMapRef(e.ref,p.ref)&&e.ownerId===proposal.ownerId&&e.kind!=='observation')),'Prerequisite outside map authority','FORBIDDEN');
   check(decision!.status!=='proved'||nonblank(candidate.argument)&&!prerequisites.some(p=>p.role==='established'&&sameMapRef(p.ref,ref)),'Proved claim needs a non-circular argument');
   if(decision!.status!=='definition'){
    const id='support_'+stableHash([ref,candidate.sources,candidate.argument,candidate.assumptions,prerequisites,proposal.reviewId,decision!.status]);
    if(!next.supports.some(s=>s.id===id))next.supports.push({id,statement:ref,sources:structuredClone(candidate.sources),argument:candidate.argument,assumptions:candidate.assumptions,prerequisites,status:decision!.status==='proved'?'proved':'pending',review:{id:proposal.reviewId,body:decision!.body,candidateHash:decision!.candidateHash,sourceHashes:candidate.sources.map(s=>s.bodyHash)}});
    if(decision!.status!=='proved')pending=true;
   }
  }
  candidateRefs.set(candidate.id,ref);
  published.push(ref);
 }
 if(proposal.modelDirectedKnowledge)pending=publishDirectedMapSupports(next,proposal,candidateRefs,sourceAllowed);
 for(const row of proposal.priorEntries??[])candidateRefs.set(row.candidate.id,row.ref);
 const navigationDecisions=new Map([...(proposal.priorEntries??[]).map(r=>r.decision),...proposal.decisions].map(d=>[d.candidateId,d]));
 for(const candidate of [...proposal.candidates,...(proposal.priorEntries??[]).map(r=>r.candidate)]){const from=candidateRefs.get(candidate.id);if(!from)continue;const resolve=(target:MapRef|string)=>{const ref=typeof target==='string'?candidateRefs.get(target):target;check(ref,'Relation target was not published');return ref!;};
  const anchor=navigationDecisions.get(candidate.id)?.anchor;
  const relations=[...(anchor&&!sameMapRef(from,anchor.ref)?[{target:anchor.ref,kind:'related' as const,basis:anchor.basis,direction:'symmetric' as const}]:[]),...candidate.memberships.map(target=>({target,kind:'member-of' as const,basis:navigationDecisions.get(candidate.id)!.body,direction:'forward' as const})),...candidate.relations??[]];
  for(const relation of relations){if(proposal.modelDirectedKnowledge&&typeof relation.target==='string'&&!candidateRefs.has(relation.target)&&(proposal.withheldCandidateIds?.includes(relation.target)||navigationDecisions.get(relation.target)?.status==='reject'))continue;const to=resolve(relation.target),entry=next.entries.find(e=>sameMapRef(e.ref,to)&&e.ownerId===proposal.ownerId);check(entry&&nonblank(relation.basis),'Invalid map relation');if(relation.kind==='member-of')check(entry!.kind==='concept'||entry!.kind==='theory','Invalid concept membership');const id='relation_'+stableHash([from,to,relation.kind,relation.direction]);if(!next.relations.some(r=>r.id===id))next.relations.push({id,from,to,kind:relation.kind,basis:relation.basis,direction:relation.direction,status:'active',reviewId:proposal.reviewId,...(proposal.modelDirectedKnowledge?{sources:structuredClone(candidate.sources)}:{})});}
 }
 for(const relation of proposal.relations??[]){
  check([relation.from,relation.to].every(ref=>next.entries.some(e=>sameMapRef(e.ref,ref)&&e.ownerId===proposal.ownerId)),'Relation outside map authority','FORBIDDEN');
  const sources=proposal.modelDirectedKnowledge?next.sources.filter(s=>proposal.sourceKeys.includes(mapSourceKey(s.ref))).map(s=>s.ref):undefined;
  if(sources)check(sources.length>0&&sources.every(s=>s.ownerId===proposal.ownerId&&sourceAllowed(s)),'Relation review source unavailable','STALE_SOURCE');
  next.relations.push({...relation,id:'relation_'+stableHash(relation),status:'active',reviewId:proposal.reviewId,...(sources?{sources}:{})});
 }
 for(const key of proposal.sourceKeys){const row=next.conversions.find(c=>c.sourceKey===key);if(row){row.state=pending?'pending':'converted';row.entryRefs=[...row.entryRefs,...published.filter(ref=>!row.entryRefs.some(old=>sameMapRef(old,ref)))];}}
 next.receipts[proposal.id]=hash;next.version++;const receipt={id:proposal.id,version:next.version,entries:published,pending};next.publicationReceipts??={};next.publicationReceipts[proposal.id]=structuredClone(receipt);validateKnowledgeMap(next);return {state:next,receipt};
}
