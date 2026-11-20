import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

function endpointUrl(): URL {
  const endpoint = new URL(process.env.CARNOT_SUBAGENT_URL || 'http://127.0.0.1:4319/v1');
  if (endpoint.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('CARNOT_SUBAGENT_URL must be a loopback HTTP endpoint.');
  }
  return endpoint;
}

export async function checkSubagentHost(key: string): Promise<void> {
  const base = endpointUrl().href.replace(/\/$/,'');
  const response = await fetch(base + '/models', {headers:{Authorization:'Bearer ' + key},
    signal:AbortSignal.timeout(5000), redirect:'error'});
  if (!response.ok) throw Error('Subagent host rejected pairing.');
  const body = await response.json() as {data?: {id:string}[]};
  if (!Array.isArray(body.data) || !body.data.some(model => model.id === 'theorist')) throw Error('Unexpected subagent host.');
}

export function registerSubagentProvider(models: ModelRuntime): void {
  models.registerProvider('cage-subagents', {
    name: 'Local subagents', api: 'openai-completions', baseUrl: endpointUrl().href,
    authHeader: true,
    models: ['theorist','worker','moderator','literature','learning','report','map-maintenance','maintenance'].map(id => ({
      id, name: 'Subagent · ' + id, reasoning: false, input: ['text','image'],
      contextWindow: 128000, maxTokens: 16384,
      compat: { sendSessionAffinityHeaders: true },
      cost: { input:0, output:0, cacheRead:0, cacheWrite:0 },
    })),
  });
}
