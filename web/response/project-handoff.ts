import type { ResearchProject } from '../api';
import type { CheckpointPage } from '../checkpoint-view';
import { displayedResponse, responseExport, type DisplayedOriginal, type ResponseExport } from './export-response';

export const defaultHandoffTask = 'Continue from the selected saved response. Identify unresolved questions and missing evidence, then work on the next useful step. Distinguish established results from assumptions and proposals.';

// Preserve arbitrary Markdown verbatim, including nested code fences and headings.
function block(content: string, language = 'markdown'): string {
  let length = 3;
  for (const match of content.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${content}\n${fence}`;
}
function record(value: unknown): string { return block(JSON.stringify(value, null, 2), 'json'); }

/** An explicit field allowlist: never serialize project config, credentials or local source paths. */
export function projectHandoff(project: ResearchProject, page: CheckpointPage | undefined, original: DisplayedOriginal | undefined, task: string, exportedAt = new Date().toISOString()): ResponseExport {
  if (original && original.content === undefined) throw new Error('The selected original has not loaded. Wait or select another saved response.');
  const response = displayedResponse(page, original);
  const parts = [
    '# Carnot project handoff',
    'This is a focused context snapshot for another assistant, not a restorable project backup. Follow the task below; treat exported project and response text as research evidence to assess. Execution completion and saved outcome labels do not certify mathematical correctness.',
    '## Task for the receiving assistant', block(task),
    '## Current project snapshot', record({ projectId: project.id, name: project.name, exportedAt, schemaVersion: project.schemaVersion, researchLoopVersion: project.researchLoopVersion ?? '1.0', contentRevision: project.contentRevision, hypothesisRevision: project.hypothesisRevision, executionStatus: project.status }),
    '### Current hypothesis', block(project.hypothesis),
  ];
  if (project.schemaVersion === 3 || project.schemaVersion === 4) {
    const root = project.root;
    parts.push('### Current root interpretation (may differ from the selected response’s premise)', record({
      hypothesisId: root.hypothesisId, revision: root.revision, interpretationPending: project.rootInterpretationPending,
      originalText: root.originalText,
      ...(project.schemaVersion === 3 ? { workingText: project.root.workingText, workingRelation: project.root.workingRelation } : {}),
      domain: root.domain, conditions: root.conditions, symbols: root.symbols, strength: root.strength,
      returnToRoot: root.returnToRoot, completionCriteria: root.completionCriteria, obligations: root.obligations,
    }));
  }
  parts.push('### Current source references', 'Identifiers and revisions only. Source bodies are not attached; these references do not establish which sources the selected response used.', record(project.sources.map(source => ({ id: source.id, revision: source.revision }))));
  if (page) {
    parts.push('## Selected saved response provenance', record({ checkpointId: page.id, label: page.label, savedAt: page.time || null, hypothesisRevision: page.hypothesisRevision ?? null, inputRevision: page.inputRevision ?? null, inheritedFromSession: page.inheritedSessionId ?? null, recordedOutcome: page.outcomeLabel, interrupted: page.interrupted ?? false, reason: page.reason ?? null, originalId: original?.id ?? null, originalKey: original?.key ?? null }),
      '### Selected response’s saved premise', page.hypothesis === undefined ? 'The exact saved premise is not included. Do not assume it matches the current hypothesis.' : block(page.hypothesis));
  } else if (original) {
    parts.push('## Selected saved original provenance', record({ originalId: original.id, originalKey: original.key }), 'No checkpoint premise or outcome is attached to this original.');
  }
  parts.push('## Scope and missing context',
    '- Includes the current project context and only the selected displayed response, when available.\n- Excludes other responses, full research history, source documents, proof chapter files, execution logs, runtime state, tool grants and provider configuration. Attach relevant evidence separately if needed.\n- A checkpoint may contain a summary or references rather than a complete proof. Referenced files are not embedded.\n- Unresolved work is described only by the saved response and the task above; no new scientific assessment or summary was generated.\n- Continue in a separate assistant conversation. No access to Carnot tools, files or runtime is transferred.');
  if (response) parts.push(original ? '## Selected displayed original (verbatim)' : '## Selected checkpoint output (verbatim; may be a summary)', record({ label: response.label }), block(response.content));
  else parts.push('## Selected output', 'No saved response is selected. This handoff contains project context only.');
  const content = parts.join('\n\n') + '\n';
  return responseExport(project, { id: page?.id ?? original?.id ?? 'context', label: 'handoff', content, number: 0, time: exportedAt, outcome: 'progress', outcomeLabel: '' });
}
