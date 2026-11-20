// Session-owned loopback transport. Pi continues to own transcripts and tool execution.
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.CARNOT_SUBAGENT_PORT || 4319);
const token = process.env.CARNOT_SUBAGENT_TOKEN || randomBytes(32).toString('hex');
if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 16) throw Error('Choose a valid port and a pairing key of at least 16 characters.');
const jobs = new Map();
const models = ['theorist','worker','moderator','literature','learning','report','map-maintenance','maintenance'];
const deadline = Number(process.env.CARNOT_SUBAGENT_TIMEOUT_MS || 0);
if (!Number.isSafeInteger(deadline) || deadline < 0 || deadline > 2147483647) throw Error('Invalid host timeout.');
const limit = 32 * 1024 * 1024;
const json = (res, status, body) => {
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};
async function read(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function authorized(req) {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function chunk(job, delta, finish = null) {
  const body = {id:job.id, object:'chat.completion.chunk', created:job.created, model:job.request.model,
    choices:[{index:0,delta,finish_reason:finish}]};
  job.response.write('data: ' + JSON.stringify(body) + '\n\n');
}
function forget(job) {
  clearTimeout(job.timer);
  clearInterval(job.keepAlive);
  jobs.delete(job.id);
}
function fail(job, message) {
  forget(job);
  if (!job.response.headersSent) json(job.response, 503, {error:{message}});
  else {
    job.response.write('data: ' + JSON.stringify({error:{message}}) + '\n\n');
    job.response.end();
  }
}
function complete(job, reply) {
  const {usage, finish_reason, ...message} = reply;
  if (message?.role !== 'assistant' || !(message.content == null || typeof message.content === 'string')) throw Error('Invalid assistant message.');
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || (!job.hasText && !message.content && !calls.length)) throw Error('Empty assistant message.');
  const ids = new Set();
  for (const call of calls) {
    if (!call?.id || ids.has(call.id) || call.type !== 'function' || !job.request.tools?.some(t => t.function?.name === call.function?.name) || typeof call.function.arguments !== 'string') throw Error('Invalid tool call.');
    JSON.parse(call.function.arguments);
    ids.add(call.id);
  }
  if (usage && !['prompt_tokens','completion_tokens','total_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)) throw Error('Invalid usage receipt.');
  const finish = finish_reason ?? (calls.length ? 'tool_calls' : 'stop');
  if (!['stop','tool_calls','length','content_filter'].includes(finish) || (finish === 'tool_calls') !== Boolean(calls.length)) throw Error('Invalid finish reason.');
  if (job.request.stream) {
    if (message.content) chunk(job,{content:message.content});
    if (calls.length) chunk(job,{tool_calls:calls.map((call,index) => ({...call,index}))});
    chunk(job,{},finish);
    if (usage) job.response.write('data: ' + JSON.stringify({id:job.id,object:'chat.completion.chunk',created:job.created,model:job.request.model,choices:[],usage}) + '\n\n');
    job.response.end('data: [DONE]\n\n');
  } else {
    json(job.response,200,{id:job.id,model:job.request.model,created:job.created,object:'chat.completion',
      choices:[{index:0,message,finish_reason:finish}],usage});
  }
  forget(job);
}
const server = createServer(async (req,res) => {
  try {
    if (req.headers.origin || !authorized(req)) return json(res,401,{error:'Unauthorized'});
    const url = new URL(req.url,'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return json(res,200,{object:'list',data:models.map(id => ({id,object:'model',owned_by:'CAgE'}))});
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const request = await read(req);
      if (!models.includes(request.model) || !Array.isArray(request.messages)) return json(res,400,{error:'Unknown model or malformed transcript'});
      if (jobs.size >= 32) return json(res,429,{error:'Host is at capacity'});
      const id = randomUUID();
      const affinity = req.headers['x-session-affinity'];
      const session = typeof affinity === 'string' ? createHash('sha256').update(affinity).digest('hex') : undefined;
      const job = {id,session,request,response:res,created:Math.floor(Date.now()/1000),claimed:false,hasText:false};
      if (deadline) job.timer = setTimeout(() => fail(job,'Subagent host timed out'),deadline);
      jobs.set(id,job);
      res.once('close',() => forget(job));
      if (request.stream) {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
        chunk(job,{role:'assistant'});
        job.keepAlive = setInterval(() => res.write(': waiting\n\n'),15000);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/jobs/next') {
      const model = url.searchParams.get('model');
      const next = [...jobs.values()].find(job => !job.claimed && (!model || job.request.model === model));
      if (!next) { res.writeHead(204); res.end(); return; }
      next.claimed = true;
      return json(res,200,{id:next.id,session:next.session,request:next.request});
    }
    const route = /^\/jobs\/([a-z0-9-]+)\/(reply|text|fail|status)$/.exec(url.pathname);
    const job = route && jobs.get(route[1]);
    if (!job?.claimed) return json(res,404,{error:'No active claim'});
    if (route[2] === 'status' && req.method === 'GET') return json(res,200,{active:true});
    if (req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
    const body = await read(req);
    if (!jobs.has(job.id)) return json(res,410,{error:'Request ended'});
    if (route[2] === 'reply') complete(job,body);
    else if (route[2] === 'text' && job.request.stream && typeof body.text === 'string') {
      chunk(job,{content:body.text}); job.hasText ||= Boolean(body.text);
    } else if (route[2] === 'fail') fail(job,'External subagent failed');
    else return json(res,400,{error:'Unsupported operation'});
    return json(res,200,{accepted:true});
  } catch {
    if (!res.headersSent) json(res,400,{error:'Invalid subagent request'});
    else res.destroy();
  }
});
server.listen(port,'127.0.0.1',() => {
  console.log('CAgE subagent host: http://127.0.0.1:' + port);
  if (!process.env.CARNOT_SUBAGENT_TOKEN) console.log('Pairing key: ' + token);
});
function stop() {
  for (const job of jobs.values()) fail(job,'Subagent host stopped');
  server.close();
  server.closeAllConnections();
}
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
