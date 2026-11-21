import katex from 'katex';

const closers = { '$': '$', '$$': '$$', '\\(': '\\)', '\\[': '\\]' } as const;
type Opener = keyof typeof closers;
export interface ProofFormula { start: number; end: number; open: Opener; close: string; body: string; display: boolean }
export interface ProofLatexIssue { start: number; end: number; original: string; expected: string; message: string; requestable?: false }

function escaped(text: string, at: number): boolean {
  let n = 0;
  while (at > n && text[at - n - 1] === '\\') n++;
  return n % 2 === 1;
}

/** Only infer a missing delimiter at an equation line boundary, never across ordinary prose. */
function equationLine(line: string): boolean {
  const visible = line.replace(/\\(?:text|operatorname|mathrm)\{[^{}]*\}|\\[a-zA-Z]+/g, 'x');
  return !!line.trim() && !/[a-zA-Z]{4}|\b[a-zA-Z]{2,}\s+[a-zA-Z]{2,}\b|\p{Script=Han}|[£$§#\x60]/u.test(visible);
}

export function proofFormulaAt(text: string, start: number, limit = text.length): ProofFormula | undefined {
  const two = text.slice(start, start + 2);
  const open = two === '$$' || two === '\\(' || two === '\\[' ? two : text[start] === '$' ? '$' : undefined;
  if (!open || escaped(text, start)) return;
  const display = open === '$$' || open === '\\[';
  const from = start + open.length;
  if (open === '$' && (!text[from] || /\s/.test(text[from]))) return;
  const finish = (end: number, close: string): ProofFormula | undefined => {
    const body = text.slice(from, end);
    if (!body.trim() || open === '$' && /\s$/.test(body)) return;
    return { start, end: end + close.length, open, close, body, display };
  };
  const tokens = /\r?\n|\${1,2}|\\[[\]()]/g;
  tokens.lastIndex = from;
  let lastLine = from;
  let mathLines = true;
  const inferEnd = (end: number) => {
    const body = text.slice(from, end).trimEnd();
    if (display && mathLines && body && body.split(/\r?\n/).filter(s => s.trim()).every(equationLine)) {
      return finish(from + body.length, '');
    }
  };
  while (true) {
    const token = tokens.exec(text);
    const at = token && token.index < limit ? token.index : limit;
    const value = at === limit ? '' : token![0];
    if (!value || value.endsWith('\n')) {
      const line = text.slice(lastLine, at);
      const blank = !line.trim();
      const barrier = /^\s*(?:#{1,6}\s|\x60{3}|~{3})/.test(line);
      const next = at + value.length;
      const nextEnd = text.indexOf('\n', next);
      const nextText = text.slice(next, nextEnd < 0 ? limit : Math.min(nextEnd, limit)).trim();
      const paragraphBreak = blank && lastLine !== from && nextText && !equationLine(nextText) && nextText !== closers[open];
      if (!value || !display || paragraphBreak || barrier) {
        const end = blank || barrier || !equationLine(line) ? lastLine : at;
        return inferEnd(end);
      }
      if (!blank && !equationLine(line)) {
        // A complete display can contain words in TeX. Keep looking for its explicit end,
        // but do not combine two displays or infer the extent of an ambiguous fragment.
        mathLines = false;
      }
      lastLine = at + value.length;
      continue;
    }
    if (escaped(text, at)) continue;
    if (value === '$$' && open === '$') return finish(at, '$');
    if (value === closers[open]) {
      if (open === '$' && /\d/.test(text[at + 1] ?? '') && /^\d/.test(text[from] ?? '')) return;
      if (value === '$$' && !text.slice(lastLine, at).trim() && /[^\s,.;:!?，。；：！？、]/.test(text[at + 2] ?? ' ')) {
        return inferEnd(lastLine);
      }
      return finish(at, value);
    }
    if (value === '$$' || value === '\\[' || value === '\\(' || value === '\\]' || value === '\\)') {
      if (display && (value === '\\]' || value === '$$') || !display && value === '\\)') return finish(at, value);
      return;
    }
    if (value === '$' && display && (text[at + 1] === undefined || /[\r\n]/.test(text[at + 1]!)) &&
        mathLines && equationLine(text.slice(from, at).trim())) return finish(at, value);
  }
}

/** Recover uniformly double-escaped TeX commands, preserving matrices and row separators. */
function unescapeCommands(source: string): string {
  if (/(?<!\\)\\(?!\\)/.test(source) || /\\{3,}|\\\\(?:begin|end)\b/.test(source)) return source;
  const command = /^(?:(?:frac|dfrac|tfrac|int|iint|iiint|oint|sum|prod|sqrt|lim|infty|sin|cos|tan|arcsin|arccos|log|ln|exp|pi|theta|alpha|beta|gamma|delta|Delta|lambda|mu|sigma|omega|Omega|left|right|cdot|times|leq|geq|neq|approx|to|in|mathbb|mathrm|mathbf|mathcal|text)(?![A-Za-z])|[,;!])/;
  const escapes = [...source.matchAll(/\\\\/g)];
  if (!escapes.length || escapes.some(match => !command.test(source.slice(match.index + 2)))) return source;
  return source.replaceAll('\\\\', '\\');
}

export function latexDisplay(source: string): string {
  const body = unescapeCommands(source);
  // When a final group contains exactly one TeX atom, its closing position is unambiguous.
  const finalGroup = /\{(?:[A-Za-z0-9]|\\[A-Za-z]+)\s*$/.exec(body);
  if (!finalGroup || escaped(body, finalGroup.index) || /[%#]/.test(body)) return body;
  let depth = 0;
  for (const brace of body.matchAll(/[{}]/g)) {
    if (escaped(body, brace.index)) continue;
    depth += brace[0] === '{' ? 1 : -1;
    if (depth < 0) return body;
  }
  return depth === 1 ? body.replace(/\s*$/, tail => '}' + tail) : body;
}

function latexError(body: string, displayMode: boolean): string | undefined {
  try {
    katex.renderToString(body, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20 });
  } catch (e) { return e instanceof Error ? e.message : 'Invalid LaTeX formula'; }
}

function orphanDisplay(text: string, at: number, previousEnd: number): ProofFormula | undefined {
  const lineStart = Math.max(previousEnd, text.lastIndexOf('\n', at - 1) + 1);
  const nextLine = text.indexOf('\n', at);
  const left = text.slice(lineStart, at);
  const right = text.slice(at + 2, nextLine < 0 ? text.length : nextLine);
  if (left.trim() && right.trim()) return;
  if (!right.trim()) {
    let start = lineStart;
    let line = left;
    if (!line.trim() && start > previousEnd) {
      start = Math.max(previousEnd, text.lastIndexOf('\n', lineStart - 2) + 1);
      line = text.slice(start, lineStart - 1);
    }
    // A single dedicated equation immediately before an orphan closing delimiter.
    if (equationLine(line) && /[=^_\\]/.test(line) && !/^(?: {4}|\t)/.test(line)) {
      const before = text.slice(Math.max(previousEnd, text.lastIndexOf('\n', start - 2) + 1), start).trim();
      if (!before || !equationLine(before)) {
        start += line.length - line.trimStart().length;
        return { start, end: at + 2, display: true, open: '$$', close: '$$', body: text.slice(start, at) };
      }
    }
  }
  return { start: at, end: at + 2, display: true, open: '$$', close: '', body: '' };
}

function* formulas(text: string): Generator<ProofFormula> {
  // Protect Markdown code fences, code spans, indented code and link destinations.
  const tokens = /^(?: {0,3}(?:>[ \t]?)* {0,3}(\x60{3,}|~{3,})[^\n]*|(?: {4}|\t)[^\n]*)|\x60+|\]\((?:\\.|[^()\n]|\([^()\n]*\))*\)|<?https?:\/\/[^\s<>]+>?|\${1,2}|\\[[()]/gm;
  let fence = '', previousEnd = 0;
  for (let token; (token = tokens.exec(text));) {
    const value = token[0], at = token.index;
    if (token[1]) {
      const marker = token[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !value.slice(value.indexOf(marker) + marker.length).trim()) fence = '';
      continue;
    }
    if (fence || escaped(text, at)) continue;
    if (value[0] === '\x60') {
      const close = new RegExp('(?<!\x60)' + value + '(?!\x60)', 'g');
      close.lastIndex = tokens.lastIndex;
      const end = close.exec(text);
      if (end && !/\r?\n[ \t]*\r?\n/.test(text.slice(at, end.index))) tokens.lastIndex = end.index + value.length;
      continue;
    }
    if (!Object.hasOwn(closers, value)) continue;
    const formula = proofFormulaAt(text, at) ?? (value === '$$' ? orphanDisplay(text, at, previousEnd) : undefined);
    if (formula) { yield formula; previousEnd = tokens.lastIndex = formula.end; }
  }
}

export function repairProofLatex(source: string): { markdown: string; issues: ProofLatexIssue[] } {
  let markdown = '', cursor = 0;
  const issues: ProofLatexIssue[] = [];
  for (const formula of formulas(source)) {
    markdown += source.slice(cursor, formula.start);
    const body = latexDisplay(formula.body);
    const message = body ? latexError(body, formula.display) : 'Unmatched display delimiter. The formula boundary is ambiguous.';
    const original = source.slice(formula.start, formula.end);
    if (message) {
      const start = markdown.length;
      issues.push({ start, end: start + original.length, original, message,
        ...(body ? {} : { requestable: false as const }),
        expected: body ? 'One equivalent KaTeX formula delimited by ' + formula.open + ' and ' + closers[formula.open] + ', preserving every mathematical assertion.'
          : 'An identifiable display equation with opening and closing $$ delimiters.' });
      markdown += original;
    } else markdown += formula.open + body + closers[formula.open];
    cursor = formula.end;
  }
  return { markdown: markdown + source.slice(cursor), issues };
}

export function applyProofLatexReplacement(markdown: string, issue: ProofLatexIssue, replacement: string): string | undefined {
  if (issue.requestable === false || markdown.slice(issue.start, issue.end) !== issue.original) return;
  const formula = proofFormulaAt(replacement, 0);
  const original = proofFormulaAt(issue.original, 0) ?? (issue.original.endsWith('$$') ? orphanDisplay(issue.original, issue.original.length - 2, 0) : undefined);
  if (!formula || !original || formula.end !== replacement.length || formula.close !== closers[formula.open] ||
      formula.open !== original.open || latexError(formula.body, formula.display)) return;
  // Reject edits to literal operands or operators even when the proposed formula parses.
  const literals = (body: string) => body.replace(/\\(?:begin|end)\{[a-zA-Z*]+\}|\\[a-zA-Z]+|[\s{}]/g, '');
  if (literals(formula.body) !== literals(original.body)) return;
  return markdown.slice(0, issue.start) + replacement + markdown.slice(issue.end);
}
