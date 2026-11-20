import {open} from 'node:fs/promises';

/** UTF-16LE private spool files preserve JavaScript character offsets without an index. */
export async function readTextPage(path:string,offset:number,limit:number){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw RangeError('Invalid text page.');
 const file=await open(path,'r');
 try{
  const length=(await file.stat()).size/2;
  if(offset>=length)return {text:'',next:null};
  const count=Math.min(Math.max(2,limit),length-offset);
  const buffer=Buffer.alloc(count*2);
  let bytes=0;
  while(bytes<buffer.length){
   const result=await file.read(buffer,bytes,buffer.length-bytes,offset*2+bytes);
   if(!result.bytesRead)throw Error('Incomplete archived text page.');
   bytes+=result.bytesRead;
  }
  let text=buffer.toString('utf16le');
  if(offset+count<length&&/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
  const end=offset+text.length;
  return {text,next:end<length?end:null};
 }finally{await file.close();}
}
