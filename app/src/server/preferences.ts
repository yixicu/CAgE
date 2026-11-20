import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../storage/atomic.js';
import { RuntimeError } from '../runtime/errors.js';
import { createResearchProject, getResearchLoop } from '../research/index.js';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import type { AppPreferences } from './preferences-types.js';
export type { AppPreferences } from './preferences-types.js';

/** System settings apply at explicit start boundaries; historical snapshots stay pinned. */
export function parsePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['defaultModel','maintenanceModel', 'researchDefaults', 'learningFallbackModels'].includes(key))) throw new RuntimeError('INVALID_CONFIGURATION');
  const model = (value as AppPreferences).defaultModel;
  if (model !== undefined && (!model || typeof model !== 'object' || Array.isArray(model) || Object.keys(model).some(key => !['provider', 'modelId', 'thinkingLevel'].includes(key))
    || ![model.provider, model.modelId].every(text => typeof text === 'string' && text.trim().length > 0 && text.length <= 200)
    || (model.thinkingLevel !== undefined && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(model.thinkingLevel)))) throw new RuntimeError('INVALID_CONFIGURATION');
  const maintenanceModel=(value as AppPreferences).maintenanceModel;
  if(maintenanceModel!==undefined)parsePreferences({defaultModel:maintenanceModel});
  const fallbacks = (value as AppPreferences).learningFallbackModels;
  if (fallbacks !== undefined) {
    if (!Array.isArray(fallbacks)) throw new RuntimeError('INVALID_CONFIGURATION');
    for (const candidate of fallbacks) {
      if (!candidate) throw new RuntimeError('INVALID_CONFIGURATION');
      parsePreferences({ defaultModel: candidate });
    }
    if (new Set(fallbacks.map(candidate => JSON.stringify([candidate.provider, candidate.modelId]))).size !== fallbacks.length) throw new RuntimeError('INVALID_CONFIGURATION');
  }
  const defaults = (value as AppPreferences).researchDefaults && structuredClone((value as AppPreferences).researchDefaults);
  if (defaults !== undefined) {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || Object.keys(defaults).some(key => !['0', '1.0', '2.0', '2.1', '3.0', '4.0'].includes(key))) throw new RuntimeError('INVALID_CONFIGURATION');
    for (const [version, config] of Object.entries(defaults)) {
      const parsed=getResearchLoop(version).parseConfig(config);delete parsed.defaultModel;Object.assign(defaults,{[version]:parsed});
      // Delete from the normalized copy, not a stale object replaced above.
      delete config.defaultModel; // One workspace model; version templates only override specific roles.
    }
  }
  return { ...(maintenanceModel?{maintenanceModel:{...maintenanceModel}}:{}), ...(model ? { defaultModel: { ...model } } : {}), ...(fallbacks ? { learningFallbackModels: structuredClone(fallbacks) } : {}), ...(defaults ? { researchDefaults: structuredClone(defaults) } : {}) };
}
export function researchDefaults(preferences: AppPreferences) {
  return { '0': preferences.researchDefaults?.['0'] ?? systemDefault('0'), '1.0': preferences.researchDefaults?.['1.0'] ?? systemDefault('1.0'), '2.0': preferences.researchDefaults?.['2.0'] ?? systemDefault('2.0'), '2.1': preferences.researchDefaults?.['2.1'] ?? systemDefault('2.1'), '3.0': preferences.researchDefaults?.['3.0'] ?? systemDefault('3.0'), '4.0': preferences.researchDefaults?.['4.0'] ?? systemDefault('4.0') };
}
function systemDefault(version: '0'): import('../research/contracts/v0.js').ResearchConfigV0;
function systemDefault(version: '1.0'): import('../research/contracts/v1.js').ResearchConfig;
function systemDefault(version: '2.0'): import('../research/contracts/v2.js').ResearchConfigV2;
function systemDefault(version: '2.1' | '3.0' | '4.0'): import('../research/contracts/v21.js').ResearchConfigV21;
function systemDefault(version: '0' | '1.0' | '2.0' | '2.1' | '3.0' | '4.0') {
  const project = createResearchProject({ id: 'defaults', name: 'Defaults', hypothesis: 'Defaults', researchLoopVersion: version });
  if (project.schemaVersion === 2) {
    // Pi reports input history again on every turn. Envelopes must cover six Worker steps
    // plus Theorist context. Preserve cost caps, concurrency, science and stop semantics.
    project.config.workerBudgets.shallow.maxTokens = 160_000;
    project.config.workerBudgets.deep.maxTokens = 240_000;
    project.config.roleBudget.maxTokens = 480_000;
    project.config.epochBudget.maxTokens = 1_200_000;
    project.config.epochBudget.reserveTokens = 60_000;
    project.config.epochBudget.reserveTimeMs = 90_000;
  }
  return project.config;
}
export function applyPreferences(project: AnyResearchProject, preferences: AppPreferences): void {
  const all = researchDefaults(preferences);
  if (project.schemaVersion === 4 && project.researchLoopVersion === '0') project.config = structuredClone(all['0']);
  else if (project.schemaVersion === 3) project.config = structuredClone(all[project.researchLoopVersion]);
  else if (project.schemaVersion === 2 && project.researchLoopVersion === '2.0') project.config = structuredClone(all['2.0']);
  else if (project.schemaVersion === 1 && project.researchLoopVersion === '1.0') project.config = structuredClone(all['1.0']);
  else throw new RuntimeError('INVALID_CONFIGURATION');
  const defaults = project.config;
  if (preferences.defaultModel) {
    project.config.defaultModel = structuredClone(preferences.defaultModel);
    // Per-role choices now belong to system research settings, never stale project selections.
    project.config.roleModels = structuredClone(defaults?.roleModels ?? {});
  }
}
export async function readPreferences(dataRoot: string): Promise<AppPreferences> {
  try { return parsePreferences(JSON.parse(await readFile(join(dataRoot, 'preferences.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}
export async function writePreferences(dataRoot: string, value: AppPreferences): Promise<void> {
  await atomicWrite(join(dataRoot, 'preferences.json'), JSON.stringify(parsePreferences(value), null, 2) + '\n');
}
