import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, AtomicWriteError } from '../storage/atomic.js';

export type SessionState = 'active' | 'archived' | 'deleted';

/** Navigation metadata stays outside immutable scientific records and fork grants. */
export class SessionStates {
  private constructor(private readonly filename: string, private states: Record<string, 'archived' | 'deleted'>, private groups:Record<string,string> = {}) {}

  static async open(dataRoot: string): Promise<SessionStates> {
    const filename = join(dataRoot, 'session-state.json');
    let saved: unknown;
    try { saved = JSON.parse(await readFile(filename, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new SessionStates(filename, {}); throw error; }
    const record = saved as { schemaVersion?: unknown; sessions?: unknown; groups?:Record<string,string> };
    if (!record || record.schemaVersion !== 1 || !record.sessions || typeof record.sessions !== 'object' || Array.isArray(record.sessions)
      || Object.entries(record.sessions).some(([id, state]) => !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !['archived', 'deleted'].includes(state))) {
      throw new Error('Saved session navigation state is invalid. No research records were changed.');
    }
    if(record.groups && (typeof record.groups!=='object'||Array.isArray(record.groups)||Object.values(record.groups).some(g=>typeof g!=='string'||g.length>80)))throw Error('Invalid saved session groups.');
    return new SessionStates(filename, Object.fromEntries(Object.entries(record.sessions)),record.groups);
  }

  get(id: string): SessionState { return Object.hasOwn(this.states, id) ? this.states[id]! : 'active'; }

  // The server serializes updates to this shared sidecar across all sessions.
  async set(id: string, state: SessionState): Promise<void> {
    const next = { ...this.states, ...(state === 'active' ? {} : { [id]: state }) };
    if (state === 'active') delete next[id];
    await this.persist(next,this.groups);
  }

  group(id:string){return Object.hasOwn(this.groups,id)?this.groups[id]:undefined;}
  async move(id:string,group:string){
    const groups={...this.groups};
    if(group)groups[id]=group;else delete groups[id];
    await this.persist(this.states,groups);
  }

  private async persist(next:typeof this.states,groups:Record<string,string>){
    try { await atomicWrite(this.filename, JSON.stringify({ schemaVersion: 1, sessions: next, groups }, null, 2) + '\n'); }
    catch (error) { if (error instanceof AtomicWriteError) {this.states=next;this.groups=groups;} throw error; }
    this.states = next; this.groups=groups;
  }
}
