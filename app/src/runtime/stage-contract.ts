import { stableHash } from '../learning/research-hash.js';
import { SessionPresentationSchema as presentation } from '../presentation/session-presentation.js';
import { Type, type TSchema } from 'typebox';
import { strictCodec, canonicalCodec, exact, HANDOFF_VERSION, LEGACY_HANDOFF_VERSION, handoffVersion, ContractValidationError, type HandoffVersion, type SchemaCodec } from './strict-schema.js';
import type { AnyAgentInvocation } from '../research/contracts/loop.js';
import type { ProofDocumentSession, ChapterPurpose } from './proof-documents.js';
import { outputSchema } from './output-contract.js';
import { workerScientificSchema, isWorkerInvocation } from './worker-handoff.js';
import { combinesFormulate, FORMULATE_DERIVE_SCHEMA } from './worker-formulate.js';
import { RuntimeError } from './errors.js';

type S = TSchema & {type?:string;properties?:Record<string,TSchema>;required?:string[];items?:TSchema;anyOf?:TSchema[];minItems?:number;maxItems?:number;description?:string};
export const SUBMIT_RESULT = 'submit_research_result';
export const ROUTE_PLAN = 'select_planning_routing';
const strings=(values:string[])=>Type.String({enum:[...new Set(values)]});
export interface ContractContext { contractVersion?: HandoffVersion; projectId?: string; invocation:AnyAgentInvocation | {task:'research_learn';input:{outputSchema:TSchema}}; literatureSources?:readonly {id:string}[]; documents?:ProofDocumentSession; routing?:unknown; resources?:{id:string;version:number}[]; proofs?:any[]; attempts?:{id:string;version:string}[] }

function chapterPurpose(path: string): ChapterPurpose {
  if (/^\/(ways|candidates)\/\*\/dependencyChapters\/\*$/.test(path)) return 'prerequisite';
  if (/^\/(ways|candidates)\/\*\/continuation\/chapters\/\*$/.test(path)) return 'continuation';
  if (path === '/researchReview/adoptedChapters/*') return 'adoption';
  if (path === '/researchReview/proof/chapters/*') return 'manuscript';
  if (path === '/researchReview/proof/evidenceChapters/*') return 'evidence';
  if (path === '/component/dependencies/*') return 'dependency';
  if (path === '/componentDelivery/corrections/*/previous') return 'correction';
  if (path.startsWith('/componentDelivery/')) return 'delivery';
  return 'read';
}

/** One typed registry drives routing menus, schema enums and local diagnostics. */
function routingChoices(context: ContractContext, kind: 'anchors' | 'domains'): {id:string;label:string}[] {
  const snapshot = (context.invocation.input as any).snapshot;
  const items = [...(snapshot?.policy?.[kind] ?? []), ...(snapshot?.strategy?.[kind] ?? []), ...((context.routing as any)?.[kind] ?? [])];
  return [...new Map(items.map((item:any) => [item.id, {id:item.id,label:kind === 'anchors' ? item.content : item.label}])).values()];
}

/** One projection defines the generated schema and the exact inverse host binding. */
export function projectContract(source:TSchema, context:ContractContext, version: HandoffVersion = context.contractVersion ?? HANDOFF_VERSION):SchemaCodec {
  handoffVersion(version);
  const input=context.invocation.input as any;
  const snapshot=input.snapshot;
  const boundary=snapshot?.researchBoundary??input.researchBoundary??input.boundary;
  const resources=[...(boundary?.skills??[]),...(boundary?.strategies??[]),...(context.resources??[])];
  const sources=context.invocation.task==='literature'
    ? context.literatureSources??[]
    : snapshot?.sources??input.brief?.frozenSourceRefs??input.sources??[];
  const taskIds=[...(input.attemptIndex??[]),...(input.tasks??[])].map((x:any)=>x.id);
  let unavailableManuscript=false;
  const boundFields=new Map<string,Record<string,unknown>>();
  const bindings=new Map<string,(v:any)=>unknown>();
  const proofMenus=new Map<string,Set<string>>();
  const proofOptional=new Map<string,boolean>();
  function walk(schema:TSchema,path:string):TSchema|undefined {
    const s=schema as S;
    if(s.anyOf){const variants=s.anyOf.map(x=>walk(x,path)).filter((x):x is TSchema=>!!x);return variants.length?Type.Union(variants):undefined;}
    if(s.type==='object' && s.properties){
      const chapter='chapterId' in s.properties && 'contentHash' in s.properties;
      const proof='caseId' in s.properties && 'revision' in s.properties;
      const resource='id' in s.properties && 'version' in s.properties && Object.keys(s.properties).length===2;
      if(chapter || proof || resource){
        const available:{handle:string;value:unknown}[]=chapter?(context.documents?.referenceChoices(chapterPurpose(path)) ?? []).filter(r=>r.handle.startsWith('C')):proof?[...(boundary?.proofs??[]),...(context.proofs??[])].map((r:any)=>({handle:r.ref.caseId+'@'+r.ref.revision,value:r.ref})):((s.properties.version as S)?.type==='string'?[...(input.attemptIndex??[]),...(input.inheritedContext?.attemptIndex??[]),...(context.attempts??[])]:resources).map((r:any)=>({handle:r.id+'@'+r.version,value:{id:r.id,version:r.version}}));
        if(chapter && (chapterPurpose(path)==='manuscript' || chapterPurpose(path)==='evidence'))proofMenus.set(path,new Set(available.map(r=>r.handle)));
        if(!available.length)return;
        const properties:Record<string,TSchema>={reference:strings(available.map(r=>r.handle))};
        if(s.properties.use)properties.use=s.properties.use;
        bindings.set(path,v=>{const ref=available.find(r=>r.handle===v.reference);if(!ref)throw new RuntimeError('INVALID_TOOL');const out=Object.fromEntries(Object.entries(structuredClone(ref.value as object)).filter(([k])=>k in s.properties!));return {...out,...(Object.hasOwn(v,'use')?{use:v.use}:{})};});
        return Type.Object(properties,{additionalProperties:false});
      }
      const properties:Record<string,TSchema>={},required:string[]=[];
      for(const [key,value] of Object.entries(s.properties)){
        const next=path+'/'+key;
        if(next==='/researchReview' || next==='/researchReview/proof' || next==='/researchReview/proof/chapters' || next==='/researchReview/proof/evidenceChapters')proofOptional.set(next,next==='/researchReview/proof/chapters'?false:!s.required?.includes(key));
        if(/^\/ways\/\*\/(hypothesisRevision|waySkillVersion|conventionVersion)$/.test(next)||/^\/ways\/\*\/proofInterfaces\/\*\/version$/.test(next)||/^\/ways\/\*\/conditionalPremises\/\*\/(version|statement|conditions|symbols)$/.test(next))continue;
        if(path==='/researchReview' && ['attemptsRead','documentsRead','affectedChapters'].includes(key))continue;
        if(path==='/researchReview/proof' && ['target','expectedRevision','proof'].includes(key))continue;
        if(path==='' && context.invocation.task==='v2_generate_ways' && (key==='routing' || key==='planningChange' || key==='workingRevision' && input.workingRevisionAllowed!==true))continue;
        if((path==='/anchors/*' && key==='revision') || key==='sourceHypothesisRevision')continue;
        if(key==='verified'){boundFields.set(path,{...boundFields.get(path),verified:false});continue;}
        if(path==='' && key==='derivationMarkdown' && isWorkerInvocation(context.invocation) && (version===LEGACY_HANDOFF_VERSION || !('step' in context.invocation) || context.invocation.step!=='RETURN'))continue;
        let child=key==='presentation'?presentation:walk(value,next);
        if(['scores','rationales'].includes(key) && boundary?.decision?.factors?.length)child=Type.Object(Object.fromEntries(boundary.decision.factors.map((f:any)=>[f.id,key==='scores'?Type.Number({minimum:0,maximum:4}):Type.String({minLength:1})])),{additionalProperties:false});
        if(key==='taskId')child=taskIds.length?strings(taskIds):undefined;
        if(key==='sourceId')child=sources.length?strings(sources.map((r:any)=>r.id)):undefined;
        if(next==='/ways/*/waySkillId' && snapshot?.waySkills?.length)child=strings(snapshot.waySkills.map((x:any)=>x.id));
        if(child && /^\/ways\/\*\/(anchorIds|domainIds)$/.test(next)){
          const kind=key==='anchorIds'?'anchors':'domains';
          const choices=routingChoices(context,kind);
          child={...child,items:strings(choices.map(x=>x.id)),description:`Select ${kind} only, never ${kind==='anchors'?'domain':'anchor'} IDs. Choices: ${JSON.stringify(choices)}`};
        }
        if(!child){if(s.required?.includes(key))return;continue;}
        if((key==='from'||key==='to') && path==='/ways/*/anchorConnections/*')child=strings(routingChoices(context,'anchors').map(a=>a.id));
        if(next==='/ways/*/dependencyTaskIds')child={...child,description:'Required explicit actual data dependencies. Select [] only when there are none. Include the attemptId of each selected adopted dependency chapter; conditional proof-interface assumptions are not data dependencies.'};
        if(next==='/ways/*/id')child={...child,description:version===LEGACY_HANDOFF_VERSION?'Optional local way identity: select absent for a host-generated ID, or value for an explicit ID referenced by another way in this plan.':'Optional local way identity: omit for a host-generated ID, or supply a native string ID referenced by another way in this plan.'};
        if(next==='/ways/*/macroWayId')child={...child,description:version===LEGACY_HANDOFF_VERSION?'Optional scientific method-group identity: select absent if unused, or value for the shared macro method of complementary tasks.':'Optional scientific method-group identity: omit if unused, or supply the native string ID for the shared macro method of complementary tasks.'};
        properties[key]=child;if(s.required?.includes(key))required.push(key);
      }
      if(path==='/researchReview/proof'){
        if(!properties.chapters || (properties.chapters as S).maxItems===0){unavailableManuscript=true;return;}
        properties.chapters={...properties.chapters,minItems:1};required.push('chapters');
      }
      const partialDescription=path==='/researchReview' && unavailableManuscript?'No eligible resolved final-manuscript chapters are currently available. Omit a new proof proposal (researchReview.proof); submit partial progress using top-level summary and unresolvedQuestions, with decision continue or pause. Retain saved drafts and unresolved issues; an authorized unchangedProof remains a separate option. This does not establish new root closure or archival.':'';
      const frozenDescription=path==='' && context.invocation.task==='v2_generate_ways'?[('planningChange' in s.properties)?'The prepared target is frozen during way generation. Omit planningChange from routing input; do not restate or change the target here.':'',('workingRevision' in s.properties) && input.workingRevisionAllowed!==true?'workingRevision is not authorized in this invocation; omit it and preserve the prepared problem.':''].filter(Boolean).join(' '):'';
      return {...s,properties,required:[...new Set(required)],additionalProperties:false,...(partialDescription||frozenDescription?{description:[s.description,partialDescription,frozenDescription].filter(Boolean).join(' ')}:{})};
    }
    if(s.type==='array' && s.items){const items=walk(s.items,path+'/*');if(!items)return (s.minItems??0)>0?undefined:Type.Array(Type.String(),{maxItems:0});return {...s,items};}
    return s;
  }
  const projected=walk(source,'');if(!projected)throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
  const codec=version === LEGACY_HANDOFF_VERSION ? strictCodec(projected) : canonicalCodec(projected);
  // Frozen, already-readable metadata only: never inspect global storage to diagnose a rejected handle.
  const readableProofs=new Map((proofMenus.size ? context.documents?.referenceChoices('read') ?? [] : []).filter(r=>r.handle.startsWith('C')).map(r=>{const ref=r.value as {complete?:boolean;hypothesisRevision?:string;component?:{unresolved?:unknown[]}};return [r.handle,{complete:ref.complete,hypothesisRevision:ref.hypothesisRevision,unresolved:Boolean(ref.component?.unresolved?.length)}] as const;}));
  function proofReferenceIssues(value:unknown):string[]{
    const issues:string[]=[];
    for(const [path,allowed] of proofMenus){
      let selected:any=value, selectedPath='';
      for(const key of path.split('/').filter(x=>x && x!=='*')){
        selectedPath+='/'+key;
        const optional=proofOptional.get(selectedPath)===true;
        selected=selected && typeof selected==='object'?selected[key]:undefined;
        if(version===LEGACY_HANDOFF_VERSION && optional)selected=selected && typeof selected==='object' && Object.hasOwn(selected,'value')?selected.value:undefined;
      }
      if(!Array.isArray(selected))continue;
      for(const [index,item] of selected.slice(0,128).entries()){
        const handle=item && typeof item==='object'?item.reference:undefined;
        if(typeof handle!=='string' || allowed.has(handle))continue;
        const known=readableProofs.get(handle), purpose=chapterPurpose(path);
        const reason=!known?'The reference is not an authorized choice for this purpose.':known.complete!==true?'The already-readable chapter is incomplete.':purpose==='manuscript' && typeof snapshot?.hypothesisRevision==='string' && known.hypothesisRevision!==snapshot.hypothesisRevision?'The already-readable chapter targets a different hypothesis revision.':known.unresolved?'The already-readable component has unresolved obligations.':'The already-readable chapter is not eligible for this purpose; readability does not grant adoption or manuscript eligibility.';
        issues.push(`${path.replace('/*','/'+index)} (${purpose}): ${reason}`);
        if(issues.length>=16)break;
      }
      if(issues.length>=16)break;
    }
    if(issues.length)issues.push('Do not merely delete a necessary reference and retain the same closure claim. Resolve the scientific obligations, explicitly assemble eligible necessary bodies in proof.chapters, or give a genuinely complete own derivation; otherwise submit partial progress with decision continue or pause. Dependencies and evidenceChapters do not append manuscript bodies.');
    return issues;
  }
  function restore(value:any,path:string):any{
    if(bindings.has(path))return bindings.get(path)!(value);
    if(Array.isArray(value))return value.map(v=>restore(v,path+'/*'));
    if(value && typeof value==='object'){
      const out={...Object.fromEntries(Object.entries(value).map(([key,v])=>[key,restore(v,path+'/'+key)])),...boundFields.get(path)};
      if(path==='/anchors/*')out.revision=snapshot?.policy?.anchors?.find((a:any)=>a.id===out.id)?.revision??stableHash(out);
      if(path==='/reconstructionProposals/*')out.sourceHypothesisRevision=snapshot?.hypothesisRevision;
      return out;
    }
    return value;
  }
  return {schema:codec.schema,decode(value){
    try { return restore(codec.decode(value),''); }
    catch(error) {
      if(!(error instanceof ContractValidationError))throw error;
      const issues=proofReferenceIssues(value);
      const ways=context.invocation.task==='v2_generate_ways'?(value as {ways?:unknown[]}|null)?.ways:undefined;
      for(const [index,way] of (Array.isArray(ways)?ways:[]).entries()) {
        if(!way || typeof way!=='object')continue;
        for(const [field,kind,other] of [['anchorIds','anchors','domains'],['domainIds','domains','anchors']] as const) {
          const selected=(way as Record<string,unknown>)[field];
          if(!Array.isArray(selected))continue;
          const allowed=routingChoices(context,kind), wrongKind=routingChoices(context,other);
          for(const id of selected)if(typeof id==='string' && !allowed.some(option=>option.id===id))
            issues.push(`/ways/${index}/${field}: ${JSON.stringify(id)} ${wrongKind.some(option=>option.id===id)?`is a ${other==='domains'?'domain':'anchor'} ID, not a ${kind==='anchors'?'anchor':'domain'} ID`:'is not an authorized choice'}. Allowed ${kind}: ${JSON.stringify(allowed)}.`);
        }
      }
      if(!issues.length)throw error;
      throw new ContractValidationError([...error.issues, ...issues],error.kind,error.details);
    }
  }};
}
export function stageContract(context:ContractContext, version: HandoffVersion = context.contractVersion ?? HANDOFF_VERSION):SchemaCodec {
  handoffVersion(version);
  const call=context.invocation;
  let schema=call.task==='research_learn'?call.input.outputSchema:outputSchema(call);
  if(call.task!=='research_learn' && isWorkerInvocation(call))schema=combinesFormulate(call)?FORMULATE_DERIVE_SCHEMA:call.step==='RETURN'?workerScientificSchema(call):Type.Object({notes:Type.String({minLength:1})},{additionalProperties:false});
  if(!schema)throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
  // Manual reviews cite exact resources in their frozen candidate list. Publication checks those grants.
  if(version===HANDOFF_VERSION && call.task==='research_learn' && 'purpose' in call.input && call.input.purpose==='network-review')return canonicalCodec(schema);
  const codec=projectContract(schema,context,version);
  if (version === HANDOFF_VERSION) return codec;
  const envelope=Type.Object({contract:Type.String({enum:[LEGACY_HANDOFF_VERSION]}),result:codec.schema},{additionalProperties:false});
  // Validate the envelope separately so the shared result decoder can include its precise field diagnostics.
  const outer=Type.Object({contract:envelope.properties.contract,result:Type.Unknown()},{additionalProperties:false});
  return {schema:envelope,decode(value){exact(outer,value);return codec.decode((value as {result:unknown}).result);}};
}
