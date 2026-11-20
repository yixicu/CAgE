import { writable } from 'svelte/store';

export const FONT_SCALE_KEY = 'cage.font-scale.v1';
export const MIN_FONT_SCALE = 90;
export const MAX_FONT_SCALE = 115;
export const FONT_SCALE_STEP = 1;
export const DEFAULT_FONT_SCALE = 100;
export const fontScale = writable(DEFAULT_FONT_SCALE);
export const fontScaleNotice = writable('');

/** Only finite numeric preferences are accepted; old/corrupt values are harmless. */
export function normalizeFontScale(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_FONT_SCALE;
  if (typeof value === 'string' && !value.trim()) return DEFAULT_FONT_SCALE;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FONT_SCALE;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(number / FONT_SCALE_STEP) * FONT_SCALE_STEP));
}

let baseline: Map<string, string> | undefined;
let initialized = false;
function apply(value: unknown) {
  const percent = normalizeFontScale(value);
  const root = document.documentElement;
  // Snapshot the existing Tailwind scale once. Never multiply a previously scaled
  // value, and leave rem/spacing/breakpoints/artwork geometry untouched.
  if (!baseline) {
    const computed = getComputedStyle(root);
    baseline = new Map(Array.from(computed)
      .filter(name => /^--text-[a-z0-9]+$/.test(name))
      .map(name => [name, computed.getPropertyValue(name).trim()]));
  }
  root.style.setProperty('--ui-font-scale', String(percent / 100));
  for (const [name, size] of baseline) root.style.setProperty(name, `calc((${size}) * ${percent / 100})`);
  document.body.style.fontSize = 'var(--text-base)';
  fontScale.set(percent);
}

export function initializeFontScale() {
  if (initialized) return;
  initialized = true;
  try { apply(localStorage.getItem(FONT_SCALE_KEY)); }
  catch { apply(DEFAULT_FONT_SCALE); }
  window.addEventListener('storage', event => {
    if (event.key === FONT_SCALE_KEY || event.key === null) {
      apply(event.newValue);
      fontScaleNotice.set('');
    }
  });
}

export function selectFontScale(value: unknown) {
  const percent = normalizeFontScale(value);
  apply(percent);
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(percent));
    fontScaleNotice.set('');
  } catch {
    fontScaleNotice.set('Applied for this tab. Browser storage is unavailable.');
  }
}
