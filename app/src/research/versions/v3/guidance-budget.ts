import { createHash } from 'node:crypto';

export interface GuidanceDocumentV3 {
  id: string;
  kind: 'resource' | 'policy' | 'strategy' | 'knowledge';
  text: string;
  hash: string;
  resourceRef?: { id: string; version: number };
}
export interface GuidanceManifestV3 { id: string; hash: string; offset: number; end: number }
export interface GuidancePageV3 extends GuidanceManifestV3 {
  totalBytes: number;
  nextOffset?: number;
  body: string;
  lines: number;
}

/** Charge physical lines, including blanks, with a virtual line per 160 Unicode codepoints. */
export function guidanceCostV3(text: string): number {
  if (!text.length) return 0;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / 160)), 0);
}

export function guidanceHashV3(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function integer(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid ${name}.`);
}

export function selectWholeGuidanceV3(documents: readonly GuidanceDocumentV3[], budget: number): {
  selected: GuidanceDocumentV3[]; omitted: GuidanceDocumentV3[]; lines: number;
} {
  integer(budget, 'guidance budget');
  const selected: GuidanceDocumentV3[] = [], omitted: GuidanceDocumentV3[] = [];
  let lines = 0;
  for (const document of documents) {
    const cost = guidanceCostV3(document.text);
    if (cost <= budget - lines) { selected.push(document); lines += cost; }
    else omitted.push(document);
  }
  return { selected, omitted, lines };
}

function documentBytes(document: GuidanceDocumentV3): Buffer {
  if (!document.id || !['resource', 'policy', 'strategy', 'knowledge'].includes(document.kind)) {
    throw new Error('Invalid guidance document identity or kind.');
  }
  const bytes = Buffer.from(document.text, 'utf8');
  if (bytes.toString('utf8') !== document.text) throw new Error('Guidance text must be valid Unicode for exact UTF-8 paging.');
  if (guidanceHashV3(document.text) !== document.hash) throw new Error('Guidance document hash mismatch.');
  if (document.resourceRef) {
    if (typeof document.resourceRef.id !== 'string' || !document.resourceRef.id.length) throw new Error('Invalid resource reference.');
    integer(document.resourceRef.version, 'resource version');
  }
  return bytes;
}

function boundary(bytes: Buffer, offset: number): void {
  integer(offset, 'UTF-8 byte offset');
  if (offset > bytes.length || (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)) {
    throw new RangeError('Guidance range is outside the document or splits a UTF-8 codepoint.');
  }
}

/** Byte offsets are durable; pages preserve exact text and do not themselves grant exposure. */
export function pageGuidanceV3(document: GuidanceDocumentV3, offset = 0, maxLines = 60, maxBytes = 8192): GuidancePageV3 {
  const bytes = documentBytes(document);
  boundary(bytes, offset);
  integer(maxLines, 'page line budget', 1);
  integer(maxBytes, 'page byte budget', 1);
  let end = offset, lines = 0, completeLines = 0, lineCharacters = 0, previousCR = false;
  let limit = Math.min(bytes.length, offset + maxBytes);
  while (limit > offset && limit < bytes.length && (bytes[limit]! & 0xc0) === 0x80) limit--;
  for (const character of bytes.subarray(offset, limit).toString('utf8')) {
    const nextEnd = end + Buffer.byteLength(character, 'utf8');
    if (nextEnd - offset > maxBytes) break;
    if (character === '\r' || character === '\n') {
      if (!(character === '\n' && previousCR)) completeLines += Math.max(1, Math.ceil(lineCharacters / 160));
      lineCharacters = 0;
    } else lineCharacters++;
    const nextLines = completeLines + Math.ceil(lineCharacters / 160);
    if (nextLines > maxLines) break;
    previousCR = character === '\r';
    end = nextEnd;
    lines = nextLines;
  }
  if (end === offset && offset < bytes.length) throw new RangeError('Page budgets cannot fit the next UTF-8 codepoint.');
  return {
    id: document.id, hash: document.hash, offset, end, totalBytes: bytes.length,
    ...(end < bytes.length ? { nextOffset: end } : {}), body: bytes.subarray(offset, end).toString('utf8'), lines,
  };
}

type StoredDocument = { document: GuidanceDocumentV3; bytes: Buffer; ranges: GuidanceManifestV3[] };

/** Validated host exposure, not page execution or model claims, is the only grant source. */
export class GuidanceExposureLedgerV3 {
  private readonly documents = new Map<string, StoredDocument>();

  constructor(documents: readonly GuidanceDocumentV3[]) {
    for (const input of documents) {
      if (this.documents.has(input.id)) throw new Error(`Duplicate guidance document ID: ${input.id}.`);
      const bytes = documentBytes(input);
      const document = { ...input, ...(input.resourceRef ? { resourceRef: { ...input.resourceRef } } : {}) };
      this.documents.set(document.id, { document, bytes, ranges: [] });
    }
  }

  register(input:GuidanceDocumentV3):void {
    const bytes=documentBytes(input),old=this.documents.get(input.id);
    if(old){if(JSON.stringify(old.document)!==JSON.stringify(input)||!old.bytes.equals(bytes))throw new Error('Conflicting immutable guidance document.');return;}
    this.documents.set(input.id,{document:structuredClone(input),bytes,ranges:[]});
  }
  completeDocumentIds():string[]{return [...this.documents.values()].filter(({bytes,ranges})=>ranges.length===1&&ranges[0]!.offset===0&&ranges[0]!.end===bytes.length).map(({document})=>document.id);}

  expose(manifests: readonly GuidanceManifestV3[]): void {
    // Validate the whole call before applying any exposure, so a bad batch fails closed.
    const validated = manifests.map(manifest => {
      const stored = this.documents.get(manifest.id);
      if (!stored) throw new Error(`Unknown guidance document: ${manifest.id}.`);
      if (stored.document.hash !== manifest.hash) throw new Error('Guidance exposure hash mismatch.');
      boundary(stored.bytes, manifest.offset);
      boundary(stored.bytes, manifest.end);
      if (manifest.end < manifest.offset || (manifest.end === manifest.offset && stored.bytes.length !== 0)) {
        throw new RangeError('Guidance exposure range must be nonempty unless the document is empty.');
      }
      return { stored, range: { id: manifest.id, hash: manifest.hash, offset: manifest.offset, end: manifest.end } };
    });
    for (const { stored, range } of validated) {
      const ranges = [...stored.ranges, range].sort((a, b) => a.offset - b.offset || a.end - b.end);
      stored.ranges = [];
      for (const candidate of ranges) {
        const previous = stored.ranges.at(-1);
        if (previous && candidate.offset <= previous.end) previous.end = Math.max(previous.end, candidate.end);
        else stored.ranges.push({ ...candidate });
      }
    }
  }

  completeResourceRefs(): { id: string; version: number }[] {
    const refs = new Map<string, { ref: { id: string; version: number }; complete: boolean }>();
    for (const { document, bytes, ranges } of this.documents.values()) {
      if (!document.resourceRef) continue;
      const key = JSON.stringify([document.resourceRef.id, document.resourceRef.version]);
      const complete = ranges.length === 1 && ranges[0]!.offset === 0 && ranges[0]!.end === bytes.length;
      const prior = refs.get(key);
      refs.set(key, { ref: document.resourceRef, complete: complete && (prior?.complete ?? true) });
    }
    return [...refs.values()].filter(value => value.complete).map(value => ({ ...value.ref }));
  }

  snapshots(): GuidanceManifestV3[] {
    return [...this.documents.values()].flatMap(({ ranges }) => ranges.map(range => ({ ...range })));
  }
}

/** Extract annotation prose only, preserving every occurrence in the transmitted schema. */
export function schemaGuidanceProseV3(schema: unknown): string[] {
  const texts: string[] = [];
  const literals = new Set(['type', 'enum', 'const', 'required']);
  const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
  function annotationStrings(value: unknown): void {
    if (typeof value === 'string') texts.push(value);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) annotationStrings(child);
  }
  function visit(value: unknown, schemaMap = false): void {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (schemaMap) visit(child);
      else if ((key === 'description' || key === 'title') && typeof child === 'string') texts.push(child);
      else if (key === 'default' || key === 'examples') annotationStrings(child);
      else if (!literals.has(key)) visit(child, maps.has(key));
    }
  }
  visit(schema);
  return texts;
}

type ToolGuidanceDefinitionV3 = { name: string; description?: string; parameters?: unknown };
/** Reserve only the final wire tool set; archived intermediate declarations are not model-visible. */
export function activeToolGuidanceV3(
  context: { messages: readonly unknown[] },
  strictSchemas: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>> = {},
): { texts: string[]; lines: number; bytes: number } {
  const active = new Map<string, ToolGuidanceDefinitionV3>();
  for (const message of context.messages) {
    if (!message || typeof message !== 'object' || !('role' in message) || message.role !== 'system') continue;
    const system = message as { toolsAdded?: readonly ToolGuidanceDefinitionV3[]; toolsRemoved?: readonly { name: string }[] };
    // Match Pi's getCurrentTools: each delta removes first, then adds/replaces by name.
    for (const tool of system.toolsRemoved ?? []) active.delete(tool.name);
    for (const tool of system.toolsAdded ?? []) active.set(tool.name, tool);
  }
  const texts = [...active.values()].flatMap(tool => {
    const schema = strictSchemas instanceof Map
      ? (strictSchemas.has(tool.name) ? strictSchemas.get(tool.name) : tool.parameters)
      : (Object.hasOwn(strictSchemas, tool.name) ? (strictSchemas as Readonly<Record<string, unknown>>)[tool.name] : tool.parameters);
    return [...(typeof tool.description === 'string' ? [tool.description] : []), ...schemaGuidanceProseV3(schema)];
  });
  return { texts, lines: texts.reduce((sum, text) => sum + guidanceCostV3(text), 0), bytes: texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0) };
}
