import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, exists, readJson } from './atomic.js';

interface Lease { pid: number; token: string }
const recoveryBlocked = () => new Error('Writer recovery is already in progress or was interrupted. Preserve the data directory and inspect the recovery guard before restarting.');

/** One process owns the store. Reclamation itself is exclusive and never auto-stolen. */
export async function acquireWriterLease(root: string): Promise<string> {
  const lock = path.join(root, '.writer.lock'), guard = path.join(root, '.writer.reclaim');
  const token = randomUUID();
  const claim = async (target: string): Promise<void> => {
    const candidate = `${lock}.${token}.candidate`;
    try {
      await atomicWrite(candidate, JSON.stringify({ pid: process.pid, token }) + '\n');
      // Publish complete bytes with exclusive creation, never a zero-byte lease.
      await fs.link(candidate, target);
    } finally { await fs.unlink(candidate).catch(() => undefined); }
  };
  if (await exists(guard)) throw recoveryBlocked();
  try { await claim(lock); return token; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }

  try { await claim(guard); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw recoveryBlocked(); throw error; }
  try {
    // Do not reuse a dead-owner observation made before acquiring this guard.
    if (await exists(lock)) {
      const previous = await readJson<Lease>(lock).catch(() => undefined);
      if (!previous || !Number.isInteger(previous.pid) || previous.pid <= 0 || typeof previous.token !== 'string') throw new Error('Writer lock is unreadable. Inspect the data directory before recovery.');
      let dead = false;
      try { process.kill(previous.pid, 0); }
      catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw new Error('Another Carnot backend already owns this data directory.');
      await fs.unlink(lock);
    }
    // An initial claimant may win this link after the unlink; exclusive creation
    // then rejects us. No contender may unlink a live replacement under this guard.
    await claim(lock);
    return token;
  } finally {
    const saved = await readJson<Lease>(guard).catch(() => undefined);
    if (saved?.token === token) await fs.unlink(guard);
  }
}

export async function releaseWriterLease(root: string, token: string): Promise<void> {
  const filename = path.join(root, '.writer.lock');
  const lease = await readJson<Lease>(filename).catch(() => undefined);
  if (lease?.token === token) await fs.unlink(filename);
}
