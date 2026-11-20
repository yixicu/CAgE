import type { AssistantMessage } from '@earendil-works/pi-ai';
import { Type, type TSchema } from 'typebox';
import {canRepairNativeArguments,createNativeArgumentRepair} from './native-handoff.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { isDeepStrictEqual } from 'node:util';
import { stableHash } from '../learning/research-hash.js';
import { stageContract, projectContract, SUBMIT_RESULT, ROUTE_PLAN, type ContractContext } from './stage-contract.js';
import { HANDOFF_VERSION, handoffVersion, ContractValidationError, type HandoffVersion, type SchemaCodec, exact } from './strict-schema.js';
import { ValidationError } from '../research/contracts/errors.js';
import { RuntimeError } from './errors.js';
import { FileAccessError } from '../tools/files.js';
import { AtomicWriteError } from '../storage/atomic.js';
import { isStorageAccessError, hasErrorCode } from '../storage/errors.js';
import type { ToolArgumentEvidence } from './tool-argument-audit.js';
import type { ReportDraft } from './report-draft.js';
import { WaysWireSchema, bindWayEnvelope } from './planning-wire.js';
import { componentInterfaceSelectionDetails } from '../research/versions/v2/conditional-work.js';
import { KnowledgeRoutingSchema } from '../research/versions/v2/schemas.js';
import { applyKnowledgeRouting, type KnowledgeRoutingOutput } from '../research/versions/v2/routing.js';
import type { EpochSnapshot } from '../research/contracts/v2.js';

// Explicit host readers only: no generic plugin/name-prefix read classification.
const READ_BATCH_TOOLS = new Set(['get_module_contract', 'read_proof_chapter']);
const response=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:{}});
const interfaceSelectionFailure = (value: { message?: string; rule?: unknown }) => new ContractValidationError([value.message ?? 'Correct the nested scientific interface selection.'],'semantic',componentInterfaceSelectionDetails(value.rule));
export const STRICT_INSTRUCTIONS = `# Research delivery
Use submit_research_result for the current stage. Use its native scientific fields as described by the active tool schema. Optional fields may be omitted or supplied as their native values, not absent/value wrappers. Do not emit contract/result envelopes or invent missing science. Plain text is not a delivered result.
Save long proof bodies with save_proof_chapter, wait for the receipt, then select authorized references. The program supplies identity, frozen versions, reads and save status. A receipt means saved, not scientifically verified.
If a local submission fails, correct the named fields once by resubmitting the complete small result; reuse saved bodies, do not restart research. Refusal or truncation is not completion.
For way generation, select_planning_routing registers macro guidance before selecting its anchors in the result; it does not solve the proof or add an outer loop phase.`;

export type HandoffFailureKind = 'format' | 'semantic' | 'permission' | 'storage' | 'protocol' | 'runtime';
export function classifyHandoffError(error: unknown): HandoffFailureKind {
  if (error instanceof ContractValidationError) return error.kind;
  if (error instanceof FileAccessError || error instanceof RuntimeError && error.code === 'INVALID_TOOL' || hasErrorCode(error, ['SOURCE_NOT_GRANTED','EACCES','EPERM'])) return 'permission';
  if (error instanceof AtomicWriteError || isStorageAccessError(error) || hasErrorCode(error, ['ENOENT','ENOTDIR','EISDIR','EEXIST'])) return 'storage';
  if (error instanceof RuntimeError && error.code === 'TOOL_PROTOCOL_FAILED') return 'protocol';
  return 'runtime';
}
/** Invocation-local contract gate; scientific acceptance remains in the existing validators. */
export class StrictHandoff {
  readonly codecs=new Map<string,SchemaCodec>();
  /** SDK-parsed arguments, captured before local tool coercion; not transport bytes. */
  readonly raw=new Map<string,unknown>();
  readonly transportEvidence=new Map<string,ToolArgumentEvidence>();
  failures=0;
  readonly version: HandoffVersion;
  private readonly receiptScope: string;
  private schemaRevision=0;
  private compiled?: { revision:number; names:string; bodies:string; routing:unknown; version:HandoffVersion };
  private batch?: { ids: Set<string>; failed: boolean; readOnly?: boolean; unsupported?: boolean; rejection?: string; rejectionKind?: ContractValidationError['kind']; rejectionDetails?: ContractValidationError['details']; reported?: boolean };
  /** Persist aliases before any model-facing schema/menu/receipt can expose them. */
  async checkpointHandles(): Promise<void> {
    const handles=this.context.documents?.handleSnapshot() ?? [];
    if(!isDeepStrictEqual(handles,this.draft.state.handles)){this.draft.state.handles=handles;this.schemaRevision++;await this.draft.save();}
  }
  async prepareMessage(message: AssistantMessage): Promise<void> {
    this.batch = undefined;
    const calls = message.content.filter(part => part.type === 'toolCall');
    await this.draft.capture(JSON.stringify({recoveryOnly:true,toolCalls:calls}), message.stopReason === 'length');
    if (message.stopReason !== 'toolUse') return;
    // Retain every independently complete body before any other call can fail.
    for (const call of calls) {
      const evidence = this.transportEvidence.get(call.id);
      if (call.name === 'save_proof_chapter' && evidence?.jsonValid && evidence.sdkMatchesRaw && !evidence.incomplete && !evidence.issue)
        this.draft.retainBody(call.arguments);
    }
    await this.checkpointHandles();
    const ids = new Set(calls.map(call => call.id));
    if (ids.size !== calls.length || calls.some(call => !call.id)) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    if (calls.length <= 1) return;
    // Check the complete batch before local feedback can hide a later fatal call.
    for (const call of calls) {
      if (!this.codecs.has(call.name)) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
      const evidence=this.transportEvidence.get(call.id);
      if (!evidence || evidence.incomplete || evidence.coverage==='insufficient' || evidence.jsonValid && !evidence.sdkMatchesRaw) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    }
    const readOnly=calls.every(call=>this.nativeHandoff&&['lookup_learning_routes','open_learning_route'].includes(call.name)|| (this.allowModeratorReadBatch ? call.name==='read_research_resource'||call.name==='read_final_proof' : READ_BATCH_TOOLS.has(call.name) || this.allowGuidanceReadBatch && call.name==='read_research_resource'));
    if (!readOnly && calls.some(call => call.name !== 'save_proof_chapter')) {
      // Do not decode, resolve or execute unsupported combinations, including terminals.
      this.batch={ids,failed:false,unsupported:true,rejection:'This combination of exposed tools cannot execute in one response. No call in this batch executed. Split the intended calls into separate subsequent responses, wait for each result or save receipt, then submit the final result. Each resubmitted call must pass its own argument, permission and scientific checks.'};
      return;
    }
    // All decoders were frozen before this dispatch: a new sibling receipt cannot be selected.
    let preflightRejection: string | undefined, rejectionKind: ContractValidationError['kind'] = 'format', rejectionDetails: ContractValidationError['details'] = [];
    for (const call of calls) {
      const evidence = this.transportEvidence.get(call.id);
      if (!evidence || evidence.incomplete || evidence.coverage==='insufficient' || evidence.jsonValid && !evidence.sdkMatchesRaw) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
      if (!evidence.jsonValid || evidence.issue) {preflightRejection ??= `A complete tool call did not contain valid JSON. Resubmit the complete independent ${readOnly?'read':'save'} batch; no ${readOnly?'read':'save'} in this batch executed.`;continue;}
      try {
        const codec=this.codecs.get(call.name);if(!codec)throw new RuntimeError('INVALID_TOOL');
        const decoded=codec.decode(structuredClone(call.arguments)) as any;
        if(readOnly)continue; // Pi already executes tools sequentially; only authorize this frozen batch here.
        const body='text' in decoded.content?decoded.content.text:this.draft.state.savedBundles[decoded.content.savedBody];
        if(typeof body!=='string' || !body.trim())throw new ContractValidationError(['Invalid chapter body.']);
        const prepared=this.context.documents?.prepareChapterComponent(decoded.component,chapterIdentity(decoded,body));
        if(prepared?.rejection){
          const reason=(prepared.rejection as {message?:string}).message??'Chapter metadata was rejected.';
          this.draft.state.issues=[reason];
          await this.draft.save();
          if ((prepared.rejection as {error?:unknown}).error==='CHAPTER_REFERENCE_NOT_AVAILABLE'&&(prepared.rejection as {recoverable?:unknown}).recoverable===true)throw new ContractValidationError(['Select an available exact chapter reference from the authorized tool receipt; do not change scientific content.'],'semantic');
          if ((prepared.rejection as {error?:unknown}).error==='INTERFACE_SELECTION') throw interfaceSelectionFailure(prepared.rejection as {message?:string;rule?:unknown});
          throw new RuntimeError('INVALID_TOOL');
        }
      }
      catch(error) {
        this.draft.state.issues=[error instanceof Error?error.message:'Chapter preflight failed.'];
        await this.draft.save();
        if (error instanceof ContractValidationError) { if(!preflightRejection){preflightRejection=error.message;rejectionKind=error.kind;rejectionDetails=error.details;} }
        else throw error;
      }
    }
    this.batch = {ids, failed:false, ...(readOnly?{readOnly:true}:{}), ...(preflightRejection ? {rejection:preflightRejection,rejectionKind,rejectionDetails} : {})};
  }
  permitsCall(message: AssistantMessage, id: string): boolean {
    const calls = message.content.filter(part => part.type === 'toolCall');
    return message.stopReason === 'toolUse' && (calls.length === 1 ? !this.ended : Boolean(this.batch?.ids.has(id) && (this.batch.rejection || !this.ended && !this.batch.failed)));
  }
  accepted=false;
  value:unknown;
  fatal?:RuntimeError;
  constructor(readonly context:ContractContext, readonly draft:ReportDraft, private readonly accept:(value:unknown)=>Promise<unknown>, private readonly allowGuidanceReadBatch=false, private readonly allowModeratorReadBatch=false,private readonly nativeHandoff=false) {
    this.version = handoffVersion(context.contractVersion ?? draft.state.contractVersion ?? HANDOFF_VERSION);
    if (draft.state.contractVersion !== undefined && draft.state.contractVersion !== this.version) throw new RuntimeError('INVALID_CONFIGURATION');
    context.contractVersion = this.version; draft.state.contractVersion = this.version;
    this.receiptScope = stableHash({draft:draft.state.key,project:context.projectId ?? (context.invocation.input as any)?.project?.id ?? ''});
    draft.state.metrics ??= {validationMs:0,acceptanceMs:0,correctionDispatchMs:0,correctionDispatches:0,correctionToolAttempts:0};
    draft.state.metrics.correctionToolAttempts ??= 0;
    if(draft.state.routing!==undefined){
      if(context.invocation.task!=='v2_generate_ways')throw new RuntimeError('INVALID_CONFIGURATION');
      context.routing=this.validateRouting(structuredClone(draft.state.routing));
    }
  }
  private validateRouting(value:unknown):KnowledgeRoutingOutput {
    const snapshot=(this.context.invocation.input as {snapshot:EpochSnapshot}).snapshot;
    if(value && typeof value==='object' && Object.hasOwn(value,'planningChange'))throw new ContractValidationError(['/planningChange: the prepared target is frozen. Omit planningChange and submit routing selections without changing the prepared target.'],'semantic',[{path:'/planningChange',keyword:'frozen-target',expected:'omitted',message:'The prepared target is frozen; omit planningChange from routing input.'}]);
    const bound=bindWayEnvelope({routing:value,ways:[]},snapshot) as {routing:KnowledgeRoutingOutput};
    exact(KnowledgeRoutingSchema,bound.routing);
    try {applyKnowledgeRouting(snapshot.policy,structuredClone(bound.routing),snapshot.sources,snapshot.userDomainPreferences);}
    catch(error){if(error instanceof ValidationError)throw new ContractValidationError([error.message],'semantic');throw error;}
    return bound.routing;
  }
  get correctionActive(){return Object.values(this.draft.state.recovery ?? {}).some(item=>item.pending);}
  get ended(){return this.accepted || Object.values(this.draft.state.recovery ?? {}).some(item=>item.pending && Object.values(item.fingerprints).some(count=>count>=2)) || !!this.fatal;}
  isCorrectingTool(tool:string):boolean {return this.draft.state.recovery?.[stableHash([this.receiptScope,tool])]?.pending ?? false;}
  private markProgress(tool:string):void { this.schemaRevision++; const key=stableHash([this.receiptScope,tool]);const recovery=this.draft.state.recovery?.[key];if(recovery){recovery.pending=false;recovery.fingerprints={};} }
  private retainedArguments(toolCallId?:string):{value:unknown}|undefined {
    if(!toolCallId)return;
    for(const row of [...this.draft.state.responses].reverse()){
      if(row.truncated)continue;
      let value:{toolCalls?:{id:string;arguments:unknown}[]};try{value=JSON.parse(row.text);}catch{continue;}
      const call=value.toolCalls?.find(call=>call.id===toolCallId);if(call)return {value:call.arguments};
    }
  }
  reject(message:string, operation?:{tool:string;toolCallId:string}, kind: 'format' | 'semantic' = 'format', details: readonly {path:string;keyword:string;expected?:string;message:string}[] = []){
    if(this.batch)this.batch.failed=true;
    this.failures++;
    this.draft.state.issues=[message];
    // Receipt identities are retention metadata, not evidence of diagnostic progress.
    const fingerprint = stableHash([kind, details.length ? details : message.replace(/body_[a-f0-9]{64}/g,'<saved-body>')]);
    const key=stableHash([this.receiptScope,operation?.tool ?? SUBMIT_RESULT]);
    const recovery=(this.draft.state.recovery ??= {})[key] ??= {pending:true,fingerprints:{}};
    recovery.pending=true;const attemptsUsed=recovery.fingerprints[fingerprint]=(recovery.fingerprints[fingerprint]??0)+1;
    const original=this.nativeHandoff?this.retainedArguments(operation?.toolCallId):undefined,codec=operation&&this.codecs.get(operation.tool);
    const permitted=this.nativeHandoff?kind==='format'&&this.draft.state.metrics!.correctionDispatches<1&&!!original&&!!codec&&canRepairNativeArguments(codec.schema,original.value):attemptsUsed<2;
    if(this.nativeHandoff&&permitted)this.schemaRevision++;
    if(this.nativeHandoff&&!permitted)this.fatal=new RuntimeError('INVALID_OUTPUT');
    const failure={...operation,attemptsUsed,correctionRemaining:permitted,classification:kind,fingerprint,noProgress:!permitted};
    this.draft.state.lastFailure=failure;
    return {...response({accepted:false,errors:[message],errorDetails:details,failure,retry:failure.correctionRemaining?(this.nativeHandoff?'Use the refreshed tool schema to correct only its listed fields. The host retains all original text and other fields.':'Resubmit the complete small result once. Reuse saved bodies.'):'No further automatic correction; retained work remains available.'}), isError:true};
  }
  compile(tools:readonly ToolDefinition[]):string[]{
    const names=tools.map(tool=>tool.name).join('\0');
    const bodies=Object.keys(this.draft.state.savedBundles).filter(key=>typeof this.draft.state.savedBundles[key]==='string').join('\0');
    if(this.compiled?.revision===this.schemaRevision && this.compiled.names===names && this.compiled.bodies===bodies && this.compiled.routing===this.context.routing && this.compiled.version===this.version)return [...this.codecs.keys()];
    this.codecs.clear();
    for(const tool of tools){
      if(this.nativeHandoff&&this.correctionActive&&this.draft.state.lastFailure?.correctionRemaining&&tool.name!==this.draft.state.lastFailure.tool)continue;
      if(tool.name===ROUTE_PLAN && this.context.invocation.task!=='v2_generate_ways')continue;
      try {
        let parameters=tool.parameters;
        if(tool.name==='save_proof_chapter'){
          const original=parameters as TSchema & {properties:Record<string,TSchema>};
          const handles=Object.entries(this.draft.state.savedBundles).filter(([,v])=>typeof v==='string').map(([k])=>k);
          const choices:TSchema[]=[Type.Object({text:Type.String({minLength:1,maxLength:1_000_000})},{additionalProperties:false})];
          if(handles.length)choices.push(Type.Object({savedBody:Type.String({enum:handles})},{additionalProperties:false}));
          parameters={...original,properties:{...original.properties,content:Type.Union(choices)}};
        }
        const codec=tool.name===SUBMIT_RESULT?stageContract(this.context,this.version):projectContract(parameters,this.context,this.version);
        if(this.nativeHandoff&&this.isCorrectingTool(tool.name)&&this.draft.state.lastFailure?.correctionRemaining){
          const original=this.retainedArguments(this.draft.state.lastFailure.toolCallId);
          if(!original)throw new RuntimeError('INVALID_CONFIGURATION');
          const repair=createNativeArgumentRepair(codec.schema,original.value);
          this.codecs.set(tool.name,{schema:repair.schema,decode(value){
            exact(repair.schema,value);
            let restored:unknown;try{restored=repair.decode(value);}catch{throw new ContractValidationError(['Format repair must preserve the original field meaning.'],'semantic');}
            return codec.decode(restored);
          }});
        }else this.codecs.set(tool.name,codec);
      } catch(error){
        // A reader with no authorized object cannot be offered; no result-schema fallback.
        if(['read_proof_chapter','read_final_proof','read_research_resource','read_session_attempt'].includes(tool.name) && error instanceof RuntimeError && error.code==='STRICT_SCHEMA_UNSUPPORTED')continue;
        throw error;
      }
    }
    this.compiled={revision:this.schemaRevision,names,bodies,routing:this.context.routing,version:this.version};
    return [...this.codecs.keys()];
  }
  async execute(tool:ToolDefinition,args:Parameters<ToolDefinition['execute']>){
    try{return await this.executeCall(tool,args);}catch(error){
      const classification=classifyHandoffError(error);
      this.fatal=error instanceof RuntimeError?error:new RuntimeError(classification==='permission'?'INVALID_TOOL':classification==='storage'?'OPERATION_RECONCILIATION_REQUIRED':'TOOL_FAILED');
      throw this.fatal;
    }
  }
  private async rejectPreparedBatch(tool:string, id:string){
    const batch=this.batch!;
    if(batch.reported)return {...response({accepted:false,errors:[batch.rejection],saved:false,batchRejected:true,...(batch.readOnly||batch.unsupported?{executed:false,skipped:true}:{})}),isError:true};
    batch.reported=true;const rejected=this.reject(batch.rejection!,{tool,toolCallId:id},batch.rejectionKind??'format',batch.rejectionDetails??[]);await this.draft.save();
    if(batch.unsupported){const value=JSON.parse(rejected.content[0].text);return {...rejected,...response({...value,saved:false,batchRejected:true,executed:false,skipped:true})};}
    return rejected;
  }
  private async executeCall(tool:ToolDefinition,args:Parameters<ToolDefinition['execute']>){
    const [id]=args;
    const raw=this.raw.get(id);this.raw.delete(id);
    const evidence=this.transportEvidence.get(id);this.transportEvidence.delete(id);
    if(evidence?.incomplete || evidence?.sdkMatchesRaw===false || evidence?.coverage==='insufficient')throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    if((this.batch?.readOnly || this.batch?.unsupported) && this.batch.rejection){
      await this.draft.capture(JSON.stringify({recoveryOnly:true,tool:tool.name,arguments:raw,...(evidence?.issue?{transport:evidence}:{})}),false);
      return this.rejectPreparedBatch(tool.name,id);
    }
    if(evidence?.issue){
      // Quarantine exact transport bytes and SDK interpretation; no body receipt or scientific adoption.
      await this.draft.capture(JSON.stringify({recoveryOnly:true,transport:evidence}),false);
      const details=evidence.syntaxError?[{path:'/',keyword:'json-syntax',expected:evidence.syntaxError.category,message:'Submit complete valid JSON; preserve scientific text and reuse retained body receipts.'}]:[];
      const result=this.reject(evidence.issue,{tool:tool.name,toolCallId:id},'format',details);await this.draft.save();return result;
    }
    await this.draft.capture(JSON.stringify({tool:tool.name,arguments:raw,...(evidence?.rawSchemaValid===false?{transport:evidence}:{})}),false);
    if (this.batch?.rejection) return this.rejectPreparedBatch(tool.name,id);
    if(this.ended)throw new RuntimeError('INVALID_OUTPUT');
    let retainedBody:string|undefined;
    if(tool.name==='save_proof_chapter'){
      retainedBody=this.draft.retainBody(raw);
      if(retainedBody)await this.draft.save();
    }
    let pendingOperation: string | undefined;
    try {
      const codec=this.codecs.get(tool.name);if(!codec)throw new RuntimeError('INVALID_TOOL');
      const validationStarted=performance.now();
      let decoded: unknown;
      try { decoded=codec.decode(raw); } finally { this.draft.state.metrics!.validationMs += performance.now()-validationStarted; }
      if(tool.name===SUBMIT_RESULT){
        let output=decoded;
        if(this.context.invocation.task==='v2_generate_ways')output={...decoded as object,...(this.context.routing?{routing:this.context.routing}:{})};
        const acceptedInput=structuredClone(output);
        const acceptanceStarted=performance.now();
        let validated: unknown;
        try { validated=await this.accept(output); } finally { this.draft.state.metrics!.acceptanceMs += performance.now()-acceptanceStarted; }
        this.draft.state.strictResult=acceptedInput;
        this.draft.state.handles=this.context.documents?.handleSnapshot()??[];
        this.draft.state.complete=true;this.draft.state.issues=[];
        this.markProgress(tool.name);
        await this.draft.save(); // Never accept until the receipt is durable.
        this.value=validated;this.accepted=true;
        return response({accepted:true,contract:this.version});
      }
      if(tool.name===ROUTE_PLAN){
        const routing=this.validateRouting(decoded);
        this.draft.state.routing=structuredClone(routing);
        await this.draft.save();
        this.context.routing=routing;this.markProgress(tool.name);
        return response({registered:true,anchors:routing.anchors.map(a=>({id:a.id,content:a.content})),domains:routing.domains.map(d=>({id:d.id,label:d.label}))});
      }
      if (tool.name === 'save_proof_chapter') {
        const receipts = this.draft.state.operationReceipts ??= {};
        const supplied=decoded as {content?:{text?:string;savedBody?:string}};
        const body=supplied.content?.text ?? this.draft.state.savedBundles[supplied.content?.savedBody ?? ''];
        if(typeof body!=='string')throw new ContractValidationError(['/content: select exact body text or an existing savedBody receipt.']);
        const argumentsHash = stableHash({...decoded as object,content:{bodyHash:stableHash(body)}});
        const operationKey = stableHash([this.receiptScope, tool.name, argumentsHash]);
        const prior = receipts[operationKey];
        if (prior?.scope === this.receiptScope && prior.status === 'completed' && prior.result !== undefined) {this.markProgress(tool.name);await this.draft.save();return structuredClone(prior.result) as Awaited<ReturnType<ToolDefinition['execute']>>;}
        if (Object.values(receipts).some(receipt => receipt.scope === this.receiptScope && receipt.status !== 'completed')) throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
        receipts[operationKey]={scope:this.receiptScope,tool:tool.name,argumentsHash,status:'pending'};
        await this.draft.save(); pendingOperation=operationKey;
      }
      const result=await tool.execute(id,decoded as any,args[2],args[3],args[4]);
      // Restricted readers/savers can return structured failures without throwing.
      for(const c of result.content)if(c.type==='text'){let v:any;try{v=JSON.parse(c.text);}catch{continue;}if(v?.error) { if(v.error==='CHAPTER_REFERENCE_NOT_AVAILABLE'&&v.recoverable===true)throw new ContractValidationError(['Select an available exact chapter reference from the authorized tool receipt; do not change scientific content.'],'semantic'); if (v.error === 'INTERFACE_SELECTION') throw interfaceSelectionFailure(v); throw new RuntimeError('INVALID_TOOL'); }
        if(tool.name==='search_research_resources' && Array.isArray(v))this.context.resources=[...(this.context.resources??[]),...v.map(r=>({id:r.id,version:r.version}))];
        if(tool.name==='search_final_proofs' && Array.isArray(v))this.context.proofs=[...(this.context.proofs??[]),...v];
      }
      if(tool.name==='save_proof_chapter'){
        const previous = new Set(this.draft.state.handles.map(([handle])=>handle));
        const added = (this.context.documents?.referenceDirectory()??[]).filter(item=>!previous.has((item as {handle:string}).handle));
        await this.checkpointHandles();
        this.markProgress(tool.name);
        const completed = {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({references:added})}]};
        if (pendingOperation) { const receipt=this.draft.state.operationReceipts![pendingOperation];receipt.status='completed';receipt.result=structuredClone(completed);await this.draft.save(); }
        return completed;
      }
      this.markProgress(tool.name);return result;
    } catch(error){
      this.draft.state.complete=false;delete this.draft.state.strictResult;
      if(this.batch)this.batch.failed=true;
      if (pendingOperation) {
        const receipt=this.draft.state.operationReceipts![pendingOperation];
        // A typed pre-effect format rejection is safe to correct; every other effect is uncertain.
        if (error instanceof ContractValidationError) delete this.draft.state.operationReceipts![pendingOperation];
        else { receipt.status='uncertain'; if(error instanceof AtomicWriteError)receipt.published=error.published;const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^[A-Z_]{1,64}$/.test(code))receipt.code=code; }
      }
      if (!(error instanceof ContractValidationError)) {
        const classification=classifyHandoffError(error);
        this.fatal=error instanceof RuntimeError?error:new RuntimeError(classification==='permission'?'INVALID_TOOL':classification==='storage'?'OPERATION_RECONCILIATION_REQUIRED':'TOOL_FAILED');
        await this.draft.save();throw this.fatal;
      }
      if(this.batch?.readOnly){this.batch.rejection='A preceding read needs local correction. This remaining read was skipped and did not execute; resubmit the intended authorized read after correction.';this.batch.reported=true;}
      const result=this.reject(error.message+(retainedBody?`; body retained as ${retainedBody}; select content.savedBody on correction.`:''),{tool:tool.name,toolCallId:id},error.kind,error.details);
      await this.draft.save();return result;
    }
  }
}

/** Register placeholders locally. Actual schemas are generated per dispatch, before HTTP. */
export function terminalTools():ToolDefinition[]{
  return [
    {name:SUBMIT_RESULT,label:'Deliver research result',description:'Deliver the complete native scientific result for this frozen stage. Omit unused optional fields; do not add transport envelopes or presence wrappers. Local format, permissions and scientific checks remain mandatory.',parameters:Type.Object({}),execute:async()=>response({})},
    {name:ROUTE_PLAN,label:'Register macro guidance',description:'Register the selected sparse guidance before choosing its anchor/domain IDs in ways. Reuse frozen Base guidance; no detailed derivation here.',parameters:WaysWireSchema.properties.routing,execute:async()=>response({})},
  ];
}

/** Body receipts survive invalid metadata. Retry selects the saved bytes, never past result fields. */
export function chapterTool(original:ToolDefinition,readDraft:()=>ReportDraft|undefined):ToolDefinition {
  const source=original.parameters as TSchema & {properties:Record<string,TSchema>;required?:string[]};
  const properties={...source.properties};delete properties.chapterId;delete properties.complete;
  // A body is either new bytes or an exact private recovery receipt.
  properties.content=Type.Union([Type.Object({text:Type.String({minLength:1,maxLength:1_000_000})},{additionalProperties:false}),Type.Object({savedBody:Type.String({minLength:1})},{additionalProperties:false})]);
  return {...original,parameters:Type.Object(properties,{additionalProperties:false}),execute:async(id,value,signal,update,context)=>{
    const draft=readDraft();if(!draft)throw new RuntimeError('INVALID_CONFIGURATION');
    const v=value as any;let body:string,bodyId:string;
    if('text' in v.content){body=v.content.text;bodyId='body_'+stableHash(body);draft.state.savedBundles[bodyId]=body;await draft.save();}
    else {bodyId=v.content.savedBody;const saved=draft.state.savedBundles[bodyId];if(typeof saved!=='string')throw new RuntimeError('INVALID_TOOL');body=saved;}
    try{
      const result=await original.execute(id,{...v,content:body,chapterId:chapterIdentity(v,body),complete:true},signal,update,context);
      for(const c of result.content)if(c.type==='text'){let parsed:any;try{parsed=JSON.parse(c.text);}catch{continue;}if(parsed?.error){if(parsed.error==='CHAPTER_REFERENCE_NOT_AVAILABLE'&&parsed.recoverable===true)throw new ContractValidationError(['Select an available exact chapter reference from the authorized tool receipt; do not change scientific content.'],'semantic');if(parsed.error==='INTERFACE_SELECTION')throw interfaceSelectionFailure(parsed);throw new RuntimeError('INVALID_TOOL');}}
      return result;
    }catch(error){if(error instanceof ContractValidationError)throw new ContractValidationError([...error.issues,`Body retained as ${bodyId}; select content.savedBody on correction.`],error.kind,error.details);throw error;}
  }};
}

/** Shared deterministic identity for preflight and the actual write. */
function chapterIdentity(value:{title:unknown;summary:unknown;component?:unknown},body:string):string {
  return 'chapter_'+stableHash({title:value.title,summary:value.summary,body,component:value.component});
}
