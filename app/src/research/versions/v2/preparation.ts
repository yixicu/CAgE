import { eligibleComponents, selectComponents, COMPONENT_ASSIGNMENT_INSTRUCTIONS } from '../../proof-components.js';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { PlanningChangeSchema, TagsSchema } from '../../contracts/review.js';
import type { ResearchProjectV2, PossibleWay, EpochSnapshot } from '../../contracts/v2.js';
import type { PlanningChange } from '../../contracts/review.js';
import { stableHash } from '../../../learning/research-hash.js';

const text = Type.String({ minLength: 1 });
const strings = Type.Array(text);
export const ProblemSchema = Type.Object({
  goal: text, conditions: strings, symbols: strings, obligations: strings,
  userStrategy: Type.Array(Type.Object({ instruction: text, source: text,
    strength: Type.Union([Type.Literal('preference'), Type.Literal('requirement')]) }, { additionalProperties: false })),
  executionRequirements: strings,
}, { additionalProperties: false });
export type PreparedProblem = Static<typeof ProblemSchema>;
export const ProblemPreparationSchema = Type.Object({
  problem: ProblemSchema, planningChange: Type.Optional(PlanningChangeSchema),
  researchTags: Type.Optional(TagsSchema), presentation: Type.Optional(Type.Unknown()),
}, { additionalProperties: false });
/** Optional scientific choice in the existing planning call; the root remains frozen. */
export const WorkingRevisionSchema = Type.Object({
  change: Type.Object({ ...PlanningChangeSchema.properties, kind: Type.Literal('working'),
    logicalRelation: Type.Union([Type.Literal('equivalent'), Type.Literal('sufficient'), Type.Literal('counterexample')]) }, { additionalProperties: false }),
  obligations: Type.Array(text, { minItems: 1 }),
}, { additionalProperties: false });
export interface WorkingRevision { change: PlanningChange & { kind: 'working'; logicalRelation: 'equivalent' | 'sufficient' | 'counterexample' }; obligations: string[] }
export function revisePreparedProblem(problem: PreparedProblem | undefined, revision: unknown): PreparedProblem {
  if (!problem || !Value.Check(ProblemSchema, problem) || !Value.Check(WorkingRevisionSchema, revision)) throw new Error('Working revision requires a prepared baseline, explicit root relation and obligations.');
  const choice = revision as WorkingRevision;
  if (!choice.change.linkReason.trim() || !choice.change.hypothesis.trim()) throw new Error('Working revision requires a nonempty target and logical return to the frozen root.');
  return { ...structuredClone(problem), goal: choice.change.hypothesis,
    conditions: [...new Set([...problem.conditions, ...choice.change.conditions])], obligations: [...choice.obligations] };
}
export interface ProblemPreparation { problem: PreparedProblem; planningChange?: PlanningChange; researchTags?: string[]; presentation?: unknown }
const ReusePreparationSchema = Type.Object({ reusePreparedProblem: Type.Literal(true) }, { additionalProperties: false });
export function preparationOutputSchema(input: unknown) {
  const data = input as { reusePreparedProblemAllowed?: boolean; priorPreparedProblem?: unknown };
  return data?.reusePreparedProblemAllowed && Value.Check(ProblemSchema, data.priorPreparedProblem)
    ? Type.Union([ProblemPreparationSchema, ReusePreparationSchema]) : ProblemPreparationSchema;
}
/** Only the latest committed organization of this exact target; source/commit revisions are not user requests. */
export function preparationBaseline(project: ResearchProjectV2, snapshot: EpochSnapshot,
  selection: { commandIds: string[]; blockedReason?: string; reconstruction?: unknown }) {
  const prior = project.epochs.at(-1)?.snapshot;
  if (!prior?.problem || !Value.Check(ProblemSchema, prior.problem) || prior.hypothesis !== snapshot.hypothesis
    || prior.hypothesisRevision !== snapshot.hypothesisRevision
    || stableHash(prior.workingHypothesis ?? null) !== stableHash(snapshot.workingHypothesis ?? null)) return {};
  return { priorPreparedProblem: structuredClone(prior.problem),
    reusePreparedProblemAllowed: !selection.blockedReason && !selection.commandIds.length && !selection.reconstruction };
}
export function parsePreparation(value: unknown, reusable?: PreparedProblem): ProblemPreparation {
  if (Value.Check(ReusePreparationSchema, value)) {
    if (!reusable || !Value.Check(ProblemSchema, reusable)) throw new Error('Preparation reuse has no eligible frozen baseline.');
    return { problem: structuredClone(reusable) };
  }
  if (!Value.Check(ProblemPreparationSchema, value)) throw new Error('Theorist task preparation is incomplete.');
  return structuredClone(value) as unknown as ProblemPreparation;
}
export const PREPARATION_INSTRUCTIONS = `# Problem preparation
## Purpose and order
Organize the user request before Strategy or Skill. Restate the goal, premises, symbols and proof obligations concisely; preserve quantifiers, domains, cases and precision. Separate operational requests from scientific premises. Extract user methods with their original source and preference/requirement strength.
## Reuse and revision
When priorPreparedProblem is supplied, use it as the baseline, preserving previously incorporated annotations and method preferences unless the current authorized input changes them. If reusePreparedProblemAllowed is true and no scientific revision is needed, return only {"reusePreparedProblem":true}; the host copies every field exactly. Do not retranscribe the baseline or re-derive the problem. A useful working-hypothesis replacement remains your choice: use the full problem/planningChange response instead. Pending user changes take priority; reuse is unavailable when they need consideration.
## Do not
Do not solve, calculate, select theorems, search the library or route knowledge here. Do not promote preferences to requirements, weaken explicit requirements, or silently omit premises. The host owns original target identity; restatement alone never replaces it.`;
export const ALLOCATION_INSTRUCTIONS = COMPONENT_ASSIGNMENT_INSTRUCTIONS + `An unchanged prepared problem is supplied directly by the host. When workingRevisionAllowed is true, you may choose workingRevision with an explicit equivalent/sufficient/counterexample return to the frozen root and new obligations; plan all ways against that revised goal. The host preserves the existing conditions, symbols, user methods and execution requirements. Otherwise omit workingRevision. Choose one or more macro methods according to plausible paths and current evidence, never a fixed count. Strategy gives broad principles or potentially relevant theorems; WaySkill connects them into a method chain. Do not precompute exact answers in planning. One way entry is one Worker task: use macroWayId to associate complementary tasks with their shared macro method, independently of hypothesis graph parentId. Each shared proof obligation has one primary owner; use exact adopted prerequisites rather than repeat it. Reassess scores and rationales every Epoch from accepted progress and remaining obligations. Actually adjust task selection/count, effort and explicit allocation dispatch/defer, not just ordering. priorityInputs.uncertainty describes scientific exploration risk, not permission to run. allocationUncertainty, when assessed, separately describes uncertainty about shallow/deep/defer choice; omit it if unassessed. Unknown proof success does not imply unknown appropriate effort. A useful counterexample is valuable; API failure is not evidence against a method. Do not update global factors merely because one local path succeeded. Continue named obstacles with newWork, not renamed duplicate tasks. Keep useful alternatives when they discriminate remaining uncertainties. Only pre-Epoch adopted dependencies may be used. Keep assignments macro-level and scoped: no precomputed solutions, redundant independent derivations of the same shared component, higher-order expansions when only leading order was requested, or stronger exact bounds than the root requires. Distinguish H (the full root obligation) from P (this Worker's target). For a required component, explain why complete resolution of H includes P and use base-necessary with hypothesis_implies_target; completion of P alone does not close H. Use base-sufficient with target_implies_hypothesis only if P really suffices for the entire H under the stated premises. base-equivalent requires both directions; base-counterexample refutes only its stated claim, not other unaddressed root obligations. Never change an implication merely to fit a constructor. User strategy is guidance, not a source-grounded anchor or evidence. The final synthesis must assemble all required components and check their return to H.`;

/** Compact prior allocation, not another copy of Worker proofs or global learning. */
export function allocationHistory(project: ResearchProjectV2) {
  const epoch = project.epochs.at(-1);
  if (!epoch) return undefined;
  return { epoch: epoch.id, decision: epoch.decision, reason: epoch.reason,
    tasks: epoch.tasks.map(task => ({ id: task.id, macroWayId: task.way.macroWayId ?? task.way.id,
      assignment: task.way.assignment ?? task.way.question, effort: task.way.effort,
      allocation: task.way.allocation, scores: task.way.scores, state: task.state,
      committed: epoch.committedTaskIds.includes(task.id) })),
    instruction: 'Committed execution is not scientific adoption. Consult the new path reports and review evidence; change actual complementary work allocation when warranted.' };
}

/** A dependency declaration is not read permission or scientific acceptance. */
export function eligibleAdoptedChapters(project: ResearchProjectV2) {
  return eligibleComponents(project);
}
export function adoptedPrerequisites(project: ResearchProjectV2, way: PossibleWay) {
  const selected = way.dependencyChapters ?? [];
  const adopted = selectComponents(project, selected);
  for (const ref of selected) {
    if (!way.dependencyTaskIds.includes(ref.attemptId) || !adopted.some(saved => stableHash(saved) === stableHash(ref))) {
      throw new Error('Prerequisite must be an explicitly adopted, current, exact pre-Epoch chapter.');
    }
  }
  return structuredClone(selected);
}
