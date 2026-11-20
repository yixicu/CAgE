<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type StorageLocations, type StorageSettings } from './api';

  let { current }: { current: StorageSettings } = $props();
  let draft = $state(untrack(() => ({ ...current.configured })));
  let saved = $state(untrack(() => ({ ...current.configured })));
  let busy = $state(false);
  let error = $state('');
  const fields = [
    { key: 'system', label: 'System logs and records' },
    { key: 'research', label: 'Knowledge and project files' },
  ] as const;
  const changed = $derived(fields.some(({ key }) => draft[key] !== saved[key]));

  async function browse(key: keyof StorageLocations) {
    busy = true;
    error = '';
    try {
      const { path } = await api.pickStorageFolder();
      if (path) draft[key] = path;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Enter the folder path directly.'; }
    finally { busy = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const result = await api.saveStorage(draft);
      saved = { ...result.configured };
      draft = { ...result.configured };
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save the storage folders.'; }
    finally { busy = false; }
  }
</script>

<section class="settings-panel" aria-labelledby="storage-title">
  <h2 id="storage-title">Storage folders</h2>
  <p class="muted small">Folder changes apply after you exit and reopen Carnot. Select an existing research folder to open its projects and proofs, or an empty one to start fresh. Existing files stay in their current folders.</p>
  <form onsubmit={save}>
    {#each fields as field}
      <div class="folder">
        <label for={'storage-' + field.key}>{field.label}</label>
        <div class="path-row">
          <input id={'storage-' + field.key} required bind:value={draft[field.key]} disabled={busy} spellcheck="false" autocomplete="off" />
          <button type="button" aria-label={'Browse for ' + field.label.toLowerCase()} title={'Browse for ' + field.label.toLowerCase()} disabled={busy} onclick={() => browse(field.key)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V6a2 2 0 0 1 2-2h5l2 3h6a2 2 0 0 1 2 2v1"/><path d="M5 20a2 2 0 0 1-2-2l3-8h16l-3 8a3 3 0 0 1-3 2Z"/></svg>
          </button>
        </div>
        {#if current.active[field.key] !== saved[field.key]}<small class="muted" role="status">Currently using {current.active[field.key]}. Saved folder applies on restart.</small>{/if}
      </div>
    {/each}
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={!changed || busy}>Save folders</button>
  </form>
</section>

<style>
  form,.folder{display:grid;gap:6px}
  form{gap:16px;margin-top:14px}
  .path-row{display:flex;align-items:center;gap:8px}
  .path-row button{display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0}
  .folder label,.folder input{margin:0}
  .folder input{width:100%;min-width:0}
  .folder small{overflow-wrap:anywhere}
  button{justify-self:start;white-space:nowrap}
</style>
