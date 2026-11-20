import {defineTool} from '@earendil-works/pi-coding-agent';
import type {Message,TranscriptContext} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite} from '../storage/atomic.js';
import {readTextPage} from '../storage/text-page.js';

// This archive belongs to one live request. The original Pi transcript stays intact.
export function maintenanceContext(directory:string){
  const exchanges=new Map<string,{text:string}|{file:string}>();
  let memoryBytes=0,spilledBytes=0,spillDirectory:string|undefined;
  const compacted=new Map<number,number>();
  let pageBytes=48000;
  const tool=defineTool({name:'maintenance_read_exchange',label:'Read earlier tool exchange',
    description:'Read the original tool arguments, assistant text and returned content for an earlier exchange in this live turn. Omit exchange to list archived handles. Continue at nextOffset.',
    parameters:Type.Object({exchange:Type.Optional(Type.String()),offset:Type.Optional(Type.Integer({minimum:0}))},{additionalProperties:false}),
    execute:async(_id,{exchange,offset=0})=>{
      if(exchange===undefined){
        const handles=Array.from(exchanges.keys()).slice(offset,offset+Math.max(1,Math.min(32,Math.floor(pageBytes/48))));
        return {content:[{type:'text',text:JSON.stringify({handles,nextOffset:offset+handles.length<exchanges.size?offset+handles.length:null})}],details:{summary:'Listed archived exchanges.',residentTextBytes:memoryBytes,spilledTextBytes:spilledBytes}};
      }
      const saved=exchanges.get(exchange);
      if(saved===undefined)throw Error('Unknown exchange in this maintenance turn.');
      const limit=Math.max(1,Math.min(12000,Math.floor(pageBytes/6)));
      let text:string,next:number|null;
      if('file' in saved){({text,next}=await readTextPage(saved.file,offset,limit));}
      else{text=saved.text.slice(offset,offset+limit);next=offset+text.length<saved.text.length?offset+text.length:null;}
      return {content:[{type:'text',text:JSON.stringify({exchange,offset,text,nextOffset:next})}],details:{summary:'Read archived exchange '+exchange+'.',residentTextBytes:memoryBytes,spilledTextBytes:spilledBytes}};
    }});

  let correctionStart:number|undefined;
  async function project(context:TranscriptContext,budget:number,hasCorrection:boolean){
    const messages=context.messages;
    const latest=messages.findLastIndex(m=>m.role==='assistant');
    const latestRead=messages.findLastIndex(m=>m.role==='assistant'&&m.content.some(p=>p.type==='toolCall'&&p.name===tool.name));
    if(hasCorrection)correctionStart??=latest;
    else correctionStart=undefined;
    const originalBytes=Buffer.byteLength(JSON.stringify(context.messages));
    let bytes=originalBytes;
    for(const [start,size] of compacted)if(start<(correctionStart??messages.length))bytes-=size;
    const pressure=bytes>budget;
    if(!pressure&&!compacted.size)return context;
    const omit=new Set<number>();
    const summaries=[];
    // A completed exchange stays archived after the first projection. Reserve
    // the latest read page until another read brings fresh evidence.
    for(let i=0;i<(correctionStart??messages.length);i++){
      const assistant=messages[i];
      if(assistant.role!=='assistant')continue;
      const handle='exchange-'+i;
      if(!compacted.has(i)&&(i===latestRead||!pressure||bytes<=budget*0.75||i===latest&&bytes<=budget))continue;
      const calls=assistant.content.filter(part=>part.type==='toolCall');
      if(!calls.length)continue;
      const results=messages.slice(i+1,i+1+calls.length);
      if(results.length!==calls.length||!calls.every((call,j)=>results[j].role==='toolResult'&&results[j].toolCallId===call.id))continue;
      const ordinary=calls.filter(call=>call.name!==tool.name);
      const receipts=results.flatMap(result=>{
        if(result.role!=='toolResult')return [];
        const details=result.details as {summary?:unknown;operationId?:unknown;receipt?:unknown}|undefined;
        return [{tool:result.toolName,callId:result.toolCallId,operationId:details?.operationId,
          status:result.isError?'failed':'returned',receipt:details?.receipt,summary:typeof details?.summary==='string'?details.summary.slice(0,300):undefined}];
      });
      if(ordinary.length&&!exchanges.has(handle)){
        const text=JSON.stringify({
          assistant:assistant.content.filter(part=>part.type!=='thinking'&&(part.type!=='toolCall'||part.name!==tool.name)),
          results:results.flatMap(m=>m.role==='toolResult'&&m.toolName!==tool.name?[{callId:m.toolCallId,name:m.toolName,content:m.content,isError:m.isError,details:m.details}]:[]),
        });
        const bytes=text.length*2;
        if(memoryBytes+bytes<=65536){exchanges.set(handle,{text});memoryBytes+=bytes;}
        else{
          spillDirectory??=await mkdtemp(join(directory,'exchange-'));
          const file=join(spillDirectory,handle+'.utf16');
          await atomicWrite(file,Buffer.from(text,'utf16le'));
          exchanges.set(handle,{file});
          spilledBytes+=bytes;
        }
      }
      // A read points directly back to its original exchange and page. Never
      // archive the serialized page again inside another exchange.
      const rereads=calls.filter(call=>call.name===tool.name).map(call=>({exchange:call.arguments.exchange,offset:call.arguments.offset??0}));
      summaries.push({exchange:ordinary.length?handle:undefined,rereads:rereads.length?rereads:undefined,receipts:receipts.slice(-4),totalOperations:receipts.length});
      let size=0;
      for(let j=i;j<=i+calls.length;j++){omit.add(j);size+=Buffer.byteLength(JSON.stringify(messages[j]));}
      if(!compacted.has(i)){compacted.set(i,size);bytes-=size;}
      i+=calls.length;
    }
    if(!summaries.length)return context;
    const first=omit.values().next().value!;
    const replacement:Message={role:'user',timestamp:messages[first].timestamp,
      content:JSON.stringify({maintenanceExchangeCheckpoint:{count:summaries.length,recent:summaries.slice(-6),
        recovery:'Use maintenance_read_exchange for exact archived tool arguments and results in this turn.'}})};
    if(bytes+Buffer.byteLength(JSON.stringify(replacement))>=originalBytes)return context;
    return {...context,messages:messages.flatMap((m,i)=>i===first?[replacement]:omit.has(i)?[]:[m])};
  }
  return {tool,project,setPageBudget(bytes:number){pageBytes=bytes;},
    async close(){if(spillDirectory)await rm(spillDirectory,{recursive:true,force:true});}};
}
