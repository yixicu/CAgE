import { isDeepStrictEqual } from 'node:util';
import { Value } from 'typebox/value';
import type { FrozenInvocationInputV0,OperationPinV0,SingleOutcomeV0,RootV0,PlanOutputV0,SelectionV0,SolveOutcomeV0 } from '../../contracts/v0.js';
import type { ResourceRef } from '../../../learning/research-data.js';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import { InputSchemaV0,SingleOutcomeSchemaV0 } from './schemas.js';
import { digestV0,validateOutcomeV0 } from './state.js';
import { validTagsV21 } from '../v21/tags.js';
import type { OperationContractV0 } from './operation-contract.js';

/** Mechanical normalization only. Choice and every scientific declaration come from the model. */
export function normalizeSingleV0(input:FrozenInvocationInputV0,value:SingleOutcomeV0):{root:RootV0;plan:PlanOutputV0;selection:SelectionV0;outcome:SolveOutcomeV0}{
 const root={...structuredClone(input.snapshot.root),...structuredClone(value.rootInterpretation??{})};
 const plan:PlanOutputV0={...(value.rootInterpretation?{rootInterpretation:structuredClone(value.rootInterpretation)}:{}),...(value.rootChange?{rootChange:structuredClone(value.rootChange)}:{}),candidates:value.candidates.map(c=>({methodKey:c.method,direction:c.method,conditions:[...c.conditions],unknownBridges:[...c.unknownBridges],returnToRoot:root.returnToRoot,resourceRefs:structuredClone(c.resourceRefs),p:c.p,estimateReason:c.reason})),blockers:[...value.gaps]};
 const routeId=`${input.callId}_model-choice`,inputHash=digestV0(input);
 const selection:SelectionV0={modelChoice:{selectedIndex:value.selectedIndex,inputHash,callId:input.callId,reason:value.choiceReason},planHash:inputHash,candidates:plan.candidates.map((c,i)=>({...c,id:i===value.selectedIndex?routeId:`${input.callId}_alternative_${i}`})),selectedWayId:value.selectedIndex===null?null:routeId,maxScore:value.selectedIndex===null?null:value.candidates[value.selectedIndex]!.p,tieRule:'first-in-plan',selectedAt:input.snapshot.startedAt};
 const outcome:SolveOutcomeV0={verdict:value.verdict,selectedWayId:routeId,rootId:root.hypothesisId,rootRevision:root.revision,obligations:structuredClone(value.obligations),conditions:value.conditionChecks.map(c=>c.condition),conditionChecks:structuredClone(value.conditionChecks),gaps:[...value.gaps],selfCheck:value.selfCheck,summary:value.summary,reproducible:value.reproducible,reproducibility:value.reproducibility,...(value.dependencySourceIds?{dependencySourceIds:[...value.dependencySourceIds]}:{}),tags:[...value.tags],outline:[...value.outline]};
 return {root,plan,selection,outcome};
}
export function createSingleOperationV0(input:unknown,requestedPin?:OperationPinV0):OperationContractV0 {
 if(!Value.Check(InputSchemaV0,input))throw new Error('Invalid frozen single-request input.');
 const frozen=structuredClone(input as unknown as FrozenInvocationInputV0),schema=structuredClone(SingleOutcomeSchemaV0);
 const pin:OperationPinV0={revision:'v0-operation-2',task:'v0_single',schemaDigest:digestV0(schema),inputHash:digestV0(frozen)};
 if(requestedPin&&!isDeepStrictEqual(requestedPin,pin))throw new Error('V0 single-request pin mismatch.');
 if(frozen.plan||frozen.selection||frozen.epochId!==frozen.snapshot.id)throw new Error('Single request cannot contain a preselected plan.');
 if(frozen.snapshot.sources.some(s=>digestV0(s.body)!==s.bodyHash)||frozen.resourceBodies.some(r=>digestV0(r.body)!==r.bodyHash))throw new Error('Frozen single-request bytes mismatch.');
 const unique=(refs:ResourceRef[])=>new Set(refs.map(r=>`${r.id}\0${r.version}`)).size===refs.length;
 if(!unique(frozen.loadedResources)||!unique(frozen.resourceBodies.map(r=>r.ref))||frozen.loadedResources.length!==frozen.resourceBodies.length||frozen.loadedResources.some(ref=>!frozen.resourceBodies.some(r=>isDeepStrictEqual(r.ref,ref)))||frozen.resourceBodies.some(r=>!frozen.snapshot.resourceCatalog.some(m=>m.id===r.ref.id&&m.version===r.ref.version&&m.enabled&&m.status==='valid')))throw new Error('Single request requires exact authorized preloaded resource bodies.');
 if(frozen.snapshot.resources.length!==frozen.loadedResources.length||frozen.snapshot.resourceCatalog.length!==frozen.loadedResources.length||frozen.snapshot.resources.some(r=>!frozen.loadedResources.some(ref=>isDeepStrictEqual(r,ref))))throw new Error('All frozen shortlisted resources must be loaded before the single request.');
 const validate=(value:unknown):SingleOutcomeV0=>{
  if(!Value.Check(schema,value))throw new ContractValidationError([...Value.Errors(schema,value)].slice(0,20).map(e=>`${e.instancePath}: ${e.message}`),'format');
  const v=value as unknown as SingleOutcomeV0;
  try{
   if(frozen.snapshot.rootInterpretationPending&&!v.rootInterpretation&&!v.rootChange)throw new Error('Interpret the complete original root in this response.');
   if(v.rootInterpretation&&(!frozen.snapshot.rootInterpretationPending||v.rootChange))throw new Error('Cannot replace a committed root interpretation.');
   if(frozen.planningSelection?.hypothesisCommandId&&!v.rootChange)throw new Error('Selected explicit root modification must be represented.');
   if(v.rootChange&&(v.rootChange.sourceCommandId!==frozen.planningSelection?.hypothesisCommandId||!frozen.planningSelection?.commandIds.includes(v.rootChange.sourceCommandId)||v.candidates.length||v.selectedIndex!==null||v.verdict!=='open'))throw new Error('Root modification must match command and pause without solving the old root.');
   const interpretation=v.rootChange?.interpretation??v.rootInterpretation??frozen.snapshot.root;
   if(!interpretation.obligations.length||!interpretation.completionCriteria.length||new Set(interpretation.obligations.map(o=>o.id)).size!==interpretation.obligations.length)throw new Error('Complete unique root obligations and completion criteria required.');
   if(!v.candidates.length){if(v.selectedIndex!==null||v.verdict!=='open'||!v.gaps.length&&!v.rootChange)throw new Error('No feasible route requires null choice and explicit open blockers.');}
   else {
    if(v.selectedIndex===null||v.selectedIndex>=v.candidates.length)throw new Error('Model must select an existing candidate index.');
    const chosen=v.candidates[v.selectedIndex]!;
    if(v.candidates.some((c,i)=>c.p>chosen.p||c.p===chosen.p&&i<v.selectedIndex!))throw new Error('Model choice violates supplied maximum-p, first-tie rule.');
   }
   for(const c of v.candidates)for(const ref of c.resourceRefs)if(!frozen.loadedResources.some(r=>isDeepStrictEqual(ref,r)))throw new Error('Route cited a resource not preloaded in this request.');
   const n=normalizeSingleV0(frozen,v);
   if(!v.rootChange)validateOutcomeV0(n.outcome,n.root,`${frozen.callId}_model-choice`,frozen.snapshot.sources.map(s=>s.ref));
   if(!validTagsV21(v.tags))throw new Error('Invalid archive tags.');
  }catch(error){throw new ContractValidationError([error instanceof Error?error.message:'Single request semantic failure.'],'semantic');}
  return structuredClone(v);
 };
 return {pin,schema,prepare:validate,validatePrepared:validate,observeEvidence(){/* Preloaded exact bodies are already frozen; later tools cannot expand authority. */}};
}
