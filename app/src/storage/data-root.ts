import {realpath} from 'node:fs/promises';
import {realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWithin} from '../tools/files.js';

const applicationRoot=fileURLToPath(new URL('../../',import.meta.url));
const localDirectory='.carnot-data';

export function defaultDataRoot(sourceRoot=applicationRoot):string {
  const configured = process.env.CARNOT_DATA_DIR?.trim();
  if (configured) return configured;
  const source = path.resolve(sourceRoot);
  const current = path.join(source,localDirectory);
  const parent = path.dirname(source);
  if (path.basename(source) !== 'app' ||
      !statSync(path.join(parent,'desktop-packaging','shell','tauri.conf.json'), {throwIfNoEntry:false})?.isFile()) return current;
  const legacy = path.join(parent,localDirectory);
  if (!statSync(legacy, {throwIfNoEntry:false})?.isDirectory()) return current;
  if (statSync(current, {throwIfNoEntry:false}) && path.relative(realpathSync(legacy),realpathSync(current)) !== '') {
    throw new AmbiguousWorkspaceError('Two CAgE workspaces exist. Set CARNOT_DATA_DIR to the absolute path of the workspace you want to open.');
  }
  return legacy;
}

export class AmbiguousWorkspaceError extends Error {}

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
