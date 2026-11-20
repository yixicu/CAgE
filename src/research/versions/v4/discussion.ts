import type {Static} from 'typebox';
import type {legacyDiscussion,CompactDiscussion,DiscussionV4,DiscussionUpdates} from './discussion-schema.js';
export type {CompactDiscussion,DiscussionV4,DiscussionUpdates} from './discussion-schema.js';
export {DiscussionSchemaV4,DiscussionUpdatesSchema} from './discussion-schema.js';
import {stableHash} from '../../../learning/research-hash.js';
import type { ReportUpdate } from '../../../learning/report-assessment.js';
import type { ResearchCompositionV21, ResearchProjectV21 } from '../../contracts/v21.js';
import type { PlanningSelection, UserCommand } from '../../contracts/user-commands.js';
import { commandRefinementKind, compareCommandOrder } from '../../user-commands.js';
import { digestV21 } from '../v21/state.js';

// History is user-visible conversation. It confers no evidence grants.
export function freezeDiscussionV4(project:ResearchProjectV21, selection:PlanningSelection,
 commands:UserCommand[],composition:ResearchCompositionV21,compact=false):DiscussionV4 {
 const journal=commands.filter(c=>c.projectId===project.id&&c.kind==='refine').sort(compareCommandOrder);
 const selected=(s?:PlanningSelection)=>journal.filter(c=>s?.commandIds.includes(c.id))
  .map(c=>({id:c.id,kind:commandRefinementKind(c)!,text:c.payload}));
 const turns:Static<typeof legacyDiscussion>['turns']=[], compactTurns:CompactDiscussion['turns']=[];
 for(const epoch of project.epochs){
  if(epoch.projectId!==project.id||epoch.snapshot.theoryRevision!=='v4-operation-5')continue;
  const userInputs=epoch.snapshot.discussion?.userInputs??selected(epoch.planningSelection);
  const base={epochId:epoch.id,rootId:epoch.snapshot.root.revision,question:epoch.snapshot.root.originalText,userInputs};
  const reports=epoch.optionalFlow?.artifacts.filter(a=>a.authorRole==='theorist'&&a.acceptanceCommitted&&a.publicReport
   &&a.originalRef.projectId===project.id&&a.originalRef.owner===project.id&&a.originalRef.epochId===epoch.id
   &&a.root.revision===base.rootId&&a.originalRef.bodyHash===digestV21(a.publicReport.body)&&a.publicReport.bodyHash===stableHash(a.publicReport.body))??[];
  if(!reports.length&&userInputs.length)(compact?compactTurns:turns).push(base);
  for(const [index,a] of reports.entries()){
   const published=a.publicReport!, outcome=a.acceptedOutcome??a.control.outcome;
   const ref=epoch.optionalFlow?.archives.findLast(r=>r.status==='saved'&&r.artifactId===a.id)?.proofRef;
   const row=composition.v4KnowledgeLibrary?.reportAssessment(project.id,a.id);
   const current=row&&(!compact||row.projectId===project.id&&row.artifactId===a.id)&&row.epochId===epoch.id&&row.rootId===base.rootId&&row.bodyHash===published.bodyHash?publicAssessment(row):undefined;
   const common={...base,userInputs:index===0?userInputs:[]};
   const metadata={artifactId:a.id,bodyHash:published.bodyHash,outcome:outcome.resultKind,scope:outcome.scope,
    conditions:outcome.conditions??a.root.conditions,qualification:a.qualification,...(ref&&composition.v4ProofValid?{archiveValid:composition.v4ProofValid(ref)}:{}),
    ...(current?{assessment:current}:{})
   };
   const outline=published.proofOutline??outcome.outline?.join('\n');
   if(compact)compactTurns.push({...common,report:{...metadata,conclusion:outcome.reason,route:a.control.route?.description??'',gaps:outcome.gaps,...(outline?{proofOutline:outline}:{})}});
   else turns.push({...common,report:{...metadata,body:published.body}});
  }
 }
 return compact?{revision:'public-discussion-v2',turns:compactTurns,userInputs:selected(selection)}:{revision:'public-discussion-v1',turns,userInputs:selected(selection)};
}

function publicAssessment(row:ReportUpdate){
 const {id,revision,status,claim,inference,body,condition,review,previousCondition,previousReview}=row;
 return {id,revision,status,claim,inference,body,...(row.opposingArtifactId?{opposingArtifactId:row.opposingArtifactId}:{}),...(condition?{condition}:{}),...(review?{review}:{}),
  ...(previousCondition?{previousCondition}:{}),...(previousReview?{previousReview}:{})};
}


type Turn=CompactDiscussion['turns'][number];
type Report=NonNullable<Turn['report']>;
const clip=(value:string,limit:number)=>value.length<=limit?value:value.slice(0,limit)+'…';

export function discussionCard(turn:Turn,index:number,updates:DiscussionUpdates){
 const report=turn.report;
 const update=report&&updates.find(row=>row.artifactId===report.artifactId);
 const assessment=update?update.assessment:report?.assessment;
 return {index,epochId:turn.epochId,rootId:turn.rootId,question:clip(turn.question,300),
  inputCount:turn.userInputs.length,userInputs:turn.userInputs.slice(0,3).map(row=>({...row,text:clip(row.text,300)})),
  ...(report?{report:{artifactId:report.artifactId,bodyHash:report.bodyHash,outcome:report.outcome,scope:report.scope,
   conclusion:clip(report.conclusion,480),route:clip(report.route,240),...(report.proofOutline?{proofOutline:clip(report.proofOutline,900)}:{}),
   conditions:report.conditions.slice(0,4).map(value=>clip(value,180)),conditionCount:report.conditions.length,
   gaps:report.gaps.slice(0,4).map(value=>clip(value,180)),gapCount:report.gaps.length,qualification:report.qualification,
   archiveValid:update?update.archiveValid:report.archiveValid,
   ...(assessment?{assessment:{id:assessment.id,revision:assessment.revision,status:assessment.status,claim:clip(assessment.claim,180),
    inference:clip(assessment.inference,180),condition:clip(assessment.condition??assessment.previousCondition??'',240),review:clip(assessment.review??assessment.previousReview??assessment.body,280)}}:{})}}:{})};
}

export function discussionVersion(discussion:CompactDiscussion,updates:DiscussionUpdates){
 return stableHash([discussion,updates]);
}

/** Called once on admission. Recovery keeps the pinned call input and qualifier changes. */
export function prepareDiscussionCall(project:ResearchProjectV21,discussion:CompactDiscussion,composition?:ResearchCompositionV21){
 const updates:DiscussionUpdates=[];
 const epochs=new Map(project.epochs.filter(epoch=>epoch.projectId===project.id).map(epoch=>[epoch.id,epoch]));
 for(const turn of discussion.turns){
  const report=turn.report;
  if(!report)continue;
  const epoch=epochs.get(turn.epochId);
  const proof=epoch?.optionalFlow?.archives.findLast(row=>row.status==='saved'&&row.artifactId===report.artifactId)?.proofRef;
  const archiveValid=proof&&composition?.v4ProofValid?composition.v4ProofValid(proof):report.archiveValid;
  const row=composition?.v4KnowledgeLibrary?.reportAssessment(project.id,report.artifactId);
  const assessment=row&&row.projectId===project.id&&row.artifactId===report.artifactId&&row.epochId===turn.epochId&&row.rootId===turn.rootId&&row.bodyHash===report.bodyHash?publicAssessment(row):report.assessment;
  if(assessment?.id!==report.assessment?.id||assessment?.revision!==report.assessment?.revision||archiveValid!==report.archiveValid)
   updates.push({artifactId:report.artifactId,archiveValid,assessment});
 }
 const total=discussion.turns.length, start=Math.max(0,total-3);
 const notices=discussion.turns.flatMap((turn,index)=>{
  if(!turn.report)return [];
  const update=updates.find(row=>row.artifactId===turn.report!.artifactId);
  if(!update&&!turn.report.assessment&&turn.report.archiveValid!==false)return [];
  const report=discussionCard(turn,index,updates).report!;
  return [{index,epochId:turn.epochId,artifactId:report.artifactId,archiveValid:report.archiveValid,assessment:report.assessment,changed:!!update}];
 }).sort((a,b)=>Number(b.changed)-Number(a.changed)||b.index-a.index);
 return {updates,view:{revision:discussion.revision,version:discussionVersion(discussion,updates),totalTurns:total,
  turns:discussion.turns.slice(start).map((turn,i)=>discussionCard(turn,start+i,updates)),userInputs:discussion.userInputs,
  qualificationNotices:notices.slice(0,4),qualificationCount:notices.length}};
}

export function authorizedDiscussionBody(project:ResearchProjectV21,turn:Turn,report:Report){
 const epoch=project.epochs.find(e=>e.projectId===project.id&&e.id===turn.epochId&&e.snapshot.root.revision===turn.rootId);
 const a=epoch?.optionalFlow?.artifacts.find(row=>row.id===report.artifactId&&row.acceptanceCommitted&&row.authorRole==='theorist'
  &&row.root.revision===turn.rootId&&row.originalRef.projectId===project.id&&row.originalRef.owner===project.id&&row.originalRef.epochId===turn.epochId);
 const published=a?.publicReport;
 if(!published||published.bodyHash!==report.bodyHash||published.bodyHash!==stableHash(published.body)||a!.originalRef.bodyHash!==digestV21(published.body))
  throw Error('Public discussion original unavailable at this version.');
 return published.body;
}
