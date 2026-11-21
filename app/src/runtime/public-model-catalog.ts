import { type Api, type Model, type Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

// pi.dev serves older catalog snapshots to the bundled Pi client's versioned user agent.
// CAgE can consume newer descriptors for chat transports already present in that client.
function publicCatalog(base: Provider): Provider {
  const bundled = base.getModels();
  let overlay: readonly Model<Api>[] = [];
  function compatible(value: unknown): value is Model<Api> {
    if (!value || typeof value !== 'object') return false;
    const m = value as Model<Api>;
    return (m.type === undefined || m.type === 'chat') && m.provider === base.id &&
      typeof m.id === 'string' && !!m.id && typeof m.name === 'string' &&
      bundled.some(known => known.api === m.api && known.baseUrl === m.baseUrl &&
        JSON.stringify(known.headers ?? {}) === JSON.stringify(m.headers ?? {})) &&
      typeof m.reasoning === 'boolean' && Array.isArray(m.input) && m.input.includes('text') &&
      Number.isSafeInteger(m.contextWindow) && m.contextWindow > 0 && Number.isSafeInteger(m.maxTokens) && m.maxTokens > 0 &&
      !!m.cost && [m.cost.input,m.cost.output,m.cost.cacheRead,m.cost.cacheWrite].every(n => Number.isFinite(n) && n >= 0);
  }
  const chat = () => [...new Map([...bundled,...overlay].map(m => [m.id,m])).values()];
  return {
    ...base,
    getModels: chat,
    getAllModels: () => [...chat(), ...(base.getAllModels?.() ?? []).filter(m => m.type && m.type !== 'chat')],
    async refreshModels(context) {
      if (!context.allowNetwork) {
        const restored = context.stored?.models.filter(compatible) ?? [];
        await context.publish({ update: () => { overlay = restored; } });
        return;
      }
      const response = await fetch('https://pi.dev/api/models/providers/' + base.id + '?types=chat', {
        headers: { accept: 'application/json', 'User-Agent': 'CAgE model catalog' }, redirect: 'error', signal: context.signal,
      });
      if (!response.ok) { await response.body?.cancel(); throw Error('Catalog unavailable'); }
      const rows: unknown = await response.json();
      const models = Array.isArray(rows) ? rows.filter(compatible) : [];
      if (!models.length) throw Error('No compatible chat models in catalog');
      await context.publish({ persist: { models, checkedAt: Date.now() }, update: () => { overlay = models; } });
    },
  };
}

const builtins = new Map(builtinProviders().map(provider => [provider.id, provider]));

// OpenRouter personalizes its list for the current key. Radius owns its discovery protocol.
export function registerPublicCatalog(runtime: ModelRuntime, id: string) {
  const base = builtins.get(id);
  if (!base || id === 'openrouter' || base.refreshModels || !base.getModels().length ||
      runtime.getRegisteredNativeProvider(id) || runtime.getRegisteredProviderConfig(id)) return;
  runtime.registerNativeProvider(publicCatalog(base));
}
