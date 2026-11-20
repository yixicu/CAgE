import type { ResearchLoopBundle } from '../../contracts/loop.js';
import { assertBoundary, validateInvocation } from './boundaries.js';
import { ResearchEngine } from './engine.js';
import { createProjectState } from './state.js';
import { parseConfig, parseInFlight, parseProject } from './schemas.js';
import { roleSystemPrompt, taskPrompt } from './prompts.js';

/** V1's approved nine-stage scientific implementation; versioned separately from V2. */
export const v1: ResearchLoopBundle = Object.freeze<ResearchLoopBundle>({
  version: '1.0', workerProtocolVersion: '1.0', contractVersion: '1', projectSchemaVersion: 1,
  acceptsSelectionFrom: Object.freeze(['1.0']),
  create: (store, runtime, composition) => new ResearchEngine(store, runtime, composition),
  assertBoundary, validateInvocation,
  createProject: createProjectState, parseProject, parseConfig, parseInFlight, roleSystemPrompt, taskPrompt,
});
