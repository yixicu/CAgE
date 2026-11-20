import { createHash } from 'node:crypto';
import type { ArchiveSelectionV0, ArchiveReceiptV0, RawAnswerStoreV0, ResearchCompositionV0 } from '../research/contracts/v0.js';
import type { FileResearchStore } from '../storage/index.js';
import type { LearningService } from './learning-service.js';
import type { ResearchLibrary } from './research-library.js';
import { stableHash } from './research-hash.js';
import { requireData } from './research-data.js';
import { validateArchiveSelectionV0, digestV0, samePremiseV0, StaleEvidenceV0Error } from '../research/versions/v0/state.js';
const staleEvidence=(message:string)=>Object.assign(new StaleEvidenceV0Error(message),{code:'STALE_SOURCE'});
const bytesHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Archive the single full original unchanged. This is not another scientific review. */
export async function archiveWayV0(library:ResearchLibrary,raw:RawAnswerStoreV0,selection:ArchiveSelectionV0):Promise<ArchiveReceiptV0> {
  selection=structuredClone(selection); validateArchiveSelectionV0(selection);
  requireData(selection.outcome.reproducible && Boolean(selection.outcome.reproducibility.trim()),'Archive requires explicit model-owned reproducibility.');
  const ref=selection.answerRef, {root,outcome,way}=selection;
  const body=await raw.read(ref,{readerProjectId:selection.projectId,readerRole:'theorist',purpose:'archive',ref});
  const bytes=Buffer.from(body,'utf8');
  requireData(bytes.length===ref.byteLength&&bytesHash(bytes)===ref.bodyHash,'V0 immutable original failed byte verification.');
  const proofRef=await library.publishProof({sessionId:selection.projectId,hypothesisId:root.hypothesisId,hypothesisRevision:root.revision,
    targetKey:stableHash({text:root.originalText,conditions:root.conditions}),target:root.originalText,methodKey:way.methodKey,
    conditions:outcome.conditions,tags:outcome.tags,summary:outcome.summary,proof:body,rootClosed:true,reproducible:true,
    semanticChange:true,logicalRelation:outcome.verdict==='refuted'?'counterexample':'direct',linkReason:root.returnToRoot,
    sourceLoopVersion:'0',v0OriginalAnswers:[ref],archiveOperationId:selection.operationId,sourceRefs:[ref.id]},
    {role:'theorist',sessionId:selection.projectId},selection.expectedRevision).catch(error=>{if(error?.code==='STALE_SOURCE')throw staleEvidence('V0 archive original evidence was withdrawn.');throw error;});
  return {operationId:selection.operationId,selectionHash:digestV0(selection),status:'saved',selection,proofRef,retries:0};
}
export function createV0Composition(store:FileResearchStore,learning?:LearningService):ResearchCompositionV0 {
  return {rawAnswers:store.rawAnswersV0,
    freezeSources:async project=>Promise.all(project.sources.map(async ref=>{const bytes=await store.readSource(project.id,ref);return {ref:structuredClone(ref),body:Buffer.from(bytes).toString('utf8'),bodyHash:bytesHash(bytes)};})),
    readBoundary:async project=>store.library.readBoundary({sessionId:project.id,loopVersion:2,hypothesis:project.hypothesis}),
    readResource:async(ref,project)=>{const catalog=project.activeEpoch?.snapshot.resourceCatalog;requireData(catalog,'Frozen V0 resources required.','FORBIDDEN');return store.library.frozenResourceReader(catalog,{role:'theorist',sessionId:project.id,loopVersion:2}).read(ref);},
    expectedArchiveRevision:async(project,way)=>Object.values(store.library.snapshot().proofs).find(proof=>proof.sessionId===project.id&&proof.hypothesisId===project.root.hypothesisId&&proof.methodKey===way.methodKey)?.revision??0,
    archiveWay:async selection=>{
      const project=await store.loadProject(selection.projectId);
      if(project.schemaVersion!==4)throw staleEvidence('Archive execution version changed.');
      const valid=project.root.hypothesisId===selection.root.hypothesisId&&project.root.revision===selection.root.revision&&selection.possibleDependencySources.every(prior=>project.sources.some(current=>samePremiseV0(prior,current)));
      if(!valid){await store.library.invalidateV0RawAnswerSources([selection.answerRef],{role:'theorist',sessionId:project.id});throw staleEvidence('V0 archive root or premise is no longer current.');}
      for(const prior of selection.possibleDependencySources){const current=project.sources.find(ref=>samePremiseV0(prior,ref))!;try{await store.readSource(project.id,current);}catch(error){if(['SOURCE_CHANGED','SOURCE_NOT_GRANTED'].includes((error as {code?:string}).code??'')){await store.library.invalidateV0RawAnswerSources([selection.answerRef],{role:'theorist',sessionId:project.id});throw staleEvidence('V0 archive premise changed or is no longer authorized.');}throw error;}}
      return archiveWayV0(store.library,store.rawAnswersV0,selection);
    },
    invalidateSources:async(project,currentSources)=>{
      const stale=[...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])].flatMap(epoch=>{
        const selection=epoch.archive?.selection;
        if(!selection)return [];
        const rootChanged=selection.root.hypothesisId!==project.root.hypothesisId||selection.root.revision!==project.root.revision;
        const premiseChanged=selection.possibleDependencySources.some(prior=>!currentSources.some(current=>samePremiseV0(prior,current)));
        return rootChanged||premiseChanged?[selection.answerRef]:[];
      });
      await store.library.invalidateV0RawAnswerSources(stale,{role:'theorist',sessionId:project.id});
    },
    afterCheckpoint:async(project,epoch)=>{await learning?.onCheckpointV0(project,epoch);},
  };
}
