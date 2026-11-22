import {isDeepStrictEqual} from 'node:util';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {SUBMIT_RESULT} from './stage-contract.js';
import {ContractValidationError,exact} from './strict-schema.js';
import {decodeSafeToolArguments} from './safe-tool-arguments.js';
import type {ToolArgumentEvidence} from './tool-argument-audit.js';
import {RuntimeError} from './errors.js';

export function publicPhase(signature?:string):unknown{
  try{return signature && JSON.parse(signature)?.phase;}catch{return undefined;}
}

export function completionCandidate(message:AssistantMessage):string{
  const calls=message.content.filter(p=>p.type==='toolCall');
  const standalone=!calls.length&&message.stopReason==='stop';
  if(!standalone&&(calls.length!==1||calls[0]!.name!==SUBMIT_RESULT||calls[0]!.arguments.action!=='complete'))return '';
  const text=message.content.filter(p=>p.type==='text');
  const final=text.filter(p=>publicPhase(p.textSignature)==='final_answer');
  return (final.length?final:text.filter(p=>!publicPhase(p.textSignature))).map(p=>p.text).join('');
}

const replacement=Type.Object({markdown:Type.String({minLength:1,pattern:'\\S',description:'Complete manuscript in Markdown.'})},{additionalProperties:false});
const previous=Type.Object({usePrevious:Type.Literal(true,{description:'The preceding text is the complete manuscript.'})},{additionalProperties:false});
export function manuscriptSchema(hasPrevious:boolean){
  return Type.Object({answer:hasPrevious?Type.Union([previous,replacement]):replacement},{additionalProperties:false});
}

export const SUBMIT_MANUSCRIPT='submit_manuscript';
export const manuscriptTool:ToolDefinition={
  name:SUBMIT_MANUSCRIPT,label:'Submit manuscript',description:'Deliver the complete Markdown derivation. The program requests its declaration separately.',
  parameters:manuscriptSchema(false),
  execute:async()=>{throw new RuntimeError('TOOL_PROTOCOL_FAILED');} // Only the proof controller can acknowledge a validated manuscript.
};

/** Decode the same provider evidence during live delivery and journal recovery. */
export function readManuscript(message:AssistantMessage,evidence:ToolArgumentEvidence[],hasPrevious:boolean){
  const parts=message.content.filter(p=>p.type!=='thinking'&&(p.type!=='text'||p.text.trim()));
  if(message.stopReason==='stop'&&!evidence.length)throw new ContractValidationError(['Use the manuscript tool with the displayed answer field.']);
  const calls=parts.filter(p=>p.type==='toolCall'),call=calls[0],entry=evidence[0];
  if(message.stopReason==='toolUse'&&(calls.length!==1||call?.name!==SUBMIT_MANUSCRIPT||parts.at(-1)!==call||
     parts.some(p=>p.type==='text'&&publicPhase(p.textSignature)==='final_answer'))){
    throw new ContractValidationError(['Submit one manuscript through submit_manuscript. Put the complete derivation in answer.markdown.']);
  }
  if(message.stopReason!=='toolUse'||!call||evidence.length!==1||entry?.tool!==call.name||entry.toolCallId!==call.id||!isDeepStrictEqual(entry.sdkArguments,call.arguments)){
    throw new RuntimeError('TOOL_PROTOCOL_FAILED');
  }
  const input=decodeSafeToolArguments(entry).value;
  exact(manuscriptSchema(hasPrevious),input);
  return (input as {answer:{usePrevious:true}|{markdown:string}}).answer;
}

/** Dispatch and continue retain the model's open progress note, outside the final report. */
export function openProgressNote(value:unknown):string {
 if(!value||typeof value!=='object'||!('action' in value)||!('outcome' in value))return '';
 const workers='workers' in value?value.workers:undefined;
 if(value.action!=='dispatch'&&value.action!=='continue')return '';
 if(workers!==undefined&&!Array.isArray(workers))return '';
 const hasWorkers=Array.isArray(workers)&&workers.length>0;
 if((value.action==='dispatch')!==hasWorkers)return '';
 const outcome=value.outcome;
 return outcome&&typeof outcome==='object'&&'resultKind' in outcome&&outcome.resultKind==='open'&&
  'reason' in outcome&&typeof outcome.reason==='string'?outcome.reason:'';
}
