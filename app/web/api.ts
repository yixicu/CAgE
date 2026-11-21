import type { MapRef, NodeReviewStatus } from '../src/learning/knowledge-map';
import type { KnowledgeMapStore } from '../src/learning/knowledge-map-store';
import type { SearchProvider } from '../src/shared/search-providers';
import type { MonitorActivitySnapshot } from '../src/server/monitor-activity';
import type { InheritedResearchView } from '../src/research/contracts/lineage';
export type { InheritedResearchView };
import type { ResearchConfig as ResearchConfigV1, UserCommand, ModelSelection } from '../src/engine/types';
import type { AppPreferences } from '../src/server/preferences-types';
import type { CapabilitiesView, CapabilityItem, CapabilityNetwork } from '../src/server/capabilities-types';
import { DEFAULT_RESEARCH_MODE, type ResearchMode } from './research-mode';
import { ProjectRequestTracker } from './project-request';
import type { V1SkillState } from '../src/learning/v1-skill-contracts';
export type { CapabilitiesView, CapabilityItem, CapabilityNetwork };
export type { AppPreferences };
import type { AnyResearchProject as ResearchProject, AnyResearchEvent as ResearchEvent } from '../src/research/contracts/loop';
import type { ResearchConfigV2, EvolutionPublication, GlobalEvolutionState, Attribution } from '../src/research/contracts/v2';
import type { ResearchConfigV21 } from '../src/research/contracts/v21';
type ResearchConfig = ResearchConfigV1 | ResearchConfigV2 | ResearchConfigV21;

export type { ResearchProject, ResearchConfig, UserCommand };
export type WorkspaceEvent = ResearchEvent | { type: 'settings.changed'; projectId?: never };
export type ProjectSummary = { group?:string; id: string; name: string; status: ResearchProject['status']; archived?: boolean; researchLoopVersion?: string; fork?: { parentSessionId: string; checkpointId: string; number: number } } & ({ schemaVersion?: 1; round: number } | { schemaVersion: 2 | 3 | 4; epoch: number });
export interface EvolutionCaseView { id: string; name: string; revision: string; epoch: number; reviewedAuditCount?: number; reviewedPolicyTraceCount: number; reviewedWaySkillTraceCount: number; domainIds: string[] }
export interface FeedbackTarget { taskId?: string; auditId?: string; attribution?: Attribution; attributionReason?: string }
export interface EvolutionRequest { operationId: string; target: 'policy' | 'way_skill'; action: 'review' | 'rollback'; caseIds: string[]; heldOutCaseIds: string[]; scope: string; rollbackVersion?: string; expectedRevision: string }
export interface EvolutionResponse { publication: EvolutionPublication; state: GlobalEvolutionState }
export interface EvolutionOperationView { status: 'none' | 'pending' | 'failed' | 'completed'; publication?: EvolutionPublication; state?: GlobalEvolutionState }
export interface LearningTaskView { name?:string;createdAt?:string; id: string; projectId: string; kind: 'skill' | 'decision' | 'strategy' | 'publication' | 'review'; status: 'queued' | 'running' | 'completed' | 'no-change' | 'failed' | 'paused'; message?: string }
export interface LearningView { tasks: LearningTaskView[] }
export interface ConnectionReview { id: string; resource: { id: string; version: number }; status: 'queued' | 'running' | 'completed' | 'no-change' | 'failed' | 'paused'; message?: string; coverage?: { candidateCount: number; includedCount: number; omittedCount: number } }
export interface ModelDescriptor { provider: string; id: string; name: string; reasoning: boolean }
export interface ProviderStatus { id: string; name: string; configured: boolean; oauthSupported: boolean; catalogRefreshSupported?: boolean; apiKeySupported?: boolean }
export interface UnavailableProject { id: string; name?: string; code: 'PROJECT_UNAVAILABLE'; message: string }
export interface StorageLocations { system: string; research: string }
export interface StorageSettings { active: StorageLocations; configured: StorageLocations }
export interface Bootstrap { storage?: StorageSettings; unavailableProjects?: UnavailableProject[]; requestToken: string; projects: ProjectSummary[]; models: ModelDescriptor[]; providers: ProviderStatus[]; activeProjectIds: string[]; preferences: AppPreferences; researchDefaults: { '0': ResearchConfigV2; '1.0': ResearchConfigV1; '2.0': ResearchConfigV2; '2.1': ResearchConfigV21; '3.0': ResearchConfigV21; '4.0': ResearchConfigV21 } }
export interface DocumentEntry { path: string; title: string; kind: 'markdown' | 'pdf' | 'text'; sourceId?: string }
export interface DocumentList { revision: string; documents: DocumentEntry[] }
export interface DocumentContent { path: string; content: string; revision: string; kind: string }
export interface OAuthFlow { browserFailed?: boolean; id: string; status: string; url?: string; instructions?: string; prompt?: string | { type?: string; message?: string; placeholder?: string; options?: { id: string; label: string }[] }; userCode?: string; expiresAt?: number; error?: string }
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; } }
let requestToken = ''; // Never place the local nonce or credentials in storage or URLs.
const projectRequests = new ProjectRequestTracker();
const segment = (value: string) => encodeURIComponent(value);
const readDeadline = (signal?: AbortSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('The local read timed out. Check the backend, then refresh.', 'TimeoutError')), 30_000);
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
};

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const deadline = method === 'GET' ? readDeadline(signal) : undefined;
  try {
    const response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: deadline?.signal ?? signal,
      headers: { ...(requestToken ? { 'X-Carnot-Token': requestToken } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      throw new ApiError(data?.message || data?.error || `Request failed (${response.status}).`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally { deadline?.dispose(); }
}

export type ReportUpdate = import('../src/learning/report-assessment').ReportUpdate & {foundationChoice?:'accepted'|'available'};
export type {ReportPublication} from '../src/presentation/report-publications';
export interface SavedProof {
  body: string;
  displayBody?: string;
  citations?: import('../src/learning/knowledge-map').MapOpenResult[];
  presentationIssues?: string[];
}
export type ReviewedPremiseOrigin=import('../src/server/knowledge-map-routes').ReviewedPremiseOrigin;
export interface DomainRequest {
 taskId:string;proposalHash:string;fields:string[];premises?:{field:string;statement:string;accepted:boolean}[];sourceDecision?:'conditional'|'unsupported';acceptedFields?:string[];reason:string;revisionNote?:string;revisionTaskId?:string;revisionStatus?:string;decision?:'approve'|'decline';status:string;question?:string;alternative?:string;
}
import type {PublicMaintenanceHistory as MaintenanceHistory,MaintenanceInput} from '../src/server/maintenance-session';
export const api = {
  coreMapStatus: () => request<{currentVersion:number; keptLocal:number}>('/core-map/update'),
  checkCoreMap: (token?:string) => request<{currentVersion:number; keptLocal:number; available:boolean; release:{version:number;sha256:string}}>('/core-map/update/check','POST',{token}),
  installCoreMap: (version:number,sha256:string,token?:string) => request<{currentVersion:number;keptLocal:number}>('/core-map/update/install','POST',{version,sha256,token}),
  checkDesktopUpdate: (token?: string) => request<{currentVersion:string; latestVersion:string; available:boolean}>('/desktop/update/check', 'POST', { token }),
  installDesktopUpdate: (version: string, token?: string) => request<{status:string}>('/desktop/update/install', 'POST', { version, token }),
  saveStorage:(locations:StorageLocations)=>request<StorageSettings>('/workspace/storage','PUT',locations),
  pickStorageFolder:()=>request<{path:string|null}>('/workspace/pick-folder','POST'),
  openStorage:()=>request<void>('/workspace/open-storage','POST'),
  coreMap:()=>request<{entries:(import('../src/learning/knowledge-map').MapEntry & {qualification?:import('../src/learning/knowledge-map').MapQualification;suppliedProof?:{argument:string};supports?:import('../src/learning/knowledge-map').MapSupport[]})[];relations:import('../src/learning/knowledge-map').MapRelation[]}>('/research/core-map'),
  cageMap:(id:string)=>request<{entries:import('../src/learning/knowledge-map').MapEntry[];relations:import('../src/learning/knowledge-map').MapRelation[]}>(`/research/knowledge-map?projectId=${segment(id)}`),
  nodeDocument:(projectId:string,ref:MapRef,signal?:AbortSignal)=>request<import('../src/learning/knowledge-map').MapNodeDocument>('/research/knowledge-map/node-document','POST',{projectId,ref},signal),
  nodeReview:(projectId:string,ref:MapRef)=>request<Awaited<ReturnType<KnowledgeMapStore['nodeReview']>>>('/research/knowledge-map/review-status','POST',{projectId,ref}),
  setNodeReview:(projectId:string,ref:MapRef,expected:string,status:NodeReviewStatus,argument?:string)=>request<Awaited<ReturnType<KnowledgeMapStore['nodeReview']>>>('/research/knowledge-map/review-status','PUT',{projectId,ref,expected,status,argument}),
  maintenanceSession:()=>request<MaintenanceHistory>('/maintenance/session'),
  stopMaintenance:(requestId:string)=>request<MaintenanceHistory>('/maintenance/session/stop','POST',{requestId}),
  sendMaintenance:(input:MaintenanceInput)=>request<MaintenanceHistory>('/maintenance/session/turns','POST',input),
  reportUpdates:(id:string,signal?:AbortSignal)=>request<{updates:ReportUpdate[];publications?:import('../src/presentation/report-publications').ReportPublication[];referrals?:{id:string;origin:string;epochId?:string}[]}>(`/projects/${segment(id)}/v4/report-updates`,'GET',undefined,signal),
  domainRequests:(id:string,signal?:AbortSignal)=>request<{requests:DomainRequest[]}>(`/projects/${segment(id)}/v4/domain-requests`,'GET',undefined,signal),
  retryMapTask:(projectId:string,taskId:string)=>request('/research/knowledge-map/retry','POST',{projectId,taskId}),
  acceptPremise:(projectId:string,statement:string,origin:ReviewedPremiseOrigin)=>request('/research/knowledge-map/reviewed-premises','POST',{projectId,statement,origin}),
  decideDomain:(projectId:string,taskId:string,proposalHash:string,decision:'approve'|'decline',acceptedFields?:string[])=>request('/research/knowledge-map/domain-decisions','POST',{projectId,taskId,proposalHash,decision,acceptedFields}),
  v1Skills: () => request<V1SkillState>('/skills/v1'),
  selectV1Skill: (id: string, enabled: boolean, expectedRevision: string) => request<V1SkillState>(`/skills/v1/${segment(id)}`, 'PUT', { enabled, expectedRevision }),
  async bootstrap(): Promise<Bootstrap> { const data = await request<Bootstrap>('/bootstrap'); requestToken = data.requestToken; return data; },
  projects: () => request<ProjectSummary[]>('/projects'),
  preferences: (value: AppPreferences) => request<AppPreferences>('/preferences', 'PUT', value),
  capabilityNetwork: (projectId?: string) => request<CapabilityNetwork>(`/capabilities/network${projectId ? `?projectId=${segment(projectId)}` : ''}`),
  capabilityResource: (id: string, version: number, revision: string) => request<{ id: string; version: number; body: string }>(`/capabilities/resource?id=${segment(id)}&version=${version}&revision=${segment(revision)}`),
  editCapabilityResource: (input: { id: string; version: number; expectedRevision: string; body: string; projectId?: string }) => request<{ resource: { id: string; version: number; body: string }; network: CapabilityNetwork }>('/capabilities/resource', 'PUT', input),
  capabilityConnectionReview: (id: string, version: number) => request<{ review: ConnectionReview | null }>(`/capabilities/network/reviews?id=${segment(id)}&version=${version}`),
  reassessCapabilityConnections: (input: { id: string; version: number; expectedRevision: string; requestId: string }) => request<{ review: ConnectionReview }>('/capabilities/network/reviews', 'POST', input),
  capabilities: (projectId?: string) => request<CapabilitiesView>(`/capabilities${projectId ? `?projectId=${segment(projectId)}` : ''}`),
  selectCapability: (input: { expectedRevision: string; key: string; enabled: boolean; projectId?: string }) => request<CapabilitiesView>('/capabilities', 'PUT', input),
  rename: (id: string, name: string, expectedRevision: string) => request<ResearchProject>(`/projects/${segment(id)}/name`, 'PUT', { name, expectedRevision }),
  moveSession:(id:string,group:string)=>request<void>(`/projects/${segment(id)}/group`,'PUT',{group}),
  setSessionState: (id: string, state: 'active' | 'archived' | 'deleted') => request<{ state: string }>(`/projects/${segment(id)}/session-state`, 'PUT', { state }),
  forkProject: (id: string, checkpointId: string, expectedRevision: string, operationId: string) => request<ResearchProject>(`/projects/${segment(id)}/fork`, 'POST', { checkpointId, expectedRevision, operationId }),
  forkContext: (id: string) => request<InheritedResearchView | null>(`/projects/${segment(id)}/inherited`),
  async createProject(name: string, hypothesis: string, researchLoopVersion: ResearchMode = DEFAULT_RESEARCH_MODE): Promise<ResearchProject> {
    const input = { name: name || 'New research', hypothesis, researchLoopVersion, ...(name === 'New research' ? { nameSource: 'user' as const } : {}) };
    const token = await projectRequests.begin(input);
    const project = await request<ResearchProject>('/projects', 'POST', { ...input, requestId: token.requestId });
    projectRequests.confirm(token);
    return project;
  },
  selectResearchMode: (id: string, version: ResearchMode, expectedRevision: string) => request<ResearchProject>(`/projects/${segment(id)}/research-loop`, 'PUT', { version, expectedRevision }),
  project: (id: string) => request<ResearchProject>(`/projects/${segment(id)}`),
  wayArchive: (id: string, operationId: string) => request<SavedProof & { operationId: string; assessment?:ReportUpdate; refutation?:import('../src/learning/research-data').ArchivedRefutation }>(`/projects/${segment(id)}/archives/${segment(operationId)}`),
  rawAnswer: (id: string, answerId: string) => request<SavedProof & { answerId: string }>(`/projects/${segment(id)}/answers/${segment(answerId)}`),
  monitorActivity: (id: string) => request<MonitorActivitySnapshot>(`/projects/${segment(id)}/activity`),
  start: (id: string, recoveryOnly = false) => request<ResearchProject>(`/projects/${segment(id)}/start`, 'POST', recoveryOnly ? { recoveryOnly: true } : {}),
  commands: (id: string) => request<UserCommand[]>(`/projects/${segment(id)}/commands`),
  commandHistory: (id: string) => request<UserCommand[]>(`/projects/${segment(id)}/commands?history=true`),
  command: (id: string, kind: UserCommand['kind'], payload = '', identity: { requestId?: string; refinementKind?: 'hypothesis' | 'annotation' } = {}) => request<{ accepted: true }>(`/projects/${segment(id)}/commands`, 'POST', { kind, payload, ...identity }),
  configure: (id: string, config: ResearchConfig) => request<ResearchProject>(`/projects/${segment(id)}/config`, 'PUT', { config }),
  learning: (projectId?: string) => request<LearningView>(`/learning${projectId ? `?projectId=${segment(projectId)}` : ''}`),
  // Legacy adapters remain for historical consumers; the current workspace uses automatic learning.
  evolution: () => request<GlobalEvolutionState>('/evolution'),
  evolutionCases: () => request<EvolutionCaseView[]>('/evolution/cases'),
  reviewEvolution: (id: string, input: EvolutionRequest) => request<EvolutionResponse>(`/projects/${segment(id)}/evolution/review`, 'POST', input),
  evolutionOperation: (id: string, operationId: string) => request<EvolutionOperationView>(`/projects/${segment(id)}/evolution/operations/${segment(operationId)}`),
  acceptReconstruction: (id: string, proposalId: string, expectedRevision: string) => request<{ accepted: true; commandId: string; duplicate: boolean }>(`/projects/${segment(id)}/reconstructions/${segment(proposalId)}/accept`, 'POST', { expectedRevision }),
  feedback: (id: string, epochId: string, userAssessment: string, informationValue: number, expectedRevision: string, target: FeedbackTarget = {}) => request<ResearchProject>(`/projects/${segment(id)}/feedback`, 'POST', { epochId, userAssessment, informationValue, expectedRevision, ...target }),
  documents: (id: string) => request<DocumentList>(`/projects/${segment(id)}/documents`),
  document: (id: string, path: string, revision?: string) => request<DocumentContent>(`/projects/${segment(id)}/document?path=${segment(path)}${revision ? `&revision=${segment(revision)}` : ''}`),
  saveDocument: (id: string, path: string, content: string, expectedRevision: string) => request<ResearchProject>(`/projects/${segment(id)}/document`, 'PUT', { path, content, expectedRevision }),
  grantSource: (id: string, path: string) => request<ResearchProject>(`/projects/${segment(id)}/sources`, 'POST', { mode: 'reference', path }),
  async importSource(id: string, file: File): Promise<ResearchProject> {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a Markdown, text, or PDF file no larger than 20 MiB.');
    if (!/\.(md|markdown|txt|pdf)$/i.test(file.name)) throw new Error('Supported files: Markdown (.md), plain text (.txt), and PDF (.pdf).');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return request<ResearchProject>(`/projects/${segment(id)}/sources`, 'POST', { mode: 'import', name: file.name, contentBase64: btoa(binary), mime: /\.pdf$/i.test(file.name) ? 'application/pdf' : 'text/plain' });
  },
  async pdf(id: string, sourceId: string): Promise<Uint8Array> {
    const deadline = readDeadline();
    try {
      const response = await fetch(`/api/projects/${segment(id)}/pdf/${segment(sourceId)}`, { cache: 'no-store', signal: deadline.signal, headers: { 'X-Carnot-Token': requestToken } });
      if (!response.ok) throw new ApiError('Unable to load the selected PDF.', response.status);
      return new Uint8Array(await response.arrayBuffer());
    } finally { deadline.dispose(); }
  },
  saveKey: (provider: string, key: string) => request<ProviderStatus[]>('/providers/key', 'POST', { provider, key }),
  disconnect: (provider: string) => request<ProviderStatus[]>(`/providers/${segment(provider)}`, 'DELETE'),
  refreshModelCatalog: (provider: string) => request<{count: number}>(`/providers/${segment(provider)}/models/refresh`, 'POST', {}),
  beginOAuth: (provider: string, type: 'oauth' | 'api_key' = 'oauth', method?: 'browser' | 'device_code') => request<OAuthFlow>('/providers/oauth', 'POST', { provider, type, method }),
  oauth: (id: string) => request<OAuthFlow>(`/providers/oauth/${segment(id)}`),
  answerOAuth: (id: string, value: string) => request<OAuthFlow>(`/providers/oauth/${segment(id)}/respond`, 'POST', { value }),
  openOAuth: (id: string) => request<void>(`/providers/oauth/${segment(id)}/open`, 'POST', {}),
  cancelOAuth: (id: string) => request<void>(`/providers/oauth/${segment(id)}`, 'DELETE'),
  exit: (mode: 'background' | 'shutdown') => request<{ status: 'kept' | 'stopping' | 'closed'; activeProjectIds: string[] }>('/exit', 'POST', { mode }),
};

/** Fetch streaming rather than EventSource: the nonce stays in the header. Each
 * connection is only a notification stream. Callers reload authoritative state. */
export function subscribeEvents(onEvent: (event: WorkspaceEvent) => void, onConnection: (connected: boolean) => void, onReconnect: () => Promise<void>): () => void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  async function connect() {
    try {
      if (!first) await onReconnect();
      first = false;
      const response = await fetch('/api/events', { headers: { 'X-Carnot-Token': requestToken }, signal: abort.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('Event stream unavailable');
      onConnection(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!abort.signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true }).replace(/\r/g, '');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const payload = message.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (payload) {
            try { const event = JSON.parse(payload) as ResearchEvent; if (typeof event.type === 'string') onEvent(event); } catch { /* A malformed notification cannot become research state. */ }
          }
        }
      }
    } catch { /* The main view labels a disconnected stream and preserves drafts. */ }
    if (!abort.signal.aborted) { onConnection(false); timer = setTimeout(() => void connect(), 2000); }
  }
  void connect();
  return () => { abort.abort(); if (timer) clearTimeout(timer); };
}

export interface PluginView {
  provider?: SearchProvider; excludedProjects?: string[];
  id: string; name: string; version: string; description: string; requestedCapabilities: string[]; roleScopes: string[];
  installed: boolean; enabled: boolean; grants: { projectId: string; role: string; capabilities: string[] }[];
}
export const pluginsApi = {
  credential: (p: SearchProvider) => request<{configured: boolean}>(`/plugins/${p}/credential`),
  saveKey: (p: SearchProvider, key: string) => request<{configured: boolean}>(`/plugins/${p}/credential`, 'PUT', { key }),
  removeKey: (p: SearchProvider) => request<{configured: boolean}>(`/plugins/${p}/credential`, 'DELETE'),
  selectProvider: (provider: SearchProvider) => request<PluginView[]>('/plugins/firecrawl/provider', 'PUT', {provider}),
  list: () => request<PluginView[]>('/plugins'),
  install: (id: string) => request<PluginView[]>(`/plugins/${segment(id)}/install`, 'POST', {}),
  enable: (id: string) => request<PluginView[]>(`/plugins/${segment(id)}/enable`, 'POST', {}),
  grant: (id: string, projectId: string, role: string, capabilities: string[]) => request<PluginView[]>(`/plugins/${segment(id)}/grants`, 'PUT', { projectId, role, capabilities }),
  disable: (id: string) => request<PluginView[]>(`/plugins/${segment(id)}/disable`, 'POST', {}),
  uninstall: (id: string) => request<PluginView[]>(`/plugins/${segment(id)}`, 'DELETE'),
};
