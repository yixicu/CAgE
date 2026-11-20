import type { AnyAgentSessionSpec } from '../research/contracts/loop.js';

/** A Worker proves its assigned module. Root identity/scoring stay with host and Theorist. */
export function workerContext(spec: AnyAgentSessionSpec): unknown {
  if ('contractVersion' in spec && spec.contractVersion === '2.1') return spec.context;
  if (!('brief' in spec.context)) return spec.context;
  const brief = spec.context.brief;
  // Old persisted tasks may define essential premises only in the root text. Never guess a local extraction.
  if (brief.proofContext?.scope !== 'module') return spec.context;
  const way = 'way' in brief ? brief.way : undefined;
  const common = {
    question: brief.question, target: way?.targetProposition ?? brief.question,
    assignment: way?.assignment ?? ('assignment' in brief ? brief.assignment : undefined),
    proofContext: brief.proofContext, assumptions: brief.assumptions,
    mode: way?.mode ?? ('mode' in brief ? brief.mode : undefined), effort: brief.effort,
    changedPremises: way?.changedPremises, requiredLimits: way?.requiredLimits,
    conditionalPremises: way?.conditionalPremises, proofInterfaces: way?.proofInterfaces,
    adoptedChapters: brief.adoptedChapters, componentIssues: brief.componentIssues,
    continuation: way?.continuation ?? ('continuation' in brief ? brief.continuation : undefined),
    dependencyUse: way?.dependencyUse ?? ('dependencyUse' in brief ? brief.dependencyUse : undefined),
    frozenSourceRefs: brief.frozenSourceRefs, anchors: 'anchors' in brief ? brief.anchors : undefined,
    executionRequirements: 'constraints' in brief ? brief.constraints?.executionRequirements : undefined,
    targetTheory: 'targetTheory' in brief ? brief.targetTheory : undefined,
    conventionVersion: brief.conventionVersion, budget: brief.budget,
  };
  return { brief: common };
}
