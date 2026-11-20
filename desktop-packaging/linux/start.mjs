import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
process.chdir(fileURLToPath(new URL('./', import.meta.url)));
process.env.CARNOT_DATA_DIR ||= join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'cage');
const { startServer } = await import('./dist/server/index.js');
const app = await startServer();
const url = 'http://127.0.0.1:' + app.server.address().port;
console.log('CAgE is running at ' + url);
if (!process.argv.includes('--no-browser')) {
  const browser = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  browser.on('error', () => console.error('Open ' + url + ' in your browser.'));
  browser.unref();
}
const stop = () => { void app.carnot.shutdown().catch(() => { process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
