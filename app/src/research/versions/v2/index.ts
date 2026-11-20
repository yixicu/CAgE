import type { ResearchLoopBundleV2 } from '../../contracts/loop.js';
import { ResearchEngine } from './engine.js';
import { createProjectState } from './state.js';
import { assertBoundary, validateInvocation } from './boundaries.js';
import { parseProject, parseConfig, parseInFlight } from './schemas.js';
import { roleSystemPrompt, taskPrompt } from './prompts.js';
export const v2: ResearchLoopBundleV2 = Object.freeze<ResearchLoopBundleV2>({
  version: '2.0', workerProtocolVersion: '2.0', contractVersion: '2', projectSchemaVersion: 2,
  acceptsSelectionFrom: Object.freeze(['2.0']),
  create: (store, runtime, composition) => new ResearchEngine(store, runtime, composition),
  createProject: createProjectState, assertBoundary, validateInvocation,
  parseProject, parseConfig, parseInFlight, roleSystemPrompt, taskPrompt,
});
