import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWithin} from '../tools/files.js';

const applicationRoot=fileURLToPath(new URL('../../',import.meta.url));
const localDirectory='.carnot-data';

export function defaultDataRoot(sourceRoot=applicationRoot):string {
  return process.env.CARNOT_DATA_DIR?.trim() || path.join(sourceRoot,localDirectory);
}

async function canonicalFuture(location:string):Promise<string>{
  try{return await realpath(location);}
  catch(error){
    const parent=path.dirname(location);
    if((error as NodeJS.ErrnoException).code!=='ENOENT'||parent===location)throw error;
    return path.join(await canonicalFuture(parent),path.basename(location));
  }
}

/** Validate before creating launcher logs or taking the store's exclusive lease. */
export async function resolveDataRoot(value?:string,sourceRoot=applicationRoot):Promise<string>{
  const requested=path.resolve(value?.trim()||defaultDataRoot(sourceRoot));
  const source=await realpath(sourceRoot);
  const target=await canonicalFuture(requested);
  const overlapsSource=(base:string,location:string)=>isWithin(base,location)&&path.relative(path.join(base,localDirectory),location)!=='';
  if(overlapsSource(path.resolve(sourceRoot),requested)||overlapsSource(source,target)){
    throw Error('Choose the application .carnot-data directory or a data directory outside the source tree.');
  }
  return target;
}
