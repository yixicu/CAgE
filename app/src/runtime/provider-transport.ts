import { AsyncLocalStorage } from 'node:async_hooks';

const googleFetch = new AsyncLocalStorage<typeof fetch>();
let dispatcher: typeof fetch | undefined;

/** Pi's Gemini SDK calls global fetch and rejects a per-request fetch option.
 * Keep the existing CAgE admission and HTTP checks scoped to this SDK call.
 * Other async chains go straight to the original fetch, including overlapping runs. */
export function withPiFetch<T>(api: string, fetcher: typeof fetch, invoke: (customFetch?: typeof fetch) => T): T {
  if (api !== 'google-generative-ai') return invoke(fetcher);
  if (!dispatcher || globalThis.fetch !== dispatcher) {
    const original = globalThis.fetch;
    dispatcher = (...args) => {
      const scoped = googleFetch.getStore();
      return scoped ? googleFetch.exit(() => scoped(...args)) : original(...args);
    };
    globalThis.fetch = dispatcher;
  }
  return googleFetch.run(fetcher, () => invoke());
}

/** The SDK includes a live AbortSignal in Gemini's config. Keep it attached to
 * the request when copying other fields for comparison or token accounting. */
export function copyProviderPayload(payload: unknown, keepSignal = true): Record<string, unknown> {
  const body = payload as Record<string, unknown>;
  const config = body?.config as Record<string, unknown> | undefined;
  if (!config?.abortSignal) return structuredClone(body);
  const { abortSignal, ...settings } = config;
  const copy = structuredClone({ ...body, config: settings });
  return keepSignal ? { ...copy, config: { ...copy.config, abortSignal } } : copy;
}

export function providerTools(payload: unknown): unknown[] | undefined {
  const body = payload as { tools?: unknown[]; config?: {tools?: unknown[]} } | undefined;
  return body?.tools ?? body?.config?.tools;
}

/** Observe status before SDKs throw on non-2xx responses. Preserve the response body,
 * configured fetch (including test guards), cancellation and provider SDK ownership. */
export function observeHttpStatus(fetcher: typeof fetch, observe: (status:number)=>void): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    observe(response.status);
    return response;
  };
}

/** Only an explicit pre-inference client rejection is eligible for context recovery. */
export function isProviderContextRejection(status:number,message:string):boolean{
 if(![400,413,422].includes(status)||/rate limit|too many requests|throttl/i.test(message))return false;
 return /context[_ ]length[_ ]exceeded|context_window_exceeded|(?:input|prompt) (?:is )?too long|exceeds (?:the |this model.s |model.s )?(?:maximum )?context (?:length|window|size)|maximum context length is [\d,]+ tokens|input token count.{0,50}exceeds the maximum|prompt token count.{0,50}exceeds the limit|exceeds the available context size/i.test(message);
}
export function contextRequestSize(payload:unknown){
  const body=copyProviderPayload(payload);
 let output=0;
  for(const owner of [body,body?.config,body?.generationConfig,body?.inferenceConfig]){
  if(!owner||typeof owner!=='object')continue;
  const config=owner as Record<string,unknown>;
  for(const key of ['max_tokens','max_completion_tokens','max_output_tokens','maxOutputTokens','maxTokens']){
   if(typeof config[key]==='number'){output=Math.max(output,config[key]);delete config[key];}
  }
 }
 return {bytes:Buffer.byteLength(JSON.stringify(body)),output};
}

export function smallerContextRequest(previous:ReturnType<typeof contextRequestSize>,next:ReturnType<typeof contextRequestSize>){
 return next.bytes<=previous.bytes&&next.output<=previous.output&&(next.bytes<previous.bytes||next.output<previous.output);
}
