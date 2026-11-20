import {MAP_PRESENTATION,mapOpenPresentation,mapSelectionPresentation,type MapDetail} from '../learning/knowledge-map-presentation.js';
import {Type} from 'typebox';
import {defineTool,type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {mapReadFeedback,type MapQuery,type MapSelection,type MapOpenResult,type MapView} from '../learning/knowledge-map.js';
import {exact} from './strict-schema.js';

export interface MapRuntimePort {
 readonly modelDirectedKnowledge?:boolean;
 readonly refutationEvidence?:boolean;
 view?():Promise<MapView>;
 lookup(query:MapQuery):Promise<MapSelection>;
 open(selection:string,detail?:MapDetail):Promise<MapOpenResult>;
 refresh():Promise<{revision:string;profileVersion:number}>;
}

export type KnowledgeMapToolEvent = {
 type:'knowledge-map-tool-result';
 presentation?:typeof MAP_PRESENTATION;
 modelDirectedKnowledge?:true;
 view?:MapView;
 callId:string;
 tool:'lookup_map_knowledge'|'open_map_knowledge'|'refresh_knowledge_map';
 input:MapQuery|{selection:string;detail?:MapDetail}|Record<string,never>;
 result:MapSelection|MapOpenResult|{revision:string;profileVersion:number};
};

const lookup=Type.Object({
 query:Type.String({minLength:1}),
 domain:Type.Optional(Type.Array(Type.String({minLength:1}))),
 mode:Type.Optional(Type.Union([Type.Literal('exact'),Type.Literal('candidates')])),
 offset:Type.Optional(Type.Integer({minimum:0})),
},{additionalProperties:false});
const open=Type.Object({selection:Type.String({minLength:1}),detail:Type.Optional(Type.Literal('proof'))},{additionalProperties:false});
export const directedMapLookupDescription='Browse the authorized map. Use directory to list branches and branch to list their members. Use relations on a selected entry to inspect its direct links and their scientific basis. Use exact for names or aliases, lexical for entry text and source for public source text. Use offset for the next page.';
const routeLookupSchema=(observations:boolean)=>Type.Object({
 mode:Type.Optional(Type.Union([Type.Literal('directory'),Type.Literal('branch'),Type.Literal('relations'),Type.Literal('exact'),Type.Literal('lexical'),Type.Literal('source')])),
 query:Type.Optional(Type.String({minLength:1,description:'Text for exact (default), lexical or source search.'})),
 selection:Type.Optional(Type.String({minLength:1,description:'Branch handle for branch mode or entry handle for relations mode.'})),
 relation:Type.Optional(Type.Union([Type.Literal('member-of'),Type.Literal('specializes'),Type.Literal('related'),Type.Literal('prerequisite'),Type.Literal('uses-definition'),Type.Literal('upper-structure'),...(observations?[Type.Literal('tests'),Type.Literal('measures'),Type.Literal('measured-in')]:[])])),
 direction:Type.Optional(Type.Union([Type.Literal('incoming'),Type.Literal('outgoing'),Type.Literal('symmetric')])),
 offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:256})),
},{additionalProperties:false});
export const directedMapLookup=routeLookupSchema(false);
export const observationMapLookup=routeLookupSchema(true);
const legacyOpen=Type.Object({selection:Type.String({minLength:1})},{additionalProperties:false});
const refresh=Type.Object({},{additionalProperties:false});

/** Shared read-only native tools; the port owns grants, exact views and source checks. */
export class KnowledgeMapTools {
 constructor(private readonly port:MapRuntimePort,private readonly record?:(event:unknown)=>Promise<void>,private readonly presentation?:typeof MAP_PRESENTATION,private readonly directed=port.modelDirectedKnowledge===true){}

 private async result(event:KnowledgeMapToolEvent,signal?:AbortSignal){
  signal?.throwIfAborted();
  // Persist the exact result before returning it; a failed journal write is not a search miss.
  const saved=structuredClone({...event,...(this.presentation?{presentation:this.presentation}:{}),...(this.directed?{modelDirectedKnowledge:true,view:await this.port.view?.()}:{})});
  await this.record?.(saved);
  const exposed=this.presentation===MAP_PRESENTATION?(event.tool==='open_map_knowledge'?mapOpenPresentation(event.result as MapOpenResult,(event.input as {detail?:MapDetail}).detail):event.tool==='lookup_map_knowledge'?mapSelectionPresentation(event.result as MapSelection):event.result):event.result;
  return {content:[{type:'text' as const,text:JSON.stringify(exposed)}],details:{}};
 }
 private async unavailable(error:unknown,callId:string,tool:string,input:unknown,signal?:AbortSignal){
  const feedback=this.directed&&mapReadFeedback(error);
  if(!feedback)throw error;
  signal?.throwIfAborted();
  await this.record?.({type:'knowledge-map-read-feedback',callId,tool,input,feedback});
  return {content:[{type:'text' as const,text:JSON.stringify(feedback)}],details:{mapReadFeedback:true}};
 }

 tools():ToolDefinition[]{
  const lookupSchema=this.directed?(this.port.refutationEvidence?observationMapLookup:directedMapLookup):lookup;
  return [
   defineTool({
    name:'lookup_map_knowledge',label:'Look up map knowledge',executionMode:'sequential',
    description:this.directed?directedMapLookupDescription:'Find concepts, theorems and upstream theory claims in the authorized knowledge map. Start with exact names or aliases; use candidates after an inadequate match. Results retain conditions and proof status. This does not search Skill/Strategy routes.',
    parameters:lookupSchema,
    execute:async(callId,input,signal)=>{
     exact(lookupSchema,input);signal?.throwIfAborted();
     let result:MapSelection;
     try{result=await this.port.lookup(input);}catch(error){return this.unavailable(error,callId,'lookup_map_knowledge',input,signal);}
     return this.result({type:'knowledge-map-tool-result',callId,tool:'lookup_map_knowledge',input,result},signal);
    },
   }),
   defineTool({
    name:'open_map_knowledge',label:'Read map knowledge',executionMode:'sequential',
    description:this.presentation===MAP_PRESENTATION?'Open the complete statement, conditions and status without its proof. Use detail="proof" only to inspect an argument or full source when needed. Pending claims and source evidence are not established theorems.':'Open a returned map or source-evidence selection. Read its exact statement, assumptions, argument and qualification. A pending claim or historical case is not an established theorem.',
    parameters:this.presentation?open:legacyOpen,
    execute:async(callId,input,signal)=>{
     exact(this.presentation?open:legacyOpen,input);signal?.throwIfAborted();
     let result:MapOpenResult;
     try{result=await this.port.open(input.selection,(input as {detail?:MapDetail}).detail);}catch(error){return this.unavailable(error,callId,'open_map_knowledge',input,signal);}
     return this.result({type:'knowledge-map-tool-result',callId,tool:'open_map_knowledge',input,result},signal);
    },
   }),
   defineTool({
    name:'refresh_knowledge_map',label:'Refresh map view',executionMode:'sequential',
    description:'Refresh the authorized map and foundation view when newer knowledge is needed. Prior reads keep their exact provenance; this grants no new access.',
    parameters:refresh,
    execute:async(callId,input,signal)=>{
     exact(refresh,input);signal?.throwIfAborted();
     const result=await this.port.refresh();
     return this.result({type:'knowledge-map-tool-result',callId,tool:'refresh_knowledge_map',input:{},result},signal);
    },
   }),
  ];
 }
}
