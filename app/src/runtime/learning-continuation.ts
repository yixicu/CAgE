import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ModelSelection } from '../research/contracts/v1.js';
import type { LearningCall, LearningResult } from './learning-task.js';
import type { LearningAttemptResult } from './learning-fallback.js';
import type { ToolArgumentEvidence } from './tool-argument-audit.js';
import type { GuidanceExposureV3 } from './v3-guidance.js';
import { OperationJournal } from './operation-journal.js';
import { stableHash } from '../learning/research-hash.js';
import { isSystemMaintenanceTool, RuntimeError, type RuntimeErrorCode } from './errors.js';

/** A trusted adapter must await these receipts. onPayload is NOT admission.
 * notAdmitted requires positive knowledge that nothing was published/sent. */
export interface LearningTransportAdmission {
  dispatchId: string;
  /** Call in the same synchronous step as queue visibility/network send. */
  assertCanAdmit(): void;
  admitted(receipt: {transport: string; requestId: string}): Promise<void>;
  notAdmitted(reason: string): Promise<void>;
}
const ADMISSION = Symbol.for('carnot.learning-admission.v1');
export function learningDispatchAdmission(options: unknown): LearningTransportAdmission | undefined {
  return options && typeof options === 'object' ? (options as {[ADMISSION]?:LearningTransportAdmission})[ADMISSION] : undefined;
}
export function bindLearningAdmission<T extends object>(options:T, admission:LearningTransportAdmission):T {
  return Object.assign(options,{[ADMISSION]:admission});
}
export interface LearningDispatchInput {
  messages: AgentMessage[]; context: TranscriptContext; model: unknown; maxTokens: number;
  evidence: ToolArgumentEvidence[]; exposure?: Omit<GuidanceExposureV3,'dispatch'>;
}
export interface LearningDispatch extends LearningDispatchInput {
  id:string; attempt:number; state:'preflight'|'not-admitted'|'unknown'|'admitted'|'complete';
  admission?:{transport:string;requestId:string}; reason?:string;
  response?:AssistantMessage; partialResponse?:AssistantMessage; payload?:unknown;
  effects:{id:string;tool:string;arguments:unknown;status:'pending'|'completed';result?:unknown}[];
}
interface SavedAttempt {call:LearningCall;result?:{output?:unknown;usage:LearningResult['usage'];errorCode?:RuntimeErrorCode}}
export interface LearningContinuationState {
  revision:'learning-continuation-1'; call:LearningCall; authorized:ModelSelection[]; startedAt:number;
  attempts:SavedAttempt[]; dispatches:LearningDispatch[]; result?:LearningResult;
}
export type LearningRecovery = {status:'known-unsent'|'resume-continuation'|'reconciliation-required'} | {status:'publish-output';result:LearningResult};
/** One immutable call claim plus atomic whole-checkpoint receipts. The durable
 * unknown transition precedes handing control to any transport. */
export class LearningContinuation {
  private constructor(private readonly journal:OperationJournal<LearningContinuationState>,readonly state:LearningContinuationState) {}
  private static key(call:LearningCall):string {return `learning:${call.id}:${call.continuationGeneration??0}`;}
  static async open(root:string,call:LearningCall,authorized:readonly ModelSelection[]):Promise<LearningContinuation> {
    const {journal,fresh}=await OperationJournal.begin<LearningContinuationState>(root,this.key(call),{revision:'learning-continuation-1',call});
    journal.acquire();
    try {
      if(!fresh&&!journal.state.result)throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
      const state=journal.state.result??{revision:'learning-continuation-1' as const,call:structuredClone(call),authorized:structuredClone([...authorized]),startedAt:Date.now(),attempts:[],dispatches:[]};
      const value=new LearningContinuation(journal,state);value.validate(call);await value.save();return value;
    } catch(error){journal.release();throw error;}
  }
  static async inspect(root:string,call:LearningCall):Promise<LearningRecovery> {
    const journal=await OperationJournal.inspect<LearningContinuationState>(root,this.key(call),{revision:'learning-continuation-1',call});
    if(!journal?.state.result||journal.isActive)return {status:'reconciliation-required'};
    const value=new LearningContinuation(journal,journal.state.result);value.validate(call);return value.recovery();
  }
  private validate(call:LearningCall):void {
    if(this.state.revision!=='learning-continuation-1'||stableHash(this.state.call)!==stableHash(call)||!Array.isArray(this.state.attempts)||!Array.isArray(this.state.dispatches))throw new RuntimeError('INVALID_CONFIGURATION');
    for(const [i,d] of this.state.dispatches.entries())if(d.id!==`${LearningContinuation.key(call)}:${i+1}`||!this.state.attempts[d.attempt]||!['preflight','not-admitted','unknown','admitted','complete'].includes(d.state)||d.state==='complete'&&!d.response||!Array.isArray(d.messages)||!Array.isArray(d.context?.messages)||!Array.isArray(d.effects))throw new RuntimeError('INVALID_CONFIGURATION');
  }
  release():void {this.journal.release();}
  private async save():Promise<void>{await this.journal.checkpoint(this.state);}
  recovery():LearningRecovery {
    if(this.state.result)return {status:'publish-output',result:structuredClone({...this.state.result,readResources:this.readResources()})};
    const d=this.state.dispatches.at(-1);
    if(!d)return {status:'known-unsent'};
    if(d.effects.some(e=>e.status!=='completed')||['unknown','admitted'].includes(d.state))return {status:'reconciliation-required'};
    return {status:d.state==='complete'||this.state.dispatches.length>1?'resume-continuation':'known-unsent'};
  }
  readResources():{id:string;version:number}[]{
    const ids=new Set<string>();
    for(const d of this.state.dispatches){
      if(d.response)for(const manifest of d.exposure?.manifests??[])ids.add(manifest.id);
      for(const e of d.effects)if(e.status==='completed'&&e.tool==='read_research_resource'){
        const page=(e.result as {details?:{guidancePage?:{id:string}}})?.details?.guidancePage;if(page)ids.add(page.id);
      }
    }
    return (this.state.call.resourceReadGrants?.resources??[]).filter(g=>ids.has(`resource:${g.meta.id}:${g.meta.version}`)).map(g=>({id:g.meta.id,version:g.meta.version}));
  }
  async attempt(index:number,call:LearningCall):Promise<void>{
    const old=this.state.attempts[index];
    if(old){if(stableHash(old.call)!==stableHash(call))throw new RuntimeError('INVALID_CONFIGURATION');return;}
    if(index!==this.state.attempts.length||this.state.attempts.some(a=>!a.result))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
    this.state.attempts.push({call:structuredClone(call)});await this.save();
  }
  async finishAttempt(index:number,result:LearningAttemptResult):Promise<void>{
    this.state.attempts[index]!.result={usage:structuredClone(result.usage),...(result.error?{errorCode:result.error.code}:{output:structuredClone(result.output)})};await this.save();
  }
  async prepare(input:LearningDispatchInput,attempt:number):Promise<LearningDispatch>{
    if(!this.state.attempts[attempt]||this.recovery().status==='reconciliation-required')throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
    const d:LearningDispatch={...structuredClone(input),id:`${LearningContinuation.key(this.state.call)}:${this.state.dispatches.length+1}`,attempt,state:'preflight',effects:[]};
    this.state.dispatches.push(d);await this.save();return d;
  }
  private dispatch(id:string):LearningDispatch {const d=this.state.dispatches.find(d=>d.id===id);if(!d)throw new RuntimeError('INVALID_CONFIGURATION');return d;}
  async sending(id:string):Promise<void>{const d=this.dispatch(id);if(!['preflight','not-admitted'].includes(d.state))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');d.state='unknown';delete d.reason;await this.save();}
  admission(id:string,assertCurrent?:()=>void):LearningTransportAdmission {return {dispatchId:id,
    assertCanAdmit:()=>{if(this.dispatch(id).state!=='unknown')throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');assertCurrent?.();},
    admitted:async receipt=>{const d=this.dispatch(id);if(!['unknown','admitted'].includes(d.state)||!receipt.transport||!receipt.requestId||d.admission&&stableHash(d.admission)!==stableHash(receipt))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');d.state='admitted';d.admission=structuredClone(receipt);await this.save();},
    notAdmitted:async reason=>{const d=this.dispatch(id);if(!['preflight','unknown','not-admitted'].includes(d.state)||!reason)throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');d.state='not-admitted';d.reason=reason;await this.save();}};}
  async payload(id:string,payload:unknown):Promise<void>{
    const d=this.dispatch(id);
    if(!['unknown','not-admitted'].includes(d.state)||d.payload!==undefined&&stableHash(d.payload)!==stableHash(payload))throw new RuntimeError('INVALID_CONFIGURATION');
    if(d.payload===undefined){d.payload=structuredClone(payload);await this.save();}
  }
  async response(id:string,response:AssistantMessage,evidence:ToolArgumentEvidence[]):Promise<void>{
    const d=this.dispatch(id);if(['error','aborted'].includes(response.stopReason)||this.state.call.nativeHandoff==='native-handoff-v1'&&response.stopReason==='length'){
      if(this.state.call.nativeHandoff==='native-handoff-v1'){if(d.partialResponse&&stableHash(d.partialResponse)!==stableHash(response))throw new RuntimeError('INVALID_CONFIGURATION');d.partialResponse=structuredClone(response);d.evidence=structuredClone(evidence);await this.save();}
      return;
    }
    if(d.response&&stableHash(d.response)!==stableHash(response))throw new RuntimeError('INVALID_CONFIGURATION');
    d.response=structuredClone(response);d.evidence=structuredClone(evidence);d.state='complete';await this.save();
  }
  async effectStarted(dispatch:string,id:string,tool:string,args:unknown):Promise<void>{
    const d=this.dispatch(dispatch);if(d.state!=='complete'||d.effects.some(e=>e.id===id))throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
    d.effects.push({id,tool,arguments:structuredClone(args),status:'pending'});await this.save();
  }
  async effectCompleted(dispatch:string,id:string,result:unknown):Promise<void>{
    const effect=this.dispatch(dispatch).effects.find(e=>e.id===id);if(!effect||effect.status!=='pending')throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');effect.result=structuredClone(result);effect.status='completed';await this.save();
  }
  async acceptOutput(index:number,output:unknown,usage:LearningResult['usage']):Promise<void>{
    const attempts=this.state.attempts.slice(0,index+1).map((a,i)=>({model:structuredClone(a.call.model),budget:structuredClone(a.call.budget),usage:structuredClone(i===index?usage:a.result!.usage),...(a.result?.errorCode?{errorCode:a.result.errorCode}:{})}));
    const knownTokens=attempts.every(a=>a.usage.tokensKnown!==false&&Number.isFinite(a.usage.tokens));
    const knownCost=attempts.every(a=>a.usage.costKnown!==false&&Number.isFinite(a.usage.costUsd));
    await this.complete({output:structuredClone(output),attempts,elapsedMs:Date.now()-this.state.startedAt,usage:{turns:attempts.reduce((n,a)=>n+a.usage.turns,0),toolCalls:attempts.reduce((n,a)=>n+a.usage.toolCalls,0),tokensKnown:knownTokens,costKnown:knownCost,...(knownTokens?{tokens:attempts.reduce((n,a)=>n+a.usage.tokens!,0)}:{}),...(knownCost?{costUsd:attempts.reduce((n,a)=>n+a.usage.costUsd!,0)}:{})}});
  }
  maintenanceReferral():boolean {
    return this.state.call.nativeHandoff==='native-handoff-v1' && this.state.dispatches.some(d=>d.response?.content.some(p=>p.type==='toolCall' && isSystemMaintenanceTool(p.name)));
  }
  async complete(result:LearningResult):Promise<void>{this.state.result=structuredClone({...result,...(this.maintenanceReferral()?{maintenanceReferral:true}:{}),readResources:this.readResources()});await this.save();}
}
