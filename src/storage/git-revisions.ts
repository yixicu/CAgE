import fs from 'node:fs';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { assertSafeRelative } from '../tools/files.js';
import { atomicWrite, ensureDirectory } from './atomic.js';
import { isStorageAccessError } from './errors.js';

// isomorphic-git treats read errors as missing objects. Retain the original access
// failure per operation so a temporary I/O problem can never trigger a rollback.
async function withFilesystem<T>(action: (filesystem: typeof fs) => Promise<T>): Promise<T> {
  let accessError: unknown;
  const filesystem = { ...fs, promises: { ...fs.promises,
    readFile: async (...args: Parameters<typeof fs.promises.readFile>) => {
      try { return await fs.promises.readFile(...args); }
      catch (error) { if (isStorageAccessError(error)) accessError ??= error; throw error; }
    },
    // Keep the SDK's object format; a killed writer leaves only an ignored temp file.
    writeFile: async (filename: string, content: string | Uint8Array) => { if (accessError) throw accessError; await atomicWrite(filename, content); },
    mkdir: async (directory: string) => { if (accessError) throw accessError; await ensureDirectory(directory); },
  } } as typeof fs;
  try {
    const result = await action(filesystem);
    if (accessError) throw accessError;
    return result;
  } catch (error) { throw accessError ?? error; }
}

export class GitRevisions {
  constructor(readonly root: string) {}
  async initialize(): Promise<void> { await withFilesystem(fs => git.init({ fs, dir: this.root, defaultBranch: 'research' })); }
  async read(revision: string, filename: string): Promise<Uint8Array> {
    assertSafeRelative(filename);
    if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error('An immutable Git revision is required.');
    return withFilesystem(async fs => (await git.readBlob({ fs, dir: this.root, oid: revision, filepath: filename })).blob);
  }
  async parent(revision: string): Promise<string | undefined> {
    if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error('An immutable Git revision is required.');
    const record = await withFilesystem(fs => git.readCommit({ fs, dir: this.root, oid: revision }));
    if (record.commit.parent.length > 1) throw new Error('Research ancestry must have a single parent.');
    return record.commit.parent[0];
  }
  async hasRootFile(revision: string, filename: string): Promise<boolean> { return withFilesystem(async fs => (await git.readTree({ fs, dir: this.root, oid: revision })).tree.some((entry) => entry.path === filename && entry.type === 'blob')); }
  async blobId(revision: string, filename: string): Promise<string> { return withFilesystem(async fs => (await git.readBlob({ fs, dir: this.root, oid: revision, filepath: assertSafeRelative(filename) })).oid); }
  async commit(files: Record<string, string>, parent?: string, message = 'Research checkpoint', preserveParent = false): Promise<string> {
    return withFilesystem(async fs => {
      const trees = new Map<string, git.TreeEntry[]>(); trees.set('', []);
      // Shared libraries append immutable proof/resource versions without loading their old bodies.
      if (preserveParent && parent) {
        const visit = async (oid: string, directory: string): Promise<void> => {
          const entries = (await git.readTree({ fs, dir: this.root, oid })).tree;
          trees.set(directory, entries.filter(entry => entry.type === 'blob'));
          for (const entry of entries) if (entry.type === 'tree') await visit(entry.oid, directory ? `${directory}/${entry.path}` : entry.path);
        };
        await visit(parent, '');
      }
      for (const [filename, text] of Object.entries(files)) {
        assertSafeRelative(filename);
        const dirname = path.posix.dirname(filename) === '.' ? '' : path.posix.dirname(filename);
        const parts = dirname.split('/').filter(Boolean);
        let directory = '';
        for (const part of parts) { directory = directory ? `${directory}/${part}` : part; if (!trees.has(directory)) trees.set(directory, []); }
        const oid = await git.writeBlob({ fs, dir: this.root, blob: new TextEncoder().encode(text) });
        const basename = path.posix.basename(filename);
        trees.set(dirname, trees.get(dirname)!.filter(entry => entry.path !== basename));
        trees.get(dirname)!.push({ mode: '100644', path: basename, oid, type: 'blob' });
      }
      let rootTree = '';
      for (const directory of [...trees.keys()].sort((a, b) => b.split('/').length - a.split('/').length || b.length - a.length)) {
        const oid = await git.writeTree({ fs, dir: this.root, tree: trees.get(directory)! });
        if (!directory) { rootTree = oid; continue; }
        const parentPath = path.posix.dirname(directory) === '.' ? '' : path.posix.dirname(directory);
        trees.get(parentPath)!.push({ mode: '040000', path: path.posix.basename(directory), oid, type: 'tree' });
      }
      // Content-addressed blobs and trees reuse identical text across every checkpoint.
      const author = { name: 'Carnot', email: 'local@carnot.invalid', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
      return git.writeCommit({ fs, dir: this.root, commit: { tree: rootTree, parent: parent ? [parent] : [], author, committer: author, message } });
    });
  }
}
