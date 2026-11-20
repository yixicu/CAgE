import { batchModeV21, batchPlanContextV21 } from './batch-context.js';
import { latestDecisions } from './check-view.js';
import {interpretedRootV21} from './root-interpretation.js';
import { Type, type TSchema } from 'typebox';
import type { ResearchProjectV21, InFlightEpochV21, PlanOutputV21, CheckOutputV21 } from '../../contracts/v21.js';
import { PlanSchemaV21, CheckSchemaV21, obj } from './schemas.js';
type Shape=TSchema & {properties:Record<string,TSchema>;required?:string[];items?:Shape};
function omit(schema:TSchema,keys:string[]):Shape {const s=structuredClone(schema) as Shape;for(const k of keys)delete s.properties[k];s.required=s.required?.filter(k=>!keys.includes(k));return s;}
export function compactPlanSchema(marker:InFlightEpochV21):TSchema {
 const schema=structuredClone(PlanSchemaV21) as Shape;
 const way=omit((schema.properties.ways as Shape).items!,['rootObligationIds']);
 way.properties.routeTarget=Type.Literal('original-root');way.required=[...(way.required??[]).filter(k=>k!=='routeTarget'),'routeTarget'];
 (schema.properties.ways as Shape).items=way;
 if(!marker.snapshot.resources.length){schema.properties.selectedResources=Type.Array(Type.Never(),{maxItems:0});way.properties.resourceRefs=Type.Array(Type.Never(),{maxItems:0});}
 const q=(schema.properties.questions as Shape).items!;
 q.properties.conditions=Type.Union([q.properties.conditions,obj({sameAs:Type.Literal('root.conditions')})]);
 q.properties.symbols=Type.Union([q.properties.symbols,obj({sameAs:Type.Literal('root.symbols')})]);
 return schema;
}
export function expandPlanWire(value:unknown,marker:InFlightEpochV21,allowInterpretation=false):PlanOutputV21 {
 const output=structuredClone(value) as PlanOutputV21,root=allowInterpretation&&output.rootInterpretation?interpretedRootV21(marker.snapshot.root,output.rootInterpretation):marker.snapshot.root;
 for(const w of output.ways)w.rootObligationIds=root.obligations.map(o=>o.id);
 for(const q of output.questions){if(!Array.isArray(q.conditions))q.conditions=structuredClone(root.conditions);if(Object.keys(q.symbols).length===1&&q.symbols.sameAs==='root.symbols')q.symbols=structuredClone(root.symbols);}
 return output;
}
export function compactCheckSchema(allowSelectedSupport=false):TSchema {
 const schema=structuredClone(CheckSchemaV21) as Shape;
 (schema.properties.decisions as Shape).items=omit((schema.properties.decisions as Shape).items!,['answerHash','questionRevision','dependencyBindings','adoptionHash']);
 (schema.properties.closures as Shape).items=omit((schema.properties.closures as Shape).items!,['wayRevision','hypothesisId','hypothesisRevision','target']);
 if(allowSelectedSupport){const support=((schema.properties.closures as Shape).items!.properties.obligations as Shape).items!;support.properties.answerIds=Type.Union([support.properties.answerIds,obj({sameAs:Type.Literal('selected-adopted-support')})]);}
 return schema;
}
export function expandCheckWire(value:unknown,project:ResearchProjectV21,marker:InFlightEpochV21,allowSelectedSupport=false):CheckOutputV21 {
 const o=structuredClone(value) as CheckOutputV21; const answers=[...project.answers,...marker.answers];
 for(const d of o.decisions){const a=answers.find(a=>a.id===d.answerId);if(a){d.answerHash=a.bodyHash;d.questionRevision=a.questionRevision;}d.dependencyBindings=[];}
 for(const c of o.closures){c.wayRevision=project.ways.find(w=>w.id===c.wayId)?.revision??'';c.hypothesisId=marker.snapshot.root.hypothesisId;c.hypothesisRevision=marker.snapshot.root.revision;c.target='original-root';}
 if(allowSelectedSupport){
  const decisions=latestDecisions(project);for(const d of o.decisions)decisions.set(d.answerId,d);
  for(const c of o.closures)for(const support of c.obligations)if(!Array.isArray(support.answerIds)&&(support.answerIds as {sameAs?:string}).sameAs==='selected-adopted-support')support.answerIds=c.answerIds.filter(id=>{const d=decisions.get(id);return d?.status==='adopted'&&d.rootObligationIds.includes(support.obligationId);});
 }
 return o;
}
/** Whitelist projection: no recursive call inputs, original source bodies or repeated receipt bodies. */
export function projectPlanView(project:ResearchProjectV21,marker:InFlightEpochV21):unknown {
 if(marker.snapshot.contextCompaction&&marker.rootIdentityRecipe)return {...batchPlanContextV21(marker) as object,root:marker.snapshot.root,planningInputs:marker.planningSelection&&{boundaryId:marker.planningSelection.boundaryId,hypothesisCommandId:marker.planningSelection.hypothesisCommandId,annotationCommandIds:marker.planningSelection.annotationCommandIds,reconstruction:marker.planningSelection.reconstruction}};
 return {...(batchModeV21(marker)?batchPlanContextV21(marker) as object:{}),root:marker.snapshot.root,...(marker.snapshot.rootInterpretationPending===true?{initialRootInterpretationRequired:true}:{}),inputRef:{epochId:marker.snapshot.id,inputRevision:marker.snapshot.inputRevision},planningInputs:marker.planningSelection,resources:marker.snapshot.resources.length?marker.snapshot.resourceCatalog??marker.snapshot.resources:'none',ways:project.ways,questions:project.questions,answers:project.answers.map(a=>({id:a.id,questionId:a.questionId,questionRevision:a.questionRevision,executionStatus:a.executionStatus,completeness:a.completeness,...(a.errorCategory!==undefined?{errorCategory:a.errorCategory}:{}),...(a.stopReason!==undefined?{stopReason:a.stopReason}:{}),...(a.rawStopReason!==undefined?{rawStopReason:a.rawStopReason}:{}),answerRef:a.answerRef})),reviews:project.reviews.map(r=>({epochId:r.epochId,hypothesisRevision:r.hypothesisRevision,decisions:r.decisions,closures:r.closures,invalidatedAnswerIds:r.invalidatedAnswerIds})),...(!batchModeV21(marker)?{sources:marker.snapshot.sources.map(s=>({ref:s.ref,bodyHash:s.bodyHash}))}:{}),...(marker.snapshot.discussion?{discussion:marker.snapshot.discussion}:{refinements:project.refinements})};
}

/** New wire omits only mechanically reconstructible fields, not scientific evidence. */
export function batchPlanSchemaV21(marker:InFlightEpochV21):TSchema {
 const schema=compactPlanSchema(marker) as Shape,q=(schema.properties.questions as Shape).items!;
 q.properties.order={...q.properties.order,description:'Omit this Host-projected field; if supplied, use the zero-based index in Way.questionIds.'};q.required=q.required?.filter(k=>k!=='order');return schema;
}
export function batchCheckSchemaV21():TSchema {
 const schema=compactCheckSchema(true) as Shape,c=(schema.properties.closures as Shape).items!;
 c.properties.reproducible=Type.Literal(true);c.required=[...(c.required??[]).filter(k=>k!=='rootClosed'),'reproducible'];return schema;
}
export function expandBatchPlanV21(value:unknown,marker:InFlightEpochV21):PlanOutputV21 {
 const o=expandPlanWire(value,marker,true);
 for(const q of o.questions){const ways=o.ways.filter(w=>w.id===q.wayId&&w.questionIds.includes(q.id));if(ways.length!==1)continue;const order=ways[0]!.questionIds.indexOf(q.id);if(q.order===undefined)q.order=order;}
 return o;
}
export function expandBatchCheckV21(value:unknown,project:ResearchProjectV21,marker:InFlightEpochV21):CheckOutputV21 {
 const o=expandCheckWire(value,project,marker,true);for(const c of o.closures)if(c.rootClosed===undefined)c.rootClosed=true;return o;
}

/** Operation7 alone accepts this exact, explicit lossless spelling. Historical schemas stay frozen. */
export function conditionsCheckSchemaV21():TSchema {
 const schema=batchCheckSchemaV21() as Shape;
 for(const key of ['decisions','closures']){const item=(schema.properties[key] as Shape).items!;item.properties.conditions=Type.Union([item.properties.conditions,obj({sameAs:Type.Literal('root.conditions')})]);}
 return schema;
}
export function expandConditionsCheckV21(value:unknown,project:ResearchProjectV21,marker:InFlightEpochV21):CheckOutputV21 {
 const wire=structuredClone(value) as CheckOutputV21;
 for(const item of [...wire.decisions,...wire.closures]){
  const conditions=item.conditions as unknown;
  if(conditions!==null&&typeof conditions==='object'&&!Array.isArray(conditions)&&Object.keys(conditions).length===1&&(conditions as {sameAs?:unknown}).sameAs==='root.conditions')item.conditions=structuredClone(marker.snapshot.root.conditions);
 }
 return expandBatchCheckV21(wire,project,marker);
}
