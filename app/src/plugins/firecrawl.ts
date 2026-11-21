import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { searchProviders, type SearchProvider } from '../shared/search-providers.js';
import { Type } from 'typebox';
import type { TrustedPlugin } from './index.js';

export const firecrawlCapability = 'tool.firecrawl-search';
export const isFirecrawlTool = (name: string) => name === 'web_search' || name === 'open_web_result';

function result(details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
}
export function searchUnavailable(reason: string) {
  return result({ status: 'unavailable', reason, message: 'Web search is temporarily unavailable. Continue the current task using available evidence.' });
}

function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
}

export function providerKeyFile(firecrawlFile: string, provider: SearchProvider) {
  return provider === 'firecrawl' ? firecrawlFile : join(dirname(firecrawlFile), provider + '.key');
}

export function firecrawlPlugin(keyFile: string, selected: () => SearchProvider): TrustedPlugin {
  async function request(provider: SearchProvider, endpoint: string, body: object, signal?: AbortSignal) {
    try {
      const key = (await readFile(providerKeyFile(keyFile, provider), 'utf8')).trim();
      if (!key) return;
      const timeout = AbortSignal.timeout(15000);
      const response = await fetch(new URL(endpoint, searchProviders[provider].endpoint), {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { ...(provider === 'exa' ? { 'x-api-key': key } : { Authorization: 'Bearer ' + key }), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); return; }
      const payload = await response.json();
      return provider === 'firecrawl' ? (payload?.success === true ? payload.data : undefined) : payload;
    } catch { /* A missing key, cancellation or provider failure is a normal tool result. */ }
  }
  return {
    manifest: { id: 'firecrawl', name: 'Web search', version: '1.0.0', hostApi: '1',
      description: 'Search the public web and read selected results with your chosen provider.',
      requestedCapabilities: [firecrawlCapability], roleScopes: ['theorist'] },
    activate(api) {
      const provider = selected();
      const known = new Set<string>();
      api.registerTool(firecrawlCapability, {
        name: 'web_search', label: 'Search the web', description: 'Discover public URLs when you lack an address. Use read_document for direct reading, locating passages and PDF images. open_web_result can request provider extraction if the origin is unreadable.',
        parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
        async execute(_id, args, signal) {
          const query = (args as { query?: unknown })?.query;
          if (typeof query !== 'string' || !query.trim() || query.length > 1000) return searchUnavailable('Invalid search query');
          const body = provider === 'firecrawl' ? { query, limit: 5, sources: ['web'] }
            : provider === 'tavily' ? { query, search_depth: 'basic', max_results: 5 }
            : { query, numResults: 5, contents: { highlights: true } };
          const data = await request(provider, 'search', body, signal);
          const rows = provider === 'firecrawl' ? data?.web : data?.results;
          if (!Array.isArray(rows)) return searchUnavailable('Provider search unavailable');
          const hits = [];
          for (const row of rows.slice(0, 5)) {
            if (!publicUrl(row?.url)) continue;
            known.add(row.url);
            const snippet = row.description ?? row.content ?? (Array.isArray(row.highlights) ? row.highlights.join(' ') : '');
            hits.push({ url: row.url, title: typeof row.title === 'string' ? row.title.slice(0, 300) : '',
              snippet: typeof snippet === 'string' ? snippet.slice(0, 1000) : '' });
          }
          return result({ status: 'ok', results: hits });
        },
      });
      api.registerTool(firecrawlCapability, {
        name: 'open_web_result', label: 'Read a search result', description: 'Read an original page from a URL returned by web_search. Cite the URL and only the passage actually returned.',
        parameters: Type.Object({ url: Type.String({ minLength: 1, maxLength: 8192 }) }, { additionalProperties: false }),
        async execute(_id, args, signal) {
          const url = (args as { url?: unknown })?.url;
          if (typeof url !== 'string' || !known.has(url)) return searchUnavailable('Use a URL from a search under the current project grant.');
          const page = provider === 'firecrawl' ? await request(provider, 'scrape', { url, formats: ['markdown'], onlyMainContent: true }, signal)
            : provider === 'tavily' ? await request(provider, 'extract', { urls: [url], format: 'markdown' }, signal)
            : await request(provider, 'contents', { urls: [url], text: true }, signal);
          const text = provider === 'firecrawl' ? page?.markdown : provider === 'tavily' ? page?.results?.[0]?.raw_content : page?.results?.[0]?.text;
          if (typeof text !== 'string' || !text.trim()) return searchUnavailable('Page text unavailable');
          return result({ status: 'ok', url, readAt: new Date().toISOString(), text: text.slice(0, 16000), truncated: text.length > 16000 });
        },
      });
    },
  };
}
