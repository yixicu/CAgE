import {MapError} from '../../../learning/knowledge-map.js';
import {knowledgeRefKey,type KnowledgeRef,type KnowledgeProposal,type KnowledgeNode} from '../../../learning/knowledge-network.js';
import {validateResearchPublicationV44,type ResearchPublicationV4R4} from './theory-revision4.js';
import type {PostReportStudyV45,ReportEvidenceV45} from './post-report.js';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ProofRef } from '../../../learning/research-data.js';
import { stableHash } from '../../../learning/research-hash.js';
import { atomicWrite, readJson } from '../../../storage/atomic.js';
import { validateResearchPublicationV42, type ResearchPublicationV4R2 } from './theory-revision2.js';
import { validateResearchPublicationV43, type ResearchPublicationV4R3 } from './theory-revision3.js';
type ResearchPublication = ResearchPublicationV4R2 | ResearchPublicationV4R3 | ResearchPublicationV4R4;
const validResearch = (value:ResearchPublication) => value.support.revision==='v4-operation-4'?validateResearchPublicationV44(value as ResearchPublicationV4R4):value.support.revision==='v4-operation-3'?validateResearchPublicationV43(value as ResearchPublicationV4R3):validateResearchPublicationV42(value as ResearchPublicationV4R2);
import type { V4Authorize } from './coordinator.js';

const nonblank = Type.String({ pattern: '\\S' });
const contentSchema = Type.Object({
  primitives: nonblank, laws: nonblank, modelConditions: nonblank, construction: nonblank,
  internalClaim: nonblank, derivation: nonblank, limits: nonblank,
}, { additionalProperties: false });
export type PublishedTheoryContentV4 = Static<typeof contentSchema>;
const proofSchema = Type.Object({
  sessionId: nonblank, caseId: nonblank, hypothesisId: nonblank, hypothesisRevision: nonblank,
  revision: Type.Integer({ minimum: 1 }), semanticRevision: Type.Integer({ minimum: 1 }), contentHash: nonblank,
}, { additionalProperties: false });
export interface PublishedTheoryCardV4 extends PublishedTheoryContentV4 {
  id: string;
  authority: 'proof-backed';
  proofRef: ProofRef;
  parentProofs: ProofRef[];
}
const cardSchema = Type.Object({
  ...contentSchema.properties, id: Type.String({pattern: '^shared_[0-9a-f]{64}$'}),
  authority: Type.Literal('proof-backed'), proofRef: proofSchema, parentProofs: Type.Array(proofSchema),
}, {additionalProperties:false});
interface Revision {
  binding: string;
  inputHash: string;
  card: PublishedTheoryCardV4;
}
interface Catalogue {
  version: 1;
  mapIntents?:{decision?:NonNullable<import('../../../learning/knowledge-map.js').MapOutbox['projection']>['decision'];domainAdmission?:true;refutationEvidence?:true;modelDirectedKnowledge?:true;id:string;entry:import('../../../learning/knowledge-map.js').MapEntry;source:import('../../../learning/knowledge-map.js').MapSource;completed?:unknown}[];
  knowledgeIntents?:{id:string;proposal:KnowledgeProposal;completed?:{revision:number;receiptId:string}}[];
  revisions: Revision[];
  // The prefix of the append-only revision list selected by a boundary, including an empty selection.
  cutoffs: Record<string, number>;
  research?: {publication:ResearchPublication;card:ResearchTheoryCardV4}[];
  researchCutoffs?: Record<string,number>;
  postReports?: {studyId:string;publicationHash:string;card:ReportTheoryCardV45}[];
}

export interface ReportTheoryCardV45 {
  mapCard?:import('./post-report.js').ResearchReplyV45['mapCard'];
  qualification?:'candidate'|'supported';
  family?:{id:string;version:number;parent?:KnowledgeRef;relation?:'revises'|'narrows';argument?:string};
  knowledgeSupport?:KnowledgeRef[];
  id:string;authority:'research-evidence';kind:'finding'|'theory';body:string;review:string;source:ReportEvidenceV45;
}
function reportCard(study:PostReportStudyV45):ReportTheoryCardV45 {
  const publication=study.publication;
  if(study.status!=='completed'||!publication||!['finding','theory'].includes(publication.kind)||!publication.body.trim()||!publication.review.trim()||publication.sourceHash!==study.report.bodyHash||stableHash(study.report.body)!==study.report.bodyHash)throw Error('Invalid report research publication');
  const candidate=study.responses.findLast(r=>r.action==='review'),review=study.responses.at(-1);
  if(candidate?.kind!==publication.kind||candidate.body!==publication.body||review?.action!=='publish'||review.body!==publication.review)throw Error('Report publication lacks matching candidate and critical review');
  const body={...(study.mapNodeWriting&&publication.kind==='theory'&&review.mapCard?{mapCard:structuredClone(review.mapCard)}:{}),authority:'research-evidence' as const,kind:publication.kind,body:publication.body,review:publication.review,source:structuredClone(study.report),...(study.knowledge?{qualification:publication.qualification??'candidate' as const,knowledgeSupport:study.knowledge.opened.filter(x=>!study.knowledge!.presentation||x.ref.store!=='theory'||study.knowledge!.proofExposureRefs?.includes(knowledgeRefKey(x.ref))).map(x=>structuredClone(x.ref)),family:study.knowledge.family?{id:study.knowledge.family.parent.id,version:study.knowledge.family.parent.version+1,...study.knowledge.family}:{id:'theory_family_'+stableHash(study.id),version:1}}:{})};
  return {id:'shared_'+stableHash([study.id,body]),...body};
}
function validReportCard(row:NonNullable<Catalogue['postReports']>[number]):boolean {
  const c=row?.card;
  if(!c||typeof c.id!=='string'||c.authority!=='research-evidence'||!['finding','theory'].includes(c.kind)||typeof c.body!=='string'||!c.body.trim()||typeof c.review!=='string'||!c.review.trim()||!c.source||typeof c.source.body!=='string'||stableHash(c.source.body)!==c.source.bodyHash)return false;
  const {id,...body}=c;
  return id==='shared_'+stableHash([row.studyId,body])&&row.publicationHash===stableHash(c);
}

export interface ResearchTheoryCardV4 extends PublishedTheoryContentV4 {
  id:string; authority:'research-evidence'; revision:'v4-operation-2'|'v4-operation-3'|'v4-operation-4';
  support:{trialId:string; sources:{projectId:string;epochId:string;rootId:string;stageId:string;bodyHash:string}[];evidenceHash:string};
}

const maxBytes = 32 * 1024;
const tails = new Map<string, Promise<void>>();

function proofSet(refs: readonly ProofRef[]): ProofRef[] {
  const byId = new Map(refs.map(ref => [stableHash(ref), ref]));
  return [...byId.keys()].sort().map(id => byId.get(id)!);
}
function revisionId(binding: string, inputHash: string, body: Omit<PublishedTheoryCardV4,'id'>): string {
  return 'shared_' + stableHash([binding,inputHash,body]);
}

/** Backend-only. The application holds the research data root's writer lease. */
export class PublishedTheoriesV4 {
  private readonly file: string;
  private readonly key: string;
  constructor(dataRoot: string) {
    this.file = path.resolve(dataRoot, 'v4', 'published-theories.json');
    this.key = process.platform === 'win32' ? this.file.toLowerCase() : this.file;
  }

  private async load(): Promise<Catalogue> {
    try {
      const data = await readJson<Catalogue>(this.file);
      if (data.version !== 1 || !Array.isArray(data.revisions) || !data.cutoffs || typeof data.cutoffs !== 'object')
        throw new Error('Invalid V4 published theory catalogue');
      for (const row of data.revisions) {
        if (!row || !Value.Check(cardSchema,row.card)) throw new Error('Invalid V4 published theory revision');
        const {id, ...body} = row.card;
        if (revisionId(row.binding,row.inputHash,body) !== id) throw new Error('Invalid V4 published theory revision binding');
      }
      for(const row of data.research??[]){
        if(!validResearch(row.publication))throw new Error('Invalid independent theory evidence');
        if(JSON.stringify(this.researchCard(row.publication))!==JSON.stringify(row.card))throw new Error('Invalid independent theory support binding');
      }
      if(data.postReports!==undefined&&(!Array.isArray(data.postReports)||!data.postReports.every(validReportCard)))throw Error('Invalid post-report publication binding');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, revisions: [], cutoffs: {} };
      throw error;
    }
  }

  private researchCard(publication:ResearchPublication):ResearchTheoryCardV4 {
    const support={trialId:publication.support.trialId,sources:publication.support.sources.map(({scope,stage})=>({...scope,stageId:stage.stageId,bodyHash:stableHash(stage)})),evidenceHash:stableHash(publication.support)};
    return {id:'shared_'+stableHash(publication),authority:'research-evidence',revision:publication.support.revision,...publication.content,support};
  }

  /** Pure findings/theories retain their reviewed body without a source-root application. */
  async publishReportStudy(study:PostReportStudyV45,authorize:(source:ReportEvidenceV45)=>boolean|Promise<boolean>):Promise<ReportTheoryCardV45>{
    const exact=structuredClone(study),card=reportCard(exact);
    if(!await authorize(card.source))throw Error('Post-report publication source unavailable');
    return this.edit(data=>{
      const rows=data.postReports??=[],prior=rows.find(row=>row.studyId===exact.id);
      if(prior){if(prior.publicationHash!==stableHash(card))throw Error('Conflicting post-report publication');return {value:structuredClone(prior.card),changed:false};}
      if(card.family?.parent){const parent=rows.find(r=>reportKnowledgeRef(r.card).id===card.family!.parent!.id&&reportKnowledgeRef(r.card).version===card.family!.parent!.version);if(!parent||stableHash(reportKnowledgeRef(parent.card))!==stableHash(card.family.parent)||rows.some(r=>reportKnowledgeRef(r.card).id===card.family!.id&&reportKnowledgeRef(r.card).version>card.family!.parent!.version))throw Error('Theory family revision conflict');}
      rows.push({studyId:exact.id,publicationHash:stableHash(card),card});
      if(exact.knowledge&&(!exact.map||card.kind==='theory')){
        const owner=reportKnowledgeRef(card),node=reportKnowledgeNode(card),id='theory_projection_'+stableHash(card);
        const bindings=card.qualification==='supported'?exact.knowledge.bindings.map(b=>({theory:owner,...b})):[];
        if(card.kind!=='theory'&&bindings.length)throw Error('Findings cannot explain shared theory');
        data.knowledgeIntents??=[];
        data.knowledgeIntents.push({id,proposal:{owner,purpose:'theory-study',allowedRefs:[owner,...exact.knowledge.allowedRefs],reviewed:true,receiptId:id,expectedRevision:exact.knowledge.network.revision,nodes:[node],bindings}});
      }
      if(exact.map&&card.kind==='theory'){
        const ref={...reportKnowledgeRef(card),store:'theory' as const},source:import('../../../learning/knowledge-map.js').MapSource={ref:{kind:'theory',id:card.id,version:ref.version,bodyHash:ref.bodyHash,ownerId:'local-user',projectId:card.source.scope.projectId},body:'',canonicalTheory:ref,status:'active',origin:{cardId:card.id,...(study.domainAdmission?{studyId:study.id}:{}),...(card.source.empiricalEvidence?{empiricalEvidence:true}:{})}};
        const placement=study.publication?.placement;
        const authorReads=exact.responses.findLast(r=>r.action==='publish')?.mapWriteReads??exact.map.opened;
        const opened=placement?.kind==='nearby'?authorReads.filter(o=>o.ref&&o.selection===placement.anchor):[];
        if(study.scientificMapWrites&&(!placement?.reason?.trim()||placement.kind==='nearby'&&opened.length!==1))throw Error('The Moderator must supply the theory placement and open its exact anchor');
        data.mapIntents??=[];data.mapIntents.push({...(study.scientificMapWrites&&placement?{decision:{placement:structuredClone(placement),opened:structuredClone(opened)}}:{}),...(study.domainAdmission?{domainAdmission:true}:{}),...(study.refutationEvidence?{refutationEvidence:true}:{}),...(study.modelDirectedKnowledge?{modelDirectedKnowledge:true}:{}),id:'map_projection_'+stableHash(card),entry:{ref,kind:'theory',ownerId:'local-user',...(card.mapCard?{title:card.mapCard.title,summary:card.mapCard.summary,nodeType:'theory' as const}:{title:card.body.trim().split('\n')[0]!}),aliases:[],domain:card.mapCard?.domain??[],assumptions:[],definition:false,status:'active',theoryQualification:card.qualification??'candidate',createdFrom:[source.ref]},source});
      }
      return {value:structuredClone(card),changed:true};
    });
  }

  /** Canonical content and the projection intent are committed in one catalogue edit. */
  async knowledgeRevision(){await tails.get(this.key);return stableHash((await this.load()).postReports??[]);}
  async reconcileMapIntents(library:import('../../../learning/research-library.js').ResearchLibrary,projectId?:string){
    for(const intent of await this.pendingMapIntents()){
      if(projectId&&intent.source.ref.projectId!==projectId)continue;
      try{
        const receipt=await library.knowledgeMap.projectTheory(intent.entry,intent.source,intent.id,intent.modelDirectedKnowledge,intent.refutationEvidence,intent.domainAdmission,undefined,intent.decision);
        await this.completeMapIntent(intent.id,receipt);
      }catch(error){if(!(error instanceof MapError&&error.code==='STALE_SOURCE'))throw error;}
    }
  }
  async pendingMapIntents(){await tails.get(this.key);return structuredClone((await this.load()).mapIntents?.filter(i=>!i.completed)??[]);}
  async completeMapIntent(id:string,receipt:unknown){return this.edit(data=>{const item=data.mapIntents?.find(i=>i.id===id);if(!item)throw Error('Unknown map projection');if(item.completed&&stableHash(item.completed)!==stableHash(receipt))throw Error('Changed map projection receipt');item.completed=structuredClone(receipt);return {changed:true,value:undefined};});}
  async pendingKnowledgeIntents(){await tails.get(this.key);return structuredClone((await this.load()).knowledgeIntents?.filter(x=>!x.completed)??[]);}
  async completeKnowledgeIntent(id:string,receipt:{revision:number;receiptId:string}){
    return this.edit(data=>{const row=data.knowledgeIntents?.find(x=>x.id===id);if(!row||receipt.receiptId!==id)throw Error('Unknown theory projection receipt');if(row.completed&&row.completed.receiptId!==receipt.receiptId)throw Error('Conflicting projection receipt');row.completed=structuredClone(receipt);return {value:undefined,changed:true};});
  }
  async knowledgeSnapshot(authorize:(source:ReportEvidenceV45)=>boolean|Promise<boolean>,available:(refs:KnowledgeRef[])=>boolean|Promise<boolean>){
    await tails.get(this.key);const data=await this.load(),rows=[];
    for(const row of data.postReports??[])if(await authorize(row.card.source)&&await available(row.card.knowledgeSupport??[]))rows.push(row.card);
    const latest=new Map<string,number>();for(const c of rows){const ref=reportKnowledgeRef(c);latest.set(ref.id,Math.max(latest.get(ref.id)??0,ref.version));}
    return {revision:stableHash(data.postReports??[]),cards:structuredClone(rows),nodes:rows.map(c=>{const node=reportKnowledgeNode(c);return {...node,status:node.ref.version===latest.get(node.ref.id)?'active' as const:'withdrawn' as const};})};
  }

  /** Callers must grant the originating public source, including cross-project use. */
  async readReportStudies(authorize:(source:ReportEvidenceV45)=>boolean|Promise<boolean>,select?:(card:ReportTheoryCardV45)=>boolean):Promise<ReportTheoryCardV45[]>{
    await tails.get(this.key);const data=await this.load(),cards:ReportTheoryCardV45[]=[],all=data.postReports??[];
    const selected=new Set(all.filter(row=>!select||select(row.card)).map(row=>row.card.id));
    if(select){let changed=true;while(changed){changed=false;for(const row of all)if(selected.has(row.card.id))for(const ref of row.card.knowledgeSupport??[]){const parent=all.find(p=>stableHash(reportKnowledgeRef(p.card))===stableHash(ref));if(parent&&!selected.has(parent.card.id)){selected.add(parent.card.id);changed=true;}}}}
    for(const row of all)if(selected.has(row.card.id)&&await authorize(row.card.source))cards.push(structuredClone(row.card));
    return cards;
  }

  /** Publication retains its own checked claim support; no root-use receipt is manufactured. */
  async publishResearch(publication:ResearchPublication,authorize:V4Authorize):Promise<ResearchTheoryCardV4>{
    if(!validResearch(publication))throw new Error('Invalid independent theory evidence');
    for(const source of publication.support.sources)if(!await authorize(source.stage,source.scope))throw new Error('Independent theory source unavailable');
    const exact=structuredClone(publication),card=this.researchCard(exact);
    if(Buffer.byteLength(JSON.stringify(card))>maxBytes)throw new Error('Independent theory exceeds whole-card allowance');
    return this.edit(data=>{
      const rows=data.research??=[];
      const prior=rows.find(row=>row.publication.id===exact.id);
      if(prior){if(stableHash(prior.publication)!==stableHash(exact))throw new Error('Conflicting independent theory publication');return {value:prior.card,changed:false};}
      rows.push({publication:exact,card});return {value:card,changed:true};
    });
  }

  /** The source validator is host-only; private public-fragment bodies never enter another project's catalogue. */
  async readResearch(projectId:string,epochId:string,authorize:V4Authorize,proofValid:(ref:ProofRef)=>boolean|Promise<boolean>=()=>false):Promise<ResearchTheoryCardV4[]>{
    await tails.get(this.key);const data=await this.load(),cutoff=data.researchCutoffs?.[JSON.stringify([projectId,epochId])];
    if(cutoff===undefined)return [];
    if(!Number.isSafeInteger(cutoff)||cutoff<0||cutoff>(data.research??[]).length)throw new Error('Invalid independent theory boundary');
    const validIds=new Set<string>(),active=new Set<string>();
    const validSupport=async(row:NonNullable<Catalogue['research']>[number]):Promise<boolean>=>{
      if(validIds.has(row.card.id))return true;if(active.has(row.card.id))return false;active.add(row.card.id);
      for(const source of row.publication.support.sources)if(!await authorize(source.stage,source.scope))return false;
      for(const ref of row.publication.support.sharedRefs??[]){
        const parent=(data.research??[]).find(p=>p.card.id===ref.id),legacy=data.revisions.find(p=>p.card.id===ref.id);
        if(parent){if(stableHash(parent.card)!==ref.hash||!await validSupport(parent))return false;}
        else if(legacy){if(stableHash(legacy.card)!==ref.hash)return false;for(const proof of [legacy.card.proofRef,...legacy.card.parentProofs])if(!await proofValid(proof))return false;}
        else return false;
      }
      active.delete(row.card.id);validIds.add(row.card.id);return true;
    };
    const cards:ResearchTheoryCardV4[]=[];let bytes=2;
    for(const row of (data.research??[]).slice(0,cutoff).reverse()){
      const valid=await validSupport(row);
      const size=Buffer.byteLength(JSON.stringify(row.card));
      if(valid&&bytes+size<=maxBytes){cards.push(structuredClone(row.card));bytes+=size;}
      if(cards.length===8)break;
    }
    return cards;
  }

  /** Export only the explicitly authorized closure; missing bodies remain visible as missing support. */
  async exportResearch(id:string,authorize:V4Authorize){
    await tails.get(this.key);const data=await this.load(),pending=[id],seen=new Set<string>();
    const revisions:{card:ResearchTheoryCardV4;support?:ResearchPublication['support'];missing:string[]}[]=[];
    while(pending.length){
      const current=pending.pop()!;if(seen.has(current))continue;seen.add(current);
      const row=data.research?.find(r=>r.card.id===current);if(!row)continue;
      const missing:string[]=[];
      for(const source of row.publication.support.sources)if(!await authorize(source.stage,source.scope))missing.push(source.stage.stageId);
      for(const parent of row.publication.support.sharedRefs??[]){if(data.research?.some(r=>r.card.id===parent.id))pending.push(parent.id);else missing.push(parent.id);}
      revisions.push({card:structuredClone(row.card),...(!missing.length?{support:structuredClone(row.publication.support)}:{}),missing});
    }
    return {revision:data.research?.find(row=>row.card.id===id)?.card.revision??'v4-operation-2',revisions,complete:revisions.length>0&&revisions.every(r=>!r.missing.length)};
  }
  async supportReferences(ids:readonly string[]){
    await tails.get(this.key);const data=await this.load(),pending=[...ids],seen=new Set<string>();
    const sources:{projectId:string;artifactId:string}[]=[],proofRefs:ProofRef[]=[];
    while(pending.length){
      const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);
      const row=data.research?.find(r=>r.card.id===id),legacy=data.revisions.find(r=>r.card.id===id);
      if(row){for(const source of row.publication.support.sources)sources.push({projectId:source.scope.projectId,artifactId:source.stage.stageId.split('/fragment/')[0]!});pending.push(...(row.publication.support.sharedRefs??[]).map(r=>r.id));}
      else if(legacy)proofRefs.push(legacy.card.proofRef,...legacy.card.parentProofs);
      else throw new Error('Missing published theory support');
    }
    return {sources:[...new Map(sources.map(s=>[JSON.stringify(s),s])).values()],proofRefs:proofSet(proofRefs)};
  }

  private edit<T>(change: (data: Catalogue) => { value: T; changed: boolean }): Promise<T> {
    const transaction = (tails.get(this.key) ?? Promise.resolve()).then(async () => {
      const data = await this.load();
      const {value, changed} = change(data);
      if (changed) await atomicWrite(this.file, JSON.stringify(data));
      return value;
    });
    const tail = transaction.then(() => {}, () => {});
    tails.set(this.key, tail);
    void tail.then(() => { if (tails.get(this.key) === tail) tails.delete(this.key); });
    return transaction;
  }

  /** Trusted final-proof publication only. Neither a model tool nor an external write API. */
  async publish(theoryId: string, proofRef: ProofRef, content: PublishedTheoryContentV4, parentProofs: readonly ProofRef[] = []): Promise<PublishedTheoryCardV4> {
    if (!theoryId?.trim() || !Value.Check(contentSchema, content) || !Value.Check(proofSchema, proofRef) ||
        !Array.isArray(parentProofs) || !parentProofs.every(ref => Value.Check(proofSchema,ref))) {
      throw new Error('Invalid V4 published theory content or proof reference');
    }
    const exactProof = structuredClone(proofRef), abstract = structuredClone(content);
    const direct = proofSet(structuredClone(parentProofs));
    const binding = stableHash([theoryId,exactProof]);
    const inputHash = stableHash([abstract,direct]);
    return this.edit(data => {
      const current = data.revisions.find(row => row.binding === binding);
      if (current) {
        if (current.inputHash !== inputHash) throw new Error('Conflicting V4 theory revision for the same final proof');
        return { value: current.card, changed: false };
      }
      const parents = new Set(direct.map(stableHash));
      const inherited = data.revisions.filter(row => parents.has(stableHash(row.card.proofRef))).flatMap(row => row.card.parentProofs);
      const body: Omit<PublishedTheoryCardV4,'id'> = { authority: 'proof-backed',
        proofRef: exactProof, parentProofs: proofSet([...direct,...inherited]), ...abstract };
      const card = {id: revisionId(binding,inputHash,body),...body};
      if (Buffer.byteLength(JSON.stringify([card])) > maxBytes) throw new Error('Published V4 theory exceeds the whole-card allowance');
      data.revisions.push({binding,inputHash,card});
      return { value: card, changed: true };
    });
  }

  freeze(projectId: string, epochId: string): Promise<string[]> {
    const scope = JSON.stringify([projectId,epochId]);
    return this.edit(data => {
      let changed = !Object.hasOwn(data.cutoffs,scope);
      if (changed) data.cutoffs[scope] = data.revisions.length;
      data.researchCutoffs??={};
      if(!Object.hasOwn(data.researchCutoffs,scope)){data.researchCutoffs[scope]=(data.research??[]).length;changed=true;}
      return {value:data.revisions.slice(0,data.cutoffs[scope]).map(row=>row.card.id), changed};
    });
  }

  /** Only the frozen abstract and the complete currently valid support chain can cross projects. */
  async read(projectId: string, epochId: string, isValid: (proof: ProofRef) => boolean | Promise<boolean>, query = ''): Promise<PublishedTheoryCardV4[]> {
    await tails.get(this.key);
    const data = await this.load(), cutoff = data.cutoffs[JSON.stringify([projectId,epochId])];
    if (cutoff === undefined) return [];
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > data.revisions.length) throw new Error('Invalid V4 theory boundary');
    const exactId = /^shared_[0-9a-f]{64}$/.test(query) ? query : undefined;
    const terms = new Set(query.slice(0,8192).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const candidates = data.revisions.slice(0,cutoff).reverse()
      .filter(({card}) => !exactId || card.id === exactId)
      .map(({card}) => {
        const body = Object.keys(contentSchema.properties).map(k => card[k as keyof PublishedTheoryContentV4]).join(' ');
        const words = new Set(body.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
        let score = 0;
        for (const term of terms) if (words.has(term)) score++;
        return {card,score};
      }).sort((a,b) => b.score-a.score);
    const cards: PublishedTheoryCardV4[] = [];
    let bytes = 2;
    for (const {card} of candidates) {
      const size = Buffer.byteLength(JSON.stringify(card)) + Number(cards.length > 0);
      if (bytes + size > maxBytes) continue;
      let valid = true;
      for (const proof of [card.proofRef,...card.parentProofs]) {
        if (!await isValid(proof)) { valid = false; break; }
      }
      if (!valid) continue;
      cards.push(card);
      bytes += size;
      if (cards.length === 8) break;
    }
    return cards;
  }
}

export const reportKnowledgeRef=(card:ReportTheoryCardV45):KnowledgeRef=>({store:'theory',id:card.family?.id??card.id,version:card.family?.version??1,bodyHash:stableHash(card.body)});
export function reportKnowledgeNode(card:ReportTheoryCardV45):KnowledgeNode {const lines=card.body.trim().split(/\n+/);return {ref:reportKnowledgeRef(card),kind:card.kind,...(card.qualification?{scientificStatus:card.qualification}:{}),title:card.mapCard?.title??lines[0]!.slice(0,160),summary:card.mapCard?.summary??lines.slice(1).join(' ').slice(0,600),conditions:[],status:'active'};}
