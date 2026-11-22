import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { canonicalCodec, ContractValidationError } from '../dist/runtime/strict-schema.js';
import { structuredOutputPayload } from '../dist/runtime/structured-output.js';
import { ToolArgumentAudit } from '../dist/runtime/tool-argument-audit.js';
import { decodeSafeToolArguments } from '../dist/runtime/safe-tool-arguments.js';
import { copyProviderPayload, withPiFetch } from '../dist/runtime/provider-transport.js';

// Locked Pi descriptors, including both official Kimi endpoints and their different APIs.
const account = Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url');
const subscription = {type:'oauth', access:'fixture.'+account+'.invalid', refresh:'invalid',
  expires:Date.now()+3_600_000, accountId:'fixture-account'};
const credentials = new InMemoryCredentialStore();
await credentials.modify('openai-codex', () => subscription);
const models = builtinModels({credentials});
const backgroundModel = models.getModel('openai', 'gpt-4.1-mini');
const backgroundSelection = {provider:backgroundModel.provider, modelId:backgroundModel.id};
const targets = [
  ['openai', 'gpt-6.1-sol'], ['openai-codex', 'gpt-6.1-sol'], ['anthropic', 'claude-sonnet-4-6'], ['xai', 'grok-4.7'],
  ['deepseek', 'deepseek-v4-pro'], ['zai', 'glm-5.3'], ['moonshotai', 'kimi-k3'],
  ['kimi-coding', 'k3'], ['google', 'gemini-3.1-pro-preview'],
].map(([provider, id]) => {
  const model = models.getModel(provider, id);
  assert.ok(model, `Missing bundled Pi model ${provider}/${id}`);
  return model;
});

function wireTools(api, body) {
  if (api === 'google-generative-ai') return (body.tools ?? []).flatMap(t => t.functionDeclarations);
  if (api === 'openai-completions') return (body.tools ?? []).map(t => t.function);
  return body.tools ?? [];
}

// Supply bytes to the actual HTTP client and let both SDKs parse them. Arguments
// use fragmented JSON except on Gemini, whose native surface supplies an object.
function fixtureStream(model, { name, args, text, id = 'call_fixture', omitId = false, googleParts }) {
  const raw = JSON.stringify(args);
  const fragments = raw ? [raw.slice(0, 3), raw.slice(3)] : [];
  const usage = {input_tokens: 18, output_tokens: 7, total_tokens: 25};
  let events;
  let tail = '';
  if (['openai-responses', 'openai-codex-responses'].includes(model.api)) {
    const item = name
      ? {type:'function_call', id:'fc_'+id, call_id:id, name, arguments:raw}
      : {type:'message', id:'msg_'+id, role:'assistant', content:[{type:'output_text', text}]};
    events = [
      {type:'response.output_item.added', output_index:0, item:{...item, ...(name ? {arguments:''} : {content:[]})}},
      ...(name ? fragments.map(delta => ({type:'response.function_call_arguments.delta', item_id:item.id, output_index:0, delta}))
        : [{type:'response.output_text.delta', output_index:0, delta:text}]),
      {type:'response.output_item.done', output_index:0, item},
      {type:'response.completed', response:{id:'resp_'+id, status:'completed', output:[item], usage}},
    ];
  } else if (model.api === 'anthropic-messages') {
    events = [
      {type:'message_start', message:{type:'message', role:'assistant', id:'msg_'+id, model:model.id, content:[], usage}},
      {type:'content_block_start', index:0, content_block:name ? {type:'tool_use', id, name, input:{}} : {type:'text', text:''}},
      ...(name ? fragments.map(partial_json => ({type:'content_block_delta', index:0, delta:{type:'input_json_delta', partial_json}}))
        : [{type:'content_block_delta', index:0, delta:{type:'text_delta', text}}]),
      {type:'content_block_stop', index:0},
      {type:'message_delta', delta:{stop_reason:name ? 'tool_use' : 'end_turn'}, usage},
      {type:'message_stop'},
    ];
  } else if (model.api === 'openai-completions') {
    const deltas = name ? fragments.map((part, index) => ({tool_calls:[{index:0,
      ...(index === 0 ? {id, type:'function'} : {}), function:{...(index === 0 ? {name} : {}), arguments:part}}]}))
      : [{content:text}];
    events = [...deltas, {}].map((delta, index) => ({id, object:'chat.completion.chunk', model:model.id,
      choices:[{index:0, delta, finish_reason:index === deltas.length ? (name ? 'tool_calls' : 'stop') : null}],
      ...(index === deltas.length ? {usage:{prompt_tokens:18, completion_tokens:7, total_tokens:25}} : {})}));
    tail = 'data: [DONE]\n\n';
  } else {
    assert.equal(model.api, 'google-generative-ai');
    const part = name ? {functionCall:{...(omitId ? {} : {id}), name, args}, thoughtSignature:'dGVzdA=='} : {text};
    events = [{responseId:'resp_'+id, candidates:[{index:0, content:{role:'model', parts:googleParts ?? [part]}, finishReason:'STOP'}],
      usageMetadata:{promptTokenCount:18, candidatesTokenCount:7, totalTokenCount:25}}];
  }
  return new Response(events.map(e => (e.type ? 'event: '+e.type+'\n' : '')+'data: '+JSON.stringify(e)+'\n\n').join('')+tail,
    {headers:{'content-type':'text/event-stream'}});
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = undefined; // Exercise the subscription's SSE route entirely offline.
let handler;
globalThis.fetch = async (input, options) => {
  assert.ok(handler, 'Unexpected HTTP request');
  const request = new Request(input, options);
  assert.equal(request.method, 'POST');
  const url = new URL(request.url);
  if (url.hostname === 'chatgpt.com') assert.equal(request.headers.get('chatgpt-account-id'), 'fixture-account');
  const body = request.headers.get('content-encoding') === 'zstd'
    ? JSON.parse(zstdDecompressSync(Buffer.from(await request.arrayBuffer())).toString('utf8')) : await request.json();
  // Archival can wake learning or post-report work before the foreground /start
  // poll sees completion, or even during the next project's provider checks.
  if (url.origin === new URL(backgroundModel.baseUrl).origin && body.model === backgroundModel.id) {
    const tools = wireTools(backgroundModel.api, body);
    const submission = tools.find(tool => tool.name === 'submit_research_result');
    if (submission?.parameters.properties?.action && JSON.stringify(submission.parameters.properties.action).includes('"no-change"')) {
      const args = {action:'no-change'};
      for (const field of ['derivedMetadata', 'processedSources']) {
        if (submission.parameters.required?.includes(field)) args[field] = [];
      }
      return fixtureStream(backgroundModel, {name:submission.name, args});
    }
    // Background stages outside this foreground proof fixture have an offline endpoint.
    return Response.json({error:{message:'No background fixture for this stage'}}, {status:403});
  }
  return handler(url, body);
};

const toolName = 'submit_research_result';
const codec = canonicalCodec({type:'object', properties:{body:{type:'string', minLength:1}}, required:['body'], additionalProperties:false});
const codecs = new Map([[toolName, codec]]);
const schemas = new Map([[toolName, codec.schema]]);

async function auditedCalls(model, fixture) {
  const audit = new ToolArgumentAudit(model.api, schemas, {provider:model.provider, model:model.id, endpoint:model.baseUrl});
  let requests = 0, admissions = 0, delivered;
  const calls = [];
  const signal = new AbortController().signal;
  handler = (url, body) => {
    requests++;
    assert.equal(url.origin, new URL(model.baseUrl).origin);
    const [tool] = wireTools(model.api, body);
    assert.equal(tool.name, toolName);
    assert.deepEqual(tool.parametersJsonSchema ?? tool.input_schema ?? tool.parameters, codec.schema);
    if (model.api === 'google-generative-ai') {
      assert.equal(body.config, undefined);
      assert.equal(body.parallel_tool_calls, undefined);
      assert.ok(url.pathname.endsWith(':streamGenerateContent'));
    }
    return fixtureStream(model, fixture);
  };
  const guardedFetch = (...args) => {
    assert.equal(++admissions, 1, 'Duplicate provider request');
    return globalThis.fetch(...args);
  };
  const stream = withPiFetch(model.api, guardedFetch, customFetch => models.streamSimple(model, {
    messages:[{role:'user', content:'Submit the observation.', timestamp:0}],
    tools:[{name:toolName, description:'Submit the observation.', parameters:codec.schema}],
  }, {
    ...(model.provider === 'openai-codex' ? {} : {apiKey:'fixture-only'}), transport:'sse', maxRetries:0, fetch:customFetch, signal,
    onPayload(payload, target) {
      const finalPayload = structuredOutputPayload(payload, target, codecs);
      if (target.api === 'google-generative-ai') {
        assert.equal(copyProviderPayload(finalPayload).config.abortSignal, signal);
        const snapshot = copyProviderPayload(finalPayload, false);
        assert.ok(!Object.hasOwn(snapshot.config, 'abortSignal'));
        assert.deepEqual(snapshot, JSON.parse(JSON.stringify(snapshot)));
        assert.notEqual(snapshot.config.tools, finalPayload.config.tools);
      }
      audit.captureRemoteTools(finalPayload);
      return finalPayload;
    },
    onProviderStreamEvent(event) { audit.observeProvider(event); },
  }));
  for await (const event of stream) {
    if (event.type === 'error') throw Error(event.error.errorMessage);
    const result = audit.observe(event);
    if (result) calls.push(result);
    if (event.type === 'done') delivered = event.message;
  }
  assert.equal(requests, 1);
  assert.equal(admissions, 1);
  assert.equal(delivered?.stopReason, 'toolUse');
  assert.deepEqual(calls.map(e => e.toolCallId), delivered.content.filter(block => block.type === 'toolCall').map(block => block.id));
  return {calls, remaining:audit.drain()};
}

async function checkArguments(model, valid, omitId = false) {
  const args = {body:valid ? 'A ⇒ B given α.' : 37};
  const {calls, remaining} = await auditedCalls(model, {name:toolName, args, omitId});
  assert.equal(calls.length, 1);
  const [evidence] = calls;
  if (model.api === 'google-generative-ai') {
    if (omitId) assert.match(evidence.toolCallId, /^submit_research_result_\d+_\d+$/);
    else assert.equal(evidence.toolCallId, 'call_fixture');
  }
  assert.deepEqual(remaining, []);
  assert.equal(evidence.identityValid, true);
  assert.equal(evidence.sdkMatchesRaw, true);
  assert.equal(evidence.rawSchemaValid, valid);
  assert.equal(evidence.remoteSchemaValid, valid);
  assert.deepEqual(evidence.remoteSchema, codec.schema);
  const value = decodeSafeToolArguments(evidence).value;
  if (valid) assert.deepEqual(codec.decode(value), args);
  else assert.throws(() => codec.decode(value), ContractValidationError);
}

async function checkGeminiIdentity(model) {
  const values = [{body:'First observation.'}, {body:'Second observation.'}];
  const parts = values.map(args => ({functionCall:{name:toolName, args}}));
  const paired = await auditedCalls(model, {googleParts:parts});
  assert.deepEqual(paired.remaining, []);
  assert.equal(new Set(paired.calls.map(row => row.toolCallId)).size, 2);
  assert.deepEqual(paired.calls.map(row => codec.decode(decodeSafeToolArguments(row).value)), values);
  const repeatedId = parts.map(({functionCall}) => ({functionCall:{...functionCall, id:'duplicate'}}));
  const duplicate = await auditedCalls(model, {googleParts:repeatedId});
  assert.equal(duplicate.calls.length, 2);
  assert.throws(() => decodeSafeToolArguments(duplicate.calls[1]), {name:'SafeToolArgumentsError'});
  const partial = await auditedCalls(model, {googleParts:[{functionCall:{name:toolName, args:values[0], willContinue:true}}]});
  assert.equal(partial.calls.length, 1);
  assert.throws(() => decodeSafeToolArguments(partial.calls[0]), {name:'SafeToolArgumentsError'});
  console.log('PASS Gemini call identity preserves ordered ID-less arguments and rejects duplicate IDs and partial calls');
}

const title = 'Parity of a quadratic function';
const manuscript = 'For every real x, f(-x) = (-x)^2 = x^2 = f(x). Thus f is even.';
const declaration = {action:'complete', route:{methodKey:'parity', description:title, reason:'Use the definition.', resourceRefs:[]},
  outcome:{resultKind:'supported-result', scope:'root', gaps:[], dependencyArtifactIds:[], reason:'The identity holds for every real x.', reproducible:true}};

async function checkConcurrentTransport() {
  const gate = Promise.withResolvers();
  let arrivals = 0;
  handler = (url, body) => {
    assert.equal(url.hostname, 'fixture.invalid');
    return Response.json({via:'default', value:body.value});
  };
  const post = value => fetch('https://fixture.invalid/probe', {method:'POST', body:JSON.stringify({value})});
  async function scoped(label) {
    let admitted = false;
    return withPiFetch('google-generative-ai', async (...args) => {
      if (admitted) throw Error('Duplicate request blocked for '+label);
      admitted = true;
      const response = await globalThis.fetch(...args);
      return Response.json({via:label, value:(await response.json()).value});
    }, async customFetch => {
      assert.equal(customFetch, undefined);
      if (++arrivals === 2) gate.resolve();
      await gate.promise;
      assert.deepEqual(await (await post(label)).json(), {via:label, value:label});
      await assert.rejects(post(label), {message:'Duplicate request blocked for '+label});
    });
  }
  const scopes = Promise.all([scoped('first'), scoped('second')]);
  assert.deepEqual(await (await post('unrelated')).json(), {via:'default', value:'unrelated'});
  await scopes;
}

async function checkProject(app, model) {
  const api = async (method, url, payload) => {
    const res = await app.inject({method, url, payload, headers:{'x-carnot-token':app.carnot.requestToken}});
    assert.ok(res.statusCode < 300, res.body);
    return res.json();
  };
  if (model.provider !== 'openai-codex') await api('POST', '/api/providers/key', {provider:model.provider, key:'fixture-only'});
  const foreground = {provider:model.provider, modelId:model.id, thinkingLevel:'medium'};
  const config = (await api('GET', '/api/bootstrap')).researchDefaults['4.0'];
  await api('PUT', '/api/preferences', {defaultModel:backgroundSelection, researchDefaults:{'4.0':{...config, roleModels:{
    theorist:foreground, worker:foreground, moderator:backgroundSelection, learning:backgroundSelection,
    report:backgroundSelection, mapMaintenance:backgroundSelection,
  }}}});
  const project = await api('POST', '/api/projects', {name:'New research', researchLoopVersion:'4.0', hypothesis:'Prove that x² is even.'});
  const steps = [];
  handler = (url, body) => {
    assert.equal(url.origin, new URL(model.baseUrl).origin);
    if (model.api === 'google-generative-ai') assert.ok(url.pathname.includes('/models/'+model.id+':'));
    else assert.equal(body.model, model.id);
    const names = wireTools(model.api, body).map(t => t.name);
    const step = steps.push(names);
    assert.ok(step <= 2, 'Unexpected research dispatch '+step);
    if (step === 1) {
      const declaration=wireTools(model.api,body).find(tool=>tool.name==='submit_manuscript');
      const schema=declaration.parameters??declaration.input_schema??declaration.parametersJsonSchema;
      assert.deepEqual(schema.required,['answer']);
      return fixtureStream(model,{name:'submit_manuscript',args:{answer:{markdown:manuscript}},id:'manuscript',omitId:model.provider==='google'});
    }
    assert.ok(names.includes(toolName));
    assert.deepEqual(names, [toolName]);
    if(model.provider==='google')assert.deepEqual(body.toolConfig.functionCallingConfig,{mode:'ANY',allowedFunctionNames:[toolName]});
    if(model.provider==='openai')assert.deepEqual(body.tool_choice,{type:'function',name:toolName});
    return fixtureStream(model, {name:toolName, args:declaration, id:'call_'+step, omitId:model.provider === 'google'});
  };
  await api('POST', '/api/projects/'+project.id+'/start', {});
  for (let n=0; n<300 && (await app.carnot.activeProjectIds()).includes(project.id); n++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = await api('GET', '/api/projects/'+project.id);
  assert.equal(result.status, 'completed', JSON.stringify({error:result.lastError, status:result.status, steps}));
  assert.equal(result.name, title);
  assert.equal(steps.length, 2, JSON.stringify(steps));
  return project.id;
}

let dir, app;
try {
  dir = await mkdtemp(join(tmpdir(), 'cage-provider-regression-'));
  process.env.PI_CODING_AGENT_DIR = join(dir, 'agent');
  // A signed-in subscription is a persisted Pi OAuth credential. Seed a private
  // temporary workspace with a syntactically parseable, unusable fixture token.
  const authDir = join(dir, 'pi', 'auth');
  await mkdir(authDir, {recursive:true});
  await writeFile(join(authDir, 'auth.json'), JSON.stringify({'openai-codex':subscription}), {flag:'wx', mode:0o600});
  const {createApp} = await import('../dist/server/app.js');
  app = await createApp({dataRoot:dir});
  await checkConcurrentTransport();
  console.log('PASS overlapping Gemini transports isolate request guards and block duplicate requests');
  const projects = [];
  for (const model of targets) {
    await checkArguments(model, true);
    await checkArguments(model, false);
    if (model.provider === 'google') { await checkArguments(model, true, true); await checkGeminiIdentity(model); }
    console.log(`PASS ${model.provider}/${model.id} (${model.api}) accepts valid and rejects invalid tool arguments`);
    projects.push(await checkProject(app, model));
    console.log(`PASS ${model.provider}/${model.id} V4 project completed through /start`);
  }
  const answers = await Promise.all((await readdir(join(dir,'raw-answers'))).map(async name =>
    JSON.parse(await readFile(join(dir,'raw-answers',name),'utf8'))));
  const archived = answers.filter(row => row.body === manuscript && row.ref.completeness === 'complete');
  assert.deepEqual(archived.map(row => row.ref.projectId).sort(), projects.sort());
  console.log(`PASS ${targets.length} completed manuscripts archived; zero external requests`);
} finally {
  try { if (app) { await app.carnot.shutdown(); await app.close(); } }
  finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    if (dir) await rm(dir, {recursive:true, force:true, maxRetries:8, retryDelay:150});
  }
}
