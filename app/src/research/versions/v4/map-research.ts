import {mapWriteSelections,findMapWriteRead,registerScientificSource} from './scientific-map-write.js';
import type {MapSource} from '../../../learning/knowledge-map.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import {mapReadFeedback,type MapQuery,type MapSelection} from '../../../learning/knowledge-map.js';
import {stableHash} from '../../../learning/research-hash.js';
import {MapReader,projectMapReadRecord,type MapReadRecord} from './map-reader.js';
import {clearResearchReadContext,savedPublicResearchId,isPublicResearchReply,type PostReportStudyV45,type ResearchReplyV45} from './post-report.js';

/** Replaying a page may lose authority; never fill a revoked slot with a new comparison. */
export async function retainedMapPage(previous:MapSelection|undefined,requested:MapQuery|undefined,lookup:(q:MapQuery)=>Promise<MapSelection>){
 const query=requested??{mode:'directory'};
 try{
  const selection=await lookup(query);
  if(!previous||query.mode==='directory'||stableHash(previous)===stableHash(selection))return {query,selection};
 }catch(error){if(!mapReadFeedback(error))throw error;}
 const directory:MapQuery={mode:'directory'};
 return {query:directory,selection:await lookup(directory)};
}

export class MapResearch {
 constructor(private readonly root:string,private readonly library:ResearchLibrary){}
 private reader(study:PostReportStudyV45){const projectId=study.report.scope.projectId,taskId=study.id+':'+study.phase;return new MapReader(this.library,{...(study.refutationEvidence?{refutationEvidence:true}:{}),purpose:study.phase==='review'?'map-theory-review':'map-theory-study',ownerId:'local-user',projectId,taskId,profileId:'profile_'+stableHash(['local-user',projectId])},MapReader.path(this.root,projectId,taskId),undefined,study.modelDirectedKnowledge);}
 async prepare(study:PostReportStudyV45){if(study.map?.presentation&&study.map.phase&&study.map.phase!==study.phase)clearResearchReadContext(study);const reader=this.reader(study);const query=study.map?.query??{query:study.report.body.slice(0,16000),mode:'candidates' as const};const page=study.modelDirectedKnowledge?await retainedMapPage(study.map?.selection,study.map?.query,q=>reader.lookup(q)):{query,selection:await reader.lookup(query)};study.map={...await reader.context(),phase:study.phase,...page,...(study.map?.lastRead?{lastRead:study.map.lastRead,readResults:[await projectMapReadRecord(this.library,study.map.lastRead)]}:study.map?.readResults?{readResults:await reader.projectBatchResults(study.map.readResults)}:{})};if(study.readBatch)study.currentReadResults=await Promise.all(study.readBatch.results.map(async r=>r.mapRead?{toolCallId:r.toolCallId,...await projectMapReadRecord(this.library,r.mapRead)}:study.currentReadResults?.find(x=>(x as {toolCallId:string}).toolCallId===r.toolCallId)??{toolCallId:r.toolCallId,result:r.result}));}
 async resolve(study:PostReportStudyV45,reply:ResearchReplyV45){const clean={...reply};delete clean.map;delete clean.mapRead;delete clean.mapWriteReads;
  if(reply.mapChanges||reply.placement){
   if(!study.scientificMapWrites||study.archiveReview)throw Error('Scientific map writing is unavailable in this study.');
   const reads=(await this.reader(study).context()).opened;
   const selections=reply.mapChanges?mapWriteSelections(reply.mapChanges):[];
   if(reply.placement?.kind==='nearby')selections.push(reply.placement.anchor);
   clean.mapWriteReads=selections.map(selection=>{
    const read=findMapWriteRead(reads,selection);if(!read)throw Error('Open the exact map target in this phase: '+selection);
    return read;
   });
  }
  if(!['lookup-map','open-map','refresh-map','save-map-result','save-and-review','read-map-batch'].includes(reply.action))return clean;const reader=this.reader(study);let selection=study.map?.selection;
  if(reply.action==='read-map-batch'){const readResults=await reader.readBatch(reply.readBatchId??'',reply.reads??[]);return {...clean,map:{...await reader.context(),phase:study.phase,selection,readResults}};}
  let feedback:MapReadRecord['feedback'];try{
  if(reply.action==='lookup-map')selection=await reader.lookup(reply.mapQuery??{query:reply.body});
  if(reply.action==='open-map')await reader.open(reply.mapSelection??'',reply.detail);
  if(reply.action==='refresh-map'){await reader.refresh();if(study.modelDirectedKnowledge)selection=undefined;}
  }catch(error){feedback=study.modelDirectedKnowledge?mapReadFeedback(error):undefined;if(!feedback)throw error;}
  const action=reply.action==='lookup-map'?'lookup':reply.action==='open-map'?'open':reply.action==='refresh-map'?'refresh':undefined;
  const mapRead:MapReadRecord|undefined=action?{call:{toolCallId:'single',action,query:reply.mapQuery,selection:reply.mapSelection,detail:reply.detail},view:await reader.view(),...(feedback?{feedback}:{}),result:feedback?undefined:action==='lookup'?selection:action==='open'?(await reader.context()).opened.find(o=>o.selection===reply.mapSelection):{revision:(await reader.context()).revision}}:undefined;
  return {...clean,...(mapRead?{mapRead}:{}),map:{...await reader.context(),phase:study.phase,query:study.modelDirectedKnowledge&&reply.action==='refresh-map'?undefined:feedback?study.map?.query:reply.mapQuery??study.map?.query,selection,...(mapRead?.view.presentation?{lastRead:mapRead,readResults:[await projectMapReadRecord(this.library,mapRead)]}:{})}};
 }
 async reconcile(study:PostReportStudyV45){
  const projectId=study.report.scope.projectId;
  const admit=async(source:MapSource,response?:ResearchReplyV45)=>{
   if(study.scientificMapWrites)return registerScientificSource(this.library,source,response?.mapChanges,response?.mapWriteReads??[],study.refutationEvidence);
   await this.library.knowledgeMap.admit([source],'local-user',projectId,study.modelDirectedKnowledge,study.refutationEvidence,study.domainAdmission);
  };
  for(const [i,response] of study.responses.entries())if(isPublicResearchReply(study,response)){
   await admit({ref:{kind:'public-research',id:study.id+':public:'+i,version:1,bodyHash:stableHash(response.body),ownerId:'local-user',projectId},body:response.body,status:'active',origin:{studyId:study.id,...(study.report.empiricalEvidence?{empiricalEvidence:true}:{}),...(study.nativeHandoff?{}:{body:response.body})}},response);
  }
  if(study.status==='completed'&&study.publication?.kind==='finding'&&!savedPublicResearchId(study,study.publication.body)){
   await admit({ref:{kind:'public-research',id:study.id+':finding',version:1,bodyHash:stableHash(study.publication.body),ownerId:'local-user',projectId},body:study.publication.body,status:'active',origin:{studyId:study.id,...(study.report.empiricalEvidence?{empiricalEvidence:true}:{}),publicationHash:stableHash(study.publication)}});
  }
 }
}
