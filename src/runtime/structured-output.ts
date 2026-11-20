import { RuntimeError } from './errors.js';
import { handoffVersion, type SchemaCodec } from './strict-schema.js';
export interface StrictCapability {
  /** Explicitly attested at the endpoint/model boundary; never inferred from valid JSON. */
  supported: true;
  protocol: 'chat-tools' | 'response-tools' | 'anthropic-tools';
  baseUrl?: string;
}
type Target={provider:string;api:string;baseUrl:string};
/** Protocol-level adapters: all stages/providers share the contract and acceptance code. */
export function strictCapability(model:Target,configured?:StrictCapability):StrictCapability {
  const protocol=model.api==='openai-completions'?'chat-tools': ['openai-responses','azure-openai-responses','openai-codex-responses'].includes(model.api)?'response-tools':model.api==='anthropic-messages'?'anthropic-tools':undefined;
  if(configured){if(configured.supported!==true || configured.protocol!==protocol)throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');return configured;}
  let url:URL;try{url=new URL(model.baseUrl);}catch{throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');}
  if(url.protocol==='https:' && url.hostname==='api.openai.com' && ['openai-completions','openai-responses'].includes(model.api))return {supported:true,protocol:protocol!};
  if(url.protocol==='https:' && url.hostname==='api.anthropic.com' && protocol==='anthropic-tools')return {supported:true,protocol};
  // Endpoint capability, not research logic or a per-model prompt workaround.
  if(url.protocol==='https:' && url.hostname==='api.deepseek.com' && protocol==='chat-tools' && ['/','/v1','/beta','/v1/','/beta/'].includes(url.pathname))return {supported:true,protocol,baseUrl:'https://api.deepseek.com/beta'};
  throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');
}
export function strictProviderModel<T extends Target>(model:T,configured?:StrictCapability):T {
  const capability=strictCapability(model,configured);
  return {...model,...(capability.baseUrl?{baseUrl:capability.baseUrl}:{})};
}
export function structuredOutputPayload(payload:unknown,model:Target,codecs:ReadonlyMap<string,SchemaCodec>,configured?:StrictCapability, version: import('./strict-schema.js').HandoffVersion = 'cage-native-2'):unknown {
  handoffVersion(version);
  const protocol=model.api==='openai-completions'?'chat-tools':['openai-responses','azure-openai-responses','openai-codex-responses'].includes(model.api)?'response-tools':model.api==='anthropic-messages'?'anthropic-tools':undefined;
  if (!protocol) throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');
  const capability=version==='cage-strict-1'?strictCapability(model,configured):{supported:true as const,protocol};
  if(!payload || typeof payload!=='object' || Array.isArray(payload))throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');
  const body={...payload} as Record<string,unknown>;delete body.response_format;
  const tools=body.tools as Record<string,any>[]|undefined;
  if(!tools?.length)throw new RuntimeError('STRICT_OUTPUT_UNSUPPORTED');
  body.tools=tools.map(tool=>{
    const declaration=capability.protocol==='chat-tools'?tool.function:tool;
    if(!declaration || (capability.protocol!=='anthropic-tools' && tool.type!=='function'))throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
    const codec=codecs.get(declaration.name);if(!codec)throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
    const converted={...declaration,...(capability.protocol==='anthropic-tools'?{input_schema:codec.schema}:{parameters:codec.schema})};
    if(version==='cage-strict-1')converted.strict=true;else delete converted.strict;
    return capability.protocol==='chat-tools'?{...tool,function:converted}:converted;
  });
  // Auto works with thinking models; text is never accepted as delivery.
  if(capability.protocol==='anthropic-tools')body.tool_choice={type:'auto',disable_parallel_tool_use:true};
  else {body.parallel_tool_calls=false;body.tool_choice='auto';}
  return body;
}
