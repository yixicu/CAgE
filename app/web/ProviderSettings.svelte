<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, type ProviderStatus, type OAuthFlow, type ModelDescriptor, type AppPreferences } from './api';
  import type { ModelSelection } from '../src/engine/types';
  import ModelPicker from './ModelPicker.svelte';
  import LearningFallbackSettings from './LearningFallbackSettings.svelte';
  let { config, providers, models, defaultModel, preferences, onchange }: { config: import('./api').Bootstrap['researchDefaults']['4.0']; providers: ProviderStatus[]; models: ModelDescriptor[]; defaultModel?: ModelSelection; preferences: AppPreferences; onchange: () => Promise<void> } = $props();
  let model = $state<ModelSelection | undefined>(untrack(() => defaultModel ? { ...defaultModel } : undefined));
  let modelDirty = $state(false);
  $effect(() => { if (!modelDirty) model = defaultModel ? { ...defaultModel } : undefined; });
  let maintenanceModel=$state<ModelSelection>();
  $effect(()=>{if(!modelDirty)maintenanceModel=preferences.maintenanceModel});
  import { v4ModelBindings, v4ModelLabels, v4StageOwners, type V4Stage } from '../src/research/versions/v4/model-bindings';
  let overrides = $state({ ...untrack(()=>config.roleModels) });
  $effect(()=>{if(!modelDirty) overrides={...config.roleModels}});
  let selected = $state('');
  let key = $state('');
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  let flow = $state<OAuthFlow | undefined>();
  let response = $state('');
  let reopened = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let provider = $derived(providers.find(item => item.id === selected));
  let authUrl = $derived(flow?.url && /^https?:\/\//i.test(flow.url) ? flow.url : undefined);
  const desktop = !!(window as Window & { __CARNOT_DESKTOP_VERSION__?: string }).__CARNOT_DESKTOP_VERSION__;
  async function signIn(method?: 'browser' | 'device_code') {
    await run(async () => {
      flow = await api.beginOAuth(selected, 'oauth', method);
      response = '';
      void poll();
    });
  }
  const terminal = (status: string) => ['connected', 'failed', 'cancelled'].includes(status);
  onDestroy(() => { disposed = true; key = ''; response = ''; if (timer) clearTimeout(timer); if (flow && !terminal(flow.status)) void api.cancelOAuth(flow.id).catch(() => {}); });
  async function run(action: () => Promise<void>) {
    busy = true; error = ''; message = '';
    try { await action(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Provider operation failed.'; } finally { busy = false; }
  }
  async function poll() {
    if (!flow || terminal(flow.status) || disposed) return;
    const id = flow.id;
    try {
      const next = await api.oauth(id);
      if (disposed || flow?.id !== id) return;
      flow = next;
      if (next.status === 'connected') { await onchange(); message = 'Provider connected for all CAgE projects. Choose a default model below.'; response = ''; }
      if (next.status === 'failed') error = next.error || 'CAgE provider sign-in failed. You can cancel and retry.';
    } catch { if (!disposed) error = 'Sign-in status is unavailable. Check the backend connection.'; }
    if (!disposed && flow && !terminal(flow.status)) timer = setTimeout(() => void poll(), 2000);
  }
  async function saveKey(event: SubmitEvent) {
    event.preventDefault();
    await run(async () => {
      const secret = key; key = '';
      await api.saveKey(selected, secret); await onchange();
      message = 'Provider connected for all CAgE projects. Choose a default model below.';
    });
  }
</script>
<section class="settings-panel">
  <h2>Connections</h2>
  <div class="provider-list">{#each providers.filter(item => item.configured) as item}<button onclick={() => selected = item.id}><span class="provider-avatar">{item.name[0]}</span><strong>{item.name}</strong><span class="connected-label">Connected</span></button>{/each}</div>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if message}<p class="notice success" role="status">{message}</p>{/if}
  <label>Provider<select aria-label="Provider" bind:value={selected} disabled={busy || !!flow && !terminal(flow.status)} onchange={() => { key = ''; message = ''; error = ''; }}>
    <option value="">Choose a provider</option>
    {#each providers as item (item.id)}<option value={item.id}>{item.name} · {item.configured ? 'connected' : 'not connected'}</option>{/each}
  </select></label>
  {#if provider}
    <form onsubmit={saveKey} class="provider-form">
      {#if provider.id === 'cage-subagents'}<p>Start the bundled subagent host in your Codex session, then enter its pairing key.</p>{/if}
      {#if provider.apiKeySupported !== false}<label>{provider.id === 'cage-subagents' ? 'Host pairing key' : 'API key'}<input type="password" bind:value={key} autocomplete="off" placeholder="Enter a new key" disabled={busy || !!flow && !terminal(flow.status)} required /></label>{/if}
      <div class="inline-actions">
        {#if provider.apiKeySupported !== false}<button class="primary" type="submit" disabled={busy || !key || !!flow && !terminal(flow.status)}>{provider.id === 'cage-subagents' ? 'Pair host' : 'Save API key'}</button>{#if provider.id !== 'cage-subagents'}<button type="button" disabled={busy || !!flow && !terminal(flow.status)} onclick={() => run(async () => { key = ''; flow = await api.beginOAuth(selected, 'api_key'); response = ''; void poll(); })}>Guided API-key connection</button>{/if}{/if}
        {#if provider.oauthSupported}<button type="button" disabled={busy || !!flow && !terminal(flow.status)} onclick={() => signIn()}>Sign in with {provider.name}</button>{/if}
        {#if desktop && provider.oauthSupported && provider.id === 'openai-codex'}<button type="button" disabled={busy || !!flow && !terminal(flow.status)} onclick={() => signIn('device_code')}>Use device code</button>{/if}
        {#if provider.configured}<button type="button" class="danger-text" disabled={busy || !!flow && !terminal(flow.status)} onclick={() => run(async () => { await api.disconnect(selected); await onchange(); message = 'Provider disconnected for all CAgE projects.'; })}>Disconnect</button>{/if}
      </div>
    </form>
  {/if}
  {#if flow}
    <div class="oauth-box">
      <h3>CAgE sign-in: {flow.status.replaceAll('_', ' ')}</h3>
      {#if flow.instructions}<p>{flow.instructions}</p>{/if}
      {#if flow.userCode}<p>Device code: <strong>{flow.userCode}</strong></p>{/if}
      {#if authUrl && !terminal(flow.status)}
        {#if desktop}
          {#if flow.browserFailed && reopened !== flow.id}<p role="status">The default browser could not open. Retry or copy the link into your browser.</p>{/if}
          <div class="inline-actions">
            <button disabled={busy} onclick={() => run(async () => { const id = flow!.id; await api.openOAuth(id); reopened = id; })}>Open in default browser ↗</button>
            <button onclick={() => run(async () => { await navigator.clipboard.writeText(authUrl!); message = 'Sign-in link copied.'; })}>Copy sign-in link</button>
          </div>
        {:else}<a class="button-link" href={authUrl} target="_blank" rel="noopener noreferrer">Open provider sign-in ↗</a>{/if}
      {/if}
      {#if flow.prompt}
        <form onsubmit={event => { event.preventDefault(); void run(async () => { const value = response; response = ''; flow = await api.answerOAuth(flow!.id, value); }); }}>
          <label>{typeof flow.prompt === 'string' ? flow.prompt : flow.prompt.message || 'Provider response'}
            {#if typeof flow.prompt !== 'string' && flow.prompt.options?.length}
              <select bind:value={response} required><option value="">Choose</option>{#each flow.prompt.options as option}<option value={option.id}>{option.label}</option>{/each}</select>
            {:else}<input type={typeof flow.prompt !== 'string' && flow.prompt.type === 'secret' ? 'password' : 'text'} bind:value={response} autocomplete="off" required />{/if}
          </label>
          <button type="submit" disabled={busy || !response}>Continue sign-in</button>
        </form>
      {/if}
      {#if !terminal(flow.status)}<button disabled={busy} onclick={() => run(async () => { await api.cancelOAuth(flow!.id); flow = undefined; response = ''; if (timer) clearTimeout(timer); })}>Cancel sign-in</button>{/if}
    </div>
  {/if}
  <form class="default-model-form" onsubmit={event => { event.preventDefault(); void run(async () => { const next = { ...preferences, maintenanceModel, researchDefaults:{...preferences.researchDefaults,'4.0':{...config,roleModels:{...overrides}}} }; if (model) next.defaultModel = model; else delete next.defaultModel; await api.preferences(next); await onchange(); modelDirty = false; message = 'Model settings saved.'; }); }}>
    <fieldset class="flat-fieldset" disabled={busy}>
      <ModelPicker label="CAgE default model" value={model} {models} onchange={value => { modelDirty = true; model = value; }} />
      <h3>V4 agent models</h3>
      {#each v4ModelBindings as role}
        <ModelPicker label={v4ModelLabels[role]} inheritLabel={role in v4StageOwners ? 'Inherit '+v4ModelLabels[v4StageOwners[role as V4Stage]]+' model' : undefined} value={overrides[role]} {models} inherit onchange={value=>{modelDirty=true;if(value)overrides[role]=value;else delete overrides[role]}}/>
      {/each}
      <ModelPicker label="Maintenance Assistant" value={maintenanceModel} {models} inherit onchange={v=>{modelDirty=true;maintenanceModel=v}}/>
      <button class="primary" type="submit" disabled={!!model && !models.some(item => item.provider === model?.provider && item.id === model?.modelId)}>Save models</button>
    </fieldset>
  </form>
  <LearningFallbackSettings {preferences} {models} {onchange} />
</section>
