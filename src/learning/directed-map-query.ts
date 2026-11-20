import {catalogTermsV3} from './hierarchical-catalog-v3.js';
import {stableHash} from './research-hash.js';
import {directedMapQualification} from './knowledge-map-support.js';
import {MAP_RECIPE, MapReadError, mapEvidenceHandle, mapHandle, mapRefKey, mapSourceKey,
 type KnowledgeMapState, type MapCandidate, type MapEntry, type MapNavigationPath, type MapQuery,
 type MapRef, type MapSelection, type MapSourceRef, type MapView} from './knowledge-map.js';

const name=(text:string)=>text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const branchHandle=(domain:string|null)=>'branch_'+stableHash(domain);
const pathKey=(p:MapNavigationPath)=>JSON.stringify([p.kind,p.direction,p.from,p.to,p.support,p.role,p.basis]);

export function directedMapQuery(state:KnowledgeMapState,view:MapView,query:MapQuery,authorized:Set<string>,sourceAllowed:(ref:MapSourceRef)=>boolean,entryAllowed:(ref:MapRef)=>boolean):MapSelection {
 const mode=query.mode??'exact',offset=query.offset??0,limit=query.limit??24;
 const textMode=['exact','lexical','source'].includes(mode),selected=mode==='branch'||mode==='relations';
 if(!['exact','lexical','source','directory','branch','relations'].includes(mode)
    ||(textMode?!query.query?.trim():query.query!==undefined)
    ||(selected?!query.selection?.trim():query.selection!==undefined)
    ||mode!=='relations'&&(query.relation!==undefined||query.direction!==undefined)||query.domain!==undefined)
  throw new MapReadError('INVALID_INPUT','Choose a directory, branch, relation, exact name, lexical search or source search and supply only its fields');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>256)
  throw new MapReadError('INVALID_INPUT','Map pagination');
 const entries=state.entries.filter(e=>authorized.has(mapRefKey(e.ref)));
 const sourceKeys=new Set(view.sourceRefs.filter(sourceAllowed).map(mapSourceKey));
 const coverageRows=state.conversions.filter(c=>sourceKeys.has(c.sourceKey));
 const result:MapSelection={mode,recipe:MAP_RECIPE,revision:view.revision,outcome:'miss',entries:[],evidence:[],total:0,truncated:false,
  coverage:{available:coverageRows.length,converted:coverageRows.filter(c=>c.state==='converted').length,pending:coverageRows.filter(c=>c.state!=='converted').length},
  notice:'Scoped to this authorized view. Open a statement and check its conditions before use.'};
 function page<T>(items:T[]):T[]{
  result.total=items.length;
  if(offset+limit<items.length)result.nextOffset=offset+limit;
  result.truncated=offset>0||result.nextOffset!==undefined;
  result.outcome=result.truncated?'incomplete':items.length?'candidates':'miss';
  return items.slice(offset,offset+limit);
 }
 const matches:{entry:MapEntry;reason:MapCandidate['reason'];score:number;paths?:MapNavigationPath[]}[]=[];
 const qualifications=new Map<MapEntry,ReturnType<typeof directedMapQualification>>();
 function qualify(entry:MapEntry){
  const found=qualifications.get(entry);if(found)return found;
  const status=directedMapQualification(state,entry,view.profile,sourceAllowed,entryAllowed);
  qualifications.set(entry,status);return status;
 }
 if(mode==='directory'||mode==='branch'){
  const groups=new Map<string,{selection:string;title:string;members:MapEntry[]}>();
  for(const entry of entries){
   const labels=new Map<string|null,string>();
   const branches=entry.observation?[...entry.domain,entry.observation.system,entry.observation.observable]:entry.domain;
   for(const label of branches)if(name(label))labels.set(name(label),label.trim());
   if(!labels.size)labels.set(null,'Entries without a domain');
   for(const [key,title] of labels){
    const selection=branchHandle(key),group=groups.get(selection)??{selection,title,members:[]};
    if(compare(title,group.title)<0)group.title=title;
    group.members.push(entry);groups.set(selection,group);
   }
  }
  if(mode==='directory'){
   const sorted=[...groups.values()].sort((a,b)=>compare(name(a.title),name(b.title))||compare(a.selection,b.selection));
   result.directory=page(sorted).map(g=>({selection:g.selection,title:g.title,count:g.members.length}));
   result.notice='Choose a directory branch to browse its members, request an exact name or alias, or choose an explicit search.';
   return result;
  }
  const group=groups.get(query.selection!);
  if(!group)throw new MapReadError('FORBIDDEN','Map branch outside the current authorized view');
  for(const entry of group.members)matches.push({entry,reason:'branch',score:0});
 }else if(mode==='relations'){
  const byRef=new Map(entries.map(e=>[mapRefKey(e.ref),e])),anchor=entries.find(e=>mapHandle(e.ref)===query.selection);
  if(!anchor)throw new MapReadError('FORBIDDEN','Relation anchor outside the current authorized view');
  const paths=new Map<MapEntry,MapNavigationPath[]>();
  const add=(from:MapEntry|undefined,to:MapEntry|undefined,kind:MapNavigationPath['kind'],basis:string,symmetric:boolean,proof?:Pick<MapNavigationPath,'support'|'role'|'conditions'>)=>{
   if(!from||!to||(from!==anchor&&to!==anchor)||query.relation&&query.relation!==kind)return;
   const direction=symmetric?'symmetric':from===anchor?'outgoing':'incoming';
   if(query.direction&&query.direction!==direction)return;
   const target=from===anchor?to:from,list=paths.get(target)??[];
   list.push({kind,direction,basis,from:mapHandle(from.ref),to:mapHandle(to.ref),...proof});paths.set(target,list);
  };
  for(const edge of state.relations){
   const from=byRef.get(mapRefKey(edge.from)),to=byRef.get(mapRefKey(edge.to));
   if(edge.status!=='active'||!from||!to||(from!==anchor&&to!==anchor))continue;
   // Historical edges have no source list. Use their bound review or originating record conservatively.
   const sources=edge.sources??state.supports.find(s=>s.review?.id===edge.reviewId&&mapRefKey(s.statement)===mapRefKey(edge.from))?.sources??from.createdFrom;
   const localDraftLink=from.maintenanceDraft?.projectId===view.grant.projectId&&edge.reviewId===from.maintenanceDraft.callId;
   if((sources.length?sources.every(sourceAllowed):localDraftLink))add(from,to,edge.kind,edge.basis,edge.direction==='symmetric');
  }
  for(const support of state.supports){
   if(support.status!=='proved'||!support.review||!support.sources.every(sourceAllowed))continue;
   const statement=byRef.get(mapRefKey(support.statement));
   if(!statement||statement!==anchor&&!support.prerequisites.some(p=>byRef.get(mapRefKey(p.ref))===anchor))continue;
   const basis=qualify(statement).bases.find(b=>b.steps[0]?.via===support.id);if(!basis)continue;
   for(const p of support.prerequisites)add(statement,byRef.get(mapRefKey(p.ref)),'prerequisite',
    p.role==='assumption'?'Recorded as an assumption of this reviewed argument.':'Recorded as an established prerequisite of this reviewed argument.',false,{support:support.id,role:p.role,conditions:basis.assumptions});
  }
  for(const [entry,list] of paths)matches.push({entry,reason:'relation',score:0,paths:list.sort((a,b)=>compare(pathKey(a),pathKey(b)))});
 }else if(mode==='source'){
  const terms=new Set(catalogTermsV3(query.query!));
  const sources=state.sources.filter(s=>s.ref.kind!=='maintenance-proof'&&sourceKeys.has(mapSourceKey(s.ref))&&s.status==='active'&&catalogTermsV3(s.body).some(t=>terms.has(t)))
   .sort((a,b)=>compare(mapSourceKey(a.ref),mapSourceKey(b.ref)));
  result.evidence=page(sources).map(s=>({selection:mapEvidenceHandle(s.ref),source:structuredClone(s.ref),conversion:coverageRows.find(c=>c.sourceKey===mapSourceKey(s.ref))?.state??'available'}));
  if(!result.truncated&&result.evidence.length)result.outcome='partial';
  result.notice='Source text matches are evidence leads. A matching source does not establish a claim.';
  return result;
 }else if(mode==='exact'){
  const wanted=name(query.query!);
  for(const entry of entries){
   if(name(entry.title)===wanted)matches.push({entry,reason:'exact',score:1});
   else if(entry.aliases.some(alias=>name(alias)===wanted))matches.push({entry,reason:'alias',score:1});
  }
 }else{
  const terms=new Set(catalogTermsV3(query.query!));
  for(const entry of entries){
   const searchable=[entry.title,...entry.aliases,...entry.domain,entry.summary??'',entry.body??'',...entry.assumptions,...(entry.observation?Object.values(entry.observation).flat():[])].join(' ');
   const score=catalogTermsV3(searchable).filter(t=>terms.has(t)).length;
   if(score)matches.push({entry,reason:'lexical',score});
  }
 }
 matches.sort((a,b)=>b.score-a.score||compare(a.paths?pathKey(a.paths[0]!):'',b.paths?pathKey(b.paths[0]!):'')
  ||compare(name(a.entry.title),name(b.entry.title))||compare(mapRefKey(a.entry.ref),mapRefKey(b.entry.ref)));
 result.entries=page(matches).map(({entry,reason,score,paths})=>{
  const {qualification,accepted}=qualify(entry);
  return {selection:mapHandle(entry.ref),ref:entry.ref,kind:entry.kind,...(entry.nodeType?{nodeType:entry.nodeType}:{}),title:entry.title,aliases:entry.aliases,domain:entry.domain,
   assumptions:entry.assumptions,qualification,accepted,reason,score,...(paths?{paths}:{}),
   ...(entry.summary?{summary:entry.summary}:entry.body?{statementPreview:entry.body.length>280?entry.body.slice(0,280)+'…':entry.body}:{})};
 });
 if(!result.truncated&&result.entries.length){
  if(result.entries.every(e=>['pending','disputed','withdrawn'].includes(e.qualification)))result.outcome='partial';
  else if(mode==='exact')result.outcome='exact';
 }
 return result;
}
