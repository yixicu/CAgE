import { foregroundBudgetV4 } from '../v4/foreground-budget.js';
/** Frozen operational controls; absent policy means the historical contract, never OFF. */
import {isDeepStrictEqual} from 'node:util';
import {stableHash} from '../../../learning/research-hash.js';
import type {CapacityPolicyV3,RoleBudget} from '../../contracts/v1.js';
import type {ResearchConfigV21,InFlightEpochV21,EpochRecordV21} from '../../contracts/v21.js';
export function validateCapacityPolicyV3(value:unknown):asserts value is CapacityPolicyV3 {
 const p=value as CapacityPolicyV3;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='controlsEnabled,revision,settingsVersion'||p.revision!=='v3-capacity-1'||typeof p.controlsEnabled!=='boolean'||typeof p.settingsVersion!=='string'||!/^[a-f0-9]{64}$/.test(p.settingsVersion))throw new Error('Invalid frozen V3 capacity policy.');
}
export function budgetControlsEnabledV3(policy?:CapacityPolicyV3):boolean {
 if(policy===undefined)return true;validateCapacityPolicyV3(policy);return policy.controlsEnabled;
}
function settings(config:ResearchConfigV21):ResearchConfigV21 {
 const copy=structuredClone(config);for(const b of [copy.roleBudget,...Object.values(copy.workerBudgets)])delete b.capacityPolicy;return copy;
}
export function freezeCapacityConfigV3(config:ResearchConfigV21):ResearchConfigV21 {
 const frozen=settings(config);frozen.budgetControlEnabled??=true;
 if(typeof frozen.budgetControlEnabled!=='boolean')throw new Error('Invalid V3 budget-control setting.');
 const policy:CapacityPolicyV3={revision:'v3-capacity-1',controlsEnabled:frozen.budgetControlEnabled,settingsVersion:stableHash(frozen)};
 for(const b of [frozen.roleBudget,...Object.values(frozen.workerBudgets)])b.capacityPolicy=structuredClone(policy);return frozen;
}
export function originatingBudgetV3(config:ResearchConfigV21,frozen?:CapacityPolicyV3):RoleBudget {
 if(frozen){validateCapacityPolicyV3(frozen);if(!isDeepStrictEqual(config.roleBudget.capacityPolicy,frozen)||stableHash(settings(config))!==frozen.settingsVersion)throw new Error('Originating V3 settings differ from frozen capacity policy.');return structuredClone(config.roleBudget);}
 return structuredClone(freezeCapacityConfigV3(config).roleBudget);
}
export function modelConfigV3(config:ResearchConfigV21){return {...(config.defaultModel?{defaultModel:structuredClone(config.defaultModel)}:{}),...(config.roleModels?{roleModels:structuredClone(config.roleModels)}:{})};}
export function assertFrozenCapacityV3(epoch:InFlightEpochV21|EpochRecordV21):void {
 const {snapshot}=epoch,policy=snapshot.capacityPolicy,revision=epoch.optionalFlow?.operationRevision;
 const budgets=[snapshot.config.roleBudget,...Object.values(snapshot.config.workerBudgets)];
 if(policy===undefined){if(['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')||budgets.some(b=>b.capacityPolicy!==undefined))throw new Error('Missing frozen V3 capacity policy.');return;}
 validateCapacityPolicyV3(policy);
 if(!isDeepStrictEqual(snapshot.modelConfig,modelConfigV3(snapshot.config)))throw new Error('Frozen V3 model settings mismatch.');
 if(revision&&!['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)||!isDeepStrictEqual(snapshot.config,freezeCapacityConfigV3(snapshot.config))||stableHash(settings(snapshot.config))!==policy.settingsVersion||budgets.some(b=>!isDeepStrictEqual(b.capacityPolicy,policy)))throw new Error('Frozen V3 capacity settings mismatch.');
 for(const branch of epoch.optionalFlow?.branches??[]){if(!isDeepStrictEqual(branch.frozen.budget,foregroundBudgetV4(snapshot,snapshot.config.workerBudgets[branch.frozen.effort])))throw new Error('Worker capacity differs from its originating boundary.');if(!isDeepStrictEqual(branch.frozen.model,snapshot.modelConfig.roleModels?.worker??snapshot.modelConfig.defaultModel))throw new Error('Worker model differs from its originating boundary.');}
 for(const call of epoch.calls)if(call.task==='v21_theorist'&&!isDeepStrictEqual((call.input as {capacityPolicy?:unknown})?.capacityPolicy,policy))throw new Error('Theorist input capacity differs from its frozen boundary.');
}
