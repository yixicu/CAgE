import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { stableHash } from '../../../learning/research-hash.js';
import type { StagePassage } from './theory-trial.js';

const text = Type.String({ minLength: 1, pattern: '\\S' });
const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const choice = <const T extends readonly string[]>(...values: T) => Type.Unsafe<T[number]>(Type.Union(values.map(value => Type.Literal(value))));
const assessment = Type.Union([
  object({ decision: choice('pass', 'pending'), reason: text }),
  object({ decision: Type.Literal('watch'), reason: text, signal: text }),
  object({ decision: choice('construct', 'identify'), agenda: text, rationale: text }),
]);
const scopeReview = object({ decision: choice('admit', 'identify', 'close'), reason: text });
const candidate = object({ decision: Type.Literal('candidate'), primitives: text, laws: text, modelConditions: text,
  construction: text, internalClaim: text, derivation: text, interpretation: text, contribution: text, knownTheoryComparison: text, limits: text });
const construction = Type.Union([candidate, object({ decision: Type.Literal('no-change'), reason: text })]);
const challenge = object({ verdict: choice('supported', 'inconclusive', 'refuted'), contribution: choice('upstream', 'identification', 'restatement'), argument: text, limits: text });
const application = Type.Union([
  object({ status: Type.Literal('pending'), reason: text }),
  object({ status: Type.Literal('ready'), conclusion: text, interpretation: text, applicationArgument: text,
    conditions: Type.Array(text), limits: text }),
]);
const applicationReview = object({ verdict: choice('supported', 'inconclusive', 'refuted'), argument: text });
export const theorySchemasV43 = { assess: assessment, 'scope-review': scopeReview, construct: construction, challenge, instantiate: application, 'application-review': applicationReview };
export type PurposeV43 = keyof typeof theorySchemasV43;
export interface RootContextV43 {
  originalProblem: string;
  remainingObligations: string[];
  target: { projectId: string; epochId: string; rootId: string; branch: string; premiseRevision: string; obligation: string };
}
export interface ResearchStateV43 {
  phase: PurposeV43 | 'closed';
  host: { rootContext: RootContextV43; sources: { stageId: string; hash: string }[]; baseline: unknown[] };
  assessment?: Static<typeof assessment>;
  scopeReview?: Static<typeof scopeReview>;
  candidate?: Static<typeof candidate>;
  challenge?: Static<typeof challenge>;
  application?: Static<typeof application>;
  applicationReview?: Static<typeof applicationReview>;
  responses: unknown[];
}
export function createResearchV43(stages: readonly StagePassage[], rootContext: RootContextV43): ResearchStateV43 {
  if (!rootContext.originalProblem.trim() || !rootContext.remainingObligations.length ||
      !rootContext.remainingObligations.includes(rootContext.target.obligation) ||
      !Object.values(rootContext.target).every(v => typeof v === 'string' && v.trim()) || !stages.length) throw new Error('Missing revision-3 root context');
  return { phase: 'assess', responses: [], host: structuredClone({ rootContext,
    sources: stages.map(s => ({ stageId: s.stageId, hash: stableHash(s) })),
    baseline: stages.map(s => ({ fragment: s.fragment, conditions: s.conditions, environments: s.environments })) }) };
}
export function advanceResearchV43(state: ResearchStateV43, response: unknown): ResearchStateV43 {
  if (state.phase === 'closed' || !Value.Check(theorySchemasV43[state.phase], response)) throw new Error('Invalid revision-3 theory response');
  const next = structuredClone(state);
  next.responses.push(structuredClone(response));
  switch (state.phase) {
    case 'assess': {
      const value = response as NonNullable<ResearchStateV43['assessment']>;
      next.assessment = value;
      next.phase = value.decision === 'construct' || value.decision === 'identify' ? 'scope-review' : 'closed'; break;
    }
    case 'scope-review': {
      const value = response as NonNullable<ResearchStateV43['scopeReview']>;
      next.scopeReview = value; next.phase = value.decision === 'close' ? 'closed' : 'construct'; break;
    }
    case 'construct': {
      const value = response as Static<typeof construction>;
      if (value.decision === 'no-change') next.phase = 'closed';
      else { next.candidate = value; next.phase = 'challenge'; } break;
    }
    case 'challenge': {
      const value = response as NonNullable<ResearchStateV43['challenge']>;
      next.challenge = value;
      next.phase = value.verdict === 'supported' && value.contribution !== 'restatement' &&
        (state.scopeReview?.decision !== 'identify' && state.assessment?.decision !== 'identify' || value.contribution === 'identification') ? 'instantiate' : 'closed'; break;
    }
    case 'instantiate': {
      const value = response as NonNullable<ResearchStateV43['application']>;
      next.application = value; next.phase = value.status === 'ready' ? 'application-review' : 'closed'; break;
    }
    case 'application-review': next.applicationReview = response as NonNullable<ResearchStateV43['applicationReview']>; next.phase = 'closed'; break;
  }
  return next;
}

/** Deliberately no target, old review transcript, host baseline, or unfinished task in research input. */
export function researchInputV43(purpose: PurposeV43, stages: readonly StagePassage[], state: ResearchStateV43, knownTheories: readonly string[], watch?: { signal: string; reason: string }) {
  const sourceOnly = purpose === 'assess' || purpose === 'construct';
  const sources = stages.map(s => ({ statement: s.fragment?.statement, argument: s.fragment?.derivation ?? s.passage,
    status: s.fragment?.status, conditions: s.conditions,
    environments: s.environments?.map(e => ({ symbols: e.symbols, assumptions: e.assumptions.map(a => ({ statement: a.statement, provenance: a.provenance })) })) }));
  return { sources, knownTheories, ...(purpose === 'assess' && watch ? { watch: { signal: watch.signal, reason: watch.reason } } : {}),
    ...(purpose === 'assess' ? {} : { agenda: state.assessment }),
    ...(purpose === 'construct' ? { mode: state.scopeReview?.decision === 'identify' || state.assessment?.decision === 'identify' ? 'identification' : 'upstream' } : {}),
    ...(!sourceOnly ? { rootContext: state.host.rootContext, candidate: state.candidate,
      ...(purpose === 'application-review' ? { application: state.application } : {}) } : {}) };
}
export function qualifyApplicationV43(state: ResearchStateV43, stages: readonly StagePassage[], expected: { projectId: string; epochId: string; rootId: string }) {
  if (state.application?.status !== 'ready' || state.applicationReview?.verdict !== 'supported' ||
      state.challenge?.verdict !== 'supported' || state.challenge.contribution === 'restatement' || !state.candidate ||
      !state.scopeReview || state.scopeReview.decision === 'close') return;
  const target = state.host.rootContext.target;
  if (target.projectId !== expected.projectId || target.epochId !== expected.epochId || target.rootId !== expected.rootId ||
      state.host.sources.some(ref => !stages.some(s => s.stageId === ref.stageId && stableHash(s) === ref.hash))) return;
  return { ...structuredClone(state.application), target: structuredClone(target),
    evidence: { kind: 'reviewed-argument' as const, sources: structuredClone(state.host.sources), review: structuredClone(state.applicationReview) } };
}
export interface ResearchPublicationV4R3 {
  id: string;
  content: { primitives: string; laws: string; modelConditions: string; construction: string; internalClaim: string; derivation: string; limits: string };
  support: { trialId: string; revision: 'v4-operation-3'; sources: { scope: { projectId: string; epochId: string; rootId: string }; stage: StagePassage }[];
    sharedRefs?: { id: string; hash: string }[]; responses: unknown[]; target: { projectId: string; epochId: string; rootId: string }; host: ResearchStateV43['host'] };
}
export function validateResearchPublicationV43(value: ResearchPublicationV4R3): boolean {
  try {
    if (value.support.revision !== 'v4-operation-3' || value.id !== value.support.trialId || !value.support.sources.length) return false;
    if (Object.entries(value.support.target).some(([key, body]) => value.support.host.rootContext.target[key as keyof RootContextV43['target']] !== body)) return false;
    if (value.support.sources.some(s => s.stage.rootId !== s.scope.rootId)) return false;
    const stages = value.support.sources.map(s => s.stage);
    let state = createResearchV43(stages, value.support.host.rootContext);
    if (stableHash(state.host) !== stableHash(value.support.host)) return false;
    if (value.support.sharedRefs?.some(ref => !ref.id || !ref.hash)) return false;
    for (const response of value.support.responses) state = advanceResearchV43(state, response);
    if (!state.candidate || state.challenge?.verdict !== 'supported' || state.challenge.contribution === 'restatement' ||
        state.scopeReview?.decision === 'close' || (state.scopeReview?.decision === 'identify' || state.assessment?.decision === 'identify') && state.challenge.contribution !== 'identification') return false;
    return Object.entries(value.content).every(([key, body]) => state.candidate![key as keyof NonNullable<ResearchStateV43['candidate']>] === body);
  } catch { return false; }
}
