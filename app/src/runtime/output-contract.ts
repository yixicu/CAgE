import { ChapterSelectionSchema } from './chapter-selection.js';
import { ContinuationSchema } from '../research/contracts/review.js';
import { WaysWireSchema, ModuleContextSchema, continuationIndex } from './planning-wire.js';
import { planningIssues } from './planning-issues.js';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { isDeepStrictEqual } from 'node:util';
import type { AnyAgentInvocation } from '../research/contracts/loop.js';
import type { ResourceReadRef, ScientificReview } from '../research/contracts/review.js';
import type { BoundaryView } from '../learning/research-data.js';
import type { EpochSnapshot } from '../research/contracts/v2.js';
import * as v1 from '../research/versions/v1/schemas.js';
import * as v2 from '../research/versions/v2/schemas.js';
import { preparationOutputSchema } from '../research/versions/v2/preparation.js';

/** Wire-format validation only. The unchanged engines still adjudicate and commit results. */
export function outputSchema(invocation: AnyAgentInvocation): TSchema | undefined {
  if (invocation.task === 'v2_route_knowledge' && (invocation.input as { preparationOnly?: boolean }).preparationOnly) return preparationOutputSchema(invocation.input);
  const schemas: Record<string, TSchema> = {
    plan: v1.PlanSchema, synthesize: v1.SynthesisSchema, review: v1.ReviewSchema,
    literature: v1.LiteratureSchema, moderate_plan: v1.ModeratorSchema, moderate_review: v1.ModeratorSchema,
    worker_step: v1.WorkerStepSchema, v2_worker_step: v2.WorkerStepSchema,
    v2_generate_ways: WaysWireSchema, v2_synthesize: v2.SynthesisSchema,
    v2_route_knowledge: v2.KnowledgeRoutingSchema, v2_audit: v2.AuditOutputSchema, v2_literature: v2.LiteratureSchema,
  };
  if (invocation.task === 'v2_decision_check') {
    const input = invocation.input as { choices: string[] };
    return Type.Object({ selectedAction: Type.Union(input.choices.map(value => Type.Literal(value))), uncertainty: Type.Number({ minimum: 0, maximum: 1 }), rationale: Type.String({ minLength: 1 }) }, { additionalProperties: false });
  }
  if (invocation.task === 'v2_moderate' || invocation.task === 'v2_review_way_skill') return (invocation.input as { outputSchema?: TSchema }).outputSchema;
  // Match the existing semantic gate on the first request, including evolved factor IDs.
  if (invocation.task === 'v2_generate_ways') {
    const { snapshot } = invocation.input as { snapshot: EpochSnapshot };
    const factors = snapshot.researchBoundary?.decision.factors;
    if (factors) {
      const wire = structuredClone(WaysWireSchema);
      const item = wire.properties.ways.items as TSchema & { properties: Record<string, TSchema>; required?: string[] };
      item.properties.scores = Type.Object(Object.fromEntries(factors.map(({ id }) => [id, Type.Number({ minimum: 0, maximum: 4 })])), { additionalProperties: false });
      item.properties.rationales = Type.Object(Object.fromEntries(factors.map(({ id }) => [id, Type.String({ minLength: 1 })])), { additionalProperties: false });
      item.required = [...new Set([...(item.required ?? []), 'scores', 'rationales'])];
      return wire;
    }
  }
  if (invocation.task === 'plan') {
    // V1 uses the same host-owned reference envelope as V2; never retype component science.
    return Type.Object({ ...v1.PlanSchema.properties,
      candidates: Type.Array(Type.Object({ ...v1.CandidateSchema.properties,
        proofContext: ModuleContextSchema,
        dependencyChapters: Type.Optional(Type.Array(ChapterSelectionSchema, { maxItems: 128 })),
        continuation: Type.Optional(Type.Object({ ...ContinuationSchema.properties,
          chapters: Type.Optional(Type.Array(ChapterSelectionSchema, { maxItems: 128 })),
        }, { additionalProperties: false })),
      }, { additionalProperties: false }), { maxItems: 100 }),
    }, { additionalProperties: false });
  }
  const selected = schemas[invocation.task];
  if (selected && (invocation.task === 'review' || invocation.task === 'v2_synthesize')) {
    const wire = structuredClone(selected) as { required?: string[]; properties: { researchReview?: { properties: { proof?: { required?: string[] } } } } };
    if (invocation.task === 'v2_synthesize' && (invocation.input as {attemptIndex?: unknown[]}).attemptIndex?.length)
      wire.required = [...new Set([...(wire.required ?? []), 'researchReview'])];
    const proof = wire.properties.researchReview?.properties.proof;
    if (proof?.required) proof.required = proof.required.filter(key => key !== 'target');
    return wire as TSchema;
  }
  return selected;
}

/** Repeat the frozen envelope explicitly; models still supply and validators check every field. */
export function frozenResultFields(invocation: AnyAgentInvocation) {
  if (invocation.task !== 'v2_worker_step' || invocation.step !== 'RETURN') return undefined;
  const { brief } = invocation.input as { brief: Parameters<typeof v2.parseWorkerResult>[1] };
  return { taskId: brief.taskId, branchId: brief.branchId, epochId: brief.epochId, hypothesisRevision: brief.rootHypothesisRevision, inputRevision: brief.inputRevision, assumptions: [...brief.assumptions] };
}

export function outputIssues(value: unknown, invocation: AnyAgentInvocation, schema?: TSchema, resourceReads: readonly ResourceReadRef[] = []): string[] {
  if (invocation.task === 'v2_generate_ways') {
    const input = invocation.input as { snapshot: EpochSnapshot; adoptedPrerequisites?: import('../research/contracts/documents.js').ChapterRef[] };
    return planningIssues(value, input.snapshot, schema ?? WaysWireSchema, resourceReads, input.adoptedPrerequisites, continuationIndex(input), (invocation.input as { workingRevisionAllowed?: boolean }).workingRevisionAllowed === true);
  }
  const issues = schema && !Value.Check(schema, value) ? [...Value.Errors(schema, value)].slice(0, 8).map(error => `${error.instancePath || '/'}: ${error.message} ${JSON.stringify(error.params)}`) : [];
  if (invocation.task === 'v2_moderate') {
    const input = invocation.input as { operation?: string; sharedPolicyAnchors?: unknown[] };
    const anchors = value && typeof value === 'object' && 'anchors' in value ? value.anchors : undefined;
    if (input.operation === 'propose_candidate' && input.sharedPolicyAnchors && Array.isArray(anchors) && anchors.some(anchor => !input.sharedPolicyAnchors!.some(shared => isDeepStrictEqual(anchor, shared)))) issues.push('/anchors: use only exact sharedPolicyAnchors from the frozen training input. Project-specific source IDs or rewritten anchor content cannot become global policy anchors. Express specialization using strategies.anchorTags. Allowed exact content: ' + JSON.stringify(input.sharedPolicyAnchors));
  }
  const frozen = frozenResultFields(invocation);
  if (frozen) {
    const candidate = value && typeof value === 'object' && 'result' in value ? value.result : undefined;
    const result: Record<string, unknown> = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
    for (const key of ['taskId', 'branchId', 'epochId', 'hypothesisRevision', 'inputRevision'] as const) {
      if (result[key] !== frozen[key]) issues.push(`/result/${key}: copy the exact frozen value ${JSON.stringify(frozen[key])}`);
    }
  }
  if (!issues.length && invocation.task === 'v2_synthesize') {
    const input = invocation.input as {attemptIndex?: {id:string;version:string}[]; previouslyRead?: Record<string,string>};
    const read = (value as {researchReview?: ScientificReview})?.researchReview?.attemptsRead ?? [];
    if (input.attemptIndex && read.some(ref => !input.attemptIndex!.some(item => item.id === ref.id && item.version === ref.version))) issues.push('/researchReview/attemptsRead: acknowledge only exact delivered attemptIndex id/version pairs.');
    const missing = input.attemptIndex?.filter(ref => input.previouslyRead?.[ref.id] !== ref.version && !read.some(item => item.id === ref.id && item.version === ref.version));
    if (missing?.length) issues.push('/researchReview/attemptsRead: inspect and acknowledge the delivered path reports before completing synthesis: ' + JSON.stringify(missing.map(({id,version})=>({id,version}))) + '. Do not claim unread evidence. A closed root also needs an explicit proof submission; completion prose alone does not archive a proof.');
  }
  if (!issues.length && (invocation.task === 'review' || invocation.task === 'v2_synthesize')) {
    const input = invocation.input as { hypothesisId?: string; project?: { hypothesis: string; hypothesisId?: string; hypothesisRevision: string }; snapshot?: EpochSnapshot; researchBoundary?: BoundaryView };
    const proposal = (value as { researchReview?: ScientificReview } | null)?.researchReview?.proof;
    if (proposal) {
      const hypothesis = input.project?.hypothesis ?? input.snapshot?.hypothesis;
      const hypothesisId = input.project?.hypothesisId ?? input.hypothesisId ?? `h_${input.project?.hypothesisRevision ?? input.snapshot?.hypothesisRevision}`;
      const boundary = input.researchBoundary ?? input.snapshot?.researchBoundary;
      if (hypothesis !== undefined && proposal.target !== hypothesis) issues.push('/researchReview/proof/target: use the exact frozen root target. A different target must first be accepted at a planning boundary: ' + JSON.stringify(hypothesis));
      const prior = boundary?.proofs?.find(item => item.ref.hypothesisId === hypothesisId && item.meta?.methodKey === proposal.methodKey);
      if (prior?.meta && !proposal.semanticChange) {
        for (const key of ['targetKey', 'conditions', 'logicalRelation'] as const) {
          if (!isDeepStrictEqual(proposal[key], prior.meta[key])) issues.push(`/researchReview/proof/${key}: semanticChange false is a wording-only revision; retain the exact existing ${key}: ${JSON.stringify(prior.meta[key])}. If the scientific conditions or logical relation genuinely changed, declare semanticChange true and explain that change; do not infer equivalence from wording.`);
        }
      }
    }
  }
  if (!issues.length && value && typeof value === 'object') {
    const output = value as { candidates?: { proofContext?: unknown }[]; ways?: { proofContext?: unknown }[]; result?: { executionStatus?: string; pathReport?: unknown; conclusion?: string; applicability?: string; derivationMarkdown?: string; derivationChain?: unknown[]; chapters?: { complete?: boolean }[] } };
    const ways = invocation.task === 'plan' ? output.candidates : undefined;
    if (ways?.some(way => !way.proofContext)) issues.push('Each new possible way needs a task-relevant proofContext: symbols/definitions, conditions/applicability, obligations. Use empty arrays where genuinely not applicable.');
    if ((invocation.task === 'worker_step' || invocation.task === 'v2_worker_step') && invocation.step === 'RETURN' && output.result?.executionStatus === 'completed') {
      const result = output.result;
      if (!result.pathReport) issues.push('Return an explicit pathReport covering method, keySteps, actual conditions, result, obstacles, nextSteps and conventionChanges; a file reference alone is not a report.');
      // Report independent omissions together: the single correction must not uncover them one at a time.
      if (!result.derivationMarkdown?.trim() && !result.chapters?.some(ref => ref.complete)) issues.push('Include derivationMarkdown containing the actual concise derivation, or complete saved chapters. derivationChain and pathReport do not replace the derivation body. Preserve pathReport when adding the body.');
      if (invocation.task === 'v2_worker_step') {
        if (!result.conclusion) issues.push('Include the scoped scientific conclusion.');
        if (!result.applicability?.trim()) issues.push('State applicability under the actual premises.');
        if (!result.derivationChain?.length) issues.push('Include the derivationChain of explicit logical steps.');
      }
    }
  }
  // Report identity and resource mistakes in the existing single permitted correction.
  if (issues.length) return issues;
  try {
    if (invocation.task === 'worker_step' && invocation.step) {
      const output = v1.parseWorkerStep(value, invocation.step);
      if (output.result) v1.parseBranchResult(output.result, (invocation.input as { brief: Parameters<typeof v1.parseBranchResult>[1] }).brief);
    } else if (invocation.task === 'v2_worker_step' && invocation.step) {
      v2.parseWorkerStepV2(value, invocation.step, (invocation.input as { brief: Parameters<typeof v2.parseWorkerResult>[1] }).brief);
    } else if (invocation.task === 'v2_synthesize') {
      v2.parseSynthesisV2(value, (invocation.input as { snapshot: Parameters<typeof v2.parseSynthesisV2>[1] }).snapshot);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Output does not match the frozen task contract.';
    if (message.includes('conditional idealization propagation')) return [message, 'Every idealizedConditions.assumedCondition must appear verbatim in assumptions. With any idealizedConditions, evidence cannot be sufficient and conclusion cannot be compatible. Pure mathematical premises are not hypothetical measurements; use an empty idealizedConditions array when no missing empirical data were idealized.'];
    if (message.includes('missing relevant Challenge limits') && invocation.task === 'v2_worker_step') {
      const brief = (invocation.input as { brief: Parameters<typeof v2.parseWorkerResult>[1] }).brief;
      return [message, 'checkedLimits must contain the exact required label for each actually performed check, without appending prose to the label. Put its derivation in derivationChain or derivationMarkdown. Never claim an unperformed check. For a genuinely unfinished check, use conclusion inconclusive, incomplete true, evidence insufficient or need_data, and unresolvedQuestions entries of the exact form required-label: specific reason for each missing check.', 'Required labels: ' + JSON.stringify(brief.way.requiredLimits)];
    }
    return [message];
  }
  return [];
}
