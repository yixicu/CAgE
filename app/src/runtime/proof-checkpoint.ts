import {stagedOutputReserve} from './foreground-budget-v4.js';
import {createHash} from 'node:crypto';
import {atomicWrite} from '../storage/atomic.js';
import {readTextPage} from '../storage/text-page.js';
import {join} from 'node:path';
import {Type} from 'typebox';
import type {TranscriptContext} from '@earendil-works/pi-ai';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';

const answer=(text:string)=>({content:[{type:'text' as const,text}],details:{}});
export class ProofCheckpoint {
 private readonly stored=new Set<string>();
 private pageSize=4000;
 private compacted=false;
 private targetRelease=0;
 private remindedAt=-1;
 constructor(private directory:string){}
 plan(window:number,output:number,bytes:number,messages:number){
  const usable=Math.max(1,window-1024-stagedOutputReserve(window,output));
  this.pageSize=Math.max(64,Math.min(4000,Math.floor(usable/12)));
  const pressure=bytes/3/usable;
  // Leave room for the model to read a passage and record its first scientific checkpoint.
  this.targetRelease=pressure>0.78?Math.ceil(bytes-usable*3*0.62):0;
  const remind=pressure>0.60 && (this.remindedAt<0||messages-this.remindedAt>=16);
  if(remind)this.remindedAt=messages;
  return {compact:this.compacted||pressure>0.78,remind};
 }
 tools():ToolDefinition[]{return [
  {name:'save_proof_checkpoint',label:'Save proof checkpoint',description:'Record a cumulative outline at a completed derivation step. Include decisive implications, where assumptions apply, unresolved branches and the next step.',parameters:Type.Object({outline:Type.String({minLength:1,maxLength:4000})}),
   execute:async(_id,{outline})=>answer(String(outline))},
  {name:'read_checkpoint_text',label:'Read proof detail',description:'Read an exact saved passage from this session by its displayed reference and character offset.',parameters:Type.Object({ref:Type.String({pattern:'^[a-f0-9]{64}$'}),offset:Type.Optional(Type.Integer({minimum:0}))}),
   execute:async(_id,{ref,offset=0})=>{
    if(!this.stored.has(ref))throw Error('Use a displayed passage reference.');
    const page=await readTextPage(join(this.directory,ref),offset,this.pageSize);
    return answer(JSON.stringify({ref,offset,...page}));
   }}
 ];}
 async compact(context:TranscriptContext,forceSpill=false):Promise<TranscriptContext>{
  const cutoff=context.messages.findLastIndex(m=>m.role==='toolResult'&&m.toolName==='save_proof_checkpoint'&&!m.isError);
  if(cutoff<1 && !forceSpill && !this.targetRelease && !this.compacted)return context;
  const messages=structuredClone(context.messages);
  this.compacted=true;
  const latestPage=messages.findLastIndex(m=>m.role==="toolResult"&&m.toolName==="read_checkpoint_text");
  let remaining=forceSpill?Infinity:this.targetRelease;
  const recentTools:{index:number;part:number;available:number}[]=[];
  for(const [index,msg] of messages.entries()){
   if(msg.role!=='assistant' && msg.role!=='toolResult')continue;
   if(msg.role==='toolResult' && (msg.isError || msg.toolName==='read_checkpoint_text' || msg.toolName==='save_proof_checkpoint'))continue;
   for(const [part,block] of msg.content.entries()){
    if(block.type!=='text')continue;
    const size=Buffer.byteLength(JSON.stringify(block.text));
    if(index<cutoff && block.text.length>=320)remaining-=Math.max(0,size-180);
    else if(index>=cutoff && msg.role==='toolResult' && size>=320)recentTools.push({index,part,available:size-180});
   }
  }
  const spill=new Set<string>();
  for(const row of recentTools.sort((a,b)=>b.available-a.available)){
   if(remaining<=0)break;
   spill.add(row.index+':'+row.part);
   remaining-=row.available;
  }
  for(const [index,msg] of messages.entries()){
   if(msg.role==="toolResult"&&msg.toolName==="read_checkpoint_text"&&index!==latestPage&&!msg.isError){
    for(const part of msg.content)if(part.type==="text"){
     const {ref,offset,next}=JSON.parse(part.text);
     part.text=JSON.stringify({previouslyRead:ref,offset,next});
    }
    continue;
   }
   if(index===latestPage||msg.role==='toolResult' && msg.isError)continue;
   if(msg.role!=='assistant'&&msg.role!=='toolResult')continue;
   for(const [partIndex,part] of msg.content.entries()){
    if(part.type!=='text'||(index<cutoff ? part.text.length<320 : !spill.has(index+':'+partIndex)))continue;
    const ref=createHash('sha256').update(part.text,'utf16le').digest('hex');
    if(!this.stored.has(ref)){
     await atomicWrite(join(this.directory,ref),Buffer.from(part.text,"utf16le"));
     this.stored.add(ref);
    }
    part.text='Saved passage. Use read_checkpoint_text with ref '+ref+' for exact text ('+part.text.length+' characters).';
   }
  }
  // The next cursor and original reference replace older pure paging exchanges.
  // Preserve any assistant prose or mixed tool batch as scientific context.
  const obsolete=new Set<number>(),seen=new Set<string>();
  for(let i=messages.length-1;i>0;i--){
   const result=messages[i],request=messages[i-1];
   if(result.role!=="toolResult"||result.toolName!=="read_checkpoint_text"||result.isError||request.role!=="assistant")continue;
   const parts=request.content.filter(part=>part.type!=="thinking");
   if(parts.length!==1||parts[0].type!=="toolCall"||parts[0].id!==result.toolCallId||parts[0].name!=="read_checkpoint_text")continue;
   const ref=parts[0].arguments.ref;
   if(typeof ref!=="string")continue;
   if(seen.has(ref)){obsolete.add(i);obsolete.add(i-1);}
   seen.add(ref);
  }
  return {...context,messages:messages.filter((_,index)=>!obsolete.has(index))};
 }
}
