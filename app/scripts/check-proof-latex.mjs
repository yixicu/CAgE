import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { decodeHTML } from 'entities';
import { applyProofLatexReplacement, repairProofLatex } from '../src/shared/proof-latex.ts';

// The browser sources use Vite's extensionless TypeScript imports.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context);
    if (context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0,-3) + '.ts', context);
    return next(specifier, context);
  },
});
const { renderMarkdown } = await import('../web/markdown.ts');
const { researchPaper } = await import('../src/presentation/research-paper.ts');
const raw = String.raw;
const untouched = [
  raw`Price from $5–$10. Literal \$ and \$5.`,
  raw`Adjacent $x$$y$. A valid display follows $$x = y$$.`,
  raw`In text \(\frac{1}{2}\).`,
  '$$\r\nx = y\r\n\r\n+ z\r\n$$',
  raw`\[\begin{cases} a,&x>0,\\[2mm] b,&x\le0. \end{cases}\]`,
  'A code span `$\\unknown$`',
  '~~~tex\n$$\\unknown$$\n~~~\n    $$\\unknown$$',
  '[source](https://example.org/$\\unknown$) and https://example.org/$\\unknown$',
];
for (const input of untouched) assert.deepEqual(repairProofLatex(input), { markdown: input, issues: [] });
for (const [input, expected] of [
  [raw`$$x = y\]`, '$$x = y$$'],
  ['$$\nx = y\n$', '$$\nx = y\n$$'],
  ['$$x=y', '$$x=y$$'],
  ['$$x=y\n\nA separate paragraph.', '$$x=y$$\n\nA separate paragraph.'],
  ['$$x=y\n$$z=w$$', '$$x=y$$\n$$z=w$$'],
  ['$$\nx=y\n```js\n1+1\n```', '$$\nx=y$$\n```js\n1+1\n```'],
  [raw`Evaluate $\frac{1}{2$ here.`, raw`Evaluate $\frac{1}{2}$ here.`],
  [raw`A $\\frac{1}{2}$ term.`, raw`A $\frac{1}{2}$ term.`],
]) {
  assert.deepEqual(repairProofLatex(input), { markdown: expected, issues: [] });
  assert.equal(renderMarkdown(input).includes('katex-error'), false);
  assert.ok(renderMarkdown(input).includes('class="katex"'));
}

for (const input of ['x=y$$', 'x=y\n$$']) {
  assert.deepEqual(repairProofLatex(input), {markdown:'$$' + input, issues:[]});
}
for (const input of ['Evidence.\n$$\n\nA paragraph of prose.', 'Evidence.\n$$\n```tex\n$\\bad$\n```']) {
  const result = repairProofLatex(input);
  assert.equal(result.markdown, input);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(input.slice(issue.start, issue.end), '$$');
  assert.equal(issue.requestable, false);
  assert.equal(applyProofLatexReplacement(input, issue, '$$x$$'), undefined);
}

const original = raw`🧪 $\\frac12$ first, $\sqqrt{x}$ here, and $\sqqrt{x}$ again.`;
const { markdown, issues } = repairProofLatex(original);
assert.equal(issues.length, 2);
for (const issue of issues) {
  assert.equal(markdown.slice(issue.start, issue.end), raw`$\sqqrt{x}$`);
  assert.match(issue.message, /Undefined control sequence/);
  assert.match(issue.expected, /delimited/);
}
const valid = raw`$\sqrt{x}$`;
assert.equal(applyProofLatexReplacement(markdown, issues[1], valid), markdown.slice(0, issues[1].start) + valid + ' again.');
for (const invalid of ['$$x$$', '$x$ and $y$', '$x', '$0$', raw`$\sqrt{y}$`, raw`$\sqqrt{x}$`, 'prefix $x$', '$x$\n']) {
  assert.equal(applyProofLatexReplacement(markdown, issues[0], invalid), undefined);
}
assert.equal(applyProofLatexReplacement('changed ' + markdown, issues[1], valid), undefined);

function checkDisplays(body, count) {
  assert.deepEqual(repairProofLatex(body), { markdown: body, issues: [] });
  const html = renderMarkdown(body, { paperMath: true });
  assert.equal((html.match(/<div class="math-block">/g) ?? []).length, count);
  assert.doesNotMatch(html, /katex-error|<h1>/);
  const expected = [...body.matchAll(/^(\\\[|\$\$)\r?\n([\s\S]*?)\r?\n(?:\\\]|\$\$)$/gm)].map(m => m[2].replaceAll('\r\n','\n').trim());
  const rendered = [...html.matchAll(/<div class="math-block">[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map(m => decodeHTML(m[1]));
  assert.deepEqual(rendered, expected);
}
const manuscript = 'The wave equation follows.\n\\[\ni\\hbar\\partial_t\\psi\n=\nH\\psi\n\\]\nConclusion.\n$$\n' +
  '\\begin{cases}a,&x>0,\\\\[2mm]b,&x\\le0.\\end{cases}\n$$';
checkDisplays(manuscript, 2);
for (const proof of ['$$x=y$$.', '$$\n\nCannot infer a formula here.']) {
  const paper = researchPaper('## Proof\n' + proof + '\n## Restriction\nBounded domain.');
  assert.equal(paper.sections.find(s => s.id === 'proof').content, proof);
  assert.equal(paper.sections.find(s => s.id === 'restriction').content, 'Bounded domain.');
}
if (process.argv[2]) {
  const { body } = JSON.parse(await readFile(process.argv[2], 'utf8'));
  checkDisplays(body, (body.match(/^\\\[$/gm) ?? []).length);
}
// Exercise the full report renderer with valid reference links late in a long manuscript.
const sections = Array.from({length: 512}, (_, i) => [
  '## Mode ' + i,
  'The boundary term vanishes on this interval. '.repeat(18) + 'See [derivation][source].',
  '$$\nE_n = n^2 E_1\n$$',
].join('\n\n'));
const longProof = sections.join('\n\n') + '\n\n[source]: https://example.org/derivation\n\nEnd of proof.';
const longHtml = renderMarkdown(longProof, {paperMath: true});
assert.equal((longHtml.match(/<h2>/g) ?? []).length, sections.length);
assert.equal((longHtml.match(/class="math-block"/g) ?? []).length, sections.length);
assert.equal((longHtml.match(/href="https:\/\/example\.org\/derivation"/g) ?? []).length, sections.length);
assert.ok(longHtml.includes('End of proof.'));
console.log('PASS formula repair, fragment replacement, literal Markdown, and proof rendering (' + Buffer.byteLength(longProof) + ' byte long report)');
