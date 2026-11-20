import { writable } from 'svelte/store';

const key = 'cage.workspace-notifications';
export const showNotices = writable(true, set => {
  try { set(localStorage.getItem(key) !== 'off'); } catch { /* Browser storage is optional. */ }
  const sync = (event: StorageEvent) => {
    if (event.key === key || event.key === null) set(event.newValue !== 'off');
  };
  window.addEventListener('storage', sync);
  return () => window.removeEventListener('storage', sync);
});
export function setShowNotices(enabled: boolean) {
  showNotices.set(enabled);
  try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* Keep the tab preference. */ }
}
