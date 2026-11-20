import type { Bootstrap } from './api';
import type { ModelSelection } from '../src/engine/types';

export const COMPOSER_SOURCE_ACCEPT = '.md,.markdown,.txt,.pdf';
export const MAX_COMPOSER_SOURCE_BYTES = 20 * 1024 * 1024;

/** Local staging only. Uploads remain explicit, sequential API operations. */
export function validateComposerFile(file: File): string | undefined {
  if (!file.name || file.name.length > 255 || /[/\\]/.test(file.name)) return 'Choose a source with a file name of 255 characters or fewer.';
  if (!/\.(md|markdown|txt|pdf)$/i.test(file.name)) return `${file.name}: supported files are Markdown (.md), plain text (.txt), and PDF (.pdf).`;
  if (!file.size) return `${file.name}: choose a file that is not empty.`;
  if (file.size > MAX_COMPOSER_SOURCE_BYTES) return `${file.name}: source files must be 20 MiB or smaller.`;
  return undefined;
}

export function stageComposerFiles(existing: readonly File[], incoming: Iterable<File>): { files: File[]; errors: string[] } {
  const files = [...existing], errors: string[] = [];
  for (const file of incoming) {
    const error = validateComposerFile(file);
    if (error) { errors.push(error); continue; }
    if (!files.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) files.push(file);
  }
  return { files, errors };
}

/** A saved selection alone does not mean its provider is still connected. */
export function isResearchModelReady(bootstrap: Bootstrap | undefined, model: ModelSelection | undefined = bootstrap?.preferences.defaultModel): boolean {
  return !!model && !!bootstrap?.providers.some(provider => provider.id === model.provider && provider.configured)
    && bootstrap.models.some(item => item.provider === model.provider && item.id === model.modelId);
}
