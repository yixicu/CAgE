import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV9} from './learning-prompts-v9.js';
const before='Extract subject-level directions, anchors and applicability as Specific Strategy, not solved-case proof chains.';
const strategy=`Keep reusable directions, bridge conditions and validity limits in Specific Strategy, not solved-case proof chains.
Leave source IDs, versions and processing history to host metadata; omit publication bookkeeping and explanations of unchanged weights.
Preserve theorem-versus-example support distinctions as scope, not a narrative of this run.`;
/** Strategy prose only: preserve v9 science, authority, resource presentation and all historical pins. */
export function prepareLearningGuidanceV10(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV9> {
 const prepared=prepareLearningGuidanceV9(call);
 if(call.purpose!=='v2-strategy')return prepared;
 const split=prepared.prompt.indexOf('\nFrozen task data: ');
 if(split<0||!prepared.prompt.slice(0,split).includes(before))throw new Error('Frozen v9 learning instruction boundary is missing.');
 return {...prepared,prompt:prepared.prompt.slice(0,split).replace(before,strategy)+prepared.prompt.slice(split)};
}
export function learningPromptV10(call:LearningCall):string {return prepareLearningGuidanceV10(call).prompt;}
