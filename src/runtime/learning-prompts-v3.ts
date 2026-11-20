import {compactHostMetadataV3} from '../research/versions/v3/host-metadata.js';
import type { LearningCall } from './learning-task.js';
import { learningPromptV2 } from './learning-prompts-v2.js';
import { guidanceHashV3, type GuidanceDocumentV3 } from '../research/versions/v3/guidance-budget.js';

type Data = Record<string, unknown>;
const DELIMITER = '\nFrozen task data: ';
const RESOURCE_KEYS = ['id', 'version', 'semanticKey', 'enabled', 'status', 'kind'];
const POLICY_KEYS = ['loopVersion', 'version', 'parentVersion'];
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function pick(value: unknown, keys: string[]): Data {
  return record(value) ? Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]])) : {};
}
function omit(value: Data, keys: string[]): Data {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
/** Render only selected guidance: raw strings retain every newline and scope qualifier. */
function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item, index) => `[${index}]\n${render(item)}`).join('\n');
  if (record(value)) return Object.entries(value).map(([key, item]) => `${key}:\n${render(item)}`).join('\n');
  return JSON.stringify(value) ?? '';
}

/** Presentation only: canonical calls and scientific originals remain unchanged. */
export function prepareLearningGuidanceV3(call: LearningCall): {
  prompt: string; documents: GuidanceDocumentV3[]; initialIds: string[];
} {
  const legacy = learningPromptV2(call).replace(DELIMITER,
    '\nOpen continuation originals are context, not established results.' + DELIMITER);
  const split = legacy.indexOf(DELIMITER);
  const raw = legacy.slice(split + DELIMITER.length), documents: GuidanceDocumentV3[] = [];
  const result = (prompt: string) => ({prompt, documents, initialIds: documents.map(document => document.id)});
  if (raw === 'undefined') return result(legacy);
  const outer: unknown = compactHostMetadataV3(JSON.parse(raw));
  if (!record(outer)) return result(legacy);
  const add = (path: string, kind: GuidanceDocumentV3['kind'], value: unknown): Data => {
    const id = `learning:${path}`, text = `${path}\n${render(value)}`;
    documents.push({id, kind, text, hash: guidanceHashV3(text)});
    return {guidanceRef: id, guidanceOmitted: true};
  };
  const data = record(outer.frozenInput) ? outer.frozenInput : outer;
  const prefix = data === outer ? '' : 'frozenInput.';
  for (const key of ['existingSkills', 'strategies']) {
    const entries = data[key];
    if (!Array.isArray(entries)) continue;
    data[key] = entries.map((entry, index) => {
      if (!record(entry)) return entry;
      const meta = record(entry.meta) ? entry.meta : entry;
      return {...pick(meta, RESOURCE_KEYS), ...add(`${prefix}${key}.${index}`, 'resource', entry)};
    });
  }
  for (const key of ['decision', 'observedPolicy']) {
    const value = data[key];
    if (value !== undefined && value !== null) {
      data[key] = {...pick(value, POLICY_KEYS), ...add(`${prefix}${key}`, 'policy', value)};
    }
  }
  for (const key of ['opportunity', 'patterns']) {
    const value = data[key];
    if (typeof value === 'string' || Array.isArray(value) && value.length && value.every(item => typeof item === 'string')) {
      data[key] = add(`${prefix}${key}`, 'knowledge', value);
    }
  }
  const invalid = outer.invalidResponse;
  if (record(invalid)) for (const key of ['resource', 'decision']) {
    const value = invalid[key];
    if (value === undefined || value === null) continue;
    const marker = add(`invalidResponse.${key}`, key === 'decision' ? 'policy' : 'resource', value);
    const technical = record(value) ? omit(value, key === 'resource' ? ['name', 'description', 'conditions', 'body'] : ['rules']) : {};
    if (key === 'decision' && Array.isArray(technical.factors)) {
      technical.factors = technical.factors.map(factor => record(factor) ? omit(factor, ['description']) : factor);
    }
    invalid[key] = {...technical, ...marker};
  }
  return result(legacy.slice(0, split + DELIMITER.length) + JSON.stringify(outer));
}

export function learningPromptV3(call: LearningCall): string {
  return prepareLearningGuidanceV3(call).prompt;
}
