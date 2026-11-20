import { isDeepStrictEqual } from 'node:util';
import { createScanner, visit } from 'jsonc-parser';
// jsonc-parser 3.3.1 exports an ambient const enum, incompatible with verbatimModuleSyntax.
// These documented scanner token numbers are pinned with that dependency.
const SyntaxKind = { CloseBraceToken: 2, CloseBracketToken: 4, CommaToken: 5, LineCommentTrivia: 12, BlockCommentTrivia: 13, LineBreakTrivia: 14, Trivia: 15, EOF: 17 } as const;
import type { ToolArgumentEvidence } from './tool-argument-audit.js';

export class SafeToolArgumentsError extends Error {
  constructor(readonly kind: 'format' | 'protocol', readonly diagnostics: readonly { path: string; message: string }[]) {
    super(kind === 'protocol' ? 'Tool argument evidence is not trustworthy.' : 'Tool argument syntax is not safely recoverable.');
    this.name = 'SafeToolArgumentsError';
  }
}
export interface SafeToolArguments {
  value: unknown; originalRaw: string; effectiveRaw: string; repaired: boolean;
  repairs: ('fence' | 'comments' | 'trailing-commas')[]; sdkEmptyFallback: boolean;
}
function reject(kind: 'format' | 'protocol', message: string): never {
  throw new SafeToolArgumentsError(kind, [{ path: '/', message }]);
}
/** Syntax-only sanitation. The parser must consume a complete tree; never synthesize values or closing tokens. */
export function sanitizeCompleteJson(raw: string): Omit<SafeToolArguments, 'sdkEmptyFallback'> {
  let text = raw;
  const repairs: SafeToolArguments['repairs'] = [];
  const fence = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  if (fence) { text = fence[1]; repairs.push('fence'); }
  const diagnostics: { path: string; message: string }[] = [];
  const add = (message: string) => { if (diagnostics.length < 32) diagnostics.push({ path: '/', message }); };
  const keys: Set<string>[] = [];
  visit(text, {
    onObjectBegin: () => { keys.push(new Set()); },
    onObjectProperty: name => { const seen = keys.at(-1)!; if (seen.has(name)) add('Duplicate decoded object property.'); seen.add(name); },
    onObjectEnd: () => { keys.pop(); },
    onLiteralValue: value => { if (typeof value === 'number' && !Number.isFinite(value)) add('Nonfinite JSON number.'); },
    onError: (_error, offset) => { add(`Invalid or incomplete JSON syntax at UTF-16 offset ${offset}.`); },
  }, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false });
  if (diagnostics.length) throw new SafeToolArgumentsError('format', diagnostics);
  const scanner = createScanner(text, false);
  const removals: { start: number; end: number }[] = [];
  let comma: { start: number; end: number } | undefined;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    const start = scanner.getTokenOffset(), end = start + scanner.getTokenLength();
    if (kind === SyntaxKind.LineCommentTrivia || kind === SyntaxKind.BlockCommentTrivia) {
      removals.push({ start, end }); if (!repairs.includes('comments')) repairs.push('comments'); continue;
    }
    if (kind === SyntaxKind.Trivia || kind === SyntaxKind.LineBreakTrivia) continue;
    if ((kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken) && comma) {
      removals.push(comma); if (!repairs.includes('trailing-commas')) repairs.push('trailing-commas');
    }
    comma = kind === SyntaxKind.CommaToken ? { start, end } : undefined;
  }
  removals.sort((a, b) => a.start - b.start);
  const pieces: string[] = []; let previous = 0;
  for (const removal of removals) { pieces.push(text.slice(previous, removal.start), ' '); previous = removal.end; }
  pieces.push(text.slice(previous));
  const effectiveRaw = pieces.join('');
  let value: unknown;
  try { value = JSON.parse(effectiveRaw); } catch { return reject('format', 'Sanitized text is not complete JSON.'); }
  return { value, originalRaw: raw, effectiveRaw, repaired: repairs.length > 0, repairs };
}
/** Transport completeness and stable identity are mandatory; schema/scientific validation is the caller's next gate. */
export function decodeSafeToolArguments(evidence: ToolArgumentEvidence): SafeToolArguments {
  if (evidence.coverage === 'insufficient' || evidence.incomplete || evidence.identityValid !== true || typeof evidence.rawArguments !== 'string') {
    return reject('protocol', 'Complete exact-identity original argument evidence is required.');
  }
  const raw = evidence.rawArguments;
  let originalValid = false;
  try { JSON.parse(raw); originalValid = true; } catch { /* Narrow sanitation below. */ }
  const decoded = sanitizeCompleteJson(raw);
  const equal = isDeepStrictEqual(decoded.value, evidence.sdkArguments);
  const sdk = evidence.sdkArguments;
  const empty = evidence.sdkEmptyObject !== false && sdk !== null && typeof sdk === 'object' && Object.getPrototypeOf(sdk) === Object.prototype && Reflect.ownKeys(sdk).length === 0;
  if (!equal && (originalValid || !empty)) return reject('protocol', 'Original or effective JSON contradicts the SDK interpretation.');
  return { ...decoded, sdkEmptyFallback: !equal && empty };
}
