import {readFile,open,link,unlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {stableHash} from '../learning/research-hash.js';
import type {OperationReceiptV3} from '../research/versions/v3/operations.js';
import {ensureDirectory,syncDirectory} from '../storage/atomic.js';
/** Immutable local artifact objects; model input never supplies a filesystem path. */
export class ArtifactStoreV3 {
 constructor(private readonly directory:string){}
 private filename(ref:string):string {if(!/^v3-artifact:[a-f0-9]{64}$/.test(ref))throw new Error('Invalid V3 artifact reference.');return join(this.directory,ref.slice(12)+'.json');}
 async read(ref:string):Promise<unknown>{if((await lstat(this.directory)).isSymbolicLink())throw new Error('Unsafe V3 artifact directory.');const filename=this.filename(ref);if((await lstat(filename)).isSymbolicLink())throw new Error('Unsafe V3 artifact object.');const envelope=JSON.parse(await readFile(filename,'utf8')) as {version:number;bodyHash:string;artifact:{request:unknown;receipt:OperationReceiptV3}};if(envelope.version!==1||stableHash(envelope.artifact)!==envelope.bodyHash)throw new Error('Corrupt V3 artifact bytes.');const full=envelope.artifact;const r=full.receipt;if(!r||r.artifactRef!==ref||r.inputHash!==ref.slice(12)||stableHash({request:full.request,inputBinding:r.inputBinding,sourceVersion:r.sourceVersion,requestedAt:r.createdAt,operationVersion:r.operationVersion})!==r.inputHash)throw new Error('Corrupt V3 artifact binding.');return full;}
 async save(ref:string,value:unknown):Promise<void>{await ensureDirectory(this.directory);if((await lstat(this.directory)).isSymbolicLink())throw new Error('Unsafe V3 artifact directory.');const filename=this.filename(ref),temporary=join(this.directory,randomUUID()+'.tmp');try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify({version:1,bodyHash:stableHash(value),artifact:value}));await file.sync();}finally{await file.close();}try{await link(temporary,filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(!isDeepStrictEqual(await this.read(ref),value))throw new Error('Immutable V3 artifact conflict.');}await syncDirectory(this.directory);}finally{await unlink(temporary).catch(()=>{});}}
}
