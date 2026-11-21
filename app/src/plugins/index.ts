import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ResearchRole } from '../engine/types.js';
import type { AnyResearchEvent as ResearchEvent } from '../research/contracts/loop.js';
import type { PolicySnapshot, StrategyProvider, StrategyRecommendation } from '../research/contracts/v2.js';
import { textStatisticsPlugin } from './text-statistics.js';
import { firecrawlPlugin, firecrawlCapability, isFirecrawlTool, searchUnavailable } from './firecrawl.js';

import { isSearchProvider, type SearchProvider } from '../shared/search-providers.js';

const ROLES: ResearchRole[] = ['theorist', 'worker', 'moderator', 'literature'];
const CAPABILITIES = new Set(['tool.text-statistics', firecrawlCapability, 'retrieval.read', 'events.read', 'strategy.macro']);
export interface PluginManifest {
  id: string; name: string; version: string; hostApi: '1'; description: string;
  requestedCapabilities: string[]; roleScopes: ResearchRole[];
}
export interface PluginGrant { projectId: string; role: ResearchRole; capabilities: string[] }
export interface PluginView extends PluginManifest { provider?: SearchProvider; excludedProjects?: string[]; installed: boolean; enabled: boolean; grants: PluginGrant[] }
export interface Disposable { dispose(): void }
export interface Retriever { name: string; retrieve(query: string): Promise<{ sourceId: string; locator: string; text: string }[]> }
export interface ScopedPluginApi {
  registerTool(capability: string, tool: ToolDefinition): Disposable;
  registerRetriever(retriever: Retriever): Disposable;
  registerStrategyProvider(provider: StrategyProvider): Disposable;
  subscribeEvents(handler: (event: ResearchEvent) => void): Disposable;
}
/** Only a compile-time reviewed catalog may supply these factories. Never import user paths. */
export interface TrustedPlugin { manifest: PluginManifest; activate(api: ScopedPluginApi, scope: Readonly<PluginGrant>): void }
interface Registration { pluginId: string; scope: PluginGrant; live: boolean; controller: AbortController; tools: ToolDefinition[]; retrievers: Retriever[]; strategies: StrategyProvider[]; listeners: ((event: ResearchEvent) => void)[] }
export class PluginError extends Error {
  constructor(readonly code: 'PLUGIN_INVALID' | 'PLUGIN_DENIED' | 'PLUGIN_FAILED' | 'PLUGIN_NOT_FOUND') {
    super({ PLUGIN_INVALID: 'The plugin manifest or grant is invalid.', PLUGIN_DENIED: 'Install, enable, and grant this plugin for the selected project and role first.', PLUGIN_FAILED: 'The plugin failed and its contributions were revoked.', PLUGIN_NOT_FOUND: 'Only reviewed bundled plugins are available.' }[code]);
  }
}

/** Thin in-process capability host. This is not an OS sandbox. */
export class PluginHost {
  private readonly entries = new Map<string, { plugin: TrustedPlugin; view: PluginView }>();
  private readonly registrations: Registration[] = [];
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly statePath?: string, catalog: TrustedPlugin[] = [textStatisticsPlugin]) {
    for (const plugin of catalog) {
      validateManifest(plugin.manifest);
      if (this.entries.has(plugin.manifest.id)) throw new PluginError('PLUGIN_INVALID');
      this.entries.set(plugin.manifest.id, { plugin, view: { ...structuredClone(plugin.manifest), installed: false, enabled: false, grants: [] } });
    }
  }
  static async open(dataRoot: string, firecrawlKeyFile = join(dataRoot, 'credentials', 'firecrawl.key')): Promise<PluginHost> {
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const host: PluginHost = new PluginHost(join(dataRoot, 'plugins.json'), [textStatisticsPlugin, firecrawlPlugin(firecrawlKeyFile, () => host.entry("firecrawl").view.provider ?? "firecrawl")]);
    let saved: unknown;
    try { saved = JSON.parse(await readFile(host.statePath!, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new PluginError('PLUGIN_INVALID'); return host; }
    if (!Array.isArray(saved)) throw new PluginError('PLUGIN_INVALID');
    for (const item of saved) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') throw new PluginError('PLUGIN_INVALID');
      const entry = host.entries.get(item.id); if (!entry) continue;
      entry.view.installed = item.installed === true;
      entry.view.enabled = entry.view.installed && item.enabled === true;
      if (!Array.isArray(item.grants)) throw new PluginError('PLUGIN_INVALID');
      entry.view.grants = item.grants.map((grant: PluginGrant) => host.validateGrant(entry.view, grant));
      if (item.id === 'firecrawl') {
        entry.view.provider = isSearchProvider(item.provider) ? item.provider : 'firecrawl';
        if (item.excludedProjects !== undefined && (!Array.isArray(item.excludedProjects) || item.excludedProjects.some((id: unknown) => typeof id !== 'string'))) throw new PluginError('PLUGIN_INVALID');
        entry.view.excludedProjects = item.excludedProjects ?? [];
        entry.view.grants = [];
      }
      if (entry.view.enabled) { try { for (const grant of entry.view.grants) host.activate(entry.plugin, grant); } catch { host.revoke(item.id); entry.view.enabled = false; entry.view.grants = []; } }
    }
    return host;
  }
  discover(): PluginView[] { return [...this.entries.values()].map(entry => structuredClone(entry.view)); }
  async install(id: string): Promise<void> { await this.mutate(() => { this.entry(id).view.installed = true; }); }
  async enable(id: string): Promise<void> {
    await this.mutate(() => { const entry = this.entry(id); if (!entry.view.installed) throw new PluginError('PLUGIN_DENIED'); entry.view.enabled = true; });
  }
  async selectProvider(provider: SearchProvider): Promise<void> {
    await this.mutate(() => {
      const view = this.entry('firecrawl').view;
      if (view.provider !== provider) this.revoke('firecrawl');
      view.provider = provider;
    });
  }
  async grant(id: string, grant: PluginGrant): Promise<void> {
    await this.mutate(() => {
      const entry = this.entry(id); if (!entry.view.installed || !entry.view.enabled) throw new PluginError('PLUGIN_DENIED');
      const checked = this.validateGrant(entry.view, grant);
      this.revoke(id, grant.projectId, grant.role);
      if (id === 'firecrawl') {
        const excluded = new Set(entry.view.excludedProjects);
        if (checked.capabilities.length) excluded.delete(grant.projectId);
        else excluded.add(grant.projectId);
        entry.view.excludedProjects = [...excluded];
        return;
      }
      entry.view.grants = entry.view.grants.filter(item => item.projectId !== grant.projectId || item.role !== grant.role);
      if (checked.capabilities.length) { this.activate(entry.plugin, checked); entry.view.grants.push(checked); }
    });
  }
  async disable(id: string): Promise<void> { await this.mutate(() => { const entry = this.entry(id); this.revoke(id); entry.view.enabled = false; entry.view.grants = []; }); }
  async unload(id: string): Promise<void> { await this.mutate(() => { const entry = this.entry(id); this.revoke(id); entry.view.installed = false; entry.view.enabled = false; entry.view.grants = []; }); }
  toolsFor(projectId: string, role: ResearchRole): ToolDefinition[] {
    if (this.closed) return [];
    const web = this.entries.get('firecrawl');
    if (web?.view.enabled && role === 'theorist' && !web.view.excludedProjects?.includes(projectId) &&
        !this.registrations.some(r => r.pluginId === 'firecrawl' && r.scope.projectId === projectId && r.live)) {
      this.activate(web.plugin, { projectId, role, capabilities: [firecrawlCapability] });
    }
    return this.registrations.filter(item => item.live && item.scope.projectId === projectId && item.scope.role === role).flatMap(item => item.tools); }
  retrieversFor(projectId: string, role: ResearchRole): Retriever[] { return this.registrations.filter(item => item.live && item.scope.projectId === projectId && item.scope.role === role).flatMap(item => item.retrievers); }
  strategiesFor(projectId: string): StrategyProvider[] { return this.registrations.filter(item => item.live && item.scope.projectId === projectId && item.scope.role === 'theorist').flatMap(item => item.strategies); }
  publish(event: ResearchEvent): void {
    for (const item of [...this.registrations]) if (item.live && item.scope.projectId === event.projectId) {
      for (const listener of [...item.listeners]) {
        try { listener(structuredClone(event)); } catch { this.fail(item.pluginId); void this.persist().catch(() => {}); break; }
      }
    }
  }
  close(): void { this.closed = true; for (const id of this.entries.keys()) this.revoke(id); }
  private entry(id: string) { const entry = this.entries.get(id); if (!entry) throw new PluginError('PLUGIN_NOT_FOUND'); return entry; }
  private validateGrant(view: PluginManifest, grant: PluginGrant): PluginGrant {
    if (!grant || typeof grant !== 'object' || !/^[a-zA-Z0-9_-]{1,100}$/.test(grant.projectId) || !view.roleScopes.includes(grant.role) || !Array.isArray(grant.capabilities) || grant.capabilities.some(capability => !view.requestedCapabilities.includes(capability) || (capability === 'strategy.macro' && grant.role !== 'theorist'))) throw new PluginError('PLUGIN_INVALID');
    return { projectId: grant.projectId, role: grant.role, capabilities: [...new Set(grant.capabilities)] };
  }
  private activate(plugin: TrustedPlugin, scope: PluginGrant): void {
    const registration: Registration = { pluginId: plugin.manifest.id, scope, live: true, controller: new AbortController(), tools: [], retrievers: [], strategies: [], listeners: [] };
    this.registrations.push(registration);
    const check = (capability: string) => { if (!registration.live || !scope.capabilities.includes(capability)) throw new PluginError('PLUGIN_DENIED'); };
    const disposable = <T>(collection: T[], item: T): Disposable => ({ dispose: () => { const index = collection.indexOf(item); if (index >= 0) collection.splice(index, 1); } });
    try {
      plugin.activate(Object.freeze({
        registerTool: (capability: string, tool: ToolDefinition) => {
          check(capability);
          const web = plugin.manifest.id === 'firecrawl' && capability === firecrawlCapability && isFirecrawlTool(tool.name);
          if ((!web && (capability !== 'tool.text-statistics' || tool.name !== 'text_statistics')) || typeof tool.execute !== 'function') throw new PluginError('PLUGIN_DENIED');
          let available = true;
          const wrapped: ToolDefinition = { ...tool, execute: async (...args) => {
            if (web) {
              if (!registration.live || !available) return searchUnavailable('Project access revoked');
              const revoked = registration.controller.signal;
              args[2] = args[2] ? AbortSignal.any([args[2], revoked]) : revoked;
              const response = await tool.execute(...args);
              return registration.live && available ? response : searchUnavailable('Project access revoked');
            }
            check(capability); if (!available) throw new PluginError('PLUGIN_DENIED');
            try { return await tool.execute(...args); } catch { this.fail(plugin.manifest.id); void this.persist().catch(() => {}); throw new PluginError('PLUGIN_FAILED'); }
          } };
          registration.tools.push(wrapped);
          const remove = disposable(registration.tools, wrapped);
          return { dispose: () => { available = false; remove.dispose(); } };
        },
        registerRetriever: (retriever: Retriever) => {
          check('retrieval.read');
          const wrapped: Retriever = { name: retriever.name, retrieve: async query => { check('retrieval.read'); try { return await retriever.retrieve(query); } catch { this.fail(plugin.manifest.id); throw new PluginError('PLUGIN_FAILED'); } } };
          registration.retrievers.push(wrapped); return disposable(registration.retrievers, wrapped);
        },
        registerStrategyProvider: (provider: StrategyProvider) => {
          check('strategy.macro');
          if (scope.role !== 'theorist' || !provider || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(provider.id) || !Array.isArray(provider.domainIds) || !provider.domainIds.length || provider.domainIds.length > 8 || provider.domainIds.some(domain => typeof domain !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(domain)) || typeof provider.recommend !== 'function') throw new PluginError('PLUGIN_INVALID');
          const domainIds = Object.freeze([...new Set(provider.domainIds)]);
          let available = true;
          const wrapped: StrategyProvider = Object.freeze({
            id: `${plugin.manifest.id}@${plugin.manifest.version}:${provider.id}`, domainIds,
            recommend: (input: Readonly<PolicySnapshot>): StrategyRecommendation => {
              check('strategy.macro'); if (!available) throw new PluginError('PLUGIN_DENIED');
              try {
                const frozen = deepFreeze(structuredClone(input));
                const output: unknown = provider.recommend(frozen);
                check('strategy.macro');
                return validateMacroRecommendation(output, frozen, domainIds);
              } catch { this.fail(plugin.manifest.id); void this.persist().catch(() => {}); throw new PluginError('PLUGIN_FAILED'); }
            },
          });
          registration.strategies.push(wrapped);
          const remove = disposable(registration.strategies, wrapped);
          return { dispose: () => { available = false; remove.dispose(); } };
        },
        subscribeEvents: (handler: (event: ResearchEvent) => void) => { check('events.read'); registration.listeners.push(handler); return disposable(registration.listeners, handler); },
      }), Object.freeze(structuredClone(scope)));
    } catch { this.fail(plugin.manifest.id); throw new PluginError('PLUGIN_FAILED'); }
  }
  private revoke(id: string, projectId?: string, role?: ResearchRole): void {
    for (let i = this.registrations.length - 1; i >= 0; i--) {
      const item = this.registrations[i]!;
      if (item.pluginId === id && (!projectId || item.scope.projectId === projectId) && (!role || item.scope.role === role)) { item.live = false; item.controller.abort(); item.tools.length = 0; item.retrievers.length = 0; item.strategies.length = 0; item.listeners.length = 0; this.registrations.splice(i, 1); }
    }
  }
  private fail(id: string): void { const entry = this.entry(id); this.revoke(id); entry.view.enabled = false; entry.view.grants = []; }
  private async mutate(work: () => void): Promise<void> {
    const next = this.queue.then(async () => { try { work(); } finally { await this.persist(); } });
    this.queue = next.catch(() => {}); await next;
  }
  private async persist(): Promise<void> {
    if (!this.statePath) return;
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.discover().map(({ id, installed, enabled, grants, provider, excludedProjects }) => ({ id, installed, enabled, grants, provider, excludedProjects })), null, 2), { mode: 0o600 });
    await rename(temporary, this.statePath);
  }
}
function validateManifest(manifest: PluginManifest): void {
  if (!manifest || typeof manifest !== 'object' || Object.keys(manifest).some(key => !['id', 'name', 'version', 'hostApi', 'description', 'requestedCapabilities', 'roleScopes'].includes(key)) || !/^[a-z0-9-]{1,64}$/.test(manifest.id) || manifest.hostApi !== '1' || typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || typeof manifest.description !== 'string' || !Array.isArray(manifest.requestedCapabilities) || manifest.requestedCapabilities.some(capability => !CAPABILITIES.has(capability)) || !Array.isArray(manifest.roleScopes) || manifest.roleScopes.some(role => !ROLES.includes(role))) throw new PluginError('PLUGIN_INVALID');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
function validateMacroRecommendation(value: unknown, policy: Readonly<PolicySnapshot>, domains: readonly string[]): StrategyRecommendation {
  if (!value || typeof value !== 'object') throw new PluginError('PLUGIN_INVALID');
  const r = value as Record<string, unknown>;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 32 && v.every(x => typeof x === 'string');
  if (Object.keys(r).sort().join(',') !== 'anchorIds,domainIds,modes,rationale,uncertainty' || !ids(r.domainIds) || !ids(r.anchorIds) || r.domainIds.some(d => !domains.includes(d) || !policy.domains.some(p => p.id === d)) || r.anchorIds.some(a => !policy.anchors.some(p => p.id === a && p.domainIds.some(d => domains.includes(d))))) throw new PluginError('PLUGIN_INVALID');
  if (typeof r.rationale !== 'string' || !r.rationale.trim() || r.rationale.length > 10000 || typeof r.uncertainty !== 'number' || !Number.isFinite(r.uncertainty) || r.uncertainty < 0 || r.uncertainty > 1 || !r.modes || typeof r.modes !== 'object' || Object.keys(r.modes).sort().join(',') !== 'challenge,conservative,exploring') throw new PluginError('PLUGIN_INVALID');
  const values = Object.values(r.modes);
  if (values.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) || Math.abs(values.reduce((sum: number, x: unknown) => sum + Number(x), 0) - 1) > 1e-9) throw new PluginError('PLUGIN_INVALID');
  return structuredClone(value) as StrategyRecommendation;
}
