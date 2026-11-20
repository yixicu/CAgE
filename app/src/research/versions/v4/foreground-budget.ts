import type { RoleBudget } from '../../contracts/v1.js';
import type { EpochSnapshotV21 } from '../../contracts/v21.js';

/** A proof call can reserve one quarter of the epoch's spendable pool across all its physical rounds. */
export function foregroundBudgetV4(snapshot: Pick<EpochSnapshotV21, 'theoryRevision' | 'config'>, roleBudget: RoleBudget = snapshot.config.roleBudget): RoleBudget {
  if(snapshot.theoryRevision==='v4-operation-5'){const result={...roleBudget};delete result.maxTokens;delete result.maxCostUsd;return result;}
  if (!['v4-operation-1','v4-operation-2','v4-operation-3','v4-operation-4'].includes(snapshot.theoryRevision??'')) return roleBudget;
  const epoch = snapshot.config.epochBudget;
  return {...roleBudget,
    maxTokens: Math.min(roleBudget.maxTokens ?? Infinity, Math.floor((epoch.maxTokens - epoch.reserveTokens) / 4)),
    maxCostUsd: Math.min(roleBudget.maxCostUsd ?? Infinity, (epoch.maxCostUsd - epoch.reserveCostUsd) / 4),
  };
}
