import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV5} from './learning-prompts-v5.js';

const support = `By default, revise retains all prior support for the card; preserve every retained branch's source dependencies.
Only if the entire revised card is independently supported by new frozen qualified sources, return independentRebuild:{justification:string}.
For this explicit whole-card rebuild, drop unsupported retained branches and justify the entire card's independence from all prior support.`;

/** Add an explicit method support choice; keep v5 roles, exact data and metering unchanged. */
export function prepareLearningGuidanceV6(call: LearningCall): ReturnType<typeof prepareLearningGuidanceV5> {
 const prepared = prepareLearningGuidanceV5(call);
 if (call.purpose !== 'method-skill') return prepared;
 const boundary = prepared.prompt.indexOf('\n2. Evidence and scope\n');
 if (boundary < 0) throw new Error('Frozen v5 learning prompt section boundary is missing.');
 return {...prepared, prompt: prepared.prompt.slice(0, boundary) + '\n' + support + prepared.prompt.slice(boundary)};
}

export function learningPromptV6(call: LearningCall): string {
 return prepareLearningGuidanceV6(call).prompt;
}
