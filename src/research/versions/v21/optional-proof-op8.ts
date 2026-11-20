import { isDeepStrictEqual } from 'node:util';
import type { RootV21 } from '../../contracts/v21.js';
import type { OptionalProofArtifactV21, OptionalOutcomeV21, OptionalProofSelectionV21 } from './optional-types-op8.js';
import { validTagsV21 } from './tags.js';
const requireProof=(condition:unknown,message:string):void=>{if(!condition)throw new Error(`Optional proof: ${message}`);};
export function validateOptionalOutcomeV21(root:RootV21,outcome:OptionalOutcomeV21,rootRequired:boolean):void {
 requireProof(new Set(outcome.obligationIds).size===outcome.obligationIds.length,'duplicate obligations');
 requireProof(outcome.obligationIds.every(id=>root.obligations.some(o=>o.id===id)),'foreign root obligation');
 requireProof(new Set(outcome.dependencyArtifactIds).size===outcome.dependencyArtifactIds.length,'duplicate dependencies');
 if(outcome.resultKind==='open')return;
 requireProof(outcome.reproducible&&outcome.gaps.length===0,'qualified proof retains a gap or lacks reproducibility');
 requireProof(validTagsV21(outcome.tags),'qualified proof needs valid existing classification tags');
 requireProof(outcome.reason.trim()&&outcome.outline.length&&outcome.outline.every(line=>line.trim()),'qualified proof needs substantive reason and outline');
 if(rootRequired){
  requireProof(outcome.scope==='root','local proof cannot close the root');
  requireProof(root.obligations.every(o=>outcome.obligationIds.includes(o.id)),'incomplete exact root coverage');
  requireProof(outcome.conditions.every(c=>root.conditions.includes(c)),'undischarged extra global condition');
 }
}
export function validateOptionalArtifactV21(root:RootV21,artifact:OptionalProofArtifactV21,all:OptionalProofArtifactV21[],rootRequired=true):void {
 requireProof(isDeepStrictEqual(root,artifact.root),'artifact belongs to another exact root');
 requireProof(artifact.qualification==='valid'&&artifact.acceptedOutcome&&artifact.acceptedOutcome.resultKind!=='open','artifact has no explicit scientific adoption');
 requireProof(artifact.technical.executionStatus==='completed'&&artifact.technical.completeness==='complete'&&artifact.originalRef.completeness==='complete'&&artifact.originalRef.byteLength>0,'incomplete original');
 requireProof(artifact.originalRef.hypothesisId===root.hypothesisId&&artifact.originalRef.hypothesisRevision===root.revision,'original root identity mismatch');
 const visit=(current:OptionalProofArtifactV21,path:Set<string>):void=>{
  requireProof(!path.has(current.id),'circular proof dependency');
  const outcome=current.acceptedOutcome;requireProof(current.qualification==='valid'&&outcome&&outcome.resultKind!=='open','unadopted or unresolved dependency');
  requireProof(current.originalRef.completeness==='complete'&&current.originalRef.byteLength>0&&current.originalRef.owner===artifact.originalRef.owner&&current.originalRef.projectId===artifact.originalRef.projectId&&current.originalRef.hypothesisId===root.hypothesisId&&current.originalRef.hypothesisRevision===root.revision,'incomplete or foreign dependency original');
  validateOptionalOutcomeV21(root,outcome!,current===artifact&&rootRequired);
  const next=new Set([...path,current.id]);
  for(const id of outcome!.dependencyArtifactIds){
   requireProof(current.exposureArtifactIds.includes(id),'dependency was not delivered to this proof boundary');
   const dependency=all.find(a=>a.id===id);requireProof(dependency&&isDeepStrictEqual(root,dependency.root),'missing exact dependency');
   requireProof(dependency!.acceptedOutcome?.resultKind==='supported-result','refutation does not discharge a positive premise');
   requireProof(dependency!.acceptedOutcome!.conditions.every(c=>root.conditions.includes(c)),'conditional dependency remains unclosed');
   requireProof(dependency!.technical.executionStatus==='completed'&&dependency!.technical.completeness==='complete','incomplete dependency');
   visit(dependency!,next);
  }
 };
 visit(artifact,new Set());
}
export function optionalConflictsV21(root:RootV21,artifacts:OptionalProofArtifactV21[]):string[] {
 const candidates=artifacts.filter(a=>a.authorRole!=='auxiliary-worker'&&a.qualification!=='rejected'&&isDeepStrictEqual(a.root,root)&&a.technical.executionStatus==='completed'&&a.technical.completeness==='complete'&&a.control.outcome.scope==='root'&&a.control.outcome.resultKind!=='open'&&a.control.outcome.gaps.length===0);
 return new Set(candidates.map(a=>a.control.outcome.resultKind)).size>1?candidates.map(a=>a.id):[];
}
export function validateOptionalProofSelectionV21(selection:OptionalProofSelectionV21):void {
 requireProof(selection.artifact.originalRef.projectId===selection.projectId&&selection.artifact.originalRef.owner===selection.projectId,'foreign original owner');
 validateOptionalArtifactV21(selection.root,selection.artifact,[selection.artifact,...selection.dependencies]);
 const needed=new Set<string>();const visit=(a:OptionalProofArtifactV21)=>{for(const id of a.acceptedOutcome?.dependencyArtifactIds??[]){if(needed.has(id))continue;needed.add(id);const dependency=selection.dependencies.find(d=>d.id===id);requireProof(dependency,'dependency missing from archive');visit(dependency!);}};visit(selection.artifact);
 requireProof(selection.dependencies.every(d=>needed.has(d.id))&&needed.size===selection.dependencies.length,'archive dependency grant overreach');
}
