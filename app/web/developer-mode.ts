import { writable } from 'svelte/store';

const key = 'cage.developer-mode';
let enabled = false;
try { enabled = typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true'; } catch { /* Default off when storage is unavailable. */ }
export const developerMode = writable(enabled);
export function setDeveloperMode(value: boolean) {
  developerMode.set(value);
  try { localStorage.setItem(key, String(value)); } catch { /* The current browser session still works. */ }
}
