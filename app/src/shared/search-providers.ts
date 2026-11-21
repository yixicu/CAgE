export const searchProviders = {
  firecrawl: { name: 'Firecrawl', keys: 'https://www.firecrawl.dev/app/api-keys', endpoint: 'https://api.firecrawl.dev/v2/search' },
  tavily: { name: 'Tavily', keys: 'https://app.tavily.com', endpoint: 'https://api.tavily.com/search' },
  exa: { name: 'Exa', keys: 'https://dashboard.exa.ai/api-keys', endpoint: 'https://api.exa.ai/search' },
} as const;
export type SearchProvider = keyof typeof searchProviders;
export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string' && Object.hasOwn(searchProviders, value);
}
