import type { ResearchMode } from './research-mode';

export interface ProjectRequestInput { name: string; hypothesis: string; researchLoopVersion: ResearchMode }
export interface ProjectRequestToken { key: string; requestId: string }
const storageKey = 'cage.pending-project-requests.v1';

/** Retain uncertain-create identities, never hypothesis text or credentials. */
export class ProjectRequestTracker {
  private readonly pending = new Map<string, string>();
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      this.storage = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
      const parsed: unknown = JSON.parse(this.storage?.getItem(storageKey) ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const [key, value] of Object.entries(parsed)) {
        if (/^[a-f0-9]{64}$/.test(key) && typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)) this.pending.set(key, value);
      }
    } catch { /* In-memory retries still work when browser storage is unavailable. */ }
  }
  private save() { try { this.storage?.setItem(storageKey, JSON.stringify(Object.fromEntries(this.pending))); } catch { /* Keep in-memory identity. */ } }
  async begin(input: ProjectRequestInput): Promise<ProjectRequestToken> {
    const bytes = new TextEncoder().encode(JSON.stringify([input.name, input.hypothesis, input.researchLoopVersion]));
    const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    let requestId = this.pending.get(key);
    if (!requestId) { requestId = crypto.randomUUID(); this.pending.set(key, requestId); this.save(); }
    return { key, requestId };
  }
  confirm(token: ProjectRequestToken): void {
    if (this.pending.get(token.key) === token.requestId) { this.pending.delete(token.key); this.save(); }
  }
}
