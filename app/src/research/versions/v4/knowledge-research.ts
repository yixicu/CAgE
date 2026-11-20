import {stableHash} from '../../../learning/research-hash.js';
import {LearningDataError} from '../../../learning/research-data.js';
import {DirectedRouteInputError,directedRouteSelection} from '../../../learning/directed-route.js';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import {knowledgeRefKey,queryKnowledge,routeClusterView,type KnowledgeRef} from '../../../learning/knowledge-network.js';
import {PublishedTheoriesV4,reportKnowledgeRef} from './published.js';
import {clearResearchReadContext,type PostReportStudyV45,type ReportEvidenceV45,type ResearchReplyV45} from './post-report.js';
import {authorizeKnowledgeRead,retainKnowledgeSelectors,knowledgeOpenPresentation,knowledgeSelectionPresentation} from './knowledge-study.js';

/** Two existing stores retain ownership; this adapter owns exact read grants and projection replay. */
export class KnowledgeResearchV4 {
 constructor(private readonly library:ResearchLibrary,private readonly theories:PublishedTheoriesV4,
  private readonly authorize:(source:ReportEvidenceV45)=>Promise<boolean>,private readonly dualCluster=false){}

 private async current(requested:KnowledgeRef[]=[]){
  for(;;){
  const view=await this.library.freezeKnowledgeView();
  const candidates=await this.theories.readReportStudies(this.authorize);
  const exactLibrary=await this.library.availableKnowledgeRefs([...view.refs.filter(r=>r.store==='library'),...requested,...candidates.flatMap(c=>c.knowledgeSupport??[]).filter(r=>r.store==='library')]);
  const libraryRefs=new Set(exactLibrary.map(knowledgeRefKey));
  const byKey=new Map(candidates.map(c=>[knowledgeRefKey(reportKnowledgeRef(c)),c]));
  const valid=(ref:KnowledgeRef,seen=new Set<string>()):boolean=>{
   const key=knowledgeRefKey(ref);if(ref.store==='library')return libraryRefs.has(key);
   if(seen.has(key))return false;const card=byKey.get(key);if(!card)return false;
   return (card.knowledgeSupport??[]).every(r=>valid(r,new Set([...seen,key])));
  };
  const theory=await this.theories.knowledgeSnapshot(this.authorize,refs=>refs.every(r=>valid(r)));
  const network=structuredClone(view.network);
  for(const node of theory.nodes){const old=network.nodes.find(n=>knowledgeRefKey(n.ref)===knowledgeRefKey(node.ref));if(old)old.status=node.status;else network.nodes.push(node);}
  let sourcesValid=true;for(const card of theory.cards)if(!await this.authorize(card.source)){sourcesValid=false;break;}if(!sourcesValid)continue;
  if((await this.library.freezeKnowledgeView()).revision!==view.revision||await this.theories.knowledgeRevision()!==theory.revision)continue;
  const visible=this.dualCluster?routeClusterView(network):network,keys=new Set(visible.nodes.map(n=>knowledgeRefKey(n.ref)));
  return {view,theory:{...theory,cards:theory.cards.filter(c=>!this.dualCluster||c.kind==='theory')},network:visible,refs:[...exactLibrary,...theory.nodes.map(n=>n.ref)].filter(r=>keys.has(knowledgeRefKey(r)))};
  }
 }
 async prepare(study:PostReportStudyV45){
  const current=await this.current(study.knowledge?.allowedRefs);
  if(study.knowledge){
   if(study.knowledge.presentation&&study.knowledge.proofPhase!==study.phase){clearResearchReadContext(study);study.knowledge.proofPhase=study.phase;}
   const available=new Set(current.refs.map(knowledgeRefKey));
   if(!study.knowledge.opened.every(x=>available.has(knowledgeRefKey(x.ref))))throw Error('Opened knowledge source withdrawn');
   study.knowledge.allowedRefs=study.knowledge.allowedRefs.filter(r=>available.has(knowledgeRefKey(r)));
   const previous=study.knowledge.selection;
   try{study.knowledge.selection=study.modelDirectedKnowledge?directedRouteSelection(study.knowledge.network,study.knowledge.routeQuery??{mode:'directory'},study.knowledge.allowedRefs,current.network):queryKnowledge(study.knowledge.network,study.knowledge.query??{text:study.report.body},study.knowledge.allowedRefs);
    if(study.modelDirectedKnowledge&&study.knowledge.routeQuery&&study.knowledge.routeQuery.mode!=='directory'&&stableHash(previous)!==stableHash(study.knowledge.selection))throw new DirectedRouteInputError('The requested route page changed; choose a new lookup.');
   }catch(error){if(!study.modelDirectedKnowledge||!(error instanceof DirectedRouteInputError))throw error;study.knowledge.readNotice=error.message;delete study.knowledge.routeQuery;study.knowledge.selection=directedRouteSelection(study.knowledge.network,{mode:'directory'},study.knowledge.allowedRefs,current.network);}
   if(this.dualCluster)retainKnowledgeSelectors(study.knowledge);
   if(study.readBatch)study.currentReadResults=study.readBatch.results.map(row=>{
    if(study.modelDirectedKnowledge&&(row.result as {readNotice?:string})?.readNotice)return {toolCallId:row.toolCallId,result:row.result};
    try{
    if(row.mapRead)return {toolCallId:row.toolCallId};
    if(row.request.action==='query-knowledge'){const copy=structuredClone(study.knowledge!);copy.selection=study.modelDirectedKnowledge?directedRouteSelection(copy.network,row.request.routeQuery!,copy.allowedRefs,current.network):queryKnowledge(copy.network,{text:row.request.body,offset:row.request.offset},copy.allowedRefs);if(study.modelDirectedKnowledge&&row.request.routeQuery?.mode!=='directory'&&stableHash(copy.selection)!==stableHash(row.result))return {toolCallId:row.toolCallId,result:{readNotice:'This route page changed. Request a new lookup.'}};if(this.dualCluster){retainKnowledgeSelectors(copy);study.knowledge!.selectors=copy.selectors;}return {toolCallId:row.toolCallId,result:copy.presentation?knowledgeSelectionPresentation(copy.selection):copy.selection};}
    if(row.request.action==='open-knowledge'){const ref=authorizeKnowledgeRead(study.knowledge!,row.request.selection??0);const opened=study.knowledge!.opened.find(o=>knowledgeRefKey(o.ref)===knowledgeRefKey(ref));return {toolCallId:row.toolCallId,result:opened?knowledgeOpenPresentation(study.knowledge!,opened,row.request.detail):undefined};}
    return {toolCallId:row.toolCallId,result:row.result};
    }catch(error){if(!study.modelDirectedKnowledge||!(error instanceof DirectedRouteInputError))throw error;return {toolCallId:row.toolCallId,result:{readNotice:error.message}};}
   });
   return;
  }
  study.knowledge={...(this.dualCluster?{presentation:'layered-map-v1' as const,proofRefs:[],proofExposureRefs:[],proofPhase:study.phase}:{}),recipe:'knowledge-network-v1',libraryRevision:current.view.revision,theoryRevision:current.theory.revision,
   network:current.network,allowedRefs:current.refs,selection:study.modelDirectedKnowledge?directedRouteSelection(current.network,{mode:'directory'},current.refs,current.network):queryKnowledge(current.network,{text:study.report.body},current.refs),opened:[],bindings:[]};
  if(this.dualCluster)retainKnowledgeSelectors(study.knowledge);
 }
 async resolve(study:PostReportStudyV45,reply:ResearchReplyV45):Promise<ResearchReplyV45>{
  const knowledge=structuredClone(study.knowledge);if(!knowledge)throw Error('Missing frozen knowledge view');
  // Provider output never owns the host read receipt.
  const result={...reply};delete result.knowledge;
  if(!['query-knowledge','open-knowledge','bind-knowledge','relate-theory'].includes(reply.action))return result;
  const current=await this.current(knowledge.allowedRefs),available=new Set(current.refs.map(knowledgeRefKey));
  const allowed=knowledge.allowedRefs.filter(r=>available.has(knowledgeRefKey(r)));
  delete knowledge.readNotice;
  try{
  if(reply.action==='query-knowledge'){if(study.modelDirectedKnowledge){if(!reply.routeQuery)throw new DirectedRouteInputError('Select a directory, name or relation.');if(reply.routeQuery.mode==='relations')authorizeKnowledgeRead(knowledge,reply.routeQuery.selection??0);knowledge.routeQuery=structuredClone(reply.routeQuery);knowledge.selection=directedRouteSelection(knowledge.network,reply.routeQuery,allowed,current.network);}else{knowledge.query={text:reply.body,offset:reply.offset};knowledge.selection=queryKnowledge(knowledge.network,knowledge.query,allowed);}if(this.dualCluster)retainKnowledgeSelectors(knowledge);}
  else {
   const ref=authorizeKnowledgeRead(knowledge,reply.selection??0);
   if(!available.has(knowledgeRefKey(ref)))throw new DirectedRouteInputError('This route is no longer available. Browse another authorized entry.');
   if(study.modelDirectedKnowledge&&reply.action!=='open-knowledge'&&!knowledge.phaseOpened?.includes(knowledgeRefKey(ref)))throw Error('Open this entry in the current research phase before citing it');
   if(reply.action!=='open-knowledge'&&knowledge.presentation&&ref.store==='theory'&&!knowledge.proofRefs?.includes(knowledgeRefKey(ref)))throw Error('Theory dependencies require an explicit full theory read');
   if(reply.action==='open-knowledge'){
    if(reply.detail!==undefined&&reply.detail!=='proof')throw Error('Invalid knowledge read detail');
    knowledge.lastRead={ref,detail:reply.detail};
    if(study.modelDirectedKnowledge&&!knowledge.phaseOpened?.includes(knowledgeRefKey(ref)))(knowledge.phaseOpened??=[]).push(knowledgeRefKey(ref));
    if(reply.detail==='proof'&&!knowledge.proofRefs?.includes(knowledgeRefKey(ref)))(knowledge.proofRefs??=[]).push(knowledgeRefKey(ref));
    const body=ref.store==='library'?(await this.library.readKnowledgeResource(ref,{purpose:study.phase==='review'?'theory-review':'theory-study',allowedRefs:allowed,revision:knowledge.libraryRevision})).body:
     current.theory.cards.find(c=>knowledgeRefKey(reportKnowledgeRef(c))===knowledgeRefKey(ref))?.body;
    if(body===undefined)throw Error('Exact theory body unavailable');
    if(reply.detail==='proof'&&!knowledge.proofExposureRefs?.includes(knowledgeRefKey(ref)))(knowledge.proofExposureRefs??=[]).push(knowledgeRefKey(ref));
    if(!knowledge.opened.some(x=>knowledgeRefKey(x.ref)===knowledgeRefKey(ref)))knowledge.opened.push({ref,body,...(knowledge.network.nodes.find(n=>knowledgeRefKey(n.ref)===knowledgeRefKey(ref))?.scientificStatus?{scientificStatus:knowledge.network.nodes.find(n=>knowledgeRefKey(n.ref)===knowledgeRefKey(ref))!.scientificStatus}:{})});
   }else if(reply.action==='relate-theory'){
    if(ref.store!=='theory'||!knowledge.opened.some(x=>knowledgeRefKey(x.ref)===knowledgeRefKey(ref))||!['revises','narrows'].includes(reply.relation??''))throw Error('Family changes require an opened theory and explicit relation');
    knowledge.family={parent:ref,relation:reply.relation!,argument:reply.body};
   }else{
    if(!knowledge.opened.some(x=>knowledgeRefKey(x.ref)===knowledgeRefKey(ref)))throw Error('A theory binding requires its subject to be opened');
    knowledge.bindings=knowledge.bindings.filter(b=>knowledgeRefKey(b.subject)!==knowledgeRefKey(ref));
    knowledge.bindings.push({subject:ref,argument:reply.body,conditions:reply.conditions??[]});
   }
  }
  }catch(error){
   if(!study.modelDirectedKnowledge||!['query-knowledge','open-knowledge'].includes(reply.action)||!(error instanceof DirectedRouteInputError||error instanceof LearningDataError&&['STALE_SOURCE','NOT_FOUND'].includes(error.code)))throw error;
   const previous=structuredClone(study.knowledge!);delete previous.lastRead;previous.readNotice=error.message+'. Choose another authorized route page or continue from the assigned evidence.';return {...result,knowledge:previous};
  }
  return {...result,knowledge};
 }
 async publish(study:PostReportStudyV45){
  await this.prepare(study);
  await this.theories.publishReportStudy(study,this.authorize);
  await this.reconcile(study.report.scope.projectId);
 }
 async reconcile(projectId?:string){
  if(this.dualCluster)await this.theories.reconcileMapIntents(this.library,projectId);
  for(const intent of await this.theories.pendingKnowledgeIntents()){
   if(this.dualCluster&&intent.proposal.nodes?.some(n=>n.kind==='finding'))continue;
   const current=await this.current(),grants=new Set(current.refs.map(knowledgeRefKey));
   if(!grants.has(knowledgeRefKey(intent.proposal.owner))||!intent.proposal.bindings?.every(b=>grants.has(knowledgeRefKey(b.subject))))continue;
   const proposal={...intent.proposal,expectedRevision:current.view.network.revision};
   try{const receipt=await this.library.projectKnowledge(proposal);await this.theories.completeKnowledgeIntent(intent.id,receipt);}
   catch(error){if(error instanceof Error&&/revision|concurrent|conflict/i.test(error.message))continue;throw error;}
  }
 }
 async availableCards(){return (await this.current()).theory.cards;}
 async support(ids:readonly string[]){
  const cards=await this.theories.readReportStudies(this.authorize),selected=new Map<string,(typeof cards)[number]>();
  const visit=(id:string)=>{if(selected.has(id))return;const card=cards.find(c=>c.id===id);if(!card)throw Error('Research support unavailable');selected.set(id,card);for(const r of card.knowledgeSupport??[])if(r.store==='theory'){const parent=cards.find(c=>knowledgeRefKey(reportKnowledgeRef(c))===knowledgeRefKey(r));if(!parent)throw Error('Research parent unavailable');visit(parent.id);}};
  for(const id of ids)visit(id);
  const proofRefs:import('../../../learning/research-data.js').ProofRef[]=[];
  for(const c of selected.values())for(const ref of c.knowledgeSupport??[])if(ref.store==='library'){const resource=await this.library.readKnowledgeResource(ref,{purpose:'theory-study',allowedRefs:[ref]});for(const source of resource.meta.sourceRefs)if('caseId'in source)proofRefs.push(source);}
  return {sources:[...selected.values()].map(c=>({projectId:c.source.scope.projectId,artifactId:c.source.artifactId})),proofRefs};
 }
 async bootstrap(text:string){
  await this.reconcile();const current=await this.current();
  const selection=queryKnowledge(current.network,{text},current.refs);
  const ids=new Set(selection.nodes.filter(n=>n.node.ref.store==='theory').map(n=>n.node.ref.id));
  return {selection,pin:{libraryRevision:current.view.revision,theoryRevision:current.theory.revision,recipe:'knowledge-network-v1' as const},
   cards:current.theory.cards.filter(c=>ids.has(reportKnowledgeRef(c).id)&&selection.nodes.some(n=>knowledgeRefKey(n.node.ref)===knowledgeRefKey(reportKnowledgeRef(c))))};
 }
}
