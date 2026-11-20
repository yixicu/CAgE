import type { CapabilityItem } from '../../src/server/capabilities-types';
type SearchItem = Pick<CapabilityItem, 'key' | 'id' | 'title' | 'description' | 'subjectTags'>;
export type SearchIndex = readonly { key: string; text: string }[];
/** Client display search only. Canonical text/identity and scientific metadata stay unchanged. */
export function createSearchIndex(items: readonly SearchItem[]): SearchIndex {
  return items.map(item => ({ key: item.key, text: `${item.title} ${item.description} ${item.id} ${(item.subjectTags ?? []).join(' ')}`.toLocaleLowerCase() }));
}
export function searchKeys(index: SearchIndex, query: string): ReadonlySet<string> {
  const text = query.trim().toLocaleLowerCase();
  return new Set(index.filter(item => item.text.includes(text)).map(item => item.key));
}
