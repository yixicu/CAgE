import { mergeConfig } from 'vite';
import base from '../../vite.config';

// The native window owns its icon. A desktop window has no browser tab to repaint.
export default mergeConfig(base, {
  plugins: [{
    name: 'carnot-native-window-icon',
    enforce: 'pre',
    transform(_source: string, id: string) {
      if (id.replaceAll('\\\\','/').endsWith('/web/load-basic-map.ts')) {
        return "export async function loadBasicMap(){return window.__CARNOT_BASIC_PHYSICS__ ? (await import(/* @vite-ignore */ '/basic-physics-map.mjs')).default : []}";
      }
      if (id.replaceAll('\\','/').endsWith('/web/branding/favicon.ts')) {
        return 'export function updateEngineFavicon() {}';
      }
    },
  }],
});