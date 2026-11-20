import type { ResearchProjectV2, WorkerStep } from '../../contracts/v2.js';

const checks = {
  INVALID_OUTPUT: 'Check the required response schema, frozen identifiers and premises before RETURN; do not repeat unchanged malformed output.',
  BUDGET_EXHAUSTED: 'Historical quota rejection, not a scientific failure. Current usage is telemetry and time is a soft advisory; reuse saved work without replaying completed steps.',
  BUDGET_UNAVAILABLE: 'Keep missing usage unknown, not zero. Current research is not blocked by unavailable telemetry.',
  TOOL_FAILED: 'A tool operation was denied or failed; inspect the saved execution boundary before retrying. No specific permission or scientific failure is established.',
  TOOL_PROTOCOL_FAILED: 'The tool-call batch was incomplete or unsupported; correct the delivery protocol without replaying completed research or inferring a scientific outcome.',
  INVALID_TOOL: 'Keep the next plan within the existing tool grants; no privilege expansion.',
  PROVIDER_FAILED: 'Provider failure establishes no scientific outcome; require an explicit later run rather than automatic replay.',
  UNKNOWN: 'Inspect the saved execution boundary before retrying; the cause and scientific outcome remain unknown.',
} as const;

/** Keep only controlled diagnostic codes, never remote messages, credentials or raw errors. */
export function executionFailure(error: unknown, step: WorkerStep | 'SESSION'): string {
  const value = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const code = Object.hasOwn(checks, value) ? value : 'UNKNOWN';
  return `Execution failure ${code} at ${step}; no scientific verdict was inferred.`;
}

/** Existing public failure records become bounded operational context, never scientific Skills. */
export function operationalLessons(project: Pick<ResearchProjectV2, 'results' | 'hypothesisRevision'>) {
  const seen = new Set<string>();
  return project.results.slice().reverse().flatMap(result => {
    if (result.executionStatus === 'completed' || result.hypothesisRevision !== project.hypothesisRevision) return [];
    const match = /^Execution failure ([A-Z_]+) at (SESSION|FORMULATE|DERIVE|CHALLENGE|CHECK|REFLECT|RETURN);/.exec(result.errorSummary ?? '');
    if (!match || !Object.hasOwn(checks, match[1]!)) return [];
    const [, code, step] = match, key = `${code}:${step}`;
    if (seen.has(key)) return []; seen.add(key);
    return [{ taskId: result.taskId, code: code!, step: step!, check: checks[code as keyof typeof checks], reviewed: false as const, scope: 'execution_only' as const }];
  }).slice(0, 5);
}

/** Controlled public explanation; never include raw provider or tool exceptions. */
export function publicFailureReason(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const reasons: Record<string, string> = {
    INVALID_OUTPUT: 'The model response could not be read as a valid research report after one correction.',
    TOOL_FAILED: 'A tool operation was denied or could not finish; saved findings were preserved.',
    TOOL_PROTOCOL_FAILED: 'The model returned an incomplete or unsupported tool-call batch; saved findings were preserved.',
    INVALID_TOOL: 'The requested tool is not allowed within this role’s permissions.',
    BUDGET_EXHAUSTED: 'A historical runtime rejected work under its old quota policy; saved findings remain available.',
    BUDGET_UNAVAILABLE: 'A historical runtime rejected unknown usage; current usage reporting does not control research admission.',
    CONTEXT_EXHAUSTED: 'The model could not fit the required research context.',
    PROVIDER_FAILED: 'The model provider did not finish the request.',
  };
  return reasons[code] ?? 'The research operation could not finish; saved findings were preserved.';
}
