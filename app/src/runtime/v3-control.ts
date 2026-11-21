import {stableHash} from '../learning/research-hash.js';
import {budgetControlsEnabledV3} from '../research/versions/v3/capacity-policy.js';
import type {CapacityPolicyV3} from '../research/contracts/v1.js';
import type {GuidanceReferenceStateV3} from './guidance-reference-repair.js';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { V21Control } from './v21-control.js';
import { V0AnswerCollector } from './v0-answer.js';
import { SUBMIT_RESULT } from './stage-contract.js';
import { ContractValidationError } from './strict-schema.js';
import { validateOperationArgumentsV3, OperationInputErrorV3 } from '../research/versions/v3/operations.js';
import { decodeSafeToolArguments, SafeToolArgumentsError } from './safe-tool-arguments.js';
import { RuntimeError } from './errors.js';
import type { OperationJournal } from './operation-journal.js';
import type { V3Execution } from '../research/versions/v3/integration.js';
import type { OptionalRetainedV21 } from './v21-optional-control.js';
import type { OptionalControlV21, OptionalTheoristResultV21 } from '../research/versions/v21/optional-types.js';

function publicPhase(signature?:string):unknown{
  try{return signature && JSON.parse(signature)?.phase;}catch{return undefined;}
}

/** V3 alone permits dynamic tools in the same Pi conversation. Every public
 * response is retained; only the terminal declaration freezes the manuscript. */
export class ProofControlV3 extends V21Control {
  private correctionFailures=new Set<string>();
  private toolRejections=new Map<string,{category:string;message:string}>();
  private pendingToolCorrection=false;
  private toolCorrectionDispatches=0;
  private current?: V0AnswerCollector;
  private completed: string[] = [];
  onCommentary?: (text:string)=>void;
  private readonly announced=new Set<number>();
  private hasAnswerText=false;
  private requestedManuscript=false;
  needsManuscript=false;
  get writingManuscript(){return this.requestedManuscript&&!this.correction;}
  private dispatchNumber = 0;
  private currentRecorded = false;
  private invalidText = false;
  private readonly retainedState: { value?: OptionalRetainedV21 };
  constructor(journal: OperationJournal, tools: ToolDefinition[], schema: TSchema,
    prepare: (value: unknown) => OptionalControlV21,
    private readonly saveBody: (text: string, collector: V0AnswerCollector, forceIncomplete: boolean) => Promise<OptionalRetainedV21>,
    private readonly cancelled: () => boolean,
    execution: () => V3Execution, private readonly boundedToolCorrection=false, zeroExposureGuidance?:()=>GuidanceReferenceStateV3,private readonly capacityPolicy?:CapacityPolicyV3,private readonly nativeHandoff=false, private readonly declarationSupplement=false) {
    const retained: { value?: OptionalRetainedV21 } = {};
    super(journal, tools, schema, value => {
      if (!retained.value || retained.value.technical.completeness !== 'complete') throw new RuntimeError('INVALID_OUTPUT');
      return {control:prepare(value),...retained.value,v3Execution:execution()} as OptionalTheoristResultV21;
    },true,{optionalProof:true,nativeHandoff,declarationSupplement,cancelled,zeroExposureGuidance,resultReady:value=>journal.capture({kind:'v21-optional-result-ready',result:value}),metadataTagPaths:[/^\/outcome\/tags$/,/^\/adoptions\/\d+\/outcome\/tags$/]});
    this.retainedState=retained;
  }
  get retained(): OptionalRetainedV21 | undefined { return this.retainedState.value; }
  override startDispatch():void {
    super.startDispatch();this.announced.clear();this.dispatchNumber++;this.toolRejections.clear();
    if(this.pendingToolCorrection){this.pendingToolCorrection=false;this.toolCorrectionDispatches++;void this.journal.capture({kind:'v3-tool-correction-dispatch',count:this.toolCorrectionDispatches,...(this.nativeHandoff?{limit:1}:budgetControlsEnabledV3(this.capacityPolicy)?{limit:2}:{controlsEnabled:false})}).catch(()=>{});}
    if(!this.correction){this.currentRecorded=false;this.current=this.collector;}
  }
  protected override canRequestFormatCorrection():boolean{return this.nativeHandoff?this.toolCorrectionDispatches+this.journal.state.corrections<1:super.canRequestFormatCorrection();}
  override get allowsDispatch():boolean{return super.allowsDispatch&&(!this.pendingToolCorrection||(this.nativeHandoff?this.canRequestFormatCorrection():!budgetControlsEnabledV3(this.capacityPolicy)||this.toolCorrectionDispatches<2));}
  protected override async rejectToolArguments(error:unknown,calls:Extract<AssistantMessage['content'][number],{type:'toolCall'}>[]):Promise<boolean>{
    if(!this.boundedToolCorrection||this.correction||calls.some(call=>call.name===SUBMIT_RESULT)||!(error instanceof ContractValidationError||error instanceof SafeToolArgumentsError&&error.kind==='format'))return false;
    if(this.nativeHandoff&&error instanceof ContractValidationError&&error.kind!=='format')return false;
    // No call in a rejected multi-tool message executes. A same-Theorist next
    // dispatch may correct the tool request, never the retained proof or data.
    if(this.nativeHandoff?!this.canRequestFormatCorrection():budgetControlsEnabledV3(this.capacityPolicy)&&this.toolCorrectionDispatches>=2){this.fatal=new RuntimeError('INVALID_OUTPUT');return true;}
    let category=error instanceof SafeToolArgumentsError?'malformed-json':'invalid-arguments';
    let message=(error instanceof ContractValidationError?error.issues.join('; '):error.diagnostics.map(d=>d.message).join('; ')).slice(0,1024);
    if(error instanceof ContractValidationError){for(const call of calls){if(call.name!=='execute_registered_operations')continue;try{validateOperationArgumentsV3(decodeSafeToolArguments(this.evidence.get(call.id)!).value);}catch(typed){if(typed instanceof OperationInputErrorV3){category=typed.code;message=typed.message;}break;}}}
    const fingerprint=stableHash([category,message,calls.map(c=>[c.name,c.arguments])]);if(!budgetControlsEnabledV3(this.capacityPolicy)&&this.correctionFailures.has(fingerprint)){this.fatal=new RuntimeError('INVALID_OUTPUT');return true;}this.correctionFailures.add(fingerprint);
    for(const call of calls)this.toolRejections.set(call.id,{category,message});
    this.pendingToolCorrection=true;
    await this.journal.capture({kind:'v3-tool-input-rejected',category,message,callIds:calls.map(c=>c.id),correctionDispatches:this.toolCorrectionDispatches,...(this.nativeHandoff?{limit:1}:budgetControlsEnabledV3(this.capacityPolicy)?{limit:2}:{controlsEnabled:false})});
    return true;
  }
  override permits(id:string):boolean{return !this.cancelled()&&!this.fatal&&(this.toolRejections.has(id)||super.permits(id));}
  override async execute(tool:ToolDefinition,args:Parameters<ToolDefinition['execute']>):Promise<Awaited<ReturnType<ToolDefinition['execute']>>>{
    const error=this.toolRejections.get(args[0]);
    if(error){if(!this.permits(args[0]))throw new RuntimeError('TOOL_PROTOCOL_FAILED');return {content:[{type:'text',text:JSON.stringify({error,executed:false,...(this.nativeHandoff?{correctionsRemaining:1-this.toolCorrectionDispatches-this.journal.state.corrections}:budgetControlsEnabledV3(this.capacityPolicy)?{correctionsRemaining:2-this.toolCorrectionDispatches}:{}),instruction:this.nativeHandoff?'Correct only the reported tool-input format. Preserve scientific content.':'Correct only the tool call format. Do not change supplied values, assumptions or conclusions. You may instead continue without this computation.'})}],details:{v3InputError:true}};}
    const result=await super.execute(tool,args);
    // Execution/authority feedback is not a schema failure and cannot spend a format repair.
    if(!this.nativeHandoff&&this.boundedToolCorrection&&(result.details as {v3InputError?:boolean}).v3InputError){
      const fingerprint=stableHash([tool.name,args[1],result.content]);if(!budgetControlsEnabledV3(this.capacityPolicy)&&this.correctionFailures.has(fingerprint)){this.fatal=new RuntimeError('INVALID_OUTPUT');return result;}this.correctionFailures.add(fingerprint);
      if(budgetControlsEnabledV3(this.capacityPolicy)&&this.toolCorrectionDispatches>=2)this.fatal=new RuntimeError('INVALID_OUTPUT');else this.pendingToolCorrection=true;
    }
    return result;
  }
  override observe(event:AssistantMessageEvent):void {
    super.observe(event);
    if(this.correction)return;

    if(this.onCommentary && event.type==='text_end' && event.content.trim()){
      const part=event.partial.content[event.contentIndex];
      if(part?.type==='text' && publicPhase(part.textSignature)==='commentary' && !this.announced.has(event.contentIndex)){
        this.announced.add(event.contentIndex);
        this.onCommentary(event.content);
      }
    }
  }
  private recordCurrent(manuscript?:string):void {
    if(this.currentRecorded||!this.current)return;
    this.invalidText ||= this.current.mismatch;
    const text=manuscript??this.current.text;
    if(text)this.completed.push(text);
    this.currentRecorded=true;
  }
  async preserveOriginal(forceIncomplete=false):Promise<void>{
    if(this.retained)return;
    this.recordCurrent();const text=this.completed.join('\n\n');if(!text)return;
    const collector=new V0AnswerCollector();
    // Aggregation never grants scientific validity. Each segment was independently
    // checked against provider bytes, and the complete original is saved once.
    const message={role:'assistant',content:[{type:'text',text}],stopReason:forceIncomplete||this.invalidText?'error':this.current?.originalStopReason??'stop',...(this.current?.rawStopReason?{rawStopReason:this.current.rawStopReason}:{})} as AssistantMessage;
    collector.observe({type:'done',reason:'stop',message});
    await this.journal.flush();
    this.retainedState.value=await this.saveBody(text,collector,forceIncomplete||this.invalidText);
    await this.journal.capture({kind:'v21-optional-original',...this.retainedState.value});
  }
  override async prepareMessage(message:AssistantMessage,skippedOperation=false):Promise<void>{
    const progressParts:number[]=[];
    let manuscript='';
    if(this.declarationSupplement && !this.correction){
      const calls=message.content.filter(part=>part.type==='toolCall');
      const mixed=calls.length>0&&!calls.some(call=>call.name===SUBMIT_RESULT && call.arguments.action!=='complete');
      let publicIndex=-1;
      for(const [i,part] of message.content.entries()){
        if(part.type==='thinking')continue;
        publicIndex++;
        if(part.type!=='text')continue;
        const phase=publicPhase(part.textSignature);
        if(phase==='commentary'||mixed&&phase!=='final_answer'){
          progressParts.push(publicIndex);
          if(part.text.trim()&&!this.announced.has(i))this.onCommentary?.(part.text);
        }else manuscript+=part.text;
      }
    }
    await this.journal.capture({...(progressParts.length?{progressParts}:{}),kind:'v3-original-message',dispatch:this.dispatchNumber,correction:this.correction,message:{...message,content:message.content.filter(part=>part.type!=='thinking')}});
    for(const evidence of this.evidence.values())await this.journal.capture({kind:'v21-optional-arguments',dispatch:this.dispatchNumber,evidence});
    if(!this.correction)this.recordCurrent(this.declarationSupplement?manuscript:undefined);
    if(this.invalidText){this.fatal=new RuntimeError('TOOL_PROTOCOL_FAILED');return;}
    if(this.cancelled()){this.fatal=new RuntimeError('BUDGET_EXHAUSTED');return;}
    const submission=message.content.find(part=>part.type==='toolCall'&&part.name===SUBMIT_RESULT);
    const terminal=!!submission;
    if(this.declarationSupplement&&!this.correction){
      const answerText=!!manuscript.trim()&&(message.stopReason==='stop'||terminal);
      this.hasAnswerText ||= answerText;
      if(this.requestedManuscript && !answerText){this.fatal=new RuntimeError('INVALID_OUTPUT');return;}
      if(!this.hasAnswerText && (submission?.type==='toolCall' && submission.arguments.action==='complete' || message.stopReason==='stop' && progressParts.length)){
        this.needsManuscript=true;this.requestedManuscript=true;
        this.feedback='The progress message was saved. Write the actual answer and derivation now.';
        return;
      }
    }
    if(terminal||this.declarationSupplement&&message.stopReason==='stop'&&message.content.some(p=>p.type==='text'&&p.text.trim())){await this.preserveOriginal();if(!this.retained||this.retained.technical.completeness!=='complete'){this.fatal=new RuntimeError('INVALID_OUTPUT');return;}}
    await super.prepareMessage(message,skippedOperation);
  }
}
