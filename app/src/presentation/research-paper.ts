import { proofFormulaAt } from '../shared/proof-latex.js';

/** Reader-facing convention, with no dependency on a research loop or provider. */
export const RESEARCH_PAPER_INSTRUCTION = String.raw`
Required presentation convention for the summary string only: write a concise,
single-column scientific paper in the researcher's language, with exactly these
Markdown section headings in order:
## Summary
State the scoped finding and evidence status in at most three sentences.
## Proof
Give the necessary definitions, premises and a checkable derivation or
counterexample. Use precise inference steps and theorem citations. Typeset key
equations as LaTeX display math on separate lines, using $$ ... $$ or \[ ... \].
Use inline LaTeX only for short symbols. In the outer JSON string, escape LaTeX
backslashes correctly. Do not put mathematics in code fences. Keep prose to
essential definitions, explanations and logical links. Do not add a literature
review, conversational introduction, repeated conclusion or execution log.
## Restriction
Retain every material assumption, domain restriction, strongest unresolved
objection, disagreement, missing datum and limit of verification. Distinguish
conditional derivation from established evidence. If no proof is available, say
so in Proof and identify the gap here; never invent steps to fill this template.
## Reference
Include this last section only when actual sources are cited. Give source IDs or
available bibliographic details and locators; do not invent titles, links, page
numbers or verified status. Use numbered citations consistently in the proof.
This convention formats the existing result; it does not change any scientific
verdict, frozen input, schema field, research stage, permission or budget. Keep all
other response fields required by the scientific schema. Checkpoint metadata
already retains opaque IDs and token/cost bookkeeping; omit them from the paper
unless needed to identify evidence. Concision must never remove a condition.
`;

export type PaperSectionId = 'summary' | 'proof' | 'restriction' | 'reference';
export const DIRECTION_LABEL_INSTRUCTION = '\nFor reader-facing candidate question labels, use one concise academic clause describing the target proposition or method. Omit conversational lead-ins and repeated research instructions. Retain every defining domain, qualifier and negation; keep full premises and inference direction in their existing fields. Do not change the question to an asserted result.';
export interface PaperSection { id: PaperSectionId; title: string; content: string }
export interface ResearchPaper { sections: PaperSection[]; original?: string }

const names: Record<PaperSectionId, string> = {
  summary: 'Summary', proof: 'Proof', restriction: 'Restriction', reference: 'Reference',
};
const aliases: Record<string, PaperSectionId> = {
  summary: 'summary', abstract: 'summary', '简要概括': 'summary', '摘要': 'summary', '概述': 'summary',
  proof: 'proof', derivation: 'proof', '证明': 'proof', '推导': 'proof',
  restriction: 'restriction', restrictions: 'restriction', limitations: 'restriction',
  '限制': 'restriction', '限制条件': 'restriction', '适用范围': 'restriction',
  reference: 'reference', references: 'reference', bibliography: 'reference', '引用': 'reference', '参考文献': 'reference',
};

function sectionHeading(line: string): PaperSectionId | undefined {
  // Explicit headings only. A theorem, code example or ordinary sentence must
  // never be guessed to be a section boundary or a scientific conclusion.
  const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]
    ?? line.match(/^\s*\*\*([^*]+)\*\*\s*$/)?.[1];
  return heading ? aliases[heading.replace(/^\d+[.)]?\s+/, '').replace(/[:：]\s*$/, '').trim().toLowerCase()] : undefined;
}

/** Pure view projection: no mutation, truncation, factual rewriting or retries. */
export function researchPaper(markdown: string): ResearchPaper {
  const content: Record<PaperSectionId, string[]> = { summary: [], proof: [], restriction: [], reference: [] };
  const preamble: string[] = [];
  let current: PaperSectionId | undefined;
  let fence = '';
  const source = markdown.replaceAll('\r\n', '\n');
  let offset = 0, displayEnd = 0;
  let recognized = false;
  for (const line of source.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    const start = offset;
    offset += line.length + 1;
    const inDisplay = start < displayEnd;
    const heading = !fence && !inDisplay && !marker ? sectionHeading(line) : undefined;
    if (heading) { current = heading; recognized = true; continue; }
    (current ? content[current] : preamble).push(line);
    if (marker && !inDisplay) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && /^\s*(?:`+|~+)\s*$/.test(line)) fence = '';
    } else if (!fence && !inDisplay && /^ {0,3}(?:\$\$|\\\[)/.test(line)) {
      const formula = proofFormulaAt(source, start + line.length - line.trimStart().length);
      if (formula) displayEnd = formula.end;
    }
  }
  const original = !recognized && markdown.trim() ? markdown : undefined;
  if (recognized && preamble.some(line => line.trim())) content.summary.unshift(...preamble, '');
  const sections = (Object.keys(names) as PaperSectionId[])
    .filter(id => id !== 'reference' || content.reference.some(line => line.trim()))
    .map(id => ({ id, title: names[id], content: content[id].join('\n').trim() }));
  return { sections, ...(original ? { original } : {}) };
}
