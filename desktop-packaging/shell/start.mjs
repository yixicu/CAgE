import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataRoot } from './dist/storage/data-root.js';
import { readStorageLocations } from './dist/storage/storage-locations.js';

const anchor = await resolveDataRoot();
const { system } = await readStorageLocations(anchor);
const directory = join(system, 'launcher-logs');
await mkdir(directory, { recursive: true, mode: 0o700 });
const log = join(directory, `desktop-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
const record = message => appendFile(log, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
await record('Opening workspace');
try {
  const { startServer } = await import('./dist/server/index.js');
  const app = await startServer();
  await record('Backend ready');
  process.stdout.write(String(app.server.address().port) + '\n');
} catch (error) {
  await record('Startup failed');
  throw error;
}
