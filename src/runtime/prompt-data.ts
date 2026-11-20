import { structuredAttemptPath } from './attempt-outline.js';
/** Request-only projection: historical quota fields are never scientific constraints. */
export function promptData<T>(input: T): T {
  const soft = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const budget = value as Record<string, unknown>;
    return { semantics: 'soft wrap-up advisory only', timeoutMs: budget.timeoutMs,
      ...(budget.softDeadlineAt === undefined ? {} : { softDeadlineAt: budget.softDeadlineAt }) };
  };
  const visit = (value: unknown, scope: 'root' | 'input' | 'other' = 'other'): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      scope !== 'other' && key === 'componentState' && item && typeof item === 'object'
        ? visit(Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'reviewBase')))
        : key === 'path' ? visitPath(value as Record<string, unknown>)
        : ['budget', 'workerBudget', 'epochBudget', 'roleBudget'].includes(key) ? soft(item)
        : key === 'workerBudgets' && item && typeof item === 'object'
          ? Object.fromEntries(Object.entries(item).map(([effort, budget]) => [effort, soft(budget)])) : visit(item, scope === 'root' && key === 'input' ? 'input' : 'other')]));
  };
  const visitPath = (attempt: Record<string, unknown>): unknown => {
    const path = structuredAttemptPath(attempt);
    return typeof path === 'string' ? path : visit(path);
  };
  return visit(input, 'root') as T;
}
