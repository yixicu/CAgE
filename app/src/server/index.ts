import './http-client.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectStartupDataRoot } from '../storage/data-root.js';
import { createApp, type AppOptions, type CarnotApp } from './app.js';
export { createApp } from './app.js';
export type { AppOptions, ApplicationRuntime, CarnotApp } from './app.js';

/** One Node process. LAN/public binding is deliberately not a supported option. */
export async function startServer(options: AppOptions & { port?: number; host?: string } = {}): Promise<CarnotApp> {
  if (options.host !== undefined && options.host !== '127.0.0.1') throw new Error('CAgE only supports the 127.0.0.1 loopback address.');
  const port = options.port ?? Number(process.env.CARNOT_PORT ?? 4327);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('CARNOT_PORT must be an integer from 0 to 65535.');
  const app = await createApp(options);
  try {
    try { await app.listen({ host: '127.0.0.1', port }); }
    catch (error) {
      if (!port || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      await app.listen({ host: '127.0.0.1', port: 0 });
    }
  } catch (error) { await app.close(); throw error; }
  return app;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dataRoot = await selectStartupDataRoot().catch(error => {
      process.stderr.write(String(error.message) + '\n');
      throw error;
    });
    const app = await startServer({dataRoot});
    const address = app.server.address();
    if (process.connected && address && typeof address === 'object') process.send?.({ type: 'carnot.ready', pid: process.pid, port: address.port });
    process.stdout.write(`CAgE is running at http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4327}\nClosing the browser keeps research running. Use Exit for a graceful shutdown.\n`);
    const stop = () => { void app.carnot.shutdown().catch(() => { process.stderr.write('CAgE could not finish graceful shutdown. Saved checkpoints remain available for recovery.\n'); process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { process.stderr.write('CAgE could not start. Check the local port, application data directory, and build.\n'); process.exitCode = 1; }
}
