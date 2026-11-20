import { isDeepStrictEqual } from 'node:util';
import { Value } from 'typebox/value';
import type { FrozenInvocationInputV0,OperationPinV0,ProofOutcomeV0,RootV0,PlanOutputV0,SelectionV0,SolveOutcomeV0 } from '../../contracts/v0.js';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import { InputSchemaV0,ProofOutcomeSchemaV0 } from './schemas.js';
import { digestV0,validateOutcomeV0 } from './state.js';
import { validTagsV21 } from '../v21/tags.js';
import type { OperationContractV0 } from './operation-contract.js';

/** No scientific decomposition is guessed: the model's closed receipt attests the exact whole question. */
export function proofRootV0(input:FrozenInvocationInputV0,target?:string):RootV0 {
 const root=structuredClone(input.snapshot.root);
 if(!input.snapshot.rootInterpretationPending&&!target)return root;
 const text=target??root.originalText;
 return {...root,originalText:text,domain:[],conditions:[],symbols:{},strength:text,returnToRoot:text,completionCriteria:[text],obligations:[{id:'original-question',statement:text}]};
}
export function normalizeProofV0(input:FrozenInvocationInputV0,value:ProofOutcomeV0|null):{root:RootV0;plan:PlanOutputV0;selection:SelectionV0;outcome:SolveOutcomeV0}{
 const root=proofRootV0(input,value?.rootReplacement),routeId=`${input.callId}_model-choice`,inputHash=digestV0(input);
 const gaps=value?[...value.gaps,...value.extraAssumptions]:['The complete answer is retained; no valid model declaration was obtained. Scientific status is unassessed.'];
 const verdict=value?.verdict??'open',refNote='Explicit whole-question model declaration; see the immutable original proof. This is not independent verification.';
 const resources=value?.usedResourceIds?.map(id=>input.loadedResources.find(r=>r.id===id)!)??[];
 const plan:PlanOutputV0={candidates:value?.candidates.map((c,index)=>({methodKey:c.method,direction:c.method,conditions:[],unknownBridges:[],returnToRoot:root.originalText,resourceRefs:index===value.selectedIndex?structuredClone(resources):[],p:c.p,estimateReason:'Model-reported route estimate; reasoning is in the original answer.'}))??[],blockers:gaps};
 const chosen=value?.selectedIndex??null;
 const selection:SelectionV0={modelChoice:{selectedIndex:chosen,inputHash,callId:input.callId,reason:refNote},planHash:inputHash,candidates:plan.candidates.map((c,i)=>({...c,id:i===chosen?routeId:`${input.callId}_alternative_${i}`})),selectedWayId:chosen===null?null:routeId,maxScore:chosen===null?null:plan.candidates[chosen]!.p,tieRule:'first-in-plan',selectedAt:input.snapshot.startedAt};
 const conditionChecks:SolveOutcomeV0['conditionChecks']=root.conditions.map(condition=>({condition,basis:'root-context',reason:refNote,evidence:['Complete original proof']}));
 for(const condition of value?.extraAssumptions??[])if(!conditionChecks.some(c=>c.condition===condition))conditionChecks.push({condition,basis:'unresolved',reason:'Model explicitly declared an additional unproved premise.',evidence:['Complete original proof']});
 const outcome:SolveOutcomeV0={verdict,selectedWayId:routeId,rootId:root.hypothesisId,rootRevision:root.revision,obligations:root.obligations.map(o=>({id:o.id,status:verdict==='open'?'open':value?.inapplicableObligationIds?.includes(o.id)?'inapplicable':'satisfied',reason:refNote,evidence:['Complete original proof']})),conditions:conditionChecks.map(c=>c.condition),conditionChecks,gaps,selfCheck:value?'The model was instructed to check the whole original question in its proof; the receipt is its claim, not independent verification.':'No model completion declaration available.',summary:value?`Model-declared ${verdict}; see the complete original proof.`:'Answer delivered; scientific declaration unassessed.',reproducible:value?.reproducible??false,reproducibility:value?.reproducible?'The model explicitly declares the original proof self-contained and reproducible.':'No affirmative model reproducibility declaration.',tags:[...(value?.subject?.trim()?[`subject:${value.subject.trim()}`]:[]),'problem-type:original-question'],outline:['Complete original proof']};
 return {root,plan,selection,outcome};
}
export function createProofOperationV0(input:unknown,requestedPin?:OperationPinV0):OperationContractV0 {
 if(!Value.Check(InputSchemaV0,input))throw new Error('Invalid proof-first input.');
 const frozen=structuredClone(input as unknown as FrozenInvocationInputV0),schema=structuredClone(ProofOutcomeSchemaV0);
 const pin:OperationPinV0={revision:frozen.snapshot.policyAssessment==='criteria-before-probability-v1'?'v0-operation-4':'v0-operation-3',task:'v0_single',schemaDigest:digestV0(schema),inputHash:digestV0(frozen)};
 if(requestedPin&&!isDeepStrictEqual(requestedPin,pin))throw new Error('Proof-first operation pin mismatch.');
 if(frozen.responseMode!=='proof-first'||frozen.plan||frozen.selection||frozen.epochId!==frozen.snapshot.id)throw new Error('Proof-first input must not preselect a route.');
 if(frozen.snapshot.sources.some(s=>digestV0(s.body)!==s.bodyHash)||frozen.resourceBodies.some(r=>digestV0(r.body)!==r.bodyHash))throw new Error('Frozen proof-first bytes mismatch.');
 const refs=frozen.loadedResources;
 if(new Set(refs.map(r=>r.id)).size!==refs.length||refs.length!==frozen.resourceBodies.length||refs.length!==frozen.snapshot.resourceCatalog.length||refs.length!==frozen.snapshot.resources.length||refs.some(ref=>!frozen.resourceBodies.some(r=>isDeepStrictEqual(r.ref,ref))||!frozen.snapshot.resources.some(r=>isDeepStrictEqual(r,ref))||!frozen.snapshot.resourceCatalog.some(r=>r.id===ref.id&&r.version===ref.version&&r.enabled&&r.status==='valid')))throw new Error('Exact authorized skills must be preloaded.');
 const validate=(value:unknown):ProofOutcomeV0=>{
  if(!Value.Check(schema,value))throw new ContractValidationError([...Value.Errors(schema,value)].slice(0,20).map(e=>`${e.instancePath}: ${e.message}`),'format');
  const v=value as unknown as ProofOutcomeV0;
  try{
   if(frozen.planningSelection?.hypothesisCommandId&&!v.rootReplacement)throw new Error('The selected user root modification needs an explicit replacement; do not solve the old question.');
   if(v.rootReplacement&&(!frozen.planningSelection?.hypothesisCommandId||!frozen.planningSelection.commandIds.includes(frozen.planningSelection.hypothesisCommandId)||v.candidates.length||v.selectedIndex!==null||v.verdict!=='open'))throw new Error('Only the selected user command permits a replacement; pause without proving the old target.');
   if(!v.candidates.length){if(v.selectedIndex!==null||v.verdict!=='open'||!v.gaps.length&&!v.rootReplacement)throw new Error('No route requires null choice, open status and stated gaps.');}
   else {if(v.selectedIndex===null||v.selectedIndex>=v.candidates.length)throw new Error('Choose an existing route.');const chosen=v.candidates[v.selectedIndex]!;if(v.candidates.some((c,i)=>c.p>chosen.p||c.p===chosen.p&&i<v.selectedIndex!))throw new Error('Declared actual route must obey highest score, first tie. Do not change the proof to repair a field.');}
   if(v.verdict!=='open'&&(v.gaps.length||v.extraAssumptions.length))throw new Error('Unresolved gaps or additional unproved premises forbid a closed whole-question claim.');
   if(v.verdict!=='open'&&v.reproducible&&!v.subject?.trim())throw new Error('A short subject label is needed to group this qualified proof for background Strategy learning. Keep the proof unchanged and supply only the missing classification in the receipt.');
   if(v.subject!==undefined&&!v.subject.trim())throw new Error('Optional subject must be nonblank; omit it if unknown.');
   if(v.usedResourceIds&&(new Set(v.usedResourceIds).size!==v.usedResourceIds.length||v.usedResourceIds.some(id=>!refs.some(r=>r.id===id))))throw new Error('Unknown or duplicate preloaded resource ID.');
   const n=normalizeProofV0(frozen,v);
   if(!validTagsV21(n.outcome.tags))throw new Error('Subject classification violates library dimensions or exact UTF-16 length; correct only this field.');
   if(v.inapplicableObligationIds&&(v.verdict!=='refuted'||new Set(v.inapplicableObligationIds).size!==v.inapplicableObligationIds.length||v.inapplicableObligationIds.some(id=>!n.root.obligations.some(o=>o.id===id))))throw new Error('Only explicitly identified original obligations can be inapplicable in a full-question refutation.');
   if(!v.rootReplacement)validateOutcomeV0(n.outcome,n.root,`${frozen.callId}_model-choice`,frozen.snapshot.sources.map(s=>s.ref));
  }catch(error){throw new ContractValidationError([error instanceof Error?error.message:'Invalid proof receipt.'],'semantic');}
  return structuredClone(v);
 };
 return {pin,schema,prepare:validate,validatePrepared:validate,observeEvidence(){}};
}
