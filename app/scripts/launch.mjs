import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStorageLocations } from '../dist/storage/storage-locations.js';
import { resolveDataRoot } from '../dist/storage/data-root.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [selected, portText] = process.argv.slice(2);
const port = Number(portText ?? process.env.CARNOT_PORT ?? 4327);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port between 1 and 65535.');
const dataDir = await resolveDataRoot(selected==='--port'?undefined:selected,root);
const {system} = await readStorageLocations(dataDir, root);
const logs = path.join(system, 'launcher-logs');
fs.mkdirSync(logs, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const errorPath = path.join(logs, `${stamp}.stderr.log`);
const out = fs.openSync(path.join(logs, `${stamp}.stdout.log`), 'a');
const err = fs.openSync(errorPath, 'a');
let child;
try {
  child = spawn(process.execPath, ['dist/server/index.js'], { cwd: root, detached: true, windowsHide: true,
    env: { ...process.env, CARNOT_DATA_DIR: dataDir, CARNOT_PORT: String(port) }, stdio: ['ignore', out, err, 'ipc'] });
} finally { fs.closeSync(out); fs.closeSync(err); }
// Only this child can announce readiness; a foreign service on the requested
// port must never be mistaken for Carnot, even if it returns a successful page.
const actualPort = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`CAgE is still starting (PID ${child.pid}). See ${errorPath}; no process was terminated.`)), 60_000);
  const failed = () => { clearTimeout(timer); reject(new Error(`CAgE could not start. See ${errorPath}`)); };
  child.once('error', failed); child.once('exit', failed);
  child.on('message', message => {
    if (message?.type !== 'carnot.ready' || message.pid !== child.pid || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) return;
    clearTimeout(timer); child.removeListener('error', failed); child.removeListener('exit', failed); resolve(message.port);
  });
});
child.disconnect(); child.unref();
const url = `http://127.0.0.1:${actualPort}`;
// The detached backend owns its file handles. End this short-lived launcher,
// including platform IPC observers, after flushing its status line.
process.stdout.write(`CAgE: ${url}\nData: ${dataDir}\n`, () => process.exit(0));
