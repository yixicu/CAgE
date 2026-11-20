import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type FileRole = 'theorist' | 'worker' | 'moderator' | 'literature';
export interface FileGrant {
  role: FileRole;
  workspaceRoot: string;
  readableRoots: string[];
  writableRoots: string[];
}
export interface FileEntry { name: string; type: 'file' | 'directory' }
interface PinnedRoot { path: string; directory: boolean; device: number; inode: number }
export class FileAccessError extends Error {
  constructor(message = 'The requested file is outside this role’s explicit grant.') { super(message); this.name = 'FileAccessError'; }
}
export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertSafeRelative(value: string): string {
  if (!value || value.includes('\0') || value.split(/[\\/]/u).includes('..') || path.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    throw new FileAccessError('A non-traversing relative file path is required.');
  }
  return value.replaceAll('\\', '/');
}
function cleanInput(value: string): void {
  if (!value || value.includes('\0') || value.split(/[\\/]/u).includes('..')) throw new FileAccessError('Path traversal is not allowed.');
  if (process.platform !== 'win32' && (value.includes('\\') || /^[A-Za-z]:/u.test(value))) throw new FileAccessError('Invalid local path.');
}
async function pin(root: string): Promise<PinnedRoot> {
  const canonical = await fs.realpath(root);
  const stat = await fs.stat(canonical);
  if (!stat.isFile() && !stat.isDirectory()) throw new FileAccessError('Only regular files or directories may be granted.');
  return { path: canonical, directory: stat.isDirectory(), device: stat.dev, inode: stat.ino };
}

/** App-level authorization for trusted local code, not an operating-system sandbox. */
export class RestrictedFileGateway {
  private constructor(private readonly workspace: PinnedRoot, private readonly readable: PinnedRoot[], private readonly writable: PinnedRoot[]) {}
  static async create(grant: FileGrant): Promise<RestrictedFileGateway> {
    const workspace = await pin(grant.workspaceRoot);
    if (!workspace.directory) throw new FileAccessError('A private workspace directory is required.');
    const readable = await Promise.all([grant.workspaceRoot, ...grant.readableRoots].map(pin));
    const writable = await Promise.all(grant.writableRoots.map(pin));
    // Central promotion is storage’s responsibility. Every role’s tools only write private notes.
    if (writable.some((root) => !root.directory || !isWithin(workspace.path, root.path))) throw new FileAccessError('Tool writes must stay in the private workspace.');
    return new RestrictedFileGateway(workspace, readable, writable);
  }
  get workspaceRoot(): string { return this.workspace.path; }
  private input(value: string): string { cleanInput(value); return path.resolve(this.workspace.path, value); }
  private async checkRoots(target: string, roots: PinnedRoot[]): Promise<void> {
    for (const root of roots) {
      if (root.directory ? isWithin(root.path, target) : root.path === target) {
        const current = await fs.stat(root.path).catch(() => undefined);
        if (current?.dev === root.device && current.ino === root.inode && await fs.realpath(root.path) === root.path) return;
      }
    }
    throw new FileAccessError();
  }
  private async readTarget(value: string): Promise<{ target: string; device: number; inode: number }> {
    const lexical = this.input(value);
    await this.checkRoots(lexical, this.readable);
    const target = await fs.realpath(lexical);
    await this.checkRoots(target, this.readable);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new FileAccessError('Only regular files can be read.');
    return { target, device: stat.dev, inode: stat.ino };
  }
  private async verifyOpened(handle: fs.FileHandle, target: string, device: number, inode: number, roots: PinnedRoot[]): Promise<void> {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== device || stat.ino !== inode) throw new FileAccessError('File changed while it was being opened.');
    const resolved = await fs.realpath(target);
    await this.checkRoots(resolved, roots);
    if (resolved !== target) throw new FileAccessError('File target changed while it was being opened.');
    if (process.platform === 'linux') await this.checkRoots(await fs.realpath(`/proc/self/fd/${handle.fd}`), roots);
  }
  async read(value: string): Promise<Uint8Array> {
    const { target, device, inode } = await this.readTarget(value);
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { await this.verifyOpened(handle, target, device, inode, this.readable); return new Uint8Array(await handle.readFile()); }
    finally { await handle.close(); }
  }
  async list(value = '.'): Promise<FileEntry[]> {
    const lexical = this.input(value);
    await this.checkRoots(lexical, this.readable);
    const target = await fs.realpath(lexical);
    await this.checkRoots(target, this.readable);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const actual = await fs.realpath(path.join(target, entry.name));
      await this.checkRoots(actual, this.readable);
      result.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  private async writableTarget(value: string): Promise<string> {
    const target = this.input(value);
    await this.checkRoots(target, this.writable);
    const relative = path.relative(this.workspace.path, target);
    if (!relative) throw new FileAccessError('A file path is required.');
    let current = this.workspace.path;
    const parts = relative.split(path.sep);
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      await this.checkRoots(current, this.writable);
      await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) throw new FileAccessError('Symbolic-link write paths are not allowed.');
    }
    const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new FileAccessError('Writes require a regular file target.');
    if (existing && await fs.realpath(target) !== target) throw new FileAccessError('Symbolic-link write paths are not allowed.');
    await this.checkRoots(await fs.realpath(path.dirname(target)), this.writable);
    return target;
  }
  async write(value: string, content: Uint8Array | string): Promise<void> {
    const target = await this.writableTarget(value);
    const parent = path.dirname(target);
    const before = await fs.stat(parent);
    const temporary = path.join(parent, `.note-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const opened = await handle.stat();
      await this.verifyOpened(handle, temporary, opened.dev, opened.ino, this.writable);
      await handle.writeFile(content); await handle.sync(); await handle.close();
      if (await this.writableTarget(value) !== target) throw new FileAccessError('File target changed.');
      const after = await fs.stat(parent);
      if (before.ino !== after.ino || before.dev !== after.dev) throw new FileAccessError('Parent directory changed.');
      await fs.rename(temporary, target);
    } finally { await handle.close().catch(() => undefined); await fs.unlink(temporary).catch(() => undefined); }
  }
  async importForEditing(sourcePath: string, relativeDestination: string): Promise<string> {
    assertSafeRelative(relativeDestination);
    await this.write(relativeDestination, await this.read(sourcePath));
    return path.join(this.workspace.path, relativeDestination);
  }
}
