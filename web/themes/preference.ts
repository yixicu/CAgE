import { writable } from 'svelte/store';
import { themeById } from './catalog';
import { updateEngineFavicon } from '../branding/favicon';
const key = 'cage.appearance.v1';
export const currentTheme = writable(themeById(undefined));
export const themeNotice = writable('');
function apply(id: unknown) {
 const theme = themeById(id);
 for (const [role,value] of Object.entries(theme.colors)) document.documentElement.style.setProperty(`--color-${role}`,value);
 document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light';
 document.documentElement.dataset.theme = theme.id;
 currentTheme.set(theme);
 void updateEngineFavicon(theme.id);
}
export function initializeTheme() {
 try { apply(localStorage.getItem(key)); } catch { apply(undefined); }
 window.addEventListener('storage', event => { if(event.key === key || event.key === null) apply(event.newValue); });
}
export function selectTheme(id: string) {
 apply(id);
 try { localStorage.setItem(key,themeById(id).id); themeNotice.set(''); }
 catch { themeNotice.set('Applied for this tab. Browser storage is unavailable.'); }
}
