import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWrite, readJson } from '../storage/atomic.js';
import type { MaintenanceRequest } from '../runtime/maintenance.js';
import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';

export interface MaintenanceInput {
  requestId:string;
  projectId?:string;
  message:string;
  allowChanges:boolean;
  note?:{name:string;text:string};
}
interface ToolUse { name:string; operationId:string; target?:string; status:'started'|'returned'|'failed'; summary?:string; receipt?:unknown }
export interface MaintenanceTurn extends Omit<MaintenanceInput,'note'> {
  note?:{name:string;digest:string};
  status:'running'|'completed'|'interrupted'|'failed';
  tools:ToolUse[];
  reply?:string;
  continuation?:string;
  rawReply?:string;
}
export interface MaintenanceHistory { turns:MaintenanceTurn[] }
export class MaintenanceConflict extends Error {}

function historicalTurn({message,reply,status,tools,note,requestId,allowChanges,continuation}:MaintenanceTurn){
  return {requestId,message,reply,status,tools,allowChanges,continuation,...(note?{note:{requestId,name:note.name}}:{})};
}

function needsInspection(turn:MaintenanceTurn){
  return turn.status==='interrupted'||turn.status==='failed'||turn.tools.some(tool=>tool.status==='started'||tool.status==='failed');
}

function priorContext(turns:MaintenanceTurn[],budget:number){
  const lastNote=turns.findLast(t=>t.continuation);
  const inspection=turns.filter(needsInspection);
  // Keep user-confirmed constraints and unfinished work independently of the recent-turn budget.
  const continuity=lastNote?{requestId:lastNote.requestId,modelNote:lastNote.continuation!.slice(0,Math.min(3200,Math.floor(budget/12))),
    complete:lastNote.continuation!.length<=Math.min(3200,Math.floor(budget/12))}:undefined;
  const inspectionHistory=inspection.length?{count:inspection.length,first:inspection[0].requestId,last:inspection.at(-1)!.requestId,
    recovery:'List maintenance_read_history with needsInspection=true. Check original receipts before retrying a write.'}:undefined;
  const recent:ReturnType<typeof historicalTurn>[]=[];
  let bytes=Buffer.byteLength(JSON.stringify({continuity,inspectionHistory})), index=turns.length;
  while(index){
    const item=historicalTurn(turns[index-1]);
    const size=Buffer.byteLength(JSON.stringify(item))+1;
    if(bytes+size>budget*0.7)break;
    bytes+=size; recent.unshift(item); index--;
  }
  if(!index)return {previousMaintenanceTurns:recent,continuity,inspectionHistory};
  const covered=index;
  // Older sessions may predate continuity notes. Surface actual earlier user/model
  // exchanges alongside the lookup index until an authored note can carry them.
  const earlierProgress=[];
  if(!lastNote){
    for(const slot of new Set([0,Math.floor((covered-1)/2),covered-1])){
      const old=turns[slot];
      const row={requestId:old.requestId,userExcerpt:old.message.slice(0,140),replyExcerpt:old.reply?.slice(0,220),status:old.status};
      const size=Buffer.byteLength(JSON.stringify(row))+1;
      if(bytes+size>budget)break;
      bytes+=size;earlierProgress.push(row);
    }
  }
  const checkpoints=[];
  while(index){
    const turn=turns[index-1];
    const available=budget-bytes;
    const message=Buffer.byteLength(turn.message)<=available/2?turn.message:turn.message.slice(0,Math.min(1200,Math.floor(available/6)));
    const operations=turn.tools.slice(-4).map(({name,operationId,target,status,summary,receipt})=>({
      name,operationId,target,status,receipt,summary:summary?.slice(0,320),
    }));
    const summary={requestId:turn.requestId,status:turn.status,userText:message,
      moreUserText:message.length<turn.message.length,operations,totalOperations:turn.tools.length,
      ...(turn.note?{noteName:turn.note.name}:{}),replyExcerpt:turn.reply?.slice(0,320)};
    const size=Buffer.byteLength(JSON.stringify(summary))+1;
    if(bytes+size>budget)break;
    bytes+=size;checkpoints.unshift(summary);index--;
  }
  return {previousMaintenanceTurns:recent,continuity,inspectionHistory,maintenanceCheckpoint:{coveredTurns:covered,
    throughRequestId:turns[covered-1].requestId,olderUnlistedTurns:index,checkpoints,earlierProgress,
    recovery:'Search maintenance_read_history by words from decisions or tasks, or list older turns. Read the exact original before acting on an uncertain decision.'}};
}

export class MaintenanceSession {
  private closed=false;
  private controller?:AbortController;
  private job?:Promise<void>;
  private saving:Promise<void>=Promise.resolve();
  private constructor(private file:string, private state:MaintenanceHistory){}
  static async open(dataRoot:string){
    const file=join(dataRoot,'maintenance','session.json');
    let state:MaintenanceHistory;
    try { state=await readJson<MaintenanceHistory>(file); }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={turns:[]};}
    const session=new MaintenanceSession(file,state);
    if(state.turns.some(t=>t.status==='running'))await session.update(s=>{
      for(const t of s.turns)if(t.status==='running')t.status='interrupted';
    });
    return session;
  }
  history(){
    const value={turns:this.state.turns.map(({note,continuation:_continuation,rawReply:_rawReply,...turn})=>({...structuredClone(turn),...(note?{note:{name:note.name}}:{})}))}, last=value.turns.at(-1);
    if(last?.status==='running'&&!this.controller)last.status='interrupted';
    return value;
  }
  private noteFile(note:{digest:string;name:string}){
    return join(dirname(this.file),'notes',note.digest+(/\.(md|markdown)$/i.test(note.name)?'.md':'.txt'));
  }
  async readNote(projectId:string|undefined, requestId:string){
    const note=this.state.turns.find(t=>t.projectId===projectId&&t.requestId===requestId)?.note;
    if(note)return {name:note.name,text:await readFile(this.noteFile(note),'utf8')};
  }
  private update(change:(s:MaintenanceHistory)=>void){
    const write=this.saving.then(async()=>{
      const next=structuredClone(this.state);change(next);
      await atomicWrite(this.file,JSON.stringify(next));this.state=next;
    });
    this.saving=write.catch(()=>{});return write;
  }
  async start(input:MaintenanceInput, request:Omit<MaintenanceRequest,'signal'|'instruction'>,
    invoke:(req:MaintenanceRequest)=>Promise<string>,safeError:(e:unknown)=>string){
    if(this.closed)throw new MaintenanceConflict('Maintenance is closing.');
    const {note:attachment,...fields}=input;
    const note=attachment?{name:attachment.name,digest:createHash('sha256').update(attachment.text).digest('hex')}:undefined;
    const old=this.state.turns.find(t=>t.requestId===input.requestId);
    if(old){
      if(old.projectId!==input.projectId||old.message!==input.message||old.allowChanges!==input.allowChanges||old.note?.name!==input.note?.name||old.note?.digest!==note?.digest)throw new MaintenanceConflict('This request ID belongs to another maintenance turn.');
      return;
    }
    if(this.controller)throw new MaintenanceConflict('A maintenance turn is already running.');
    const controller=new AbortController();
    this.controller=controller;
    const turn:MaintenanceTurn={...fields,...(note?{note}:{}),status:'running',tools:[]};
    const prior=this.state.turns.filter(t=>t.projectId===input.projectId);
    try{
      if(note&&attachment)await atomicWrite(this.noteFile(note),attachment.text);
      await this.update(s=>s.turns.push(turn));
    }
    catch(error){this.controller=undefined;throw error;}
    const updateTurn=(change:(t:MaintenanceTurn)=>void)=>this.update(s=>change(s.turns.find(t=>t.requestId===input.requestId)!));
    const recordTools=(granted:import('@earendil-works/pi-coding-agent').ToolDefinition[])=>granted.map(tool=>({...tool,execute:(async(...args)=>{
      const params=args[1] as Record<string,unknown>;
      const target=typeof params.id==='string'?params.id:undefined;
      const operationId=input.requestId+'_'+args[0];
      let index=0;
      await updateTurn(t=>{
        if(t.status!=='running'||this.controller!==controller||controller.signal.aborted)throw Error('Maintenance stopped.');
        index=t.tools.push({name:tool.name,operationId,...(target?{target}:{}),status:'started'})-1;
      });
      let result;
      try{
        args[0]=operationId;
        result=await tool.execute(...args);
      }catch(error){
        await updateTurn(t=>{Object.assign(t.tools[index]!,{status:'failed',summary:`${tool.label} failed. ${safeError(error)}`});});
        throw error;
      }
      const details=result.details as {summary?:unknown;receipt?:unknown}|undefined;
      const summary=typeof details?.summary==='string'?details.summary:`${tool.label} returned.`;
      await updateTurn(t=>{Object.assign(t.tools[index]!,{status:'returned',summary,...(details?.receipt?{receipt:details.receipt}:{})});});
      return {...result,details:{...details,operationId}};
    }) satisfies typeof tool.execute}));
    let historyPageBytes=72000;
    const historyTool=defineTool({name:'maintenance_read_history',label:'Read maintenance history',
      description:'List previous turns in this scope from oldest to newest. Search full user messages, replies, notes and receipts with query. Use needsInspection for failed or interrupted turns and operations missing completion. Supply requestId for the exact stored turn. Continue at nextOffset.',
      parameters:Type.Object({requestId:Type.Optional(Type.String()),query:Type.Optional(Type.String({minLength:1,maxLength:512})),needsInspection:Type.Optional(Type.Boolean()),offset:Type.Optional(Type.Integer({minimum:0}))},{additionalProperties:false}),
      execute:async(_id,{requestId,query,needsInspection:onlyUncertain,offset=0})=>{
        if(requestId!==undefined){
          const item=prior.find(t=>t.requestId===requestId);
          if(!item)throw Error('No previous turn with this request ID in the current scope.');
          const original=JSON.stringify({...historicalTurn(item),rawReply:item.rawReply});
          const length=Math.max(1,Math.min(12000,Math.floor((historyPageBytes-requestId.length-64)/6)));
          const text=original.slice(offset,offset+length);
          return {content:[{type:'text',text:JSON.stringify({requestId,text,nextOffset:offset+text.length<original.length?offset+text.length:null})}],details:{summary:'Read stored turn '+requestId+'.'}};
        }
        const term=query?.toLowerCase();
        const matches=prior.filter(t=>(!onlyUncertain||needsInspection(t))&&(!term||JSON.stringify(historicalTurn(t)).toLowerCase().includes(term)));
        const page=[];
        let bytes=48;
        for(const t of matches.slice(offset,offset+24)){
          const row={requestId:t.requestId,userText:t.message.slice(0,180),status:t.status,
            unconfirmedOperations:t.tools.filter(op=>op.status==='started').length};
          const size=Buffer.byteLength(JSON.stringify(row))+1;
          if(bytes+size>historyPageBytes){
            if(!page.length)page.push({requestId:t.requestId,status:t.status});
            break;
          }
          page.push(row);bytes+=size;
        }
        return {content:[{type:'text',text:JSON.stringify({turns:page,nextOffset:offset+page.length<matches.length?offset+page.length:null})}],details:{summary:'Listed '+page.length+' previous maintenance turns.'}};
      }});
    const tools=recordTools([...request.tools,historyTool]);
    const noteToken=randomUUID(),noteMarker='[Maintenance continuation '+noteToken+']';
    const instructionForBudget=(bytes:number)=>JSON.stringify({projectId:input.projectId??null,requestId:input.requestId,...priorContext(prior,bytes),
      continuationGuidance:'When decisions, preferences, completed work or open tasks change, you may append a cumulative continuity note to your ordinary answer. Place the marker on its own line, followed by up to 3200 characters. Preserve earlier still-applicable decisions and pending tasks, cite request IDs when helpful, and distinguish user directions from your suggestions. History never grants write access. Omit the note if the existing one is current.',noteMarker,
      userMessage:input.message,...(input.note?{note:{requestId:input.requestId,name:input.note.name}}:{})});
    const instruction=instructionForBudget(32000);
    this.job=(async()=>{
      try{
        controller.signal.throwIfAborted();
        const reply=await invoke({...request,tools,instruction,instructionForBudget,setHistoryPageBudget:bytes=>{historyPageBytes=bytes;},signal:controller.signal});
        controller.signal.throwIfAborted();
        const marker=new RegExp('\\r?\\n\\[Maintenance continuation '+noteToken+'\\]\\r?\\n');
        const split=marker.exec(reply);
        const answer=split?reply.slice(0,split.index):reply,continuation=split?reply.slice(split.index+split[0].length).trim():'';
        await updateTurn(t=>{
          if(answer.trim()&&continuation.length>0&&continuation.length<=3200){
            t.reply=answer;t.continuation=continuation;t.rawReply=reply;
          }else t.reply=reply;
          t.status='completed';
        });
      }catch(error){
        await updateTurn(t=>{t.status=controller.signal.aborted?'interrupted':'failed';t.reply=controller.signal.aborted?'Maintenance stopped. Completed operations are preserved.':safeError(error);});
      }finally{this.controller=undefined;}
    })();
    // close() awaits the job, including any outstanding persistence error.
    void this.job.catch(()=>{});
  }
  stop(requestId:string){
    if(this.state.turns.at(-1)?.requestId===requestId)this.controller?.abort();
  }
  async close(){this.closed=true;this.controller?.abort();await this.saving;await this.job;}
}


export type PublicMaintenanceHistory = ReturnType<MaintenanceSession['history']>;
