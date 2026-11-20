import { access, constants, mkdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { atomicWrite } from './atomic.js';
import { resolveDataRoot } from './data-root.js';

export interface StorageLocations { system: string; research: string }
const filename = 'storage-locations.json';

async function normalize(value: StorageLocations, sourceRoot?: string): Promise<StorageLocations> {
  if (!value || ![value.system, value.research].every(item => typeof item === 'string' && isAbsolute(item.trim()))) {
    throw Error('Enter an absolute path for each folder.');
  }
  const [system, research] = await Promise.all([value.system, value.research].map(item => resolveDataRoot(item, sourceRoot)));
  return { system, research };
}

export async function readStorageLocations(anchor: string, sourceRoot?: string): Promise<StorageLocations> {
  let contents: string;
  try { contents = await readFile(join(anchor, filename), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { system: anchor, research: anchor };
    throw error;
  }
  return normalize(JSON.parse(contents), sourceRoot);
}

export async function saveStorageLocations(anchor: string, paths: StorageLocations, sourceRoot: string): Promise<StorageLocations> {
  const next = await normalize(paths, sourceRoot);
  for (const folder of new Set(Object.values(next))) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if (!(await stat(folder)).isDirectory()) throw Error('Select a directory for each location.');
    await access(folder, constants.R_OK | constants.W_OK);
  }
  await atomicWrite(join(anchor, filename), JSON.stringify(next, null, 2) + '\n');
  return next;
}
