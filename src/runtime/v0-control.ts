import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { isDeepStrictEqual } from 'node:util';
import { canonicalCodec, ContractValidationError, type SchemaCodec } from './strict-schema.js';
import { decodeSafeToolArguments, SafeToolArgumentsError } from './safe-tool-arguments.js';
import type { ToolArgumentEvidence } from './tool-argument-audit.js';
import type { OperationJournal } from './operation-journal.js';
import { SUBMIT_RESULT } from './stage-contract.js';
import { RuntimeError } from './errors.js';
import { V0AnswerCollector } from './v0-answer.js';
import type { RawAnswerRefV0, TechnicalStateV0 } from '../research/contracts/v0.js';

export interface V0RetainedBody { answerRef:RawAnswerRefV0;technical:TechnicalStateV0 }
/** Host-only control. No scientific inference and no body in the tool JSON. */
export class V0Control {
  readonly codecs=new Map<string,SchemaCodec>();
  readonly evidence=new Map<string,ToolArgumentEvidence>();
  private prepared=new Map<string,unknown>();
  private fingerprints=new Set<string>();
  private collector?:V0AnswerCollector;
  private dispatch=0;
  private terminalId?:string;
  retained?:V0RetainedBody;
  accepted=false;
  value?:unknown;
  feedback?:string;
  fatal?:RuntimeError;
  correction=false;
  repeatedFeedback=false;
  private declarationConstraints={gaps:[] as string[],extraAssumptions:[] as string[],open:false};
  constructor(readonly journal:OperationJournal,private readonly task:'v0_plan'|'v0_solve'|'v0_single',tools:ToolDefinition[],schema:TSchema,
    private readonly prepare:(value:unknown)=>unknown,
    private readonly saveBody:(text:string,collector:V0AnswerCollector,forceIncomplete:boolean)=>Promise<V0RetainedBody>,
    private readonly cancelled:()=>boolean,
    private readonly currentUsage:()=>import('../research/contracts/v0.js').Usage,
    readonly proofFirst=false) {
    for(const tool of tools.filter(tool=>task!=='v0_single'||tool.name===SUBMIT_RESULT))this.codecs.set(tool.name,canonicalCodec(tool.name===SUBMIT_RESULT?schema:tool.parameters));
  }
  get singleRequest():boolean{return this.task==='v0_single';}
  get dispatchStarted():boolean{return this.dispatch>0;}
  /** Each extra proof-first dispatch needs an explicitly journaled metadata correction. */
  get allowsDispatch():boolean{return !this.singleRequest||(!this.proofFirst?!this.dispatchStarted:this.dispatch===this.journal.state.corrections);}
  startDispatch():void {
    this.evidence.clear();this.prepared.clear();this.dispatch++;
    const dispatch=this.dispatch;
    this.collector=new V0AnswerCollector(event=>{void this.journal.capture({kind:'v0-text',dispatch,event}).catch(()=>{});});
  }
  observe(event:AssistantMessageEvent):void { this.collector?.observe(event); }
  async preserveIncomplete(forceIncomplete=false):Promise<void> {
    if(this.task!=='v0_plan'&&!this.retained&&this.collector?.text){
      await this.journal.flush();this.retained=await this.saveBody(this.collector.text,this.collector,forceIncomplete);
      await this.journal.capture({kind:'v0-body',...this.retained});
    }
  }
  async prepareMessage(message:AssistantMessage):Promise<void> {
    this.prepared.clear();this.terminalId=undefined;
    await this.journal.capture({kind:'v0-message',dispatch:this.journal.state.dispatches,message:{...message,content:message.content.filter(part=>part.type!=='thinking')}});
    const calls=message.content.filter(part=>part.type==='toolCall');
    const terminals=calls.filter(call=>call.name===SUBMIT_RESULT);
    const text=message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
    const terminalIndex=message.content.findIndex(part=>part.type==='toolCall'&&part.name===SUBMIT_RESULT);
    const postTerminal=terminalIndex>=0&&message.content.slice(terminalIndex+1).some(part=>part.type!=='thinking');
    // Save public bytes before even decoding the scientific declaration, including malformed outputs.
    if(this.task!=='v0_plan'&&!this.retained&&(this.singleRequest||terminals.length>0||!calls.length))await this.preserveIncomplete();
    if(this.cancelled()){this.fatal=new RuntimeError('BUDGET_EXHAUSTED');return;}
    if(this.singleRequest&&!this.proofFirst&&(calls.length!==1||terminals.length!==1)){this.fatal=new RuntimeError('INVALID_OUTPUT');return;}
    if(this.correction&&(text.length>0||calls.length>1||calls.length===1&&terminals.length!==1||!this.proofFirst&&calls.length!==1)) {this.fatal=new RuntimeError('TOOL_PROTOCOL_FAILED');return;}
    if(message.stopReason==='stop'&&!calls.length&&!this.evidence.size){
      if(this.task!=='v0_plan'&&(!this.retained||this.retained.technical.completeness!=='complete')){this.fatal=new RuntimeError('INVALID_OUTPUT');return;}
      this.rejectDeclaration(this.proofFirst?'Submit only the compact declaration through submit_research_result. The complete original proof is retained; do not repeat or change it.':'Submit the typed outcome only through submit_research_result. Do not repeat or change the retained scientific body.');return;
    }
    if(message.stopReason!=='toolUse'||!calls.length||this.evidence.size!==calls.length||new Set(calls.map(call=>call.id)).size!==calls.length||(terminals.length&&(calls.length!==1||postTerminal))){this.fatal=new RuntimeError('TOOL_PROTOCOL_FAILED');return;}
    if(terminals.length&&this.task!=='v0_plan'&&(!this.retained||this.retained.technical.completeness!=='complete')){this.fatal=new RuntimeError('INVALID_OUTPUT');return;}
    try {
      for(const call of calls){
        const evidence=this.evidence.get(call.id);
        if(!evidence||evidence.tool!==call.name||!isDeepStrictEqual(evidence.sdkArguments,call.arguments))throw new RuntimeError('TOOL_PROTOCOL_FAILED');
        const decoded=decodeSafeToolArguments(evidence);
        await this.journal.capture({kind:'arguments',callId:call.id,evidence,effective:decoded});
        if(this.proofFirst&&call.name===SUBMIT_RESULT)await this.guardDeclaration(decoded.value);
        const codec=this.codecs.get(call.name);if(!codec)throw new RuntimeError('TOOL_PROTOCOL_FAILED');
        const wire=codec.decode(decoded.value);
        const value=call.name===SUBMIT_RESULT?this.prepare(wire):wire;
        const result=call.name===SUBMIT_RESULT&&this.task!=='v0_plan'?{outcome:value,...(this.proofFirst?{metadataStatus:'assessed'}:{}),...this.retained}:value;
        this.prepared.set(call.id,structuredClone(result));if(call.name===SUBMIT_RESULT)this.terminalId=call.id;
      }
    }catch(error){
      this.prepared.clear();
      if(this.singleRequest&&!this.proofFirst){this.fatal=error instanceof RuntimeError?error:new RuntimeError('INVALID_OUTPUT');return;}
      if(error instanceof ContractValidationError||error instanceof SafeToolArgumentsError&&error.kind==='format'){
        const feedback=error instanceof ContractValidationError?error.issues.slice(0,32).join('\n'):error.diagnostics.slice(0,32).map(x=>JSON.stringify(x)).join('\n');
        this.rejectDeclaration(feedback);
      }else this.fatal=error instanceof RuntimeError?error:new RuntimeError('TOOL_PROTOCOL_FAILED');
    }
  }
  restoreDeclarationConstraints(value:unknown):void {
    if(!this.proofFirst||!value||typeof value!=='object')return;
    const v=value as {gaps?:unknown;extraAssumptions?:unknown;open?:unknown};
    for(const key of ['gaps','extraAssumptions'] as const)if(Array.isArray(v[key])&&v[key].every(x=>typeof x==='string'&&x.trim().length>0))this.declarationConstraints[key]=[...new Set([...this.declarationConstraints[key],...v[key] as string[]])];
    if(v.open===true)this.declarationConstraints.open=true;
  }
  private async guardDeclaration(value:unknown):Promise<void>{
    if(!value||typeof value!=='object')return;
    const v=value as {gaps?:unknown;extraAssumptions?:unknown;verdict?:unknown};
    const previous=structuredClone(this.declarationConstraints);
    this.restoreDeclarationConstraints({...v,open:v.verdict==='open'});
    await this.journal.capture({kind:'v0-declaration-constraints',constraints:this.declarationConstraints});
    if(!this.correction)return;
    for(const key of ['gaps','extraAssumptions'] as const)if(previous[key].length&&(!Array.isArray(v[key])||previous[key].some(x=>!(v[key] as unknown[]).includes(x))))throw new ContractValidationError(['Metadata correction must retain previously declared '+key+'; it cannot repair the immutable proof.'],'semantic');
    if(previous.open&&v.verdict!=='open')throw new ContractValidationError(['Metadata correction cannot upgrade a previously open scientific claim.'],'semantic');
  }
  private rejectDeclaration(feedback:string):void {
    if(this.fingerprints.has(feedback)){if(this.proofFirst)this.repeatedFeedback=true;else this.fatal=new RuntimeError('INVALID_OUTPUT');}
    this.fingerprints.add(feedback);this.feedback=feedback;
  }
  /** A delivered original is not a scientific verdict when its declaration cannot be obtained. */
  async completeUnassessed():Promise<void>{
    if(!this.proofFirst||this.fatal||this.cancelled()||!this.feedback||!this.retained||this.retained.technical.executionStatus!=='completed'||this.retained.technical.completeness!=='complete'||!this.retained.answerRef.byteLength)throw new RuntimeError('INVALID_OUTPUT');
    const value={outcome:null,metadataStatus:'unassessed',...this.retained,technical:{...this.retained.technical,usage:this.currentUsage()}};
    await this.journal.capture({kind:'v0-unassessed-declaration',diagnostics:this.feedback});
    await this.journal.capture({kind:'v0-result-ready',result:value});
    await this.journal.complete(value);this.value=value;this.accepted=true;
  }
  permits(id:string):boolean{return !this.cancelled()&&!this.fatal&&!this.feedback&&this.prepared.has(id);}
  async execute(tool:ToolDefinition,args:Parameters<ToolDefinition['execute']>):Promise<Awaited<ReturnType<ToolDefinition['execute']>>>{
    if(!this.permits(args[0]))throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    const value=this.prepared.get(args[0]);
    await this.journal.capture({kind:'effect-pending',callId:args[0],tool:tool.name});
    if(this.cancelled())throw new RuntimeError('BUDGET_EXHAUSTED');
    if(tool.name===SUBMIT_RESULT){
      await this.commitTerminal(args[0]);
      return {content:[{type:'text',text:'Recorded.'}],details:{}};
    }
    const effective=[...args] as Parameters<ToolDefinition['execute']>;effective[1]=value;
    const result=await tool.execute(...effective);
    await this.journal.capture({kind:'effect-completed',callId:args[0],tool:tool.name,details:result.details});return result;
  }
  async commitTerminal(id:string):Promise<void>{
    if(id!==this.terminalId||!this.permits(id))throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    const prepared=this.prepared.get(id);
    const value=this.task!=='v0_plan'?{...(prepared as object),technical:{...this.retained!.technical,usage:this.currentUsage()}}:prepared;
    await this.journal.capture({kind:'v0-result-ready',result:value});
    await this.journal.complete(value);this.value=value;this.accepted=true;
  }

}
