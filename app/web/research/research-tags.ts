export type TagTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'idle' | 'code';

/** Lexical navigation labels only; exact task wording remains in expanded details. */
export function proofTerms(description: string): string[] {
  const filler = /^(?:a|an|the|its|their|each|this|that|it|we|i|derive|solve|expand|verify|check|show|prove|compute|calculate|use|using|obtain|find|determine|confirm|test|ensure|do|is|are|be)$/i;
  const terms = description.split(/[,;.!?\n]|\b(?:and|or|then|by|from|in|into|with|through|for|of|to|via)\b/iu).flatMap(part => {
    const words = (part.match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) ?? []).filter(word => !filler.test(word));
    return words.length ? [words.at(-1)!] : [];
  });
  return [...new Map(terms.map(term => [term.toLocaleLowerCase(), term])).values()];
}

export function agentTag(role: string): { label: string; tone: TagTone } {
  if (/theorist/i.test(role)) return { label: 'Theorist', tone: 'info' };
  if (/worker/i.test(role)) return { label: /way-worker/i.test(role) ? 'Way worker' : role.match(/^Worker \d+$/i)?.[0] ?? 'Worker', tone: 'code' };
  if (/moderator/i.test(role)) return { label: 'Moderator', tone: 'accent' };
  return { label: role.replaceAll('_', ' '), tone: 'idle' };
}

export function statusTag(status: string): { label: string; tone: TagTone } {
  const label = status === 'informed by delivered evidence' ? 'informed' : status.replaceAll('_', ' ');
  const value = status.toLowerCase().replaceAll('_', '-');
  const tone: TagTone = /^(?:failed|rejected|execution failed)$/.test(value) ? 'danger'
    : /^(?:unreviewed|not reviewed|needs-review|deferred|interrupted|blocked|not adopted|not accepted)$/.test(value) ? 'warning'
    : /^(?:completed|valid|adopted|report returned)$/.test(value) ? 'success'
    : /^(?:running|exploring|queued|ready|selected)$/.test(value) ? 'info' : 'idle';
  return { label, tone };
}
