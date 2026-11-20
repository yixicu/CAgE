import type { FastifyInstance } from 'fastify';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import type { ResourceMeta, ResourceRef } from '../learning/research-data.js';
import { LearningDataError, learningFamily } from '../learning/research-data.js';
import { stableHash } from '../learning/research-hash.js';
import type { ResearchLibrary } from '../learning/research-library.js';
import type { LearningService } from '../learning/learning-service.js';
import type { CapabilitiesView, CapabilityItem, CapabilityNetwork, CapabilityResourceEdit } from './capabilities-types.js';

type Selection = { expectedRevision: string; projectId?: string; key: string; enabled: boolean };
const keyFor = (item: ResourceMeta) => `${item.kind === 'specific-strategy' ? 'strategy' : 'skill'}:${item.id}@${item.version}`;
const revisionFor = (generation: number) => stableHash({ generation });
function projectFamily(project?:AnyResearchProject):1|2 {
  if(!project)return 2;
  const version=project.researchLoopVersion;
  if(version==='0')return 2;
  if(version!=='1.0'&&version!=='2.0'&&version!=='2.1'&&version!=='3.0'&&version!=='4.0')throw new LearningDataError('INVALID_INPUT','Unknown research version.');
  return learningFamily(version);
}

/** Current or last saved input pins, never an inference that enabled means used. */
function loadedResources(project?: AnyResearchProject): ResourceRef[] {
  if (!project) return [];
  if (project.schemaVersion === 4 || project.schemaVersion === 3) {
    const epoch = project.activeEpoch ?? project.epochs.at(-1);
    return (epoch?.loadedResources ?? []).map(ref => ({ ...ref }));
  }
  const epoch = project.schemaVersion === 2 ? project.activeEpoch ?? project.epochs.at(-1) : undefined;
  const input = project.schemaVersion === 1 ? project.rounds.at(-1)?.research : epoch && 'research' in epoch ? epoch.research ?? epoch.snapshot : epoch?.snapshot;
  if (!input || !('loadedResources' in input) || !Array.isArray(input.loadedResources)) return [];
  return input.loadedResources.filter((ref): ref is ResourceRef => !!ref && typeof ref.id === 'string' && Number.isSafeInteger(ref.version));
}

/** Project metadata is used only to project applicability. The browser receives no learning sources or raw exploration. */
export function libraryCapabilities(library: ResearchLibrary, project?: AnyResearchProject): CapabilitiesView {
  const state = library.snapshot();
  const next = library.readBoundary({ sessionId: project?.id ?? 'capability_defaults', loopVersion: projectFamily(project),
    ...(project ? { hypothesis: project.hypothesis } : {}), ...(project && 'researchTags' in project ? { tags: project.researchTags } : {}) });
  const loaded = loadedResources(project);
  const items = Object.values(state.resources).map((item): CapabilityItem => ({
    key: keyFor(item), kind: item.kind === 'specific-strategy' ? 'strategy' : 'skill', id: item.id, version: String(item.version),
    title: item.title??item.name, description: item.description, subjectTags: item.tags.filter(tag => tag.startsWith('subject:') || tag.startsWith('specialization:')), origin: 'local', owner: item.kind === 'specific-strategy' ? 'moderator' : 'theorist',
    scope: 'global', enabled: item.enabled, available: item.status === 'valid', userEdited: item.updatedBy?.role === 'user', limitations: [...item.conditions],
    active: (project?.schemaVersion !== 1 || item.kind !== 'specific-strategy') && loaded.some(ref => ref.id === item.id && ref.version === item.version),
    ...(item.status !== 'valid' ? { reason: 'Awaiting source-proof repair; excluded from research.' }
      : project?.schemaVersion === 1 && item.kind === 'specific-strategy' ? { reason: 'Used by Strict research.' } : {}),
  })).sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  return { revision: revisionFor(state.generation), items,
    effective: { policyKey: '', skillKeys: next.skills.map(keyFor), specializedIds: next.strategies.map(item => item.id) },
    pending: project?.status === 'running' && loaded.some(ref => { const item = state.resources[ref.id]; return !item || !item.enabled || item.status !== 'valid' || item.version !== ref.version; }),
    ...(project ? { loopVersion: project.researchLoopVersion } : {}) };
}

/** Synchronous projection: no await can splice inventory and graph generations. */
export function libraryCapabilityNetwork(library: ResearchLibrary, project?: AnyResearchProject): CapabilityNetwork {
  const inspection = library.inspectUserResources();
  const capabilities = libraryCapabilities(library, project);
  if (capabilities.revision !== revisionFor(inspection.generation)) throw new LearningDataError('CONFLICT', 'Capabilities changed. Refresh.');
  const available = new Set(inspection.available.map(ref => `${ref.id}@${ref.version}`));
  capabilities.items = capabilities.items.map(item => ({ ...item, available: available.has(`${item.id}@${item.version}`), editable: available.has(`${item.id}@${item.version}`),
    ...(!available.has(`${item.id}@${item.version}`) ? { reason: 'Source support unavailable; metadata only.' } : {}) }));
  return { revision: capabilities.revision, capabilities, ...inspection.network };
}

/** The library's serialized generation check covers both concurrent selection and learning publication. */
export async function selectLibraryCapability(library: ResearchLibrary, input: Selection): Promise<void> {
  const state = library.snapshot();
  if (input.expectedRevision !== revisionFor(state.generation)) throw new LearningDataError('CONFLICT', 'Capabilities changed. Refresh before saving.');
  const item = Object.values(state.resources).find(resource => keyFor(resource) === input.key);
  if (!item) throw new LearningDataError('NOT_FOUND', 'This capability version is no longer available.');
  if (input.enabled && item.status !== 'valid') throw new LearningDataError('CONFLICT', 'This capability is awaiting source-proof repair.');
  await library.setResourceEnabled(item.id, input.enabled, item.version, state.generation);
}

/** Inherits application Origin/Host/token protection. USER edits do not run learning. */
export function registerLibraryCapabilityRoutes(app: FastifyInstance, library: ResearchLibrary, snapshot: (id: string) => Promise<AnyResearchProject>, changed: () => void, learning?: LearningService): void {
  const projectId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };
  const status = (error: LearningDataError) => error.code === 'CONFLICT' || error.code === 'STALE_SOURCE' ? 409 : error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 400;
  const reviewRef={id:{type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'},version:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}};
  app.get<{Querystring:{id:string;version:number}}>('/api/capabilities/network/reviews',{schema:{querystring:{type:'object',additionalProperties:false,required:['id','version'],properties:reviewRef}}},async request=>({review:await learning?.networkReviewStatus(request.query)??null}));
  app.post<{Body:{id:string;version:number;expectedRevision:string;requestId:string}}>('/api/capabilities/network/reviews',{schema:{body:{type:'object',additionalProperties:false,required:['id','version','expectedRevision','requestId'],properties:{...reviewRef,expectedRevision:{type:'string',pattern:'^[0-9a-f]{64}$'},requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'}}}}},async(request,reply)=>{
    try {if(!learning)throw new LearningDataError('INVALID_INPUT','Learning service unavailable.');return {review:await learning.requestNetworkReview(request.body)};}
    catch(error){if(error instanceof LearningDataError)return reply.status(status(error)).send({error:error.code,message:error.message});throw error;}
  });
  app.get<{ Querystring: { projectId?: string } }>('/api/capabilities', { schema: { querystring: { type: 'object', properties: { projectId }, additionalProperties: false } } }, async (request, reply) => {
    try { return libraryCapabilities(library, request.query.projectId ? await snapshot(request.query.projectId) : undefined); }
    catch (error) { if (error instanceof LearningDataError) return reply.status(status(error)).send({ error: error.code, message: error.message }); throw error; }
  });
  app.get<{ Querystring: { projectId?: string } }>('/api/capabilities/network', { schema: { querystring: { type: 'object', properties: { projectId }, additionalProperties: false } } }, async (request, reply) => {
    try { return libraryCapabilityNetwork(library, request.query.projectId ? await snapshot(request.query.projectId) : undefined); }
    catch (error) { if (error instanceof LearningDataError) return reply.status(status(error)).send({ error: error.code, message: error.message }); throw error; }
  });
  app.get<{ Querystring: { id: string; version: number; revision: string } }>('/api/capabilities/resource', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['id', 'version', 'revision'], properties: {
      id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' }, version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      revision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
  } } }, async (request, reply) => {
    try {
      const generation = library.snapshot().generation;
      if (request.query.revision !== revisionFor(generation)) throw new LearningDataError('CONFLICT', 'Capabilities changed. Refresh before reading.');
      return await library.inspectUserResource({ id: request.query.id, version: request.query.version }, generation);
    } catch (error) { if (error instanceof LearningDataError) return reply.status(status(error)).send({ error: error.code, message: error.message }); throw error; }
  });
  app.put<{ Body: CapabilityResourceEdit }>('/api/capabilities/resource', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['id', 'version', 'expectedRevision', 'body'], properties: {
      id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' }, version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      expectedRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' }, body: { type: 'string', minLength: 1, maxLength: 20 * 1024 * 1024 }, projectId,
    },
  } } }, async (request, reply) => {
    try {
      const project = request.body.projectId ? await snapshot(request.body.projectId) : undefined;
      const generation = library.snapshot().generation;
      if (request.body.expectedRevision !== revisionFor(generation)) throw new LearningDataError('CONFLICT', 'Capabilities changed. Refresh before saving.');
      const resource = await library.editUserResource({ id: request.body.id, version: request.body.version }, request.body.body, generation);
      changed();
      return { resource: { id: resource.id, version: resource.version, title:resource.title??resource.name, body: request.body.body }, network: libraryCapabilityNetwork(library, project) };
    } catch (error) { if (error instanceof LearningDataError) return reply.status(status(error)).send({ error: error.code, message: error.message }); throw error; }
  });
  app.put<{ Body: Selection }>('/api/capabilities', { schema: { body: { type: 'object', additionalProperties: false, required: ['expectedRevision', 'key', 'enabled'],
    properties: { expectedRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' }, projectId, key: { type: 'string', minLength: 1, maxLength: 600 }, enabled: { type: 'boolean' } } } } }, async (request, reply) => {
    try {
      const project = request.body.projectId ? await snapshot(request.body.projectId) : undefined;
      await selectLibraryCapability(library, request.body); changed();
      return libraryCapabilities(library, project);
    } catch (error) { if (error instanceof LearningDataError) return reply.status(status(error)).send({ error: error.code, message: error.message }); throw error; }
  });
}
