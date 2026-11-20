import { DeclarationSupplementError } from './declaration-supplement.js';
import {sameObservationEvidence} from '../research/versions/v4/map-evidence-schema.js';
import type {MapReader} from '../research/versions/v4/map-reader.js';
import type {MapOpenResult} from '../learning/knowledge-map.js';
import {decodeSafeToolArguments} from './safe-tool-arguments.js';
import {budgetControlsEnabledV3} from '../research/versions/v3/capacity-policy.js';
import {restoreGuidanceV3} from './v3-guidance.js';
import { isDeepStrictEqual } from 'node:util';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentInvocationV21, AgentSessionSpecV21, RawAnswerOwnerV21, RawAnswerStoreV21, TechnicalStateV21 } from '../research/contracts/v21.js';
import type { OptionalTheoristResultV21 } from '../research/versions/v21/optional-types.js';
import { createOptionalOperationV21, type OptionalOperationContractV21, type OptionalOperationContextV21 } from '../research/versions/v21/optional-operation.js';
import { digestV21 } from '../research/versions/v21/state.js';
import { V21AnswerCollector, type AnswerCaptureEvent } from './v21-answer.js';
import { OptionalProofControlV21, type OptionalRetainedV21 } from './v21-optional-control.js';
import { RuntimeError } from './errors.js';
import { SUBMIT_RESULT } from './stage-contract.js';
import type { OperationJournal } from './operation-journal.js';
import type { ResourceRef } from '../learning/research-data.js';
import type { ToolArgumentEvidence } from './tool-argument-audit.js';
export function optionalInvocationV21(invocation:AgentInvocationV21):boolean{return invocation.task==='v21_theorist'||invocation.task==='v21_optional_worker';}
export function optionalContextV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):OptionalOperationContextV21 {
 const input=invocation.input as {boundaryId:string};
 if('brief'in spec.context)return {brief:spec.context.brief,root:spec.context.brief.root,boundaryId:input.boundaryId};
 return {project:spec.context.project,marker:spec.context.marker,root:spec.context.marker.snapshot.root,boundaryId:input.boundaryId};
}
export function optionalOperationV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):OptionalOperationContractV21 {
 if(!optionalInvocationV21(invocation)||!invocation.operation)throw new RuntimeError('INVALID_CONFIGURATION');
 const operation=createOptionalOperationV21(invocation.task as 'v21_theorist'|'v21_optional_worker',invocation.input,optionalContextV21(spec,invocation),invocation.operation.revision);
 if(!isDeepStrictEqual(operation.pin,invocation.operation))throw new RuntimeError('INVALID_CONFIGURATION');return operation;
}
export function optionalOwnerV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):RawAnswerOwnerV21 {
 const context=optionalContextV21(spec,invocation),root=context.root,brief=context.brief,boundaryId=context.boundaryId;
 return {owner:spec.projectId,projectId:spec.projectId,epochId:brief?.epochId??context.marker!.snapshot.id,
  wayId:brief?.way.id??`${boundaryId}_main`,questionId:brief?.question.id??`root:${root.hypothesisId}`,
  questionRevision:brief?.question.revision??root.revision,attemptId:brief?.attemptId??boundaryId,callId:brief?.callId??boundaryId,
  hypothesisId:root.hypothesisId,hypothesisRevision:root.revision,inputHash:invocation.operation!.inputHash,
  scientificInputHash:brief?.scientificInputHash??digestV21(invocation.input),workerProtocolVersion:'2.1'};
}
export function optionalCallIdV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):string{return `${spec.projectId}:${invocation.task}:${invocation.operation!.inputHash}:${invocation.recoveryGeneration??0}`;}
export function optionalPinsV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21):unknown{return {...(spec.loop.researchLoopVersion==='4.0'?{theoryRevision:invocation.operation?.revision==='v4-proof-5'?'v4-operation-5':invocation.operation?.revision==='v4-proof-4'?'v4-operation-4':invocation.operation?.revision==='v4-proof-3'?'v4-operation-3':invocation.operation?.revision==='v4-proof-2'?'v4-operation-2':'v4-operation-1'}:{}),pin:invocation.operation,input:invocation.input,model:spec.model,budget:spec.budget,protocol:invocation.operation?.revision==='v4-proof-5'?'4.0-continuous-proof-5':invocation.operation?.revision==='v4-proof-4'?'4.0-public-summary-4':invocation.operation?.revision==='v4-proof-3'?'4.0-host-stage-3':invocation.operation?.revision==='v4-proof-2'?'4.0-canonical-fragments-2':invocation.operation?.revision==='v3-operation-6'?'3.0-incremental-original-6':['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'')?'3.0-incremental-original-5':invocation.operation?.revision==='v3-operation-4'?'3.0-incremental-original-4':invocation.operation?.revision==='v3-operation-3'?'3.0-incremental-original-3':invocation.operation?.revision==='v3-operation-2'?'3.0-incremental-original-2':invocation.operation?.revision==='v3-operation-1'?'3.0-incremental-original-1':invocation.operation?.revision==='v21-operation-9'?'2.1-optional-original-2':'2.1-optional-original-1'};}
export async function validateOptionalResultV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21,result:unknown,raw:RawAnswerStoreV21,resources?:ResourceRef[],deliveries?:import('../research/contracts/v21.js').AnswerDeliveryV21[],mapKnowledge?:MapOpenResult[],mapWriteReads?:MapOpenResult[]):Promise<OptionalTheoristResultV21> {
 const r=result as OptionalTheoristResultV21,owner=optionalOwnerV21(spec,invocation),mapEnabled=('brief'in spec.context?spec.context.brief.knowledgeMapRevision:spec.context.snapshot.knowledgeMapRevision)==='dual-cluster-map-v1';
 if(!r||!r.originalRef||!r.technical||Object.keys(r).some(key=>!['control','originalRef','technical',...(mapEnabled?['mapKnowledge']:[]),...(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'')?['v3Execution']:[])].includes(key))||Object.entries(owner).some(([key,value])=>(r.originalRef as unknown as Record<string,unknown>)[key]!==value)||r.originalRef.completeness!=='complete'||r.technical.completeness!=='complete'||r.technical.executionStatus!=='completed'||!r.originalRef.byteLength)throw new RuntimeError('INVALID_CONFIGURATION');
 const directed='brief'in spec.context?spec.context.brief.modelDirectedKnowledge:spec.context.snapshot.modelDirectedKnowledge;
 if(directed)for(const saved of r.mapKnowledge??[])if(saved.kind==='observation'&&r.control.outcome.knowledgeRefs?.includes(saved.selection)&&!mapKnowledge?.some(current=>sameObservationEvidence(saved,current)))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
 if(directed)for(const saved of r.mapKnowledge??[])if(saved.basis&&r.control.outcome.knowledgeRefs?.includes(saved.selection)&&!mapKnowledge?.some(current=>current.selection===saved.selection&&isDeepStrictEqual(current.basis,saved.basis)))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
 const body=await raw.read(r.originalRef,{readerProjectId:spec.projectId,readerRole:'theorist',purpose:'review',ref:r.originalRef});
 const operation=optionalOperationV21(spec,invocation);operation.observeEvidence({mapWriteReads,publicBody:body});if(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??''))operation.observeEvidence({...(mapEnabled?{mapKnowledge:mapKnowledge??[]}:{}),receipts:r.v3Execution?.receipts??[],...(r.v3Execution?.catalogPin?{catalogMaterials:r.v3Execution.catalogMaterials??[],knowledgeReads:r.v3Execution.knowledgeReads??[]}:{}),...(resources?{resources}:{}),...(deliveries?{deliveries}:{})});operation.validatePrepared(r.control);
 if(!body.trim())throw new RuntimeError('INVALID_CONFIGURATION');return structuredClone(r);
}
type SavedRow={kind:string;dispatch?:number;correction?:boolean;message?:AssistantMessage;event?:AnswerCaptureEvent;evidence?:ToolArgumentEvidence;owner?:RawAnswerOwnerV21;text?:string;technical?:TechnicalStateV21;declaration?:unknown;result?:unknown};
/** Finish persistence only. A pending/uncertain provider call is never replayed. */
export async function recoverOptionalResultV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21,journal:OperationJournal,raw:RawAnswerStoreV21,mapReader?:MapReader):Promise<OptionalTheoristResultV21|undefined> {
 if(journal.state.dispatches===0)return undefined;
 const v3=['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'');
 if(budgetControlsEnabledV3(spec.budget.capacityPolicy)&&journal.state.corrections>2||(!v3&&(journal.state.dispatches>3||journal.state.dispatches>journal.state.corrections+1)))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
 const rows=await journal.captured() as SavedRow[];
 const mapEnabled=('brief'in spec.context?spec.context.brief.knowledgeMapRevision:spec.context.snapshot.knowledgeMapRevision)==='dual-cluster-map-v1';
 if(mapEnabled&&!mapReader)throw new RuntimeError('INVALID_CONFIGURATION');
 const mapWriteReads='snapshot' in spec.context&&spec.context.snapshot.scientificMapWrites?[] as MapOpenResult[]:undefined;
 const mapKnowledge=mapReader?await mapReader.proofReferences(rows,mapWriteReads):undefined;
 const ready=rows.findLast(row=>row.kind==='v21-optional-result-ready');
 const persisted=journal.state.status==='completed'?journal.state.result:ready?.result;
 const resourceRows=rows as unknown as {kind:string;resources?:ResourceRef[];details?:{resourceRef?:ResourceRef;answerDelivery?:import('../research/contracts/v21.js').AnswerDeliveryV21}}[];
 const restoredGuidance=['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'')?restoreGuidanceV3(spec,rows):undefined;
 const resources=['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'')?restoreGuidanceV3(spec,rows).resources:resourceRows.flatMap(row=>row.kind==='v21-preloaded-resources'?row.resources??[]:row.kind==='effect-completed'&&row.details?.resourceRef?[row.details.resourceRef]:[]);
 const deliveries=[...resourceRows.flatMap(row=>row.kind==='effect-completed'&&row.details?.answerDelivery?[row.details.answerDelivery]:[]),...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(invocation.operation?.revision??'')?restoreGuidanceV3(spec,rows).deliveries:[])];
 if(persisted!==undefined){const result=await validateOptionalResultV21(spec,invocation,persisted,raw,v3?resources:undefined,v3?deliveries:undefined,mapKnowledge,mapWriteReads);
  if(v3){
   const evidence=rows as unknown as {kind:string;receipt?:unknown;ref?:string;full?:unknown}[];
   if(!result.v3Execution||result.v3Execution.modelRequests!==journal.state.dispatches)throw new RuntimeError('INVALID_CONFIGURATION');
   const base='brief'in spec.context?spec.context.brief.v3:spec.context.snapshot.v3;
   if(!isDeepStrictEqual(result.v3Execution.methodNetworkPin,base?.methodNetwork?.pin))throw new RuntimeError('INVALID_CONFIGURATION');
   if(base?.catalogPin){
    const materials=restoredGuidance?.catalogMaterials??[],known=new Set([...(base.catalogNodeIds??[]),...materials.map(m=>m.node.id)]);
    const reads=(restoredGuidance?.knowledgeReads??[]).filter(id=>known.has(id));
    if(!isDeepStrictEqual(result.v3Execution.catalogPin,base.catalogPin)||!isDeepStrictEqual(result.v3Execution.catalogNodeIds,base.catalogNodeIds??[])||!isDeepStrictEqual(result.v3Execution.catalogMaterials,materials)||!isDeepStrictEqual(result.v3Execution.knowledgeReads,reads))throw new RuntimeError('INVALID_CONFIGURATION');
   }else if(['catalogPin','catalogNodeIds','catalogMaterials','knowledgeReads'].some(key=>Object.hasOwn(result.v3Execution!,key)))throw new RuntimeError('INVALID_CONFIGURATION');
   const routeRows=(rows as unknown as {kind:string;instance?:unknown}[]).filter(row=>row.kind==='v3-route-instance').map(row=>row.instance);
   const uniqueRoutes=[...new Map(routeRows.map(value=>[(value as {id:string}).id,value])).values()];
   if(base?.methodNetwork?!isDeepStrictEqual(result.v3Execution.routeInstances,uniqueRoutes):result.v3Execution.routeInstances!==undefined)throw new RuntimeError('INVALID_CONFIGURATION');
   const savedReceipts=evidence.filter(row=>row.kind==='v3-operation-receipt').map(row=>row.receipt);
   if(!isDeepStrictEqual(savedReceipts,result.v3Execution.receipts)||new Set(result.v3Execution.receipts.map(r=>r.id)).size!==result.v3Execution.receipts.length||result.v3Execution.completedTools!==result.v3Execution.receipts.filter(r=>r.status==='completed').length)throw new RuntimeError('INVALID_CONFIGURATION');
   for(const receipt of result.v3Execution.receipts){
    if(!evidence.some(row=>row.kind==='v3-operation-receipt'&&isDeepStrictEqual(row.receipt,receipt))||!evidence.some(row=>row.kind==='v3-operation-artifact'&&row.ref===receipt.artifactRef&&(row.full as {receipt?:unknown})?.receipt&&isDeepStrictEqual((row.full as {receipt:unknown}).receipt,receipt)))throw new RuntimeError('INVALID_CONFIGURATION');
   }
  }if(journal.state.status!=='completed')await journal.complete(result);return result;}
 // V3 may have several scientific dispatches. Without its validated durable
 // ready receipt, never replay or synthesize a continuation after a crash.
 if(v3){
  if(!mapEnabled)return undefined;
  // Reconcile a completely received terminal declaration locally, never synthesize science or resend the provider.
  const last=rows.findLast(row=>row.kind==='v3-original-message'),intent=rows.find(row=>row.kind==='v21-optional-save-intent');
  const bounds='brief'in spec.context?spec.context.brief:spec.context.snapshot;
  const supplement=last?.correction&&bounds.inquiryGuidance==='theorist-prior-v3'&&journal.state.corrections===1;
  if(!last?.message||last.dispatch!==journal.state.dispatches||last.correction&&!supplement||last.message.stopReason!=='toolUse'||!intent?.technical||intent.technical.completeness!=='complete'||intent.technical.executionStatus!=='completed'||!intent.text||rows.some(row=>row.kind==='v21-optional-cancelled'))return undefined;
  const calls=last.message.content.filter(p=>p.type==='toolCall');if(calls.length!==1||calls[0]!.name!==SUBMIT_RESULT)return undefined;
  const terminal=calls[0]!,terminalIndex=last.message.content.findIndex(p=>p.type==='toolCall'&&p.id===terminal.id);
  if(last.message.content.slice(terminalIndex+1).some(p=>p.type!=='thinking'))return undefined;
  const argumentRows=rows.filter(row=>row.kind==='v21-optional-arguments'&&row.dispatch===last.dispatch&&row.evidence);
  if(argumentRows.length!==1)return undefined;const evidence=argumentRows[0]!.evidence!;
  if(evidence.toolCallId!==terminal.id||evidence.tool!==terminal.name||!isDeepStrictEqual(evidence.sdkArguments,terminal.arguments))return undefined;
  const declaration=decodeSafeToolArguments(evidence).value,savedDeclaration=rows.find(row=>row.kind==='v21-declaration-constraints')?.declaration;
  if(!supplement&&savedDeclaration!==undefined&&!isDeepStrictEqual(savedDeclaration,declaration))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
  const publicText=rows.filter(row=>row.kind==='v3-original-message'&&!row.correction).map(row=>row.message?.content.filter(p=>p.type==='text').map(p=>p.text).join('')??'').filter(Boolean).join('\n\n');
  if(publicText!==intent.text||!isDeepStrictEqual(intent.owner,optionalOwnerV21(spec,invocation)))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
  const retained=await recoverOptionalOriginalV21(spec,invocation,journal,raw);if(!retained)return undefined;
  const events=rows as unknown as {kind:string;receipt?:import('../research/versions/v3/operations.js').OperationReceiptV3;instance?:import('../research/versions/v3/route-instances.js').RouteInstanceV3}[],base='brief'in spec.context?spec.context.brief.v3:spec.context.snapshot.v3;
  const receipts=events.flatMap(r=>r.kind==='v3-operation-receipt'&&r.receipt?[r.receipt]:[]),materials=restoredGuidance?.catalogMaterials??[],known=new Set([...(base?.catalogNodeIds??[]),...materials.map(m=>m.node.id)]);
  const execution:import('../research/versions/v3/integration.js').V3Execution={receipts,modelRequests:journal.state.dispatches,toolDispatches:events.filter(r=>r.kind==='v3-execution-pending'||r.kind==='v3-route-instance').length,completedTools:receipts.filter(r=>r.status==='completed').length,...(base?.methodNetwork?{methodNetworkPin:base.methodNetwork.pin,routeInstances:[...new Map(events.flatMap(r=>r.kind==='v3-route-instance'&&r.instance?[[r.instance.id,r.instance] as const]:[])).values()]}:{}),...(base?.catalogPin?{catalogPin:base.catalogPin,catalogNodeIds:base.catalogNodeIds??[],catalogMaterials:materials,knowledgeReads:(restoredGuidance?.knowledgeReads??[]).filter(id=>known.has(id))}:{})};
  const operation=optionalOperationV21(spec,invocation);operation.observeEvidence({publicBody:intent.text,mapWriteReads,mapKnowledge,receipts,resources,deliveries,...(base?.catalogPin?{catalogMaterials:materials,knowledgeReads:execution.knowledgeReads}:{}),rootDelivered:restoredGuidance?.rootDelivered});
  let effective=declaration;
  if(supplement){
   if(last.message.content.some(p=>p.type==='text'&&p.text.length))return undefined;
   const messages=rows.filter(r=>r.kind==='v3-original-message'),previous=messages.at(-2);
   if(!previous?.message||previous.correction||previous.dispatch!==last.dispatch!-1)return undefined;
   const priorCalls=previous.message.content.filter(p=>p.type==='toolCall');
   if(priorCalls.length===1&&priorCalls[0]!.name===SUBMIT_RESULT){
    if(previous.message.stopReason!=='toolUse'||previous.message.content.slice(previous.message.content.indexOf(priorCalls[0]!)+1).some(p=>p.type!=='thinking'))return undefined;
    const priorEvidence=rows.filter(r=>r.kind==='v21-optional-arguments'&&r.dispatch===previous.dispatch&&r.evidence);
    if(priorEvidence.length!==1||priorEvidence[0]!.evidence!.toolCallId!==priorCalls[0]!.id||priorEvidence[0]!.evidence!.tool!==SUBMIT_RESULT||!isDeepStrictEqual(priorEvidence[0]!.evidence!.sdkArguments,priorCalls[0]!.arguments))return undefined;
    const first=decodeSafeToolArguments(priorEvidence[0]!.evidence!).value;
    if(!isDeepStrictEqual(savedDeclaration,first)||!rows.some(r=>r.kind==='v4-declaration-supplement'))return undefined;
    try{operation.prepare(first);return undefined;}catch(error){
     if(!(error instanceof DeclarationSupplementError))return undefined;
     effective=error.restore(first,declaration);
    }
   }else if(priorCalls.length||previous.message.stopReason!=='stop'||!rows.some(r=>r.kind==='v4-missing-declaration')||savedDeclaration!==undefined&&!isDeepStrictEqual(savedDeclaration,declaration))return undefined;
  }
  const result={...retained,control:operation.prepare(effective),v3Execution:execution,mapKnowledge};
  await validateOptionalResultV21(spec,invocation,result,raw,resources,deliveries,mapKnowledge,mapWriteReads);
  await journal.capture({kind:'v21-optional-local-terminal-reconciliation',terminalCallId:terminal.id,dispatch:last.dispatch});await journal.capture({kind:'v21-optional-result-ready',result});
  // Reuse the standard persisted-result audit before completing the local journal.
  return recoverOptionalResultV21(spec,invocation,journal,raw,mapReader);
 }

 if(rows.some(row=>row.kind==='v21-optional-cancelled'))return undefined;
 const first=rows.find(row=>row.kind==='v21-optional-message'&&!row.correction),last=rows.findLast(row=>row.kind==='v21-optional-message'&&row.dispatch===journal.state.dispatches&&row.message?.stopReason==='toolUse');
 if(!first?.message||!last?.message)return undefined;
 const captured=new V21AnswerCollector();for(const row of rows)if(row.kind==='v21-optional-text'&&row.event&&!captured.terminal)captured.restore(row.event);
 if(!captured.complete||!captured.text.trim())return undefined;
 const owner=optionalOwnerV21(spec,invocation),intent=rows.find(row=>row.kind==='v21-optional-save-intent');
 if(intent&&(!isDeepStrictEqual(intent.owner,owner)||intent.text!==captured.text||intent.technical?.completeness!=='complete'||intent.technical.executionStatus!=='completed'))throw new RuntimeError('INVALID_CONFIGURATION');
 const technical:TechnicalStateV21=intent?.technical??{executionStatus:'completed',completeness:'complete',stopReason:first.message.stopReason,usage:{turns:1,toolCalls:0,tokensKnown:false,costKnown:false}};
 const operation=optionalOperationV21(spec,invocation);
 const terminal:ToolDefinition={name:SUBMIT_RESULT,label:'Submit',description:'Recovered control',parameters:operation.schema,execute:async()=>{throw new RuntimeError('INVALID_CONFIGURATION');}};
 const control=new OptionalProofControlV21(journal,[terminal],operation.schema,value=>operation.prepare(value),async(text)=>{
  if(text!==captured.text)throw new RuntimeError('INVALID_CONFIGURATION');
  if(!intent)await journal.capture({kind:'v21-optional-save-intent',owner,text,technical});
  return {originalRef:await raw.save(owner,text,technical),technical};
 },()=>false);
 control.startDispatch();control.observe({type:'done',reason:first.message.stopReason as 'stop'|'length'|'toolUse',message:first.message});
 const declaration=rows.find(row=>row.kind==='v21-declaration-constraints');if(declaration?.declaration!==undefined)control.restoreDeclaration(declaration.declaration);
 control.correction=!!last.correction;
 for(const row of rows)if(row.kind==='v21-optional-arguments'&&row.dispatch===last.dispatch&&row.evidence)control.evidence.set(row.evidence.toolCallId,row.evidence);
 await control.prepareMessage(last.message);
 if(control.fatal||control.feedback)return undefined;
 const calls=last.message.content.filter(part=>part.type==='toolCall');
 if(calls.length!==1||calls[0].name!==SUBMIT_RESULT||!control.permits(calls[0].id))return undefined;
 await control.execute(terminal,[calls[0].id,calls[0].arguments,undefined,undefined,undefined] as unknown as Parameters<ToolDefinition['execute']>);
 return validateOptionalResultV21(spec,invocation,control.value,raw);
}

/** Exposes retained bytes even when no trustworthy scientific control exists. */
export async function recoverOptionalOriginalV21(spec:AgentSessionSpecV21,invocation:AgentInvocationV21,journal:OperationJournal,raw:RawAnswerStoreV21):Promise<OptionalRetainedV21|undefined> {
 const rows=await journal.captured() as SavedRow[],intent=rows.find(row=>row.kind==='v21-optional-save-intent');
 if(!intent?.technical||intent.text===undefined)return undefined;
 const owner=optionalOwnerV21(spec,invocation);
 if(!isDeepStrictEqual(intent.owner,owner))throw new RuntimeError('INVALID_CONFIGURATION');
 const originalRef=await raw.save(owner,intent.text,intent.technical);
 await raw.read(originalRef,{readerProjectId:spec.projectId,readerRole:'theorist',purpose:'review',ref:originalRef});
 return {originalRef,technical:structuredClone(intent.technical)};
}
