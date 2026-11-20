import { engineAsset, tintEnginePixels } from './engine-mark';

let source: Promise<HTMLImageElement> | undefined;
let latestRequest = 0;
const rendered = new Map<string, string>();
function loadSource(): Promise<HTMLImageElement> {
  return source ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Engine icon unavailable'));
    image.src = engineAsset.url;
  });
}
function render(image: HTMLImageElement, id: string): string {
  const canvas = document.createElement('canvas');
  // Tint before downsampling so translucent small-size edges use the same
  // source colors and alpha as the inline SVG filter.
  const { x, y, size } = engineAsset.viewport;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, x, y, size, size, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size);
  tintEnginePixels(pixels.data, id);
  context.putImageData(pixels, 0, 0);
  const icon = document.createElement('canvas');
  icon.width = icon.height = 64;
  const output = icon.getContext('2d');
  if (!output) throw new Error('Canvas unavailable');
  output.drawImage(canvas, 0, 0, 64, 64);
  return icon.toDataURL('image/png');
}
/** Theme failures never block startup; the local original PNG stays usable. */
export async function updateEngineFavicon(id: string): Promise<void> {
  const request = ++latestRequest;
  const link = document.querySelector<HTMLLinkElement>('link[data-engine-icon]');
  if (!link) return;
  try {
    let url = rendered.get(id);
    if (!url) {
      const image = await loadSource();
      if (request !== latestRequest) return;
      url = render(image, id);
      rendered.set(id, url);
    }
    if (request !== latestRequest) return;
    link.type = 'image/png';
    link.href = url;
  } catch {
    if (request !== latestRequest) return;
    source = undefined; // A later theme choice may retry a transient load failure.
    link.type = 'image/png';
    link.href = engineAsset.url;
  }
}
