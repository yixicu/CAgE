import { isDeepStrictEqual } from 'node:util';
import type { AnswerDeliveryV21, InFlightEpochV21, ResearchProjectV21 } from '../../contracts/v21.js';
import { digestV21 } from './state.js';
import { makeAnswerDelivery, makeAnswerPrefix } from './check-view.js';
/** Presentation budgets, not proof-validity thresholds. Unseen bytes retain scoped readers. */
export const BATCH_CONTEXT_V21={sourceOrResourceBytes:65536,planningBytes:262144,answerBytes:65536,answerAggregateBytes:196608} as const;
export function batchModeV21(marker:InFlightEpochV21):boolean { const outer=marker.theoristMode,inner=marker.snapshot?.theoristMode;if(outer!==inner||outer!==undefined&&outer!=='judgment-batch-v1')throw new Error('Consolidated Theorist mode must be consistently frozen.');const revision=marker.promptRevision;if(revision!==marker.snapshot?.promptRevision||revision!==undefined&&(revision!=='categorized-v1'||outer!=='judgment-batch-v1'))throw new Error('Prompt revision must be consistently frozen on a consolidated boundary.');return outer==='judgment-batch-v1'; }
export function batchPlanContextV21(marker:InFlightEpochV21):unknown {
 for(const source of marker.snapshot.sources)if(digestV21(source.body)!==source.bodyHash)throw new Error('Frozen source body hash mismatch.');
 const bodies=marker.snapshot.resourceBodies??[];let remaining=BATCH_CONTEXT_V21.planningBytes-bodies.reduce((n,r)=>n+Buffer.byteLength(r.body),0);
 const sources=marker.snapshot.sources.map(source=>{const size=Buffer.byteLength(source.body),delivered=size<=BATCH_CONTEXT_V21.sourceOrResourceBytes&&size<=remaining;if(delivered)remaining-=size;return delivered?structuredClone(source):{ref:source.ref,bodyHash:source.bodyHash,byteLength:size,bodyDelivered:false};});
 return {decision:marker.snapshot.decision,resourceBodies:bodies,sources,contextPolicy:BATCH_CONTEXT_V21};
}
export function validateBatchResourcesV21(marker:InFlightEpochV21):void {
 const bodies=marker.snapshot.resourceBodies??[],catalog=marker.snapshot.resourceCatalog??[];
 if(new Set(bodies.map(r=>`${r.ref.id}:${r.ref.version}`)).size!==bodies.length||bodies.some(r=>digestV21(r.body)!==r.bodyHash||!marker.snapshot.resources.some(ref=>isDeepStrictEqual(ref,r.ref))||!catalog.some(m=>m.id===r.ref.id&&m.version===r.ref.version&&m.enabled&&m.status==='valid')))throw new Error('Preloaded resource bytes do not match exact frozen authority.');
}
export function batchAnswerDeliveriesV21(_project:ResearchProjectV21,marker:InFlightEpochV21,entries:{ref:AnswerDeliveryV21['answerRef'];body:string}[]):AnswerDeliveryV21[] {
 const relevant=new Set(marker.answers.map(a=>a.id));for(const task of marker.tasks)for(const id of task.frozen?.adoptedAnswerIds??[])relevant.add(id);
 // Preserve every required review interface. Spend only the extra-body allowance on current/dependent originals.
 let extra=Math.max(0,BATCH_CONTEXT_V21.answerAggregateBytes-entries.reduce((n,entry)=>n+Buffer.byteLength(makeAnswerPrefix(entry.ref,entry.body).body),0));
 return entries.map(({ref,body})=>{const prefix=makeAnswerPrefix(ref,body),bytes=Buffer.byteLength(body),cost=bytes-Buffer.byteLength(prefix.body);if(relevant.has(ref.id)&&bytes<=BATCH_CONTEXT_V21.answerBytes&&cost<=extra){extra-=cost;return makeAnswerDelivery(ref,body,'full-original');}return prefix;});
}
