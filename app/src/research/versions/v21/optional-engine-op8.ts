/** Explicit operation8 scheduler. The single writer remains alive while admitted branches drain. */
import { isDeepStrictEqual } from 'node:util';
import type { AgentSession, AgentSessionSpecV21, AgentRuntimeV21, ResearchStoreV21, ResearchCompositionV21, ResearchProjectV21, InFlightEpochV21, CallV21, FrozenQuestionV21, EpochRecordV21, ResearchEventV21 } from '../../contracts/v21.js';
import type { OptionalFlowV21, OptionalBranchV21, OptionalTheoristResultV21, OptionalProofArtifactV21, OptionalWorkerRequestV21, OptionalProofSelectionV21 } from './optional-types-op8.js';
import { OPTIONAL_MODE_V21 } from './optional-types-op8.js';
import { createOptionalOperationV21 } from './optional-operation-op8.js';
import { digestV21 } from './state.js';
import { stableHash } from '../../../learning/research-hash.js';
import { interpretedRootV21 } from './root-interpretation.js';
import { validateOptionalArtifactV21, optionalConflictsV21 } from './optional-proof-op8.js';
import { finishPlanningInputs } from '../../user-commands.js';
const now=()=>new Date().toISOString();
const pin={researchLoopVersion:'2.1' as const,workerProtocolVersion:'2.1' as const};
interface OptionalPortsV21 {
 stopped(project:ResearchProjectV21):boolean; save(marker:InFlightEpochV21):Promise<void>; halted(project:ResearchProjectV21):Promise<boolean>;
 emit(project:ResearchProjectV21,type:ResearchEventV21['type'],extra?:Partial<ResearchEventV21>):void;
 registerLearning(project:ResearchProjectV21,epoch:EpochRecordV21):Promise<void>;
}
export function initialOptionalFlowV21():OptionalFlowV21{return {version:1,sequence:0,artifacts:[],branches:[],archives:[],evidenceRevision:0,reviewedArtifactIds:[],deliveryHistory:[],conflictArtifactIds:[],phase:'solve',continuationNeeded:true,notices:[]};}
export class OptionalResearchRunnerV21 {
 private cancelled=false;
 private mutations:Promise<void>=Promise.resolve();
 private async serial<T>(work:()=>Promise<T>):Promise<T>{const job=this.mutations.then(work);this.mutations=job.then(()=>{},()=>{});return job;}
 private sessions=new Map<string,AgentSession>();private running=new Map<string,Promise<void>>();private errors:unknown[]=[];
 constructor(private store:ResearchStoreV21,private runtime:AgentRuntimeV21,private composition:ResearchCompositionV21,private ports:OptionalPortsV21){}
 async cancel():Promise<void>{this.cancelled=true;await Promise.allSettled([...this.sessions.values()].map(s=>this.runtime.cancelSession?.(s)));}
 private flow(m:InFlightEpochV21){if(m.solverMode!==OPTIONAL_MODE_V21||!m.optionalFlow)throw new Error('Optional execution needs its explicit frozen mode.');return m.optionalFlow as OptionalFlowV21;}
 private admitted(m:InFlightEpochV21){return m.calls.length;}
 private canAdmit(m:InFlightEpochV21,reserve=0):boolean {
  const budget=m.snapshot.config.epochBudget,used=m.calls.reduce((sum,c)=>({tokens:sum.tokens+(c.usage?.tokens??0),cost:sum.cost+(c.usage?.costUsd??0)}),{tokens:0,cost:0});
  return this.admitted(m)+reserve<budget.maxTasks&&used.tokens<budget.maxTokens-budget.reserveTokens&&used.cost<budget.maxCostUsd-budget.reserveCostUsd;
 }
 private spec(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,branch?:OptionalBranchV21):AgentSessionSpecV21 {
  const role=branch?'worker':'theorist',model=branch?.frozen.model??m.snapshot.modelConfig.roleModels?.[role]??m.snapshot.modelConfig.defaultModel;
  const input=call.input as {artifacts?:OptionalProofArtifactV21[]};
  return {id:`${call.id}_session`,projectId:p.id,loop:pin,contractVersion:'2.1',role,...(model?{model}:{}),budget:structuredClone(branch?.frozen.budget??m.snapshot.config.roleBudget),context:branch?{brief:structuredClone(branch.frozen)}:{project:structuredClone(p),snapshot:structuredClone(m.snapshot),marker:structuredClone(m),grants:(input.artifacts??[]).map(a=>({readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.originalRef})),deliveries:[]}};
 }
 private async invoke(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,branch?:OptionalBranchV21):Promise<OptionalTheoristResultV21>{
  if(call.status==='completed')return structuredClone(call.result) as OptionalTheoristResultV21;
  const spec=this.spec(p,m,call,branch),inv={task:call.task,input:structuredClone(call.input),operation:call.operation,recoveryGeneration:call.recoveryGeneration};
  if(call.status==='pending'||call.status==='uncertain'){
   const recovered=await this.runtime.reconcileV21?.(spec,inv);
   if(recovered?.status==='completed'){call.result=structuredClone(recovered.result);call.status='completed';await this.ports.save(m);return recovered.result as OptionalTheoristResultV21;}
   if(recovered&&'captured'in recovered&&recovered.captured){call.captured=structuredClone(recovered.captured);await this.ports.save(m);}
   if(recovered?.status!=='not-started')throw new Error('Optional paid call is uncertain; no replay.');
  }
  if(this.flow(m).phase==='stopped'||await this.ports.halted(p))throw new Error('Optional dispatch stopped before admission.');
  call.status='pending';await this.ports.save(m);
  if(await this.ports.halted(p))throw new Error('Optional dispatch stopped before runtime admission.');
  const session=await this.runtime.createSession(spec);this.sessions.set(call.id,session);
  try{
   if(await this.ports.halted(p)){await this.runtime.cancelSession?.(session);throw new Error('Optional session cancelled before invocation.');}
   const result=await this.runtime.invoke(session,inv) as OptionalTheoristResultV21;
   call.result=structuredClone(result);call.usage=this.runtime.getUsage?.(session);call.status='completed';await this.ports.save(m);return result;
  }catch(error){const captured=this.runtime.retainedV21Original?.(session);if(captured)call.captured=structuredClone(captured);call.status='uncertain';await this.ports.save(m);throw error;}
  finally{this.sessions.delete(call.id);await this.runtime.closeSession(session);}
 }
 private operationCall(p:ResearchProjectV21,m:InFlightEpochV21,id:string,task:'v21_theorist'|'v21_optional_worker',input:unknown,branch?:OptionalBranchV21):CallV21 {
  const existing=m.calls.find(c=>c.id===id);if(existing)return existing;
  const operation=createOptionalOperationV21(task,input,{project:p,marker:m,...(branch?{brief:branch.frozen}:{}),root:m.snapshot.root,boundaryId:id});
  const call:CallV21={id,task,status:'not-started',input:structuredClone(input),inputHash:digestV21(input),operation:operation.pin,recoveryGeneration:0};m.calls.push(call);return call;
 }
 private async input(p:ResearchProjectV21,m:InFlightEpochV21,id:string):Promise<unknown>{
  const f=this.flow(m),artifacts=[];
  for(const a of f.artifacts){const body=await this.composition.rawAnswers.read(a.originalRef,{readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.originalRef});artifacts.push({...structuredClone(a),body});}
  return {boundaryId:id,root:structuredClone(m.snapshot.root),rootInterpretationPending:p.rootInterpretationPending===true,decision:m.snapshot.decision,resourceBodies:m.snapshot.resourceBodies??[],sources:m.snapshot.sources,phase:f.phase,artifacts,pendingBranches:f.branches.map(({id,kind,state})=>({id,kind,state})),remainingCalls:Math.max(0,m.snapshot.config.epochBudget.maxTasks-m.calls.length-1),notices:f.notices,refinements:p.refinements};
 }
 private async accept(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,result:OptionalTheoristResultV21,branch?:OptionalBranchV21):Promise<void>{return this.serial(()=>this.acceptLocked(p,m,call,result,branch));}
 private async acceptLocked(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,result:OptionalTheoristResultV21,branch?:OptionalBranchV21):Promise<void>{
  const f=this.flow(m),id=`artifact_${call.id}`;if(f.artifacts.some(a=>a.id===id))return;
  if(!result?.originalRef||!result.control||!result.technical)throw new Error('Optional runtime returned no immutable result.');
  const ref=result.originalRef;if(ref.projectId!==p.id||ref.owner!==p.id||ref.hypothesisId!==m.snapshot.root.hypothesisId||ref.hypothesisRevision!==m.snapshot.root.revision||ref.callId!==call.id)throw new Error('Optional result identity mismatch.');
  if(result.control.rootInterpretation){if(branch||p.rootInterpretationPending!==true||f.artifacts.length)throw new Error('Root interpretation outside initial boundary.');m.snapshot.root=interpretedRootV21(m.snapshot.root,result.control.rootInterpretation);p.root=structuredClone(m.snapshot.root);p.rootInterpretationPending=false;}
  m.sealed=true;
  const exposure=(call.input as {artifacts?:OptionalProofArtifactV21[]}).artifacts?.map(a=>a.id)??[];
  const a:OptionalProofArtifactV21={...structuredClone(result),id,authorRole:branch?.kind??'theorist',root:structuredClone(m.snapshot.root),route:structuredClone(result.control.route),exposureArtifactIds:exposure,qualification:'unreviewed',createdAt:now()};
  const restored:OptionalProofArtifactV21[]=[],withdrawn:string[]=[];f.artifacts.push(a);f.evidenceRevision++;
  if(branch){branch.artifactId=id;branch.state='completed';}
  else{
   // The immutable own draft is appended before applying any new adoption decision.
   for(const adoption of result.control.adoptions){
    const target=f.artifacts.find(x=>x.id===adoption.artifactId);if(!target||!exposure.includes(target.id)||target.authorRole==='theorist'&&target.qualification!=='needs-review')throw new Error('Adoption requires a delivered Worker original or explicit re-review of an affected Theorist original.');
    if(adoption.outcome.resultKind!==target.control.outcome.resultKind||adoption.outcome.scope!==target.control.outcome.scope)throw new Error('Adoption cannot relabel a local/unknown/opposite result as a root proof.');
    if(target.qualification==='needs-review'&&adoption.status==='valid')restored.push(target);if(['valid','needs-review'].includes(target.qualification)&&adoption.status==='rejected')withdrawn.push(target.id);
    target.judgment={callId:call.id,evidenceRevision:f.evidenceRevision};target.scientificFailure=adoption.scientificFailure;target.qualification=adoption.status;target.adoptionReason=adoption.reason;target.acceptedOutcome=structuredClone(adoption.outcome);
    if(adoption.status==='valid')validateOptionalArtifactV21(m.snapshot.root,target,f.artifacts,target.authorRole!=='auxiliary-worker');
    if(!f.reviewedArtifactIds.includes(target.id))f.reviewedArtifactIds.push(target.id);
   }
   if(result.control.outcome.resultKind!=='open'){
    a.qualification='valid';a.acceptedOutcome=structuredClone(result.control.outcome);a.adoptionReason='Theorist same-response original proof and explicit exact-root declaration.';
    validateOptionalArtifactV21(m.snapshot.root,a,f.artifacts);
   }
   if(m.planningSelection)finishPlanningInputs(p,m.planningSelection,p.hypothesisRevision);
   f.continuationNeeded=result.control.action==='dispatch'||result.control.action==='continue';
  }
  f.conflictArtifactIds=optionalConflictsV21(m.snapshot.root,f.artifacts);
  if(f.conflictArtifactIds.length){for(const artifact of f.artifacts)if(f.conflictArtifactIds.includes(artifact.id)&&artifact.qualification==='valid')artifact.qualification='needs-review';await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},f.conflictArtifactIds);this.ports.emit(p,'research.warning',{message:'Opposite claims for the same root require scientific review. Prior delivery and learning eligibility are suspended.'});}
  if(withdrawn.length)await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},withdrawn);
  if(restored.length&&!f.conflictArtifactIds.length)await this.composition.restoreOptionalProofs?.({...p,activeEpoch:m},restored,{callId:call.id,evidenceRevision:f.evidenceRevision});
  await this.ports.save(m);
 }
 private freeze(p:ResearchProjectV21,m:InFlightEpochV21,r:OptionalWorkerRequestV21,index:number):OptionalBranchV21 {
  const id=`${m.snapshot.id}_optional_worker_${index}`,qId=`${id}_question`,wayId=`${id}_way`;
  const way={id:wayId,revision:'1',methodKey:r.route.methodKey,routeTarget:'original-root' as const,direction:r.route.description,purpose:r.reason,conditions:r.conditions,questionIds:[qId],rootObligationIds:r.rootObligationIds,obstacles:[],utilityStatus:'active' as const,resourceRefs:r.route.resourceRefs};
  const question={id:qId,revision:'1',wayId,order:0,question:r.question,known:[],unknown:[],constraints:[],definitions:[],conditions:r.conditions,symbols:r.symbols,sourceIds:m.snapshot.sources.map(s=>s.ref.id),expectedArtifact:r.kind==='way-worker'?'Complete independent proof or valid refutation of the exact original root.':'Exact local auxiliary result with all conditions retained.',checks:r.checks,purpose:r.reason,rootObligationIds:r.rootObligationIds,dependencyQuestionIds:[],conditionalInterfaces:[],interfaceUses:[],adoptedAnswerIds:[],allocation:'dispatch' as const,effort:r.effort,reason:r.reason};
  const resourceBodies=(m.snapshot.resourceBodies??[]).filter(x=>r.route.resourceRefs.some(ref=>isDeepStrictEqual(ref,x.ref)));
  if(resourceBodies.length!==r.route.resourceRefs.length)throw new Error('Worker resource was not exactly frozen and delivered.');
  const base={solverRole:r.kind,projectId:p.id,epochId:m.snapshot.id,attemptId:`${id}_attempt`,callId:id,root:structuredClone(m.snapshot.root),way,question,inputRevision:m.snapshot.inputRevision,brief:JSON.stringify({root:m.snapshot.root,question,sources:m.snapshot.sources,resourceBodies,role:r.kind}),sources:structuredClone(m.snapshot.sources),premises:[],grants:[],conditionalInterfaces:[],interfaceUses:[],adoptedAnswerIds:[],resources:r.route.resourceRefs,resourceBodies,strategy:r.route.reason,decision:JSON.stringify(m.snapshot.decision),model:m.snapshot.modelConfig.roleModels?.worker??m.snapshot.modelConfig.defaultModel,effort:r.effort,budget:structuredClone(m.snapshot.config.workerBudgets[r.effort]),scientificInputHash:digestV21({root:m.snapshot.root,question,resourceBodies,sources:m.snapshot.sources})};
  const frozen:FrozenQuestionV21={...base,inputHash:digestV21(base)};
  return {id,kind:r.kind,callId:id,frozen,state:'ready'};
 }
 private async dispatchRequests(p:ResearchProjectV21,m:InFlightEpochV21,result:OptionalTheoristResultV21):Promise<void>{
  const f=this.flow(m);for(const request of result.control.workers){
   if(await this.ports.halted(p))return;
   const active=f.branches.filter(b=>['ready','running'].includes(b.state)).length;
   if(!this.store.commitGuardedCheckpoint||active>=Math.max(0,m.snapshot.config.maxWorkers-1)||!this.canAdmit(m,2)||request.kind==='way-worker'&&f.branches.some(b=>b.kind==='way-worker')){f.notices.push(`Not dispatched ${request.route.methodKey}: guarded delivery, reserved Theorist/review capacity or frozen admission budget unavailable.`);continue;}
   if(request.kind==='way-worker'&&(!result.control.nearTieReason||result.control.outcome.resultKind!=='open'))throw new Error('Alternative route must be early, explicitly near-tied, before a complete main proof.');
   const branch=this.freeze(p,m,request,f.branches.length+1);f.branches.push(branch);
   this.operationCall(p,m,branch.callId,'v21_optional_worker',{...structuredClone(branch.frozen),boundaryId:branch.callId},branch);await this.ports.save(m);this.launch(p,m,branch);
  }
 }
 private launch(p:ResearchProjectV21,m:InFlightEpochV21,b:OptionalBranchV21):void{
  if(this.running.has(b.id)||['completed','cancelled'].includes(b.state))return;
  const promise=(async()=>{try{if(b.state!=='uncertain')b.state='running';await this.ports.save(m);const call=m.calls.find(c=>c.id===b.callId)!;const result=await this.invoke(p,m,call,b);await this.accept(p,m,call,result,b);}catch(error){const call=m.calls.find(c=>c.id===b.callId);b.state=call?.captured?'completed':'uncertain';if(!call?.captured)this.errors.push(error);await this.ports.save(m);}finally{this.running.delete(b.id);}})();
  this.running.set(b.id,promise);
 }
 private dependencies(a:OptionalProofArtifactV21,all:OptionalProofArtifactV21[]):OptionalProofArtifactV21[]{const found=new Map<string,OptionalProofArtifactV21>();const visit=(x:OptionalProofArtifactV21)=>{for(const id of x.acceptedOutcome?.dependencyArtifactIds??[]){if(found.has(id))continue;const dep=all.find(v=>v.id===id);if(!dep)throw new Error('Missing archive dependency.');found.set(id,dep);visit(dep);}};visit(a);return [...found.values()].map(x=>structuredClone(x));}
 private async collectCompleted(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  // A terminal runtime receipt can arrive while archive/checkpoint I/O is awaited.
  // Consume it under the science lock before a delivery event or learning grant.
  for(const branch of this.flow(m).branches){const call=m.calls.find(c=>c.id===branch.callId);if(call?.status==='completed'&&!this.flow(m).artifacts.some(a=>a.id===`artifact_${call.id}`))await this.acceptLocked(p,m,call,call.result as OptionalTheoristResultV21,branch);}
 }
 private async publish(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{return this.serial(()=>this.publishLocked(p,m));}
 private async publishLocked(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const f=this.flow(m);await this.collectCompleted(p,m);if(f.conflictArtifactIds.length||await this.ports.halted(p))return;
  for(const a of f.artifacts.filter(a=>a.qualification==='valid'&&a.authorRole!=='auxiliary-worker')){
   validateOptionalArtifactV21(m.snapshot.root,a,f.artifacts);let receipt=f.archives.find(r=>r.artifactId===a.id&&isDeepStrictEqual(r.selection.artifact.acceptedOutcome,a.acceptedOutcome)&&r.selection.artifact.adoptionReason===a.adoptionReason&&isDeepStrictEqual(r.selection.artifact.judgment,a.judgment));
   if(!receipt){const selection:OptionalProofSelectionV21={operationId:`${m.snapshot.id}_archive_${a.id}_${digestV21([a.acceptedOutcome,a.adoptionReason,a.judgment]).slice(0,12)}`,projectId:p.id,epochId:m.snapshot.id,caseGroupId:digestV21({text:m.snapshot.root.originalText,conditions:m.snapshot.root.conditions,symbols:m.snapshot.root.symbols,strength:m.snapshot.root.strength,sources:m.snapshot.sources.map(s=>s.bodyHash)}),evidenceRevision:f.evidenceRevision,root:structuredClone(m.snapshot.root),artifact:structuredClone(a),dependencies:this.dependencies(a,f.artifacts)};receipt={operationId:selection.operationId,artifactId:a.id,selectionHash:stableHash(selection),selection,status:'pending'};f.archives.push(receipt);await this.ports.save(m);}
   if(receipt.status!=='saved'){
    if(!this.composition.archiveOptionalProof)throw new Error('Optional proof archive adapter unavailable.');
    const saved=await this.composition.archiveOptionalProof(structuredClone(receipt.selection));
    if(saved.status!=='saved'||!saved.proofRef||saved.operationId!==receipt.operationId||saved.selectionHash!==receipt.selectionHash||!isDeepStrictEqual(saved.selection,receipt.selection))throw new Error('Optional archive receipt mismatch.');
    Object.assign(receipt,saved);await this.ports.save(m);
   }
  }
  // A Worker may have returned during an awaited archive write. Never deliver a stale winner.
  await this.collectCompleted(p,m);f.conflictArtifactIds=optionalConflictsV21(m.snapshot.root,f.artifacts);
  if(f.conflictArtifactIds.length){await this.composition.invalidateOptionalProofs?.({...p,activeEpoch:m},f.conflictArtifactIds);return;}
  const candidates=f.artifacts.filter(a=>a.qualification==='valid'&&f.archives.some(r=>r.artifactId===a.id&&r.status==='saved'));
  const selected=candidates.find(a=>a.authorRole==='theorist')??candidates[0];
  if(selected){const receipt=f.archives.findLast(r=>r.artifactId===selected.id&&r.status==='saved')!;if(f.selectedArtifactId===selected.id&&isDeepStrictEqual(f.deliveryHistory.at(-1)?.proofRef,receipt.proofRef))return;f.selectedArtifactId=selected.id;f.foregroundCompletedAt??=now();f.deliveryHistory.push({artifactId:selected.id,proofRef:receipt.proofRef!,deliveredAt:now()});await this.ports.save(m);await this.checkpoint(p,m,false);if(f.conflictArtifactIds.length||f.artifacts.find(a=>a.id===f.selectedArtifactId)?.qualification!=='valid'||await this.ports.halted(p))return;this.ports.emit(p,'checkpoint.committed',{userVisible:true,message:'Qualified original proof archived. Already admitted alternative work is still retained.'});}
 }
 private terminalWatermark(m:InFlightEpochV21):string{return digestV21(m.calls.filter(c=>c.task==='v21_optional_worker').map(c=>({id:c.id,status:c.status,result:c.status==='completed'?c.result:undefined,captured:c.captured})));}
 private async checkpoint(p:ResearchProjectV21,m:InFlightEpochV21,terminal:boolean):Promise<void>{
  const f=this.flow(m);await this.collectCompleted(p,m);const watermark=f.evidenceRevision,terminalWatermark=this.terminalWatermark(m),halted=await this.ports.halted(p),selected=f.artifacts.find(a=>a.id===f.selectedArtifactId),qualified=selected?.qualification==='valid'&&!f.conflictArtifactIds.length;
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
   if(recovered?.status==='completed'){call.result=structuredClone(recovered.result);call.status='completed';const result=recovered.result as OptionalTheoristResultV21;if(result.originalRef&&result.technical)call.captured={originalRef:structuredClone(result.originalRef),technical:structuredClone(result.technical)};}
   else if(recovered&&'captured'in recovered&&recovered.captured)call.captured=structuredClone(recovered.captured);
   if(branch&&call.captured)branch.state='completed';
  }
  await this.ports.save(m);
 }
 async run(p:ResearchProjectV21,m:InFlightEpochV21):Promise<ResearchProjectV21>{
  const f=this.flow(m);p.epoch=m.epoch;p.phase='executing';m.phase='executing';
  if(f.phase==='stopped'){await this.collectStopped(p,m);p.status='stopped';p.phase='idle';Object.assign(p,await this.store.commitCheckpoint(p));return p;}
  if(f.phase==='paused')f.phase=f.selectedArtifactId?'collect':'solve';
  try{
   // Reconcile recorded work before admitting any new call. Never infer completion from a checkpoint alone.
   if(!await this.ports.halted(p))for(const branch of f.branches)if(!['completed','cancelled'].includes(branch.state))this.launch(p,m,branch);
   for(;;){
    if(await this.ports.halted(p)){await this.composition.stopOptionalLearning?.(p);if(this.ports.stopped(p))await this.cancel();await Promise.allSettled([...this.running.values()]);f.phase=this.ports.stopped(p)?'stopped':'paused';await this.ports.save(m);await this.checkpoint(p,m,true);return p;}
    const pending=m.calls.find(c=>c.task==='v21_theorist'&&!f.artifacts.some(a=>a.id===`artifact_${c.id}`));
    const unreviewed=f.artifacts.some(a=>a.authorRole!=='theorist'&&!f.reviewedArtifactIds.includes(a.id)&&a.technical.executionStatus==='completed');
    if(pending||f.continuationNeeded||unreviewed){
     if(!pending&&!this.canAdmit(m)){f.notices.push('Frozen science-call budget exhausted; no additional continuation or adoption was launched.');f.continuationNeeded=false;break;}
     const id=pending?.id??`${m.snapshot.id}_theorist_${++f.sequence}`;
     const call=pending??this.operationCall(p,m,id,'v21_theorist',await this.input(p,m,id));await this.ports.save(m);
     const result=await this.invoke(p,m,call);await this.accept(p,m,call,result);await this.publish(p,m);
     if(result.control.action==='dispatch')await this.dispatchRequests(p,m,result);
     if(result.control.action==='pause')f.continuationNeeded=false;
     // A completed proof ends discretionary main research, not collection/adoption of admitted alternatives.
     if(f.selectedArtifactId&&f.artifacts.find(a=>a.id===f.selectedArtifactId)?.authorRole==='theorist')f.continuationNeeded=false;
     f.phase=f.selectedArtifactId?'collect':'solve';await this.ports.save(m);continue;
    }
    await this.publish(p,m);
    if(this.running.size){await Promise.race([...this.running.values()]);continue;}
    break;
   }
   // Budget exhaustion stops new calls, but never abandons already admitted result persistence.
   await Promise.allSettled([...this.running.values()]);
   await this.publish(p,m);f.phase=await this.ports.halted(p)?this.ports.stopped(p)?'stopped':'paused':'done';if(f.phase==='stopped')await this.composition.stopOptionalLearning?.(p);await this.ports.save(m);await this.checkpoint(p,m,true);
   if(this.errors.length)throw new AggregateError(this.errors,'Optional branches require durable reconciliation.');
   if(!f.branches.some(b=>b.state==='uncertain'))await this.store.clearInFlight(p.id);
   return p;
  }catch(error){await this.cancel();await Promise.allSettled([...this.running.values()]);if(await this.ports.halted(p)){f.phase=this.ports.stopped(p)?'stopped':'paused';await this.composition.stopOptionalLearning?.(p);}await this.ports.save(m);await this.checkpoint(p,m,true);throw error;}
 }
}
