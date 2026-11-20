import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV5} from './learning-prompts-v5.js';

const retention = `Before superseding, compare the existing card's full coverage using scoped reads; metadata alone may omit branches.
Default revise: preserve still-valid supported branches and their source dependencies, with condition-first operations and checks.
For narrower new evidence, keep the broader valid card: use no-change or a distinct key only for substantively different applicability, not a synonym.
A same-key independent rebuild must preserve supported coverage or explicitly justify correcting/retracting invalid or stale branches.
Only if the entire resulting card is independently supported by new frozen qualified sources, return independentRebuild:{justification:string}.
Justify the whole card's independence from prior support and any coverage correction; narrower evidence alone does not invalidate old branches.
Never force an unsupported union or generalization; consolidate conditions/checks without mechanical body growth. Keep examples in archives.`;
const previousSkill = `Revise an existingSkills entry's exact semanticKey for the same method; do not create a synonym.
Preserve scope and disablement; truncated catalog metadata does not erase conditions.
Use no-change if safe scope cannot be established; use a new key only for a different method.`;
const skill = `Use the same semanticKey for the same method and applicability; preserve disablement and limitations.
Use a distinct scoped key only for a substantively different method/applicability, not merely a new case or synonym.
Truncated metadata does not erase conditions; use scoped reads or no-change when safe coverage cannot be established.`;

/** New jobs only: preserve active method coverage without changing evidence or historical recipes. */
export function prepareLearningGuidanceV7(call: LearningCall): ReturnType<typeof prepareLearningGuidanceV5> {
 const prepared = prepareLearningGuidanceV5(call);
 if (call.purpose !== 'method-skill') return prepared;
 const boundary = prepared.prompt.indexOf('\n2. Evidence and scope\n');
 if (boundary < 0 || !prepared.prompt.includes(previousSkill)) throw new Error('Frozen v5 learning prompt section boundary is missing.');
 const prompt = prepared.prompt.slice(0, boundary) + '\n' + retention + prepared.prompt.slice(boundary);
 return {...prepared, prompt: prompt.replace(previousSkill, skill)};
}
export function learningPromptV7(call: LearningCall): string { return prepareLearningGuidanceV7(call).prompt; }
