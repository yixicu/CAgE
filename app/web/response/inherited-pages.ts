import type { InheritedResearchView } from '../../src/research/contracts/lineage';
import type { CheckpointPage } from '../checkpoint-view';

/** Display a read-only prefix without putting parent records into child science. */
export function inheritedPages(view?: InheritedResearchView | null): CheckpointPage[] {
  return (view?.context.outputs ?? []).map(output => ({
    id: `inherited:${output.sessionId}:${output.id}`,
    inheritedSessionId: output.sessionId,
    number: output.number, label: `Inherited · ${output.label}`,
    content: output.content, time: output.time, hypothesis: output.hypothesis,
    outcome: 'progress', outcomeLabel: 'Inherited record · read-only',
  }));
}
