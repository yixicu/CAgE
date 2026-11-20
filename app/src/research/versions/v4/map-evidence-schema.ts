import {mapNodeTypeSchema} from '../../../learning/map-node-fields.js';
import {isDeepStrictEqual} from 'node:util';
import {Type,type TSchema} from 'typebox';
import {MapObservationSchema,validMapObservation} from '../../../learning/map-observation.js';
import {mapHandle,mapSourceKey,type MapOpenResult} from '../../../learning/knowledge-map.js';
import type {OptionalOutcomeV21} from '../v21/optional-types.js';
const text=Type.String(),strings=Type.Array(text),obj=(properties:Record<string,TSchema>)=>Type.Object(properties,{additionalProperties:false});
const ref=obj({store:Type.Union([Type.Literal('map'),Type.Literal('theory')]),id:text,version:Type.Integer({minimum:1}),bodyHash:text});
const source=obj({kind:Type.Union(['proof-report','public-research','library-proof','theory','user-seed','maintenance-proof'].map(x=>Type.Literal(x))),id:text,version:Type.Integer({minimum:1}),bodyHash:text,ownerId:text,projectId:text});
const roles=Type.Union([Type.Literal('established'),Type.Literal('assumption')]);
const basis=obj({steps:Type.Array(obj({ref,via:text}),{minItems:1}),assumptions:strings});
const premise=obj({ref,role:roles,basis:Type.Optional(basis),discharges:Type.Optional(Type.Array(obj({condition:text,argument:text})))});
const support=obj({id:text,statement:ref,sources:Type.Array(source),argument:text,assumptions:strings,prerequisites:Type.Array(premise),unresolvedPrerequisites:Type.Optional(Type.Array(obj({candidateId:text,candidateHash:text,role:roles}))),status:Type.Union(['proved','pending','disputed','withdrawn'].map(x=>Type.Literal(x))),review:Type.Optional(obj({id:text,body:text,candidateHash:text,sourceHashes:strings}))});
/** Host read provenance only. Scientific declarations continue to carry ordinary native reference handles. */
const read=obj({suppliedProof:Type.Optional(obj({argument:text,source})),nodeType:Type.Optional(mapNodeTypeSchema),selection:text,ref:Type.Optional(ref),kind:Type.Union(['concept','theorem','theory','source-evidence'].map(x=>Type.Literal(x))),title:Type.Optional(text),aliases:Type.Optional(strings),domain:Type.Optional(strings),body:text,assumptions:strings,qualification:Type.Union(['definition','proved','accepted','pending','disputed','withdrawn','evidence'].map(x=>Type.Literal(x))),accepted:Type.Boolean(),supports:Type.Array(support),bases:Type.Optional(Type.Array(basis)),basis:Type.Optional(basis),sources:Type.Array(source),theoryQualification:Type.Optional(Type.Union([Type.Literal('candidate'),Type.Literal('supported')]))});
export const MapEvidenceSchemaV4=Type.Array(read);
const observationSupport=obj({...support.properties,status:Type.Union(['observed','pending','disputed','withdrawn'].map(x=>Type.Literal(x))),prerequisites:Type.Array(premise,{maxItems:0})});
const {basis:_basis,theoryQualification:_theory,...observationFields}=read.properties;
const observationRead=obj({...observationFields,ref,kind:Type.Literal('observation'),observation:MapObservationSchema,
 qualification:Type.Union(['observed','pending','disputed','withdrawn'].map(x=>Type.Literal(x))),accepted:Type.Literal(false),
 supports:Type.Array(observationSupport),bases:Type.Optional(Type.Array(basis,{maxItems:0}))});
export const ScientificMapReadSchemaV4=Type.Array(Type.Union([obj({...read.properties,separateCitations:Type.Optional(Type.Literal(true))}),observationRead]));
export const ScopedMapEvidenceSchemaV4=Type.Array(Type.Union([read,observationRead]));

export function sameObservationEvidence(saved:MapOpenResult,current:MapOpenResult):boolean {
 return current.kind==='observation'&&current.selection===saved.selection&&isDeepStrictEqual(saved.ref,current.ref)
  &&current.qualification===saved.qualification&&current.body===saved.body&&isDeepStrictEqual(current.observation,saved.observation)
  &&saved.supports.filter(s=>s.status==='observed').every(s=>current.supports.some(active=>isDeepStrictEqual(active,s)));
}

function isReviewedMeasurement(read:MapOpenResult):boolean {
 if(read.kind!=='observation'||read.qualification!=='observed'||!validMapObservation(read.observation)||read.ref?.store!=='map'||read.selection!==mapHandle(read.ref))return false;
 const sources=new Set(read.sources.map(mapSourceKey));
 return !read.accepted&&!read.basis&&!read.bases?.length&&read.supports.some(support=>support.status==='observed'
  &&!!support.review&&!support.prerequisites.length&&!support.unresolvedPrerequisites?.length&&mapHandle(support.statement)===read.selection&&support.sources.length>0&&support.sources.every(s=>sources.has(mapSourceKey(s))));
}

export function scopedOutcomeIssue(outcome:Pick<OptionalOutcomeV21,'resultKind'|'refutationKind'|'reason'|'knowledgeRefs'>,reads:readonly MapOpenResult[]):string|undefined {
 if(!['open','supported-result','valid-refutation','empirical-exclusion'].includes(outcome.resultKind))return 'Unknown scoped outcome.';
 if(outcome.resultKind==='valid-refutation'){
  if(!['counterexample','contradiction'].includes(outcome.refutationKind??''))return 'Identify the theoretical refutation as a counterexample or a contradiction.';
  if(!outcome.reason.trim())return 'Explain the refutation under the original premises and quantifiers.';
 }else if(outcome.refutationKind!==undefined)return 'refutationKind applies only to a theoretical refutation.';
 for(const id of outcome.knowledgeRefs??[])if(/^(map_|source_)/.test(id)&&!reads.some(r=>r.selection===id))return 'A cited map record must be present in the exact delivered evidence.';
 const observations=reads.filter(r=>r.kind==='observation'&&outcome.knowledgeRefs?.includes(r.selection));
 if(outcome.resultKind==='empirical-exclusion'){
  if(!outcome.reason.trim())return 'Describe the tested scope, prediction, auxiliary assumptions and measurement comparison.';
  if(!observations.length||!observations.every(isReviewedMeasurement))return 'Empirical exclusion requires exact citations to delivered, reviewed observations.';
 }else if(outcome.resultKind!=='open'&&observations.length)return 'Report a measured finding with its exact observation in an open report. Use empirical-exclusion when a reviewed measurement excludes a specific prediction within the claimed scope. A mathematical premise requires independent support.';
}

