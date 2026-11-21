import {workerDispatchRule} from '../research/versions/v21/optional-types.js';
import {scientificMapFormatIssue} from '../research/versions/v4/scientific-map-write.js';
import { DeclarationSupplementError } from './declaration-supplement.js';
import {guidanceReferenceComparisonV3,type GuidanceReferenceStateV3} from './guidance-reference-repair.js';
import { preflightV21MemoryTool } from './v21-memory-tools.js';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { isDeepStrictEqual } from 'node:util';
import { canonicalCodec, ContractValidationError, type SchemaCodec } from './strict-schema.js';
import { RuntimeError } from './errors.js';
import { SUBMIT_RESULT } from './stage-contract.js';
import { decodeSafeToolArguments, SafeToolArgumentsError } from './safe-tool-arguments.js';
import type { ToolArgumentEvidence } from './tool-argument-audit.js';
import type { OperationJournal } from './operation-journal.js';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { V0AnswerCollector } from './v0-answer.js';

export interface V21ControlOptions {
  /** Fresh V4 permits one format-only repair, independently of scientific budgets. */
  nativeHandoff?: boolean;
  optionalProof?: boolean;
  declarationSupplement?: boolean;
  /** Fresh host-root classifier has no legally editable metadata fields. */
  rejectInvalidDeclaration?: boolean;
  /** Only operation8 opts in; all earlier operation contracts retain their behavior. */
  singleScientificResponse?: boolean;
  cancelled?: () => boolean;
  resultReady?: (value: unknown) => Promise<void>;
  metadataTagPaths?: RegExp[];
  zeroExposureGuidance?:()=>GuidanceReferenceStateV3;
}
export class V21Control {
  private readonly tools = new Map<string,ToolDefinition>();
  readonly codecs = new Map<string, SchemaCodec>();
  readonly evidence = new Map<string, ToolArgumentEvidence>();
  private readonly prepared = new Map<string, unknown>();
  accepted = false;
  value?: unknown;
  feedback?: string;
  fatal?: RuntimeError;
  private fingerprints = new Set<string>();
  correction = false;
  private dispatch = 0;
  private correctionDispatches = 0;
  protected collector?: V0AnswerCollector;
  private declaration?: unknown;
  private declarationSeen = false;
  private supplement?:DeclarationSupplementError;
  private missingDeclaration=false;
  get supplementPrompt():string|undefined {
    if(this.supplement)return 'The original manuscript and all other fields are saved. Check that the saved manuscript supports the correction. Submit only the fields in the refreshed tool schema. If the manuscript itself needs revision, leave the declaration unsubmitted. Use the terminal tool once with no prose. ';
    if(this.missingDeclaration)return 'The original manuscript is saved. Supply its missing declaration once through the terminal tool. Use only the saved argument and evidence. Write no new prose. ';
  }
  constructor(readonly journal: OperationJournal, tools: ToolDefinition[], private readonly schema: TSchema, private readonly prepare: (value: unknown) => unknown, readonly judgmentBatch = false, private readonly options: V21ControlOptions = {}) {
    for (const tool of tools) this.tools.set(tool.name,tool);
    // Keep saved operation pins stable. Only the provider-facing description changes.
    const fields=(schema as Shape).properties;
    const wireSchema=options.optionalProof&&fields?.action
      ? {...schema,properties:{...fields,action:{...fields.action,description:workerDispatchRule}}}
      : schema;
    for (const tool of tools) this.codecs.set(tool.name, canonicalCodec(tool.name === SUBMIT_RESULT ? wireSchema : tool.parameters));
  }
  /** Pi must not silently extend a metadata repair into another scientific turn. */
  get allowsDispatch(): boolean { if (this.options.cancelled?.()) return false; if (this.options.singleScientificResponse) return !this.accepted && !this.fatal && this.dispatch === this.journal.state.corrections; return !this.judgmentBatch || (!this.accepted && !this.fatal && (!this.correction || this.correctionDispatches < this.journal.state.corrections)); }
  startDispatch(): void {
    this.evidence.clear(); this.prepared.clear(); this.dispatch++;
    if (!this.judgmentBatch) return;
    if (this.correction) this.correctionDispatches++;
    const dispatch = this.dispatch;
    this.collector = new V0AnswerCollector(event => { void this.journal.capture({kind:'v21-public-text',dispatch,correction:this.correction,event}).catch(() => {}); });
  }
  observe(event: AssistantMessageEvent): void { this.collector?.observe(event); }
  async prepareMessage(message: AssistantMessage, skippedOperation=false): Promise<void> {
    this.prepared.clear();
    const calls = message.content.filter(part => part.type === 'toolCall');
    if (this.judgmentBatch) {
      // Append the exact public reply AND raw arguments before any JSON decoding.
      // Corrections never replace the first response, even when validation fails.
      await this.journal.capture({kind:'v21-message',dispatch:this.dispatch,firstResponse:this.dispatch===1,correction:this.correction,message:{...message,content:message.content.filter(part=>part.type!=='thinking')}});
      for (const evidence of this.evidence.values()) await this.journal.capture({kind:'v21-argument-evidence',dispatch:this.dispatch,evidence});
      if (this.collector?.mismatch) { this.fatal = new RuntimeError('TOOL_PROTOCOL_FAILED'); return; }
      const text = message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
      if(skippedOperation && !calls.length && message.stopReason==='toolUse'){
        if(this.correction)this.correctionDispatches--;
        return;
      }
      const terminalIndex = message.content.findIndex(part=>part.type==='toolCall' && part.name===SUBMIT_RESULT);
      if (this.correction && (text.length > 0 || calls.length !== 1 || calls[0].name !== SUBMIT_RESULT)
        || terminalIndex >= 0 && message.content.slice(terminalIndex+1).some(part=>part.type!=='thinking')) {
        this.fatal = new RuntimeError('TOOL_PROTOCOL_FAILED'); return;
      }
    }
    if (message.stopReason === 'stop' && !calls.length && !this.evidence.size) {
      if(this.options.declarationSupplement&&!this.correction&&this.canRequestFormatCorrection()&&message.content.some(part=>part.type==='text'&&part.text.trim())){
        this.missingDeclaration=true;
        this.feedback='The manuscript is present. Its terminal declaration is missing.';
        await this.journal.capture({kind:'v4-missing-declaration'});
        return;
      }
      if (this.judgmentBatch) { await this.rejectUnassessed('No complete scientific declaration was supplied; metadata repair cannot invent it.'); return; }
      this.feedback = 'Submit the complete scientific result through submit_research_result, not plain text.';
      return;
    }
    if (message.stopReason !== 'toolUse' || !calls.length || this.evidence.size !== calls.length || new Set(calls.map(call => call.id)).size !== calls.length || (calls.some(call => call.name === SUBMIT_RESULT) && calls.length !== 1)) {
      this.fatal = new RuntimeError('TOOL_PROTOCOL_FAILED'); return;
    }
    try {
      for (const call of calls) {
        const evidence = this.evidence.get(call.id);
        if (!evidence || evidence.tool !== call.name || !isDeepStrictEqual(evidence.sdkArguments, call.arguments)) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
        const decoded = decodeSafeToolArguments(evidence);
        await this.journal.capture({ kind: 'arguments', callId: call.id, evidence, effective: decoded });
        const supplement=this.correction&&call.name===SUBMIT_RESULT?this.supplement:undefined;
        if (this.judgmentBatch && call.name === SUBMIT_RESULT && !supplement) await this.guardDeclaration(decoded.value);
        if(this.options.optionalProof && call.name===SUBMIT_RESULT && !supplement && record(decoded.value)){
          const {action,outcome,workers}=decoded.value;
          if(action==='dispatch' && (!record(outcome)||outcome.resultKind!=='open'||!Array.isArray(workers)||!workers.length)
            || action!=='dispatch' && Array.isArray(workers) && workers.length){
            await this.rejectScientificStep(workerDispatchRule);
            return;
          }
        }
        const codec = this.codecs.get(call.name);
        if (!codec) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
        if(!this.correction&&call.name===SUBMIT_RESULT&&this.options.declarationSupplement&&(this.schema as Shape).properties?.mapChanges){
          const format=scientificMapFormatIssue((decoded.value as {mapChanges?:unknown}|undefined)?.mapChanges);
          if(format)throw format;
        }
        const patch = codec.decode(decoded.value);
        const wire = supplement?supplement.restore(this.declaration,patch):patch;
        await preflightV21MemoryTool(this.tools.get(call.name)!, wire);
        const prepared = call.name === SUBMIT_RESULT ? this.prepare(wire) : wire;
        this.prepared.set(call.id, structuredClone(prepared));
      }
    } catch (error) {
      this.prepared.clear();
      if (await this.rejectToolArguments(error,calls)) return;
      if(this.options.optionalProof && error instanceof DeclarationSupplementError && (error.fields==='action'||error.fields==='measured-outcome')){
        await this.rejectScientificStep(error.message);
        return;
      }
      if(error instanceof DeclarationSupplementError&&this.options.declarationSupplement&&!this.correction&&this.canRequestFormatCorrection()&&this.declarationSeen){
        this.supplement=error;
        this.codecs.set(SUBMIT_RESULT,canonicalCodec(error.schema));
        this.feedback=error.message;
        await this.journal.capture({kind:'v4-declaration-supplement',fields:error.fields,diagnostics:error.issues});
        return;
      }
      if (error instanceof ContractValidationError || error instanceof SafeToolArgumentsError && error.kind === 'format') {
        if(this.options.optionalProof && calls.some(call=>call.name===SUBMIT_RESULT) && error instanceof ContractValidationError
          && !(this.options.zeroExposureGuidance && !this.options.nativeHandoff && error.kind==='semantic' && error.issues.every(issue=>issue==='Selected method resource requires an exact delivered frozen version.'))
          && (error.kind==='semantic'||!this.repairableMetadata())){
          await this.rejectScientificStep(error.message);
          return;
        }
        if(this.options.nativeHandoff && (error instanceof ContractValidationError && error.kind!=='format' || !this.canRequestFormatCorrection())){await this.rejectUnassessed(error.message);return;}
        if(this.options.nativeHandoff&&calls.some(call=>call.name===SUBMIT_RESULT)&&!this.repairableMetadata()){await this.rejectUnassessed('The original report is retained. This declaration cannot be repaired without changing scientific fields.');return;}
        if(this.options.rejectInvalidDeclaration&&this.judgmentBatch&&this.declarationSeen&&error instanceof ContractValidationError&&calls.some(call=>call.name===SUBMIT_RESULT)){await this.rejectUnassessed('Unrepairable root classification: the retained scientific declaration has no editable metadata fields.\n'+error.issues.join('\n'));return;}
        if(this.options.zeroExposureGuidance&&error instanceof ContractValidationError&&error.kind==='semantic'&&!error.issues.every(issue=>issue==='Selected method resource requires an exact delivered frozen version.')){await this.rejectUnassessed(error.issues.join('\n'));return;}
        const feedback = error instanceof ContractValidationError ? error.issues.slice(0, 32).join('\n') : error.diagnostics.slice(0, 32).map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
        if (this.judgmentBatch && calls.some(call=>call.name===SUBMIT_RESULT) && !this.declarationSeen) { await this.rejectUnassessed(feedback); return; }
        if (this.fingerprints.has(feedback)) this.fatal = new RuntimeError('INVALID_OUTPUT');
        else { this.fingerprints.add(feedback); this.feedback = feedback; }
      } else this.fatal = error instanceof RuntimeError ? error : new RuntimeError('TOOL_PROTOCOL_FAILED');
    }
  }
  /** Version-specific pure input feedback; historical controls do not opt in. */
  protected async rejectToolArguments(_error:unknown,_calls:Extract<AssistantMessage['content'][number],{type:'toolCall'}>[]):Promise<boolean>{return false;}
  protected canRequestFormatCorrection():boolean{return !this.options.nativeHandoff||this.journal.state.corrections<1;}
  private repairableMetadata():boolean {
    if(!this.declarationSeen)return false;
    const errors=Value.Errors(this.schema,this.declaration),paths=this.options.metadataTagPaths??[/^\/(?:closures|failures)\/\d+\/tags$/];
    return errors.length>0&&errors.every(error=>{
      const missing=(error.params as {requiredProperties?:unknown}).requiredProperties;
      return error.keyword==='required'&&Array.isArray(missing)&&missing.length>0&&missing.every(key=>typeof key==='string'&&paths.some(pattern=>pattern.test(`${error.instancePath}/${key}`)));
    });
  }
  private async rejectScientificStep(diagnostics:string):Promise<void>{
    await this.journal.capture({kind:'v21-rejected-scientific-step',diagnostics});
    this.fatal=new RuntimeError('SCIENTIFIC_STEP_REJECTED');
  }
  private async rejectUnassessed(diagnostics: string): Promise<void> {
    await this.journal.capture({kind:'v21-unassessed-declaration',diagnostics});
    this.fatal = new RuntimeError('INVALID_OUTPUT');
  }
  /** Rehydrate the original declaration only for local crash reconciliation. */
  restoreDeclaration(value: unknown): void {
    if (this.declarationSeen || !record(value)) throw new RuntimeError('INVALID_CONFIGURATION');
    this.declaration = structuredClone(value); this.declarationSeen = true;
  }
  private async guardDeclaration(value: unknown): Promise<void> {
    if (!this.declarationSeen) {
      if (this.correction&&!this.missingDeclaration || !record(value)) throw new ContractValidationError(['Metadata correction requires a complete original scientific declaration; missing science cannot be reconstructed.'],'semantic');
      this.declaration = structuredClone(value); this.declarationSeen = true;
      await this.journal.capture({kind:'v21-declaration-constraints',declaration:this.declaration});
      if(this.options.zeroExposureGuidance)guidanceReferenceComparisonV3(this.declaration,this.options.zeroExposureGuidance());
      return;
    }
    const repair=this.options.zeroExposureGuidance?guidanceReferenceComparisonV3(this.declaration,this.options.zeroExposureGuidance()):undefined;
    if (!metadataOnly(repair?.comparison??this.declaration,value,this.schema,'',this.options.metadataTagPaths)) throw new ContractValidationError([
      'Metadata correction must preserve every original field, its absence, array order and scope. Only missing closure/failure tags may be added; no new claims, assumptions, dependencies, adoption, closure or reproducibility judgments. Unknown fields may contain scientific caveats and cannot be silently removed.'
    ],'semantic');
    if(repair?.removed.length)await this.journal.capture({kind:'v3-zero-exposure-guidance-correction',path:'/route/resourceRefs',original:(this.declaration as any).route.resourceRefs,corrected:(value as any).route.resourceRefs,removed:repair.removed});
  }
  permits(id: string): boolean { return !this.options.cancelled?.() && !this.fatal && !this.feedback && this.prepared.has(id); }
  async execute(tool: ToolDefinition, args: Parameters<ToolDefinition['execute']>): Promise<Awaited<ReturnType<ToolDefinition['execute']>>> {
    if (!this.permits(args[0])) throw new RuntimeError('TOOL_PROTOCOL_FAILED');
    const value = this.prepared.get(args[0]);
    // All validation was pure and complete before this durable effect boundary.
    await this.journal.capture({ kind: 'effect-pending', callId: args[0], tool: tool.name });
    try {
      if (this.options.cancelled?.()) throw new RuntimeError('BUDGET_EXHAUSTED');
      if (tool.name === SUBMIT_RESULT) {
        await this.options.resultReady?.(value);
        await this.journal.complete(value); this.value = value; this.accepted = true;
        return { content: [{ type: 'text', text: 'Recorded.' }], details: {} };
      }
      const effective = [...args] as Parameters<ToolDefinition['execute']>; effective[1] = value;
      const result = await tool.execute(...effective);
      await this.journal.capture({ kind: 'effect-completed', callId: args[0], tool: tool.name, details: result.details });
      return result;
    } catch { this.fatal = new RuntimeError('OPERATION_RECONCILIATION_REQUIRED'); throw this.fatal; }
  }
}

type Shape = TSchema & { properties?: Record<string,TSchema>; items?: TSchema; anyOf?: TSchema[]; oneOf?: TSchema[] };
function record(value: unknown): value is Record<string,unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function alternatives(schema: TSchema): Shape[] {
  const shape = schema as Shape, choices = shape.anyOf ?? shape.oneOf;
  return choices ? choices.flatMap(alternatives) : [shape];
}
/** Conservative syntactic comparison, never a host scientific equivalence judgment.
 * All original values (including unknown fields or invalid science) and missing
 * scientific fields stay locked. Only absent classification tags can
 * be filled, under the ordinary schema and subsequent semantic validation. */
function metadataOnly(original: unknown, next: unknown, schema?: TSchema, path = '', tagPaths: RegExp[] = [/^\/(?:closures|failures)\/\d+\/tags$/]): boolean {
  if (isDeepStrictEqual(original,next)) return true;
  if (!schema) return false;
  const shapes = alternatives(schema);
  if (Array.isArray(original) && Array.isArray(next)) {
    const items = shapes.map(shape=>shape.items).filter((item): item is TSchema=>!!item && !Array.isArray(item));
    if (original.length !== next.length || items.length !== 1) return false;
    return original.every((item,index)=>metadataOnly(item,next[index],items[0],`${path}/${index}`,tagPaths));
  }
  if (!record(original) || !record(next)) return false;
  const properties: Record<string,TSchema[]> = Object.create(null);
  for (const shape of shapes) for (const [key,child] of Object.entries(shape.properties ?? {})) (properties[key] ??= []).push(child);
  for (const [key,value] of Object.entries(original)) {
    const definitions = properties[key];
    if (!Object.hasOwn(next,key)) return false;
    const child = definitions?.length === 1 ? definitions[0] : definitions?.length ? {anyOf:definitions} as TSchema : undefined;
    if (!metadataOnly(value,next[key],child,`${path}/${key}`,tagPaths)) return false;
  }
  for (const [key,value] of Object.entries(next)) if (!Object.hasOwn(original,key)) {
    const definitions = properties[key], childPath = `${path}/${key}`;
    if (!tagPaths.some(pattern=>pattern.test(childPath)) || !definitions?.some(child=>Value.Check(child,value))) return false;
  }
  return true;
}
