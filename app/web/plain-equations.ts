export interface PlainEquation { start: number; end: number; source: string; latex: string }
const names = /^(?:alpha|beta|gamma|delta|Delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|psi|omega|Omega|sin|cos|tan|exp|log|ln|sqrt)(?![A-Za-z])/;
const token = /^(?:\d+(?:\.\d+)?|[A-Za-z](?:[A-Z])?\d*(?![A-Za-z])|[+*/^_=()\[\]',−-])/;

/** Small ASCII-math subset for old proof prose; uncertain notation stays literal. */
export function plainEquations(text: string): PlainEquation[] {
  const found: PlainEquation[] = [];
  if (!text.includes('=')) return found;
  for (let start = 0; start < text.length; start++) {
    if (start && /[\p{L}\p{N}_\\]/u.test(text[start - 1]!)) continue;
    if (!/[A-Za-z\d(]/.test(text[start]!)) continue;
    const tokens: string[] = [], brackets: string[] = [];
    let cursor = start, end = start, invalid = false;
    while (cursor < text.length) {
      const tail = text.slice(cursor), space = tail.match(/^\s+/)?.[0];
      if (space) { cursor += space.length; continue; }
      const value = tail.match(names)?.[0] ?? tail.match(token)?.[0];
      if (!value) break;
      if (value === ',' && !brackets.length) break;
      if (value === '(' || value === '[') brackets.push(value);
      if ((value === ')' || value === ']') && brackets.pop() !== (value === ')' ? '(' : '[')) invalid = true;
      tokens.push(value); cursor += value.length; end = cursor;
    }
    if (invalid || brackets.length || !tokens.includes('=') || /^[+*/^_=−-]$/.test(tokens.at(-1) ?? '')
      || end === start || !/[\s,.;:!?)]|^$/.test(text[end] ?? '')) { start = Math.max(start, end - 1); continue; }
    const equals = tokens.indexOf('=');
    if (!equals || equals === tokens.length - 1) continue;
    function tex(parts: string[]): string {
      let result = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part === 'sqrt') {
          if (parts[i + 1] !== '(') throw new Error('Ambiguous square root.');
          let depth = 1, last = i + 2;
          while (last < parts.length && depth) { if (parts[last] === '(') depth++; if (parts[last] === ')') depth--; if (depth) last++; }
          if (depth) throw new Error('Unclosed square root.');
          result += `\\sqrt{${tex(parts.slice(i + 2, last))}}`; i = last;
        } else if (names.test(part)) result += `\\${part} `;
        else if (part === '(' || part === '[') result += `\\left${part}`;
        else if (part === ')' || part === ']') result += `\\right${part}`;
        else result += part.replace(/^([A-Za-z])([0-9]+)$/, '$1_{$2}').replace('−', '-');
      }
      return result;
    }
    try {
      const source = text.slice(start, end);
      // Leave ambiguous indexed names, scientific notation and multi-token powers literal.
      if (/\d[eE][+-]?\d|[A-Za-z]\d/.test(source) || /[\^_]/.test(source.replace(/[\^_][A-Za-z0-9+-](?![A-Za-z0-9.])/g, ''))) throw new Error('Unsupported plain notation.');
      const latex = tex(tokens);
      found.push({ start, end, source: text.slice(start, end), latex }); start = end - 1;
    } catch { start = end - 1; /* Do not re-interpret fragments of unsupported notation. */ }
  }
  return found;
}
