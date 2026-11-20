import {KnowledgeMapStore,type MapSeedInput} from './knowledge-map-store.js';
import {ScientificTextStore} from '../storage/scientific-text.js';
import {emptyKnowledgeMap,type KnowledgeMapState,type MapGrant,type MapView,type MapQuery,type MapUser,type MapRef,type MapSource,type MapReviewedProposal} from './knowledge-map.js';
import { usesV3Proof } from '../research/versions/v3/proof-version.js';
import {directedRouteSelection,directedRoutePresentation,type DirectedRouteQuery} from './directed-route.js';
import {applyKnowledgeProposal,emptyKnowledgeNetwork,knowledgeRefKey,prepareKnowledgeNetwork,queryKnowledge,validKnowledgeRef,validateKnowledgeNetwork,type KnowledgeNetworkState,type KnowledgeNode,type KnowledgeProposal,type KnowledgeQuery,type KnowledgeRef,type KnowledgeSelection,type PreparedKnowledgeNetwork} from './knowledge-network.js';
import { userResourceNetwork, type UserResourceNetwork } from './user-resource-inspection.js';
import { stageNetworkReviewV1, type NetworkReviewContextV1, type NetworkReviewOutputV1, type NetworkReviewResourceV1 } from './network-review-v1.js';
import {nominateStructuralReviewV3,structuralDescriptorCurrentV3,type StrategyAdmissionRecipeV3} from './strategy-admission-v3.js';
import {StrategySupportResolverV3,dedupeStrategySourcesV3,type StrategyPublicationV3} from './strategy-support-v3.js';
import {buildMethodNetworkV3,buildMethodNetworkPreparationV3,validNetworkPinV3,queryMethodNetworkV3,queryLearningMethodNetworkV3,validateMethodNetworkSelectionV3,emptyMethodNetworkV3,type NetworkPinV3,type NetworkQueryV3,type NetworkSelectionV3,type NetworkIndexV3,type PreparedNetworkV3,type RouteTemplateV3} from './method-network-v3.js';
import {stageMethodNetworkV3} from './method-network-publication-v3.js';
import {buildCatalogIndexV3,prepareCatalogIndexV3,queryCatalogIndexV3,catalogTermsV3,catalogBodyKeyV3,catalogResourceIdV3,validCatalogPinV3,CatalogUnavailableErrorV3,type CatalogPinV3,type CatalogQueryV3,type CatalogSelectionV3,type CatalogIndexV3,type CatalogInputV3,type CatalogBodyTermsV3,type PreparedCatalogIndexV3,type IndexedEntryV3} from './hierarchical-catalog-v3.js';
import type {KnowledgeNodeV3} from '../research/versions/v3/knowledge.js';
import {isStorageAccessError,hasErrorCode} from '../storage/errors.js';
import {freezeCapacityReservationV3} from './capacity-reservation.js';
import {MethodSupportResolverV3,dedupeMethodSourcesV3,type MethodPublicationV3} from './method-support-v3.js';
import { KnowledgeCandidateValidationErrorV3, emptyKnowledgePublicationV3, stageKnowledgePublicationV3, publicationSnapshotV3, type KnowledgeReviewRevisionV3 } from './v3-knowledge.js';
import { archivedRefutation, LearningDataError, modernOptionalRevision, optionalArchiveRelation } from './research-data.js';
import { scopedOutcomeIssue } from '../research/versions/v4/map-evidence-schema.js';
import { validTagsV21 } from '../research/versions/v21/tags.js';
import type { RawAnswerRefV0 } from '../research/contracts/v0.js';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { AtomicWriteError, atomicWrite, exists, readJson } from '../storage/atomic.js';
import { GitRevisions } from '../storage/git-revisions.js';
import {
  archiveCandidates, buildCatalog, defaultDecision, normalizeTags, proofGroups, proofRef, requireData,
  requireText, reviseDecision, safeId, sourceKey,
} from './research-data.js';
import { stableHash } from './research-hash.js';
import { chapterKey } from '../research/proof-components.js';
import type { RawAnswerRefV21 } from '../research/contracts/v21.js';
import type { ChapterRef } from '../research/contracts/documents.js';
import type {
  AnomalyInput, AnomalyRef, ArchiveSubject, BoundaryQuery, BoundaryView, DecisionFile, DecisionProposal,
  FailureInput, FailureRecord, FailureRef, LearningActor, LearningSource, LoopVersion, ProofDocument,
  OptionalCaseOutcomeSummary, OptionalDecisionEvidence, DerivedProofMetadata,
  ProofInput, ProofRecord, ProofRef, ResearchLibraryState, ResourceInput, ResourceMeta, ResourceRef,
  ReviewOperation, ReviewPurpose, WeightUpdateOutcome,
} from './research-data.js';

type Pointer = { revision: string; previousRevision?: string };
export type ResourceReader = { role: 'theorist'; sessionId: string; loopVersion: LoopVersion } | { role: 'moderator'; purpose: 'v2-strategy'; operationId: string };
export interface ProofReader { read(ref: ProofRef): Promise<ProofDocument> }
export interface KnowledgeViewV4 {revision:string;network:KnowledgeNetworkState;refs:KnowledgeRef[]}
export interface KnowledgeReadGrantV4 {purpose:'theory-study'|'theory-review'|'theorist-bootstrap'|'method-learning'|'strategy-learning';allowedRefs:KnowledgeRef[];revision?:string}
export interface KnowledgePublicationAuthorityV4 {actor:LearningActor;jobId:string;sources:LearningSource[]}
export interface ReviewView {
  operation: ReviewOperation;
  decision?: DecisionFile; anomalies?: AnomalyInput[]; patterns?: string[];
  outlines?: { ref: ProofRef; meta: ProofRecord; summary: string; learningMetadata?: DerivedProofMetadata }[]; strategies?: ResourceMeta[];
  readProof?: (ref: ProofRef) => Promise<ProofDocument>;
  caseOutcomeSummaries?: OptionalCaseOutcomeSummary[];
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const proofPath = (record: ProofRef) => `sessions/${safeId(record.sessionId)}/proofs/${safeId(record.caseId.slice(record.sessionId.length + 1))}/revisions/${record.revision}`;
const resourcePath = (ref: ResourceRef) => `library/${safeId(ref.id)}/revisions/${ref.version}`;
const failurePath = (ref: FailureRef) => `failure-cases/${safeId(ref.id)}/revisions/${ref.version}`;
const sameRef = (a: ProofRef, b: ProofRef) => stableHash(a) === stableHash(b);
/** Keep historical target-method grouping; optional dual originals share one root case. */
export const independentProofCaseKey = (proof: ProofRecord): string => proof.optionalProof
  ? `optional:${proof.optionalProof.caseGroupId}` : `legacy:${stableHash([proof.targetKey, proof.methodKey])}`;
const optionalArtifactKey = (sessionId: string, artifactId: string) => stableHash([sessionId, artifactId]);

/** Host-owned store under FileResearchStore's existing process lease. Model/plugin code receives only narrow views. */
export class ResearchLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly publicationScope = new AsyncLocalStorage<{active:boolean;queue:Promise<unknown>}>();
  private closed = false;
  private catalogIndexV3?:CatalogIndexV3;
  private readonly networkCacheV3=new Map<string,Promise<{network:PreparedNetworkV3;catalog:PreparedCatalogIndexV3;reconstructed?:boolean}>>();
  private readonly catalogCacheV3=new Map<string,Promise<PreparedCatalogIndexV3>>();
  private readonly knowledgeCacheV4=new Map<string,Promise<{prepared:PreparedKnowledgeNetwork;refs:KnowledgeRef[];metas:Map<string,ResourceMeta>}>>();
  private preparedKnowledgeV4?:PreparedKnowledgeNetwork;
  private readonly methodSupport=new MethodSupportResolverV3();
  private readonly strategySupport=new StrategySupportResolverV3();
  private knowledgeStatusesV3=new Map<string,KnowledgeNodeV3['status']>();
  private refreshKnowledgeStatusesV3(){this.knowledgeStatusesV3=new Map(this.state.knowledgeV3?.nodes.map(node=>[node.id,node.status]));}
  private mapAdapter?:KnowledgeMapStore;
  private mapSourceResolver?:{valid:(source:MapSource)=>Promise<boolean>;theoryBody:(ref:MapRef)=>Promise<string>};
  configureKnowledgeMapSources(resolver:{valid:(source:MapSource)=>Promise<boolean>;theoryBody:(ref:MapRef)=>Promise<string>}):void {this.mapSourceResolver=resolver;}
  get knowledgeMap():KnowledgeMapStore {
    return this.mapAdapter??=new KnowledgeMapStore({
      snapshot:async()=>{requireData(!this.closed,'Research library is closed.');if(this.state.knowledgeMapV4)return {state:structuredClone(this.state.knowledgeMapV4),revision:this.revision!};return this.serial(async()=>{if(!this.state.knowledgeMapV4){const next=structuredClone(this.state);next.knowledgeMapV4=emptyKnowledgeMap();await this.commit(next);}return {state:structuredClone(this.state.knowledgeMapV4!),revision:this.revision!};});},
      historical:async revision=>{const state=await this.readState(revision);requireData(state.knowledgeMapV4,'Exact map checkpoint unavailable.','NOT_FOUND');return state.knowledgeMapV4;},
      edit:<T>(edit:(state:KnowledgeMapState)=>Promise<{state:KnowledgeMapState;value:T}>|{state:KnowledgeMapState;value:T})=>this.serial(async()=>{const previous=this.state.knowledgeMapV4??emptyKnowledgeMap(),result=await edit(structuredClone(previous));if(stableHash(previous)!==stableHash(result.state)||!this.state.knowledgeMapV4){const next=structuredClone(this.state);next.knowledgeMapV4=result.state;await this.commit(next);}return result.value;}),
      sourceValid:async source=>source.ref.kind==='maintenance-proof'?source.status==='active'&&stableHash(source.body)===source.ref.bodyHash:source.ref.kind==='user-seed'?source.status==='active':this.mapSourceResolver?this.mapSourceResolver.valid(source):false,
      theoryBody:async ref=>{requireData(this.mapSourceResolver,'Canonical theory reader unavailable.','NOT_FOUND');return this.mapSourceResolver.theoryBody(ref);},
    });
  }
  freezeKnowledgeMap(grant:MapGrant){return this.knowledgeMap.freeze(grant);}
  queryKnowledgeMap(view:MapView,query:MapQuery,grant:MapGrant){return this.knowledgeMap.query(view,query,grant);}
  openKnowledgeMap(view:MapView,selection:string,grant:MapGrant){return this.knowledgeMap.open(view,selection,grant);}
  importKnowledgeSeeds(input:MapSeedInput,actor:MapUser){return this.knowledgeMap.importSeeds(input,actor);}
  updateFoundationProfile(input:{requestId:string;expectedVersion:number;accepted:MapRef[]},actor:MapUser){return this.knowledgeMap.updateProfile(input,actor);}
  knowledgeMapSnapshot(actor:MapUser){return this.knowledgeMap.inspect(actor);}
  publishKnowledgeMap(proposal:MapReviewedProposal,grant:MapGrant,guard?:()=>void){return this.knowledgeMap.publish(proposal,grant,guard);}
  private constructor(private readonly root: string, private readonly git: GitRevisions, private state: ResearchLibraryState, private revision?: string) {this.refreshKnowledgeStatusesV3();}
  private get scientificText(){return new ScientificTextStore(path.join(path.dirname(this.root),'scientific-content'));}
  private async readState(revision:string):Promise<ResearchLibraryState>{return this.scientificText.decode(JSON.parse(new TextDecoder().decode(await this.git.read(revision,'state.json'))),['knowledgeMapV4']);}

  static async open(root: string): Promise<ResearchLibrary> {
    const git = new GitRevisions(root); await git.initialize();
    let revision: string | undefined;
    let state: ResearchLibraryState;
    if (await exists(path.join(root, 'checkpoint.json'))) {
      const pointer = await readJson<Pointer>(path.join(root, 'checkpoint.json'));
      revision = pointer.revision;
      state = await new ScientificTextStore(path.join(path.dirname(root),'scientific-content')).decode<ResearchLibraryState>(JSON.parse(new TextDecoder().decode(await git.read(revision, 'state.json'))),['knowledgeMapV4']);
      requireData(state.schemaVersion === 1 && Number.isSafeInteger(state.generation) && !!state.catalogs && !!state.decisions, 'Unsupported research library snapshot.');
    } else {
      const generation = 0;
      state = { schemaVersion: 1, generation, proofs: {}, nextProof: {}, failures: {}, resources: {},
        decisions: { '1': defaultDecision(1), '2': defaultDecision(2) }, anomalies: {}, patternsV1: [], operations: {},
        receipts: [], archive: { cold: {} }, inspectedAttempts: {}, invalidProofs: {}, appliedUpdates: {},
        catalogs: { proofs: buildCatalog({}, generation), skills: buildCatalog({}, generation), strategies: buildCatalog({}, generation) } };
    }
    state.invalidProofs ??= {};
    state.appliedUpdates ??= {};
    const library=new ResearchLibrary(root,git,state,revision);
    await library.prepareMethodSupport(state);return library;
  }

  private catalogInputV3(state:ResearchLibraryState):CatalogInputV3 {
    const validProof=(ref:ProofRef)=>{const current=state.proofs[ref.caseId];return !!current&&current.status==='valid'&&current.semanticRevision===ref.semanticRevision&&!state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`];};
    // Reconstruct exact saved Strategy metadata; live support gates delivery, and commit marks current invalid resources.
    const resources=Object.values(state.resources).filter(meta=>meta.enabled&&meta.status==='valid'&&this.methodSupportValid(meta,state));
    const eligible=new Map(resources.map(meta=>[catalogResourceIdV3(meta),meta]));
    const publication=state.knowledgeV3;
    const nodes=(publication?.nodes??[]).filter(node=>node.status==='active'&&(!publication?.supports[node.id]||validProof(publication.supports[node.id]!))&&(!node.authorityRef||eligible.has(catalogResourceIdV3(node.authorityRef))));
    const supports=Object.fromEntries(nodes.flatMap(node=>publication?.supports[node.id]?[[node.id,publication.supports[node.id]!]]:[]));
    return {generation:state.generation,resources,nodes,supports,edges:publication?.edges??[]};
  }
  private async catalogBodyTermsV3(input:CatalogInputV3,revision:string|undefined,previous?:CatalogIndexV3,files:Record<string,string>={}):Promise<Map<string,CatalogBodyTermsV3>> {
    const terms=new Map<string,CatalogBodyTermsV3>(),old=new Map(previous?.entries.filter(entry=>entry.meta).map(entry=>[catalogBodyKeyV3(entry.meta!),entry]));
    for(const meta of input.resources){if(!meta.catalogBodyHashV3)continue;
      const prior=old.get(catalogBodyKeyV3(meta));
      if(prior?.bodyHash===meta.catalogBodyHashV3&&prior.bodyTerms){terms.set(catalogBodyKeyV3(meta),{hash:prior.bodyHash,terms:prior.bodyTerms});continue;}
      const filename=`${resourcePath(meta)}/body.md`,sidecar=`${resourcePath(meta)}/catalog-terms-v3.json`;
      let publication:CatalogBodyTermsV3;
      if(files[filename]!==undefined){
        const body=files[filename],hash=createHash('sha256').update(body,'utf8').digest('hex');
        if(hash!==meta.catalogBodyHashV3)throw new CatalogUnavailableErrorV3('Exact catalog publication body hash mismatch.');
        publication={hash,terms:catalogTermsV3(body)};files[sidecar]=json({recipe:'hierarchy-index-v1',...publication});
      }else{
        if(!revision)throw new CatalogUnavailableErrorV3('Exact publication term sidecar is unavailable.');
        const saved=JSON.parse(new TextDecoder().decode(await this.git.read(revision,sidecar))) as CatalogBodyTermsV3&{recipe:string};
        if(saved.recipe!=='hierarchy-index-v1'||saved.hash!==meta.catalogBodyHashV3||!Array.isArray(saved.terms)||saved.terms.some(term=>typeof term!=='string'))throw new CatalogUnavailableErrorV3('Exact publication term sidecar binding mismatch.');
        publication={hash:saved.hash,terms:saved.terms};
      }
      terms.set(catalogBodyKeyV3(meta),publication);
    }
    return terms;
  }
  private async loadCatalogV3(pin:CatalogPinV3):Promise<PreparedCatalogIndexV3> {
    if(!validCatalogPinV3(pin))throw new CatalogUnavailableErrorV3('Invalid immutable catalog pin.');
    const key=`${pin.revision}:${pin.indexHash}`,cached=this.catalogCacheV3.get(key);if(cached){this.catalogCacheV3.delete(key);this.catalogCacheV3.set(key,cached);return cached;}
    const pending=(async()=>{
      try{
        const state=await this.readState(pin.revision);
        if(state.schemaVersion!==1||state.catalogV3?.recipe!==pin.recipe||state.catalogV3.indexHash!==pin.indexHash)throw new CatalogUnavailableErrorV3('Catalog pin is not bound to this exact checkpoint.');
        // Method ancestry metadata is read only while opening the pin; current withdrawal is checked on each use.
        for(const meta of Object.values(state.resources)){
          if(this.isV3Method(meta,state))await this.methodSupport.resolve(meta,async ref=>JSON.parse(new TextDecoder().decode(await this.git.read(pin.revision,`${resourcePath(ref)}/meta.json`))) as ResourceMeta);
          if(meta.strategySupport)await this.strategySupport.resolve(meta,async ref=>JSON.parse(new TextDecoder().decode(await this.git.read(pin.revision,`${resourcePath(ref)}/meta.json`))) as ResourceMeta);
        }
        const analyzer=state.catalogV3.analyzer??'surface-v1';
        const input=this.catalogInputV3(state);let index:CatalogIndexV3|undefined;
        try{
          const parsed=JSON.parse(new TextDecoder().decode(await this.git.read(pin.revision,'catalog/hierarchy-v3.json'))) as CatalogIndexV3;
          if(stableHash(parsed)===pin.indexHash&&(parsed.analyzer??'surface-v1')===analyzer){
            const expected=buildCatalogIndexV3(input,{analyzer,legacyShape:parsed.analyzer===undefined,bodyTerms:new Map(parsed.entries.filter(entry=>entry.meta&&entry.bodyHash&&entry.bodyTerms).map(entry=>[catalogBodyKeyV3(entry.meta!),{hash:entry.bodyHash!,terms:entry.bodyTerms!}]))});
            if(stableHash(expected)===pin.indexHash)index=expected;
          }
        }catch(error){if(isStorageAccessError(error))throw error;}
        if(!index){
          // Recovery is mechanical and local to the requested immutable revision, never the live state.
          index=buildCatalogIndexV3(input,{analyzer,legacyShape:state.catalogV3.analyzer===undefined,bodyTerms:await this.catalogBodyTermsV3(input,pin.revision)});
          if(stableHash(index)!==pin.indexHash)throw new CatalogUnavailableErrorV3('Exact checkpoint cannot reconstruct the pinned catalog hash.');
        }
        return prepareCatalogIndexV3(index);
      }catch(error){if(error instanceof CatalogUnavailableErrorV3)throw error;throw new CatalogUnavailableErrorV3('Immutable catalog checkpoint is unavailable.',{cause:error});}
    })();
    this.catalogCacheV3.set(key,pending);while(this.catalogCacheV3.size>4)this.catalogCacheV3.delete(this.catalogCacheV3.keys().next().value!);try{return await pending;}catch(error){if(this.catalogCacheV3.get(key)===pending)this.catalogCacheV3.delete(key);throw error;}
  }
  /** Small host-owned V3 policy view; does not scan or clone catalog resources. */
  decisionV3():DecisionFile {return structuredClone(this.state.decisions['2']);}
  /** Register canonical metadata only; reviewed associations and scientific edges remain author-owned. */
  private async synchronizeKnowledgeV4():Promise<void> {
    const current=this.state.knowledgeNetworkV4??emptyKnowledgeNetwork(),nodes:KnowledgeNode[]=[];
    for(const meta of Object.values(this.state.resources)){
      const prior=current.nodes.find(n=>n.ref.store==='library'&&n.ref.id===meta.id&&n.ref.version===meta.version);
      const bodyHash=meta.catalogBodyHashV3??prior?.ref.bodyHash??createHash('sha256').update(await this.readText(`${resourcePath(meta)}/body.md`),'utf8').digest('hex');
      const node:KnowledgeNode={ref:{store:'library',id:meta.id,version:meta.version,bodyHash},kind:meta.kind,title:meta.title??meta.name,summary:meta.description,conditions:[...meta.conditions],status:meta.enabled&&this.catalogResourceAvailableV3(meta)?'active':'withdrawn'};
      const {associations:_associations,...old}=prior??{};
      if(stableHash(old)!==stableHash(node))nodes.push(node);
    }
    if(!nodes.length&&this.state.knowledgeNetworkV4&&this.revision)return;
    const next=structuredClone(this.state);
    next.knowledgeNetworkV4=nodes.length?applyKnowledgeProposal(current,{owner:nodes[0]!.ref,purpose:'host-projection',allowedRefs:nodes.map(n=>n.ref),reviewed:false,receiptId:`library-projection:${current.revision}:${stableHash(nodes)}`,expectedRevision:current.revision,nodes}):current;
    await this.commit(next);
  }
  private async loadKnowledgeViewV4(revision:string):Promise<{prepared:PreparedKnowledgeNetwork;refs:KnowledgeRef[];metas:Map<string,ResourceMeta>}> {
    requireData(typeof revision==='string'&&/^[a-f0-9]{40,64}$/u.test(revision),'Invalid knowledge checkpoint.');
    const old=this.knowledgeCacheV4.get(revision);if(old)return old;
    const pending=(async()=>{
      const state=await this.readState(revision);
      requireData(state.schemaVersion===1&&state.knowledgeNetworkV4,'Knowledge checkpoint is unavailable.','NOT_FOUND');
      validateKnowledgeNetwork(state.knowledgeNetworkV4);
      const prepared=prepareKnowledgeNetwork(state.knowledgeNetworkV4,this.preparedKnowledgeV4),metas=new Map<string,ResourceMeta>(),refs:KnowledgeRef[]=[];
      this.preparedKnowledgeV4=prepared;
      const latestTheory=new Map<string,number>();for(const n of prepared.state.nodes)if(n.ref.store==='theory')latestTheory.set(n.ref.id,Math.max(latestTheory.get(n.ref.id)??0,n.ref.version));
      for(const node of prepared.state.nodes){
        if(node.status!=='active')continue;
        if(node.ref.store==='theory'){if(node.ref.version===latestTheory.get(node.ref.id))refs.push(node.ref);continue;}
        const meta=state.resources[node.ref.id];
        if(!meta||meta.version!==node.ref.version||!meta.enabled||meta.status!=='valid')continue;
        requireData(meta.kind===node.kind&&(!meta.catalogBodyHashV3||meta.catalogBodyHashV3===node.ref.bodyHash),'Knowledge metadata binding mismatch.','FORBIDDEN');
        const reader=async(ref:ResourceRef)=>JSON.parse(new TextDecoder().decode(await this.git.read(revision,`${resourcePath(ref)}/meta.json`))) as ResourceMeta;
        if(this.isV3Method(meta,state))await this.methodSupport.resolve(meta,reader);
        if(meta.strategySupport)await this.strategySupport.resolve(meta,reader);
        metas.set(knowledgeRefKey(node.ref),meta);refs.push(node.ref);
      }
      return {prepared,refs,metas};
    })();
    this.knowledgeCacheV4.set(revision,pending);while(this.knowledgeCacheV4.size>4)this.knowledgeCacheV4.delete(this.knowledgeCacheV4.keys().next().value!);
    try{return await pending;}catch(error){this.knowledgeCacheV4.delete(revision);throw error;}
  }
  async readDirectedRoutes(revision:string,query:DirectedRouteQuery,allowedTheories:(refs:KnowledgeRef[])=>Promise<KnowledgeRef[]>,workerGrants?:ResourceRef[]) {
    const frozen=await this.loadKnowledgeViewV4(revision);
    const refs=workerGrants?frozen.refs.filter(ref=>ref.store==='library'&&workerGrants.some(g=>g.id===ref.id&&g.version===ref.version)):frozen.refs;
    const allowed=await this.availableKnowledgeRefs(refs.filter(ref=>ref.store==='library'));
    allowed.push(...await allowedTheories(refs.filter(ref=>ref.store==='theory')));
    const current=await this.freezeKnowledgeView();
    return directedRoutePresentation(directedRouteSelection(frozen.prepared.state,query,allowed,current.network));
  }
  async freezeKnowledgeView():Promise<KnowledgeViewV4> {
    return this.serial(async()=>{await this.synchronizeKnowledgeV4();const view=await this.loadKnowledgeViewV4(this.revision!);return {revision:this.revision!,network:structuredClone(view.prepared.state),refs:structuredClone(view.refs)};});
  }
  private validateKnowledgeGrantV4(grant:KnowledgeReadGrantV4):void {
    requireData(!!grant&&['theory-study','theory-review','theorist-bootstrap','method-learning','strategy-learning'].includes(grant.purpose)&&Array.isArray(grant.allowedRefs)&&grant.allowedRefs.every(validKnowledgeRef),'An explicit knowledge-purpose grant is required.','FORBIDDEN');
  }
  async queryKnowledgeView(view:KnowledgeViewV4,query:KnowledgeQuery,grant:KnowledgeReadGrantV4):Promise<KnowledgeSelection> {
    this.validateKnowledgeGrantV4(grant);
    return this.serial(async()=>{
      requireData(!grant.revision||grant.revision===view.revision,'Knowledge grant checkpoint mismatch.','FORBIDDEN');
      const frozen=await this.loadKnowledgeViewV4(view.revision);
      requireData(stableHash(view.network)===stableHash(frozen.prepared.state)&&stableHash(view.refs)===stableHash(frozen.refs),'Knowledge view differs from its exact checkpoint.','FORBIDDEN');
      const authorized=new Set(grant.allowedRefs.map(knowledgeRefKey));
      const refs=frozen.refs.filter(ref=>{
        if(!authorized.has(knowledgeRefKey(ref)))return false;
        if(ref.store==='library'){const meta=frozen.metas.get(knowledgeRefKey(ref));return !!meta&&!!this.state.resources[ref.id]?.enabled&&this.catalogResourceAvailableV3(meta);}
        return this.state.knowledgeNetworkV4?.nodes.some(n=>knowledgeRefKey(n.ref)===knowledgeRefKey(ref)&&n.status==='active');
      });
      return queryKnowledge(frozen.prepared,query,refs);
    });
  }
  async readKnowledgeResource(ref:KnowledgeRef,grant:KnowledgeReadGrantV4):Promise<{meta:ResourceMeta;body:string}> {
    this.validateKnowledgeGrantV4(grant);
    requireData(validKnowledgeRef(ref)&&ref.store==='library'&&grant.allowedRefs.some(r=>knowledgeRefKey(r)===knowledgeRefKey(ref)),'Resource is outside this exact knowledge grant.','FORBIDDEN');
    return this.serial(async()=>{
      const revision=grant.revision??this.revision;requireData(revision,'Knowledge checkpoint is unavailable.','NOT_FOUND');
      if(grant.revision){const frozen=await this.loadKnowledgeViewV4(revision);requireData(frozen.refs.some(r=>knowledgeRefKey(r)===knowledgeRefKey(ref)),'Resource is not in this frozen checkpoint.','FORBIDDEN');}
      const read=async(filename:string)=>new TextDecoder().decode(await this.git.read(revision,filename));
      const meta=JSON.parse(await read(`${resourcePath(ref)}/meta.json`)) as ResourceMeta;
      requireData(meta.id===ref.id&&meta.version===ref.version&&(!meta.catalogBodyHashV3||meta.catalogBodyHashV3===ref.bodyHash),'Exact resource identity mismatch.','FORBIDDEN');
      if(this.isV3Method(meta))await this.methodSupport.resolve(meta,async r=>JSON.parse(await read(`${resourcePath(r)}/meta.json`)) as ResourceMeta);
      if(meta.strategySupport)await this.strategySupport.resolve(meta,async r=>JSON.parse(await read(`${resourcePath(r)}/meta.json`)) as ResourceMeta);
      requireData(this.state.resources[ref.id]?.enabled&&this.catalogResourceAvailableV3(meta),'Resource support was withdrawn.','STALE_SOURCE');
      const body=await read(`${resourcePath(ref)}/body.md`);
      requireData(createHash('sha256').update(body,'utf8').digest('hex')===ref.bodyHash,'Exact resource body hash mismatch.','FORBIDDEN');
      return {meta:structuredClone(meta),body};
    });
  }
  private async validateKnowledgeLibraryRefsV4(refs:KnowledgeRef[]):Promise<void> {
    requireData(Array.isArray(refs)&&refs.every(validKnowledgeRef),'Invalid exact knowledge references.');
    for(const ref of refs){if(ref.store!=='library')continue;
      const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
      if(this.isV3Method(meta))await this.methodSupport.resolve(meta,r=>this.readJsonAt<ResourceMeta>(`${resourcePath(r)}/meta.json`));
      if(meta.strategySupport)await this.strategySupport.resolve(meta,r=>this.readJsonAt<ResourceMeta>(`${resourcePath(r)}/meta.json`));
      requireData(meta.id===ref.id&&meta.version===ref.version&&this.state.resources[ref.id]?.enabled&&this.catalogResourceAvailableV3(meta),'Knowledge source is unavailable.','STALE_SOURCE');
      const hash=meta.catalogBodyHashV3??createHash('sha256').update(await this.readText(`${resourcePath(ref)}/body.md`),'utf8').digest('hex');
      requireData(hash===ref.bodyHash,'Knowledge source hash mismatch.','FORBIDDEN');
    }
  }
  private usedKnowledgeRefsV4(proposal:KnowledgeProposal):KnowledgeRef[] {
    // A granted but unused neighbour does not become a scientific dependency.
    return [proposal.owner,...(proposal.nodes??[]).map(n=>n.ref),...(proposal.composition?[proposal.composition.strategy,...proposal.composition.steps.map(s=>s.skill)]:[]),...(proposal.bindings??[]).flatMap(b=>[b.theory,b.subject]),...(proposal.links??[]).flatMap(l=>[l.from,l.to,...(l.theory?[l.theory]:[])])];
  }
  /** Version replacement is not withdrawal: recheck exact historical support without reading bodies. */
  async availableKnowledgeRefs(refs:KnowledgeRef[]):Promise<KnowledgeRef[]> {
    return this.serial(async()=>{const available:KnowledgeRef[]=[];
      for(const ref of refs){if(ref.store!=='library')continue;try{await this.validateKnowledgeLibraryRefsV4([ref]);available.push(structuredClone(ref));}
        catch(error){if(!(error instanceof LearningDataError)||!['STALE_SOURCE','NOT_FOUND','FORBIDDEN'].includes(error.code))throw error;}}
      return available;
    });
  }
  /** Read-only source fence usable by a map commit already holding this library's writer. */
  async knowledgeSourceAvailable(ref:KnowledgeRef):Promise<boolean>{try{await this.validateKnowledgeLibraryRefsV4([ref]);return ref.store==='library';}catch(error){if(error instanceof LearningDataError&&['STALE_SOURCE','NOT_FOUND','FORBIDDEN'].includes(error.code))return false;throw error;}}
  private async commitKnowledgeProposalV4(proposal:KnowledgeProposal):Promise<{revision:number;receiptId:string}> {
    const current=this.state.knowledgeNetworkV4??emptyKnowledgeNetwork();
    let network:KnowledgeNetworkState;
    try{network=applyKnowledgeProposal(current,proposal);}catch(error){throw new LearningDataError(current.revision!==proposal.expectedRevision?'CONFLICT':'INVALID_INPUT',error instanceof Error?error.message:'Invalid knowledge proposal.');}
    if(network.revision!==current.revision){const next=structuredClone(this.state);next.knowledgeNetworkV4=network;await this.commit(next);}
    return {revision:network.revision,receiptId:proposal.receiptId};
  }
  /** Trusted catalogue owner supplies reviewed theory references; this store rechecks library authority. */
  async projectKnowledge(proposal:KnowledgeProposal):Promise<{revision:number;receiptId:string}> {
    return this.serial(async()=>{
      requireData(proposal.owner?.store==='theory'&&['host-projection','theory-study'].includes(proposal.purpose),'Only the canonical theory owner may project theory knowledge.','FORBIDDEN');
      requireData((proposal.nodes??[]).every(n=>n.ref.store==='theory'),'Theory projection cannot rewrite library metadata.','FORBIDDEN');
      await this.validateKnowledgeLibraryRefsV4(this.usedKnowledgeRefsV4(proposal));
      return this.commitKnowledgeProposalV4(proposal);
    });
  }
  async publishKnowledgeProposal(proposal:KnowledgeProposal,authority:KnowledgePublicationAuthorityV4):Promise<{revision:number;receiptId:string}> {
    return this.serial(async()=>{
      const {actor,jobId,sources}=authority,receipt=this.state.appliedUpdates[jobId];
      requireData(proposal.owner?.store==='library'&&receipt?.kind==='resource'&&receipt.id===proposal.owner.id&&receipt.version===proposal.owner.version,'Knowledge owner must match its primary publication receipt.','FORBIDDEN');
      requireData(receipt.actor&&stableHash(receipt.actor)===stableHash(actor)&&receipt.sources&&stableHash(receipt.sources)===stableHash(sources),'Knowledge author and sources must match the primary publication.','FORBIDDEN');
      await this.validateSources(sources);await this.validateKnowledgeLibraryRefsV4(this.usedKnowledgeRefsV4(proposal));
      const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(proposal.owner)}/meta.json`);
      requireData(proposal.purpose===(meta.kind==='specific-strategy'?'strategy-learning':'method-learning'),'Knowledge author purpose mismatch.','FORBIDDEN');
      const replay=Object.hasOwn(this.state.knowledgeNetworkV4?.receipts??{},proposal.receiptId);
      if(actor.role==='theorist')this.theorist(actor);else if(!replay){const operation=this.reviewActor(actor,'v2-strategy');await this.validateStructuralReview(operation,true);requireData(sources.every(ref=>!('kind'in ref)&&operation.cases.some(c=>sameRef(c.ref,ref))&&operation.delivered.includes(sourceKey(ref))),'Strategy knowledge sources were not delivered in this review.','FORBIDDEN');}
      requireData((meta.kind==='specific-strategy')===(actor.role==='moderator'),'Knowledge resource ownership mismatch.','FORBIDDEN');
      for(const node of proposal.nodes??[])requireData(node.kind===meta.kind&&node.title===(meta.title??meta.name)&&node.summary===meta.description&&stableHash(node.conditions)===stableHash(meta.conditions),'Knowledge annotations cannot rewrite canonical resource metadata.','FORBIDDEN');
      return this.commitKnowledgeProposalV4(proposal);
    });
  }
  /** Freeze eligibility/version once; later ordinary preferences apply only to future pins. */
  async freezeCatalogV3():Promise<CatalogPinV3> {
    return this.serial(async()=>{
      if(!this.state.catalogV3||this.state.catalogV3.analyzer!=='descriptors-v2'||!this.revision)await this.commit(structuredClone(this.state),{},true);
      const pin:CatalogPinV3={recipe:'hierarchy-index-v1',revision:this.revision!,indexHash:this.state.catalogV3!.indexHash};
      await this.loadCatalogV3(pin);return pin;
    });
  }
  async freezeMethodNetworkV3(retrievalMode:'legacy'|'query-relevance-v2'|'query-relevance-v3',withDirectedRoutes=false):Promise<{catalogPin:CatalogPinV3;networkPin:NetworkPinV3}> {
    requireData(retrievalMode==='legacy'||retrievalMode==='query-relevance-v2'||retrievalMode==='query-relevance-v3','Unknown method network retrieval mode.');
    return this.serial(async()=>{
      if(withDirectedRoutes)await this.synchronizeKnowledgeV4();
      if(!this.state.methodNetworkManifestV3||!this.revision){const next=structuredClone(this.state);next.methodNetworkV3??=emptyMethodNetworkV3();await this.commit(next,{},true);}
      const manifest=this.state.methodNetworkManifestV3!,catalogPin:CatalogPinV3={recipe:'hierarchy-index-v1',revision:this.revision!,indexHash:manifest.catalogHash};
      const networkPin:NetworkPinV3={...(retrievalMode!=='legacy'?{retrievalRevision:retrievalMode}:{}),recipe:'method-network-v1',revision:this.revision!,catalogHash:manifest.catalogHash,networkHash:manifest.networkHash};
      await this.loadMethodNetworkV3(networkPin);return {catalogPin,networkPin};
    });
  }
  private async loadMethodNetworkV3(pin:NetworkPinV3):Promise<{network:PreparedNetworkV3;catalog:PreparedCatalogIndexV3;reconstructed?:boolean}> {
    requireData(validNetworkPinV3(pin),'Invalid method network pin.');
    const {retrievalRevision:_presentation,...identity}=pin;
    const key=stableHash(identity),cached=this.networkCacheV3.get(key);if(cached)return cached;
    const pending=(async()=>{
      const state=await this.readState(pin.revision);
      requireData(state.methodNetworkManifestV3?.recipe===pin.recipe&&state.methodNetworkManifestV3.catalogHash===pin.catalogHash&&state.methodNetworkManifestV3.networkHash===pin.networkHash&&state.methodNetworkV3,'Method network pin does not match checkpoint.');
      const catalog=await this.loadCatalogV3({recipe:'hierarchy-index-v1',revision:pin.revision,indexHash:pin.catalogHash});
      const canonical=buildMethodNetworkPreparationV3(state.methodNetworkV3!,catalog.index);
      requireData(canonical.hash===pin.networkHash,'Method network manifest or source hash mismatch.');
      let network:PreparedNetworkV3|undefined;
      try{network=canonical.prepare(JSON.parse(new TextDecoder().decode(await this.git.read(pin.revision,'catalog/method-network-v3.json'))) as NetworkIndexV3);}
      catch(error){if(isStorageAccessError(error))throw error;}
      // Derived views are replaceable; only exact canonical state may reconstruct a missing view.
      return {catalog,network:network??canonical.prepare(),...(!network?{reconstructed:true}:{})};
    })();
    this.networkCacheV3.set(key,pending);while(this.networkCacheV3.size>4)this.networkCacheV3.delete(this.networkCacheV3.keys().next().value!);
    try{return await pending;}catch(error){this.networkCacheV3.delete(key);throw error;}
  }
  private async currentFamiliesV3(pin:NetworkPinV3){
    if(this.revision===pin.revision)return undefined;
    const {networkPin}=await this.freezeMethodNetworkV3('query-relevance-v3');
    return (await this.loadMethodNetworkV3(networkPin)).network.clusters;
  }
  async queryMethodNetworkV3(pin:NetworkPinV3,query:NetworkQueryV3):Promise<NetworkSelectionV3> {
    const {network,catalog,reconstructed}=await this.loadMethodNetworkV3(pin);
    return queryMethodNetworkV3(network,pin,query,entry=>this.catalogEntryAvailableV3(entry,catalog,query.view==='directory'||query.view==='family'),reconstructed?' Derived navigation was reconstructed from this exact frozen checkpoint; no newer source was substituted.':'',query.view==='directory'||query.view==='family'?await this.currentFamiliesV3(pin):undefined);
  }
  async validateMethodNetworkSelectionV3(pin:NetworkPinV3,selection:NetworkSelectionV3,directed=false):Promise<void> {
    const {network,catalog}=await this.loadMethodNetworkV3(pin);
    validateMethodNetworkSelectionV3(network,pin,selection,()=>true);
    const current=directed&&selection.clusters.length?await this.currentFamiliesV3(pin):undefined;
    try{if(current&&selection.clusters.some(c=>current.get(c.id)?.revision!==c.revision))throw new Error('Route family changed.');
      validateMethodNetworkSelectionV3(network,pin,selection,entry=>this.catalogEntryAvailableV3(entry,catalog,directed));}
    catch(error){throw Object.assign(new Error('Previously delivered method navigation contains withdrawn sources.',{cause:error}),{code:'NETWORK_SELECTION_WITHDRAWN'});}
  }
  learningMethodNetworkV3(refs:ResourceRef[]) {
    const allowed=new Set(refs.map(catalogBodyKeyV3)),current=this.state.methodNetworkV3;
    const permitted=(ref:ResourceRef)=>{const meta=this.state.resources[ref.id];return allowed.has(catalogBodyKeyV3(ref))&&!!meta&&meta.version===ref.version&&meta.enabled&&this.catalogResourceAvailableV3(meta);};
    return {version:current?.version??0,routes:structuredClone((current?.routes??[]).filter(route=>route.status==='active'&&permitted(route.resourceRef)&&route.sourceRefs.every(permitted)&&route.alternatives.every(permitted)))};
  }
  /** Recheck only scientific navigation actually frozen for delivery, never unused metadata grants. */
  async validateLearningMethodNetworkV3(routes:readonly RouteTemplateV3[]):Promise<void> {
    const checked=new Set<string>();
    for(const route of routes)for(const ref of [route.resourceRef,...route.sourceRefs,...route.alternatives]){
      const key=catalogBodyKeyV3(ref);if(checked.has(key))continue;checked.add(key);
      const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
      if(this.isV3Method(meta,this.state))await this.methodSupport.resolve(meta,exact=>this.readJsonAt<ResourceMeta>(`${resourcePath(exact)}/meta.json`));
      if(meta.strategySupport)await this.strategySupport.resolve(meta,exact=>this.readJsonAt<ResourceMeta>(`${resourcePath(exact)}/meta.json`));
      requireData(meta.id===ref.id&&meta.version===ref.version&&meta.enabled&&this.catalogResourceAvailableV3(meta),'Frozen learning navigation source was withdrawn.','STALE_SOURCE');
    }
  }
  /** Metadata-only discovery across kinds/domains; these references do not grant any resource body. */
  async learningMethodNetworkCandidatesV3(query:string,refs:ResourceRef[],retrievalRevision?:'query-relevance-v2'|'query-relevance-v3') {
    requireData(retrievalRevision===undefined||retrievalRevision==='query-relevance-v2'||retrievalRevision==='query-relevance-v3','Unknown learning network retrieval revision.');
    const {networkPin}=await this.freezeMethodNetworkV3(retrievalRevision??'legacy');
    const queryInput={query,refs:refs.map(catalogResourceIdV3),maxNodes:32,maxChars:24576,maxHops:2};
    const loaded=await this.loadMethodNetworkV3(networkPin);
    const selection=retrievalRevision?queryLearningMethodNetworkV3(loaded.network,networkPin,queryInput,entry=>this.catalogEntryAvailableV3(entry,loaded.catalog)):await this.queryMethodNetworkV3(networkPin,queryInput);
    const wanted=new Set([...[...selection.routes,...selection.clusters.flatMap(cluster=>cluster.routes)].map(route=>`${route.ref.id}:${route.ref.version}`)]);
    const {network}=await this.loadMethodNetworkV3(networkPin);
    const current=network.index.publication,routes:typeof current.routes=[];let bytes=0;
    const candidates=retrievalRevision?[...wanted].map(key=>network.routes.get(key)!).filter(Boolean):current.routes;let truncated=selection.truncated;
    for(const route of candidates){if(!wanted.has(`${route.id}:${route.version}`))continue;
      const all=[route.resourceRef,...route.sourceRefs,...route.alternatives];
      if(all.some(ref=>{const meta=this.state.resources[ref.id];return !meta||meta.version!==ref.version||!meta.enabled||!this.catalogResourceAvailableV3(meta);}))continue;
      const size=Buffer.byteLength(JSON.stringify(route));if(bytes+size>24576){truncated=true;continue;}bytes+=size;routes.push(structuredClone(route));
    }
    const granted=new Map<string,ResourceRef>();for(const route of routes)for(const ref of [route.resourceRef,...route.sourceRefs,...route.alternatives])granted.set(catalogBodyKeyV3(ref),ref);
    return {version:current.version,routes,allowedRefs:structuredClone([...granted.values()]),navigationOnly:true as const,...(retrievalRevision?{retrievalRevision,truncated}: {})};
  }
  methodNetworkCheckpoint(){return {version:this.state.methodNetworkV3?.version??0,revision:this.revision};}
  async publishMethodNetworkV3(options:{proposal:unknown;owner:ResourceRef;sources:ProofRef[];jobId:string;expectedVersion:number;parentRevision?:string;actor:LearningActor;allowedRefs?:ResourceRef[]}):Promise<{status:'published'|'rejected';reason?:string;version?:number}> {
    const {owner,sources,jobId,expectedVersion,actor,proposal,allowedRefs=[]}=options;
    return this.serial(async()=>{
      requireData(typeof jobId==='string'&&jobId.length>0&&Number.isSafeInteger(expectedVersion)&&expectedVersion>=0,'Invalid method network publication binding.');
      const hash=stableHash(options),old=this.state.methodNetworkOutcomesV3?.[jobId];
      if(old){requireData(old.hash===hash,'Changed method network publication replay.','CONFLICT');const {hash:_hash,...result}=old;return structuredClone(result);}
      const publication=this.state.appliedUpdates[jobId];
      requireData(publication?.kind==='resource'&&publication.id===owner.id&&publication.version===owner.version,'Method network owner must match its primary publication receipt.','FORBIDDEN');
      await this.validateSources(sources);
      const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(owner)}/meta.json`);
      requireData(meta&&meta.id===owner.id&&meta.version===owner.version&&meta.enabled&&this.catalogResourceAvailableV3(meta),'Network owner is stale.','STALE_SOURCE');
      if(actor.role==='theorist')this.theorist(actor);else {const operation=this.reviewActor(actor,'v2-strategy');await this.validateStructuralReview(operation,true);requireData(sources.every(ref=>operation.cases.some(c=>sameRef(c.ref,ref))&&operation.delivered.includes(sourceKey(ref))),'Network Strategy sources must be delivered in this review.','FORBIDDEN');}
      requireData(actor.role==='moderator'?meta.kind==='specific-strategy':meta.kind==='method-skill','Network author purpose mismatch.','FORBIDDEN');
      requireData(sources.every(ref=>meta.sourceRefs.some(source=>!('kind'in source)&&sameRef(source,ref))&&usesV3Proof(this.state.proofs[ref.caseId]?.sourceLoopVersion)),'Network proposal requires exact qualified V3 owner sources.','FORBIDDEN');


      const current=this.state.methodNetworkV3??emptyMethodNetworkV3();
      const next=structuredClone(this.state);let outcome:{status:'published'|'rejected';reason?:string;version?:number};
      const baseline=current.version!==expectedVersion&&options.parentRevision?(await this.readState(options.parentRevision)).methodNetworkV3:undefined;
      try{
        if(current.version!==expectedVersion){
          const original=baseline??emptyMethodNetworkV3();
          const footprint=(graph:typeof current)=>{
            const route=graph.routes.find(r=>r.resourceRef.id===owner.id);
            return route?[route,graph.links.filter(l=>l.from.id===route.id||l.to.id===route.id)]:[];
          };
          if((!options.parentRevision&&expectedVersion!==0)||original.version!==expectedVersion||stableHash(footprint(original))!==stableHash(footprint(current)))
            throw Error('The saved card is available. Reassess its links against the changed route.');
        }
        const currentOwner=this.state.resources[owner.id];
        if(currentOwner?.version!==owner.version||!currentOwner.enabled)throw Error('The saved card was revised or disabled. Reassess its links.');
        next.methodNetworkV3=stageMethodNetworkV3(current,proposal,owner,allowedRefs,sources.some(ref=>this.state.proofs[ref.caseId]?.logicalRelation==='counterexample'));outcome={status:'published',version:next.methodNetworkV3.version};}
      catch(error){outcome={status:'rejected',reason:error instanceof Error?error.message:'Invalid optional network proposal.'};next.methodNetworkV3??=current;}
      if(outcome.status==='published'){
        const route=next.methodNetworkV3!.routes.find(r=>r.resourceRef.id===owner.id&&r.resourceRef.version===owner.version)!;
        const used=[...route.alternatives,...next.methodNetworkV3!.links.filter(link=>link.from.id===route.id&&link.from.version===route.version).flatMap(link=>link.sourceRefs)];
        try{for(const ref of used){const exact=await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);requireData(exact.id===ref.id&&exact.version===ref.version,'Exact network source identity binding mismatch.','FORBIDDEN');requireData(this.state.resources[ref.id]?.version===ref.version&&this.state.resources[ref.id]?.enabled&&this.catalogResourceAvailableV3(exact),'Used network source was revised or withdrawn.','STALE_SOURCE');}}
        catch(error){if(!(error instanceof LearningDataError)||error.code!=='STALE_SOURCE')throw error;outcome={status:'rejected',reason:error.message};next.methodNetworkV3=current;}
      }
      next.methodNetworkOutcomesV3={...next.methodNetworkOutcomesV3,[jobId]:{hash,...outcome}};
      await this.commit(next,{},true);return outcome;
    });
  }
  /** Host USER inspection, never a ResourceReader grant. Disabled valid resources stay inspectable. */
  inspectUserResources(): { generation: number; available: ResourceRef[]; network: UserResourceNetwork } {
    const available = Object.values(this.state.resources).filter(meta => this.catalogResourceAvailableV3(meta));
    const exact = new Set(available.filter(meta => meta.enabled).map(meta => JSON.stringify([meta.id, meta.version])));
    return { generation: this.state.generation, available: available.map(({ id, version }) => ({ id, version })),
      network: userResourceNetwork(this.state.methodNetworkV3, ref => exact.has(JSON.stringify([ref.id, ref.version]))) };
  }

  /** Exact current USER body inspection: no source bundles, freeze, persistence or model exposure. */
  async inspectUserResource(ref: ResourceRef, expectedGeneration: number): Promise<{ id: string; version: number; title: string; body: string }> {
    return this.inspectExactResource(ref,expectedGeneration,false);
  }

  maintenanceCheckpoint(){
    return {checkpoint:this.revision,mapVersion:this.state.knowledgeMapV4?.version,generation:this.state.generation};
  }

  async readMaintenanceResource(ref:ResourceRef,generation:number){
    return this.inspectExactResource(ref,generation,true);
  }

  async maintenanceSkillCandidates(kind:'method-skill'|'failure-skill',sources:LearningSource[],parents:Record<string,ResourceRef>){
    return this.serial(async()=>{
      const tags=new Set(sources.flatMap(ref=>'kind' in ref?this.state.failures[ref.id]?.tags??[]:
        this.derivedProofMetadata(ref)?.tags??this.state.proofs[ref.caseId]?.tags??[]));
      const matches=Object.values(this.state.resources).filter(resource=>{
        const parent=parents[`${kind}:${resource.semanticKey}`];
        return resource.kind===kind&&resource.maintenance&&!resource.maintenance.retired&&parent?.id===resource.id&&parent.version===resource.version&&(!resource.tags.length||resource.tags.some(tag=>tags.has(tag)));
      }).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,3);
      return Promise.all(matches.map(async meta=>{
        const {body}=await this.readMaintenanceResource(meta,this.state.generation);
        return {id:meta.id,version:meta.version,semanticKey:meta.semanticKey,title:meta.title??meta.name,conditions:meta.conditions,
          advisoryOnly:true,body:body.slice(0,16000),truncated:body.length>16000};
      }));
    });
  }

  private async inspectExactResource(ref:ResourceRef,expectedGeneration:number,maintenance:boolean){
    safeId(ref.id);
    requireData(Number.isSafeInteger(ref.version) && ref.version > 0 && Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0, 'Invalid inspection reference.');
    const validate = () => {
      requireData(this.state.generation === expectedGeneration, 'Capabilities changed. Refresh before reading.', 'CONFLICT');
      const meta = this.state.resources[ref.id];
      requireData(Object.hasOwn(this.state.resources,ref.id)&&meta, 'Resource is unavailable.', 'NOT_FOUND');
      requireData(meta.version === ref.version, 'Resource version changed. Refresh before reading.', 'CONFLICT');
      requireData((maintenance&&meta.maintenance)||this.catalogResourceAvailableV3(meta), 'Resource support was withdrawn or is unavailable.', 'STALE_SOURCE');
      return meta;
    };
    const meta = validate(), revision = this.revision;
    requireData(revision, 'Resource is unavailable.', 'NOT_FOUND');
    const original = JSON.parse(new TextDecoder().decode(await this.git.read(revision, `${resourcePath(ref)}/meta.json`))) as ResourceMeta;
    const identity = (value: ResourceMeta) => ({ ...value, enabled: undefined, status: undefined });
    requireData(stableHash(identity(original)) === stableHash(identity(meta)), 'Resource metadata binding mismatch.', 'FORBIDDEN');
    const body = new TextDecoder().decode(await this.git.read(revision, `${resourcePath(ref)}/body.md`));
    requireData(!meta.catalogBodyHashV3 || createHash('sha256').update(body, 'utf8').digest('hex') === meta.catalogBodyHashV3, 'Resource body hash mismatch.', 'FORBIDDEN');
    validate();
    return { id: ref.id, version: ref.version, title:meta.title??meta.name, body };
  }

  private catalogResourceAvailableV3(meta:ResourceMeta):boolean {
    const current=this.state.resources[meta.id];
    if(!current||meta.status!=='valid'||current.version===meta.version&&current.status!=='valid'||!this.resourceSupportValid(meta))return false;
    const evidence=this.state.resourceOptionalEvidence?.[catalogBodyKeyV3(meta)];
    if(evidence&&Object.entries(evidence.artifacts).some(([id,hash])=>this.state.v21OptionalEvidence?.[evidence.sessionId]?.[id]!==hash))return false;
    return meta.sourceRefs.every(ref=>{
      if(!('kind'in ref)){const current=this.state.proofs[ref.caseId];return !!current&&current.status==='valid'&&current.semanticRevision===ref.semanticRevision&&!this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`];}
      const current=this.state.failures[ref.id];if(!current||current.version!==ref.version||!current.scientific||current.sessionId!==ref.sessionId||current.attemptId!==ref.attemptId)return false;
      if(current.optionalArtifact)return this.state.v21OptionalEvidence?.[current.sessionId]?.[current.optionalArtifact.artifactId]===current.optionalArtifact.evidenceKey;
      return current.sourceLoopVersion!=='2.1'||this.state.v21ReviewEvidence?.[current.sessionId]?.[current.attemptId]===current.judgmentHash;
    });
  }
  private catalogEntryAvailableV3(entry:IndexedEntryV3,index:PreparedCatalogIndexV3,directed=false):boolean {
    const resource=entry.meta??entry.node.authorityRef;
    if(directed&&resource&&!this.state.resources[resource.id]?.enabled)return false;
    const status=this.knowledgeStatusesV3.get(entry.id);if(status==='revoked'||status==='needs-review')return false;
    if(entry.support){const ref=entry.support,current=this.state.proofs[ref.caseId];if(!current||current.status!=='valid'||current.semanticRevision!==ref.semanticRevision||this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`])return false;}
    if(entry.meta&&!this.catalogResourceAvailableV3(entry.meta))return false;
    if(entry.node.authorityRef){const meta=index.entries.get(catalogResourceIdV3(entry.node.authorityRef))?.meta;if(!meta||!this.catalogResourceAvailableV3(meta))return false;}
    return true;
  }
  async queryCatalogV3(pin:CatalogPinV3,query:CatalogQueryV3):Promise<CatalogSelectionV3> {
    const index=await this.loadCatalogV3(pin);return queryCatalogIndexV3(index,pin,query,entry=>this.catalogEntryAvailableV3(entry,index));
  }
  /** Exact support of pinned navigation nodes; ordinary later preferences/versions are irrelevant. */
  async catalogKnowledgeSourcesV3(pin:CatalogPinV3,ids:readonly string[]):Promise<ProofRef[]> {
    const index=await this.loadCatalogV3(pin),refs=new Map<string,ProofRef>();
    for(const id of ids){const entry=index.entries.get(id);requireData(entry,'Knowledge is outside this exact pinned catalog.','FORBIDDEN');
      requireData(this.catalogEntryAvailableV3(entry,index),'Pinned knowledge source was withdrawn.','STALE_SOURCE');
      if(entry.support)refs.set(stableHash(entry.support),structuredClone(entry.support));
    }
    return [...refs.values()];
  }
  async readCatalogNodeV3(pin:CatalogPinV3,id:string,directed=false):Promise<KnowledgeNodeV3> {
    const index=await this.loadCatalogV3(pin),entry=index.entries.get(id);
    requireData(entry,'Node is outside this exact pinned catalog.','FORBIDDEN');
    requireData(this.catalogEntryAvailableV3(entry,index,directed),'Pinned knowledge source was withdrawn.','STALE_SOURCE');
    return structuredClone(entry.node);
  }
  async catalogMetaV3(pin:CatalogPinV3,ref:ResourceRef,directed=false):Promise<ResourceMeta> {
    const index=await this.loadCatalogV3(pin),entry=index.entries.get(catalogResourceIdV3(ref));
    requireData(entry?.meta,'Resource version is outside this exact pinned catalog.','FORBIDDEN');
    requireData(this.catalogEntryAvailableV3(entry,index,directed),'Pinned resource source was withdrawn.','STALE_SOURCE');
    return structuredClone(entry.meta);
  }
  async readCatalogResourceV3(pin:CatalogPinV3,ref:ResourceRef,caller:ResourceReader,directed=false):Promise<{meta:ResourceMeta;body:string}> {
    requireData(caller.role==='theorist'&&caller.loopVersion===2,'Catalog resource discovery belongs to the V3 Theorist.','FORBIDDEN');this.theorist(caller);
    const meta=await this.catalogMetaV3(pin,ref,directed);
    const original=JSON.parse(new TextDecoder().decode(await this.git.read(pin.revision,`${resourcePath(ref)}/meta.json`))) as ResourceMeta;
    const identity=(value:ResourceMeta)=>({...value,enabled:undefined,status:undefined});
    requireData(stableHash(identity(original))===stableHash(identity(meta)),'Pinned resource metadata binding mismatch.','FORBIDDEN');
    const body=new TextDecoder().decode(await this.git.read(pin.revision,`${resourcePath(ref)}/body.md`));
    requireData(!meta.catalogBodyHashV3||createHash('sha256').update(body,'utf8').digest('hex')===meta.catalogBodyHashV3,'Pinned resource body hash mismatch.','FORBIDDEN');
    // A withdrawal during I/O cannot race through a successful read.
    await this.catalogMetaV3(pin,ref,directed);return {meta,body};
  }

  private isV3Method(meta:Pick<ResourceMeta,'kind'|'sourceRefs'|'methodSupport'>,state=this.state):boolean {
    return meta.kind==='method-skill'&&(!!meta.methodSupport||meta.sourceRefs.some(ref=>!('kind'in ref)&&usesV3Proof(state.proofs[ref.caseId]?.sourceLoopVersion)));
  }
  private async prepareMethodSupport(state:ResearchLibraryState):Promise<void> {
    for(const meta of Object.values(state.resources)){
      if(this.isV3Method(meta,state))await this.methodSupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      if(meta.strategySupport)await this.strategySupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
    }
  }
  private methodSupportValid(meta:ResourceMeta,state=this.state):boolean {
    if(!this.isV3Method(meta,state))return true;
    const support=this.methodSupport.get(meta);if(!support||support.unverified)return false;
    return support.refs.every(ref=>{const proof=state.proofs[ref.caseId];return proof?.status==='valid'&&proof.semanticRevision===ref.semanticRevision&&!state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`];});
  }
  private resourceSupportValid(meta:ResourceMeta,state=this.state):boolean {
    if(!this.methodSupportValid(meta,state))return false;
    if(!meta.strategySupport)return true;
    const support=this.strategySupport.get(meta);if(!support||support.unverified)return false;
    return support.refs.every(ref=>{const proof=state.proofs[ref.caseId];return proof?.status==='valid'&&proof.semanticRevision===ref.semanticRevision&&!state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`];});
  }
  private reportBlocksReuse(projectId:string,artifactId:string):boolean {
    const status=this.reportAssessment(projectId,artifactId)?.status;
    return status==='pending'||status==='queued'||this.opposingReportHeld(projectId,artifactId);
  }
  opposingReportHeld(projectId:string,artifactId:string):boolean {
    return this.state.reportUpdatesV4?.some(row=>{
      if(row.projectId!==projectId||row.opposingArtifactId!==artifactId)return false;
      const assessment=this.reportAssessment(projectId,row.artifactId);
      if(!assessment||assessment.status==='unsupported'||assessment.status==='conditional')return false;
      const proof=this.state.proofs[row.proofRef.caseId];
      return proof?.status==='valid'&&!this.state.invalidProofs[`${row.proofRef.caseId}:${row.proofRef.semanticRevision}`];
    })??false;
  }
  private pendingReportDependency(proof:ProofRecord,seen=new Set<string>()):boolean {
    if(!this.state.reportUpdatesV4?.length||seen.has(proof.caseId)||!proof.optionalProof)return false;
    seen.add(proof.caseId);
    const p=proof.optionalProof;
    return [p,...p.dependencies].some(s=>this.reportBlocksReuse(proof.sessionId,s.artifactId))
      ||p.v4TheorySupport?.sources.some(s=>this.reportBlocksReuse(s.projectId,s.artifactId))===true
      ||[...p.v3KnowledgeSources??[],...p.v4TheorySupport?.proofRefs??[]].some(r=>{const parent=this.state.proofs[r.caseId];return parent?.semanticRevision===r.semanticRevision&&this.pendingReportDependency(parent,seen);});
  }
  private resourceAvailable(meta:ResourceMeta,state=this.state):boolean {
    if(meta.status!=='valid'||!this.resourceSupportValid(meta,state))return false;
    const refs=[...meta.sourceRefs,...(this.strategySupport.get(meta)?.refs??[]),...(this.methodSupport.get(meta)?.refs??[])];
    return !this.state.reportUpdatesV4?.length||refs.every(ref=>'kind' in ref||this.isProofValid(ref));
  }

  knowledgeSourcesV3(ids:readonly string[]):ProofRef[] {
    const publication=this.state.knowledgeV3,refs:ProofRef[]=[];
    for(const id of ids){const node=publication?.nodes.find(n=>n.id===id);if(!node)continue;
      requireData(node.status==='active','Used knowledge is not active.','STALE_SOURCE');
      const ref=publication?.supports[id];if(ref){requireData(this.isProofValid(ref),'Used knowledge evidence was revoked.','STALE_SOURCE');if(!refs.some(r=>sameRef(r,ref)))refs.push(structuredClone(ref));}
      if(node.authorityRef){const r=this.state.resources[node.authorityRef.id];requireData(r&&r.version===node.authorityRef.version&&r.enabled&&this.resourceAvailable(r),'Used authority was revoked.','STALE_SOURCE');}
    }return refs;
  }
  knowledgeSnapshotV3() {
    const publication=structuredClone(this.state.knowledgeV3??emptyKnowledgePublicationV3());
    for(const node of publication.nodes)if(node.authorityRef){const resource=this.state.resources[node.authorityRef.id];if(!resource||resource.version!==node.authorityRef.version||!resource.enabled||!this.resourceAvailable(resource))node.status='revoked';}
    return publicationSnapshotV3(publication,ref=>this.isProofValid(ref));
  }
  async publishKnowledgeV3(candidates:unknown,refs:ProofRef[],jobId:string,expectedVersion:number,actor:LearningActor,reviewRevision?:KnowledgeReviewRevisionV3):Promise<void> {
    requireData(actor.role==='theorist','Knowledge review belongs to existing method learning.','FORBIDDEN');
    for(const ref of refs)this.theorist(actor,ref.sessionId);
    return this.serial(async()=>{
      await this.validateSources(refs);
      const sources=await Promise.all(refs.map(async ref=>({ref,document:await this.readFinalProof(ref,actor)})));
      const next=structuredClone(this.state);
      const current=next.knowledgeV3??emptyKnowledgePublicationV3();
      try { next.knowledgeV3=stageKnowledgePublicationV3(current,candidates,sources,jobId,expectedVersion,reviewRevision); }
      catch(error){
        if(!(error instanceof KnowledgeCandidateValidationErrorV3))throw error;
        // Reject the entire optional batch durably, without adding nodes or advancing the graph version.
        if(!current.rejections?.[jobId]){
          current.rejections={...current.rejections,[jobId]:structuredClone(error.outcome)};next.knowledgeV3=current;
          await this.commit(next); // Persistence failures remain fatal, never converted to candidate rejection.
        }
        throw error;
      }
      if(next.knowledgeV3.version===(this.state.knowledgeV3?.version??0))return; // Validated replay never re-enriches from mutable authority state.
      for(const node of [...next.knowledgeV3.nodes]){
        const support=next.knowledgeV3.supports[node.id];if(!support||node.kind==='case')continue;
        const source=sources.find(s=>sameRef(s.ref,support));
        const authorities=[...(source?.document.meta.optionalProof?.route.resourceRefs??[]),...Object.values(this.state.resources).filter(r=>r.sourceRefs.some(ref=>!('kind'in ref)&&sameRef(ref,support))).map(r=>({id:r.id,version:r.version}))];
        for(const ref of authorities){
          const resource=this.state.resources[ref.id];if(!resource||resource.version!==ref.version||!this.resourceAvailable(resource)||!resource.enabled)continue;
          const id='resource:'+ref.id+':'+ref.version;
          if(!next.knowledgeV3.nodes.some(n=>n.id===id))next.knowledgeV3.nodes.push({id,kind:resource.kind==='specific-strategy'?'strategy':'way-skill',title:resource.title??resource.name,summary:resource.description,keywords:resource.tags,conditions:resource.conditions,risk:['Resource guidance requires applicability judgment; not a proof of this question.'],sourceRef:id,authorityRef:ref,status:'active'});
          if(!next.knowledgeV3.edges.some(e=>e.from===node.id&&e.to===id&&e.relation==='related'))next.knowledgeV3.edges.push({from:node.id,to:id,relation:'related',sourceRef:node.sourceRef});
        }
      }
      await this.commit(next);
    });
  }
  learningEventTime(jobId:string,operationId?:string):string|undefined {
    const receipt=this.state.appliedUpdates[jobId];
    const resource=receipt?.kind==='resource'?this.state.resources[receipt.id]:undefined;
    if(resource && receipt.version===resource.version)return resource.updatedAt;
    if(resource && receipt.version===1)return resource.createdAt;
    return operationId?this.state.operations[operationId]?.createdAt:undefined;
  }
  /** Administrative snapshot; never supplied to an Agent or a plugin. */
  snapshot(): ResearchLibraryState {
    const view=structuredClone(this.state);
    for(const resource of Object.values(view.resources))if(!this.resourceSupportValid(resource)){
      resource.status='needs_review';const record=(resource.kind==='specific-strategy'?view.catalogs.strategies:view.catalogs.skills).records[resource.id];if(record)record.status='needs_review';
    }
    return view;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    requireData(!this.closed, 'Research library is closed.');
    const scope=this.publicationScope.getStore();
    if(scope?.active){
      const operation=scope.queue.then(action);scope.queue=operation.catch(()=>{});return operation;
    }
    const operation = this.queue.then(action); this.queue = operation.catch(() => {}); return operation;
  }
  /** Hold the writer across one learning result's authority check and sequential effects.
   * Trusted callbacks must await every effect; unrelated async callers retain normal queue order.
   * Commits remain individually durable/idempotent, not an all-or-nothing batch. */
  async withLearningPublication<T>(validate:()=>Promise<void>,publish:()=>Promise<T>):Promise<T> {
    requireData(!this.publicationScope.getStore()?.active,'Nested learning publication is unsupported.');
    return this.serial(async()=>{
      const scope={active:true,queue:Promise.resolve() as Promise<unknown>};
      try{return await this.publicationScope.run(scope,async()=>{
        await validate(); // After earlier queued mutations; scoped authority reads keep the same writer.
        return publish();
      });}
      finally{let pending;do{pending=scope.queue;await pending;}while(pending!==scope.queue);scope.active=false;}
    });
  }
  private async commit(next: ResearchLibraryState, files: Record<string, string> = {}, catalogV3=false): Promise<void> {
    await this.prepareMethodSupport(next);
    const changedMap=next.knowledgeMapV4?.version!==this.state.knowledgeMapV4?.version?next.knowledgeMapV4:undefined;
    for (const proof of Object.values(next.proofs)) {
      const provenance = proof.optionalProof;
      if (!provenance || proof.status !== 'valid') continue;
      const known = next.v21OptionalEvidence?.[proof.sessionId];
      const evidence = [{artifactId:provenance.artifactId,evidenceKey:provenance.artifactEvidenceKey},...provenance.dependencies];
      if(changedMap&&provenance.resultContract==='scoped-refutation-v1'){
        const observations=[provenance,...provenance.dependencies].flatMap(source=>source.mapKnowledge??[]).filter(read=>read.kind==='observation');
        for(const observation of observations){
          if(await this.knowledgeMap.evidenceValid(observation,'local-user',proof.sessionId,changedMap))continue;
          proof.status='needs_review';
          next.invalidProofs[`${proof.caseId}:${proof.semanticRevision}`]='needs_review';
          break;
        }
      }
      if (provenance.v4TheorySupport?.sources.some(source=>next.v21OptionalInvalidArtifacts?.[optionalArtifactKey(source.projectId,source.artifactId)]) || evidence.some(source=>next.v21OptionalInvalidArtifacts?.[optionalArtifactKey(proof.sessionId,source.artifactId)]
        || known?.[source.artifactId] !== undefined && known[source.artifactId] !== source.evidenceKey)) {
        proof.status = 'needs_review'; next.invalidProofs[`${proof.caseId}:${proof.semanticRevision}`] = 'needs_review';
      }
    }
    // Only actual adopted knowledge evidence propagates withdrawal, not related navigation links.
    let changed=true;
    while(changed){changed=false;for(const proof of Object.values(next.proofs)){
      if(proof.status!=='valid')continue;
      const adopted=[...(proof.optionalProof?.v3KnowledgeSources??[]),...(proof.optionalProof?.v4TheorySupport?.proofRefs??[])];
      if(adopted.some(ref=>next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`]||next.proofs[ref.caseId]?.status!=='valid'||next.proofs[ref.caseId]?.semanticRevision!==ref.semanticRevision)){
        proof.status='needs_review';next.invalidProofs[`${proof.caseId}:${proof.semanticRevision}`]='needs_review';changed=true;
      }
    }}
    for (const resource of Object.values(next.resources)) {
      const evidence = next.resourceOptionalEvidence?.[`${resource.id}:${resource.version}`];
      if (!this.resourceSupportValid(resource,next) || resource.sourceRefs.some(ref=>!('kind' in ref)&&next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`])
        || evidence && Object.entries(evidence.artifacts).some(([id,hash])=>next.v21OptionalEvidence?.[evidence.sessionId]?.[id] !== hash))
        resource.status = 'needs_review';
    }
    // A learned decision is not a reversible sum. Withdraw the affected policy as a
    // whole and append a neutral revision, rather than inventing weight subtraction.
    for (const loop of ['1', '2'] as const) {
      const supports = next.decisionSupport?.[loop];
      if (!supports) continue;
      for (const support of Object.values(supports).sort((a,b) => a.version-b.version)) {
        if (support.status !== 'valid') continue;
        const staleProof = support.proofRefs.some(ref => next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`]
          || next.proofs[ref.caseId]?.status !== 'valid' || next.proofs[ref.caseId]?.semanticRevision !== ref.semanticRevision);
        const staleRaw = support.rawEvidence && Object.entries(support.rawEvidence.judgments).some(([id, hash]) => next.v21ReviewEvidence?.[support.rawEvidence!.sessionId]?.[id] !== hash);
        const staleOptional = support.optionalEvidence && Object.entries(support.optionalEvidence.artifacts).some(([id, hash]) => next.v21OptionalEvidence?.[support.optionalEvidence!.sessionId]?.[id] !== hash);
        const staleParent = support.parentVersion !== undefined && supports[String(support.parentVersion)]?.status === 'needs_review';
        if (staleProof || staleRaw || staleOptional || staleParent) {
          support.status = 'needs_review'; support.reason = 'A supporting scientific source or inherited decision was withdrawn or changed.';
        }
      }
      const current = next.decisions[loop];
      if (supports[String(current.version)]?.status === 'needs_review') {
        const reset = { ...defaultDecision(Number(loop) as LoopVersion), version: current.version + 1, parentVersion: current.version };
        next.decisions[loop] = reset;
        supports[String(reset.version)] = { version: reset.version, parentVersion: current.version, status: 'neutral-reset',
          proofRefs: [], reason: 'Neutral baseline after source withdrawal; affected learned policy awaits new supported maintenance.' };
        files = { ...files, [`decisions/v${loop}.json`]: json(reset), [`decisions/v${loop}/revisions/${reset.version}.json`]: json(reset) };
      }
    }
    next.generation = this.state.generation + 1;
    next.catalogs = {
      proofs: buildCatalog(next.proofs, next.generation),
      skills: buildCatalog(Object.fromEntries(Object.entries(next.resources).filter(([, r]) => r.kind !== 'specific-strategy')), next.generation),
      strategies: buildCatalog(Object.fromEntries(Object.entries(next.resources).filter(([, r]) => r.kind === 'specific-strategy')), next.generation),
    };
    let catalogIndex:CatalogIndexV3|undefined;
    if(catalogV3||this.state.catalogV3||next.methodNetworkV3){
      let previous=this.catalogIndexV3;
      if(!previous&&this.state.catalogV3&&this.revision)previous=(await this.loadCatalogV3({recipe:'hierarchy-index-v1',revision:this.revision,indexHash:this.state.catalogV3.indexHash})).index;
      const catalogInput=this.catalogInputV3(next);
      catalogIndex=buildCatalogIndexV3(catalogInput,{previous,bodyTerms:await this.catalogBodyTermsV3(catalogInput,this.revision,previous,files)});
      next.catalogV3={recipe:'hierarchy-index-v1',indexHash:stableHash(catalogIndex),analyzer:catalogIndex.analyzer};
    }
    let networkIndex:NetworkIndexV3|undefined;
    if(next.methodNetworkV3&&catalogIndex){networkIndex=buildMethodNetworkV3(next.methodNetworkV3,catalogIndex);next.methodNetworkManifestV3={recipe:'method-network-v1',networkHash:stableHash(networkIndex),catalogHash:next.catalogV3!.indexHash};files['catalog/method-network-v3.json']=json(networkIndex);}
    const stored=await this.scientificText.encode(next,['knowledgeMapV4']);
    const revision = await this.git.commit({ ...files, 'state.json': json(stored), ...(catalogIndex?{'catalog/hierarchy-v3.json':json(catalogIndex)}:{}),
      'catalog/proofs.json': json(next.catalogs.proofs), 'catalog/skills.json': json(next.catalogs.skills),
      'catalog/strategies.json': json(next.catalogs.strategies),
    }, this.revision, 'Research library checkpoint', true);
    // Verify staged authority before publishing its single durable pointer.
    requireData(stableHash(await this.readState(revision)) === stableHash(next), 'Staged library failed verification.');
    if(catalogIndex)requireData(stableHash(JSON.parse(new TextDecoder().decode(await this.git.read(revision,'catalog/hierarchy-v3.json'))))===next.catalogV3!.indexHash,'Staged catalog index failed verification.');
    if(networkIndex)requireData(stableHash(JSON.parse(new TextDecoder().decode(await this.git.read(revision,'catalog/method-network-v3.json'))))===next.methodNetworkManifestV3!.networkHash,'Staged method network failed verification.');
    try { await atomicWrite(path.join(this.root, 'checkpoint.json'), json({ revision, previousRevision: this.revision })); }
    catch (error) {
      // A visible pointer must not be followed by a later write based on stale grants.
      // Still report uncertain durability; no proof/save acknowledgment is fabricated.
      if (error instanceof AtomicWriteError && error.published) { this.state = next; this.revision = revision; this.catalogIndexV3=catalogIndex;this.refreshKnowledgeStatusesV3(); }
      throw error;
    }
    this.state = next; this.revision = revision;this.catalogIndexV3=catalogIndex;this.refreshKnowledgeStatusesV3();
  }
  private async readJsonAt<T>(filename: string): Promise<T> {
    requireData(this.revision, 'Resource does not exist.', 'NOT_FOUND');
    return JSON.parse(new TextDecoder().decode(await this.git.read(this.revision, filename))) as T;
  }
  private async readText(filename: string): Promise<string> {
    requireData(this.revision, 'Resource does not exist.', 'NOT_FOUND');
    return new TextDecoder().decode(await this.git.read(this.revision, filename));
  }
  private theorist(actor: LearningActor, sessionId?: string): asserts actor is Extract<LearningActor, { role: 'theorist' }> {
    requireData(actor.role === 'theorist' && (!sessionId || actor.sessionId === sessionId), 'Theorist session scope required.', 'FORBIDDEN'); safeId(actor.sessionId);
  }
  private reviewActor(actor: LearningActor, purpose: ReviewPurpose): ReviewOperation {
    requireData(actor.role === 'moderator' && actor.purpose === purpose, 'Moderator task purpose mismatch.', 'FORBIDDEN');
    const operation = this.state.operations[actor.operationId];
    requireData(operation?.purpose === purpose && operation.status === 'running', 'A running isolated review task is required.', 'FORBIDDEN');
    return operation;
  }

  async publishProof(input: ProofInput, actor: LearningActor, expectedRevision?: number): Promise<ProofRef> {
    this.theorist(actor, input.sessionId);
    safeId(input.sessionId); safeId(input.hypothesisId);
    for (const [label, value] of Object.entries({ hypothesisRevision: input.hypothesisRevision, targetKey: input.targetKey, target: input.target, methodKey: input.methodKey, ...(modernOptionalRevision(input.optionalProof?.operationRevision)?{}:{summary: input.summary}), proof: input.proof, linkReason: input.linkReason })) requireText(value, label);
    if(modernOptionalRevision(input.optionalProof?.operationRevision)) requireData(typeof input.summary==='string','Optional archive summary must be text.');
    const scoped = input.optionalProof?.resultContract === 'scoped-refutation-v1';
    if(scoped)requireData(input.sourceLoopVersion==='4.0'&&input.optionalProof?.operationRevision==='v4-proof-5'&&input.optionalProof.modelDirectedKnowledge===true
      &&input.optionalProof.authorRole!=='auxiliary-worker','Scoped root conclusions require a qualified Theorist or Way Worker under the frozen V4 knowledge contract.');
    requireData(input.rootClosed === true && input.reproducible === true && (['direct', 'equivalent', 'sufficient', 'counterexample'].includes(input.logicalRelation)
      || scoped && ['empirical-exclusion','contradiction'].includes(input.logicalRelation)), 'Only a reproducible, closed root argument may enter the proof library.');
    requireData(Array.isArray(input.conditions) && input.conditions.every(c => typeof c === 'string' && !!c.trim()), 'Explicit proof conditions must be strings.');
    const tags = normalizeTags(input.tags);
    return this.serial(async () => {
      if(input.sourceLoopVersion==='0') requireData(input.v0OriginalAnswers?.length===1 && input.v0OriginalAnswers.every(ref=>ref.projectId===input.sessionId && ref.protocolVersion==='v0-native-1' && ref.completeness==='complete' && !this.state.v0InvalidOriginals?.[stableHash(ref)]),'V0 archive original is invalid or withdrawn.','STALE_SOURCE');
      if (input.optionalProof) {
        const provenance = input.optionalProof;
        if(provenance.v4TheorySupport){
          requireData(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(provenance.operationRevision??'')&&Array.isArray(provenance.v4TheorySupport.sources)&&Array.isArray(provenance.v4TheorySupport.proofRefs),'Theory proof support requires the revision-2 contract.');
          for(const source of provenance.v4TheorySupport.sources){
            requireText(source.projectId,'theory source project',1000);requireText(source.artifactId,'theory source artifact',1000);
            requireData(!this.state.v21OptionalInvalidArtifacts?.[optionalArtifactKey(source.projectId,source.artifactId)],'Theory support was withdrawn.','STALE_SOURCE');
          }
          if(provenance.v4TheorySupport.proofRefs.length){
            await this.validateSources(provenance.v4TheorySupport.proofRefs);
            requireData(provenance.v4TheorySupport.proofRefs.every(ref=>this.state.proofs[ref.caseId]?.logicalRelation!=='empirical-exclusion'),'Empirical comparisons cannot establish a theoretical premise.');
          }
        }
        if(provenance.v3KnowledgeSources?.length){requireData(['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(provenance.operationRevision??''),'Knowledge dependencies require V3.');await this.validateSources(provenance.v3KnowledgeSources);}
        if(provenance.acceptedOutcome.resultKind==='supported-result'||provenance.acceptedOutcome.resultKind==='valid-refutation')
          requireData(!provenance.v3KnowledgeSources?.some(ref=>this.state.proofs[ref.caseId]?.logicalRelation==='empirical-exclusion'),'Empirical conclusions cannot supply mathematical knowledge premises.');
        if(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(provenance.operationRevision??''))for(const dependency of provenance.dependencies){
          if(dependency.kind==='fragment')requireData(['v4-proof-2','v4-proof-3','v4-proof-4'].includes(provenance.operationRevision??'')&&!!dependency.publicStage&&dependency.acceptedOutcome===undefined,'Fragment provenance must retain canonical local evidence.');
          else if(dependency.kind==='continuation')requireData(dependency.authorRole==='theorist'&&dependency.originalOutcome.resultKind==='open'&&dependency.acceptedOutcome===undefined,'Continuation provenance must remain an unqualified own draft.');
          else if(dependency.kind==='refutation-evidence'){
            const evidence=dependency.acceptedOutcome;
            const parents=[provenance.acceptedOutcome,...provenance.dependencies.map(d=>d.acceptedOutcome??('originalOutcome' in d?d.originalOutcome:undefined))]
              .filter(outcome=>outcome?.dependencyArtifactIds.includes(dependency.artifactId));
            requireData(scoped&&(evidence.resultKind==='valid-refutation'||evidence.resultKind==='empirical-exclusion')&&parents.length>0
              &&parents.every(outcome=>outcome?.resultKind===evidence.resultKind&&outcome.refutationKind===evidence.refutationKind),'A refutation dependency requires a matching negative conclusion.');
          }else requireData(dependency.acceptedOutcome?.resultKind==='supported-result','Positive archived premises must remain supported results.');
        }
        if(modernOptionalRevision(provenance.operationRevision)) {
          const outcome=provenance.acceptedOutcome;
          const eligible=validTagsV21(outcome.tags)&&!!outcome.outline?.length&&outcome.outline.every(line=>typeof line==='string'&&!!line.trim());
          requireData(provenance.conditionsRole==='host-root-context'&&stableHash(input.conditions)===stableHash(provenance.root.conditions)
            &&provenance.learningEligibility===(eligible?'eligible':'metadata-incomplete')
            &&stableHash(input.tags)===stableHash(validTagsV21(outcome.tags)?outcome.tags:[])
            &&input.summary===(outcome.outline??[]).join('\n'),'Optional archive context and learning metadata must retain their declared meaning.');
        }

        requireData((input.sourceLoopVersion === '4.0' ? ['v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(provenance.operationRevision??'') : input.sourceLoopVersion === (['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(provenance.operationRevision??'')?'3.0':'2.1')) && provenance.originalRef.projectId === input.sessionId
          && provenance.originalRef.owner === input.sessionId && provenance.originalRef.completeness === 'complete'
          && provenance.root.hypothesisId === input.hypothesisId && provenance.root.revision === input.hypothesisRevision
          && provenance.route.methodKey === input.methodKey && ['theorist','auxiliary-worker','way-worker'].includes(provenance.authorRole)
          && provenance.acceptedOutcome.scope === 'root' && provenance.acceptedOutcome.resultKind !== 'open'
          && provenance.acceptedOutcome.reproducible && !provenance.acceptedOutcome.gaps.length,
        'Optional proof provenance must identify an exact qualified root original.');
        requireData(![provenance.artifactId, ...provenance.dependencies.map(ref => ref.artifactId)]
          .some(id => this.state.v21OptionalInvalidArtifacts?.[optionalArtifactKey(input.sessionId,id)]),
        'Optional proof or adopted source was withdrawn.', 'STALE_SOURCE');
        const sources = [{artifactId:provenance.artifactId,evidenceKey:provenance.artifactEvidenceKey},...provenance.dependencies];
        requireData(sources.every(source=>/^[a-f0-9]{64}$/u.test(source.evidenceKey))
          && provenance.evidenceKey === stableHash({artifact:provenance.artifactEvidenceKey,dependencies:provenance.dependencies.map(source=>source.evidenceKey)}),
        'Optional archive requires exact source evidence keys.');
        requireData(sources.every(source=>this.state.v21OptionalEvidence?.[input.sessionId]?.[source.artifactId] === undefined
          || this.state.v21OptionalEvidence[input.sessionId]![source.artifactId] === source.evidenceKey),
        'Optional archive scientific judgment changed before publication.','STALE_SOURCE');
        const relation=optionalArchiveRelation(provenance.acceptedOutcome,provenance.resultContract);
        requireData(input.logicalRelation===relation||!scoped&&relation==='direct'&&['equivalent','sufficient'].includes(input.logicalRelation),'Archived relation differs from its qualified result.');
        if(scoped){
          requireData(input.linkReason===provenance.acceptedOutcome.reason,'Scoped archive must preserve the exact scientific conclusion.');
          for(const source of [provenance,...provenance.dependencies]){
            const outcome=source.acceptedOutcome??('originalOutcome' in source?source.originalOutcome:undefined);
            requireData(outcome,'Scoped archive lacks an outcome.');
            if(source.acceptedOutcome)requireData(outcome.resultKind!=='open'&&outcome.reproducible===true&&!outcome.gaps.length,'Adopted archive evidence must retain its scientific qualification.');
            const reads=source.mapKnowledge??[];
            const cited=new Set((outcome.knowledgeRefs??[]).filter(ref=>/^(map_|source_)/u.test(ref)));
            requireData(cited.size===reads.length&&reads.every(read=>cited.delete(read.selection)),'Archive must retain each exact cited map read.');
            const issue=scopedOutcomeIssue(outcome,reads);
            requireData(!issue,issue??'Invalid scoped result.');
            for(const read of reads){
              requireData(this.state.knowledgeMapV4&&await this.knowledgeMap.evidenceValid(read,'local-user',input.sessionId),'Archived map evidence changed before publication.','STALE_SOURCE');
            }
          }
        }else{
          requireData([provenance,...provenance.dependencies].every(source=>!(source.mapKnowledge??[]).some(read=>read.kind==='observation')
            &&(!source.acceptedOutcome||source.acceptedOutcome.resultKind!=='empirical-exclusion'&&source.acceptedOutcome.refutationKind===undefined)
            &&(!('originalOutcome' in source)||source.originalOutcome.resultKind!=='empirical-exclusion'&&source.originalOutcome.refutationKind===undefined)),'A historical archive cannot acquire scoped evidence or conclusions.');
        }
        const originals = [{artifactId:provenance.artifactId,originalRef:provenance.originalRef},...provenance.dependencies];
        requireData(input.optionalOriginalBodies && Object.keys(input.optionalOriginalBodies).length === originals.length,
          'Optional archive must preserve each exact original separately.');
        for (const original of originals) {
          const body = input.optionalOriginalBodies[original.artifactId];
          requireData(typeof body === 'string' && Buffer.byteLength(body,'utf8') === original.originalRef.byteLength
            && createHash('sha256').update(body,'utf8').digest('hex') === original.originalRef.bodyHash,
          'Optional archive original byte integrity mismatch.');
        }
        requireData(input.proof === input.optionalOriginalBodies[provenance.artifactId], 'The archived main proof must be the unchanged author original.');
      }
      const prior = Object.values(this.state.proofs).find(p => p.sessionId === input.sessionId && (input.optionalProof
        ? p.optionalProof?.artifactId === input.optionalProof.artifactId
        : !p.optionalProof && p.hypothesisId === input.hypothesisId && p.methodKey === input.methodKey));
      if (prior?.optionalProof && input.optionalProof) requireData(prior.optionalProof.authorRole === input.optionalProof.authorRole
        && prior.optionalProof.resultContract === input.optionalProof.resultContract
        && stableHash(prior.optionalProof.originalRef) === stableHash(input.optionalProof.originalRef)
        && prior.optionalProof.caseGroupId === input.optionalProof.caseGroupId,
      'An optional artifact cannot change its author, exact original or case lineage.', 'CONFLICT');
      const contentHash = stableHash({ target: input.target, hypothesisRevision: input.hypothesisRevision, targetKey: input.targetKey,
        methodKey: input.methodKey, conditions: input.conditions, summary: input.summary, proof: input.proof,
        logicalRelation: input.logicalRelation, linkReason: input.linkReason, sourceRefs: input.sourceRefs ?? [],
        ...(input.evidenceChapters?.length ? { evidenceChapters: input.evidenceChapters } : {}),
        ...(input.sourceLoopVersion === '0' ? {sourceLoopVersion:'0',v0OriginalAnswers:input.v0OriginalAnswers} : input.sourceLoopVersion ? { sourceLoopVersion: input.sourceLoopVersion, originalAnswers: input.originalAnswers ?? [] } : {}),
        ...(input.optionalProof ? {optionalProof:{...input.optionalProof,evidenceRevision:undefined}} : {}) });
      if (prior?.status === 'valid' && prior.contentHash === contentHash && stableHash(prior.tags) === stableHash(tags)) return proofRef(prior);
      // Recover a committed identical submission before checking optimistic concurrency.
      if (expectedRevision !== undefined) requireData((prior?.revision ?? 0) === expectedRevision, 'Proof revision changed.', 'CONFLICT');
      if (prior && !input.semanticChange) requireData(prior.status === 'valid' && prior.targetKey === input.targetKey && stableHash(prior.conditions) === stableHash(input.conditions)
        && prior.logicalRelation === input.logicalRelation, 'Changed target, conditions or logical direction requires a semantic revision.');
      const next = structuredClone(this.state), now = new Date().toISOString();
      const proofNumber = prior?.proofNumber ?? ((next.nextProof[input.sessionId] ?? 0) + 1);
      next.nextProof[input.sessionId] = Math.max(next.nextProof[input.sessionId] ?? 0, proofNumber);
      const record: ProofRecord = {
        sessionId: input.sessionId, caseId: prior?.caseId ?? `${input.sessionId}:proof-${proofNumber}`,
        hypothesisId: input.hypothesisId, hypothesisRevision: input.hypothesisRevision, proofNumber,
        revision: (prior?.revision ?? 0) + 1, semanticRevision: prior ? prior.semanticRevision + (input.semanticChange ? 1 : 0) : 1,
        contentHash, targetKey: input.targetKey, target: input.target, methodKey: input.methodKey, conditions: [...input.conditions], tags,
        sourceRefs: [...(input.sourceRefs ?? [])], logicalRelation: input.logicalRelation, linkReason: input.linkReason,
        ...(input.evidenceChapters?.length ? { evidenceChapters: structuredClone(input.evidenceChapters) } : {}),
        ...(input.previousHypothesisId ? { previousHypothesisId: input.previousHypothesisId } : {}),
        ...(input.sourceLoopVersion === '0' ? {sourceLoopVersion:'0' as const,v0OriginalAnswers:structuredClone(input.v0OriginalAnswers),archiveOperationId:input.archiveOperationId} : input.sourceLoopVersion ? {sourceLoopVersion: input.sourceLoopVersion, ...(!input.optionalProof?{originalAnswers:structuredClone(input.originalAnswers ?? [])}:{}), archiveOperationId: input.archiveOperationId} : {}),
        ...(input.optionalProof ? {optionalProof:structuredClone(input.optionalProof)} : {}),
        status: 'valid', createdAt: prior?.createdAt ?? now, updatedAt: now,
        createdBy: prior?.createdBy ?? structuredClone(actor), updatedBy: structuredClone(actor),
      };
      next.proofs[record.caseId] = record;
      if (prior?.optionalProof && prior.semanticRevision !== record.semanticRevision) {
        next.invalidProofs[`${prior.caseId}:${prior.semanticRevision}`] = 'needs_review';
        for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source)
          && source.caseId === prior.caseId && source.semanticRevision === prior.semanticRevision)) resource.status = 'needs_review';
      }
      const base = proofPath(record);
      await this.commit(next, { [`${base}/meta.json`]: json(record), [`${base}/summary.md`]: input.summary, [`${base}/proof.md`]: input.proof,
        ...Object.fromEntries(Object.entries(input.optionalOriginalBodies ?? {}).map(([id,body])=>[`${base}/originals/${stableHash(id)}.md`,body])),
        [`sessions/${record.sessionId}/proofs/proof-${proofNumber}/current.json`]: json(proofRef(record)) });
      return proofRef(record);
    });
  }

  /** Exact immutable proof bytes; callers expose only this through a scoped reader. */
  private async proofDocument(ref: ProofRef): Promise<ProofDocument> {
    safeId(ref.sessionId);
    requireData(ref.caseId.startsWith(`${ref.sessionId}:proof-`) && Number.isSafeInteger(ref.revision) && ref.revision > 0, 'Invalid frozen proof reference.');
    const base = proofPath(ref), meta = await this.readJsonAt<ProofRecord>(`${base}/meta.json`);
    requireData(sameRef(proofRef(meta), ref), 'Frozen proof identity or fingerprint mismatch.', 'FORBIDDEN');
    meta.status = this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] ?? (this.pendingReportDependency(meta)?'needs_review':meta.status);
    for(const source of meta.optionalProof?[meta.optionalProof,...meta.optionalProof.dependencies]:[])for(const read of source.mapKnowledge??[])if(!await this.knowledgeMap.evidenceValid(read,'local-user',ref.sessionId))meta.status='needs_review';
    const originals = meta.optionalProof ? await Promise.all([meta.optionalProof,...meta.optionalProof.dependencies].map(async original => {
      const body = await this.readText(`${base}/originals/${stableHash(original.artifactId)}.md`);
      requireData(Buffer.byteLength(body,'utf8') === original.originalRef.byteLength
        && createHash('sha256').update(body,'utf8').digest('hex') === original.originalRef.bodyHash,'Archived optional original integrity mismatch.');
      const provenanceKind=original.artifactId===meta.optionalProof!.artifactId?'final-proof' as const
        :'kind'in original&&(original.kind==='continuation'||original.kind==='refutation-evidence')?original.kind:'positive-premise' as const;
      return {artifactId:original.artifactId,authorRole:original.authorRole,originalRef:structuredClone(original.originalRef),body,...(['v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(meta.optionalProof?.operationRevision??'')?{provenanceKind}:{})};
    })) : undefined;
    return { meta, summary: await this.readText(`${base}/summary.md`), proof: await this.readText(`${base}/proof.md`), ...(originals?{originals}:{}) };
  }
  /** Derived metadata is usable only for its unchanged, qualified original source. */
  derivedProofMetadata(ref: ProofRef): DerivedProofMetadata | undefined {
    const value = this.state.optionalProofMetadata?.[stableHash(ref)];
    const current = this.state.proofs[ref.caseId], provenance = current?.optionalProof;
    if (!value || value.recipeVersion !== 'optional-metadata-v1' || !current || !provenance
      || !sameRef(proofRef(current), ref) || !sameRef(value.proofRef, ref) || !this.isProofValid(ref)
      || !modernOptionalRevision(provenance.operationRevision) || value.evidenceKey !== provenance.evidenceKey
      || stableHash(value.originalHashes) !== stableHash([provenance.originalRef, ...provenance.dependencies.map(source => source.originalRef)].map(source => source.bodyHash))
      || !validTagsV21(value.tags) || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 100000
      || [{artifactId: provenance.artifactId, evidenceKey: provenance.artifactEvidenceKey}, ...provenance.dependencies]
        .some(source => this.state.v21OptionalInvalidArtifacts?.[optionalArtifactKey(ref.sessionId, source.artifactId)]
          || this.state.v21OptionalEvidence?.[ref.sessionId]?.[source.artifactId] !== source.evidenceKey)) return undefined;
    return structuredClone(value);
  }
  /** One durable derivation from exact archived originals; never changes proof identity. */
  async recordDerivedProofMetadata(ref: ProofRef, metadata: {tags: string[]; summary: string}, actor: LearningActor,
    derivationId: string, optionalEvidence: OptionalDecisionEvidence): Promise<void> {
    this.theorist(actor, ref.sessionId);
    requireText(derivationId, 'metadata derivation identity', 1000);
    requireData(validTagsV21(metadata.tags), 'Derived proof tags need valid dimensioned classification.');
    requireText(metadata.summary, 'derived proof summary', 100000);
    return this.serial(async () => {
      await this.validateSources([ref]);
      const current = this.state.proofs[ref.caseId], provenance = current?.optionalProof;
      requireData(current && sameRef(proofRef(current), ref) && ['2.1','3.0','4.0'].includes(current.sourceLoopVersion??'')
        && provenance && modernOptionalRevision(provenance.operationRevision) && provenance.acceptedOutcome.scope === 'root'
        && provenance.acceptedOutcome.resultKind !== 'open' && provenance.acceptedOutcome.reproducible
        && !provenance.acceptedOutcome.gaps.length, 'Metadata requires the exact current qualified operation9 archive.', 'STALE_SOURCE');
      requireData(optionalEvidence.sessionId === ref.sessionId && Object.keys(optionalEvidence.artifacts).length > 0
        && Object.entries(optionalEvidence.artifacts).every(([id, hash]) => this.state.v21OptionalEvidence?.[ref.sessionId]?.[id] === hash)
        && [{artifactId: provenance.artifactId, evidenceKey: provenance.artifactEvidenceKey}, ...provenance.dependencies]
          .every(source => !this.state.v21OptionalInvalidArtifacts?.[optionalArtifactKey(ref.sessionId, source.artifactId)]
            && optionalEvidence.artifacts[source.artifactId] === source.evidenceKey),
      'Derived metadata requires current evidence for every adopted original.', 'STALE_SOURCE');
      const value: DerivedProofMetadata = {recipeVersion: 'optional-metadata-v1', derivationId,
        proofRef: structuredClone(ref), evidenceKey: provenance.evidenceKey,
        originalHashes: [provenance.originalRef, ...provenance.dependencies.map(source => source.originalRef)].map(source => source.bodyHash),
        tags: normalizeTags(metadata.tags), summary: metadata.summary};
      const key = stableHash(ref), prior = this.state.optionalProofMetadata?.[key];
      if (prior) {
        requireData(stableHash(prior) === stableHash(value), 'Derived proof metadata is immutable for this exact source.', 'CONFLICT');
        return;
      }
      const next = structuredClone(this.state); next.optionalProofMetadata ??= {}; next.optionalProofMetadata[key] = value;
      await this.commit(next);
    });
  }
  private learningTags(proof: ProofRecord): string[] {
    return this.derivedProofMetadata(proofRef(proof))?.tags ?? proof.tags;
  }
  /** Metadata-only completion check; wording revisions do not revoke earlier proofs. */
  reportUpdates(projectId:string){return structuredClone((this.state.reportUpdatesV4??[]).filter(row=>row.projectId===projectId));}
  reportAssessment(projectId:string,artifactId:string){
    const rows=this.state.reportUpdatesV4?.filter(row=>row.projectId===projectId&&row.artifactId===artifactId);
    const active=rows?.findLast(row=>row.status!=='queued');
    if(active?.status==='pending'||active?.status==='unsupported')return active;
    return rows?.find(row=>row.status==='queued'&&rows.findLast(r=>r.id===row.id)?.status==='queued')??active;
  }
  async assessArchivedReport(report:import('../research/versions/v4/post-report.js').ReportEvidenceV45,objection:import('./report-assessment.js').ReportObjection,decision?:import('./report-assessment.js').ReportDecision,opposingArtifactId?:string){
    return this.serial(async()=>{
      const {scope,artifactId,bodyHash}=report, updates=this.state.reportUpdatesV4??[], id='assessment_'+stableHash([scope,artifactId,bodyHash,objection]);
      const prior=updates.findLast(row=>row.id===id),current=updates.findLast(row=>row.projectId===scope.projectId&&row.artifactId===artifactId&&row.status!=='queued');
      if(prior&&prior.status!=='queued'&&(!decision||prior.status!=='pending')){
        requireData(!decision||prior.decisionHash===stableHash(decision),'A different review decision was already recorded.','CONFLICT');
        return structuredClone(prior);
      }
      requireData(!decision||prior?.status==='pending'&&current?.id===id,'The objection is no longer current.','STALE_SOURCE');
      const proof=Object.values(this.state.proofs).find(row=>row.sessionId===scope.projectId&&row.optionalProof?.artifactId===artifactId&&row.optionalProof.originalRef.epochId===scope.epochId);
      requireData(proof&&(proof.status==='valid'||current?.proofRef&&sameRef(current.proofRef,proofRef(proof)))&&proof.hypothesisRevision===scope.rootId&&proof.optionalProof!.acceptedOutcome.resultKind==='supported-result'
        &&proof.optionalProof!.originalRef.bodyHash===createHash('sha256').update(report.body).digest('hex')&&stableHash(report.body)===bodyHash,'Original accepted argument unavailable.','STALE_SOURCE');
      const ref=proofRef(proof);
      requireData(!prior||sameRef(prior.proofRef,ref),'The archived proof revision changed.','STALE_SOURCE');
      const history=updates.filter(row=>row.projectId===scope.projectId&&row.artifactId===artifactId);
      const waiting=history.find(row=>row.status==='queued'&&history.findLast(r=>r.id===row.id)?.status==='queued');
      const queue=!decision&&(current?.status==='pending'||waiting&&waiting.id!==id);
      if(prior?.status==='queued'&&queue)return structuredClone(prior);
      const previousCondition=prior?.previousCondition??(current?.status==='conditional'?current.condition:undefined);
      const previousReview=prior?.previousReview??(current?.status==='conditional'?current.review:undefined);
      const superseded=!decision&&current?.status==='unsupported';
      const status=decision?.status==='confirmed'&&previousCondition?'conditional':decision?.status??(superseded?'unsupported':queue?'queued':'pending');
      const review=superseded?'The original argument was already withdrawn. This additional objection is retained with its record.':decision?.status==='confirmed'&&previousCondition?[previousReview,decision.body].filter(Boolean).join('\n\n'):decision?.body;
      const condition=status==='conditional'?(decision?.status==='conditional'?decision.condition:previousCondition):undefined;
      opposingArtifactId??=prior?.opposingArtifactId;
      const update:import('./report-assessment.js').ReportUpdate={...structuredClone(objection),...(opposingArtifactId?{opposingArtifactId}:{}),id,revision:(history.at(-1)?.revision??0)+1,...scope,artifactId,bodyHash,proofRef:ref,status,...(condition?{condition}:{}),...(review?{review}:{}),...(decision?{decisionHash:stableHash(decision)}:{}),...(previousCondition?{previousCondition,previousReview}:{})};
      const next=structuredClone(this.state);(next.reportUpdatesV4??=[]).push(update);
      if(decision?.status==='conditional'||decision?.status==='unsupported'){
        (next.v21OptionalInvalidArtifacts??={})[optionalArtifactKey(scope.projectId,artifactId)]=true;
      }
      await this.commit(next);return structuredClone(update);
    });
  }
  isProofValid(ref: ProofRef): boolean {
    return this.isCurrentArchive(ref) && !this.pendingReportDependency(this.state.proofs[ref.caseId]!);
  }
  // An unresolved review suspends reuse while allowing another objection to be filed.
  isCurrentArchive(ref: ProofRef): boolean {
    const current = this.state.proofs[ref.caseId];
    return Boolean(current && current.status === 'valid' && !this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`]
      && current.sessionId === ref.sessionId && current.hypothesisId === ref.hypothesisId && current.hypothesisRevision === ref.hypothesisRevision
      && current.revision >= ref.revision && current.semanticRevision >= ref.semanticRevision
      && (current.revision !== ref.revision || sameRef(proofRef(current),ref)));
  }
  proofReader(grants: readonly ProofRef[]): ProofReader {
    const frozen = structuredClone(grants);
    return Object.freeze({ read: async (ref: ProofRef) => {
      requireData(frozen.some(grant => sameRef(grant, ref)), 'Proof is outside the explicit frozen grants.', 'FORBIDDEN');
      return this.proofDocument(ref);
    } });
  }
  async readFinalProof(ref: ProofRef, caller: { role: 'theorist'; sessionId: string }): Promise<ProofDocument> {
    this.theorist(caller); return this.proofDocument(ref);
  }
  async readProofOutlines(sessionId: string): Promise<NonNullable<BoundaryView['proofs']>> {
    safeId(sessionId);
    const records = Object.values(this.state.proofs).filter(p => p.sessionId === sessionId && p.status !== 'revoked');
    return Promise.all(records.map(async record => ({ ref: proofRef(record), summary: await this.readText(`${proofPath(record)}/summary.md`),
      meta: { targetKey: record.targetKey, methodKey: record.methodKey, conditions: [...record.conditions], logicalRelation: record.logicalRelation } })));
  }
  /** Cross-session retrieval exposes final proofs only; source IDs never grant exploration access. */
  async searchProofOutlines(tags: readonly string[], limit = 8): Promise<{ ref: ProofRef; meta: ProofRecord; summary: string }[]> {
    const requested = normalizeTags([...tags]);
    requireData(Number.isSafeInteger(limit) && limit > 0 && limit <= 32, 'Invalid final-proof search limit.');
    const catalog = this.state.catalogs.proofs;
    const ids = requested.length ? (catalog.byTag[requested[0]!] ?? []).filter(id => requested.every(tag => catalog.byTag[tag]?.includes(id))) : Object.keys(catalog.records);
    const selected = ids.map(id => catalog.records[id]!).filter(meta => meta.status === 'valid')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.caseId.localeCompare(b.caseId)).slice(0, limit);
    return Promise.all(selected.map(async meta => ({ ref: proofRef(meta), meta: structuredClone(meta), summary: await this.readText(`${proofPath(meta)}/summary.md`) })));
  }

  async recordFailure(input: FailureInput, actor: LearningActor): Promise<FailureRef> {
    this.theorist(actor, input.sessionId);
    for (const id of [input.id, input.sessionId, input.attemptId, input.workerId]) safeId(id);
    for (const [key, value] of Object.entries({ patternKey: input.patternKey, summary: input.summary, body: input.body })) requireText(value, key);
    const tags = normalizeTags(input.tags);
    return this.serial(async () => {
      if (input.optionalArtifact) requireData(['2.1','3.0','4.0'].includes(input.sourceLoopVersion??'') && input.optionalArtifact.originalRef.projectId === input.sessionId
        && input.optionalArtifact.originalRef.owner === input.sessionId && input.optionalArtifact.originalRef.attemptId === input.attemptId
        && input.optionalArtifact.originalRef.completeness === 'complete' && ['auxiliary-worker','way-worker'].includes(input.optionalArtifact.authorRole)
        && this.state.v21OptionalEvidence?.[input.sessionId]?.[input.optionalArtifact.artifactId] === input.optionalArtifact.evidenceKey,
      'Optional Worker scientific failure judgment changed.','STALE_SOURCE');
      else if(input.sourceLoopVersion==='2.1') requireData(input.rawAnswer?.projectId===input.sessionId && input.rawAnswer.id===input.attemptId && this.state.v21ReviewEvidence?.[input.sessionId]?.[input.attemptId]===input.judgmentHash,'V2.1 scientific failure judgment changed.','STALE_SOURCE');
      const prior = this.state.failures[input.id];
      requireData(!prior || prior.sessionId === input.sessionId && prior.attemptId === input.attemptId && prior.workerId === input.workerId, 'Failure identity belongs to another attempt.', 'CONFLICT');
      const contentHash = stableHash({ ...input, tags });
      if (prior?.contentHash === contentHash) return { kind: 'failure', id: prior.id, sessionId: prior.sessionId, attemptId: prior.attemptId, version: prior.version };
      const record: FailureRecord = { kind: 'failure', id: input.id, sessionId: input.sessionId, attemptId: input.attemptId, version: (prior?.version ?? 0) + 1,
        ...(input.sourceLoopVersion?{sourceLoopVersion:input.sourceLoopVersion,rawAnswer:structuredClone(input.rawAnswer),judgmentHash:input.judgmentHash}:{}),
        ...(input.optionalArtifact?{optionalArtifact:structuredClone(input.optionalArtifact)}:{}),
        workerId: input.workerId, patternKey: input.patternKey, summary: input.summary, tags, scientific: input.scientific,
        contentHash, updatedAt: new Date().toISOString() };
      const next = structuredClone(this.state); next.failures[input.id] = record;
      await this.commit(next, { [`${failurePath(record)}/meta.json`]: json(record), [`${failurePath(record)}/case.md`]: input.body });
      return { kind: 'failure', id: record.id, sessionId: record.sessionId, attemptId: record.attemptId, version: record.version };
    });
  }
  async readFailure(ref: FailureRef, caller: { role: 'theorist'; sessionId: string }): Promise<{ meta: FailureRecord; body: string }> {
    this.theorist(caller, ref.sessionId);
    const meta = await this.readJsonAt<FailureRecord>(`${failurePath(ref)}/meta.json`);
    requireData(meta.sessionId === caller.sessionId && meta.attemptId === ref.attemptId && meta.version === ref.version, 'Failure is not owned by this session.', 'FORBIDDEN');
    return { meta, body: await this.readText(`${failurePath(ref)}/case.md`) };
  }

  /** Check exact current scientific authority; this never grants source or resource reads. */
  async validateSources(refs: LearningSource[]): Promise<void> {
    requireData(Array.isArray(refs) && refs.length > 0 && refs.length <= 64, 'Learning needs bounded, fixed source versions.');
    for (const ref of refs) {
      if ('kind' in ref) {
        const current = this.state.failures[ref.id];
        requireData(current && current.version === ref.version && current.sessionId === ref.sessionId && current.attemptId === ref.attemptId && current.scientific,
          'Failure source is unavailable, stale or not scientific.', 'STALE_SOURCE');
        if (current.optionalArtifact) requireData(this.state.v21OptionalEvidence?.[current.sessionId]?.[current.optionalArtifact.artifactId] === current.optionalArtifact.evidenceKey,'Optional scientific failure judgment was withdrawn.','STALE_SOURCE');
        else if(current.sourceLoopVersion==='2.1') requireData(this.state.v21ReviewEvidence?.[current.sessionId]?.[current.attemptId]===current.judgmentHash,'V2.1 failure source judgment was withdrawn.','STALE_SOURCE');
      } else {
        const document=await this.proofDocument(ref);
        const current = this.state.proofs[ref.caseId];
        requireData(document.meta.status==='valid' && current?.status === 'valid' && current.semanticRevision === ref.semanticRevision && !this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`], 'Proof science changed or was withdrawn.', 'STALE_SOURCE');
      }
    }
  }

  // Follow only maintenance revisions. A second scientific writer still needs a fresh review.
  private async scientificBase(head:ResourceMeta|undefined,version:number){
    let base=head;
    while(base&&base.version>version&&base.maintenance?.parent?.id===base.id&&base.maintenance.parent.version===base.version-1){
      base=await this.readJsonAt<ResourceMeta>(`${resourcePath(base.maintenance.parent)}/meta.json`);
    }
    return base;
  }
  async publishResource(input: ResourceInput, expectedVersion: number, actor: LearningActor, operationId?: string, optionalEvidence?: OptionalDecisionEvidence, support?:MethodPublicationV3,contentPolicyRevision?:'compact-english-v14',recordUnchangedReceipt=false,strategySupport?:StrategyPublicationV3): Promise<ResourceMeta> {
    safeId(input.id);for(const key of ['semanticKey','name','description'] as const)requireText(input[key],key);
    if(input.title!==undefined)requireText(input.title,'resource title',500);
    if(contentPolicyRevision==='compact-english-v14')requireData(typeof input.body==='string'&&input.body.trim().length>0,'Invalid resource body.');else requireText(input.body,'body');
    const tags = normalizeTags(input.tags);
    requireData(Array.isArray(input.conditions) && input.conditions.every(v => typeof v === 'string'), 'Invalid resource conditions.');
    return this.serial(async () => {
      const inputHash = stableHash({ input, expectedVersion, actor, ...(optionalEvidence?{optionalEvidence}:{}),...(support?{support}:{}),...(strategySupport?{strategySupport}:{}),...(contentPolicyRevision?{contentPolicyRevision}:{}) });
      const applied = operationId && this.state.appliedUpdates[operationId];
      if (applied) {
        requireData(applied.kind === 'resource' && applied.id === input.id && applied.inputHash === inputHash, 'Publication operation ID was reused.', 'CONFLICT');
        if(actor.role==='moderator'){const operation=this.state.operations[actor.operationId];if(operation?.structuralAdmission)await this.validateStructuralReview(operation,true);}
        return this.readJsonAt<ResourceMeta>(`${resourcePath(applied)}/meta.json`);
      }
      await this.validateSources(input.sourceRefs);
      if (optionalEvidence) {
        this.theorist(actor,optionalEvidence.sessionId);
        requireData(Object.keys(optionalEvidence.artifacts).length > 0 && Object.entries(optionalEvidence.artifacts)
          .every(([id,hash])=>this.state.v21OptionalEvidence?.[optionalEvidence.sessionId]?.[id] === hash),
        'Optional method evidence changed or was withdrawn.','STALE_SOURCE');
      }
      const head=this.state.resources[input.id];
      const prior=await this.scientificBase(head,expectedVersion);
      const supersedesMaintenance=head!==prior&&prior?.version===expectedVersion;
      if (input.kind === 'specific-strategy') {
        const operation = this.reviewActor(actor, 'v2-strategy');
        await this.validateStructuralReview(operation);
        requireData(input.sourceRefs.every(ref => !('kind' in ref) && operation.cases.some(c => sameRef(c.ref, ref)) && operation.delivered.includes(sourceKey(ref))), 'Strategy sources must be delivered final proofs in this task.', 'FORBIDDEN');
        const cases = input.sourceRefs.map(ref => this.state.proofs[(ref as ProofRef).caseId]);
        requireData(operation.repairResourceIds.includes(input.id)&&!prior?.maintenance || new Set(cases.map(independentProofCaseKey)).size >= 2, 'A new subject Strategy needs multiple independent final cases.');
      } else {
        this.theorist(actor);
        if (input.kind === 'failure-skill') {
          requireData(input.generalizable === true && input.sourceRefs.every(ref => 'kind' in ref && ref.sessionId === actor.sessionId), 'Failure Skill needs generalizable same-session failures.', 'FORBIDDEN');
          const records = input.sourceRefs.map(ref => this.state.failures[(ref as FailureRef).id]);
          requireData(new Set(records.map(r => r.workerId)).size >= 2 && new Set(records.map(r => r.patternKey)).size === 1, 'Failure Skill requires the same scientific pattern from multiple distinct Workers.');
        } else requireData(input.kind === 'method-skill' && input.sourceRefs.every(ref => !('kind' in ref)), 'Method Skills use complete proof sources.');
      }
      requireData(!prior?.maintenance?.retired,'This resource was retired.','CONFLICT');
      if(prior&&actor.role==='moderator'){const operation=this.state.operations[actor.operationId];if(operation?.structuralAdmission)requireData(operation.structuralAdmission.parentStrategies.some(ref=>ref.id===prior.id&&ref.version===prior.version),'Strategy parent is outside frozen structural scope.','FORBIDDEN');}
      requireData(!prior || prior.kind === input.kind && prior.semanticKey === input.semanticKey, 'Resource identity cannot change kind or meaning.', 'CONFLICT');
      requireData(!Object.values(this.state.resources).some(r => r.id !== input.id && r.kind === input.kind && r.semanticKey === input.semanticKey), 'An equivalent resource already exists; revise it instead of bypassing its preference.', 'CONFLICT');
      requireData(!prior?.strategySupport||!!strategySupport,'A marked Strategy requires its support publication policy.','CONFLICT');
      requireData(strategySupport===undefined||input.kind==='specific-strategy'&&strategySupport?.recipe==='strategy-support-v1'&&Object.keys(strategySupport).every(key=>['recipe','independentRebuild'].includes(key)),'Unsupported Strategy publication recipe.');
      let sourceRefs=input.sourceRefs,methodSupport:ResourceMeta['methodSupport'],strategyMarker:ResourceMeta['strategySupport'];
      if(strategySupport){
        requireData((prior?.version??0)===expectedVersion,'Resource parent version changed.','CONFLICT');
        const directSourceRefs=dedupeStrategySourcesV3(input.sourceRefs as ProofRef[]),rebuild=strategySupport.independentRebuild;
        requireData(rebuild===undefined||!!rebuild&&typeof rebuild==='object'&&!Array.isArray(rebuild),'Invalid Strategy rebuild choice.');
        if(rebuild){requireData(Object.keys(rebuild).length===1&&Object.hasOwn(rebuild,'justification'),'Invalid Strategy rebuild choice.');requireText(rebuild.justification,'whole-body independent Strategy rebuild justification',4000);}
        let inherited:ProofRef[]=[];
        if(prior){
          const parent=await this.readJsonAt<ResourceMeta>(`${resourcePath({id:input.id,version:expectedVersion})}/meta.json`);
          requireData(parent.id===input.id&&parent.version===expectedVersion&&parent.kind===input.kind&&parent.semanticKey===input.semanticKey,'Strategy support parent mismatch.','CONFLICT');
          if(!rebuild){requireData(prior.status==='valid','Strategy parent needs scientific repair.','STALE_SOURCE');const resolved=await this.strategySupport.resolve(parent,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));requireData(!resolved.unverified,resolved.unverified??'Unverified Strategy ancestry.','STALE_SOURCE');inherited=resolved.refs;}
        }
        sourceRefs=dedupeStrategySourcesV3([...inherited,...directSourceRefs]);await this.validateSources(sourceRefs);
        strategyMarker={recipe:'strategy-support-v1',mode:rebuild?'independent-rebuild':'revise',...(head?{parent:{id:head.id,version:head.version}}:{}),...(rebuild?{justification:rebuild.justification}:{}),directSourceRefs};
      }
      const v3Method=this.isV3Method(input)||!!prior&&this.isV3Method(prior);
      requireData(!support||v3Method&&support.recipe==='method-support-v1','Unsupported method publication recipe.');
      if(v3Method){
        requireData((prior?.version??0)===expectedVersion,'Resource parent version changed.','CONFLICT');
        const directSourceRefs=dedupeMethodSourcesV3(input.sourceRefs as ProofRef[]),rebuild=support?.independentRebuild;
        if(rebuild)requireText(rebuild.justification,'whole-card independent rebuild justification',4000);
        let inherited:ProofRef[]=[];
        if(prior&&!rebuild){
          const frozen=await this.readJsonAt<ResourceMeta>(`${resourcePath({id:input.id,version:expectedVersion})}/meta.json`);
          requireData(frozen.id===input.id&&frozen.version===expectedVersion&&frozen.kind===input.kind&&frozen.semanticKey===input.semanticKey,'Method support parent mismatch.','CONFLICT');
          const resolved=await this.methodSupport.resolve(frozen,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
          requireData(!resolved.unverified,resolved.unverified??'Unverified method ancestry.','STALE_SOURCE');inherited=resolved.refs;
        }
        sourceRefs=dedupeMethodSourcesV3([...inherited,...directSourceRefs]);await this.validateSources(sourceRefs);
        methodSupport={recipe:'method-support-v1',mode:rebuild?'independent-rebuild':'revise',...(head?{parent:{id:head.id,version:head.version}}:{}),...(rebuild?{justification:rebuild.justification}:{}),directSourceRefs};
      }
      const content = { kind: input.kind, semanticKey: input.semanticKey, name: input.name, ...(input.title!==undefined?{title:input.title}:{}), description: input.description, tags, conditions: input.conditions, sourceRefs, body: input.body,...(methodSupport?{methodSupport}:{}),...(strategyMarker?{strategySupport:strategyMarker}:{}) };
      if (!supersedesMaintenance&&prior?.status === 'valid') {
        const previous = { kind: prior.kind, semanticKey: prior.semanticKey, name: prior.name, ...(prior.title!==undefined?{title:prior.title}:{}), description: prior.description, tags: prior.tags, conditions: prior.conditions, sourceRefs: prior.sourceRefs, body: await this.readText(`${resourcePath(prior)}/body.md`),...(prior.methodSupport?{methodSupport:prior.methodSupport}:{}),...(prior.strategySupport?{strategySupport:prior.strategySupport}:{}) };
        if (stableHash(content) === stableHash(previous)) {
        if(recordUnchangedReceipt&&operationId){const unchanged=structuredClone(this.state);unchanged.appliedUpdates[operationId]={kind:'resource',id:prior.id,version:prior.version,inputHash,actor:structuredClone(actor),sources:structuredClone(input.sourceRefs)};await this.commit(unchanged);}
        return structuredClone(prior);
      }
      }
      requireData((prior?.version ?? 0) === expectedVersion, 'Resource parent version changed.', 'CONFLICT');
      const catalogPublicationV3=!!strategySupport||v3Method||contentPolicyRevision==='compact-english-v14'||input.sourceRefs.some(ref=>'kind'in ref?usesV3Proof(this.state.failures[ref.id]?.sourceLoopVersion):usesV3Proof(this.state.proofs[ref.caseId]?.sourceLoopVersion));
      const now = new Date().toISOString();
      const resource: ResourceMeta = { id: input.id, kind: input.kind, semanticKey: input.semanticKey, name: input.name, ...(input.title!==undefined?{title:input.title}:{}), description: input.description, tags,
        ...(catalogPublicationV3?{catalogBodyHashV3:createHash('sha256').update(input.body,'utf8').digest('hex')}:{}),
        conditions: [...input.conditions], version: (head?.version??0) + 1, enabled: (supersedesMaintenance?head?.maintenance?.resumeEnabled??head?.enabled:prior?.enabled)??true, status: 'valid',
        sourceRefs: structuredClone(sourceRefs),...(methodSupport?{methodSupport}:{}),...(strategyMarker?{strategySupport:strategyMarker}:{}), createdAt: prior?.createdAt ?? now, updatedAt: now,
        createdBy: prior?.createdBy ?? structuredClone(actor), updatedBy: structuredClone(actor) };
      const next = structuredClone(this.state); next.resources[resource.id] = resource;
      if (optionalEvidence) {
        next.resourceOptionalEvidence ??= {};
        next.resourceOptionalEvidence[`${resource.id}:${resource.version}`] = structuredClone(optionalEvidence);
      }
      if (operationId) next.appliedUpdates[operationId] = { kind: 'resource', id: resource.id, version: resource.version, inputHash, actor:structuredClone(actor),sources:structuredClone(input.sourceRefs) };
      await this.commit(next, { [`${resourcePath(resource)}/meta.json`]: json(resource), [`${resourcePath(resource)}/body.md`]: input.body },catalogPublicationV3);
      return structuredClone(resource);
    });
  }

  /** Freeze full exact bodies, historical neighbors and bounded diverse candidates for USER review. */
  async prepareUserNetworkReview(ref: ResourceRef, generation: number): Promise<NetworkReviewContextV1> {
    const targetBody=await this.inspectUserResource(ref,generation), state=this.snapshot(), target=state.resources[ref.id]!;
    requireData(target.enabled, 'Enable this resource before reassessing its connections.', 'FORBIDDEN');
    const graph=state.methodNetworkV3??emptyMethodNetworkV3();
    const visibleRoutes=new Set(this.inspectUserResources().network.routes.map(route=>`${route.id}@${route.version}`));
    const oldRoutes=graph.routes.filter(route=>route.resourceRef.id===ref.id), oldIds=new Set(oldRoutes.map(route=>route.id));
    const oldLinks=graph.links.filter(link=>oldIds.has(link.from.id)||oldIds.has(link.to.id));
    const neighborIds=new Set(oldLinks.flatMap(link=>[link.from.id,link.to.id]).filter(id=>!oldIds.has(id)).flatMap(id=>graph.routes.filter(route=>route.id===id).map(route=>route.resourceRef.id)));
    const eligible=Object.values(state.resources).filter(meta=>meta.id!==ref.id&&meta.enabled&&this.catalogResourceAvailableV3(meta));
    const overlap=(meta:ResourceMeta)=>meta.tags.filter(tag=>target.tags.includes(tag)).length;
    eligible.sort((a,b)=>Number(neighborIds.has(b.id))-Number(neighborIds.has(a.id))||overlap(b)-overlap(a)||a.id.localeCompare(b.id));
    // Preserve former neighbors, then sample each explicit discipline before remaining candidates.
    const ordered:ResourceMeta[]=[], seen=new Set<string>(), add=(meta:ResourceMeta)=>{if(!seen.has(meta.id)){seen.add(meta.id);ordered.push(meta);}};
    eligible.filter(meta=>neighborIds.has(meta.id)).forEach(add);
    const subjects=new Set<string>();for(const meta of eligible){const subject=meta.tags.filter(tag=>tag.startsWith('subject:')).sort().join('|');if(!subjects.has(subject)){subjects.add(subject);add(meta);}}
    eligible.forEach(add);
    const currentRoute=(meta:ResourceMeta)=>graph.routes.find(route=>visibleRoutes.has(`${route.id}@${route.version}`)&&route.resourceRef.id===meta.id&&route.resourceRef.version===meta.version);
    const make=(meta:ResourceMeta,body:string):NetworkReviewResourceV1=>({meta:structuredClone(meta),body,bodyHash:stableHash(body),canRefute:meta.sourceRefs.some(source=>!('kind'in source)&&state.proofs[source.caseId]?.logicalRelation==='counterexample'),
      ...(currentRoute(meta)?{route:structuredClone(currentRoute(meta)!)}:{})});
    const candidates:NetworkReviewResourceV1[]=[];let bytes=0;
    for(const meta of ordered){if(candidates.length>=16)break;const value=await this.inspectUserResource(meta,generation),size=Buffer.byteLength(value.body,'utf8');if(bytes+size>200000)continue;bytes+=size;candidates.push(make(meta,value.body));}
    requireData(this.state.generation===generation,'Library changed while preparing review.','CONFLICT');
    return {recipe:'manual-network-review-v1',networkVersion:graph.version,target:make(target,targetBody.body),candidates,prior:{routes:structuredClone(oldRoutes),links:structuredClone(oldLinks),advisoryOnly:true},coverage:{candidateCount:eligible.length,includedCount:candidates.length,omittedCount:eligible.length-candidates.length,selection:'Former neighbors first, then explicit discipline diversity and shared tags; at most 16 full-body neighbors and 200000 UTF-8 bytes. Selection is navigation context, not a scientific relation.'}};
  }

  async validateUserNetworkReview(context:NetworkReviewContextV1):Promise<void> {
    requireData(context.recipe==='manual-network-review-v1'&&(this.state.methodNetworkV3?.version??0)===context.networkVersion,'Knowledge tree changed. Start a fresh reassessment.','CONFLICT');
    for(const grant of [context.target,...context.candidates]) {
      const meta=this.state.resources[grant.meta.id];
      requireData(meta?.version===grant.meta.version&&meta.enabled&&this.catalogResourceAvailableV3(meta),'A reviewed resource changed or its support was withdrawn.','STALE_SOURCE');
      const value=await this.inspectUserResource(meta,this.state.generation);
      requireData(stableHash(value.body)===grant.bodyHash&&stableHash(grant.body)===grant.bodyHash&&stableHash(meta)===stableHash(grant.meta),'Frozen review body or metadata changed.','STALE_SOURCE');
      if(grant.route)for(const dependency of [grant.route.resourceRef,...grant.route.sourceRefs,...grant.route.alternatives]){const current=this.state.resources[dependency.id];requireData(current?.version===dependency.version&&current.enabled&&this.catalogResourceAvailableV3(current),'A route dependency changed or was withdrawn.','STALE_SOURCE');}
    }
    requireData((this.state.methodNetworkV3?.version??0)===context.networkVersion,'Knowledge tree changed during review validation.','CONFLICT');
  }

  async publishUserNetworkReview(context:NetworkReviewContextV1,output:NetworkReviewOutputV1,jobId:string):Promise<{status:'published'|'no-change';version:number}> {
    return this.serial(async()=>{
      const hash=stableHash({context,output,jobId}),prior=this.state.manualNetworkReviewsV1?.[jobId];
      if(prior){requireData(prior.hash===hash,'Manual review receipt binding changed.','CONFLICT');return {status:prior.status,version:prior.version};}
      await this.validateUserNetworkReview(context);
      requireData(output.action==='replace'||output.action==='no-change','Invalid navigation action.');
      requireData(output.action!=='no-change'||output.routes===undefined&&output.links===undefined,'No-change cannot contain a graph patch.');
      const next=structuredClone(this.state);
      if(output.action==='replace')next.methodNetworkV3=stageNetworkReviewV1(next.methodNetworkV3??emptyMethodNetworkV3(),context,output);
      const result={status:output.action==='replace'?'published' as const:'no-change' as const,version:next.methodNetworkV3?.version??0};
      next.manualNetworkReviewsV1={...next.manualNetworkReviewsV1,[jobId]:{hash,...result}};
      await this.commit(next,{},true);return result;
    });
  }

  /** USER-authored content revision; preserves source dependencies, never a model review. */
  async editUserResource(ref: ResourceRef, body: string, expectedGeneration: number): Promise<ResourceMeta> {
    safeId(ref.id);
    requireData(typeof body === 'string' && body.trim().length > 0 && Buffer.byteLength(body, 'utf8') <= 20 * 1024 * 1024, 'Resource body must be nonempty and at most 20 MiB.');
    requireData(Number.isSafeInteger(ref.version) && ref.version > 0 && Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0, 'Invalid edit reference.');
    return this.serial(async () => {
      const previous = await this.inspectUserResource(ref, expectedGeneration);
      const prior = this.state.resources[ref.id]!;
      if (previous.body === body) return structuredClone(prior);
      requireData(ref.version < Number.MAX_SAFE_INTEGER, 'Resource version exhausted.', 'CONFLICT');
      const resource: ResourceMeta = { ...structuredClone(prior), version: ref.version + 1,
        catalogBodyHashV3: createHash('sha256').update(body, 'utf8').digest('hex'),
        updatedAt: new Date().toISOString(), updatedBy: { role: 'user' } };
      if (prior.methodSupport) resource.methodSupport = { recipe: 'method-support-v1', mode: 'revise', parent: { ...ref }, directSourceRefs: [] };
      if (prior.strategySupport) resource.strategySupport = { recipe: 'strategy-support-v1', mode: 'revise', parent: { ...ref }, directSourceRefs: structuredClone(prior.sourceRefs as ProofRef[]) };
      const next = structuredClone(this.state); next.resources[resource.id] = resource;
      const evidence = next.resourceOptionalEvidence?.[`${prior.id}:${prior.version}`];
      if (evidence) next.resourceOptionalEvidence![`${resource.id}:${resource.version}`] = structuredClone(evidence);
      // New exact body withdraws old route ownership; no automatic scientific reparenting.
      await this.commit(next, { [`${resourcePath(resource)}/meta.json`]: json(resource), [`${resourcePath(resource)}/body.md`]: body }, true);
      return structuredClone(resource);
    });
  }

  async maintainResource(callId:string,generation:number,change:{
    target?:ResourceRef;content?:{kind:ResourceMeta['kind'];title:string;body:string;assumptions:string[];tags?:string[];description?:string};
  },checkpoint?:string){
    return this.serial(async()=>{
      const target=change.target;
      requireData(Number.isSafeInteger(generation)&&generation>=0&&generation<=this.state.generation,'revision: select an existing library revision.','CONFLICT');
      if(target&&generation!==this.state.generation){
        requireData(checkpoint,'revision: read the target in this session before editing an older revision.','CONFLICT');
        const original=await this.readState(checkpoint);
        requireData(original.generation===generation&&stableHash(original.resources[target.id]??null)===stableHash(this.state.resources[target.id]??null),'The selected resource changed. Read its current version.','CONFLICT');
      }
      const previous=target?await this.readMaintenanceResource(target,this.state.generation):undefined;
      const prior=target?this.state.resources[target.id]:undefined,content=change.content;
      requireData(content||prior,'Select an existing resource.');
      requireData(!prior?.maintenance?.retired,'Resource was retired.','CONFLICT');
      if(prior&&content)requireData(content.kind===prior.kind,'Preserve the resource kind when editing.');
      if(content){requireText(content.title,'resource title',500);requireText(content.body,'resource body',1000000);}
      const id=prior?.id??'draft_'+stableHash(['shared-library',callId]);
      requireData(prior||!Object.hasOwn(this.state.resources,id),'This resource creation already exists.','CONFLICT');
      const now=new Date().toISOString(),actor={role:'maintenance' as const,scope:'shared-library' as const},body=content?.body??previous!.body;
      const sameStatement=!content||previous?.body===body&&stableHash(prior?.conditions)===stableHash(content.assumptions);
      const resource:ResourceMeta={
        ...(prior??{id,semanticKey:id,sourceRefs:[],createdAt:now,createdBy:actor}),
        description:content?.description??(sameStatement?prior?.description:'')??'',
        version:(prior?.version??0)+1,kind:content?.kind??prior!.kind,name:content?.title??prior!.name,title:content?.title??prior!.title??prior!.name,
        tags:content?.tags?normalizeTags(content.tags):prior?.tags??[],conditions:content?.assumptions??prior!.conditions,updatedAt:now,updatedBy:actor,enabled:false,status:'needs_review',
        catalogBodyHashV3:createHash('sha256').update(body,'utf8').digest('hex'),
        maintenance:{...actor,callId,resumeEnabled:prior?.maintenance?.resumeEnabled??prior?.enabled??false,...(target?{parent:target}:{}),...(!content?{retired:true as const}:{})},
      };
      if(prior?.methodSupport)resource.methodSupport={recipe:'method-support-v1',mode:'revise',parent:target!,directSourceRefs:[]};
      if(prior?.strategySupport)resource.strategySupport={recipe:'strategy-support-v1',mode:'revise',parent:target!,directSourceRefs:structuredClone(prior.sourceRefs as ProofRef[])};
      const next=structuredClone(this.state);next.resources[id]=resource;
      const evidence=target&&next.resourceOptionalEvidence?.[catalogBodyKeyV3(target)];
      if(evidence)next.resourceOptionalEvidence![catalogBodyKeyV3(resource)]=structuredClone(evidence);
      await this.commit(next,{[`${resourcePath(resource)}/meta.json`]:json(resource),[`${resourcePath(resource)}/body.md`]:body},true);
      return {scope:'shared-library',id,version:resource.version,status:content?'needs_review':'retired',revision:this.state.generation};
    });
  }

  async setResourceEnabled(id: string, enabled: boolean, expectedVersion: number, expectedGeneration?: number): Promise<ResourceMeta> {
    return this.serial(async () => {
      if (expectedGeneration !== undefined) requireData(this.state.generation === expectedGeneration, 'Resource catalog changed.', 'CONFLICT');
      const next = structuredClone(this.state), item = next.resources[safeId(id)];
      requireData(item?.version === expectedVersion, 'Resource preference version changed.', 'CONFLICT');
      requireData(typeof enabled === 'boolean', 'Invalid enabled preference.'); item.enabled = enabled;if(item.maintenance)item.maintenance.resumeEnabled=enabled;
      await this.commit(next); return structuredClone(item);
    });
  }
  async readResource(ref: ResourceRef, caller: ResourceReader): Promise<{ meta: ResourceMeta; body: string }> {
    const current = this.state.resources[ref.id];
    const repairRead = caller.role === 'moderator' && this.state.operations[caller.operationId]?.repairResourceIds.includes(ref.id);
    requireData(current && current.enabled && (this.resourceAvailable(current) || repairRead), 'Resource is disabled or awaiting scientific repair.', 'FORBIDDEN');
    if (caller.role === 'theorist') {
      this.theorist(caller); requireData(caller.loopVersion === 2 || current.kind !== 'specific-strategy', 'V2 Strategy is not a V1 capability.', 'FORBIDDEN');
    } else {
      const operation = this.reviewActor(caller, 'v2-strategy'); requireData(current.kind === 'specific-strategy', 'Moderator can read strategies only.', 'FORBIDDEN');
      await this.validateStructuralReview(operation);
      requireData(this.strategyInReviewScope(operation,current), 'Strategy is outside this review scope.', 'FORBIDDEN');
    }
    const meta = await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
    requireData(meta.id === ref.id && meta.version === ref.version && meta.kind === current.kind, 'Resource reference mismatch.');
    if(this.isV3Method(meta))await this.methodSupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      if(meta.strategySupport)await this.strategySupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
    requireData(repairRead||this.resourceSupportValid(meta),'This method version has withdrawn or unverified inherited support.','FORBIDDEN');
    requireData(repairRead || !meta.sourceRefs.some(source => !('kind' in source) && this.state.invalidProofs[`${source.caseId}:${source.semanticRevision}`]), 'This resource version depends on withdrawn science.', 'FORBIDDEN');
    const optionalEvidence = this.state.resourceOptionalEvidence?.[`${meta.id}:${meta.version}`];
    requireData(repairRead || !optionalEvidence || Object.entries(optionalEvidence.artifacts)
      .every(([id,hash])=>this.state.v21OptionalEvidence?.[optionalEvidence.sessionId]?.[id] === hash),
    'This resource version depends on withdrawn optional route evidence.','FORBIDDEN');
    return { meta: { ...meta, enabled: current.enabled, status: current.status }, body: await this.readText(`${resourcePath(ref)}/body.md`) };
  }
  async readMaintenanceStrategyForReview(ref:ResourceRef,operationId:string){
    const operation=this.reviewActor({role:'moderator',purpose:'v2-strategy',operationId},'v2-strategy');
    await this.validateStructuralReview(operation);
    const current=this.state.resources[ref.id],generation=this.state.generation;
    requireData(operation.repairResourceIds.includes(ref.id)&&current?.maintenance&&!current.maintenance.retired&&current.kind==='specific-strategy'&&current.version===ref.version,'Draft is outside this Strategy review.','FORBIDDEN');
    const {body}=await this.readMaintenanceResource(ref,generation);
    return {meta:structuredClone(current),body,advisoryOnly:true as const,notice:'Maintenance draft for review. Justify any new Strategy independently from the delivered proof cases.'};
  }
  /** Fresh-policy repair context is advisory only, never a canonical resource grant. */
  async readStrategyRepairContextV3(ref:ResourceRef,caller:Extract<ResourceReader,{role:'moderator'}>,recipe:'strategy-support-v1'):Promise<{meta:ResourceMeta;body?:string;bodyUnavailable?:true;advisoryOnly:true;notice:string}> {
    return this.serial(async()=>{
      requireData(recipe==='strategy-support-v1','Unsupported Strategy repair context policy.','FORBIDDEN');
      const operation=this.reviewActor(caller,'v2-strategy'),current=this.state.resources[ref.id];
      requireData(operation.repairResourceIds.includes(ref.id)&&current?.enabled&&current.kind==='specific-strategy'&&!!current.strategySupport&&current.version===ref.version,'Strategy is outside this exact marked repair scope.','FORBIDDEN');
      requireData(current.status==='needs_review'||!this.resourceSupportValid(current),'Strategy is not awaiting scoped repair.','FORBIDDEN');
      const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
      requireData(meta.id===current.id&&meta.version===current.version&&meta.kind===current.kind&&meta.semanticKey===current.semanticKey&&!!meta.strategySupport&&stableHash(meta.strategySupport)===stableHash(current.strategySupport),'Strategy repair metadata binding mismatch.','FORBIDDEN');
      requireData(typeof meta.catalogBodyHashV3==='string'&&/^[a-f0-9]{64}$/u.test(meta.catalogBodyHashV3),'Strategy repair body hash is unavailable.','FORBIDDEN');
      let body:string|undefined;
      try{body=await this.readText(`${resourcePath(ref)}/body.md`);}catch(error){if(isStorageAccessError(error)||!hasErrorCode(error,['ENOENT','NotFoundError']))throw error;}
      if(body!==undefined)requireData(createHash('sha256').update(body,'utf8').digest('hex')===meta.catalogBodyHashV3,'Strategy repair body hash mismatch.','FORBIDDEN');
      return {meta:{...meta,enabled:true,status:'needs_review'},...(body===undefined?{bodyUnavailable:true as const}:{body}),advisoryOnly:true as const,notice:'Repair-only prior context, not valid evidence or a canonical resource grant. Rebuild the entire body from qualified current direct proofs; missing prior text does not establish preserved coverage.'};
    });
  }
  /** New learning grants distinguish unavailable optional authority from corrupt exact bindings. */
  async optionalLearningResource(ref:ResourceRef,caller:ResourceReader,expected:Pick<ResourceMeta,'kind'|'semanticKey'>,allowOwnPublication=false):Promise<
    {available:true;meta:ResourceMeta;body:string}|{available:false;reason:'disabled'|'stale-source'|'needs-review'}> {
    return this.serial(async()=>{
    requireData(Number.isSafeInteger(ref.version)&&ref.version>0,'Invalid learning resource version.');
    const current=this.state.resources[ref.id];requireData(current,'Learning resource identity is missing.','NOT_FOUND');
    const meta=await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
    requireData(meta.id===ref.id&&meta.version===ref.version&&meta.kind===expected.kind&&meta.semanticKey===expected.semanticKey
      &&current.kind===meta.kind&&current.semanticKey===meta.semanticKey,'Learning resource binding mismatch.','FORBIDDEN');
    if(caller.role==='theorist'){
      this.theorist(caller);requireData(caller.loopVersion===2||meta.kind!=='specific-strategy','V2 Strategy is not a V1 capability.','FORBIDDEN');
    }else{
      const operation=this.reviewActor(caller,'v2-strategy');requireData(meta.kind==='specific-strategy','Moderator can read strategies only.','FORBIDDEN');
      await this.validateStructuralReview(operation,allowOwnPublication);
      requireData(this.strategyInReviewScope(operation,meta),'Strategy is outside this review scope.','FORBIDDEN');
    }
    if(meta.strategySupport&&caller.role==='moderator'&&this.state.operations[caller.operationId]?.repairResourceIds.includes(meta.id)){
      await this.strategySupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      if(!this.resourceSupportValid(meta)||meta.status!=='valid'||current.version===meta.version&&current.status!=='valid')return {available:false,reason:current.enabled?'needs-review':'disabled'};
    }
    const body=await this.readText(`${resourcePath(ref)}/body.md`);
    let sources=meta.sourceRefs;
    if(this.isV3Method(meta)){
      const support=await this.methodSupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      requireData(!support.unverified,support.unverified??'Unverified method support.','FORBIDDEN');sources=support.refs;
    }
    if(meta.strategySupport){const support=await this.strategySupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));if(support.unverified&&caller.role==='moderator'&&this.state.operations[caller.operationId]?.repairResourceIds.includes(meta.id))return {available:false,reason:this.state.resources[ref.id]?.enabled?'needs-review':'disabled'};requireData(!support.unverified,support.unverified??'Unverified Strategy support.','FORBIDDEN');sources=support.refs;}
    let stale=false;
    try{await this.validateSources(sources);}catch(error){if(error instanceof LearningDataError&&error.code==='STALE_SOURCE')stale=true;else throw error;}
    const evidence=this.state.resourceOptionalEvidence?.[`${meta.id}:${meta.version}`];
    if(evidence&&Object.entries(evidence.artifacts).some(([id,hash])=>this.state.v21OptionalEvidence?.[evidence.sessionId]?.[id]!==hash))stale=true;
    if(!this.state.resources[ref.id]?.enabled)return {available:false,reason:'disabled'};
    if(stale)return {available:false,reason:'stale-source'};
    const latest=this.state.resources[ref.id];
    if(meta.status!=='valid'||latest?.version===ref.version&&latest.status!=='valid')return {available:false,reason:'needs-review'};
    return {available:true,meta:{...meta,enabled:true,status:'valid'},body};
    });
  }
  /** Existing rounds retain their approved exact versions; preferences affect the next boundary. */
  frozenResourceReader(grants: readonly ResourceMeta[], caller: Extract<ResourceReader, { role: 'theorist' }>) {
    this.theorist(caller);
    requireData(caller.loopVersion === 1 || caller.loopVersion === 2, 'Invalid loop version.');
    const frozen = structuredClone(grants);
    requireData(frozen.every(meta => meta.enabled && meta.status === 'valid' && (caller.loopVersion === 2 || meta.kind !== 'specific-strategy')), 'Invalid frozen resource grants.', 'FORBIDDEN');
    return Object.freeze({ read: async (ref: ResourceRef): Promise<{ meta: ResourceMeta; body: string }> => {
      const grant = frozen.find(meta => meta.id === ref.id && meta.version === ref.version);
      requireData(grant, 'Resource is outside the explicit frozen grants.', 'FORBIDDEN');
      const meta = await this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`);
      requireData(meta.id === grant.id && meta.version === grant.version && meta.kind === grant.kind && stableHash(meta.sourceRefs) === stableHash(grant.sourceRefs)&&stableHash(meta.strategySupport??null)===stableHash(grant.strategySupport??null), 'Frozen resource reference mismatch.', 'FORBIDDEN');
      if(this.isV3Method(meta))await this.methodSupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      if(meta.strategySupport)await this.strategySupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
      requireData(this.resourceSupportValid(meta),'This method version has withdrawn or unverified inherited support.','FORBIDDEN');
      requireData(!meta.sourceRefs.some(source => !('kind' in source) && this.state.invalidProofs[`${source.caseId}:${source.semanticRevision}`]), 'This resource version depends on withdrawn science.', 'FORBIDDEN');
      const optionalEvidence = this.state.resourceOptionalEvidence?.[`${meta.id}:${meta.version}`];
      requireData(!optionalEvidence || Object.entries(optionalEvidence.artifacts)
        .every(([id,hash])=>this.state.v21OptionalEvidence?.[optionalEvidence.sessionId]?.[id] === hash),
      'This resource version depends on withdrawn optional route evidence.','FORBIDDEN');
      return { meta: { ...meta, enabled: grant.enabled, status: grant.status }, body: await this.readText(`${resourcePath(ref)}/body.md`) };
    } });
  }
  readBoundary(query: BoundaryQuery): BoundaryView {
    safeId(query.sessionId); requireData(query.loopVersion === 1 || query.loopVersion === 2, 'Invalid loop version.');
    const tags = normalizeTags(query.tags ?? []), words = (query.hypothesis ?? '').toLowerCase().split(/\W+/u).filter(w => w.length > 3);
    const rank = (r: ResourceMeta) => tags.filter(t => r.tags.includes(t)).length * 10 + words.filter(w => `${r.name} ${r.description}`.toLowerCase().includes(w)).length;
    const limit = Math.max(1, Math.min(query.limit ?? 8, 32));
    const applicable = (resource: ResourceMeta) => ['subject:', 'specialization:'].every(dimension => {
      const requested = tags.filter(t => t.startsWith(dimension)), supplied = resource.tags.filter(t => t.startsWith(dimension));
      return !requested.length || !supplied.length || requested.some(t => supplied.includes(t));
    });
    // Historical boundaries cannot persist fresh Strategy support metadata; V3 uses its pinned catalog path.
    const permitted = Object.values(this.state.resources).filter(r => !r.strategySupport && r.enabled && this.resourceAvailable(r) && (query.loopVersion === 2 || r.kind !== 'specific-strategy') && applicable(r));
    const candidates = permitted.filter(r => !tags.length && !words.length || rank(r) > 0).sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    return structuredClone({ decision: this.state.decisions[String(query.loopVersion) as '1' | '2'], skills: candidates.filter(r => r.kind !== 'specific-strategy').slice(0, limit), strategies: candidates.filter(r => r.kind === 'specific-strategy').slice(0, limit) });
  }

  async updateDecision(loopVersion: LoopVersion, expectedVersion: number, proposal: DecisionProposal, actor: LearningActor, operationId?: string, rawEvidence?: {sessionId:string; judgments:Record<string,string>}, proofEvidence?: readonly ProofRef[], optionalEvidence?: OptionalDecisionEvidence): Promise<DecisionFile> {
    requireData(loopVersion === 1 || loopVersion === 2, 'Invalid loop version.');
    return this.serial(async () => {
      const inputHash = stableHash({ loopVersion, expectedVersion, proposal, actor, ...(rawEvidence?{rawEvidence}:{}), ...(proofEvidence?{proofEvidence}:{}), ...(optionalEvidence?{optionalEvidence}:{}) });
      const applied = operationId && this.state.appliedUpdates[operationId];
      if (applied) {
        requireData(applied.kind === 'decision' && applied.id === String(loopVersion) && applied.inputHash === inputHash, 'Publication operation ID was reused.', 'CONFLICT');
        return this.readJsonAt<DecisionFile>(`decisions/v${loopVersion}/revisions/${applied.version}.json`);
      }
      if (loopVersion === 1) {
        const operation = this.reviewActor(actor, 'v1-decision');
        requireData(operation.expectedDecisionVersion === expectedVersion && operation.delivered.length > 0, 'V1 proposal must use its delivered frozen review.', 'FORBIDDEN');
      } else this.theorist(actor);
      if(rawEvidence) {
        this.theorist(actor,rawEvidence.sessionId);
        requireData(Object.keys(rawEvidence.judgments).length>0 && Object.entries(rawEvidence.judgments).every(([id,hash])=>this.state.v21ReviewEvidence?.[rawEvidence.sessionId]?.[id]===hash),'V2.1 decision evidence changed or was withdrawn.','STALE_SOURCE');
      }
      if (optionalEvidence) {
        this.theorist(actor, optionalEvidence.sessionId);
        requireData(loopVersion === 2 && Object.keys(optionalEvidence.artifacts).length > 0
          && Object.entries(optionalEvidence.artifacts).every(([id,hash]) => this.state.v21OptionalEvidence?.[optionalEvidence.sessionId]?.[id] === hash
            && !this.state.v21OptionalInvalidArtifacts?.[optionalArtifactKey(optionalEvidence.sessionId,id)]),
        'Optional-route decision evidence changed or was withdrawn.', 'STALE_SOURCE');
        requireData(!!proofEvidence?.length, 'Optional-route maintenance needs an exact qualified proof source.', 'FORBIDDEN');
      }
      if(proofEvidence) {
        requireData(loopVersion===2 && proofEvidence.length>0,'Proof-backed maintenance requires loop2 evidence.','FORBIDDEN');
        // V0 uses proof-only evidence; V2.1 must additionally bind every original to current exact judgments.
        await this.validateSources([...proofEvidence]);
        for(const ref of proofEvidence) {
          this.theorist(actor,ref.sessionId);
          requireData(this.isProofValid(ref),'Decision proof evidence changed or was withdrawn.','STALE_SOURCE');
          const source=await this.proofDocument(ref);
          if (optionalEvidence) {
            const provenance = source.meta.optionalProof;
            requireData(source.meta.status === 'valid' && ['2.1','3.0','4.0'].includes(source.meta.sourceLoopVersion??'') && provenance
              && ref.sessionId === optionalEvidence.sessionId && optionalEvidence.artifacts[provenance.artifactId] === provenance.artifactEvidenceKey
              && provenance.dependencies.every(dependency => optionalEvidence.artifacts[dependency.artifactId] === dependency.evidenceKey),
            'Decision requires qualified optional proof provenance and exact judgments for adopted dependencies.', 'STALE_SOURCE');
          } else if(rawEvidence) {
            requireData(source.meta.status==='valid'&&source.meta.sourceLoopVersion==='2.1'&&!!source.meta.originalAnswers?.length&&source.meta.originalAnswers.every(answer=>answer.projectId===rawEvidence.sessionId&&answer.completeness==='complete'&&Object.hasOwn(rawEvidence.judgments,answer.id)),'Decision requires an exact valid V2.1 archive and current judgments for every original.','STALE_SOURCE');
          } else requireData(source.meta.status==='valid' && source.meta.sourceLoopVersion==='0' && source.meta.v0OriginalAnswers?.length===1 && source.meta.v0OriginalAnswers[0]!.completeness==='complete','Decision requires an exact valid V0 archive.','STALE_SOURCE');
        }
      }
      const current = this.state.decisions[String(loopVersion) as '1' | '2'];
      requireData(current.version === expectedVersion, 'Global decision parent changed.', 'CONFLICT');
      const decision = reviseDecision(current, proposal), next = structuredClone(this.state);
      next.decisions[String(loopVersion) as '1' | '2'] = decision;
      next.decisionSupport ??= {};
      const support = next.decisionSupport[String(loopVersion) as '1' | '2'] ??= {};
      support[String(decision.version)] = { version: decision.version, parentVersion: current.version, status: 'valid',
        proofRefs: structuredClone([...(proofEvidence ?? [])]),
        ...(rawEvidence ? {rawEvidence:structuredClone(rawEvidence)} : {}),
        ...(optionalEvidence ? {optionalEvidence:structuredClone(optionalEvidence)} : {}) };
      if (operationId) next.appliedUpdates[operationId] = { kind: 'decision', id: String(loopVersion), version: decision.version, inputHash };
      await this.commit(next, { [`decisions/v${loopVersion}.json`]: json(decision), [`decisions/v${loopVersion}/revisions/${decision.version}.json`]: json(decision) }); return structuredClone(decision);
    });
  }

  /** Optional numeric maintenance is scoped to one already-published V3 Strategy batch. */
  async updateStrategyWeights(operationId: string, expectedVersion: number, patch: unknown, processed: ProofRef[], publicationId: string): Promise<WeightUpdateOutcome> {
    return this.serial(async () => {
      const operation = this.state.operations[operationId];
      requireData(operation?.purpose === 'v2-strategy' && operation.weightDecision && operation.weightAnchor,
        'A frozen V3 Strategy weight grant is required.', 'FORBIDDEN');
      const inputHash = stableHash({operationId,expectedVersion,patch,processed,publicationId});
      if (operation.weightUpdate) {
        requireData(operation.weightUpdate.inputHash === inputHash, 'Weight publication operation was reused.', 'CONFLICT');
        return structuredClone(operation.weightUpdate.outcome);
      }
      requireData(operation.status === 'running' && expectedVersion === operation.weightDecision.version,
        'Weight maintenance must use its running frozen Strategy review.', 'FORBIDDEN');
      const applied = this.state.appliedUpdates[publicationId];
      requireData(applied?.kind === 'resource', 'Weight maintenance requires its published Strategy.', 'FORBIDDEN');
      const strategy = await this.readJsonAt<ResourceMeta>(`${resourcePath(applied)}/meta.json`);
      requireData(strategy.kind === 'specific-strategy' && strategy.updatedBy?.role === 'moderator'
        && strategy.updatedBy.operationId === operationId && stableHash(strategy.sourceRefs) === stableHash(processed),
      'Weight sources must equal the associated Strategy processed sources.', 'FORBIDDEN');
      requireData(processed.length > 0 && processed.every(ref => operation.cases.some(c => sameRef(c.ref,ref))
        && operation.delivered.includes(sourceKey(ref))), 'Weight sources were not delivered in this review.', 'FORBIDDEN');
      await this.validateSources(processed);
      requireData(processed.every(ref => this.isProofValid(ref)), 'Weight source was withdrawn.', 'STALE_SOURCE');
      const next = structuredClone(this.state), current = next.decisions['2'];
      let outcome: WeightUpdateOutcome;
      const files: Record<string,string> = {};
      try {
        requireData(current.version === expectedVersion, 'Decision parent changed; optional weights skipped.', 'CONFLICT');
        const ids = ['M','R','D','N','E'];
        requireData(current.factors.length === ids.length && ids.every(id => current.factors.some(f => f.id === id)), 'Existing decision factors are outside the supported numeric scope.');
        requireData(patch !== null && typeof patch === 'object' && !Array.isArray(patch), 'Invalid optional weight update.');
        const value = patch as {weights?: Record<string,unknown>; reason?: unknown};
        requireData(Object.keys(value).every(k => k === 'weights' || k === 'reason'), 'Only numeric weights and a reason may be updated.');
        requireText(value.reason as string, 'weight update reason', 2000);
        requireData(value.weights && typeof value.weights === 'object' && !Array.isArray(value.weights)
          && Object.keys(value.weights).length === ids.length && ids.every(id => Object.hasOwn(value.weights!,id)), 'Provide exactly the existing five weights.');
        let sum = 0;
        const factors = current.factors.map(f => {
          const weight = value.weights![f.id], anchor = operation.weightAnchor![f.id];
          requireData(typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1, 'Invalid factor weight.');
          requireData(Number.isFinite(anchor) && Math.abs(weight-anchor!) <= anchor! * .1 + 1e-10, 'Weight exceeds its fixed anchor by more than 10%.');
          sum += weight; return {...f,weight};
        });
        requireData(Math.abs(sum-1) < 1e-8, 'Decision weights must sum to one.');
        if (factors.every((f,i) => f.weight === current.factors[i]!.weight)) outcome = {status:'unchanged',version:current.version};
        else {
          const decision: DecisionFile = {...current,version:current.version+1,parentVersion:current.version,factors};
          next.decisions['2'] = decision; next.decisionSupport ??= {}; next.decisionSupport['2'] ??= {};
          next.decisionSupport['2'][String(decision.version)] = {version:decision.version,parentVersion:current.version,status:'valid',proofRefs:structuredClone(processed)};
          files['decisions/v2.json'] = json(decision); files[`decisions/v2/revisions/${decision.version}.json`] = json(decision);
          outcome = {status:'applied',version:decision.version};
        }
      } catch (error) {
        if (!(error instanceof LearningDataError) || !['INVALID_INPUT','CONFLICT'].includes(error.code)) throw error;
        outcome = {status:'rejected',reason:error.message};
      }
      next.operations[operationId]!.weightUpdate = {inputHash,outcome};
      await this.commit(next,files); return structuredClone(outcome);
    });
  }

  async recordAnomalies(inputs: AnomalyInput[], actor: LearningActor): Promise<void> {
    this.theorist(actor);
    return this.serial(async () => {
      const next = structuredClone(this.state);
      for (const input of inputs) {
        this.theorist(actor, input.sessionId); safeId(input.id); safeId(input.attemptId);
        requireText(input.summary, 'compact anomaly', 6000); requireText(input.patternKey, 'pattern', 1000);
        requireData(Number.isSafeInteger(input.factorVersion) && input.factorVersion > 0, 'Invalid factor version.');
        const old = next.anomalies[input.id];
        requireData(!old || old.sessionId === input.sessionId && old.attemptId === input.attemptId, 'Anomaly belongs to another attempt.', 'CONFLICT');
        if (old && stableHash({ ...old, version: undefined }) === stableHash(input)) continue;
        // An event identity is tied to its attempt; renaming it must not multiply evidence.
        requireData(!Object.values(next.anomalies).some(a => a.id !== input.id && a.sessionId === input.sessionId && a.attemptId === input.attemptId && a.patternKey === input.patternKey), 'Duplicate anomaly event.');
        next.anomalies[input.id] = { ...input, version: (old?.version ?? 0) + 1 };
      }
      if (stableHash(next.anomalies) !== stableHash(this.state.anomalies)) await this.commit(next);
    });
  }
  async acknowledgeAttempts(sessionId: string, versions: Record<string, string>): Promise<void> {
    safeId(sessionId);
    return this.serial(async () => {
      const next = structuredClone(this.state), seen = next.inspectedAttempts[sessionId] ??= {};
      for (const [id, version] of Object.entries(versions)) { safeId(id); requireText(version, 'attempt version', 200); seen[id] = version; }
      await this.commit(next);
    });
  }

  async prepareReview(purpose: ReviewPurpose, options: { strategyAdmissionRecipe?: StrategyAdmissionRecipeV3; threshold?: number; limit?: number; strategyWeights?: boolean; capacityOrigin?: ReviewOperation['capacityOrigin'] } = {}): Promise<ReviewOperation | undefined> {
    requireData(purpose === 'v1-decision' || purpose === 'v2-strategy', 'Unknown Moderator task.');
    requireData(options.strategyAdmissionRecipe===undefined||options.strategyAdmissionRecipe==='structural-review-v1'&&purpose==='v2-strategy','Unsupported Strategy admission recipe.');
    return this.serial(async () => {
      const active = Object.values(this.state.operations).filter(o => o.purpose === purpose && ['queued', 'running', 'paused'].includes(o.status));
      const failed = Object.values(this.state.operations).filter(o => o.purpose === purpose && o.status === 'failed');
      const threshold = Math.max(1, options.threshold ?? 3), limit = Math.max(1, Math.min(options.limit ?? 8, 64));
      requireData(Number.isSafeInteger(threshold) && Number.isSafeInteger(limit), 'Review thresholds must be finite integers.');
      const operation: ReviewOperation = { ...(options.strategyAdmissionRecipe?{strategyAdmissionRecipe:options.strategyAdmissionRecipe}:{}),...(options.capacityOrigin?freezeCapacityReservationV3(options.capacityOrigin):{}),id: randomUUID(), purpose, status: 'queued', cases: [], anomalies: [], delivered: [], processed: [], repairResourceIds: [], repairKeys: {}, createdAt: new Date().toISOString() };
      if (purpose === 'v1-decision') {
        if (active.length) return undefined;
        const pending = Object.values(this.state.anomalies).filter(a => !this.state.receipts.some(r => r.purpose === purpose && r.sourceId === a.id && r.revision === a.version)
          && !failed.some(o => o.anomalies.some(ref => ref.id === a.id && ref.version === a.version)));
        if (pending.length < threshold) return undefined;
        operation.anomalies = pending.slice(0, limit).map(a => ({ id: a.id, version: a.version }));
        operation.expectedDecisionVersion = this.state.decisions['1'].version;
      } else {
        const unique = new Map<string, ProofRecord>();
        for (const proof of Object.values(this.state.proofs).filter(p => p.status === 'valid' && (!modernOptionalRevision(p.optionalProof?.operationRevision)||p.optionalProof?.learningEligibility==='eligible'||!!this.derivedProofMetadata(proofRef(p))))) {
          // Preserve each optional artifact for method diversity, but never give it
          // an independent case vote. Legacy equivalence remains unchanged.
          const key = proof.optionalProof ? `artifact:${proof.caseId}` : independentProofCaseKey(proof);
          const existing = unique.get(key);
          if (!existing || proof.createdAt < existing.createdAt) unique.set(key, proof);
        }
        const repair = Object.values(this.state.resources).filter(r => r.kind === 'specific-strategy' && !r.maintenance?.retired && (r.status === 'needs_review'||!!r.strategySupport&&!this.resourceSupportValid(r)));
        const repairKeys = Object.fromEntries(repair.map(resource => [resource.id, stableHash({ version: resource.version,
          invalidSources: resource.sourceRefs.filter(ref => !('kind' in ref) && this.state.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`]),
        })]));
        const repairPending = (resource: ResourceMeta, proof: ProofRecord, groupKey: string) => resource.tags.some(t => groupKey.split('|').includes(t))
          && !Object.values(this.state.operations).some(previous => ['completed', 'no-change'].includes(previous.status)
            && previous.repairKeys?.[resource.id] === repairKeys[resource.id]
            && previous.cases.some(c => c.ref.caseId === proof.caseId && c.ref.semanticRevision === proof.semanticRevision && c.groupKeys.includes(groupKey) && previous.processed.includes(sourceKey(c.ref))));
        const structuralExcluded=new Set<string>();
        if(options.strategyAdmissionRecipe)for(const previous of Object.values(this.state.operations))if(previous.purpose==='v2-strategy'&&previous.structuralAdmission){
          for(const item of previous.cases)if(['queued','running','paused','failed'].includes(previous.status)||previous.processed.includes(sourceKey(item.ref))){const proof=this.state.proofs[item.ref.caseId];if(proof)structuralExcluded.add(independentProofCaseKey(proof));}
        }
        const groups = new Map<string, ProofRecord[]>();
        for (const proof of unique.values()) for (const key of proofGroups(this.learningTags(proof))) {
          if(structuralExcluded.has(independentProofCaseKey(proof)))continue;
          if (active.some(o => o.cases.some(c => c.groupKeys.includes(key)))) continue;
          if (failed.some(o => o.cases.some(c => c.ref.caseId === proof.caseId && c.ref.semanticRevision === proof.semanticRevision))) continue;
          const repairGroup = repair.some(r => !r.maintenance&&repairPending(r, proof, key));
          if (repairGroup || !this.state.receipts.some(r => r.purpose === purpose && r.groupKey === key && r.sourceId === proof.caseId && r.semanticRevision === proof.semanticRevision)) (groups.get(key) ?? (groups.set(key, []), groups.get(key)!)).push(proof);
        }
        const chosen = new Map<string, { ref: ProofRef; groupKeys: string[] }>();
        const chosenCases = new Set<string>();
        for (const [groupKey, proofs] of groups) {
          const repairGroup = repair.some(r => !r.maintenance&&proofs.some(proof => repairPending(r, proof, groupKey)));
          if (new Set(proofs.map(independentProofCaseKey)).size < threshold && !repairGroup) continue;
          for (const proof of proofs) {
            const item = chosen.get(proof.caseId);
            if (item) item.groupKeys.push(groupKey);
            else if (chosen.size < 64 && (chosenCases.has(independentProofCaseKey(proof)) || chosenCases.size < limit)) {
              chosen.set(proof.caseId, { ref: proofRef(proof), groupKeys: [groupKey] });
              chosenCases.add(independentProofCaseKey(proof));
            }
          }
        }
        operation.cases = [...chosen.values()];
        operation.repairResourceIds = repair.filter(r => operation.cases.some(c => r.tags.some(t => c.groupKeys.some(g => g.split('|').includes(t))))||r.maintenance&&!r.tags.length&&operation.cases.length>=2).map(r => r.id);
        operation.repairKeys = Object.fromEntries(operation.repairResourceIds.map(id => [id, repairKeys[id]!]));
        if (!operation.cases.length && options.strategyAdmissionRecipe==='structural-review-v1') {
          const qualified=new Map<string,ProofRecord[]>();
          for(const meta of Object.values(this.state.resources))if(meta.kind==='method-skill'&&meta.enabled&&this.resourceAvailable(meta)){
            const support=await this.methodSupport.resolve(meta,ref=>this.readJsonAt<ResourceMeta>(`${resourcePath(ref)}/meta.json`));
            if(support.unverified)continue;
            const proofs=support.refs.map(ref=>this.state.proofs[ref.caseId]).filter((proof):proof is ProofRecord=>!!proof&&usesV3Proof(proof.sourceLoopVersion)&&unique.has(proof.optionalProof?`artifact:${proof.caseId}`:independentProofCaseKey(proof))&&support.refs.some(ref=>sameRef(ref,proofRef(proof)))&&this.isProofValid(proofRef(proof)));
            if(proofs.length)qualified.set(meta.id,proofs);
          }
          const nomination=nominateStructuralReviewV3(this.state,qualified,independentProofCaseKey,threshold,limit);
          if(nomination){
            operation.cases=nomination.cases;operation.structuralAdmission=nomination.descriptor;
            await this.validateStructuralReview(operation);
          }
        }
        if (!operation.cases.length) return undefined;
      }
      const next = structuredClone(this.state);
      if (purpose === 'v2-strategy' && options.strategyWeights && operation.cases.every(c => usesV3Proof(this.state.proofs[c.ref.caseId]?.sourceLoopVersion))) {
        next.strategyWeightAnchor ??= Object.fromEntries(this.state.decisions['2'].factors.map(f => [f.id,f.baseline]));
        operation.weightDecision = structuredClone(this.state.decisions['2']);
        operation.weightAnchor = structuredClone(next.strategyWeightAnchor);
      }
      next.operations[operation.id] = operation; await this.commit(next); return structuredClone(operation);
    });
  }

  private async validateStructuralReview(operation:ReviewOperation,allowOwnPublication=false):Promise<void> {
    const descriptor=operation.structuralAdmission;if(!descriptor)return;
    requireData(structuralDescriptorCurrentV3(this.state,descriptor),'Frozen structural review contributors changed.','STALE_SOURCE');
    await this.validateSources(descriptor.proofs);
    for(const owner of descriptor.owners){const meta=this.state.resources[owner.ref.id];requireData(meta&&meta.enabled&&this.catalogResourceAvailableV3(meta),'Structural review owner unavailable.','STALE_SOURCE');}
    for(const ref of descriptor.parentStrategies){
      const head=this.state.resources[ref.id],receipt=this.state.appliedUpdates[operation.id];
      const own=allowOwnPublication&&receipt?.kind==='resource'&&receipt.id===ref.id&&head?.version===receipt.version&&head.version>ref.version;
      const meta=own?head:await this.scientificBase(head,ref.version);
      requireData(meta&&(meta.version===ref.version||own)&&(head===meta?meta.enabled:head?.maintenance?.resumeEnabled)&&this.resourceAvailable(meta),'Frozen structural parent changed.','STALE_SOURCE');
      await this.validateSources(meta.sourceRefs);
    }
  }
  async validateStructuralReviewV3(id:string,allowOwnPublication=false):Promise<void> {const operation=this.state.operations[id];requireData(operation,'Review operation missing.','NOT_FOUND');await this.validateStructuralReview(operation,allowOwnPublication);}
  private strategyInReviewScope(operation:ReviewOperation,meta:ResourceMeta):boolean {
    return operation.repairResourceIds.includes(meta.id)||operation.structuralAdmission?.parentStrategies.some(ref=>ref.id===meta.id&&ref.version===meta.version)===true||operation.cases.some(c=>c.groupKeys.some(group=>meta.tags.some(tag=>group.split('|').includes(tag))));
  }
  async setReviewStatus(id: string, status: 'running' | 'failed' | 'paused', error?: string): Promise<ReviewOperation> {
    return this.serial(async () => {
      const next = structuredClone(this.state), operation = next.operations[id];
      requireData(operation && !['completed', 'no-change'].includes(operation.status), 'Review task cannot transition.');
      requireData(status !== 'running' || operation.status === 'queued' || operation.status === 'paused', 'Failed or unknown calls cannot be retried implicitly.');
      if (status === 'paused' && operation.status === 'failed') requireData(!Object.values(next.operations).some(other => other.id !== id && other.purpose === operation.purpose && ['queued', 'running', 'paused'].includes(other.status)
        && (operation.purpose === 'v1-decision' || other.cases.some(item => item.groupKeys.some(key => operation.cases.some(source => source.groupKeys.includes(key)))||(operation.structuralAdmission||other.structuralAdmission)&&operation.cases.some(source=>this.state.proofs[item.ref.caseId]&&this.state.proofs[source.ref.caseId]&&independentProofCaseKey(this.state.proofs[item.ref.caseId]!)===independentProofCaseKey(this.state.proofs[source.ref.caseId]!))))), 'A review of this evidence group is already active.', 'CONFLICT');
      operation.status = status; if (error) operation.error = error.slice(0, 4000);
      await this.commit(next); return structuredClone(operation);
    });
  }
  async purposeView(id: string,modelDirectedKnowledge?:true): Promise<ReviewView> {
    return this.serial(async () => {
      const next = structuredClone(this.state), operation = next.operations[id];
      requireData(operation?.status === 'running', 'Only running tasks receive a review context.', 'FORBIDDEN');
      await this.validateStructuralReview(operation);
      const view: ReviewView = { operation: structuredClone(operation) };
      if (operation.purpose === 'v1-decision') {
        requireData(this.state.decisions['1'].version === operation.expectedDecisionVersion, 'Frozen V1 decision has changed.', 'CONFLICT');
        view.decision = structuredClone(this.state.decisions['1']); view.patterns = [...this.state.patternsV1];
        view.anomalies = operation.anomalies.map(ref => {
          const record = this.state.anomalies[ref.id];
          requireData(record?.version === ref.version, 'Frozen anomaly changed before delivery.', 'STALE_SOURCE');
          return structuredClone(record);
        });
        operation.delivered = operation.anomalies.map(sourceKey);
      } else {
        view.outlines = await Promise.all(operation.cases.map(async item => {
          const document = await this.proofDocument(item.ref);
          if (document.meta.optionalProof) requireData(document.meta.status === 'valid' && this.isProofValid(item.ref), 'A frozen optional Moderator proof was withdrawn before delivery.', 'STALE_SOURCE');
          const learningMetadata = this.derivedProofMetadata(item.ref);
          return { ref: structuredClone(item.ref), meta: document.meta, summary: learningMetadata?.summary ?? document.summary,
            ...(learningMetadata ? {learningMetadata} : {}) };
        }));
        const summaries = new Map<string, OptionalCaseOutcomeSummary>();
        for (const outline of view.outlines) {
          const provenance = outline.meta.optionalProof;
          if (!provenance) continue;
          const outcome=provenance.acceptedOutcome, refutation=archivedRefutation(outline.meta);
          requireData(outcome.resultKind!=='open','Moderator summaries require a closed archive.');
          const summary = summaries.get(provenance.caseGroupId) ?? {caseGroupId:provenance.caseGroupId,evidenceKeys:[],routes:[]};
          summary.evidenceKeys.push(provenance.evidenceKey);
          summary.routes.push({artifactId:provenance.artifactId,authorRole:provenance.authorRole,methodKey:outline.meta.methodKey,
            routeReason:provenance.route.reason,resultKind:outcome.resultKind,...(refutation?{refutation}:{}),
            conditions:[...(modernOptionalRevision(provenance.operationRevision)?provenance.root.conditions:provenance.acceptedOutcome.conditions??[])],...(modernOptionalRevision(provenance.operationRevision)?{conditionsRole:'host-root-context' as const}:{}),exposureArtifactIds:[...provenance.exposureArtifactIds],
            dependencyArtifactIds:provenance.dependencies.map(dependency=>dependency.artifactId),proofRef:structuredClone(outline.ref)});
          summaries.set(provenance.caseGroupId,summary);
        }
        if (summaries.size) view.caseOutcomeSummaries = [...summaries.values()];
        if(modelDirectedKnowledge){view.strategies=operation.repairResourceIds.flatMap(id=>{const target=this.state.resources[id];return target&&(target.enabled||target.maintenance&&!target.maintenance.retired)?[structuredClone(target)]:[];});}else{
        const tags = new Set(view.outlines.flatMap(item => item.learningMetadata?.tags ?? item.meta.tags));
        view.strategies = Object.values(this.state.resources).filter(r => r.kind === 'specific-strategy' && (r.enabled||r.maintenance&&!r.maintenance.retired&&operation.repairResourceIds.includes(r.id)) && (r.status === 'valid' || operation.repairResourceIds.includes(r.id)) && (operation.structuralAdmission?this.strategyInReviewScope(operation,r):r.tags.some(t => tags.has(t)) && this.strategyInReviewScope(operation,r))).map(r => structuredClone(r));
        }
        operation.delivered = operation.cases.map(c => sourceKey(c.ref));
        const reader = this.proofReader(operation.cases.map(c => c.ref)); view.readProof = ref => reader.read(ref);
      }
      view.operation = structuredClone(operation); await this.commit(next); return view;
    });
  }

  async completeReview(id: string, processed: (ProofRef | AnomalyRef)[], outcome: 'completed' | 'no-change', patterns?: string[]): Promise<ReviewOperation> {
    return this.serial(async () => {
      const next = structuredClone(this.state), operation = next.operations[id];
      requireData(operation?.status === 'running', 'Review is not running.');
      await this.validateStructuralReview(operation,true);
      for (const ref of processed) {
        const key = sourceKey(ref); requireData(operation.delivered.includes(key), 'Cannot confirm an unread or newer source.', 'FORBIDDEN');
        if ('caseId' in ref) {
          const item = operation.cases.find(c => sameRef(c.ref, ref)); requireData(item && operation.purpose === 'v2-strategy', 'Proof not frozen in this task.', 'FORBIDDEN');
          for (const groupKey of item.groupKeys) if (!next.receipts.some(r => r.purpose === operation.purpose && r.groupKey === groupKey && r.sourceId === ref.caseId && r.semanticRevision === ref.semanticRevision)) next.receipts.push({ purpose: operation.purpose, groupKey, sourceId: ref.caseId, semanticRevision: ref.semanticRevision, revision: ref.revision, operationId: id });
        } else {
          requireData(operation.purpose === 'v1-decision' && operation.anomalies.some(r => r.id === ref.id && r.version === ref.version), 'Anomaly not frozen in this task.', 'FORBIDDEN');
          if (!next.receipts.some(r => r.purpose === operation.purpose && r.sourceId === ref.id && r.revision === ref.version)) next.receipts.push({ purpose: operation.purpose, groupKey: 'v1', sourceId: ref.id, semanticRevision: ref.version, revision: ref.version, operationId: id });
        }
      }
      if (patterns) { requireData(operation.purpose === 'v1-decision' && patterns.length <= 32 && patterns.every(p => typeof p === 'string' && p.length <= 4000), 'Only compact V1 patterns are allowed.'); next.patternsV1 = [...patterns]; }
      operation.processed = [...new Set(processed.map(sourceKey))]; operation.status = outcome;
      await this.commit(next); return structuredClone(operation);
    });
  }

  async invalidateProof(ref: ProofRef, actor: LearningActor, status: 'revoked' | 'needs_review' = 'revoked'): Promise<void> {
    this.theorist(actor, ref.sessionId);
    return this.serial(async () => {
      await this.proofDocument(ref);
      const next = structuredClone(this.state), current = next.proofs[ref.caseId];
      requireData(current, 'Proof unavailable.', 'NOT_FOUND');
      next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] = status;
      if (current.semanticRevision === ref.semanticRevision) current.status = status;
      for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source) && source.caseId === ref.caseId && source.semanticRevision === ref.semanticRevision)) resource.status = 'needs_review';
      await this.commit(next);
    });
  }
  /** Host-derived affected versions; inspect metadata, never ask a model to reread proofs. */
  async invalidateChapterSources(refs: readonly ChapterRef[], actor: LearningActor): Promise<ProofRef[]> {
    requireData(actor.role === 'theorist', 'Only Theorist can withdraw proof dependencies.', 'FORBIDDEN');
    this.theorist(actor, actor.sessionId);
    requireData(refs.every(ref => ref.sessionId === actor.sessionId), 'Chapter withdrawal is limited to this session.', 'FORBIDDEN');
    if (!refs.length) return [];
    return this.serial(async () => {
      const keys = new Set(refs.map(chapterKey)), next = structuredClone(this.state);
      // Include historical versions still cited by learned resources, not just current finals.
      const candidates = this.proofDependencyCandidates(next);
      const seen = new Set<string>(), affected: ProofRef[] = [];
      for (const ref of candidates) {
        if (ref.sessionId !== actor.sessionId || seen.has(stableHash(ref))) continue;
        seen.add(stableHash(ref));
        const meta = await this.readJsonAt<ProofRecord>(`${proofPath(ref)}/meta.json`);
        requireData(sameRef(proofRef(meta), ref), 'Frozen proof dependency metadata mismatch.', 'FORBIDDEN');
        if (!meta.evidenceChapters?.some(chapter => keys.has(chapterKey(chapter)))) continue;
        const status = next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] === 'revoked' ? 'revoked' : 'needs_review';
        next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] = status;
        const current = next.proofs[ref.caseId];
        if (current?.semanticRevision === ref.semanticRevision && current.status !== 'revoked') current.status = status;
        affected.push(ref);
      }
      if (affected.length) {
        for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source)
          && affected.some(ref => ref.caseId === source.caseId && ref.semanticRevision === source.semanticRevision))) resource.status = 'needs_review';
        await this.commit(next);
      }
      return affected;
    });
  }
  async recordV21ReviewEvidence(sessionId:string, judgments:Record<string,string>, invalidated:string[], actor:LearningActor, reviewId?:string):Promise<void> {
    this.theorist(actor,sessionId);
    await this.serial(async()=>{
      if(reviewId && this.state.v21AppliedReviews?.[sessionId]?.includes(reviewId)) return;
      const next=structuredClone(this.state); next.v21ReviewEvidence??={}; const evidence=next.v21ReviewEvidence[sessionId]??={};
      for(const id of invalidated) delete evidence[id];
      for(const [id,hash] of Object.entries(judgments)) evidence[id]=hash;
      if(reviewId) {next.v21AppliedReviews??={};(next.v21AppliedReviews[sessionId]??=[]).push(reviewId);}
      for(const resource of Object.values(next.resources)) if(resource.sourceRefs.some(ref=>{if(!('kind' in ref))return false;const failure=next.failures[ref.id];return failure?.sourceLoopVersion==='2.1' && !failure.optionalArtifact && next.v21ReviewEvidence?.[failure.sessionId]?.[failure.attemptId]!==failure.judgmentHash;}))resource.status='needs_review';
      await this.commit(next);
    });
  }
  /** Current accepted role-neutral judgments, never restored by a stale checkpoint. */
  async recordV21OptionalEvidence(sessionId: string, artifacts: Record<string,string>, actor: LearningActor): Promise<void> {
    this.theorist(actor,sessionId);
    await this.serial(async () => {
      const next = structuredClone(this.state); next.v21OptionalEvidence ??= {};
      const evidence = next.v21OptionalEvidence[sessionId] ??= {};
      next.v21OptionalAppliedEvidence ??= {}; const applied = next.v21OptionalAppliedEvidence[sessionId] ??= {};
      for (const [id, hash] of Object.entries(artifacts)) {
        requireText(id,'artifact identity',1000); requireData(/^[a-f0-9]{64}$/u.test(hash),'Invalid optional evidence hash.');
        if (applied[id]?.includes(hash)) continue;
        (applied[id] ??= []).push(hash);
        if (!next.v21OptionalInvalidArtifacts?.[optionalArtifactKey(sessionId,id)]) evidence[id] = hash;
      }
      if (stableHash(next.v21OptionalAppliedEvidence) !== stableHash(this.state.v21OptionalAppliedEvidence ?? {})) await this.commit(next);
    });
  }
  /** Withdraw originals and all adopted derivatives without changing their audit bytes. */
  async invalidateOptionalProofSources(artifactIds: readonly string[], actor: LearningActor): Promise<ProofRef[]> {
    this.theorist(actor);
    if (!artifactIds.length) return [];
    return this.serial(async () => {
      const ids = new Set(artifactIds), next = structuredClone(this.state);
      next.v21OptionalInvalidArtifacts ??= {};
      for (const id of ids) {
        requireText(id,'artifact identity',1000);
        next.v21OptionalInvalidArtifacts[optionalArtifactKey(actor.sessionId,id)] = true;
        if (next.v21OptionalEvidence?.[actor.sessionId]) delete next.v21OptionalEvidence[actor.sessionId]![id];
      }
      const candidates = this.proofDependencyCandidates(next), seen = new Set<string>(), affected: ProofRef[] = [];
      for (const ref of candidates) {
        if (seen.has(stableHash(ref))) continue;
        seen.add(stableHash(ref));
        const meta = await this.readJsonAt<ProofRecord>(`${proofPath(ref)}/meta.json`);
        requireData(sameRef(proofRef(meta),ref),'Frozen optional dependency metadata mismatch.','FORBIDDEN');
        const provenance = meta.optionalProof;
        if (!provenance || !(ref.sessionId===actor.sessionId&&(ids.has(provenance.artifactId)||provenance.dependencies.some(dependency=>ids.has(dependency.artifactId))))
          && !provenance.v4TheorySupport?.sources.some(source=>source.projectId===actor.sessionId&&ids.has(source.artifactId))) continue;
        const status = next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] === 'revoked' ? 'revoked' : 'needs_review';
        next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] = status;
        const current = next.proofs[ref.caseId];
        if (current?.semanticRevision === ref.semanticRevision && current.status !== 'revoked') current.status = status;
        affected.push(ref);
      }
      for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source)
        && affected.some(ref => ref.caseId === source.caseId && ref.semanticRevision === source.semanticRevision))) resource.status = 'needs_review';
      if (stableHash(next) !== stableHash(this.state)) await this.commit(next);
      return affected;
    });
  }
  /** Only a newly completed explicit scientific review can restore eligibility.
   * Prior proof semantic versions and their derived learning remain withdrawn. */
  async requalifyOptionalProofSources(sessionId:string, artifacts:{artifactId:string;evidenceKey:string;originalRef:RawAnswerRefV21}[],
    review:{callId:string;evidenceRevision:number},actor:LearningActor):Promise<void> {
    this.theorist(actor,sessionId);
    requireData(artifacts.length > 0 && new Set(artifacts.map(artifact=>artifact.artifactId)).size === artifacts.length
      && Number.isSafeInteger(review.evidenceRevision) && review.evidenceRevision > 0,'Explicit requalification requires distinct artifacts and a fresh evidence revision.');
    requireText(review.callId,'scientific review call',1000);
    await this.serial(async()=>{
      const key = stableHash([sessionId,review.callId]), inputHash = stableHash({sessionId,artifacts,review});
      const prior = this.state.v21OptionalRequalifications?.[key];
      if (prior) { requireData(prior.inputHash === inputHash,'Scientific requalification call was reused for different evidence.','CONFLICT'); return; }
      const next=structuredClone(this.state); next.v21OptionalEvidence??={}; const evidence=next.v21OptionalEvidence[sessionId]??={};
      next.v21OptionalAppliedEvidence??={}; const applied=next.v21OptionalAppliedEvidence[sessionId]??={};
      for (const artifact of artifacts) {
        requireData(artifact.originalRef.owner === sessionId && artifact.originalRef.projectId === sessionId
          && artifact.originalRef.completeness === 'complete' && /^[a-f0-9]{64}$/u.test(artifact.evidenceKey),'Requalification requires an exact complete owned original.');
        const archived=Object.values(next.proofs).find(proof=>proof.sessionId===sessionId&&proof.optionalProof?.artifactId===artifact.artifactId);
        requireData(!archived || stableHash(archived.optionalProof!.originalRef)===stableHash(artifact.originalRef),'Requalification cannot replace an immutable original.','CONFLICT');
        requireData(!applied[artifact.artifactId]?.includes(artifact.evidenceKey),'Requalification must carry a new exact scientific judgment pin.','STALE_SOURCE');
        if (next.v21OptionalInvalidArtifacts) delete next.v21OptionalInvalidArtifacts[optionalArtifactKey(sessionId,artifact.artifactId)];
        evidence[artifact.artifactId]=artifact.evidenceKey;(applied[artifact.artifactId]??=[]).push(artifact.evidenceKey);
      }
      next.v21OptionalRequalifications??={};next.v21OptionalRequalifications[key]={inputHash,evidenceRevision:review.evidenceRevision};
      await this.commit(next);
    });
  }
  private proofDependencyCandidates(state: ResearchLibraryState): ProofRef[] {
    return [...Object.values(state.proofs).map(proofRef),
      ...Object.values(state.resources).flatMap(resource=>resource.sourceRefs.filter((ref):ref is ProofRef=>!('kind' in ref))),
      ...Object.values(state.operations).flatMap(operation=>operation.cases.map(item=>item.ref)),
      ...Object.values(state.decisionSupport??{}).flatMap(versions=>Object.values(versions).flatMap(support=>support.proofRefs))];
  }
  async invalidateRawAnswerSources(refs: readonly RawAnswerRefV21[], actor: LearningActor): Promise<ProofRef[]> {
    requireData(actor.role === 'theorist', 'Only Theorist can withdraw proof dependencies.', 'FORBIDDEN');
    this.theorist(actor, actor.sessionId);
    requireData(refs.every(ref => ref.projectId === actor.sessionId), 'Raw-answer withdrawal is limited to this session.', 'FORBIDDEN');
    if (!refs.length) return [];
    return this.serial(async () => {
      const keys = new Set(refs.map(ref => stableHash(ref))), next = structuredClone(this.state);
      // Include historical versions still cited by learned resources, not just current finals.
      const candidates = this.proofDependencyCandidates(next);
      const seen = new Set<string>(), affected: ProofRef[] = [];
      for (const ref of candidates) {
        if (ref.sessionId !== actor.sessionId || seen.has(stableHash(ref))) continue;
        seen.add(stableHash(ref));
        const meta = await this.readJsonAt<ProofRecord>(`${proofPath(ref)}/meta.json`);
        requireData(sameRef(proofRef(meta), ref), 'Frozen proof dependency metadata mismatch.', 'FORBIDDEN');
        if (!meta.originalAnswers?.some(answer => keys.has(stableHash(answer)))
          && !(meta.optionalProof && [meta.optionalProof.originalRef,...meta.optionalProof.dependencies.map(dependency=>dependency.originalRef)].some(answer=>keys.has(stableHash(answer))))) continue;
        const status = next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] === 'revoked' ? 'revoked' : 'needs_review';
        next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] = status;
        const current = next.proofs[ref.caseId];
        if (current?.semanticRevision === ref.semanticRevision && current.status !== 'revoked') current.status = status;
        affected.push(ref);
      }
      if (affected.length) {
        for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source)
          && affected.some(ref => ref.caseId === source.caseId && ref.semanticRevision === source.semanticRevision))) resource.status = 'needs_review';
        await this.commit(next);
      }
      return affected;
    });
  }
  async invalidateV0RawAnswerSources(refs: readonly RawAnswerRefV0[], actor: LearningActor): Promise<ProofRef[]> {
    requireData(actor.role === 'theorist', 'Only Theorist can withdraw proof dependencies.', 'FORBIDDEN');
    this.theorist(actor, actor.sessionId);
    requireData(refs.every(ref => ref.projectId === actor.sessionId), 'Raw-answer withdrawal is limited to this session.', 'FORBIDDEN');
    if (!refs.length) return [];
    return this.serial(async () => {
      const keys = new Set(refs.map(ref => stableHash(ref))), next = structuredClone(this.state);
      next.v0InvalidOriginals ??= {};
      for(const key of keys) next.v0InvalidOriginals[key]=true;
      // Include historical versions still cited by learned resources, not just current finals.
      const candidates = this.proofDependencyCandidates(next);
      const seen = new Set<string>(), affected: ProofRef[] = [];
      for (const ref of candidates) {
        if (ref.sessionId !== actor.sessionId || seen.has(stableHash(ref))) continue;
        seen.add(stableHash(ref));
        const meta = await this.readJsonAt<ProofRecord>(`${proofPath(ref)}/meta.json`);
        requireData(sameRef(proofRef(meta), ref), 'Frozen proof dependency metadata mismatch.', 'FORBIDDEN');
        if (!meta.v0OriginalAnswers?.some(answer => keys.has(stableHash(answer)))) continue;
        const status = next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] === 'revoked' ? 'revoked' : 'needs_review';
        next.invalidProofs[`${ref.caseId}:${ref.semanticRevision}`] = status;
        const current = next.proofs[ref.caseId];
        if (current?.semanticRevision === ref.semanticRevision && current.status !== 'revoked') current.status = status;
        affected.push(ref);
      }
      {
        for (const resource of Object.values(next.resources)) if (resource.sourceRefs.some(source => !('kind' in source)
          && affected.some(ref => ref.caseId === source.caseId && ref.semanticRevision === source.semanticRevision))) resource.status = 'needs_review';
        await this.commit(next);
      }
      return affected;
    });
  }
  async archive(subjects: ArchiveSubject[], now = new Date().toISOString()): Promise<string[]> {
    requireData(Number.isFinite(Date.parse(now)), 'Invalid archive time.');
    return this.serial(async () => {
      if (this.state.archive.checkedAt && Date.parse(now) - Date.parse(this.state.archive.checkedAt) < 86_400_000) return [];
      const pinned = new Set(Object.values(this.state.operations).filter(o => ['queued', 'running', 'paused'].includes(o.status)).flatMap(o => o.cases.map(c => c.ref.sessionId)));
      const candidates = archiveCandidates(subjects.map(subject => ({ ...subject,
        hasValidProof: subject.hasValidProof || subject.kind === 'session' && Object.values(this.state.proofs).some(p => p.sessionId === subject.sessionId && p.status === 'valid'),
        learningPinned: subject.learningPinned || pinned.has(subject.sessionId),
      })), now), next = structuredClone(this.state); next.archive.checkedAt = now;
      for (const id of candidates) next.archive.cold[id] ??= now;
      await this.commit(next); return candidates;
    });
  }
  async recordActivity(records: { sessionId: string; fingerprint: string; initialAt?: string }[], now = new Date().toISOString()): Promise<Record<string, { fingerprint: string; lastActivityAt: string }>> {
    requireData(Number.isFinite(Date.parse(now)), 'Invalid activity time.');
    return this.serial(async () => {
      const next = structuredClone(this.state), activity = next.archive.activity ??= {}; let changed = false;
      for (const record of records) {
        safeId(record.sessionId); requireText(record.fingerprint, 'activity fingerprint', 200);
        const prior = activity[record.sessionId];
        if (prior?.fingerprint === record.fingerprint) continue;
        const initialAt = record.initialAt && Number.isFinite(Date.parse(record.initialAt)) ? record.initialAt : now;
        activity[record.sessionId] = { fingerprint: record.fingerprint, lastActivityAt: prior ? now : initialAt }; changed = true;
        // Actual research/editing restores the session; a catalog read does not.
        if (prior) for (const id of Object.keys(next.archive.cold)) if (id === `session:${record.sessionId}` || id.startsWith(`attempt:${record.sessionId}:`) || id.startsWith(`failure:${record.sessionId}:`)) delete next.archive.cold[id];
      }
      if (changed) await this.commit(next);
      return structuredClone(activity);
    });
  }
  async restoreArchived(ids: string[]): Promise<void> {
    return this.serial(async () => { const next = structuredClone(this.state); for (const id of ids) delete next.archive.cold[id]; await this.commit(next); });
  }
  async close(): Promise<void> { this.closed = true; await this.queue; }
}
