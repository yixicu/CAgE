/** One approved silhouette, shared by the inline mark and browser favicon. */
export const engineAsset = {
  url: `${import.meta.env.BASE_URL}branding/engine-a-v4.png`,
  width: 1254,
  height: 1254,
  // Retain the full source canvas and its approved visual position.
  viewport: { x: 0, y: 0, size: 1254 },
};

type RGB = readonly [number, number, number];
export interface EnginePalette { low: RGB; high: RGB }
export const enginePalettes: Readonly<Record<string, EnginePalette>> = {
  blue: { low: [25, 55, 98], high: [141, 195, 245] },
  sage: { low: [28, 63, 39], high: [160, 204, 145] },
  amber: { low: [107, 49, 14], high: [248, 190, 83] },
  rose: { low: [93, 33, 58], high: [230, 155, 177] },
  obsidian: { low: [83, 111, 148], high: [224, 237, 255] },
};
export const enginePalette = (id: string): EnginePalette => enginePalettes[id] ?? enginePalettes.blue;

// Source blue-channel shading preserves facets independently of theme hue.
// Normalize first, then tint; separate SVG primitives clamp the same as canvas.
export const engineTone = { low: 80, span: 160 };
export function engineToneMatrix(): string {
  const scale = 255 / engineTone.span;
  const offset = -engineTone.low / engineTone.span;
  return [0, 0, scale, 0, offset, 0, 0, scale, 0, offset, 0, 0, scale, 0, offset, 0, 0, 0, 1, 0].join(' ');
}
export function engineTintMatrix(id: string): string {
  const { low, high } = enginePalette(id);
  return [...low.flatMap((value, channel) => [0, 0, (high[channel] - value) / 255, 0, value / 255]), 0, 0, 0, 1, 0].join(' ');
}
export function tintEnginePixels(data: Uint8ClampedArray, id: string): void {
  const { low, high } = enginePalette(id);
  for (let i = 0; i < data.length; i += 4) {
    const tone = Math.max(0, Math.min(1, (data[i + 2] - engineTone.low) / engineTone.span));
    for (let channel = 0; channel < 3; channel++) data[i + channel] = low[channel] + tone * (high[channel] - low[channel]);
    // Alpha is deliberately unchanged, including antialiased silhouette edges.
  }
}
