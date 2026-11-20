/** Host-bound optional learning proposals; canonical prose remains in ResourceRef bodies. */
import {stableHash} from './research-hash.js';
import {validateNetworkPublicationV3,type NetworkPublicationV3,type RouteTemplateV3,type MethodLinkV3} from './method-network-v3.js';
import type {ResourceRef} from './research-data.js';
export interface MethodNetworkProposalV3 {
 route:Pick<RouteTemplateV3,'title'|'summary'|'transformation'|'topics'|'conditions'|'outputs'|'checks'|'failures'|'roles'|'alternatives'>;
 links?:Array<Pick<MethodLinkV3,'to'|'relation'|'basis'|'bridgeConditions'|'score'>>;
}
const exactKeys=(value:unknown,allowed:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function stageMethodNetworkV3(current:NetworkPublicationV3,proposal:unknown,owner:ResourceRef,allowed:ResourceRef[],canRefute:boolean):NetworkPublicationV3 {
 if(!exactKeys(proposal,['route','links']))throw new Error('Unexpected method network proposal shape.');
 const input=proposal as MethodNetworkProposalV3;
 if(!exactKeys(input.route,['title','summary','transformation','topics','conditions','outputs','checks','failures','roles','alternatives'])||input.links!==undefined&&(!Array.isArray(input.links)||input.links.length>32))throw new Error('Invalid route or links.');
 const permitted=new Set([owner,...allowed].map(r=>`${r.id}:${r.version}`));
 if(!Array.isArray(input.route.alternatives)||input.route.alternatives.some(ref=>!permitted.has(`${ref?.id}:${ref?.version}`)))throw new Error('Alternative is outside frozen resource grants.');
 const id=`route_${stableHash(owner.id).slice(0,32)}`,prior=current.routes.filter(route=>route.id===id).sort((a,b)=>b.version-a.version)[0];
 const route:RouteTemplateV3={...structuredClone(input.route),id,version:(prior?.version??0)+1,resourceRef:structuredClone(owner),sourceRefs:[structuredClone(owner)],status:'active',...(prior?{supersedes:[{id:prior.id,version:prior.version}]}:{})};
 const links:MethodLinkV3[]=[];
 for(const link of input.links??[]){
  if(!exactKeys(link,['to','relation','basis','bridgeConditions','score']))throw new Error('Invalid method link shape.');
  const target=current.routes.find(r=>r.id===link.to?.id&&r.version===link.to?.version&&r.status==='active');
  if(!target||!permitted.has(`${target.resourceRef.id}:${target.resourceRef.version}`)||target.sourceRefs.some(ref=>!permitted.has(`${ref.id}:${ref.version}`)))throw new Error('Linked route is outside frozen resource grants.');
  if(link.relation==='refutes'&&!canRefute)throw new Error('Refutation navigation needs a qualified refutation source.');
  const from={id:route.id,version:route.version};
  links.push({...structuredClone(link),from,id:`link_${stableHash([from,link.to,link.relation]).slice(0,32)}`,version:1,sourceRefs:[structuredClone(owner),structuredClone(target.resourceRef)]});
 }
 const next=structuredClone(current);next.routes=next.routes.filter(r=>r.id!==id);next.routes.push(route);
 next.links=next.links.filter(link=>link.from.id!==id&&link.to.id!==id);next.links.push(...links);next.version++;
 validateNetworkPublicationV3(next);return next;
}
