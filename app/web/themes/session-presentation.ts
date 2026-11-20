import type { CrystalTheme } from './catalog';

/** Conversation-only overrides. Home artwork, the theme registry and status
 * colors retain their own authority; a session never writes global tokens. */
const accents: Record<string, string> = {
  blue: '#1766D2', sage: '#287846', amber: '#A35A00', rose: '#B83F64',
};
export function sessionSurfaceStyle(theme: CrystalTheme): string {
  if (theme.dark) return '';
  const accent = accents[theme.id] ?? accents.blue;
  const roles = {
    canvas: '#ffffff', surface: '#ffffff', rail: '#f7f8fa',
    tint: `color-mix(in srgb,${accent} 5%,white)`,
    selected: `color-mix(in srgb,${accent} 9%,white)`,
    hover: `color-mix(in srgb,${accent} 6%,white)`,
    accent, action: accent, link: accent, signal: accent,
    'action-hover': `color-mix(in srgb,${accent} 85%,black)`,
  };
  return Object.entries(roles).map(([key, value]) => `--color-${key}:${value}`).join(';');
}

/** Native scrolling and hit testing remain intact. Firefox uses the standard
 * thin colored fallback; WebKit/Blink gets a dotted track and a circular mark
 * centered on the native thumb's full draggable area. Forced colors use native
 * system scrollbars rather than relying on decorative background images. */
export const sessionScrollbar = [
  '[scrollbar-width:thin] [scrollbar-color:var(--color-accent)_transparent]',
  'supports-[selector(::-webkit-scrollbar)]:[scrollbar-width:auto]',
  'supports-[selector(::-webkit-scrollbar)]:[scrollbar-color:auto]',
  '[&::-webkit-scrollbar]:w-3',
  '[&::-webkit-scrollbar-track:vertical]:bg-transparent',
  '[&::-webkit-scrollbar-track:vertical]:[background-image:radial-gradient(circle,#b3bbc4_1.25px,transparent_1.5px)]',
  '[&::-webkit-scrollbar-track:vertical]:[background-size:12px_8px]',
  '[&::-webkit-scrollbar-thumb:vertical]:bg-transparent [&::-webkit-scrollbar-thumb:vertical]:min-h-7',
  '[&::-webkit-scrollbar-thumb:vertical]:[background-image:radial-gradient(circle,var(--color-accent)_5px,transparent_5.5px)]',
  '[&::-webkit-scrollbar-thumb:vertical]:[background-position:center]',
  '[&::-webkit-scrollbar-thumb:vertical]:[background-size:12px_12px]',
  '[&::-webkit-scrollbar-thumb:vertical]:bg-no-repeat',
  '[&::-webkit-scrollbar-button:vertical]:hidden',
  'forced-colors:[scrollbar-color:auto] forced-colors:[scrollbar-width:auto]',
  'forced-colors:[&::-webkit-scrollbar-thumb:vertical]:[background:ButtonText]',
  'forced-colors:[&::-webkit-scrollbar-track:vertical]:[background:Canvas]',
].join(' ');

/** Hide sidebar scrollbars without changing native overflow or wheel input. */
export const hiddenSidebarScrollbar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
