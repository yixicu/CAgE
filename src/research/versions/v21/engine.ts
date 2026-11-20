import {RuntimeError} from '../../../runtime/errors.js';
import {freezeDiscussionV4,prepareDiscussionCall} from '../v4/discussion.js';
import { foregroundBudgetV4 } from '../v4/foreground-budget.js';
import { usesV3Proof } from '../v3/proof-version.js';
import {validateRootIdentity} from './root-identity.js';
import {freezeKnowledgeV3,retrieveKnowledgeV3} from '../v3/knowledge.js';
import {freezeCapacityConfigV3,budgetControlsEnabledV3,modelConfigV3} from '../v3/capacity-policy.js';
import { freezeContextV3, initialFlowV3 } from '../v3/integration.js';
import {OptionalResearchRunnerV21,initialOptionalFlowV21,affectedOptionalEvidenceV3,reportResearchHalted} from './optional-engine.js';
import type {V4Scope} from '../v4/coordinator.js';
import {ProofBridgeV4} from '../v4/proof-bridge.js';
import {OPTIONAL_MODE_V21} from './optional-types.js';
import { batchModeV21, BATCH_CONTEXT_V21, batchAnswerDeliveriesV21 } from './batch-context.js';
import {interpretedRootV21} from './root-interpretation.js';
import {stableHash} from '../../../learning/research-hash.js';
import { isDeepStrictEqual } from 'node:util';
import type { ResearchLoopV21 } from '../../contracts/loop.js';
import type { AgentInvocationV21, AgentRuntimeV21, AgentSessionSpecV21, AnswerDeliveryV21, ArchiveSelectionV21, CallV21, CheckOutputV21, EpochRecordV21, FrozenQuestionV21, InFlightEpochV21, PlanOutputV21, RawAnswerGrantV21, ResearchCompositionV21, ResearchEventV21, ResearchProjectV21, ResearchStoreV21, UserCommand } from '../../contracts/v21.js';
import { initializeCommandStates, ingestCommands, selectPlanningInputs, markPlanningInputs, finishPlanningInputs } from '../../user-commands.js';
import { defaultDecision } from '../../../learning/research-data.js';
import { parseProject, parseInFlight, parseWorkerAnswer } from './schemas.js';
import { digestV21 } from './state.js';
import { projectPlanView } from './compact-contract.js';
import { createOperationV21, validatePlanOutput } from './operation-contract.js';
import { makeAnswerPrefix, makeAnswerDelivery, projectCheckView, latestDecisions } from './check-view.js';
import { validateCheckOutput, invalidatedDependentsV21 } from './review.js';
const now=()=>new Date().toISOString();
const projectPin=(p:ResearchProjectV21)=>({researchLoopVersion:p.researchLoopVersion,workerProtocolVersion:'2.1' as const});
/** Single authoritative writer; model outputs never directly mutate central state. */
export class ResearchEngineV21 implements ResearchLoopV21 {
 private optionalRunners=new Map<string,OptionalResearchRunnerV21>();
 private archiveResearch=new Map<string,{projectId:string;bridge:ProofBridgeV4;done:Promise<void>;wake?:V4Scope}>();
 private shuttingDown=false;
 private active=new Map<string,Promise<void>>();private stop=new Set<string>();private pause=new Set<string>();private listeners=new Set<(e:ResearchEventV21)=>void>();private writes:Promise<void>=Promise.resolve();
 constructor(private store:ResearchStoreV21,private runtime:AgentRuntimeV21,private composition?:ResearchCompositionV21){}
 isActive(id?:string){return id?this.active.has(id):this.active.size>0;}
 subscribe(listener:(e:ResearchEventV21)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private emit(project:ResearchProjectV21,type:ResearchEventV21['type'],extra:Partial<ResearchEventV21>={}){const e:ResearchEventV21={contractVersion:'2.1',type,projectId:project.id,epoch:project.epoch,phase:project.phase,...extra};for(const listener of this.listeners)try{listener(structuredClone(e));}catch{/* Observers cannot alter research. */}}
 async enqueue(c:UserCommand){if(c.kind==='stop')this.stop.add(c.projectId);if(c.kind==='pause')this.pause.add(c.projectId);await this.store.enqueueCommand(c);if(c.kind==='stop'||c.kind==='pause'){for(const job of this.archiveResearch.values())if(job.projectId===c.projectId)job.bridge.cancel();if(c.kind==='stop')await this.composition?.stopOptionalLearning?.(await this.store.loadProject(c.projectId));if(c.kind==='stop')await this.optionalRunners.get(c.projectId)?.cancel();}}
 async getSnapshot(id:string,saved?:ResearchProjectV21){const p=parseProject(saved??await this.store.loadProject(id)),m=await this.store.loadInFlight(id);if(m)p.activeEpoch=parseInFlight(m);return p;}
 private save(marker:InFlightEpochV21):Promise<void>{const snapshot=parseInFlight(JSON.parse(JSON.stringify(marker)));const job=this.writes.then(()=>this.store.saveInFlight(snapshot));this.writes=job.catch(()=>{});return job;}
 private async controls(p:ResearchProjectV21){const commands=await this.store.listCommands(p.id);initializeCommandStates(p,commands);const flags=ingestCommands(p,commands);if(flags.stop)this.stop.add(p.id);if(flags.pause)this.pause.add(p.id);return commands;}
 private async halted(p:ResearchProjectV21){await this.controls(p);return this.stop.has(p.id)||this.pause.has(p.id);}
 async reconcile(id:string){
  if(this.active.has(id))throw new Error('Cannot reconcile an active writer.');
  const p=await this.store.loadProject(id),m=await this.store.loadInFlight(id);
  // Register only durable reviewed epochs, never the uncommitted marker. Preserve
  // the saved stopped state while checking admission, before projecting paused UI.
  if(m)parseInFlight(m);
  const committedMarker=m&&!m.optionalFlow&&p.epochs.some(e=>e.id===m.snapshot.id);
  if(committedMarker){await this.store.clearInFlight(id);delete p.activeEpoch;}
  if(p.status==='stopped')await this.composition?.stopOptionalLearning?.(p);for(const epoch of p.epochs)await this.registerLearning(p,epoch);
  if(m&&!committedMarker){p.activeEpoch=m;if(p.status!=='stopped')p.status='paused';}
  this.resumeArchiveResearch(p);return p;
 }
 async wakeReport(scope:V4Scope){
  const project=await this.store.loadProject(scope.projectId);
  if(this.shuttingDown||project.status==='stopped'||this.stop.has(project.id)||this.pause.has(project.id))return;
  const current=this.archiveResearch.get(JSON.stringify([scope.projectId,scope.epochId,scope.rootId]));
  if(current){current.wake=scope;return;}
  this.resumeArchiveResearch(project,undefined,undefined,scope);
 }
 private resumeArchiveResearch(project:ResearchProjectV21,existing?:ProofBridgeV4,existingEpoch?:string,only?:V4Scope){
  const composition=this.composition;
  if(this.shuttingDown||project.status==='stopped'||project.researchLoopVersion!=='4.0'||!composition?.v4DataRoot)return;
  for(const epoch of project.epochs){
   if(only&&(epoch.snapshot.id!==only.epochId||epoch.snapshot.root.revision!==only.rootId))continue;
   const key=JSON.stringify([project.id,epoch.snapshot.id,epoch.snapshot.root.revision]);
   if(!['v4-operation-2','v4-operation-3','v4-operation-4','v4-operation-5'].includes(epoch.snapshot.theoryRevision??'')||epoch.decision==='stop'||this.archiveResearch.has(key))continue;
   const p=structuredClone(project),m:InFlightEpochV21={...structuredClone(epoch),schemaVersion:3,projectId:p.id,loop:projectPin(p)};
   const bridge=existing&&epoch.snapshot.id===existingEpoch?existing:new ProofBridgeV4(composition.v4DataRoot,this.runtime,composition.v4ProofValid??(()=>false),async(source,marker,id,reviewId)=>!marker.optionalFlow||(await affectedOptionalEvidenceV3(composition,source,marker,marker.optionalFlow,reviewId)).includes(id),composition.v4SourceProject,composition.v4KnowledgeLibrary);
   const halted=async()=>this.shuttingDown||this.stop.has(p.id)||this.pause.has(p.id)||await reportResearchHalted(this.store,p.id);
   const done=bridge.drainArchive(p,m,halted,message=>this.emit(p,'research.warning',{message})).catch(()=>this.emit(p,'research.warning',{message:'V4 archival research is retained for safe reconciliation.'})).finally(()=>{
    const wake=this.archiveResearch.get(key)?.wake;
    this.archiveResearch.delete(key);
    if(wake&&!this.shuttingDown&&!this.stop.has(p.id)&&!this.pause.has(p.id))this.resumeArchiveResearch(p,undefined,undefined,wake);
   });
   this.archiveResearch.set(key,{projectId:p.id,bridge,done});
  }
 }
 private async registerLearning(p:ResearchProjectV21,epoch:EpochRecordV21){
  if((!epoch.review&&!epoch.optionalFlow)||epoch.decision==='stop'||p.status==='stopped'||this.stop.has(p.id))return;
  try {
   // Read only: observing a durable pending STOP must not acknowledge refinements.
   const commands=await this.store.listCommands(p.id);
   if(this.stop.has(p.id)||commands.some(c=>c.projectId===p.id&&c.kind==='stop'&&!p.processedCommandIds.includes(c.id)))return;
   await this.composition?.afterCheckpoint?.(structuredClone(p),structuredClone(epoch));
  }catch{this.emit(p,'research.warning',{message:'Background learning registration failed; saved research is unchanged. Startup reconciliation will retry registration without replaying scientific calls or archives.'});}
 }
 start(id:string):Promise<void>{if(this.active.has(id))return Promise.reject(new Error('V2.1 writer is already active.'));this.stop.delete(id);this.pause.delete(id);const work=this.run(id).then(async()=>{this.resumeArchiveResearch(await this.store.loadProject(id));}).finally(()=>this.active.delete(id));this.active.set(id,work);return work;}
 async shutdown(){this.shuttingDown=true;for(const job of this.archiveResearch.values())job.bridge.cancel();await Promise.all([...this.active.keys()].map(id=>this.enqueue({id:`shutdown_${Date.now()}_${id}`,projectId:id,kind:'stop',payload:'Shutdown',createdAt:now()})));await Promise.allSettled([...this.active.values(),...[...this.archiveResearch.values()].map(j=>j.done)]);}
 private async newEpoch(p:ResearchProjectV21):Promise<InFlightEpochV21>{
  if(!this.composition)throw new Error('V2.1 composition requires the shared raw store and archive adapter.');
  // New V3 solves the immutable original directly; no duplicate model restatement is required.
  if(usesV3Proof(p.researchLoopVersion)&&!p.pendingModificationIds?.length)p.rootInterpretationPending=false;
  const commands=await this.controls(p),number=p.epoch+1,id=`${p.id}_epoch_${number}`,frozen=await this.store.freezeInputs(p),sources=await this.composition.freezeSources({...p,sources:frozen.sources,contentRevision:frozen.contentRevision});
  for(const source of sources)if(source.bodyHash!==digestV21(source.body)||!frozen.sources.some(ref=>isDeepStrictEqual(ref,source.ref)))throw new Error('Frozen source bytes or exact revision mismatch.');
  if(frozen.sources.some(ref=>!sources.some(s=>isDeepStrictEqual(ref,s.ref))))throw new Error('A required frozen source body is missing.');
  const hadPendingModifications=!!p.pendingModificationIds?.length;
  const planningSelection=selectPlanningInputs(p,commands,id);
  const classify=p.researchLoopVersion==='4.0'?!!planningSelection.hypothesisCommandId:hadPendingModifications;
  if(p.researchLoopVersion==='4.0'&&!classify)p.rootInterpretationPending=false;
  const catalog=usesV3Proof(p.researchLoopVersion)&&!classify?await this.composition.freezeCatalogBoundaryV3?.(p):undefined;
  const directed=p.researchLoopVersion==='4.0';
  const boundary=catalog?.boundary??(directed?undefined:await this.composition.readBoundary?.(p)),resources=boundary?[...boundary.skills,...boundary.strategies].map(r=>({id:r.id,version:r.version})):directed?[]:await this.composition.selectResources?.(p)??[];
  // Explicit user modifications retain the established classification-only root-change boundary.
  const modes=classify?{...(usesV3Proof(p.researchLoopVersion)?{rootIdentityRecipe:'host-root-identity-v1' as const}:{}),promptRevision:'categorized-v1' as const,theoristMode:'judgment-batch-v1' as const,controlMode:'compact-v1' as const,planningMode:'route-choice-v1' as const,reviewMode:'interface-v1' as const}:{solverMode:OPTIONAL_MODE_V21};
  const m:InFlightEpochV21={...modes,...('solverMode'in modes?{optionalFlow:initialOptionalFlowV21(p.researchLoopVersion==='4.0'?'v4-proof-5':usesV3Proof(p.researchLoopVersion)?'v3-operation-6':'v21-operation-9')}:{}),schemaVersion:3,loop:projectPin(p),projectId:p.id,epoch:number,phase:'planning',sealed:false,snapshot:{...modes,...(p.rootInterpretationPending!==undefined?{rootInterpretationPending:p.rootInterpretationPending}:{}),id,number,root:structuredClone(p.root),inputRevision:frozen.contentRevision,sources:structuredClone(sources),resources:structuredClone(resources),...(boundary?{resourceCatalog:structuredClone([...boundary.skills,...boundary.strategies])}:{}),decision:structuredClone(boundary?.decision??defaultDecision(2)),modelConfig:{...(p.config.defaultModel?{defaultModel:p.config.defaultModel}:{}),...(p.config.roleModels?{roleModels:p.config.roleModels}:{})},config:structuredClone(p.config),startedAt:now()},tasks:[],calls:[],answers:[],archives:[],loadedResources:[],startedAt:now(),planningSelection};
  if(usesV3Proof(p.researchLoopVersion)){if(p.researchLoopVersion==='4.0'){m.snapshot.theoryRevision='v4-operation-5';m.snapshot.knowledgeNetworkRevision='knowledge-network-v1';m.snapshot.knowledgeMapRevision='dual-cluster-map-v1';m.snapshot.knowledgeMapPresentation='layered-map-v1';m.snapshot.nativeHandoff='native-handoff-v1';m.snapshot.modelDirectedKnowledge=true;m.snapshot.inquiryGuidance='theorist-prior-v3';m.snapshot.mapGapPolicy='reviewed-domain-v1';m.snapshot.scientificMapWrites=true;m.snapshot.mapNodeWriting='structured-map-v2';m.snapshot.theoremAuthoring=true;m.snapshot.contextCompaction='staged-context-v1';m.snapshot.lemmaGrouping=true;m.snapshot.resultContract='scoped-refutation-v1';}m.snapshot.resourceMetadataRecipe='strategy-support-v1';m.snapshot.config=freezeCapacityConfigV3(p.researchLoopVersion==='4.0'?{...p.config,budgetControlEnabled:false}:p.config);m.snapshot.capacityPolicy=structuredClone(m.snapshot.config.roleBudget.capacityPolicy!);m.snapshot.modelConfig=modelConfigV3(m.snapshot.config);}
  if(directed)m.snapshot.discussion=freezeDiscussionV4(p,planningSelection,commands,this.composition,m.snapshot.contextCompaction==='staged-context-v1');
  if(catalog&&m.optionalFlow){m.snapshot.v3={...freezeContextV3(m.snapshot.root,m.snapshot.resourceCatalog??[],freezeKnowledgeV3(catalog.nodes,catalog.edges,catalog.pin.indexHash,'authority-navigation-v2'),catalog.pin,directed),catalogPin:catalog.pin,catalogNodeIds:catalog.nodes.map(n=>n.id),...(catalog.methodNetwork?{methodNetwork:structuredClone(catalog.methodNetwork)}:{})};m.optionalFlow.v3=initialFlowV3(m.snapshot.v3);}
  let preloadBudget=BATCH_CONTEXT_V21.planningBytes; m.snapshot.resourceBodies=[];
  if(resources.length&&!this.composition.readResource)throw new Error('Exact resource reader is required for consolidated planning.');
  for(const ref of (catalog?.methodNetwork?[]:resources)){const resource=await this.composition.readResource!(ref,{...p,activeEpoch:m});const meta=m.snapshot.resourceCatalog?.find(r=>r.id===ref.id&&r.version===ref.version);if(!meta||!isDeepStrictEqual(resource.meta,meta)||!resource.meta.enabled||resource.meta.status!=='valid')throw new Error('Frozen resource metadata changed during preload.');const bytes=Buffer.byteLength(resource.body);if(m.solverMode===OPTIONAL_MODE_V21||bytes<=BATCH_CONTEXT_V21.sourceOrResourceBytes&&bytes<=preloadBudget){m.snapshot.resourceBodies.push({ref:structuredClone(ref),body:resource.body,bodyHash:digestV21(resource.body)});preloadBudget-=bytes;}}
  if(usesV3Proof(p.researchLoopVersion)&&m.optionalFlow&&!catalog){m.snapshot.v3=freezeContextV3(m.snapshot.root,m.snapshot.resourceCatalog??[],directed?undefined:await this.composition.readKnowledgeV3?.(p),undefined,directed);m.optionalFlow.v3=initialFlowV3(m.snapshot.v3);}
  if(!directed&&m.snapshot.knowledgeMapRevision&&m.snapshot.v3){
   const context=m.snapshot.v3,nodes=context.knowledge.nodes.filter(n=>['goal','method','way-skill','strategy','precondition','operation','version'].includes(n.kind)),ids=new Set(nodes.map(n=>n.id));
   context.knowledge=freezeKnowledgeV3(nodes,context.knowledge.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),context.knowledge.version,context.knowledge.retrievalRevision);
   context.catalogNodeIds=context.catalogNodeIds?.filter(id=>ids.has(id));context.retrieval=retrieveKnowledgeV3(context.knowledge,{query:m.snapshot.root.originalText,maxNodes:12,maxHops:1,maxChars:8192});
  }
  m.loadedResources=m.snapshot.resourceBodies.map(r=>structuredClone(r.ref));
  markPlanningInputs(p,m.planningSelection!);p.status='running';p.phase='planning';p.startedAt??=now();
  await this.save(m);Object.assign(p,this.store.commitPlanningCheckpoint?await this.store.commitPlanningCheckpoint(p,m):await this.store.commitCheckpoint(p));return m;
 }
 private spec(p:ResearchProjectV21,m:InFlightEpochV21,id:string,deliveries:AnswerDeliveryV21[],brief?:FrozenQuestionV21):AgentSessionSpecV21 {
  const role=brief?'worker':'theorist',model=brief?.model??m.snapshot.modelConfig.roleModels?.[role]??m.snapshot.modelConfig.defaultModel;
  const grants:RawAnswerGrantV21[]=[...p.answers,...m.answers].map(a=>({readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.answerRef}));
  return {id,projectId:p.id,loop:projectPin(p),contractVersion:'2.1',role,...(model?{model:structuredClone(model)}:{}),budget:structuredClone(brief?.budget??foregroundBudgetV4(m.snapshot)),context:brief?{brief:structuredClone(brief)}:{project:structuredClone(p),snapshot:structuredClone(m.snapshot),marker:structuredClone(m),grants,deliveries:structuredClone(deliveries)}};
 }
 private async invoke(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,deliveries:AnswerDeliveryV21[]=[],brief?:FrozenQuestionV21):Promise<unknown>{
  if(call.status==='denied')throw new RuntimeError('INSUFFICIENT_PERMISSION');
  if(call.task==='v21_plan'||call.task==='v21_check'){const op=createOperationV21(call.task,call.input,{project:p,marker:m,deliveries},call.operation?.revision);if(!call.operation||!isDeepStrictEqual(op.pin,call.operation))throw new Error('Frozen control operation pin mismatch.');}
  if(call.status==='completed'){if(call.loadedResources)m.loadedResources=structuredClone(call.loadedResources);if(call.answerDeliveries)deliveries.push(...structuredClone(call.answerDeliveries));return structuredClone(call.result);}
  const spec=this.spec(p,m,`${call.id}_session`,deliveries,brief),inv:AgentInvocationV21={task:call.task,input:structuredClone(call.input),...(call.operation?{operation:call.operation}:{}),recoveryGeneration:call.recoveryGeneration};
  if(call.status==='pending'||call.status==='uncertain'){
   if(!this.runtime.reconcileV21)throw new Error('V2.1 call outcome requires durable runtime reconciliation.');
   const state=await this.runtime.reconcileV21(spec,inv);if(state.status==='completed'){if(state.systemChangeSkipped)call.systemChangeSkipped=true;if(state.loadedResources)m.loadedResources=structuredClone(state.loadedResources);if(state.answerDeliveries)deliveries.push(...structuredClone(state.answerDeliveries));call.loadedResources=structuredClone(m.loadedResources??[]);call.answerDeliveries=structuredClone(deliveries);call.result=state.result;call.status='completed';await this.save(m);return structuredClone(state.result);}if(state.status==='denied'){call.status='denied';await this.save(m);throw new RuntimeError('INSUFFICIENT_PERMISSION');}if(state.status!=='not-started')throw new Error('V2.1 call remains uncertain; no model replay was made.');
  }
  if(await this.halted(p))throw new Error('V2.1 dispatch stopped before admission.');
  call.status='pending';await this.save(m);
  if(await this.halted(p))throw new Error('V2.1 dispatch stopped before runtime admission; reconcile durable runtime journal before continuing.');
  const session=await this.runtime.createSession(spec);
  try{const result=await this.runtime.invoke(session,inv);if(this.runtime.systemChangeSkipped?.(session))call.systemChangeSkipped=true;call.result=structuredClone(result);call.status='completed';call.usage=this.runtime.getUsage?.(session);
   const loaded=this.runtime.loadedResourceRefs?.(session)??[];m.loadedResources=[...new Map([...(m.loadedResources??[]),...loaded].map(r=>[`${r.id}:${r.version}`,{id:r.id,version:r.version}])).values()];
   for(const delivery of this.runtime.loadedAnswerDeliveries?.(session)??[])if(!deliveries.some(d=>isDeepStrictEqual(d,delivery)))deliveries.push(delivery);
   call.loadedResources=structuredClone(m.loadedResources??[]);call.answerDeliveries=structuredClone(deliveries);await this.save(m);return result;
  }catch(error){if(this.runtime.systemChangeSkipped?.(session))call.systemChangeSkipped=true;call.status=error instanceof RuntimeError && error.code==='INSUFFICIENT_PERMISSION'?'denied':'uncertain';await this.save(m);throw error;}finally{await this.runtime.closeSession(session);}
 }
 private controlCall(p:ResearchProjectV21,m:InFlightEpochV21,task:'v21_plan'|'v21_check',input:unknown,deliveries:AnswerDeliveryV21[]):CallV21 {
  const existing=m.calls.find(c=>c.task===task);if(existing)return existing;
  const discussion=m.snapshot.discussion;
  const history=task==='v21_plan'&&m.snapshot.contextCompaction&&discussion?.revision==='public-discussion-v2'?prepareDiscussionCall(p,discussion,this.composition):undefined;
  if(history)input={...(input as object),discussion:history.view};
  const operation=createOperationV21(task,input,{project:p,marker:m,deliveries});const call:CallV21={...(history?{discussionUpdates:history.updates}:{}),id:`${m.snapshot.id}_${task}`,task,status:'not-started',input:structuredClone(input),inputHash:digestV21(input),operation:operation.pin,recoveryGeneration:0};m.calls.push(call);return call;
 }
 private async plan(p:ResearchProjectV21,m:InFlightEpochV21){
  if(!m.plan){const call=this.controlCall(p,m,'v21_plan',projectPlanView(p,m),[]),result=await this.invoke(p,m,call);m.plan=validatePlanOutput({project:p,marker:m,deliveries:[]},result as PlanOutputV21,{initialInterpretation:['v21-operation-4','v21-operation-6','v21-operation-7'].includes(call.operation?.revision??'')});await this.save(m);}
  const plan=m.plan;
  if(m.rootIdentityRecipe)validateRootIdentity(plan,{project:p,marker:m,deliveries:[]});
  if(usesV3Proof(p.researchLoopVersion)&&!m.optionalFlow&&(!plan.rootChange||plan.questions.length||plan.ways.length))throw new Error('V3 modification boundary may only classify and commit an explicit root change; science continues at a new frozen V3 boundary.');
  if(plan.rootInterpretation){m.snapshot.root=interpretedRootV21(m.snapshot.root,plan.rootInterpretation);p.root=structuredClone(m.snapshot.root);p.rootInterpretationPending=false;}
  if(plan.rootChange){if(plan.rootChange.kind!=='working'&&p.rootInterpretationPending===true)p.rootInterpretationPending=false;p.root=structuredClone(plan.rootChange.root);p.hypothesis=p.root.originalText;p.hypothesisId=p.root.hypothesisId;p.hypothesisRevision=p.root.revision;}
  for(const w of plan.ways){const i=p.ways.findIndex(old=>old.id===w.id);if(i<0)p.ways.push(structuredClone(w));else p.ways[i]=structuredClone(w);}
  for(const q of plan.questions){const i=p.questions.findIndex(old=>old.id===q.id);if(i<0)p.questions.push(structuredClone(q));else p.questions[i]=structuredClone(q);}
  if(m.planningSelection)finishPlanningInputs(p,m.planningSelection,p.hypothesisRevision);
  if(!m.sealed){for(const q of plan.questions){
   const task={id:`${m.snapshot.id}_${q.id}`,questionId:q.id,questionRevision:q.revision,state:q.allocation==='defer'?'blocked' as const:'ready' as const,...(q.allocation==='defer'?{blockReason:q.reason}:{})};
   if(q.allocation==='defer'){m.tasks.push(task);continue;}
   const way=p.ways.find(w=>w.id===q.wayId)!;const decisions=latestDecisions(p);const grants:RawAnswerGrantV21[]=[],premises:FrozenQuestionV21['premises']=[];
   for(const id of q.adoptedAnswerIds){const answer=p.answers.find(a=>a.id===id)!,decision=decisions.get(id)!;if(!answer||decision?.status!=='adopted')throw new Error('Frozen premise adoption changed.');const grant:RawAnswerGrantV21={readerProjectId:p.id,readerRole:'worker',purpose:'adopted-premise',ref:answer.answerRef};grants.push(grant);premises.push({answer:structuredClone(answer),decision:structuredClone(decision),body:await this.composition!.rawAnswers.read(answer.answerRef,grant)});}
   const sources=m.snapshot.sources.filter(s=>q.sourceIds.includes(s.ref.id)),resourceBodies:NonNullable<FrozenQuestionV21['resourceBodies']>=[];for(const ref of way.resourceRefs){if(!this.composition!.readResource)throw new Error('Selected resource exact body reader is unavailable.');const resource=await this.composition!.readResource(ref,{...p,activeEpoch:m});if(resource.meta.id!==ref.id||resource.meta.version!==ref.version||!resource.meta.enabled||resource.meta.status!=='valid')throw new Error('Selected frozen resource is unavailable or revoked.');const preloaded=m.snapshot.resourceBodies?.find(r=>isDeepStrictEqual(r.ref,ref));if(preloaded&&(preloaded.body!==resource.body||preloaded.bodyHash!==digestV21(resource.body)))throw new Error('Preloaded resource bytes changed.');resourceBodies.push(preloaded?structuredClone(preloaded):{ref:structuredClone(ref),body:resource.body,bodyHash:digestV21(resource.body)});}const science=scientificInputsV21(m.snapshot.root,q,way,sources,premises,resourceBodies);
   const base={...(m.promptRevision?{promptRevision:m.promptRevision}:{}),projectId:p.id,epochId:m.snapshot.id,attemptId:`${task.id}_attempt_1`,callId:`${task.id}_answer_1`,root:m.snapshot.root,way,question:q,inputRevision:m.snapshot.inputRevision,brief:JSON.stringify({root:m.snapshot.root,question:q,sources,premises,resourceBodies,conditionalInterfaces:q.conditionalInterfaces,interfaceUses:q.interfaceUses}),sources,premises,grants,conditionalInterfaces:q.conditionalInterfaces,interfaceUses:q.interfaceUses,adoptedAnswerIds:q.adoptedAnswerIds,resources:way.resourceRefs,resourceBodies,strategy:plan.strategy,decision:JSON.stringify(m.snapshot.decision),...((m.snapshot.modelConfig.roleModels?.worker??m.snapshot.modelConfig.defaultModel)?{model:m.snapshot.modelConfig.roleModels?.worker??m.snapshot.modelConfig.defaultModel}:{}),effort:q.effort,budget:m.snapshot.config.workerBudgets[q.effort],scientificInputHash:digestV21(science)};
   const frozen:FrozenQuestionV21=structuredClone({...base,inputHash:digestV21(base)});m.tasks.push({...task,frozen});
   m.calls.push({id:frozen.callId,task:'v21_worker_answer',status:'not-started',input:structuredClone(frozen),inputHash:digestV21(frozen),recoveryGeneration:0});
  }m.sealed=true;}
  m.phase='executing';p.phase='executing';p.epoch=m.epoch;await this.save(m);Object.assign(p,await this.store.commitCheckpoint(p));
 }
 private async execute(p:ResearchProjectV21,m:InFlightEpochV21){
  const queue=m.tasks.filter(t=>t.frozen&&t.state!=='completed'&&t.state!=='failed'&&t.state!=='interrupted');let cursor=0;const errors:unknown[]=[];
  const worker=async()=>{for(;;){if(await this.halted(p))return;const task=queue[cursor++];if(!task)return;const frozen=task.frozen!,call=m.calls.find(c=>c.id===frozen.callId)!;task.state='running';await this.save(m);this.emit(p,'worker.status',{taskId:task.id,status:task.state});try{const answer=parseWorkerAnswer(await this.invoke(p,m,call,[],frozen));if(answer.callId!==frozen.callId||answer.inputHash!==frozen.inputHash||answer.questionRevision!==frozen.question.revision)throw new Error('Worker result changed immutable identity.');task.answer=answer;task.state=answer.executionStatus==='completed'?'completed':answer.executionStatus;if(!m.answers.some(a=>a.id===answer.id))m.answers.push(answer);await this.save(m);this.emit(p,'worker.status',{taskId:task.id,status:task.state});}catch(error){errors.push(error);return;}}};
  await Promise.all(Array.from({length:Math.min(m.snapshot.config.maxWorkers,queue.length)},worker));if(errors.length&&!this.stop.has(p.id)&&!this.pause.has(p.id))throw new AggregateError(errors,'V2.1 calls require recovery.');
 }
 private async check(p:ResearchProjectV21,m:InFlightEpochV21){
  if(m.review)return;
  const prior=latestDecisions(p),entries:{ref:AnswerDeliveryV21['answerRef'];body:string}[]=[];for(const a of [...new Map([...p.answers,...m.answers].map(a=>[a.id,a])).values()].filter(a=>m.answers.some(x=>x.id===a.id)||prior.get(a.id)?.status!=='adopted'||prior.get(a.id)?.answerHash!==a.bodyHash||prior.get(a.id)?.questionRevision!==a.questionRevision)){const grant:RawAnswerGrantV21={readerProjectId:p.id,readerRole:'theorist',purpose:'review',ref:a.answerRef};entries.push({ref:a.answerRef,body:await this.composition!.rawAnswers.read(a.answerRef,grant)});}
  const deliveries:AnswerDeliveryV21[]=batchModeV21(m)?batchAnswerDeliveriesV21(p,m,entries):entries.map(({ref,body})=>m.reviewMode==='interface-v1'?makeAnswerPrefix(ref,body):makeAnswerDelivery(ref,body,'full-original'));
  m.phase='checking';p.phase='checking';await this.save(m);this.emit(p,'epoch.phase');
  const call=this.controlCall(p,m,'v21_check',projectCheckView(p,m,deliveries),deliveries);
  const result=await this.invoke(p,m,call,deliveries);m.check=validateCheckOutput({project:p,marker:m,deliveries},result as CheckOutputV21,{legacyTags:!['v21-operation-3','v21-operation-4','v21-operation-5','v21-operation-6','v21-operation-7'].includes(call.operation?.revision??'')});
  const old=latestDecisions(p),changed=m.check.decisions.filter(d=>old.has(d.answerId)&&(old.get(d.answerId)?.adoptionHash!==d.adoptionHash||old.get(d.answerId)?.status!==d.status)).map(d=>d.answerId),invalidated=invalidatedDependentsV21([...old.values()],changed).filter(id=>!m.check!.decisions.some(d=>d.answerId===id));
  m.review={...(m.promptRevision?{promptRevision:m.promptRevision}:{}),...(m.theoristMode?{theoristMode:m.theoristMode}:{}),...(call.operation?{operationRevision:call.operation.revision}:{}),id:`${m.snapshot.id}_review`,epochId:m.snapshot.id,hypothesisId:m.snapshot.root.hypothesisId,hypothesisRevision:m.snapshot.root.revision,scientificInputHash:digestV21({root:m.snapshot.root,answers:m.answers.map(a=>a.scientificInputHash)}),...(m.controlMode?{controlMode:m.controlMode}:{}),...(m.planningMode?{planningMode:m.planningMode}:{}),...(m.reviewMode?{reviewMode:m.reviewMode}:{}),decisions:[...new Map([...old.values(),...m.check.decisions].filter(d=>!invalidated.includes(d.answerId)).map(d=>[d.answerId,d])).values()],answerDeliveries:deliveries,cachedAnswerDeliveries:p.reviews.filter(r=>r.hypothesisId===m.snapshot.root.hypothesisId&&r.hypothesisRevision===m.snapshot.root.revision&&r.reviewMode===m.reviewMode).flatMap(r=>r.answerDeliveries).filter(d=>!deliveries.some(x=>x.answerRef.id===d.answerRef.id)&&!invalidated.includes(d.answerRef.id)&&old.get(d.answerRef.id)?.status==='adopted').map(({body:_body,...d})=>d),deliveredAnswerRefs:deliveries.filter(d=>d.kind==='full-original').map(d=>d.answerRef),cachedAnswerRefs:p.reviews.filter(r=>r.hypothesisId===m.snapshot.root.hypothesisId&&r.hypothesisRevision===m.snapshot.root.revision).flatMap(r=>r.deliveredAnswerRefs).filter(ref=>!deliveries.some(d=>d.answerRef.id===ref.id)&&!invalidated.includes(ref.id)&&old.get(ref.id)?.status==='adopted'),invalidatedAnswerIds:invalidated,closures:m.check.closures,createdAt:now(),...(m.check.failures?{failures:m.check.failures}:{}),...(m.check.decisionOpportunity?{decisionOpportunity:m.check.decisionOpportunity}:{})};await this.save(m);
 }
 private async archive(p:ResearchProjectV21,m:InFlightEpochV21){if(!m.review)return;await this.composition!.invalidateReviewedEvidence?.({...p,answers:[...p.answers,...m.answers],activeEpoch:m},m.review);m.phase='archiving';p.phase='archiving';
  for(const closure of m.review.closures){let receipt=m.archives.find(a=>a.wayId===closure.wayId);if(receipt?.status==='saved')continue;
   if(!receipt){const way=p.ways.find(w=>w.id===closure.wayId)!,expectedRevision=await this.composition!.expectedArchiveRevision?.(p,way);const selection:ArchiveSelectionV21={operationId:`${m.snapshot.id}_archive_${way.id}_${way.revision}`,projectId:p.id,epochId:m.snapshot.id,wayId:way.id,wayRevision:way.revision,root:m.snapshot.root,methodKey:way.methodKey,answers:closure.answerIds.map(id=>[...p.answers,...m.answers].find(a=>a.id===id)!.answerRef),review:m.review,closure,conditions:closure.conditions,tags:closure.tags,outline:closure.outline,...(expectedRevision!==undefined?{expectedRevision}:{})};receipt={operationId:selection.operationId,wayId:way.id,selectionHash:stableHash(selection),status:'pending',selection,retries:0};m.archives.push(receipt);await this.save(m);}
   try{const saved=await this.composition!.archiveWay(structuredClone(receipt.selection));if(saved.status!=='saved'||!saved.proofRef||saved.operationId!==receipt.operationId)throw new Error('Archive did not return a confirmed exact proof receipt.');Object.assign(receipt,saved);await this.save(m);}catch(error){receipt.retries++;receipt.error='Archive requires reconciliation; scientific closure and originals retained.';await this.save(m);throw error;}
  }
 }
 private async finish(p:ResearchProjectV21,m:InFlightEpochV21):Promise<ResearchProjectV21>{
  await this.controls(p);if(this.stop.has(p.id)||this.pause.has(p.id)){await this.save(m);p.status=this.stop.has(p.id)?'stopped':'paused';p.phase='idle';return this.store.commitCheckpoint(p);}const decision=this.stop.has(p.id)?'stop':this.pause.has(p.id)?'pause':m.check?.decision??'continue';
  for(const a of m.answers)if(!p.answers.some(old=>old.id===a.id))p.answers.push(a);if(m.review&&!p.reviews.some(r=>r.id===m.review!.id))p.reviews.push(m.review);
  for(const wd of m.check?.wayDecisions??[]){const way=p.ways.find(w=>w.id===wd.wayId);if(way)way.utilityStatus=wd.status;}
  const {schemaVersion:_schema,loop:_loop,...record}=structuredClone(m);const epoch:EpochRecordV21={...record,id:m.snapshot.id,completedAt:now(),decision,reason:m.check?.reason??(decision==='stop'?'User STOP preserved in-flight results.':'Boundary preserved.')};
  if(!p.epochs.some(e=>e.id===epoch.id))p.epochs.push(epoch);p.epoch=m.epoch;p.summary=m.check?.summary??p.summary;p.phase='idle';p.status=decision==='stop'?'stopped':decision==='complete'?'completed':decision==='pause'?'paused':'running';delete p.activeEpoch;delete p.lastError;
  const saved=await this.store.commitCheckpoint(p);await this.store.clearInFlight(p.id);if(!epoch.foregroundCompletedAt){epoch.foregroundCompletedAt=now();saved.epochs=saved.epochs.map(e=>e.id===epoch.id?epoch:e);Object.assign(saved,await this.store.commitCheckpoint(saved));}this.emit(saved,'checkpoint.committed');await this.registerLearning(saved,epoch);return saved;
 }
 private async retireDeniedBoundary(p:ResearchProjectV21,m:InFlightEpochV21):Promise<void>{
  const denied=new RuntimeError('INSUFFICIENT_PERMISSION');
  const commands=await this.controls(p);
  const fresh=commands.some(c=>c.kind==='refine' && p.commandStates?.[c.id]?.status==='pending' && !m.planningSelection?.commandIds.includes(c.id));
  const flow=m.optionalFlow;
  if(!fresh || this.stop.has(p.id) || this.pause.has(p.id)
   || m.calls.some(c=>c.status!=='denied' && c.status!=='completed')
   || flow?.branches.some(b=>b.state!=='completed' && b.state!=='cancelled')
   || flow?.pendingEffects?.some(effect=>effect.status==='pending')
   || flow?.archives.some(a=>a.status==='pending') || m.archives.some(a=>a.status==='pending'))throw denied;

  // The denied request already reached the model. Keep that selection and its reason
  // in history; commands arriving after selection remain pending for the new boundary.
  for(const id of m.planningSelection?.commandIds??[]){
   const state=p.commandStates?.[id];
   if(state?.status==='planning' && state.boundaryId===m.snapshot.id){state.status='rejected';state.message=denied.message;}
  }
  initializeCommandStates(p,commands);
  const {schemaVersion:_schema,loop:_loop,...record}=structuredClone(m);
  const retired:EpochRecordV21={...record,id:m.snapshot.id,completedAt:now(),decision:'stop',reason:denied.message};
  const index=p.epochs.findIndex(e=>e.id===retired.id);
  if(index<0)p.epochs.push(retired);else p.epochs[index]=retired;
  p.epoch=m.epoch;p.status='paused';p.phase='idle';delete p.lastError;
  Object.assign(p,await this.store.commitCheckpoint(p));
  await this.store.clearInFlight(p.id);
 }
 private async run(id:string){let p=await this.store.loadProject(id),m=await this.store.loadInFlight(id);try{
  if(!this.composition)throw new Error('Missing V2.1 composition.');
  if(m?.loop.researchLoopVersion==='4.0' && m.calls.some(c=>c.status==='denied')){await this.retireDeniedBoundary(p,m);m=undefined;}
  if(m&&!m.optionalFlow&&p.epochs.some(e=>e.id===m!.snapshot.id)){await this.store.clearInFlight(id);m=undefined;}
  if(m?.optionalFlow?.phase==='stopped'){const retiredRunner=new OptionalResearchRunnerV21(this.store,this.runtime,this.composition,{stopped:project=>this.stop.has(project.id),save:marker=>this.save(marker),halted:project=>this.halted(project),emit:(project,type,extra)=>this.emit(project,type,extra),registerLearning:(project,epoch)=>this.registerLearning(project,epoch)});await retiredRunner.collectStopped(p,m);const {schemaVersion:_schema,loop:_loop,...record}=structuredClone(m);const retired:EpochRecordV21={...record,id:m.snapshot.id,completedAt:now(),...(m.optionalFlow.foregroundCompletedAt?{foregroundCompletedAt:m.optionalFlow.foregroundCompletedAt}:{}),decision:'stop',reason:'Stopped optional boundary retained; explicit Start creates a fresh boundary without replaying its calls.'};const index=p.epochs.findIndex(e=>e.id===retired.id);if(index<0)p.epochs.push(retired);else p.epochs[index]=retired;p.epoch=m.epoch;p.status='paused';p.phase='idle';Object.assign(p,await this.store.commitCheckpoint(p));await this.store.clearInFlight(id);m=undefined;}
  for(;;){await this.controls(p);if(this.stop.has(id)||this.pause.has(id)){p.status=this.stop.has(id)?'stopped':'paused';p.phase='idle';if(m)await this.save(m);Object.assign(p,await this.store.commitCheckpoint(p));break;}
   m??=await this.newEpoch(p);if(m.solverMode===OPTIONAL_MODE_V21){const runner=new OptionalResearchRunnerV21(this.store,this.runtime,this.composition,{stopped:project=>this.stop.has(project.id),save:marker=>this.save(marker),halted:project=>this.halted(project),emit:(project,type,extra)=>this.emit(project,type,extra),registerLearning:(project,epoch)=>this.registerLearning(project,epoch)});this.optionalRunners.set(id,runner);try{p=await runner.run(p,m);this.resumeArchiveResearch(p,runner.archiveBridge(),m.snapshot.id);}finally{this.optionalRunners.delete(id);}break;}if(!m.sealed)await this.plan(p,m);else if(m.plan){if(m.plan.rootInterpretation){if(!isDeepStrictEqual(interpretedRootV21(p.root,m.plan.rootInterpretation),m.snapshot.root))throw new Error('Saved initial root interpretation conflicts with project identity.');p.root=structuredClone(m.snapshot.root);p.rootInterpretationPending=false;}for(const w of m.plan.ways){const i=p.ways.findIndex(x=>x.id===w.id);if(i<0)p.ways.push(w);else p.ways[i]=w;}for(const q of m.plan.questions){const i=p.questions.findIndex(x=>x.id===q.id);if(i<0)p.questions.push(q);else p.questions[i]=q;}}
   if(m.plan?.rootChange){if(m.rootIdentityRecipe)validateRootIdentity(m.plan,{project:p,marker:m,deliveries:[]});p.root=structuredClone(m.plan.rootChange.root);p.hypothesis=p.root.originalText;p.hypothesisId=p.root.hypothesisId;p.hypothesisRevision=p.root.revision;if(m.plan.rootChange.kind!=='working'&&p.rootInterpretationPending===true)p.rootInterpretationPending=false;p=await this.finish(p,m);m=undefined;continue;}
   if(!m.review){await this.execute(p,m);if(!await this.halted(p))await this.check(p,m);}
   if(await this.halted(p)){p.status=this.stop.has(id)?'stopped':'paused';p.phase='idle';await this.save(m);Object.assign(p,await this.store.commitCheckpoint(p));break;}
   if(!await this.halted(p))await this.archive(p,m);const finishedCapacity=m.snapshot.capacityPolicy,finishedMaxEpochs=m.snapshot.config.maxEpochs;p=await this.finish(p,m);m=undefined;
   if(p.status!=='running')break;if(budgetControlsEnabledV3(finishedCapacity)&&p.epoch>=(finishedCapacity?finishedMaxEpochs:p.config.maxEpochs)){p.status='paused';p.summary+='\nConfigured Epoch boundary reached; continuation remains available.';await this.store.commitCheckpoint(p);break;}
  }this.emit(p,'research.finished');
 }catch(error){p.status=this.stop.has(id)?'stopped':'paused';p.lastError=error instanceof RuntimeError && ['INSUFFICIENT_PERMISSION','CONTEXT_EXHAUSTED'].includes(error.code)?error.message:'V2.1 recovery required. Frozen calls and original answers are preserved; no uncertain request was replayed.';if(m)await this.save(m);Object.assign(p,await this.store.commitCheckpoint(p));this.emit(p,'research.warning',{message:p.lastError});throw error;}}
}

/** Scientific cache identity excludes dispatch allocation, model, budgets and mutable locators. */
export function scientificInputsV21(root:FrozenQuestionV21['root'],question:FrozenQuestionV21['question'],way:FrozenQuestionV21['way'],sources:FrozenQuestionV21['sources'],premises:FrozenQuestionV21['premises'],resourceBodies:NonNullable<FrozenQuestionV21['resourceBodies']>):unknown {
 const {allocation:_allocation,effort:_effort,reason:_reason,...scientificQuestion}=question;
 return {root,question:scientificQuestion,method:{methodKey:way.methodKey,direction:way.direction,purpose:way.purpose,conditions:way.conditions,rootObligationIds:way.rootObligationIds},sources:sources.map(s=>({id:s.ref.id,revision:s.ref.revision,bodyHash:s.bodyHash,body:s.body})),premises:premises.map(p=>({bodyHash:p.answer.bodyHash,scientificInputHash:p.answer.scientificInputHash,adoptionHash:p.decision.adoptionHash,body:p.body})),resourceBodies};
}
