import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV8} from './learning-prompts-v8.js';

const beforeMethod = `Organize the body: recognizable structure, applicability, ordered operations, decisive checks, limits.
Give tests to perform and branch-changing outcomes, not proofs of those tests.
Check science internally; write the checklist, not its derivation.`;
const method = `Abstract source-specific objects into structural roles; name the reusable transformation, not the solved instance.
Write tests to perform and ordered actions, not derivations of the tests.
Distinguish recognition cues for trying a procedure from assumptions required for a claimed result.
Give condition-first operations, branch-changing checks and failure limits; re-establish result assumptions on each new problem.
For cross-field reuse, map objects, constraints and invariants explicitly; analogy transfers neither premises nor conclusions.
Index supported operations with method:/problem-type: tags alongside subject tags; do not claim untested application domains.`;
const beforeStrategy = 'Extract subject-level directions, anchors and applicability as Specific Strategy, not problem-specific proof chains.';
const strategy = `Extract subject-level directions, anchors and applicability as Specific Strategy, not solved-case proof chains.
Connect directions through shared structures only when supported by processed proofs; state bridge conditions.
Keep source validity domains distinct; a useful analogy is guidance, not evidence of a cross-domain theorem.`;

/** Transfer guidance only. Reuse v8 presentation, scoped reads and optional Moderator weight authority. */
export function prepareLearningGuidanceV9(call:LearningCall):ReturnType<typeof prepareLearningGuidanceV8> {
 const prepared=prepareLearningGuidanceV8(call);
 const before=call.purpose==='method-skill'?beforeMethod:call.purpose==='v2-strategy'?beforeStrategy:undefined;
 if(!before)return prepared;
 // Replace authored instructions only; scientific frozen data is never rewritten.
 const split=prepared.prompt.indexOf('\nFrozen task data: ');
 if(split<0||!prepared.prompt.slice(0,split).includes(before))throw new Error('Frozen v8 learning instruction boundary is missing.');
 return {...prepared,prompt:prepared.prompt.slice(0,split).replace(before,call.purpose==='method-skill'?method:strategy)+prepared.prompt.slice(split)};
}
export function learningPromptV9(call:LearningCall):string {return prepareLearningGuidanceV9(call).prompt;}
