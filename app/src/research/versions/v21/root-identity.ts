import { usesV3Proof } from '../v3/proof-version.js';
import { isDeepStrictEqual } from 'node:util';
import type { TSchema } from 'typebox';
import type { OperationContextV21 } from './operation-contract.js';
import type { PlanOutputV21, RootV21 } from '../../contracts/v21.js';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import { digestV21 } from './state.js';
export const ROOT_IDENTITY_RECIPE = 'host-root-identity-v1' as const;
const fields = ['hypothesisId','revision','semanticRevision','previousId','sourceCommandId'] as const;
function fail(message:string):never {throw new ContractValidationError([message],'semantic');}
/** Fresh classifier only. No scientific field or command selection is host-authored. */
export function rootIdentityEnabled(context:OperationContextV21,task:string):boolean {
 const {project:p,marker:m}=context,recipe=m.rootIdentityRecipe;
 if(recipe!==m.snapshot.rootIdentityRecipe)fail('Root identity recipe snapshot mismatch.');
 if(recipe===undefined)return false;
 const s=m.planningSelection;
 if(recipe!==ROOT_IDENTITY_RECIPE||task!=='v21_plan'||!usesV3Proof(p.researchLoopVersion)||m.projectId!==p.id||m.phase!=='planning'||m.optionalFlow||m.solverMode||m.snapshot.solverMode||m.snapshot.v3||m.promptRevision!=='categorized-v1'||m.snapshot.promptRevision!==m.promptRevision||!s||s.boundaryId!==m.snapshot.id||!s.commandIds.length||!s.pendingModifications.length||new Set(s.commandIds).size!==s.commandIds.length||!s.commandIds.every(id=>p.pendingModificationIds?.includes(id))||!isDeepStrictEqual(p.root,m.snapshot.root))fail('Invalid frozen root identity boundary.');
 return true;
}
export function rootIdentitySchema(schema:TSchema):void {
 const shape=schema as any,root=shape.properties.rootChange.properties.root;
 for(const key of fields)delete root.properties[key];
 root.required=root.required.filter((key:string)=>!fields.includes(key as typeof fields[number]));
 delete shape.properties.rootInterpretation;shape.required=(shape.required??[]).filter((key:string)=>key!=='rootInterpretation');
 shape.required=[...new Set([...shape.required,'rootChange'])];delete shape.anyOf;
 shape.properties.ways.maxItems=0;shape.properties.questions.maxItems=0;
}
export function bindRootIdentity(value:PlanOutputV21,context:OperationContextV21):PlanOutputV21 {
 const plan=structuredClone(value),change=plan.rootChange,{marker:m}=context,previous=m.snapshot.root;
 if(!change||plan.ways.length||plan.questions.length||plan.rootInterpretation)fail('Root classification requires only rootChange, without scientific dispatch or interpretation.');
 if(!m.planningSelection?.commandIds.includes(change.sourceCommandId))fail('Root change must select an exact frozen command.');
 const science={...change.root} as Partial<RootV21>;for(const key of fields)delete science[key];
 if(!science.completionCriteria?.length||!science.obligations?.length||new Set(science.obligations.map(o=>o.id)).size!==science.obligations.length)fail('Root requires complete criteria and unique scientific obligation IDs.');
 if(change.kind==='working'){
  const host:Partial<RootV21>={};for(const key of fields)if(Object.hasOwn(previous,key))(host as any)[key]=previous[key];
  change.root={...science,...host} as RootV21;
 }else{
  const hypothesisId='root_'+digestV21({recipe:ROOT_IDENTITY_RECIPE,projectId:context.project.id,predecessor:{id:previous.hypothesisId,revision:previous.revision},boundaryId:m.snapshot.id,commandId:change.sourceCommandId,kind:change.kind});
  const root={...science,hypothesisId,semanticRevision:previous.semanticRevision+1,previousId:previous.hypothesisId,sourceCommandId:change.sourceCommandId};
  change.root={...root,revision:digestV21({recipe:ROOT_IDENTITY_RECIPE,root})} as RootV21;
 }
 return plan;
}
export function validateRootIdentity(value:PlanOutputV21,context:OperationContextV21):void {
 if(!isDeepStrictEqual(value,bindRootIdentity(value,context)))fail('Canonical root identity does not match frozen science and lineage.');
}
