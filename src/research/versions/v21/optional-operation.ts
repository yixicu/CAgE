import { DeclarationSupplementError } from '../../../runtime/declaration-supplement.js';
import {theoremAuthoringSchema,theoremAuthoringIssues,scientificMapChangesSchema,legacyScientificMapChangesSchema,mapMetadataIssues,scientificMapFormatIssue} from '../v4/scientific-map-write.js';
import {scopedOutcomeIssue} from '../v4/map-evidence-schema.js';
import {PublicStageSchemaV4,validatePublicStageV4,publicFragmentsV4,derivePublicStageV4,type PublicFragmentV4} from '../v4/fragments.js';
import { usesV3Proof } from '../v3/proof-version.js';
import {mergeCatalogMaterialsV3,type CatalogMaterialV3} from '../v3/catalog-context.js';
import {assertFrozenCapacityV3} from '../v3/capacity-policy.js';
import { createOptionalOperationV21 as createOperation8 } from './optional-operation-op8.js';
import { isDeepStrictEqual } from 'node:util';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { FrozenQuestionV21, InFlightEpochV21, OperationPinV21, ResearchProjectV21, RootV21 } from '../../contracts/v21.js';
import type { ResourceRef } from '../../../learning/research-data.js';
import { ContractValidationError } from '../../../runtime/strict-schema.js';
import { RootInterpretationSchemaV21 } from './schemas.js';
import { TagsSchemaV21, validTagsV21 } from './tags.js';
import { digestV21 } from './state.js';
import { OPTIONAL_MODE_V21, type OptionalControlV21, type OptionalProofArtifactV21 } from './optional-types.js';
const text=Type.String({minLength:1}), strings=Type.Array(text), obj=(p:Record<string,TSchema>)=>Type.Object(p,{additionalProperties:false});
const resource=obj({id:text,version:Type.Integer({minimum:1})});
export const OptionalRouteSchemaV21=obj({methodKey:text,description:text,reason:text,resourceRefs:Type.Array(resource)});
export const OptionalOutcomeSchemaV21=obj({resultKind:Type.Union(['open','supported-result','valid-refutation'].map(value=>Type.Literal(value))),scope:Type.Union(['root','local'].map(value=>Type.Literal(value))),gaps:strings,dependencyArtifactIds:strings,reason:text,reproducible:Type.Boolean(),tags:Type.Optional(strings),outline:Type.Optional(strings)});
export const OptionalWorkerRequestSchemaV21=obj({kind:Type.Union(['auxiliary-worker','way-worker'].map(value=>Type.Literal(value))),route:OptionalRouteSchemaV21,question:text,symbols:Type.Record(Type.String(),text),checks:strings,effort:Type.Union(['shallow','deep'].map(value=>Type.Literal(value))),reason:text});
export const OptionalControlSchemaV21=obj({action:Type.Union(['dispatch','continue','complete','pause'].map(value=>Type.Literal(value))),route:OptionalRouteSchemaV21,outcome:OptionalOutcomeSchemaV21,rootInterpretation:Type.Optional(RootInterpretationSchemaV21),workers:Type.Array(OptionalWorkerRequestSchemaV21),adoptions:Type.Array(obj({artifactId:text,status:Type.Union(['valid','rejected','deferred'].map(value=>Type.Literal(value))),outcome:OptionalOutcomeSchemaV21,reason:text,scientificFailure:Type.Optional(Type.Boolean())})),nearTieReason:Type.Optional(text),failures:Type.Optional(Type.Array(obj({artifactIds:strings,patternKey:text,summary:text,tags:TagsSchemaV21,scientific:Type.Boolean(),generalizable:Type.Boolean()})))});
export interface OptionalOperationContextV21 { project?:ResearchProjectV21; marker?:InFlightEpochV21; brief?:FrozenQuestionV21; root:RootV21; boundaryId:string }
export interface OptionalOperationContractV21 { pin:OperationPinV21; schema:TSchema; prepare(value:unknown):OptionalControlV21; validatePrepared(value:unknown):OptionalControlV21; observeEvidence(evidence:{mapWriteReads?:import('../../../learning/knowledge-map.js').MapOpenResult[];publicBody?:string;mapKnowledge?:import('../../../learning/knowledge-map.js').MapOpenResult[];catalogMaterials?:CatalogMaterialV3[];knowledgeReads?:string[];rootDelivered?:boolean;deliveries?:import('../../contracts/v21.js').AnswerDeliveryV21[];resources?:ResourceRef[];receipts?:import('../v3/operations.js').OperationReceiptV3[]}):void }
function exact(schema:TSchema,value:unknown):void {if(Value.Check(schema,value))return;const details=[...Value.Errors(schema,value)].slice(0,32).map(e=>({path:e.instancePath,keyword:e.keyword,message:e.message}));throw new ContractValidationError(details.map(d=>`${d.path}: ${d.message}`),'format',details);}
/** Operation9 does not reinterpret saved operation8 schemas or declarations. */
export function createOptionalOperationV21(task:'v21_theorist'|'v21_optional_worker',input:unknown,context:OptionalOperationContextV21,revision:OperationPinV21['revision']='v21-operation-9'):OptionalOperationContractV21 {
 if(revision==='v21-operation-8'){
  if(['v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes((task==='v21_optional_worker'?context.brief?.operationRevision:context.marker?.optionalFlow?.operationRevision)??''))throw new Error('Historical operation8 cannot execute an operation9 boundary.');
  return createOperation8(task,input,context,revision) as unknown as OptionalOperationContractV21;
 }
 const c=structuredClone(context),frozen=structuredClone(input) as Record<string,unknown>;
 if(!['v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)||!frozen||typeof frozen!=='object'||Array.isArray(frozen)||frozen.boundaryId!==c.boundaryId||!c.boundaryId||!isDeepStrictEqual(frozen.root,c.root))throw new Error('Optional operation requires its exact frozen root and boundary identity.');
 const worker=task==='v21_optional_worker';
 const boundary=worker?c.brief:c.marker?.snapshot;
 const refinedInquiry=boundary?.inquiryGuidance==='theorist-prior-v2'||boundary?.inquiryGuidance==='theorist-prior-v3';
 const scopedResults=boundary?.resultContract==='scoped-refutation-v1';
 if(scopedResults&&(revision!=='v4-proof-5'||!boundary?.inquiryGuidance||!boundary.modelDirectedKnowledge))throw new Error('Scoped outcomes require their frozen V4 inquiry contract.');
 const projected=['v4-proof-3','v4-proof-4'].includes(revision);
 if(revision==='v4-proof-5'&&(worker?c.brief?.theoryRevision:c.marker?.snapshot.theoryRevision)!=='v4-operation-5')throw new Error('Continuous proof requires its frozen theory revision.');
 if(projected&&(worker?c.brief?.theoryRevision:c.marker?.snapshot.theoryRevision)!==(revision==='v4-proof-4'?'v4-operation-4':'v4-operation-3'))throw new Error('Projected proof requires its exact frozen theory revision.');
 if(revision==='v4-proof-2'&&(worker?c.brief?.theoryRevision:c.marker?.snapshot.theoryRevision)!=='v4-operation-2')throw new Error('Canonical proof requires its exact frozen theory revision.');
 if(['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)){if(worker){if(!c.brief?.budget.capacityPolicy)throw new Error('Missing frozen Worker capacity.');}else{assertFrozenCapacityV3(c.marker!);if(!isDeepStrictEqual(frozen.capacityPolicy,c.marker!.snapshot.capacityPolicy))throw new Error('Frozen invocation capacity differs.');}}
 if(!worker && (['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??''))!==(usesV3Proof(c.project?.researchLoopVersion)))throw new Error('Scientific version and operation revision differ.');
 if((worker?c.brief?.operationRevision:c.marker?.optionalFlow?.operationRevision)!==revision)throw new Error('Operation9 requires its explicitly frozen protocol revision.');
 if(worker){if(!c.brief?.solverRole||!['auxiliary-worker','way-worker'].includes(c.brief.solverRole)||c.boundaryId!==c.brief.callId)throw new Error('Optional worker requires its explicit frozen solver role.');const {boundaryId:_,...brief}=frozen;if(!isDeepStrictEqual(brief,c.brief))throw new Error('Optional worker input differs from its frozen contract.');}
 else if(!c.project||!c.marker||c.marker.solverMode!==OPTIONAL_MODE_V21||c.marker.snapshot.solverMode!==OPTIONAL_MODE_V21||c.marker.projectId!==c.project.id||!isDeepStrictEqual(c.marker.snapshot.root,c.root))throw new Error('Optional Theorist mode must be explicitly and consistently frozen.');
 if(!worker){
  if((frozen.rootInterpretationPending===true)!==(c.project!.rootInterpretationPending===true))throw new Error('Initial root interpretation status differs from the frozen project.');
  for(const key of (['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')?['decision']:['sources','resourceBodies','decision']) as ('sources'|'resourceBodies'|'decision')[])if(frozen[key]!==undefined&&!isDeepStrictEqual(frozen[key],c.marker!.snapshot[key]))throw new Error('Optional source/resource/policy context differs from its frozen snapshot.');
 }
 if(!worker&&['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')&&Array.isArray(frozen.sources)&&frozen.sources.some(source=>!c.marker!.snapshot.sources.some(exact=>isDeepStrictEqual(exact,source))))throw new Error('V3 delivered source differs from its exact frozen authority.');
 if(!worker&&['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')&&Array.isArray(frozen.resourceBodies)&&frozen.resourceBodies.some(body=>!c.marker!.snapshot.resourceBodies?.some(exact=>isDeepStrictEqual(exact,body))))throw new Error('V3 delivered resource differs from its exact frozen authority.');
 const deliveredBodies=(worker?c.brief?.resourceBodies:frozen.resourceBodies) as {ref:ResourceRef;body:string;bodyHash:string}[]|undefined;
 for(const body of deliveredBodies??[])if(digestV21(body.body)!==body.bodyHash)throw new Error('Optional delivered resource bytes failed their frozen hash.');
 const sources=(worker?c.brief?.sources:frozen.sources) as {body:string;bodyHash:string}[]|undefined;
 for(const source of sources??[])if(digestV21(source.body)!==source.bodyHash)throw new Error('Optional delivered source bytes failed their frozen hash.');
 const schema=structuredClone(OptionalControlSchemaV21) as TSchema & {required?:string[];properties:Record<string,TSchema>};
 if(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')){for(const target of [schema.properties.outcome,(schema.properties.adoptions as {items:TSchema & {properties:Record<string,TSchema>}}).items.properties.outcome]){const shape=target as TSchema&{properties:Record<string,TSchema>};shape.properties.receiptRefs=Type.Optional(strings);shape.properties.knowledgeRefs=Type.Optional(strings);shape.properties.sourceRefs=Type.Optional(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')?Type.Array(Type.String(),{description:'IDs of used external frozen documents; not root, resource, knowledge or registry identifiers.'}):strings);}}
 if(scopedResults){
  const adoption=(schema.properties.adoptions as {items:{properties:Record<string,TSchema>}}).items;
  for(const target of [schema.properties.outcome,adoption.properties.outcome]){
   const fields=(target as {properties:Record<string,TSchema>}).properties;
   fields.resultKind=Type.Union(['open','supported-result','valid-refutation','empirical-exclusion'].map(x=>Type.Literal(x)));
   fields.refutationKind=Type.Optional(Type.Union([Type.Literal('counterexample'),Type.Literal('contradiction')],{description:'Required only for valid-refutation. Establish a counterexample under the original premises or derive a contradiction using the target claim.'}));
   const openReportGuidance=refinedInquiry
    ?'Use action=pause with resultKind=open for a measured answer to an open-ended question, compatibility, tension or insufficient evidence. Report the measured finding in your public answer with its exact observation citation. Reserve supported-result for deductions established independently of observations.'
    :'Use open for compatibility, tension or insufficient evidence.';
   fields.reason=Type.String({minLength:1,description:'For empirical-exclusion, state the excluded scope, prediction, auxiliary assumptions, and the comparison including uncertainty. Use root scope only when the excluded prediction follows necessarily from the original target within its stated domain. '+openReportGuidance});
   fields.knowledgeRefs=Type.Optional(Type.Array(text,{description:(refinedInquiry?'For map citations, copy the selection string verbatim from the opened record into knowledgeRefs.':'Actual knowledge citations.')+' Empirical exclusion requires at least one exact reviewed observation. Open its record and check the original source, conditions, units and uncertainty. Measurements cannot establish a mathematical premise.'}));
  }
 }
 if(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')&&!worker)schema.properties.continueMain=Type.Optional(Type.Boolean({description:'For dispatch: true continues main work in parallel (default); false waits for an admitted Worker.'}));
 if(!worker&&scopedResults&&c.marker?.snapshot.scientificMapWrites)schema.properties.mapChanges=Type.Optional(c.marker.snapshot.theoremAuthoring?theoremAuthoringSchema:c.marker.snapshot.mapNodeWriting?scientificMapChangesSchema:legacyScientificMapChangesSchema);
 if(revision==='v4-proof-2'){
  schema.properties.publicStage=worker?Type.Optional(PublicStageSchemaV4):PublicStageSchemaV4;
  if(!worker)schema.required=[...(schema.required??[]),'publicStage'];
  for(const target of [schema.properties.outcome,(schema.properties.adoptions as {items:TSchema & {properties:Record<string,TSchema>}}).items.properties.outcome]) (target as TSchema & {properties:Record<string,TSchema>}).properties.fragmentRefs=Type.Optional(strings);
 }
 if(projected&&!worker){
  const outcome=schema.properties.outcome as TSchema & {required?:string[];properties:Record<string,TSchema>};
  outcome.required=outcome.required?.filter(key=>!['resultKind','scope'].includes(key));
 }
 const interpretationPending=!worker&&frozen.rootInterpretationPending===true;
 if(interpretationPending&&!['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision))schema.required=[...new Set([...(schema.required??[]),'rootInterpretation'])];
 if(['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)){delete schema.properties.rootInterpretation;schema.required=schema.required?.filter(key=>!['rootInterpretation','workers','adoptions'].includes(key));}
 const pin:OperationPinV21={revision,task,solverMode:OPTIONAL_MODE_V21,schemaDigest:digestV21(schema),inputHash:digestV21(frozen)};
 const catalogContext=worker?c.brief?.v3:c.marker?.snapshot.v3;
 let materials:CatalogMaterialV3[]=[],knowledgeReads:string[]=[];
 const mapEnabled=(worker?c.brief?.knowledgeMapRevision:c.marker?.snapshot.knowledgeMapRevision)==='dual-cluster-map-v1';
 const directedMap=worker?c.brief?.modelDirectedKnowledge:c.marker?.snapshot.modelDirectedKnowledge;
 const layeredMap=(worker?c.brief?.knowledgeMapPresentation:c.marker?.snapshot.knowledgeMapPresentation)==='layered-map-v1';
 let mapWriteReads:import('../../../learning/knowledge-map.js').MapOpenResult[]=[];
 let publicBody:string|undefined;
 let mapKnowledge:import('../../../learning/knowledge-map.js').MapOpenResult[]=[];
 const resources=structuredClone(c.brief?.resources??c.marker?.snapshot.resources??[]);
 let deliveries:import('../../contracts/v21.js').AnswerDeliveryV21[]=[];
 const readOriginal=(ref:import('../../contracts/v21.js').RawAnswerRefV21):string|undefined=>{const chunks=deliveries.filter(d=>isDeepStrictEqual(d.answerRef,ref)&&d.startByte>=0&&d.endByte<=ref.byteLength&&d.endByte>d.startByte&&Buffer.byteLength(d.body)===d.endByte-d.startByte&&digestV21(d.body)===d.excerptHash).sort((a,b)=>a.startByte-b.startByte||b.endByte-a.endByte);let end=0;const bytes:Buffer[]=[];for(const d of chunks){if(d.startByte>end)return undefined;if(d.endByte<=end)continue;bytes.push(Buffer.from(d.body).subarray(end-d.startByte));end=d.endByte;}const body=Buffer.concat(bytes).toString('utf8');return end===ref.byteLength&&digestV21(body)===ref.bodyHash?body:undefined;};
 let loaded=['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')?[]:(deliveredBodies??[]).map(r=>r.ref),rootDelivered=false;
 let receipts=structuredClone(c.marker?.optionalFlow?.v3?.receipts??[]);
 const validate=(value:unknown):OptionalControlV21=>{
  if(schema.properties.mapChanges){
   const format=scientificMapFormatIssue((value as OptionalControlV21|undefined)?.mapChanges);if(format)throw format;
  }
  exact(schema,value);const result=structuredClone(value as OptionalControlV21),issues:string[]=[];
  if(['v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)){result.workers??=[];result.adoptions??=[];}
  let supplement:DeclarationSupplementError['fields']|undefined;
  const fail=(message:string)=>{if(issues.length<32)issues.push(message);};
  if(result.mapChanges){
   if(!['complete','pause'].includes(result.action))fail('Attach map changes only when releasing the public report.');
   const fields=mapMetadataIssues(result.mapChanges,mapWriteReads,publicBody);
   if(c.marker?.snapshot.theoremAuthoring)fields.push(...theoremAuthoringIssues(result.mapChanges,mapWriteReads,result.outcome.knowledgeRefs??[]));
   if(fields.length)throw new DeclarationSupplementError(fields.map(f=>f.message),'map-metadata',fields);
  }
  if(projected&&!worker){
   if(result.action==='continue'){result.outcome.resultKind='open';result.outcome.scope??='root';}
   else if(result.outcome.resultKind===undefined||result.outcome.scope===undefined)fail('A non-continuation requires an explicit scientific result kind and scope.');
  }
  const root=result.rootInterpretation?{...c.root,...result.rootInterpretation}:c.root;
  if(result.rootInterpretation&&!interpretationPending)fail('Root interpretation is allowed only at the explicitly pending initial Theorist boundary.');
  if(result.rootInterpretation&&(!root.obligations.length||!root.completionCriteria.length||new Set(root.obligations.map(o=>o.id)).size!==root.obligations.length))fail('Initial interpretation needs complete unique scientific obligations and completion criteria.');
  // Only reclassify a duplicate, already-authorized typed resource dependency.
  // The original submission remains immutable; unknown and adoption references stay untouched.
  if(['v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)&&result.outcome.sourceRefs){
   const sources=worker?c.brief?.sources:c.marker?.snapshot.sources;
   result.outcome.sourceRefs=result.outcome.sourceRefs.filter(id=>
    sources?.some(source=>source.ref.id===id)||!(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')&&rootDelivered&&id===`root:${c.root.hypothesisId}:${c.root.revision}`)&&!result.route.resourceRefs.some(ref=>
     id===`resource:${ref.id}:${ref.version}`&&resources.some(grant=>isDeepStrictEqual(grant,ref))&&
     loaded.some(grant=>isDeepStrictEqual(grant,ref))));
  }
  const validateRoute=(route:OptionalControlV21['route'])=>{for(const ref of route.resourceRefs)if(!resources.some(r=>isDeepStrictEqual(r,ref))||!loaded.some(r=>isDeepStrictEqual(r,ref)))fail('Selected method resource requires an exact delivered frozen version.');};
  if(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??''))for(const [outcomeIndex,outcome] of [result.outcome,...result.adoptions.map(a=>a.outcome)].entries()){const knowledge=worker?c.brief?.v3?.knowledge:c.marker?.snapshot.v3?.knowledge;const target=outcomeIndex>0?((c.marker?.optionalFlow?.artifacts??frozen.artifacts??[]) as OptionalProofArtifactV21[]).find(a=>a.id===result.adoptions[outcomeIndex-1]?.artifactId):undefined;const mapReads=outcomeIndex===0?mapKnowledge:target?.mapKnowledge??[];
    // A node ID shown by our reader is a valid alias only for one actually delivered exact version.
    // Preserve the model's original declaration; canonicalize this host-owned copy for every later check.
    if(mapEnabled&&layeredMap&&outcome.knowledgeRefs)outcome.knowledgeRefs=outcome.knowledgeRefs.map(id=>{
      if(mapReads.some(read=>read.selection===id))return id;
      const matches=mapReads.filter(read=>{
        const ref=read.ref;
        if(!ref||read.selection.startsWith('map_basis_'))return false;
        if(ref.id===id)return true;
        if(!refinedInquiry||read.kind!=='observation')return false;
        const versioned=`${ref.store}:${ref.id}:${ref.version}`;
        return id===versioned||id===`${versioned}:${ref.bodyHash}`;
      });
      if(!matches.length)return id;
      if(matches.length!==1||knowledge?.nodes.some(node=>node.id===id)||materials.some(m=>m.node.id===id)){fail('Map node ID is ambiguous; no exact citation can be inferred.');return id;}
      return matches[0]!.selection;
    });
    if(scopedResults){
     const issue=scopedOutcomeIssue(outcome,mapReads);if(issue){
       fail(issue);
       if(outcomeIndex===0&&outcome.resultKind==='supported-result'&&!outcome.refutationKind&&mapReads.some(read=>read.kind==='observation'&&outcome.knowledgeRefs?.includes(read.selection)))supplement='measured-outcome';
       if(outcomeIndex===0&&outcome.resultKind==='valid-refutation'&&outcome.refutationKind===undefined
         &&!scopedOutcomeIssue({...outcome,refutationKind:'counterexample'},mapReads))supplement='refutation-kind';
     }
     if(target&&(outcome.refutationKind!==target.control.outcome.refutationKind||(outcome.resultKind==='empirical-exclusion'||outcome.resultKind==='valid-refutation')&&outcome.reason!==target.control.outcome.reason))fail('Adoption must preserve the declared refutation and its original scope, comparison and reasoning.');
    }
    for(const id of outcome.knowledgeRefs??[]){if(mapEnabled&&mapReads.some(read=>read.selection===id))continue;const node=knowledge?.nodes.find(n=>n.id===id)??materials.find(m=>m.node.id===id)?.node;if(!node||node.status!=='active')fail('Used knowledge requires an active frozen exact node grant.');
    if(catalogContext?.catalogPin&&node){const catalogMember=catalogContext.catalogNodeIds?.includes(id)||materials.some(m=>m.node.id===id);const exactResource=node.authorityRef&&id===`resource:${node.authorityRef.id}:${node.authorityRef.version}`;
      if(catalogMember&&!knowledgeReads.includes(id)&&!(exactResource&&loaded.some(ref=>isDeepStrictEqual(ref,node.authorityRef))))fail('Used catalog knowledge requires actual exact full delivery.');
      if(node.authorityRef&&!loaded.some(ref=>isDeepStrictEqual(ref,node.authorityRef)))fail('Used knowledge authority requires exact delivered resource body.');
    }
   }const sources=worker?c.brief?.sources:c.marker?.snapshot.sources;for(const id of outcome.sourceRefs??[])if(!sources?.some(s=>s.ref.id===id))fail('Used source requires a frozen exact source grant.');
   const ids=outcome.receiptRefs??[];if(new Set(ids).size!==ids.length)fail('Computational receipt dependencies must be unique.');for(const id of ids){const receipt=receipts.find(r=>r.id===id);if(receipt){const owner=c.marker?.optionalFlow?.artifacts.find(a=>a.v3Execution?.receipts.some(r=>r.id===receipt.id));if(owner&&owner.originalRef.callId!==c.boundaryId&&!outcome.dependencyArtifactIds.includes(owner.id))fail('Prior or Worker computational evidence requires explicit adoption of its owning proof artifact.');if(worker&&receipt.inputBinding.branchId!==c.brief!.question.id)fail('Worker cannot use sibling computational evidence.');}
    if(!receipt||receipt.status!=='completed'||!['exact','formal','conditional','numerical','heuristic'].includes(receipt.verification.kind))fail('Used computational evidence requires an exact available completed receipt.');}}
  validateRoute(result.route);for(const request of result.workers)validateRoute(request.route);
  for(const outcome of [result.outcome,...result.adoptions.map(a=>a.outcome)]){
   if(new Set(outcome.dependencyArtifactIds).size!==outcome.dependencyArtifactIds.length)fail('Outcome dependency identities cannot repeat.');
   if(outcome.resultKind!=='open'&&(outcome.gaps.length||!outcome.reproducible))fail('A supported result or refutation cannot erase open gaps or omit reproducibility.');
  }
  const rootCandidate=(outcome:OptionalControlV21['outcome'])=>outcome.scope==='root'&&outcome.resultKind!=='open'&&!outcome.gaps.length&&outcome.reproducible;
  const openCompletionIssue=worker?'An open scientific result cannot be declared complete.':'An open scientific or merely local result cannot complete the Theorist boundary without explicit adoption of a delivered exact-root result.';
  if(result.action==='complete'&&(worker?result.outcome.resultKind==='open':!rootCandidate(result.outcome)&&!result.adoptions.some(adoption=>adoption.status==='valid'&&rootCandidate(adoption.outcome))))fail(openCompletionIssue);
  if(result.action==='dispatch'&&(!result.workers.length||result.outcome.resultKind!=='open'))fail('Dispatch is a nonterminal open-proof boundary with a precise worker contract.');
  if(result.action!=='dispatch'&&result.workers.length)fail('Worker admission requires the explicit dispatch boundary.');
  if(result.workers.filter(w=>w.kind==='way-worker').length>1)fail('At most one complete alternative route may be admitted.');
  if(result.workers.some(w=>w.kind==='way-worker')&&!result.nearTieReason?.trim())fail('An alternative complete route needs the qualitative near-tie comparison and reason.');
  if(result.continueMain!==undefined&&(!['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)||worker||result.action!=='dispatch'))fail('continueMain is only an op5 Theorist dispatch choice.');
  if(worker&&(result.workers.length||result.adoptions.length||result.rootInterpretation||!['complete','pause'].includes(result.action)))fail('Workers may only finish or leave open their frozen assignment; they cannot dispatch, review or change the root.');
  if(worker&&c.brief?.solverRole==='auxiliary-worker'&&result.outcome.scope!=='local')fail('An auxiliary worker verdict has local scope, never exact-root qualification.');
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
    const ref=original?.originalRef,body=['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision??'')&&ref?readOriginal(ref):original?.body;
    if(!original||!['auxiliary-worker','way-worker'].includes(original.authorRole)||original.technical.executionStatus!=='completed'||original.technical.completeness!=='complete'||ref?.completeness!=='complete'||!ref.byteLength||ref.projectId!==c.project?.id||ref.hypothesisId!==root.hypothesisId||ref.hypothesisRevision!==root.revision||typeof body!=='string'||!body.trim()||Buffer.byteLength(body)!==ref.byteLength||digestV21(body)!==ref.bodyHash){fail('Failure patterns require exact actually delivered complete Worker originals, not own, partial, cancelled, technical or missing work.');continue;}
    if(!result.adoptions.some(adoption=>adoption.artifactId===original.id&&adoption.status==='rejected'&&adoption.scientificFailure===true))fail('Every failure-pattern original needs an explicit rejected scientificFailure judgment in this same control.');
   }
   if(new Set(originals.map(original=>original?.originalRef.callId)).size!==originals.length||new Set(originals.map(original=>original?.originalRef.id)).size!==originals.length||new Set(originals.map(original=>original?.originalRef.attemptId)).size!==originals.length)fail('Repeated artifacts or retries from one Worker original are not independent scientific failures.');
  }
  if(new Set(result.adoptions.map(a=>a.artifactId)).size!==result.adoptions.length)fail('Each delivered artifact may be reviewed only once in this response.');
  if(revision==='v4-proof-2'){
   const visible=Array.isArray(frozen.publicFragments)?frozen.publicFragments as PublicFragmentV4[]:[];
   const trusted=(c.marker?.optionalFlow?.artifacts??[]).flatMap(publicFragmentsV4);
   if(visible.some(f=>!trusted.some(t=>isDeepStrictEqual(t,f))))fail('Public fragment exposure differs from its immutable artifact.');
   try{if(result.publicStage)validatePublicStageV4(result.publicStage,root,visible,(c.marker?.optionalFlow?.artifacts??[]).map(a=>a.id),worker?c.brief!.question.id:'root');}catch(error){fail(error instanceof Error?error.message:String(error));}
   for(const outcome of [result.outcome,...result.adoptions.map(a=>a.outcome)])for(const id of outcome.fragmentRefs??[]){
    const f=visible.find(f=>f.stageId===id);if(!f||f.rootId!==root.revision||f.branch!==(worker?c.brief!.question.id:'root')||!['argued','conditional'].includes(f.fragment.status))fail('Positive fragment premise requires exact scoped argument exposure.');
   }
   if(result.action==='complete'&&result.publicStage?.remainingObligations.length)fail('Root completion retains declared original obligations.');
  }
  if(issues.length&&boundary?.inquiryGuidance==='theorist-prior-v3'&&scopedResults&&['pause','complete'].includes(result.action)){
    if(result.action==='complete'&&issues[0]===openCompletionIssue)supplement='action';
    if(supplement&&issues.length===1)throw new DeclarationSupplementError(issues,supplement);
  }
  if(issues.length)throw new ContractValidationError(issues,'semantic');
  if(projected&&!worker)result.publicStage=derivePublicStageV4(root,result,
   result.outcome.dependencyArtifactIds.filter(id=>(c.marker?.optionalFlow?.artifacts??[]).some(a=>a.id===id&&a.authorRole==='theorist'&&a.acceptanceCommitted&&isDeepStrictEqual(a.root,root))));
  return result;
 };
 return {pin,schema,prepare:validate,validatePrepared(value){
  const declaration=structuredClone(value);
  if(projected&&!worker&&declaration&&typeof declaration==='object')delete (declaration as OptionalControlV21).publicStage;
  const prepared=validate(declaration);
  if(['v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(revision)&&!isDeepStrictEqual(value,prepared))throw new ContractValidationError([projected?'Prepared control differs from its canonical typed references or host projection.':'Prepared operation4 control must use canonical typed references.'],'semantic');return prepared;
 },observeEvidence(e){if(e.mapWriteReads)mapWriteReads=e.mapWriteReads;if(e.publicBody!==undefined)publicBody=e.publicBody;if(e.mapKnowledge){if(!scopedResults&&e.mapKnowledge.some(r=>r.kind==='observation'))throw new Error('Observation outside its frozen result contract.');if(!mapEnabled)throw new Error('Map evidence outside its frozen capability.');if(e.mapKnowledge.some(r=>directedMap?['proved','accepted','definition'].includes(r.qualification)&&!r.basis:r.basis!==undefined||r.bases!==undefined))throw new Error('Map argument evidence differs from its frozen proof contract.');mapKnowledge=structuredClone(e.mapKnowledge);}if(e.catalogMaterials){if(!catalogContext?.catalogPin||worker&&e.catalogMaterials.length)throw new Error('Catalog discovery outside pinned Theorist.');materials=mergeCatalogMaterialsV3(catalogContext.catalogPin,materials,e.catalogMaterials);for(const m of materials)if(m.meta&&!resources.some(r=>r.id===m.meta!.id&&r.version===m.meta!.version))resources.push({id:m.meta.id,version:m.meta.version});}if(e.knowledgeReads)knowledgeReads=[...e.knowledgeReads];if(e.rootDelivered!==undefined)rootDelivered=e.rootDelivered;if(e.deliveries)deliveries=structuredClone(e.deliveries);if(e.resources)loaded=structuredClone(e.resources);if(e.receipts)receipts=[...new Map([...receipts,...e.receipts].map(r=>[r.id,structuredClone(r)])).values()];}};
}
