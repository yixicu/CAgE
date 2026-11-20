import type { ResourceRef } from '../../../learning/research-data.js';
import type { OperationReceiptV3 } from './operations.js';
import type { WorkspaceV3 } from './workspace.js';
export interface EvidenceUseV3 {dependencyArtifactIds:string[];fragmentRefs?:string[];receiptRefs?:string[];knowledgeRefs?:string[];sourceRefs?:string[]}
export interface RevocationArtifactV3 {operationRevision?:string;id:string;route:{resourceRefs:ResourceRef[]};control:{publicStage?:import('../v4/fragments.js').PublicStageV4;outcome:EvidenceUseV3};acceptedOutcome?:EvidenceUseV3;v3Execution?:{receipts:OperationReceiptV3[]}}
/** Live revocation follows recorded proof usage, never ordinary knowledge navigation links. */
export function affectedArtifactsV3(artifacts:readonly RevocationArtifactV3[],revokedKnowledgeIds:readonly string[],revokedSourceIds:readonly string[],revokedResourceRefs:readonly ResourceRef[],workspace?:WorkspaceV3,additionalReceipts:readonly OperationReceiptV3[]=[],initialAffected:readonly string[]=[]):string[] {
 const knowledge=new Set(revokedKnowledgeIds),sources=new Set(revokedSourceIds),resources=new Set(revokedResourceRefs.map(r=>JSON.stringify([r.id,r.version]))),records=new Map(workspace?.records.map(r=>[r.id,r])??[]);
 const receipts=new Map([...additionalReceipts,...artifacts.flatMap(a=>a.v3Execution?.receipts??[])].map(r=>[r.id,r])),receiptByArtifact=new Map([...receipts.values()].map(r=>[r.artifactRef,r]));
 const sourceRevoked=(ref:string)=>sources.has(ref)||revokedSourceIds.some(id=>ref===`source:${id}`||ref.startsWith(`source:${id}:`));
 const evidenceBad=(id:string,visiting:Set<string>):boolean=>{
  if(visiting.has(id))return true;const next=new Set(visiting);next.add(id);
  const record=records.get(id);if(!record)return true;
  if(['needs-review','refuted','unverified'].includes(record.status)||sourceRevoked(record.sourceRef)||knowledge.has(record.sourceRef))return true;
  const producer=receiptByArtifact.get(record.sourceRef);if(producer&&receiptBad(producer.id,next))return true;
  return record.dependsOn.some(ref=>evidenceBad(ref,next));
 };
 const receiptBad=(id:string,visiting:Set<string>):boolean=>{
  if(visiting.has(id))return true;const next=new Set(visiting);next.add(id);
  const receipt=receipts.get(id);if(!receipt||receipt.status!=='completed'||sourceRevoked(receipt.artifactRef))return true;
  return [...receipt.inputBinding.factRefs,...receipt.inputBinding.conditionRefs].some(ref=>evidenceBad(ref,next));
 };
 const affected=new Set<string>(initialAffected);
 for(const artifact of artifacts){const uses=[artifact.control.outcome,...(artifact.acceptedOutcome?[artifact.acceptedOutcome]:[])];
  if(artifact.route.resourceRefs.some(ref=>resources.has(JSON.stringify([ref.id,ref.version])))||uses.some(use=>(use.knowledgeRefs??[]).some(ref=>knowledge.has(ref))||(use.sourceRefs??[]).some(sourceRevoked)||(use.receiptRefs??[]).some(id=>receiptBad(id,new Set()))))affected.add(artifact.id);
 }
 let changed=true;while(changed){changed=false;for(const artifact of artifacts){if(affected.has(artifact.id))continue;const dependencies=[...artifact.control.outcome.dependencyArtifactIds,...(artifact.acceptedOutcome?.dependencyArtifactIds??[])];if(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')){const refs=[...(artifact.control.outcome.fragmentRefs??[]),...(artifact.acceptedOutcome?.fragmentRefs??[]),...(artifact.control.publicStage?.fragments.flatMap(f=>f.dependsOn)??[])];for(const source of artifacts)if(source.control.publicStage?.fragments.some(f=>refs.includes(`${source.id}/fragment/${f.id}`)))dependencies.push(source.id);}if(dependencies.some(id=>affected.has(id))){affected.add(artifact.id);changed=true;}}}
 return artifacts.filter(a=>affected.has(a.id)).map(a=>a.id);
}
