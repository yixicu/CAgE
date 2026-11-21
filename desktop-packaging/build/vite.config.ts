import base from '../../app/vite.config';

// The native window owns its icon. A desktop window has no browser tab to repaint.
export default {
  ...base,
  plugins: [...(base.plugins ?? []), {
    name: 'carnot-native-window-icon',
    enforce: 'pre',
    transform(_source: string, id: string) {
      const path = id.replaceAll('\\','/');
      if (path.endsWith('/web/branding/favicon.ts')) {
        return 'export function updateEngineFavicon() {}';
      }
    },
  }],
};
