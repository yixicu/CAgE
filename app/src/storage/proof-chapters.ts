import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import { atomicWrite, readJson } from './atomic.js';
import { stableHash } from '../learning/research-hash.js';
import { ChapterRefSchema, type ChapterRef } from '../research/contracts/documents.js';

interface Chapter { ref: ChapterRef; content: string }
/** Immutable content-addressed files outside disposable Worker workspaces. No model paths. */
export class ProofChapters {
  constructor(private readonly root: string) {}
  private directory(sessionId: string, attemptId: string): string { return join(this.root, stableHash(sessionId), stableHash(attemptId)); }
  private path(ref: ChapterRef): string { return join(this.directory(ref.sessionId, ref.attemptId), `${ref.contentHash}.json`); }
  async save(metadata: Omit<ChapterRef, 'contentHash'>, content: string): Promise<ChapterRef> {
    if (!content.trim() || content.length > 1_000_000) throw new Error('Chapter content is empty or exceeds the document limit.');
    const ref = { ...metadata, contentHash: stableHash({ ...metadata, content }) };
    if (!Value.Check(ChapterRefSchema, ref)) throw new Error('Invalid chapter metadata.');
    await atomicWrite(this.path(ref), JSON.stringify({ ref, content }));
    return ref;
  }
  async read(ref: ChapterRef): Promise<Chapter> {
    if (!Value.Check(ChapterRefSchema, ref)) throw new Error('Invalid chapter reference.');
    const chapter = await readJson<Chapter>(this.path(ref));
    return this.validate(chapter, ref);
  }
  private validate(chapter: Chapter, ref: ChapterRef): Chapter {
    if (!Value.Check(ChapterRefSchema, ref) || typeof chapter.content !== 'string') throw new Error('Invalid chapter data.');
    const { contentHash, ...metadata } = ref;
    if (stableHash(chapter.ref) !== stableHash(ref) || stableHash({ ...metadata, content: chapter.content }) !== contentHash) throw new Error('Chapter version or content does not match its frozen reference.');
    return chapter;
  }
  async list(sessionId: string, attemptId: string): Promise<ChapterRef[]> {
    const directory = this.directory(sessionId, attemptId);
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const refs: ChapterRef[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const chapter = await readJson<Chapter>(join(directory, name));
      const { ref } = chapter;
      if (!Value.Check(ChapterRefSchema, ref)) throw new Error('Invalid chapter reference.');
      if (ref.sessionId !== sessionId || ref.attemptId !== attemptId || `${ref.contentHash}.json` !== name) throw new Error('Chapter owner mismatch.');
      refs.push(this.validate(chapter, ref).ref);
    }
    return refs;
  }
}
