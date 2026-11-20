/** Current-question navigation bindings. Expected outputs never create evidence records. */
import {isDeepStrictEqual} from 'node:util';
import {stableHash} from '../../../learning/research-hash.js';
import {validNetworkPinV3,type NetworkPinV3} from '../../../learning/method-network-v3.js';
import type {ResourceRef} from '../../../learning/research-data.js';
import {visibleWorkspaceRecordsV3,type WorkspaceV3} from './workspace.js';
export interface RouteInstanceRequestV3 {
 routeRef:{id:string;version:number};goalId:string;bindings:{role:string;recordId:string}[];
 applicability:'unknown'|'compatible'|'incompatible';status:'candidate'|'active'|'rejected'|'failed';reason:string;expectedOutputs:string[];
}
export interface RouteInstanceV3 extends RouteInstanceRequestV3 {
 recipe:'route-instance-v1';id:string;networkPin:NetworkPinV3;rootVersion:string;branchId:string;resourceRef:ResourceRef;roleKinds:{name:string;kind:'input'|'output'}[];
}
export function bindRouteInstanceV3(workspace:WorkspaceV3,pin:NetworkPinV3,branchId:string,request:RouteInstanceRequestV3,route:{ref:{id:string;version:number};resourceRef:ResourceRef;roles:{name:string;kind:'input'|'output'}[]}):RouteInstanceV3 {
 if(!validNetworkPinV3(pin)||!branchId||!request||Object.keys(request).some(k=>!['routeRef','goalId','bindings','applicability','status','reason','expectedOutputs'].includes(k))||!isDeepStrictEqual(request.routeRef,route.ref)||!request.reason?.trim()||!['unknown','compatible','incompatible'].includes(request.applicability)||!['candidate','active','rejected','failed'].includes(request.status)||!Array.isArray(request.bindings)||!Array.isArray(request.expectedOutputs)||request.expectedOutputs.some(x=>typeof x!=='string'||!x.trim()))throw new Error('Invalid exact route instance binding.');
 const visible=new Map(visibleWorkspaceRecordsV3(workspace,branchId).map(r=>[r.id,r]));
 const goal=visible.get(request.goalId);if(!goal||goal.kind!=='goal'||['refuted','needs-review'].includes(goal.status))throw new Error('Unknown or invalid route goal scope.');
 const roles=new Set<string>(),declared=new Map(route.roles.map(role=>[role.name,role.kind]));
 for(const binding of request.bindings){const record=visible.get(binding.recordId);if(!binding.role?.trim()||!declared.has(binding.role)||roles.has(binding.role)||!record||declared.get(binding.role)==='input'&&record.kind==='goal'||declared.get(binding.role)==='output'&&record.kind==='assumption'||['refuted','needs-review'].includes(record.status))throw new Error('Unknown, duplicate, withdrawn or cross-branch role binding.');roles.add(binding.role);}
 const bound={recipe:'route-instance-v1' as const,...structuredClone(request),networkPin:structuredClone(pin),rootVersion:workspace.rootVersion,branchId,resourceRef:structuredClone(route.resourceRef),roleKinds:route.roles.map(({name,kind})=>({name,kind}))};
 return {...bound,id:`route-instance:${stableHash(bound)}`};
}
export function validateRouteInstanceV3(workspace:WorkspaceV3,pin:NetworkPinV3,branchId:string,instance:RouteInstanceV3):void {
 const {recipe,id,networkPin,rootVersion,branchId:storedBranch,resourceRef,roleKinds,...request}=instance;
 const expected=bindRouteInstanceV3(workspace,pin,branchId,request,{ref:request.routeRef,resourceRef,roles:roleKinds});
 if(!isDeepStrictEqual(instance,expected))throw new Error('Foreign or modified route instance.');
}
