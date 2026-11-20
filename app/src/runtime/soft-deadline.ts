import {budgetControlsEnabledV3} from '../research/versions/v3/capacity-policy.js';
import type {CapacityPolicyV3} from '../research/contracts/v1.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite, exists, readJson } from '../storage/atomic.js';

export interface SoftDeadlineState { id: string; deadline: number; status: 'disabled' | 'waiting' | 'pending' | 'uncertain' | 'delivered'; reachedAt?: number; deliveredAt?: number }
/** A durable advisory, never a cancellation or admission gate. */
export class SoftDeadline {
  private writes = Promise.resolve();
  private constructor(private readonly file: string, readonly state: SoftDeadlineState) {}
  static async open(root: string, key: string, deadline: number, policy?:CapacityPolicyV3): Promise<SoftDeadline> {
    const id = createHash('sha256').update(key).digest('hex');
    const file = join(root, `${id}.json`);
    const state = await exists(file) ? await readJson<SoftDeadlineState>(file) : { id, deadline, status: budgetControlsEnabledV3(policy)?'waiting' as const:'disabled' as const };
    if((state.status==='disabled')!==!budgetControlsEnabledV3(policy))throw new Error('Frozen soft-deadline policy mismatch.');
    const clock = new SoftDeadline(file, state); await clock.save(); return clock;
  }
  private save(): Promise<void> { const body = JSON.stringify(this.state); this.writes = this.writes.then(() => atomicWrite(this.file, body)); return this.writes; }
  async reach(now = Date.now()): Promise<void> {
    if (now < this.state.deadline || this.state.status !== 'waiting') return this.writes;
    this.state.status = 'pending'; this.state.reachedAt = now; await this.save();
  }
  async prepare(now = Date.now()): Promise<string | undefined> {
    await this.reach(now);
    if (this.state.status === 'disabled' || this.state.status === 'waiting' || this.state.status === 'delivered') return undefined;
    this.state.status = 'uncertain'; await this.save();
    return `Soft time advisory ${this.state.id}: The requested time has elapsed. Start reporting current results, identifying unfinished proof obligations, established conditions and useful continuation. Prefer finishing existing work over expanding directions. Necessary checks, tools, chapter saves and final reporting remain allowed. This is not a scientific verdict or a forced stop.`;
  }
  async delivered(): Promise<void> {
    if (this.state.status !== 'uncertain') return;
    this.state.status = 'delivered'; this.state.deliveredAt = Date.now(); await this.save();
  }
  async flush(): Promise<void> { await this.writes; }
}
