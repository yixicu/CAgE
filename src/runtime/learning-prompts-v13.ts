import type {LearningCall} from './learning-task.js';
import type {DecisionFile} from '../learning/research-data.js';
import {prepareLearningGuidanceV12} from './learning-prompts-v12.js';
import {guidanceHashV3} from '../research/versions/v3/guidance-budget.js';
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
/** Unknown shapes keep the complete historical rendering rather than silently lose a field. */
function policy(value:unknown):value is DecisionFile {
 return record(value)&&keys(value,['loopVersion','version','parentVersion','factors','rules'])&&(value.loopVersion===1||value.loopVersion===2)
  &&Number.isSafeInteger(value.version)&&Number(value.version)>=1&&(value.parentVersion===undefined||Number.isSafeInteger(value.parentVersion)&&Number(value.parentVersion)>=0)
  &&Array.isArray(value.rules)&&value.rules.every(rule=>typeof rule==='string')&&Array.isArray(value.factors)&&value.factors.every(factor=>record(factor)
   &&keys(factor,['id','description','weight','baseline'])&&typeof factor.id==='string'&&typeof factor.description==='string'&&finite(factor.weight)&&finite(factor.baseline));
}
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
/** Named CSV columns retain literal multiline descriptions; rule bodies stay verbatim with UTF-8 framing. */
function render(value:DecisionFile):string {
 const {factors,rules,...meta}=value;
 return ['operation.weightDecision',`Policy ${JSON.stringify(meta)}`,`Factors: ${factors.length}; columns=id,description,weight,baseline`,
  ...factors.map(factor=>[quote(factor.id),quote(factor.description),JSON.stringify(factor.weight),JSON.stringify(factor.baseline)].join(',')),`Rules: ${rules.length}`].join('\n')+'\n'
  +rules.map((rule,index)=>`Rule ${index}; bytes=${Buffer.byteLength(rule)}\n${rule}\n`).join('');
}
/** Same complete policy authority and task prompt; only its metered presentation changes under the new pin. */
export function prepareLearningGuidanceV13(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV12> {
 const prepared=prepareLearningGuidanceV12(call);
 if(call.purpose!=='v2-strategy'||!record(call.input))return prepared;
 const data=record(call.input.frozenInput)?call.input.frozenInput:call.input;
 if(!record(data.operation)||!policy(data.operation.weightDecision))return prepared;
 const id=`learning:${data===call.input?'':'frozenInput.'}operation.weightDecision`,index=prepared.documents.findIndex(doc=>doc.id===id);
 if(index<0)return prepared;
 const text=render(data.operation.weightDecision);prepared.documents[index]={...prepared.documents[index]!,text,hash:guidanceHashV3(text)};
 return prepared;
}
export function learningPromptV13(call:LearningCall):string{return prepareLearningGuidanceV13(call).prompt;}
