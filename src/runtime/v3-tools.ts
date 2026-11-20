import {bindRouteInstanceV3,type RouteInstanceV3,type RouteInstanceRequestV3} from '../research/versions/v3/route-instances.js';
import {directedRouteLookup,directedRouteLookupDescription} from './directed-route-tools.js';
import {DirectedRouteInputError,validateDirectedRouteQuery,type DirectedRouteQuery} from '../learning/directed-route.js';
import {validNetworkPinV3,type NetworkQueryV3} from '../learning/method-network-v3.js';
import type {FrozenMethodNetworkV3} from '../research/versions/v3/integration.js';
import {isDeepStrictEqual} from 'node:util';
import {resourceNavigationSourcesV3,bodyHashV3,mergeCatalogMaterialsV3,validateCatalogMaterialV3,type CatalogPinV3,type CatalogPortV3,type CatalogMaterialV3} from '../research/versions/v3/catalog-context.js';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { stableHash } from '../learning/research-hash.js';
import { executeRegisteredBatchV3, REGISTERED_OPERATIONS_V3, RegisteredOperationsSchemaV3, validateOperationArgumentsV3, OperationInputErrorV3, type RegisteredOperationRequestV3, type OperationReceiptV3 } from '../research/versions/v3/operations.js';
import { retrieveKnowledgeV3, retrieveKnowledgeLegacyV3, readKnowledgeNodeV3, type KnowledgeSnapshotV3, type KnowledgeQueryV3 } from '../research/versions/v3/knowledge.js';
import { adoptOperationReceiptV3, type WorkspaceV3 } from '../research/versions/v3/workspace.js';
import type { ArtifactStoreV3 } from './v3-artifacts.js';
import type { OperationJournal } from './operation-journal.js';

export interface RuntimeContextV3 {methodNetwork?:FrozenMethodNetworkV3;knowledge:KnowledgeSnapshotV3;workspace:WorkspaceV3;catalogPin?:CatalogPinV3;catalogNodeIds?:string[]}
/** Scoped to one already pinned invocation, never a filesystem capability. */
export class RuntimeToolsV3 {
  private catalog?:{pin:CatalogPinV3;port:CatalogPortV3;register:(material:CatalogMaterialV3)=>void;knowledgeReads:()=>string[];materials?:CatalogMaterialV3[]};
  private materials:CatalogMaterialV3[]=[];
  private routeInstances:RouteInstanceV3[]=[];
  private navigationSources=new Map<string,{id:string;version:number}[]>();
  private knowledgeReader:()=>string[]=()=>[];
  configureCatalog(options:{pin:CatalogPinV3;port:CatalogPortV3;register:(material:CatalogMaterialV3)=>void;knowledgeReads:()=>string[];materials?:CatalogMaterialV3[]}):void {
    if(!isDeepStrictEqual(options.pin,this.context.catalogPin))throw new Error('Catalog pin mismatch.');if(this.context.methodNetwork&&(!validNetworkPinV3(this.context.methodNetwork.pin)||this.context.methodNetwork.pin.catalogHash!==options.pin.indexHash||this.context.methodNetwork.pin.revision!==options.pin.revision||!isDeepStrictEqual(this.context.methodNetwork.pin,this.context.methodNetwork.selection.pin)||!options.port.network))throw new Error('Invalid method network pin or reader.');this.catalog=options;this.knowledgeReader=options.knowledgeReads;this.materials=structuredClone(options.materials??[]);
  }
  setKnowledgeReader(reader:()=>string[]):void {this.knowledgeReader=reader;}
  private async retain(material:CatalogMaterialV3):Promise<void>{
    if(!this.catalog||!this.journal||this.stopped())throw new Error('Catalog stopped or unbound.');
    validateCatalogMaterialV3(material,this.catalog.pin);
    const frozen=this.context.knowledge.nodes.find(node=>node.id===material.node.id);
    if(frozen&&!isDeepStrictEqual(frozen,material.node))throw new Error('Catalog node identity conflicts with frozen context.');
    const index=this.materials.findIndex(m=>m.node.id===material.node.id);
    const merged=mergeCatalogMaterialsV3(this.catalog.pin,index<0?[]:[this.materials[index]!],[material]);
    await this.journal.capture({kind:'v3-catalog-material',material:structuredClone(material)});
    this.catalog.register(material);if(index<0)this.materials.push(merged[0]!);else this.materials[index]=merged[0]!;
  }
  async loadCatalog(id:string):Promise<CatalogMaterialV3>{
    if(!this.catalog||!this.journal||this.stopped())throw new Error('Catalog unavailable.');
    const {pin,port}=this.catalog,nodeId=id.startsWith('knowledge:')?id.slice(10):id;
    const node=await port.node(pin,nodeId);if(node.id!==nodeId)throw new Error('Catalog node identity mismatch.');
    let material:CatalogMaterialV3={pin,node};
    if(node.authorityRef){const exact=await port.resource(pin,node.authorityRef);material={...material,...exact,bodyHash:bodyHashV3(exact.body)};}
    await this.retain(material);return structuredClone(material);
  }
  private nodePage(snapshot:KnowledgeSnapshotV3,id:string,query:KnowledgeQueryV3){
    const node=snapshot.nodes.find(n=>n.id===id);if(!node)throw new Error('Unknown frozen knowledge node.');
    const budget=Math.max(512,Math.min(262144,query.maxChars??8192));let bytes=Math.min(8192,Math.max(256,budget-1024));
    for(;;){const page={...readKnowledgeNodeV3(snapshot,id,{offset:query.offset,maxBytes:bytes}),nodes:[{id:node.id,kind:node.kind,title:node.title.slice(0,128),summary:node.summary.slice(0,256),sourceRef:node.sourceRef,status:node.status,...(node.authorityRef?{authorityRef:node.authorityRef}:{})}],metadataOnly:true};
      if(Buffer.byteLength(JSON.stringify(page))<=budget)return page;
      if(bytes===256)return {nodeRef:id,metadataOmitted:true,hint:'Retry the same nodeRef and offset with larger maxChars for the exact frozen body page.'};bytes=Math.max(256,Math.floor(bytes/2));
    }
  }
  private async retrieveCatalog(query:NetworkQueryV3 & {nodeRef?:string;facets?:string[]}):Promise<unknown>{
    const {pin,port}=this.catalog!;
    if(query.nodeRef){
      if(this.context.knowledge.nodes.some(n=>n.id===query.nodeRef)&&!(this.context.catalogNodeIds??[]).includes(query.nodeRef)){
        try{for(const ref of this.navigationSources.get(query.nodeRef)??[])await port.meta(pin,ref);}
        catch(error){if((error as {code?:string})?.code!=='STALE_SOURCE')throw error;return {methodNetworkUnavailable:true,notice:'This navigation source was withdrawn. Use global retrieval or reason freely; no unrelated proof evidence is invalidated.',rescue:{view:'global',offset:0}};}
        return this.nodePage(this.context.knowledge,query.nodeRef,query);
      }
      const node=await port.node(pin,query.nodeRef);if(node.id!==query.nodeRef)throw new Error('Catalog node identity mismatch.');
      const meta=node.authorityRef?await port.meta(pin,node.authorityRef):undefined;
      await this.retain({pin,node,...(meta?{meta}:{})});
      return this.nodePage({version:pin.revision,hash:pin.indexHash,nodes:[node],edges:[]},node.id,query);
    }
    if(this.context.methodNetwork){
      const selected=await port.network!(this.context.methodNetwork.pin,query);
      if(!isDeepStrictEqual(selected.pin,this.context.methodNetwork.pin))throw new Error('Method network selection pin mismatch.');
      return selected; // Navigation only: never register clusters as authority material.
    }
    const local=retrieveKnowledgeV3(this.context.knowledge,{...query,offset:0,query:query.query??''});
    const seeds=(query.refs?.length||query.goalIds?.length?local.candidates:[]).flatMap(node=>node.authorityRef?[`resource:${node.authorityRef.id}:${node.authorityRef.version}`]:[]);
    const selected=await port.query(pin,{...query,query:query.query??'',refs:[...new Set([...(query.refs??[]),...seeds])]});
    if(!isDeepStrictEqual(pin,selected.pin))throw new Error('Catalog selection pin mismatch.');
    for(const entry of selected.candidates)await this.retain({pin,node:entry.node,...(entry.meta?{meta:entry.meta}:{})});
    const result={...selected,candidates:selected.candidates.map(entry=>entry.node),cursorScope:'global-catalog' as const,localContext:undefined as ReturnType<typeof retrieveKnowledgeV3>|undefined};
    if(local.candidates.length)result.localContext=local;
    const maxBytes=Math.max(512,Math.min(262144,query.maxChars??32768));
    if(Buffer.byteLength(JSON.stringify(result))>maxBytes)delete result.localContext;
    if(Buffer.byteLength(JSON.stringify(result))>maxBytes)throw new Error('Catalog navigation metadata exceeds requested budget.');
    return result;
  }
  directedReader(port?:CatalogPortV3,pin?:CatalogPinV3,network?:FrozenMethodNetworkV3):ToolDefinition {
    // Pi's provider adapters read properties from the root object of a tool schema.
    const familyQuery=Type.Object({
      ...directedRouteLookup.properties,mode:Type.Optional(directedRouteLookup.properties.mode),
      view:Type.Optional(Type.Union([Type.Literal('directory'),Type.Literal('family')])),
      clusterRef:Type.Optional(Type.String({minLength:1})),maxNodes:Type.Optional(Type.Integer({minimum:1,maximum:32}))
    },{additionalProperties:false});
    return {
      name:'retrieve_knowledge',label:'Browse Skill and Strategy routes',
      description:directedRouteLookupDescription+(network?' Use view=directory or view=family with clusterRef to browse authored method neighborhoods.':''),
      parameters:network?familyQuery:directedRouteLookup,
      execute:async(_callId,input)=>{
        if(!this.journal||this.stopped())throw new Error('Route reader stopped or unbound.');
        this.dispatches++;
        let result:unknown;
        try{
          if(input&&typeof input==='object'&&'view' in input){
            if(!network||!port?.network)throw new Error('Route family reader unavailable.');
            const q=input as {view:'directory'|'family';clusterRef?:string;offset?:number;maxNodes?:number};
            if(Object.keys(q).some(k=>!['view','clusterRef','offset','maxNodes'].includes(k))||(q.view==='family')!==!!q.clusterRef)
              throw new DirectedRouteInputError('Select view=directory, or view=family with its exact clusterRef.');
            result=await port.network(network.pin,{...q,query:''});
          }else{
            const query=input as DirectedRouteQuery;
            validateDirectedRouteQuery(query);
            if(pin){
              if(!port?.directedRoutes)throw new Error('Directed route reader unavailable.');
              result={directedRouteQuery:query,page:await port.directedRoutes(pin,query)};
            }else{
              if(query.mode==='relations')throw new DirectedRouteInputError('Route anchor outside the current grant');
              result={directedRouteQuery:query,page:{mode:query.mode,...(query.mode==='directory'?{directory:[]}:{}),entries:[],total:0,notice:'No route catalog is available in this frozen context.'}};
            }
          }
        }catch(error){
          if(!(error instanceof DirectedRouteInputError))throw error;
          result={directedRouteFeedback:true,notice:error.message};
        }
        await this.journal.capture({kind:'v3-knowledge-retrieval',query:input,result});
        return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};
      }
    };
  }
  private journal?:OperationJournal;
  private requestSequence=0;
  private artifacts=new Map<string,unknown>();
  private receipts=new Map<string,OperationReceiptV3>();
  private workspace:WorkspaceV3;
  private dispatches=0;
  constructor(private readonly context:RuntimeContextV3,private readonly host:{runId:string;rootVersion:string;branchId:string;sourceVersion:string},private readonly stopped:()=>boolean,private readonly persisted?:{store:ArtifactStoreV3;grantedRefs:string[]},private readonly compactContract=false){this.workspace=structuredClone(context.workspace);if(context.methodNetwork)this.navigationSources=resourceNavigationSourcesV3(context.knowledge);}
  bind(journal:OperationJournal):void {this.journal=journal;this.requestSequence=0;this.dispatches=0;this.routeInstances=[];this.artifacts.clear();this.receipts.clear();this.materials=structuredClone(this.catalog?.materials??[]);this.workspace=structuredClone(this.context.workspace);}
  summary(){return {...(this.context.methodNetwork?{methodNetworkPin:structuredClone(this.context.methodNetwork.pin),routeInstances:structuredClone(this.routeInstances)}:{}),receipts:structuredClone([...this.receipts.values()]),modelRequests:this.journal?.state.dispatches??0,toolDispatches:this.dispatches,completedTools:[...this.receipts.values()].filter(r=>r.status==='completed').length,...(this.context.catalogPin?{catalogPin:structuredClone(this.context.catalogPin),catalogNodeIds:[...this.context.catalogNodeIds??[]],catalogMaterials:structuredClone(this.materials),knowledgeReads:this.knowledgeReader().filter(id=>(this.context.catalogNodeIds??[]).includes(id)||this.materials.some(m=>m.node.id===id))}: {})};}
  tools():ToolDefinition[]{return [
    {name:'execute_registered_operations',label:'Execute reviewed operations',description:this.compactContract?'Run 1–8 independent local checks, stopping on failure. Rationals use integer/fraction strings; polynomial arrays ascend by degree; dimension keys are SI exponents. Results certify only supplied inputs, never the global proof.': 'Execute 1–8 independent bounded local operations. Registered IDs and scopes: '+JSON.stringify(REGISTERED_OPERATIONS_V3)+'. Return at the first missing condition, unsupported operation or inapplicable input. Never execute model-generated code. Results verify only their stated local scope.',parameters:this.compactContract?RegisteredOperationsSchemaV3:Type.Object({requests:Type.Array(Type.Object({operationId:Type.String({maxLength:100}),parameters:Type.Unknown(),factRefs:Type.Optional(Type.Array(Type.String({maxLength:256}),{maxItems:64})),conditionRefs:Type.Optional(Type.Array(Type.String({maxLength:256}),{maxItems:64}))},{additionalProperties:false}),{minItems:1,maxItems:8})},{additionalProperties:false}),execute:async(_id,args)=>{
      if(!this.journal||this.stopped())throw new Error('V3 operation stopped or unbound.');
      if(this.compactContract){try{validateOperationArgumentsV3(args);}catch(error){if(!(error instanceof OperationInputErrorV3))throw error;return {content:[{type:'text',text:JSON.stringify({error:{category:error.code,message:error.message},executed:false})}],details:{v3InputError:true}};}}
      const requestKey=`${this.journal.state.pinHash}:${++this.requestSequence}`;
      const requestedAt=new Date().toISOString();
      this.dispatches++;await this.journal.capture({kind:'v3-execution-pending',requestKey,requestedAt});
      const receipts=await executeRegisteredBatchV3((args as {requests:RegisteredOperationRequestV3[]}).requests,{...this.host,knowledgeVersion:this.context.knowledge.version,requestKey,requestedAt,workspace:this.workspace,...(this.compactContract?{strictContract:true}:{})},{
        readReceipt:async id=>this.receipts.get(id),
        persistArtifact:async(ref,full)=>{if(this.stopped())throw new Error('V3 stopped before artifact publication.');const old=this.artifacts.get(ref);if(old&&stableHash(old)!==stableHash(full))throw new Error('V3 immutable artifact conflict.');await this.persisted?.store.save(ref,full);await this.journal!.capture({kind:'v3-operation-artifact',ref,full});this.artifacts.set(ref,structuredClone(full));},
        persistReceipt:async receipt=>{if(this.stopped())throw new Error('V3 stopped before receipt publication.');await this.journal!.capture({kind:'v3-operation-receipt',receipt});this.receipts.set(receipt.id,structuredClone(receipt));},
      });
      for(const receipt of receipts)this.workspace=adoptOperationReceiptV3(this.workspace,receipt,this.host.branchId);
      const compact=receipts.map(receipt=>({...receipt,inputBinding:{...receipt.inputBinding,factRefs:receipt.inputBinding.factRefs.slice(0,4),conditionRefs:receipt.inputBinding.conditionRefs.slice(0,4)},conditionalPremises:receipt.conditionalPremises.slice(0,4),missingConditions:receipt.missingConditions.slice(0,4),errors:receipt.errors.slice(0,4).map(error=>error.slice(0,256)),summary:receipt.summary.slice(0,512),conditionalPremiseCount:receipt.conditionalPremises.length,missingConditionCount:receipt.missingConditions.length,omittedReferenceCount:Math.max(0,receipt.inputBinding.factRefs.length-4)+Math.max(0,receipt.inputBinding.conditionRefs.length-4)+Math.max(0,receipt.conditionalPremises.length-4)+Math.max(0,receipt.missingConditions.length-4)}));
      const bounded=compact.map(receipt=>Buffer.byteLength(JSON.stringify(receipt))<=1800?receipt:{id:receipt.id,taskId:receipt.taskId,callId:receipt.callId,operationId:receipt.operationId,operationVersion:receipt.operationVersion,inputHash:receipt.inputHash,sourceVersion:receipt.sourceVersion,artifactRef:receipt.artifactRef,status:receipt.status,verification:receipt.verification,conditionalPremiseCount:receipt.conditionalPremiseCount,missingConditionCount:receipt.missingConditionCount,truncated:true,notice:'Read the immutable artifact for full premises, binding and result before relying on this receipt.'});
      const visible=this.compactContract?receipts.map(receipt=>({id:receipt.id,artifactRef:receipt.artifactRef,status:receipt.status,verification:receipt.verification,...(receipt.result!==undefined?{result:receipt.result}:{}),conditionalPremises:receipt.conditionalPremises,missingConditions:receipt.missingConditions,errors:receipt.errors})).map(receipt=>Buffer.byteLength(JSON.stringify(receipt))<=1800?receipt:{id:receipt.id,artifactRef:receipt.artifactRef,status:receipt.status,verification:receipt.verification,truncated:true,notice:'Read artifact for full result, premises and errors before relying on it.'}):bounded;
      return {content:[{type:'text',text:JSON.stringify({receipts:visible,notice:'Local execution evidence only. Continue the same proof; cite actually used receipt IDs in the final outcome. Do not equate computation with global proof.'})}],details:{v3Receipts:receipts}};
    }},
    {name:'retrieve_knowledge',label:'Retrieve frozen linked knowledge',description:this.context.methodNetwork?'Search frozen method clusters first; view=routes and clusterRef expand route summaries; view=global with offset rescues uncovered resources. Exact bodies use read_research_resource. Unknown fit permits free reasoning; links are not proof.':'Bounded deterministic lookup in the knowledge snapshot frozen for this run. Use goal or node references for directed follow-up. Backlinks are navigation, not reverse implications.',parameters:Type.Object({...(this.context.methodNetwork?{clusterRef:Type.Optional(Type.String({maxLength:256})),view:Type.Optional(Type.Union([Type.Literal('clusters'),Type.Literal('routes'),Type.Literal('global')]))}:{}),...(this.catalog?{facets:Type.Optional(Type.Array(Type.String(),{maxItems:32}))}:{}),query:Type.Optional(Type.String({maxLength:16384})),nodeRef:Type.Optional(Type.String({maxLength:256})),offset:Type.Optional(Type.Integer({minimum:0})),refs:Type.Optional(Type.Array(Type.String(),{maxItems:32})),goalIds:Type.Optional(Type.Array(Type.String(),{maxItems:32})),maxNodes:Type.Optional(Type.Integer({minimum:1,maximum:32})),maxHops:Type.Optional(Type.Integer({minimum:0,maximum:3})),maxChars:Type.Optional(Type.Integer({minimum:512,maximum:this.catalog?262144:16384}))},{additionalProperties:false}),execute:async(_id,args)=>{if(!this.journal||this.stopped())throw new Error('V3 retrieval stopped or unbound.');this.dispatches++;const query=args as KnowledgeQueryV3 & {nodeRef?:string};const result=this.catalog?await this.retrieveCatalog(query):query.nodeRef?readKnowledgeNodeV3(this.context.knowledge,query.nodeRef,{offset:query.offset,maxBytes:query.maxChars}):(this.compactContract?retrieveKnowledgeV3:retrieveKnowledgeLegacyV3)(this.context.knowledge,{...query,query:query.query??''});await this.journal.capture({kind:'v3-knowledge-retrieval',query:args,result});return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};}},
    {name:'read_operation_artifact',label:'Read retained operation artifact',description:'Read a bounded portion of an immutable full artifact returned in this invocation. Only exact granted artifact references are accepted.',parameters:Type.Object({ref:Type.String({maxLength:256}),offset:Type.Optional(Type.Integer({minimum:0})),length:Type.Optional(Type.Integer({minimum:1,maximum:12000}))},{additionalProperties:false}),execute:async(_id,args)=>{if(!this.journal||this.stopped())throw new Error('V3 artifact read stopped or unbound.');const {ref,offset=0,length=12000}=args as {ref:string;offset?:number;length?:number};const full=this.artifacts.get(ref)??(this.persisted?.grantedRefs.includes(ref)?await this.persisted.store.read(ref):undefined);if(!full){if(this.compactContract)return {content:[{type:'text',text:JSON.stringify({error:{category:'ungranted-reference',message:'Use an exact artifactRef returned in this invocation or granted by the host.'},executed:false})}],details:{v3InputError:true}};throw new Error('Unknown or ungranted V3 artifact.');}this.dispatches++;const text=JSON.stringify(full);
      if(this.compactContract&&(!Number.isSafeInteger(offset)||offset<0||offset>text.length||!Number.isSafeInteger(length)||length<1||length>12000||offset>0&&/[\uDC00-\uDFFF]/.test(text[offset]??'')&&/[\uD800-\uDBFF]/.test(text[offset-1]??'')||length===1&&/[\uD800-\uDBFF]/.test(text[offset]??'')))return {content:[{type:'text',text:JSON.stringify({error:{category:'invalid-read-range',message:'Use a valid codepoint boundary and length 2–12000 when reading a surrogate pair.'},executed:false})}],details:{v3InputError:true}};
      let end=Math.min(text.length,offset+length);const envelope=()=>({ref,text:text.slice(offset,end),offset,totalLength:text.length,truncated:end<text.length,...(end<text.length?{nextOffset:end}:{})});while(Buffer.byteLength(JSON.stringify(envelope()))>16384&&end>offset)end--;if(end<text.length&&end>offset&&/[\uD800-\uDBFF]/.test(text[end-1]!))end--;return {content:[{type:'text',text:JSON.stringify(envelope())}],details:{}};}},
    ...(this.context.methodNetwork?[{name:'record_research_route',label:'Record current route binding',description:'Optional current-question route instance. Bind exact route and workspace goal/roles; expected outputs remain unproved expectations. This neither reads a method body nor establishes applicability or evidence.',parameters:Type.Object({routeRef:Type.Object({id:Type.String(),version:Type.Integer({minimum:1})},{additionalProperties:false}),goalId:Type.String(),bindings:Type.Array(Type.Object({role:Type.String(),recordId:Type.String()},{additionalProperties:false}),{maxItems:64}),applicability:Type.Union([Type.Literal('unknown'),Type.Literal('compatible'),Type.Literal('incompatible')]),status:Type.Union([Type.Literal('candidate'),Type.Literal('active'),Type.Literal('rejected'),Type.Literal('failed')]),reason:Type.String({minLength:1}),expectedOutputs:Type.Array(Type.String({minLength:1}),{maxItems:64})},{additionalProperties:false}),execute:async(_id:string,args:unknown)=>{
      if(!this.catalog?.port.network||!this.journal||this.stopped())throw new Error('Network route binding unavailable.');
      const request=args as RouteInstanceRequestV3,pin=this.context.methodNetwork!.pin;
      const selected=await this.catalog.port.network(pin,{query:'',refs:[request.routeRef.id],view:'routes',maxNodes:32,maxChars:262144});
      if(!isDeepStrictEqual(pin,selected.pin))throw new Error('Foreign route network pin.');
      const route=[...selected.routes,...selected.clusters.flatMap(c=>c.routes)].find(r=>isDeepStrictEqual(r.ref,request.routeRef));
      if(!route)throw new Error('Exact route is not available in this frozen network.');
      await this.catalog.port.meta(this.catalog.pin,route.resourceRef);
      const instance=bindRouteInstanceV3(this.workspace,pin,this.host.branchId,request,route);
      await this.journal.capture({kind:'v3-route-instance',instance});if(!this.routeInstances.some(r=>r.id===instance.id))this.routeInstances.push(instance);this.dispatches++;
      return {content:[{type:'text' as const,text:JSON.stringify({instance,notice:'Navigation binding only; expected outputs are not facts and compatible does not establish premises.'})}],details:{}};
    }}]:[]),
  ];}
}
