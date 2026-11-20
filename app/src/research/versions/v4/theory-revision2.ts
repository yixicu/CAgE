import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { stableHash } from '../../../learning/research-hash.js';
import type { StagePassage } from './theory-trial.js';

const text = Type.String({minLength:1,pattern:'\\S'});
const texts = Type.Array(text,{uniqueItems:true});
const refs = Type.Array(text,{minItems:1,uniqueItems:true});
const obj = <P extends Record<string,TSchema>>(properties:P) => Type.Object(properties,{additionalProperties:false});
const baseline = obj({stageRefs:refs, established:text, attribution:text});
const contribution = obj({kind:Type.Union(['source-verification','source-identification','extraction','extension','reformulation'].map(v=>Type.Literal(v))), structuralDelta:text, independentQuestion:text, nonCircularity:text});
const probe = obj({question:text,prediction:text,status:Type.Literal('conjectural')});
const assessment = Type.Union([
 obj({decision:Type.Literal('pass'),reason:text,sourceBaseline:baseline,probe:Type.Optional(probe)}),
 obj({decision:Type.Literal('watch'),reason:text,signal:text,sourceBaseline:baseline,probe:Type.Optional(probe)}),
 obj({decision:Type.Literal('read-needed'),reason:text,fragmentRefs:refs,sourceBaseline:baseline}),
 obj({decision:Type.Literal('reuse'),reason:text,sourceBaseline:baseline,contributionAccount:contribution,theoryRef:Type.Optional(text),sourceStructureRefs:Type.Optional(refs)}),
 obj({decision:Type.Literal('construct'),mode:Type.Union([Type.Literal('consolidate'),Type.Literal('extend')]),sourceBaseline:baseline,contributionAccount:contribution,probe, nextInquiry:text}),
]);
const candidate = obj({primitives:text,laws:text,modelConditions:text,construction:text,internalClaim:text,derivation:text,interpretation:text,knownTheoryComparison:text,nonVacuity:text,boundaryEvidence:text,stageRefs:refs,theoryRefs:Type.Optional(texts),openObligations:texts,sourceBaseline:baseline,contributionAccount:contribution});
const construction = Type.Union([obj({decision:Type.Literal('no-change'),reason:text,contributionAccount:contribution}),candidate]);
const challenge = obj({verdict:Type.Union([Type.Literal('supported'),Type.Literal('revise'),Type.Literal('inconclusive'),Type.Literal('refuted')]),reason:text,internalArgument:text,interpretationCheck:text,nonVacuity:text,boundaryEvidence:text,contributionAccount:contribution,openObligations:texts,stageRefs:refs,theoryRefs:Type.Optional(texts)});
const target = obj({projectId:text,epochId:text,rootId:text,branch:text,premiseRevision:text,obligation:text});
const node = obj({id:text,kind:Type.Union(['source','theory','assumption','internal','interpretation','application'].map(v=>Type.Literal(v))),statement:text,argument:text,status:Type.Union(['argued','assumed-under-root','assumed-under-branch'].map(v=>Type.Literal(v))),dependsOn:texts,sourceRef:Type.Optional(text),assumptionRef:Type.Optional(text),branch:Type.Optional(text)});
const application = Type.Union([
 obj({status:Type.Literal('preparing'),reason:text,openObligations:refs}),
 obj({status:Type.Literal('ready'),target,conclusion:text,applicationArgument:text,interpretation:text,conditions:texts,rootNode:text,support:Type.Array(node,{minItems:3}),openObligations:Type.Array(text,{maxItems:0}),limits:text}),
]);
export const theorySchemasV42 = {assess:assessment,construct:construction,identify:candidate,challenge,instantiate:application};
export type PurposeV42 = keyof typeof theorySchemasV42;
export type CandidateV42 = Static<typeof candidate>;
export type ApplicationV42 = Static<typeof application>;
export interface ResearchStateV42 {
 phase:'assess'|'construct'|'identify'|'challenge'|'instantiate'|'closed';
 assessment?:Static<typeof assessment>; candidate?:CandidateV42; challenge?:Static<typeof challenge>; application?:ApplicationV42;
 responses:unknown[];
}
export function advanceResearchV42(state:ResearchStateV42,response:unknown,stages:readonly StagePassage[]):ResearchStateV42 {
 if(state.phase==='closed')throw new Error('V4 research already closed');
 const schema=theorySchemasV42[state.phase];
 if(!Value.Check(schema,response))throw new Error('Invalid revision-2 theory response');
 const next=structuredClone(state), value=structuredClone(response) as any;
 const granted=new Set(stages.map(s=>s.stageId));
 const check=(ids:string[])=>{if(ids.some(id=>!granted.has(id)))throw new Error('Theory source was not exposed');};
 if(value.sourceBaseline)check(value.sourceBaseline.stageRefs);
 if(value.stageRefs)check(value.stageRefs);
 next.responses.push(value);
 switch(state.phase){
 case 'assess':
  next.assessment=value;
  if(value.decision==='reuse'){
   if(!!value.theoryRef===!!value.sourceStructureRefs)throw new Error('Reuse needs exactly one existing or source identity');
   if(value.sourceStructureRefs)check(value.sourceStructureRefs);
   next.phase='identify';
  }else next.phase=value.decision==='construct'?'construct':'closed';
  break;
 case 'construct': case 'identify':
  if(value.decision==='no-change')next.phase='closed';
  else {
   if(stableHash(value.sourceBaseline)!==stableHash(state.assessment?.sourceBaseline))throw new Error('Source baseline changed during research');
   if(state.phase==='identify'&&value.contributionAccount.kind!=='source-identification')throw new Error('Source identification cannot claim extraction');
   next.candidate=value;next.phase='challenge';
  }
  break;
 case 'challenge': next.challenge=value;next.phase=value.verdict==='supported'?'instantiate':'closed';break;
 case 'instantiate':next.application=value;next.phase='closed';break;
 }
 return next;
}

/** Structural closure is a declared research argument, never a mathematical certificate. */
export function qualifyApplicationV42(state:ResearchStateV42, stages:readonly StagePassage[], expected:{projectId:string;epochId:string;rootId:string},theories:readonly {id:string;internalClaim:string;authority:string}[]=[]) {
 const app=state.application;
 if(app?.status!=='ready'||!state.candidate||state.challenge?.verdict!=='supported')return;
 if(app.target.projectId!==expected.projectId||app.target.epochId!==expected.epochId||app.target.rootId!==expected.rootId)return;
 const current=stages.filter(s=>s.rootId===expected.rootId);
 if(!current.some(s=>s.branch===app.target.branch&&s.premiseRevision===app.target.premiseRevision&&s.remainingObligations?.includes(app.target.obligation)))return;
 const branch=app.target.branch, conditions=app.conditions, candidateClaim=state.candidate.internalClaim, appInterpretation=app.interpretation;
 const sources=new Map(stages.map(s=>[s.stageId,s]));
 const nodes=new Map(app.support.map(n=>[n.id,n]));
 if(nodes.size!==app.support.length||!nodes.has(app.rootNode))return;
 const active=new Set<string>(), done=new Set<string>(), kinds=new Set<string>();
 function visit(id:string):boolean {
  if(active.has(id))return false;if(done.has(id))return true;
  const n=nodes.get(id);if(!n)return false;
  active.add(id);kinds.add(n.kind);
  if(n.kind==='internal'&&n.statement!==candidateClaim)return false;
  if(n.kind==='interpretation'&&n.statement!==appInterpretation)return false;
  if(n.kind==='source'){
   const source=sources.get(n.sourceRef??'');
   if(!source||n.status!=='argued'||source.fragment?.status!=='argued'||n.statement!==source.fragment.statement||!source.passage.trim())return false;
   if(source.branch!=='root'&&source.branch!==branch)return false;
   const assumptions=[...(source.environments??[]).flatMap(e=>e.assumptions),...source.fragment.localAssumptions];
   if(assumptions.some(a=>!n.dependsOn.some(id=>nodes.get(id)?.statement===a.statement)))return false;
   if((source.dependencies??[]).some(ref=>!n.dependsOn.some(id=>nodes.get(id)?.sourceRef===ref||sources.get(nodes.get(id)?.sourceRef??'')?.fragment?.id===ref)))return false;
  }else if(n.kind==='theory'){
   const theory=theories.find(t=>t.id===n.sourceRef);
   if(!theory||!['proof-backed','research-evidence'].includes(theory.authority)||n.status!=='argued'||n.statement!==theory.internalClaim)return false;
  }else if(n.kind==='assumption'){
   const source=sources.get(n.sourceRef??'');
   if(!source||source.rootId!==expected.rootId)return false;
   const assumption=[...(source.environments??[]).flatMap(e=>e.assumptions),...(source.fragment?.localAssumptions??[])].find(a=>a.id===n.assumptionRef);
   if(!assumption||assumption.statement!==n.statement||assumption.provenance!==n.status||!conditions.includes(n.statement))return false;
   if(n.status==='assumed-under-root'){ /* Root hypotheses remain available within a narrower branch. */ }
   else if(n.status==='assumed-under-branch'){if(n.branch!==branch||source.branch!==branch)return false;}
   else return false;
  }else if(n.status!=='argued'||!n.dependsOn.length)return false;
  if(n.dependsOn.some(dep=>!visit(dep)))return false;
  active.delete(id);done.add(id);return true;
 }
 if(!visit(app.rootNode)||nodes.get(app.rootNode)?.kind!=='application'||nodes.get(app.rootNode)?.statement!==app.conclusion||done.size!==nodes.size||!['internal','interpretation','application'].every(k=>kinds.has(k)))return;
 if(app.conditions.some(condition=>!app.support.some(node=>node.statement===condition)))return;
 return structuredClone(app);
}

export interface ResearchPublicationV4R2 {
 id:string;
 content:{primitives:string;laws:string;modelConditions:string;construction:string;internalClaim:string;derivation:string;limits:string};
 support:{trialId:string;revision:'v4-operation-2';exposureStageIds?:string[];sharedRefs?:{id:string;hash:string}[];sources:{scope:{projectId:string;epochId:string;rootId:string};stage:StagePassage}[];responses:unknown[];target:{projectId:string;epochId:string;rootId:string}};
}
export function validateResearchPublicationV42(value:ResearchPublicationV4R2):boolean {
 try {
  if(value.support.revision!=='v4-operation-2'||value.id!==value.support.trialId||!value.support.sources.length)return false;
  if(value.support.sharedRefs?.some(ref=>!ref.id||!ref.hash))return false;
  let state:ResearchStateV42={phase:'assess',responses:[]};
  const grants=[...value.support.sources.map(s=>s.stage),...(value.support.exposureStageIds??[]).map(stageId=>({stageId,passage:'Exposure metadata only',branch:'root',conditions:[]}))];
  for(const response of value.support.responses)state=advanceResearchV42(state,response,grants);
  const c=state.candidate;
  if(!c||state.challenge?.verdict!=='supported'||['source-verification','reformulation'].includes(state.challenge.contributionAccount.kind))return false;
  if([...c.stageRefs,...state.challenge.stageRefs].some(id=>!value.support.sources.some(s=>s.stage.stageId===id)))return false;
  return ['primitives','laws','modelConditions','construction','internalClaim','derivation'].every(k=>value.content[k as keyof typeof value.content]===c[k as keyof typeof c]);
 }catch{return false;}
}
