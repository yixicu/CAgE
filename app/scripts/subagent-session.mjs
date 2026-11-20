// Client for an independent host session. Run in a private directory outside the project.
import { open, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const [operation, arg, file] = process.argv.slice(2);
const port = Number(process.env.CARNOT_SUBAGENT_PORT || 4319);
const token = process.env.CARNOT_SUBAGENT_TOKEN;
if (!token || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Set CARNOT_SUBAGENT_TOKEN and a valid local port.');
const base = 'http://127.0.0.1:' + port;
async function request(path, body) {
  const res = await fetch(base + path, {method:body === undefined ? 'GET' : 'POST',
    headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json'}, body,redirect:'error'});
  if (!res.ok) throw Error('Subagent host returned HTTP ' + res.status);
  return res;
}
if (operation === 'next' && arg && file) {
  // Reserve the destination before claiming, so a typo cannot consume a job.
  const out = await open(file,'wx',0o600);
  let id;
  try {
    for (;;) {
      const res = await request('/jobs/next' + (arg === 'any' ? '' : '?model=' + encodeURIComponent(arg)));
      if (res.status === 204) { await sleep(300); continue; }
      const job = await res.json();
      id = job.id;
      await out.writeFile(JSON.stringify(job));
      console.log(id, job.request.model);
      break;
    }
  } catch (error) {
    if (id) await request('/jobs/' + id + '/fail','{}').catch(() => {});
    throw error;
  } finally { await out.close(); }
} else if (['reply','text','fail','status'].includes(operation) && /^[a-f0-9-]{36}$/.test(arg)) {
  const body = operation === 'status' ? undefined : operation === 'fail' ? '{}' : await readFile(file,'utf8');
  await request('/jobs/' + arg + '/' + operation,body);
  console.log(operation === 'status' ? 'active' : 'accepted');
} else {
  throw Error('Use next <model|any> <new-request-file>, reply|text <id> <response-file>, or status|fail <id>.');
}
