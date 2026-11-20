import {realpath} from 'node:fs/promises';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {atomicWrite} from './atomic.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWithin} from '../tools/files.js';

const applicationRoot=fileURLToPath(new URL('../../',import.meta.url));
const localDirectory='.carnot-data';
const choiceFile='.carnot-workspace-choice';

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
    let choice: string | undefined;
    try { choice = readFileSync(path.join(source,choiceFile),'utf8').trim(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (choice === 'legacy') return legacy;
    if (choice === 'current') return current;
    throw new AmbiguousWorkspaceError(legacy,current);
  }
  return legacy;
}

export class AmbiguousWorkspaceError extends Error {
  constructor(readonly legacy: string, readonly current: string) {
    super(`Two CAgE workspaces exist. Choose the one to open:\n1. Before the layout update (v0.2.6 layout): ${legacy}\n2. After the layout update (v0.2.7 layout): ${current}`);
  }
}

/** Only interactive launchers prompt. Services and explicit paths stay deterministic. */
export async function selectStartupDataRoot(value?: string, sourceRoot=applicationRoot): Promise<string> {
  try { return await resolveDataRoot(value,sourceRoot); }
  catch (error) {
    if (!(error instanceof AmbiguousWorkspaceError)) throw error;
    if (!process.stdin.isTTY) throw new Error(error.message + '\nStart in a terminal to choose, or set CARNOT_DATA_DIR.');
    process.stderr.write(error.message + '\n');
    const input = createInterface({input:process.stdin, output:process.stderr});
    try {
      process.stderr.write('Enter 1 or 2 (q to cancel): ');
      for await (const line of input) {
        const answer = line.trim();
        if (answer === 'q') break;
        if (answer === '1' || answer === '2') {
          const legacy = answer === '1';
          const target = await resolveDataRoot(legacy ? error.legacy : error.current,sourceRoot);
          await atomicWrite(path.join(sourceRoot,choiceFile), legacy ? 'legacy\n' : 'current\n');
          return target;
        }
        process.stderr.write('Enter 1 or 2 (q to cancel): ');
      }
      throw new Error('Workspace selection cancelled.');
    } finally { input.close(); }
  }
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
