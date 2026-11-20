import {Type} from 'typebox';
import type {TranscriptContext} from '@earendil-works/pi-ai';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import type {AgentSessionSpecV21} from '../research/contracts/v21.js';
import {authorizedDiscussionBody,discussionCard,discussionVersion} from '../research/versions/v4/discussion.js';

const page=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:{}});
const integer=(minimum:number)=>Type.Integer({minimum});
const version=Type.String({pattern:'^[a-f0-9]{64}$'});

/** Positions are one-based lines and zero-based UTF-16 columns; preserve every newline. */
export function discussionLines(text:string,line=1,column=0,lineCount=30,maxChars=4096){
 const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[];
 if(!lines.length&&line===1&&column===0)return {text:'',line,column,totalLines:0};
 if(line>lines.length||column>=lines[line-1].length)return {error:'Range outside the requested discussion text.'};
 let result='',i=line-1,col=column;
 while(i<lines.length&&i<line-1+lineCount&&result.length<maxChars){
  const value=lines[i],end=Math.min(value.length,col+maxChars-result.length);
  // Keep supplementary characters intact on partial-line pages.
  const stop=end<value.length&&/[\uD800-\uDBFF]/.test(value.charAt(end-1))?end-1:end;
  result+=value.slice(col,stop);col=stop;
  if(col<value.length)break;
  i++;col=0;
 }
 return {text:result,line,column,totalLines:lines.length,...(i<lines.length?{next:{line:i+1,column:col}}:{})};
}

export function discussionTools(spec:AgentSessionSpecV21,contextWindow=65536):ToolDefinition[]{
 const maxChars=Math.max(64,Math.min(4096,Math.floor(contextWindow/12)));
 if(spec.role!=='theorist'||spec.loop.researchLoopVersion!=='4.0'||!('project' in spec.context))return [];
 const {project,snapshot,marker}=spec.context,discussion=snapshot.discussion;
 const call=marker.calls.find(c=>spec.id===c.id+'_session'&&['v21_plan','v21_theorist'].includes(c.task));
 if(spec.projectId!==project.id||marker.projectId!==project.id||!snapshot.contextCompaction||discussion?.revision!=='public-discussion-v2'||!call)return [];
 const updates=call.discussionUpdates??[],pin=discussionVersion(discussion,updates);
 if((call.input as {discussion?:{version?:string}})?.discussion?.version!==pin)return [];
 return [{
  name:'list_discussion_turns',label:'Browse prior discussion',description:'Page the pinned public discussion directory in chronological order, including prior user instructions and current assessment previews. Use exact detail reads for clipped fields.',
  parameters:Type.Object({version,qualifiedOnly:Type.Optional(Type.Boolean()),start:Type.Optional(integer(0)),count:Type.Optional(Type.Integer({minimum:1,maximum:4}))},{additionalProperties:false}),
  execute:async(_id,args)=>{
   const {version,start=0,count=2,qualifiedOnly=false}=args as {version:string;start?:number;count?:number;qualifiedOnly?:boolean};
   if(version!==pin)return page({error:'Discussion version unavailable.'});
   const indices=discussion.turns.flatMap((turn,index)=>{
    const update=updates.find(row=>row.artifactId===turn.report?.artifactId);
    return !qualifiedOnly||update||turn.report?.assessment||turn.report?.archiveValid===false?[index]:[];
   });
   const turns=[];let bytes=0;
   for(const i of indices.slice(start,start+count)){
    const card=discussionCard(discussion.turns[i],i,updates);
    const fullSize=Buffer.byteLength(JSON.stringify(card));
    const preview=fullSize<=maxChars*2?card:{index:i,epochId:card.epochId,rootId:card.rootId,inputCount:card.inputCount,
     question:card.question.slice(0,100),...(card.report?{report:{artifactId:card.report.artifactId,bodyHash:card.report.bodyHash,
      outcome:card.report.outcome,archiveValid:card.report.archiveValid,assessmentStatus:card.report.assessment?.status}}:{}),detailAvailable:true};
    const cost=Buffer.byteLength(JSON.stringify(preview));
    if(turns.length&&bytes+cost>maxChars*2)break;
    turns.push(preview);bytes+=cost;
   }
   const next=start+turns.length;
   return page({version,turns,totalTurns:indices.length,...(next<indices.length?{next}:{})});
  },
 },{
  name:'read_discussion_report',label:'Read exact public discussion lines',description:'Read exact lines of an authorized public report (supply its bodyHash), earlier user input (inputIndex), question, or complete scientific metadata including its current reassessment. Continue using next.line and next.column.',
  parameters:Type.Object({version,index:integer(0),section:Type.Union([Type.Literal('report'),Type.Literal('question'),Type.Literal('user-input'),Type.Literal('metadata')]),bodyHash:Type.Optional(version),inputIndex:Type.Optional(integer(0)),line:Type.Optional(integer(1)),column:Type.Optional(integer(0)),lineCount:Type.Optional(Type.Integer({minimum:1,maximum:80}))},{additionalProperties:false}),
  execute:async(_id,args)=>{
   const {version,index,section,bodyHash,inputIndex=0,line,column,lineCount}=args as {version:string;index:number;section:string;bodyHash?:string;inputIndex?:number;line?:number;column?:number;lineCount?:number};
   const turn=discussion.turns[index];
   if(version!==pin||!turn)return page({error:'Discussion turn unavailable at that version.'});
   let value:string|undefined;
   if(section==='question')value=turn.question;
   if(section==='user-input')value=turn.userInputs[inputIndex]?.text;
   if(section==='report'&&turn.report&&bodyHash===turn.report.bodyHash){
    try{value=authorizedDiscussionBody(project,turn,turn.report);}catch{return page({error:'Public original unavailable at this version.'});}
   }
   if(section==='metadata'&&turn.report)value=JSON.stringify({...turn.report,...updates.find(row=>row.artifactId===turn.report!.artifactId)},null,2);
   if(value===undefined)return page({error:'The requested field or report hash is unavailable.'});
   return page({version,index,epochId:turn.epochId,rootId:turn.rootId,section,...(section==='report'?{bodyHash}:{}),...discussionLines(value,line,column,lineCount,maxChars)});
  },
 }];
}

const historyReads=new Set(['list_discussion_turns','read_discussion_report']);

/** Project only completed, paired reads. Pi's persisted transcript and frozen originals stay exact. */
export function projectDiscussionReads(context:TranscriptContext,byteBudget:number):TranscriptContext{
 const messages=context.messages,omitted=new Set<number>(),summaries=new Map<number,string>();
 let bytes=0,haveLatest=false;
 for(let i=messages.length-1;i>=0;i--){
  const message=messages[i];
  if(message.role!=='assistant')continue;
  const calls=message.content.filter(part=>part.type==='toolCall');
  if(!calls.some(call=>historyReads.has(call.name)))continue;
  const results=messages.slice(i+1,i+1+calls.length);
  if(results.length!==calls.length||!calls.every((call,j)=>{
   const reply=results[j];return reply.role==='toolResult'&&reply.toolCallId===call.id&&reply.toolName===call.name;
  }))continue;
  const pure=calls.every(call=>historyReads.has(call.name))&&message.content.every(part=>part.type==='toolCall'||part.type==='thinking'||part.type==='text'&&!part.text.trim());
  const size=Buffer.byteLength(JSON.stringify([...(pure?[message]:[]),...results.filter(reply=>reply.role==='toolResult'&&historyReads.has(reply.toolName))]));
  if(!haveLatest||bytes+size<=byteBudget){haveLatest=true;bytes+=size;continue;}
  if(pure){
   for(let j=i;j<=i+calls.length;j++)omitted.add(j);
  }else{
   // Mixed replies may contain science or other tool results. Preserve the
   // original request and pair every tool call with its response.
   for(const [j,call] of calls.entries())if(historyReads.has(call.name))
    summaries.set(i+1+j,'Prior public discussion page. Repeat the paired read to recover its exact content.');
  }
 }
 if(!omitted.size&&!summaries.size)return context;
 return {...context,messages:messages.flatMap((message,i)=>{
  if(omitted.has(i))return [];
  const summary=summaries.get(i);
  if(summary&&message.role==='toolResult')return [{...message,content:[{type:'text' as const,text:summary}]}];
  return [message];
 })};
}
