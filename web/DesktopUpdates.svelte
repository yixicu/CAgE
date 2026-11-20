<script lang="ts">
  import { api, ApiError } from './api';
  let { version }: { version:string } = $props();
  let latest = $state('');
  let status = $state('');
  let busy = $state(false);
  let needsAccess = $state(false);
  let token = $state('');

  async function run(action: 'check' | 'install') {
    if (busy) return;
    busy = true;
    status = action === 'check' ? 'Checking GitHub Releases…' : 'Downloading and verifying the installer…';
    try {
      if (action === 'check') {
        latest = '';
        const result = await api.checkDesktopUpdate(token.trim() || undefined);
        latest = result.available ? result.latestVersion : '';
        status = latest ? 'Version ' + latest + ' is available. Updating will close Carnot.' : 'You are up to date.';
        if (!latest) token = '';
      } else {
        await api.installDesktopUpdate(latest, token.trim() || undefined);
        token = '';
        latest = '';
        status = 'Installer started. Carnot is closing.';
      }
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) needsAccess = true;
      status = reason instanceof Error ? reason.message : 'Could not contact GitHub.';
    } finally { busy = false; }
  }
</script>

<section class="settings-panel" aria-labelledby="desktop-updates">
  <h2 id="desktop-updates">Desktop updates</h2>
  <p class="muted small">Installed version {version} · yixicu/CAgE</p>
  {#if needsAccess}
    <label for="release-token">GitHub access token</label>
    <input id="release-token" type="password" bind:value={token} autocomplete="off" spellcheck="false" />
    <p class="muted small">For a private release, use your own token with Contents read access to yixicu/CAgE. It is used for this update only.</p>
  {/if}
  <div class="actions">
    <button disabled={busy} onclick={() => run('check')}>Check for updates</button>
    <button class="primary" disabled={busy || !latest} onclick={() => run('install')}>Update</button>
  </div>
  <p role="status">{status}</p>
</section>

<style>
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  label, input { display:block; margin-top:8px; }
  input { width:min(100%,32rem); }
  [role=status]:empty { display:none; }
</style>
