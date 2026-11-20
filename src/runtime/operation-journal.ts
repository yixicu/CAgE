import { createHash } from 'node:crypto';
import { open, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, ensureDirectory, syncDirectory } from '../storage/atomic.js';
import { stableHash } from '../learning/research-hash.js';
import { RuntimeError } from './errors.js';

export interface OperationJournalState<T = unknown> {
  schemaVersion: 1; id: string; pinHash: string; status: 'pending' | 'completed' | 'uncertain' | 'denied'; deniedReply?: unknown;
  dispatches: number; corrections: number; result?: T; resultHash?: string;
}
/** Exclusive durable admission is distinct from replaceable checkpoints. A claim is never
 * removed on failure: a remote request may have started before a process disappeared. */
export class OperationJournal<T = unknown> {
  private static readonly active = new Map<string,OperationJournal<unknown>>();
  get isActive(): boolean { return OperationJournal.active.has(this.directory); }
  acquire(): void { if (this.isActive && OperationJournal.active.get(this.directory) !== this) throw new RuntimeError('SESSION_BUSY'); OperationJournal.active.set(this.directory,this); }
  release(): void { if (OperationJournal.active.get(this.directory) === this) OperationJournal.active.delete(this.directory); }
  private tail: Promise<void> = Promise.resolve();
  private captureBatch?: { bytes: string[]; promise: Promise<void> };
  pendingCaptureBytes = 0;
  private constructor(private readonly directory: string, readonly state: OperationJournalState<T>) {}
  static async begin<T>(root: string, id: string, pins: unknown): Promise<{ journal: OperationJournal<T>; fresh: boolean }> {
    const directory = join(root, createHash('sha256').update(id).digest('hex'));
    await ensureDirectory(directory);
    if ((await lstat(root)).isSymbolicLink() || (await lstat(directory)).isSymbolicLink()) throw new RuntimeError('INVALID_CONFIGURATION');
    const pinHash = stableHash(pins);
    const state: OperationJournalState<T> = { schemaVersion: 1, id, pinHash, status: 'pending', dispatches: 0, corrections: 0 };
    let claim;
    try { claim = await open(join(directory, 'claim.json'), 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = JSON.parse(await readFile(join(directory, 'claim.json'), 'utf8')) as OperationJournalState<T>;
      if (existing.schemaVersion !== 1 || existing.id !== id || existing.pinHash !== pinHash) throw new RuntimeError('INVALID_CONFIGURATION');
      let restored = existing;
      try { restored = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (restored.schemaVersion !== 1 || restored.id !== id || restored.pinHash !== pinHash || !['pending','completed','uncertain','denied'].includes(restored.status) || !Number.isSafeInteger(restored.dispatches) || !Number.isSafeInteger(restored.corrections) || restored.dispatches < 0 || restored.corrections < 0 || restored.corrections > restored.dispatches) throw new RuntimeError('INVALID_CONFIGURATION');
      if ((restored.status === 'completed' || restored.result !== undefined || restored.resultHash !== undefined) && (!restored.resultHash || restored.resultHash !== stableHash(restored.result))) throw new RuntimeError('INVALID_CONFIGURATION');
      return { journal: new OperationJournal(directory, restored), fresh: false };
    }
    try { await claim.writeFile(JSON.stringify(state)); await claim.sync(); }
    finally { await claim.close(); }
    await syncDirectory(directory);
    const journal = new OperationJournal<T>(directory, state);
    OperationJournal.active.set(directory,journal);
    return { journal, fresh: true };
  }
  static async inspect<T>(root: string, id: string, pins: unknown): Promise<OperationJournal<T> | undefined> {
    const directory = join(root, createHash('sha256').update(id).digest('hex'));
    let claim: OperationJournalState<T>;
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new RuntimeError('INVALID_CONFIGURATION');
      claim = JSON.parse(await readFile(join(directory, 'claim.json'), 'utf8'));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED'); }
    let state = claim;
    try { state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED'); }
    const hash = stableHash(pins);
    if (claim.schemaVersion !== 1 || claim.id !== id || claim.pinHash !== hash || state.schemaVersion !== 1 || state.id !== id || state.pinHash !== hash || !['pending','completed','uncertain','denied'].includes(state.status) || !Number.isSafeInteger(state.dispatches) || !Number.isSafeInteger(state.corrections) || state.dispatches < 0 || state.corrections < 0 || state.corrections > state.dispatches) throw new RuntimeError('INVALID_CONFIGURATION');
    if ((state.status === 'completed' || state.result !== undefined || state.resultHash !== undefined) && (!state.resultHash || state.resultHash !== stableHash(state.result))) throw new RuntimeError('INVALID_CONFIGURATION');
    return new OperationJournal(directory, state);
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.tail.then(action); this.tail = next; return next;
  }
  /** Copy the event before calling. Append-only evidence preserves split UTF-16 fragments. */
  capture(event: unknown): Promise<void> {
    const bytes = JSON.stringify(event) + '\n';
    this.pendingCaptureBytes += Buffer.byteLength(bytes);
    if (this.captureBatch) { this.captureBatch.bytes.push(bytes); return this.captureBatch.promise; }
    const batch = { bytes: [bytes], promise: Promise.resolve() };
    this.captureBatch = batch;
    batch.promise = this.enqueue(async () => {
      this.captureBatch = undefined;
      const content = batch.bytes.join('');
      const file = await open(join(this.directory, 'capture.jsonl'), 'a', 0o600);
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
      this.pendingCaptureBytes -= Buffer.byteLength(content);
    });
    return batch.promise;
  }
  dispatch(correction = false, maximumCorrections = 2): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.status !== 'pending' || (correction && this.state.corrections >= maximumCorrections)) throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
      if (correction) this.state.corrections++;
      this.state.dispatches++;
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(this.state));
    });
  }
  correction(maximumCorrections?: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.status !== 'pending' || maximumCorrections!==undefined && this.state.corrections >= maximumCorrections) throw new RuntimeError('INVALID_OUTPUT');
      this.state.corrections++;
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(this.state));
    });
  }
  /** Durable replaceable state; unlike complete(), this retains the exclusive owner. */
  checkpoint(result: T): Promise<void> {
    const copied = structuredClone(result);
    return this.enqueue(async () => {
      const next = { ...this.state, result: copied, resultHash: stableHash(copied) };
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(next));
      Object.assign(this.state, next);
    });
  }
  deny(reply: unknown): Promise<void> {
    return this.enqueue(async () => {
      const next = { ...this.state, status: 'denied' as const, deniedReply: structuredClone(reply) };
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(next));
      Object.assign(this.state, next);
    });
  }
  complete(result: T): Promise<void> {
    const copied = structuredClone(result);
    return this.enqueue(async () => {
      const next = { ...this.state, status: 'completed' as const, result: copied, resultHash: stableHash(copied) };
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(next));
      Object.assign(this.state, next);
      this.release();
    });
  }
  async flush(): Promise<void> { await this.tail; }
  async captured(): Promise<unknown[]> {
    await this.tail;
    try {
      const data = await readFile(join(this.directory, 'capture.jsonl'), 'utf8');
      // Only complete append records are recoverable after a torn final write.
      return data.split('\n').slice(0, -1).map(line => JSON.parse(line));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
}
