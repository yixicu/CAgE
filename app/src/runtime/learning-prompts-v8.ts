import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV7} from './learning-prompts-v7.js';
import {guidanceHashV3} from '../research/versions/v3/guidance-budget.js';
import {compactHostMetadataV3} from '../research/versions/v3/host-metadata.js';

const strategy = `Compare qualified final-proof summaries, necessary bodies and existing Strategies only.
Extract subject-level directions, anchors and applicability as Specific Strategy, not problem-specific proof chains.
Do not write Skills or Base/User Strategy, or inspect Worker exploration, failures or whole sessions.
Return exact processedSources keys from operation.delivered; cite only processed qualified final proofs.
Use no-change when evidence does not support a safe Strategy update; omit weightUpdate by default.
After integrating a publishable Strategy, judge whether its actually processed cases support a global numeric weight change.
Keep subject-specific preferences and localized guidance in Strategy; one success does not establish global superiority.
Only if justified, include weightUpdate:{weights:{M,R,D,N,E},reason:string} in this same publication response.
Give all five finite nonnegative normalized weights, retaining each within 10% of operation.weightAnchor.
Use the frozen operation.weightDecision, reading its scoped guidance if omitted; explain the allocation evidence in reason.
Preserve factor identities, descriptions, rules and baseline; no added factors, scoring system or probability calibration.
No extra decision call, counters, surprise triggers or automatic reward for publication; omission means unchanged weights.`;
const delimiter='\nFrozen task data: ';
type Data=Record<string,unknown>;
const record=(value:unknown):value is Data=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function render(value:unknown):string {
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map((item,index)=>`[${index}]\n${render(item)}`).join('\n');
 if(record(value))return Object.entries(value).map(([key,item])=>`${key}:\n${render(item)}`).join('\n');
 return JSON.stringify(value)??'';
}
/** New V3 Strategy jobs only; all older recipes and non-Strategy v7 behavior remain unchanged. */
export function prepareLearningGuidanceV8(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV7> {
 const prepared=prepareLearningGuidanceV7(call);
 if(call.purpose!=='v2-strategy')return prepared;
 const boundary=prepared.prompt.indexOf('\n2. Evidence and scope\n'),split=prepared.prompt.indexOf(delimiter);
 if(boundary<0||split<0)throw new Error('Frozen learning prompt section boundary is missing.');
 let prompt='1. Task\n'+strategy+prepared.prompt.slice(boundary,split+delimiter.length);
 const raw=prepared.prompt.slice(split+delimiter.length);
 if(raw==='undefined')return {...prepared,prompt:prompt+raw};
 const outer:unknown=JSON.parse(raw),data=record(outer)&&record(outer.frozenInput)?outer.frozenInput:outer;
 // Moderator outlines use the same exact host-only presentation as other archived proof views.
 if(record(data)&&Array.isArray(data.outlines))data.outlines=data.outlines.map(proof=>compactHostMetadataV3({proof}).proof);
 if(record(data)&&record(data.operation)&&data.operation.weightDecision!==undefined){
  const id=`learning:${data===outer?'':'frozenInput.'}operation.weightDecision`,value=data.operation.weightDecision;
  const text=`operation.weightDecision\n${render(value)}`;
  prepared.documents.push({id,kind:'policy',text,hash:guidanceHashV3(text)});prepared.initialIds.push(id);
  data.operation.weightDecision={...(record(value)?{loopVersion:value.loopVersion,version:value.version}:{}),guidanceRef:id,guidanceOmitted:true};
 }
 prompt+=JSON.stringify(outer);
 return {...prepared,prompt};
}
export function learningPromptV8(call:LearningCall):string {return prepareLearningGuidanceV8(call).prompt;}
