import type {MapOpenResult,MapSelection,MapReadCall,MapView} from './knowledge-map.js';
import {mapBasisChoices} from './knowledge-map-support.js';

export const MAP_PRESENTATION='layered-map-v1' as const;
export type MapDetail='proof';
const preview=(text:string)=>text.length>280?text.slice(0,280)+'…':text;

/** Presentation is deliberately separate from full host evidence and immutable body hashes. */
export function mapOpenPresentation(read:MapOpenResult,detail?:MapDetail){
 const nodeType=read.nodeType??(read.qualification==='definition'?'definition':read.kind);
 const choices=mapBasisChoices(read).map(({selection,basis})=>({selection,conditions:basis.assumptions,argument:basis.steps[0]?.via}));
 const citations=read.bases?.length?{citations:choices,citationInstruction:choices.some(c=>c.selection!==read.selection)?'Cite the selection for the argument whose conditions you establish.':'Cite the statement selection after showing its conditions hold.'}:{};
 if(read.kind==='observation')return {
  ...structuredClone(read),nodeType,level:detail==='proof'?'proof' as const:'statement' as const,statementAvailable:true,
  statement:read.body,notice:read.qualification==='observed'?'Cite this exact observation for empirical comparison after checking its source, measurement conditions and uncertainty.':'This measurement has no current independent transcription review qualifying it for empirical comparison.'
 };
 if(detail==='proof')return {...structuredClone(read),nodeType,...citations,level:'proof' as const,...(read.empiricalSource?{notice:'Open and cite the reviewed observation entry for an empirical comparison.'}:{})};
 const statementAvailable=read.kind!=='source-evidence'&&read.kind!=='theory';
 return {level:'statement' as const,selection:read.selection,ref:read.ref,kind:read.kind,nodeType,title:read.title,domain:read.domain,
  qualification:read.qualification,accepted:read.accepted,theoryQualification:read.theoryQualification,
  statementAvailable,...(statementAvailable?{statement:read.body}:{}),assumptions:read.assumptions,
  ...(read.suppliedProof?{suppliedProofAvailable:true}:{}),...citations,supports:read.supports.map(s=>({id:s.id,status:s.status,assumptions:s.assumptions,prerequisites:read.bases?s.prerequisites.map(p=>({ref:p.ref,role:p.role})):s.prerequisites})),
  notice:statementAvailable?'Apply only after checking all conditions. Proof arguments are available with detail="proof".':
   'No separate statement is stored for this source or theory. This card does not establish a claim. Request detail="proof" only if its full source is needed.'};
}

export function mapSelectionPresentation(selection:MapSelection){
 if(selection.mode==='directory')return {...selection,level:'directory' as const};
 return {...selection,level:'index' as const,entries:selection.entries.map(e=>({selection:e.selection,ref:e.ref,kind:e.kind,nodeType:e.nodeType??(e.qualification==='definition'?'definition':e.kind),
  title:preview(e.title),...(e.summary?{summary:e.summary}:{statementPreview:e.statementPreview}),statementComplete:false,aliases:e.aliases.map(preview),domain:e.domain,qualification:e.qualification,accepted:e.accepted,
  reason:e.reason,...(e.paths?{paths:e.paths}:{}),conditionsPreview:e.assumptions.map(preview),conditionsComplete:false})),
  notice:selection.notice+' Index cards are discovery leads. Open the complete statement and conditions before use.'};
}

export function mapRecordPresentation(record:{call:MapReadCall;result:unknown;view?:MapView}){
 const result=record.result;
 return {call:record.call,result:record.call.action==='open'?mapOpenPresentation(result as MapOpenResult,record.call.detail):
  record.call.action==='lookup'?mapSelectionPresentation(result as MapSelection):result};
}

interface Context {presentation?:typeof MAP_PRESENTATION;profile?:unknown;revision?:string;selection?:MapSelection;opened:MapOpenResult[];proofSelections?:string[];readResults?:unknown[]}
export function mapContextPresentation(context:Context){
 if(context.presentation!==MAP_PRESENTATION)return context;
 // Previous explicit proofs remain in their native result; context refresh never repeats them.
 return {presentation:context.presentation,profile:context.profile,revision:context.revision,
  selection:context.selection?mapSelectionPresentation(context.selection):undefined,
  opened:context.opened.map(read=>mapOpenPresentation(read)),readResults:context.readResults};
}

/** Theory associations are navigation, not an implicit request to read a derivation. */
export function routeSelectionPresentation<T extends {bindings?:unknown[];links?:unknown[];nodes?:unknown[]}>(selection:T):T{
 return {...selection,nodes:selection.nodes?.map(row=>{const r=row as {node:Record<string,unknown>};return {...r,node:{...r.node,title:preview(String(r.node.title??'')),summary:r.node.kind==='theory'?'Open the theory through an explicit knowledge read.':preview(String(r.node.summary??''))}};}),bindings:selection.bindings?.map(b=>{const {argument:_argument,...metadata}=b as Record<string,unknown>;return metadata;}),
  links:selection.links?.map(l=>{const {basis:_basis,...metadata}=l as Record<string,unknown>;return metadata;})} as T;
}
