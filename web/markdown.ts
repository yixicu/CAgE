import { latexDisplay } from './latex-display';
import { plainEquations } from './plain-equations';
import MarkdownIt from 'markdown-it';
import katex from 'katex';

// This is the only HTML-producing boundary in the GUI. Raw document HTML is
// always escaped; only markdown-it and untrusted-mode KaTeX generate markup.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
const math = (source: string, displayMode: boolean) => {
  const renderedSource = latexDisplay(source);
  const html = katex.renderToString(renderedSource, {
    displayMode, throwOnError: false, trust: false, strict: 'warn', maxExpand: 500, maxSize: 20,
  });
  return renderedSource === source ? html : `<span data-latex-repaired="true" data-original-latex="${md.utils.escapeHtml(source)}" title="Repeated LaTeX escapes corrected for display; the saved source is unchanged.">${html}</span>`;
};

md.inline.ruler.before('escape', 'carnot_math', (state, silent) => {
  const start = state.pos;
  const display = state.src.startsWith('$$', start) || state.src.startsWith('\\[', start);
  const bracket = state.src.startsWith('\\(', start) || state.src.startsWith('\\[', start);
  if (!bracket && state.src[start] !== '$') return false;
  const open = bracket ? (display ? '\\[' : '\\(') : display ? '$$' : '$';
  const close = bracket ? (display ? '\\]' : '\\)') : display ? '$$' : '$';
  const from = start + open.length;
  let end = state.src.indexOf(close, from);
  while (end > from && state.src[end - 1] === '\\' && !bracket) end = state.src.indexOf(close, end + 1);
  if (end < from || end >= state.posMax) return false;
  const content = state.src.slice(from, end);
  if (!content.trim() || (!display && (content.includes('\n') || (!bracket && /^\s|\s$/.test(content))))) return false;
  const punctuation = state.src.slice(end + close.length).match(/^[,.;:!?，。；：！？、]+/)?.[0] || '';
  if (!silent) {
    const token = state.push('carnot_math_inline', 'math', 0);
    token.content = content;
    token.meta = { punctuation, display, paperMath: !!state.env.paperMath };
  }
  state.pos = end + close.length + punctuation.length;
  return true;
});
md.renderer.rules.carnot_math_inline = (tokens, index) => {
  const token = tokens[index]!;
  const display = !!token.meta?.display || !!token.meta?.paperMath && /(?:=|\\(?:approx|equiv|leq|geq)\b)/.test(token.content);
  const punctuation = token.meta?.punctuation;
  if (display) return `<span class="math-block">${math(token.content + (punctuation ?? ''), true)}</span>`;
  const rendered = math(token.content, false);
  // Keep punctuation with its equation without changing the source or trusting HTML.
  return typeof punctuation === 'string' && punctuation ? `<span class="inline-equation">${rendered}${md.utils.escapeHtml(punctuation)}</span>` : rendered;
};
md.core.ruler.after('inline', 'paper_plain_equations', state => {
  if (!state.env.paperMath) return;
  for (const block of state.tokens) {
    if (!block.children) continue;
    let linkDepth = 0;
    block.children = block.children.flatMap(child => {
      if (child.type === 'link_open') linkDepth++;
      if (child.type === 'link_close') linkDepth--;
      if (child.type !== 'text' || linkDepth) return [child];
      const output = []; let from = 0;
      for (const equation of plainEquations(child.content)) {
        try { katex.renderToString(equation.latex, { throwOnError: true, trust: false, maxExpand: 500, maxSize: 20 }); }
        catch { continue; }
        if (equation.start > from) { const text = new state.Token('text', '', 0); text.content = child.content.slice(from, equation.start); output.push(text); }
        const token = new state.Token('carnot_plain_equation', 'math', 0);
        const punctuation = child.content.slice(equation.end).match(/^[,.;:!?，。；：！？、]+/)?.[0] ?? '';
        token.content = equation.latex + punctuation; token.meta = { original: equation.source + punctuation };
        output.push(token); from = equation.end + punctuation.length;
      }
      if (!from) return [child];
      if (from < child.content.length) { const text = new state.Token('text', '', 0); text.content = child.content.slice(from); output.push(text); }
      return output;
    });
  }
});
md.renderer.rules.carnot_plain_equation = (tokens, index) => {
  const token = tokens[index]!;
  const original = typeof token.meta?.original === 'string' ? token.meta.original : token.content;
  return `<span class="math-block" data-plain-math="true" data-original-math="${md.utils.escapeHtml(original)}" title="Plain-text equation typeset for display; the saved source is unchanged.">${math(token.content, true)}</span>`;
};
md.block.ruler.before('fence', 'carnot_math_block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const first = state.src.slice(start, state.eMarks[startLine]).trim();
  const delimiter = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : '';
  if (!delimiter) return false;
  const close = delimiter === '$$' ? '$$' : '\\]';
  const closing = first.indexOf(close, delimiter.length);
  // A display followed by prose/punctuation belongs to the inline math rule.
  // Do not consume subsequent paragraphs while searching for another closer.
  if (closing >= 0 && closing !== first.length - close.length) return false;
  if (silent) return true;
  let content = first.slice(delimiter.length);
  let nextLine = startLine + 1;
  if (content.endsWith(close)) content = content.slice(0, -close.length);
  else {
    let closed = false;
    while (nextLine < endLine) {
      const line = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
      nextLine += 1;
      const closing = line.indexOf(close);
      if (closing >= 0 && line.slice(closing + close.length).trim()) return false;
      if (line.trimEnd().endsWith(close)) {
        content += '\n' + line.trimEnd().slice(0, -close.length);
        closed = true;
        break;
      }
      content += '\n' + line;
    }
    if (!closed) return false;
  }
  const token = state.push('carnot_math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, nextLine];
  state.line = nextLine;
  return true;
});
md.renderer.rules.carnot_math_block = (tokens, index) => `<div class="math-block">${math(tokens[index]!.content, true)}</div>\n`;
md.renderer.rules.image = (tokens, index) => `<span class="image-placeholder">[Image: ${md.utils.escapeHtml(tokens[index]!.content)}]</span>`;
md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index]!.attrSet('rel', 'noopener noreferrer');
  tokens[index]!.attrSet('target', '_blank');
  return renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(source: string, options: { paperMath?: boolean } = {}): string {
  return md.render(source, options);
}
