import {scopedOutcomeIssue} from '../v4/map-evidence-schema.js';
import {publicFragmentsV4,fragmentSupportV4,validatePublicStageV4,derivePublicStageV4} from '../v4/fragments.js';
import { isDeepStrictEqual } from 'node:util';
import type { RootV21 } from '../../contracts/v21.js';
import type { OptionalProofArtifactV21, OptionalOutcomeV21, OptionalProofSelectionV21 } from './optional-types.js';
import * as legacy from './optional-proof-op8.js';
import { classifyContinuationsV3 } from '../v3/continuations.js';
import type * as Legacy from './optional-types-op8.js';
const requireProof=(condition:unknown,message:string):void=>{if(!condition)throw new Error(`Optional proof: ${message}`);};
export function validateOptionalOutcomeV21(_root:RootV21,outcome:OptionalOutcomeV21,rootRequired:boolean):void {
 requireProof(new Set(outcome.dependencyArtifactIds).size===outcome.dependencyArtifactIds.length,'duplicate dependencies');
 if(outcome.resultKind==='open')return;
 requireProof(outcome.reproducible&&outcome.gaps.length===0,'qualified proof retains a gap or lacks reproducibility');
 if(rootRequired){
  requireProof(outcome.scope==='root','local proof cannot close the root');
 }
}
export function validateOptionalArtifactV21(root:RootV21,artifact:OptionalProofArtifactV21,all:OptionalProofArtifactV21[],rootRequired=true):void {
 if(!['v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??''))return legacy.validateOptionalArtifactV21(root,artifact as Legacy.OptionalProofArtifactV21,all as Legacy.OptionalProofArtifactV21[],rootRequired);
 requireProof(all.every(a=>(a.operationRevision??'v21-operation-8')===artifact.operationRevision),'mixed optional protocol revisions');
 requireProof(!artifact.resultContract||artifact.authorRole!=='auxiliary-worker'||!rootRequired,'auxiliary result cannot close the root');
 requireProof(isDeepStrictEqual(root,artifact.root),'artifact belongs to another exact root');
 requireProof(artifact.qualification==='valid'&&artifact.acceptedOutcome&&artifact.acceptedOutcome.resultKind!=='open','artifact has no explicit scientific adoption');
 requireProof(artifact.technical.executionStatus==='completed'&&artifact.technical.completeness==='complete'&&artifact.originalRef.completeness==='complete'&&artifact.originalRef.byteLength>0,'incomplete original');
 requireProof(artifact.originalRef.hypothesisId===root.hypothesisId&&artifact.originalRef.hypothesisRevision===root.revision,'original root identity mismatch');
 const visit=(current:OptionalProofArtifactV21,path:Set<string>,continuation=false,fragmentPremise=false):void=>{
  requireProof(!path.has(current.id),'circular proof dependency');
  const outcome=continuation||fragmentPremise?current.control.outcome:current.acceptedOutcome;
  if(!continuation&&!fragmentPremise)requireProof(current.qualification==='valid'&&outcome&&outcome.resultKind!=='open','unadopted or unresolved dependency');
  requireProof(current.operationRevision===artifact.operationRevision,'dependency protocol revision mismatch');
  const declared=current.control.outcome,compared=current.acceptedOutcome??outcome;
  requireProof(current.resultContract===artifact.resultContract,'dependency result contract mismatch');
  if(current.resultContract){
   requireProof(current.operationRevision==='v4-proof-5','scoped result outside its frozen V4 revision');
   for(const o of [declared,compared!]){
    const issue=scopedOutcomeIssue(o,current.mapKnowledge??[]);if(issue)requireProof(false,issue);
   }
   requireProof(declared.refutationKind===compared!.refutationKind,'adoption changed refutation kind');
   if(declared.resultKind==='valid-refutation'||declared.resultKind==='empirical-exclusion')requireProof(declared.reason===compared!.reason,'adoption changed the scope or reasoning of a refutation');
  }else requireProof([declared,compared!].every(o=>!o.refutationKind&&o.resultKind!=='empirical-exclusion')&&!current.mapKnowledge?.some(r=>r.kind==='observation'),'scoped evidence without its frozen result contract');
  const continuations=['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(current.operationRevision??'')?classifyContinuationsV3(current,all):[];
  if(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(current.operationRevision??''))requireProof(isDeepStrictEqual(current.continuationArtifactIds??[],continuations),'continuation classification mismatch');
  for(const field of ['knowledgeRefs','sourceRefs'] as const)requireProof(isDeepStrictEqual([...(declared[field]??[])].sort(),[...(compared![field]??[])].sort()),'adoption changed actual source dependencies');
  requireProof(isDeepStrictEqual([...(declared.receiptRefs??[])].sort(),[...(compared!.receiptRefs??[])].sort()),'adoption changed actual computational dependencies');
  if(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(current.operationRevision??'')){for(const id of declared.receiptRefs??[]){const receipt=all.flatMap(a=>a.v3Execution?.receipts??[]).find(r=>r.id===id);requireProof(receipt?.status==='completed','missing completed computational dependency');}}
  requireProof(declared.resultKind===compared!.resultKind&&declared.scope===compared!.scope,'adoption changed the original result kind or scope');
  requireProof(isDeepStrictEqual([...declared.dependencyArtifactIds].sort(),[...compared!.dependencyArtifactIds].sort()),'adoption changed the original actual dependencies');
  // Re-review can change a judgment, never fill a gap or assert reproducibility absent from the original.
  validateOptionalOutcomeV21(root,declared,false);
  requireProof(current.originalRef.completeness==='complete'&&current.originalRef.byteLength>0&&current.originalRef.owner===artifact.originalRef.owner&&current.originalRef.projectId===artifact.originalRef.projectId&&current.originalRef.hypothesisId===root.hypothesisId&&current.originalRef.hypothesisRevision===root.revision,'incomplete or foreign dependency original');
  validateOptionalOutcomeV21(root,outcome!,current===artifact&&rootRequired);
  const next=new Set([...path,current.id]);
  if(['v4-proof-3','v4-proof-4'].includes(current.operationRevision??'')&&current.authorRole==='theorist'){
   const ancestry=declared.dependencyArtifactIds.filter(id=>all.some(a=>a.id===id&&a.authorRole==='theorist'&&a.acceptanceCommitted&&isDeepStrictEqual(a.root,root)));
   requireProof(isDeepStrictEqual(current.control.publicStage,derivePublicStageV4(root,current.control,ancestry)),'host public stage projection mismatch');
  }
  if(current.operationRevision==='v4-proof-2'){
   const visible=all.flatMap(publicFragmentsV4).filter(f=>current.fragmentExposureRefs?.includes(f.stageId));
   if(current.control.publicStage)validatePublicStageV4(current.control.publicStage,root,visible,all.map(a=>a.id),current.authorRole==='theorist'?'root':current.control.publicStage.environments[0]!.branch);
   requireProof(isDeepStrictEqual([...(declared.fragmentRefs??[])].sort(),[...(compared!.fragmentRefs??[])].sort()),'adoption changed public fragment support');
   for(const ref of outcome!.fragmentRefs??[])requireProof(visible.some(f=>f.stageId===ref&&f.rootId===root.revision&&f.branch==='root'&&['argued','conditional'].includes(f.fragment.status)),'missing exposed public argument');
   for(const dependency of fragmentSupportV4(current,all))visit(dependency,next,false,true);
  }

  for(const id of outcome!.dependencyArtifactIds){
   requireProof(current.exposureArtifactIds.includes(id),'dependency was not delivered to this proof boundary');
   const dependency=all.find(a=>a.id===id);requireProof(dependency&&isDeepStrictEqual(root,dependency.root),'missing exact dependency');
   const ownContinuation=continuations.includes(id);
   if(!ownContinuation){
    const premise=dependency!.acceptedOutcome;
    const sameNegativeEvidence=current.resultContract&&premise?.resultKind===outcome!.resultKind&&
     (outcome!.resultKind==='empirical-exclusion'||outcome!.resultKind==='valid-refutation'&&outcome!.refutationKind===premise?.refutationKind);
    requireProof(premise?.resultKind==='supported-result'||sameNegativeEvidence,'negative evidence cannot discharge a positive premise or change refutation category');
   }
   requireProof(dependency!.technical.executionStatus==='completed'&&dependency!.technical.completeness==='complete','incomplete dependency');
   visit(dependency!,next,ownContinuation);
  }
 };
 visit(artifact,new Set());
}
export function optionalConflictsV21(root:RootV21,artifacts:OptionalProofArtifactV21[]):string[] {
 const candidates=artifacts.filter(a=>a.authorRole!=='auxiliary-worker'&&a.qualification!=='rejected'&&isDeepStrictEqual(a.root,root)&&a.technical.executionStatus==='completed'&&a.technical.completeness==='complete'&&a.control.outcome.scope==='root'&&a.control.outcome.resultKind!=='open'&&a.control.outcome.gaps.length===0);
 // A theoretical and an empirical exclusion of the same exact root have the same polarity.
 return new Set(candidates.map(a=>a.control.outcome.resultKind==='supported-result')).size>1?candidates.map(a=>a.id):[];
}
export function validateOptionalProofSelectionV21(selection:OptionalProofSelectionV21):void {
 requireProof(selection.resultContract===selection.artifact.resultContract&&selection.dependencies.every(a=>a.resultContract===selection.resultContract),'archive result contract mismatch');
 if(selection.resultContract)requireProof(selection.sourceLoopVersion==='4.0'&&selection.modelDirectedKnowledge,'scoped archive requires V4 knowledge provenance');
 if(!['v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(selection.artifact.operationRevision??''))return legacy.validateOptionalProofSelectionV21(selection as Legacy.OptionalProofSelectionV21);
 requireProof(selection.artifact.originalRef.projectId===selection.projectId&&selection.artifact.originalRef.owner===selection.projectId,'foreign original owner');
 validateOptionalArtifactV21(selection.root,selection.artifact,[selection.artifact,...selection.dependencies]);
 const needed=new Set<string>();
 const visit=(a:OptionalProofArtifactV21,continuation=false):void=>{
  const outcome=continuation?a.control.outcome:a.acceptedOutcome;
  for(const dependency of a.operationRevision==='v4-proof-2'?fragmentSupportV4(a,selection.dependencies):[]){if(!needed.has(dependency.id)){needed.add(dependency.id);visit(dependency,true);}}
  for(const id of outcome?.dependencyArtifactIds??[]){
   if(needed.has(id))continue;needed.add(id);
   const dependency=selection.dependencies.find(d=>d.id===id);requireProof(dependency,'dependency missing from archive');
   visit(dependency!,['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(a.operationRevision??'')&&!!a.continuationArtifactIds?.includes(id));
  }
 };visit(selection.artifact);
 requireProof(selection.dependencies.every(d=>needed.has(d.id))&&needed.size===selection.dependencies.length,'archive dependency grant overreach');
}
