import type {LearningCall} from './learning-task.js';
import {prepareLearningGuidanceV4} from './learning-prompts-v4.js';

const method = `Extract an execution/recognition card, not a mini-paper, from the qualified reproducible root result.
Organize the body: recognizable structure, applicability, ordered operations, decisive checks, limits.
Give tests to perform and branch-changing outcomes, not proofs of those tests.
Check science internally; write the checklist, not its derivation.
Keep only reusable formulas needed to recognize or execute operations; define symbols and valid scope.
Leave worked proofs, solved examples and instance algebra in the immutable archive.
Leave source IDs, hashes and provenance to host metadata, not the body.
State each condition/check once across fields; align transferable names/tags and scope.
Preserve scope; one case gives no universal theorem or success guarantee.
Learn valid same-premise refutation constructions and scope, never the refuted claim.
Check empty, zero, degenerate, boundary and exceptional cases; exclude unsafe division/inversion/strict-claim branches.
Use no-change for contradictions; do not repair source science.
One qualified case suffices; no Moderator approval; archival status is not verification.`;

/** Change only the method task. Preserve v4 roles, output contracts and exact-data presentation. */
export function prepareLearningGuidanceV5(call: LearningCall): ReturnType<typeof prepareLearningGuidanceV4> {
 const prepared = prepareLearningGuidanceV4(call);
 if (call.purpose !== 'method-skill') return prepared;
 const boundary = prepared.prompt.indexOf('\n2. Evidence and scope\n');
 if (boundary < 0) throw new Error('Frozen v4 learning prompt section boundary is missing.');
 return {...prepared, prompt: '1. Task\n' + method + prepared.prompt.slice(boundary)};
}

export function learningPromptV5(call: LearningCall): string {
 return prepareLearningGuidanceV5(call).prompt;
}
