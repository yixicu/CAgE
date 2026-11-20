import { createHash } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { RootV21 } from '../../contracts/v21.js';
import type { OptionalControlV21, OptionalProofArtifactV21 } from '../v21/optional-types.js';
const text=Type.String({minLength:1,pattern:'\\S'}), strings=Type.Array(text,{uniqueItems:true});
const assumption=Type.Object({id:text,statement:text,provenance:Type.Union([Type.Literal('assumed-under-root'),Type.Literal('assumed-under-branch')]),sourceRef:text},{additionalProperties:false});
const environment=Type.Object({id:text,branch:text,symbols:Type.Record(Type.String(),text),definitions:Type.Array(text),assumptions:Type.Array(assumption)},{additionalProperties:false});
const fragment=Type.Object({id:text,contextRefs:Type.Array(text,{minItems:1,uniqueItems:true}),localAssumptions:Type.Array(assumption),statement:text,status:Type.Union([Type.Literal('proposed'),Type.Literal('conditional'),Type.Literal('argued'),Type.Literal('contradicted'),Type.Literal('unresolved')]),derivation:text,dependsOn:strings},{additionalProperties:false});
export const PublicStageSchemaV4=Type.Object({environments:Type.Array(environment,{minItems:1}),fragments:Type.Array(fragment,{minItems:1}),remainingObligations:strings,continuationArtifactIds:strings},{additionalProperties:false});
export type AssumptionV4=Static<typeof assumption>;
export type EnvironmentV4=Static<typeof environment>;
export type MathematicalFragmentV4=Static<typeof fragment>;
export type PublicStageV4=Static<typeof PublicStageSchemaV4>;
export interface PublicFragmentV4 {stageId:string;artifactId:string;producerId:string;rootId:string;branch:string;premiseRevision:string;bodyHash:string;dependencies:string[];fragment:MathematicalFragmentV4;environments:EnvironmentV4[];passage:string;conditions:string[]}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Mechanical attributed projection, not a claim that all scientific conditions were enumerated. */
export function derivePublicStageV4(root:RootV21,control:OptionalControlV21,ancestry:readonly string[],branch='root'):PublicStageV4 {
 const outcome=control.outcome,sourceRef=`root:${root.hypothesisId}:${root.revision}`;
 const passage=[outcome.reason,...(outcome.outline??[])].filter(text=>text.trim()).join('\n');
 return {environments:[{id:'context',branch,symbols:structuredClone(root.symbols),definitions:[],
  assumptions:root.conditions.map((statement,index)=>({id:`root-condition-${index}`,statement,provenance:'assumed-under-root',sourceRef}))}],
  fragments:[{id:'statement',contextRefs:['context'],localAssumptions:[],statement:outcome.reason,
   status:outcome.resultKind==='open'?'unresolved':outcome.resultKind==='valid-refutation'?'contradicted':'argued',
   derivation:passage,dependsOn:[]}],
  remainingObligations:[...new Set(outcome.gaps.length?outcome.gaps:outcome.resultKind==='open'?(root.obligations.length?root.obligations.map(o=>o.statement):[root.originalText]):[])],continuationArtifactIds:[...new Set(ancestry)]};
}
export function publicFragmentsV4(a:OptionalProofArtifactV21):PublicFragmentV4[]{
 if(!['v4-proof-2','v4-proof-3','v4-proof-4'].includes(a.operationRevision??'')||!a.control.publicStage||!a.acceptanceCommitted||a.technical.executionStatus!=='completed'||a.originalRef.completeness!=='complete'||['needs-review','rejected'].includes(a.qualification))return [];
 return a.control.publicStage.fragments.map(fragment=>{
  const environments=a.control.publicStage!.environments.filter(e=>fragment.contextRefs.includes(e.id));
  const body={fragment,environments},passage=['v4-proof-3','v4-proof-4'].includes(a.operationRevision??'')?fragment.derivation:JSON.stringify(body),branch=environments[0]!.branch;
  return {stageId:`${a.id}/fragment/${fragment.id}`,artifactId:a.id,producerId:a.originalRef.callId,rootId:a.root.revision,branch,premiseRevision:digest(environments),bodyHash:digest(body),dependencies:fragment.dependsOn.map(ref=>a.control.publicStage!.fragments.some(f=>f.id===ref)?`${a.id}/fragment/${ref}`:ref).filter(ref=>ref.includes('/fragment/')),fragment:structuredClone(fragment),environments:structuredClone(environments),passage,conditions:[...environments.flatMap(e=>e.assumptions),...fragment.localAssumptions].map(a=>a.statement)};
 });
}
/** Author declarations remain research evidence; these checks establish identity and scoped support only. */
export function validatePublicStageV4(value:unknown,root:RootV21,available:readonly PublicFragmentV4[],ancestry:readonly string[],branch='root'):asserts value is PublicStageV4 {
 if(!Value.Check(PublicStageSchemaV4,value))throw new Error('Canonical public stage fields are missing or malformed.');
 const stage=value as PublicStageV4, envs=new Map(stage.environments.map(e=>[e.id,e])),fragments=new Map(stage.fragments.map(f=>[f.id,f]));
 if(envs.size!==stage.environments.length||fragments.size!==stage.fragments.length)throw new Error('Duplicate public fragment/environment identity.');
 if(stage.continuationArtifactIds.some(id=>!ancestry.includes(id)))throw new Error('Unknown continuation ancestry.');
 const rootRef=`root:${root.hypothesisId}:${root.revision}`;
 const assumptions=(f:MathematicalFragmentV4)=>[...f.contextRefs.flatMap(id=>envs.get(id)?.assumptions??[]),...f.localAssumptions];
 const retain=(current:MathematicalFragmentV4,required:AssumptionV4[])=>{const actual=assumptions(current);if(required.some(a=>!actual.some(b=>digest(a)===digest(b))))throw new Error('Public dependency conditions were not retained in the receiving scope.');};
 for(const env of stage.environments){
  if(branch!=='root'&&env.branch!==branch)throw new Error('Public environment crosses its author branch.');
  for(const a of [...env.assumptions,...stage.fragments.filter(f=>f.contextRefs.includes(env.id)).flatMap(f=>f.localAssumptions)]){
   if(a.provenance==='assumed-under-root'&&a.sourceRef!==rootRef)throw new Error('Inherited root assumption has no exact root provenance.');
   if(a.provenance==='assumed-under-branch'&&(env.branch==='root'||a.sourceRef!==`branch:${env.branch}`))throw new Error('Branch assumption cannot become a root premise.');
  }
 }
 const visit=(id:string,path:Set<string>):void=>{
  if(path.has(id))throw new Error('Circular public fragment support.');
  const f=fragments.get(id);if(!f)throw new Error('Missing local fragment support.');
  if(f.contextRefs.some(ref=>!envs.has(ref)))throw new Error('Missing public environment.');
  const scope=envs.get(f.contextRefs[0]!)!.branch;
  if(f.contextRefs.some(ref=>envs.get(ref)!.branch!==scope))throw new Error('Fragment environments cross branch scopes.');
  const premises=new Set(f.contextRefs.flatMap(ref=>envs.get(ref)!.assumptions.map(a=>a.id)).concat(f.localAssumptions.map(a=>a.id)));
  for(const ref of f.dependsOn){
   if(premises.has(ref))continue;
   if(fragments.has(ref)){const dep=fragments.get(ref)!;if(dep.contextRefs.some(id=>!envs.has(id)||![scope,'root'].includes(envs.get(id)!.branch)))throw new Error('Public premise crosses branch scope.');if(!['argued','conditional'].includes(dep.status))throw new Error('Unresolved positive public premise.');retain(f,assumptions(dep));visit(ref,new Set([...path,id]));continue;}
   const dep=available.find(item=>item.stageId===ref);
   if(!dep||dep.rootId!==root.revision||![scope,'root'].includes(dep.branch)||!['argued','conditional'].includes(dep.fragment.status))throw new Error('Public premise was not exposed with valid exact scope.');
   retain(f,[...dep.environments.flatMap(e=>e.assumptions),...dep.fragment.localAssumptions]);
  }
 };
 for(const f of stage.fragments)visit(f.id,new Set());
}
export function fragmentSupportV4(a:OptionalProofArtifactV21,all:readonly OptionalProofArtifactV21[]):OptionalProofArtifactV21[]{
 const refs=new Set([...(a.control.outcome.fragmentRefs??[]),...(a.control.publicStage?.fragments.flatMap(f=>f.dependsOn)??[])]);
 return all.filter(item=>publicFragmentsV4(item).some(fragment=>refs.has(fragment.stageId)));
}

/** Bounded whole fragments with their exact prerequisite closure; omissions never remove conditions. */
export function boundedPublicFragmentsV4(artifacts:readonly OptionalProofArtifactV21[],maxBytes=32768,maxFragments=6):PublicFragmentV4[]{
 const all=artifacts.flatMap(publicFragmentsV4),selected=new Map<string,PublicFragmentV4>();
 const collect=(f:PublicFragmentV4,set:Map<string,PublicFragmentV4>):boolean=>{
  if(set.has(f.stageId))return true;set.set(f.stageId,f);
  for(const ref of f.dependencies){const dep=all.find(x=>x.stageId===ref);if(!dep||!collect(dep,set))return false;}return true;
 };
 for(const f of [...all].reverse()){const candidate=new Map(selected);if(collect(f,candidate)&&candidate.size<=maxFragments&&Buffer.byteLength(JSON.stringify([...candidate.values()]))<=maxBytes)for(const [id,item] of candidate)selected.set(id,item);}
 return [...selected.values()];
}
