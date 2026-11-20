import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';

// Only the host supplies the scope and the set of actually exposed stage IDs.
const text = Type.String({ minLength: 1, pattern: '\\S' });
const refs = Type.Array(text, { minItems: 1, uniqueItems: true });
const object = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const assessment = Type.Union([
  object({ decision: Type.Literal('pass'), reason: text }),
  object({ decision: Type.Literal('watch'), reason: text, signal: text }),
  object({ decision: Type.Literal('reuse'), reason: text, theoryRef: text }),
  object({ decision: Type.Literal('construct'), question: text, comparison: text, stageRefs: refs }),
]);
const proposal = object({
  primitives: text, laws: text, modelConditions: text, construction: text,
  internalClaim: text, derivation: text, interpretation: text, originalObligation: text,
  knownTheoryComparison: text, test: text, distinguishingOutcomes: text, stageRefs: refs,
});
const noChange = object({ decision: Type.Literal('no-change'), reason: text });
const construction = Type.Union([proposal, noChange]);
const challenge = Type.Union([
  object({ verdict: Type.Literal('park'), reason: text }),
  object({ verdict: Type.Literal('revise'), failedCondition: text }),
  object({
    verdict: Type.Literal('try'), originalVariableTest: text, conditions: text, remainingObligation: text,
    scopedEvidence: Type.Optional(object({
      internalDerivation: text, instancePremises: text, returnImplication: text, limits: text,
    })),
  }),
]);

export const theorySchemasV4 = { assess: assessment, construct: construction, challenge } as const;

type Trial =
  | { phase: 'screen' }
  | { phase: 'construct' | 'closed'; assessment: Static<typeof assessment> }
  | { phase: 'closed'; assessment: Static<typeof assessment>; proposal: Static<typeof noChange> }
  | { phase: 'challenge'; assessment: Static<typeof assessment>; proposal: Static<typeof proposal> }
  | { phase: 'reviewed'; assessment: Static<typeof assessment>; proposal: Static<typeof proposal>; challenge: Static<typeof challenge> };

function decode<S extends TSchema>(schema: S, value: unknown): Static<S> {
  if (!Value.Check(schema, value)) throw new Error('Invalid V4 theory trial response');
  return structuredClone(value) as Static<S>;
}

export interface StagePassage {
  fragment?: import('./fragments.js').MathematicalFragmentV4;
  environments?: import('./fragments.js').EnvironmentV4[];
  premiseRevision?: string;
  rootId?: string;
  remainingObligations?: string[];
  dependencies?: string[];
  bodyHash?: string;
  stageId: string;
  passage: string;
  conditions: string[];
  branch: string;
}

/** Driver for an already admitted, already authorized packet. No provider retry or publication. */
export async function runTheoryTrial(
  packet: readonly StagePassage[],
  invoke: (purpose: 'assess' | 'construct' | 'challenge', stages: readonly StagePassage[], previous: Trial) => Promise<unknown>,
) {
  const stages = structuredClone(packet);
  const ids = stages.map(stage => stage.stageId);
  if (!stages.length || stages.length > 6 || new Set(ids).size !== ids.length
      || stages.some(stage => !stage.stageId.trim() || !stage.branch.trim() || !stage.passage.trim())) {
    throw new Error('Expected one to six distinct exposed V4 stage passages');
  }
  const responses: unknown[] = [];
  let state = replayTheoryTrial(ids, responses);
  for (const purpose of ['assess', 'construct', 'challenge'] as const) {
    const response = await invoke(purpose, structuredClone(stages), structuredClone(state));
    responses.push(structuredClone(response));
    state = replayTheoryTrial(ids, responses);
    if (state.phase === 'closed') break;
  }
  return state;
}

/** Replay accepted responses. The writer decides eligibility for scoped use from the evidence and grants. */
export function replayTheoryTrial(exposedStages: readonly string[], responses: readonly unknown[]): Trial {
  const grants = new Set(exposedStages);
  const checkRefs = (ids: string[]) => {
    if (ids.some(id => !grants.has(id))) throw new Error('V4 stage was not exposed');
  };
  return responses.reduce<Trial>((trial, response) => {
    if (trial.phase === 'screen') {
      const result = decode(assessment, response);
      if (result.decision === 'construct') checkRefs(result.stageRefs);
      return { phase: result.decision === 'construct' ? 'construct' : 'closed', assessment: result };
    } else if (trial.phase === 'construct') {
      const draft = decode(construction, response);
      if ('decision' in draft) return { phase: 'closed', assessment: trial.assessment, proposal: draft };
      checkRefs(draft.stageRefs);
      return { phase: 'challenge', assessment: trial.assessment, proposal: draft };
    } else if (trial.phase === 'challenge') {
      return { ...trial, phase: 'reviewed', challenge: decode(challenge, response) };
    } else {
      throw new Error('V4 theory trial already ended');
    }
  }, { phase: 'screen' });
}
