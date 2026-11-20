import type {NetworkPresentationRevisionV3} from '../../../runtime/network-presentation-v3.js';
import {validateRouteInstanceV3,type RouteInstanceV3} from './route-instances.js';
import {validNetworkPinV3,type NetworkPinV3,type NetworkSelectionV3} from '../../../learning/method-network-v3.js';
import {resourceNodeV3,mergeCatalogMaterialsV3,type CatalogPinV3,type CatalogMaterialV3} from './catalog-context.js';
/** Host-only frozen context and bounded presentation. Existing method resources remain authorities. */
import { isDeepStrictEqual } from 'node:util';
import { stableHash } from '../../../learning/research-hash.js';
import type { ResourceMeta } from '../../../learning/research-data.js';
import type { EpochSnapshotV21, RootV21, FrozenResourceV21 } from '../../contracts/v21.js';
import { freezeKnowledgeV3, retrieveKnowledgeV3, lexicalTermsV3, type KnowledgeSnapshotV3, type KnowledgeContextV3, type KnowledgeNodeV3 } from './knowledge.js';
import { createWorkspaceV3, addWorkspaceRecordV3, adoptOperationReceiptV3, visibleWorkspaceRecordsV3, type WorkspaceV3 } from './workspace.js';
import { REGISTERED_OPERATIONS_V3, type OperationReceiptV3 } from './operations.js';
export interface FrozenMethodNetworkV3 {presentationRevision?:NetworkPresentationRevisionV3;pin:NetworkPinV3;selection:NetworkSelectionV3}
export interface V3FrozenContext {methodNetwork?:FrozenMethodNetworkV3;catalogPin?:CatalogPinV3;catalogNodeIds?:string[];knowledge:KnowledgeSnapshotV3;workspace:WorkspaceV3;retrieval:KnowledgeContextV3}
export interface V3Execution {routeInstances?:RouteInstanceV3[];methodNetworkPin?:NetworkPinV3;catalogPin?:CatalogPinV3;catalogNodeIds?:string[];catalogMaterials?:CatalogMaterialV3[];knowledgeReads?:string[];receipts:OperationReceiptV3[];modelRequests:number;toolDispatches:number;completedTools:number}
export interface V3FlowState {routeInstances?:RouteInstanceV3[];catalogMaterials?:CatalogMaterialV3[];workspace:WorkspaceV3;receipts:OperationReceiptV3[];acceptedCallIds:string[];modelRequests:number;toolDispatches:number;completedTools:number}
export function freezeContextV3(root:RootV21,resources:ResourceMeta[],learned?:KnowledgeSnapshotV3,catalogPin?:CatalogPinV3,directed=false):V3FrozenContext {
 const nodes:KnowledgeNodeV3[]=structuredClone([...(learned?.nodes??[])]),edges=structuredClone([...(learned?.edges??[])]);
 // A learned projection cannot reactivate an authority missing from this exact boundary.
 for(const node of nodes)if(node.authorityRef&&!resources.some(r=>r.id===node.authorityRef!.id&&r.version===node.authorityRef!.version&&r.enabled&&r.status==='valid'))node.status='needs-review';
 const append=(node:KnowledgeNodeV3)=>{const old=nodes.find(n=>n.id===node.id);if(old&&!isDeepStrictEqual(old,node)){if(node.authorityRef&&old.authorityRef&&isDeepStrictEqual(node.authorityRef,old.authorityRef)){Object.assign(old,structuredClone(node));return;}throw new Error('Knowledge authority identity collision.');}if(!old)nodes.push(node);};
 for(const r of resources)append(catalogPin?resourceNodeV3(r):{id:`resource:${r.id}:${r.version}`,kind:r.kind==='specific-strategy'?'strategy':'way-skill',title:r.name,summary:r.description,keywords:r.tags,conditions:r.conditions,risk:['Resource guidance requires applicability judgment; not a proof of this question.'],sourceRef:`resource:${r.id}:${r.version}`,authorityRef:{id:r.id,version:r.version},status:r.enabled&&r.status==='valid'?'active':'needs-review'});
 for(const operation of REGISTERED_OPERATIONS_V3)append({id:`operation:${operation.id}:${operation.version}`,kind:'operation',title:operation.id,summary:operation.scope,keywords:operation.id.split('-'),conditions:[],risk:['Local computation only. Parameters do not establish scientific premises.'],sourceRef:`registry:${operation.id}:${operation.version}`,status:'active'});
 const tokens=lexicalTermsV3;
 const rootNode:KnowledgeNodeV3={id:`goal:${root.hypothesisId}:${root.revision}`,kind:'goal',title:'Current original question',summary:root.originalText.slice(0,4096),keywords:tokens(root.originalText),conditions:root.conditions.slice(0,16),risk:['Goal text is a navigation key, not an established fact.',...(root.originalText.length>4096?['Preview truncated; full original question remains in root.']:[])],sourceRef:`root:${root.hypothesisId}:${root.revision}`,status:'active'};append(rootNode);
 for(const r of resources){const resourceId=`resource:${r.id}:${r.version}`,origin=`resource:${r.id}:${r.version}`;
  for(const source of r.sourceRefs){const ref='kind'in source?`failure:${source.id}:${source.version}`:`proof:${source.caseId}:${source.revision}:${source.semanticRevision}`,id=`method-evidence:${stableHash(source)}`;append({id,kind:'kind'in source?'counterexample':'case',title:'Existing method evidence',summary:'An exact existing learning-source reference; the case is not a theorem for the new question.',keywords:[],conditions:[],risk:['Historical source scope must be checked; no automatic generalization.'],sourceRef:ref,status:r.enabled&&r.status==='valid'?'active':'needs-review'});edges.push({from:resourceId,to:id,relation:'derivedfrom',sourceRef:origin});}
  for(const condition of r.conditions){const id=`precondition:${stableHash([origin,condition])}`;append({id,kind:'precondition',title:'Method prerequisite',summary:condition.slice(0,4096),keywords:tokens(condition),conditions:[],risk:['Applicability is unestablished until checked in this problem.',...(condition.length>4096?['Preview truncated; exact text is in the authority resource.']:[])],sourceRef:origin,status:r.enabled&&r.status==='valid'?'active':'needs-review'});edges.push({from:resourceId,to:id,relation:'requires',sourceRef:origin});}
  if(!directed&&tokens([r.name,r.description,...r.tags].join(' ')).some(t=>rootNode.keywords.includes(t)))edges.push({from:rootNode.id,to:resourceId,relation:'related',sourceRef:rootNode.sourceRef});
  // Only an explicit registered ID in metadata creates an operation navigation link.
  for(const operation of REGISTERED_OPERATIONS_V3)if([r.name,r.description,...r.tags].some(text=>text.includes(operation.id)))edges.push({from:resourceId,to:`operation:${operation.id}:${operation.version}`,relation:'related',sourceRef:origin});
 }
 const retrievalRevision='authority-navigation-v2' as const,version=stableHash({retrievalRevision,learned:learned?.hash??null,root:[root.hypothesisId,root.revision],resources:resources.map(r=>[r.id,r.version]),registry:REGISTERED_OPERATIONS_V3}),knowledge=freezeKnowledgeV3(nodes,edges,version,retrievalRevision);
 let workspace=createWorkspaceV3({originalQuestion:root.originalText,rootVersion:root.revision});
 workspace=addRootWorkspaceV3(workspace,root);
 if(directed)return {knowledge,workspace,retrieval:{snapshotVersion:knowledge.version,snapshotHash:knowledge.hash,candidates:[],edges:[],backlinks:[],truncated:false,omittedRefs:[],omittedRefCount:0,oversizedRefs:[],retrievalRef:stableHash(['directory',knowledge.hash]),limits:{maxNodes:12,maxHops:1,maxChars:8192}}};
 let retrieval=retrieveKnowledgeV3(knowledge,{query:[root.originalText,...root.domain,...root.conditions].join('\n'),maxNodes:12,maxHops:1,maxChars:8192});
 if(!retrieval.candidates.some(n=>n.authorityRef&&n.status==='active')){const refs=knowledge.nodes.filter(n=>n.authorityRef&&n.status==='active').map(n=>n.id);if(refs.length)retrieval=retrieveKnowledgeV3(knowledge,{query:'',maxNodes:8,maxHops:0,maxChars:8192});}
 return {knowledge,workspace,retrieval};
}
export function addRootWorkspaceV3(workspace:WorkspaceV3,root:RootV21):WorkspaceV3 {
 let next=structuredClone(workspace);
 for(const obligation of root.obligations)next=addWorkspaceRecordV3(next,{id:`goal:${root.revision}:${stableHash([obligation.id,obligation.statement])}`,kind:'goal',text:obligation.statement,branchId:'root',status:'unverified',evidenceKind:'unknown',sourceRef:`root:${root.hypothesisId}:${root.revision}`,dependsOn:[]});
 for(const condition of root.conditions)next=addWorkspaceRecordV3(next,{id:`assumption:${stableHash([root.revision,condition])}`,kind:'assumption',text:condition,branchId:'root',status:'conditional',evidenceKind:'conditional',sourceRef:`root:${root.hypothesisId}:${root.revision}`,dependsOn:[]});
 return next;
}
export function initialFlowV3(context:V3FrozenContext):V3FlowState{return {workspace:structuredClone(context.workspace),receipts:[],acceptedCallIds:[],modelRequests:0,toolDispatches:0,completedTools:0};}
export function boundedResourceBodiesV3(snapshot:EpochSnapshotV21):FrozenResourceV21[] {
 const refs=snapshot.v3?.retrieval.candidates.flatMap(n=>n.authorityRef?[n.authorityRef]:[])??[],result:FrozenResourceV21[]=[];let remaining=8192;
 for(const ref of refs){const body=snapshot.resourceBodies?.find(b=>isDeepStrictEqual(b.ref,ref));if(body&&Buffer.byteLength(body.body)<=remaining){result.push(structuredClone(body));remaining-=Buffer.byteLength(body.body);}}
 return result;
}
export function presentContextV3(context:V3FrozenContext,workspace:WorkspaceV3,branchId='root') {
 const records=visibleWorkspaceRecordsV3(workspace,branchId),kept=records.slice(-24);let truncated=kept.length!==records.length;
 while(Buffer.byteLength(JSON.stringify(kept))>8192&&kept.length){kept.shift();truncated=true;}
 return {...(context.methodNetwork?{methodNetwork:structuredClone(context.methodNetwork)}:{}),knowledgeVersion:context.knowledge.version,knowledgeHash:context.knowledge.hash,retrieval:context.retrieval,workspace:{originalQuestion:workspace.originalQuestion,rootVersion:workspace.rootVersion,records:kept,truncated,recordCount:records.length},registeredOperations:REGISTERED_OPERATIONS_V3};
}
export function acceptExecutionV3(state:V3FlowState,execution:V3Execution,context:{callId:string;projectId:string;rootVersion:string;knowledgeVersion:string;branchId:string;sourceVersion:string;methodNetworkPin?:NetworkPinV3;catalogPin?:CatalogPinV3;catalogNodeIds?:string[]}):V3FlowState {
 if(state.acceptedCallIds.includes(context.callId))return structuredClone(state);
 if(![execution.modelRequests,execution.toolDispatches,execution.completedTools].every(n=>Number.isSafeInteger(n)&&n>=0)||execution.completedTools>execution.receipts.length)throw new Error('Invalid V3 execution counters.');
 const next=structuredClone(state);
 if(context.methodNetworkPin){if(!validNetworkPinV3(context.methodNetworkPin)||!isDeepStrictEqual(execution.methodNetworkPin,context.methodNetworkPin)||context.methodNetworkPin.catalogHash!==context.catalogPin?.indexHash||context.methodNetworkPin.revision!==context.catalogPin?.revision)throw new Error('Foreign method network execution binding.');}
 else if(execution.methodNetworkPin||execution.routeInstances)throw new Error('Method network evidence on historical invocation.');
 if(context.catalogPin){
  if(!isDeepStrictEqual(execution.catalogPin,context.catalogPin)||!isDeepStrictEqual(execution.catalogNodeIds??[],context.catalogNodeIds??[]))throw new Error('Foreign catalog execution binding.');
  next.catalogMaterials=mergeCatalogMaterialsV3(context.catalogPin,state.catalogMaterials??[],execution.catalogMaterials??[]);
  const allowed=new Set([...(context.catalogNodeIds??[]),...next.catalogMaterials.map(m=>m.node.id)]);
  if((execution.knowledgeReads??[]).some(id=>!allowed.has(id)))throw new Error('Foreign catalog knowledge delivery.');
 }else if(execution.catalogPin||execution.catalogNodeIds||execution.catalogMaterials||execution.knowledgeReads)throw new Error('Catalog evidence on historical invocation.');
 for(const receipt of execution.receipts){const b=receipt.inputBinding;if(b.runId!==context.projectId||b.rootVersion!==context.rootVersion||b.knowledgeVersion!==context.knowledgeVersion||b.branchId!==context.branchId||receipt.sourceVersion!==context.sourceVersion)throw new Error('Foreign V3 operation receipt binding.');
  const old=next.receipts.find(r=>r.id===receipt.id);if(old&&!isDeepStrictEqual(old,receipt))throw new Error('Conflicting V3 operation receipt replay.');
  if(!old){next.receipts.push(structuredClone(receipt));next.workspace=adoptOperationReceiptV3(next.workspace,receipt,context.branchId);}}
 if(context.methodNetworkPin){next.routeInstances??=[];for(const instance of execution.routeInstances??[]){validateRouteInstanceV3(next.workspace,context.methodNetworkPin,context.branchId,instance);const old=next.routeInstances.find(r=>r.id===instance.id);if(old&&!isDeepStrictEqual(old,instance))throw new Error('Conflicting route instance replay.');if(!old)next.routeInstances.push(structuredClone(instance));}}
 next.acceptedCallIds.push(context.callId);next.modelRequests+=execution.modelRequests;next.toolDispatches+=execution.toolDispatches;next.completedTools+=execution.completedTools;return next;
}

export function boundedSourcesV3(snapshot:EpochSnapshotV21){let remaining=8192;return snapshot.sources.filter(source=>{const bytes=Buffer.byteLength(source.body);if(bytes>remaining)return false;remaining-=bytes;return true;});}

export function branchContextV3(context:V3FrozenContext,workspace:WorkspaceV3,branchId:string):V3FrozenContext {const scoped=structuredClone(workspace);scoped.records=visibleWorkspaceRecordsV3(workspace,branchId);scoped.adoptedReceiptIds=scoped.adoptedReceiptIds.filter(id=>scoped.records.some(r=>r.id===`fact_${id}`));const result={...structuredClone(context),workspace:scoped};delete result.methodNetwork;return result;}
/** Exact bodies only: skipped oversized bytes remain available through frozen readers. */
export function presentedResourceBodiesV3(input:unknown):FrozenResourceV21[]{const value=input as {resourceBodies?:FrozenResourceV21[]}|undefined;let remaining=8192;return (value?.resourceBodies??[]).filter(body=>{const bytes=Buffer.byteLength(body.body);if(bytes>remaining)return false;remaining-=bytes;return true;});}
/** Metadata cards never replay originals; oversized declarations receive explicitly incomplete cards. */
export function artifactCardsV3(artifacts:import('../v21/optional-types.js').OptionalProofArtifactV21[],maxBytes=24576,discussion?:Pick<import('../v21/optional-types.js').OptionalFlowV21,'branches'|'reviewedArtifactIds'>){const cards:Record<string,unknown>[]=[],omittedRefs:string[]=[];let bytes=2;
 const reviewed=new Set(discussion?.reviewedArtifactIds);
 const own=artifacts.findLast(a=>a.authorRole==='theorist');
 const ordered=discussion?[...new Set([...(own?[own]:[]),...artifacts.filter(a=>a.authorRole!=='theorist'&&!reviewed.has(a.id)),...artifacts.toReversed()])].slice(0,16):artifacts.slice(-16);
 for(const artifact of ordered){const {v3Execution:_execution,root:_root,...metadata}=structuredClone(artifact);let card:Record<string,unknown>={...metadata,summary:artifact.control.outcome.reason.slice(0,800),originalAvailable:true};
  if(Buffer.byteLength(JSON.stringify(card))>4096)card={id:artifact.id,authorRole:artifact.authorRole,originalRef:structuredClone(artifact.originalRef),technical:structuredClone(artifact.technical),qualification:artifact.qualification,summary:artifact.control.outcome.reason.slice(0,512),metadataTruncated:true,originalAvailable:true,notice:'Declaration omitted to preserve context budget. Read this exact original before relying on missing details; no omitted premise is established.'};
  const branch=discussion?.branches.find(b=>b.artifactId===artifact.id);
  if(branch){
   const {question,symbols,checks}=branch.frozen.question;
   card.assignment={question,symbols,checks};
   if(Buffer.byteLength(JSON.stringify(card.assignment))>4096)card.assignment={questionId:branch.frozen.question.id,questionPreview:question.slice(0,512),truncated:true};
  }
  const size=Buffer.byteLength(JSON.stringify(card))+1;if(bytes+size>maxBytes){omittedRefs.push(artifact.id);continue;}cards.push(card);bytes+=size;
 }
 const selected=new Set(cards.map(c=>c.id));for(const a of artifacts)if(!selected.has(a.id)&&!omittedRefs.includes(a.id))omittedRefs.push(a.id);
 return {cards,truncated:omittedRefs.length>0||cards.some(c=>c.metadataTruncated),omittedRefs:omittedRefs.slice(0,64),omittedCount:omittedRefs.length,maxBytes};
}
