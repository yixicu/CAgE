import {stageModel} from './model-bindings.js';
import {routeSelectionPresentation} from '../../../learning/knowledge-map-presentation.js';
import {reconcileReportReviews,reviewOpposedArchives} from './report-review.js';
import {matchesPendingReview} from '../../../learning/report-assessment.js';
import {MapResearch} from './map-research.js';
import {registerReportMapSource} from './map-sources.js';
import {admitMapMaintenance,startMapMaintenance,waitMapMaintenance} from './map-maintenance.js';
import {KnowledgeResearchV4} from './knowledge-research.js';
import type { AgentRuntimeV21, CallV21, InFlightEpochV21, ResearchProjectV21 } from '../../contracts/v21.js';
import type { OptionalProofArtifactV21 } from '../v21/optional-types.js';
import { budgetControlsEnabledV3 } from '../v3/capacity-policy.js';
import { getV4Coordinator, type V4Scope } from './coordinator.js';
import type { TheoryRequestV4 } from './moderator.js';
import type { StagePassage } from './theory-trial.js';
import type { ProofRef } from '../../../learning/research-data.js';
import { PublishedTheoriesV4 } from './published.js';
import { publicFragmentsV4 } from './fragments.js';
import {reportOutcomeV45,type ResearchReplyV45,type ReportEvidenceV45} from './post-report.js';
import {digestV21} from '../v21/state.js';

interface TheoryRuntime extends AgentRuntimeV21 {
  invokeTheoryV4?(request: TheoryRequestV4): Promise<unknown>;
  theoryCapacityV4?(): number;
}

function publicStage(a: OptionalProofArtifactV21): StagePassage | undefined {
  if (!a.acceptanceCommitted || a.authorRole !== 'theorist' || a.control.outcome.resultKind !== 'open'
      || a.control.action !== 'continue' || a.qualification === 'needs-review' || a.qualification === 'rejected'
      || a.technical.executionStatus !== 'completed' || a.originalRef.completeness !== 'complete') return;
  // Only the public result declaration is released. Raw manuscripts and private tool traces stay behind their grants.
  const { reason, gaps, outline } = a.control.outcome;
  const passage = [reason, ...(outline ?? []), ...gaps.map(gap => 'Open: ' + gap)].join('\n');
  if (!reason.trim() || Buffer.byteLength(passage) > 8192) return;
  return { stageId: a.id, branch: 'root', passage, conditions: [...a.root.conditions] };
}

/** One instance per active V4 run. All durable decisions belong to the data-root coordinator. */
export class ProofBridgeV4 {
  private readonly coordinator;
  private readonly catalogue;
  private readonly controller = new AbortController();
  private job?: Promise<void>;
  private submitted = new Set<string>();
  private spent = {calls:0,tokens:0,costUsd:0};
  constructor(private readonly dataRoot: string, private readonly runtime: TheoryRuntime,
    private readonly proofValid:(ref:ProofRef)=>boolean,
    private readonly revoked:(p:ResearchProjectV21,m:InFlightEpochV21,id:string,reviewId?:string)=>Promise<boolean>,
    private readonly sourceProject?:(id:string)=>Promise<ResearchProjectV21>,
    private readonly knowledgeLibrary?:import('../../../learning/research-library.js').ResearchLibrary) {
    this.coordinator = getV4Coordinator(dataRoot);
    this.catalogue = new PublishedTheoriesV4(dataRoot);
  }
  cancel() { this.controller.abort(); }
  async restore(p:ResearchProjectV21,m:InFlightEpochV21) {
    if(m.snapshot.theoryRevision==='v4-operation-5')return;
    // Retry one durable optional write from a prior checkpoint, without rerunning any scientific call.
    const prior=p.epochs.findLast(e=>e.snapshot.id!==m.snapshot.id && e.optionalFlow?.notices.includes(
      'V4 theory publication deferred for '+e.optionalFlow.selectedArtifactId));
    if(prior?.optionalFlow && !prior.optionalFlow.conflictArtifactIds.length){
      const artifact=prior.optionalFlow.artifacts.find(a=>a.id===prior.optionalFlow!.selectedArtifactId && a.qualification==='valid');
      const receipt=prior.optionalFlow.archives.find(r=>r.status==='saved' && r.artifactId===artifact?.id);
      if(artifact && receipt?.proofRef){
        try {await this.publish(p,{...prior,projectId:p.id,loop:m.loop,schemaVersion:3},artifact,receipt.proofRef);}
        catch { /* The archived pending marker preserves the failed publication for a future retry. */ }
      }
    }
    await this.catalogue.freeze(p.id,m.snapshot.id);
    this.spent=await this.coordinator.usage(this.scope(p,m),this.envelope(m));
    const accepted=new Set(m.optionalFlow?.artifacts.filter(a=>a.acceptanceCommitted).map(a=>a.originalRef.callId));
    for(const call of m.calls) if(accepted.has(call.id)) await this.acknowledge(p,m,call);
  }
  async pause() { this.cancel(); await this.job; }
  startPostReport(p:ResearchProjectV21,m:InFlightEpochV21,halted:()=>Promise<boolean>,warn:(message:string)=>void){
    if(this.job||this.controller.signal.aborted||m.snapshot.theoryRevision!=='v4-operation-5')return;
    this.job=this.drain(p,m,halted,warn).catch(()=>warn('Post-report research deferred; the durable report remains available for recovery.')).finally(()=>{this.job=undefined;});
  }
  async drainArchive(p:ResearchProjectV21,m:InFlightEpochV21,halted:()=>Promise<boolean>,warn:(message:string)=>void){
    // The archived epoch inherits the pump that started while late Workers were being collected.
    // Keep it registered for STOP and shutdown, then scan the final checkpoint for supplements.
    if(m.snapshot.theoryRevision==='v4-operation-5'&&this.job)await this.job;
    return this.drain(p,m,halted,warn);
  }
  private async drain(p:ResearchProjectV21,m:InFlightEpochV21,halted:()=>Promise<boolean>,warn:(message:string)=>void){
    if(p.status==='stopped'||this.controller.signal.aborted||await halted())return;
    if(m.snapshot.theoryRevision==='v4-operation-5'){
      for(const a of m.optionalFlow?.artifacts??[])await this.report(p,m,a);
      for(const b of m.optionalFlow?.branches??[])if(b.artifactId&&(m.optionalFlow?.artifacts??[]).some(a=>a.publicReport?.pendingBranches.some(p=>p.id===b.id))){const a=m.optionalFlow?.artifacts.find(a=>a.id===b.artifactId);if(a)await this.supplement(p,m,a);}
      if(this.knowledgeLibrary)await reviewOpposedArchives(this.dataRoot,this.knowledgeLibrary,p,m);
      const model=stageModel(m.snapshot.modelConfig,'report');
      const mapModel=stageModel(m.snapshot.modelConfig,'mapMaintenance');
      const map=m.snapshot.knowledgeMapRevision&&this.knowledgeLibrary?new MapResearch(this.dataRoot,this.knowledgeLibrary):undefined;
      const reconcileAssessments=()=>this.knowledgeLibrary&&m.snapshot.mapGapPolicy?reconcileReportReviews(this.dataRoot,this.knowledgeLibrary,p.id,this.scope(p,m)):Promise.resolve();
      await reconcileAssessments();
      if(!this.runtime.invokeTheoryV4)return;
      const pumpMap=async()=>{if(!map||!mapModel||!this.knowledgeLibrary)return;await admitMapMaintenance({dataRoot:this.dataRoot,library:this.knowledgeLibrary,ownerId:'local-user',projectId:p.id,model:mapModel,budget:m.snapshot.config.roleBudget});startMapMaintenance({dataRoot:this.dataRoot,library:this.knowledgeLibrary,runtime:this.runtime,projectId:p.id,signal:this.controller.signal,onError:()=>warn('Knowledge maintenance deferred; its exact source and task remain saved.')});};
      if(map){for(const study of (await this.coordinator.snapshot(this.scope(p,m))).postReports)if(await this.authorizeReport(p,m,study.report))await map.reconcile(study);await pumpMap();}
      if(!model)return;
      while(!await halted()&&!this.controller.signal.aborted){
        const known=await this.catalogue.readReportStudies(report=>this.authorizeReport(p,m,report));
        const sources=[];for(const prior of await this.coordinator.researchReports())if(prior.report.scope.projectId===p.id&&await this.authorizeReport(p,m,prior.report))sources.push(prior.report);
        const knowledge=m.snapshot.knowledgeNetworkRevision&&this.knowledgeLibrary?new KnowledgeResearchV4(this.knowledgeLibrary,this.catalogue,report=>this.authorizeReport(p,m,report),!!m.snapshot.knowledgeMapRevision):undefined;
        await knowledge?.reconcile(p.id);
        const advanced=await this.coordinator.runReport(this.scope(p,m),async(study,journal)=>{
          await knowledge?.prepare(study);await map?.prepare(study);
          const reply=await this.runtime.invokeTheoryV4!({revision:'v4-operation-5',purpose:study.phase==='review'?'challenge':'assess',reportStudy:study,stages:[],previous:undefined,projectId:p.id,callId:study.nativeReply?.callId??study.id+'_'+study.responses.length,model,budget:{...m.snapshot.config.roleBudget,maxTokens:undefined,maxCostUsd:undefined},knownTheories:knowledge?[]:known.filter(c=>c.source.scope.projectId===p.id).map(c=>c.body),signal:this.controller.signal,...journal}) as ResearchReplyV45;
          return reply;
        },(report,review)=>this.authorizeReport(p,m,report,review),this.controller.signal,sources,knowledge||m.snapshot.knowledgeMapPresentation?[]:known.filter(c=>c.source.scope.projectId===p.id).map(c=>c.source),knowledge||map?async study=>{await knowledge?.prepare(study);await map?.prepare(study);}:undefined,async(study,reply)=>{const resolved=knowledge?await knowledge.resolve(study,reply):reply;return map?map.resolve(study,resolved):resolved;});
        await reconcileAssessments();
        for(const study of (await this.coordinator.snapshot(this.scope(p,m))).postReports)if(study.publication&&await this.authorizeReport(p,m,study.report)){if(knowledge)await knowledge.publish(study);else await this.catalogue.publishReportStudy(study,report=>this.authorizeReport(p,m,report));}
        if(map){for(const study of (await this.coordinator.snapshot(this.scope(p,m))).postReports)if(await this.authorizeReport(p,m,study.report))await map.reconcile(study);await pumpMap();}
        if(!advanced){if(map)await waitMapMaintenance(this.dataRoot,p.id);return;}
      }
      return;
    }
    // The coordinator admits only pre-existing archive-only work for this closed scope.
    await this.catalogue.freeze(p.id,m.snapshot.id);
    for(let unit=0;unit<(m.snapshot.theoryRevision==='v4-operation-4'?12:4);unit++){
      if(await halted()||this.controller.signal.aborted){await this.coordinator.closeScope(this.scope(p,m));return;}
      const snapshot=await this.coordinator.snapshot(this.scope(p,m));
      if(!snapshot.tasks.some(t=>t.archiveOnly&&['ready','sending'].includes(t.status)))return;
      await this.boundary(p,m,0,halted,warn,true);
      await this.job;
    }
  }
  async finish(p:ResearchProjectV21,m:InFlightEpochV21,stopped=false) {
    if(m.snapshot.theoryRevision==='v4-operation-5'){if(stopped)this.cancel();return;}
    if(stopped)this.cancel();
    if(['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')){
      await this.coordinator.closeScope(this.scope(p,m),{archiveOnly:!this.controller.signal.aborted});
      if(this.job)void this.job.then(()=>this.publishIndependent(p,m)).catch(()=>{});
      return;
    }
    await this.coordinator.closeScope(this.scope(p,m));
    this.cancel();
    await this.job;
  }
  async acknowledge(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21) {
    if(m.snapshot.theoryRevision==='v4-operation-5')return;
    const guidance=(call.input as {v4Guidance?:{applications:{id:string}[]}}).v4Guidance;
    if(call.status==='completed' && guidance?.applications.length) {
      await this.coordinator.acknowledgeApplications(this.scope(p,m),guidance.applications.map(a=>a.id),call.id);
    }
  }
  private scope(p: ResearchProjectV21, m: InFlightEpochV21): V4Scope {
    return { projectId:p.id, epochId:m.snapshot.id, rootId:m.snapshot.root.revision };
  }
  async report(p:ResearchProjectV21,m:InFlightEpochV21,a:OptionalProofArtifactV21){
    if(m.snapshot.theoryRevision!=='v4-operation-5'||a.authorRole!=='theorist'||!a.acceptanceCommitted||!['complete','pause'].includes(a.control.action)||a.technical.executionStatus!=='completed')return;
    // Only the explicitly released final public body crosses the research grant.
    if(!a.publicReport)return;
    const report={scope:this.scope(p,m),artifactId:a.id,...structuredClone(a.publicReport),...reportOutcomeV45(a)};
    await this.coordinator.submitReport(report,m.snapshot.nativeHandoff,m.snapshot.modelDirectedKnowledge,m.snapshot.resultContract?true:undefined,m.snapshot.mapGapPolicy?true:undefined,m.snapshot.scientificMapWrites,m.snapshot.mapNodeWriting,m.snapshot.contextCompaction);
    if(m.snapshot.knowledgeMapRevision&&this.knowledgeLibrary)await registerReportMapSource(this.knowledgeLibrary,m.snapshot,a,report);
  }
  async supplement(p:ResearchProjectV21,m:InFlightEpochV21,a:OptionalProofArtifactV21){
    if(m.snapshot.theoryRevision!=='v4-operation-5'||a.authorRole==='theorist')return;
    await this.coordinator.supplementReport(this.scope(p,m),a.id,[a.control.outcome.reason,...a.control.outcome.outline??[],...a.control.outcome.gaps].join('\n'));
  }
  private async authorizeReport(p:ResearchProjectV21,m:InFlightEpochV21,report:ReportEvidenceV45,review?:import('../../../learning/report-assessment.js').ReportUpdate){
    if(report&&this.knowledgeLibrary?.opposingReportHeld(report.scope.projectId,report.artifactId))return false;
    const assessment=report&&this.knowledgeLibrary?.reportAssessment(report.scope.projectId,report.artifactId);
    if(assessment&&assessment.status!=='confirmed'&&!matchesPendingReview(assessment,review))return false;
    if(!report||report.scope.projectId!==p.id&&!this.sourceProject)return false;
    for(const source of report.related??[])if(!await this.authorizeReport(p,m,source))return false;
    const current=this.sourceProject?await this.sourceProject(report.scope.projectId):p;
    const epoch=current.activeEpoch?.snapshot.id===report.scope.epochId?current.activeEpoch:current.epochs.find(e=>e.snapshot.id===report.scope.epochId)??(report.scope.epochId===m.snapshot.id&&report.scope.projectId===p.id?m:undefined);
    if(!epoch)return false;
    const a=epoch.optionalFlow?.artifacts.find(a=>a.id===report.artifactId);
    if(!a||digestV21(report.body)!==a.originalRef.bodyHash)return false;
    const verdict=reportOutcomeV45(a);
    if(report.empiricalEvidence!==verdict.empiricalEvidence||report.refutationKind!==verdict.refutationKind)return false;
    // Late supplements are explicitly unassessed context, not automatic withdrawal of the report.
    return !!a?.acceptanceCommitted&&a.publicReport?.body===report.body&&a.publicReport.bodyHash===report.bodyHash&&a.authorRole==='theorist'&&a.root.revision===report.scope.rootId&&a.qualification!=='rejected'&&a.qualification!=='needs-review'&&!await this.revoked(current,{...epoch,schemaVersion:3,projectId:current.id,loop:m.loop},a.id,matchesPendingReview(assessment,review)?a.id:undefined);
  }
  private async shared(p:ResearchProjectV21,m:InFlightEpochV21) {
    const legacy=await this.catalogue.read(p.id,m.snapshot.id,this.proofValid,m.snapshot.root.originalText);
    if(!['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??''))return legacy;
    return [...legacy,...await this.catalogue.readResearch(p.id,m.snapshot.id,(stage,scope)=>this.authorize(p,m,stage,scope,true),this.proofValid)];
  }
  private async publishIndependent(p:ResearchProjectV21,m:InFlightEpochV21){
    if(!['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')||this.controller.signal.aborted)return;
    const valid=(stage:StagePassage,scope:V4Scope)=>this.authorize(p,m,stage,scope);
    for(const publication of await this.coordinator.publicationEvidence(this.scope(p,m),valid,()=>this.shared(p,m)))
      await this.catalogue.publishResearch(publication,valid);
  }
  async publish(p:ResearchProjectV21,m:InFlightEpochV21,a:OptionalProofArtifactV21,proof:ProofRef) {
    if(m.snapshot.theoryRevision==='v4-operation-5')return;
    if(['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')){await this.publishIndependent(p,m);return;}
    if(a.authorRole!=='theorist'||!this.proofValid(proof))return;
    const scope=this.scope(p,m);
    const use=(a.control.outcome.tags??[]).filter(tag=>tag.startsWith('method:theory-use/'));
    for(const tag of use){
      const theory=await this.coordinator.publicationCandidate(scope,tag.slice('method:theory-use/'.length),
        (stage,origin)=>this.authorize(p,m,stage,origin),()=>this.shared(p,m));
      if(!theory)continue;
      const {primitives,laws,modelConditions,construction,internalClaim,derivation}=theory.proposal;
      // The final proof may use a shared premise that the Moderator never saw.
      const needed=new Set(theory.sharedTheoryIds);
      const seen=new Set<string>(), pending=[a];
      let complete=true;
      while(pending.length){
        const item=pending.pop()!;
        if(seen.has(item.id))continue;
        seen.add(item.id);
        for(const outcome of [item.control.outcome,item.acceptedOutcome]){
          if(!outcome)continue;
          for(const label of outcome.tags??[]){
            if(!label.startsWith('method:theory-use/'))continue;
            const ref=label.slice('method:theory-use/'.length);
            if(ref.startsWith('shared_'))needed.add(ref);
            else if(ref!==theory.id)complete=false;
          }
          for(const dependency of outcome.dependencyArtifactIds){
            const prior=m.optionalFlow?.artifacts.find(row=>row.id===dependency);
            if(prior)pending.push(prior);else complete=false;
          }
        }
      }
      if(!complete)continue;
      const parents:ProofRef[]=[];
      for(const id of needed){
        const [card]=await this.catalogue.read(p.id,m.snapshot.id,this.proofValid,id);
        if(card?.id!==id){complete=false;break;}
        parents.push(card.proofRef,...card.parentProofs);
      }
      if(!complete)continue;
      await this.catalogue.publish(theory.id,proof,{primitives,laws,modelConditions,construction,internalClaim,derivation,limits:theory.scopedEvidence.limits},parents);
    }
  }
  private async authorize(p: ResearchProjectV21, m: InFlightEpochV21, stage: StagePassage, source: V4Scope,shared=false) {
    if(source.projectId!==p.id){if(!shared||!this.sourceProject)return false;try{p=await this.sourceProject(source.projectId);}catch{return false;}}
    const epoch=source.epochId===m.snapshot.id&&p.id===m.projectId?m:p.activeEpoch?.snapshot.id===source.epochId?p.activeEpoch:p.epochs.find(e=>e.snapshot.id===source.epochId);
    const r2=['v4-operation-2','v4-operation-3','v4-operation-4'].includes(epoch?.snapshot.theoryRevision??'');
    const a=epoch?.optionalFlow?.artifacts.find(item=>r2?publicFragmentsV4(item).some(f=>f.stageId===stage.stageId):item.id===stage.stageId);
    if (!a || a.root.revision !== source.rootId || a.originalRef.projectId !== p.id) return false;
    const fragment=r2?publicFragmentsV4(a).find(f=>f.stageId===stage.stageId):undefined;
    const released=fragment?{...fragment,remainingObligations:a.control.publicStage!.remainingObligations}:publicStage(a);
    if (!epoch || released?.passage !== stage.passage || stage.branch !== released.branch
       || JSON.stringify(released.conditions) !== JSON.stringify(stage.conditions)||r2&&JSON.stringify(released)!==JSON.stringify(stage)) return false;
    const marker:InFlightEpochV21='loop' in epoch ? epoch : {...epoch,schemaVersion:3,projectId:p.id,loop:m.loop};
    return !await this.revoked(p,marker,a.id);
  }
  private envelope(m: InFlightEpochV21) {
    const b=m.snapshot.config.epochBudget;
    return {tokens:Math.floor((b.maxTokens-b.reserveTokens)/8),costUsd:(b.maxCostUsd-b.reserveCostUsd)/8};
  }
  canReserve(m:InFlightEpochV21,foreground:number,moderator=0) {
    if(m.snapshot.theoryRevision==='v4-operation-5')return true;
    const b=m.snapshot.config.epochBudget, cap=this.envelope(m);
    const mainTokens=Math.floor((b.maxTokens-b.reserveTokens)/4), mainCost=(b.maxCostUsd-b.reserveCostUsd)/4;
    let tokens=this.spent.tokens+foreground*mainTokens+moderator*cap.tokens, cost=this.spent.costUsd+foreground*mainCost+moderator*cap.costUsd;
    for(const call of m.calls){
      const u=call.status==='completed'?call.usage:undefined;
      tokens+=u?.tokensKnown && u.tokens!==undefined?u.tokens:mainTokens;
      cost+=u?.costKnown && u.costUsd!==undefined?u.costUsd:mainCost;
    }
    return cap.tokens>0 && cap.costUsd>0 && tokens<=b.maxTokens-b.reserveTokens && cost<=b.maxCostUsd-b.reserveCostUsd
      && (!budgetControlsEnabledV3(m.snapshot.capacityPolicy)||m.calls.length+this.spent.calls+foreground+moderator<=b.maxTasks);
  }
  async guidance(p: ResearchProjectV21, m: InFlightEpochV21) {
    if(m.snapshot.modelDirectedKnowledge)return {authority:'post-report',applications:[],knownTheories:[],publishedTheories:[]};
    if(m.snapshot.theoryRevision==='v4-operation-5'){
      if(m.snapshot.knowledgeNetworkRevision&&this.knowledgeLibrary){
        const knowledge=new KnowledgeResearchV4(this.knowledgeLibrary,this.catalogue,report=>this.authorizeReport(p,m,report),!!m.snapshot.knowledgeMapRevision);
        const found=await knowledge.bootstrap([m.snapshot.root.originalText,m.snapshot.root.workingText,...m.snapshot.root.conditions].join(' '));
        if(m.snapshot.knowledgeMapPresentation)return {authority:'post-report',applications:[],knownTheories:[],knowledgeSelection:routeSelectionPresentation(found.selection),knowledgePin:found.pin,publishedTheories:found.cards.map(({id,authority,kind,qualification})=>({id,authority,kind,qualification,notice:'Discover the corresponding map node before applying its claims; full theory text is not loaded automatically.'}))};
        return {authority:'post-report',applications:[],knownTheories:[],knowledgeSelection:found.selection,knowledgePin:found.pin,publishedTheories:found.cards.map(({id,authority,kind,body,review,qualification})=>({id,authority,kind,body,review,qualification}))};
      }
      const candidates=await this.catalogue.readReportStudies(report=>this.authorizeReport(p,m,report));
      const terms=m.snapshot.root.originalText.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[];
      const selected=candidates.filter(c=>c.source.scope.projectId!==p.id&&terms.some(t=>c.body.toLowerCase().includes(t))).slice(-4);
      if(m.snapshot.knowledgeMapPresentation)return {authority:'post-report',applications:[],knownTheories:[],publishedTheories:selected.map(({id,authority,kind,qualification})=>({id,authority,kind,qualification}))};
      return {authority:'post-report',applications:[],knownTheories:[],publishedTheories:selected.map(({id,authority,kind,body,review})=>({id,authority,kind,body,review}))};
    }
    const scope=this.scope(p,m);
    const valid=(s:StagePassage, origin:V4Scope)=>this.authorize(p,m,s,origin);
    const shared=()=>this.shared(p,m);
    let applications=await this.coordinator.listApplications(scope,valid,shared);
    if(['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')){
      const latest=m.optionalFlow?.artifacts.findLast(a=>a.authorRole==='theorist'&&a.acceptanceCommitted);
      const fragments=latest?publicFragmentsV4(latest):[];
      applications=applications.filter(a=>{const app='application' in a?a.application:undefined;return !!app&&fragments.some(f=>f.branch===app.target.branch&&f.premiseRevision===app.target.premiseRevision&&latest?.control.publicStage?.remainingObligations.includes(app.target.obligation));});
    }
    if(['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??''))return {authority:'scoped-research-evidence',applications:applications.filter(a=>Buffer.byteLength(JSON.stringify(a))<=8192).slice(-2),knownTheories:[],publishedTheories:[]};
    const theories=await this.coordinator.listKnownTheories(scope,valid,shared);
    // Omit oversized hypotheses whole. Partial text could drop a necessary condition.
    return {authority:'exploratory', applications:applications.filter(a=>Buffer.byteLength(JSON.stringify(a))<=8192).slice(-2),
      knownTheories:theories.filter(t=>Buffer.byteLength(JSON.stringify(t))<=8192).slice(-2),
      publishedTheories:await this.shared(p,m)};
  }
  async validateGuidance(p:ResearchProjectV21,m:InFlightEpochV21,call:CallV21,used?:string[]) {
    // Layered discovery cards are not scientific dependencies; map reads validate actual use.
    if(m.snapshot.knowledgeMapPresentation&&!used?.length)return;
    if(m.snapshot.theoryRevision==='v4-operation-5'){
      const offered=(call.input as {v4Guidance?:{publishedTheories?:{id:string}[]}}).v4Guidance?.publishedTheories??[];
      const current=m.snapshot.knowledgeNetworkRevision&&this.knowledgeLibrary?await new KnowledgeResearchV4(this.knowledgeLibrary,this.catalogue,report=>this.authorizeReport(p,m,report),!!m.snapshot.knowledgeMapRevision).availableCards():await this.catalogue.readReportStudies(report=>this.authorizeReport(p,m,report));
      for(const id of used??offered.map(c=>c.id))if(!offered.some(c=>c.id===id)||!current.some(c=>c.id===id))throw Error('Published mathematical source unavailable');return;
    }
    const saved=(call.input as {v4Guidance?:Awaited<ReturnType<ProofBridgeV4['guidance']>>}).v4Guidance;
    const offered=[...(saved?.applications??[]),...(saved?.knownTheories??[]),...(saved?.publishedTheories??[])];
    const required=used??offered.map(row=>row.id);
    if(!required.length)return;
    const valid=(s:StagePassage, origin:V4Scope)=>this.authorize(p,m,s,origin);
    const scope=this.scope(p,m);
    const shared=()=>this.shared(p,m);
    const current=['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')?(await this.guidance(p,m)).applications:[...await this.coordinator.listApplications(scope,valid,shared),...await this.coordinator.listKnownTheories(scope,valid,shared),...await shared()];
    for(const id of required){
      if(!offered.some(row=>row.id===id)||!current.some(row=>row.id===id))throw new Error('V4 theory reference unavailable or outside the frozen proof input.');
    }
  }
  async applicationSupport(p:ResearchProjectV21,m:InFlightEpochV21,ids:readonly string[]){
    if(m.snapshot.knowledgeNetworkRevision&&this.knowledgeLibrary)return new KnowledgeResearchV4(this.knowledgeLibrary,this.catalogue,report=>this.authorizeReport(p,m,report),!!m.snapshot.knowledgeMapRevision).support(ids);
    if(m.snapshot.theoryRevision==='v4-operation-5'){
      const cards=await this.catalogue.readReportStudies(report=>this.authorizeReport(p,m,report));
      const selected=ids.map(id=>{const card=cards.find(c=>c.id===id);if(!card)throw Error('Research support unavailable');return card;});
      return {sources:selected.map(c=>({projectId:c.source.scope.projectId,artifactId:c.source.artifactId})),proofRefs:[]};
    }
    const sources:{projectId:string;artifactId:string}[]=[],proofRefs:ProofRef[]=[];
    for(const id of ids){
      const closure=await this.coordinator.applicationSupport(this.scope(p,m),id,(stage,scope)=>this.authorize(p,m,stage,scope),()=>this.shared(p,m));
      if(!closure)throw new Error('Used V4 application support unavailable');
      for(const source of closure.sources)sources.push({projectId:source.scope.projectId,artifactId:source.stage.stageId.split('/fragment/')[0]!});
      const shared=await this.catalogue.supportReferences(closure.sharedRefs.map(ref=>ref.id));sources.push(...shared.sources);proofRefs.push(...shared.proofRefs);
    }
    return {sources:[...new Map(sources.map(s=>[JSON.stringify(s),s])).values()],proofRefs:[...new Map(proofRefs.map(r=>[JSON.stringify(r),r])).values()]};
  }
  async boundary(p: ResearchProjectV21, m: InFlightEpochV21, workers: number, halted: ()=>Promise<boolean>,
    warn: (message:string)=>void,archiveOnly=false) {
    if(m.snapshot.theoryRevision==='v4-operation-5')return;
    const scope=this.scope(p,m);
    const cap=this.envelope(m);
    this.spent=await this.coordinator.usage(scope,cap);
    const artifacts=m.optionalFlow?.artifacts ?? [];
    let handover=false;
    for (const a of artifacts) {
      if (this.submitted.has(a.id)) continue;
      const stages:StagePassage[]=['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')?publicFragmentsV4(a).map(f=>({...f,remainingObligations:a.control.publicStage!.remainingObligations})):[publicStage(a)].filter((s):s is StagePassage=>!!s);
      if (!stages.length) continue;
      const requested=a.control.outcome.tags?.includes('method:theory-handover') === true;
      for(const stage of stages)await this.coordinator.submitStage({scope,stage,producerId:a.originalRef.callId,handover:requested,
        watchKeys:a.control.outcome.tags?.filter(tag=>tag!=='method:theory-handover')});
      this.submitted.add(a.id);
      handover=requested;
    }
    const invoke=this.runtime.invokeTheoryV4;
    const model=m.snapshot.modelConfig.roleModels?.moderator ?? m.snapshot.modelConfig.defaultModel;
    if (!invoke || !model || this.job || !artifacts.length || await halted()) return;
    const capacity=this.runtime.theoryCapacityV4?.() ?? 1;
    const overlap=!archiveOnly&&Math.min(capacity,m.snapshot.config.maxWorkers)>workers+1;
    if (!overlap && (workers||!['v4-operation-2','v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')&&!handover)) return;
    const b=m.snapshot.config.epochBudget;
    const maxTokens=Math.floor((b.maxTokens-b.reserveTokens)/8), maxCostUsd=(b.maxCostUsd-b.reserveCostUsd)/8;
    const valid=(s:StagePassage, origin:V4Scope)=>this.authorize(p,m,s,origin);
    const latest=artifacts.findLast(a=>a.authorRole==='theorist'&&a.acceptanceCommitted);
    const current=latest?publicFragmentsV4(latest)[0]:undefined;
    const remaining=latest?.control.publicStage?.remainingObligations??m.snapshot.root.obligations.map(o=>o.statement);
    const rootContext=['v4-operation-3','v4-operation-4'].includes(m.snapshot.theoryRevision??'')&&current&&remaining.length?{
      originalProblem:m.snapshot.root.originalText,remainingObligations:[...remaining],
      target:{...scope,branch:current.branch,premiseRevision:current.premiseRevision,obligation:remaining[0]!},
    }:undefined;
    const job=this.coordinator.runNext(scope,async (purpose,stages,previous,journal)=>{
      const anchor=[...stages].reverse().find(s=>s.rootId===scope.rootId&&s.premiseRevision&&s.remainingObligations?.length);
      const target=anchor?{...scope,branch:anchor.branch,premiseRevision:anchor.premiseRevision!,obligation:anchor.remainingObligations![0]!}:undefined;
      return invoke.call(this.runtime,{purpose,revision:m.snapshot.theoryRevision,...(target?{target}:{}),stages:[...stages],previous,projectId:p.id,
        callId:scope.epochId+'_'+stages[0].stageId+'_'+purpose,model,
        budget:{...m.snapshot.config.roleBudget,maxTokens:Math.min(maxTokens,m.snapshot.config.roleBudget.maxTokens??maxTokens),
          maxCostUsd:Math.min(maxCostUsd,m.snapshot.config.roleBudget.maxCostUsd??maxCostUsd)},
        signal:this.controller.signal,...journal});
    },{revision:m.snapshot.theoryRevision,...(rootContext?{rootContext}:{}),preciseDispatch:true,authorize:valid,sharedTheories:()=>this.shared(p,m), signal:this.controller.signal, admit:async ()=>{
      if (await halted() || this.controller.signal.aborted) return false;
      this.spent=await this.coordinator.usage(scope,cap);
      // Reserve both this optional send and the next ordinary proof step.
      const allowed=this.canReserve(m,archiveOnly?0:1,1);
      if(allowed)this.spent={calls:this.spent.calls+1,tokens:this.spent.tokens+cap.tokens,costUsd:this.spent.costUsd+cap.costUsd};
      return allowed;
    }}).then(()=>this.publishIndependent(p,m)).catch(()=>warn('V4 Moderator trial unavailable; the main proof continues.'))
      .finally(()=>{this.job=undefined;});
    this.job=job;
    if(!overlap || handover) await job;
  }
}
