import {Type} from 'typebox';
import {Value} from 'typebox/value';
import {stableHash} from '../../../learning/research-hash.js';
import type {StagePassage} from './theory-trial.js';
import {theorySchemasV43,type RootContextV43,type ResearchStateV43} from './theory-revision3.js';
const text=Type.String({minLength:1,pattern:'\\S'}), choice=(...values:string[])=>Type.Union(values.map(v=>Type.Literal(v)));
const obj=(properties:Record<string,any>)=>Type.Object(properties,{additionalProperties:false});
const read=obj({decision:Type.Literal('read'),selections:Type.Array(Type.Integer({minimum:1,maximum:20}),{minItems:1,maxItems:6,uniqueItems:true})});
const progress=obj({decision:choice('continue','revise','park','develop'),finding:text,nextInquiry:Type.Optional(text),alternatives:Type.Optional(Type.Array(text,{maxItems:2})),discriminatingQuestion:Type.Optional(text)});
export const theorySchemasV44={
 assess:Type.Union([theorySchemasV43.assess,read]),
 'scope-review':obj({decision:choice('admit','identify','close','park'),reason:text,inquiry:Type.Optional(text)}),
 probe:Type.Union([progress,read]),
 construct:Type.Union([theorySchemasV43.construct,progress,read]),
 challenge:theorySchemasV43.challenge,
 instantiate:theorySchemasV43.instantiate,
 'application-review':theorySchemasV43['application-review'],
};
export type PurposeV44=keyof typeof theorySchemasV44;
export interface ResearchStateV44 {
 phase:PurposeV44|'parked'|'closed';
 host:{rootContext:RootContextV43; originContext:RootContextV43;contextUpdates:{at:number;rootContext:RootContextV43}[]; initial:StagePassage[]; catalogue:StagePassage[]; sources:{stageId:string;hash:string}[]; prior?:{recordId:string;question:string;findings:string[];alternatives?:string[];discriminatingQuestion?:string;candidate?:ResearchStateV43['candidate'];challenge?:ResearchStateV43['challenge']};};
 assessment?:any; scopeReview?:any; candidate?:ResearchStateV43['candidate'];challenge?:ResearchStateV43['challenge'];application?:ResearchStateV43['application'];applicationReview?:ResearchStateV43['applicationReview'];
 inquiry?:string;findings:string[];alternatives:string[];discriminatingQuestion?:string;
 reads:{selections:number[];opened:string[];missing:number[]}[];responses:unknown[];
}
export function createResearchV44(stages:readonly StagePassage[],rootContext:RootContextV43,catalogue:readonly StagePassage[]=stages,prior?:ResearchStateV44['host']['prior']):ResearchStateV44 {
 if(!stages.length||!rootContext.originalProblem.trim()||!rootContext.remainingObligations.length)throw Error('Missing structural research context');
 const ordered=[...new Map([...stages,...catalogue].map(s=>[s.stageId,s])).values()].slice(0,20);
 return {phase:prior?'scope-review':'assess',host:structuredClone({rootContext,originContext:rootContext,contextUpdates:[],initial:[...stages],catalogue:ordered,sources:stages.map(s=>({stageId:s.stageId,hash:stableHash(s)})),...(prior?{prior}:{})}),
 ...(prior?{inquiry:prior.question,assessment:{decision:'construct',agenda:prior.question,rationale:'Revisit a persisted inquiry using new public evidence.'}}:{}),findings:[],alternatives:[],reads:[],responses:[]};
}
export function advanceResearchV44(state:ResearchStateV44,response:unknown):ResearchStateV44 {
 if(['closed','parked'].includes(state.phase)||!Value.Check(theorySchemasV44[state.phase as PurposeV44],response))throw Error('Invalid structural research response');
 const next=structuredClone(state),v=response as any;next.responses.push(structuredClone(response));
 if(v.decision==='read'){
  const opened:string[]=[],missing:number[]=[];
  for(const n of v.selections){const source=state.host.catalogue[n-1];
   if(!source||(!next.host.sources.some(s=>s.stageId===source.stageId)&&next.host.sources.length>=6)){missing.push(n);continue;}
   if(!next.host.sources.some(s=>s.stageId===source.stageId))next.host.sources.push({stageId:source.stageId,hash:stableHash(source)});
   opened.push(source.stageId);
  }
  next.reads.push({selections:v.selections,opened,missing});return next;
 }
 switch(state.phase){
 case 'assess':next.assessment=v;next.inquiry=v.agenda;next.phase=['construct','identify'].includes(v.decision)?'scope-review':v.decision==='pending'||v.decision==='watch'?'parked':'closed';break;
 case 'scope-review':next.scopeReview=v;next.inquiry=v.inquiry??state.inquiry;next.phase=v.decision==='close'?'closed':v.decision==='park'?'parked':v.decision==='identify'?'construct':'probe';break;
 case 'probe':case 'construct':
  if(v.decision==='candidate'){next.candidate=v;next.phase='challenge';break;}
  if(v.decision==='no-change'){next.phase='closed';break;}
  if(v.alternatives?.length>1&&!v.discriminatingQuestion)throw Error('Competing explanations require a discriminating inquiry');
  delete next.candidate;delete next.challenge;delete next.application;delete next.applicationReview;
  next.findings.push(v.finding);next.alternatives=v.alternatives??state.alternatives;next.discriminatingQuestion=v.discriminatingQuestion??state.discriminatingQuestion;
  if(v.nextInquiry)next.inquiry=v.nextInquiry;
  next.phase=v.decision==='park'?'parked':v.decision==='revise'||v.nextInquiry&&v.nextInquiry!==state.inquiry?'scope-review':v.decision==='develop'?'construct':'probe';break;
 case 'challenge':next.challenge=v;if(v.verdict!=='supported'||v.contribution==='restatement')next.findings.push(v.argument);next.phase=v.verdict==='supported'&&v.contribution!=='restatement'&&(state.scopeReview?.decision!=='identify'&&state.assessment?.decision!=='identify'||v.contribution==='identification')?'instantiate':'parked';break;
 case 'instantiate':next.application=v;if(v.status==='pending')next.findings.push(v.reason);next.phase=v.status==='ready'?'application-review':'parked';break;
 case 'application-review':next.applicationReview=v;if(v.verdict!=='supported')next.findings.push(v.argument);next.phase=v.verdict==='supported'?'closed':'parked';break;
 }
 return next;
}
export function refreshResearchContextV44(state:ResearchStateV44,context:RootContextV43):ResearchStateV44 {
 if(stableHash(state.host.rootContext)===stableHash(context))return state;
 const next=structuredClone(state);next.host.rootContext=structuredClone(context);next.host.contextUpdates.push({at:state.responses.length,rootContext:structuredClone(context)});return next;
}
export function researchInputV44(purpose:PurposeV44,_stages:readonly StagePassage[],state:ResearchStateV44,knownTheories:readonly string[]) {
 const sourceOnly=['assess','probe','construct'].includes(purpose);
 const sources=state.host.catalogue.filter(s=>state.host.sources.some(r=>r.stageId===s.stageId)).map(s=>({body:s.passage,conditions:s.conditions,status:s.fragment?.status}));
 return {sources,summaryIndex:state.host.catalogue.map((s,i)=>({selection:i+1,label:`Public stage ${i+1}`,relation:s.rootId===state.host.rootContext.target.rootId?'current-root':'authorized-history',opened:state.host.sources.some(r=>r.stageId===s.stageId)})),reads:state.reads.map(r=>({selections:r.selections,missing:r.missing})),knownTheories,
 inquiry:state.inquiry,findings:state.findings,prior:state.host.prior,alternatives:state.alternatives,discriminatingQuestion:state.discriminatingQuestion,
 ...(!sourceOnly?{rootContext:state.host.rootContext,candidate:state.candidate,...(purpose==='application-review'?{application:state.application}:{})}:{})};
}
export function qualifyApplicationV44(state:ResearchStateV44,stages:readonly StagePassage[],expected:{projectId:string;epochId:string;rootId:string}) {
 const target=state.host.rootContext.target;
 if(state.phase!=='closed'||state.application?.status!=='ready'||state.applicationReview?.verdict!=='supported'||state.challenge?.verdict!=='supported'||state.challenge.contribution==='restatement'||!state.candidate||!state.scopeReview||['close','park'].includes(state.scopeReview.decision))return;
 if(Object.entries(expected).some(([k,v])=>target[k as keyof typeof target]!==v)||state.host.sources.some(r=>!stages.some(s=>s.stageId===r.stageId&&stableHash(s)===r.hash)))return;
 return {...structuredClone(state.application),target:structuredClone(target),evidence:{kind:'reviewed-argument' as const,sources:state.host.sources,review:state.applicationReview}};
}
export function publicationResearchV44(input:ResearchStateV44):ResearchStateV44 {
 let state=createResearchV44(input.host.initial,input.host.originContext,input.host.catalogue,input.host.prior);
 for(const [at,response] of input.responses.entries()){
  for(const update of input.host.contextUpdates.filter(u=>u.at===at))state=refreshResearchContextV44(state,update.rootContext);
  state=advanceResearchV44(state,response);
  if(state.challenge?.verdict==='supported')return state;
 }
 return state;
}
export interface ResearchPublicationV4R4 {
 id:string;content:{primitives:string;laws:string;modelConditions:string;construction:string;internalClaim:string;derivation:string;limits:string};
 support:{trialId:string;revision:'v4-operation-4';sources:{scope:{projectId:string;epochId:string;rootId:string};stage:StagePassage}[];sharedRefs?:{id:string;hash:string}[];responses:unknown[];target:{projectId:string;epochId:string;rootId:string};host:ResearchStateV44['host']};
}
export function validateResearchPublicationV44(value:ResearchPublicationV4R4):boolean {
 try{
  if(value.support.revision!=='v4-operation-4'||value.id!==value.support.trialId||!value.support.sources.length)return false;
  if(Object.entries(value.support.target).some(([k,v])=>value.support.host.rootContext.target[k as keyof RootContextV43['target']]!==v))return false;
  let state=createResearchV44(value.support.host.initial,value.support.host.originContext,value.support.host.catalogue,value.support.host.prior);
  for(const [at,response] of value.support.responses.entries()){for(const update of value.support.host.contextUpdates.filter(u=>u.at===at))state=refreshResearchContextV44(state,update.rootContext);state=advanceResearchV44(state,response);}
  if(stableHash(state.host)!==stableHash(value.support.host)||!state.candidate||state.challenge?.verdict!=='supported'||state.challenge.contribution==='restatement')return false;
  if(state.host.sources.some(ref=>!value.support.sources.some(row=>row.stage.stageId===ref.stageId&&stableHash(row.stage)===ref.hash&&row.stage.rootId===row.scope.rootId)))return false;
  return Object.entries(value.content).every(([k,v])=>state.candidate![k as keyof NonNullable<ResearchStateV44['candidate']>]===v);
 }catch{return false;}
}
