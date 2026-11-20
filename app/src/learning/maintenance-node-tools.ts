import {defineTool,type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {Type,type TSchema,type Static} from 'typebox';
import {exact} from '../runtime/strict-schema.js';
import {RESOURCE_TITLE_GUIDANCE, SKILL_BODY_GUIDANCE, STRATEGY_BODY_GUIDANCE} from './resource-authoring.js';
import {FIELD_TAG_GUIDANCE} from '../shared/knowledge-fields.js';
import {mapNodeTypeSchema,authoredRelationKinds,MAP_NODE_WRITING} from './map-node-fields.js';
import {MapError,sameMapRef} from './knowledge-map.js';
import type {ResearchLibrary} from './research-library.js';


const closed={additionalProperties:false};
const scope=Type.Union([Type.Literal('project-map'),Type.Literal('shared-library')]);
const revision=Type.Integer({minimum:0}), id=Type.String({minLength:1,maxLength:256});
const target={scope,id,version:Type.Integer({minimum:1}),revision};
const content={
 nodeType:Type.Optional(mapNodeTypeSchema),
 relations:Type.Optional(Type.Array(Type.Object({target:Type.Object({id,version:Type.Integer({minimum:1})},closed),
  kind:Type.Union(authoredRelationKinds.map(k=>Type.Literal(k))),direction:Type.Union([Type.Literal('forward'),Type.Literal('symmetric')]),basis:Type.String({minLength:1})},closed))),
 kind:Type.Union([Type.Literal('concept'),Type.Literal('theorem'),Type.Literal('method-skill'),Type.Literal('failure-skill'),Type.Literal('specific-strategy')]),
 title:Type.String({minLength:1,maxLength:500}),body:Type.String({minLength:1,maxLength:1000000}),
 summary:Type.Optional(Type.String({maxLength:4000,description:"Project-map search summary. Empty text clears it."})),
 description:Type.Optional(Type.String({maxLength:4000,description:"Shared Skill or Strategy description. Empty text clears it."})),
 aliases:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:500}),{maxItems:64,description:"Project-map alternative names. An empty list clears them."})),
 tags:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:200}),{maxItems:64,description:"Shared resource classification tags, e.g. subject:physics, or project-map domain labels."})),
 proof:Type.Optional(Type.String({minLength:1,maxLength:1000000,description:'Full attached proof of this theorem under the stated assumptions.'})),
 review:Type.Optional(Type.String({minLength:1,maxLength:1000000,description:'Your check of the decisive inference and its conditions in the attached proof. Submit only after verifying the proof in this session.'})),
 dependencies:Type.Optional(Type.Array(Type.Object({id,version:Type.Integer({minimum:1})},closed),{maxItems:128,description:'Exact project-map theorems or definitions used as premises.'})),
 assumptions:Type.Array(Type.String({minLength:1,maxLength:1000}),{maxItems:128}),
};
const list=Type.Object({scope,offset:Type.Optional(Type.Integer({minimum:0})),query:Type.Optional(Type.String({maxLength:500}))},closed);
const read=Type.Object({...target,supportId:Type.Optional(Type.String({minLength:1,description:'Read the attached argument for this exact support.'})),offset:Type.Optional(Type.Integer({minimum:0}))},closed);
const create=Type.Object({scope,revision,...content},closed);
const edit=Type.Object({...target,...content},closed);
const retire=Type.Object(target,closed);
const reviewImport=Type.Object({...target,mode:Type.Union([Type.Literal('proof'),Type.Literal('transcription')]),verdict:Type.Union([Type.Literal('confirm'),Type.Literal('inconclusive')]),reason:Type.String({minLength:1,maxLength:100000}),dependencies:content.dependencies},closed);
type Content=Pick<Static<typeof create>,'kind'|'title'|'body'|'assumptions'|'tags'|'summary'|'description'|'aliases'|'nodeType'|'relations'|'proof'|'review'|'dependencies'>;

function tool<S extends TSchema,R>(name:string,description:string,parameters:S,run:(input:Static<S>,callId:string,signal?:AbortSignal)=>Promise<R>,summarize:(receipt:R,input:Static<S>)=>string):ToolDefinition {
 return defineTool({name:'maintenance_'+name,label:name.replaceAll('_',' '),description,parameters,executionMode:'sequential',
  execute:async(callId,input,signal)=>{
   exact(parameters,input);signal?.throwIfAborted();
   const result=await run(input,callId,signal);
   const mutation=['create_node','edit_node','delete_node','review_import'].includes(name);
   return {content:[{type:'text',text:JSON.stringify(result)}],details:{summary:summarize(result,input),...(mutation?{receipt:result}:{})}};
  }});
}

export function maintenanceNodeTools(library:ResearchLibrary,projectId?:string):ToolDefinition[] {
 const allowed=projectId===undefined?'shared-library':'project-map';
 const authoring=allowed==='shared-library'?' '+[RESOURCE_TITLE_GUIDANCE,'For Skills: '+SKILL_BODY_GUIDANCE,'For Strategies: '+STRATEGY_BODY_GUIDANCE,FIELD_TAG_GUIDANCE].join(' '):' '+MAP_NODE_WRITING;
 function scopedTool<S extends TSchema,R>(name:string,description:string,parameters:S,run:(input:Static<S>,callId:string,signal?:AbortSignal)=>Promise<R>,summarize:(receipt:R,input:Static<S>)=>string){
  return tool(name,`This session can access only ${allowed}. ${description}`,parameters,(input,callId,signal)=>{
   if((input as {scope?:string}).scope!==allowed)throw new MapError('FORBIDDEN',`Session scope is ${allowed}.`);
   return run(input,callId,signal);
  },summarize);
 }
 const evidenceOffsets=new Map<string,number>();
 const checkpoints=new Map<number,string>();
 const rememberCurrent=()=>{
  const {checkpoint,mapVersion,generation}=library.maintenanceCheckpoint();
  const revision=projectId===undefined?generation:mapVersion;
  if(checkpoint&&revision!==undefined)checkpoints.set(revision,checkpoint);
 };
 const snapshot=async()=>{
  const map=await library.knowledgeMap.inspectMaintenance(projectId!);
  checkpoints.set(map.revision,map.checkpoint);return map;
 };
 async function write(input:{scope:Static<typeof scope>;revision:number},callId:string,ref?:{id:string;version:number},value?:Content,signal?:AbortSignal){
  if(value&&value.kind!=='theorem'&&(value.review!==undefined||value.proof!==undefined||value.dependencies!==undefined))throw new MapError('INVALID_INPUT','Only a project theorem accepts proof, review or dependencies.');
  if(input.scope==='project-map'){
   if(value?.description!==undefined)throw new MapError('INVALID_INPUT','Use summary for project-map nodes.');
   if(value&&value.kind!=='concept'&&value.kind!=='theorem')throw new MapError('INVALID_INPUT','Choose a concept or theorem for the project map.');
   const receipt=await library.knowledgeMap.maintainNode(projectId!,callId,input.revision,{target:ref,content:value?{...value,kind:value.kind as 'concept'|'theorem'}:undefined},signal,checkpoints.get(input.revision));
   rememberCurrent();return receipt;
  }
  if(value?.nodeType!==undefined||value?.relations!==undefined)throw new MapError('INVALID_INPUT','Typed node relationships belong to project-map entries.');
  if(value?.summary!==undefined||value?.aliases!==undefined)throw new MapError('INVALID_INPUT','Use description for shared resources. Aliases belong to map nodes.');
  if(value&&(value.kind==='concept'||value.kind==='theorem'))throw new MapError('INVALID_INPUT','Choose a Skill or Strategy for the shared library.');
  const receipt=await library.maintainResource(callId,input.revision,{target:ref,content:value?{...value,kind:value.kind as 'method-skill'|'failure-skill'|'specific-strategy'}:undefined},checkpoints.get(input.revision));
  rememberCurrent();return receipt;
 }
 const writeSummary=(action:string)=>(receipt:Awaited<ReturnType<typeof write>>,input:{title?:string;scope:string})=>{
  const ref='ref' in receipt?receipt.ref:receipt;
  const title=input.title?'“'+input.title+'”':ref?.id??'node';
  return `${action} ${title}${ref?' (v'+ref.version+')':''} in the ${receipt.scope==='project-map'?'project map':'shared library'}. Status: ${receipt.status.replaceAll('_',' ')}. Revision ${receipt.revision}.`;
 };
 return [
  scopedTool('list_nodes','List up to 40 current nodes, including retired records. Project map is local to this project. Shared library edits affect all projects. Use the returned revision for any read or write.',list,async input=>{
   let current:number,items:{id:string;version:number;title:string;kind:string;status:string;summary?:string;description?:string;aliases?:string[]}[];
   if(input.scope==='project-map'){
    const map=await snapshot();current=map.revision;
    const latest=new Map<string,(typeof map.entries)[number]>();
    for(const entry of map.entries)if((latest.get(entry.ref.id)?.ref.version??0)<entry.ref.version)latest.set(entry.ref.id,entry);
    items=[...latest.values()].map(e=>({id:e.ref.id,version:e.ref.version,title:e.title,summary:e.summary,nodeType:e.nodeType??(e.definition?'definition':e.kind),domain:e.domain,aliases:e.aliases,kind:e.kind,status:e.qualification,...(e.importedEvidence?{importReview:{mode:e.importedEvidence.mode,status:e.importedEvidence.reviewStatus}}:{})}));
   }else{
    const state=library.snapshot();current=state.generation;rememberCurrent();
    const available=new Set(library.inspectUserResources().available.map(r=>r.id));
    items=Object.values(state.resources).filter(r=>r.maintenance||available.has(r.id)).map(r=>({id:r.id,version:r.version,title:r.title??r.name,description:r.description,kind:r.kind,status:r.maintenance?.retired?'retired':r.status,enabled:r.enabled}));
   }
   const query=(input.query??'').toLowerCase(),offset=input.offset??0;
   const matches=items.filter(e=>[e.id,e.kind,e.title,e.summary??'',e.description??'',...e.aliases??[]].some(v=>v.toLowerCase().includes(query))).sort((a,b)=>a.id.localeCompare(b.id));
   return {scope:input.scope,revision:current,total:matches.length,nodes:matches.slice(offset,offset+40),nextOffset:offset+40<matches.length?offset+40:null};
  },(r,input)=>`Found ${r.total} matching node${r.total===1?'':'s'}${input.query?' for “'+input.query+'”':''} in the ${r.scope==='project-map'?'project map':'shared library'}. Showing ${r.nodes.length} at revision ${r.revision}.`),
  scopedTool('read_node','Read an exact project map node or shared Skill/Strategy. Use offset for long bodies. For an attached proof, read its supportId.',read,async input=>{
   let body:string,metadata:{title:string;status:string;[key:string]:unknown};
   if(input.scope==='project-map'){
    const map=await snapshot();
    if(input.revision!==map.revision)throw new MapError('CONFLICT','Map changed. List the nodes again.');
    const node=map.entries.find(e=>e.ref.id===input.id&&e.ref.version===input.version);
    if(!node)throw new MapError('NOT_FOUND','Node unavailable in this project.');
    const imported=input.supportId==='import'?node.importedEvidence:undefined;
    const supplied=input.supportId==='supplied'?node.suppliedProof:undefined;
    const support=input.supportId===undefined?undefined:node.supports.find(s=>s.id===input.supportId);
    if(input.supportId!==undefined&&!support&&!supplied&&!imported)throw new MapError('NOT_FOUND','Proof support unavailable for this exact node.');
    body=imported?.argument??supplied?.argument??support?.argument??node.body??await library.knowledgeMap.maintenanceTheoryBody(projectId!,node.ref,input.revision);
    if(imported){
     const key=JSON.stringify([input.revision,input.id,input.version]),offset=input.offset??0;
     const previous=evidenceOffsets.get(key)??0;
     if(offset<=previous)evidenceOffsets.set(key,Math.max(previous,Math.min(body.length,offset+16000)));
    }
    metadata={...(node.importedEvidence?{importReview:{mode:node.importedEvidence.mode,status:node.importedEvidence.reviewStatus,evidenceId:'import',source:node.importedEvidence.source,supportId:node.importedEvidence.supportId}}:{}),title:node.title,summary:node.summary,kind:node.kind,nodeType:node.nodeType??(node.definition?'definition':node.kind),relations:map.relations.filter(r=>sameMapRef(r.from,node.ref)||sameMapRef(r.to,node.ref)),status:node.qualification,accepted:node.accepted,assumptions:node.assumptions,...(node.supports.length?{supports:node.supports.map(s=>({supportId:s.id,status:s.status,conditions:s.assumptions}))}:{}),...(support?{prerequisites:support.prerequisites,review:support.review}:{}),aliases:node.aliases,domain:node.domain,createdFrom:node.createdFrom,maintenance:node.maintenanceDraft,...(node.observation?{observation:node.observation}:{}),...(node.suppliedProof?{suppliedProof:{supportId:'supplied',source:node.suppliedProof.source,status:'unreviewed'}}:{}),bodyType:imported?'import-evidence':supplied?'supplied-proof':support?'proof':'body'};
   }else{
    if(input.supportId!==undefined)throw new MapError('INVALID_INPUT','Proof supports belong to project-map nodes.');
    const node=await library.readMaintenanceResource({id:input.id,version:input.version},input.revision);
    const state=library.snapshot(),meta=state.resources[input.id]!;
    if(state.generation!==input.revision)throw new MapError('CONFLICT','Library changed. List the nodes again.');
    rememberCurrent();body=node.body;metadata={title:meta.title??meta.name,description:meta.description,kind:meta.kind,status:meta.maintenance?.retired?'retired':meta.status,enabled:meta.enabled,assumptions:meta.conditions,tags:meta.tags,semanticKey:meta.semanticKey,sources:meta.sourceRefs,maintenance:meta.maintenance};
   }
   const offset=input.offset??0;
   return {scope:input.scope,id:input.id,version:input.version,revision:input.revision,...metadata,body:body.slice(offset,offset+16000),nextOffset:offset+16000<body.length?offset+16000:null};
  },(r,input)=>`Read ${input.supportId?'proof support for ':''}“${r.title}” (v${r.version}, ${r.status}).${r.nextOffset!==null?' More text is available.':''}`),
  ...(projectId===undefined?[]:[scopedTool('review_import','Review one requested imported item after reading its complete evidence with read_node supportId="import". A proof review checks the decisive deductions under the stated assumptions. A transcription review checks the recorded measurement fields against the supplied excerpt and locator. Use inconclusive when the supplied evidence is insufficient. List exact project premises used for a proof.',reviewImport,async(input,_callId,signal)=>{
   const map=await snapshot(),entry=map.entries.find(e=>e.ref.id===input.id&&e.ref.version===input.version);
   if(!entry?.importedEvidence)throw new MapError('NOT_FOUND','Imported evidence unavailable.');
   const key=JSON.stringify([input.revision,input.id,input.version]);
   if(entry.importedEvidence.reviewStatus==='unreviewed'&&(evidenceOffsets.get(key)??0)<entry.importedEvidence.argument.length)
    throw new MapError('INVALID_INPUT','Read the entire exact import evidence using supportId="import" before submitting a review.');
   return library.knowledgeMap.reviewImport(projectId,input,input.revision,input.mode,input.verdict,input.reason,input.dependencies,signal);
  },r=>`Imported evidence review: ${r.status} at revision ${r.revision}.`)]),
  scopedTool('create_node','Create one project node or shared resource. Project theorems require an attached proof and your inline review before publication. Concepts start as drafts. Shared Skills/Strategies start disabled and require scientific review. Include subject or method tags so source-matched learning jobs can find them.'+authoring,create,(input,callId,signal)=>write(input,callId,undefined,pickContent(input),signal),writeSummary('Created')),
  scopedTool('edit_node','Replace one exact editable node. For metadata-only theorem edits keep the same body and assumptions and omit proof, review and dependencies to reuse current support. For a scientific change include the full proof, exact premises and your inline review. Provide the full replacement content and preserve kind. Supply a fresh summary or description when revising the body or assumptions. Map measurements, theory projections and accepted foundations use dedicated controls. Shared resource revisions become disabled pending review.'+authoring,edit,(input,callId,signal)=>write(input,callId,{id:input.id,version:input.version},pickContent(input),signal),writeSummary('Updated')),
  scopedTool('delete_node','Retire one exact node and preserve its history. Shared library retirement applies across projects. Canonical theory projections, measurements and accepted foundations use dedicated controls.',retire,(input,callId)=>write(input,callId,{id:input.id,version:input.version}),writeSummary('Retired')),
 ];
}

function pickContent({kind,title,body,assumptions,tags,summary,description,aliases,nodeType,relations,proof,review,dependencies}:Content):Content {return {kind,title,body,assumptions,tags,summary,description,aliases,nodeType,relations,proof,review,dependencies};}
