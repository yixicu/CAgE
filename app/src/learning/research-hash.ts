import { createHash } from 'node:crypto';

/** Stable fingerprints belong to the Node data layer, not browser-facing contracts. */
export function stableHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(item);
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
