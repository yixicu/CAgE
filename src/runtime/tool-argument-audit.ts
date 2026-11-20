import { isDeepStrictEqual } from 'node:util';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import { stableHash } from '../learning/research-hash.js';
import { HANDOFF_VERSION, checkSchema, type HandoffVersion } from './strict-schema.js';

export interface JsonSyntaxDiagnostic {
  category: 'object-delimiter' | 'array-delimiter' | 'property-name' | 'property-colon' | 'escape' | 'unexpected-end' | 'unterminated-string' | 'trailing-content' | 'invalid-json';
  expected?: string;
  offset?: number; line?: number; column?: number;
  positionUnit: 'utf16-code-unit';
}
/** Read only known parser categories and bounded numeric positions; never echo parser text/input. */
export function diagnoseJsonSyntax(error: unknown, raw: string): JsonSyntaxDiagnostic {
  const message=error instanceof SyntaxError && typeof error.message==='string'?error.message:'';
  const known: readonly [RegExp,JsonSyntaxDiagnostic['category'],string][] = [
    [/^Expected ',' or '}' after property value in JSON(?: at position|$)/,'object-delimiter',"comma or object end"],
    [/^Expected ',' or ']' after array element in JSON(?: at position|$)/,'array-delimiter',"comma or array end"],
    [/^Expected (?:double-quoted property name|property name or '}') in JSON(?: at position|$)/,'property-name',"double-quoted property name or object end"],
    [/^Expected ':' after property name in JSON(?: at position|$)/,'property-colon',"colon"],
    [/^(?:Bad escaped character|Bad Unicode escape) in JSON(?: at position|$)/,'escape',"valid JSON escape"],
    [/^Unexpected end of JSON input$/,'unexpected-end',"complete JSON value"],
    [/^Unterminated string in JSON(?: at position|$)/,'unterminated-string',"closing string quote"],
    [/^Unexpected non-whitespace character after JSON(?: at position|$)/,'trailing-content',"end of JSON input"],
  ];
  const match=known.find(([pattern])=>pattern.test(message));
  const result:JsonSyntaxDiagnostic={category:match?.[1]??'invalid-json',...(match?{expected:match[2]}:{}),positionUnit:'utf16-code-unit'};
  // V8 reports a zero-based UTF-16 offset; do not confuse it with UTF-8 byte count.
  const position=message.match(/ at position (\d+)(?: \(line \d+ column \d+\))?$/);
  const offset=position?Number(position[1]):result.category==='unexpected-end'?raw.length:undefined;
  if(offset!==undefined && Number.isSafeInteger(offset) && offset>=0 && offset<=raw.length){
    result.offset=offset;let line=1,column=1;
    for(let i=0;i<offset;i++){if(raw.charCodeAt(i)===10){line++;column=1;}else column++;}
    result.line=line;result.column=column;
  }
  return result;
}

export interface ToolArgumentEvidence {
  toolCallId: string; tool: string; api: string;
  coverage: 'chat-argument-deltas' | 'response-argument-events' | 'anthropic-argument-events' | 'insufficient';
  rawArguments?: string; sdkArguments: unknown; schema?: TSchema; remoteSchema?: TSchema; remoteSchemaHash?: string;
  jsonValid?: boolean; sdkMatchesRaw?: boolean; rawSchemaValid?: boolean; remoteSchemaValid?: boolean;
  schemaErrors?: { path: string; message: string }[];
  identityValid?: boolean; identityIssue?: string; sdkEmptyObject?: boolean;
  issue?: string; syntaxError?: JsonSyntaxDiagnostic; incomplete?: true; finalReplacedDeltas?: boolean;
  contractContext?: AuditTarget & { contract: string; schemaHash: string; declaredStrict?: boolean };
}
interface AuditTarget { provider: string; model: string; endpoint: string }
interface NativeArguments { id: string; name: string; parts: string[]; complete: boolean; replaced?: boolean; initial?: unknown; deltas?: boolean }

/** Dispatch-local argument evidence, using the installed SDK's pre-normalization hook.
 * No headers, request history, text or thinking events are retained. Parsed native
 * events are evidence about arguments, not a claim of full HTTP/SSE byte capture. */
export class ToolArgumentAudit {
  private readonly chunks = new Map<number, string[]>();
  private readonly seenIndices = new Set<number>();
  private readonly seenIds = new Set<string>();
  private identityIssue?: string;
  private readonly chatNative = new Map<number, {id:string;name:string;parts:string[];complete:boolean}>();
  private readonly chatIds = new Map<string, number>();
  private readonly nativeIds = new Map<string, number>();
  private failIdentity(): void { this.identityIssue = 'Tool call identity changed, restarted, or conflicted within the dispatch.'; }
  private bind(index: number, id: string): void {
    if (!Number.isSafeInteger(index) || index < 0 || (this.indices.has(index) && this.indices.get(index) !== id) || (this.nativeIds.has(id) && this.nativeIds.get(id) !== index)) this.failIdentity();
    else { this.indices.set(index, id); this.nativeIds.set(id, index); }
  }
  private readonly calls = new Map<number,{id:string;name:string;arguments:unknown}>();
  private readonly native = new Map<string, NativeArguments>();
  private readonly indices = new Map<number, string>();
  private target?: AuditTarget;
  private readonly remoteSchemas = new Map<string, { schema: TSchema; strict: boolean }>();
  constructor(private readonly api: string, private readonly schemas: ReadonlyMap<string, TSchema>, target?: AuditTarget, private readonly contractVersion: HandoffVersion = HANDOFF_VERSION) { if(target)this.setTarget(target); }
  setTarget(target: AuditTarget): void {
    let endpoint='invalid';
    try { const url=new URL(target.endpoint); endpoint=url.origin+url.pathname; } catch { /* Never retain credentials or query strings. */ }
    this.target={provider:target.provider,model:target.model,endpoint};
  }
  /** Observe only the final outgoing declarations, never messages, headers or credentials. */
  captureRemoteTools(payload: unknown): void {
    this.remoteSchemas.clear();
    const tools = (payload as { tools?: unknown[] } | null)?.tools;
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      const declaration = this.api === 'openai-completions' ? (tool as any)?.function : tool as any;
      const schema = this.api === 'anthropic-messages' ? declaration?.input_schema : declaration?.parameters;
      if (typeof declaration?.name === 'string' && schema && typeof schema === 'object') this.remoteSchemas.set(declaration.name, { schema: structuredClone(schema), strict: declaration.strict === true });
    }
  }
  /** Called before Pi mutates provider-owned events. Store deltas, not cumulative snapshots. */
  observeProvider(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const e = value as any;
    if (this.api === 'openai-completions') {
      const choice = e.choices?.[0];
      for (const call of choice?.delta?.tool_calls ?? []) {
        if (!Number.isSafeInteger(call.index) || call.index < 0) { this.failIdentity(); continue; }
        let row = this.chatNative.get(call.index);
        if (!row) { row = {id:'', name:'', parts:[], complete:false}; this.chatNative.set(call.index,row); }
        if (row.complete) this.failIdentity();
        if (typeof call.id === 'string' && call.id) {
          if ((row.id && row.id !== call.id) || (this.chatIds.has(call.id) && this.chatIds.get(call.id) !== call.index)) this.failIdentity();
          row.id ||= call.id; this.chatIds.set(call.id, call.index);
        }
        if (typeof call.function?.name === 'string' && call.function.name) {
          if (row.name && row.name !== call.function.name) this.failIdentity();
          row.name ||= call.function.name;
        }
        if (typeof call.function?.arguments === 'string') row.parts.push(call.function.arguments);
      }
      if (typeof choice?.finish_reason === 'string') for (const row of this.chatNative.values()) row.complete = true;
      return;
    }
    if (this.api === 'anthropic-messages') {
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
        const b = e.content_block;
        if (typeof b.id !== 'string' || !b.id || typeof b.name !== 'string' || !b.name) { this.failIdentity(); return; }
        if (this.native.has(b.id) || this.seenIds.has(b.id) || this.indices.has(e.index)) { this.failIdentity(); return; }
        const initial = structuredClone(b.input ?? {});
        this.bind(e.index, b.id);
        this.native.set(b.id, { id: b.id, name: b.name, parts: [JSON.stringify(initial)], initial, complete: false });
      }
      const row = this.native.get(this.indices.get(e.index) ?? '');
      if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
        if (!row || row.complete || typeof e.delta.partial_json !== 'string') { this.failIdentity(); return; }
        if (!row.deltas) { row.parts = []; row.deltas = true; }
        row.parts.push(e.delta.partial_json);
      }
      if (row && e.type === 'content_block_stop') {
        if (row.complete) this.failIdentity();
        row.complete = true;
      }
      return;
    }
    if (!['openai-responses', 'azure-openai-responses', 'openai-codex-responses'].includes(this.api)) return;
    if ((e.type === 'response.output_item.added' || e.type === 'response.output_item.done') && e.item?.type === 'function_call') {
      const item = e.item;
      if (typeof item.call_id !== 'string' || !item.call_id || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name) { this.failIdentity(); return; }
      const id = `${item.call_id}|${item.id}`;
      let row = this.native.get(id);
      if (this.seenIds.has(id) || (row && (row.name !== item.name || row.complete || e.type === 'response.output_item.added'))) this.failIdentity();
      if (!row && e.type === 'response.output_item.done') this.failIdentity();
      if (!row) { row = { id, name: item.name, parts: [], complete: false }; this.native.set(id, row); }
      this.bind(e.output_index, id);
      if (typeof item.arguments === 'string' && (item.arguments.length || e.type === 'response.output_item.done')) {
        const previous = row.parts.join(''); row.replaced ||= !!previous && previous !== item.arguments; row.parts = [item.arguments];
      }
      if (e.type === 'response.output_item.done') row.complete = true;
    }
    const row = this.native.get(this.indices.get(e.output_index) ?? '');
    if (e.type === 'response.function_call_arguments.delta' || e.type === 'response.function_call_arguments.done') {
      if (!row || row.complete || (e.item_id !== undefined && row.id.slice(row.id.indexOf('|') + 1) !== e.item_id)) { this.failIdentity(); return; }
      if (e.type === 'response.function_call_arguments.delta' && typeof e.delta === 'string') row.parts.push(e.delta);
      else if (e.type === 'response.function_call_arguments.done' && typeof e.arguments === 'string') {
        const previous = row.parts.join(''); row.replaced ||= !!previous && previous !== e.arguments; row.parts = [e.arguments];
      } else this.failIdentity();
    }
  }
  drain(): ToolArgumentEvidence[] {
    const remaining=[...this.chunks].map(([index,parts]):ToolArgumentEvidence=>{
      const rawArguments=parts.join('');
      const call=this.calls.get(index);
      return {toolCallId:call?.id??`unfinished-${index}`,tool:call?.name??'unknown',api:this.api,
        coverage:'insufficient',incomplete:true,identityValid:false,rawArguments,sdkArguments:call?.arguments};
    });
    for(const [index,call] of this.calls)if(!this.chunks.has(index))remaining.push({toolCallId:call.id||`unfinished-${index}`,tool:call.name||'unknown',api:this.api,coverage:'insufficient',incomplete:true,identityValid:false,sdkArguments:undefined});
    const ids=new Set(remaining.map(r=>r.toolCallId));
    for(const row of this.native.values())if(!ids.has(row.id))remaining.push({toolCallId:row.id,tool:row.name,api:this.api,coverage:'insufficient',incomplete:true,identityValid:false,rawArguments:row.parts.join(''),sdkArguments:undefined});
    for(const row of this.chatNative.values())remaining.push({toolCallId:row.id||'unfinished-chat',tool:row.name||'unknown',api:this.api,coverage:'insufficient',incomplete:true,identityValid:false,rawArguments:row.parts.join(''),sdkArguments:undefined});
    if(this.identityIssue)remaining.push({toolCallId:'invalid-dispatch-identity',tool:'unknown',api:this.api,coverage:'insufficient',identityValid:false,identityIssue:this.identityIssue,issue:this.identityIssue,sdkArguments:undefined});
    this.chatNative.clear();this.chatIds.clear();this.chunks.clear();this.calls.clear();this.native.clear();this.indices.clear();this.nativeIds.clear();this.seenIds.clear();this.seenIndices.clear();this.identityIssue=undefined;return remaining;
  }
  observe(event: AssistantMessageEvent): ToolArgumentEvidence | undefined {
    if (event.type === 'toolcall_start' || event.type === 'toolcall_delta' || event.type === 'toolcall_end') {
      if (!Number.isSafeInteger(event.contentIndex) || event.contentIndex < 0) { this.failIdentity(); return; }
      if (event.type === 'toolcall_end' && (!event.toolCall || typeof event.toolCall.id !== 'string' || !event.toolCall.id || typeof event.toolCall.name !== 'string' || !event.toolCall.name)) { this.failIdentity(); return; }
      if (event.type === 'toolcall_delta' && typeof event.delta !== 'string') { this.failIdentity(); return; }
    }
    if (event.type === 'toolcall_start' || event.type === 'toolcall_delta') {
      const index = event.contentIndex;
      if (event.type === 'toolcall_start') {
        if (this.seenIndices.has(index)) this.failIdentity();
        this.seenIndices.add(index);
      }
      const call = event.partial.content[index];
      if (call?.type === 'toolCall') {
        if ((call.id !== undefined && typeof call.id !== 'string') || (call.name !== undefined && typeof call.name !== 'string')) { this.failIdentity(); return; }
        const prior = this.calls.get(index);
        if (prior && ((prior.id && call.id && prior.id !== call.id) || (prior.name && call.name && prior.name !== call.name))) this.failIdentity();
        this.calls.set(index, { id: call.id || prior?.id || '', name: call.name || prior?.name || '', arguments: undefined });
      }
      if (event.type === 'toolcall_delta') {
        const parts = this.chunks.get(index) ?? []; parts.push(event.delta); this.chunks.set(index, parts);
      }
    }
    if (event.type !== 'toolcall_end') return;
    const call = event.toolCall, native = this.native.get(call.id), prior = this.calls.get(event.contentIndex);
    if (!call.id || !call.name || this.seenIds.has(call.id) || !prior || !this.seenIndices.has(event.contentIndex) ||
        (prior.id && prior.id !== call.id) || (prior.name && prior.name !== call.name) || (native && native.name !== call.name)) this.failIdentity();
    this.seenIds.add(call.id);
    if(native?.deltas && native.initial && Object.keys(native.initial as object).length)this.failIdentity();
    const chatIndex = this.chatIds.get(call.id), chat = chatIndex === undefined ? undefined : this.chatNative.get(chatIndex);
    if (this.chatNative.size && (!chat || !chat.complete || chat.name !== call.name)) this.failIdentity();
    const raw = native?.parts.join('') ?? chat?.parts.join('') ?? this.chunks.get(event.contentIndex)?.join('');
    if(chatIndex !== undefined)this.chatNative.delete(chatIndex);
    this.chunks.delete(event.contentIndex); this.calls.delete(event.contentIndex); this.native.delete(call.id);
    const schema = this.schemas.get(call.name);
    const remote = this.remoteSchemas.get(call.name);
    const coverage:ToolArgumentEvidence['coverage']=native?.complete
      ? this.api==='anthropic-messages'?'anthropic-argument-events':'response-argument-events'
      : this.api==='openai-completions' && raw!==undefined?'chat-argument-deltas':'insufficient';
    const evidence: ToolArgumentEvidence = {
      toolCallId: call.id, tool: call.name, api: this.api, coverage,
      identityValid: !this.identityIssue, ...(this.identityIssue ? {identityIssue:this.identityIssue, issue:this.identityIssue} : {}),
      ...(raw !== undefined ? { rawArguments: raw } : {}), sdkArguments: structuredClone(call.arguments),
      sdkEmptyObject: call.arguments !== null && typeof call.arguments === 'object' && Object.getPrototypeOf(call.arguments) === Object.prototype && Reflect.ownKeys(call.arguments).length === 0,
      ...(schema ? { schema: structuredClone(schema) } : {}),
      ...(remote ? { remoteSchema: structuredClone(remote.schema), remoteSchemaHash: stableHash(remote.schema) } : {}),
      ...(native?.replaced?{finalReplacedDeltas:true}:{}),
      ...(this.target&&schema?{contractContext:{...this.target,contract:this.contractVersion,schemaHash:stableHash(schema),...(remote ? {declaredStrict:remote.strict} : {})}}:{}),
    };
    if(this.identityIssue)return evidence;
    if (coverage === 'insufficient') {
      if(native && !native.complete){evidence.incomplete=true;evidence.issue='Native tool argument events did not complete. Partial arguments cannot be delivered.';}
      return evidence;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw!); evidence.jsonValid = true; }
    catch (error) {
      evidence.jsonValid = false;
      const syntax=evidence.syntaxError=diagnoseJsonSyntax(error,raw!);
      const location=syntax.offset===undefined?'':` at zero-based UTF-16 offset ${syntax.offset}, line ${syntax.line}, column ${syntax.column}`;
      evidence.issue = `Original tool arguments are not complete valid JSON: ${syntax.category}${location}${syntax.expected?`; expected ${syntax.expected}`:''}. SDK-repaired or partial values cannot be delivered. Resubmit the complete small result; preserve scientific text and reuse retained bodies.`;
      return evidence;
    }
    evidence.sdkMatchesRaw = (!native || native.name===call.name) && isDeepStrictEqual(parsed, call.arguments);
    // Anthropic initial nonempty input plus later deltas is ambiguous, not an implicit merge.
    if(native?.deltas && native.initial && Object.keys(native.initial as object).length){
      evidence.identityValid=false;
      evidence.issue='Tool arguments supplied conflicting initial input and deltas. Delivery is blocked; resubmit one complete result.';
    }
    evidence.rawSchemaValid = !!schema && checkSchema(schema, parsed);
    if (remote) evidence.remoteSchemaValid = checkSchema(remote.schema, parsed);
    evidence.schemaErrors = evidence.rawSchemaValid ? [] : schema ? [...Value.Errors(schema, parsed)].slice(0,32).map(e => ({path:e.instancePath, message:e.message})) : [{path:'/', message:'Tool was not declared in this dispatch.'}];
    if (!evidence.sdkMatchesRaw) evidence.issue = 'Original JSON and SDK-parsed arguments differ. Delivery is blocked; retain the diagnostic and retry without changing scientific content.';
    return evidence;
  }
}
