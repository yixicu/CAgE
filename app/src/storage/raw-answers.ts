import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { RawAnswerOwnerV21, RawAnswerRefV21, RawAnswerGrantV21, RawAnswerScopeV21, RawAnswerStoreV21, TechnicalStateV21 } from '../research/contracts/v21.js';
import { ensureDirectory, syncDirectory, AtomicWriteError } from './atomic.js';
import { stableHash } from '../learning/research-hash.js';

export class RawAnswerError extends Error {
  constructor(readonly code:'FORBIDDEN'|'INVALID'|'CONFLICT'|'CORRUPT', message:string) { super(message); this.name='RawAnswerError'; }
}
const hash = (body:Uint8Array) => createHash('sha256').update(body).digest('hex');
const requireRaw = (ok:unknown, code:RawAnswerError['code'], message:string):void => { if (!ok) throw new RawAnswerError(code,message); };
function ownerValid(owner:RawAnswerOwnerV21):void {
  requireRaw(owner && owner.workerProtocolVersion==='2.1','INVALID','Raw answer requires an exact protocol owner.');
  for(const key of ['owner','projectId','epochId','wayId','questionId','questionRevision','attemptId','callId','hypothesisId','hypothesisRevision','inputHash','scientificInputHash'] as const)
    requireRaw(typeof owner[key]==='string' && owner[key].length>0 && owner[key].length<=1024,'INVALID',`Invalid raw answer ${key}.`);
  requireRaw(owner.owner===owner.projectId,'INVALID','Raw owner must remain the originating project.');
}
function ownerOf(ref:RawAnswerOwnerV21):RawAnswerOwnerV21 {
  const {owner,projectId,epochId,wayId,questionId,questionRevision,attemptId,callId,hypothesisId,hypothesisRevision,inputHash,scientificInputHash,workerProtocolVersion}=ref;
  return {owner,projectId,epochId,wayId,questionId,questionRevision,attemptId,callId,hypothesisId,hypothesisRevision,inputHash,scientificInputHash,workerProtocolVersion};
}
interface Envelope { ref:RawAnswerRefV21; state:TechnicalStateV21; body:string }
/** Immutable final objects. Runtime's separate journal owns mutable partial capture and invocation claims. */
export class RawAnswerStore implements RawAnswerStoreV21 {
  constructor(readonly directory:string, private readonly authorizeGrant?:(grant:RawAnswerGrantV21)=>boolean|Promise<boolean>) {}
  private filename(ref:Pick<RawAnswerRefV21,'id'>):string {
    requireRaw(/^raw_[0-9a-f]{64}$/.test(ref.id),'INVALID','Invalid immutable raw identity.');
    return path.join(this.directory,`${ref.id}.json`);
  }
  async save(owner:RawAnswerOwnerV21,exactBody:string,state:TechnicalStateV21):Promise<RawAnswerRefV21> {
    owner=ownerOf(structuredClone(owner)); state=structuredClone(state); ownerValid(owner);
    requireRaw(typeof exactBody==='string','INVALID','Raw body must be exact SDK text.');
    const bytes=Buffer.from(exactBody,'utf8');
    requireRaw(bytes.toString('utf8')===exactBody,'INVALID','Raw body contains unpaired UTF-16 code units.');
    requireRaw(['completed','failed','interrupted'].includes(state.executionStatus) && ['complete','partial','empty'].includes(state.completeness),'INVALID','Invalid technical state.');
    requireRaw(state.completeness!=='complete'||state.executionStatus==='completed','INVALID','Incomplete transport cannot produce a complete raw answer.');
    requireRaw((bytes.length===0)===(state.completeness==='empty'),'INVALID','Empty raw bytes must retain empty completeness.');
    const ref:RawAnswerRefV21={...owner,id:`raw_${stableHash(owner)}`,bodyHash:hash(bytes),byteLength:bytes.length,completeness:state.completeness};
    const envelope:Envelope={ref,state,body:exactBody}, filename=this.filename(ref);
    await ensureDirectory(this.directory);
    const temporary=path.join(this.directory,`.${randomUUID()}.tmp`);
    try {
      const file=await fs.open(temporary,'wx',0o600);
      try { await file.writeFile(JSON.stringify(envelope)); await file.sync(); } finally { await file.close(); }
      // link is exclusive: two finalizers cannot replace an immutable result.
      try { await fs.link(temporary,filename); }
      catch(error) {
        if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
        const existing=JSON.parse(await fs.readFile(filename,'utf8')) as Envelope;
        const prior=await this.load(existing.ref);
        requireRaw(isDeepStrictEqual(prior,envelope),'CONFLICT','Frozen call already has a different raw result.');
        await syncDirectory(this.directory);
        return structuredClone(ref);
      }
      try { await syncDirectory(this.directory); } catch(error) { throw new AtomicWriteError(error); }
      return structuredClone(ref);
    } finally { await fs.unlink(temporary).catch(()=>undefined); }
  }
  private async authorize(ref:RawAnswerRefV21,grant:RawAnswerGrantV21):Promise<void> {
    requireRaw(grant && isDeepStrictEqual(grant.ref,ref),'FORBIDDEN','Exact raw answer grant required.');
    requireRaw(typeof grant.readerProjectId==='string' && !!grant.readerProjectId && ['theorist','worker','moderator','literature'].includes(grant.readerRole),'FORBIDDEN','Invalid raw reader.');
    requireRaw(grant.readerRole!=='moderator' && ['review','adopted-premise','archive','inherited-draft'].includes(grant.purpose),'FORBIDDEN','Role has no raw exploration authority.');
    requireRaw(grant.readerRole!=='worker'||grant.purpose==='adopted-premise'||grant.purpose==='inherited-draft','FORBIDDEN','Worker cannot review sibling originals.');
    requireRaw(grant.readerProjectId===ref.projectId || grant.purpose==='inherited-draft','FORBIDDEN','Foreign raw answer requires an inherited grant.');
    if(this.authorizeGrant) requireRaw(await this.authorizeGrant(structuredClone(grant)),'FORBIDDEN','Raw grant is no longer authorized.');
    else requireRaw(grant.readerProjectId===ref.projectId,'FORBIDDEN','Foreign raw grant requires manifest verification.');
  }
  private async load(ref:RawAnswerRefV21):Promise<Envelope> {
    ownerValid(ref);
    requireRaw(ref.id===`raw_${stableHash(ownerOf(ref))}`,'INVALID','Raw identity does not bind exact owner.');
    const value=JSON.parse(await fs.readFile(this.filename(ref),'utf8')) as Envelope;
    requireRaw(isDeepStrictEqual(value.ref,ref)&&typeof value.body==='string','CORRUPT','Saved raw envelope mismatch.');
    const bytes=Buffer.from(value.body,'utf8');
    requireRaw(bytes.toString('utf8')===value.body && bytes.length===ref.byteLength && hash(bytes)===ref.bodyHash && value.state.completeness===ref.completeness,'CORRUPT','Saved raw bytes failed verification.');
    return value;
  }
  async read(ref:RawAnswerRefV21,grant:RawAnswerGrantV21):Promise<string> {
    ref=structuredClone(ref); grant=structuredClone(grant);
    await this.authorize(ref,grant); // Authorization always precedes lookup, hashing, or expansion.
    return (await this.load(ref)).body;
  }
  async list(scope:RawAnswerScopeV21,grants:RawAnswerGrantV21[]):Promise<RawAnswerRefV21[]> {
    const result=new Map<string,RawAnswerRefV21>();
    for(const grant of structuredClone(grants)) {
      await this.authorize(grant.ref,grant);
      const ref=grant.ref;
      if(ref.owner===scope.owner && ref.projectId===scope.projectId && (scope.epochId===undefined||ref.epochId===scope.epochId)) {
        await this.load(ref); result.set(ref.id,ref);
      }
    }
    return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
}
