import { isDeepStrictEqual } from 'node:util';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { FrozenQuestionV21, InFlightEpochV21, OperationPinV21, ResearchProjectV21, RootV21 } from '../../contracts/v21.js';
import type { ResourceRef } from '../../../learning/research-data.js';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import { RootInterpretationSchemaV21 } from './schemas.js';
import { TagsSchemaV21, validTagsV21 } from './tags.js';
import { digestV21 } from './state.js';
import { OPTIONAL_MODE_V21, type OptionalControlV21, type OptionalProofArtifactV21 } from './optional-types-op8.js';
const text=Type.String({minLength:1}), strings=Type.Array(text), obj=(p:Record<string,TSchema>)=>Type.Object(p,{additionalProperties:false});
const resource=obj({id:text,version:Type.Integer({minimum:1})});
export const OptionalRouteSchemaV21=obj({methodKey:text,description:text,reason:text,resourceRefs:Type.Array(resource)});
export const OptionalOutcomeSchemaV21=obj({resultKind:Type.Union(['open','supported-result','valid-refutation'].map(value=>Type.Literal(value))),scope:Type.Union(['root','local'].map(value=>Type.Literal(value))),conditions:strings,gaps:strings,obligationIds:strings,dependencyArtifactIds:strings,reason:text,reproducible:Type.Boolean(),tags:TagsSchemaV21,outline:strings});
export const OptionalWorkerRequestSchemaV21=obj({kind:Type.Union(['auxiliary-worker','way-worker'].map(value=>Type.Literal(value))),route:OptionalRouteSchemaV21,question:text,conditions:strings,symbols:Type.Record(Type.String(),text),rootObligationIds:strings,checks:strings,effort:Type.Union(['shallow','deep'].map(value=>Type.Literal(value))),reason:text});
export const OptionalControlSchemaV21=obj({action:Type.Union(['dispatch','continue','complete','pause'].map(value=>Type.Literal(value))),route:OptionalRouteSchemaV21,outcome:OptionalOutcomeSchemaV21,rootInterpretation:Type.Optional(RootInterpretationSchemaV21),workers:Type.Array(OptionalWorkerRequestSchemaV21),adoptions:Type.Array(obj({artifactId:text,status:Type.Union(['valid','rejected','deferred'].map(value=>Type.Literal(value))),outcome:OptionalOutcomeSchemaV21,reason:text,scientificFailure:Type.Optional(Type.Boolean())})),nearTieReason:Type.Optional(text),failures:Type.Optional(Type.Array(obj({artifactIds:strings,patternKey:text,summary:text,tags:TagsSchemaV21,scientific:Type.Boolean(),generalizable:Type.Boolean()})))});
export interface OptionalOperationContextV21 { project?:ResearchProjectV21; marker?:InFlightEpochV21; brief?:FrozenQuestionV21; root:RootV21; boundaryId:string }
export interface OptionalOperationContractV21 { pin:OperationPinV21; schema:TSchema; prepare(value:unknown):OptionalControlV21; validatePrepared(value:unknown):OptionalControlV21; observeEvidence(evidence:{resources?:ResourceRef[]}):void }
function exact(schema:TSchema,value:unknown):void {if(Value.Check(schema,value))return;const details=[...Value.Errors(schema,value)].slice(0,32).map(e=>({path:e.instancePath,keyword:e.keyword,message:e.message}));throw new ContractValidationError(details.map(d=>`${d.path}: ${d.message}`),'format',details);}
/** New codec, never a modification or reinterpretation of operation1–7. */
export function createOptionalOperationV21(task:'v21_theorist'|'v21_optional_worker',input:unknown,context:OptionalOperationContextV21,revision:OperationPinV21['revision']='v21-operation-8'):OptionalOperationContractV21 {
 const c=structuredClone(context),frozen=structuredClone(input) as Record<string,unknown>;
 if(revision!=='v21-operation-8'||!frozen||typeof frozen!=='object'||Array.isArray(frozen)||frozen.boundaryId!==c.boundaryId||!c.boundaryId||!isDeepStrictEqual(frozen.root,c.root))throw new Error('Optional operation requires its exact frozen root and boundary identity.');
 const worker=task==='v21_optional_worker';
 if(worker){if(!c.brief?.solverRole||!['auxiliary-worker','way-worker'].includes(c.brief.solverRole)||c.boundaryId!==c.brief.callId)throw new Error('Optional worker requires its explicit frozen solver role.');const {boundaryId:_,...brief}=frozen;if(!isDeepStrictEqual(brief,c.brief))throw new Error('Optional worker input differs from its frozen contract.');}
 else if(!c.project||!c.marker||c.marker.solverMode!==OPTIONAL_MODE_V21||c.marker.snapshot.solverMode!==OPTIONAL_MODE_V21||c.marker.projectId!==c.project.id||!isDeepStrictEqual(c.marker.snapshot.root,c.root))throw new Error('Optional Theorist mode must be explicitly and consistently frozen.');
 if(!worker){
  if((frozen.rootInterpretationPending===true)!==(c.project!.rootInterpretationPending===true))throw new Error('Initial root interpretation status differs from the frozen project.');
  for(const key of ['sources','resourceBodies','decision'] as const)if(frozen[key]!==undefined&&!isDeepStrictEqual(frozen[key],c.marker!.snapshot[key]))throw new Error('Optional source/resource/policy context differs from its frozen snapshot.');
 }
 const deliveredBodies=(worker?c.brief?.resourceBodies:frozen.resourceBodies) as {ref:ResourceRef;body:string;bodyHash:string}[]|undefined;
 for(const body of deliveredBodies??[])if(digestV21(body.body)!==body.bodyHash)throw new Error('Optional delivered resource bytes failed their frozen hash.');
 const sources=(worker?c.brief?.sources:frozen.sources) as {body:string;bodyHash:string}[]|undefined;
 for(const source of sources??[])if(digestV21(source.body)!==source.bodyHash)throw new Error('Optional delivered source bytes failed their frozen hash.');
 const schema=structuredClone(OptionalControlSchemaV21) as TSchema & {required?:string[];properties:Record<string,TSchema>};
 const interpretationPending=!worker&&frozen.rootInterpretationPending===true;
 if(interpretationPending)schema.required=[...new Set([...(schema.required??[]),'rootInterpretation'])];
 const pin:OperationPinV21={revision:'v21-operation-8',task,solverMode:OPTIONAL_MODE_V21,schemaDigest:digestV21(schema),inputHash:digestV21(frozen)};
 const resources=c.brief?.resources??c.marker?.snapshot.resources??[];
 let loaded=(deliveredBodies??[]).map(r=>r.ref);
 const validate=(value:unknown):OptionalControlV21=>{
  exact(schema,value);const result=structuredClone(value as OptionalControlV21),issues:string[]=[];
  const fail=(message:string)=>{if(issues.length<32)issues.push(message);};
  const root=result.rootInterpretation?{...c.root,...result.rootInterpretation}:c.root;
  if(result.rootInterpretation&&!interpretationPending)fail('Root interpretation is allowed only at the explicitly pending initial Theorist boundary.');
  if(result.rootInterpretation&&(!root.obligations.length||!root.completionCriteria.length||new Set(root.obligations.map(o=>o.id)).size!==root.obligations.length))fail('Initial interpretation needs complete unique scientific obligations and completion criteria.');
  const validateRoute=(route:OptionalControlV21['route'])=>{for(const ref of route.resourceRefs)if(!resources.some(r=>isDeepStrictEqual(r,ref))||!loaded.some(r=>isDeepStrictEqual(r,ref)))fail('Selected method resource requires an exact delivered frozen version.');};
  validateRoute(result.route);for(const request of result.workers){validateRoute(request.route);if(request.rootObligationIds.some(id=>!root.obligations.some(o=>o.id===id)))fail('Worker contract names an unknown exact root obligation.');if(request.kind==='way-worker'&&(root.obligations.some(o=>!request.rootObligationIds.includes(o.id))||request.conditions.some(condition=>!root.conditions.includes(condition))))fail('A complete alternative route must preserve every exact root obligation without extra conditions.');}
  for(const outcome of [result.outcome,...result.adoptions.map(a=>a.outcome)]){
   if(!validTagsV21(outcome.tags))fail('Outcome tags violate existing library classifications.');
   if(new Set(outcome.obligationIds).size!==outcome.obligationIds.length||outcome.obligationIds.some(id=>!root.obligations.some(o=>o.id===id)))fail('Outcome obligations require unique exact root identities.');
   if(new Set(outcome.dependencyArtifactIds).size!==outcome.dependencyArtifactIds.length)fail('Outcome dependency identities cannot repeat.');
   if(outcome.resultKind!=='open'&&(outcome.gaps.length||!outcome.reproducible))fail('A supported result or refutation cannot erase open gaps or omit reproducibility.');
   if(outcome.resultKind!=='open'&&outcome.scope==='root'&&root.obligations.some(o=>!outcome.obligationIds.includes(o.id)))fail('A root result must discharge every exact root obligation.');
  }
  const rootCandidate=(outcome:OptionalControlV21['outcome'])=>outcome.scope==='root'&&outcome.resultKind!=='open'&&!outcome.gaps.length&&outcome.reproducible&&root.obligations.every(o=>outcome.obligationIds.includes(o.id));
  if(!worker&&result.action==='complete'&&!rootCandidate(result.outcome)&&!result.adoptions.some(adoption=>adoption.status==='valid'&&rootCandidate(adoption.outcome)))fail('An open scientific or merely local result cannot complete the Theorist boundary without explicit adoption of a delivered exact-root result.');
  if(worker&&result.action==='complete'&&result.outcome.resultKind==='open')fail('An open scientific result cannot be declared complete.');
  if(result.action==='dispatch'&&(!result.workers.length||result.outcome.resultKind!=='open'))fail('Dispatch is a nonterminal open-proof boundary with a precise worker contract.');
  if(result.action!=='dispatch'&&result.workers.length)fail('Worker admission requires the explicit dispatch boundary.');
  if(result.workers.filter(w=>w.kind==='way-worker').length>1)fail('At most one complete alternative route may be admitted.');
  if(result.workers.some(w=>w.kind==='way-worker')&&!result.nearTieReason?.trim())fail('An alternative complete route needs the qualitative near-tie comparison and reason.');
  if(worker&&(result.workers.length||result.adoptions.length||result.rootInterpretation||!['complete','pause'].includes(result.action)))fail('Workers may only finish or leave open their frozen assignment; they cannot dispatch, review or change the root.');
  if(worker&&c.brief?.solverRole==='auxiliary-worker'&&result.outcome.scope!=='local')fail('An auxiliary worker verdict has local scope, never exact-root qualification.');
  if(worker&&c.brief?.solverRole==='way-worker'&&result.outcome.scope!=='root')fail('An alternative route retains the exact original root scope.');
  if(worker&&result.route.methodKey!==c.brief!.way.methodKey)fail('Worker method must retain its frozen route identity.');
  const delivered=Array.isArray(frozen.artifacts)?frozen.artifacts as (OptionalProofArtifactV21&{body?:string})[]:[];
  const deliveredIds=new Set(delivered.map(artifact=>artifact.id));
  for(const adoption of result.adoptions)if(!deliveredIds.has(adoption.artifactId))fail('Adoption requires the exact artifact actually delivered in this frozen invocation.');
  for(const outcome of [result.outcome,...result.adoptions.map(a=>a.outcome)])for(const id of outcome.dependencyArtifactIds)if(!deliveredIds.has(id))fail('Scientific dependency requires an exact delivered artifact, never a pending or unseen branch.');
  for(const adoption of result.adoptions)if(adoption.scientificFailure===true&&adoption.status!=='rejected')fail('A scientific-failure judgment requires an explicitly rejected adoption.');
  if(worker&&result.failures!==undefined)fail('Workers cannot declare failure patterns or generalize sibling research.');
  for(const pattern of result.failures??[]){
   if(pattern.artifactIds.length<2||new Set(pattern.artifactIds).size!==pattern.artifactIds.length)fail('A failure pattern needs at least two distinct independently completed Worker artifacts.');
   if(!validTagsV21(pattern.tags))fail('Failure pattern tags violate existing library classifications.');
   const originals=pattern.artifactIds.map(id=>delivered.find(a=>a.id===id));
   for(const original of originals){
    const ref=original?.originalRef;
    if(!original||!['auxiliary-worker','way-worker'].includes(original.authorRole)||original.technical.executionStatus!=='completed'||original.technical.completeness!=='complete'||ref?.completeness!=='complete'||!ref.byteLength||ref.projectId!==c.project?.id||ref.hypothesisId!==root.hypothesisId||ref.hypothesisRevision!==root.revision||typeof original.body!=='string'||!original.body.trim()||Buffer.byteLength(original.body)!==ref.byteLength||digestV21(original.body)!==ref.bodyHash){fail('Failure patterns require exact actually delivered complete Worker originals, not own, partial, cancelled, technical or missing work.');continue;}
    if(!result.adoptions.some(adoption=>adoption.artifactId===original.id&&adoption.status==='rejected'&&adoption.scientificFailure===true))fail('Every failure-pattern original needs an explicit rejected scientificFailure judgment in this same control.');
   }
   if(new Set(originals.map(original=>original?.originalRef.callId)).size!==originals.length||new Set(originals.map(original=>original?.originalRef.id)).size!==originals.length||new Set(originals.map(original=>original?.originalRef.attemptId)).size!==originals.length)fail('Repeated artifacts or retries from one Worker original are not independent scientific failures.');
  }
  if(new Set(result.adoptions.map(a=>a.artifactId)).size!==result.adoptions.length)fail('Each delivered artifact may be reviewed only once in this response.');
  if(issues.length)throw new ContractValidationError(issues,'semantic');return result;
 };
 return {pin,schema,prepare:validate,validatePrepared:validate,observeEvidence(e){if(e.resources)loaded=structuredClone(e.resources);}};
}
