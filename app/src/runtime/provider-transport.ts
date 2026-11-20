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
 const body=structuredClone(payload) as Record<string,unknown>;
 let output=0;
 for(const owner of [body,body?.generationConfig,body?.inferenceConfig]){
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
