import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Replacement is visible, but its persistence across a power loss is uncertain. */
export class AtomicWriteError extends Error {
  readonly published = true;
  readonly code: string;
  constructor(cause: unknown) {
    super('File replacement is visible, but its crash durability could not be confirmed.', { cause });
    this.name = 'AtomicWriteError';
    this.code = (cause as NodeJS.ErrnoException)?.code ?? 'DURABILITY_UNCERTAIN';
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  const unsupported = (error: unknown): boolean => {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EINVAL' || code === 'ENOTSUP' || code === 'EOPNOTSUPP'
      || process.platform === 'win32' && (code === 'EPERM' || code === 'EISDIR');
  };
  let handle;
  try { handle = await fs.open(directory, 'r'); }
  catch (error) { if (unsupported(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupported(error)) throw error; }
  finally { await handle.close(); }
}

/** Publish newly created ancestor entries before anything can reference their files. */
export async function ensureDirectory(directory: string): Promise<void> {
  const first = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (!first) return;
  let current = path.resolve(directory);
  const boundary = path.dirname(path.resolve(first));
  while (true) {
    await syncDirectory(current);
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function atomicWrite(filename: string, content: string | Uint8Array): Promise<void> {
  await ensureDirectory(path.dirname(filename));
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
    // A Windows reader or indexer may briefly hold the destination without delete sharing.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY')) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
    try { await syncDirectory(path.dirname(filename)); }
    catch (error) { throw new AtomicWriteError(error); }
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
export async function readJson<T>(filename: string): Promise<T> { return JSON.parse(await fs.readFile(filename, 'utf8')) as T; }
export async function exists(filename: string): Promise<boolean> {
  try { await fs.access(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Optional proof delivery has an in-process terminal-receipt watermark. Prepare
 * bytes asynchronously, then check and rename in one JS turn so an arriving
 * receipt cannot slip between the guard and pointer visibility. */
export async function atomicWriteGuarded(filename:string,content:string|Uint8Array,guard:()=>boolean):Promise<boolean>{
  const {renameSync}=await import('node:fs');
  await ensureDirectory(path.dirname(filename));const temporary=`${filename}.${randomUUID()}.tmp`;
  try{const file=await fs.open(temporary,'wx',0o600);try{await file.writeFile(content);await file.sync();}finally{await file.close();}
    if(!guard())return false;
    renameSync(temporary,filename);
    try{await syncDirectory(path.dirname(filename));}catch(error){throw new AtomicWriteError(error);}
    return true;
  }finally{await fs.unlink(temporary).catch(()=>undefined);}
}
