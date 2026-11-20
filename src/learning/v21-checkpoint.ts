import {join} from 'node:path';
import {OperationJournal} from '../runtime/operation-journal.js';
import {optionalCallIdV21,optionalPinsV21} from '../runtime/v21-optional-recovery.js';
import {MapReader} from '../research/versions/v4/map-reader.js';
import { usesV3Proof } from '../research/versions/v3/proof-version.js';
import {validateCatalogMaterialV3} from '../research/versions/v3/catalog-context.js';
import { modernOptionalRevision, optionalArchiveRelation } from './research-data.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ArchiveSelectionV21, ArchiveReceiptV21, RawAnswerStoreV21, ResearchCompositionV21, ResearchProjectV21, ReviewReceiptV21 } from '../research/contracts/v21.js';
import type { FileResearchStore } from '../storage/index.js';
import type { LearningService } from './learning-service.js';
import type { ResearchLibrary } from './research-library.js';
import { validTagsV21 } from '../research/versions/v21/tags.js';
import { stableHash } from './research-hash.js';
import { validateArchiveSelection } from '../research/versions/v21/review.js';
import { requireData } from './research-data.js';
import type { OptionalArchiveReceiptV21, OptionalProofArtifactV21, OptionalProofSelectionV21, OptionalTheoristResultV21 } from '../research/versions/v21/optional-types.js';
import { validateOptionalArtifactV21, validateOptionalProofSelectionV21 } from '../research/versions/v21/optional-proof.js';
const bytesHash=(body:Uint8Array)=>createHash('sha256').update(body).digest('hex');
/** Stable scientific evidence identity; administrative delivery timing is not evidence. */
export const optionalArtifactEvidenceKeyV21 = (artifact: OptionalProofArtifactV21): string => stableHash({
  ...(artifact.resultContract?{resultContract:artifact.resultContract}:{}),
  ...(artifact.v4TheorySupport?{v4TheorySupport:artifact.v4TheorySupport}:{}),
  ...(artifact.mapKnowledge?.length?{mapKnowledge:artifact.mapKnowledge}:{}),
  ...(artifact.operationRevision?{operationRevision:artifact.operationRevision}:{}),
  ...(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')?{publicStage:artifact.control.publicStage,fragmentExposureRefs:artifact.fragmentExposureRefs}:{}),
  id:artifact.id,authorRole:artifact.authorRole,root:artifact.root,route:artifact.route,originalRef:artifact.originalRef,
  technical:artifact.technical,qualification:artifact.qualification,acceptedOutcome:artifact.acceptedOutcome,
  originalOutcome:artifact.control.outcome,judgment:artifact.judgment,scientificFailure:artifact.scientificFailure,
  adoptionReason:artifact.adoptionReason,exposureArtifactIds:artifact.exposureArtifactIds,
  ...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')?{originalExposureRefs:artifact.originalExposureRefs,continuationArtifactIds:artifact.continuationArtifactIds}:{}),
});
export async function restoreOptionalProofsV21(library:ResearchLibrary,raw:RawAnswerStoreV21,project:Readonly<ResearchProjectV21>,
  artifacts:OptionalProofArtifactV21[],review:{callId:string;evidenceRevision:number}):Promise<void> {
  const marker=project.activeEpoch,flow=marker?.optionalFlow,call=marker?.calls.find(candidate=>candidate.id===review.callId);
  const result=call?.result as OptionalTheoristResultV21|undefined;
  requireData(marker?.solverMode==='theorist-owned-optional-workers-v2' && flow && !flow.conflictArtifactIds.length
    && flow.evidenceRevision===review.evidenceRevision && call?.task==='v21_theorist' && call.status==='completed'
    && ['v21-operation-8','v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(call.operation?.revision??'') && result?.technical.executionStatus==='completed' && result.technical.completeness==='complete'
    && result.originalRef.callId===review.callId && result.originalRef.owner===project.id && result.originalRef.projectId===project.id
    && result.originalRef.hypothesisId===marker.snapshot.root.hypothesisId && result.originalRef.hypothesisRevision===marker.snapshot.root.revision,
  'Requalification requires a completed fresh exact Theorist review after conflict resolution.','FORBIDDEN');
  for (const artifact of artifacts) {
    const current=flow.artifacts.find(candidate=>candidate.id===artifact.id),adoption=result.control.adoptions.find(item=>item.artifactId===artifact.id);
    const delivered=(call.input as {artifacts?:(OptionalProofArtifactV21&{body?:string})[]}).artifacts?.find(item=>item.id===artifact.id);
    requireData(current && isDeepStrictEqual(current,artifact) && artifact.judgment?.callId===review.callId
      && artifact.judgment.evidenceRevision===review.evidenceRevision && adoption?.status==='valid'
      && isDeepStrictEqual(adoption.outcome,artifact.acceptedOutcome) && adoption.reason===artifact.adoptionReason
      && delivered && isDeepStrictEqual(delivered.originalRef,artifact.originalRef) && delivered.authorRole===artifact.authorRole
      && typeof delivered.body==='string' && Buffer.byteLength(delivered.body,'utf8')===artifact.originalRef.byteLength
      && bytesHash(Buffer.from(delivered.body,'utf8'))===artifact.originalRef.bodyHash,
    'Requalification must name each exact delivered original and its fresh valid adoption.','FORBIDDEN');
    validateOptionalArtifactV21(marker.snapshot.root,artifact,flow.artifacts,artifact.authorRole!=='auxiliary-worker'&&artifact.acceptedOutcome?.scope==='root');
    const body=await raw.read(artifact.originalRef,{readerProjectId:project.id,readerRole:'theorist',purpose:'archive',ref:artifact.originalRef});
    requireData(Buffer.byteLength(body,'utf8')===artifact.originalRef.byteLength&&bytesHash(Buffer.from(body,'utf8'))===artifact.originalRef.bodyHash,'Requalification original integrity mismatch.');
  }
  await library.requalifyOptionalProofSources(project.id,artifacts.map(artifact=>({artifactId:artifact.id,
    evidenceKey:optionalArtifactEvidenceKeyV21(artifact),originalRef:artifact.originalRef})),review,{role:'theorist',sessionId:project.id});
}
/** A Theorist manuscript is not synthesized into a WorkerAnswer to use old archive code. */
export async function archiveOptionalProofV21(library: ResearchLibrary, raw: RawAnswerStoreV21, input: OptionalProofSelectionV21): Promise<OptionalArchiveReceiptV21> {
  const selection = structuredClone(input);
  validateOptionalProofSelectionV21(selection);
  requireData(selection.caseGroupId.trim() && Number.isSafeInteger(selection.evidenceRevision) && selection.evidenceRevision > 0,
    'Optional archive requires a stable case lineage and positive evidence revision.');
  const {artifact,root} = selection, outcome = artifact.acceptedOutcome!;
  const originals: Record<string,string> = {};
  for (const original of [artifact,...selection.dependencies]) {
    const ref = original.originalRef;
    requireData(ref.owner === selection.projectId && ref.projectId === selection.projectId
      && ref.hypothesisId === root.hypothesisId && ref.hypothesisRevision === root.revision,
    'Optional archive dependencies require exact owned root originals.');
    const body = await raw.read(ref,{readerProjectId:selection.projectId,readerRole:'theorist',purpose:'archive',ref});
    requireData(Buffer.byteLength(body,'utf8') === ref.byteLength && bytesHash(Buffer.from(body,'utf8')) === ref.bodyHash,
      'Optional archive original integrity mismatch.');
    requireData(!Object.hasOwn(originals,original.id),'Duplicate optional original identity.');
    originals[original.id] = body;
  }
  const modern = modernOptionalRevision(artifact.operationRevision);
  const learningMetadata = validTagsV21(outcome.tags) && Array.isArray(outcome.outline) && outcome.outline.length > 0 && outcome.outline.every(line=>typeof line==='string'&&!!line.trim());
  const provenance = {
    ...(selection.resultContract?{resultContract:selection.resultContract}:{}),
    ...(selection.modelDirectedKnowledge?{modelDirectedKnowledge:true as const}:{}),
    ...(artifact.mapKnowledge?.length?{mapKnowledge:structuredClone(artifact.mapKnowledge)}:{}),
    ...(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')?{v4TheorySupport:{
      sources:[...new Map([artifact,...selection.dependencies].flatMap(a=>a.v4TheorySupport?.sources??[]).map(s=>[stableHash(s),s])).values()],
      proofRefs:[...new Map([artifact,...selection.dependencies].flatMap(a=>a.v4TheorySupport?.proofRefs??[]).map(s=>[stableHash(s),s])).values()],
    }}:{}),
    ...(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')?{v3KnowledgeSources:artifact.v3Execution?.catalogPin?await library.catalogKnowledgeSourcesV3(artifact.v3Execution.catalogPin,[...new Set([artifact,...selection.dependencies].flatMap(source=>[...(source.acceptedOutcome?.knowledgeRefs??[]),...(source.control.outcome.knowledgeRefs??[])]))].filter(id=>[...(artifact.v3Execution?.catalogNodeIds??[]),...(artifact.v3Execution?.catalogMaterials??[]).map(m=>m.node.id),...selection.dependencies.flatMap(a=>[...(a.v3Execution?.catalogNodeIds??[]),...(a.v3Execution?.catalogMaterials??[]).map(m=>m.node.id)])].includes(id))):library.knowledgeSourcesV3([...new Set([artifact,...selection.dependencies].flatMap(source=>[...(source.acceptedOutcome?.knowledgeRefs??[]),...(source.control.outcome.knowledgeRefs??[])]))])}:{}),
    ...(modern?{operationRevision:artifact.operationRevision!,conditionsRole:'host-root-context' as const,learningEligibility:learningMetadata?'eligible' as const:'metadata-incomplete' as const}:{}),
    artifactId:artifact.id,caseGroupId:selection.caseGroupId,evidenceRevision:selection.evidenceRevision,
    evidenceKey:stableHash({artifact:optionalArtifactEvidenceKeyV21(artifact),dependencies:selection.dependencies.map(optionalArtifactEvidenceKeyV21)}),
    artifactEvidenceKey:optionalArtifactEvidenceKeyV21(artifact),
    authorRole:artifact.authorRole,originalRef:artifact.originalRef,root,route:artifact.route,
    exposureArtifactIds:[...artifact.exposureArtifactIds],acceptedOutcome:outcome,
    ...(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')?{publicStage:artifact.control.publicStage,fragmentExposureRefs:artifact.fragmentExposureRefs}:{}),
    ...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')?{originalExposureRefs:artifact.originalExposureRefs,continuationArtifactIds:artifact.continuationArtifactIds}:{}),
    ...(artifact.adoptionReason?{adoptionReason:artifact.adoptionReason}:{}),
    dependencies:selection.dependencies.map(dependency=>({... (dependency.mapKnowledge?.length?{mapKnowledge:structuredClone(dependency.mapKnowledge)}:{}),artifactId:dependency.id,evidenceKey:optionalArtifactEvidenceKeyV21(dependency),authorRole:dependency.authorRole,
      originalRef:dependency.originalRef,exposureArtifactIds:[...dependency.exposureArtifactIds],
      ...(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')?{publicStage:dependency.control.publicStage,fragmentExposureRefs:dependency.fragmentExposureRefs}:{}),
      ...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')?{originalExposureRefs:dependency.originalExposureRefs,continuationArtifactIds:dependency.continuationArtifactIds}:{}),
      ...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')&&dependency.control.outcome.resultKind==='open'
        ?{kind:['v4-proof-2','v4-proof-3','v4-proof-4'].includes(artifact.operationRevision??'')?'fragment' as const:'continuation' as const,originalOutcome:dependency.control.outcome}
        :{acceptedOutcome:dependency.acceptedOutcome!,...(selection.resultContract&&dependency.acceptedOutcome?.resultKind!=='supported-result'?{kind:'refutation-evidence' as const}:{})})})),
  };
  const prior = Object.values(library.snapshot().proofs).find(proof=>proof.sessionId === selection.projectId && proof.optionalProof?.artifactId === artifact.id);
  const proofRef = await library.publishProof({sessionId:selection.projectId,hypothesisId:root.hypothesisId,hypothesisRevision:root.revision,
    targetKey:stableHash({text:root.originalText,conditions:root.conditions}),target:root.originalText,methodKey:artifact.route.methodKey,
    conditions:modern?root.conditions:outcome.conditions!,tags:modern&&!validTagsV21(outcome.tags)?[]:outcome.tags!,summary:(outcome.outline??[]).join('\n'),proof:originals[artifact.id]!,
    rootClosed:true,reproducible:true,semanticChange:true,logicalRelation:optionalArchiveRelation(outcome,selection.resultContract),
    linkReason:outcome.reason,sourceLoopVersion:selection.sourceLoopVersion??(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(artifact.operationRevision??'')?'3.0':'2.1'),optionalProof:provenance,optionalOriginalBodies:originals,
    archiveOperationId:selection.operationId,sourceRefs:[artifact,...selection.dependencies].map(source=>source.originalRef.id)},
  {role:'theorist',sessionId:selection.projectId},prior?.revision ?? 0);
  return {operationId:selection.operationId,artifactId:artifact.id,selectionHash:stableHash(selection),selection,status:'saved',proofRef};
}
/** Host presentation around originals, never a model-authored replacement manuscript. */
export async function archiveWayV21(library:ResearchLibrary, raw:RawAnswerStoreV21, selection:ArchiveSelectionV21):Promise<ArchiveReceiptV21> {
  selection=structuredClone(selection);
  const {root,closure,review}=selection;
  validateArchiveSelection(selection,{legacyTags:!['v21-operation-3','v21-operation-4','v21-operation-5','v21-operation-6','v21-operation-7'].includes(selection.review.operationRevision??'')});
  const bodies:string[]=[];
  for(const ref of selection.answers) {
    requireData(ref.projectId===selection.projectId && ref.owner===selection.projectId,'Archive originals require exact session ownership.');
    const body=await raw.read(ref,{readerProjectId:selection.projectId,readerRole:'theorist',purpose:'archive',ref});
    const bytes=Buffer.from(body,'utf8');
    requireData(bytes.length===ref.byteLength&&bytesHash(bytes)===ref.bodyHash,'Archive original integrity mismatch.');
    const deliveries=[...review.answerDeliveries,...review.cachedAnswerDeliveries].filter(item=>isDeepStrictEqual(item.answerRef,ref));
    const validDeliveries=deliveries.filter(delivery=>{
      const {startByte:start,endByte:end}=delivery;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>bytes.length) return false;
      const slice=bytes.subarray(start,end);
      return Buffer.from(slice.toString('utf8'),'utf8').equals(slice)&&bytesHash(slice)===delivery.excerptHash
        && (!('body' in delivery)||delivery.body===slice.toString('utf8'));
    });
    requireData(validDeliveries.length===deliveries.length,'An archived delivery receipt failed immutable byte verification.');
    const full=validDeliveries.some(delivery=>delivery.kind==='full-original'&&delivery.startByte===0&&delivery.endByte===bytes.length);
    requireData(full || review.reviewMode==='interface-v1' && validDeliveries.length>0,'Archive needs actual full delivery or valid light-review evidence.');
    bodies.push(`## ${bodies.length+1}. ${ref.questionId}\n\n${body}`);
  }
  const proofRef=await library.publishProof({sessionId:selection.projectId,hypothesisId:root.hypothesisId,hypothesisRevision:root.revision,
    targetKey:stableHash({text:root.originalText,conditions:root.conditions}),target:root.originalText,methodKey:selection.methodKey,
    conditions:selection.conditions,tags:selection.tags,summary:selection.outline.join('\n'),proof:bodies.join('\n\n'),rootClosed:true,reproducible:['v21-operation-6','v21-operation-7'].includes(review.operationRevision??'')?closure.reproducible===true:closure.reproducible??true,
    semanticChange:true,logicalRelation:closure.resultKind==='valid-refutation'?'counterexample':closure.rootRelation==='equivalent'?'equivalent':closure.rootRelation==='sufficient'?'sufficient':'direct',linkReason:closure.reason,
    sourceLoopVersion:'2.1',originalAnswers:selection.answers,archiveOperationId:selection.operationId,
    sourceRefs:selection.answers.map(ref=>ref.id)}, {role:'theorist',sessionId:selection.projectId},selection.expectedRevision);
  return {operationId:selection.operationId,wayId:selection.wayId,selectionHash:stableHash(selection),status:'saved',selection,proofRef,retries:0};
}
/** Await after the durable accepted review and before archive or another boundary. */
export async function invalidateReviewedEvidenceV21(library:ResearchLibrary,project:Readonly<ResearchProjectV21>,review:Readonly<ReviewReceiptV21>):Promise<void> {
  if(library.snapshot().v21AppliedReviews?.[project.id]?.includes(review.id)) return;
  const answers=[...project.answers,...(project.activeEpoch?.answers??[])];
  const actor={role:'theorist' as const,sessionId:project.id};
  const invalidated=review.invalidatedAnswerIds.map(id=>answers.find(answer=>answer.id===id)?.answerRef);
  requireData(invalidated.every(ref=>ref&&ref.projectId===project.id),'Review withdrawal requires exact owned answer versions.');
  await library.invalidateRawAnswerSources(invalidated.filter((ref):ref is NonNullable<typeof ref>=>Boolean(ref)),actor);
  const judgments=Object.fromEntries(review.decisions.filter(decision=>!review.invalidatedAnswerIds.includes(decision.answerId)).map(decision=>[decision.answerId,stableHash(decision)]));
  await library.recordV21ReviewEvidence(project.id,judgments,[...review.invalidatedAnswerIds],actor,review.id);
}
export function createV21Composition(store:FileResearchStore,learning?:LearningService):ResearchCompositionV21 {
  return {rawAnswers:store.rawAnswers, v4KnowledgeLibrary:store.library, v4DataRoot:store.dataRoot, v4ProofValid:ref=>store.library.isProofValid(ref),
    v4SourceProject:async id=>{
      const project=await store.loadProject(id), active=await store.loadInFlight(id);
      if(project.schemaVersion!==3 || project.researchLoopVersion!=='4.0')throw new Error('V4 source unavailable');
      if(active){
        if(!('schemaVersion' in active)||active.schemaVersion!==3 || active.projectId!==id)throw new Error('V4 source boundary unavailable');
        project.activeEpoch=active;
      }
      return project;
    },
    freezeCatalogBoundaryV3:async project=>{
      const directed=project.researchLoopVersion==='4.0';
      const {catalogPin:pin,networkPin}=await store.library.freezeMethodNetworkV3('query-relevance-v3',directed);
      const selection=await store.library.queryMethodNetworkV3(networkPin,directed?{view:'directory',query:''}:{query:[project.root.originalText,...project.root.domain,...project.root.conditions].join('\n'),maxNodes:12,maxChars:16384,maxHops:1});
      const refs=new Map<string,import('./research-data.js').ResourceRef>();
      for(const route of [...selection.routes,...selection.clusters.flatMap(cluster=>cluster.routes)])refs.set(`${route.resourceRef.id}:${route.resourceRef.version}`,route.resourceRef);
      for(const entry of selection.uncovered)if(entry.node.authorityRef)refs.set(`${entry.node.authorityRef.id}:${entry.node.authorityRef.version}`,entry.node.authorityRef);
      const resources=await Promise.all([...refs.values()].map(ref=>store.library.catalogMetaV3(pin,ref)));
      const nodes=await Promise.all(resources.map(meta=>store.library.readCatalogNodeV3(pin,`resource:${meta.id}:${meta.version}`)));
      for(const entry of selection.uncovered)if(!nodes.some(node=>node.id===entry.node.id))nodes.push(entry.node);
      return {pin,methodNetwork:{presentationRevision:'progressive-navigation-v1' as const,pin:networkPin,selection},boundary:{decision:store.library.decisionV3(),skills:resources.filter(meta=>meta.kind!=='specific-strategy'),strategies:resources.filter(meta=>meta.kind==='specific-strategy')},nodes,edges:[]};
    },
    validateCatalogMaterialsV3:async(project,materials)=>{
      const pin=project.activeEpoch?.snapshot.v3?.catalogPin;requireData(pin,'Catalog material requires a pinned epoch.','FORBIDDEN');
      for(const material of materials){validateCatalogMaterialV3(material,pin);const node=await store.library.readCatalogNodeV3(pin,material.node.id,project.activeEpoch?.snapshot.modelDirectedKnowledge);requireData(isDeepStrictEqual(node,material.node),'Catalog node differs from exact pinned member.','FORBIDDEN');
        if(material.meta){const meta=await store.library.catalogMetaV3(pin,material.meta,project.activeEpoch?.snapshot.modelDirectedKnowledge);requireData(isDeepStrictEqual(meta,material.meta),'Catalog authority differs from exact pinned metadata.','FORBIDDEN');}
        if(material.body!==undefined){const original=await store.library.readCatalogResourceV3(pin,material.meta!,{role:'theorist',sessionId:project.id,loopVersion:2},project.activeEpoch?.snapshot.modelDirectedKnowledge);requireData(original.body===material.body,'Catalog original bytes differ from immutable revision.','FORBIDDEN');}
      }
    },
    invalidatedMapEvidenceV4:async(projectId,reads)=>{const invalid:string[]=[];for(const read of reads)if(!await store.library.knowledgeMap.evidenceValid(read,'local-user',projectId))invalid.push(read.selection);return invalid;},
    validateMapKnowledgeV4:async(spec,call,refs,writing)=>{
      const scope='brief' in spec.context?spec.context.brief:spec.context.snapshot;
      requireData(spec.loop.researchLoopVersion==='4.0'&&scope.knowledgeMapRevision==='dual-cluster-map-v1'&&spec.id===call.id+'_session','Map references require the frozen proof capability.','FORBIDDEN');
      const invocation={task:call.task,input:call.input,operation:call.operation,recoveryGeneration:call.recoveryGeneration};
      const journal=await OperationJournal.inspect(join(store.dataRoot,'pi','v21-call-journal'),optionalCallIdV21(spec,invocation),optionalPinsV21(spec,invocation));
      requireData(journal,'Map references require a saved native read journal.','FORBIDDEN');
      return MapReader.validateUses(store.library,store.dataRoot,spec.projectId,call.id,refs,spec.role==='worker',await journal.captured(),!!scope.modelDirectedKnowledge,scope.resultContract==='scoped-refutation-v1',writing);
    },
    validateCatalogKnowledgeV3:async(project,ids)=>{const pin=project.activeEpoch?.snapshot.v3?.catalogPin;requireData(pin,'Catalog knowledge requires a pinned epoch.','FORBIDDEN');for(const id of ids)await store.library.readCatalogNodeV3(pin,id,project.activeEpoch?.snapshot.modelDirectedKnowledge);},

    readKnowledgeV3:async()=>store.library.knowledgeSnapshotV3(),
    invalidatedResourceRefsV3:async refs=>{const resources=store.library.snapshot().resources;return refs.filter(ref=>!resources[ref.id]||resources[ref.id]!.status!=='valid');},
    invalidatedKnowledgeRefsV3:async ids=>{const state=store.library.snapshot(),publication=state.knowledgeV3;return ids.filter(id=>{
      const node=publication?.nodes.find(n=>n.id===id);if(!node)return false;
      const support=publication?.supports[id];if(support&&!store.library.isProofValid(support))return true;
      if(node.status==='revoked'||node.status==='needs-review')return true;
      const ref=node.authorityRef;return !!ref&&(!state.resources[ref.id]||state.resources[ref.id]!.status!=='valid');
    });},
    invalidatedSourceIdsV3:async(project,sources,usedIds)=>{
      const current=await store.loadProject(project.id),invalid:string[]=[];
      for(const id of usedIds){
        const frozen=sources.find(source=>source.ref.id===id);
        if(!frozen||!current.sources.some(ref=>isDeepStrictEqual(ref,frozen.ref))){invalid.push(id);continue;}
        try{const bytes=await store.readSource(project.id,frozen.ref);if(bytesHash(bytes)!==frozen.bodyHash)invalid.push(id);}catch{invalid.push(id);}
      }return invalid;
    },
    archiveOptionalProof:selection=>archiveOptionalProofV21(store.library,store.rawAnswers,selection),
    restoreOptionalProofs:(project,artifacts,review)=>restoreOptionalProofsV21(store.library,store.rawAnswers,project,artifacts,review),
    invalidateOptionalProofs:async(project,artifactIds)=>{await store.library.invalidateOptionalProofSources(artifactIds,{role:'theorist',sessionId:project.id});},
    stopOptionalLearning:async(project)=>{await learning?.pauseOptionalProject(project.id,Math.max(project.epoch,project.activeEpoch?.epoch??0));},
    freezeSources:async project=>Promise.all(project.sources.map(async ref=>{
      const bytes=await store.readSource(project.id,ref);
      return {ref:structuredClone(ref),body:Buffer.from(bytes).toString('utf8'),bodyHash:bytesHash(bytes)};
    })),
    invalidateReviewedEvidence:async(project,review)=>invalidateReviewedEvidenceV21(store.library,project,review),
    readResource:async(ref,project)=>{
      const pin=project.activeEpoch?.snapshot.v3?.catalogPin;if(pin)return store.library.readCatalogResourceV3(pin,ref,{role:'theorist',sessionId:project.id,loopVersion:2},project.activeEpoch?.snapshot.modelDirectedKnowledge);
      const catalog=project.activeEpoch?.snapshot.resourceCatalog;
      requireData(catalog,'Selected resource bodies require frozen boundary metadata.','FORBIDDEN');
      return store.library.frozenResourceReader(catalog,{role:'theorist',sessionId:project.id,loopVersion:2}).read(ref);
    },
    readBoundary:async project=>{
      const boundary=store.library.readBoundary({sessionId:project.id,loopVersion:2,hypothesis:project.hypothesis});
      if(!usesV3Proof(project.researchLoopVersion))return boundary;
      const resources=Object.values(store.library.snapshot().resources).filter(r=>r.enabled&&r.status==='valid');
      requireData(resources.length<=2000,'V3 local authority index exceeds its explicit resource budget.');
      return {...boundary,skills:resources.filter(r=>r.kind!=='specific-strategy'),strategies:resources.filter(r=>r.kind==='specific-strategy')};
    },
    selectResources:async project=>{const boundary=store.library.readBoundary({sessionId:project.id,loopVersion:2,hypothesis:project.hypothesis}); return [...boundary.skills,...boundary.strategies].filter(item=>item.enabled&&item.status==='valid').map(({id,version})=>({id,version}));},
    expectedArchiveRevision:async(project,way)=>Object.values(store.library.snapshot().proofs).find(proof=>proof.sessionId===project.id&&proof.hypothesisId===project.root.hypothesisId&&proof.methodKey===way.methodKey)?.revision??0,
    archiveWay:selection=>archiveWayV21(store.library,store.rawAnswers,selection),
    afterCheckpoint:async(project,epoch)=>{await learning?.onCheckpointV21(project,epoch);},
  };
}
