<script lang="ts">
  import { api, type Bootstrap } from './api';
  import ThemeSettings from './themes/ThemeSettings.svelte';
  import FontScaleSettings from './appearance/FontScaleSettings.svelte';
  import ProviderSettings from './ProviderSettings.svelte';
  import StorageSettings from './StorageSettings.svelte';
  import ProjectSettings from './ProjectSettings.svelte';
  import PluginSettings from './PluginSettings.svelte';
  import ResearchModeSelect from './ResearchModeSelect.svelte';
  import { DEFAULT_RESEARCH_MODE, type ResearchMode } from './research-mode';
  import { developerMode, setDeveloperMode } from './developer-mode';
  let { bootstrap, onchange }: { bootstrap: Bootstrap; onchange: () => Promise<void> } = $props();
  let tab = $state('models');
  let version = $state<ResearchMode>(DEFAULT_RESEARCH_MODE);
  let message = $state('');
  let storageError = $state('');
  import {showNotices,setShowNotices} from './appearance/notifications';
  $effect(() => { if (!$developerMode) version = DEFAULT_RESEARCH_MODE; });
</script>
<div class="system-settings">
  <div class="settings-title"><h1>Settings</h1></div>
  <nav class="settings-tabs" aria-label="Settings sections">
    {#each [['models', 'Models & connections'], ['research', 'Research'], ['plugins', 'Plugins & general'], ['appearance', 'Appearance']] as [id, label]}
      <button class:chosen={tab === id} onclick={() => { tab = id; message = ''; }}>{label}</button>
    {/each}
  </nav>
  {#if message}<p class="notice success" role="status">{message}</p>{/if}
  {#if tab === 'models'}
    <ProviderSettings config={bootstrap.researchDefaults['4.0']} providers={bootstrap.providers} models={bootstrap.models} preferences={bootstrap.preferences} defaultModel={bootstrap.preferences.defaultModel} {onchange} />
  {:else if tab === 'appearance'}
    <FontScaleSettings />
    <ThemeSettings />
  {:else if tab === 'research'}
    {#if bootstrap.storage}<StorageSettings current={bootstrap.storage} />{/if}
    <label class="check-label mb-4"><input type="checkbox" checked={$developerMode} onchange={event => setDeveloperMode(event.currentTarget.checked)} />Developer mode<span class="muted small">Legacy and test engines</span></label>
    <div class="research-version"><div><span class="muted small">Research defaults</span><ResearchModeSelect value={version} onchange={value => { version = value; }} /></div></div>
    {#key version}
      <ProjectSettings {version} config={bootstrap.researchDefaults[version]} models={bootstrap.models} running={false} onsave={async config => {
        await api.preferences({ ...bootstrap.preferences, researchDefaults: { ...bootstrap.preferences.researchDefaults, [version]: config } });
        await onchange(); message = 'Research settings saved for all projects.';
      }} />
    {/key}
  {:else}
    <section class="settings-panel"><h2>General</h2>
      <label class="general-row">Workspace notifications<input type="checkbox" checked={$showNotices} onchange={e=>setShowNotices(e.currentTarget.checked)}/></label>
      <div class="general-row"><span>Local storage</span><button onclick={async()=>{storageError='';try{await api.openStorage()}catch{storageError='Could not open the storage folder.'}}}>Open folder</button></div>
      {#if storageError}<p role="alert">{storageError}</p>{/if}
    </section>
    <PluginSettings />
  {/if}
</div>

<style>
.system-settings .settings-tabs{gap:4px;flex-wrap:wrap;margin:16px 0 20px;padding:4px;border:1px solid var(--color-line);border-radius:10px;background:var(--color-rail)}
.settings-tabs button{padding:7px 13px;border-radius:7px;line-height:1.3}
.settings-tabs button.chosen{background:var(--color-surface);box-shadow:0 1px 4px var(--color-scrim);color:var(--color-ink)}
.system-settings :global(.settings-panel),.system-settings :global(section[aria-labelledby=appearance-title]){background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;padding:clamp(14px,2vw,24px);margin-bottom:16px}
.system-settings :global(.model-picker){margin:12px 0;align-items:start}
.system-settings :global(.model-picker label),.system-settings :global(.settings-grid label){display:grid;gap:6px;margin:0}
.system-settings :global(.model-picker select),.system-settings :global(.settings-grid input){margin:0;width:100%}
.research-version>div,.general-row{display:flex;align-items:center;gap:16px}
.settings-panel .general-row{justify-content:space-between;padding:12px 0;margin:0;border-top:1px solid var(--color-line)}
.system-settings :global(.default-model-form){padding-top:16px}.system-settings :global(h3){margin:20px 0 10px}
.system-settings :global(.scale-row){padding-block:10px}
</style>
