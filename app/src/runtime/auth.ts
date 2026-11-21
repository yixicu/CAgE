import './oauth-branding.js';
import { registerPublicCatalog } from './public-model-catalog.js';
import { checkSubagentHost } from './subagent-provider.js';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai';
import { RuntimeError } from './errors.js';

export interface ProviderView { id: string; name: string; apiKey: boolean; oauth: boolean; catalogRefreshSupported: boolean; connected: boolean; credentialType?: AuthType }
export interface ModelView { provider: string; id: string; name: string; reasoning: boolean; contextWindow: number; maxTokens: number }
export interface LoginView {
  id: string; provider: string; type: AuthType;
  status: 'pending' | 'awaiting_input' | 'connected' | 'failed' | 'cancelled';
  browserFailed?: boolean; url?: string; userCode?: string; expiresAt: number;
  prompt?: { type: AuthPrompt['type']; message: string; options?: { id: string; label: string }[] };
  error?: string;
}
interface LoginRecord { view: LoginView; controller: AbortController; timer: ReturnType<typeof setTimeout>; pending?: { resolve(value: string): void; reject(error: Error): void; cleanup(): void } }

/** Backend-only facade over Pi's supported auth flows and official plaintext credential store. */
export class CAgEAuthManager {
  private readonly catalogRequests = new Map<string, Promise<number>>();
  private readonly logins = new Map<string, LoginRecord>();
  private constructor(private readonly models: ModelRuntime, private readonly authDir: string, private readonly deviceId: string) {}
  static async create(models: ModelRuntime, authDir: string): Promise<CAgEAuthManager> {
    await mkdir(authDir, { recursive: true, mode: 0o700 });
    const path = join(authDir, 'device-id');
    let id: string;
    try { id = (await readFile(path, 'utf8')).trim(); if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(); }
    catch { id = randomUUID(); await writeFile(path, id, { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw new RuntimeError('AUTH_FAILED'); id = (await readFile(path, 'utf8')).trim(); }); }
    return new CAgEAuthManager(models, authDir, id);
  }
  async listProviders(): Promise<ProviderView[]> {
    const credentials = new Map((await this.models.listCredentials()).map(item => [item.providerId, item.type]));
    return this.models.getProviders().map(provider => ({ id: provider.id, name: provider.name,
      apiKey: !!provider.auth.apiKey?.login, oauth: !!provider.auth.oauth,
      catalogRefreshSupported: !!provider.refreshModels,
      connected: credentials.has(provider.id), ...(credentials.has(provider.id) ? { credentialType: credentials.get(provider.id)! } : {}),
    }));
  }
  listModels(provider?: string): ModelView[] {
    return this.models.getModels(provider).map(model => ({ provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens }));
  }
  async refreshModelCatalog(provider: string): Promise<number> {
    if (!this.models.getProvider(provider)?.refreshModels) throw new RuntimeError('MODEL_CATALOG_UNSUPPORTED');
    if (!(await this.hasStoredCredential(provider))) throw new RuntimeError('AUTH_REQUIRED');
    if (process.env.PI_OFFLINE !== undefined) throw new RuntimeError('MODEL_CATALOG_OFFLINE');
    const pending = this.catalogRequests.get(provider);
    if (pending) return pending;
    registerPublicCatalog(this.models, provider);
    const request = this.models.refresh({ providers: [provider], force: true, allowNetwork: true, signal: AbortSignal.timeout(20000) })
      .then(result => {
        if (result.aborted || result.errors.has(provider)) throw new RuntimeError('MODEL_CATALOG_FAILED');
        return this.models.getModels(provider).length;
      })
      .catch(() => { throw new RuntimeError('MODEL_CATALOG_FAILED'); })
      .finally(() => this.catalogRequests.delete(provider));
    this.catalogRequests.set(provider, request);
    return request;
  }
  async hasStoredCredential(provider: string): Promise<boolean> { return (await this.models.listCredentials()).some(item => item.providerId === provider); }
  private assertMethod(provider: string, type: AuthType): void {
    const auth = this.models.getProvider(provider)?.auth;
    if (type !== 'api_key' && type !== 'oauth') throw new RuntimeError('AUTH_UNSUPPORTED');
    if (!auth || (type === 'oauth' ? !auth.oauth : !auth.apiKey?.login)) throw new RuntimeError('AUTH_UNSUPPORTED');
  }
  /** Only suited to providers whose official login asks for one secret. Complex providers use startLogin. */
  async saveApiKey(provider: string, key: string): Promise<void> {
    this.assertMethod(provider, 'api_key');
    validateSecret(key);
    let supplied = false;
    try {
      if (provider === 'cage-subagents') await checkSubagentHost(key);
      await this.models.login(provider, 'api_key', {
        prompt: async prompt => { if (prompt.type !== 'secret' || supplied) throw new RuntimeError('AUTH_INPUT_REQUIRED'); supplied = true; return key; },
        notify: () => {},
      }, { agentName: 'CAgE', getDeviceId: () => this.deviceId });
      await this.protectAuthFile();
    } catch (error) { throw error instanceof RuntimeError ? error : new RuntimeError('AUTH_FAILED'); }
  }
  startLogin(provider: string, type: AuthType = 'oauth', desktop?: { open(url: string): Promise<void>; method?: 'browser' | 'device_code' }): LoginView {
    if (provider === 'cage-subagents') throw new RuntimeError('AUTH_UNSUPPORTED');
    this.assertMethod(provider, type);
    // One in-flight login per provider; never let repeated UI clicks create multiple callbacks.
    for (const record of this.logins.values()) if (record.view.provider === provider && ['pending', 'awaiting_input'].includes(record.view.status)) return copy(record.view);
    const id = randomUUID();
    const controller = new AbortController();
    const record: LoginRecord = { controller, view: { id, provider, type, status: 'pending', expiresAt: Date.now() + 10 * 60_000 }, timer: setTimeout(() => this.cancelLogin(id), 10 * 60_000) };
    record.timer.unref?.();
    this.logins.set(id, record);
    void this.models.login(provider, type, { signal: controller.signal,
      notify: event => {
        const previous = record.view.url;
        this.notify(record, event);
        const url = record.view.url;
        if (desktop && url && url !== previous) {
          void desktop.open(url).catch(() => { if (record.view.url === url) record.view.browserFailed = true; });
        }
      },
      prompt: prompt => {
        if (desktop && provider === 'openai-codex' && type === 'oauth' && prompt.type === 'select' &&
            prompt.options.some(o => o.id === 'browser') && prompt.options.some(o => o.id === 'device_code')) {
          return Promise.resolve(desktop.method ?? 'browser');
        }
        return this.prompt(record, prompt);
      },
    }, { agentName: 'CAgE', getDeviceId: () => this.deviceId }).then(async () => {
      if (controller.signal.aborted) return;
      await this.protectAuthFile();
      this.finish(record, 'connected');
    }).catch(error => {
      if (controller.signal.aborted) return;
      this.finish(record, 'failed');
      record.view.error = provider === 'openai' && error instanceof Error && error.message.startsWith('Port 1455 is in use')
        ? 'Another sign-in is using callback port 1455. Finish or cancel it, then try again.'
        : new RuntimeError('AUTH_FAILED').message;
    });
    return copy(record.view);
  }
  getLogin(id: string): LoginView { const record = this.logins.get(id); if (!record) throw new RuntimeError('AUTH_CANCELLED'); return copy(record.view); }
  answerLogin(id: string, value: string): LoginView {
    const record = this.logins.get(id);
    if (!record?.pending || record.controller.signal.aborted || record.view.status !== 'awaiting_input') throw new RuntimeError('AUTH_CANCELLED');
    if (typeof value !== 'string' || !value.trim() || value.length > 16384) throw new RuntimeError('INVALID_CONFIGURATION');
    if (record.view.prompt?.type === 'secret') validateSecret(value);
    if (record.view.prompt?.type === 'select' && !record.view.prompt.options?.some(option => option.id === value)) throw new RuntimeError('INVALID_CONFIGURATION');
    const pending = record.pending; record.pending = undefined; pending.cleanup();
    delete record.view.prompt; record.view.status = 'pending'; pending.resolve(value);
    return copy(record.view);
  }
  cancelLogin(id: string): void {
    const record = this.logins.get(id); if (!record || ['connected', 'failed', 'cancelled'].includes(record.view.status)) return;
    record.controller.abort();
    record.pending?.reject(new RuntimeError('AUTH_CANCELLED')); record.pending?.cleanup(); record.pending = undefined;
    this.finish(record, 'cancelled');
  }
  async logout(provider: string): Promise<void> {
    for (const record of this.logins.values()) if (record.view.provider === provider) this.cancelLogin(record.view.id);
    try { await this.models.logout(provider); } catch { throw new RuntimeError('AUTH_FAILED'); }
  }
  dispose(): void { for (const id of this.logins.keys()) this.cancelLogin(id); this.logins.clear(); }
  private async protectAuthFile(): Promise<void> { if (process.platform !== 'win32') await chmod(join(this.authDir, 'auth.json'), 0o600); }
  private finish(record: LoginRecord, status: LoginView['status']): void {
    clearTimeout(record.timer); record.pending?.cleanup(); record.pending = undefined;
    record.view = { id: record.view.id, provider: record.view.provider, type: record.view.type, status, expiresAt: record.view.expiresAt };
    // Only retain safe completion metadata briefly, not device codes or authorization links.
    record.timer = setTimeout(() => this.logins.delete(record.view.id), 5 * 60_000); record.timer.unref?.();
  }
  private notify(record: LoginRecord, event: AuthEvent): void {
    if (record.controller.signal.aborted) return;
    // Raw progress/info strings are intentionally discarded: providers can include error bodies.
    if (event.type === 'auth_url') record.view.url = checkedLoginUrl(event.url);
    if (event.type === 'device_code') { record.view.url = checkedLoginUrl(event.verificationUri); record.view.userCode = event.userCode.slice(0, 128); }
  }
  private prompt(record: LoginRecord, prompt: AuthPrompt): Promise<string> {
    if (record.controller.signal.aborted || prompt.signal?.aborted) return Promise.reject(new RuntimeError('AUTH_CANCELLED'));
    record.view.status = 'awaiting_input';
    record.view.prompt = { type: prompt.type, message: safePromptLabel(prompt, record.view.provider), ...(prompt.type === 'select' ? { options: prompt.options.map(option => ({ id: option.id, label: option.label.slice(0, 160) })) } : {}) };
    return new Promise((resolve, reject) => {
      const abort = () => { record.pending = undefined; delete record.view.prompt; if (!record.controller.signal.aborted) record.view.status = 'pending'; cleanup(); reject(new RuntimeError('AUTH_CANCELLED')); };
      const cleanup = () => { record.controller.signal.removeEventListener('abort', abort); prompt.signal?.removeEventListener('abort', abort); };
      record.pending = { resolve, reject, cleanup };
      record.controller.signal.addEventListener('abort', abort, { once: true }); prompt.signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
function validateSecret(value: string): void {
  // Pi supports shell-backed configured keys; Carnot accepts literal secrets only.
  if (typeof value !== 'string' || !value.trim() || value.length > 16384 || value.trimStart().startsWith('!') || /[\r\n\0]/.test(value)) throw new RuntimeError('INVALID_CONFIGURATION');
}
function checkedLoginUrl(value: string): string { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || /(?:access_token|refresh_token)=/i.test(value)) throw new RuntimeError('AUTH_FAILED'); return url.href; }
function safePromptLabel(prompt: AuthPrompt, provider: string): string {
  if (prompt.type === 'secret') return 'Enter the credential requested by this provider. It is stored only by the backend.';
  if (prompt.type === 'manual_code' && provider === 'openai') return 'Paste the full callback URL from the provider sign-in page.';
  if (prompt.type === 'manual_code') return 'Paste the authorization code or callback URL from the provider sign-in page.';
  // Official provider field prompts are required for multi-field API-key setup; never echo answers.
  return prompt.message.slice(0, 400);
}
function copy(view: LoginView): LoginView { return structuredClone(view); }
