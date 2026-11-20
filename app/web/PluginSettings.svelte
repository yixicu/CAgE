<script lang="ts">
  import { onMount } from 'svelte';
  import { pluginsApi, type PluginView } from './api';
  let plugins = $state<PluginView[]>([]);
  let busy = $state(false);
  let error = $state('');
  async function run(action: () => Promise<PluginView[]>) {
    busy = true; error = '';
    try { plugins = await action(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Plugin operation failed.'; } finally { busy = false; }
  }
  onMount(() => { void run(pluginsApi.list); });
</script>
<section class="settings-panel">
  <h2>Trusted plugins</h2>
  <p class="muted small">Enabled plugins run inside the research process.</p>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#each plugins as plugin (plugin.id)}
    <article class="plugin-card">
      <h3>{plugin.name} <span class="muted small">v{plugin.version}</span></h3><p>{plugin.description}</p>
      <p class="small">{plugin.installed ? 'Installed' : 'Not installed'} · {plugin.enabled ? 'Enabled' : 'Disabled'}</p>
      <p class="small muted">Capabilities: {plugin.requestedCapabilities.join(', ')}</p>
      <div class="inline-actions">
        {#if !plugin.installed}<button disabled={busy} onclick={() => run(() => pluginsApi.install(plugin.id))}>Install bundled plugin</button>{:else}
          <button disabled={busy} onclick={() => run(() => plugin.enabled ? pluginsApi.disable(plugin.id) : pluginsApi.enable(plugin.id))}>{plugin.enabled ? 'Disable & unload' : 'Enable'}</button>
          <button disabled={busy} onclick={() => run(() => pluginsApi.uninstall(plugin.id))}>Uninstall</button>
        {/if}
      </div>

    </article>
  {/each}
  {#if !plugins.length && !busy}<p class="empty-message">No plugin catalog is available.</p>{/if}
</section>
