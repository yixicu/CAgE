export interface TreeNodeView {
  id: string; parentId?: string; title: string; caption?: string; status: string;
  tone: 'idle' | 'running' | 'success' | 'failed' | 'review';
  tags?: {label:string;tone:TreeNodeView['tone'];category:string}[]; conditions?: string[]; steps?: string[]; obstacles?: string[]; finding?: string;
  summary: string; details: { label: string; text: string }[]; path?: string;
}
/** Color describes execution, never whether a scientific hypothesis is true. */
export function executionTone(status: string, execution?: string): TreeNodeView['tone'] {
  if (execution === 'failed' || status === 'failed') return 'failed';
  if (execution === 'interrupted' || ['interrupted', 'needs_review', 'blocked'].includes(status)) return 'review';
  if (status === 'active' && !execution || status === 'running') return 'running';
  if (execution === 'completed' || ['completed', 'compatible', 'conditionally_compatible', 'contradictory', 'inconclusive'].includes(status)) return 'success';
  return 'idle';
}
export const readable = (text: string) => text.replaceAll('_', ' ');
/** Shorten request boilerplate only; full question, qualifiers and negation survive. */
export const compactNodeTitle = (text: string) => text.trim().replace(/^(?:please\s+)?(?:investigate|determine whether|check whether|test whether|prove or disprove)\s+/i, '') || text;
export const fields = (values: Record<string, string | undefined>) => Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]).map(([label, text]) => ({ label, text }));
