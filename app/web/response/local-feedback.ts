/** Browser-only opinions. Never consumed by the research engine or learning APIs. */
export const feedbackOptions = ['Way selection good', 'Logic clear', 'Conditions complete', 'Needs another way', 'Logic gap', 'Missing conditions'] as const;
export type LocalVote = 'good' | 'bad';
export interface LocalFeedback { version: 1; fingerprint: string; vote: LocalVote; options: string[]; at: string }
export type FeedbackStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const localFeedbackKey = (projectId: string, pageId: string) => `cage.response-feedback.v1:${encodeURIComponent(projectId)}:${encodeURIComponent(pageId)}`;
/** An identity hint, not a scientific fingerprint or security boundary. Stores no body. */
export function responseFingerprint(content: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < content.length; i++) { a = Math.imul(a ^ content.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ content.charCodeAt(i); }
  return `${content.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
export function readLocalFeedback(storage: FeedbackStorage, key: string, fingerprint: string): LocalFeedback | undefined {
  const raw = storage.getItem(key);
  if (!raw) return;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const item = value as Partial<LocalFeedback>;
  if (item.version !== 1 || item.fingerprint !== fingerprint || !['good', 'bad'].includes(item.vote ?? '') || !Array.isArray(item.options)
    || item.options.some(option => typeof option !== 'string' || !(feedbackOptions as readonly string[]).includes(option)) || typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at))) return;
  return { version: 1, fingerprint, vote: item.vote!, options: [...new Set(item.options)], at: item.at };
}
export function saveLocalFeedback(storage: FeedbackStorage, key: string, fingerprint: string, vote: LocalVote, options: readonly string[]): LocalFeedback {
  const record: LocalFeedback = { version: 1, fingerprint, vote, options: feedbackOptions.filter(option => options.includes(option)), at: new Date().toISOString() };
  storage.setItem(key, JSON.stringify(record));
  return record;
}
