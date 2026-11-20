import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV11} from './learning-prompts-v11.js';
const before='Write tests to perform and ordered actions, not derivations of the tests.';
const procedure=`Write ordered actions with the observable intermediate result or invariant each decisive step checks, not derivations.
State what permits continuation and the safe stop or fallback when a check fails or remains unknown; procedure failure alone does not refute the target.`;
/** Method guidance only; historical pins, scientific data and all other purposes stay exact. */
export function prepareLearningGuidanceV12(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV11> {
 const prepared=prepareLearningGuidanceV11(call);
 if(call.purpose!=='method-skill')return prepared;
 const split=prepared.prompt.indexOf('\nFrozen task data: '),instructions=prepared.prompt.slice(0,split);
 if(split<0||!instructions.includes(before))throw new Error('Frozen v11 learning instruction boundary is missing.');
 return {...prepared,prompt:instructions.replace(before,procedure)+prepared.prompt.slice(split)};
}
export function learningPromptV12(call:LearningCall):string {return prepareLearningGuidanceV12(call).prompt;}
