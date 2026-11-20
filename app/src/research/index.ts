import type {ResearchProjectV0,AgentSessionSpecV0} from './contracts/v0.js';
import type {NewResearchProjectV0,ResearchLoopBundleV0} from './contracts/loop.js';
import {v0} from './versions/v0/index.js';
import type {ResearchProjectV21,AgentSessionSpecV21} from './contracts/v21.js';
import type {NewResearchProjectV21,ResearchLoopBundleV21} from './contracts/loop.js';
import {v21} from './versions/v21/index.js';
import {v4} from './versions/v4/index.js';
import {v3} from './versions/v3/index.js';
import type { AgentSessionSpec, LoopProvenance, ResearchProject } from './contracts/v1.js';
import type { AgentSessionSpecV2, ResearchProjectV2 } from './contracts/v2.js';
import type { AnyAgentSessionSpec, AnyInFlight, AnyResearchLoopBundle, AnyResearchProject, NewResearchProject, NewResearchProjectV2, ResearchLoopBundle, ResearchLoopBundleV2, ResearchLoopResolver } from './contracts/loop.js';
import { v1 } from './versions/v1/index.js';
import { v2 } from './versions/v2/index.js';
export type * from './contracts/loop.js';
import { ResearchVersionError } from './contracts/errors.js';
export { ValidationError, ResearchVersionError, ResearchSelectionError } from './contracts/errors.js';
export const DEFAULT_RESEARCH_LOOP_VERSION = '2.1';
const bundles: ReadonlyMap<string, AnyResearchLoopBundle> = new Map<string, AnyResearchLoopBundle>([[v1.version, v1], [v2.version, v2], [v21.version,v21], [v3.version,v3], [v4.version,v4], [v0.version,v0]]);
export function getResearchLoop(version: string): AnyResearchLoopBundle {
  const bundle = bundles.get(version);
  if (!bundle) throw new ResearchVersionError();
  return bundle;
}
export function listResearchLoops() {
  return [...bundles.values()].map(({ version, workerProtocolVersion, contractVersion, projectSchemaVersion }) => ({ version, workerProtocolVersion, contractVersion, projectSchemaVersion, default: version === DEFAULT_RESEARCH_LOOP_VERSION }));
}
export function loopForProject(value: ResearchProject, resolve?: ResearchLoopResolver): ResearchLoopBundle;
export function loopForProject(value: ResearchProjectV2, resolve?: ResearchLoopResolver): ResearchLoopBundleV2;
export function loopForProject(value: ResearchProjectV21, resolve?: ResearchLoopResolver): ResearchLoopBundleV21;
export function loopForProject(value: ResearchProjectV0, resolve?: ResearchLoopResolver): ResearchLoopBundleV0;
export function loopForProject(value: unknown, resolve?: ResearchLoopResolver): AnyResearchLoopBundle;
export function loopForProject(value: unknown, resolve: ResearchLoopResolver = getResearchLoop): AnyResearchLoopBundle {
  if (!value || typeof value !== 'object') throw new Error('Invalid project version metadata.');
  const p = value as Record<string, unknown>;
  if (typeof p.researchLoopVersion !== 'string' || typeof p.workerProtocolVersion !== 'string' || typeof p.schemaVersion !== 'number') throw new Error('Invalid project version metadata.');
  const bundle = resolve(p.researchLoopVersion);
  if (bundle.version !== p.researchLoopVersion || p.schemaVersion !== bundle.projectSchemaVersion || p.workerProtocolVersion !== bundle.workerProtocolVersion || (bundle.contractVersion !== '1' && bundle.contractVersion !== '2' && bundle.contractVersion !== '2.1' && bundle.contractVersion !== 'v0-test-1')) throw new ResearchVersionError();
  return bundle;
}
export function parseResearchProject(value: unknown, resolve: ResearchLoopResolver = getResearchLoop): AnyResearchProject { return loopForProject(value, resolve).parseProject(value); }
export function createResearchProject(input: NewResearchProjectV0): ResearchProjectV0;
export function createResearchProject(input: NewResearchProjectV21): ResearchProjectV21;
export function createResearchProject(input: NewResearchProjectV2): ResearchProjectV2;
export function createResearchProject(input: Omit<NewResearchProject, 'researchLoopVersion'> & { researchLoopVersion: '1.0' }): ResearchProject;
export function createResearchProject(input: NewResearchProject | NewResearchProjectV2 | NewResearchProjectV21 | NewResearchProjectV0): AnyResearchProject;
export function createResearchProject(input: NewResearchProject | NewResearchProjectV2 | NewResearchProjectV21 | NewResearchProjectV0): AnyResearchProject {
  const bundle = getResearchLoop(input.researchLoopVersion ?? DEFAULT_RESEARCH_LOOP_VERSION);
  if (bundle.contractVersion === 'v0-test-1') return bundle.createProject({...input,researchLoopVersion:'0'});
  if (bundle.contractVersion === '2.1') return bundle.createProject({...input,researchLoopVersion:bundle.version});
  if (bundle.contractVersion === '2') return bundle.createProject({ id: input.id, name: input.name, hypothesis: input.hypothesis, researchLoopVersion: '2.0', ...(input.config ? { config: input.config } : {}) });
  return bundle.createProject({ id: input.id, name: input.name, hypothesis: input.hypothesis, researchLoopVersion: input.researchLoopVersion, ...(input.config ? { config: input.config } : {}) });
}
export function loopForSession(spec: AgentSessionSpec, resolve?: ResearchLoopResolver): ResearchLoopBundle;
export function loopForSession(spec: AgentSessionSpecV2, resolve?: ResearchLoopResolver): ResearchLoopBundleV2;
export function loopForSession(spec: AgentSessionSpecV21, resolve?: ResearchLoopResolver): ResearchLoopBundleV21;
export function loopForSession(spec: AgentSessionSpecV0, resolve?: ResearchLoopResolver): ResearchLoopBundleV0;
export function loopForSession(spec: AnyAgentSessionSpec, resolve?: ResearchLoopResolver): AnyResearchLoopBundle;
export function loopForSession(spec: AnyAgentSessionSpec, resolve: ResearchLoopResolver = getResearchLoop): AnyResearchLoopBundle {
  const project = 'project' in spec.context ? spec.context.project : undefined;
  const pin: LoopProvenance = spec.loop ?? (project ? { researchLoopVersion: project.researchLoopVersion, workerProtocolVersion: project.workerProtocolVersion } : { researchLoopVersion: '1.0', workerProtocolVersion: '1.0' });
  const bundle = resolve(pin.researchLoopVersion);
  if (bundle.version !== pin.researchLoopVersion || pin.workerProtocolVersion !== bundle.workerProtocolVersion || (project && (project.researchLoopVersion !== pin.researchLoopVersion || project.workerProtocolVersion !== pin.workerProtocolVersion)) || (bundle.contractVersion !== '1' ? !('contractVersion' in spec) || spec.contractVersion !== bundle.contractVersion : 'contractVersion' in spec)) throw new ResearchVersionError();
  return bundle;
}
export function parseResearchInFlight(value: unknown): AnyInFlight {
  const pin = (value as { loop?: LoopProvenance } | null)?.loop ?? { researchLoopVersion: '1.0', workerProtocolVersion: '1.0' };
  const bundle = getResearchLoop(pin.researchLoopVersion);
  if (pin.workerProtocolVersion !== bundle.workerProtocolVersion) throw new ResearchVersionError();
  return bundle.parseInFlight(value);
}
