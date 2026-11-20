import {Type} from 'typebox';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {createHash} from 'node:crypto';
/** V3-only exact frozen reader paging. Full resource delivery is recorded only
 * after the union of returned byte ranges covers the complete immutable body. */
export function boundedFrozenReadV3(tool:ToolDefinition):ToolDefinition {
 if(!['read_frozen_source','read_research_resource'].includes(tool.name))return tool;
 const properties=(tool.parameters as {properties?:Record<string,ReturnType<typeof Type.String>>}).properties??{};
 const coverage=new Map<string,{hash:string;ranges:[number,number][]}>();
 return {...tool,description:tool.description+' V3 returns at most 8192 UTF-8 bytes of JSON per call, with exact body hash and nextOffset. Follow nextOffset to read the complete immutable object; partial reads do not grant full resource delivery.',parameters:Type.Object({...properties,offset:Type.Optional(Type.Integer({minimum:0})),maxBytes:Type.Optional(Type.Integer({minimum:1024,maximum:8192}))},{additionalProperties:false}),execute:async(id,args,signal,onUpdate,context)=>{
  const value=args as {offset?:number;maxBytes?:number}&Record<string,unknown>,offset=value.offset??0,maxBytes=value.maxBytes??8192;
  const original=Object.fromEntries(Object.entries(value).filter(([key])=>!['offset','maxBytes'].includes(key)));
  const result=await tool.execute(id,original,signal,onUpdate,context),text=result.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'),bytes=Buffer.from(text,'utf8');
  if(offset>bytes.length||offset<bytes.length&&(bytes[offset]!&0xc0)===0x80)throw new Error('Frozen read requires a valid UTF-8 byte cursor.');
  const bodyHash=createHash('sha256').update(bytes).digest('hex');let end=Math.min(bytes.length,offset+maxBytes-512);
  while(end>offset&&end<bytes.length&&(bytes[end]!&0xc0)===0x80)end--;
  const envelope=()=>({ref:original,bodyHash,offset,totalBytes:bytes.length,...(end<bytes.length?{nextOffset:end}:{}),truncated:end<bytes.length,chunk:bytes.subarray(offset,end).toString('utf8')});
  while(Buffer.byteLength(JSON.stringify(envelope()))>maxBytes&&end>offset){end--;while(end>offset&&end<bytes.length&&(bytes[end]!&0xc0)===0x80)end--;}
  if(end===offset&&offset<bytes.length)throw new Error('Frozen read metadata exceeds byte budget.');
  const key=JSON.stringify(Object.entries(original).sort(([a],[b])=>a.localeCompare(b))),prior=coverage.get(key);if(prior&&prior.hash!==bodyHash)throw new Error('Frozen resource changed between pages.');
  const ranges=[...(prior?.ranges??[]),[offset,end] as [number,number]].sort((a,b)=>a[0]-b[0]);let covered=0;for(const [start,stop]of ranges){if(start>covered)break;covered=Math.max(covered,stop);}coverage.set(key,{hash:bodyHash,ranges});
  const details={...(result.details as Record<string,unknown>)};if(covered<bytes.length)delete details.resourceRef;
  return {content:[{type:'text' as const,text:JSON.stringify(envelope())}],details};
 }};
}
