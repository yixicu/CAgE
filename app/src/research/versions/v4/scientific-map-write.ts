import {Type, type Static,type TSchema} from 'typebox';
import {Value} from 'typebox/value';
import type {ResearchLibrary} from '../../../learning/research-library.js';
import {MapError, type MapOpenResult, type MapSource} from '../../../learning/knowledge-map.js';
import type {MapDraftInput, MapPlacement} from './map-maintenance.js';
import {mapBasisChoices} from '../../../learning/knowledge-map-support.js';
import {DeclarationSupplementError,type MetadataField} from '../../../runtime/declaration-supplement.js';

import {authoredRelationKinds,mapNodeTypeSchema,MAP_NODE_WRITING} from '../../../learning/map-node-fields.js';

const text=Type.String({minLength:1});
const strings=Type.Array(text);
const exact={additionalProperties:false} as const;
export const scientificPlacementSchema=Type.Union([
 Type.Object({kind:Type.Literal('nearby'),anchor:text,reason:text},exact),
 Type.Object({kind:Type.Literal('new-field'),field:text,reason:text,premise:Type.Optional(text)},exact),
]);
const legacyEntry=Type.Object({
 kind:Type.Union([Type.Literal('concept'),Type.Literal('theorem')]),title:text,
 body:Type.String({minLength:1,description:'Exact mathematical statement or definition, including formulas.'}),
 status:Type.Union([Type.Literal('definition'),Type.Literal('proved'),Type.Literal('pending')]),
 assumptions:strings,summary:Type.Optional(text),aliases:Type.Optional(strings),domain:Type.Optional(strings),
 existing:Type.Optional(Type.String({minLength:1,description:'Opened current local node to amend.'})),
 placement:scientificPlacementSchema,
 supportAssumptions:Type.Optional(strings),
 prerequisites:Type.Optional(Type.Array(Type.Object({selection:text,role:Type.Union([Type.Literal('established'),Type.Literal('assumption')]),
  discharges:Type.Optional(Type.Array(Type.Object({condition:text,argument:text},exact)))},exact))),
 memberships:Type.Optional(strings),
 relations:Type.Optional(Type.Array(Type.Object({target:text,kind:Type.Union([Type.Literal('related'),Type.Literal('specializes')]),basis:text,direction:Type.Union([Type.Literal('forward'),Type.Literal('symmetric')])},exact))),
 proofSection:Type.Optional(Type.Object({from:text,through:text},{...exact,description:'Optional unique opening and closing text of the proof in this public report. Omit to use the complete report.'})),
},exact);
const entry=Type.Object({...legacyEntry.properties,nodeType:Type.Optional(mapNodeTypeSchema),
 relations:Type.Optional(Type.Array(Type.Object({target:text,kind:Type.Union(authoredRelationKinds.map(kind=>Type.Literal(kind))),basis:text,direction:Type.Union([Type.Literal('forward'),Type.Literal('symmetric')])},exact))),
},exact);
const description='Optional changes justified in this public answer. Create or amend precise statements under an opened nearby anchor, or name a new field for user consent. Withdraw an opened locally owned statement by its exact handle and reason. The host attaches the public proof.';
const changesSchema=<T extends TSchema>(entrySchema:T,description:string)=>Type.Union([
 Type.Object({entries:Type.Array(entrySchema,{minItems:1})},exact),
 Type.Object({withdraw:text,reason:text},exact),
],{description});
export const legacyScientificMapChangesSchema=changesSchema(legacyEntry,description);
const structuredDescription=description+' Give the proof once in the public report. Use proofSection to attach its exact excerpt. '+MAP_NODE_WRITING;
export const scientificMapChangesSchema=changesSchema(entry,structuredDescription);
export type ScientificMapChanges=Static<typeof scientificMapChangesSchema>;

export const theoremAuthoringSchema=changesSchema(entry,structuredDescription+
 ' For every new theorem, supply a standalone summary distinct from its title and statement, its nodeType, domain, assumptions, supportAssumptions, prerequisites and relations. Name only the definitions, assumptions and established results actually used by this particular derivation. For each external proof premise cite its opened handle in outcome.knowledgeRefs and select its applicable proof basis. Use candidate_N for a premise stated separately in this submission. Mark established and assumed premises in prerequisites, and identify definitions with uses-definition links. State local hypotheses in assumptions and any additional proof conditions in supportAssumptions. Use empty arrays when none apply. Placement alone does not declare a proof premise.');

export function theoremAuthoringIssues(changes:ScientificMapChanges,opened:MapOpenResult[],citations:string[]):MetadataField[]{
 const issues:MetadataField[]=[];
 if(!('entries' in changes))return issues;
 changes.entries.forEach((item,i)=>{
  if(item.kind!=='theorem'||item.existing)return;
  const prefix=['mapChanges','entries',String(i)];
  function issue(key:string,schema:TSchema,reason:string){
   const path=[...prefix,key];
   issues.push({path,schema,message:'/'+path.join('/')+' '+reason});
  }
  const summary=item.summary?.trim();
  if(!summary||[item.title.trim(),item.body.trim()].includes(summary))
   issue('summary',text,'requires an independently written summary of the claim and its conditions.');
  if(item.nodeType!=='theorem'&&item.nodeType!=='basic-knowledge')
   issue('nodeType',Type.Union([Type.Literal('theorem'),Type.Literal('basic-knowledge')]),'requires the scientific type of this theorem.');
  if(!item.domain?.length||item.domain.some(tag=>!tag.trim()))
   issue('domain',Type.Array(text,{minItems:1}),'requires the applicable scientific domain tags.');
  for(const key of ['prerequisites','supportAssumptions','relations'] as const)if(!item[key])
   issue(key,entry.properties[key],'must be explicitly authored from the saved proof. Supply an empty array if none apply.');
  function checkPremise(selection:string,path:string[]){
   if(/^candidate_[1-9][0-9]*$/.test(selection)){
    if(Number(selection.slice(10))===i+1)issues.push({path,message:'/'+path.join('/')+' cannot cite this theorem itself as a premise.'});
    return;
   }
   const read=findMapWriteRead(opened,selection);
   if(!read)return; // mapMetadataIssues reports the precise unopened field.
   const cited=citations.some(c=>c===selection
    ||selection===read.selection&&mapBasisChoices(read).some(b=>b.selection===c)
    ||selection===read.selection&&c===read.ref?.id&&opened.filter(r=>r.ref?.id===c).length===1);
   if(!cited)issues.push({path,message:'/'+path.join('/')+' must select a premise cited in outcome.knowledgeRefs or a different same-submission candidate. Cited handles: '+citations.join(', ')});
  }
  item.prerequisites?.forEach((p,j)=>checkPremise(p.selection,[...prefix,'prerequisites',String(j),'selection']));
  item.relations?.forEach((r,j)=>{
   if(r.kind==='uses-definition'||r.kind==='prerequisite')checkPremise(r.target,[...prefix,'relations',String(j),'target']);
  });
 });
 return issues;
}

const labels:Record<string,readonly string[]>={
 kind:['concept','theorem','nearby','new-field',...authoredRelationKinds],
 status:['definition','proved','pending'],role:['established','assumption'],direction:['forward','symmetric'],
};

/** Recover only unambiguous label spellings when the repaired structure checks exactly. */
export function scientificMapFormatIssue(input:unknown):DeclarationSupplementError|undefined {
 if(!input||typeof input!=='object'||Value.Check(scientificMapChangesSchema,input))return;
 const fields:MetadataField[]=[],candidate=structuredClone(input);
 function visit(value:unknown,path:string[]){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
   const at=[...path,key],matched=typeof child==='string'&&Object.hasOwn(labels,key)?labels[key]?.find(c=>c===child.trim().toLowerCase()):undefined;
   if(matched&&matched!==child){
    (value as Record<string,unknown>)[key]=matched;
    fields.push({path:at,expected:matched,message:'/'+at.join('/')+' uses '+JSON.stringify(child)+'. Supply the canonical label '+JSON.stringify(matched)+'.'});
   }else if(typeof child==='object')visit(child,at);
  }
 }
 visit(candidate,['mapChanges']);
 if(fields.length&&Value.Check(scientificMapChangesSchema,candidate))return new DeclarationSupplementError(fields.map(f=>f.message),'map-metadata',fields);
}

function targets(changes:ScientificMapChanges){
 const refs:{selection:string;path:string[];sameBatch?:boolean}[]=[];
 const add=(selection:string,path:string[],sameBatch=false)=>refs.push({selection,path,sameBatch});
 if('withdraw' in changes)add(changes.withdraw,['withdraw']);
 else changes.entries.forEach((e,i)=>{
  const prefix=['entries',String(i)];
  if(e.existing)add(e.existing,[...prefix,'existing']);
  if(e.placement.kind==='nearby')add(e.placement.anchor,[...prefix,'placement','anchor']);
  e.prerequisites?.forEach((p,j)=>add(p.selection,[...prefix,'prerequisites',String(j),'selection'],true));
  e.memberships?.forEach((ref,j)=>add(ref,[...prefix,'memberships',String(j)],true));
  e.relations?.forEach((r,j)=>add(r.target,[...prefix,'relations',String(j),'target'],true));
 });
 return refs.filter(r=>!(r.sameBatch&&'entries' in changes&&/^candidate_[1-9][0-9]*$/.test(r.selection)&&Number(r.selection.slice(10))<=changes.entries.length));
}

export function mapWriteSelections(changes:ScientificMapChanges){return [...new Set(targets(changes).map(t=>t.selection))];}

export function findMapWriteRead(opened:MapOpenResult[],selection:string){
 return opened.find(r=>r.ref&&(r.selection===selection||mapBasisChoices(r).some(b=>b.selection===selection)));
}

export function mapMetadataIssues(changes:ScientificMapChanges,opened:MapOpenResult[],body?:string):MetadataField[]{
 const issues:MetadataField[]=[];
 for(const t of targets(changes))if(!findMapWriteRead(opened,t.selection)){
  const path=['mapChanges',...t.path];
  issues.push({path,message:'/'+path.join('/')+' is not an opened selection: '+t.selection+'. Copy the original intended handle from the opened records or use candidate_N for a linked entry in this submission. Opened: '+opened.map(r=>r.selection+' '+(r.title??'')).join(', ')});
 }
 if(body!==undefined&&'entries' in changes)changes.entries.forEach((entry,i)=>{
  if(!entry.proofSection)return;
  const {from,through}=entry.proofSection,first=body.indexOf(from),last=body.indexOf(through);
  for(const key of ['from','through'] as const){
   const value=entry.proofSection[key],position=body.indexOf(value);
   if(position>=0&&position===body.lastIndexOf(value)&&(key==='from'||first<0||last>=first+from.length))continue;
   const path=['mapChanges','entries',String(i),'proofSection',key];
   issues.push({path,message:'/'+path.join('/')+' must identify a unique '+(key==='from'?'opening':'closing')+' quotation in the saved public proof, in source order. Submitted: '+value});
  }
 });
 return issues;
}

function proofArgument(body:string,section?:{from:string;through:string}){
 if(!section)return body;
 const start=body.indexOf(section.from);
 const end=body.indexOf(section.through,start+section.from.length);
 if(start<0||end<0||body.lastIndexOf(section.from)!==start||body.lastIndexOf(section.through)!==end)
  throw new MapError('INVALID_INPUT','Proof section requires unique opening and closing text in source order.');
 return body.slice(start,end+section.through.length);
}

/** Called after the owning report/research response is durably public. */
export async function registerScientificSource(library:ResearchLibrary,source:MapSource,changes:ScientificMapChanges|undefined,opened:MapOpenResult[],observations?:true){
 const {ownerId,projectId}=source.ref;
 if(!changes){await library.knowledgeMap.catalog([source],ownerId,projectId);return;}
 const reads=mapWriteSelections(changes).map(selection=>{
  const read=findMapWriteRead(opened,selection);
  if(!read)throw new MapError('FORBIDDEN','A scientific map change requires its exact opened map target: '+selection);
  return read;
 });
 if('withdraw' in changes){
  await library.knowledgeMap.withdrawScientificNode(source,reads[0]!.ref!,changes.reason);
  return;
 }
 const entries:(MapDraftInput & {placement:MapPlacement})[]=changes.entries.map(({proofSection,...entry})=>({
  ...entry,...(entry.status==='proved'||proofSection?{argument:proofArgument(source.body,proofSection)}:{}),
 }));
 await library.knowledgeMap.admit([source],ownerId,projectId,true,observations,true,{entries,opened:reads});
}
