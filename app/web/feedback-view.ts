import type { Attribution, EpochRecord } from '../src/research/contracts/v2';
import type { FeedbackTarget } from './api';
export const attributionLabels: Record<Attribution, string> = {
  domain_anchor: 'Domain or knowledge-anchor choice', way_formation: 'Possible-way formation', missing_data: 'Missing evidence or data', execution_failure: 'Execution failure', scientific_contradiction: 'Scientific contradiction', informative_success: 'Informative result',
};
export function feedbackTarget(epoch: EpochRecord, selected: string, attribution: Attribution | '', reason: string): FeedbackTarget {
  if (!selected) return {};
  if (selected.startsWith('audit:')) {
    const auditId = selected.slice(6);
    if (!epoch.audits.some(audit => audit.id === auditId && !audit.provisional)) throw new Error('Select a committed public audit.');
    return { auditId };
  }
  const taskId = selected.startsWith('task:') ? selected.slice(5) : '';
  if (!epoch.committedTaskIds.includes(taskId) || !epoch.tasks.some(task => task.id === taskId)) throw new Error('Select a committed public task.');
  if (attribution && !reason.trim()) throw new Error('Explain the attribution correction.');
  return { taskId, ...(attribution ? { attribution, attributionReason: reason.trim() } : {}) };
}
