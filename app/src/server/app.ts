import { DesktopUpdates, launchUpdate, UpdateError } from './desktop-updates.js';
import {maintenanceReferenceTools} from './maintenance-references.js';
import {archivedRefutation} from '../learning/research-data.js';
import { usesV3Proof } from '../research/versions/v3/proof-version.js';
import { inspectStageWindows } from '../research/versions/v4/stages.js';
import { getV4Coordinator } from '../research/versions/v4/coordinator.js';
import { createV0MemoryTools } from '../runtime/v0-memory-tools.js';
import { createV0Composition } from '../learning/v0-checkpoint.js';
import { createV21MemoryTools } from '../runtime/v21-memory-tools.js';
import { eventPayload } from './event-payload.js';
import { createV21Composition } from '../learning/v21-checkpoint.js';
import { pendingSynthesis } from '../research/versions/v2/synthesis-recovery.js';
import { completeArchivedProof } from '../research/versions/v2/completion.js';
import { applyPresentation } from '../presentation/session-presentation.js';
import { commandStateProjection } from '../research/user-commands.js';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { ResearchEngine } from '../engine/index.js';
import type { ResearchRole, UserCommand } from '../engine/types.js';
import type { Attribution } from '../research/contracts/v2.js';
import type { AnyAgentRuntime, AnyResearchEvent, AnyResearchProject } from '../research/contracts/loop.js';
import { ValidationError, createResearchProject, getResearchLoop, listResearchLoops, ResearchSelectionError, ResearchVersionError } from '../research/index.js';
import { runEvolutionReview, type EvolutionInput } from '../research/versions/v2/evolution.js';
import { trialSkill } from '../research/versions/v2/learning.js';
import { V1SkillError } from '../learning/v1-skills.js';
import { LearningService } from '../learning/learning-service.js';
import { archiveResearch } from '../learning/maintenance.js';
import type { LearningRuntime } from '../runtime/learning-task.js';
import { learningTools } from '../runtime/learning-tools.js';
import { researchMemoryTools } from '../runtime/research-memory-tools.js';
import { endedAttempts as endedV1Attempts } from '../research/versions/v1/engine.js';
import { endedAttempts as endedV2Attempts } from '../research/versions/v2/engine.js';
import { FileResearchStore, ConflictError, ProjectBusyError } from '../storage/index.js';
import { readStorageLocations, saveStorageLocations, type StorageLocations } from '../storage/storage-locations.js';
import { acquireWriterLease, releaseWriterLease } from '../storage/writer-lease.js';
import { pickStorageFolder } from './storage-picker.js';
import {resolveDataRoot} from '../storage/data-root.js';
import { isStorageAccessError } from '../storage/errors.js';
import { CAgERuntimeAdapter, RuntimeError, createCAgEResearchTools } from '../runtime/index.js';
import type { CAgEAuthManager } from '../runtime/auth.js';
import { createResearchTools } from '../tools/research-tools.js';
import { FileAccessError } from '../tools/files.js';
import { extractDocumentText } from '../tools/documents.js';
import { PluginHost, PluginError, type PluginGrant } from '../plugins/index.js';
import { readPreferences, writePreferences, parsePreferences, researchDefaults, applyPreferences } from './preferences.js';
import { registerLibraryCapabilityRoutes } from './library-capabilities.js';
import {registerKnowledgeMapRoutes,publicResearchTask} from './knowledge-map-routes.js';
import {MapError} from '../learning/knowledge-map.js';
import {admitMapMaintenance,startMapMaintenance,waitMapMaintenance,isMapMaintenanceRunning} from '../research/versions/v4/map-maintenance.js';
import {MapReader} from '../research/versions/v4/map-reader.js';
import {MapSources} from '../research/versions/v4/map-sources.js';
import type {TheoryRequestV4} from '../research/versions/v4/moderator.js';
import {stableHash} from '../learning/research-hash.js';
import type {MapView,MapOpenResult,MapRef} from '../learning/knowledge-map.js';
import { MaintenanceSession, MaintenanceConflict, type MaintenanceInput } from './maintenance-session.js';
import { maintenanceDiagnostics } from './maintenance-diagnostics.js';
import { maintenanceNodeTools } from '../learning/maintenance-node-tools.js';
import type { MaintenanceRequest } from '../runtime/maintenance.js';
import { MonitorActivity } from './monitor-activity.js';
import { SessionStates, type SessionState } from './session-state.js';

export interface ApplicationRuntime extends AnyAgentRuntime, Partial<LearningRuntime> { runMaintenance?(request:MaintenanceRequest):Promise<string>; auth: Pick<CAgEAuthManager, 'listProviders' | 'listModels' | 'saveApiKey' | 'startLogin' | 'getLogin' | 'answerLogin' | 'cancelLogin' | 'logout'>; invokeTheoryV4?(request:TheoryRequestV4):Promise<unknown>; hasForegroundInvocation?(): boolean; canQueueBackgroundLearning?(): boolean; shutdown(): Promise<void> }
export interface AppOptions {
  desktopVersion?: string;
  dataRoot?: string; sourceRoot?: string; staticRoot?: string;
  /** Deterministic tests may inject adapters; normal startup always constructs official Pi. */
  runtime?: ApplicationRuntime; store?: FileResearchStore; plugins?: PluginHost;
}
export interface ApplicationServices {
  store: FileResearchStore; runtime: ApplicationRuntime; engine: ResearchEngine; plugins: PluginHost; requestToken: string;
  activeProjectIds(): Promise<string[]>; shutdown(): Promise<void>;
  retryLearningOutput(id: string): Promise<unknown>;
}
export type CarnotApp = FastifyInstance & { carnot: ApplicationServices };
class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const identifier = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };
const archiveIdentifier = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,512}$' };
const idParams = { type: 'object', properties: { id: identifier }, required: ['id'], additionalProperties: false };
const sourceLimit = 20 * 1024 * 1024;
function decodeSourceBase64(value: string): Buffer {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const length = value.length / 4 * 3 - padding;
  if (length > sourceLimit) throw new ApiError(413, 'SOURCE_TOO_LARGE', 'Source files must be 20 MiB or smaller.');
  const end = value.length - padding;
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(value[end - 1] ?? '');
  // A flat alphabet scan avoids the regexp stack growth of repeated groups.
  if (value.length % 4 !== 0 || !end || /[^A-Za-z0-9+/]/.test(value.slice(0, end))
    || padding === 2 && last % 16 !== 0 || padding === 1 && last % 4 !== 0) {
    throw new ApiError(400, 'INVALID_SOURCE', 'Import a Markdown, text, or PDF file with valid base64 content.');
  }
  return Buffer.from(value, 'base64');
}
const body = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength: number, minLength = 1) => ({ type: 'string', minLength, maxLength });
const projectPath = '/api/projects/:id';
async function cleanupStages(stages: (() => unknown | Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const stage of stages) { try { await stage(); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, 'Application cleanup completed with preserved recovery errors.');
}

/** No sockets, provider requests, or model invocations occur merely by importing this module. */
export async function createApp(options: AppOptions = {}): Promise<CarnotApp> {
  const sourceRoot = options.sourceRoot ?? fileURLToPath(new URL('../../', import.meta.url));
  const anchor = await resolveDataRoot(options.dataRoot ?? options.store?.dataRoot, sourceRoot);
  const active = await readStorageLocations(anchor, sourceRoot);
  if (options.store && relative(options.store.dataRoot, active.research)) throw Error('Injected store uses a different research folder.');
  // The anchor owns settings and credentials even when the research store is elsewhere.
  const anchorLease = relative(anchor, active.research) ? await acquireWriterLease(anchor) : undefined;
  try {
    const app = await openWorkspace(options, sourceRoot, anchor, active);
    if (anchorLease) app.addHook('onClose', () => releaseWriterLease(anchor, anchorLease));
    return app;
  } catch (error) {
    if (anchorLease) await releaseWriterLease(anchor, anchorLease);
    throw error;
  }
}

async function openWorkspace(options: AppOptions, sourceRoot: string, anchor: string, active: StorageLocations): Promise<CarnotApp> {
  const dataRoot = active.research;
  let configured = active;
  let preferences = await readPreferences(anchor);
  const sessionStates = await SessionStates.open(dataRoot);
  const store = options.store ?? await FileResearchStore.open(dataRoot, { sourceRoot });
  let maintenance:Promise<MaintenanceSession>|undefined;
  const getMaintenance=()=>maintenance??=MaintenanceSession.open(dataRoot).catch(error=>{maintenance=undefined;throw error;});
  const closeMaintenance=async()=>{if(maintenance)await (await maintenance).close();};
  let learning: LearningService;
  let plugins: PluginHost;
  let runtime: ApplicationRuntime;
  const activity = new MonitorActivity();
  const knownProjectIds = new Set<string>();
  const projectNames = new Map<string, string>();
  const unavailableProjects = new Map<string, { id: string; name?: string; code: 'PROJECT_UNAVAILABLE'; message: string }>();
  const markUnavailable = async (id: string, error?: unknown) => {
    // A temporary process/disk limit does not establish damaged session data.
    if (isStorageAccessError(error)) throw error;
    // Shared-root outages are not evidence that this individual session is bad.
    // Recheck at every isolation boundary, including nested startup/summary catches.
    await readdir(join(store.dataRoot, 'projects'));
    unavailableProjects.set(id, { id, ...(projectNames.has(id) ? { name: projectNames.get(id)! } : {}), code: 'PROJECT_UNAVAILABLE',
      message: 'This session could not be safely loaded. Its saved files are preserved. Repair the saved data and restart CAgE to recheck it.' });
  };
  const availableProjects = async () => {
    // A failed project is quarantined until startup can fully reconcile it again.
    // Root directory/library errors still fail globally rather than appearing empty.
    const projects = await store.listProjects(markUnavailable);
    for (const project of projects) { knownProjectIds.add(project.id); projectNames.set(project.id, project.name); }
    return projects.filter(project => !unavailableProjects.has(project.id));
  };
  const archiveAvailable = async () => archiveResearch(store, await availableProjects(), learning.tasks(), {
    endedAttempts: project => project.schemaVersion === 1 ? endedV1Attempts(project) : project.schemaVersion === 2 ? endedV2Attempts(project) : [], onUnavailable: markUnavailable,
  });
  try {
    plugins = options.plugins ?? await PluginHost.open(dataRoot);
    runtime = options.runtime ?? await CAgERuntimeAdapter.create({ appDataDir: join(dataRoot, 'pi'), authRoot: join(anchor, 'pi'), recordsRoot: join(active.system, 'pi'), rawAnswers: store.rawAnswers, rawAnswersV0: store.rawAnswersV0,
      onProgress: progress => activity.observe(progress),
      resolveKnowledgeMap:async spec=>{
        const allowedRefs:MapRef[]=[];
        const savedRead=async(taskId:string)=>{
          try{return JSON.parse(await readFile(MapReader.path(dataRoot,spec.projectId,taskId),'utf8')) as {view:MapView;opened:MapOpenResult[]};}
          catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return undefined;}
        };
        if(spec.role!=='theorist'&&'brief' in spec.context){
          const parent=(spec.context.brief as {knowledgeMapParentSessionId?:string}).knowledgeMapParentSessionId;
          const existing=await savedRead(spec.id);
          if(existing){
            const grant=existing.view.grant;
            if(grant.ownerId!=='local-user'||grant.projectId!==spec.projectId||grant.taskId!==spec.id||grant.purpose!=='map-worker'||!Array.isArray(grant.allowedRefs))throw new RuntimeError('INVALID_CONFIGURATION');
            allowedRefs.push(...grant.allowedRefs);
          }else if(parent){
            const saved=await savedRead(parent);
            if(saved){
              const grant=saved.view.grant;
              if(grant.ownerId!=='local-user'||grant.projectId!==spec.projectId||grant.taskId!==parent||grant.purpose!=='map-proof')throw new RuntimeError('INVALID_CONFIGURATION');
              allowedRefs.push(...saved.opened.flatMap(open=>open.ref?[open.ref]:[]));
            }
          }
        }
        return new MapReader(store.library,{...(('brief' in spec.context?spec.context.brief:spec.context.snapshot).resultContract?{refutationEvidence:true}:{}),purpose:spec.role==='theorist'?'map-proof':'map-worker',ownerId:'local-user',projectId:spec.projectId,taskId:spec.id,profileId:'profile_'+stableHash(['local-user',spec.projectId]),...(spec.role==='theorist'?{}:{allowedRefs})},MapReader.path(dataRoot,spec.projectId,spec.id),('brief'in spec.context?spec.context.brief.knowledgeMapPresentation:spec.context.snapshot.knowledgeMapPresentation)??'legacy',('brief'in spec.context?spec.context.brief:spec.context.snapshot).modelDirectedKnowledge);
      },
      resolveCatalogV3:async spec=>{
        const bounds='brief'in spec.context?spec.context.brief:spec.context.snapshot;
        const directed=bounds.modelDirectedKnowledge;
        return {directedRoutes:(pin,query)=>store.library.readDirectedRoutes(pin.revision,query,refs=>mapSources.availableRouteTheories(refs),'brief' in spec.context?spec.context.brief.resources:undefined),network:(pin,query)=>store.library.queryMethodNetworkV3(pin,query),validateNetwork:(pin,selection)=>store.library.validateMethodNetworkSelectionV3(pin,selection,directed),query:(pin,query)=>store.library.queryCatalogV3(pin,query),node:(pin,id)=>store.library.readCatalogNodeV3(pin,id,directed),meta:(pin,ref)=>store.library.catalogMetaV3(pin,ref,directed),resource:(pin,ref)=>store.library.readCatalogResourceV3(pin,ref,{role:'theorist',sessionId:spec.projectId,loopVersion:2},directed)};
      },
      resolveLearningTools: async call => learningTools(learning, call),
      validateLearningCall: async (call,readResources,navigationDelivery) => {if(call.promptRevision==='compact-english-v14')return learning.validateLearningCall(call,readResources,navigationDelivery);},
      resolveInherited: projectId => store.readInherited(projectId),
      learningFallbackModels: () => preferences.learningFallbackModels ?? [],
      resolveTools: async (spec, workspaceRoot) => {
        if ('contractVersion' in spec && spec.contractVersion === 'v0-test-1') return createV0MemoryTools(spec, store.library);
        if ('contractVersion' in spec && spec.contractVersion === '2.1') {
          const sources = 'brief' in spec.context ? spec.context.brief.sources.map(source => source.ref) : spec.context.snapshot.sources.map(source => source.ref);
          const gateway = await createResearchTools({ workspaceRoot, sources, readSource: ref => store.readSource(spec.projectId, ref) });
          return [...createCAgEResearchTools(gateway), ...createV21MemoryTools(spec, store.rawAnswers, store.library), ...plugins.toolsFor(spec.projectId, spec.role)];
        }
        const sources = 'brief' in spec.context ? spec.context.brief.frozenSourceRefs : 'snapshot' in spec.context ? spec.context.snapshot.sources : spec.context.project.sources;
        const gateway = await createResearchTools({ workspaceRoot, sources, readSource: ref => store.readSource(spec.projectId, ref) });
        return [...createCAgEResearchTools(gateway), ...researchMemoryTools(spec, store.library, spec.role === 'theorist' ? await store.readInherited(spec.projectId) : undefined), ...plugins.toolsFor(spec.projectId, spec.role)];
      },
    });
  } catch (error) { if (!options.store) await store.close(); throw error; }
  try { learning = await LearningService.open({ directory: join(dataRoot, 'learning'), library: store.library, runtime,
    moderatorModel: () => preferences.defaultModel, networkReviewConfig: () => researchDefaults(preferences)['3.0'], foregroundBusy: () => (runtime.hasForegroundInvocation?.() ?? false) && !(runtime.canQueueBackgroundLearning?.() ?? false) }); }
  catch (error) { plugins.close(); await runtime.shutdown().catch(() => {}); if (!options.store) await store.close(); throw error; }
  const mapSources=new MapSources(store,createV21Composition(store,learning));
  store.library.configureKnowledgeMapSources({valid:source=>mapSources.valid(source),theoryBody:ref=>mapSources.theoryBody(ref)});
  const engine = new ResearchEngine(store, runtime, undefined, { v0: createV0Composition(store, learning), v21: createV21Composition(store, learning), strategyProviders: projectId => plugins.strategiesFor(projectId),
    readBoundary: async query => ({ ...store.library.readBoundary(query), proofs: await store.library.readProofOutlines(query.sessionId), inspectedAttempts: store.library.snapshot().inspectedAttempts[query.sessionId] ?? {} }),
    readInherited: projectId => store.readInherited(projectId),
    readResource: (ref, query) => store.library.readResource(ref, { role: 'theorist', sessionId: query.sessionId, loopVersion: query.loopVersion }),
    isProofValid: ref => store.library.isProofValid(ref),
    afterCheckpoint: async input => {
      try { await learning.checkpoint(input); } catch (error) { if (!learning.proofReceipt(input.receipt.id)) throw error; }
      const ref = learning.proofReceipt(input.receipt.id);
      await archiveAvailable();
      return ref;
    },
  });
  try {
    // Recovery only reconciles committed state and orphan markers. It never starts a round.
    for (const saved of await availableProjects()) {
      try {
      const project = await engine.reconcile(saved.id);
      if (project.schemaVersion === 4 || project.schemaVersion === 3) continue; // V2.1 reconciles its own immutable answer/archive receipts, never legacy Worker results.
      const attempts = project.schemaVersion === 1 ? endedV1Attempts(project) : endedV2Attempts(project);
      let publicationChanged = false;
      for (const record of project.schemaVersion === 1 ? project.rounds : project.epochs) if (record.research) {
        const receipt = record.research;
        try { await learning.checkpoint({ project, receipt, endedAttempts: attempts.filter(attempt => receipt.attempts.some(ref => ref.id === attempt.id && ref.version === attempt.version)) }); }
        catch { /* Persist the pending submission below; do not prevent access to recoverable research. */ }
        const ref = learning.proofReceipt(receipt.id);
        if (receipt.review?.proof) { const status = ref ? { status: 'saved' as const, ref } : receipt.proofArchive?.status === 'saved' ? receipt.proofArchive : { status: 'pending' as const }; if (JSON.stringify(status) !== JSON.stringify(receipt.proofArchive)) { receipt.proofArchive = status; publicationChanged = true; } }
      }
      if (project.schemaVersion === 2 && !await store.loadInFlight(project.id) && completeArchivedProof(project,ref=>store.library.isProofValid(ref))) publicationChanged = true;
      if (publicationChanged) await store.commitCheckpoint(project);
      } catch (error) { await markUnavailable(saved.id, error); }
    }
    await archiveAvailable();
  } catch (error) {
    await learning.close().catch(() => {}); plugins.close(); await runtime.shutdown().catch(() => {}); await store.close().catch(() => {}); throw error;
  }
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: 512 }, bodyLimit: 30 * 1024 * 1024, ajv: { customOptions: { removeAdditional: false } } }) as unknown as CarnotApp;
  const updates = options.desktopVersion ? new DesktopUpdates(options.desktopVersion, join(active.system, 'desktop-updates')) : undefined;
  const requestToken = randomBytes(32).toString('base64url');
  const streams = new Set<ServerResponse>();
  const jobs = new Map<string, Promise<void>>();
  const mutations = new Map<string, Promise<unknown>>();
  const mapControllers=new Map<string,AbortController>();
  const mapAdmissionErrors=new Map<string,string>();
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  const activeProjectIds = async () => [...new Set([...knownProjectIds, ...jobs.keys()])].filter(id => jobs.has(id) || engine.isActive(id));
  const publish = (event: AnyResearchEvent | { type: 'settings.changed' }) => {
    const payload = eventPayload(event);
    if (payload.type !== 'settings.changed') plugins.publish(payload);
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const response of streams) { if (response.destroyed || response.writableEnded) { streams.delete(response); continue; } if (!response.write(message)) response.end(); }
  };
  const unsubscribe = engine.subscribe(publish);
  const reportLedger=getV4Coordinator(dataRoot);
  const unsubscribeReportWake=reportLedger.onReportWake(async scope=>{
    if(!stopping&&sessionStates.get(scope.projectId)!=='deleted')await engine.wakeReport(scope);
  });
  const drainMutations = () => Promise.allSettled([...mutations.values()]);
  const closeMapMaintenance=async()=>{
    for(const controller of mapControllers.values())controller.abort();
    await Promise.allSettled([...mapControllers.keys()].map(id=>waitMapMaintenance(dataRoot,id)));
  };
  const release = () => cleanup ??= (async () => {
    stopping = true;
    unsubscribeReportWake();
    await cleanupStages([closeMaintenance, drainMutations, () => engine.shutdown(), closeMapMaintenance, () => Promise.allSettled([...jobs.values()]),
      () => learning.close(), unsubscribe, () => plugins.close(), () => runtime.shutdown(), () => store.close()]);
  })();
  app.decorate('carnot', { store, runtime, engine, plugins, requestToken, activeProjectIds,
    retryLearningOutput: id => learning.retryFailedOutput(id),
    shutdown: () => shutdown ??= (async () => {
      stopping = true;
      await cleanupStages([closeMaintenance, drainMutations, () => engine.shutdown(), closeMapMaintenance, () => Promise.allSettled([...jobs.values()]), () => app.close()]);
    })(),
  } satisfies ApplicationServices);
  app.addHook('preClose', async () => { stopping = true; await closeMaintenance(); for (const response of streams) response.end(); streams.clear(); });
  app.addHook('onClose', release);
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode < 300 && request.method !== 'GET' && /^\/api\/(preferences|providers)(\/|$)/.test(request.url)) publish({ type: 'settings.changed' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const host = request.headers.host;
    if (!host || !/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)) throw new ApiError(403, 'LOCAL_ONLY', 'Only the local CAgE address is allowed.');
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) throw new ApiError(403, 'ORIGIN_DENIED', 'Open CAgE in its own local browser page.');
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'ORIGIN_DENIED', 'Cross-site requests are not allowed.');
    const route = request.routeOptions.url ?? request.url.split('?')[0];
    if (!['GET', 'HEAD'].includes(request.method) && /\/evolution(?:\/|$)/.test(route)) throw new ApiError(410, 'AUTOMATIC_LEARNING', 'Learning now follows the research loop automatically. Historical review endpoints are read-only.');
    if (route?.startsWith('/api/') && route !== '/api/bootstrap') {
      const token = request.headers['x-carnot-token'];
      if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(requestToken) || !timingSafeEqual(Buffer.from(token), Buffer.from(requestToken))) throw new ApiError(403, 'TOKEN_REQUIRED', 'Reload the CAgE page to establish the local session.');
    }
    if (stopping && !['GET', 'HEAD'].includes(request.method)) throw new ApiError(409, 'SHUTTING_DOWN', 'CAgE is saving active research and shutting down.');
    if (route?.startsWith(projectPath)) {
      const id = (request.params as { id: string }).id;
      if (sessionStates.get(id) === 'deleted' && route !== `${projectPath}/session-state`) throw new ApiError(410, 'SESSION_DELETED', 'This session was deleted.');
      if (!unavailableProjects.has(id) && knownProjectIds.has(id)) {
        try { await Promise.all([store.listCommands(id), store.loadInFlight(id)]); }
        catch (error) { await markUnavailable(id, error); }
      }
      const unavailable = unavailableProjects.get(id);
      if (unavailable) throw new ApiError(409, unavailable.code, unavailable.message);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const safe = publicError(error);
    void reply.status(safe.status).send({ error: safe.code, message: safe.message });
  });
  const providerViews = async () => (await runtime.auth.listProviders()).map(provider => ({ id: provider.id, name: provider.name, configured: provider.connected, oauthSupported: provider.oauth, apiKeySupported: provider.apiKey }));
  const assertRoleModels = async (project: AnyResearchProject, roles: readonly ResearchRole[]) => {
    if (!roles.length) return;
    const providers = await providerViews(); const models = runtime.auth.listModels();
    for (const role of roles) {
      const model = project.config.roleModels?.[role] ?? project.config.defaultModel;
      if (!model) throw new RuntimeError('MODEL_REQUIRED');
      if (!models.some(item => item.id === model.modelId && item.provider === model.provider)) throw new RuntimeError('MODEL_UNAVAILABLE');
      if (!providers.some(item => item.id === model.provider && item.configured)) throw new RuntimeError('AUTH_REQUIRED');
    }
  };
  const snapshot = async (id: string) => {
    const unavailable = unavailableProjects.get(id);
    if (unavailable) throw new ApiError(409, unavailable.code, unavailable.message);
    let current: AnyResearchProject;
    try {
      current = { ...await engine.getSnapshot(id) };
      await store.listCommands(id);
    } catch (error) {
      if (!knownProjectIds.has(id)) throw error;
      await markUnavailable(id, error);
      throw new ApiError(409, 'PROJECT_UNAVAILABLE', unavailableProjects.get(id)!.message);
    }
    // Legacy untitled sessions can use the existing Theorist topic without a
    // model call or storage migration. Explicit user names remain authoritative.
    const topic = current.schemaVersion === 4 ? current.epochs[0]?.selection?.candidates[0]?.direction : current.schemaVersion === 3 ? current.ways[0]?.direction : current.schemaVersion === 2 ? current.epochs[0]?.tasks[0]?.way.question || current.epochs.at(-1)?.snapshot.routingStrategy?.domains.slice(0, 2).map(domain => domain.label).join(' · ') : current.graph.find(node => node.parentId)?.question;
    applyPresentation(current, undefined, topic);
    return current;
  };
  const summaries = async () => (await Promise.all((await availableProjects()).filter(project => sessionStates.get(project.id) !== 'deleted').map(async project => {
    try {
      const current = await snapshot(project.id);
      return { id: current.id, name: current.name, status: current.status, group:sessionStates.group(current.id), archived: sessionStates.get(current.id) === 'archived', schemaVersion: current.schemaVersion, researchLoopVersion: current.researchLoopVersion, ...(current.fork ? { fork: { parentSessionId: current.fork.parent.sessionId, checkpointId: current.fork.parent.checkpointId, number: current.fork.parent.number } } : {}), ...(current.schemaVersion === 4 ? { epoch: current.epoch } : current.schemaVersion === 3 ? { epoch: current.epoch } : current.schemaVersion === 2 ? { epoch: current.epoch } : { round: current.round }) };
    } catch (error) { await markUnavailable(project.id, error); return undefined; }
  }))).filter(project => project !== undefined);
  const notifyProject = (project: AnyResearchProject) => {
    knownProjectIds.add(project.id);
    projectNames.set(project.id, project.name);
    publish(project.schemaVersion === 4
      ? { type: 'project.updated', projectId: project.id, epoch: project.epoch, phase: project.phase, contractVersion: 'v0-test-1' }
      : project.schemaVersion === 3
      ? { type: 'project.updated', projectId: project.id, epoch: project.epoch, phase: project.phase, contractVersion: '2.1' }
      : project.schemaVersion === 2
      ? { type: 'project.updated', projectId: project.id, epoch: project.epoch, phase: project.phase, contractVersion: '2' }
      : { type: 'project.updated', projectId: project.id, round: project.round, stage: project.stage });
  };
  const serial = async <T>(id: string, work: () => Promise<T>, allowDeleted = false): Promise<T> => {
    const projectId = id.startsWith('commands:') ? id.slice('commands:'.length) : id;
    const previous = mutations.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => {
      if (stopping) throw new ApiError(409, 'SHUTTING_DOWN', 'CAgE is saving active research and shutting down.');
      if (!allowDeleted && sessionStates.get(projectId) === 'deleted') throw new ApiError(410, 'SESSION_DELETED', 'This session was deleted.');
      return work();
    }); mutations.set(id, operation);
    try { return await operation; } finally { if (mutations.get(id) === operation) mutations.delete(id); }
  };
  const requireIdle = (id: string) => { if (jobs.has(id) || engine.isActive(id)) throw new ProjectBusyError(); };

  app.get('/api/maintenance/session',async()=>(await getMaintenance()).history());
  app.post<{Body:{requestId:string}}>('/api/maintenance/session/stop',{schema:{body:body({requestId:identifier})}},async request=>{
    const session=await getMaintenance();session.stop(request.body.requestId);return session.history();
  });
  app.post<{Body:MaintenanceInput}>('/api/maintenance/session/turns',{schema:{body:body({
    requestId:identifier,projectId:identifier,message:string(32000),note:body({name:string(255),text:string(200000)},['name','text']),allowChanges:{type:'boolean'}
  },['requestId','message','allowChanges'])}},async(request,reply)=>{
    const input=request.body, id=input.projectId, session=await getMaintenance();
    if(!input.message.trim())throw new ApiError(400,'EMPTY_MESSAGE','Enter a maintenance request.');
    if(id&&(!knownProjectIds.has(id)||sessionStates.get(id)==='deleted'))throw new ApiError(404,'PROJECT_NOT_FOUND','Select an available project.');
    const project=id?await snapshot(id):undefined;
    const model=preferences.maintenanceModel??preferences.defaultModel??project?.config.defaultModel;
    if(!model)throw new RuntimeError('MODEL_REQUIRED');
    if(!runtime.runMaintenance)throw new ApiError(503,'MAINTENANCE_UNAVAILABLE','Maintenance is unavailable on this runtime.');
    const tools=[...maintenanceReferenceTools(key=>session.readNote(id,key)),...(id?[maintenanceDiagnostics(()=>snapshot(id),learning,store.library,dataRoot)]:[]),...maintenanceNodeTools(store.library,id)
      .filter(t=>input.allowChanges||['maintenance_list_nodes','maintenance_read_node'].includes(t.name))]
      .map(t=>({...t,execute:(...args:Parameters<typeof t.execute>)=>serial(id??'maintenance:shared',()=>t.execute(...args))}));
    try{
      await serial('maintenance:session',()=>session.start(input,{model,tools},r=>runtime.runMaintenance!(r),e=>publicError(e).message));
    }catch(error){if(error instanceof MaintenanceConflict)throw new ApiError(409,'MAINTENANCE_BUSY',error.message);throw error;}
    return reply.code(202).send(session.history());
  });
  registerLibraryCapabilityRoutes(app, store.library, snapshot, () => publish({ type: 'settings.changed' }), learning);
  const pumpKnowledgeMap=async(projectId:string)=>{
    if(stopping)throw new ApiError(409,'SHUTTING_DOWN','Knowledge maintenance is shutting down.');
    const project=await snapshot(projectId);
    if(project.schemaVersion!==3||project.researchLoopVersion!=='4.0')throw new ApiError(403,'V4_REQUIRED','Knowledge-map maintenance requires a V4 project.');
    const stopped=project.status==='stopped'||(await store.listCommands(projectId)).some(c=>c.kind==='stop'&&!project.processedCommandIds.includes(c.id));
    if(stopped)throw new ApiError(409,'PROJECT_STOPPED','Resume the project before admitting new knowledge maintenance.');
    const model=project.config.roleModels?.moderator??project.config.defaultModel;
    if(!model)throw new RuntimeError('MODEL_REQUIRED');
    await assertRoleModels(project,['moderator']);
    await mapSources.reconcile(projectId);
    await admitMapMaintenance({dataRoot,library:store.library,ownerId:'local-user',projectId,model,budget:project.config.roleBudget});
    let controller=mapControllers.get(projectId);
    if(!controller||controller.signal.aborted){controller=new AbortController();mapControllers.set(projectId,controller);}
    mapAdmissionErrors.delete(projectId);
    startMapMaintenance({dataRoot,library:store.library,runtime,projectId,signal:controller.signal,onError:error=>{mapAdmissionErrors.set(projectId,publicError(error).message);}});
  };
  app.get<{Params:{id:string}}>(`${projectPath}/v4/domain-requests`,{schema:{params:idParams}},async request=>{
    const project=await snapshot(request.params.id);
    if(project.schemaVersion!==3||project.researchLoopVersion!=='4.0')throw new ApiError(403,'V4_REQUIRED','Select a V4 project.');
    const coordinator=getV4Coordinator(dataRoot);
    const allTasks=await coordinator.mapTasks(project.id);
    const tasks=allTasks.filter(t=>t.domainRequest);
    const origins=await mapSources.domainOrigins(project,tasks);
    const accepted=tasks.some(t=>t.domainRequest?.premises?.length)?await store.library.knowledgeMap.acceptedFoundationBodies({purpose:'map-user',ownerId:'local-user',projectId:project.id}):new Set<string>();
    return {requests:tasks.map(t=>{
      const origin=origins.get(t.id);
      return {taskId:t.id,...t.domainRequest,premises:t.domainRequest?.premises?.map(p=>({...p,accepted:accepted.has(stableHash(p.statement))})),status:t.status,revisionStatus:allTasks.find(child=>child.id===t.domainRequest?.revisionTaskId)?.status,question:origin?.question??t.alternateRoute?.question,epochIds:origin?.epochIds,alternative:t.alternateRoute?.result};
    })};
  });
  registerKnowledgeMapRoutes(app,{library:store.library,loadProject:snapshot,
    acceptPremise:async(actor,statement,origin)=>{
      let guard:(()=>void)|undefined;
      if(origin.kind==='archive'){
        guard=()=>{
          const update=store.library.reportUpdates(actor.projectId).findLast(row=>row.id===origin.updateId);
          const current=update&&store.library.reportAssessment(actor.projectId,update.artifactId);
          if(!current||current.id!==origin.updateId||current.revision!==origin.revision||current.status!=='conditional'||current.condition!==statement)throw new MapError('CONFLICT','This archive no longer has the selected condition.');
        };
      }else{
        const task=(await getV4Coordinator(dataRoot).mapTasks(actor.projectId)).find(t=>t.id===origin.taskId);
        const proposal=task?.domainRequest;
        if(!proposal||proposal.proposalHash!==origin.proposalHash||!proposal.premises?.some(p=>p.field===origin.field&&p.statement===statement))throw new MapError('CONFLICT','Select the exact premise in this field proposal.');
      }
      return store.library.knowledgeMap.acceptReviewedPremise(statement,JSON.stringify(origin),actor,guard);
    },
    domainDecision:async(id,taskId,hash,decision,acceptedFields)=>{
      const project=await snapshot(id),coordinator=getV4Coordinator(dataRoot);
      if(project.schemaVersion!==3||project.researchLoopVersion!=='4.0')throw new MapError('FORBIDDEN','Select a V4 project.');
      const task=(await coordinator.mapTasks(id)).find(t=>t.id===taskId);
      if(!task)throw new MapError('NOT_FOUND','Requested proposal does not belong to this project.');
      const partial=acceptedFields&&task.domainRequest?.fields.some(field=>!acceptedFields.includes(field));
      const alternate=decision==='decline'||partial?(await mapSources.domainOrigins(project,[task])).get(task.id):undefined;
      return coordinator.resolveMapDomainDecision(id,taskId,hash,decision,alternate,acceptedFields);
    },
    backfill:(id,keys)=>mapSources.backfill(id,keys),
    retry:(id,taskId)=>getV4Coordinator(dataRoot).retryMapTask(id,taskId),
    pump:async id=>{try{await pumpKnowledgeMap(id);}catch(error){mapAdmissionErrors.set(id,publicError(error).message);throw error;}},
    tasks:async id=>[...await getV4Coordinator(dataRoot).mapTasks(id),...(mapAdmissionErrors.has(id)?[{id:'map-admission:'+id,phase:'admission',status:'failed',error:mapAdmissionErrors.get(id)}]:[])],
  });
  app.get<{ Querystring: { projectId?: string } }>('/api/learning', async request => ({ tasks: learning.tasks(request.query.projectId) }));
  app.post<{Params:{id:string};Body:{studyId:string;requestId:string}}>(`${projectPath}/v4/research/retry`,{schema:{params:idParams,body:body({studyId:identifier,requestId:identifier})}},request=>serial(request.params.id,async()=>{
    const id=request.params.id;const project=await snapshot(id);
    if(project.researchLoopVersion!=='4.0')throw new ApiError(403,'RESEARCH_SCOPE','Research retry requires this V4 project.');
    const coordinator=getV4Coordinator(dataRoot),study=(await coordinator.researchReports()).find(s=>s.id===request.body.studyId&&s.report.scope.projectId===id);
    if(!study)throw new ApiError(404,'RESEARCH_NOT_FOUND','Research study not found in this project.');
    const stoppedEpoch=project.schemaVersion===3&&(project.epochs.some(epoch=>epoch.snapshot.id===study.report.scope.epochId&&epoch.decision==='stop')||project.activeEpoch?.snapshot.id===study.report.scope.epochId&&project.activeEpoch.optionalFlow?.phase==='stopped');
    const pendingStop=project.schemaVersion===3&&(await store.listCommands(id)).some(command=>command.kind==='stop'&&!project.processedCommandIds.includes(command.id));
    if(project.status==='stopped'||stoppedEpoch||pendingStop)throw new ApiError(409,'RESEARCH_STOPPED','Research retry cannot resume an explicitly stopped project or proof boundary.');
    if(!await mapSources.authorizeReport(study.report,study.archiveReview))throw new ApiError(409,'RESEARCH_SOURCE_UNAVAILABLE','The exact research source is no longer authorized.');
    let task;try{task=await coordinator.retryReport(id,study.id,request.body.requestId);}catch(error){if(error instanceof MapError)throw new ApiError(error.code==='NOT_FOUND'?404:409,error.code,error.message);throw error;}
    try{await reportLedger.wakeReport(study.report.scope);return {task:publicResearchTask(task),admission:'scheduled'};}catch{return {task:publicResearchTask(task),admission:'deferred',message:'Retry saved; background reconciliation remains pending.'};}
  }));
  learning.wake();

  app.post('/api/workspace/pick-folder', async () => {
    try { return { path: await pickStorageFolder() }; }
    catch { throw new ApiError(400, 'PICKER_UNAVAILABLE', 'The folder picker could not open. Enter the folder path directly.'); }
  });
  app.put<{ Body: StorageLocations }>('/api/workspace/storage', { schema: { body: body({ system: string(32767), research: string(32767) }) } }, request => serial('workspace-storage', async () => {
    try { configured = await saveStorageLocations(anchor, request.body, sourceRoot); }
    catch { throw new ApiError(400, 'INVALID_STORAGE', 'Choose writable folders with absolute paths outside the application source, or use its default data folder.'); }
    publish({ type: 'settings.changed' });
    return { active, configured };
  }));
  app.post('/api/workspace/open-storage', async (_request, reply) => {
    const { spawn } = await import('node:child_process');
    const launcher = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    await new Promise<void>((resolveLaunch, reject) => {
      const child = spawn(launcher, [resolve(dataRoot)], { stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolveLaunch(); });
    });
    return reply.code(204).send();
  });
  app.get('/api/bootstrap', async () => {
    const providers = await providerViews();
    const connected = new Set(providers.filter(provider => provider.configured).map(provider => provider.id));
    const projects = await summaries();
    return { requestToken, storage: { active, configured }, projects, unavailableProjects: [...unavailableProjects.values()].filter(project => sessionStates.get(project.id) !== 'deleted'), models: runtime.auth.listModels().filter(model => connected.has(model.provider)), providers, preferences, researchDefaults: researchDefaults(preferences), activeProjectIds: await activeProjectIds() };
  });
  app.put<{ Body: unknown }>('/api/preferences', { schema: { body: body({ defaultModel: { type: 'object' }, maintenanceModel:{type:'object'}, researchDefaults: { type: 'object' }, learningFallbackModels: { type: 'array', items: { type: 'object' } } }, []) } }, request => serial('app-preferences', async () => {
    const next = parsePreferences(request.body);
    for (const model of [...(next.defaultModel ? [next.defaultModel] : []), ...(next.maintenanceModel?[next.maintenanceModel]:[]), ...(next.learningFallbackModels ?? [])]) {
      if (!(await providerViews()).some(provider => provider.id === model.provider && provider.configured)) throw new RuntimeError('AUTH_REQUIRED');
      if (!runtime.auth.listModels(model.provider).some(item => item.id === model.modelId)) throw new RuntimeError('MODEL_UNAVAILABLE');
    }
    await writePreferences(anchor, next); preferences = next; return preferences;
  }));
  app.get('/api/projects', summaries);
  app.put<{Params:{id:string};Body:{group:string}}>(`${projectPath}/group`, {schema:{params:idParams,body:body({group:{type:'string',maxLength:80}})}},async(request,reply)=>{
    const id=request.params.id;
    if(!knownProjectIds.has(id))throw new ApiError(404,'PROJECT_NOT_FOUND','Session unavailable.');
    await serial('app/session-state',()=>sessionStates.move(id,request.body.group.trim()));
    publish({type:'settings.changed'});
    return reply.code(204).send();
  });
  app.put<{ Params: { id: string }; Body: { state: SessionState } }>(`${projectPath}/session-state`, { schema: { params: idParams, body: body({ state: { type: 'string', enum: ['active', 'archived', 'deleted'] } }) } }, request => serial(request.params.id, async () => {
    const { id } = request.params, { state } = request.body;
    const updateState = async () => {
    if (sessionStates.get(id) === 'deleted') {
      if (state === 'deleted') return { state };
      throw new ApiError(410, 'SESSION_DELETED', 'This session was deleted.');
    }
    await snapshot(id);
    if (state === 'deleted') requireIdle(id);
    await serial('app/session-state', () => sessionStates.set(id, state));
    publish({ type: 'settings.changed' });
    return { state };
    };
    // Drain the independently queued command writes before publishing a tombstone.
    return state === 'deleted' ? serial(`commands:${id}`, updateState, true) : updateState();
  }, true));
  app.get('/api/research-loops', async () => listResearchLoops());
  app.post<{ Body: { name: string; hypothesis: string; researchLoopVersion?: string; requestId?: string } }>('/api/projects', { schema: { body: body({ name: string(200), hypothesis: string(1_000_000), researchLoopVersion: string(100), requestId: identifier }, ['name', 'hypothesis']) } }, async (request, reply) => {
    // Validate the normal creation contract before resolving a retry identity.
    const created = createResearchProject({ id: randomUUID(), name: request.body.name.trim(), hypothesis: request.body.hypothesis, researchLoopVersion: request.body.researchLoopVersion });
    const { requestId, name, hypothesis, researchLoopVersion } = request.body;
    // Bind every submitted field. A changed payload is a distinct creation,
    // while retries survive restart without a new journal or scientific field.
    if (requestId) created.id = `project_${createHash('sha256').update(JSON.stringify(['create-v1', requestId, name, hypothesis, researchLoopVersion ?? null])).digest('hex')}`;
    return serial(created.id, async () => {
      if (requestId) {
        const location = knownProjectIds.has(created.id) ? undefined : await lstat(join(store.dataRoot, 'projects', created.id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined; });
        if (knownProjectIds.has(created.id) || location) {
          if (sessionStates.get(created.id) === 'deleted') throw new ApiError(410, 'SESSION_DELETED', 'This creation request belongs to a deleted session. Start a new session instead.');
          if (location && !location.isDirectory()) throw new ApiError(409, 'PROJECT_CREATE_CONFLICT', 'This creation request has an existing local entry. No data was replaced.');
          // An incomplete/corrupt directory must fail closed, never be recreated.
          const existing = await snapshot(created.id); notifyProject(existing); return reply.status(200).send(existing);
        }
      }
      if (created.name !== 'New research') created.nameSource = 'user';
      applyPreferences(created, preferences);
      const project = await store.createProject(created);
      notifyProject(project); return reply.status(201).send(project);
    });
  });
  app.post<{ Params: { id: string }; Body: { checkpointId: string; expectedRevision: string; operationId: string } }>(`${projectPath}/fork`, { schema: { params: idParams, body: body({ checkpointId: identifier, expectedRevision: {type:'string',pattern:'^[0-9a-f]{40}$'}, operationId: identifier }) } }, request => serial(request.params.id, async () => {
    let child = await store.createFork(request.params.id, request.body, () => requireIdle(request.params.id));
    if (unavailableProjects.has(child.id)) {
      // An explicit publication retry can repair its own incomplete child.
      // Clear only after full validation; ordinary notifications cannot unquarantine.
      requireIdle(child.id);
      await store.listCommands(child.id);
      child = await engine.reconcile(child.id);
      await store.readInherited(child.id);
      unavailableProjects.delete(child.id);
    }
    notifyProject(child); return child;
  }));
  app.get<{ Params: { id: string } }>(`${projectPath}/inherited`, { schema: { params: idParams } }, async request => await store.readInherited(request.params.id) ?? null);
  app.put<{ Params: { id: string }; Body: { name: string; expectedRevision: string } }>(`${projectPath}/name`, { schema: { params: idParams, body: body({ name: string(160), expectedRevision: string(100) }) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const project = await snapshot(request.params.id);
    if (project.contentRevision !== request.body.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload the session before renaming.');
    if (!request.body.name.trim()) throw new ApiError(400, 'INVALID_NAME', 'A session title is required.');
    project.name = request.body.name.trim(); project.nameSource = 'user';
    const updated = await store.commitCheckpoint(project); notifyProject(updated); return updated;
  }));
  app.get<{ Params: { id: string } }>(projectPath, { schema: { params: idParams } }, request => snapshot(request.params.id));
  app.get<{ Params: { id: string } }>(`${projectPath}/v4/stage-windows`, { schema: { params: idParams } }, async request => {
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 3 || !usesV3Proof(project.researchLoopVersion)) {
      throw new ApiError(409, 'V3_PROJECT_REQUIRED', 'Stage-window inspection requires a V3 or V4 project.');
    }
    return { epochs: inspectStageWindows(project) };
  });
  app.get<{Params:{id:string}}>(`${projectPath}/v4/trials`, {schema:{params:idParams}}, async request=>{
    const project=await snapshot(request.params.id);
    if(project.schemaVersion!==3 || project.researchLoopVersion!=='4.0') throw new ApiError(409,'V4_PROJECT_REQUIRED','Theory trials require a V4 project.');
    const epochs=new Map(project.epochs.map(e=>[e.snapshot.id,e.snapshot.root.revision]));
    if(project.activeEpoch)epochs.set(project.activeEpoch.snapshot.id,project.activeEpoch.snapshot.root.revision);
    const coordinator=getV4Coordinator(store.dataRoot);
    const trials=[];
    for(const [epochId,rootId] of epochs){const snapshot=await coordinator.snapshot({projectId:project.id,epochId,rootId});trials.push({epochId,...snapshot,postReports:snapshot.postReports.map(publicResearchTask)});}
    return {epochs:trials};
  });
  app.post<{Params:{id:string}; Body:{epochId:string;taskId:string;operatorNote:string}}>(
    `${projectPath}/v4/settle-uncertain`, {schema:{params:idParams,body:body({epochId:string(1024),taskId:string(128),operatorNote:string(2048)})}},
    async request=>serial(request.params.id,async()=>{
      const project=await snapshot(request.params.id);
      if(project.schemaVersion!==3 || project.researchLoopVersion!=='4.0') throw new ApiError(409,'V4_PROJECT_REQUIRED','Theory trials require a V4 project.');
      requireIdle(project.id);
      const epoch=[project.activeEpoch,...project.epochs].find(e=>e?.snapshot.id===request.body.epochId);
      if(!epoch)throw new ApiError(404,'EPOCH_NOT_FOUND','Unknown theory boundary.');
      const scope={projectId:project.id,epochId:epoch.snapshot.id,rootId:epoch.snapshot.root.revision};
      const coordinator=getV4Coordinator(store.dataRoot);
      const trial=(await coordinator.snapshot(scope)).tasks.find(t=>t.id===request.body.taskId);
      if(!trial)throw new ApiError(404,'TRIAL_NOT_FOUND','Unknown theory trial.');
      if(!['uncertain','settled'].includes(trial.status)&&!trial.unresolvedSend)throw new ApiError(409,'TRIAL_NOT_UNCERTAIN','The trial has no unresolved send.');
      if(!request.body.operatorNote.trim()||Buffer.byteLength(request.body.operatorNote)>2048)
        throw new ApiError(400,'INVALID_SETTLEMENT_NOTE','Supply a nonempty settlement note of at most 2048 UTF-8 bytes.');
      return {status:await coordinator.resolveUncertain(scope,request.body.taskId,{operatorNote:request.body.operatorNote})};
    }));
  app.get<{Params:{id:string}}>(`${projectPath}/v4/report-updates`,{schema:{params:idParams}},async request=>{
    const project=await snapshot(request.params.id);
    if(project.researchLoopVersion!=='4.0')throw new ApiError(409,'V4_PROJECT_REQUIRED','Archive updates require a V4 project.');
    const updates=store.library.reportUpdates(project.id);
    const accepted=updates.some(u=>u.status==='conditional')?await store.library.knowledgeMap.acceptedFoundationBodies({purpose:'map-user',ownerId:'local-user',projectId:project.id}):new Set<string>();
    const referrals:{id:string;origin:string;epochId?:string}[]=await reportLedger.finishedMaintenanceReferrals(project.id);
    for(const task of learning.tasks(project.id)){
      if('maintenanceReferral' in task&&task.maintenanceReferral&&['completed','no-change','failed','paused'].includes(task.status))referrals.push({id:task.id,origin:'Method learning'});
    }
    if(project.schemaVersion===3)for(const epoch of project.epochs){
      if(epoch.calls.some(c=>c.systemChangeSkipped))referrals.push({id:epoch.id,origin:'Research',epochId:epoch.id});
    }
    return {referrals,updates:updates.map(u=>{
      if(u.status!=='conditional'||!u.condition)return u;
      const current=store.library.reportAssessment(project.id,u.artifactId);
      return {...u,foundationChoice:current?.id===u.id&&current.revision===u.revision?(accepted.has(stableHash(u.condition))?'accepted':'available'):undefined};
    })};
  });
  app.get<{ Params: { id: string; operationId: string } }>(`${projectPath}/archives/:operationId`, { schema: { params: body({ id: identifier, operationId: archiveIdentifier }) } }, async request => {
    const project = await snapshot(request.params.id);
    if (project.schemaVersion === 4) {
      const receipt = [...project.epochs, ...(project.activeEpoch ? [project.activeEpoch] : [])].map(epoch => epoch.archive).find(archive => archive?.operationId === request.params.operationId && archive.status === 'saved' && archive.selection.projectId === project.id);
      if (!receipt?.proofRef) throw new ApiError(404, 'ARCHIVE_NOT_FOUND', 'This saved Way archive is not available in this session.');
      const document = await store.library.proofReader([receipt.proofRef]).read(receipt.proofRef);
      return { operationId: receipt.operationId, body: document.proof };
    }
    if (project.schemaVersion !== 3) throw new ApiError(409, 'V21_REQUIRED', 'Way archives require a V2.1 project.');
    const receipt = [...project.epochs.flatMap(epoch => [...epoch.archives,...(epoch.optionalFlow?.archives??[])]), ...(project.activeEpoch?.archives ?? []),...(project.activeEpoch?.optionalFlow?.archives??[])].find(archive => archive.operationId === request.params.operationId && archive.status === 'saved' && archive.selection.projectId === project.id);
    if (!receipt?.proofRef) throw new ApiError(404, 'ARCHIVE_NOT_FOUND', 'This saved Way archive is not available in this session.');
    const document = await store.library.proofReader([receipt.proofRef]).read(receipt.proofRef);
    const refutation=archivedRefutation(document.meta);
    const assessment=document.meta.optionalProof&&store.library.reportAssessment(project.id,document.meta.optionalProof.artifactId);
    return { operationId: receipt.operationId, body: document.proof, ...(refutation?{refutation}:{}),...(assessment?{assessment}:{}) };
  });
  app.get<{ Params: { id: string; answerId: string } }>(`${projectPath}/answers/:answerId`, { schema: { params: body({ id: identifier, answerId: identifier }) } }, async request => {
    const project = await snapshot(request.params.id);
    if (project.schemaVersion === 4) {
      const ref = [...project.epochs, ...(project.activeEpoch ? [project.activeEpoch] : [])].flatMap(epoch => [...(epoch.solve ? [epoch.solve.answerRef] : []), ...(epoch.technicalAnswers ?? []).map(answer => answer.answerRef)]).find(ref => ref.id === request.params.answerId && ref.projectId === project.id && ref.owner === project.id);
      if (!ref) throw new ApiError(404, 'ANSWER_NOT_FOUND', 'This original answer is not available in this session.');
      const exactBody = await store.rawAnswersV0.read(ref, { readerProjectId: project.id, readerRole: 'theorist', purpose: 'history', ref });
      return { answerId: ref.id, ref, body: exactBody };
    }
    if (project.schemaVersion !== 3) throw new ApiError(409, 'V21_REQUIRED', 'Original answer references require a V2.1 project.');
    const answer = [...project.answers, ...(project.activeEpoch?.answers ?? [])].find(answer => answer.id === request.params.answerId && answer.projectId === project.id && answer.owner === project.id);
    const optionalEpochs=[...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])];
    const optionalRef=optionalEpochs.flatMap(epoch=>[...(epoch.optionalFlow?.artifacts.map(a=>a.originalRef)??[]),...epoch.calls.flatMap(call=>{const result=call.result as import('../research/versions/v21/optional-types.js').OptionalTheoristResultV21|undefined;const ref=call.captured?.originalRef??result?.originalRef;return ref&&ref.callId===call.id&&(call.captured||call.operation&&ref.inputHash===call.operation.inputHash)&&(!['v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(call.operation?.revision??'')||ref.epochId===epoch.snapshot.id&&ref.inputHash===call.operation?.inputHash)&&ref.hypothesisId===epoch.snapshot.root.hypothesisId&&ref.hypothesisRevision===epoch.snapshot.root.revision?[ref]:[];})]).find(ref=>ref.id===request.params.answerId&&ref.projectId===project.id&&ref.owner===project.id);
    const ref=answer?.answerRef??optionalRef;
    if (!ref) throw new ApiError(404, 'ANSWER_NOT_FOUND', 'This original answer is not available in this session.');
    const exactBody = await store.rawAnswers.read(ref, { readerProjectId: project.id, readerRole: 'theorist', purpose: 'review', ref });
    return { answerId: ref.id, ref, body: exactBody };
  });
  app.get<{ Params: { id: string } }>(`${projectPath}/activity`, { schema: { params: idParams } }, async request => {
    // Do not load/recover scientific checkpoints from observation polling.
    if (!knownProjectIds.has(request.params.id)) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Research project not found.');
    // Injected runtimes have no observation connection; absence is not known idle.
    const id=request.params.id;
    return {...(options.runtime ? {projectId:id,available:false,operations:[]} : activity.snapshot(id)),
      background:{reports:reportLedger.hasActiveReport(id),map:isMapMaintenanceRunning(dataRoot,id)}};

  });
  app.post<{ Params: { id: string }; Body: { recoveryOnly?: boolean } }>(`${projectPath}/start`, { schema: { params: idParams, body: body({ recoveryOnly: { type: 'boolean' } }, []) } }, async (request, reply) => serial(request.params.id, async () => {
    const id = request.params.id; requireIdle(id); let project = await snapshot(id);
    const resumeV4 = project.schemaVersion === 3 && project.researchLoopVersion === '4.0' && project.activeEpoch;
    if (request.body.recoveryOnly || !resumeV4 && (project.schemaVersion === 2 || project.schemaVersion === 3) && await store.loadInFlight(id)) {
      // Reconcile existing durable work only. A second explicit Start is required
      // for a new Epoch, even when models are available; uncertain calls never replay.
      const recovered = await engine.reconcile(id);
      notifyProject(recovered);
      return reply.status(200).send(await snapshot(id));
    }
    const previousConfig = JSON.stringify(project.config);
    const forkUserPreferences = project.fork && (project.schemaVersion === 2 || project.schemaVersion === 3) ? structuredClone(project.config.userDomainPreferences) : undefined;
    if (!resumeV4 && (project.schemaVersion !== 4 || !project.activeEpoch || project.activeEpoch.cancelled)) applyPreferences(project, preferences);
    if ((project.schemaVersion === 2 || project.schemaVersion === 3) && forkUserPreferences) project.config.userDomainPreferences = forkUserPreferences;
    let roles: ResearchRole[] = project.schemaVersion === 4 ? ['theorist'] : ['theorist', 'worker', ...(project.schemaVersion !== 3 && project.config.literatureEnabled ? ['literature' as const] : [])];
    let modelProject = project;
    if (resumeV4 && project.schemaVersion === 3) modelProject = { ...project, config: { ...resumeV4.snapshot.config, ...resumeV4.snapshot.modelConfig } };
    if (project.schemaVersion === 4 && project.activeEpoch && !project.activeEpoch.cancelled) {
      const frozen = project.activeEpoch.snapshot;
      modelProject = { ...project, config: { ...frozen.config, ...frozen.modelConfig } };
      if (project.activeEpoch.solve || project.activeEpoch.calls.some(call => call.task === 'v0_solve' && call.status === 'completed')) roles = [];
    }
    if (project.schemaVersion === 4 && (project.epochs.some(epoch => epoch.archive?.status === 'pending') || project.status === 'completed' && !project.pendingModificationIds?.length && !Object.values(project.commandStates ?? {}).some(state => state.status === 'pending' || state.status === 'planning'))) roles = [];
    if (project.schemaVersion === 3 && (project.epochs.some(epoch => epoch.archives.some(archive => archive.status === 'pending')) || project.status === 'completed' && !project.pendingModificationIds?.length && !Object.values(project.commandStates ?? {}).some(state => state.status === 'pending' || state.status === 'planning'))) roles = [];
    if (project.schemaVersion === 2) {
      const latest = project.epochs.at(-1), completed = structuredClone(project);
      completeArchivedProof(completed,ref=>store.library.isProofValid(ref));
      if (completed.status === 'completed' && latest?.research?.proofArchive?.status === 'saved' && !completed.pendingModificationIds?.length
        && !Object.values(completed.commandStates ?? {}).some(state=>state.status==='pending'||state.status==='planning')
        || latest?.research?.review?.proof && latest.research.proofArchive?.status !== 'saved') roles = [];
      else if (pendingSynthesis(latest)) {
        roles = ['theorist'];
        modelProject = {...project,config:{...project.config,defaultModel:latest!.snapshot.modelConfig.defaultModel,roleModels:latest!.snapshot.modelConfig.roleModels}};
      }
    }
    await assertRoleModels(modelProject, roles);
    if (JSON.stringify(project.config) !== previousConfig) project = await store.commitCheckpoint(project);
    if (stopping) throw new ApiError(409, 'SHUTTING_DOWN', 'CAgE is saving active research and shutting down.');
    // The job belongs to this process, not a browser connection. Closing a tab never cancels it.
    const job = engine.start(id).catch(() => { publish(project.schemaVersion === 4
      ? { type: 'research.warning', projectId: id, epoch: project.epoch, contractVersion: 'v0-test-1', message: 'Research stopped after an execution error. Reload the saved project for details.' }
      : project.schemaVersion === 3
      ? { type: 'research.warning', projectId: id, epoch: project.epoch, contractVersion: '2.1', message: 'Research stopped after an execution error. Reload the saved project for details.' }
      : project.schemaVersion === 2
      ? { type: 'research.warning', projectId: id, epoch: project.epoch, contractVersion: '2', message: 'Research stopped after an execution error. Reload the saved project for details.' }
      : { type: 'research.warning', projectId: id, round: project.round, message: 'Research stopped after an execution error. Reload the saved project for details.' }); }).finally(async () => {
      jobs.delete(id);
      // The final engine event can precede runtime cleanup. Notify again only
      // after this process releases its job so clients can observe idle state.
      notifyProject(await snapshot(id).catch(() => project));
    });
    jobs.set(id, job); return reply.status(202).send(await snapshot(id));
  }));
  app.get<{ Params: { id: string }; Querystring: { history?: string } }>(`${projectPath}/commands`, { schema: { params: idParams, querystring: { type: 'object', properties: { history: { enum: ['true'] } }, additionalProperties: false } } }, async request => {
    const project = await snapshot(request.params.id), commands = await store.listCommands(project.id);
    const states = commandStateProjection(project, commands);
    return commands.filter(command => request.query.history === 'true' || (command.kind === 'refine'
      ? ['pending', 'planning'].includes(states[command.id]?.status ?? '') : !project.processedCommandIds.includes(command.id)));
  });
  app.post<{ Params: { id: string }; Body: { kind: UserCommand['kind']; payload?: string; requestId?: string; refinementKind?: UserCommand['refinementKind'] } }>(`${projectPath}/commands`, {
    schema: { params: idParams, body: body({ kind: { enum: ['refine', 'pause', 'stop'] }, payload: string(100000, 0), requestId: identifier, refinementKind: { enum: ['hypothesis', 'annotation', 'accept_reconstruction'] } }, ['kind']) },
  }, (request, reply) => serial(`commands:${request.params.id}`, async () => {
    if (request.body.refinementKind && request.body.kind !== 'refine') throw new ApiError(400, 'INVALID_REQUEST', 'Only refinement commands can have a refinement kind.');
    const project = await snapshot(request.params.id);
    const commandId = request.body.requestId ? `cmd_${createHash('sha256').update(`${project.id}\0${request.body.requestId}`).digest('hex').slice(0, 48)}` : randomUUID();
    const payload = request.body.payload ?? '';
    const existing = (await store.listCommands(project.id)).find(command => command.id === commandId || (request.body.requestId && command.requestId === request.body.requestId));
    if (existing) {
      if (existing.id !== commandId || existing.kind !== request.body.kind || existing.payload !== payload || existing.refinementKind !== request.body.refinementKind) throw new ApiError(409, 'COMMAND_CONFLICT', 'This request ID already belongs to another command. Retry the original submission or submit a new request ID.');
      if(existing.kind==='stop'&&project.researchLoopVersion==='4.0'){mapControllers.get(project.id)?.abort();await getV4Coordinator(dataRoot).stopMapTasks(project.id);}
      return reply.status(200).send({ accepted: true, commandId: existing.id, sequence: existing.sequence, duplicate: true });
    }
    await engine.enqueue({ id: commandId, projectId: project.id, kind: request.body.kind, payload, createdAt: new Date().toISOString(),
      ...(request.body.requestId ? { requestId: request.body.requestId } : {}), ...(request.body.refinementKind ? { refinementKind: request.body.refinementKind } : {}) });
    const saved = (await store.listCommands(project.id)).find(command => command.id === commandId);
    if (!saved) throw new Error('Accepted command is missing from its durable journal.');
    if(saved.kind==='stop'&&project.researchLoopVersion==='4.0'){mapControllers.get(project.id)?.abort();await getV4Coordinator(dataRoot).stopMapTasks(project.id);}
    notifyProject(project);
    return reply.status(202).send({ accepted: true, commandId, sequence: saved.sequence, duplicate: false });
  }));
  app.post<{ Params: { id: string; proposalId: string }; Body: { expectedRevision: string } }>(`${projectPath}/reconstructions/:proposalId/accept`, { schema: { params: body({ id: identifier, proposalId: identifier }), body: body({ expectedRevision: { type: 'string', pattern: '^[0-9a-f]{40}$' } }) } }, (request, reply) => serial(`commands:${request.params.id}`, async () => {
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 2) throw new ApiError(409, 'V2_REQUIRED', 'Hypothesis reconstruction proposals require a V2 project.');
    const proposal = project.reconstructionProposals?.find(item => item.id === request.params.proposalId);
    if (!proposal) throw new ApiError(404, 'PROPOSAL_NOT_FOUND', 'This saved hypothesis proposal was not found.');
    const commandId = `reconstruct_${createHash('sha256').update(`${project.id}\0${proposal.id}`).digest('hex').slice(0, 32)}`;
    const payload = JSON.stringify({ kind: 'accept_reconstruction', proposalId: proposal.id, sourceHypothesisRevision: proposal.sourceHypothesisRevision });
    const commands = await store.listCommands(project.id);
    const existing = commands.find(command => command.id === commandId);
    if (existing && (existing.kind !== 'refine' || existing.payload !== payload || (existing.refinementKind && existing.refinementKind !== 'accept_reconstruction'))) throw new ApiError(409, 'COMMAND_CONFLICT', 'The saved acceptance command conflicts with this proposal. No new command was queued.');
    const state = commandStateProjection(project, commands)[commandId];
    if (proposal.status === 'accepted') return reply.status(200).send({ accepted: true, commandId: proposal.acceptedCommandId ?? commandId, sequence: existing?.sequence, duplicate: true });
    if (existing) {
      const pending = state ? ['pending', 'planning'].includes(state.status) : !project.processedCommandIds.includes(commandId) || project.pendingModificationIds?.includes(commandId);
      if (!pending) throw new ApiError(409, 'RECONSTRUCTION_NOT_PENDING', 'This earlier acceptance is no longer pending. Its historical command was preserved; request a new proposal to submit a new candidate.');
      if (state?.status !== 'planning' && proposal.sourceHypothesisRevision !== project.hypothesisRevision) throw new ApiError(409, 'STALE_HYPOTHESIS_PROPOSAL', 'This queued proposal refers to an earlier hypothesis revision. Request a new proposal for the current hypothesis.');
      return reply.status(200).send({ accepted: true, commandId, sequence: existing.sequence, duplicate: true });
    }
    if (project.contentRevision !== request.body.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload the latest project before accepting the hypothesis proposal.');
    if (proposal.sourceHypothesisRevision !== project.hypothesisRevision) throw new ApiError(409, 'STALE_HYPOTHESIS_PROPOSAL', 'This proposal refers to an earlier hypothesis revision. Request a new proposal for the current hypothesis.');
    await engine.enqueue({ id: commandId, projectId: project.id, kind: 'refine', refinementKind: 'accept_reconstruction', payload, createdAt: new Date().toISOString() });
    const saved = (await store.listCommands(project.id)).find(command => command.id === commandId);
    notifyProject(project);
    return reply.status(202).send({ accepted: true, commandId, sequence: saved?.sequence, duplicate: false });
  }));
  app.put<{ Params: { id: string }; Body: { config: unknown } }>(`${projectPath}/config`, { schema: { params: idParams, body: body({ config: { type: 'object' } }) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id); const project = await snapshot(request.params.id); const bundle = getResearchLoop(project.researchLoopVersion);
    if (project.schemaVersion === 4 && bundle.contractVersion === 'v0-test-1') project.config = bundle.parseConfig(request.body.config);
    else if (project.schemaVersion === 3 && bundle.contractVersion === '2.1') project.config = bundle.parseConfig(request.body.config);
    else if (project.schemaVersion === 2 && bundle.contractVersion === '2') project.config = bundle.parseConfig(request.body.config);
    else if (project.schemaVersion === 1 && bundle.contractVersion === '1') project.config = bundle.parseConfig(request.body.config);
    else throw new ResearchVersionError();
    const updated = await store.commitCheckpoint(project); notifyProject(updated); return updated;
  }));
  app.get('/api/evolution', async () => store.loadEvolutionState());
  app.post<{ Params: { id: string }; Body: { sourceProjectId: string; sourceRevision: string; skillId: string; skillVersion: string; expectedRevision: string } }>(`${projectPath}/evolution/skill-trial`, { schema: { params: idParams, body: body({ sourceProjectId: identifier, sourceRevision: string(100), skillId: identifier, skillVersion: string(200), expectedRevision: string(100) }) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 2) throw new ApiError(409, 'V2_REQUIRED', 'WaySkill trials require V2.');
    if (project.contentRevision !== request.body.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload the target session before selecting a local trial.');
    const source = (await store.listResearchCases()).find(p => p.id === request.body.sourceProjectId && p.contentRevision === request.body.sourceRevision);
    if (!source) throw new ApiError(409, 'REVISION_CONFLICT', 'The source method revision is unavailable.');
    const next = trialSkill(project, source, request.body.skillId, request.body.skillVersion);
    const saved = await store.commitCheckpoint(next); notifyProject(saved); return saved;
  }));
  app.get('/api/evolution/cases', async () => (await store.listResearchCases()).map(project => {
    const committedTasks = new Set(project.epochs.flatMap(epoch => epoch.tasks.map(task => task.id)));
    const policy = project.strategyTraces.filter(trace => trace.reviewed && committedTasks.has(trace.taskId));
    const skills = project.waySkillTraces.filter(trace => trace.reviewed && committedTasks.has(trace.taskId));
    return { id: project.id, name: project.name, revision: project.contentRevision, epoch: project.epoch,
      reviewedPolicyTraceCount: policy.length, reviewedWaySkillTraceCount: skills.length,
      reviewedAuditCount: project.epochs.flatMap(epoch => epoch.audits).filter(audit => !audit.provisional && audit.reviewed).length,
      domainIds: [...new Set([...policy, ...skills].flatMap(trace => trace.domainIds))].sort() };
  }));
  app.get<{ Params: { id: string; operationId: string } }>(`${projectPath}/evolution/operations/:operationId`, { schema: { params: body({ id: identifier, operationId: identifier }) } }, async request => {
    await snapshot(request.params.id);
    const operation = await store.loadEvolutionReviewOperation(request.params.operationId);
    if (!operation) return { operationId: request.params.operationId, status: 'none' };
    if (operation.projectId !== request.params.id) throw new ApiError(404, 'NOT_FOUND', 'This review operation does not belong to the selected project.');
    if (operation.status !== 'completed') return { operationId: operation.id, status: operation.status, createdAt: operation.createdAt };
    const state = await store.loadEvolutionState();
    const publication = state.history.find(item => item.id === operation.publicationId);
    if (!publication) throw new ApiError(409, 'REVIEW_UNRESOLVED', 'The completed review could not be reconciled. No model call was repeated.');
    return { operationId: operation.id, status: 'completed', createdAt: operation.createdAt, publication, state };
  });
  app.post<{ Params: { id: string }; Body: EvolutionInput & { expectedRevision: string; operationId: string } }>(`${projectPath}/evolution/review`, { schema: { params: idParams, body: body({
    operationId: identifier, target: { enum: ['policy', 'way_skill'] }, candidate: { type: 'object' },
    caseIds: { type: 'array', items: identifier, minItems: 3, maxItems: 100, uniqueItems: true },
    heldOutCaseIds: { type: 'array', items: identifier, minItems: 1, maxItems: 98, uniqueItems: true },
    scope: string(2000), action: { enum: ['review', 'rollback'] }, rollbackVersion: string(200), expectedRevision: string(100),
  }, ['operationId', 'target', 'caseIds', 'heldOutCaseIds', 'scope', 'action', 'expectedRevision']) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 2) throw new ApiError(409, 'V2_REQUIRED', 'Policy and WaySkill review requires a V2 project.');
    if (request.body.heldOutCaseIds.some(id => !request.body.caseIds.includes(id)) || !request.body.scope.trim()) throw new ApiError(400, 'INVALID_REQUEST', 'Select held-out cases from the reviewed case list and specify applicability.');
    if ((request.body.action === 'rollback') !== Boolean(request.body.rollbackVersion)) throw new ApiError(400, 'INVALID_REQUEST', 'Rollback requires an exact prior approved version.');
    const { expectedRevision, operationId, ...input } = request.body;
    const inputDigest = createHash('sha256').update(JSON.stringify({ projectId: project.id, expectedRevision, input })).digest('hex');
    const previous = await store.loadEvolutionReviewOperation(operationId);
    if (previous) {
      if (previous.projectId !== project.id || previous.inputDigest !== inputDigest) throw new ApiError(409, 'REVIEW_OPERATION_CONFLICT', 'This review operation ID already belongs to a different request.');
      if (previous.status !== 'completed') throw new ApiError(409, 'REVIEW_NOT_REPEATED', 'This review was already attempted or may have an uncertain outcome. No model call was repeated. Inspect learning history before explicitly requesting a new review.');
      const state = await store.loadEvolutionState();
      const publication = state.history.find(item => item.id === previous.publicationId);
      if (!publication) throw new ApiError(409, 'REVIEW_NOT_REPEATED', 'The completed review could not be reconciled. No model call was repeated.');
      return { publication, state };
    }
    const state = await store.loadEvolutionState();
    if (state.revision !== expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload the published learning history before requesting review.');
    const operation = { id: operationId, projectId: project.id, inputDigest, status: 'pending' as const, createdAt: new Date().toISOString() };
    await store.saveEvolutionReviewOperation(operation);
    try {
      if (input.target === 'policy' && !project.config.moderatorEnabled) throw new ApiError(400, 'MODERATOR_DISABLED', 'Enable the Moderator before requesting a Slow policy review.');
      await assertRoleModels(project, [input.target === 'policy' ? 'moderator' : 'theorist']);
      const publication = await runEvolutionReview(project, runtime, await store.listResearchCases(), state, input);
      const updated = await store.publishEvolution(publication, expectedRevision);
      await store.saveEvolutionReviewOperation({ ...operation, status: 'completed', publicationId: publication.id });
      notifyProject(project);
      return { publication, state: updated };
    } catch (error) {
      await store.saveEvolutionReviewOperation({ ...operation, status: 'failed' }).catch(() => {});
      throw error;
    }
  }));
  // Feedback assesses the owner's visible synthesis, never a private Worker transcript or proof truth.
  app.post<{ Params: { id: string }; Body: { epochId: string; userAssessment: string; informationValue: number; expectedRevision: string; taskId?: string; auditId?: string; attribution?: Attribution; attributionReason?: string } }>(`${projectPath}/feedback`, { schema: { params: idParams, body: body({ epochId: identifier, userAssessment: string(4000), informationValue: { type: 'number', minimum: 0, maximum: 1 }, expectedRevision: { type: 'string', pattern: '^[0-9a-f]{40}$' }, taskId: identifier, auditId: identifier, attribution: { enum: ['domain_anchor', 'way_formation', 'missing_data', 'execution_failure', 'scientific_contradiction', 'informative_success'] }, attributionReason: string(4000) }, ['epochId', 'userAssessment', 'informationValue', 'expectedRevision']) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 2) throw new ApiError(409, 'V2_REQUIRED', 'Learning feedback requires a V2 project.');
    if (project.contentRevision !== request.body.expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload the saved project before submitting feedback.');
    const epoch = project.epochs.find(item => item.id === request.body.epochId && item.summary.trim());
    if (!epoch) throw new ApiError(400, 'VISIBLE_CHECKPOINT_REQUIRED', 'Choose a saved Epoch with a visible result.');
    const { taskId, auditId, attribution, attributionReason } = request.body;
    if (taskId && auditId) throw new ApiError(400, 'INVALID_FEEDBACK_TARGET', 'Choose one public task or one committed audit for this assessment.');
    if ((attribution !== undefined) !== (attributionReason !== undefined) || (attribution !== undefined && (!taskId || !attributionReason?.trim()))) throw new ApiError(400, 'INVALID_ATTRIBUTION_REVIEW', 'Select a public committed task and provide both an attribution category and its reason.');
    if (taskId && (!epoch.tasks.some(task => task.id === taskId) || !epoch.committedTaskIds.includes(taskId))) throw new ApiError(400, 'COMMITTED_TASK_REQUIRED', 'Select a public committed task from this synthesis Epoch.');
    const reviewed = { at: new Date().toISOString(), assessment: request.body.userAssessment.trim(), informationValue: request.body.informationValue,
      ...(attribution !== undefined ? { attribution, attributionReason: attributionReason!.trim() } : {}) };
    if (!reviewed.assessment) throw new ApiError(400, 'INVALID_REQUEST', 'Provide an assessment of the visible synthesis.');
    if (auditId) {
      const audit = epoch.audits.find(item => item.id === auditId && !item.provisional);
      if (!audit) throw new ApiError(400, 'COMMITTED_AUDIT_REQUIRED', 'Choose a non-provisional audit from this committed synthesis Epoch.');
      audit.reviewed = { at: reviewed.at, assessment: reviewed.assessment, informationValue: reviewed.informationValue };
      const updated = await store.commitCheckpoint(project); notifyProject(updated); return updated;
    }
    const traces = [...project.waySkillTraces, ...project.strategyTraces].filter(trace => trace.epochId === epoch.id && (!taskId || trace.taskId === taskId));
    if (!traces.length && taskId) throw new ApiError(409, 'NO_RESEARCH_TRACES', 'This branch has no research traces to assess.');
    if (!taskId) epoch.userReview = {at:reviewed.at,assessment:reviewed.assessment,informationValue:reviewed.informationValue};
    for (const trace of traces) trace.reviewed = { ...trace.reviewed, ...structuredClone(reviewed) };
    for (const trace of project.strategyTraces.filter(trace => trace.epochId === epoch.id && (!taskId || trace.taskId === taskId))) trace.userAssessment = reviewed.assessment;
    const updated = await store.commitCheckpoint(project);
    const archived = epoch.research?.proofArchive;
    if (!taskId && archived?.status === 'saved' && archived.ref) await learning.reviewProof(updated, epoch.id, archived.ref, reviewed.assessment);
    notifyProject(updated); return updated;
  }));
  app.put<{ Params: { id: string }; Body: { version: string; expectedRevision: string } }>(`${projectPath}/research-loop`, { schema: { params: idParams, body: body({ version: string(100), expectedRevision: string(100) }) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const updated = await engine.selectVersion(request.params.id, request.body.version, request.body.expectedRevision);
    notifyProject(updated); return updated;
  }));
  app.get<{ Params: { id: string } }>(`${projectPath}/documents`, { schema: { params: idParams } }, async request => {
    const project = await snapshot(request.params.id);
    const managed = await store.listDocuments(project.id);
    return { revision: project.contentRevision, documents: [...managed.map(document => ({ path: document.path, title: basename(document.path), kind: documentKind(document.path) })), ...project.sources.filter(source => !managed.some(document => document.path === source.path)).map(source => ({ path: source.path, title: basename(source.path), kind: documentKind(source.path), sourceId: source.id }))] };
  });
  app.get<{ Params: { id: string }; Querystring: { path: string; revision?: string } }>(`${projectPath}/document`, { schema: { params: idParams, querystring: body({ path: string(4096), revision: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, ['path']) } }, async request => {
    const project = await snapshot(request.params.id); const documents = await store.listDocuments(project.id);
    const managed = documents.some(item => item.path === request.query.path);
    const source = managed ? undefined : project.sources.find(item => item.path === request.query.path);
    if (!source && !managed) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'This document is not part of the project.');
    const bytes = source ? await store.readSource(project.id, source) : await store.readDocument(project.id, request.query.path, request.query.revision);
    const document = await extractDocumentText(bytes, request.query.path);
    return { path: request.query.path, content: document.text, revision: source?.revision ?? request.query.revision ?? project.contentRevision, kind: documentKind(request.query.path), ...(document.warning ? { warning: document.warning } : {}) };
  });
  app.put<{ Params: { id: string }; Body: { path: string; content: string; expectedRevision: string } }>(`${projectPath}/document`, { schema: { params: idParams, body: body({ path: string(4096), content: string(1_000_000, 0), expectedRevision: { type: 'string', pattern: '^[0-9a-f]{40}$' } }) } }, request => serial(request.params.id, async () => {
    requireIdle(request.params.id); const project = await store.reviseDocument(request.params.id, request.body); notifyProject(project); return project;
  }));
  app.post<{ Params: { id: string }; Body: { mode: 'reference'; path: string } | { mode: 'import'; name: string; contentBase64: string; mime?: string } }>(`${projectPath}/sources`, { schema: { params: idParams, body: { oneOf: [body({ mode: { const: 'reference' }, path: string(4096) }), body({ mode: { const: 'import' }, name: string(255), contentBase64: string(28 * 1024 * 1024), mime: string(100) }, ['mode', 'name', 'contentBase64'])] } } }, request => serial(request.params.id, async () => {
    const id = request.params.id; requireIdle(id); await snapshot(id); const input = request.body;
    if (input.mode === 'reference') {
      if (!isAbsolute(input.path) || !/\.(md|markdown|txt|pdf)$/i.test(input.path)) throw new ApiError(400, 'INVALID_SOURCE', 'Choose an absolute Markdown, text, or PDF file path to grant read-only access.');
      await store.authorizeSource(id, input.path);
    } else {
      if (basename(input.name) !== input.name || !/\.(md|markdown|txt|pdf)$/i.test(input.name)) throw new ApiError(400, 'INVALID_SOURCE', 'Import a Markdown, text, or PDF file with valid base64 content.');
      const bytes = decodeSourceBase64(input.contentBase64);
      await store.importSource(id, { name: input.name, bytes, mime: input.mime });
    }
    const project = await snapshot(id); notifyProject(project); return project;
  }));
  app.get<{ Params: { id: string; sourceId: string } }>(`${projectPath}/pdf/:sourceId`, { schema: { params: body({ id: identifier, sourceId: identifier }) } }, async (request, reply) => {
    const project = await snapshot(request.params.id); const source = project.sources.find(item => item.id === request.params.sourceId && documentKind(item.path) === 'pdf');
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'This PDF has not been granted to this project.');
    const bytes = await store.readSource(project.id, source);
    return reply.header('Content-Disposition', 'inline; filename="document.pdf"').type('application/pdf').send(Buffer.from(bytes));
  });
  app.get('/api/events', async (_request, reply) => {
    reply.hijack(); const response = reply.raw;
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    response.write(': connected; reload authoritative state on reconnect\n\n'); streams.add(response);
    const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keepalive\n\n'); }, 20000); heartbeat.unref();
    response.on('close', () => { clearInterval(heartbeat); streams.delete(response); });
  });
  app.post<{ Body: { provider: string; key: string } }>('/api/providers/key', { schema: { body: body({ provider: string(200), key: string(16384) }) } }, async request => { await runtime.auth.saveApiKey(request.body.provider, request.body.key); return providerViews(); });
  app.delete<{ Params: { provider: string } }>('/api/providers/:provider', async request => { await runtime.auth.logout(request.params.provider); return providerViews(); });
  app.post<{ Body: { provider: string; type?: 'oauth' | 'api_key' } }>('/api/providers/oauth', { schema: { body: body({ provider: string(200), type: { enum: ['oauth', 'api_key'] } }, ['provider']) } }, request => runtime.auth.startLogin(request.body.provider, request.body.type ?? 'oauth'));
  app.get<{ Params: { id: string } }>('/api/providers/oauth/:id', { schema: { params: idParams } }, request => runtime.auth.getLogin(request.params.id));
  app.post<{ Params: { id: string }; Body: { value: string } }>('/api/providers/oauth/:id/respond', { schema: { params: idParams, body: body({ value: string(16384) }) } }, request => runtime.auth.answerLogin(request.params.id, request.body.value));
  app.delete<{ Params: { id: string } }>('/api/providers/oauth/:id', { schema: { params: idParams } }, request => { runtime.auth.cancelLogin(request.params.id); return { cancelled: true }; });
  app.get('/api/plugins', async () => plugins.discover());
  for (const action of ['install', 'enable', 'disable'] as const) {
    app.post<{ Params: { id: string } }>(`/api/plugins/:id/${action}`, { schema: { params: idParams, body: body({}) } }, async request => { await plugins[action](request.params.id); return plugins.discover(); });
  }
  app.put<{ Params: { id: string }; Body: PluginGrant }>('/api/plugins/:id/grants', { schema: { params: idParams, body: body({ projectId: identifier, role: { enum: ['theorist', 'worker', 'moderator', 'literature'] }, capabilities: { type: 'array', items: string(100), maxItems: 10 } }) } }, async request => { await snapshot(request.body.projectId); await plugins.grant(request.params.id, request.body); return plugins.discover(); });
  app.delete<{ Params: { id: string } }>('/api/plugins/:id', { schema: { params: idParams } }, async request => { await plugins.unload(request.params.id); return plugins.discover(); });
  if (updates) {
    const writing = new Set<FastifyRequest>();
    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writing.add(request);
        reply.raw.once('close', () => writing.delete(request));
      }
    });
    app.addHook('onResponse', async request => { writing.delete(request); });
    const token = { type: 'string', pattern: '^[A-Za-z0-9_\\-]{1,512}$' };
    app.post<{ Body: { token?: string } }>('/api/desktop/update/check', {
      bodyLimit: 2048, schema: { body: body({ token }, []) }
    }, request => updates.check(request.body.token));
    let downloading = false;
    app.post<{ Body: { token?: string; version: string } }>('/api/desktop/update/install', {
      bodyLimit: 2048, schema: { body: body({ token, version: string(32) }, ['version']) }
    }, async (request, reply) => {
      const requireIdleForUpdate = async (reserve = false) => {
        const session = await maintenance;
        if (reply.raw.destroyed || stopping || [...writing].some(other => other !== request) || mutations.size || jobs.size || mapControllers.size ||
          [...knownProjectIds].some(id => engine.isActive(id)) || runtime.hasForegroundInvocation?.() ||
          session?.history().turns.at(-1)?.status === 'running' || learning.tasks().some(task => task.status === 'running')) {
          throw new ApiError(409, 'UPDATE_BUSY', 'Finish active research and maintenance before installing the update.');
        }
        if (reserve) stopping = true;
      };
      if (downloading) throw new ApiError(409, 'UPDATE_BUSY', 'An update is already downloading.');
      downloading = true;
      try {
        await requireIdleForUpdate();
        const installer = await updates.download(request.body.version, request.body.token);
        try {
          await requireIdleForUpdate(true);
          try { await launchUpdate(installer.path); }
          catch { stopping = false; throw new ApiError(500, 'UPDATE_LAUNCH', 'Windows could not launch the verified installer.'); }
        } catch (error) {
          await installer.discard();
          throw error;
        }
        const shutdownAfterReply = () => { void app.carnot.shutdown().catch(() => {}); };
        reply.raw.once('finish', shutdownAfterReply);
        reply.raw.once('close', shutdownAfterReply);
        if (reply.raw.destroyed) shutdownAfterReply();
        return reply.code(202).send({ status: 'launching' });
      } finally { downloading = false; }
    });
  }
  app.post<{ Body: { mode: 'background' | 'shutdown' } }>('/api/exit', { schema: { body: body({ mode: { enum: ['background', 'shutdown'] } }) } }, async (request, reply) => {
    const active = await activeProjectIds(); if (request.body.mode === 'background') return { status: 'kept', activeProjectIds: active };
    stopping = true;
    reply.raw.once('finish', () => { void app.carnot.shutdown().catch(() => {}); });
    return { status: active.length ? 'stopping' : 'closed', activeProjectIds: active };
  });
  await registerStatic(app, options.staticRoot ?? join(sourceRoot, 'dist', 'web'));
  // Recover durable reviews even if their source epoch is no longer the visible one.
  const readyReportScopes=new Map((await reportLedger.researchReports()).filter(study=>study.status==='ready').map(study=>[JSON.stringify(study.report.scope),study.report.scope]));
  for(const scope of readyReportScopes.values()){
    try{await reportLedger.wakeReport(scope);}catch(error){mapAdmissionErrors.set(scope.projectId,publicError(error).message);}
  }
  // Reconcile saved map intents without starting an idle project's foreground proof.
  for(const project of await availableProjects())if(project.researchLoopVersion==='4.0'&&project.status!=='stopped'){
    try{
      await mapSources.reconcile(project.id);
      const intents=await store.library.knowledgeMap.outbox('local-user',project.id);
      if(intents.length||(await reportLedger.mapTasks(project.id)).some(task=>task.status==='ready'))await pumpKnowledgeMap(project.id);
    }catch(error){mapAdmissionErrors.set(project.id,publicError(error).message);}
  }
  return app;
}
function documentKind(path: string): 'markdown' | 'pdf' | 'text' { return /\.pdf$/i.test(path) ? 'pdf' : /\.(md|markdown)$/i.test(path) ? 'markdown' : 'text'; }
function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof UpdateError) return new ApiError(error.status, error.code, error.message);
  if (isStorageAccessError(error)) return new ApiError(503, 'LOCAL_RESOURCE_UNAVAILABLE', 'Local storage or process resources are unavailable. Resolve the local access or resource problem, then refresh to check saved state before retrying an action.');
  if (error instanceof V1SkillError) return new ApiError(['STALE_REVISION', 'REVIEW_PENDING', 'ID_CONFLICT'].includes(error.code) ? 409 : 400, error.code, error.message);
  if (error instanceof ResearchVersionError) return new ApiError(409, error.code, error.message);
  if (error instanceof ResearchSelectionError) return new ApiError(409, error.code, error.message);
  if (error instanceof RuntimeError) return new ApiError(['MODEL_REQUIRED', 'MODEL_UNAVAILABLE', 'INVALID_CONFIGURATION', 'AUTH_UNSUPPORTED', 'AUTH_INPUT_REQUIRED'].includes(error.code) ? 400 : ['AUTH_REQUIRED', 'AUTH_FAILED'].includes(error.code) ? 401 : 409, error.code, error.message);
  if (error instanceof ConflictError) return new ApiError(409, error.code, error.message);
  if (error instanceof ProjectBusyError) return new ApiError(409, error.code, error.message);
  if (error instanceof FileAccessError) return new ApiError(403, 'FILE_DENIED', 'The requested file is outside the explicit grant or has changed.');
  if (error instanceof PluginError) return new ApiError(error.code === 'PLUGIN_NOT_FOUND' ? 404 : error.code === 'PLUGIN_FAILED' ? 409 : 400, error.code, error.message);
  if (error instanceof ValidationError) return new ApiError(400, 'INVALID_REQUEST', 'The request does not match the research configuration or document schema.');
  const e = error as { code?: string; validation?: unknown; message?: string };
  if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new ApiError(413, 'REQUEST_TOO_LARGE', 'This request is too large. Source files must be 20 MiB or smaller.');
  if (e.validation || e.code?.startsWith('FST_ERR_CTP')) return new ApiError(400, 'INVALID_REQUEST', 'Check the request fields and JSON content.');
  if (e.code === 'FORK_UNAVAILABLE') return new ApiError(409, 'FORK_UNAVAILABLE', (error as Error).message);
  if (e.code === 'SOURCE_CHANGED') return new ApiError(409, 'SOURCE_CHANGED', 'The authorized source changed after freezing. Reimport it before the next round.');
  if (e.code === 'SOURCE_NOT_GRANTED') return new ApiError(403, 'SOURCE_NOT_GRANTED', 'This source revision has no explicit project grant.');
  if (e.code === 'ENOENT' || e.message === 'Research project not found.') return new ApiError(404, 'NOT_FOUND', 'The requested project or file was not found.');
  return new ApiError(500, 'LOCAL_OPERATION_FAILED', 'The local operation failed. No provider credentials or private document content are included in this error.');
}
async function registerStatic(app: CarnotApp, root: string): Promise<void> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    let pathname: string; try { pathname = decodeURIComponent(request.url.split('?')[0]!); } catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid resource path.'); }
    if (pathname.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Unknown local API route.' });
    if (pathname.split(/[\\/]/).some(part => part === '..' || part.startsWith('.')) || pathname.includes('\0')) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
    try {
      const canonicalRoot = await realpath(root); const candidate = await realpath(resolve(canonicalRoot, `.${pathname === '/' ? '/index.html' : pathname}`));
      const within = relative(canonicalRoot, candidate);
      if (within.startsWith('..') || isAbsolute(within) || !(await stat(candidate)).isFile() || !types[extname(candidate)]) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      return reply.type(types[extname(candidate)]!).send(await readFile(candidate));
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, 'WEB_BUILD_REQUIRED', 'The web interface is not built. Run npm run build, then restart CAgE.'); }
  };
  app.get('/', serve); app.get('/*', serve);
}
