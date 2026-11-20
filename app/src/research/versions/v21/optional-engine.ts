import {prepareDiscussionCall} from '../v4/discussion.js';
import {mapWriteSelections} from '../v4/scientific-map-write.js';
import {maintenanceReferral,RuntimeError} from '../../../runtime/errors.js';
import {sameObservationEvidence} from '../v4/map-evidence-schema.js';
import {boundedPublicFragmentsV4,fragmentSupportV4,type PublicFragmentV4} from '../v4/fragments.js';
import { foregroundBudgetV4 } from '../v4/foreground-budget.js';
import {ProofBridgeV4} from '../v4/proof-bridge.js';
import {resourceNodeV3} from '../v3/catalog-context.js';
import {freezeKnowledgeV3} from '../v3/knowledge.js';
import {budgetControlsEnabledV3} from '../v3/capacity-policy.js';
import {classifyContinuationsV3,fullOriginalRefsV3} from '../v3/continuations.js';
import {inlineProofsV3} from '../v3/inline-proofs.js';
import { affectedArtifactsV3 } from '../v3/revocation.js';
import { artifactCardsV3, boundedResourceBodiesV3, boundedSourcesV3, branchContextV3, presentContextV3, acceptExecutionV3, addRootWorkspaceV3 } from '../v3/integration.js';
/** Explicit operation9 scheduler. The single writer remains alive while admitted branches drain. */
import { OptionalResearchRunnerV21 as LegacyOptionalResearchRunnerV21 } from './optional-engine-op8.js';
import { isDeepStrictEqual } from 'node:util';
import type { AgentSession, AgentSessionSpecV21, AgentRuntimeV21, ResearchStoreV21, ResearchCompositionV21, ResearchProjectV21, InFlightEpochV21, CallV21, FrozenQuestionV21, EpochRecordV21, ResearchEventV21 } from '../../contracts/v21.js';
import type { OptionalFlowV21, OptionalBranchV21, OptionalTheoristResultV21, OptionalProofArtifactV21, OptionalWorkerRequestV21, OptionalProofSelectionV21 } from './optional-types.js';
import { OPTIONAL_MODE_V21 } from './optional-types.js';
import { createOptionalOperationV21 } from './optional-operation.js';
import { digestV21 } from './state.js';
import { stableHash } from '../../../learning/research-hash.js';
import { interpretedRootV21 } from './root-interpretation.js';
import { validateOptionalArtifactV21, optionalConflictsV21 } from './optional-proof.js';
import { finishPlanningInputs } from '../../user-commands.js';
const now=()=>new Date().toISOString();
const projectPin=(p:ResearchProjectV21)=>({researchLoopVersion:p.researchLoopVersion,workerProtocolVersion:'2.1' as const});
/** Report readers may outlive their foreground epoch. Only its active writer ingests project commands. */
export async function reportResearchHalted(store:ResearchStoreV21,projectId:string){
 const commands=await store.listCommands(projectId),project=await store.loadProject(projectId);
 return project.status==='stopped'||commands.some(c=>(c.kind==='stop'||c.kind==='pause')&&!project.processedCommandIds.includes(c.id));
}
interface OptionalPortsV21 {
 stopped(project:ResearchProjectV21):boolean; save(marker:InFlightEpochV21):Promise<void>; halted(project:ResearchProjectV21):Promise<boolean>;
 emit(project:ResearchProjectV21,type:ResearchEventV21['type'],extra?:Partial<ResearchEventV21>):void;
 registerLearning(project:ResearchProjectV21,epoch:EpochRecordV21):Promise<void>;
}
export function initialOptionalFlowV21(operationRevision:'v21-operation-9'|'v3-operation-1'|'v3-operation-2'|'v3-operation-3'|'v3-operation-4'|'v3-operation-5'|'v3-operation-6'|'v4-proof-2'|'v4-proof-3'|'v4-proof-4'|'v4-proof-5'='v21-operation-9'):OptionalFlowV21{return {version:1,operationRevision,sequence:0,artifacts:[],branches:[],archives:[],evidenceRevision:0,reviewedArtifactIds:[],deliveryHistory:[],conflictArtifactIds:[],phase:'solve',continuationNeeded:true,notices:[]};}
class ConditionResearchRunnerV21 {
 private cancelled=false;
 private theory?:ProofBridgeV4;
 backgroundBridge(){return this.theory;}
 private mutations:Promise<void>=Promise.resolve();
 private async serial<T>(work:()=>Promise<T>):Promise<T>{const job=this.mutations.then(work);this.mutations=job.then(()=>{},()=>{});return job;}
 // V3 marker transitions share the staged scientific-commit lock; never hold it over model execution.
 private transition<T>(m:InFlightEpochV21,work:()=>Promise<T>):Promise<T>{return m.snapshot.v3?this.serial(work):work();}
 private sessions=new Map<string,AgentSession>();private running=new Map<string,Promise<void>>();private errors:unknown[]=[];
 constructor(private store:ResearchStoreV21,private runtime:AgentRuntimeV21,private composition:ResearchCompositionV21,private ports:OptionalPortsV21){}
 async cancel():Promise<void>{this.cancelled=true;this.theory?.cancel();await Promise.allSettled([...this.sessions.values()].map(s=>this.runtime.cancelSession?.(s)));}
 private flow(m:InFlightEpochV21){if(m.solverMode!==OPTIONAL_MODE_V21||!m.optionalFlow)throw new Error('Optional execution needs its explicit frozen mode.');return m.optionalFlow;}
 private admitted(m:InFlightEpochV21){return m.calls.length;}
 private canAdmit(m:InFlightEpochV21,reserve=0):boolean {
  if(m.snapshot.theoryRevision==='v4-operation-5')return true;
  const budget=m.snapshot.config.epochBudget,used=m.calls.reduce((sum,c)=>({tokens:sum.tokens+(c.usage?.tokens??0),cost:sum.cost+(c.usage?.costUsd??0)}),{tokens:0,cost:0});
  if(this.theory) return this.theory.canReserve(m,reserve+1);
  return (!budgetControlsEnabledV3(m.snapshot.capacityPolicy)||this.admitted(m)+reserve<budget.maxTasks)&&used.tokens<budget.maxTokens-budget.reserveTokens&&used.cost<budget.maxCostUsd-budget.reserveCostUsd;
 }
 private spec(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,branch?:OptionalBranchV21):AgentSessionSpecV21 {
  const role=branch?'worker':'theorist',model=branch?.frozen.model??m.snapshot.modelConfig.roleModels?.[role]??m.snapshot.modelConfig.defaultModel;
  const input=call.input as {artifacts?:OptionalProofArtifactV21[]};
  return {id:`${call.id}_session`,projectId:p.id,loop:projectPin(p),contractVersion:'2.1',role,...(model?{model}:{}),budget:structuredClone(branch?.frozen.budget??foregroundBudgetV4(m.snapshot)),context:branch?{brief:structuredClone(branch.frozen)}:{project:structuredClone(p),snapshot:structuredClone(m.snapshot),marker:structuredClone(m),grants:(m.snapshot.v3?this.flow(m).artifacts:input.artifacts??[]).map(a=>({readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.originalRef})),deliveries:[]}};
 }
 private async recordRawDelivery(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21):Promise<void>{
  const flow=this.flow(m);
  if(call.systemChangeSkipped && !flow.notices.includes(maintenanceReferral)){
   flow.notices.push(maintenanceReferral);
   await this.ports.save(m);
   this.ports.emit(p,'research.warning',{userVisible:true,message:maintenanceReferral});
  }
  const retained=call.captured??(call.result as OptionalTheoristResultV21|undefined),ref=retained?.originalRef;
  if(!ref)return;
  if(ref.owner!==p.id||ref.projectId!==p.id||ref.callId!==call.id||ref.hypothesisId!==m.snapshot.root.hypothesisId||ref.hypothesisRevision!==m.snapshot.root.revision||ref.inputHash!==call.operation?.inputHash)throw new Error('Retained original identity mismatch.');
  const body=await this.composition.rawAnswers.read(ref,{readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref});
  if(Buffer.byteLength(body)!==ref.byteLength||digestV21(body)!==ref.bodyHash)throw new Error('Retained original hash mismatch.');
  if(!body.length)return;
  const f=this.flow(m);f.rawDeliveryHistory??=[];
  if(f.rawDeliveryHistory.some(row=>row.callId===call.id))return;
  const deliveredAt=now();f.rawDeliveredAt??=deliveredAt;f.rawDeliveryHistory.push({callId:call.id,originalRef:structuredClone(ref),deliveredAt});
  await this.ports.save(m);
  this.ports.emit(p,'research.warning',{userVisible:true,message:ref.completeness==='complete'?'Original text saved and available; scientific completion has not yet been assessed.':'Partial original text saved and available; not a completed proof.'});
 }
 private async invoke(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,branch?:OptionalBranchV21):Promise<OptionalTheoristResultV21>{
  if(call.status==='rejected')throw new RuntimeError('SCIENTIFIC_STEP_REJECTED');
  if(call.status==='denied')throw new RuntimeError('INSUFFICIENT_PERMISSION');
  if(call.status==='completed')return this.transition(m,async()=>{await this.recordRawDelivery(p,m,call);return structuredClone(call.result) as OptionalTheoristResultV21;});
  const spec=this.spec(p,m,call,branch),inv={task:call.task,input:structuredClone(call.input),operation:call.operation,recoveryGeneration:call.recoveryGeneration};
  if(call.status==='pending'||call.status==='uncertain'){
   const recovered=await this.runtime.reconcileV21?.(spec,inv);
   if(recovered?.status==='completed')return this.transition(m,async()=>{if(recovered.systemChangeSkipped)call.systemChangeSkipped=true;call.result=structuredClone(recovered.result);call.status='completed';if(m.snapshot.v3){call.loadedResources=structuredClone(recovered.loadedResources??[]);call.answerDeliveries=structuredClone(recovered.answerDeliveries??[]);}await this.ports.save(m);await this.recordRawDelivery(p,m,call);return recovered.result as OptionalTheoristResultV21;});
   if(recovered&&'captured'in recovered&&recovered.captured)await this.transition(m,async()=>{call.captured=structuredClone(recovered.captured!);await this.ports.save(m);await this.recordRawDelivery(p,m,call);});
   if(recovered?.status==='rejected'&&recovered.captured){await this.transition(m,async()=>{call.status='rejected';call.usage=recovered.captured!.technical.usage;await this.ports.save(m);});throw new RuntimeError('SCIENTIFIC_STEP_REJECTED');}
   if(recovered?.status==='denied'){await this.transition(m,async()=>{call.status='denied';await this.ports.save(m);});throw new RuntimeError('INSUFFICIENT_PERMISSION');}
   if(recovered?.status!=='not-started')throw new Error('Optional paid call is uncertain; no replay.');
  }
  if(this.flow(m).phase==='stopped'||await this.ports.halted(p))throw new Error('Optional dispatch stopped before admission.');
  if(this.theory && !branch)await this.theory.validateGuidance(p,m,call);
  await this.transition(m,async()=>{call.status='pending';await this.ports.save(m);});
  if(await this.ports.halted(p))throw new Error('Optional dispatch stopped before runtime admission.');
  const session=await this.runtime.createSession(spec);this.sessions.set(call.id,session);
  try{
   if(await this.ports.halted(p)){await this.runtime.cancelSession?.(session);throw new Error('Optional session cancelled before invocation.');}
   const result=await this.runtime.invoke(session,inv) as OptionalTheoristResultV21;
   await this.transition(m,async()=>{if(this.runtime.systemChangeSkipped?.(session))call.systemChangeSkipped=true;call.result=structuredClone(result);call.usage=this.runtime.getUsage?.(session);if(m.snapshot.v3){call.loadedResources=structuredClone(this.runtime.loadedResourceRefs?.(session)??[]);call.answerDeliveries=structuredClone(this.runtime.loadedAnswerDeliveries?.(session)??[]);}call.status='completed';await this.ports.save(m);await this.recordRawDelivery(p,m,call);});return result;
  }catch(error){await this.transition(m,async()=>{if(call.status!=='completed'){if(this.runtime.systemChangeSkipped?.(session))call.systemChangeSkipped=true;const captured=this.runtime.retainedV21Original?.(session);if(captured)call.captured=structuredClone(captured);
   call.usage=this.runtime.getUsage?.(session);
   call.status=error instanceof RuntimeError && error.code==='SCIENTIFIC_STEP_REJECTED'&&captured?'rejected':error instanceof RuntimeError && error.code==='INSUFFICIENT_PERMISSION'?'denied':'uncertain';await this.ports.save(m);await this.recordRawDelivery(p,m,call);}});throw error;}
  finally{this.sessions.delete(call.id);await this.runtime.closeSession(session);}
 }
 private operationCall(p:ResearchProjectV21,m:InFlightEpochV21,id:string,task:'v21_theorist'|'v21_optional_worker',input:unknown,branch?:OptionalBranchV21):CallV21 {
  const existing=m.calls.find(c=>c.id===id);if(existing)return existing;
  const discussion=m.snapshot.discussion;
  const history=task==='v21_theorist'&&m.snapshot.contextCompaction&&discussion?.revision==='public-discussion-v2'?prepareDiscussionCall(p,discussion,this.composition):undefined;
  if(history)input={...(input as object),discussion:history.view};
  const operation=createOptionalOperationV21(task,input,{project:p,marker:m,...(branch?{brief:branch.frozen}:{}),root:m.snapshot.root,boundaryId:id},this.flow(m).operationRevision);
  const call:CallV21={...(history?{discussionUpdates:history.updates}:{}),id,task,status:'not-started',input:structuredClone(input),inputHash:digestV21(input),operation:operation.pin,recoveryGeneration:0};m.calls.push(call);return call;
 }
 private async input(p:ResearchProjectV21,m:InFlightEpochV21,id:string):Promise<unknown>{
  const f=this.flow(m),artifacts=[],cards=m.snapshot.v3?artifactCardsV3(f.artifacts,24576,m.snapshot.discussion?f:undefined):undefined;
  const inline=['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(f.operationRevision??'')&&cards?await inlineProofsV3({pendingReviewOnly:!!m.snapshot.discussion,artifacts:f.artifacts,cards:cards.cards,reviewedArtifactIds:f.reviewedArtifactIds,projectId:p.id,root:m.snapshot.root,readOriginal:ref=>this.composition.rawAnswers.read(ref,{readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref})}):undefined;
  if(cards)artifacts.push(...(inline?.cards??cards.cards));else for(const a of f.artifacts){const body=await this.composition.rawAnswers.read(a.originalRef,{readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.originalRef});artifacts.push({...structuredClone(a),body});}
  return {boundaryId:id,...(f.operationRevision==='v4-proof-2'?{publicFragments:boundedPublicFragmentsV4(f.artifacts)}:{}),...(this.theory?{v4Guidance:await this.theory.guidance(p,m)}:{}),...(m.snapshot.capacityPolicy?{capacityPolicy:structuredClone(m.snapshot.capacityPolicy)}:{}),root:structuredClone(m.snapshot.root),rootInterpretationPending:p.rootInterpretationPending===true,decision:m.snapshot.decision,resourceBodies:m.snapshot.v3?boundedResourceBodiesV3(m.snapshot):m.snapshot.resourceBodies??[],...(m.snapshot.v3&&f.v3?{v3:{...presentContextV3(m.snapshot.v3,f.v3.workspace),...(m.snapshot.v3.methodNetwork?{routeInstances:(f.v3.routeInstances??[]).filter(r=>r.branchId==='root').slice(-16),routeInstancesTruncated:(f.v3.routeInstances??[]).length>16}:{}),priorReceiptRefs:f.v3.receipts.slice(-16).map(r=>({id:r.id,artifactRef:r.artifactRef,status:r.status,verification:r.verification,conditionalPremises:r.conditionalPremises,summary:r.summary.slice(0,1200)})),receiptRefsTruncated:f.v3.receipts.length>16}}:{}),sources:m.snapshot.v3?boundedSourcesV3(m.snapshot):m.snapshot.sources,...(m.snapshot.v3?{sourceRefs:m.snapshot.sources.map(s=>({ref:s.ref,bodyHash:s.bodyHash,bodyAvailable:true})),artifactContext:cards?{truncated:cards.truncated,omittedRefs:cards.omittedRefs,omittedCount:cards.omittedCount,maxBytes:cards.maxBytes}:undefined}:{}),phase:f.phase,artifacts,...(inline?{inlineEvidence:{bytes:inline.bytes,maxBytes:inline.maxBytes,omittedRefs:inline.omittedRefs}}:{}),pendingBranches:f.branches.map(({id,kind,state})=>({id,kind,state})),...(m.snapshot.theoryRevision!=='v4-operation-5'&&budgetControlsEnabledV3(m.snapshot.capacityPolicy)?{remainingCalls:Math.max(0,m.snapshot.config.epochBudget.maxTasks-m.calls.length-1)}:{}),notices:f.notices,...(m.snapshot.discussion?{discussion:m.snapshot.discussion}:{refinements:p.refinements})};
 }
 private async accept(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,result:OptionalTheoristResultV21,branch?:OptionalBranchV21):Promise<void>{return this.serial(()=>this.acceptLocked(p,m,call,result,branch));}

 private affectedV3(p:ResearchProjectV21,m:InFlightEpochV21,f:OptionalFlowV21){return affectedOptionalEvidenceV3(this.composition,p,m,f);}
 private async refreshCriticalV3(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const f=this.flow(m),affected=await this.affectedV3(p,m,f);if(!affected.length)return;
  const changed=f.artifacts.some(a=>affected.includes(a.id)&&a.qualification==='valid');
  for(const a of f.artifacts)if(affected.includes(a.id)&&a.qualification==='valid')a.qualification='needs-review';
  if(changed){if(f.selectedArtifactId&&affected.includes(f.selectedArtifactId))delete f.selectedArtifactId;f.evidenceRevision++;f.continuationNeeded=true;f.notices.push('Critical used evidence was revoked or became unavailable. Affected originals remain visible but require a new independent proof or explicit scientific review; unrelated links remain unchanged.');await this.ports.save(m);}
  await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},affected);
 }
 private async flushEffects(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const f=this.flow(m);
  if(f.conflictArtifactIds.length)await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},f.conflictArtifactIds);
  for(const effect of f.pendingEffects??[]){
   if(effect.status==='saved')continue;
   if(effect.withdrawnIds.length)await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},effect.withdrawnIds);
   if(effect.restoredIds.length&&!f.conflictArtifactIds.length){
    const restored=f.artifacts.filter(a=>effect.restoredIds.includes(a.id)&&a.qualification==='valid');
    if(restored.length)await this.composition.restoreOptionalProofs?.({...p,activeEpoch:m},restored,{callId:effect.callId,evidenceRevision:effect.evidenceRevision});
   }
   effect.status='saved';await this.ports.save(m);
  }
 }
 private async acceptLocked(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,result:OptionalTheoristResultV21,branch?:OptionalBranchV21):Promise<void>{
  const f=this.flow(m),id=`artifact_${call.id}`,existing=f.artifacts.find(a=>a.id===id);
  // Only a committed acceptance receipt is idempotent. Retained unreviewed bytes
  // must not suppress validation after interrupted or failed acceptance.
  if(existing?.acceptanceCommitted){await this.flushEffects(p,m);return;}
  if(!result?.originalRef||!result.control||!result.technical)throw new Error('Optional runtime returned no immutable result.');
  if(this.theory && !branch) {
    const prefix='method:theory-use/';
    const used=(result.control.outcome.tags??[]).filter(tag=>tag.startsWith(prefix)).map(tag=>tag.slice(prefix.length));
    await this.theory.validateGuidance(p,m,call,used);
  }
  const ref=result.originalRef;
  if(ref.projectId!==p.id||ref.owner!==p.id||ref.hypothesisId!==m.snapshot.root.hypothesisId||ref.hypothesisRevision!==m.snapshot.root.revision||ref.callId!==call.id||ref.inputHash!==call.operation?.inputHash)throw new Error('Optional result identity mismatch.');
  const body=await this.composition.rawAnswers.read(ref,{readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref});
  if(Buffer.byteLength(body)!==ref.byteLength||digestV21(body)!==ref.bodyHash)throw new Error('Optional original bytes mismatch.');
  const operation=createOptionalOperationV21(call.task as 'v21_theorist'|'v21_optional_worker',call.input,{project:p,marker:m,...(branch?{brief:branch.frozen}:{}),root:m.snapshot.root,boundaryId:call.id},this.flow(m).operationRevision);
  if(!isDeepStrictEqual(operation.pin,call.operation))throw new Error('Optional acceptance pin mismatch.');
  if(m.snapshot.v3?.catalogPin){
    const materials=result.v3Execution?.catalogMaterials??[];
    if(materials.length){
      const validate=this.composition.validateCatalogMaterialsV3;
      if(!validate)throw new Error('Pinned material validator unavailable.');
      if(m.snapshot.modelDirectedKnowledge&&result.v3Execution){
        // Preserve the journal of past reads. Carry only still-available material into subsequent work.
        const retained:typeof materials=[],withdrawn=new Set<string>();
        for(const material of materials){
          try{await validate({...p,activeEpoch:m},[material]);retained.push(material);}
          catch(error){if((error as {code?:string}).code!=='STALE_SOURCE')throw error;withdrawn.add(material.node.id);}
        }
        result.v3Execution.catalogMaterials=retained;
        result.v3Execution.knowledgeReads=result.v3Execution.knowledgeReads?.filter(id=>!withdrawn.has(id));
      }else await validate({...p,activeEpoch:m},materials);
    }
    const known=new Set([...(branch?.frozen.v3?.catalogNodeIds??m.snapshot.v3.catalogNodeIds??[]),...materials.map(item=>item.node.id)]);
    const used=[...new Set([result.control.outcome,...result.control.adoptions.map(a=>a.outcome)].flatMap(o=>o.knowledgeRefs??[]).filter(id=>known.has(id)))];
    if(used.length){if(!this.composition.validateCatalogKnowledgeV3)throw new Error('Pinned knowledge validator unavailable.');await this.composition.validateCatalogKnowledgeV3({...p,activeEpoch:m},used);}
    for(const ref of [...result.control.route.resourceRefs,...result.control.workers.flatMap(w=>w.route.resourceRefs)]){if(!this.composition.readResource)throw new Error('Pinned resource reader unavailable.');await this.composition.readResource(ref,{...p,activeEpoch:m});}
  }
  // Read receipts are host evidence, never caller-authored permission or proof status.
  const mapEnabled=(branch?.frozen.knowledgeMapRevision??m.snapshot.knowledgeMapRevision)==='dual-cluster-map-v1';
  delete result.mapKnowledge;
  if(mapEnabled){
    const refs=[...new Set((result.control.outcome.knowledgeRefs??[]).filter(ref=>/^(map_|source_)/.test(ref)))];
    if(refs.length){
      if(!this.composition.validateMapKnowledgeV4)throw new Error('Map reference validator unavailable.');
      result.mapKnowledge=await this.composition.validateMapKnowledgeV4(this.spec(p,m,call,branch),call,refs);
      operation.observeEvidence({mapKnowledge:result.mapKnowledge});
    }
    for(const adoption of result.control.adoptions){
      // Rejecting or deferring an unchanged original must remain possible after
      // its argument is withdrawn. Its immutable reference list is checked below.
      if(m.snapshot.modelDirectedKnowledge&&adoption.status!=='valid')continue;
      const refs=[...new Set((adoption.outcome.knowledgeRefs??[]).filter(ref=>/^(map_|source_)/.test(ref)))];
      if(!refs.length)continue;
      const target=f.artifacts.find(a=>a.id===adoption.artifactId),sourceCall=target&&m.calls.find(c=>c.id===target.originalRef.callId);
      if(!sourceCall||!this.composition.validateMapKnowledgeV4)throw new Error('Adopted map evidence has no owned source call.');
      const sourceBranch=f.branches.find(b=>b.callId===sourceCall.id);
      const validated=await this.composition.validateMapKnowledgeV4(this.spec(p,m,sourceCall,sourceBranch),sourceCall,refs);
      for(const saved of target!.mapKnowledge??[])if(saved.kind==='observation'&&refs.includes(saved.selection)&&!validated.some(read=>read.selection===saved.selection&&sameObservationEvidence(saved,read)))throw new Error('Adoption requires the observed record and exact review originally cited.');
      for(const saved of target!.mapKnowledge??[])if(saved.basis&&refs.includes(saved.selection)&&!validated.some(r=>r.selection===saved.selection&&isDeepStrictEqual(r.basis,saved.basis)))throw new Error('Adoption requires the exact argument originally cited.');
    }
  }
  if(result.v3Execution)operation.observeEvidence({deliveries:call.answerDeliveries??[],receipts:result.v3Execution.receipts,...(m.snapshot.v3?.catalogPin?{catalogMaterials:result.v3Execution.catalogMaterials??[],knowledgeReads:result.v3Execution.knowledgeReads??[]}:{}),...(call.loadedResources?.length?{resources:call.loadedResources}:{})});
  operation.observeEvidence({publicBody:body});
  const writeSelections=result.control.mapChanges?mapWriteSelections(result.control.mapChanges):[];
  const mapWriteReads=writeSelections.length?await this.composition.validateMapKnowledgeV4?.(this.spec(p,m,call,branch),call,writeSelections,true):undefined;
  if(mapWriteReads?.length)operation.observeEvidence({mapWriteReads});
  operation.validatePrepared(result.control);
  const exposure=(call.input as {artifacts?:OptionalProofArtifactV21[]}).artifacts?.map(a=>a.id)??[];
  const raw:OptionalProofArtifactV21={...structuredClone(result),operationRevision:this.flow(m).operationRevision,id,authorRole:branch?.kind??'theorist',root:structuredClone(m.snapshot.root),route:structuredClone(result.control.route),exposureArtifactIds:exposure,qualification:'unreviewed',createdAt:existing?.createdAt??now()};
  delete raw.mapWriteReads;
  if(mapWriteReads?.length)raw.mapWriteReads=mapWriteReads;
  delete raw.v4TheorySupport;
  if(m.snapshot.resultContract)raw.resultContract=m.snapshot.resultContract;else delete raw.resultContract;
  if(this.theory&&m.snapshot.theoryRevision==='v4-operation-5'&&!m.snapshot.knowledgeMapPresentation&&!branch){
    const offered=(call.input as {v4Guidance?:{publishedTheories?:{id:string}[]}}).v4Guidance?.publishedTheories??[];
    if(offered.length)raw.v4TheorySupport=await this.theory.applicationSupport(p,m,offered.map(c=>c.id));
  }
  if(this.theory&&!branch&&['v4-proof-2','v4-proof-3','v4-proof-4'].includes(raw.operationRevision??'')){
    const used=(result.control.outcome.tags??[]).filter(tag=>tag.startsWith('method:theory-use/')).map(tag=>tag.slice('method:theory-use/'.length));
    if(used.length)raw.v4TheorySupport=await this.theory.applicationSupport(p,m,used);
  }
  // Raw bytes already belong to the durable call receipt, not a scientific artifact.
  // All scientific mutations, including interpretation and reviewed IDs, remain
  // private until every adoption and the own result have passed validation.
  const candidate=structuredClone(f),root=result.control.rootInterpretation?interpretedRootV21(m.snapshot.root,result.control.rootInterpretation):structuredClone(m.snapshot.root);
  if(result.control.rootInterpretation&&(branch||p.rootInterpretationPending!==true||f.artifacts.some(a=>a.id!==id)))throw new Error('Root interpretation outside initial boundary.');
  if(candidate.v3&&m.snapshot.v3){if(!result.v3Execution)throw new Error('V3 runtime omitted durable execution evidence.');candidate.v3=acceptExecutionV3(candidate.v3,result.v3Execution,{callId:call.id,projectId:p.id,rootVersion:root.revision,knowledgeVersion:m.snapshot.v3.knowledge.version,branchId:branch?.frozen.question.id??'root',sourceVersion:stableHash(branch?.frozen.sources??m.snapshot.sources),...(!branch&&m.snapshot.v3.methodNetwork?{methodNetworkPin:m.snapshot.v3.methodNetwork.pin}:{}),...(m.snapshot.v3.catalogPin?{catalogPin:m.snapshot.v3.catalogPin,catalogNodeIds:branch?.frozen.v3?.catalogNodeIds??m.snapshot.v3.catalogNodeIds??[]}:{} )});candidate.v3.workspace=addRootWorkspaceV3(candidate.v3.workspace,root);}
  const a:OptionalProofArtifactV21={...raw,root:structuredClone(root)};if(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(f.operationRevision??''))a.fragmentExposureRefs=((call.input as {publicFragments?:PublicFragmentV4[]}).publicFragments??[]).map(f=>f.stageId);if(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(f.operationRevision??'')){a.originalExposureRefs=fullOriginalRefsV3(call.answerDeliveries??[],f.artifacts);a.continuationArtifactIds=classifyContinuationsV3(a,f.artifacts);}
  const candidateIndex=candidate.artifacts.findIndex(x=>x.id===id);if(candidateIndex<0)candidate.artifacts.push(a);else candidate.artifacts[candidateIndex]=a;
  const restored:OptionalProofArtifactV21[]=[],withdrawn:string[]=[];candidate.evidenceRevision++;
  if(branch){const staged=candidate.branches.find(b=>b.id===branch.id)!;staged.artifactId=id;staged.state='completed';}
  else{
   for(const adoption of result.control.adoptions){
    const target=candidate.artifacts.find(x=>x.id===adoption.artifactId);if(!target||!exposure.includes(target.id)||target.authorRole==='theorist'&&target.qualification!=='needs-review')throw new Error('Adoption requires a delivered Worker original or explicit re-review of an affected Theorist original.');
    if(adoption.outcome.resultKind!==target.control.outcome.resultKind||adoption.outcome.scope!==target.control.outcome.scope||adoption.outcome.refutationKind!==target.control.outcome.refutationKind)throw new Error('Adoption cannot relabel a local/unknown/opposite result as a root proof.');
    for(const field of ['knowledgeRefs','sourceRefs'] as const)if(!isDeepStrictEqual([...(adoption.outcome[field]??[])].sort(),[...(target.control.outcome[field]??[])].sort()))throw new Error('Adoption cannot rewrite actual source dependencies.');
    if(!isDeepStrictEqual([...(adoption.outcome.receiptRefs??[])].sort(),[...(target.control.outcome.receiptRefs??[])].sort()))throw new Error('Adoption cannot rewrite actual computational dependencies.');
    if(!isDeepStrictEqual([...adoption.outcome.dependencyArtifactIds].sort(),[...target.control.outcome.dependencyArtifactIds].sort()))throw new Error('Adoption cannot erase or replace original dependencies; write a new Theorist bridge.');
    if(target.qualification==='needs-review'&&adoption.status==='valid')restored.push(target);if(['valid','needs-review'].includes(target.qualification)&&adoption.status==='rejected')withdrawn.push(target.id);
    target.judgment={callId:call.id,evidenceRevision:candidate.evidenceRevision};target.scientificFailure=adoption.scientificFailure;target.qualification=adoption.status;target.adoptionReason=adoption.reason;target.acceptedOutcome=structuredClone(adoption.outcome);
    if(!candidate.reviewedArtifactIds.includes(target.id))candidate.reviewedArtifactIds.push(target.id);
   }
   if(result.control.outcome.resultKind!=='open'){
    a.qualification='valid';a.acceptedOutcome=structuredClone(result.control.outcome);a.adoptionReason='Theorist same-response original and reported scientific scope; not host mathematical verification.';
   }
   // Validate against the entire staged batch, never a partially published batch.
   for(const adoption of result.control.adoptions)if(adoption.status==='valid'){
    const target=candidate.artifacts.find(x=>x.id===adoption.artifactId)!;
    validateOptionalArtifactV21(root,target,candidate.artifacts,target.acceptedOutcome?.scope==='root');
   }
   if(a.qualification==='valid')validateOptionalArtifactV21(root,a,candidate.artifacts,a.acceptedOutcome?.scope==='root');
   candidate.continuationNeeded=result.control.action==='dispatch'||result.control.action==='continue';
  }
  a.acceptanceCommitted=true;
  if(m.snapshot.theoryRevision==='v4-operation-5'&&!branch&&['complete','pause'].includes(a.control.action)&&a.technical.executionStatus==='completed'&&body.trim())a.publicReport={...reportOutline(body),body,bodyHash:stableHash(body),pendingBranches:candidate.branches.filter(b=>!['completed','cancelled'].includes(b.state)).map(({id,state})=>({id,state}))};
  const critical=await this.affectedV3(p,m,candidate);for(const artifact of candidate.artifacts)if(critical.includes(artifact.id)&&artifact.qualification==='valid')artifact.qualification='needs-review';
  if(critical.length){if(candidate.selectedArtifactId&&critical.includes(candidate.selectedArtifactId))delete candidate.selectedArtifactId;candidate.continuationNeeded=true;candidate.notices.push('Actually used evidence was revoked; affected originals retained for review, not global proof qualification.');}
  candidate.conflictArtifactIds=optionalConflictsV21(root,candidate.artifacts);
  if(candidate.conflictArtifactIds.length)for(const artifact of candidate.artifacts)if(candidate.conflictArtifactIds.includes(artifact.id)&&artifact.qualification==='valid')artifact.qualification='needs-review';
  if(withdrawn.length||restored.length){candidate.pendingEffects??=[];candidate.pendingEffects.push({callId:call.id,withdrawnIds:withdrawn,restoredIds:restored.map(a=>a.id),evidenceRevision:candidate.evidenceRevision,status:'pending'});}
  if(m.snapshot.v3)await this.ports.save({...structuredClone(m),optionalFlow:structuredClone(candidate),snapshot:{...structuredClone(m.snapshot),root:structuredClone(root)},sealed:true});
  // Synchronous commit preserves the live flow identity held by the scheduler.
  // Running closures hold branch references; preserve their identities across the batch.
  for(const staged of candidate.branches){const live=f.branches.find(b=>b.id===staged.id);if(live)Object.assign(live,staged);}
  candidate.branches=f.branches;Object.assign(f,candidate);m.snapshot.root=root;m.sealed=true;
  if(result.control.rootInterpretation){p.root=structuredClone(root);p.rootInterpretationPending=false;}
  if(!branch&&m.planningSelection)finishPlanningInputs(p,m.planningSelection,p.hypothesisRevision);
  if(branch){const committed=f.branches.find(b=>b.id===branch.id)!;Object.assign(branch,committed);}
  if(!m.snapshot.v3)await this.ports.save(m);
  // External effects have independent idempotent receipts; no claim of cross-store atomicity.
  if(f.conflictArtifactIds.length){await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},f.conflictArtifactIds);this.ports.emit(p,'research.warning',{message:'Opposite claims for the same root require scientific review. Original text is retained; scientific and learning eligibility are suspended.'});}
  if(critical.length)await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},critical);
  await this.flushEffects(p,m);
  if(!branch)try{await this.theory?.report(p,m,a);}catch{this.ports.emit(p,'research.warning',{userVisible:true,message:'Post-report research registration deferred; the durable public report remains available for reconciliation.'});}
  else if(m.snapshot.theoryRevision==='v4-operation-5'&&f.artifacts.some(x=>x.publicReport)){
    try{await this.theory?.supplement(p,m,a);}catch{this.ports.emit(p,'research.warning',{userVisible:true,message:'Late branch supplement registration deferred; the original result remains saved.'});}
    const notice='Late branch result awaits scientific review: '+a.id;if(!f.notices.includes(notice)){f.notices.push(notice);await this.ports.save(m);this.ports.emit(p,'research.warning',{userVisible:true,message:notice});}
  }
 }
 private freeze(p:ResearchProjectV21,m:InFlightEpochV21,r:OptionalWorkerRequestV21,index:number):OptionalBranchV21 {
  const id=`${m.snapshot.id}_optional_worker_${index}`,qId=`${id}_question`,wayId=`${id}_way`;
  const way={id:wayId,revision:'1',methodKey:r.route.methodKey,routeTarget:'original-root' as const,direction:r.route.description,purpose:r.reason,conditions:structuredClone(m.snapshot.root.conditions),questionIds:[qId],rootObligationIds:r.kind==='way-worker'?m.snapshot.root.obligations.map(o=>o.id):[],obstacles:[],utilityStatus:'active' as const,resourceRefs:r.route.resourceRefs};
  const question={id:qId,revision:'1',wayId,order:0,question:r.question,known:[],unknown:[],constraints:[],definitions:[],conditions:structuredClone(m.snapshot.root.conditions),symbols:r.symbols,sourceIds:m.snapshot.sources.map(s=>s.ref.id),expectedArtifact:r.kind==='way-worker'?'Complete independent proof or valid refutation of the exact original root.':'Exact local auxiliary result; explain assumptions and remaining gaps in the original text.',checks:r.checks,purpose:r.reason,rootObligationIds:r.kind==='way-worker'?m.snapshot.root.obligations.map(o=>o.id):[],dependencyQuestionIds:[],conditionalInterfaces:[],interfaceUses:[],adoptedAnswerIds:[],allocation:'dispatch' as const,effort:r.effort,reason:r.reason};
  const dynamic=this.flow(m).v3?.catalogMaterials??[],allBodies=[...(m.snapshot.resourceBodies??[]),...dynamic.flatMap(item=>item.meta&&item.body!==undefined?[{ref:{id:item.meta.id,version:item.meta.version},body:item.body,bodyHash:digestV21(item.body)}]:[])];
  const bodyMap=new Map<string,NonNullable<FrozenQuestionV21['resourceBodies']>[number]>();for(const body of allBodies){const key=`${body.ref.id}:${body.ref.version}`,old=bodyMap.get(key);if(m.snapshot.v3?.catalogPin&&old&&!isDeepStrictEqual(old,body))throw new Error('Conflicting scoped original body.');bodyMap.set(key,body);}
  const resourceBodies=(m.snapshot.v3?.catalogPin?[...bodyMap.values()]:(m.snapshot.resourceBodies??[])).filter(x=>r.route.resourceRefs.some(ref=>isDeepStrictEqual(ref,x.ref)));
  if(resourceBodies.length!==r.route.resourceRefs.length)throw new Error('Worker resource was not exactly frozen and delivered.');
  let scopedV3=m.snapshot.v3?branchContextV3(m.snapshot.v3,this.flow(m).v3?.workspace??m.snapshot.v3.workspace,qId):undefined;
  if(scopedV3?.catalogPin){
    const all=[...scopedV3.knowledge.nodes,...dynamic.map(item=>item.node)],catalogIds=new Set([...(scopedV3.catalogNodeIds??[]),...dynamic.map(item=>item.node.id)]),unique=new Map<string,import('../v3/knowledge.js').KnowledgeNodeV3>();
    for(const node of all){const old=unique.get(node.id);if(old&&!isDeepStrictEqual(old,node))throw new Error('Conflicting scoped catalog node identity.');unique.set(node.id,node);}
    for(const material of dynamic)if(material.meta&&r.route.resourceRefs.some(ref=>ref.id===material.meta!.id&&ref.version===material.meta!.version)){const canonical=resourceNodeV3(material.meta),old=unique.get(canonical.id);if(old&&!isDeepStrictEqual(old,canonical))throw new Error('Conflicting scoped authority identity.');unique.set(canonical.id,canonical);catalogIds.add(canonical.id);}
    const grantedOrigins=new Set(r.route.resourceRefs.map(ref=>`resource:${ref.id}:${ref.version}`)),derivedOrigins=new Map<string,Set<string>>();
    if(m.snapshot.v3?.methodNetwork)for(const edge of scopedV3.knowledge.edges)if(['requires','derivedfrom'].includes(edge.relation)&&edge.sourceRef.startsWith('resource:')){let origins=derivedOrigins.get(edge.to);if(!origins)derivedOrigins.set(edge.to,origins=new Set());origins.add(edge.sourceRef);}
    const nodes=[...unique.values()].filter(node=>{
      if(node.authorityRef)return r.route.resourceRefs.some(ref=>isDeepStrictEqual(ref,node.authorityRef)&&node.id===`resource:${ref.id}:${ref.version}`);
      if(catalogIds.has(node.id))return false;
      if(m.snapshot.v3?.methodNetwork){const origins=[...(derivedOrigins.get(node.id)??[]),...(node.sourceRef.startsWith('resource:')?[node.sourceRef]:[])];if(origins.length&&!origins.some(origin=>grantedOrigins.has(origin)))return false;}
      return true;
    }),ids=new Set(nodes.map(node=>node.id));
    scopedV3.knowledge=freezeKnowledgeV3(nodes,scopedV3.knowledge.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)),scopedV3.knowledge.version,scopedV3.knowledge.retrievalRevision);
    scopedV3.catalogNodeIds=[...catalogIds].filter(id=>ids.has(id));scopedV3.retrieval={...scopedV3.retrieval,snapshotHash:scopedV3.knowledge.hash,candidates:scopedV3.retrieval.candidates.filter(node=>ids.has(node.id)),edges:scopedV3.retrieval.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)),backlinks:scopedV3.retrieval.backlinks.filter(edge=>ids.has(edge.nodeId)&&ids.has(edge.from))};
  }
  const base={...(m.snapshot.contextCompaction?{contextCompaction:m.snapshot.contextCompaction}:{}),...(m.snapshot.mapGapPolicy?{mapGapPolicy:m.snapshot.mapGapPolicy}:{}),...(m.snapshot.resultContract?{resultContract:m.snapshot.resultContract,inquiryGuidance:m.snapshot.inquiryGuidance}:{}),...(m.snapshot.modelDirectedKnowledge?{modelDirectedKnowledge:true as const}:{}),...(m.snapshot.nativeHandoff?{nativeHandoff:m.snapshot.nativeHandoff}:{}),...(m.snapshot.knowledgeMapPresentation?{knowledgeMapPresentation:m.snapshot.knowledgeMapPresentation}:{}),...(m.snapshot.knowledgeMapRevision?{knowledgeMapRevision:m.snapshot.knowledgeMapRevision}:{}),...(m.snapshot.knowledgeNetworkRevision?{knowledgeNetworkRevision:m.snapshot.knowledgeNetworkRevision}:{}),...(m.snapshot.theoryRevision?{theoryRevision:m.snapshot.theoryRevision}:{}),...(scopedV3?{v3:scopedV3}:{}),operationRevision:this.flow(m).operationRevision,solverRole:r.kind,projectId:p.id,epochId:m.snapshot.id,attemptId:`${id}_attempt`,callId:id,root:structuredClone(m.snapshot.root),way,question,inputRevision:m.snapshot.inputRevision,brief:JSON.stringify({root:m.snapshot.root,question,sources:m.snapshot.sources,resourceBodies,role:r.kind}),sources:structuredClone(m.snapshot.sources),premises:[],grants:[],conditionalInterfaces:[],interfaceUses:[],adoptedAnswerIds:[],resources:r.route.resourceRefs,resourceBodies,strategy:r.route.reason,decision:JSON.stringify(m.snapshot.decision),model:m.snapshot.modelConfig.roleModels?.worker??m.snapshot.modelConfig.defaultModel,effort:r.effort,budget:structuredClone(foregroundBudgetV4(m.snapshot,m.snapshot.config.workerBudgets[r.effort])),scientificInputHash:digestV21({root:m.snapshot.root,question,resourceBodies,sources:m.snapshot.sources})};
  const frozen:FrozenQuestionV21={...base,inputHash:digestV21(base)};
  return {id,kind:r.kind,callId:id,frozen,state:'ready'};
 }
 private async dispatchRequests(p:ResearchProjectV21,m:InFlightEpochV21,result:OptionalTheoristResultV21):Promise<number>{
  let count=0;const f=this.flow(m);for(const request of result.control.workers){
   if(await this.ports.halted(p))return count;
   const admitted=await this.transition(m,async()=>{const active=f.branches.filter(b=>['ready','running'].includes(b.state)).length;
   if(!this.store.commitGuardedCheckpoint||active>=Math.max(0,m.snapshot.config.maxWorkers-1)||!this.canAdmit(m,2)||request.kind==='way-worker'&&f.branches.some(b=>b.kind==='way-worker')){f.notices.push(`Not dispatched ${request.route.methodKey}: guarded delivery, reserved Theorist/review capacity or frozen admission budget unavailable.`);await this.ports.save(m);return undefined;}
   if(request.kind==='way-worker'&&(!result.control.nearTieReason||result.control.outcome.resultKind!=='open'))throw new Error('Alternative route must be early, explicitly near-tied, before a complete main proof.');
   const branch=this.freeze(p,m,request,f.branches.length+1);if(m.snapshot.knowledgeMapRevision){branch.frozen.knowledgeMapParentSessionId=result.originalRef.callId+'_session';const {inputHash:_oldHash,...bound}=branch.frozen;branch.frozen.inputHash=digestV21(bound);}f.branches.push(branch);
   this.operationCall(p,m,branch.callId,'v21_optional_worker',{...structuredClone(branch.frozen),boundaryId:branch.callId},branch);await this.ports.save(m);return branch;});if(admitted){count++;this.launch(p,m,admitted);}
  }return count;
 }
 private launch(p:ResearchProjectV21,m:InFlightEpochV21,b:OptionalBranchV21):void{
  if(this.running.has(b.id)||['completed','cancelled'].includes(b.state))return;
  const promise=(async()=>{try{await this.transition(m,async()=>{if(b.state!=='uncertain')b.state='running';await this.ports.save(m);});const call=m.calls.find(c=>c.id===b.callId)!;const result=await this.invoke(p,m,call,b);await this.accept(p,m,call,result,b);}catch(error){await this.transition(m,async()=>{const call=m.calls.find(c=>c.id===b.callId);b.state=call?.captured?'completed':'uncertain';if(!call?.captured)this.errors.push(error);await this.ports.save(m);});}finally{this.running.delete(b.id);}})();
  this.running.set(b.id,promise);
 }
 private dependencies(a:OptionalProofArtifactV21,all:OptionalProofArtifactV21[]):OptionalProofArtifactV21[]{const found=new Map<string,OptionalProofArtifactV21>();const visit=(x:OptionalProofArtifactV21)=>{for(const dep of ['v4-proof-2','v4-proof-3','v4-proof-4'].includes(x.operationRevision??'')?fragmentSupportV4(x,all):[]){if(!found.has(dep.id)){found.set(dep.id,dep);visit(dep);}}for(const id of (x.acceptedOutcome??(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(x.operationRevision??'')?x.control.outcome:undefined))?.dependencyArtifactIds??[]){if(found.has(id))continue;const dep=all.find(v=>v.id===id);if(!dep)throw new Error('Missing archive dependency.');found.set(id,dep);visit(dep);}};visit(a);return [...found.values()].map(x=>structuredClone(x));}
 private async collectCompleted(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  // A terminal runtime receipt can arrive while archive/checkpoint I/O is awaited.
  // Consume it under the science lock before a delivery event or learning grant.
  for(const branch of this.flow(m).branches){const call=m.calls.find(c=>c.id===branch.callId);if(call?.status==='completed'&&!this.flow(m).artifacts.some(a=>a.id===`artifact_${call.id}`&&a.acceptanceCommitted))await this.acceptLocked(p,m,call,call.result as OptionalTheoristResultV21,branch);}
 }
 private savedReceipt(a:OptionalProofArtifactV21,f:OptionalFlowV21){return f.archives.findLast(r=>r.artifactId===a.id&&r.status==='saved'&&isDeepStrictEqual(r.selection.artifact.acceptedOutcome,a.acceptedOutcome)&&r.selection.artifact.adoptionReason===a.adoptionReason&&isDeepStrictEqual(r.selection.artifact.judgment,a.judgment));}
 private async publish(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{return this.serial(()=>this.publishLocked(p,m));}
 private async publishLocked(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const f=this.flow(m);await this.collectCompleted(p,m);await this.refreshCriticalV3(p,m);await this.flushEffects(p,m);if(f.conflictArtifactIds.length||await this.ports.halted(p))return;
  for(const a of f.artifacts.filter(a=>a.qualification==='valid'&&a.acceptedOutcome?.scope==='root'&&a.authorRole!=='auxiliary-worker')){
   await this.refreshCriticalV3(p,m);if(a.qualification!=='valid')continue;
   validateOptionalArtifactV21(m.snapshot.root,a,f.artifacts);let receipt=f.archives.find(r=>r.artifactId===a.id&&isDeepStrictEqual(r.selection.artifact.acceptedOutcome,a.acceptedOutcome)&&r.selection.artifact.adoptionReason===a.adoptionReason&&isDeepStrictEqual(r.selection.artifact.judgment,a.judgment));
   if(!receipt){const selection:OptionalProofSelectionV21={...(m.snapshot.resultContract?{resultContract:m.snapshot.resultContract}:{}),...(m.snapshot.modelDirectedKnowledge?{modelDirectedKnowledge:true as const}:{}),...(p.researchLoopVersion==='4.0'?{sourceLoopVersion:p.researchLoopVersion}:{}),operationId:`${m.snapshot.id}_archive_${a.id}_${digestV21([a.acceptedOutcome,a.adoptionReason,a.judgment]).slice(0,12)}`,projectId:p.id,epochId:m.snapshot.id,caseGroupId:digestV21({text:m.snapshot.root.originalText,conditions:m.snapshot.root.conditions,symbols:m.snapshot.root.symbols,strength:m.snapshot.root.strength,sources:m.snapshot.sources.map(s=>s.bodyHash)}),evidenceRevision:f.evidenceRevision,root:structuredClone(m.snapshot.root),artifact:structuredClone(a),dependencies:this.dependencies(a,f.artifacts)};receipt={operationId:selection.operationId,artifactId:a.id,selectionHash:stableHash(selection),selection,status:'pending'};f.archives.push(receipt);await this.ports.save(m);}
   if(receipt.status!=='saved'){
    if(!this.composition.archiveOptionalProof)throw new Error('Optional proof archive adapter unavailable.');
    const saved=await this.composition.archiveOptionalProof(structuredClone(receipt.selection));
    if(saved.status!=='saved'||!saved.proofRef||saved.operationId!==receipt.operationId||saved.selectionHash!==receipt.selectionHash||!isDeepStrictEqual(saved.selection,receipt.selection))throw new Error('Optional archive receipt mismatch.');
    Object.assign(receipt,saved);await this.ports.save(m);
   }
  }
  // A Worker may have returned during an awaited archive write. Never deliver a stale winner.
  await this.collectCompleted(p,m);await this.refreshCriticalV3(p,m);f.conflictArtifactIds=optionalConflictsV21(m.snapshot.root,f.artifacts);
  if(f.conflictArtifactIds.length){await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},f.conflictArtifactIds);return;}
  const candidates=f.artifacts.filter(a=>a.qualification==='valid'&&a.acceptedOutcome?.scope==='root'&&a.authorRole!=='auxiliary-worker'&&this.savedReceipt(a,f));
  const selected=candidates.find(a=>a.authorRole==='theorist')??candidates[0];
  if(!selected)return;
  const receipt=this.savedReceipt(selected,f)!;
  const pending='V4 theory publication deferred for '+selected.id;
  const delivered=f.selectedArtifactId===selected.id&&isDeepStrictEqual(f.deliveryHistory.at(-1)?.proofRef,receipt.proofRef);
  if(!delivered){
    if(this.theory && selected.control.outcome.tags?.some(tag=>tag.startsWith('method:theory-use/')) && !f.notices.includes(pending))f.notices.push(pending);
    f.selectedArtifactId=selected.id;f.foregroundCompletedAt??=now();
    f.deliveryHistory.push({artifactId:selected.id,proofRef:receipt.proofRef!,deliveredAt:now()});
    await this.ports.save(m);await this.checkpoint(p,m,false);
    if(f.conflictArtifactIds.length||f.artifacts.find(a=>a.id===f.selectedArtifactId)?.qualification!=='valid'||await this.ports.halted(p))return;
    this.ports.emit(p,'checkpoint.committed',{userVisible:true,message:'Qualified original proof archived. Already admitted alternative work is still retained.'});
  }
  if(this.theory && receipt.proofRef && !await this.ports.halted(p)){
    if(f.notices.includes(pending)){
      try {
        await this.theory.publish(p,m,selected,receipt.proofRef);
        f.notices=f.notices.filter(n=>n!==pending);
      } catch {
        this.ports.emit(p,'research.warning',{userVisible:true,message:pending+'; the archived proof remains available.'});
      }
    }
  }
 }
 private terminalWatermark(m:InFlightEpochV21):string{return digestV21(m.calls.filter(c=>c.task==='v21_optional_worker').map(c=>({id:c.id,status:c.status,result:c.status==='completed'?c.result:undefined,captured:c.captured})));}
 private async checkpoint(p:ResearchProjectV21,m:InFlightEpochV21,terminal:boolean):Promise<void>{
  const f=this.flow(m);await this.collectCompleted(p,m);await this.refreshCriticalV3(p,m);const watermark=f.evidenceRevision,terminalWatermark=this.terminalWatermark(m),halted=await this.ports.halted(p),selected=f.artifacts.find(a=>a.id===f.selectedArtifactId),qualified=selected?.qualification==='valid'&&selected.acceptedOutcome?.scope==='root'&&!!this.savedReceipt(selected,f)&&!f.conflictArtifactIds.length;
  const {schemaVersion:_schema,loop:_loop,...record}=structuredClone(m);
  const decision=halted&&this.ports.stopped(p)?'stop':halted?'pause':qualified?'complete':'pause';
  const epoch:EpochRecordV21={...record,id:m.snapshot.id,completedAt:now(),...(f.foregroundCompletedAt?{foregroundCompletedAt:f.foregroundCompletedAt}:{}),decision,reason:f.conflictArtifactIds.length?'Same-root contradictory claims await review.':qualified?'Qualified exact original archived.':halted?'STOP preserved admitted originals.':'Bounded optional research remains open.'};
  const index=p.epochs.findIndex(e=>e.id===epoch.id);if(index<0)p.epochs.push(epoch);else p.epochs[index]=epoch;
  p.epoch=m.epoch;p.status=halted?(this.ports.stopped(p)?'stopped':'paused'):qualified?'completed':'paused';p.phase=terminal?'idle':'executing';p.summary=f.conflictArtifactIds.length?'Previously delivered proof requires review: opposite same-root claim received.':qualified?`${selected!.authorRole==='theorist'?'Theorist':'Worker'} original: ${selected!.acceptedOutcome!.reason}`:epoch.reason;
  const saved=this.store.commitGuardedCheckpoint?await this.store.commitGuardedCheckpoint(p,()=>this.terminalWatermark(m)===terminalWatermark&&(terminal||halted||!this.cancelled&&!this.ports.stopped(p))):await this.store.commitCheckpoint(p);
  if(!saved){await this.collectCompleted(p,m);await this.checkpoint(p,m,terminal);return;}Object.assign(p,saved);
  await this.collectCompleted(p,m);if(f.evidenceRevision!==watermark){await this.checkpoint(p,m,terminal);return;}
  if(!halted&&!f.conflictArtifactIds.length)await this.ports.registerLearning(p,epoch);
 }
 async collectStopped(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const f=this.flow(m);if(f.phase!=='stopped')throw new Error('Persistence-only reconciliation requires a stopped boundary.');
  await this.composition.stopOptionalLearning?.(p);
  for(const call of m.calls.filter(c=>c.status==='pending'||c.status==='uncertain')){
   const branch=f.branches.find(b=>b.callId===call.id),spec=this.spec(p,m,call,branch);
   const recovered=await this.runtime.reconcileV21?.(spec,{task:call.task,input:structuredClone(call.input),operation:call.operation,recoveryGeneration:call.recoveryGeneration});
   if(recovered?.status==='completed'){if(recovered.systemChangeSkipped)call.systemChangeSkipped=true;call.result=structuredClone(recovered.result);call.status='completed';const result=recovered.result as OptionalTheoristResultV21;if(result.originalRef&&result.technical)call.captured={originalRef:structuredClone(result.originalRef),technical:structuredClone(result.technical)};}
   else if(recovered&&'captured'in recovered&&recovered.captured)call.captured=structuredClone(recovered.captured);
   if(recovered?.status==='denied')call.status='denied';
   if(recovered?.status==='rejected'&&call.captured){call.status='rejected';call.usage=call.captured.technical.usage;}
   if(branch&&call.captured)branch.state='completed';
  }
  await this.ports.save(m);
 }
 async run(p:ResearchProjectV21,m:InFlightEpochV21):Promise<ResearchProjectV21>{
  const f=this.flow(m);
  if(p.researchLoopVersion==='4.0' && this.composition.v4DataRoot) this.theory=new ProofBridgeV4(this.composition.v4DataRoot,this.runtime,this.composition.v4ProofValid??(()=>false),async(project,marker,id,reviewId)=>!marker.optionalFlow || (await affectedOptionalEvidenceV3(this.composition,project,marker,marker.optionalFlow,reviewId)).includes(id),this.composition.v4SourceProject,this.composition.v4KnowledgeLibrary);
  await this.theory?.restore(p,m);
  // A new V3 marker may be durable before the project's no-restatement flag.
  if(['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(f.operationRevision??'')){
   if(m.snapshot.rootInterpretationPending!==false||!isDeepStrictEqual(p.root,m.snapshot.root))throw new Error('Operation3 exact original root binding mismatch.');
   p.rootInterpretationPending=false;
  }
  // A durable accepted marker may precede the project checkpoint on disk.
  // Restore its already-committed interpretation without rerunning any science.
  const interpreted=f.artifacts.find(a=>a.acceptanceCommitted&&a.authorRole==='theorist'&&a.control.rootInterpretation);
  if(interpreted){
   const call=m.calls.find(c=>c.id===interpreted.originalRef.callId),inputRoot=(call?.input as {root?:typeof p.root}|undefined)?.root;
   if(!inputRoot||!isDeepStrictEqual(interpretedRootV21(inputRoot,interpreted.control.rootInterpretation!),m.snapshot.root)||!isDeepStrictEqual(interpreted.root,m.snapshot.root)||p.root.hypothesisId!==m.snapshot.root.hypothesisId||p.root.revision!==m.snapshot.root.revision)throw new Error('Accepted root interpretation recovery mismatch.');
   if(p.rootInterpretationPending===true){p.root=structuredClone(m.snapshot.root);p.rootInterpretationPending=false;}
   else if(!isDeepStrictEqual(p.root,m.snapshot.root))throw new Error('Project root differs from its committed optional interpretation.');
  }
  p.epoch=m.epoch;p.phase='executing';m.phase='executing';
  if(f.phase==='stopped'){await this.theory?.finish(p,m,true);await this.collectStopped(p,m);p.status='stopped';p.phase='idle';Object.assign(p,await this.store.commitCheckpoint(p));return p;}
  if(f.phase==='paused'){if(m.snapshot.theoryRevision==='v4-operation-5'&&!f.selectedArtifactId)f.continuationNeeded=true;f.phase=f.selectedArtifactId?'collect':'solve';}
  try{
   // Reconcile recorded work before admitting any new call. Never infer completion from a checkpoint alone.
   if(!await this.ports.halted(p))for(const branch of f.branches)if(!['completed','cancelled'].includes(branch.state))this.launch(p,m,branch);
   for(;;){
    if(await this.ports.halted(p)){if(this.ports.stopped(p))await this.theory?.finish(p,m,true);else await this.theory?.pause();await this.composition.stopOptionalLearning?.(p);if(this.ports.stopped(p))await this.cancel();await Promise.allSettled([...this.running.values()]);f.phase=this.ports.stopped(p)?'stopped':'paused';await this.ports.save(m);await this.checkpoint(p,m,true);return p;}
    const rejected=m.calls.filter(c=>c.task==='v21_theorist'&&c.status==='rejected');
    if(rejected.length){
     const last=rejected.at(-1)!;
     if(!f.rawDeliveryHistory?.some(row=>row.callId===last.id))await this.recordRawDelivery(p,m,last);
     const notice=rejected.length===1?'The previous scientific declaration was rejected. Make a fresh scientific decision. Dispatch requires an open outcome and a precise Worker assignment.':'Two scientific declarations were rejected. Start a new Epoch to try again.';
     if(!f.notices.includes(notice)){f.notices.push(notice);await this.ports.save(m);this.ports.emit(p,'research.warning',{userVisible:true,message:notice});}
     if(rejected.length>1){f.continuationNeeded=false;break;}
    }
    const pending=m.calls.find(c=>c.task==='v21_theorist'&&c.status!=='rejected'&&!f.artifacts.some(a=>a.id===`artifact_${c.id}`&&a.acceptanceCommitted));
    const unreviewed=!(m.snapshot.theoryRevision==='v4-operation-5'&&f.selectedArtifactId)&&f.artifacts.some(a=>a.authorRole!=='theorist'&&!f.reviewedArtifactIds.includes(a.id)&&a.technical.executionStatus==='completed');
    const finalizedR5=m.snapshot.theoryRevision==='v4-operation-5'&&f.artifacts.some(a=>a.publicReport);
    const needsFreshStep=m.calls.findLast(c=>c.task==='v21_theorist')?.status==='rejected';
    if(pending||needsFreshStep||f.continuationNeeded||!finalizedR5&&unreviewed){
     if(!pending && this.theory) await this.theory.boundary(p,m,this.running.size,()=>this.ports.halted(p),message=>this.ports.emit(p,'research.warning',{userVisible:true,message}));
     if(!pending&&!this.canAdmit(m)){await this.transition(m,async()=>{f.notices.push('Frozen science-call budget exhausted; no additional continuation or adoption was launched.');f.continuationNeeded=false;await this.ports.save(m);});break;}
     const call=await this.transition(m,async()=>{const id=pending?.id??`${m.snapshot.id}_theorist_${++f.sequence}`;
     const admitted=pending??this.operationCall(p,m,id,'v21_theorist',await this.input(p,m,id));await this.ports.save(m);return admitted;});
     let result:OptionalTheoristResultV21;
     try{result=await this.invoke(p,m,call);}
     catch(error){if(call.status!=='rejected')throw error;continue;}
     await this.accept(p,m,call,result);await this.theory?.acknowledge(p,m,call);await this.publish(p,m);
     const dispatched=result.control.action==='dispatch'?await this.dispatchRequests(p,m,result):0;
     await this.transition(m,async()=>{if(result.control.action==='pause'||['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(f.operationRevision??'')&&result.control.continueMain===false&&dispatched>0)f.continuationNeeded=false;
     // A completed proof ends discretionary main research, not collection/adoption of admitted alternatives.
     if(f.selectedArtifactId&&f.artifacts.some(a=>a.id===f.selectedArtifactId&&a.authorRole==='theorist'&&a.qualification==='valid'))f.continuationNeeded=false;
     f.phase=f.selectedArtifactId?'collect':'solve';await this.ports.save(m);});continue;
    }
    await this.publish(p,m);
    if(m.snapshot.theoryRevision==='v4-operation-5'&&f.artifacts.some(a=>a.publicReport))this.theory?.startPostReport(p,m,()=>reportResearchHalted(this.store,p.id),message=>this.ports.emit(p,'research.warning',{userVisible:true,message}));
    if(this.running.size){await Promise.race([...this.running.values()]);continue;}
    if(f.continuationNeeded)continue;
    break;
   }
   await this.theory?.finish(p,m,this.ports.stopped(p));
   // Budget exhaustion stops new calls, but never abandons already admitted result persistence.
   await Promise.allSettled([...this.running.values()]);
   await this.publish(p,m);f.phase=await this.ports.halted(p)?this.ports.stopped(p)?'stopped':'paused':'done';if(f.phase==='stopped')await this.composition.stopOptionalLearning?.(p);await this.ports.save(m);await this.checkpoint(p,m,true);
   if(this.errors.length)throw new AggregateError(this.errors,'Optional branches require durable reconciliation.');
   if(!f.branches.some(b=>b.state==='uncertain'))await this.store.clearInFlight(p.id);
   return p;
  }catch(error){await this.cancel();await this.theory?.pause();await Promise.allSettled([...this.running.values()]);if(await this.ports.halted(p)){f.phase=this.ports.stopped(p)?'stopped':'paused';await this.composition.stopOptionalLearning?.(p);}await this.ports.save(m);await this.checkpoint(p,m,true);throw error;}
 }
}

/** Historical records retain their frozen operation8 scheduler and science rules. */
export class OptionalResearchRunnerV21 {
 private runner?:ConditionResearchRunnerV21|LegacyOptionalResearchRunnerV21;
 constructor(private store:ResearchStoreV21,private runtime:AgentRuntimeV21,private composition:ResearchCompositionV21,private ports:OptionalPortsV21){}
 private select(m:InFlightEpochV21){
  const revision=m.optionalFlow?.operationRevision??m.calls.find(c=>c.operation)?.operation?.revision??'v21-operation-8';
  if(!['v21-operation-8','v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)||m.calls.some(c=>c.operation&&c.operation.revision!==revision))throw new Error('Mixed optional operation revisions.');
  return this.runner??=revision!=='v21-operation-8'?new ConditionResearchRunnerV21(this.store,this.runtime,this.composition,this.ports):new LegacyOptionalResearchRunnerV21(this.store,this.runtime,this.composition,this.ports);
 }
 archiveBridge(){return this.runner instanceof ConditionResearchRunnerV21?this.runner.backgroundBridge():undefined;}
 async cancel(){await this.runner?.cancel();}
 async collectStopped(p:ResearchProjectV21,m:InFlightEpochV21){return this.select(m).collectStopped(p,m);}
 async run(p:ResearchProjectV21,m:InFlightEpochV21){return this.select(m).run(p,m);}
}

export async function affectedOptionalEvidenceV3(composition:ResearchCompositionV21,p:ResearchProjectV21,m:InFlightEpochV21,f:OptionalFlowV21,conditionalSourceId?:string):Promise<string[]> {
  const mapInvalid=f.artifacts.filter(a=>{
    const row=composition.v4KnowledgeLibrary?.reportAssessment(p.id,a.id);
    return !!row&&(row.status==='unsupported'||row.status==='conditional'||!!row.previousCondition)&&a.id!==conditionalSourceId;
  }).map(a=>a.id),mapHandles=new Set<string>();
  if(m.snapshot.knowledgeMapRevision==='dual-cluster-map-v1')for(const artifact of f.artifacts){
    const used=(artifact.control.outcome.knowledgeRefs??[]).filter(id=>/^(map_|source_)/.test(id));
    for(const id of used)mapHandles.add(id);
    const reads=(artifact.mapKnowledge??[]).filter(r=>used.includes(r.selection));
    if(used.some(id=>!reads.some(r=>r.selection===id))||reads.length&&(!composition.invalidatedMapEvidenceV4||(await composition.invalidatedMapEvidenceV4(p.id,reads)).length))mapInvalid.push(artifact.id);
  }
  if(!m.snapshot.v3||!f.v3)return affectedArtifactsV3(f.artifacts,[],[],[],undefined,[],mapInvalid);
  const outcomes=f.artifacts.flatMap(a=>[a.control.outcome,...(a.acceptedOutcome?[a.acceptedOutcome]:[])]),usedKnowledge=[...new Set(outcomes.flatMap(o=>o.knowledgeRefs??[]))];
  const pin=m.snapshot.v3.catalogPin,current=!pin&&usedKnowledge.length&&!composition.invalidatedKnowledgeRefsV3?await composition.readKnowledgeV3?.(p):undefined,revokedKnowledge:string[]=!pin&&composition.invalidatedKnowledgeRefsV3?await composition.invalidatedKnowledgeRefsV3(usedKnowledge):[],resourceRefs=f.artifacts.flatMap(a=>a.route.resourceRefs);
  if(pin)for(const id of usedKnowledge.filter(id=>m.snapshot.v3!.catalogNodeIds?.includes(id)||f.v3!.catalogMaterials?.some(item=>item.node.id===id))){try{if(!composition.validateCatalogKnowledgeV3)throw new Error('Pinned knowledge validator unavailable.');await composition.validateCatalogKnowledgeV3({...p,activeEpoch:m},[id]);}catch{revokedKnowledge.push(id);}}
  for(const id of usedKnowledge){if(mapHandles.has(id))continue;const frozen=(m.snapshot.v3.knowledge.nodes.find(n=>n.id===id)??f.v3.catalogMaterials?.find(item=>item.node.id===id)?.node);if(!frozen){revokedKnowledge.push(id);continue;}
   if(frozen.authorityRef)resourceRefs.push(frozen.authorityRef);
   const authority=m.snapshot.resourceCatalog?.find(r=>frozen.sourceRef===`resource:${r.id}:${r.version}`);if(authority)resourceRefs.push({id:authority.id,version:authority.version});
   if(!pin&&!composition.invalidatedKnowledgeRefsV3&&!frozen.authorityRef&&!frozen.sourceRef.startsWith('resource:')&&!frozen.sourceRef.startsWith('registry:')&&!frozen.sourceRef.startsWith('root:')){const live=current?.nodes.find(n=>n.id===id);if(!live||live.status!=='active')revokedKnowledge.push(id);}
  }
  const refs=[...new Map(resourceRefs.map(r=>[`${r.id}:${r.version}`,r])).values()],revokedResources=pin?[]:await composition.invalidatedResourceRefsV3?.(refs)??[];
  for(const ref of refs)try{if(!composition.readResource)throw new Error('Exact authority reader unavailable.');await composition.readResource(ref,{...p,activeEpoch:m});}catch{if(!revokedResources.some(r=>isDeepStrictEqual(r,ref)))revokedResources.push(ref);}
  for(const id of usedKnowledge){const node=(m.snapshot.v3.knowledge.nodes.find(n=>n.id===id)??f.v3.catalogMaterials?.find(item=>item.node.id===id)?.node);if(node&&revokedResources.some(ref=>node.authorityRef&&isDeepStrictEqual(node.authorityRef,ref)||node.sourceRef===`resource:${ref.id}:${ref.version}`)&&!revokedKnowledge.includes(id))revokedKnowledge.push(id);}
  const usedSourceIds=[...new Set(outcomes.flatMap(o=>o.sourceRefs??[]))];
  for(const record of f.v3.workspace.records)for(const source of m.snapshot.sources)if(record.sourceRef===source.ref.id||record.sourceRef===`source:${source.ref.id}`||record.sourceRef.startsWith(`source:${source.ref.id}:`))usedSourceIds.push(source.ref.id);
  const revokedSources=usedSourceIds.length?await composition.invalidatedSourceIdsV3?.(p,m.snapshot.sources,[...new Set(usedSourceIds)])??[]:[];
  return affectedArtifactsV3(f.artifacts,revokedKnowledge,revokedSources,revokedResources,f.v3.workspace,f.v3.receipts,mapInvalid);
 }

// An optional author-written Markdown section stays part of the immutable manuscript.
function reportOutline(body:string):{proofOutline?:string}{
 const heading=/^#{1,6}\s+Proof outline\s*$/im.exec(body);
 if(!heading)return {};
 const section=body.slice(heading.index+heading[0].length).split(/^#{1,6}\s/m,1)[0]?.trim();
 return section && section.length<=4000?{proofOutline:section}:{};
}