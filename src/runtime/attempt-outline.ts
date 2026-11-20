import { Value } from 'typebox/value';
import { PathReportSchema } from '../research/contracts/documents.js';
const access = 'Use the corrected component interfaces by default. Original exploratory chapters remain in the authorized attemptIndex for concrete questions; read only relevant steps when needed. This is not a claim that their bodies were read.';
/** Request view only. Unknown legacy strings retain their original meaning and representation. */
export function structuredAttemptPath(attempt: Record<string, unknown>): unknown {
  if (typeof attempt.id !== 'string' || typeof attempt.version !== 'string' || typeof attempt.workerId !== 'string'
    || typeof attempt.path !== 'string') return attempt.path;
  try {
    const parsed = JSON.parse(attempt.path);
    if (!parsed || parsed.bodyAccess !== access || !Value.Check(PathReportSchema, parsed.pathReport)) return attempt.path;
    // Parse only a generated outline, never arbitrary prose, raw derivations or tool arguments.
    return parsed;
  } catch { return attempt.path; }
}
