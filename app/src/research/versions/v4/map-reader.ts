import {mapContextPresentation,mapRecordPresentation,MAP_PRESENTATION,type MapDetail} from '../../../learning/knowledge-map-presentation.js';
import type {TranscriptContext} from '@earendil-works/pi-ai';
import type {KnowledgeMapToolEvent} from '../../../runtime/knowledge-map-tools.js';
import {join} from 'node:path';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import {mapHandle,sameMapRef,MapError,mapReadFeedback,type MapGrant,type MapView,type MapOpenResult,type MapQuery,type MapReadCall,type MapSelection} from '../../../learning/knowledge-map.js';
import {stableHash} from '../../../learning/research-hash.js';
import {findMapWriteRead} from './scientific-map-write.js';
import {mapBasisChoices,retainMapOpenBases} from '../../../learning/knowledge-map-support.js';
import {atomicWrite,readJson,exists} from '../../../storage/atomic.js';

/** Host-owned exact read checkpoint. Scientific agents see ordinary native readers. */
export class MapReader {
 get refutationEvidence(){return this.grant.refutationEvidence===true;}
 private deliveredOpens?:Set<string>;
 private state?:{view:MapView;opened:MapOpenResult[];openViews?:Record<string,MapView>;proofSelections?:string[];batches?:Record<string,{hash:string;cursor:number;results:unknown[]}>};
 constructor(private readonly library:ResearchLibrary,private readonly grant:MapGrant,private readonly file?:string,private readonly presentation:typeof MAP_PRESENTATION|'legacy'=MAP_PRESENTATION,readonly modelDirectedKnowledge=false){}
 static async validateUses(library:ResearchLibrary,root:string,projectId:string,callId:string,refs:string[],worker:boolean,rows:unknown[],expectedDirected?:boolean,expectedObservations?:boolean,writing?:true){
  const taskId=callId+'_session',saved=await readJson<{view:MapView;opened:MapOpenResult[]}>(MapReader.path(root,projectId,taskId)),grant=saved.view.grant;
  if(expectedDirected!==undefined&&!!saved.view.modelDirectedKnowledge!==expectedDirected)throw new MapError('FORBIDDEN','Saved map reader differs from the frozen proof capability');
  if(expectedObservations!==undefined&&!!grant.refutationEvidence!==expectedObservations)throw new MapError('FORBIDDEN','Saved observation grant differs from the frozen task');
  if(grant.ownerId!=='local-user'||grant.projectId!==projectId||grant.taskId!==taskId||grant.profileId!=='profile_'+stableHash(['local-user',projectId])||grant.purpose!==(worker?'map-worker':'map-proof')||worker&&!Array.isArray(grant.allowedRefs))throw new MapError('FORBIDDEN','Map proof scope mismatch');
  const reader=new MapReader(library,grant,MapReader.path(root,projectId,taskId),saved.view.presentation??'legacy',!!saved.view.modelDirectedKnowledge),writeReads:MapOpenResult[]=[];
  const available=await reader.proofReferences(rows,writing?writeReads:undefined);
  return refs.map(ref=>{const read=writing?findMapWriteRead(writeReads,ref):available.find(r=>r.selection===ref);if(!read)throw new MapError('FORBIDDEN','Used map knowledge was not delivered in this proof');return read;});
 }
 async proofReferences(rows:unknown[],writeReads?:MapOpenResult[]){
  const evidence=rows as {type?:string;kind?:string;tool?:string;callId?:string;result?:MapOpenResult;presentation?:string;input?:{detail?:string}}[];
  const delivered=evidence.filter(row=>row.type==='knowledge-map-tool-result'&&row.tool==='open_map_knowledge'&&row.result&&evidence.some(done=>done.kind==='effect-completed'&&done.callId===row.callId&&done.tool===row.tool));
  await this.validate();const state=await this.load(),result:MapOpenResult[]=[];
  const ambiguous=new Set<string>();
  for(const row of delivered){
   // A user-supplied derivation is readable on demand. It is never a proof basis in a citation receipt.
   const {suppliedProof:_supplied,...old}=row.result!;
   const summaryOnly=row.presentation===MAP_PRESENTATION&&['theory','source-evidence'].includes(old.kind)&&row.input?.detail!=='proof';
   if(summaryOnly&&(!writeReads||!old.ref))continue;
   const stored=state.opened.find(r=>r.selection===old.selection);
   const current=stored&&{...stored};if(current)delete current.suppliedProof;
   if(!current&&state.view?.modelDirectedKnowledge)continue;
   if(!current||stableHash(current.ref??current.sources)!==stableHash(old.ref??old.sources)||current.body!==old.body)throw new MapError('FORBIDDEN','Map proof read differs from delivered exact content');
   if(writeReads&&current.ref&&!old.empiricalSource&&!current.empiricalSource){
    const read=retainMapOpenBases(old,current),previous=writeReads.findIndex(r=>r.selection===read.selection);
    if(previous<0)writeReads.push(read);else writeReads[previous]=read;
   }
   if(summaryOnly)continue;
   if(old.empiricalSource||current.empiricalSource)continue;
   if(old.kind==='observation'){
    if(old.qualification!=='observed'||current.qualification!=='observed'||stableHash(old.observation)!==stableHash(current.observation))continue;
    const supports=old.supports.filter(s=>s.status==='observed'&&current.supports.some(c=>stableHash(c)===stableHash(s)));
    if(supports.length&&!result.some(r=>r.selection===old.selection))result.push({...structuredClone(old),supports:structuredClone(supports)});
    continue;
   }
   if(!old.bases){if(!result.some(r=>r.selection===current.selection))result.push(structuredClone(current));continue;}
   // Resolve only bases the model actually saw. A later open cannot change what
   // an earlier citation meant, even when another proof now has the same title.
   for(const {selection,basis} of mapBasisChoices(old)){
    if(!current.bases?.some(b=>stableHash(b)===stableHash(basis)))continue;
    const via=basis.steps[0]!.via,{bases:_offered,separateCitations:_replayed,...receipt}=structuredClone(old);
    const prior=result.find(r=>r.selection===selection);
    if(prior&&stableHash(prior.basis)!==stableHash(basis)){ambiguous.add(selection);continue;}
    if(!prior)result.push({...receipt,selection,basis,accepted:via==='accepted',qualification:via==='accepted'?'accepted':via==='definition'?'definition':'proved',supports:receipt.supports.filter(s=>s.id===via)});
   }
   if(!old.bases.length&&!result.some(r=>r.selection===old.selection))result.push({...structuredClone(old),supports:[],accepted:false});
  }
  return result.filter(r=>!ambiguous.has(r.selection));
 }
 static path(root:string,projectId:string,taskId:string){return join(root,'v4','map-reads',stableHash([projectId,taskId])+'.json');}
 private async load(){
  if(!this.state){const saved=this.file&&await exists(this.file)?await readJson<{view:MapView;opened:MapOpenResult[]}>(this.file):undefined;
   if(saved&&stableHash(saved.view.grant)!==stableHash(this.grant))throw Error('Map read authority changed');
   if(saved&&Boolean(saved.view.modelDirectedKnowledge)!==this.modelDirectedKnowledge)throw Error('Map read contract changed');
   this.state=saved??{view:await this.library.freezeKnowledgeMap(this.grant),opened:[]};
   if(!saved&&this.modelDirectedKnowledge)this.state.view.modelDirectedKnowledge=true;
   if(!saved&&this.presentation==='legacy')delete this.state.view.presentation;await this.save();}
  return this.state;
 }
 private async save(){if(this.file)await atomicWrite(this.file,JSON.stringify(this.state));}
 async validate(){const state=await this.load();const opened:MapOpenResult[]=[];
  for(const old of state.opened){
   const view=state.openViews?.[old.selection]??(!old.ref||state.view.refs.some(r=>sameMapRef(r,old.ref!))?state.view:await this.library.freezeKnowledgeMap({...this.grant,allowedRefs:[old.ref]}));
   try{opened.push(retainMapOpenBases(old,await this.library.openKnowledgeMap(view,old.ref?mapHandle(old.ref):old.selection,view.grant)));}
   catch(error){if(!this.modelDirectedKnowledge||!mapReadFeedback(error))throw error;}
  }
  if(!this.modelDirectedKnowledge||stableHash(opened)!==stableHash(state.opened)){state.opened=opened;await this.save();}
 }
 async lookup(query:MapQuery){const state=await this.load();await this.validate();return this.library.queryKnowledgeMap(state.view,query,this.grant);}
 async open(selection:string,detail?:MapDetail){const state=await this.load(),opened=await this.library.openKnowledgeMap(state.view,selection,this.grant);state.openViews??={};state.openViews[selection]=structuredClone(state.view);if(detail==='proof'){state.proofSelections??=[];if(!state.proofSelections.includes(selection))state.proofSelections.push(selection);}state.opened=state.opened.filter(o=>o.selection!==selection);state.opened.push(opened);await this.save();return opened;}
 async refresh(){const state=await this.load();await this.validate();const presentation=state.view.presentation;state.view=await this.library.freezeKnowledgeMap(this.grant);state.view.presentation=presentation;if(this.modelDirectedKnowledge)state.view.modelDirectedKnowledge=true;await this.save();return {revision:state.view.revision,profileVersion:state.view.profile.version};}
 async view(){return structuredClone((await this.load()).view);}
 async readBatch(id:string,reads:import('../../../learning/knowledge-map.js').MapReadCall[]){
  if(!id||!reads.length||reads.some(r=>!['lookup','open','refresh'].includes(r.action)))throw Error('Invalid native read batch');
  const state=await this.load();state.batches??={};const hash=stableHash(reads),batch=state.batches[id]??={hash,cursor:0,results:[]};if(batch.hash!==hash)throw Error('Changed native read batch replay');await this.save();
  await this.validate();while(batch.cursor<reads.length){
   const read=reads[batch.cursor]!;
   let result:unknown,feedback:ReturnType<typeof mapReadFeedback>;
   try{result=read.action==='open'?await this.open(read.selection??'',read.detail):read.action==='lookup'?await this.lookup(read.query??{query:''}):await this.refresh();}
   catch(error){feedback=this.modelDirectedKnowledge&&read.action!=='refresh'?mapReadFeedback(error):undefined;if(!feedback)throw error;}
   batch.results.push({call:read,result,view:structuredClone(state.view),...(feedback?{feedback}:{})});batch.cursor++;await this.save();
  }
  return Promise.all(batch.results.map(r=>projectMapReadRecord(this.library,r as MapReadRecord)));
 }
 async projectBatchResults(results:unknown[]){const state=await this.load();const records=Object.values(state.batches??{}).flatMap(b=>b.results as MapReadRecord[]);return Promise.all(results.map(r=>{const call=(r as {call:MapReadCall}).call;const record=records.findLast(x=>stableHash(x.call)===stableHash(call));return record?projectMapReadRecord(this.library,record):{call,error:'STALE_SOURCE',notice:'Historical read requires a fresh native lookup.'};}));}
 async context(){
  const state=await this.load();await this.validate();
  const current=await this.library.freezeKnowledgeMap(this.grant);
  const accepted=state.view.profile.accepted.filter(r=>current.profile.accepted.some(now=>sameMapRef(r,now))
   &&(!this.modelDirectedKnowledge||[current,state.view].every(v=>v.refs.some(now=>sameMapRef(r,now)))));
  return {presentation:state.view.presentation,proofSelections:state.proofSelections,profile:{...state.view.profile,accepted},revision:state.view.revision,opened:state.opened};
 }
 async initialContext(query:string){const context=await this.context();return this.modelDirectedKnowledge?{...context,selection:await this.lookup({mode:'directory'})}:context.presentation===MAP_PRESENTATION?{...context,selection:await this.lookup({query,mode:'candidates'})}:context;}
 async authority(input?:TranscriptContext):Promise<unknown>{
  const context=await this.context();
  if(this.modelDirectedKnowledge){
   const visible=new Set<string>();
   for(const msg of input?.messages??[]){
    if(msg.role!=='toolResult'||msg.toolName!=='open_map_knowledge'||msg.isError)continue;
    for(const part of msg.content)if(part.type==='text'){
     try{const card=JSON.parse(part.text);if(typeof card?.selection==='string')visible.add(card.selection);}catch{}
    }
   }
   const state=await this.load(),directory=await this.library.queryKnowledgeMap(state.view,{mode:'directory'},this.grant);
   return mapContextPresentation({...context,selection:directory,opened:context.opened.filter(r=>!visible.has(r.selection)&&(!this.deliveredOpens||this.deliveredOpens.has(r.selection)))});
  }
  return {profile:context.profile,entries:context.opened.map(({selection,ref,qualification,accepted,supports})=>({selection,ref,qualification,accepted,supports:supports.map(s=>({id:s.id,status:s.status}))})),notice:'These current qualifications supersede earlier read statuses. A withdrawn acceptance or pending claim is not an established premise.'};
 }
 async projectForeground(input:TranscriptContext,rows:unknown[]):Promise<TranscriptContext>{
  if(!this.modelDirectedKnowledge)return input;
  const events=rows as (Partial<KnowledgeMapToolEvent>&{kind?:string})[];
  const completed=new Set(events.filter(e=>e.kind==='effect-completed').map(e=>JSON.stringify([e.callId,e.tool])));
  const receipts=new Map(events.filter(e=>e.type==='knowledge-map-tool-result'&&e.modelDirectedKnowledge&&completed.has(JSON.stringify([e.callId,e.tool]))).map(e=>[e.callId,e]));
  this.deliveredOpens=new Set([...receipts.values()].filter(e=>e.tool==='open_map_knowledge'&&e.view&&stableHash(e.view.grant)===stableHash(this.grant)).map(e=>(e.input as {selection:string}).selection));
  const result=structuredClone(input);
  for(const message of result.messages){
   if(message.role!=='toolResult'||message.isError||!['lookup_map_knowledge','open_map_knowledge'].includes(message.toolName))continue;
   const receipt=receipts.get(message.toolCallId);
   if((message.details as {v3InputError?:boolean}|undefined)?.v3InputError||(message.details as {mapReadFeedback?:boolean}|undefined)?.mapReadFeedback)continue;
   if(receipt?.view&&receipt.tool===message.toolName&&stableHash(receipt.view.grant)===stableHash(this.grant)){
    const call:MapReadCall=receipt.tool==='lookup_map_knowledge'?{toolCallId:message.toolCallId,action:'lookup',query:receipt.input as MapQuery}
     :{toolCallId:message.toolCallId,action:'open',...receipt.input as {selection:string;detail?:MapDetail}};
    const record={view:receipt.view,call,result:receipt.result};
    const current=await projectMapReadRecord(this.library,record),prior=mapRecordPresentation(record);
    if('result' in current&&stableHash(current.result)===stableHash(prior.result))continue;
   }
   message.content=[{type:'text',text:JSON.stringify({notice:'This earlier map read is no longer current in its original scope. Choose a fresh read if needed.'})}];
  }
  return result;
 }
}
export interface MapReadRecord {call:MapReadCall;result:unknown;view:MapView;feedback?:ReturnType<typeof mapReadFeedback>}
/** Historical receipts stay intact. Only currently authorized science is projected into a new model input. */
export async function projectMapReadRecord(library:ResearchLibrary,record:MapReadRecord){
 if(record.view.modelDirectedKnowledge&&record.feedback)return {call:record.call,...record.feedback};
 try{
  const result=record.call.action==='open'?retainMapOpenBases(record.result as MapOpenResult,await library.openKnowledgeMap(record.view,record.call.selection??'',record.view.grant)):record.call.action==='lookup'?await library.queryKnowledgeMap(record.view,record.call.query??{query:''},record.view.grant):record.result;
  if(record.view.modelDirectedKnowledge&&record.call.action==='lookup'){
   const original=record.result as MapSelection,current=result as MapSelection;
   // Page offsets can shift after withdrawal. A replay authorizes old selections, never their replacements.
   const handles=(s:MapSelection)=>[...s.entries,...s.evidence,...s.directory??[]].map(e=>e.selection);
   const offered=new Set(handles(original)),paths=new Set(original.entries.flatMap(e=>(e.paths??[]).map(p=>stableHash([e.selection,p]))));
   if(handles(current).some(h=>!offered.has(h))||current.entries.some(e=>e.paths?.some(p=>!paths.has(stableHash([e.selection,p])))))
    return {call:record.call,error:'STALE_SOURCE',notice:'This earlier page changed under current authority. Request a fresh page to see its available selections.'};
  }
  return record.view.presentation===MAP_PRESENTATION?mapRecordPresentation({...record,result}):{call:record.call,result};
 }catch(error){
  if(record.view.modelDirectedKnowledge){const feedback=mapReadFeedback(error);if(feedback)return {call:record.call,...feedback};}
  else if(error instanceof MapError&&['STALE_SOURCE','FORBIDDEN','NOT_FOUND'].includes(error.code))return {call:record.call,error:error.code,notice:'This prior read is no longer authorized. Its historical body is not supplied.'};
  throw error;
 }
}
