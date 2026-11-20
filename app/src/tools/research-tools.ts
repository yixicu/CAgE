import type { SourceRevisionRef } from '../engine/types.js';
import { RestrictedFileGateway, assertSafeRelative, FileAccessError } from './files.js';
import { extractDocumentText, type DocumentText } from './documents.js';

export interface SearchHit { sourceId: string; locator: string; excerpt: string }
export interface ResearchTools {
  readAuthorizedFile(sourceIdOrPrivatePath: string): Promise<DocumentText>;
  searchAuthorizedSources(query: string): Promise<SearchHit[]>;
  writeWorkerNote(relativePath: string, content: string): Promise<{ path: string }>;
}
export async function createResearchTools(options: {
  workspaceRoot: string; sources: readonly SourceRevisionRef[];
  readSource: (ref: SourceRevisionRef) => Promise<Uint8Array>;
}): Promise<ResearchTools> {
  const sources = structuredClone(options.sources);
  const gateway = await RestrictedFileGateway.create({ role: 'worker', workspaceRoot: options.workspaceRoot, readableRoots: [], writableRoots: [options.workspaceRoot] });
  const read = async (ref: SourceRevisionRef) => extractDocumentText(await options.readSource(structuredClone(ref)), ref.path);
  return {
    async readAuthorizedFile(value) {
      const source = sources.find((item) => item.id === value || item.path === value);
      if (source) return read(source);
      // Model-provided paths never grant access. Only its own private notes are addressable.
      assertSafeRelative(value);
      return extractDocumentText(await gateway.read(value), value);
    },
    async searchAuthorizedSources(query) {
      if (!query.trim() || query.length > 500) throw new FileAccessError('Provide a search phrase of 1–500 characters.');
      const hits: SearchHit[] = [];
      for (const source of sources) {
        const document = await read(source);
        const sections = document.pages?.map((page) => ({ locator: `page ${page.page}`, text: page.text })) ?? [{ locator: 'text', text: document.text }];
        for (const section of sections) {
          const position = section.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
          if (position >= 0) hits.push({ sourceId: source.id, locator: section.locator, excerpt: section.text.slice(Math.max(0, position - 120), position + query.length + 240) });
          if (hits.length >= 50) return hits;
        }
      }
      return hits;
    },
    async writeWorkerNote(relativePath, content) {
      assertSafeRelative(relativePath);
      if (!/\.(md|txt|json)$/iu.test(relativePath)) throw new FileAccessError('Private notes must be Markdown, text or JSON.');
      await gateway.write(relativePath, content);
      return { path: relativePath };
    },
  };
}
