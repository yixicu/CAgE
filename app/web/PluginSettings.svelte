<script lang="ts">
  import { searchProviders, type SearchProvider } from '../src/shared/search-providers';
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import { pluginsApi, type PluginView, type ProjectSummary } from './api';
  let { projects }: {projects: ProjectSummary[]} = $props();
  let key = $state('');
  let plugins = $state<PluginView[]>([]);
  let keys = $state<Partial<Record<SearchProvider, boolean>>>({});
  let provider = $derived(plugins.find(p => p.id === 'firecrawl')?.provider ?? 'firecrawl');
  let configured = $derived(keys[provider]);
  const choices = Object.keys(searchProviders) as SearchProvider[];
  let busy = $state(false);
  let error = $state('');
  async function run(action: () => Promise<PluginView[]>) {
    busy = true; error = '';
    try { plugins = await action(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Plugin operation failed.'; } finally { busy = false; }
  }
  onMount(() => { void run(async () => {
    const list = await pluginsApi.list();
    keys = Object.fromEntries(await Promise.all(choices.map(async p => [p, (await pluginsApi.credential(p)).configured])));
    return list;
  }); });
  async function updateKey(remove: boolean) {
    busy = true; error = '';
    try {
      const status = remove ? await pluginsApi.removeKey(provider) : await pluginsApi.saveKey(provider, key.trim());
      keys[provider] = status.configured;
      key = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not update the key.'; }
    finally { busy = false; }
  }
</script>
<section class="settings-panel plugins">
  <h2>Research plugins</h2>
  <p class="intro">Theorist can open public links and read PDFs directly. Enable web search to discover additional sources.</p>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#each plugins as plugin (plugin.id)}
    <article class="plugin-card">
      <header>
        <span class="plugin-icon"><Icon name={plugin.id === 'firecrawl' ? 'search' : 'capabilities'} size={21} /></span>
        <div class="plugin-name"><h3>{plugin.name}</h3><small>v{plugin.version}</small></div>
        <span class="state" class:enabled={plugin.enabled}>{plugin.enabled ? 'Enabled' : plugin.installed ? 'Installed' : 'Available'}</span>
      </header>
      <p class="description">{plugin.description}</p>
      {#if plugin.installed && plugin.id === 'firecrawl'}
        <div class="setting">
          <label for="search-provider">Search provider</label>
          <select id="search-provider" value={provider} disabled={busy} onchange={event => {
            const selected = event.currentTarget.value as SearchProvider;
            key = ''; void run(() => pluginsApi.selectProvider(selected));
          }}>{#each choices as choice}<option value={choice}>{searchProviders[choice].name}</option>{/each}</select>
          <div class="row"><label for="firecrawl-key">{searchProviders[provider].name} API key</label><a href={searchProviders[provider].keys} target="_blank" rel="noopener noreferrer">Get an API key ↗</a></div>
          <form onsubmit={event => { event.preventDefault(); void updateKey(false); }}>
            <input id="firecrawl-key" type="password" autocomplete="off" maxlength="512" bind:value={key} disabled={busy} placeholder={configured ? 'Enter a replacement key' : 'Paste your key'} />
            <button disabled={busy || !key.trim()}>Save key</button>
          </form>
          <div class="row"><small role="status">{configured ? 'Key saved' : 'No key saved'}</small>
            {#if configured}<button class="text-button" disabled={busy} onclick={() => updateKey(true)}>Remove key</button>{/if}
          </div>
          <small>Requests to {searchProviders[provider].endpoint} use this provider’s credits.</small>
        </div>
        {#if plugin.enabled}
          <div class="setting access">
            <span>Available to Theorist in all V4 projects by default.</span>
            <details><summary>Project exceptions ({plugin.excludedProjects?.length ?? 0})</summary>
              <small>Select a project to disable web search there.</small>
              {#each projects.filter(p => p.researchLoopVersion === '4.0' && !p.archived) as project}
                <label class="check-label"><input type="checkbox" disabled={busy} checked={plugin.excludedProjects?.includes(project.id) ?? false}
                  onchange={event => { const caps = event.currentTarget.checked ? [] : plugin.requestedCapabilities; void run(() => pluginsApi.grant(plugin.id, project.id, 'theorist', caps)); }} />{project.name}</label>
              {:else}<small>No active V4 projects.</small>{/each}
            </details>
          </div>
        {/if}
      {/if}
      <footer>
        <details><summary>Permissions</summary><small>{plugin.requestedCapabilities.join(', ')}</small></details>
        <div class="inline-actions">
          {#if !plugin.installed}<button class="primary" disabled={busy} onclick={() => run(() => pluginsApi.install(plugin.id))}>Install bundled plugin</button>{:else}
            <button disabled={busy} onclick={() => run(() => plugin.enabled ? pluginsApi.disable(plugin.id) : pluginsApi.enable(plugin.id))}>{plugin.enabled ? 'Disable & unload' : 'Enable'}</button>
            <button class="text-button" disabled={busy} onclick={() => run(() => pluginsApi.uninstall(plugin.id))}>Uninstall</button>
          {/if}
        </div>
      </footer>
    </article>
  {/each}
  {#if !plugins.length && !busy && !error}<p class="empty-message">No plugin catalog is available.</p>{/if}
</section>

<style>
  .plugins .intro,.description,small { color:var(--color-muted); font-size:12px; line-height:1.6 }
  .plugins h2 { margin-bottom:4px }
  .intro { margin:0 0 14px }
  .plugin-card { overflow:hidden; padding:0; margin:12px 0 }
  header,.row,footer,form,.plugin-name { display:flex; align-items:center; gap:10px }
  header { padding:18px 20px 0 }
  .plugin-icon { flex:none; display:grid; place-items:center; width:36px; height:36px; border-radius:9px; color:var(--color-action); background:var(--color-tint) }
  .plugin-name { flex-wrap:wrap; gap:6px }
  h3 { margin:0; font-size:16px; line-height:1.3 }
  .state { margin-left:auto; padding:3px 9px; border:1px solid var(--color-line); border-radius:16px; font-size:11px; white-space:nowrap }
  .enabled { color:var(--color-success) }
  .enabled::before { content:'●'; font-size:8px; margin-right:5px }
  .description { margin:7px 20px 15px }
  .setting { display:grid; gap:5px; padding:13px 20px; border-top:1px solid var(--color-line) }
  .setting label { margin:0 }
  .setting form input { flex:1; min-width:0 }
  .row, footer { justify-content:space-between; flex-wrap:wrap }
  .row a { color:var(--color-action); font-size:12px }
  .setting select { width:100% }
  .setting .check-label { display:flex; gap:8px; align-items:center; font-weight:400 }
  .access { font-size:12px }
  .access details { margin:0 }
  .access summary { cursor:pointer; color:var(--color-action) }
  .access .check-label { padding:5px 0 }
  .setting select + .row { margin-top:6px }
  footer { padding:9px 16px 9px 20px; background:var(--color-rail); border-top:1px solid var(--color-line) }
  footer details { margin:0; font-size:12px; color:var(--color-muted) }
  footer summary { cursor:pointer }
</style>
