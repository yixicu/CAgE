import { normalizeProofV0 } from '../research/versions/v0/proof-operation.js';
import {isDeepStrictEqual as equal} from 'node:util';
import type {ResearchProjectV0,InFlightEpochV0} from '../research/contracts/v0.js';
import type {AnyInFlight} from '../research/contracts/loop.js';
/** Persist monotone execution evidence without judging scientific truth. */
export function validateV0Transition(project:ResearchProjectV0,next:InFlightEpochV0,old?:AnyInFlight):void {
  const reject=(message:string):never=>{throw new Error(`Invalid V0 recovery transition: ${message}`);};
  if(next.projectId!==project.id||next.loop.researchLoopVersion!=='0'||next.loop.workerProtocolVersion!=='v0-native-1')reject('project or protocol mismatch');
  if(!old){if(!equal(next.snapshot.root,project.root))reject('initial root mismatch');return;}
  if(!('schemaVersion' in old)||old.schemaVersion!==4)return reject('cross-version marker');
  if(next.executionMode!==old.executionMode)reject('execution mode changed');
  if(next.snapshot.id!==old.snapshot.id||next.epoch!==old.epoch)reject('unfinished epoch replaced');
  if(old.cancelled&&!next.cancelled)reject('cancellation removed');
  if(!equal(old.snapshot,next.snapshot)) {
    if(old.selection||!next.plan||!equal({...old.snapshot,root:next.snapshot.root,rootInterpretationPending:next.snapshot.rootInterpretationPending},next.snapshot))reject('frozen snapshot changed');
    if(old.executionMode==='proof-first'){
      const call=old.calls.find(c=>c.task==='v0_single'&&c.status==='completed');
      if(!call||!old.snapshot.rootInterpretationPending||next.snapshot.rootInterpretationPending)reject('proof root interpretation lacks completed call');
      const normalized=normalizeProofV0(call!.input,(call!.result as import('../research/contracts/v0.js').ProofResultV0).outcome);
      if(!equal(next.snapshot.root,normalized.root)||!equal(next.plan,normalized.plan))reject('proof root differs from exact original attestation');
    }else {if(!old.snapshot.rootInterpretationPending||!next.plan?.rootInterpretation||next.snapshot.rootInterpretationPending||!equal(next.snapshot.root,{...old.snapshot.root,...next.plan.rootInterpretation})||!(old.executionMode==='single-request'?old.calls.some(call=>call.task==='v0_single'&&call.status==='completed'&&equal((call.result as {outcome?:{rootInterpretation?:unknown}})?.outcome?.rootInterpretation,next.plan!.rootInterpretation)):old.calls.some(call=>call.task==='v0_plan'&&call.status==='completed')))reject('root interpretation differs from completed frozen plan');}
  }
  for(const key of ['planningSelection','plan','selection','solve','metadataStatus'] as const)if(old[key]&&!equal(old[key],next[key]))reject(`${key} changed`);
  if(old.scientificCommitted&&!next.scientificCommitted)reject('scientific commit removed');
  for(const prior of old.calls){
    const call=next.calls.find(item=>item.id===prior.id);if(!call)reject('call removed');
    if(!equal({...prior,status:undefined,result:undefined,usage:undefined,loadedResources:undefined,recoveryGeneration:undefined},{...call,status:undefined,result:undefined,usage:undefined,loadedResources:undefined,recoveryGeneration:undefined}))reject('frozen call changed');
    if(call!.recoveryGeneration!==prior.recoveryGeneration)reject('frozen recovery generation changed');
    if(prior.status==='completed'&&!equal(prior,call))reject('completed call changed');
    if(prior.status==='pending'&&call!.status==='not-started'||prior.status==='uncertain'&&!['uncertain','completed'].includes(call!.status))reject('uncertain invocation replay');
  }
  if(old.archive&&(!next.archive||!equal(old.archive.selection,next.archive.selection)||old.archive.selectionHash!==next.archive.selectionHash||old.archive.status==='saved'&&!equal(old.archive,next.archive)))reject('archive evidence changed');
}
