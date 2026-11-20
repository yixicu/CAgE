/** Retry identity only; no source text is persisted in browser storage. */
export interface CommandRequestInput { projectId: string; kind: 'refine' | 'pause' | 'stop'; payload: string; refinementKind?: 'hypothesis' | 'annotation' }
export interface CommandRequestToken { key: string; requestId: string }
const storageKey = 'cage.pending-command-requests.v1';
export class CommandRequestTracker {
  private readonly pending = new Map<string, string>();
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      this.storage = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
      const parsed: unknown = JSON.parse(this.storage?.getItem(storageKey) ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const [key, value] of Object.entries(parsed)) {
        if (/^[a-f0-9]{64}$/.test(key) && typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) this.pending.set(key, value);
      }
    } catch { /* Storage failure cannot block submission or expose source text. */ }
  }
  private save() { try { this.storage?.setItem(storageKey, JSON.stringify(Object.fromEntries(this.pending))); } catch { /* In-memory retries remain stable. */ } }
  async begin(input: CommandRequestInput): Promise<CommandRequestToken> {
    const bytes = new TextEncoder().encode(JSON.stringify([input.projectId, input.kind, input.refinementKind ?? '', input.payload]));
    const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    let requestId = this.pending.get(key);
    if (!requestId) { requestId = crypto.randomUUID(); this.pending.set(key, requestId); this.save(); }
    return { key, requestId };
  }
  confirm(token: CommandRequestToken): void {
    if (this.pending.get(token.key) === token.requestId) { this.pending.delete(token.key); this.save(); }
  }
}
