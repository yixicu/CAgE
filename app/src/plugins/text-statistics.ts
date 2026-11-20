import { Type } from 'typebox';
import type { TrustedPlugin } from './index.js';

/** A trusted, pure demonstration. It neither reads files nor invokes a provider. */
export const textStatisticsPlugin: TrustedPlugin = {
  manifest: {
    id: 'text-statistics', name: 'Text statistics', version: '1.0.0', hostApi: '1',
    description: 'Count words, characters and lines in explicitly supplied text. No file or network access.',
    requestedCapabilities: ['tool.text-statistics'], roleScopes: ['theorist', 'worker', 'moderator', 'literature'],
  },
  activate(api) {
    api.registerTool('tool.text-statistics', {
      name: 'text_statistics', label: 'Text statistics', description: 'Count characters, words and lines in supplied text; these counts do not measure scientific quality.',
      parameters: Type.Object({ text: Type.String({ maxLength: 200000 }) }, { additionalProperties: false }),
      async execute(_id, parameters) {
        const text = (parameters as { text: string }).text;
        if (typeof text !== 'string' || text.length > 200000) throw new Error('Invalid text');
        const details = { characters: [...text].length, words: text.trim() ? text.trim().split(/\s+/u).length : 0, lines: text.length ? text.split(/\r?\n/u).length : 0 };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      },
    });
  },
};
