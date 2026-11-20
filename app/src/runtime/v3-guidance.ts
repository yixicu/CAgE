import {initialNetworkPresentationV3,type NetworkPresentationRevisionV3} from './network-presentation-v3.js';
import {validNetworkSelectionV3,type NetworkSelectionV3} from '../learning/method-network-v3.js';
import {resourceNavigationSourcesV3,mergeCatalogMaterialsV3,type CatalogMaterialV3,type CatalogPortV3,type CatalogPinV3} from '../research/versions/v3/catalog-context.js';
import {prepareConciseLearning,validateLearningPresentation} from './learning-presentation.js';
import {prepareLearningGuidanceV13} from './learning-prompts-v13.js';
import {prepareLearningGuidanceV12} from './learning-prompts-v12.js';
import {AUTHORITY_DELIVERY_V3,isAuthorityNavigationV3,rankedAuthorityNavigationV3} from '../research/versions/v3/authority-navigation.js';
import {prepareLearningGuidanceV11} from './learning-prompts-v11.js';
import {prepareLearningGuidanceV10} from './learning-prompts-v10.js';
import {prepareLearningGuidanceV9} from './learning-prompts-v9.js';
import {prepareLearningGuidanceV8} from './learning-prompts-v8.js';
import {prepareLearningGuidanceV7} from './learning-prompts-v7.js';
import {prepareLearningGuidanceV6} from './learning-prompts-v6.js';
import {prepareLearningGuidanceV5} from './learning-prompts-v5.js';
import {prepareLearningGuidanceV4} from './learning-prompts-v4.js';
import {activeToolGuidanceV3} from '../research/versions/v3/guidance-budget.js';
import {compactHostMetadataV3,proofHostGuidanceV3} from '../research/versions/v3/host-metadata.js';
import {DirectedRouteInputError} from '../learning/directed-route.js';
import {isDeepStrictEqual} from 'node:util';
import {makeAnswerDelivery} from '../research/versions/v21/check-view.js';
import type {AnswerDeliveryV21} from '../research/contracts/v21.js';
import type {LearningSessionSpec} from './learning-task.js';
import {prepareLearningGuidanceV3} from './learning-prompts-v3.js';
/** Operation5 only: bounded model views never rewrite originals or library documents. */
import {Type} from 'typebox';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import type {TranscriptContext} from '@earendil-works/pi-ai';
import type {AgentSessionSpecV21} from '../research/contracts/v21.js';
import {guidanceCostV3,guidanceHashV3,pageGuidanceV3,selectWholeGuidanceV3,GuidanceExposureLedgerV3,type GuidanceDocumentV3} from '../research/versions/v3/guidance-budget.js';
const PREFIX='Solve or continue from these frozen inputs. The original question is authoritative; no root restatement is required.\n';
const LIMIT=100;
const NETWORK_UNAVAILABLE='Previously displayed method navigation is unavailable because a contributor was withdrawn. Its scientific text has been retired. Use retrieve_knowledge view=global, revise the query, or reason freely; this notice does not invalidate unrelated proof evidence.';
const WORKER_GUIDANCE_FIELDS=[['strategy'],['way','direction'],['way','purpose'],['question','purpose'],['question','reason'],['question','expectedArtifact']] as const;
function workerGuidance(snapshot:any):string {
 const groups=new Map<string,string[]>();
 for(const path of WORKER_GUIDANCE_FIELDS){const text=path.reduce((value:any,key)=>value?.[key],snapshot);if(typeof text==='string'&&text.length)groups.set(text,[...(groups.get(text)??[]),path.join('.')]);}
 return [...groups].map(([text,fields])=>`${fields.join(', ')}\n${text}`).join('\n');
}
function hostToolFeedback(message:any):boolean{return message.role==='toolResult'&&(message.isError===true||message.details?.v3InputError===true);}
function card(node:any){return {id:node.id,kind:node.kind,...(node.authorityRef?{authorityRef:node.authorityRef}:{}),provenanceRef:node.sourceRef,status:node.status,guidanceAvailable:true};}
/** Pure presentation: all method prose is supplied separately by the metered dispatch view. */
export function guidanceInputV3(input:unknown):unknown {
 const view=compactHostMetadataV3(input) as any;if(!view||typeof view!=='object')return view;
 delete view.resourceBodies;delete view.decision;delete view.strategy;delete view.brief;
 if(view.v3)delete view.v3.catalogMaterials;
 if(view.v3?.methodNetwork)delete view.v3.methodNetwork.selection;
 if(view.way&&view.question)for(const path of WORKER_GUIDANCE_FIELDS){const parent=path.slice(0,-1).reduce((value:any,key)=>value?.[key],view);if(parent&&typeof parent==='object')delete parent[path[path.length-1]!];}
 if(view.v3?.retrieval?.candidates)view.v3.retrieval.candidates=view.v3.retrieval.candidates.map(card);
 return view;
}
type Manifest={id:string;hash:string;offset:number;end:number};
/** networkSelections bind canonical validation records; manifests identify the actual displayed initial text. */
export interface GuidanceExposureV3 {initialNetworkPresentationRevision?:NetworkPresentationRevisionV3;navigationNodeIds?:string[];navigationBytes?:number;navigationLines?:number;networkSelections?:NetworkSelectionV3[];kind:'v3-guidance-exposure';dispatch:number;rootHash:string;manifests:Manifest[];lines:number;bytes:number;omitted:string[];answerDeliveries?:AnswerDeliveryV21[];proofBytes?:number;toolLines?:number;toolBytes?:number}
function policyText(value:any):string {
 if(typeof value==='string'){try{return policyText(JSON.parse(value));}catch{return value;}}
 if(!value)return '';
 return [`Decision policy ${value.loopVersion}:${value.version}`,...(value.factors??[]).flatMap((f:any)=>[
  `Factor ${f.id}; weight ${f.weight}; baseline ${f.baseline??f.weight}`,f.description]),
  ...(value.rules??[]).flatMap((rule:string,i:number)=>[`Rule ${i+1}`,rule])].join('\n');
}
function describe(meta:any,body:string){return [meta?.name,meta?.description,...(meta?.conditions??[]),body].filter(v=>typeof v==='string'&&v.length).join('\n');}
function textParts(message:any):string[]{return typeof message.content==='string'?[message.content]:(message.content??[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text);}
function replaceText(message:any,old:string,next:string){if(typeof message.content==='string'){if(message.content===old)message.content=next;}else for(const part of message.content??[])if(part.type==='text'&&part.text===old){part.text=next;return;}}
interface NavigationValidatorV3 {network?:(selection:NetworkSelectionV3)=>Promise<void>;resource?:(ref:{id:string;version:number})=>Promise<unknown>;node?:(id:string)=>Promise<unknown>}
export class RuntimeGuidanceV3 {
 private get directed(){return 'snapshot'in this.spec.context?!!this.spec.context.snapshot.modelDirectedKnowledge:'brief'in this.spec.context&&!!this.spec.context.brief.modelDirectedKnowledge;}
 private get unavailableRoute(){return this.directed?{notice:'This route is outside the current scope. Browse the directory for an available route.',rescue:{mode:'directory',offset:0}}:{notice:NETWORK_UNAVAILABLE,rescue:{view:'global',offset:0}};}
 private unavailableRead(callId:string,id:string){
  const notice=this.unavailableNavigationPage(id);this.pages.set(callId,notice);
  return {content:[{type:'text' as const,text:notice.text}],details:{guidancePage:notice.page,unavailableGuidanceRef:id}};
 }
 readonly answerDeliveries:AnswerDeliveryV21[]=[];private initialAnswers:AnswerDeliveryV21[]=[];
 readonly documents:GuidanceDocumentV3[]=[];readonly ledger:GuidanceExposureLedgerV3;
 private initialIds:string[]=[];private initialPrompt?:string;private pages=new Map<string,{text:string;page:ReturnType<typeof pageGuidanceV3>}>();
 private readonly uncapped:boolean;
 private navigationDocuments=new Map<string,{selection?:NetworkSelectionV3;resourceRefs:{id:string;version:number}[];catalogNodeId?:string}>();
 private retiredNavigation=new Set<string>();
 private materials:CatalogMaterialV3[]=[];
 get catalogMaterials():CatalogMaterialV3[]{return structuredClone(this.materials);}
 private prefix=PREFIX;private learning=false;private available=60;private prompts=new Map<string,string>();readonly rootHash:string;rootDelivered=false;
 constructor(readonly spec:AgentSessionSpecV21|LearningSessionSpec,private readonly resourceValidator?:ToolDefinition,private readonly catalogLoader?:(id:string)=>Promise<CatalogMaterialV3>,private navigationValidator?:NavigationValidatorV3){
  this.uncapped='learning'in spec.context?spec.context.learning.promptRevision==='compact-english-v14':['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(('brief'in spec.context?spec.context.brief.operationRevision:spec.context.marker?.optionalFlow?.operationRevision)??'');
  if('learning'in spec.context){validateLearningPresentation(spec.context.learning);const prepared=(spec.context.learning.promptRevision==='compact-english-v14'?prepareConciseLearning:spec.context.learning.promptRevision==='compact-english-v13'?prepareLearningGuidanceV13:spec.context.learning.promptRevision==='compact-english-v12'?prepareLearningGuidanceV12:spec.context.learning.promptRevision==='compact-english-v11'?prepareLearningGuidanceV11:spec.context.learning.promptRevision==='compact-english-v10'?prepareLearningGuidanceV10:spec.context.learning.promptRevision==='compact-english-v9'?prepareLearningGuidanceV9:spec.context.learning.promptRevision==='compact-english-v8'?prepareLearningGuidanceV8:spec.context.learning.promptRevision==='compact-english-v7'?prepareLearningGuidanceV7:spec.context.learning.promptRevision==='compact-english-v6'?prepareLearningGuidanceV6:spec.context.learning.promptRevision==='compact-english-v5'?prepareLearningGuidanceV5:spec.context.learning.promptRevision==='compact-english-v4'?prepareLearningGuidanceV4:prepareLearningGuidanceV3)(spec.context.learning);this.documents=prepared.documents;this.initialIds=prepared.initialIds;this.rootHash='';this.learning=true;
   const grants=spec.context.learning.resourceReadGrants;
   if(grants){if(grants.recipe!=='frozen-learning-resources-v1'||!['method-skill','failure-skill','v2-strategy'].includes(spec.context.learning.purpose)||!resourceValidator)throw new Error('Missing scoped learning resource validator.');
    if(grants.unavailable?.some(ref=>typeof ref.id!=='string'||!ref.id||!Number.isSafeInteger(ref.version)||ref.version<1||!['disabled','stale-source','needs-review'].includes(ref.reason)||grants.resources.some(value=>value.meta.id===ref.id&&value.meta.version===ref.version)))throw new Error('Invalid unavailable learning resource reference.');
    for(const value of grants.resources){const meta=value.meta;if(!meta.enabled||meta.status!=='valid'||meta.kind!==(spec.context.learning.purpose==='v2-strategy'?'specific-strategy':spec.context.learning.purpose)||guidanceHashV3(value.body)!==value.bodyHash)throw new Error('Invalid frozen learning resource body.');
     if(this.documents.some(doc=>doc.id===`resource:${meta.id}:${meta.version}`&&doc.resourceRef?.id===meta.id&&doc.resourceRef.version===meta.version))continue;
     const text=describe(meta,value.body);this.documents.push({id:`resource:${meta.id}:${meta.version}`,kind:'resource',text,hash:guidanceHashV3(text),resourceRef:{id:meta.id,version:meta.version}});
    }
   }
   this.ledger=new GuidanceExposureLedgerV3(this.documents);return;}
  const worker='brief'in spec.context,snapshot='brief'in spec.context?spec.context.brief:spec.context.snapshot;
  const root=snapshot.root;this.rootHash=guidanceHashV3(JSON.stringify(root));
  const catalog='brief'in spec.context?[]:spec.context.snapshot.resourceCatalog??[];
  const navigation=!worker&&isAuthorityNavigationV3(snapshot.v3?.knowledge.retrievalRevision);
  const add=(id:string,kind:GuidanceDocumentV3['kind'],text:string,resourceRef?:{id:string;version:number})=>{
   if(this.documents.some(doc=>doc.id===id))return;
   this.documents.push({id,kind,text,hash:guidanceHashV3(text),...(resourceRef?{resourceRef}: {})});
  };
  for(const resource of snapshot.resourceBodies??[]){
   const node=snapshot.v3?.knowledge.nodes.find(n=>n.authorityRef?.id===resource.ref.id&&n.authorityRef.version===resource.ref.version&&(!navigation||n.id===`resource:${resource.ref.id}:${resource.ref.version}`));
   const meta=catalog.find(r=>r.id===resource.ref.id&&r.version===resource.ref.version)??(node?{name:node.title,description:node.summary,conditions:node.conditions}:undefined);
   if(navigation&&(!catalog.some(r=>r.id===resource.ref.id&&r.version===resource.ref.version&&r.enabled&&r.status==='valid')||node?.status!=='active'))continue;
   if(guidanceHashV3(resource.body)!==resource.bodyHash)throw new Error('Frozen guidance body hash mismatch.');
   add(`resource:${resource.ref.id}:${resource.ref.version}`,'resource',describe(meta,resource.body),resource.ref);
  }
  if(!worker&&snapshot.v3?.methodNetwork){if(!validNetworkSelectionV3(snapshot.v3.methodNetwork.selection,snapshot.v3.methodNetwork.pin)||snapshot.v3.methodNetwork.pin.catalogHash!==snapshot.v3.catalogPin?.indexHash||snapshot.v3.methodNetwork.pin.revision!==snapshot.v3.catalogPin?.revision)throw new Error('Invalid frozen network guidance binding.');add('method-network:initial','knowledge',initialNetworkPresentationV3(snapshot.v3.methodNetwork.selection,snapshot.v3.methodNetwork.presentationRevision));this.initialIds.push('method-network:initial');add('method-network:rules','knowledge',snapshot.modelDirectedKnowledge?'Choose which directory to browse. Use retrieve_knowledge mode=directory for Skill, Strategy and theory branches, or view=directory for method families. Read a chosen Skill or Strategy with read_research_resource using its resource id/version.': 'Compare route families, then expand summaries and read exact bodies only as needed. No fit permits free reasoning. For terminal route.resourceRefs, copy the exact card resourceRef {id,version}; never use cluster, route or knowledge node IDs as resource IDs. Read the complete exact resource before relying on it. Navigation and expected outputs are not evidence.');this.initialIds.push('method-network:rules');add('method-network:unavailable','knowledge',this.unavailableRoute.notice);}
  if(this.directed){add('method-network:unavailable','knowledge',this.unavailableRoute.notice);for(const doc of this.documents)if(doc.resourceRef)this.navigationDocuments.set(doc.id,{resourceRefs:[doc.resourceRef]});}
  add('policy','policy',policyText(snapshot.decision));this.initialIds.push('policy');
  const strategy=worker?workerGuidance(snapshot):'strategy'in snapshot?snapshot.strategy:undefined;
  if(strategy){add('strategy','strategy',strategy);this.initialIds.push('strategy');}
  for(const node of snapshot.v3?.knowledge.nodes??[]){
   if(node.kind==='goal')continue;
   if(navigation&&(node.status!=='active'||node.authorityRef&&!this.documents.some(d=>d.id===`resource:${node.authorityRef!.id}:${node.authorityRef!.version}`&&d.resourceRef)))continue;
   add(`knowledge:${node.id}`,'knowledge',describe({name:node.title,description:node.summary,conditions:[...node.conditions,...node.risk]},''));
  }
  const candidates=worker?(snapshot.resourceBodies??[]).map(body=>`resource:${body.ref.id}:${body.ref.version}`):
   (snapshot.v3?.retrieval.candidates??[]).map(node=>node.authorityRef?`resource:${node.authorityRef.id}:${node.authorityRef.version}`:`knowledge:${node.id}`);
  if(navigation&&snapshot.v3&&!snapshot.modelDirectedKnowledge){
   const ranked=rankedAuthorityNavigationV3(snapshot.v3.knowledge,{query:[root.originalText,...root.domain,...root.conditions].join('\n')});
   for(const node of ranked.filter(n=>catalog.some(r=>r.id===n.authorityRef!.id&&r.version===n.authorityRef!.version&&r.enabled&&r.status==='valid')&&this.documents.some(d=>d.id===`resource:${n.authorityRef!.id}:${n.authorityRef!.version}`&&d.resourceRef)).slice(0,12)){
    const ref=node.authorityRef!,meta=catalog.find(r=>r.id===ref.id&&r.version===ref.version);
    const bodyId=`resource:${ref.id}:${ref.version}`;
    if(!meta?.enabled||meta.status!=='valid'||!this.documents.some(d=>d.id===bodyId&&d.resourceRef))continue;
    const name=guidanceCostV3(meta.name)<=2?meta.name:'Name omitted; read exact resource.',description=guidanceCostV3(meta.description)<=2?meta.description:'Description omitted; read exact resource.';
    const text=[`Metadata only; applicability unverified; exact scope/body: ${bodyId}`,`Status: valid; enabled. ${name}`,description,'Conditions omitted here; check the complete resource before applying it.'].join('\n');
    const id=`navigation:${ref.id}:${ref.version}`;add(id,'knowledge',text);this.initialIds.push(id);
   }
  }
  if('snapshot'in spec.context&&spec.context.snapshot.v3?.methodNetwork){
   const source=spec.context.snapshot,v3=source.v3!;
   this.navigationDocuments.set('method-network:initial',{selection:structuredClone(v3.methodNetwork!.selection),resourceRefs:[]});
   const origins=resourceNavigationSourcesV3(v3.knowledge),catalogIds=new Set(v3.catalogNodeIds??[]);
   for(const node of v3.knowledge.nodes)if(catalogIds.has(node.id))this.navigationDocuments.set(`knowledge:${node.id}`,{resourceRefs:[],catalogNodeId:node.id});else if(origins.has(node.id))this.navigationDocuments.set(`knowledge:${node.id}`,{resourceRefs:origins.get(node.id)!});
  }
  this.initialIds.push(...new Set(candidates));this.ledger=new GuidanceExposureLedgerV3(this.documents);
  if('marker'in spec.context)for(const material of spec.context.marker.optionalFlow?.v3?.catalogMaterials??[])this.registerCatalogMaterial(material);
 }
 /** Retire redelivery only; immutable originals and prior exposure receipts remain unchanged. */
 private async navigationAvailable(id:string):Promise<boolean>{
  const source=this.navigationDocuments.get(id);if(!source)return true;if(this.retiredNavigation.has(id))return false;
  let available=true;
  try{
   if(source.selection){if(!this.navigationValidator?.network)throw new Error('Missing live network navigation validator.');await this.navigationValidator.network(source.selection);}
   if(source.catalogNodeId){if(!this.navigationValidator?.node)throw new Error('Missing live catalog navigation validator.');await this.navigationValidator.node(source.catalogNodeId);}
   for(const ref of source.resourceRefs){if(!this.navigationValidator?.resource)throw new Error('Missing live navigation source validator.');await this.navigationValidator.resource(ref);}
  }catch(error){if(!['NETWORK_SELECTION_WITHDRAWN','STALE_SOURCE'].includes((error as {code?:string})?.code??''))throw error;available=false;}
  if(!available)this.retiredNavigation.add(id);return available;
 }
 private unavailableNavigationPage(unavailableGuidanceRef:string){
  const doc=this.documents.find(value=>value.id==='method-network:unavailable')!;
  const page=pageGuidanceV3(doc,0,Math.max(1,guidanceCostV3(doc.text)),Math.max(1,Buffer.byteLength(doc.text)));
  return {text:JSON.stringify({guidancePage:page,unavailableGuidanceRef}),page,unavailableGuidanceRef};
 }
 async refreshDirectedNavigation(context:TranscriptContext,pin:CatalogPinV3,port:CatalogPortV3):Promise<TranscriptContext>{
  this.navigationValidator={...this.navigationValidator,resource:ref=>port.meta(pin,ref)};
  for(const id of this.initialIds)if(this.navigationDocuments.get(id)?.resourceRefs.length)await this.navigationAvailable(id);
  this.initialIds=this.initialIds.filter(id=>!this.retiredNavigation.has(id));
  const result=structuredClone(context);
  for(const message of result.messages){
   if(message.role==='toolResult'&&message.toolName==='read_research_resource'){const known=this.pages.get(message.toolCallId);if(known)await this.navigationAvailable(known.page.id);}
   if(message.role!=='toolResult'||message.toolName!=='retrieve_knowledge'||hostToolFeedback(message))continue;
   for(const text of textParts(message)){
    let data;try{data=JSON.parse(text);}catch{continue;}
    if(!data?.directedRouteQuery)continue;
    try{
     const current=await port.directedRoutes!(pin,data.directedRouteQuery);
     if(isDeepStrictEqual(JSON.parse(JSON.stringify(current)),data.page))continue;
    }catch(error){if(!(error instanceof DirectedRouteInputError))throw error;}
    replaceText(message,text,JSON.stringify({directedRouteWithdrawn:true,notice:'This route page has changed under the current grant. Browse again to select an available route.'}));
   }
  }
  return result;
 }
 /** Retire only typed dynamic withdrawal; corrupt pins/manifests and I/O remain fatal. */
 async refreshNetworkNavigation(context:TranscriptContext,validate:(selection:NetworkSelectionV3)=>Promise<void>,validateResource?:(ref:{id:string;version:number})=>Promise<unknown>,validateNode?:(id:string)=>Promise<unknown>):Promise<TranscriptContext>{
  if(!('snapshot'in this.spec.context)||!this.spec.context.snapshot.v3?.methodNetwork)return context;
  this.navigationValidator={...this.navigationValidator,network:validate,...(validateResource?{resource:validateResource}:{}),...(validateNode?{node:validateNode}:{})};
  const result=structuredClone(context),frozen=this.spec.context.snapshot.v3.methodNetwork;
  if(this.initialIds.includes('method-network:initial')&&!await this.navigationAvailable('method-network:initial')){this.initialIds=this.initialIds.filter(id=>id!=='method-network:initial');if(!this.initialIds.includes('method-network:unavailable'))this.initialIds.push('method-network:unavailable');}
  for(const message of result.messages)if(message.role==='toolResult'&&!hostToolFeedback(message)){
   if(message.toolName==='read_research_resource'){const known=this.pages.get(message.toolCallId);if(known)await this.navigationAvailable(known.page.id);}
   if(message.toolName==='retrieve_knowledge')for(const text of textParts(message)){
    let data:unknown;try{data=JSON.parse(text);}catch{continue;}
    if((data as {pin?:{recipe?:string}})?.pin?.recipe!=='method-network-v1'){
     const value=data as {nodes?:{id:string}[];candidates?:{id:string}[];nodeId?:string;nodeRef?:string};
     const ids=[...(value.nodes??value.candidates??[]).map(node=>node.id),value.nodeId??value.nodeRef].filter((id):id is string=>typeof id==='string');
     let available=true;for(const id of ids)if(!await this.navigationAvailable(`knowledge:${id}`))available=false;
     if(!available)replaceText(message,text,JSON.stringify({methodNetworkUnavailable:true,networkPin:frozen.pin,...this.unavailableRoute}));
     continue;
    }
    if(!validNetworkSelectionV3(data,frozen.pin))throw new Error('Foreign network navigation before dispatch.');
    try{await validate(data);}catch(error){if((error as {code?:string})?.code!=='NETWORK_SELECTION_WITHDRAWN')throw error;replaceText(message,text,JSON.stringify({methodNetworkUnavailable:true,networkPin:frozen.pin,...this.unavailableRoute}));}
   }
  }
  this.initialIds=this.initialIds.filter(id=>!this.retiredNavigation.has(id));return result;
 }
 /** Library membership is checked by the host loader before this exact-byte registration. */
 registerCatalogMaterial(material:CatalogMaterialV3):void {
  const pin='snapshot'in this.spec.context?this.spec.context.snapshot.v3?.catalogPin:undefined;
  if(!pin)throw new Error('Catalog material is outside a pinned Theorist context.');
  const index=this.materials.findIndex(value=>value.node.id===material.node?.id);
  const merged=mergeCatalogMaterialsV3(pin,index<0?[]:[this.materials[index]!],[material]);
  const doc:GuidanceDocumentV3|undefined=material.meta?(material.body===undefined?undefined:{id:`resource:${material.meta.id}:${material.meta.version}`,kind:'resource',text:describe(material.meta,material.body),hash:'',resourceRef:{id:material.meta.id,version:material.meta.version}}):
   {id:`knowledge:${material.node.id}`,kind:'knowledge',text:describe({name:material.node.title,description:material.node.summary,conditions:[...material.node.conditions,...material.node.risk]},''),hash:''};
  if(this.directed&&doc?.resourceRef)this.navigationDocuments.set(doc.id,{resourceRefs:[doc.resourceRef]});
  if(doc){doc.hash=guidanceHashV3(doc.text);this.ledger.register(doc);if(!this.documents.some(value=>value.id===doc.id))this.documents.push(doc);}
  if(material.meta&&material.body!==undefined&&material.node.id!==`resource:${material.meta.id}:${material.meta.version}`){const alias={id:`knowledge:${material.node.id}`,kind:'knowledge' as const,text:describe({name:material.node.title,description:material.node.summary,conditions:[...material.node.conditions,...material.node.risk]},''),hash:''};alias.hash=guidanceHashV3(alias.text);this.ledger.register(alias);if(!this.documents.some(value=>value.id===alias.id))this.documents.push(alias);}
  if('snapshot'in this.spec.context&&this.spec.context.snapshot.v3?.methodNetwork)this.navigationDocuments.set(`knowledge:${material.node.id}`,{resourceRefs:[],catalogNodeId:material.node.id});
  if(index<0)this.materials.push(merged[0]!);else this.materials[index]=merged[0]!;
 }
 knowledgeReads():string[]{return this.ledger.completeDocumentIds().filter(id=>id.startsWith('knowledge:')).map(id=>id.slice('knowledge:'.length));}
 /** About-to-be-delivered authority is checked before transport, not yet exposed. */
 pendingResourceRefs(exposure:Omit<GuidanceExposureV3,'dispatch'>):{id:string;version:number}[]{
  const context=this.spec.context,pinned='snapshot'in context?!!context.snapshot.v3?.catalogPin:'brief'in context?!!context.brief.v3?.catalogPin:false;
  if(!pinned&&(!('learning'in context)||!context.learning.presentationRevision))return [];
  return this.documents.filter(doc=>doc.resourceRef&&exposure.manifests.some(m=>m.id===doc.id&&m.hash===doc.hash&&m.end>m.offset)).map(doc=>({...doc.resourceRef!}));
 }
 /** Navigation provenance is validation-only, never a canonical complete-body grant. */
 pendingNavigationResourceRefs(exposure:Omit<GuidanceExposureV3,'dispatch'>):{id:string;version:number}[]{
  const refs=new Map<string,{id:string;version:number}>();
  for(const doc of this.documents)if(exposure.manifests.some(m=>m.id===doc.id&&m.hash===doc.hash&&m.end>m.offset))for(const ref of this.navigationDocuments.get(doc.id)?.resourceRefs??[])refs.set(`${ref.id}:${ref.version}`,ref);
  for(const id of exposure.navigationNodeIds??[])for(const ref of this.navigationDocuments.get(`knowledge:${id}`)?.resourceRefs??[])refs.set(`${ref.id}:${ref.version}`,ref);
  return structuredClone([...refs.values()]);
 }
 guidanceReferenceState(){
  if(!('snapshot'in this.spec.context)||this.spec.context.snapshot.v3?.knowledge.retrievalRevision!==AUTHORITY_DELIVERY_V3)return undefined;
  const snapshot=this.spec.context.snapshot,catalog=[...snapshot.resourceCatalog??[],...this.materials.flatMap(m=>m.meta?[m.meta]:[])];
  const eligible=catalog.filter(r=>r.enabled&&r.status==='valid'&&(snapshot.resources.some(ref=>ref.id===r.id&&ref.version===r.version)||this.materials.some(m=>m.meta?.id===r.id&&m.meta.version===r.version&&m.body!==undefined))&&this.documents.some(d=>d.resourceRef?.id===r.id&&d.resourceRef.version===r.version)).map(r=>({id:r.id,version:r.version})).filter((r,i,all)=>all.findIndex(value=>value.id===r.id&&value.version===r.version)===i);
  const ranges=this.ledger.snapshots(),exposed=this.documents.filter(d=>d.resourceRef&&ranges.some(r=>r.id===d.id&&r.end>r.offset)).map(d=>d.resourceRef!);
  return {eligible,exposed,complete:this.ledger.completeResourceRefs()};
 }
 private validateAnswer(delivery:AnswerDeliveryV21){
  if(!('marker'in this.spec.context)||!this.spec.context.grants.some(grant=>grant.readerProjectId===this.spec.projectId&&grant.readerRole==='theorist'&&isDeepStrictEqual(grant.ref,delivery.answerRef))||!this.spec.context.marker.optionalFlow?.artifacts.some(a=>isDeepStrictEqual(a.originalRef,delivery.answerRef))||!isDeepStrictEqual(delivery,makeAnswerDelivery(delivery.answerRef,delivery.body,'full-original')))throw new Error('Inline original differs from exact frozen delivery grants.');
 }
 bindPrompt(prompt:string){
  if(this.learning&&prompt.includes('\nFrozen task data: ')){this.prefix=prompt.slice(0,prompt.indexOf('\nFrozen task data: ')+19);this.initialPrompt=prompt;this.prompts.set(prompt,this.prefix);}
  else if(prompt.startsWith(PREFIX)){this.initialPrompt=prompt;this.prompts.set(prompt,PREFIX.trimEnd());const input=JSON.parse(prompt.slice(PREFIX.length));this.initialAnswers=(input.artifacts??[]).filter((a:any)=>typeof a.body==='string').map((a:any)=>makeAnswerDelivery(a.originalRef,a.body,'full-original'));for(const delivery of this.initialAnswers)this.validateAnswer(delivery);if(this.initialAnswers.reduce((sum,d)=>sum+d.answerRef.byteLength,0)>32768)throw new Error('Inline proof evidence exceeds its byte cap.');}
  else this.prompts.set(prompt,this.guidanceReferenceState()?prompt:prompt.split('Diagnostics:\n')[0]!);
 }
 tools():ToolDefinition[]{return [{name:'read_research_resource',label:'Read exact frozen guidance',
  description:'Read an exact frozen method, policy or knowledge page. Use guidanceRef or resource id/version. Follow nextOffset; partial reads do not grant the whole method.',
  parameters:Type.Object({guidanceRef:Type.Optional(Type.String()),id:Type.Optional(Type.String()),version:Type.Optional(Type.Integer({minimum:1})),offset:Type.Optional(Type.Integer({minimum:0})),maxLines:Type.Optional(Type.Integer({minimum:1,...(this.uncapped?{}:{maximum:100})}))},{additionalProperties:false}),
  execute:async(callId,args,signal,onUpdate,context)=>{
   const value=args as {guidanceRef?:string;id?:string;version?:number;offset?:number;maxLines?:number};
   let id=value.guidanceRef??(value.id&&value.version?`resource:${value.id}:${value.version}`:undefined);
   let doc=this.documents.find(item=>item.id===id);
   if(id&&this.catalogLoader&&(!doc||doc.resourceRef||this.materials.some(m=>`knowledge:${m.node.id}`===id)||'snapshot'in this.spec.context&&(this.spec.context.snapshot.v3?.catalogNodeIds??[]).some(nodeId=>`knowledge:${nodeId}`===id))){
    let material:CatalogMaterialV3;
    try{material=await this.catalogLoader(id);}catch(error){if(this.directed&&['STALE_SOURCE','FORBIDDEN','NOT_FOUND'].includes((error as {code?:string}).code??''))return this.unavailableRead(callId,id);throw error;}
    const expected=material.meta?`resource:${material.meta.id}:${material.meta.version}`:`knowledge:${material.node.id}`;
    const canonicalAlias=id===`knowledge:${material.node.id}`&&material.node.id===expected;
    const learnedAlias=id===`knowledge:${material.node.id}`&&material.node.id!==expected;
    if(expected!==id&&!canonicalAlias&&!learnedAlias)throw new Error('Catalog loader returned a different guidance identity.');
    if(canonicalAlias)id=expected;
    this.registerCatalogMaterial(material);doc=this.documents.find(item=>item.id===id);
   }
   if(!doc){if(this.directed)return this.unavailableRead(callId,id??'');throw new Error('Guidance is outside the exact frozen grants.');}
   if(!await this.navigationAvailable(doc.id)){const notice=this.unavailableNavigationPage(doc.id);this.pages.set(callId,notice);return {content:[{type:'text' as const,text:notice.text}],details:{guidancePage:notice.page,unavailableGuidanceRef:doc.id}};}
   if(this.learning&&doc.resourceRef){if(!this.resourceValidator)throw new Error('Missing scoped learning resource validator.');await this.resourceValidator.execute(callId,doc.resourceRef,signal,onUpdate,context);}
   if('brief'in this.spec.context&&this.spec.context.brief.v3?.catalogPin&&this.resourceValidator)await this.resourceValidator.execute(callId,{...doc.resourceRef,guidanceRef:doc.id},signal,onUpdate,context);
   const page=pageGuidanceV3(doc,value.offset??0,this.uncapped?(value.maxLines??Math.max(1,guidanceCostV3(doc.text))):Math.max(1,Math.min(value.maxLines??this.available,this.available)),this.uncapped?Math.max(1,Buffer.byteLength(doc.text)):8192);
   const text=JSON.stringify({guidancePage:page});this.pages.set(callId,{text,page});
   return {content:[{type:'text' as const,text}],details:{guidancePage:page}};
  }}];}
 /** Restore only a complete, hash-matching result from the bound continuation. */
 restoreCompletedRead(callId:string,result:unknown):void {
  const value=result as {content?:{type:string;text?:string}[];details?:{guidancePage?:ReturnType<typeof pageGuidanceV3>;unavailableGuidanceRef?:string}};
  const page=value.details?.guidancePage;if(!page)return; // Rejected read feedback grants nothing.
  const doc=this.documents.find(d=>d.id===page.id);
  if(!doc||doc.hash!==page.hash||!Number.isSafeInteger(page.offset)||!Number.isSafeInteger(page.end)||page.offset<0||page.end<page.offset||page.end>Buffer.byteLength(doc.text)||Buffer.from(doc.text).subarray(page.offset,page.end).toString('utf8')!==page.body)throw new Error('Invalid recovered guidance page.');
  const unavailableGuidanceRef=value.details?.unavailableGuidanceRef;
  if(unavailableGuidanceRef!==undefined&&(page.id!=='method-network:unavailable'||!this.navigationDocuments.has(unavailableGuidanceRef)))throw new Error('Foreign retired navigation reference.');
  const text=JSON.stringify({guidancePage:page,...(unavailableGuidanceRef!==undefined?{unavailableGuidanceRef}:{})});if(!value.content?.some(c=>c.type==='text'&&c.text===text))throw new Error('Incomplete recovered guidance result.');
  this.pages.set(callId,{page:structuredClone(page),text});
 }
 project(context:TranscriptContext,strictSchemas?:ReadonlyMap<string,unknown>):{context:TranscriptContext;exposure:Omit<GuidanceExposureV3,'dispatch'>}{
  const result=structuredClone(context),messages=result.messages as any[],toolGuidance=activeToolGuidanceV3(context,strictSchemas);let base=toolGuidance.lines,initialVisible=false,retainedInitial=false;
  const duplicate=`Exact duplicate frozen input omitted. Use the first frozen input above. ${this.learning?'Input':'Root'} hash: ${this.learning?guidanceHashV3(this.initialPrompt??''):this.rootHash}.`;
  // Keep one complete input; replacing each duplicate part separately cannot erase the first copy.
  for(const message of messages)if(message.role==='user'&&this.initialPrompt){
   if(typeof message.content==='string'&&message.content===this.initialPrompt){if(retainedInitial)message.content=duplicate;else retainedInitial=true;}
   else if(Array.isArray(message.content))for(const part of message.content)if(part.type==='text'&&part.text===this.initialPrompt){if(retainedInitial)part.text=duplicate;else retainedInitial=true;}
  }
  for(const message of messages){
   if('learning'in this.spec.context&&['compact-english-v13','compact-english-v14'].includes(this.spec.context.learning.promptRevision??'')&&message.role==='toolResult'&&message.toolName==='read_final_proof'&&!hostToolFeedback(message))for(const text of textParts(message)){
    let value:unknown;try{value=JSON.parse(text);}catch{throw new Error('Invalid final proof reader result.');}
    for(const prose of proofHostGuidanceV3(value))base+=guidanceCostV3(prose);
   }
   if(hostToolFeedback(message))for(const text of textParts(message)){let value:unknown;try{value=JSON.parse(text);}catch{value=text;}const cost=(item:unknown):number=>typeof item==='string'?guidanceCostV3(item):Array.isArray(item)?item.reduce((sum,v)=>sum+cost(v),0):item&&typeof item==='object'?Object.values(item).reduce<number>((sum,v)=>sum+cost(v),0):0;base+=cost(value);}
   if(message.role==='system'){base+=guidanceCostV3(textParts(message).join('\n'));for(const value of Object.values(message.sections??{}))if(typeof value==='string')base+=guidanceCostV3(value);}
   if(message.role==='user')for(const text of textParts(message)){
    if(text===this.initialPrompt){base+=guidanceCostV3(this.prefix.trimEnd());const data=JSON.parse(text.slice(this.prefix.length));for(const notice of [...data.notices??[],...(data.artifacts??[]).flatMap((a:any)=>[a.notice,a.originalOmitted]).filter(Boolean)])if(typeof notice==='string')base+=guidanceCostV3(notice);initialVisible=true;}
    else if(this.prompts.has(text))base+=guidanceCostV3(this.prompts.get(text)!);
    else base+=guidanceCostV3(text); // Only host-added advisories exist outside the exact initial question.
   }
  }
  if(!this.uncapped&&base>LIMIT)throw new Error('Authored guidance alone exceeds the 100-line budget.');
  this.available=this.uncapped?this.documents.reduce((sum,doc)=>sum+guidanceCostV3(doc.text),0)+messages.filter(m=>m.role==='toolResult').reduce((sum,m)=>sum+textParts(m).reduce((n,t)=>n+guidanceCostV3(t),0),0):LIMIT-base;
  const navigationNodeIds=new Set<string>(),networkSelections:NetworkSelectionV3[]=[],manifests:Manifest[]=[],omitted:string[]=[];let remaining=this.available,bytes=0;
  // Prefer the latest explicitly requested page. Preserve every tool-call/result pair.
  for(const message of [...messages].reverse())if(message.role==='toolResult'&&message.toolName==='read_research_resource'&&!hostToolFeedback(message)){
   const known=this.pages.get(message.toolCallId);if(!known)throw new Error('Unrecognized guidance page in provider view.');
   const display=this.retiredNavigation.has(known.page.id)?this.unavailableNavigationPage(known.page.id):known,page=display.page;let shown=false;
   for(const text of textParts(message))if(text===known.text||text===display.text){
    if(text!==display.text)replaceText(message,text,display.text);
    if(this.uncapped||page.lines<=remaining){remaining-=page.lines;bytes+=Buffer.byteLength(page.body);manifests.push({id:page.id,hash:page.hash,offset:page.offset,end:page.end});shown=true;}
    else replaceText(message,text,JSON.stringify(this.guidanceReferenceState()?{guidanceRef:page.id,hash:page.hash,delivered:false,deliveredBytes:0,retryOffset:page.offset,requestedRange:{offset:page.offset,end:page.end},omittedForBudget:true}:{guidanceRef:page.id,hash:page.hash,offset:page.offset,end:page.end,omittedForBudget:true}));
   }
   if(!shown)omitted.push(page.id);
  }
  const initial=this.initialIds.flatMap(id=>{const doc=this.documents.find(d=>d.id===id);return doc?[doc]:[];});
  const selection=initialVisible?(this.uncapped?{selected:initial,omitted:[],lines:initial.reduce((sum,doc)=>sum+guidanceCostV3(doc.text),0)}:selectWholeGuidanceV3(initial,remaining)):{selected:[],omitted:initial,lines:0};
  for(const doc of selection.selected){bytes+=Buffer.byteLength(doc.text);manifests.push({id:doc.id,hash:doc.hash,offset:0,end:Buffer.byteLength(doc.text)});}
  omitted.push(...selection.omitted.map(doc=>doc.id));
  for(const message of messages){
   if(message.role==='user'&&this.initialPrompt)for(const text of textParts(message))if(text===this.initialPrompt){
    const data=JSON.parse(text.slice(this.prefix.length));data.guidance={...(this.uncapped?{contentRevision:'compact-english-v14'}:{limit:LIMIT}),selected:selection.selected.map(doc=>({id:doc.id,hash:doc.hash,text:doc.text})),omittedRefs:selection.omitted.map(doc=>doc.id),catalog:this.documents.map(doc=>({id:doc.id,hash:doc.hash,lines:guidanceCostV3(doc.text),bytes:Buffer.byteLength(doc.text)}))};
    const unavailable='learning'in this.spec.context?this.spec.context.learning.resourceReadGrants?.unavailable:undefined;
    if(unavailable?.length){data.guidance.unavailableResources=structuredClone(unavailable);const task=data.frozenInput??data;for(const key of ['existingSkills','strategies'])if(Array.isArray(task[key]))task[key]=task[key].map((entry:any)=>unavailable.some(ref=>ref.id===entry.id&&ref.version===entry.version)?{...entry,readAvailability:'unavailable'}:entry);}
    replaceText(message,text,this.prefix+JSON.stringify(data));
   }
   if(message.role==='toolResult'&&message.toolName==='retrieve_knowledge'&&!hostToolFeedback(message))for(const text of textParts(message)){
    // This reader only supplies navigation; exact prose remains available through the scoped guidance reader.
    let data:any;try{data=JSON.parse(text);}catch{throw new Error('Invalid knowledge reader result.');}
    if((data.directedRouteQuery||data.directedRouteWithdrawn||data.directedRouteFeedback)&&('snapshot'in this.spec.context?this.spec.context.snapshot.modelDirectedKnowledge:'brief'in this.spec.context&&this.spec.context.brief.modelDirectedKnowledge))continue;
    if(data.pin?.recipe==='method-network-v1'){if(!('snapshot'in this.spec.context)||!validNetworkSelectionV3(data,this.spec.context.snapshot.v3?.methodNetwork?.pin))throw new Error('Foreign method network navigation.');networkSelections.push(data);continue;}
    const ids=[...(data.nodes??data.candidates??[]).map((node:any)=>node.id),data.nodeId??data.nodeRef].filter((id:unknown):id is string=>typeof id==='string'&&this.navigationDocuments.has(`knowledge:${id}`));
    if(ids.some((id:string)=>this.retiredNavigation.has(`knowledge:${id}`))){replaceText(message,text,JSON.stringify({methodNetworkUnavailable:true,...this.unavailableRoute}));continue;}
    for(const id of ids)navigationNodeIds.add(id);
    const pinned='snapshot'in this.spec.context&&!!this.spec.context.snapshot.v3?.catalogPin;
    const nodes=data.nodes??data.candidates??[],cards=nodes.map((node:any)=>pinned?{...card(node),title:node.title,summary:node.summary}:card(node));
    const availableRefs=pinned?nodes.map((node:any)=>node.authorityRef?`resource:${node.authorityRef.id}:${node.authorityRef.version}`:`knowledge:${node.id}`):this.documents.filter(doc=>doc.kind==='knowledge').map(doc=>doc.id);
    replaceText(message,text,JSON.stringify(pinned?{...data,candidates:undefined,nodes:undefined,cards,localContext:data.localContext?{...data.localContext,candidates:undefined,cards:(data.localContext.candidates??[]).map((node:any)=>({...card(node),title:node.title,summary:node.summary}))}:undefined,nodeRef:data.nodeId??data.nodeRef,guidanceOmitted:true,availableRefs}:{cards,nodeRef:data.nodeId??data.nodeRef,offset:data.offset,nextOffset:data.nextOffset,guidanceOmitted:true,availableRefs}));
   }
  }
  const navigationBytes=networkSelections.reduce((sum,value)=>sum+Buffer.byteLength(JSON.stringify(value)),0),navigationLines=networkSelections.reduce((sum,value)=>sum+guidanceCostV3(JSON.stringify(value)),0);bytes+=navigationBytes;
  if(manifests.some(manifest=>manifest.id==='method-network:initial')&&'snapshot'in this.spec.context&&this.spec.context.snapshot.v3?.methodNetwork)networkSelections.unshift(structuredClone(this.spec.context.snapshot.v3.methodNetwork.selection));
  const initialNetworkPresentationRevision=manifests.some(manifest=>manifest.id==='method-network:initial')&&'snapshot'in this.spec.context?this.spec.context.snapshot.v3?.methodNetwork?.presentationRevision:undefined;
  return {context:result,exposure:{...(initialNetworkPresentationRevision?{initialNetworkPresentationRevision}:{}),...(navigationNodeIds.size?{navigationNodeIds:[...navigationNodeIds]}:{}),...(networkSelections.length?{networkSelections,navigationBytes,navigationLines}:{}),kind:'v3-guidance-exposure',toolLines:toolGuidance.lines,toolBytes:toolGuidance.bytes,rootHash:initialVisible?this.rootHash:'',manifests,lines:base+(this.available-remaining)+selection.lines+navigationLines,bytes,omitted:[...new Set(omitted)],answerDeliveries:initialVisible?structuredClone(this.initialAnswers):[],proofBytes:initialVisible?this.initialAnswers.reduce((sum,d)=>sum+d.answerRef.byteLength,0):0}};
 }
 expose(exposure:Omit<GuidanceExposureV3,'dispatch'>){
  if(exposure.navigationNodeIds!==undefined&&(!Array.isArray(exposure.navigationNodeIds)||new Set(exposure.navigationNodeIds).size!==exposure.navigationNodeIds.length||exposure.navigationNodeIds.some(id=>typeof id!=='string'||!this.navigationDocuments.has(`knowledge:${id}`))))throw new Error('Foreign navigation source binding.');
  const initialNetwork=exposure.manifests.some(manifest=>manifest.id==='method-network:initial');
  const expectedPresentation=initialNetwork&&'snapshot'in this.spec.context?this.spec.context.snapshot.v3?.methodNetwork?.presentationRevision:undefined;
  if(exposure.initialNetworkPresentationRevision!==expectedPresentation)throw new Error('Initial network presentation exposure mismatch.');
  if(initialNetwork&&(!('snapshot'in this.spec.context)||!this.spec.context.snapshot.v3?.methodNetwork||!isDeepStrictEqual(exposure.networkSelections?.[0],this.spec.context.snapshot.v3.methodNetwork.selection)))throw new Error('Initial network exposure differs from frozen selection.');
  for(const selection of exposure.networkSelections??[])if(!('snapshot'in this.spec.context)||!this.spec.context.snapshot.v3?.methodNetwork||!validNetworkSelectionV3(selection,this.spec.context.snapshot.v3.methodNetwork.pin))throw new Error('Foreign network exposure.');
  if(!Number.isSafeInteger(exposure.lines)||exposure.lines<0||!this.uncapped&&exposure.lines>LIMIT||!Number.isSafeInteger(exposure.bytes)||exposure.bytes<0||typeof exposure.rootHash!=='string'||exposure.rootHash&&exposure.rootHash!==this.rootHash)throw new Error('Guidance exposure binding mismatch.');
  const validation=new GuidanceExposureLedgerV3(this.documents);validation.expose(exposure.manifests);
  let lines=0,bytes=0;for(const page of exposure.manifests){const doc=this.documents.find(item=>item.id===page.id)!;const body=Buffer.from(doc.text).subarray(page.offset,page.end);lines+=guidanceCostV3(body.toString('utf8'));bytes+=body.length;}
  const toolSelections=(exposure.networkSelections??[]).slice(initialNetwork?1:0);
  const navigationBytes=toolSelections.reduce((sum,value)=>sum+Buffer.byteLength(JSON.stringify(value)),0),navigationLines=toolSelections.reduce((sum,value)=>sum+guidanceCostV3(JSON.stringify(value)),0);
  if((exposure.navigationBytes??0)!==navigationBytes||(exposure.navigationLines??0)!==navigationLines)throw new Error('Network navigation metrics mismatch.');
  bytes+=navigationBytes;lines+=navigationLines;
  if(lines>exposure.lines||bytes!==exposure.bytes)throw new Error('Guidance exposure metrics mismatch.');
  for(const delivery of exposure.answerDeliveries??[])this.validateAnswer(delivery);
  const proofBytes=(exposure.answerDeliveries??[]).reduce((sum,d)=>sum+d.answerRef.byteLength,0);if(proofBytes>32768||proofBytes!==(exposure.proofBytes??0)||proofBytes&&!exposure.rootHash)throw new Error('Inline proof exposure binding mismatch.');
  this.ledger.expose(exposure.manifests);for(const delivery of exposure.answerDeliveries??[])if(!this.answerDeliveries.some(d=>isDeepStrictEqual(d,delivery)))this.answerDeliveries.push(structuredClone(delivery));if(exposure.rootHash&&exposure.rootHash===this.rootHash)this.rootDelivered=true;
 }
}
export function restoreGuidanceV3(spec:AgentSessionSpecV21,rows:unknown[]){
 const manager=new RuntimeGuidanceV3(spec);for(const value of rows){const row=value as GuidanceExposureV3|{kind:'v3-catalog-material';material:CatalogMaterialV3};if(row.kind==='v3-catalog-material')manager.registerCatalogMaterial(row.material);else if(row.kind==='v3-guidance-exposure'){if(!Number.isSafeInteger(row.dispatch)||row.dispatch<1)throw new Error('Invalid guidance dispatch.');manager.expose(row);}}
 return {resources:manager.ledger.completeResourceRefs(),rootDelivered:manager.rootDelivered,deliveries:manager.answerDeliveries,...(('snapshot'in spec.context?spec.context.snapshot.v3?.catalogPin:'brief'in spec.context?spec.context.brief.v3?.catalogPin:undefined)?{catalogMaterials:manager.catalogMaterials,knowledgeReads:manager.knowledgeReads()}:{})};
}
