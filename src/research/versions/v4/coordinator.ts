import {RuntimeError} from '../../../runtime/errors.js';
import {ScientificTextStore} from '../../../storage/scientific-text.js';
import type {NativeHandoffPort,NativeHandoffState} from '../../../runtime/native-handoff.js';
import {authorizeKnowledgeRead} from './knowledge-study.js';
import {knowledgeRefKey} from '../../../learning/knowledge-network.js';
import {MapError} from '../../../learning/knowledge-map.js';
import {beginAlternate,createMapRevision,type MapMaintenanceTask} from './map-maintenance.js';
import {createResearchV44,advanceResearchV44,refreshResearchContextV44,publicationResearchV44,qualifyApplicationV44,type ResearchStateV44,type PurposeV44,type ResearchPublicationV4R4} from './theory-revision4.js';
import path from 'node:path';
import {reportStudyV45,applyResearchReplyV45,type ReportEvidenceV45,type PostReportStudyV45,type ResearchReplyV45} from './post-report.js';
import { createResearchV43, advanceResearchV43, qualifyApplicationV43, type ResearchStateV43, type PurposeV43, type RootContextV43, type ResearchPublicationV4R3 } from './theory-revision3.js';
import { advanceResearchV42, qualifyApplicationV42, type ResearchStateV42, type PurposeV42 } from './theory-revision2.js';
import { createHash, randomUUID } from 'node:crypto';
import { stableHash } from '../../../learning/research-hash.js';
import { atomicWrite, readJson } from '../../../storage/atomic.js';
import { replayTheoryTrial, runTheoryTrial, type StagePassage } from './theory-trial.js';

export interface V4Scope { projectId: string; epochId: string; rootId: string }
export type V4Authorize = (stage: StagePassage, source: V4Scope) => boolean | Promise<boolean>;
type Purpose = PurposeV42 | PurposeV43 | PurposeV44;
interface Usage { tokens?: number; costUsd?: number }
interface Dispatch { purpose: Purpose; sentAt: string; usage?: Usage }
export interface V4SharedCard { id:string; authority:'proof-backed'|'research-evidence'; internalClaim:string; modelConditions:string }
export type V4SharedTheories = () => Promise<readonly V4SharedCard[]>;
type SharedRef = {id:string; hash:string};
const sharedRef = (card:V4SharedCard): SharedRef => ({id:card.id,hash:stableHash(card)});
function allSharedGranted(required:SharedRef[], cards:readonly V4SharedCard[]) {
  return required.every(ref => cards.some(card => card.id === ref.id && sharedRef(card).hash === ref.hash));
}
interface Watch { trialId: string; signal: string; reason: string; anchorStageIds: string[] }
export interface V4DispatchJournal { revision?:'v4-operation-1'|'v4-operation-2'|'v4-operation-3'|'v4-operation-4'; rootContext?:RootContextV43; watch?: Watch; knownTheories: string[]; onDispatch: () => Promise<void>; onUsage: (usage?: Usage) => Promise<void> }
type Provider = (purpose:Purpose, stages:readonly StagePassage[], previous:unknown, journal:V4DispatchJournal) => Promise<unknown>;
type Review = Awaited<ReturnType<typeof runTheoryTrial>>;
type Stage = { scope: V4Scope; stage: StagePassage; producerId: string; handover?: boolean; watchKeys?: string[] };
type Task = {
  revision?:'v4-operation-2'|'v4-operation-3'|'v4-operation-4'; research4?:ResearchStateV44;recordId?:string;predecessor?:string; research3?:ResearchStateV43; readReceipts?:{ids:string[];hashes:string[];missing:string[];at:string}[]; research?:ResearchStateV42; archiveOnly?:boolean; cancelled?:boolean; manifest?:string;
  id: string; scope: V4Scope; ids: string[]; fresh: string[]; mode: 'directed' | 'blind';
  status: 'ready' | 'sending' | 'uncertain' | 'completed' | 'failed' | 'stopped' | 'settled';
  sources?: {scope: V4Scope; stageId:string}[]; watch?: Watch; settlement?: {operatorNote:string; at:string};
  sharedRefs?: SharedRef[]; knownRefs: string[]; sends: Dispatch[]; state: Review; purpose?: Purpose; error?: string;
};
type Ledger = {
  mapTasks?:MapMaintenanceTask[];
  postReports?:PostReportStudyV45[];
  version: 1; credits: number; remainder: number; stages: Stage[]; tasks: Task[];
  waiting?:Record<string,{since:string;lastServed?:string}>;
  service?:Record<string,{outcome:string;at:string}>;
  historyCutoffs?: Record<string,{stages:number; watches:string[];research?:string[]}>;
  closed: string[]; freezes: Record<string,string[]>; exposed: Record<string,string>;
};
function freezeHistory(data: Ledger, scope: V4Scope) {
  data.historyCutoffs ??= {};
  return data.historyCutoffs[key(scope)] ??= {
    stages:data.stages.length,
    research:data.tasks.filter(t=>(t.revision==='v4-operation-2'||t.revision==='v4-operation-3'||t.revision==='v4-operation-4')&&t.status==='completed').map(t=>t.id),
    watches:data.tasks.filter(t => t.status === 'completed' && t.state.phase === 'closed' && t.state.assessment.decision === 'watch').map(t => t.id),
  };
}

function stageRefs(task: Task) {
  return task.sources ?? task.ids.map(stageId => ({scope:task.scope,stageId}));
}

function acceptedResponses(state: Review): unknown[] {
  if (state.phase === 'screen') return [];
  const accepted: unknown[] = [state.assessment];
  if ('proposal' in state) accepted.push(state.proposal);
  if (state.phase === 'reviewed') accepted.push(state.challenge);
  return accepted;
}

const key = ({projectId,epochId,rootId}: V4Scope) => JSON.stringify([projectId,epochId,rootId]);
/** A trial may use any theory shown to it. Guard its complete input ancestry on every subsequent read. */
function sourceClosure(data: Ledger, task: Task) {
  const stages = new Set<Stage>();
  const sharedRefs: SharedRef[] = [];
  const visited = new Set<string>();
  const pending = [task];
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    sharedRefs.push(...current.sharedRefs ?? []);
    for (const ref of stageRefs(current)) {
      const source = data.stages.find(s => same(s.scope,ref.scope) && s.stage.stageId === ref.stageId);
      if (!source) return {stages:[],sharedRefs:[]};
      stages.add(source);
    }
    for (const id of [...current.knownRefs,...(current.watch ? [current.watch.trialId] : [])]) {
      const source = data.tasks.find(t => t.id === id && t.status === 'completed');
      if (!source) return {stages:[],sharedRefs:[]};
      pending.push(source);
    }
  }
  return {stages:[...stages],sharedRefs};
}

/** Actual premises are narrower than material shown for discovery or comparison. */
function positiveClosure(data:Ledger,task:Task,application=false,visiting=new Set<string>()):{stages:Stage[];sharedRefs:SharedRef[]}|undefined {
  if(task.revision==='v4-operation-4')return task.research4?.challenge?.verdict==='supported'?sourceClosure(data,task):undefined;
  if(task.revision==='v4-operation-3')return task.research3?.challenge?.verdict==='supported'?sourceClosure(data,task):undefined;
  if(visiting.has(task.id)||!task.research?.candidate||!task.research.challenge)return;
  visiting.add(task.id);
  const available=sourceClosure(data,task),state=task.research;
  const ids=new Set([...state.candidate!.stageRefs,...state.challenge!.stageRefs]);
  const theories=new Set([...state.candidate!.theoryRefs??[],...state.challenge!.theoryRefs??[]]);
  if(state.assessment?.decision==='reuse'&&state.assessment.theoryRef)theories.add(state.assessment.theoryRef);
  if(application&&state.application?.status==='ready')for(const node of state.application.support){
    if((node.kind==='source'||node.kind==='assumption')&&node.sourceRef)ids.add(node.sourceRef);
    if(node.kind==='theory'&&node.sourceRef)theories.add(node.sourceRef);
  }
  const stages:Stage[]=[],sharedRefs:SharedRef[]=[];
  const pending=[...ids];
  for(let i=0;i<pending.length;i++){
    const row=available.stages.find(s=>s.stage.stageId===pending[i]);if(!row)return;
    stages.push(row);
    for(const dep of row.stage.dependencies??[])if(!pending.includes(dep))pending.push(dep);
  }
  for(const id of theories){
    const shared=available.sharedRefs.find(ref=>ref.id===id);
    if(shared){sharedRefs.push(shared);continue;}
    const parent=data.tasks.find(t=>t.id===id&&task.knownRefs.includes(id)&&t.status==='completed');
    if(!parent)return;
    const closure=positiveClosure(data,parent,false,visiting);if(!closure)return;
    stages.push(...closure.stages);sharedRefs.push(...closure.sharedRefs);
  }
  visiting.delete(task.id);
  return {stages:[...new Map(stages.map(s=>[key(s.scope)+s.stage.stageId,s])).values()],sharedRefs:[...new Map(sharedRefs.map(r=>[r.hash,r])).values()]};
}

function nativeReplyReceived(state?:NativeHandoffState){return !!state?.original&&(!state.repairSent||!!state.repair);}
function retainNativeReply(current:NativeHandoffState|undefined,next:NativeHandoffState){
 if(!current||current.callId!==next.callId||current.original&&stableHash(current.original)!==stableHash(next.original)||current.repairSent&&!next.repairSent||current.repair&&stableHash(current.repair)!==stableHash(next.repair))throw Error('Native reply binding changed');
 return structuredClone(next);
}
function archiveNativeReply(task:{nativeReply?:NativeHandoffState;nativeReplies?:NativeHandoffState[]}){if(task.nativeReply){(task.nativeReplies??=[]).push(task.nativeReply);delete task.nativeReply;}}

const allowNone: V4Authorize = () => false;
function same(a: V4Scope,b: V4Scope) { return key(a) === key(b); }
const coordinators = new Map<string, V4Coordinator>();

/** The application holds the existing backend writer lease for this data root. */
export function getV4Coordinator(root: string) {
  const absolute = path.resolve(root);
  const id = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  let instance = coordinators.get(id);
  if (!instance) {
    instance = new V4Coordinator(path.join(absolute,'v4','coordinator.json'));
    coordinators.set(id,instance);
  }
  return instance;
}

class V4Coordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private active = false;
  private recovered = false;
  private pumping=false;
  private windows:{scope:V4Scope;run:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(error:unknown)=>void}[]=[];
  private reportWake?:(scope:V4Scope)=>Promise<void>;
  onReportWake(listener:(scope:V4Scope)=>Promise<void>){this.reportWake=listener;return ()=>{if(this.reportWake===listener)this.reportWake=undefined;};}
  async wakeReport(scope:V4Scope){await this.reportWake?.(scope);}
  private readonly texts:ScientificTextStore;
  constructor(private filename: string) {this.texts=new ScientificTextStore(path.join(path.dirname(path.dirname(filename)),'scientific-content'));}

  private edit<T>(fn: (data: Ledger) => T): Promise<T> {
    const transaction = this.tail.then(async () => {
      let data: Ledger;
      try { data = await readJson<Ledger>(this.filename); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        data = {version:1, credits:1, remainder:0, stages:[], tasks:[], closed:[], freezes:{}, exposed:{}};
      }
      data=await this.texts.decode<Ledger>(data,['mapTasks','postReports']);
      if (data.version !== 1) throw new Error('Unsupported V4 ledger version');
      const before = JSON.stringify(data);
      if (!this.recovered) {
        for(const task of data.mapTasks??[])if(task.status==='sending')task.status=task.receipt||nativeReplyReceived(task.nativeReply)||!task.attemptSent?'ready':'uncertain';
        for(const study of data.postReports??[])if(study.status==='sending'){
          if(study.receipt||nativeReplyReceived(study.nativeReply))study.status='ready';
          else study.status=study.attemptSent?'uncertain':'ready';
        }
        for (const task of data.tasks) if (task.status === 'sending') task.status = task.sends.at(-1)?.usage ? 'failed' : 'uncertain';
      }
      const result = fn(data);
      const after = JSON.stringify(data);
      if (after !== before) await atomicWrite(this.filename,JSON.stringify(await this.texts.encode(data,['mapTasks','postReports']))+'\n');
      this.recovered = true;
      return result;
    });
    this.tail = transaction.catch(() => undefined);
    return transaction;
  }

  async resolveMapDomainDecision(projectId:string,taskId:string,proposalHash:string,decision:'approve'|'decline',alternate?:Pick<NonNullable<MapMaintenanceTask['alternateRoute']>,'question'|'report'|'model'>,acceptedFields?:string[]){
    return this.edit(data=>{
      const task=data.mapTasks?.find(t=>t.id===taskId&&t.projectId===projectId);
      if(!task)throw new MapError('NOT_FOUND','Map task not found in this project');
      const request=task.domainRequest;
      if(!request||request.proposalHash!==proposalHash)throw new MapError('CONFLICT','The reviewed field admission request changed');
      if(decision==='approve'&&acceptedFields?.length===0||acceptedFields?.some(field=>!request.fields.includes(field))||decision==='decline'&&acceptedFields?.length)throw new MapError('INVALID_INPUT','Select fields from the exact reviewed proposal');
      const accepted=decision==='decline'?[]:request.fields.filter(field=>!acceptedFields||acceptedFields.includes(field));
      const declined=request.fields.filter(field=>!accepted.includes(field));
      if(request.decision){if(request.decision!==decision||stableHash(request.acceptedFields??(decision==='approve'?request.fields:[]))!==stableHash(accepted))throw new MapError('CONFLICT','This admission request already has a decision');return structuredClone(task);}
      if(task.status!=='awaiting-consent')throw new MapError('CONFLICT','This task is not awaiting a field admission decision');
      request.decision=decision;request.acceptedFields=accepted;
      if(declined.length&&alternate)task.alternateRoute={...structuredClone(alternate),fields:declined};
      if(request.sourceDecision){
        if(task.alternateRoute)beginAlternate(task);else task.status='completed';
      }else task.status='ready';
      delete task.lease;return structuredClone(task);
    });
  }
  async registerMapTask(task:MapMaintenanceTask){return this.edit(data=>{data.mapTasks??=[];const previous=data.mapTasks.find(t=>t.id===task.id);if(previous){if(stableHash([previous.intentId,previous.ownerId,previous.projectId,previous.sourceKeys])!==stableHash([task.intentId,task.ownerId,task.projectId,task.sourceKeys]))throw Error('Changed map admission identity');return structuredClone(previous);}data.mapTasks.push(structuredClone(task));return structuredClone(task);});}
  async mapTasks(projectId:string){return this.edit(data=>structuredClone((data.mapTasks??[]).filter(t=>t.projectId===projectId)));}
  async settleMapAssessment(id:string,row:import('../../../learning/report-assessment.js').ReportUpdate){
    return this.edit(data=>{
      const task=data.mapTasks!.find(t=>t.id===id)!;
      if(task.status==='awaiting-assessment'&&task.projectId===row.projectId&&task.waitingForReport===row.artifactId&&!['pending','queued'].includes(row.status)){
        if(row.status==='confirmed')task.status='ready';
        else if(task.domainRequest&&(row.status==='conditional'||row.status==='unsupported')){
          task.domainRequest.sourceDecision=row.status;
          if(!task.domainRequest.decision)task.status='awaiting-consent';
          else if(task.alternateRoute)beginAlternate(task);else task.status='completed';
        }else task.status='completed';
        delete task.waitingForReport;
        task.history.push({action:'archive-decision',body:row.status==='confirmed'?'Independent review confirmed the source. Resume the saved extraction. '+row.review:'The original proof was withdrawn. '+row.review});
      }
      return structuredClone(task);
    });
  }
  async claimMapTask(projectId:string,hostOnly=false){return this.edit(data=>{const task=data.mapTasks?.find(t=>t.projectId===projectId&&t.status==='ready'&&(!hostOnly||t.phase==='publish'||!!t.receipt||!!t.pendingReviewObjection));if(!task)return;task.status='sending';task.lease=randomUUID();task.attemptSent=false;return structuredClone(task);});}
  async saveMapTask(task:MapMaintenanceTask){return this.edit(data=>{const i=data.mapTasks?.findIndex(t=>t.id===task.id)??-1;if(i<0||!task.lease||data.mapTasks![i]!.lease!==task.lease)throw Error('Map task lease changed');data.mapTasks![i]=structuredClone(task);return structuredClone(task);});}
  async releaseInterruptedMapTask(claim:MapMaintenanceTask){
    return this.edit(data=>{
      const task=data.mapTasks?.find(t=>t.id===claim.id&&t.projectId===claim.projectId);
      if(!task||!claim.lease||task.lease!==claim.lease||task.status!=='sending')return;
      if(claim.receipt&&!task.receipt)task.receipt=structuredClone(claim.receipt);
      task.status=task.receipt||nativeReplyReceived(task.nativeReply)||!task.attemptSent?'ready':'uncertain';
      delete task.lease;
    });
  }
  async saveMapNativeReply(id:string,state:NativeHandoffState){return this.edit(data=>{const task=data.mapTasks?.find(t=>t.id===id);if(!task)throw Error('Map task unavailable');task.nativeReply=retainNativeReply(task.nativeReply,state);if(!task.lease&&task.status==='uncertain'&&nativeReplyReceived(state))task.status='stopped';});}
  async recordMapUsage(id:string,callId:string,usage:Usage){return this.edit(data=>{const task=data.mapTasks?.find(t=>t.id===id);if(task?.nativeReply?.callId!==callId)throw Error('Map call changed');const send=task.sends.at(-1);if(send)send.usage=usage;});}
  async stopMapTasks(projectId:string){return this.edit(data=>{for(const task of data.mapTasks??[])if(task.projectId===projectId&&['ready','sending'].includes(task.status)){task.status=task.status==='sending'&&task.attemptSent&&!task.receipt?'uncertain':'stopped';delete task.lease;}});}
  async retryMapTask(projectId:string,id:string){
    return this.edit(data=>{
      let task=data.mapTasks?.find(t=>t.id===id&&t.projectId===projectId);
      if(!task)throw new MapError('NOT_FOUND','Map task not found in this project');
      if(task.status==='completed'&&task.domainRequest?.revisionNote){
        const revision=createMapRevision(task);task.domainRequest.revisionTaskId=revision.id;
        const previous=data.mapTasks!.find(t=>t.id===revision.id);
        if(!previous){data.mapTasks!.push(revision);return structuredClone(revision);}
        if(!['failed','stopped'].includes(previous.status))return structuredClone(previous);
        task=previous;
      }
      if(!['failed','stopped'].includes(task.status))throw new MapError('CONFLICT','Only a failed or explicitly stopped map task can be retried; uncertain sends require settlement');
      // Historical tasks persist the stable public runtime message, including failures before receipt decoding.
      const rejectedWire=task.status==='failed'&&!task.receipt&&nativeReplyReceived(task.nativeReply)&&task.error===new RuntimeError('INVALID_OUTPUT').message;
      if(!task.authored&&((task.rejectedReceipt&&task.receipt)||rejectedWire)){
        task.history.push({action:'rejected-native-result',body:JSON.stringify({callId:task.nativeReply?.callId,reply:task.receipt,error:task.error})});
        delete task.receipt;delete task.readBatchCursor;delete task.readResults;delete task.rejectedReceipt;
        archiveNativeReply(task);
      }
      task.status='ready';task.attemptSent=false;delete task.lease;delete task.error;
      return structuredClone(task);
    });
  }
  async submitStage(input: Stage) {
    if (![input.scope.projectId,input.scope.epochId,input.scope.rootId,input.producerId,input.stage.stageId,
      input.stage.passage,input.stage.branch].every(v => typeof v === 'string' && v.trim())
      || input.watchKeys !== undefined && (!Array.isArray(input.watchKeys) || !input.watchKeys.every(k=>typeof k === 'string' && k.trim()))
      || !Array.isArray(input.stage.conditions) || !input.stage.conditions.every(c => typeof c === 'string')) {
      throw new Error('Invalid V4 stage');
    }
    const row = structuredClone(input);
    return this.edit(data => {
      if (data.closed.includes(key(row.scope))) return false;
      freezeHistory(data,row.scope);
      const prior = data.stages.find(s => same(s.scope,row.scope) && s.stage.stageId === row.stage.stageId);
      if (prior) {
        if (prior.producerId !== row.producerId || JSON.stringify(prior.stage) !== JSON.stringify(row.stage)) {
          throw new Error('Conflicting immutable V4 stage');
        }
        return false;
      }
      if (!data.stages.some(s => s.producerId === row.producerId)) {
        data.remainder = (data.remainder+1) % 4;
        if (!data.remainder) data.credits = Math.min(2,data.credits+1);
      }
      data.stages.push(row);
      return true;
    });
  }

  async closeScope(scope: V4Scope, options?:{archiveOnly?:boolean}) {
    await this.edit(data => { if (!data.closed.includes(key(scope))) data.closed.push(key(scope));
      for(const t of data.tasks.filter(t=>same(t.scope,scope)&&(t.revision==='v4-operation-2'||t.revision==='v4-operation-3'||t.revision==='v4-operation-4'))) {
        if(t.revision==='v4-operation-4'){
          if(options?.archiveOnly&&!t.cancelled&&t.research4?.inquiry&&!['closed','parked'].includes(t.research4.phase))t.archiveOnly=true;
          else if(!options?.archiveOnly){t.archiveOnly=false;t.cancelled=true;if(t.status!=='uncertain')t.status='stopped';}
          continue;
        }
        if(t.revision==='v4-operation-3'){
          if(options?.archiveOnly&&!t.cancelled&&t.research3?.assessment&&['construct','identify'].includes(t.research3.assessment.decision)&&t.research3.scopeReview?.decision!=='close')t.archiveOnly=true;
          else {t.archiveOnly=false;t.cancelled=true;if(t.status!=='uncertain')t.status='stopped';}
          continue;
        }
        if(options?.archiveOnly && !t.cancelled && t.research?.assessment && ['construct','reuse'].includes(t.research.assessment.decision))t.archiveOnly=true;
        else {t.archiveOnly=false;t.cancelled=true;if(t.status!=='uncertain')t.status='stopped';}
      }
    });
  }

  async resolveUncertain(scope: V4Scope, taskId: string, input: {operatorNote:string}): Promise<'settled'|'already-settled'> {
    const note = input?.operatorNote;
    if (typeof note !== 'string' || !note.trim() || Buffer.byteLength(note) > 2048) throw new Error('Expected a scoped V4 settlement note');
    return this.edit(d => {
      const task = d.tasks.find(t => t.id === taskId && same(t.scope,scope));
      if (task?.status === 'settled' && task.settlement) return 'already-settled';
      if (!task || !(task.status === 'uncertain'||task.cancelled&&!task.settlement&&task.sends.some(s=>!s.usage)) || !task.sends.length) throw new Error('No uncertain V4 dispatch in scope');
      task.settlement = {operatorNote:note.trim(),at:new Date().toISOString()};
      task.status = 'settled';
      return 'settled';
    });
  }

  async countAttempts(scope: V4Scope) {
    return this.edit(d => d.tasks.filter(t => same(t.scope,scope)).reduce((sum,t) => sum+t.sends.length,0));
  }

  async usage(scope: V4Scope, reservePerCall: Required<Usage>) {
    return this.edit(d => {
      const totals = {calls:0,tokens:0,costUsd:0};
      for (const task of d.tasks) {
        if (!same(task.scope,scope)) continue;
        for (const send of task.sends) {
          totals.calls++;
          totals.tokens += send.usage?.tokens ?? reservePerCall.tokens;
          totals.costUsd += send.usage?.costUsd ?? reservePerCall.costUsd;
        }
      }
      return totals;
    });
  }

  async submitReport(report:ReportEvidenceV45,nativeHandoff?:'native-handoff-v1',modelDirectedKnowledge?:true,refutationEvidence?:true,domainAdmission?:true,scientificMapWrites?:true,mapNodeWriting?:'structured-map-v2',contextCompaction?:PostReportStudyV45['contextCompaction']){
    const study=reportStudyV45(report);if(contextCompaction)study.contextCompaction=contextCompaction;if(scientificMapWrites)study.scientificMapWrites=true;if(mapNodeWriting)study.mapNodeWriting=mapNodeWriting;if(domainAdmission)study.domainAdmission=true;if(refutationEvidence)study.refutationEvidence=true;if(modelDirectedKnowledge)study.modelDirectedKnowledge=true;if(nativeHandoff)study.nativeHandoff=nativeHandoff;
    return this.edit(d=>{d.postReports??=[];const old=d.postReports.find(s=>s.id===study.id);if(old)return structuredClone(old);d.postReports.push(study);return structuredClone(study);});
  }
  async queueArchiveReview(report:ReportEvidenceV45,assessment:import('../../../learning/report-assessment.js').ReportUpdate){
    const created=await this.edit(d=>{
      const base=d.postReports?.find(s=>s.id===reportStudyV45(report).id&&s.domainAdmission);
      if(!base||base.report.bodyHash!==assessment.bodyHash||!same(base.report.scope,assessment)||base.report.artifactId!==assessment.artifactId||assessment.status!=='pending')throw Error('Archive review target is outside its original report');
      const id=assessment.id+'_review';if(d.postReports!.some(s=>s.id===id))return false;
      d.postReports!.push({...reportStudyV45(base.report),id,domainAdmission:true,contextCompaction:base.contextCompaction,modelDirectedKnowledge:base.modelDirectedKnowledge,refutationEvidence:base.refutationEvidence,nativeHandoff:base.nativeHandoff,phase:'review',archiveReview:structuredClone(assessment)});
      return true;
    });
    if(created)await this.wakeReport(report.scope);
  }
  async supplementReport(scope:V4Scope,artifactId:string,body:string){
    await this.edit(d=>{for(const s of d.postReports??[])if(same(s.report.scope,scope)){
      s.report.supplements??=[];
      if(!s.report.supplements.some(x=>x.artifactId===artifactId))s.report.supplements.push({artifactId,body,status:'unassessed'});
    }});
  }
  private readonly activeReports=new Map<string,string>();
  hasActiveReport(projectId:string){return [...this.activeReports.values()].includes(projectId); }
  async runReport(scope:V4Scope,invoke:(study:PostReportStudyV45,journal:{nativeHandoff?:NativeHandoffPort;onDispatch:()=>Promise<void>;onUsage:(usage:Usage)=>Promise<void>})=>Promise<ResearchReplyV45>,authorize:(report:ReportEvidenceV45,review?:PostReportStudyV45['archiveReview'])=>Promise<boolean>,signal?:AbortSignal,sources:ReportEvidenceV45[]=[],exposedSources:ReportEvidenceV45[]=[],authorizeKnowledge?:(study:PostReportStudyV45)=>Promise<void>,resolveReply?:(study:PostReportStudyV45,reply:ResearchReplyV45)=>Promise<ResearchReplyV45>){
    const scopeKey=key(scope);if(this.activeReports.has(scopeKey)||signal?.aborted)return false;
    this.activeReports.set(scopeKey,scope.projectId);
    let task:PostReportStudyV45|undefined;
    try{
      task=await this.edit(d=>{const s=d.postReports?.find(s=>same(s.report.scope,scope)&&s.status==='ready');if(s){s.status='sending';s.attemptSent=false;if(!s.receipt&&!s.nativeReply?.original)s.availableSources=structuredClone(sources.filter(r=>r.artifactId!==s.report.artifactId));return structuredClone(s);}return undefined;});
      if(!task)return false;
      if(!task.receipt&&!task.nativeReply?.original){
        const related=task.report.related??=[];
        for(const source of exposedSources)if(source.artifactId!==task.report.artifactId&&!related.some(r=>r.artifactId===source.artifactId&&r.scope.projectId===source.scope.projectId))related.push(structuredClone(source));
      }
      if(!await authorize(task.report,task.archiveReview)||signal?.aborted){await this.edit(d=>{const s=d.postReports!.find(s=>s.id===task!.id)!;s.status='stopped';s.error='Source unavailable or cancelled';});return !signal?.aborted;}
      const resolve=async(raw:ResearchReplyV45):Promise<ResearchReplyV45>=>{
        if(raw.action!=='read-batch')return resolveReply?resolveReply(task!,raw):raw;
        const calls=raw.readCalls??[],hash=stableHash(calls);if(!raw.readBatchId||!calls.length||calls.some(c=>!(task!.contextCompaction&&c.request.action==='read-context-page')&&!['lookup-map','open-map','refresh-map','query-knowledge','open-knowledge','read'].includes(c.request.action)))throw Error('Invalid native read batch');
        if(task!.readBatch?.id!==raw.readBatchId)task!.readBatch={id:raw.readBatchId,hash,cursor:0,results:[]};
        const batch=task!.readBatch;if(batch.hash!==hash)throw Error('Changed native read batch');
        // Bind every route selector to what was actually exposed before this provider call.
        const bindings=calls.map(c=>{if(c.request.action!=='open-knowledge')return;try{return authorizeKnowledgeRead(task!.knowledge!,c.request.selection??0);}catch(error){if(!task!.modelDirectedKnowledge)throw error;return null;}});
        for(;batch.cursor<calls.length;){
          if(signal?.aborted)throw Error('Research cancelled');const item=calls[batch.cursor]!,request=item.request;
          if(bindings[batch.cursor]&&knowledgeRefKey(authorizeKnowledgeRead(task!.knowledge!,request.selection??0))!==knowledgeRefKey(bindings[batch.cursor]!))throw Error('Native read selector changed');
          if(request.action==='read'){const source=task!.availableSources?.[(request.selection??0)-1];if(!source||!await authorize(source))throw Error('Selected source withdrawn');}
          const resolved=bindings[batch.cursor]===null?{...request,knowledge:{...task!.knowledge!,lastRead:undefined,readNotice:'Choose a route displayed before this native batch.'}}:resolveReply?await resolveReply(task!,request):request;
          const result=resolved.knowledge?.readNotice?{readNotice:resolved.knowledge.readNotice}:resolved.mapRead?.result??(request.action==='query-knowledge'?resolved.knowledge?.selection:request.action==='open-knowledge'?resolved.knowledge?.opened.find(o=>knowledgeRefKey(o.ref)===knowledgeRefKey(bindings[batch.cursor]!)):request.action==='read'?task!.availableSources?.[(request.selection??0)-1]:undefined);
          applyResearchReplyV45(task!,resolved);batch.results.push({toolCallId:item.toolCallId,request:structuredClone(request),result:structuredClone(result),...(resolved.mapRead?{mapRead:resolved.mapRead}:{})});batch.cursor++;task!.receipt=raw;task!.status='sending';
          await this.edit(d=>{const current=d.postReports!.find(x=>x.id===task!.id)!;if(current.status==='stopped'||signal?.aborted)throw Error('Research cancelled');const {nativeReply:_raw,nativeReplies:_history,sends:_sends,attemptSent:_sent,...progress}=structuredClone(task!);Object.assign(current,progress);});
        }
        task!.currentReadResults=batch.results.map(r=>({toolCallId:r.toolCallId,result:r.result}));
        return {...raw,body:'Native reads completed'};
      };
      if(task.receipt){
        const resolved=await resolve(task.receipt);task.receipt=resolved;
        const replay=structuredClone(task);applyResearchReplyV45(replay,resolved);await authorizeKnowledge?.(replay);
        if(task.receipt.action==='read'&&!await authorize(task.availableSources![(task.receipt.selection??0)-1]!)){await this.edit(d=>{d.postReports!.find(s=>s.id===task!.id)!.status='stopped';});return false;}
        return this.edit(d=>{const s=d.postReports!.find(s=>s.id===task!.id)!;s.receipt=structuredClone(task!.receipt!);if(s.status==='stopped'||signal?.aborted){s.status='stopped';return false;}applyResearchReplyV45(s,s.receipt!);archiveNativeReply(s);return true;});
      }
      const id=task.id;let sent=false,received=false;
      if(task.nativeHandoff&&!task.nativeReply){task.nativeReply={callId:task.id+'_native_'+randomUUID()};await this.edit(d=>{const s=d.postReports!.find(s=>s.id===id)!;if(s.status!=='sending'||signal?.aborted)throw Error('Research cancelled');s.nativeReply=structuredClone(task!.nativeReply);});}
      try{
        const rawReply=await invoke(task,{
          ...(task.nativeHandoff?{nativeHandoff:{version:task.nativeHandoff,state:task.nativeReply,save:async(state:NativeHandoffState)=>{await this.edit(d=>{const s=d.postReports!.find(s=>s.id===id)!;s.nativeReply=retainNativeReply(s.nativeReply,state);});task!.nativeReply=structuredClone(state);}}}:{}),
          onDispatch:async()=>{if(signal?.aborted)throw Error('Research cancelled before dispatch');await this.edit(d=>{const s=d.postReports!.find(s=>s.id===id)!;s.report.related=structuredClone(task!.report.related);if(task!.knowledge)s.knowledge=structuredClone(task!.knowledge);if(task!.map)s.map=structuredClone(task!.map);s.attemptSent=true;s.sends.push({at:new Date().toISOString()});});sent=true;},
          onUsage:async usage=>{await this.edit(d=>{const last=d.postReports!.find(s=>s.id===id)!.sends.at(-1);if(last)last.usage=usage;});},
        });
        received=true;
        await this.edit(d=>{d.postReports!.find(s=>s.id===id)!.receipt=structuredClone(rawReply);});
        signal?.throwIfAborted();
        const reply=await resolve(rawReply);
        const checked=structuredClone(task);applyResearchReplyV45(checked,reply);await authorizeKnowledge?.(checked);
        if(reply.action==='read'&&!await authorize(task.availableSources![(reply.selection??0)-1]!))throw Error('Selected source withdrawn');
        await this.edit(d=>{d.postReports!.find(s=>s.id===id)!.receipt=structuredClone(reply);});
        await authorizeKnowledge?.(checked);
        const valid=await authorize(task.report,task.archiveReview);
        await this.edit(d=>{const s=d.postReports!.find(s=>s.id===id)!;if(!valid||signal?.aborted){s.status='stopped';return;}applyResearchReplyV45(s,s.receipt!);archiveNativeReply(s);});
        return true;
      }catch(error){
        await this.edit(d=>{const s=d.postReports!.find(s=>s.id===id)!;if(s.status==='stopped'||signal?.aborted){s.status='stopped';return;}if(s.receipt){s.status='ready';s.error='Retained result needs reconciliation: '+(error instanceof Error?error.message:'unavailable result');}else{s.status=s.nativeReply?.repairSent&&!s.nativeReply.repair||sent&&!received&&!s.sends.at(-1)?.usage&&!nativeReplyReceived(s.nativeReply)?'uncertain':'failed';s.error=error instanceof Error?error.message:'Research unavailable';}});return false;
      }
    }catch(error){
      if(task)await this.edit(d=>{const s=d.postReports!.find(s=>s.id===task!.id)!;if(s.status==='sending'){s.status=s.receipt?'ready':s.attemptSent?'uncertain':'ready';s.error=error instanceof Error?error.message:'Research source unavailable';}});
      return false;
    }finally{this.activeReports.delete(scopeKey);}
  }
  async finishedMaintenanceReferrals(projectId:string){
    return this.edit(data=>[
      ...(data.postReports??[]).filter(s=>s.report.scope.projectId===projectId&&s.maintenanceReferral&&['completed','failed','stopped'].includes(s.status))
        .map(s=>({id:s.id,origin:'Theory research',epochId:s.report.scope.epochId})),
      ...(data.mapTasks??[]).filter(t=>t.projectId===projectId&&t.maintenanceReferral&&['completed','failed','stopped'].includes(t.status))
        .map(t=>({id:t.id,origin:'Knowledge map review'}))
    ]);
  }
  async researchReports(projectId?:string){return this.edit(d=>structuredClone((d.postReports??[]).filter(s=>!projectId||s.report.scope.projectId===projectId)));}
  async retryReport(projectId:string,id:string,requestId:string){return this.edit(d=>{
    const study=d.postReports?.find(s=>s.id===id&&s.report.scope.projectId===projectId);
    if(!study)throw new MapError('NOT_FOUND','Research study not found in this project');
    if(!requestId.trim())throw new MapError('INVALID_INPUT','Retry request identity required');
    if(study.retryRequests?.includes(requestId))return structuredClone(study);
    if(!['failed','stopped'].includes(study.status)||this.activeReports.has(key(study.report.scope))||study.attemptSent&&!study.receipt&&!study.sends.at(-1)?.usage&&!nativeReplyReceived(study.nativeReply))throw new MapError('CONFLICT','Only a settled failed or stopped research study can be retried; uncertain sends require settlement');
    study.retryRequests??=[];study.retryRequests.push(requestId);study.status='ready';study.attemptSent=false;delete study.error;
    return structuredClone(study);
  });}
  async snapshot(scope: V4Scope) {
    return this.edit(data => ({
      postReports:structuredClone((data.postReports??[]).filter(s=>same(s.report.scope,scope))),
      credits:data.credits, remainder:data.remainder, closed:data.closed.includes(key(scope)),
      stageCount:data.stages.filter(s => same(s.scope,scope)).length, service:data.service?.[key(scope)],
      tasks:data.tasks.filter(t => same(t.scope,scope)).map(({id,ids,mode,status,purpose,error,revision,research,research3,research4,recordId,predecessor,readReceipts,archiveOnly,cancelled,settlement,sends}) =>
        ({id,stageIds:ids,mode,status,purpose,error,revision,research,research3,research4,recordId,predecessor,readReceipts,archiveOnly,unresolvedSend:status==='uncertain'||!!cancelled&&!settlement&&sends.some(s=>!s.usage)})),
    }));
  }

  async runNext(scope: V4Scope, invoke: Provider, options: {
    revision?:'v4-operation-1'|'v4-operation-2'|'v4-operation-3'|'v4-operation-4'; rootContext?:RootContextV43; preciseDispatch?: boolean; sharedTheories?: V4SharedTheories;
    signal?: AbortSignal; authorize: V4Authorize; admit?: (purpose: Purpose) => boolean | Promise<boolean>;
  }) {
    if(options.signal?.aborted)return;
    if(options.revision==='v4-operation-4')return this.queueRevision2(scope,()=>this.runNextRevision4(scope,invoke,options));
    if(options.revision==='v4-operation-3')return this.queueRevision2(scope,()=>this.runNextRevision3(scope,invoke,options));
    if(options.revision==='v4-operation-2')return this.queueRevision2(scope,()=>this.runNextRevision2(scope,invoke,options));
    if (this.active || this.pumping) return;
    this.active = true;
    try {
      const {rows,watches} = await this.edit(data => {
        const cutoff = freezeHistory(data,scope);
        return {
          rows:data.stages.filter((s,i) => same(s.scope,scope) || i < cutoff.stages),
          watches:data.tasks.filter(t => t.status === 'completed' && t.state.phase === 'closed'
            && t.state.assessment.decision === 'watch' && (same(t.scope,scope) || cutoff.watches.includes(t.id)))
            .map(task => ({task,...sourceClosure(data,task)})),
        };
      });
      const permitted: Stage[] = [];
      for (const row of rows) if (await options.authorize(row.stage,row.scope)) permitted.push(row);
      const visibleWatches = await this.granted(watches,options.authorize,options.sharedTheories);
      const task = await this.edit(data => {
        if (data.closed.includes(key(scope)) || data.tasks.some(t => t.status === 'uncertain'||t.cancelled&&!t.settlement&&t.sends.some(s=>!s.usage))) return;
        const tasks = data.tasks.filter(t => same(t.scope,scope) && !t.revision);
        const ready = tasks.find(t => t.status === 'ready');
        if (ready) return ready;
        if (!data.credits) return;
        const spent = new Set(tasks.filter(t => t.purpose).flatMap(t => t.fresh));
        const usedProducers = new Set(rows.filter(s => same(s.scope,scope) && spent.has(s.stage.stageId)).map(s => s.producerId));
        const pending = permitted.filter(s => same(s.scope,scope) && !usedProducers.has(s.producerId));
        if (!pending.length) return;
        const fresh = pending.filter((s,i) => pending.findIndex(p => p.producerId === s.producerId) === i).slice(0,4);
        const history = permitted.filter(s => !same(s.scope,scope) || usedProducers.has(s.producerId));
        const last = tasks.filter(t => t.purpose).at(-1);
        const blind = last?.mode === 'directed' && history.length > 0;
        const ordinary = fresh.length >= 4 || pending.some(s => s.handover);
        let watch: Watch | undefined;
        let selected = [...fresh];
        // A watch wake-up requires both its exact observable key and all of its original anchors.
        if (!(ordinary && blind)) {
          for (const prior of visibleWatches) {
            if (prior.state.phase !== 'closed' || prior.state.assessment.decision !== 'watch') continue;
            const {signal,reason} = prior.state.assessment;
            const hit = pending.find(s => s.watchKeys?.includes(signal));
            if (!hit) continue;
            const anchors = stageRefs(prior).map(ref => history.find(s => same(s.scope,ref.scope) && s.stage.stageId === ref.stageId));
            if (anchors.length > 5 || !anchors.every((s): s is Stage => !!s)) continue;
            selected = [hit,...anchors];
            watch = {trialId:prior.id,signal,reason,anchorStageIds:[]};
            break;
          }
        }
        if (!ordinary && !watch) return;
        const seed = key(scope) + ':' + tasks.length;
        const score = (s:Stage) => createHash('sha256').update(seed+key(s.scope)+s.stage.stageId).digest('hex');
        if (!watch) {
          if (blind) history.sort((a,b) => score(a).localeCompare(score(b)));
          else history.reverse();
          const seen = new Set(selected.map(s => s.producerId));
          const companions = history.filter(s => !seen.has(s.producerId) && !!seen.add(s.producerId));
          selected.push(...companions.slice(0,2));
        }
        const ids = selected.map((s,i) => same(s.scope,scope) ? s.stage.stageId : 'history:'+i+':'+s.stage.stageId);
        if (new Set(ids).size !== ids.length) return;
        if (watch) watch.anchorStageIds = ids.slice(1);
        const record: Task = {id:randomUUID(),scope,ids,sources:selected.map(s=>({scope:s.scope,stageId:s.stage.stageId})),
          fresh:selected.filter(s => pending.includes(s)).map(s=>s.stage.stageId),watch,
          mode:blind && !watch?'blind':'directed',status:'ready',state:{phase:'screen'},sends:[],knownRefs:[]};
        data.tasks.push(record);
        return record;
      });
      if (!task) return;
      const selected = stageRefs(task).map(ref => permitted.find(s => same(s.scope,ref.scope) && s.stage.stageId === ref.stageId));
      if (!selected.every((s): s is Stage => !!s) || task.watch && !visibleWatches.some(w => w.id === task.watch!.trialId)) {
        await this.edit(d => {d.tasks.find(t => t.id === task.id)!.status='stopped';});
        return;
      }
      const packet = selected.map((s,i) => same(s.scope,scope) ? s.stage : {...s.stage,
        stageId:task.ids[i], branch:JSON.stringify({...s.scope,branch:s.stage.branch})});
      let physical = false;
      let invalidResponse = false;
      let step = 0;
      const accepted = acceptedResponses(task.state);
      const local = (await this.listKnownTheories(scope,options.authorize,options.sharedTheories)).filter(t => Buffer.byteLength(JSON.stringify(t)) <= 8192);
      const shared = (await options.sharedTheories?.() ?? []).filter(t => t.id && t.authority === 'proof-backed' && Buffer.byteLength(JSON.stringify(t)) <= 8192);
      const known = local.filter(t => !shared.some(s => s.id === t.id)).slice(shared.length ? -1 : -2);
      const publicCards = shared.slice(known.length ? -1 : -2);
      const publicRefs = publicCards.map(sharedRef);
      try {
        const state = await runTheoryTrial(packet,async (purpose,stages,previous) => {
          const index = step++;
          if (index < accepted.length) return accepted[index];
          if (options.signal?.aborted || await this.edit(d => d.closed.includes(key(scope)))) throw new Error('V4 scope closed');
          let dispatched = false;
          const journal: V4DispatchJournal = {
            watch:task.watch, knownTheories:[...known,...publicCards].map(t => JSON.stringify(t)),
            onDispatch: async () => {
              if (dispatched) throw new Error('Duplicate V4 dispatch');
              dispatched = true;
              const closure = await this.edit(d => sourceClosure(d,d.tasks.find(t => t.id === task.id)!));
              if (!closure.stages.length) throw new Error('Missing V4 source');
              for (const row of closure.stages) {
                if (!await options.authorize(row.stage,row.scope)) throw new Error('V4 stage grant withdrawn');
              }
              if (options.signal?.aborted || options.admit && !await options.admit(purpose)) throw new Error('V4 admission deferred');
              const available = await this.listKnownTheories(scope,options.authorize,options.sharedTheories);
              const needed = [...closure.sharedRefs,...publicRefs];
              if (needed.length && !allSharedGranted(needed,await options.sharedTheories?.() ?? [])) throw new Error('Shared V4 revision withdrawn');
              if ([...task.knownRefs,...known.map(t=>t.id)].some(id => !available.some(t => t.id === id))) {
                throw new Error('V4 theory source withdrawn');
              }
              const sent = await this.edit(data => {
                if (options.signal?.aborted || data.closed.includes(key(scope))) return false;
                if (purpose === 'assess') {
                  if (!data.credits) return false;
                  data.credits--;
                }
                const stored = data.tasks.find(t => t.id === task.id)!;
                stored.knownRefs = [...new Set([...stored.knownRefs,...known.map(t=>t.id)])];
                stored.sharedRefs = [...new Map([...(stored.sharedRefs ?? []),...publicRefs].map(ref => [ref.hash,ref])).values()];
                stored.status='sending'; stored.purpose=purpose; stored.sends.push({purpose,sentAt:new Date().toISOString()});
                return true;
              });
              if (!sent) throw new Error('V4 admission deferred');
              physical = true;
            },
            onUsage: async (metrics = {}) => {
              if (!physical) throw new Error('Missing V4 dispatch intent');
              await this.edit(d => {
                const send = d.tasks.find(t => t.id === task.id)!.sends.at(-1)!;
                const receipt: Usage = {};
                if (metrics.tokens !== undefined && Number.isSafeInteger(metrics.tokens) && metrics.tokens >= 0) receipt.tokens=metrics.tokens;
                if (metrics.costUsd !== undefined && Number.isFinite(metrics.costUsd) && metrics.costUsd >= 0) receipt.costUsd=metrics.costUsd;
                send.usage ??= receipt;
              });
            },
          };
          if (!options.preciseDispatch) await journal.onDispatch();
          const response = await invoke(purpose,stages,previous,journal);
          if (!physical) throw new Error('Missing V4 dispatch intent');
          physical = false;
          invalidResponse = true;
          const responses = [...accepted,response];
          const state = replayTheoryTrial(task.ids,responses);
          if (state.phase === 'closed' && state.assessment.decision === 'reuse') {
            const ref = state.assessment.theoryRef;
            if (![...known,...publicCards].some(t => t.id === ref)) throw new Error('V4 theory was not granted');
          }
          invalidResponse = false;
          await this.edit(d => {
            const stored = d.tasks.find(t => t.id === task.id)!;
            stored.state=state; delete stored.error;
            if (options.signal?.aborted || d.closed.includes(key(scope))) stored.status='stopped';
            else stored.status = state.phase === 'closed' || state.phase === 'reviewed' ? 'completed' : 'ready';
          });
          accepted.push(response);
          return response;
        });
        return state;
      } catch (err) {
        await this.edit(d => {
          const stored = d.tasks.find(t => t.id === task.id)!;
          // A durable intent with no settled response can have reached the provider.
          if (physical || stored.status === 'sending' && !invalidResponse) stored.status = stored.sends.at(-1)?.usage ? 'failed' : 'uncertain';
          else if (invalidResponse) stored.status='failed';
          else if (options.signal?.aborted || d.closed.includes(key(scope))) stored.status='stopped';
          stored.error = err instanceof Error ? err.message : 'V4 trial interrupted';
        });
        return;
      }
    } finally { this.active=false; void this.serviceWindows(); }
  }

  private async queueRevision2(scope:V4Scope,run:()=>Promise<unknown>) {
    await this.edit(d=>{(d.waiting??={})[key(scope)]??={since:new Date().toISOString()};});
    return new Promise<unknown>((resolve,reject)=>{this.windows.push({scope,run,resolve,reject});void this.serviceWindows();});
  }
  private async serviceWindows() {
    if(this.pumping||this.active)return;
    this.pumping=true;
    try {
      while(this.windows.length){
        // Only live requested windows compete. A dormant root retains its age without blocking service.
        const order=await this.edit(d=>this.windows.map(w=>({id:key(w.scope),since:d.waiting?.[key(w.scope)]?.since??''})).sort((a,b)=>a.since.localeCompare(b.since)||a.id.localeCompare(b.id)));
        const index=this.windows.findIndex(w=>key(w.scope)===order[0].id);
        const [window]=this.windows.splice(index,1);
        try {
          const result=await window.run();
          await this.edit(d=>{if(['unit-admitted','unit-failed'].includes(d.service?.[key(window.scope)]?.outcome??'')){const now=new Date().toISOString();(d.waiting??={})[key(window.scope)]={since:now,lastServed:now};}});
          window.resolve(result);
        }catch(error){window.reject(error);}
      }
    }catch(error){for(const window of this.windows.splice(0))window.reject(error);}
    finally{this.pumping=false;}
  }

  private async runNextRevision2(scope:V4Scope, invoke:Provider, options:{preciseDispatch?:boolean;sharedTheories?:V4SharedTheories;signal?:AbortSignal;authorize:V4Authorize;admit?:(purpose:Purpose)=>boolean|Promise<boolean>}) {
    this.active=true;
    let task:Task|undefined, sent=false, received=false;
    try {
      const rows=await this.edit(d=>{const cutoff=freezeHistory(d,scope);return d.stages.filter((s,i)=>same(s.scope,scope)||i<cutoff.stages);});
      const permitted:Stage[]=[];
      for(const row of rows)if(row.stage.fragment&&row.stage.environments&&row.stage.rootId===row.scope.rootId&&await options.authorize(row.stage,row.scope))permitted.push(row);
      const contextRows=await this.edit(d=>{const cutoff=freezeHistory(d,scope);return d.tasks.filter(t=>t.revision==='v4-operation-2'&&t.status==='completed'&&(same(t.scope,scope)||cutoff.research?.includes(t.id))).map(task=>({task,...sourceClosure(d,task)}));});
      const contexts=(await this.granted(contextRows,options.authorize,options.sharedTheories)).filter(t=>Buffer.byteLength(JSON.stringify(t.research))<=8192);
      const cards=(await options.sharedTheories?.()??[]).filter(c=>Buffer.byteLength(JSON.stringify(c))<=8192).slice(-2);
      task=await this.edit(d=>{
        const note=(outcome:string)=>{(d.service??={})[key(scope)]={outcome,at:new Date().toISOString()};};
        note('no-eligible-packet');
        if(d.tasks.some(t=>t.status==='uncertain'||t.cancelled&&!t.settlement&&t.sends.some(s=>!s.usage))){note('uncertain-dispatch');return;}
        const own=d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-2');
        const ready=own.find(t=>t.status==='ready'&&(!d.closed.includes(key(scope))||t.archiveOnly));
        if(ready)return structuredClone(ready);
        if(d.closed.includes(key(scope))){note('root-closed');return;}
        if(!d.credits){note('no-credit');return;}
        if(own.reduce((n,t)=>n+t.sends.length,0)>=8){note('service-allowance-exhausted');return;}
        const used=new Set(own.filter(t=>t.sends.length).flatMap(t=>t.fresh));
        const needed=new Set(own.flatMap(t=>t.research?.assessment?.decision==='read-needed'?t.research.assessment.fragmentRefs:[]));
        const fresh=permitted.filter(s=>same(s.scope,scope)&&(!used.has(s.stage.stageId)||needed.has(s.stage.stageId)&&!own.some(t=>t.sends.length&&t.ids.includes(s.stage.stageId)&&t.research?.assessment?.decision!=='read-needed')));
        if(!fresh.length)return;
        const selectedContexts=contexts.filter(t=>t.research?.assessment?.decision!=='watch'||fresh.some(s=>s.watchKeys?.includes(t.research!.assessment!.decision==='watch'?t.research!.assessment!.signal:''))).slice(-2);
        const watchContext=selectedContexts.find(t=>t.research?.assessment?.decision==='watch');
        const anchors=watchContext?contextRows.find(r=>r.task.id===watchContext.id)!.stages:[];
        if(anchors.length>5||anchors.some(a=>!permitted.some(s=>same(s.scope,a.scope)&&s.stage.stageId===a.stage.stageId)))return;
        const last=own.filter(t=>t.sends.length).at(-1);
        const history=permitted.filter(s=>!fresh.includes(s));
        const blind=last?.mode==='directed'&&history.length>0;
        const seed=key(scope)+':'+own.length;
        if(blind)history.sort((a,b)=>stableHash(seed+a.stage.stageId).localeCompare(stableHash(seed+b.stage.stageId)));
        else history.reverse();
        const watchSignal=watchContext?.research?.assessment?.decision==='watch'?watchContext.research.assessment.signal:undefined;
        const hit=watchSignal?fresh.find(s=>s.watchKeys?.includes(watchSignal)):undefined;
        const anchorRows=anchors.map(a=>permitted.find(s=>same(s.scope,a.scope)&&s.stage.stageId===a.stage.stageId)!);
        const minimum=hit?1+anchorRows.length:1;
        let seeds=hit?[hit,...anchorRows,...fresh.filter(s=>s!==hit&&!anchorRows.includes(s)).slice(0,5-anchorRows.length)]:[...fresh.slice(0,4),...history.slice(0,2)],selected:Stage[]=[];
        const close=(seed:Stage[])=>{
          const complete=[...seed];
          for(let i=0;i<complete.length;i++)for(const dep of complete[i].stage.dependencies??[]){
            if(complete.some(s=>same(s.scope,complete[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep)))continue;
            const premise=permitted.find(s=>same(s.scope,complete[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep));
            if(!premise||complete.length>=6)return;
            complete.push(premise);
          }
          if(Buffer.byteLength(JSON.stringify(complete.map(s=>s.stage)))>32768)return;
          return complete;
        };
        // Prefer a smaller complete packet over an incomplete large one.
        while(seeds.length>=minimum){const complete=close(seeds);if(complete){selected=complete;break;}seeds=seeds.slice(0,-1);}
        if(!selected.length){note('pending-evidence-or-packet-cap');return;}
        const achievedBlind=blind&&seeds.some(s=>history.includes(s));
        const manifest=stableHash({sources:selected.map(s=>({scope:s.scope,stage:s.stage})).sort((a,b)=>stableHash(a).localeCompare(stableHash(b))),cards:cards.map(sharedRef).sort((a,b)=>a.id.localeCompare(b.id)),research:selectedContexts.map(t=>({id:t.id,state:t.research}))});
        if(own.some(t=>t.manifest===manifest&&t.sends.length))return;
        const record:Task={id:randomUUID(),scope,revision:'v4-operation-2',research:{phase:'assess',responses:[]},manifest,
          ids:selected.map(s=>s.stage.stageId),sources:selected.map(s=>({scope:s.scope,stageId:s.stage.stageId})),
          fresh:selected.filter(s=>fresh.includes(s)).map(s=>s.stage.stageId),mode:achievedBlind?'blind':'directed',status:'ready',state:{phase:'screen'},sends:[],knownRefs:selectedContexts.map(t=>t.id),watch:watchContext&&watchSignal?{trialId:watchContext.id,signal:watchSignal,reason:watchContext.research!.assessment!.decision==='watch'?watchContext.research!.assessment!.reason:'',anchorStageIds:anchorRows.map(s=>s.stage.stageId)}:undefined,sharedRefs:cards.map(sharedRef)};
        d.tasks.push(record);return structuredClone(record);
      });
      if(!task)return;
      const selected=stageRefs(task).map(ref=>permitted.find(s=>same(s.scope,ref.scope)&&s.stage.stageId===ref.stageId));
      if(!selected.every((s):s is Stage=>!!s)||!allSharedGranted(task.sharedRefs??[],cards))throw new Error('V4 research support withdrawn');
      const packet=selected.map(s=>s.stage);
      const purpose=task.research!.phase;
      if(purpose==='closed')return;
      // Archive-only research retains its claim; it never constructs an application to a closed root.
      if(task.archiveOnly&&purpose==='instantiate'){
        await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.status='completed';t.research!.phase='closed';});return;
      }
      const frozenContexts=task.knownRefs.map(id=>contexts.find(t=>t.id===id));
      if(!frozenContexts.every((t):t is Task=>!!t))throw new Error('V4 prior research withdrawn');
      const journal:V4DispatchJournal={revision:'v4-operation-2',watch:task.watch,knownTheories:[...cards.map(c=>JSON.stringify(c)),...frozenContexts.map(t=>JSON.stringify({id:t.id,authority:'research-context',scope:t.scope,research:t.research}))],
        onDispatch:async()=>{
          if(sent)throw new Error('Duplicate V4 dispatch');
          const closure=await this.edit(d=>sourceClosure(d,d.tasks.find(t=>t.id===task!.id)!));
          if(!closure.stages.length)throw new Error('V4 source grant missing');
          for(const row of closure.stages)if(!await options.authorize(row.stage,row.scope))throw new Error('V4 source grant withdrawn');
          if(!allSharedGranted(closure.sharedRefs,await options.sharedTheories?.()??[]))throw new Error('V4 prior theory grant withdrawn');
          if(options.signal?.aborted||options.admit&&!await options.admit(purpose))throw new Error('V4 admission deferred');
          if(!allSharedGranted(task!.sharedRefs??[],await options.sharedTheories?.()??[]))throw new Error('V4 theory grant withdrawn');
          await this.edit(d=>{
            const t=d.tasks.find(t=>t.id===task!.id)!;
            if(t.cancelled||t.status!=='ready'||options.signal?.aborted||d.closed.includes(key(scope))&&!t.archiveOnly)throw new Error('V4 scope closed');
            if(t.sends.length>=4||d.tasks.filter(row=>same(row.scope,scope)&&row.revision==='v4-operation-2').reduce((n,row)=>n+row.sends.length,0)>=8)throw new Error('V4 theory allowance exhausted');
            if(purpose==='assess'){if(!d.credits)throw new Error('V4 credit unavailable');d.credits--;}
            t.status='sending';t.purpose=purpose;t.sends.push({purpose,sentAt:new Date().toISOString()});
            (d.service??={})[key(scope)]={outcome:'unit-admitted',at:new Date().toISOString()};
          });sent=true;
        },
        onUsage:async(usage={})=>{
          if(!sent)throw new Error('Missing V4 dispatch intent');
          await this.edit(d=>{const send=d.tasks.find(t=>t.id===task!.id)!.sends.at(-1)!;
            send.usage={...(Number.isSafeInteger(usage.tokens)&&usage.tokens!>=0?{tokens:usage.tokens}:{}),...(Number.isFinite(usage.costUsd)&&usage.costUsd!>=0?{costUsd:usage.costUsd}:{})};});
        }};
      if(!options.preciseDispatch)await journal.onDispatch();
      const response=await invoke(purpose,packet,task.research!,journal);
      if(!sent)throw new Error('Missing V4 dispatch intent');
      received=true;
      const next=advanceResearchV42(task.research!,response,packet);
      if([...(next.candidate?.theoryRefs??[]),...(next.challenge?.theoryRefs??[])].some(id=>![...cards,...frozenContexts].some(c=>c.id===id)))throw new Error('Theory premise was not exposed');
      const reuseRef=next.assessment?.decision==='reuse'?next.assessment.theoryRef:undefined;
      if(reuseRef&&![...cards,...frozenContexts].some(c=>c.id===reuseRef))throw new Error('Reuse theory was not exposed');
      await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.research=next;delete t.error;
        t.status=options.signal?.aborted||t.cancelled?'stopped':next.phase==='closed'?'completed':'ready';
        if(d.closed.includes(key(scope))&&!t.archiveOnly)t.status='stopped';
      });
      return next;
    }catch(error){
      if(task)await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;
        if(sent)t.status=t.cancelled&&received?'stopped':received||t.sends.at(-1)?.usage?'failed':'uncertain';
        else if(options.signal?.aborted)t.status='stopped';
        t.error=error instanceof Error?error.message:'V4 unit failed';
        (d.service??={})[key(scope)]={outcome:sent?'unit-failed':'resource-or-authority-deferred',at:new Date().toISOString()};
      });
    }finally{this.active=false;}
  }

  private async runNextRevision3(scope:V4Scope, invoke:Provider, options:{rootContext?:RootContextV43;preciseDispatch?:boolean;sharedTheories?:V4SharedTheories;signal?:AbortSignal;authorize:V4Authorize;admit?:(purpose:Purpose)=>boolean|Promise<boolean>}) {
    this.active=true;
    let task:Task|undefined,sent=false,received=false;
    try {
      const rows=await this.edit(d=>{const cutoff=freezeHistory(d,scope);return d.stages.filter((s,i)=>same(s.scope,scope)||i<cutoff.stages);});
      const permitted:Stage[]=[];
      for(const row of rows)if(row.stage.fragment&&row.stage.environments&&row.stage.rootId===row.scope.rootId&&await options.authorize(row.stage,row.scope))permitted.push(row);
      const watchRows=await this.edit(d=>{const cutoff=freezeHistory(d,scope);return d.tasks.filter(t=>t.revision==='v4-operation-3'&&t.status==='completed'&&t.research3?.assessment?.decision==='watch'&&(same(t.scope,scope)||cutoff.research?.includes(t.id))).map(task=>({task,...sourceClosure(d,task)}));});
      const watches=await this.granted(watchRows,options.authorize,options.sharedTheories);
      const cards=(await options.sharedTheories?.()??[]).filter(c=>Buffer.byteLength(JSON.stringify(c))<=8192);
      task=await this.edit(d=>{
        const note=(outcome:string)=>{(d.service??={})[key(scope)]={outcome,at:new Date().toISOString()};};
        note('no-eligible-packet');
        if(d.tasks.some(t=>t.status==='uncertain'||t.cancelled&&!t.settlement&&t.sends.some(s=>!s.usage))){note('uncertain-dispatch');return;}
        const own=d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-3');
        const ready=own.find(t=>t.status==='ready'&&(!d.closed.includes(key(scope))||t.archiveOnly));
        if(ready)return structuredClone(ready);
        if(d.closed.includes(key(scope))){note('root-closed');return;}
        if(!d.credits){note('no-credit');return;}
        if(own.reduce((n,t)=>n+t.sends.length,0)>=8){note('service-allowance-exhausted');return;}
        if(!options.rootContext){note('missing-root-context');return;}
        const used=new Set(own.filter(t=>t.sends.length).flatMap(t=>t.fresh));
        const fresh=permitted.filter(s=>same(s.scope,scope)&&!used.has(s.stage.stageId));
        if(!fresh.length)return;
        const history=permitted.filter(s=>!fresh.includes(s));
        const blind=own.filter(t=>t.sends.length).at(-1)?.mode==='directed'&&history.length>0;
        if(blind)history.sort((a,b)=>stableHash(key(scope)+own.length+a.stage.stageId).localeCompare(stableHash(key(scope)+own.length+b.stage.stageId)));
        else history.reverse();
        let seeds=[...fresh.slice(0,4),...history.slice(0,2)],selected:Stage[]=[],watch:Watch|undefined;
        for(const prior of [...watches].reverse()){
          const assessment=prior.research3!.assessment!;if(assessment.decision!=='watch')continue;
          const hit=fresh.find(s=>s.watchKeys?.includes(assessment.signal));if(!hit)continue;
          const anchors=watchRows.find(r=>r.task.id===prior.id)!.stages;
          if(anchors.length>5||anchors.some(a=>!permitted.some(s=>same(s.scope,a.scope)&&s.stage.stageId===a.stage.stageId)))continue;
          seeds=[hit,...anchors.filter(a=>a.stage.stageId!==hit.stage.stageId)];
          watch={trialId:prior.id,signal:assessment.signal,reason:assessment.reason,anchorStageIds:anchors.map(s=>s.stage.stageId)};break;
        }
        const minimum=watch?seeds.length:1;
        while(seeds.length>=minimum){
          const packet=[...seeds];let complete=true;
          for(let i=0;i<packet.length&&complete;i++)for(const dep of packet[i].stage.dependencies??[]){
            if(packet.some(s=>same(s.scope,packet[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep)))continue;
            const source=permitted.find(s=>same(s.scope,packet[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep));
            if(!source||packet.length>=6){complete=false;break;}packet.push(source);
          }
          if(complete&&Buffer.byteLength(JSON.stringify(packet.map(s=>s.stage)))<=32768){selected=packet;break;}
          seeds=seeds.slice(0,-1);
        }
        if(!selected.length){note('pending-evidence-or-packet-cap');return;}
        const research3=createResearchV43(selected.map(s=>s.stage),options.rootContext);
        const record:Task={id:randomUUID(),scope,revision:'v4-operation-3',research3,
          ids:selected.map(s=>s.stage.stageId),sources:selected.map(s=>({scope:s.scope,stageId:s.stage.stageId})),
          fresh:selected.filter(s=>fresh.includes(s)).map(s=>s.stage.stageId),mode:blind&&selected.some(s=>history.includes(s))?'blind':'directed',
          status:'ready',state:{phase:'screen'},sends:[],knownRefs:[],watch,sharedRefs:cards.slice(-2).map(sharedRef)};
        d.tasks.push(record);return structuredClone(record);
      });
      if(!task)return;
      const selected=stageRefs(task).map(ref=>permitted.find(s=>same(s.scope,ref.scope)&&s.stage.stageId===ref.stageId));
      // Use only the cards frozen into this task, even when the current catalogue grows.
      const frozenCards=cards.filter(c=>task!.sharedRefs?.some(ref=>ref.id===c.id&&ref.hash===sharedRef(c).hash));
      if(!selected.every((s):s is Stage=>!!s)||!allSharedGranted(task.sharedRefs??[],frozenCards))throw new Error('V4 research support withdrawn');
      const packet=selected.map(s=>s.stage),purpose=task.research3!.phase;
      if(purpose==='closed')return;
      if(task.archiveOnly&&(purpose==='instantiate'||purpose==='application-review')){
        await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.status='completed';t.research3!.phase='closed';});return;
      }
      const journal:V4DispatchJournal={revision:'v4-operation-3',watch:task.watch,rootContext:task.research3!.host.rootContext,knownTheories:frozenCards.map(c=>JSON.stringify(c)),
        onDispatch:async()=>{
          if(sent)throw new Error('Duplicate V4 dispatch');
          const closure=await this.edit(d=>sourceClosure(d,d.tasks.find(t=>t.id===task!.id)!));
          if(!closure.stages.length)throw new Error('V4 source grant missing');
          for(const row of closure.stages)if(!await options.authorize(row.stage,row.scope))throw new Error('V4 source grant withdrawn');
          if(!allSharedGranted(closure.sharedRefs,await options.sharedTheories?.()??[]))throw new Error('V4 theory grant withdrawn');
          if(options.signal?.aborted||options.admit&&!await options.admit(purpose))throw new Error('V4 admission deferred');
          await this.edit(d=>{
            const t=d.tasks.find(t=>t.id===task!.id)!;
            if(t.cancelled||t.status!=='ready'||options.signal?.aborted||d.closed.includes(key(scope))&&!t.archiveOnly)throw new Error('V4 scope closed');
            if(t.sends.length>=6||d.tasks.filter(row=>same(row.scope,scope)&&row.revision==='v4-operation-3').reduce((n,row)=>n+row.sends.length,0)>=8)throw new Error('V4 theory allowance exhausted');
            if(purpose==='assess'){if(!d.credits)throw new Error('V4 credit unavailable');d.credits--;}
            t.status='sending';t.purpose=purpose;t.sends.push({purpose,sentAt:new Date().toISOString()});
            (d.service??={})[key(scope)]={outcome:'unit-admitted',at:new Date().toISOString()};
          });sent=true;
        },
        onUsage:async(usage={})=>{
          if(!sent)throw new Error('Missing V4 dispatch intent');
          await this.edit(d=>{d.tasks.find(t=>t.id===task!.id)!.sends.at(-1)!.usage={
            ...(Number.isSafeInteger(usage.tokens)&&usage.tokens!>=0?{tokens:usage.tokens}:{}),
            ...(Number.isFinite(usage.costUsd)&&usage.costUsd!>=0?{costUsd:usage.costUsd}:{})};});
        }};
      if(!options.preciseDispatch)await journal.onDispatch();
      const response=await invoke(purpose,packet,task.research3!,journal);
      if(!sent)throw new Error('Missing V4 dispatch intent');received=true;
      const next=advanceResearchV43(task.research3!,response);
      await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.research3=next;delete t.error;
        t.status=options.signal?.aborted||t.cancelled?'stopped':next.phase==='closed'?'completed':'ready';
        if(d.closed.includes(key(scope))&&!t.archiveOnly)t.status='stopped';
      });return next;
    }catch(error){
      if(task)await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;
        if(sent)t.status=t.cancelled&&received?'stopped':received||t.sends.at(-1)?.usage?'failed':'uncertain';
        else if(options.signal?.aborted)t.status='stopped';
        t.error=error instanceof Error?error.message:'V4 unit failed';
        (d.service??={})[key(scope)]={outcome:sent?'unit-failed':'resource-or-authority-deferred',at:new Date().toISOString()};
      });
    }finally{this.active=false;}
  }

  private async runNextRevision4(scope:V4Scope, invoke:Provider, options:{rootContext?:RootContextV43;preciseDispatch?:boolean;sharedTheories?:V4SharedTheories;signal?:AbortSignal;authorize:V4Authorize;admit?:(purpose:Purpose)=>boolean|Promise<boolean>}) {
    this.active=true;
    let task:Task|undefined,sent=false,received=false;
    try {
      const rows=await this.edit(d=>{const cutoff=freezeHistory(d,scope);return d.stages.filter((s,i)=>same(s.scope,scope)||i<cutoff.stages);});
      const permitted:Stage[]=[];
      for(const row of rows)if(row.stage.fragment&&row.stage.environments&&row.stage.rootId===row.scope.rootId&&await options.authorize(row.stage,row.scope))permitted.push(row);
      const cards=(await options.sharedTheories?.()??[]).filter(c=>Buffer.byteLength(JSON.stringify(c))<=8192);
      task=await this.edit(d=>{
        const note=(outcome:string)=>{(d.service??={})[key(scope)]={outcome,at:new Date().toISOString()};};
        note('no-eligible-packet');
        if(d.tasks.some(t=>t.status==='uncertain'||t.cancelled&&!t.settlement&&t.sends.some(s=>!s.usage))){note('uncertain-dispatch');return;}
        const own=d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-4');
        for(const exhausted of own.filter(t=>t.status==='ready'&&t.sends.length>=12)){
          exhausted.status='completed';exhausted.research4!.phase='parked';exhausted.research4!.findings.push('Finite research allowance exhausted; further work requires a newly admitted evidence opportunity.');
        }
        const ready=own.find(t=>t.status==='ready'&&(!d.closed.includes(key(scope))||t.archiveOnly));
        if(ready)return structuredClone(ready);
        if(d.closed.includes(key(scope))){note('root-closed');return;}
        if(!d.credits){note('no-credit');return;}
        if(own.reduce((n,t)=>n+t.sends.length,0)>=24){note('service-allowance-exhausted');return;}
        if(!options.rootContext){note('missing-root-context');return;}
        const used=new Set(own.filter(t=>t.sends.length).flatMap(t=>t.fresh));
        const fresh=permitted.filter(s=>same(s.scope,scope)&&!used.has(s.stage.stageId));
        if(!fresh.length)return;
        const history=permitted.filter(s=>!fresh.includes(s));
        const blind=own.filter(t=>t.sends.length).at(-1)?.mode==='directed'&&history.length>0;
        if(blind)history.sort((a,b)=>stableHash(key(scope)+own.length+a.stage.stageId).localeCompare(stableHash(key(scope)+own.length+b.stage.stageId)));
        else history.reverse();
        let seeds=[...fresh.slice(0,1),...history.slice(0,1)],selected:Stage[]=[],watch:Watch|undefined;
        const minimum=watch?seeds.length:1;
        while(seeds.length>=minimum){
          const packet=[...seeds];let complete=true;
          for(let i=0;i<packet.length&&complete;i++)for(const dep of packet[i].stage.dependencies??[]){
            if(packet.some(s=>same(s.scope,packet[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep)))continue;
            const source=permitted.find(s=>same(s.scope,packet[i].scope)&&(s.stage.stageId===dep||s.stage.fragment?.id===dep));
            if(!source||packet.length>=12){complete=false;break;}packet.push(source);
          }
          if(complete&&Buffer.byteLength(JSON.stringify(packet.map(s=>s.stage)))<=32768){selected=packet;break;}
          seeds=seeds.slice(0,-1);
        }
        if(!selected.length){note('pending-evidence-or-packet-cap');return;}
        const prior=[...own].reverse().find(t=>t.status==='completed'&&t.research4?.phase==='parked'&&t.research4.inquiry&&!own.some(n=>n.predecessor===t.id));
        const novel=prior&&selected.some(row=>!prior.research4!.host.catalogue.some(old=>old.passage===row.stage.passage&&stableHash(old.conditions)===stableHash(row.stage.conditions)));
        const inherited=prior&&novel?{recordId:prior.recordId??prior.id,question:prior.research4!.inquiry!,findings:[...(prior.research4!.host.prior?.findings??[]),...prior.research4!.findings].slice(-8),alternatives:prior.research4!.alternatives,discriminatingQuestion:prior.research4!.discriminatingQuestion,candidate:prior.research4!.candidate,challenge:prior.research4!.challenge}:undefined;
        const catalogue=[...selected,...permitted.slice().reverse()].filter(row=>Buffer.byteLength(JSON.stringify(row.stage))<=8192);
        const research4=createResearchV44(selected.map(s=>s.stage),options.rootContext,catalogue.map(s=>s.stage),inherited);
        const record:Task={id:randomUUID(),scope,revision:'v4-operation-4',research4,
          ids:selected.map(s=>s.stage.stageId),sources:selected.map(s=>({scope:s.scope,stageId:s.stage.stageId})),
          fresh:selected.filter(s=>fresh.includes(s)).map(s=>s.stage.stageId),mode:blind&&selected.some(s=>history.includes(s))?'blind':'directed',
          status:'ready',state:{phase:'screen'},sends:[],knownRefs:inherited?[prior!.id]:[],...(inherited?{recordId:inherited.recordId,predecessor:prior!.id}:{}),watch,sharedRefs:cards.slice(-2).map(sharedRef)};
        d.tasks.push(record);return structuredClone(record);
      });
      if(!task)return;
      const selected=stageRefs(task).map(ref=>permitted.find(s=>same(s.scope,ref.scope)&&s.stage.stageId===ref.stageId));
      // Use only the cards frozen into this task, even when the current catalogue grows.
      const frozenCards=cards.filter(c=>task!.sharedRefs?.some(ref=>ref.id===c.id&&ref.hash===sharedRef(c).hash));
      if(!selected.every((s):s is Stage=>!!s)||!allSharedGranted(task.sharedRefs??[],frozenCards))throw new Error('V4 research support withdrawn');
      const packet=selected.map(s=>s.stage),purpose=task.research4!.phase;
      if(purpose==='closed'||purpose==='parked')return;
      if(options.rootContext&&['scope-review','instantiate','application-review'].includes(purpose))task.research4=refreshResearchContextV44(task.research4!,options.rootContext);
      if(task.archiveOnly&&(purpose==='instantiate'||purpose==='application-review')){
        await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.status='completed';t.research4!.phase='closed';});return;
      }
      const journal:V4DispatchJournal={revision:'v4-operation-4',watch:task.watch,rootContext:task.research4!.host.rootContext,knownTheories:frozenCards.map(c=>JSON.stringify(c)),
        onDispatch:async()=>{
          if(sent)throw new Error('Duplicate V4 dispatch');
          const closure=await this.edit(d=>sourceClosure(d,d.tasks.find(t=>t.id===task!.id)!));
          if(!closure.stages.length)throw new Error('V4 source grant missing');
          for(const row of closure.stages)if(!await options.authorize(row.stage,row.scope))throw new Error('V4 source grant withdrawn');
          if(!allSharedGranted(closure.sharedRefs,await options.sharedTheories?.()??[]))throw new Error('V4 theory grant withdrawn');
          if(options.signal?.aborted||options.admit&&!await options.admit(purpose))throw new Error('V4 admission deferred');
          await this.edit(d=>{
            const t=d.tasks.find(t=>t.id===task!.id)!;
            if(t.cancelled||t.status!=='ready'||options.signal?.aborted||d.closed.includes(key(scope))&&!t.archiveOnly)throw new Error('V4 scope closed');
            if(t.sends.length>=12||d.tasks.filter(row=>same(row.scope,scope)&&row.revision==='v4-operation-4').reduce((n,row)=>n+row.sends.length,0)>=24)throw new Error('V4 theory allowance exhausted');
            if(purpose==='assess'){if(!d.credits)throw new Error('V4 credit unavailable');d.credits--;}
            t.research4=task!.research4;t.status='sending';t.purpose=purpose;t.sends.push({purpose,sentAt:new Date().toISOString()});
            (d.service??={})[key(scope)]={outcome:'unit-admitted',at:new Date().toISOString()};
          });sent=true;
        },
        onUsage:async(usage={})=>{
          if(!sent)throw new Error('Missing V4 dispatch intent');
          await this.edit(d=>{d.tasks.find(t=>t.id===task!.id)!.sends.at(-1)!.usage={
            ...(Number.isSafeInteger(usage.tokens)&&usage.tokens!>=0?{tokens:usage.tokens}:{}),
            ...(Number.isFinite(usage.costUsd)&&usage.costUsd!>=0?{costUsd:usage.costUsd}:{})};});
        }};
      if(!options.preciseDispatch)await journal.onDispatch();
      const response=await invoke(purpose,packet,task.research4!,journal);
      if(!sent)throw new Error('Missing V4 dispatch intent');received=true;
      const readResponse=response as {decision?:string;selections?:number[]};
      if(readResponse?.decision==='read'&&Array.isArray(readResponse.selections)){
        const missing:number[]=[];
        for(const selection of readResponse.selections){
          const body=task.research4!.host.catalogue[selection-1];
          const row=permitted.find(s=>s.stage.stageId===body?.stageId&&stableHash(s.stage)===stableHash(body));
          if(!row||!await options.authorize(row.stage,row.scope))missing.push(selection);
        }
        if(missing.length){await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.research4!.phase='parked';t.research4!.findings.push('Requested public summaries unavailable; no raw fallback.');t.status='completed';(t.readReceipts??=[]).push({ids:[],hashes:[],missing:missing.map(String),at:new Date().toISOString()});});return;}
      }
      const next=advanceResearchV44(task.research4!,response);
      await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;t.research4=next;delete t.error;
        t.status=options.signal?.aborted||t.cancelled?'stopped':['closed','parked'].includes(next.phase)?'completed':'ready';
        for(const ref of next.host.sources){const row=permitted.find(s=>s.stage.stageId===ref.stageId&&stableHash(s.stage)===ref.hash);if(row&&!t.sources?.some(r=>same(r.scope,row.scope)&&r.stageId===ref.stageId)){(t.sources??=[]).push({scope:row.scope,stageId:ref.stageId});t.ids.push(ref.stageId);}}
        if(readResponse?.decision==='read'){const receipt=next.reads.at(-1)!;(t.readReceipts??=[]).push({ids:receipt.opened,hashes:receipt.opened.map(id=>next.host.sources.find(r=>r.stageId===id)!.hash),missing:receipt.missing.map(String),at:new Date().toISOString()});}
        if(d.closed.includes(key(scope))&&!t.archiveOnly)t.status='stopped';
      });return next;
    }catch(error){
      if(task)await this.edit(d=>{const t=d.tasks.find(t=>t.id===task!.id)!;
        if(sent)t.status=t.cancelled&&received?'stopped':received||t.sends.at(-1)?.usage?'failed':'uncertain';
        else if(options.signal?.aborted)t.status='stopped';
        t.error=error instanceof Error?error.message:'V4 unit failed';
        (d.service??={})[key(scope)]={outcome:sent?'unit-failed':'resource-or-authority-deferred',at:new Date().toISOString()};
      });
    }finally{this.active=false;}
  }

  async readPublicFragments(scope:V4Scope,refs:readonly string[],authorize:V4Authorize) {
    const rows=await this.edit(d=>d.stages.filter(s=>same(s.scope,scope)));
    const fragments:StagePassage[]=[],missing:string[]=[];
    const pending=[...new Set(refs)];
    for(let i=0;i<pending.length;i++){
      if(pending.length>6)return {status:'pending-evidence' as const,fragments:[] as StagePassage[],missing:[...refs]};
      const ref=pending[i],row=rows.find(s=>s.stage.stageId===ref);
      if(!row||!await authorize(row.stage,row.scope)){missing.push(ref);continue;}
      fragments.push(row.stage);
      for(const dep of row.stage.dependencies??[])if(!pending.includes(dep))pending.push(dep);
    }
    if(Buffer.byteLength(JSON.stringify(fragments))>32768)return {status:'pending-evidence' as const,fragments:[] as StagePassage[],missing:[...refs]};
    return {status:missing.length?'pending-evidence' as const:'read' as const,fragments:missing.length?[]:fragments,missing};
  }

  async readRequestedFragments(scope:V4Scope,trialId:string,authorize:V4Authorize) {
    const refs=await this.edit(d=>{
      const task=d.tasks.find(t=>t.id===trialId&&same(t.scope,scope)&&t.revision==='v4-operation-2');
      return task?.research?.assessment?.decision==='read-needed'?task.research.assessment.fragmentRefs:undefined;
    });
    if(!refs)return {status:'pending-evidence' as const,fragments:[] as StagePassage[],missing:[] as string[]};
    const result=await this.readPublicFragments(scope,refs,authorize);
    await this.edit(d=>{const t=d.tasks.find(t=>t.id===trialId)!;const receipt={ids:result.fragments.map(f=>f.stageId),hashes:result.fragments.map(f=>stableHash(f)),missing:result.missing,at:new Date().toISOString()};
      if(!t.readReceipts?.some(r=>stableHash({...r,at:''})===stableHash({...receipt,at:''})))(t.readReceipts??=[]).push(receipt);
    });
    return result;
  }

  async publicationEvidence(scope:V4Scope,authorize:V4Authorize,shared?:V4SharedTheories) {
    const rows=await this.edit(d=>d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-2'&&!t.cancelled&&t.status!=='stopped'&&t.research?.challenge?.verdict==='supported'&&!['source-verification','reformulation'].includes(t.research.challenge.contributionAccount.kind)).map(task=>({task,...sourceClosure(d,task)})));
    const publications:(import('./theory-revision2.js').ResearchPublicationV4R2|ResearchPublicationV4R3|ResearchPublicationV4R4)[]=[];
    const revision3=await this.edit(d=>d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-3'&&!t.cancelled&&t.status!=='stopped'&&t.research3?.challenge?.verdict==='supported'&&t.research3.challenge.contribution!=='restatement').map(task=>({task,...sourceClosure(d,task)})));
    for(const task of await this.granted(revision3,authorize,shared)){
      const research=task.research3!,c=research.candidate!;
      if(research.scopeReview?.decision==='identify'&&research.challenge?.contribution!=='identification')continue;
      const closure=revision3.find(row=>row.task.id===task.id)!;
      publications.push({id:task.id,content:{primitives:c.primitives,laws:c.laws,modelConditions:c.modelConditions,construction:c.construction,internalClaim:c.internalClaim,derivation:c.derivation,limits:c.limits},support:{trialId:task.id,revision:'v4-operation-3',sources:closure.stages.map(({scope,stage})=>({scope,stage})),sharedRefs:closure.sharedRefs,responses:research.responses.slice(0,4),target:scope,host:research.host}});
    }
    const revision4=await this.edit(d=>d.tasks.filter(t=>same(t.scope,scope)&&t.revision==='v4-operation-4'&&!t.cancelled&&t.status!=='stopped'&&t.research4?.challenge?.verdict==='supported'&&t.research4.challenge.contribution!=='restatement').map(task=>({task,...sourceClosure(d,task)})));
    for(const task of await this.granted(revision4,authorize,shared)){
      const research=publicationResearchV44(task.research4!),c=research.candidate!;
      if(research.scopeReview?.decision==='identify'&&research.challenge?.contribution!=='identification')continue;
      const closure=revision4.find(row=>row.task.id===task.id)!;
      publications.push({id:task.id,content:{primitives:c.primitives,laws:c.laws,modelConditions:c.modelConditions,construction:c.construction,internalClaim:c.internalClaim,derivation:c.derivation,limits:c.limits},support:{trialId:task.id,revision:'v4-operation-4',sources:closure.stages.map(({scope,stage})=>({scope,stage})),sharedRefs:closure.sharedRefs,responses:research.responses.slice(0,research.responses.findIndex(r=>(r as {verdict?:string}).verdict==='supported')+1),target:scope,host:research.host}});
    }
    for(const task of await this.granted(rows,authorize,shared)){
      const positive=await this.edit(d=>positiveClosure(d,task));if(!positive)continue;
      const sources=positive.stages.map(s=>({scope:s.scope,stage:s.stage}));
      const c=task.research!.candidate!, check=task.research!.challenge!;
      publications.push({id:task.id,content:{primitives:c.primitives,laws:c.laws,modelConditions:c.modelConditions,construction:c.construction,internalClaim:c.internalClaim,derivation:c.derivation,limits:check.reason},
        support:{trialId:task.id,revision:'v4-operation-2',sources,exposureStageIds:rows.find(r=>r.task.id===task.id)!.stages.map(s=>s.stage.stageId),sharedRefs:positive.sharedRefs,responses:task.research!.responses.slice(0,3),target:scope}});
    }
    return publications;
  }

  async publicationCandidate(scope: V4Scope, id: string, authorize: V4Authorize, shared?:V4SharedTheories) {
    const result = await this.edit(d => {
      const task = d.tasks.find(t => t.id === id && same(t.scope,scope));
      if (!task || task.status !== 'completed' || !d.exposed[task.id] || task.knownRefs.length || task.watch) return;
      const {state} = task;
      if (state.phase !== 'reviewed' || state.challenge.verdict !== 'try' || !state.challenge.scopedEvidence) return;
      const {stages,sharedRefs} = sourceClosure(d,task);
      if (!stages.length || stages.some(s => !same(s.scope,scope))) return;
      return {stages,sharedRefs,candidate:{id:task.id,proposal:state.proposal,scopedEvidence:state.challenge.scopedEvidence,
        sharedTheoryIds:[...new Set(sharedRefs.map(ref=>ref.id))]}};
    });
    if (!result || result.sharedRefs.length && !allSharedGranted(result.sharedRefs,await shared?.() ?? [])) return;
    for (const row of result.stages) if (!await authorize(row.stage,row.scope)) return;
    return result.candidate;
  }

  private async granted(data: {task:Task; stages:Stage[]; sharedRefs:SharedRef[]}[], authorize: V4Authorize, shared?:V4SharedTheories) {
    const visible: Task[] = [];
    const cards = data.some(d=>d.sharedRefs.length) ? await shared?.() ?? [] : [];
    for (const {task,stages,sharedRefs} of data) {
      if (!allSharedGranted(sharedRefs,cards)) continue;
      let permitted = stages.length > 0;
      for (const row of stages) if (!await authorize(row.stage,row.scope)) { permitted=false; break; }
      if (permitted) visible.push(task);
    }
    return visible;
  }

  async listKnownTheories(scope: V4Scope, authorize: V4Authorize = allowNone, shared?:V4SharedTheories) {
    const rows = await this.edit(d => {
      const id = key(scope);
      freezeHistory(d,scope);
      const eligible = d.tasks.filter(t => !t.revision && t.status === 'completed' && t.state.phase === 'reviewed'
        && t.state.challenge.verdict === 'try' && !same(t.scope,scope));
      const frozen = d.freezes[id] ??= eligible.map(t => t.id);
      return eligible.filter(t => frozen.includes(t.id)).map(task => ({
        task,...sourceClosure(d,task),
      }));
    });
    return (await this.granted(rows,authorize,shared)).flatMap(t => t.state.phase === 'reviewed' ? [{
      id:t.id,scope:t.scope,authority:'exploratory' as const,
      claimState:t.state.challenge.verdict === 'try' && t.state.challenge.scopedEvidence ? 'conditionally-argued' as const : 'open' as const,
      proposal:t.state.proposal,challenge:t.state.challenge,
    }] : []);
  }

  async listApplications(scope: V4Scope, authorize: V4Authorize = allowNone, shared?:V4SharedTheories, includeExposed=false) {
    const rows = await this.edit(d => d.closed.includes(key(scope)) ? [] : d.tasks
      .filter(t => same(t.scope,scope) && t.status === 'completed' && (includeExposed||!d.exposed[t.id])).map(task => ({
        task,...sourceClosure(d,task),
      })));
    const result = [];
    for (const t of await this.granted(rows,authorize,shared)) {
      if(t.revision==='v4-operation-4'){
        const sources=await this.edit(d=>sourceClosure(d,t).stages);
        const app=t.research4&&qualifyApplicationV44(t.research4,sources.map(s=>s.stage),scope);
        if(app)result.push({id:t.id,trialId:t.id,scope:t.scope,authority:'research-evidence' as const,theoryRef:t.id,internalClaim:t.research4!.candidate!.internalClaim,modelConditions:t.research4!.candidate!.modelConditions,interpretation:app.interpretation,verdict:'try' as const,originalVariableTest:app.conclusion,conditions:app.conditions.join('\n'),remainingObligation:'',application:app});
        continue;
      }
      if(t.revision==='v4-operation-3'){
        const sources=await this.edit(d=>sourceClosure(d,t).stages);
        const app=t.research3&&qualifyApplicationV43(t.research3,sources.map(s=>s.stage),scope);
        if(app)result.push({id:t.id,trialId:t.id,scope:t.scope,authority:'research-evidence' as const,theoryRef:t.id,internalClaim:t.research3!.candidate!.internalClaim,modelConditions:t.research3!.candidate!.modelConditions,interpretation:app.interpretation,verdict:'try' as const,originalVariableTest:app.conclusion,conditions:app.conditions.join('\n'),remainingObligation:'',application:app});
        continue;
      }
      if(t.revision==='v4-operation-2'){
        const sourceRows=await this.edit(d=>sourceClosure(d,t).stages);
        const app=t.research && qualifyApplicationV42(t.research,sourceRows.map(s=>s.stage),scope,(await shared?.()??[]).filter(card=>t.sharedRefs?.some(ref=>ref.id===card.id&&sharedRef(card).hash===ref.hash)));
        if(app)result.push({id:t.id,trialId:t.id,scope:t.scope,authority:'research-evidence' as const,theoryRef:t.id,internalClaim:t.research!.candidate!.internalClaim,modelConditions:t.research!.candidate!.modelConditions,interpretation:app.interpretation,verdict:'try' as const,originalVariableTest:app.conclusion,conditions:app.conditions.join('\n'),remainingObligation:'',application:app});
        continue;
      }
      const base = {id:t.id,trialId:t.id,scope:t.scope,authority:'exploratory' as const};
      if (t.state.phase === 'reviewed' && t.state.challenge.verdict === 'try') {
        result.push({...base,theoryRef:t.id,internalClaim:t.state.proposal.internalClaim,modelConditions:t.state.proposal.modelConditions,interpretation:t.state.proposal.interpretation,...t.state.challenge});
      } else if (t.state.phase === 'closed' && t.state.assessment.decision === 'reuse') {
        const {theoryRef,reason} = t.state.assessment;
        if (!t.knownRefs.includes(theoryRef)) {
          const ref = t.sharedRefs?.find(r => r.id === theoryRef);
          const card = (await shared?.() ?? []).find(c => c.id === ref?.id && sharedRef(c).hash === ref.hash);
          if (!card) continue;
          result.push({...base,theoryRef,internalClaim:card.internalClaim,modelConditions:card.modelConditions,
            interpretation:reason,verdict:'try' as const,originalVariableTest:'Test the proposed correspondence in this root.',
            conditions:card.modelConditions ?? 'Check the shared revision’s model conditions.',
            remainingObligation:'Establish the interpretation on this target before applying the shared claim.'});
          continue;
        }
        const origin = await this.edit(d => d.tasks.find(other => other.id === theoryRef));
        if (origin?.state.phase !== 'reviewed' || origin.state.challenge.verdict !== 'try') continue;
        result.push({...base,theoryRef,internalClaim:origin.state.proposal.internalClaim,modelConditions:origin.state.proposal.modelConditions,interpretation:reason,verdict:'try' as const,
          originalVariableTest:origin.state.challenge.originalVariableTest,
          conditions:origin.state.challenge.conditions,
          remainingObligation:'Establish the interpretation and its conditions on this target before applying the source claim.'});
      }
    }
    return result;
  }
  async applicationSupport(scope:V4Scope,id:string,authorize:V4Authorize,shared?:V4SharedTheories) {
    const application=(await this.listApplications(scope,authorize,shared,true)).find(a=>a.id===id&&'application' in a);
    if(!application)return;
    const closure=await this.edit(d=>{const task=d.tasks.find(t=>t.id===id&&same(t.scope,scope));return task?positiveClosure(d,task,true):undefined;});
    if(!closure?.stages.length||!allSharedGranted(closure.sharedRefs,await shared?.()??[]))return;
    for(const row of closure.stages)if(!await authorize(row.stage,row.scope))return;
    return {sources:closure.stages.map(row=>({scope:row.scope,stage:row.stage})),sharedRefs:closure.sharedRefs};
  }
  async acknowledgeApplications(scope: V4Scope, ids: readonly string[], callId: string) {
    if (!callId.trim()) throw new Error('Missing V4 exposure call');
    await this.edit(d => {
      for (const t of d.tasks) if (same(t.scope,scope) && ids.includes(t.id) && t.status === 'completed'
        && (t.revision==='v4-operation-4'&&t.research4?.applicationReview?.verdict==='supported'
          || t.revision==='v4-operation-3'&&t.research3?.applicationReview?.verdict==='supported'
          || t.revision==='v4-operation-2' && t.research?.application?.status==='ready'
          || t.state.phase === 'reviewed' && t.state.challenge.verdict === 'try'
          || t.state.phase === 'closed' && t.state.assessment.decision === 'reuse')) d.exposed[t.id] ??= callId;
    });
  }
}
