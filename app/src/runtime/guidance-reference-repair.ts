import {isDeepStrictEqual} from 'node:util';
import type {ResourceRef} from '../learning/research-data.js';
import {RuntimeError} from './errors.js';
export interface GuidanceReferenceStateV3 {eligible:ResourceRef[];complete:ResourceRef[];exposed:ResourceRef[]}
/** Comparison only, never an automatic rewrite of the model's declaration. */
export function guidanceReferenceComparisonV3(original:unknown,state:GuidanceReferenceStateV3):{comparison:unknown;removed:ResourceRef[]} {
 const value=original as {route?:{resourceRefs?:unknown}};
 if(!Array.isArray(value?.route?.resourceRefs))return {comparison:original,removed:[]};
 const removed:ResourceRef[]=[],kept:ResourceRef[]=[];
 for(const ref of value.route.resourceRefs){
  if(!state.eligible.some(r=>isDeepStrictEqual(r,ref)))throw new RuntimeError('INVALID_OUTPUT');
  if(state.complete.some(r=>isDeepStrictEqual(r,ref)))kept.push(ref);
  else if(state.exposed.some(r=>isDeepStrictEqual(r,ref)))throw new RuntimeError('INVALID_OUTPUT');
  else removed.push(ref);
 }
 const comparison=structuredClone(original) as {route:{resourceRefs:ResourceRef[]}};comparison.route.resourceRefs=kept;
 return {comparison,removed};
}
