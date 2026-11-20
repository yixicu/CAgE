import { stableHash } from '../../../learning/research-hash.js';
import type { OperationReceiptV3 } from './operations.js';
export type EvidenceLevelV3 = 'exact'|'formal'|'conditional'|'numerical'|'heuristic'|'unknown';
export interface WorkspaceRecordV3 { id:string; kind:'fact'|'assumption'|'goal'; text:string; branchId:string; status:'verified'|'conditional'|'unverified'|'refuted'|'needs-review'; evidenceKind:EvidenceLevelV3; sourceRef:string; dependsOn:string[]; value?:unknown }
export interface WorkspaceV3 { version:1; originalQuestion:string; rootVersion:string; records:WorkspaceRecordV3[]; adoptedReceiptIds:string[] }
export function createWorkspaceV3(root:{originalQuestion:string;rootVersion:string}):WorkspaceV3 {if(!root.originalQuestion||!root.rootVersion)throw new Error('V3 root identity required.');return {version:1,...root,records:[],adoptedReceiptIds:[]};}
export function visibleWorkspaceRecordsV3(workspace:WorkspaceV3,branchId:string):WorkspaceRecordV3[]{return structuredClone(workspace.records.filter(r=>r.branchId==='root'||r.branchId===branchId));}
export function addWorkspaceRecordV3(workspace:WorkspaceV3,record:WorkspaceRecordV3):WorkspaceV3 {
 if(!record.id||!record.branchId||!record.sourceRef||!record.text||record.kind!=='fact'&&record.status==='verified'||record.status==='verified'&&!['exact','formal'].includes(record.evidenceKind))throw new Error('Invalid V3 evidence record.');
 const previous=workspace.records.find(r=>r.id===record.id);if(previous){if(stableHash(previous)!==stableHash(record))throw new Error('Immutable V3 evidence identity conflict.');return structuredClone(workspace);}
 const visible=new Map(visibleWorkspaceRecordsV3(workspace,record.branchId).map(r=>[r.id,r]));if(record.dependsOn.some(id=>!visible.has(id)))throw new Error('Unknown or cross-branch evidence dependency.');
 if(record.status==='verified'&&record.dependsOn.some(id=>{const r=visible.get(id)!;return r.kind!=='fact'||r.status!=='verified'||!['exact','formal'].includes(r.evidenceKind);}))throw new Error('Conditional or stale dependencies cannot yield verified facts.');
 return {...structuredClone(workspace),records:[...structuredClone(workspace.records),structuredClone(record)]};
}
export function adoptOperationReceiptV3(workspace:WorkspaceV3,receipt:OperationReceiptV3,branchId:string):WorkspaceV3 {
 if(receipt.inputBinding.rootVersion!==workspace.rootVersion||receipt.inputBinding.branchId!==branchId)throw new Error('V3 receipt root or branch mismatch.');
 const boundRefs=[...receipt.inputBinding.factRefs,...receipt.inputBinding.conditionRefs];const evidenceHash=stableHash(visibleWorkspaceRecordsV3(workspace,branchId).filter(r=>boundRefs.includes(r.id)));
 if(receipt.inputBinding.evidenceHash!==evidenceHash||receipt.id!==`receipt_${receipt.inputHash}`||receipt.callId!==`call_${receipt.inputHash}`||receipt.artifactRef!==`v3-artifact:${receipt.inputHash}`)throw new Error('V3 receipt evidence binding mismatch.');
 if(workspace.adoptedReceiptIds.includes(receipt.id))return structuredClone(workspace);
 if(receipt.status!=='completed')return structuredClone(workspace);
 const level=receipt.verification.kind,verified=['exact','formal'].includes(level)&&receipt.conditionalPremises.length===0;
 const next=addWorkspaceRecordV3(workspace,{id:`fact_${receipt.id}`,kind:'fact',text:`Registered operation ${receipt.operationId}: ${receipt.summary}. This establishes only the recorded local computation, not global proof completion.`,branchId,status:verified?'verified':'conditional',evidenceKind:level,sourceRef:receipt.artifactRef,dependsOn:[...receipt.inputBinding.factRefs,...receipt.inputBinding.conditionRefs],value:receipt.result});
 next.adoptedReceiptIds.push(receipt.id);return next;
}
/** Ordinary related links never participate: only actually used proof dependencies. */
export function invalidateWorkspaceEvidenceV3(workspace:WorkspaceV3,revokedRefs:string[]):WorkspaceV3 {const next=structuredClone(workspace),affected=new Set(revokedRefs);let changed=true;while(changed){changed=false;for(const r of next.records)if(!affected.has(r.id)&&(affected.has(r.sourceRef)||r.dependsOn.some(id=>affected.has(id)))){affected.add(r.id);changed=true;}}for(const r of next.records)if(affected.has(r.id))r.status='needs-review';return next;}
