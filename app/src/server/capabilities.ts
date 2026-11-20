import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { atomicWrite } from '../storage/atomic.js';
import type { FileResearchStore } from '../storage/index.js';
import type { PluginHost } from '../plugins/index.js';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import type { EpochResources, GlobalEvolutionState, PolicySnapshot, ResearchProjectV2, StrategyProvider, WaySkill } from '../research/contracts/v2.js';
import { applicableGlobalEvolution } from '../research/versions/v2/evolution.js';
import { basePolicy, selectPolicy, applyPolicyStrategy } from '../research/versions/v2/routing.js';
import { createProjectState } from '../research/versions/v2/state.js';
import { createWaySkills } from '../research/versions/v2/ways.js';
import type { CapabilitiesView, CapabilityItem, CapabilityUpdate } from './capabilities-types.js';

interface Choices {
  schemaVersion: 1;
  /** Scope is scientific applicability, not a second project settings system. */
  skills: Record<string, Record<string, string | null>>;
  policy?: string;
  strategies: Record<string, boolean>;
}
interface Resource {
  item: CapabilityItem;
  skill?: WaySkill;
  policy?: PolicySnapshot;
  provider?: StrategyProvider;
}
interface Catalog { entries: Resource[]; project: ResearchProjectV2; original?: AnyResearchProject }
const empty = (): Choices => ({ schemaVersion: 1, skills: {}, strategies: {} });
const digest = (value: Choices) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const skillIdentity = (skill: WaySkill) => `${skill.id}\0${skill.version}`;
const resourceContent = (resource: WaySkill | PolicySnapshot) => Object.fromEntries(Object.entries(resource).filter(([key]) => key !== 'effectiveFromEpoch'));
const sameResource = (a: WaySkill | PolicySnapshot | undefined, b: WaySkill | PolicySnapshot | undefined) => Boolean(a && b && isDeepStrictEqual(resourceContent(a), resourceContent(b)));
const baseKey = 'policy:base';
const copy = <T>(value: T): T => structuredClone(value);
const title = (value: string) => value.replace(/^base-/u, '').replace(/[-_]/gu, ' ').replace(/^./u, x => x.toUpperCase());
const virtualProject = () => createProjectState({ id: 'capability_defaults', name: 'Defaults', hypothesis: 'Defaults', researchLoopVersion: '2.0' });

export class CapabilityError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function invalid(message: string): never { throw new CapabilityError(400, 'INVALID_CAPABILITY', message); }
function parseChoices(value: unknown): Choices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Invalid saved capability selection.');
  const input = value as Choices;
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  if (Object.keys(input).some(key => !['schemaVersion', 'skills', 'policy', 'strategies'].includes(key)) || input.schemaVersion !== 1 || !record(input.skills) || !record(input.strategies) || (input.policy !== undefined && typeof input.policy !== 'string')) invalid('Invalid saved capability selection.');
  for (const [scope, skills] of Object.entries(input.skills)) {
    if (!/^(global|(?:project|domain):[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/u.test(scope) || !record(skills) || Object.keys(skills).length > 200) invalid('Invalid saved capability scope.');
    for (const [id, key] of Object.entries(skills)) if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id) || (key !== null && (typeof key !== 'string' || key.length > 600))) invalid('Invalid saved skill identity.');
  }
  if (Object.keys(input.skills).length > 1000 || Object.keys(input.strategies).length > 1000 || Object.entries(input.strategies).some(([key, enabled]) => key.length > 600 || typeof enabled !== 'boolean')) invalid('Invalid saved capability bounds.');
  return copy(input);
}
function domains(project: ResearchProjectV2): Set<string> {
  return new Set([...(project.policies.at(-1)?.domains.map(d => d.id) ?? []), ...project.epochs.filter(e => e.completedAt && e.snapshot.hypothesisRevision === project.hypothesisRevision).flatMap(e => e.snapshot.strategy.domains.map(d => d.id))]);
}
function applies(scope: string, project: ResearchProjectV2, hasProject: boolean): boolean {
  return scope === 'global' || (hasProject && (scope === `project:${project.id}` || scope.startsWith('domain:') && domains(project).has(scope.slice(7))));
}
function adopt(project: ResearchProjectV2, state: GlobalEvolutionState): ResearchProjectV2 {
  const next = copy(project), shared = applicableGlobalEvolution(next, state);
  if (shared.policy) next.policies.push(shared.policy);
  for (const skill of shared.waySkills) next.waySkills = [...next.waySkills.filter(s => s.id !== skill.id), skill];
  return next;
}

/** Small system resource selector. It cannot publish learning, change grants or edit research records. */
export class CapabilityManager {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly filename: string, private readonly store: Pick<FileResearchStore, 'listResearchCases' | 'loadEvolutionState'>, private readonly plugins: Pick<PluginHost, 'strategiesFor'>, private choices: Choices) {}
  static async open(dataRoot: string, store: Pick<FileResearchStore, 'listResearchCases' | 'loadEvolutionState'>, plugins: Pick<PluginHost, 'strategiesFor'>): Promise<CapabilityManager> {
    const filename = join(dataRoot, 'capabilities.json');
    let choices = empty();
    try { choices = parseChoices(JSON.parse(await readFile(filename, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return new CapabilityManager(filename, store, plugins, choices);
  }
  private async catalog(original?: AnyResearchProject, allProjects = true): Promise<Catalog> {
    if (original?.schemaVersion === 3) throw new CapabilityError(409, 'LIBRARY_CAPABILITIES_REQUIRED', 'V2.1 resources use the research library, not legacy V2 evolution selections.');
    const [state, saved] = await Promise.all([this.store.loadEvolutionState(), allProjects ? this.store.listResearchCases() : Promise.resolve([])]);
    const project = adopt(original?.schemaVersion === 2 ? original : virtualProject(), state);
    const projects = saved.filter(p => p.id !== original?.id);
    // Catalog the original local records; global adoption may replace a same-id active value.
    if (original?.schemaVersion === 2) projects.push(original);
    const entries: Resource[] = [];
    const add = (data: Omit<CapabilityItem, 'enabled' | 'active' | 'available'>, value: Pick<Resource, 'skill' | 'policy' | 'provider'>, available = applies(data.scope, project, Boolean(original))) => {
      entries.push({ ...value, item: { ...data, enabled: false, active: false, available: original?.schemaVersion !== 1 && available,
        ...(original?.schemaVersion === 1 ? { reason: 'V2 research resources; this session uses V1.' } : !available ? { reason: data.reason ?? (data.scope.startsWith('project:') ? 'Available only in its originating session.' : data.scope.startsWith('domain:') ? 'Requires matching committed domain evidence.' : 'Grant this provider to the session before use.') } : {}) } });
    };
    for (const skill of createWaySkills()) add({ key: `skill:default:${skill.id}@${skill.version}`, kind: 'skill', id: skill.id, version: skill.version, title: title(skill.id), description: skill.description, origin: 'default', owner: 'theorist', scope: 'global', limitations: skill.limitations }, { skill });
    const base = basePolicy();
    add({ key: baseKey, kind: 'policy', id: base.version, version: base.version, title: 'Base Strategy', description: base.rationale, origin: 'default', owner: 'base', scope: 'global', limitations: ['Stable fallback; one Strategy policy is active per Epoch.'] }, { policy: base });
    for (const publication of state.history.filter(p => p.review.action !== 'reject')) {
      const resource = publication.waySkill ?? publication.policy!;
      const kind = publication.waySkill ? 'skill' : 'policy';
      const id = publication.waySkill?.id ?? publication.policy!.version;
      add({ key: `${kind}:reviewed:${publication.id}`, kind, id, version: resource.version, title: kind === 'skill' ? title(id) : publication.policy?.strategies?.map(s => s.name).join(' · ') || `Strategy ${resource.version}`, description: publication.waySkill?.description ?? publication.policy!.rationale,
        origin: 'reviewed', owner: publication.review.owner, scope: publication.review.scope, limitations: publication.review.limitations }, publication.waySkill ? { skill: { ...copy(publication.waySkill), effectiveFromEpoch: project.epoch + 1 } } : { policy: { ...copy(publication.policy!), effectiveFromEpoch: project.epoch + 1 } });
    }
    for (const source of projects) {
      const seen = new Set<string>();
      for (const skill of [...source.waySkills, ...source.epochs.flatMap(e => e.snapshot.waySkills)]) {
        const identity = skillIdentity(skill);
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (entries.some(entry => entry.skill && skillIdentity(entry.skill) === identity && (entry.item.origin === 'default' || entry.item.origin === 'reviewed' && skill.scope === 'global'))) continue;
        const applicable = original?.id === source.id && skill.effectiveFromEpoch <= project.epoch + 1;
        add({ key: `skill:local:${source.id}:${skill.id}@${skill.version}`, kind: 'skill', id: skill.id, version: skill.version, title: title(skill.id), description: skill.description, origin: 'local', owner: 'theorist', scope: `project:${source.id}`, limitations: skill.limitations, ...(original?.id === source.id && skill.effectiveFromEpoch > project.epoch + 1 ? { reason: `Available from Epoch ${skill.effectiveFromEpoch}.` } : {}) }, { skill: copy(skill) }, applicable);
      }
    }
    const providerIds = new Set<string>();
    for (const source of original?.schemaVersion === 2 ? [project, ...projects.filter(p => p.id !== project.id)] : projects) {
      for (const provider of this.plugins.strategiesFor(source.id)) {
        if (providerIds.has(provider.id)) continue;
        providerIds.add(provider.id);
        const available = Boolean(original && this.plugins.strategiesFor(original.id).some(p => p.id === provider.id));
        add({ key: `strategy:${provider.id}`, kind: 'strategy', id: provider.id, version: provider.id.match(/@([^:]+):/u)?.[1] ?? 'declared', title: provider.id.split(':').at(-1)!, description: `Macro advice for ${provider.domainIds.join(', ')}.`, origin: 'plugin', owner: 'plugin', scope: 'global', limitations: ['Requires an existing Theorist strategy.macro grant; selection does not grant privileges.'] }, { provider }, available);
      }
    }
    return { entries, project, original };
  }
  private resolve(catalog: Catalog, choices: Choices) {
    const { project, entries, original } = catalog;
    const usable = entries.filter(entry => entry.item.available);
    const findSkill = (skill: WaySkill) => usable.find(entry => sameResource(entry.skill, skill) && entry.item.origin === (skill.scope === 'global' ? 'reviewed' : 'local')) ?? usable.find(entry => sameResource(entry.skill, skill));
    const selected = new Map(project.waySkills.filter(s => s.effectiveFromEpoch <= project.epoch + 1).map(skill => [skill.id, findSkill(skill)] as const));
    for (const [scope, overrides] of Object.entries(choices.skills).filter(([scope]) => applies(scope, project, Boolean(original))).sort(([a], [b]) => (a === 'global' ? -1 : b === 'global' ? 1 : a.startsWith('project:') ? 1 : b.startsWith('project:') ? -1 : a.localeCompare(b)))) {
      for (const [id, key] of Object.entries(overrides)) {
        if (key === null) { selected.delete(id); continue; }
        const entry = entries.find(item => item.item.key === key && item.item.id === id && item.skill && item.item.scope === scope);
        if (!entry) invalid('A selected skill version is no longer available. Review Capabilities.');
        if (!entry.item.available) invalid('The selected skill is outside this session scope or Epoch boundary.');
        selected.set(id, entry);
      }
    }
    const skills = [...selected.values()].filter((entry): entry is Resource & { skill: WaySkill } => Boolean(entry?.skill));
    if (!skills.length && original?.schemaVersion !== 1) invalid('Keep at least one applicable skill enabled.');
    const automatic = selectPolicy(project);
    let policy = usable.find(entry => sameResource(entry.policy, automatic));
    // Existing persisted policy remains authoritative in automatic mode; a missing publication is not invented.
    if (!policy) policy = { item: { key: `policy:saved:${project.id}:${automatic.version}`, kind: 'policy', id: automatic.version, version: automatic.version, title: `Strategy ${automatic.version}`, description: automatic.rationale, origin: 'local', owner: automatic.owner, scope: `project:${project.id}`, enabled: false, available: false, active: false, reason: 'Saved policy; no selectable shared approval record.', limitations: [] }, policy: automatic };
    if (choices.policy !== undefined) {
      const chosen = entries.find(entry => entry.item.key === choices.policy && entry.policy);
      if (!chosen) invalid('The selected Strategy policy is no longer available. Review Capabilities.');
      policy = chosen.item.available ? chosen : entries.find(entry => entry.item.key === baseKey)!;
    }
    const providers = usable.filter(entry => entry.provider && choices.strategies[entry.item.key] !== false);
    return { skills, policy: policy as Resource & { policy: PolicySnapshot }, providers };
  }
  private render(catalog: Catalog, choices: Choices): CapabilitiesView {
    if (catalog.original?.schemaVersion === 1) return { revision: digest(choices), items: catalog.entries.map(entry => ({ ...entry.item, enabled: false, active: false })), effective: { policyKey: '', skillKeys: [], specializedIds: [] }, pending: false, loopVersion: catalog.original.researchLoopVersion };
    const resolved = this.resolve(catalog, choices), pin = catalog.original?.schemaVersion === 2 ? catalog.original.activeEpoch?.snapshot ?? catalog.original.epochs.at(-1)?.snapshot : undefined;
    const keys = new Set([...resolved.skills, resolved.policy, ...resolved.providers].map(entry => entry.item.key));
    const activeKeys = new Set<string>();
    for (const resource of pin ? [...pin.waySkills, pin.policy] : []) {
      const matches = catalog.entries.filter(entry => sameResource(entry.skill ?? entry.policy, resource) && (!entry.item.scope.startsWith('project:') || entry.item.scope === `project:${catalog.original?.id}`));
      const match = matches.find(entry => keys.has(entry.item.key)) ?? matches.find(entry => entry.item.available) ?? matches[0];
      if (match) activeKeys.add(match.item.key);
    }
    const items = catalog.entries.map(({ item, provider }) => ({ ...item, enabled: item.available && keys.has(item.key), active: activeKeys.has(item.key) || Boolean(provider && pin?.strategy.specializedRefs?.includes(provider.id)) }));
    if (!items.some(item => item.key === resolved.policy.item.key)) items.push({ ...resolved.policy.item, enabled: true, active: sameResource(pin?.policy, resolved.policy.policy) });
    const learnedRefs = pin?.routingStrategy ? applyPolicyStrategy(pin.routingStrategy, resolved.policy.policy, pin.userDomainPreferences).specializedRefs ?? [] : [];
    const effective = { policyKey: resolved.policy.item.key, skillKeys: resolved.skills.map(entry => entry.item.key), specializedIds: [...new Set([...learnedRefs, ...resolved.providers.map(entry => entry.provider!.id)])] };
    const skillContents = (skills: WaySkill[]) => skills.slice().sort((a, b) => a.id.localeCompare(b.id)).map(resourceContent);
    const pending = Boolean(pin && (!sameResource(pin.policy, resolved.policy.policy) || !isDeepStrictEqual(skillContents(pin.waySkills), skillContents(resolved.skills.map(entry => entry.skill))) || !isDeepStrictEqual([...(pin.strategy.specializedRefs ?? [])].sort(), [...effective.specializedIds].sort())));
    return { revision: digest(choices), items, effective, pending, ...(catalog.original ? { loopVersion: catalog.original.researchLoopVersion } : {}) };
  }
  async view(project?: AnyResearchProject): Promise<CapabilitiesView> { const choices = copy(this.choices); return this.render(await this.catalog(project), choices); }
  async update(input: CapabilityUpdate, project?: AnyResearchProject): Promise<CapabilitiesView> {
    const work = this.queue.catch(() => {}).then(async () => {
      if (input.expectedRevision !== digest(this.choices)) throw new CapabilityError(409, 'CAPABILITY_CONFLICT', 'Capabilities changed. Reload before choosing resources.');
      if (project?.schemaVersion === 1) throw new CapabilityError(409, 'V2_REQUIRED', 'Fast and Slow resource selection applies to V2 sessions.');
      const catalog = await this.catalog(project), next = input.reset ? empty() : copy(this.choices);
      if (!input.reset) {
        const resource = catalog.entries.find(entry => entry.item.key === input.key);
        if (!resource) invalid('Unknown capability resource.');
        if (!resource.item.available) invalid(resource.item.reason ?? 'This resource is not applicable.');
        const item = resource.item;
        if (item.kind === 'skill') {
          next.skills[item.scope] ??= {};
          next.skills[item.scope]![item.id] = input.enabled ? item.key : null;
          if (input.enabled) {
            const rank = (scope: string) => scope === 'global' ? 0 : scope.startsWith('domain:') ? 1 : 2;
            for (const [scope, selections] of Object.entries(next.skills)) if (scope !== item.scope && applies(scope, catalog.project, Boolean(project)) && rank(scope) >= rank(item.scope)) delete selections[item.id];
          }
        } else if (item.kind === 'policy') next.policy = input.enabled ? item.key : baseKey;
        else next.strategies[item.key] = input.enabled;
      }
      const parsed = parseChoices(next);
      this.resolve(catalog, parsed);
      // A global choice must also leave future sessions and existing scoped sessions executable.
      for (const saved of await this.store.listResearchCases()) if (saved.id !== project?.id) this.resolve(await this.catalog(saved, false), parsed);
      this.resolve(await this.catalog(undefined, false), parsed);
      await atomicWrite(this.filename, JSON.stringify(parsed, null, 2) + '\n'); this.choices = parsed;
      return this.render(catalog, parsed);
    });
    this.queue = work; return work;
  }
  async selectEpochResources(project: Readonly<ResearchProjectV2>): Promise<EpochResources | undefined> {
    const choices = copy(this.choices); // Capture once; later HTTP changes cannot mutate this Epoch.
    if (!Object.keys(choices.skills).length && choices.policy === undefined && !Object.keys(choices.strategies).length) return undefined;
    const selected = this.resolve(await this.catalog(copy(project), false), choices);
    return { policy: copy(selected.policy.policy), waySkills: selected.skills.map(entry => copy(entry.skill)), strategyProviders: selected.providers.map(entry => entry.provider!) };
  }
}
