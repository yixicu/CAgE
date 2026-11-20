import {budgetControlsEnabledV3} from '../research/versions/v3/capacity-policy.js';
import type { ModelSelection, RoleBudget } from '../research/contracts/v1.js';
import type { Usage } from '../research/contracts/v2.js';
import type { LearningAttempt, LearningCall, LearningResult } from './learning-task.js';
import { RuntimeError, type RuntimeErrorCode } from './errors.js';

export type LearningAttemptResult = { output: unknown; usage: Usage; error?: never } | { error: RuntimeError; usage: Usage; output?: never };
export class LearningFallbackError extends RuntimeError {
  constructor(code: RuntimeErrorCode, readonly usage: Usage, readonly attempts: LearningAttempt[], readonly elapsedMs?: number) { super(code); }
}
export const unusedLearningUsage = (): Usage => ({ turns: 0, toolCalls: 0, tokens: 0, costUsd: 0, tokensKnown: true, costKnown: true });
const eligible = new Set<RuntimeErrorCode>(['MODEL_REQUIRED', 'MODEL_UNAVAILABLE', 'AUTH_REQUIRED', 'AUTH_FAILED', 'PROVIDER_FAILED', 'BUDGET_UNAVAILABLE', 'INVALID_OUTPUT']);

/** Only explicitly configured candidates; every attempt retains the same scientific task. */
export async function runLearningFallback(call: LearningCall, authorized: readonly ModelSelection[], run: (call: LearningCall, index: number, deadline: number|undefined) => Promise<LearningAttemptResult>, timing?:{startedAt:number}): Promise<LearningResult> {
  const frozen = structuredClone(call), started = timing?.startedAt ?? Date.now(), attempts: LearningAttempt[] = [];
  let usage = unusedLearningUsage();
  const candidates = [frozen.model, ...structuredClone(frozen.budget.capacityPolicy?authorized:authorized.slice(0,4))].filter((model, index, all) => all.findIndex(other => other.provider === model.provider && other.modelId === model.modelId) === index);
  for (const [index, model] of candidates.entries()) {
    const budget:RoleBudget={...frozen.budget,...(budgetControlsEnabledV3(frozen.budget.capacityPolicy)?{softDeadlineAt:frozen.budget.softDeadlineAt??started+frozen.budget.timeoutMs}:{})};
    if(!budgetControlsEnabledV3(frozen.budget.capacityPolicy))delete budget.softDeadlineAt;
    if(frozen.budget.capacityPolicy){if(budgetControlsEnabledV3(budget.capacityPolicy)){budget.maxTurns-=usage.turns;budget.maxToolCalls-=usage.toolCalls;if(budget.maxTurns<=0||budget.maxToolCalls<0)throw new LearningFallbackError('BUDGET_EXHAUSTED',usage,attempts,Date.now()-started);}if(budget.maxTokens!==undefined){if(!usage.tokensKnown||usage.tokens===undefined)throw new LearningFallbackError('BUDGET_UNAVAILABLE',usage,attempts,Date.now()-started);budget.maxTokens-=usage.tokens;if(budget.maxTokens<=0)throw new LearningFallbackError('BUDGET_EXHAUSTED',usage,attempts,Date.now()-started);}if(budget.maxCostUsd!==undefined){if(!usage.costKnown||usage.costUsd===undefined)throw new LearningFallbackError('BUDGET_UNAVAILABLE',usage,attempts,Date.now()-started);budget.maxCostUsd-=usage.costUsd;if(budget.maxCostUsd<=0)throw new LearningFallbackError('BUDGET_EXHAUSTED',usage,attempts,Date.now()-started);}}
    const result = await run({ ...structuredClone(frozen), model, budget }, index, budgetControlsEnabledV3(frozen.budget.capacityPolicy)?started+frozen.budget.timeoutMs:undefined);
    attempts.push({ model: { ...model }, budget, usage: structuredClone(result.usage), ...(result.error ? { errorCode: result.error.code } : {}) });
    const tokensKnown = usage.tokensKnown !== false && result.usage.tokensKnown !== false && Number.isFinite(result.usage.tokens);
    const costKnown = usage.costKnown !== false && result.usage.costKnown !== false && Number.isFinite(result.usage.costUsd);
    usage = { turns: usage.turns + result.usage.turns, toolCalls: usage.toolCalls + result.usage.toolCalls, tokensKnown, costKnown,
      ...(tokensKnown ? { tokens: (usage.tokens ?? 0) + result.usage.tokens! } : {}), ...(costKnown ? { costUsd: (usage.costUsd ?? 0) + result.usage.costUsd! } : {}) };
    if (!result.error) return { output: result.output, usage, attempts, elapsedMs: Date.now() - started };
    // Only configured fallback candidates; unknown usage remains telemetry, not an admission gate.
    if (frozen.nativeHandoff==='native-handoff-v1'&&result.error.code==='INVALID_OUTPUT' || !eligible.has(result.error.code) || index === candidates.length - 1) throw new LearningFallbackError(result.error.code, usage, attempts, Date.now() - started);
  }
  throw new LearningFallbackError('MODEL_UNAVAILABLE', usage, attempts, Date.now() - started);
}
