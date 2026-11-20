/** Recover uniformly double-escaped standalone TeX from old JSON responses.
 * Mixed escaping, environments and genuine row separators remain untouched.
 * Stored Markdown is never changed; the renderer retains the original source.
 */
export function latexDisplay(source: string): string {
  if (/(?<!\\)\\(?!\\)/.test(source) || /\\{3,}|\\\\(?:begin|end)\b/.test(source)) return source;
  const command = /^(?:(?:frac|dfrac|tfrac|int|iint|iiint|oint|sum|prod|sqrt|lim|infty|sin|cos|tan|arcsin|arccos|log|ln|exp|pi|theta|alpha|beta|gamma|delta|Delta|lambda|mu|sigma|omega|Omega|left|right|cdot|times|leq|geq|neq|approx|to|in|mathbb|mathrm|mathbf|mathcal|text)(?![A-Za-z])|[,;!])/;
  const escapes = [...source.matchAll(/\\\\/g)];
  if (!escapes.length || escapes.some(match => !command.test(source.slice(match.index! + 2)))) return source;
  return source.replaceAll('\\\\', '\\');
}
