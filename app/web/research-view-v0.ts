import type { ResearchProjectV0 } from '../src/research/contracts/v0';
import type { CheckpointPage, ProofOutcome } from './checkpoint-view';

/** V0 projections contain metadata, never a reconstructed or rewritten proof. */
export function v0Epoch(project: ResearchProjectV0, number = project.epoch) {
  return project.epochs.find(epoch => epoch.epoch === number)
    ?? (project.activeEpoch?.epoch === number ? project.activeEpoch : undefined);
}
export function v0CheckpointPages(project: ResearchProjectV0): CheckpointPage[] {
  return project.epochs.map(epoch => {
    const verdict = epoch.scientificCommitted ? epoch.solve?.outcome.verdict ?? 'open' : 'open';
    const outcome: ProofOutcome = verdict === 'solved' ? 'proved' : verdict === 'refuted' ? 'refuted' : 'progress';
    const technical = epoch.solve?.technical ?? epoch.technicalAnswers?.at(-1)?.technical;
    return { id: epoch.id, number: epoch.epoch, label: `Epoch ${epoch.epoch}`, time: epoch.completedAt,
      hypothesis: epoch.snapshot.root.originalText, hypothesisRevision: epoch.snapshot.root.revision,
      inputRevision: epoch.snapshot.inputRevision, outcome,
      outcomeLabel: verdict === 'open' ? 'Open' : verdict === 'solved' ? 'Solved · Theorist assessment' : 'Refuted · Theorist assessment',
      interrupted: epoch.decision === 'stop', reason: epoch.reason,
      content: ['V0 run metadata. Read the exact original proof in V0 · Ways.',
        `Scientific: ${verdict}`, `Technical: ${technical ? `${technical.executionStatus} · ${technical.completeness}` : 'No answer saved'}`,
        `Archive: ${epoch.archive?.status ?? 'none'}`, epoch.solve?.outcome.summary, epoch.reason].filter(Boolean).join('\n\n') };
  }).sort((a, b) => a.number - b.number);
}
export function v0Directions(project: ResearchProjectV0, number = project.epoch) {
  const epoch = v0Epoch(project, number);
  return (epoch?.selection?.candidates ?? []).map(way => ({ id: way.id, label: way.direction,
    question: way.direction, target: way.returnToRoot, conditions: way.conditions,
    exploring: project.status === 'running' && number === project.epoch && epoch?.phase === 'solving' && epoch.selection?.selectedWayId === way.id,
    status: `${epoch?.selection?.selectedWayId === way.id ? 'Selected' : 'Not selected'} · estimated p=${way.p} (heuristic, not calibrated)` }));
}
