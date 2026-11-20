import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV10} from './learning-prompts-v10.js';
const beforeScope='Distinguish recognition cues for trying a procedure from assumptions required for a claimed result.';
const scope=`In conditions, separate checks for trying a procedure from assumptions for source-specific formulas or result branches.
Propose conditional try-and-check reuse when structurally justified; rederive problem-dependent objects and verify each operation's prerequisites.
A proposed procedure transfers no source formula, conclusion or success guarantee and does not establish validation in a new setting.`;
const beforeIndex='Index supported operations with method:/problem-type: tags alongside subject tags; do not claim untested application domains.';
const index='Index structural operations with method:/problem-type: tags alongside subject tags; distinguish proposed reuse from demonstrated applicability.';
/** Method guidance only: conditional procedure trials do not expand demonstrated result scope. */
export function prepareLearningGuidanceV11(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV10> {
 const prepared=prepareLearningGuidanceV10(call);
 if(call.purpose!=='method-skill')return prepared;
 const split=prepared.prompt.indexOf('\nFrozen task data: '),instructions=prepared.prompt.slice(0,split);
 if(split<0||!instructions.includes(beforeScope)||!instructions.includes(beforeIndex))throw new Error('Frozen v10 learning instruction boundary is missing.');
 return {...prepared,prompt:instructions.replace(beforeScope,scope).replace(beforeIndex,index)+prepared.prompt.slice(split)};
}
export function learningPromptV11(call:LearningCall):string {return prepareLearningGuidanceV11(call).prompt;}
