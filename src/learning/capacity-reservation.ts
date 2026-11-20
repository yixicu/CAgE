/** New Moderator reservations bind one complete origin before queue publication. */
import {isDeepStrictEqual} from 'node:util';
import type {ModelSelection,RoleBudget} from '../research/contracts/v1.js';
import type {ResearchConfigV21} from '../research/contracts/v21.js';
import {freezeCapacityConfigV3,validateCapacityPolicyV3} from '../research/versions/v3/capacity-policy.js';
import {stableHash} from './research-hash.js';
export interface CapacityOriginV3 {projectId:string;model?:ModelSelection;budget:RoleBudget;settings:ResearchConfigV21}
export interface CapacityReservationV3 {capacityReservationRevision?:'v3-capacity-reservation-1';capacityOrigin?:CapacityOriginV3;capacityOriginBinding?:string}
function validateOrigin(origin:CapacityOriginV3):void {
 if(!origin||typeof origin.projectId!=='string'||!origin.projectId.trim()||!origin.settings||!origin.budget)throw new Error('Missing frozen Moderator capacity origin.');
 validateCapacityPolicyV3(origin.budget.capacityPolicy);
 const settings=freezeCapacityConfigV3(origin.settings);
 if(!isDeepStrictEqual(origin.settings,settings)||!isDeepStrictEqual(origin.budget,settings.roleBudget))throw new Error('Moderator capacity origin differs from its settings identity.');
 if(origin.model&&(!origin.model.provider||!origin.model.modelId))throw new Error('Invalid frozen Moderator origin model.');
}
export function capacityOriginForReservationV3(context:{projectId:string;model?:ModelSelection;budget:RoleBudget;capacitySettings?:ResearchConfigV21}):CapacityOriginV3 {
 if(!context.capacitySettings)throw new Error('Missing frozen originating settings for Moderator reservation.');
 const settings=freezeCapacityConfigV3(context.capacitySettings),{softDeadlineAt:_requestDeadline,...requested}=context.budget,{softDeadlineAt:_settingsDeadline,...frozen}=settings.roleBudget;
 if(!isDeepStrictEqual(context.capacitySettings,settings)||!isDeepStrictEqual(requested,frozen))throw new Error('Moderator origin policy differs from its originating settings identity.');
 return {projectId:context.projectId,...(context.model?{model:structuredClone(context.model)}:{}),budget:structuredClone(settings.roleBudget),settings};
}
export function freezeCapacityReservationV3(origin:CapacityOriginV3):CapacityReservationV3 {
 validateOrigin(origin);const capacityReservationRevision='v3-capacity-reservation-1' as const,capacityOrigin=structuredClone(origin);
 return {capacityReservationRevision,capacityOrigin,capacityOriginBinding:stableHash({capacityReservationRevision,capacityOrigin})};
}
export function readCapacityOriginV3(reservation:CapacityReservationV3):CapacityOriginV3|undefined {
 const {capacityReservationRevision,capacityOrigin,capacityOriginBinding}=reservation;
 if(capacityReservationRevision===undefined&&capacityOrigin===undefined&&capacityOriginBinding===undefined)return undefined;
 if(capacityReservationRevision!=='v3-capacity-reservation-1'||!capacityOrigin||!capacityOriginBinding)throw new Error('Missing or unsupported frozen Moderator capacity reservation.');
 validateOrigin(capacityOrigin);
 if(stableHash({capacityReservationRevision,capacityOrigin})!==capacityOriginBinding)throw new Error('Frozen Moderator capacity origin binding mismatch.');
 return structuredClone(capacityOrigin);
}
