import {MapError,reviewHold,observationQualification,mapRefKey,sameMapRef,type FoundationProfile,type MapEntry,type KnowledgeMapState,type MapOpenResult,type MapPrerequisite,type MapQualification,type MapProofBasis,type MapRef,type MapReviewedProposal,type MapSourceRef,type MapSupport} from './knowledge-map.js';
import {stableHash} from './research-hash.js';

export const mapBasisHandle=(basis:MapProofBasis)=>'map_basis_'+stableHash(basis);

/** Reconstruct an argument using its recorded premise choices. Never infer that a
 * hypothesis follows from another hypothesis, a title, or an accepted profile. */
export function mapProofBases(state:KnowledgeMapState,ref:MapRef,sourceAllowed:(source:MapSourceRef)=>boolean,
 accepted:MapRef[]=[],entryAllowed:(ref:MapRef)=>boolean=()=>true,required?:MapProofBasis):MapProofBasis[]{
 const entries=new Map(state.entries.map(e=>[mapRefKey(e.ref),e]));
 const supports=new Map<string,typeof state.supports>();
 for(const s of state.supports){const key=mapRefKey(s.statement),group=supports.get(key)??[];group.push(s);supports.set(key,group);}
 const resolved=new Map<string,MapProofBasis>();
 function visit(target:MapRef,path:Set<string>,limit?:MapProofBasis,rootVia?:string,firstOnly=false):MapProofBasis[]{
  const key=mapRefKey(target),entry=entries.get(key);
  if(!entry||entry.kind==='observation'||entry.status!=='active'||reviewHold(entry)||!entryAllowed(target)||path.has(key))return [];
  const cachedKey=firstOnly?JSON.stringify([key,rootVia,limit&&stableHash(limit)]):undefined,cached=cachedKey&&resolved.get(cachedKey);
  if(cached&&cached.steps.every(step=>!path.has(mapRefKey(step.ref))))return [cached];
  const permits=(via:string)=>(!rootVia||via===rootVia)&&(!limit||limit.steps.some(step=>sameMapRef(step.ref,target)&&step.via===via));
  const bases:MapProofBasis[]=[];
  if(entry.definition&&permits('definition'))bases.push({steps:[{ref:target,via:'definition'}],assumptions:[...entry.assumptions]});
  for(const support of supports.get(key)??[]){
   if(firstOnly&&bases.length)break;
   if(support.status!=='proved'||!support.review||!support.sources.every(sourceAllowed)||!permits(support.id)||support.unresolvedPrerequisites?.length)continue;
   const assumptions=new Set([...entry.assumptions,...support.assumptions]),steps:MapProofBasis['steps']=[{ref:target,via:support.id}];
   let complete=true;
   for(const premise of support.prerequisites){
    const parent=entries.get(mapRefKey(premise.ref));
    if(!parent||parent.kind==='observation'||parent.status!=='active'||reviewHold(parent)==='disputed'||!entryAllowed(parent.ref)){complete=false;break;}
    if(premise.role==='assumption'){
     assumptions.add(parent.body??parent.title);
     for(const condition of parent.assumptions)assumptions.add(condition);
     continue;
    }
    const restriction=premise.basis??limit;
    const branches=visit(parent.ref,new Set([...path,key]),restriction,premise.basis?.steps[0]?.via,true);
    const branch=premise.basis?branches.find(b=>stableHash(b)===stableHash(premise.basis)):branches[0];
    if(!branch){complete=false;break;}
    const discharged=new Set((premise.discharges??[]).filter(d=>d.argument.trim()&&branch.assumptions.includes(d.condition)).map(d=>d.condition));
    for(const condition of branch.assumptions)if(!discharged.has(condition))assumptions.add(condition);
    for(const step of branch.steps)if(!steps.some(s=>s.via===step.via&&sameMapRef(s.ref,step.ref)))steps.push(step);
   }
   if(complete)bases.push({steps,assumptions:[...assumptions]});
  }
  if(accepted.some(r=>sameMapRef(r,target))&&permits('accepted'))bases.push({steps:[{ref:target,via:'accepted'}],assumptions:[...entry.assumptions]});
  if(cachedKey&&bases[0])resolved.set(cachedKey,bases[0]);
  return bases;
 }
 const bases=visit(ref,new Set(),required,required?.steps[0]?.via);
 return required?bases.filter(b=>stableHash(b)===stableHash(required)):bases;
}

export function directedMapQualification(state:KnowledgeMapState,entry:MapEntry,profile:FoundationProfile,sourceAllowed:(ref:MapSourceRef)=>boolean,entryAllowed:(ref:MapRef)=>boolean){
 if(entry.kind==='observation')return {...observationQualification(state,entry,sourceAllowed),bases:[]};
 const bases=mapProofBases(state,entry.ref,sourceAllowed,profile.accepted,entryAllowed);
 const active=new Set(bases.map(b=>b.steps[0]!.via));
 const supports=state.supports.filter(s=>sameMapRef(s.statement,entry.ref)&&s.sources.every(sourceAllowed)&&
  s.prerequisites.every(p=>entryAllowed(p.ref)&&(!p.basis||p.basis.steps.every(step=>entryAllowed(step.ref))))).map(s=>({...structuredClone(s),status:s.status==='proved'&&!active.has(s.id)?'pending' as const:s.status}));
 const qualification:MapQualification=entry.status==='withdrawn'?'withdrawn':reviewHold(entry)??(active.has('definition')?'definition':supports.some(s=>s.status==='proved')?'proved':active.has('accepted')?'accepted':supports.some(s=>s.status==='disputed')?'disputed':'pending');
 return {qualification,accepted:active.has('accepted'),supports,bases};
}

/** A bare statement citation is sufficient when the available bases impose the
 * same obligations. The host still retains the exact argument actually used. */
export function mapBasisChoices(read:MapOpenResult){
 const bases=read.bases??[],distinct=new Set(bases.map(b=>stableHash([...new Set(b.assumptions)].sort())));
 const separate=read.separateCitations||distinct.size>1;
 return (separate?bases:bases.slice(0,1)).map(basis=>({selection:separate?mapBasisHandle(basis):read.selection,basis}));
}

/** A retained statement keeps the citation choices actually delivered. A new
 * open may offer new bases, while replay can only remove unavailable ones. */
export function retainMapOpenBases(prior:MapOpenResult,current:MapOpenResult):MapOpenResult{
 if(current.kind==='observation'){
  if(prior.kind!=='observation'||prior.qualification!=='observed'||current.qualification!=='observed')return {...current,qualification:current.qualification==='observed'?'pending' as const:current.qualification,supports:current.supports.filter(s=>s.status!=='observed')};
  const original=new Set(prior.supports.filter(s=>s.status==='observed').map(s=>stableHash(s)));
  const supports=current.supports.filter(s=>s.status==='observed'&&original.has(stableHash(s)));
  return {...current,qualification:supports.length?'observed' as const:'pending' as const,supports};
 }
 // Keep the review revision actually witnessed, even if the same version returned to pending.
 if(prior.reviewToken!==current.reviewToken)current={...current,reviewToken:prior.reviewToken};
 if(!prior?.bases||!current.bases)return current;
 if(!prior.separateCitations&&stableHash(prior.bases)===stableHash(current.bases))return current;
 const choices=mapBasisChoices(prior),keys=new Set(choices.map(c=>mapBasisHandle(c.basis)));
 const bases=current.bases.filter(b=>keys.has(mapBasisHandle(b))),active=new Set(bases.map(b=>b.steps[0]!.via));
 const supports=current.supports.map(s=>s.status==='proved'&&!active.has(s.id)?{...s,status:'pending' as const}:s);
 const qualification=active.has('definition')?'definition':supports.some(s=>s.status==='proved')?'proved':active.has('accepted')?'accepted':current.qualification==='disputed'?'disputed':'pending';
 return {...current,bases,supports,accepted:active.has('accepted'),qualification,...(prior.separateCitations||choices.some(c=>c.selection!==prior.selection)?{separateCitations:true}:{})};
}

/** Entries have already received immutable versions. Resolve reviewed arguments
 * in dependency order within the same transaction, including forward handles. */
export function publishDirectedMapSupports(state:KnowledgeMapState,proposal:MapReviewedProposal,refs:Map<string,MapRef>,sourceAllowed:(ref:MapSourceRef)=>boolean){
 const candidates=new Map(proposal.candidates.map(c=>[c.id,c])),decisions=new Map(proposal.decisions.map(d=>[d.candidateId,d]));
 if(candidates.size!==proposal.candidates.length||decisions.size!==candidates.size)throw new MapError('INVALID_INPUT','Candidate and review identities must be unique');
 const visited=new Map<string,MapProofBasis|undefined>(),visiting=new Set<string>();
 let pending=false;
 const eligible=(ref:MapRef)=>state.entries.some(e=>sameMapRef(e.ref,ref)&&e.ownerId===proposal.ownerId&&e.status==='active'&&(e.createdFrom.some(sourceAllowed)||state.supports.some(s=>sameMapRef(s.statement,ref)&&s.status!=='withdrawn'&&s.sources.every(sourceAllowed))));
 function publish(id:string):MapProofBasis|undefined{
  if(visited.has(id))return visited.get(id);
  if(visiting.has(id))return;
  const candidate=candidates.get(id),decision=decisions.get(id),ref=refs.get(id);
  if(!candidate||!decision)throw new MapError('INVALID_INPUT','Unknown sibling prerequisite');
  if(!ref)return;
  if(candidate.kind==='observation'){
   const status=decision.status==='observed'?'observed':'pending';
   state.supports.push({id:'support_'+stableHash([ref,decision.candidateHash,proposal.reviewId,status]),
    statement:ref,sources:structuredClone(candidate.sources),argument:decision.body,assumptions:[],prerequisites:[],status,
    review:{id:proposal.reviewId,body:decision.body,candidateHash:decision.candidateHash,sourceHashes:candidate.sources.map(s=>s.bodyHash)}});
   if(status==='pending')pending=true;
   visited.set(id,undefined);return;
  }
  if(decision.status==='definition')return {steps:[{ref,via:'definition'}],assumptions:candidate.assumptions};
  visiting.add(id);
  const prerequisites:MapPrerequisite[]=[],unresolved:NonNullable<MapSupport['unresolvedPrerequisites']>=[];
  let complete=decision.status==='proved'&&!!candidate.argument.trim();
  for(const p of candidate.prerequisites){
   const sibling=typeof p.ref==='string'?p.ref:undefined,prior=sibling?proposal.priorEntries?.find(row=>row.candidate.id===sibling):undefined;
   const target=typeof p.ref==='string'?refs.get(p.ref)??prior?.ref:p.ref;
   if(!target){
    const rejected=sibling&&decisions.get(sibling);
    if(!rejected||rejected.status!=='reject')throw new MapError('INVALID_INPUT','Unknown candidate prerequisite');
    unresolved.push({candidateId:rejected.candidateId,candidateHash:rejected.candidateHash,role:p.role});complete=false;continue;
   }
   if(!state.entries.some(e=>sameMapRef(e.ref,target)&&e.ownerId===proposal.ownerId))throw new MapError('FORBIDDEN','Prerequisite outside map authority');
   if(state.entries.some(e=>sameMapRef(e.ref,target)&&e.kind==='observation'))throw new MapError('FORBIDDEN','A measurement cannot be a mathematical prerequisite');
   let basis:MapProofBasis|undefined;
   if(p.role==='established'){
    if(prior){
     const via=prior.decision.status==='definition'?'definition':'support_'+stableHash([prior.ref,prior.decision.candidateHash,prior.reviewId,prior.decision.status]);
     basis=mapProofBases(state,target,sourceAllowed,[],eligible).find(b=>b.steps[0]?.via===via);
    }else if(sibling)basis=publish(sibling);
    else{
     const bases=mapProofBases(state,target,sourceAllowed,[],eligible,p.basis);
     if(new Set(bases.map(b=>stableHash([...b.assumptions].sort()))).size===1)basis=bases[0];
    }
    if(!basis||basis.steps.some(s=>sameMapRef(s.ref,ref)))complete=false;
   }else if(!eligible(target))complete=false;
   if(p.discharges?.some(d=>!d.argument.trim()||!basis?.assumptions.includes(d.condition)))complete=false;
   prerequisites.push({ref:target,role:p.role,...(basis?{basis}:{}),...(p.discharges?.length?{discharges:p.discharges}:{})});
  }
  const support:MapSupport={
   id:'support_'+stableHash([ref,decision.candidateHash,proposal.reviewId,decision.status]),
   statement:ref,sources:candidate.sources,argument:candidate.argument,assumptions:candidate.supportAssumptions??candidate.assumptions,
   prerequisites,...(unresolved.length?{unresolvedPrerequisites:unresolved}:{}),status:complete?'proved':'pending',
   review:{id:proposal.reviewId,body:decision.body,candidateHash:decision.candidateHash,sourceHashes:candidate.sources.map(s=>s.bodyHash)}
  };
  state.supports.push(support);visiting.delete(id);
  const basis=complete?mapProofBases(state,ref,sourceAllowed,[],eligible).find(b=>b.steps[0]?.via===support.id):undefined;
  if(!basis){support.status='pending';pending=true;}
  visited.set(id,basis);
  return basis;
 }
 for(const id of refs.keys())publish(id);
 return pending;
}
