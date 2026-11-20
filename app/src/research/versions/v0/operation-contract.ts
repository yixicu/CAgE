import { createProofOperationV0 } from './proof-operation.js';
import { createSingleOperationV0 } from './single-operation.js';
import { isDeepStrictEqual } from 'node:util';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import type { FrozenInvocationInputV0, OperationPinV0, PlanOutputV0, SolveOutcomeV0, SingleOutcomeV0, ProofOutcomeV0 } from '../../contracts/v0.js';
import type { ResourceRef } from '../../../learning/research-data.js';
import { InputSchemaV0,PlanSchemaV0,SolveOutcomeSchemaV0 } from './schemas.js';
import { digestV0,assertSelectionV0,validateOutcomeV0 } from './state.js';
import { validTagsV21 } from '../v21/tags.js';
export interface OperationContractV0 { pin:OperationPinV0;schema:TSchema;prepare(value:unknown):PlanOutputV0|SolveOutcomeV0|SingleOutcomeV0|ProofOutcomeV0;validatePrepared(value:unknown):PlanOutputV0|SolveOutcomeV0|SingleOutcomeV0|ProofOutcomeV0;observeEvidence(evidence:{resources?:ResourceRef[]}):void }
function exact(schema:TSchema,value:unknown):void {if(Value.Check(schema,value))return;const details=[...Value.Errors(schema,value)].slice(0,32).map(e=>({path:e.instancePath,keyword:e.keyword,message:e.message}));throw new ContractValidationError(details.map(d=>`${d.path}: ${d.message}`),'format',details);}
export function createOperationV0(task:'v0_plan'|'v0_solve'|'v0_single',input:unknown,_context?:unknown,requestedPin?:OperationPinV0):OperationContractV0 {
 if(task==='v0_single')return (requestedPin?.revision==='v0-operation-3'||requestedPin?.revision==='v0-operation-4')||(!requestedPin&&(input as FrozenInvocationInputV0)?.responseMode==='proof-first')?createProofOperationV0(input,requestedPin):createSingleOperationV0(input,requestedPin);
 exact(InputSchemaV0,input);const frozen=structuredClone(input as FrozenInvocationInputV0),schema=structuredClone(task==='v0_plan'?PlanSchemaV0:SolveOutcomeSchemaV0);let loaded=structuredClone(frozen.loadedResources);
 const pin:OperationPinV0={revision:'v0-operation-1',task,schemaDigest:digestV0(schema),inputHash:digestV0(frozen)};
 if(requestedPin&&!isDeepStrictEqual(requestedPin,pin))throw new Error('V0 frozen operation pin mismatch.');
 if(frozen.epochId!==frozen.snapshot.id||frozen.snapshot.sources.some(s=>digestV0(s.body)!==s.bodyHash)||frozen.resourceBodies.some(r=>digestV0(r.body)!==r.bodyHash))throw new Error('V0 frozen input identity or exact bytes mismatch.');
 for(const h of frozen.history??[]){if(h.solve&&(h.body===undefined||digestV0(h.body)!==h.solve.answerRef.bodyHash||Buffer.byteLength(h.body)!==h.solve.answerRef.byteLength||h.solve.answerRef.projectId!==frozen.projectId||h.solve.answerRef.epochId!==h.epochId))throw new Error('Invalid exact prior-epoch public context.');}
 if(task==='v0_solve'){if(!frozen.plan||!frozen.selection||!frozen.selection.selectedWayId)throw new Error('Solve requires a durable selected plan.');assertSelectionV0(frozen.plan,frozen.selection,frozen.epochId);}
 const validate=(value:unknown):PlanOutputV0|SolveOutcomeV0|SingleOutcomeV0|ProofOutcomeV0=>{exact(schema,value);try{
  if(task==='v0_plan'){
   const p=value as PlanOutputV0;
   if(frozen.snapshot.rootInterpretationPending&&!p.rootInterpretation&&!p.rootChange)throw new Error('Initial planning must interpret the complete original root.');
   if(p.rootInterpretation&&(!frozen.snapshot.rootInterpretationPending||p.rootChange))throw new Error('Root interpretation only belongs to the initial uncommitted root.');
   if(frozen.planningSelection?.hypothesisCommandId&&!p.rootChange)throw new Error('Selected hypothesis modification requires its complete replacement root, not silent acknowledgement.');
   if(p.rootChange&&(p.rootChange.sourceCommandId!==frozen.planningSelection?.hypothesisCommandId||!frozen.planningSelection.commandIds.includes(p.rootChange.sourceCommandId)||p.candidates.length))throw new Error('Root change must cite selected command and cannot solve the old root in the same epoch.');
   const interpretation=p.rootChange?.interpretation??p.rootInterpretation;if(interpretation&&(!interpretation.obligations.length||!interpretation.completionCriteria.length||new Set(interpretation.obligations.map(o=>o.id)).size!==interpretation.obligations.length))throw new Error('Explicit complete scientific obligations and completion criteria are required.');
   if(!p.candidates.length&&!p.blockers.length&&!p.rootChange)throw new Error('Empty candidate list requires concrete blockers.');
   for(const candidate of p.candidates){if(!Number.isFinite(candidate.p))throw new Error('Route probability must be finite.');for(const ref of candidate.resourceRefs)if(!frozen.snapshot.resources.some(r=>isDeepStrictEqual(r,ref))||!loaded.some(r=>isDeepStrictEqual(r,ref)))throw new Error('Candidate resource requires actual authorized read of exact frozen version.');}
  }else {const outcome=value as SolveOutcomeV0;validateOutcomeV0(outcome,frozen.snapshot.root,frozen.selection!.selectedWayId!,frozen.snapshot.sources.map(s=>s.ref));if(!validTagsV21(outcome.tags))throw new Error('Outcome tags violate library dimensions or exact UTF-16 length.');}
 }catch(error){if(error instanceof ContractValidationError)throw error;throw new ContractValidationError([error instanceof Error?error.message:'V0 semantic contract failure.'],'semantic');}return structuredClone(value) as PlanOutputV0|SolveOutcomeV0|SingleOutcomeV0|ProofOutcomeV0;};
 return {pin,schema,prepare:validate,validatePrepared:validate,observeEvidence(e){if(e.resources)loaded=structuredClone(e.resources);}};
}
