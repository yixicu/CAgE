import { globalAgent, type Agent, type AgentOptions } from 'node:http';
import { Agent as HttpClient, EnvHttpProxyAgent, install, setGlobalDispatcher } from 'undici';

// Use the locked client and socket pool even when the host Node bundles an older Undici.
// Node sets proxyEnv on its global HTTP agent when environment proxy support is active.
const { proxyEnv } = (globalAgent as Agent & { options: AgentOptions }).options;
setGlobalDispatcher(proxyEnv ? new EnvHttpProxyAgent() : new HttpClient());
install();
