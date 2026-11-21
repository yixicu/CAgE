import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Value} from 'typebox/value';
import type {FastifyInstance} from 'fastify';
import {coreActor,legacyCore,type CoreRelease,type CoreInstallation} from '../learning/core-package.js';
import type {KnowledgeMapStore,MapSeedInput} from '../learning/knowledge-map-store.js';
import {stableHash} from '../learning/research-hash.js';
import bundled from '../shared/core-map-release.json' with {type:'json'};
import {seedSchema} from './knowledge-map-routes.js';
import {readLimited,UpdateError} from './desktop-updates.js';

const api='https://api.github.com/repos/yixicu/CAgE';
const maxBytes=8*1024*1024;
const invalid=()=>new UpdateError(502,'CORE_UPDATE_INVALID','GitHub did not provide a valid, verifiable Core map publication.');
function json(bytes:Buffer){try{return JSON.parse(bytes.toString('utf8'));}catch{throw invalid();}}
function checkedSeeds(value:unknown):MapSeedInput['entries']{
 if(!Array.isArray(value)||value.length<1||value.length>4096||!value.every(seed=>Value.Check(seedSchema,seed)))throw invalid();
 return value;
}
function publicStatus(current?:CoreInstallation){
 return {currentVersion:current?.version??0,keptLocal:current?.nodes.filter(node=>node.local).length??0};
}

export async function loadBundledCore(map:KnowledgeMapStore,sourceRoot:string,webRoot:string){
 if(await map.corePackageStatus())return;
 if(await map.hasCoreMap()&&await map.installCorePackage(legacyCore))return;
 // Windows optional-map installers use a JSON literal wrapped in an ES module.
 for(const path of [join(webRoot,'basic-physics-map.mjs'),join(sourceRoot,'web','core-preview.json'),join(webRoot,'core-preview.json')]){
  let text:string;
  try{text=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  const entries=JSON.parse(text.trim().replace(/^export default /,'').replace(/;$/,''));
  if(stableHash(entries)===bundled.sha256)await map.installCorePackage(bundled,checkedSeeds(entries));
  else if(stableHash(entries)===legacyCore.sha256)await map.installCorePackage(legacyCore,checkedSeeds(entries));
  else if(!await map.hasCoreMap()){
   // Older installations could supply a custom optional map; retain its original import semantics.
   await map.importSeeds({projectId:coreActor.projectId,requestId:'bundled-core-v1',expectedProfileVersion:0,entries},coreActor);
  }
  return;
 }
}

export class CoreMapUpdates{
 constructor(private map:KnowledgeMapStore,private request=fetch){}
 async status(){return publicStatus(await this.map.corePackageStatus());}
 private async get(path:string,limit:number,token?:string){
  const response=await this.request(api+path,{redirect:'error',signal:AbortSignal.timeout(30_000),
   headers:{Accept:'application/vnd.github.raw+json','User-Agent':'CAgE-Core-map',...(token?{Authorization:'Bearer '+token}:{})}
  }).catch(()=>{throw new UpdateError(502,'CORE_UPDATE_CONNECTION','Could not connect to GitHub to check the Core map.');});
  if(!response.ok){
   await response.body?.cancel();
   if([401,403,404].includes(response.status))throw new UpdateError(response.status,'CORE_UPDATE_ACCESS','The Core map publication is unavailable. Check repository access or GitHub rate limits.');
   throw invalid();
  }
  const chunks:Buffer[]=[];
  await readLimited(response,limit,async chunk=>{chunks.push(Buffer.from(chunk));},invalid);
  return Buffer.concat(chunks);
 }
 private async published(token?:string):Promise<CoreRelease>{
  const value=json(await this.get('/contents/app/src/shared/core-map-release.json?ref=main',2048,token));
  if(!value||!Number.isSafeInteger(value.version)||value.version<1||typeof value.blob!=='string'||!/^[a-f0-9]{40}$/.test(value.blob)||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw invalid();
  return {version:value.version,blob:value.blob,sha256:value.sha256};
 }
 async check(token?:string){
  const release=await this.published(token),current=await this.map.corePackageStatus();
  if(current?.version===release.version&&current.sha256!==release.sha256)throw invalid();
  return {...publicStatus(current),release,available:release.version>(current?.version??0)};
 }
 async install(version:number,sha256:string,token?:string){
  const {release,available}=await this.check(token);
  if(!available||release.version!==version||release.sha256!==sha256)throw new UpdateError(409,'CORE_UPDATE_CHANGED','Check again to review the current Core map publication.');
  const bytes=await this.get('/git/blobs/'+release.blob,maxBytes,token);
  if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==release.blob)throw invalid();
  const entries=checkedSeeds(json(bytes));
  if(stableHash(entries)!==sha256)throw invalid();
  return publicStatus(await this.map.installCorePackage(release,entries));
 }
}

export function registerCoreUpdates(app:FastifyInstance,map:KnowledgeMapStore,request?:typeof fetch){
 const service=new CoreMapUpdates(map,request);
 const token={type:'string',maxLength:512},version={type:'integer',minimum:1},sha256={type:'string',pattern:'^[a-f0-9]{64}$'};
 app.get('/api/core-map/update',()=>service.status());
 app.post<{Body:{token?:string}}>('/api/core-map/update/check',{schema:{body:{type:'object',properties:{token},additionalProperties:false}}},req=>service.check(req.body.token));
 app.post<{Body:{token?:string;version:number;sha256:string}}>('/api/core-map/update/install',{schema:{body:{type:'object',properties:{token,version,sha256},required:['version','sha256'],additionalProperties:false}}},req=>service.install(req.body.version,req.body.sha256,req.body.token));
}
