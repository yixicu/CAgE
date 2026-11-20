import type { ResearchConfigV2, ResearchProjectV2 } from '../../contracts/v2.js';
import { basePolicy } from './routing.js';
import { createWaySkills } from './ways.js';
import { parseConfig, parseProject } from './schemas.js';

export const DEFAULT_CONFIG_V2: ResearchConfigV2 = {
  maxWorkers: 3, maxEpochs: 3, moderatorEnabled: false, literatureEnabled: false,
  workerBudgets: {
    shallow: { maxTurns: 12, maxToolCalls: 12, timeoutMs: 120_000, maxTokens: 8000, maxCostUsd: 0.5 },
    deep: { maxTurns: 24, maxToolCalls: 24, timeoutMs: 240_000, maxTokens: 16000, maxCostUsd: 1 },
  },
  roleBudget: { maxTurns: 16, maxToolCalls: 12, timeoutMs: 600_000, maxTokens: 16000, maxCostUsd: 1 },
  epochBudget: { maxTasks: 6, maxTokens: 80000, maxCostUsd: 6, timeoutMs: 600_000, reserveTokens: 8000, reserveCostUsd: 0.5, reserveTimeMs: 30_000 },
  userDomainPreferences: {},
};

export function createProjectState(input: { id: string; name: string; hypothesis: string; config?: Partial<ResearchConfigV2>; researchLoopVersion?: string }): ResearchProjectV2 {
  if (input.researchLoopVersion !== undefined && input.researchLoopVersion !== '2.0') throw new Error('V2 creation requires explicit version 2.0.');
  const epochBudget = { ...DEFAULT_CONFIG_V2.epochBudget, ...input.config?.epochBudget };
  if (input.config?.epochBudget && input.config.epochBudget.reserveTimeMs === undefined) epochBudget.reserveTimeMs = Math.max(1, Math.min(30_000, Math.floor(epochBudget.timeoutMs / 4)));
  const config = parseConfig({ ...structuredClone(DEFAULT_CONFIG_V2), ...input.config, epochBudget });
  return parseProject({ schemaVersion: 2, researchLoopVersion: '2.0', workerProtocolVersion: '2.0', id: input.id, name: input.name,
    hypothesis: input.hypothesis, hypothesisRevision: 'hypothesis_1', contentRevision: 'initial', sources: [], config,
    status: 'idle', phase: 'idle', epoch: 0, graph: [{ id: 'root', hypothesisRevision: 'hypothesis_1', question: input.hypothesis, status: 'pending', assumptions: [] }],
    results: [], summary: '', policies: [basePolicy()], waySkills: createWaySkills(), epochs: [], waySkillTraces: [], strategyTraces: [], processedCommandIds: [], refinements: [],
  });
}
