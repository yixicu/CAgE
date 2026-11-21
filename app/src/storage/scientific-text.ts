import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomic.js';

const format='v4-scientific-text-v1';
const mapFormat='v4-knowledge-proof-text-v2';
const fields=new Set(['body','argument','proof','review']);
const pending=new Map<string,Promise<void>>();
type Segment=string|number;
interface TextRef {path:Segment[];hash:string;encoding?:'json'}
interface Envelope {format:typeof format|typeof mapFormat;value:unknown;texts:TextRef[]}
const hashText=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=():never=>{throw Error('Invalid or unavailable scientific text storage');};

export function needsMapTextUpgrade(stored:unknown){
 if(!object(stored)||stored.format===mapFormat)return false;
 const value=stored.format===format?stored.value:stored;
 return object(value)&&!!value.knowledgeMapV4;
}

/** The manifest, never an object embedded in scientific prose, identifies text references. */
export class ScientificTextStore {
 constructor(private readonly directory:string){}

 private filename(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))fail();return path.join(this.directory,hash+'.txt');}
 private async read(hash:string):Promise<string>{
  const bytes=await fs.readFile(this.filename(hash)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(new Error('Scientific text blob is missing',{cause:error}),{code:'SCIENTIFIC_TEXT_MISSING'});throw error;});
  if(hashText(bytes)!==hash)fail();
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 }
 private async write(text:string):Promise<string>{
  const hash=hashText(text),filename=this.filename(hash);
  let work=pending.get(filename);
  if(!work){
   work=(async()=>{
    try{if(await this.read(hash)!==text)fail();}
    catch(error){if((error as NodeJS.ErrnoException).code!=='SCIENTIFIC_TEXT_MISSING')throw error;await atomicWrite(filename,text);}
   })();
   pending.set(filename,work);
   void work.finally(()=>{if(pending.get(filename)===work)pending.delete(filename);}).catch(()=>undefined);
  }
  await work;return hash;
 }

 /** Proofs and their map source copies are external even for a one-line derivation. */
 async encode<T>(input:T,roots:readonly string[]):Promise<T|Envelope>{
  if(!object(input))return input;
  const value=structuredClone(input),texts:TextRef[]=[],writes=new Map<string,Promise<string>>();
  const visit=async(node:unknown,at:Segment[]):Promise<void>=>{
   if(Array.isArray(node)){for(let i=0;i<node.length;i++)await visit(node[i],[...at,i]);return;}
   if(!object(node))return;
   for(const [key,item] of Object.entries(node)){
    const location=[...at,key];
    const proofField=at[0]==='knowledgeMapV4'&&(key==='argument'||key==='proof'||at[1]==='sources'&&key==='body');
    if(typeof item!=='string'){await visit(item,location);continue;}
    if(!item||!fields.has(key)||!proofField&&Buffer.byteLength(item,'utf8')<192)continue;
    const escape=Buffer.from(item,'utf8').toString('utf8')!==item;
    if(escape&&!proofField)continue;
    // JSON escaping preserves unmatched UTF-16 surrogates from older JSON inputs.
    const bytes=escape?JSON.stringify(item):item;
    let write=writes.get(bytes);
    if(!write){write=this.write(bytes);writes.set(bytes,write);}
    texts.push({path:location,hash:await write,...(escape?{encoding:'json' as const}:{})});
    node[key]=null;
   }
  };
  for(const root of roots)if(Object.hasOwn(value,root))await visit(value[root],[root]);
  if(roots.includes('knowledgeMapV4')&&value.knowledgeMapV4)return {format:mapFormat,value,texts};
  return texts.length?{format,value,texts}:input;
 }

 /** Legacy inline checkpoints are read unchanged. Missing/corrupt blobs never trigger model regeneration. */
 async decode<T>(input:unknown,roots:readonly string[]):Promise<T>{
  if(!object(input)||input.format!==format&&input.format!==mapFormat)return input as T;
  if(Object.keys(input).some(key=>!['format','value','texts'].includes(key))||!object(input.value)||!Array.isArray(input.texts))fail();
  const value=structuredClone(input.value),seen=new Set<string>(),reads=new Map<string,Promise<string>>();
  for(const ref of input.texts as TextRef[]){
   if(!object(ref)||Object.keys(ref).some(k=>!['path','hash','encoding'].includes(k))||ref.encoding!==undefined&&(ref.encoding!=='json'||input.format!==mapFormat)||!Array.isArray(ref.path)||typeof ref.hash!=='string'||ref.path.length<2)fail();
   const parts=ref.path as Segment[];
   if(typeof parts[0]!=='string'||!roots.includes(parts[0])||typeof parts.at(-1)!=='string'||!fields.has(parts.at(-1) as string)||parts.some(p=>typeof p==='string'?['__proto__','prototype','constructor'].includes(p):!Number.isSafeInteger(p)||p<0))fail();
   const key=JSON.stringify(parts);if(seen.has(key))fail();seen.add(key);
   let parent:unknown=value;
   for(const segment of parts.slice(0,-1)){
    if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,segment))fail();
    parent=(parent as Record<Segment,unknown>)[segment];
   }
   const last=parts.at(-1)!;
   if(!object(parent)||!Object.hasOwn(parent,last)||parent[last]!==null)fail();
   let read=reads.get(ref.hash);if(!read){read=this.read(ref.hash);reads.set(ref.hash,read);}
   const text=await read;
   const restored=ref.encoding==='json'?JSON.parse(text):text;
   if(typeof restored!=='string')fail();
   (parent as Record<Segment,unknown>)[last]=restored;
  }
  return value as T;
 }
}
