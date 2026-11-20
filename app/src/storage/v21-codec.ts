import {interpretedRootV21,initialRootInterpretationEligibleV21} from '../research/versions/v21/root-interpretation.js';
import { isDeepStrictEqual } from 'node:util';
import type { ResearchProjectV21, InFlightEpochV21 } from '../research/contracts/v21.js';
import type { AnyInFlight } from '../research/contracts/loop.js';
/** Persistence enforces monotonic immutable execution evidence, not scientific truth. */
export function validateV21Transition(project:ResearchProjectV21, next:InFlightEpochV21, old?:AnyInFlight):void {
  const reject=(message:string):never=>{throw new Error(`Invalid V2.1 recovery transition: ${message}`);};
  if(next.projectId!==project.id || next.loop.researchLoopVersion!==project.researchLoopVersion || next.loop.workerProtocolVersion!=='2.1') reject('project or protocol mismatch');
  if(next.promptRevision!==next.snapshot.promptRevision) reject('prompt revision mismatch');
  if(!old) {
    if(next.snapshot.root.hypothesisId!==project.root.hypothesisId || next.snapshot.root.revision!==project.root.revision) reject('root mismatch');
    return;
  }
  if(!('schemaVersion' in old)||old.schemaVersion!==3) return reject('cross-version marker');
  if(old.loop.researchLoopVersion!==next.loop.researchLoopVersion) reject('scientific version changed');
  if(old.promptRevision!==next.promptRevision) reject('frozen prompt revision changed');
  if(old.snapshot.id!==next.snapshot.id||old.epoch!==next.epoch) reject('unfinished Epoch replaced');
  if(old.sealed&&!next.sealed) reject('sealed Epoch reopened');
  if(old.solverMode!==next.solverMode) reject('frozen solver mode changed');
  if(old.sealed && !isDeepStrictEqual(old.snapshot,next.snapshot)) reject('sealed snapshot changed');
  if(!old.sealed && !isDeepStrictEqual(old.snapshot,next.snapshot)) {
    const allowed={...old.snapshot,root:next.snapshot.root};
    const material=next.plan?.rootChange&&isDeepStrictEqual(next.plan.rootChange.root,next.snapshot.root);
    const optionalInterpretation=old.solverMode==='theorist-owned-optional-workers-v2'&&old.snapshot.rootInterpretationPending===true&&old.calls.some(call=>call.task==='v21_theorist'&&call.status==='completed'&&['v21-operation-8','v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(call.operation?.revision??'')&&(call.result as import('../research/versions/v21/optional-types.js').OptionalTheoristResultV21)?.control.rootInterpretation&&isDeepStrictEqual(interpretedRootV21(old.snapshot.root,(call.result as import('../research/versions/v21/optional-types.js').OptionalTheoristResultV21).control.rootInterpretation!),next.snapshot.root));
    const interpretation=old.plan?.rootInterpretation&&next.plan?.rootInterpretation&&initialRootInterpretationEligibleV21(project,old)&&isDeepStrictEqual(old.plan.rootInterpretation,next.plan.rootInterpretation)&&isDeepStrictEqual(interpretedRootV21(old.snapshot.root,old.plan.rootInterpretation),next.snapshot.root)&&old.calls.some(call=>call.task==='v21_plan'&&call.status==='completed'&&['v21-operation-4','v21-operation-6','v21-operation-7'].includes(call.operation?.revision??''));
    if((!material&&!interpretation&&!optionalInterpretation)||!isDeepStrictEqual(allowed,next.snapshot))reject('unapproved preparation snapshot change');
  }
  if(old.planningSelection && !isDeepStrictEqual(old.planningSelection,next.planningSelection)) reject('captured command selection changed');
  if(old.plan && !isDeepStrictEqual(old.plan,next.plan)) reject('accepted plan changed');
  if(old.review && !isDeepStrictEqual(old.review,next.review)) reject('accepted review changed');
  if(old.optionalFlow){
    const flow=next.optionalFlow;if(!flow)reject('optional collection removed');
    if((old.optionalFlow.operationRevision??'v21-operation-8')!==(flow!.operationRevision??'v21-operation-8'))reject('optional protocol revision changed');
    if(old.optionalFlow.v3){const prior=old.optionalFlow.v3,current=flow!.v3;if(!current)reject('V3 evidence state removed');
      if(prior.workspace.originalQuestion!==current!.workspace.originalQuestion||prior.workspace.rootVersion!==current!.workspace.rootVersion)reject('V3 original workspace root changed');
      for(const key of ['modelRequests','toolDispatches','completedTools'] as const)if(current![key]<prior[key])reject('V3 execution counter regressed');
      for(const id of prior.acceptedCallIds)if(!current!.acceptedCallIds.includes(id))reject('V3 accepted call receipt removed');
      for(const id of prior.workspace.adoptedReceiptIds)if(!current!.workspace.adoptedReceiptIds.includes(id))reject('V3 adopted receipt removed');
      for(const receipt of prior.receipts)if(!current!.receipts.some(next=>isDeepStrictEqual(receipt,next)))reject('V3 immutable receipt changed');
      for(const record of prior.workspace.records){const saved=current!.workspace.records.find(r=>r.id===record.id);if(!saved||!isDeepStrictEqual({...record,status:undefined},{...saved,status:undefined}))reject('V3 immutable workspace evidence changed');if(record.status==='needs-review'&&saved!.status!=='needs-review')reject('V3 revoked record strengthened without a new evidence identity');}
    }
    if(old.optionalFlow.rawDeliveredAt&&flow!.rawDeliveredAt!==old.optionalFlow.rawDeliveredAt)reject('raw delivery time changed');
    for(const d of old.optionalFlow.rawDeliveryHistory??[])if(!flow!.rawDeliveryHistory?.some(x=>isDeepStrictEqual(x,d)))reject('raw delivery history removed');
    for(const effect of old.optionalFlow.pendingEffects??[]){const saved=flow!.pendingEffects?.find(e=>e.callId===effect.callId);if(!saved||!isDeepStrictEqual({...effect,status:undefined},{...saved,status:undefined})||effect.status==='saved'&&saved.status!=='saved')reject('optional side-effect receipt changed');}
    if(old.optionalFlow.foregroundCompletedAt&&flow!.foregroundCompletedAt!==old.optionalFlow.foregroundCompletedAt)reject('foreground delivery time changed');
    if(old.optionalFlow.reviewedArtifactIds.some(id=>!flow!.reviewedArtifactIds.includes(id)))reject('review receipt removed');
    if(old.optionalFlow.phase==='stopped'&&flow!.phase!=='stopped')reject('stopped optional flow resumed');
    if(flow!.sequence<old.optionalFlow.sequence||flow!.evidenceRevision<old.optionalFlow.evidenceRevision)reject('optional sequence regressed');
    for(const a of old.optionalFlow.artifacts){const b=flow!.artifacts.find(x=>x.id===a.id);if(!b||!isDeepStrictEqual({...a,qualification:undefined,acceptedOutcome:undefined,adoptionReason:undefined,scientificFailure:undefined,judgment:undefined,acceptanceCommitted:undefined},{...b,qualification:undefined,acceptedOutcome:undefined,adoptionReason:undefined,scientificFailure:undefined,judgment:undefined,acceptanceCommitted:undefined}))reject('immutable original artifact changed');}
    for(const a of old.optionalFlow.artifacts)if(a.acceptanceCommitted&&!flow!.artifacts.find(x=>x.id===a.id)?.acceptanceCommitted)reject('accepted artifact regressed');
    for(const b of old.optionalFlow.branches){const n=flow!.branches.find(x=>x.id===b.id);if(!n||!isDeepStrictEqual(b.frozen,n.frozen)||b.callId!==n.callId||b.kind!==n.kind||b.artifactId&&b.artifactId!==n.artifactId)reject('optional branch changed');if(['running','uncertain'].includes(b.state)&&n!.state==='ready')reject('admitted branch regressed');if(b.state==='completed'&&n!.state!=='completed'||b.state==='cancelled'&&n!.state!=='cancelled')reject('terminal branch regressed');}
    for(const a of old.optionalFlow.archives){const b=flow!.archives.find(x=>x.operationId===a.operationId);if(!b||!isDeepStrictEqual(a.selection,b.selection)||a.selectionHash!==b.selectionHash||a.status==='saved'&&!isDeepStrictEqual(a,b))reject('optional archive changed');}
    for(const d of old.optionalFlow.deliveryHistory)if(!flow!.deliveryHistory.some(x=>isDeepStrictEqual(x,d)))reject('delivery history removed');
  }
  for(const prior of old.calls) {
    const call=next.calls.find(item=>item.id===prior.id);
    if(!call) reject('call removed');
    if(!isDeepStrictEqual({...prior,status:undefined,result:undefined,usage:undefined,recoveryGeneration:undefined,systemChangeSkipped:undefined,answerDeliveries:undefined,loadedResources:undefined,captured:undefined}, {...call,status:undefined,result:undefined,usage:undefined,recoveryGeneration:undefined,systemChangeSkipped:undefined,answerDeliveries:undefined,loadedResources:undefined,captured:undefined})) reject('frozen call changed');
    if(next.optionalFlow&&call!.recoveryGeneration!==prior.recoveryGeneration)reject('optional call generation changed');
    if(call!.recoveryGeneration<prior.recoveryGeneration) reject('recovery generation regressed');
    if((prior.systemChangeSkipped && !call!.systemChangeSkipped)||(call!.systemChangeSkipped && next.loop.researchLoopVersion!=='4.0'))reject('invalid system-operation notice');
    if(prior.captured&&!isDeepStrictEqual(prior.captured,call!.captured))reject('captured original changed');
    if(call!.status==='rejected' && (!next.optionalFlow||!call!.captured||call!.result!==undefined))reject('rejected call requires an unassessed original');
    if(prior.status==='rejected' && !isDeepStrictEqual(prior,call))reject('rejected scientific call changed');
    if(prior.status==='completed' && !isDeepStrictEqual(prior,call)) reject('completed call changed');
    if(prior.status==='denied' && (call!.status!=='denied'||call!.recoveryGeneration!==prior.recoveryGeneration))reject('denied invocation replay');
    const reconciledDenial=next.loop.researchLoopVersion==='4.0' && call!.status==='denied';
    if(prior.status==='pending' && call!.status==='not-started'||prior.status==='uncertain' && !reconciledDenial && !['uncertain','completed','rejected'].includes(call!.status)) reject('uncertain invocation replay');
  }
  for(const prior of old.tasks) {
    const task=next.tasks.find(item=>item.id===prior.id);
    if(!task) reject('task removed');
    if(prior.frozen&&!isDeepStrictEqual(prior.frozen,task!.frozen)) reject('frozen task changed');
    if(prior.answer&&!isDeepStrictEqual(prior.answer,task!.answer)) reject('persisted answer changed');
    const transitions:Record<string,string[]>={planned:['planned','ready','blocked'],ready:['ready','running','blocked'],running:['running','staged','completed','failed','interrupted'],staged:['staged','completed','failed','interrupted'],completed:['completed'],blocked:['blocked'],failed:['failed'],interrupted:['interrupted']};
    if(!transitions[prior.state]?.includes(task!.state)) reject('task state regressed');
  }
  for(const answer of old.answers) if(!next.answers.some(item=>isDeepStrictEqual(item,answer))) reject('raw result removed or changed');
  for(const archive of old.archives) {
    const current=next.archives.find(item=>item.operationId===archive.operationId);
    if(!current||!isDeepStrictEqual(current.selection,archive.selection)||current.selectionHash!==archive.selectionHash) reject('archive selection changed');
    if(archive.status==='saved'&&!isDeepStrictEqual(archive,current)) reject('saved archive changed');
  }
}
