import { Type, type TSchema } from 'typebox';
import { exact } from './strict-schema.js';
import type { AnyAgentInvocation } from '../research/contracts/loop.js';
import { BranchResultSchema } from '../research/versions/v1/schemas.js';
import { WorkerResultSchema } from '../research/versions/v2/schemas.js';
import { PathReportSchema } from '../research/contracts/documents.js';

export const isWorkerInvocation = (call: { task: string }) => call.task === 'worker_step' || call.task === 'v2_worker_step';
const owned = new Set(['taskId', 'branchId', 'epochId', 'hypothesisRevision', 'inputRevision', 'executionStatus', 'chapters', 'protocol', 'stepNotes', 'evidenceWarnings', 'derivationRef']);
function fields(call: AnyAgentInvocation): Record<string, TSchema> {
  const schema = call.task === 'v2_worker_step' ? WorkerResultSchema : BranchResultSchema;
  return { ...Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !owned.has(key) && key !== 'pathReport')),
    ...Object.fromEntries(Object.entries(PathReportSchema.properties).map(([key, value]) => [`pathReport.${key}`, value])) };
}

function requiredFields(call: AnyAgentInvocation): string[] {
  const schema = call.task === 'v2_worker_step' ? WorkerResultSchema : BranchResultSchema;
  return [...(schema.required ?? []).filter(key => !owned.has(key) && key !== 'pathReport'),
    'conclusion', ...(call.task === 'worker_step' ? ['strongestObjection', 'verificationQuality'] : []),
    ...Object.keys(PathReportSchema.properties).map(key => `pathReport.${key}`)];
}

/** Compact type hints, not defaults: every scientific value must be supplied explicitly. */
function hint(value: TSchema): string {
  const schema = value as { const?: unknown; type?: string; anyOf?: TSchema[]; items?: TSchema; properties?: Record<string, TSchema>; required?: string[] };
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.anyOf) return (schema.anyOf as TSchema[]).map(hint).join(' | ');
  if (schema.type === 'array') return (schema.items as { type?: string }).type === 'string' ? 'list: - item; or [] only when checked and none' : `JSON array of ${hint(schema.items!)}`;
  if (schema.type === 'object') return `{${Object.entries(schema.properties as Record<string, TSchema>).map(([key, value]) => `${key}${schema.required?.includes(key) ? '' : '?'}: ${hint(value)}`).join(', ')}}`;
  return schema.type === 'string' ? 'raw text' : String(schema.type);
}

/** Incremental responsibilities within the unchanged six-step protocol. */
const stepFocus: Record<string, string> = {
  FORMULATE: `# FORMULATE: local plan
## Scope and missing inputs
Work ONLY on the assigned module, not the root. Check that its inputs suffice; report missing definitions or premises without reconstructing the whole problem. Use conditional premises as assumptions, not upstream claims to prove.
## Incremental output
1. NEW local definitions or missing conditions absent from the brief.
2. Outstanding obligations within this module.
3. The main risk and a targeted check.
If a category has no additions, say so briefly. Reference granted definitions and accepted interfaces instead of restating them.
## Do not expand or duplicate work
Do not derive the answer, add sharper bounds/higher orders, or promote optional verification to a required deliverable. Do not save a chapter just to copy the brief or plan and repeat it in notes. You may save important new conventions or substantive recovery material; reference it rather than copying it.`,
  DERIVE: 'Develop the assigned component once, with sufficient equations to reproduce it. Use the selected accepted component statements as premises after checking their conditions, symbols and applicability; do not reprove them. Missing sibling results are not granted premises: report the missing dependency or prove only an unassigned local prerequisite; never duplicate work assigned to another owner silently. Leave another owner\'s full classification to that owner.',
  CHALLENGE: 'Attack the weakest substantive inference or applicability condition with a targeted independent check. Do not write a second full proof or solve another owner\'s task unless a concrete contradiction requires it. Explain the actual check and its result; necessary independent verification is not forbidden duplication.',
  CHECK: 'Audit the new claims of this task and connecting uses, not all upstream proofs: recompute cheap local consequences from definitions where applicable (signs, counts, dimensions, normalization, quantifiers and approximation order), rather than trusting earlier verified/sufficient labels. Give a compact claim -> calculation/check -> result or correction ledger. When a saved component is corrected, submit a new complete save_proof_chapter now with the corrected body and interface, retaining its exact returned ref; a ledger-only correction is not delivery. Incorporate CHALLENGE corrections and identify affected equations. Do not recopy unchanged derivations or claim unperformed checks.',
  REFLECT: 'Report only residual gaps, corrections to carry forward and useful continuation; do not repeat the proof or the CHECK ledger.',
  RETURN: 'Select already saved corrected components for final delivery. Submit save_proof_chapter only for unsaved work or genuinely corrected bytes; do not regenerate a proof already saved in CHECK. Carry all corrections and qualifications into the report. Each component declares exact statement/formulas, conditions, symbol domains, direct dependency versions and use, and remaining gaps. A task may produce several components without extra Workers. Component bodies contain the corrected proof, not a request to reconcile old DERIVE/CHECK logs. Refer to saved derivation sections by title/location; the host attaches exact chapter references. Summarize key steps without copying their bodies. Never prefer an earlier formula over its later correction. If any component chapters were saved, componentDelivery is required: explicitly select the final complete component identities and list every corrected old->new identity with a scientific reason (corrections: [] only when no saved component needed correction). Do not deliver a superseded draft or depend on it. Save each prerequisite first and wait for its tool-issued ref before saving dependent chapters.',
};

/** Scientific obligations only; the provider tool contract owns the output representation. */
export function workerPrompt(call: AnyAgentInvocation): string {
  const prefix = `Task: ${call.task}; mandatory step: ${call.step}.
# Worker handoff
## Reuse and local questions
Use the frozen brief already in this session. An accepted component is a reusable premise within its stated domain, not a request to rederive it. For unclear definitions or a new needed property, request only the relevant clarification/step. For a concrete contradiction, identify the exact component version, affected use and evidence. Reuse an answer to the same issue/version unless there is new evidence.
## Mandatory boundaries
Never use a descendant derived from a premise to certify that premise. Do not repeat the hypothesis or previous derivation. FORMULATE plans objects, obligations and checks; DERIVE calculates; CHALLENGE/CHECK retain substantive verification.
## This step only
Report the new derivation, correction or gap.
`;
  const focus = stepFocus[call.step ?? ''] ?? '';
  if (call.step !== 'RETURN') return prefix + focus + '\n' + 'Submit scientific notes using submit_research_result. Save long derivations in chapters.\n';
  return prefix + focus + '\n' + 'Submit the scientific fields using submit_research_result.'
    + '\nSupply every required scientific field, including pathReport. Use short chapter handles for componentDelivery selections and corrections; explicitly choose versions. The host supplies identity and execution envelopes. Unknowns belong in unresolvedQuestions/pathReport.obstacles, never fabricated empty results. Complete saved chapters may replace derivationMarkdown. Only report checks actually performed.\n';
}

/** Validated scientific content receives its immutable host envelope only here. */
export function bindWorkerOutput(value: unknown, call: AnyAgentInvocation): unknown {
  if(call.step !== 'RETURN') return {step:call.step,...value as object};
  exact(workerScientificSchema(call),value);
  const scientific=value as Record<string,unknown>;
  const brief=(call.input as {brief:any}).brief;
  return {step:call.step,notes:'Scientific report delivered; see result and saved chapters.',result:{...scientific,
    branchId:brief.branchId,executionStatus:'completed',
    assumptions:[...new Set([...brief.assumptions,...scientific.assumptions as string[]])],
    ...(call.task==='v2_worker_step'?{taskId:brief.taskId,epochId:brief.epochId,hypothesisRevision:brief.rootHypothesisRevision,inputRevision:brief.inputRevision}:{})}};
}

export function decodeWorkerOutput(text: string, call: AnyAgentInvocation): unknown {
  let value: Record<string, unknown>;
  const problems: string[] = [];
  if (call.step !== 'RETURN') {
    // Mathematical notes can start with a brace; only recognize an actual legacy notes envelope.
    try { const legacy = JSON.parse(text); if (typeof legacy?.notes === 'string') return { step: call.step, notes: legacy.notes }; } catch { /* Plain scientific text needs no JSON parsing. */ }
    return { step: call.step, notes: text.trim() };
  }
  // Compatibility with already-running sessions and deterministic adapters.
  if (text.trimStart().startsWith('{')) {
    const parsed = JSON.parse(text);
    value = parsed.result ?? parsed;
  } else {
    const available = fields(call), matches = [...text.matchAll(/^@@([A-Za-z][\w.]*)\s*$/gm)];
    if (!matches.length || text.slice(0, matches[0].index).trim()) throw new Error('Fill the named @@ scientific slots; do not wrap them in prose.');
    value = {}; const report: Record<string, unknown> = {};
    for (const [index, match] of matches.entries()) {
      const key = match[1], schema = available[key] as { type?: string; anyOf?: { type?: string }[]; items?: { type?: string } } | undefined;
      if (!schema) throw new Error(`Unknown scientific slot: ${key}`);
      const target = key.startsWith('pathReport.') ? report : value, name = key.replace(/^pathReport\./, '');
      if (Object.hasOwn(target, name)) throw new Error(`Repeated scientific slot: ${key}`);
      const raw = text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length).trim();
      if (!raw || raw.startsWith('<') && raw.endsWith('>') && raw === `<${hint(available[key])}>`) {
        problems.push(`${key}: supply an explicit scientific answer, not an empty slot or template hint`); continue;
      }
      target[name] = schema.type === 'string' || schema.anyOf?.every(item => item.type === 'string') ? raw
        : schema.type === 'array' && schema.items?.type === 'string' && raw !== '[]' && !raw.startsWith('[')
          ? raw.split(/\r?\n(?=- )/).map(line => line.replace(/^- /, '').trim()) : JSON.parse(raw);
    }
    value.pathReport = report;
  }
  for (const key of requiredFields(call)) {
    const target = key.startsWith('pathReport.') ? value.pathReport : value, name = key.replace(/^pathReport\./, '');
    if ((!target || typeof target !== 'object' || !Object.hasOwn(target, name)) && !problems.some(issue => issue.startsWith(`${key}:`))) problems.push(`${key}: missing required scientific slot`);
  }
  if (problems.length) throw new Error(problems.join('; ') + '. Do not fill unknown science with []; report specific unresolved gaps.');
  const brief = (call.input as { brief: { branchId: string; taskId?: string; epochId?: string; rootHypothesisRevision: string; inputRevision: string; assumptions: string[] } }).brief;
  for (const key of owned) delete value[key];
  const result = { ...value, branchId: brief.branchId, executionStatus: 'completed', assumptions: [...new Set([...brief.assumptions, ...(Array.isArray(value.assumptions) ? value.assumptions : [])])],
    ...(call.task === 'v2_worker_step' ? { taskId: brief.taskId, epochId: brief.epochId, hypothesisRevision: brief.rootHypothesisRevision, inputRevision: brief.inputRevision } : {}) };
  return { step: call.step, notes: 'Scientific report submitted; see result and saved chapters.', result };
}

export function workerScientificSchema(call: AnyAgentInvocation): TSchema {
  const source = call.task === 'v2_worker_step' ? WorkerResultSchema : BranchResultSchema;
  const properties = Object.fromEntries(Object.entries(source.properties).filter(([key]) => !owned.has(key)));
  const schema = Type.Object(properties, {additionalProperties:false});
  (schema as {required?: string[]}).required = [...new Set(requiredFields(call).map(key => key.split('.')[0]))];
  return schema;
}
