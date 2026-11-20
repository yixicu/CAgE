import type {AssistantMessage,Context,Tool,ToolCall} from '@earendil-works/pi-ai';
import type {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {Type,type TSchema} from 'typebox';
import {Value} from 'typebox/value';
import {isSystemMaintenanceTool, scienceToolDenial, RuntimeError} from './errors.js';

/** Host-owned receipt; raw replies remain intact even when parsing fails. */
export interface NativeHandoffState {
 callId:string;
 original?:AssistantMessage;
 repairSent?:boolean;
 repair?:AssistantMessage;
}
export interface NativeHandoffPort {
 version:'native-handoff-v1';
 state?:NativeHandoffState;
 save(state:NativeHandoffState):Promise<void>;
}
type Request={callId:string;nativeHandoff?:NativeHandoffPort;onDispatch?:()=>void|Promise<void>;onUsage?:(usage:{tokens?:number;costUsd?:number})=>void|Promise<void>};
type Complete=(context:Context)=>ReturnType<ModelRuntime['completeSimple']>;
type Slot={call:number;path:string;schema:TSchema;metadata?:true};
type MetadataErrors=(call:ToolCall,reply:AssistantMessage)=>import('./declaration-supplement.js').MetadataField[];
const readTools=new Set(['list_discussion_turns','read_discussion_report','lookup_map_knowledge','open_map_knowledge','refresh_knowledge_map','query_knowledge','open_knowledge','read_research_source','read_context_page']);
const parts=(path:string)=>path.split('/').slice(1).map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
const escape=(key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1');
const normalized=(value:string)=>value.trim().toLowerCase();
function equivalent(before:unknown,after:unknown):boolean {
 if(typeof before==='string'&&typeof after==='string')return normalized(before)===normalized(after);
 if(typeof before==='string'&&typeof after==='number')return before.trim()!==''&&Number.isFinite(after)&&Number(before)===after;
 if(typeof before==='number'&&typeof after==='string')return Number.isFinite(before)&&String(before)===after;
 if(typeof before==='string'&&typeof after==='boolean')return normalized(before)===String(after);
 if(typeof before==='boolean'&&typeof after==='string')return String(before)===normalized(after);
 return Object.is(before,after);
}
function repairable(schema:TSchema,value:unknown):boolean {
 const shape=schema as {type?:string;const?:unknown;enum?:unknown[];anyOf?:TSchema[]};
 if(shape.anyOf)return shape.anyOf.some(part=>repairable(part,value));
 const choices=shape.enum??(shape.const===undefined?undefined:[shape.const]);
 if(choices)return choices.some(choice=>equivalent(value,choice));
 if(shape.type==='integer'||shape.type==='number')return typeof value==='string'&&value.trim()!==''&&Value.Check(schema,Number(value));
 if(shape.type==='boolean')return typeof value==='string'&&['true','false'].includes(normalized(value));
 if(shape.type==='string')return ['number','boolean'].includes(typeof value)&&Value.Check(schema,String(value));
 return false;
}

/** Preserve public qualifications beside a write call without asking the author to repeat them. */
export function publicNativeBody(reply:AssistantMessage,body:string,enabled:boolean):string {
 if(!enabled)return body;
 const note=reply.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');
 return !note.trim()||body.includes(note)?body:body+'\n\nAuthor note:\n'+note;
}

function fieldSchema(schema:TSchema,path:string):TSchema|undefined {
 let current:TSchema|undefined=schema;
 for(const part of parts(path)){const object=current as {type?:string;items?:TSchema;properties?:Record<string,TSchema>}|undefined;current=object?.type==='array'?object.items:object?.properties?.[part];}
 return current;
}
function repairSlots(calls:ToolCall[],tools:Tool[]):Slot[] {
 const slots:Slot[]=[];
 for(const [callIndex,call] of calls.entries()){
  const tool=tools.find(tool=>tool.name===call.name);if(!tool)throw new RuntimeError('INVALID_OUTPUT');
  const paths=new Set<string>();
  for(const error of Value.Errors(tool.parameters,call.arguments)){
   if(error.keyword==='required')for(const key of error.params.requiredProperties)paths.add(error.instancePath+'/'+escape(key));
   else if(error.keyword==='additionalProperties')throw new RuntimeError('INVALID_OUTPUT');
   else if(error.instancePath)paths.add(error.instancePath);
   else throw new RuntimeError('INVALID_OUTPUT');
  }
  for(const path of paths){
   const keys=parts(path),schema=fieldSchema(tool.parameters,path);
   // Missing scientific text or whole collections cannot be reconstructed by a format correction.
   const type=(schema as {type?:string}|undefined)?.type;
   if(!keys.length||keys.some(key=>['__proto__','prototype','constructor'].includes(key))||keys.some(key=>['body','argument','title','conditions','assumptions','prerequisites'].includes(key))||type==='object'||type==='array')throw new RuntimeError('INVALID_OUTPUT');
   let value:unknown=call.arguments;for(const key of keys)value=value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined;
   if(!schema||!repairable(schema,value))throw new RuntimeError('INVALID_OUTPUT');
   slots.push({call:callIndex,path,schema});
  }
 }
 return slots;
}
export function canRepairNativeArguments(schema:TSchema,value:unknown):boolean {
 try{return repairSlots([{type:'toolCall',id:'check',name:'check',arguments:value as ToolCall['arguments']}],[{name:'check',description:'',parameters:schema}]).length>0;}catch{return false;}
}
function applySlots<T extends {content:AssistantMessage['content']}>(original:T,calls:ToolCall[],slots:Slot[],values:Record<string,unknown>):T {
 const reply=structuredClone(original),targets=reply.content.filter((item):item is ToolCall=>item.type==='toolCall');
 for(const [index,slot] of slots.entries()){
  const keys=parts(slot.path),key=keys.pop()!;let target:unknown=targets[slot.call]!.arguments;
  for(const part of keys){if(!target||typeof target!=='object'||!Object.hasOwn(target,part))throw new RuntimeError('INVALID_OUTPUT');target=(target as Record<string,unknown>)[part];}
  if(!target||typeof target!=='object')throw new RuntimeError('INVALID_OUTPUT');
  const value=values['field_'+(index+1)],before=(target as Record<string,unknown>)[key];
  if(!slot.metadata&&!equivalent(before,value))throw new RuntimeError('INVALID_OUTPUT');
  Object.defineProperty(target,key,{value:structuredClone(value),enumerable:true,writable:true,configurable:true});
 }
 if(targets.length!==calls.length)throw new RuntimeError('INVALID_OUTPUT');
 return reply;
}
export function createNativeArgumentRepair(schema:TSchema,original:unknown){
 const call:ToolCall={type:'toolCall',id:'repair',name:'repair',arguments:structuredClone(original) as ToolCall['arguments']},slots=repairSlots([call],[{name:call.name,description:'',parameters:schema}]);
 if(!slots.length)throw new RuntimeError('INVALID_OUTPUT');
 const fields=Type.Object(Object.fromEntries(slots.map((slot,index)=>{let value:unknown=call.arguments;for(const part of parts(slot.path))value=(value as Record<string,unknown>)[part];return ['field_'+(index+1),{...slot.schema,description:slot.path+'; original value: '+JSON.stringify(value)}];})),{additionalProperties:false});
 return {schema:fields,decode(values:unknown):unknown{
  if(!Value.Check(fields,values))throw new RuntimeError('INVALID_OUTPUT');
  const result=applySlots({content:[call]},[call],slots,values as Record<string,unknown>).content[0]!.arguments;
  if(!Value.Check(schema,result))throw new RuntimeError('INVALID_OUTPUT');return result;
 }};
}
export interface ScientificToolNotice { toolFeedback?:string; maintenanceReferral?:true }
type ScientificReply = AssistantMessage & ScientificToolNotice;
function scientificReply(reply:AssistantMessage,tools:Tool[]):ScientificReply {
 const denied=reply.content.filter((part):part is ToolCall=>part.type==='toolCall' && !tools.some(tool=>tool.name===part.name) && !!scienceToolDenial(part.name));
 if(!denied.length)return reply;
 const ids=reply.content.filter(part=>part.type==='toolCall').map(call=>call.id);
 if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new RuntimeError('TOOL_PROTOCOL_FAILED');
 const feedback=[...new Set(denied.map(call=>scienceToolDenial(call.name)!))].join(' ');
 return {...reply,content:reply.content.filter(part=>part.type!=='toolCall'||!denied.includes(part)),toolFeedback:feedback,...(denied.some(call=>isSystemMaintenanceTool(call.name))?{maintenanceReferral:true}:{})};
}
function checkCompletion(reply:AssistantMessage){if(['error','aborted','length'].includes(reply.stopReason))throw new RuntimeError('PROVIDER_FAILED');}

/** One normal call, and at most one isolated field correction for schema mismatch. */
export async function completeNativeHandoff(request:Request,context:Context,complete:Complete,signal:AbortSignal,metadataErrors?:MetadataErrors):Promise<ScientificReply>{
 signal.throwIfAborted();
 const port=request.nativeHandoff;
 if(!port){
  await request.onDispatch?.();const reply=await complete(context);
  checkCompletion(reply);
  await request.onUsage?.({...(Number.isFinite(reply.usage?.totalTokens)?{tokens:reply.usage.totalTokens}:{}),...(Number.isFinite(reply.usage?.cost?.total)?{costUsd:reply.usage.cost.total}:{})});return scientificReply(reply,context.tools??[]);
 }
 if(port&&port.version!=='native-handoff-v1')throw new RuntimeError('INVALID_CONFIGURATION');
 const state:NativeHandoffState=structuredClone(port?.state??{callId:request.callId});
 if(state.callId!==request.callId||state.repairSent&&!state.original||state.repair&&!state.repairSent)throw new RuntimeError('INVALID_CONFIGURATION');
 const save=async()=>{if(port)await port.save(structuredClone(state));};
 const invoke=async(input:Context,repair=false)=>{
  signal.throwIfAborted();await request.onDispatch?.();signal.throwIfAborted();
  const reply=await complete(input);
  if(repair)state.repair=structuredClone(reply);else state.original=structuredClone(reply);
  await save();
  await request.onUsage?.({...(Number.isFinite(reply.usage?.totalTokens)?{tokens:reply.usage.totalTokens}:{}),...(Number.isFinite(reply.usage?.cost?.total)?{costUsd:reply.usage.cost.total}:{})});
  signal.throwIfAborted();checkCompletion(reply);return reply;
 };
 const raw=state.original??await invoke(context);checkCompletion(raw);
 const original=scientificReply(raw,context.tools??[]);
 const calls=original.content.filter((item):item is ToolCall=>item.type==='toolCall');
 const annotated:Slot[]=[];
 const forValidation=metadataErrors?calls.map((call,i)=>{
  const fields=metadataErrors(call,original),copy=structuredClone(call);
  for(const field of fields){
   const path='/'+field.path.map(escape).join('/');
   if(field.expected!==undefined){
    let row=copy.arguments;for(const key of field.path.slice(0,-1))row=row[key] as typeof row;
    row[field.path.at(-1)!]=field.expected;
   }
   annotated.push({call:i,path,schema:field.expected===undefined?Type.String({minLength:1,description:field.message}):Type.Literal(field.expected,{description:field.message}),metadata:true});
  }
  return copy;
 }):calls;
 const slots=[...repairSlots(forValidation,context.tools??[]),...annotated];
 if(!slots.length)return original;
 if(calls.length>1&&!calls.every(call=>readTools.has(call.name)))throw new RuntimeError('TOOL_PROTOCOL_FAILED');
 const parameters=Type.Object(Object.fromEntries(slots.map((slot,index)=>['field_'+(index+1),slot.schema])),{additionalProperties:false});
 let repaired=state.repair;
 if(!repaired){
  if(state.repairSent)throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
  state.repairSent=true;await save();
  const fields=slots.map((slot,index)=>{let value:unknown=calls[slot.call]!.arguments;for(const part of parts(slot.path))value=value&&typeof value==='object'?(value as Record<string,unknown>)[part]:undefined;return {field:'field_'+(index+1),tool:calls[slot.call]!.name,path:slot.path,value};});
  repaired=await invoke({systemPrompt:'Correct only the listed tool argument formats, preserving their meaning. Return replacements through correct_arguments. If correction needs scientific judgment or guessing, explain the problem instead.',messages:[{role:'user',timestamp:Date.now(),content:JSON.stringify({errors:fields})}],tools:[{name:'correct_arguments',description:'Supply only the requested replacement fields. All other original content is retained by the host.',parameters}]},true);
 }
 checkCompletion(repaired);
 const correction=scientificReply(repaired,[{name:'correct_arguments',description:'',parameters}]);
 if(correction.toolFeedback&&!correction.content.some(p=>p.type==='toolCall'))return {...correction,content:[],...(original.maintenanceReferral?{maintenanceReferral:true}:{})};
 const fixes=correction.content.filter((item):item is ToolCall=>item.type==='toolCall');
 if(fixes.length!==1||fixes[0]!.name!=='correct_arguments'||!Value.Check(parameters,fixes[0]!.arguments)||repaired.content.some(item=>item.type==='text'&&item.text.trim()))throw new RuntimeError('INVALID_OUTPUT');
 const merged=applySlots(original,calls,slots,fixes[0]!.arguments);
 for(const call of merged.content.filter((item):item is ToolCall=>item.type==='toolCall'))if(!Value.Check(context.tools!.find(tool=>tool.name===call.name)!.parameters,call.arguments)||metadataErrors?.(call,merged).length)throw new RuntimeError('INVALID_OUTPUT');
 return {...merged,...(correction.toolFeedback?{toolFeedback:correction.toolFeedback}:{}),...(correction.maintenanceReferral?{maintenanceReferral:true}:{})};
}
