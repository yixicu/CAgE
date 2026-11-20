import blue from './assets/blue-tabular-reference.png';
import sage from './assets/sage-reference.png';
import amber from './assets/amber-reference.png';
import rose from './assets/rose-reference.png';
import obsidian from './assets/obsidian-reference.png';

/** Home presentation only; conversation geometry and semantic palettes stay in catalog.ts. */
export interface StartPageArtwork {
  src: string;
  description: string;
  opacityClass: string;
  sidebarClass: string;
}
const lightSidebar = 'bg-transparent from-surface/95 via-surface/85 to-surface/55';
export const startPageArtworks: Readonly<Record<string, StartPageArtwork>> = {
  blue: { src: blue, description: 'Tabular crystal', opacityClass: 'opacity-65', sidebarClass: lightSidebar },
  sage: { src: sage, description: 'Hexagonal prism', opacityClass: 'opacity-65', sidebarClass: lightSidebar },
  amber: { src: amber, description: 'Stepped cubic cluster', opacityClass: 'opacity-65', sidebarClass: lightSidebar },
  rose: { src: rose, description: 'Oblique crystal blocks', opacityClass: 'opacity-65', sidebarClass: lightSidebar },
  obsidian: { src: obsidian, description: 'Smoky tetrahedral cluster', opacityClass: 'opacity-65', sidebarClass: 'bg-transparent from-surface/95 via-surface/90 to-surface/75' },
};
export const startPageArtwork = (themeId: string): StartPageArtwork => startPageArtworks[themeId] ?? startPageArtworks.blue;
