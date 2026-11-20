import { parseConfig, parseProject } from './schemas.js';
import { BASELINE_WEIGHTS } from './frontier.js';
import type { ResearchConfig, ResearchProject, ResearchStage } from '../../contracts/v1.js';
export const DEFAULT_CONFIG: Readonly<ResearchConfig> = {
  maxWorkers: 3, maxRounds: 3, maxBranches: 9, moderatorEnabled: false, literatureEnabled: false,
  workerBudgets: { shallow: { maxTurns: 12, maxToolCalls: 24, timeoutMs: 120000 }, deep: { maxTurns: 24, maxToolCalls: 60, timeoutMs: 600000 } },
  roleBudget: { maxTurns: 36, maxToolCalls: 60, timeoutMs: 900000 },
};
export const TRANSITIONS: Readonly<Record<ResearchStage, readonly ResearchStage[]>> = {
  INTAKE: ['PLAN'], PLAN: ['PRIORITIZE'], PRIORITIZE: ['DISPATCH'], DISPATCH: ['VERIFY'], VERIFY: ['SYNTHESIZE'], SYNTHESIZE: ['REVIEW'], REVIEW: ['CHECKPOINT'], CHECKPOINT: ['DECIDE'], DECIDE: ['INTAKE'],
};
export function assertTransition(from: ResearchStage, to: ResearchStage): void { if (!TRANSITIONS[from].includes(to)) throw new Error(`Illegal research transition ${from} -> ${to}.`); }
export function createProjectState(input: { id: string; name: string; hypothesis: string; config?: Partial<ResearchConfig> }): ResearchProject {
  const config = parseConfig({ ...structuredClone(DEFAULT_CONFIG), ...input.config });
  for (const budget of Object.values(config.workerBudgets)) if (budget.maxTurns < 6) throw new Error('Worker maxTurns must permit the six mandatory protocol steps.');
  return parseProject({
    schemaVersion: 1, researchLoopVersion: '1.0', workerProtocolVersion: '1.0', id: input.id, name: input.name, hypothesis: input.hypothesis,
    hypothesisRevision: 'initial', contentRevision: 'initial', sources: [], config, status: 'idle', stage: 'INTAKE', round: 0, frontier: [],
    graph: [{ id: 'root', hypothesisRevision: 'initial', question: input.hypothesis, status: 'pending' }], results: [], summary: '',
    policies: [{ weights: { ...BASELINE_WEIGHTS }, version: 1, effectiveFromRound: 1 }], rounds: [], processedCommandIds: [], refinements: [], experiences: [], evidence: [],
  });
}
