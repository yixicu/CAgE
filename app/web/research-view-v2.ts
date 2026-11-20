import type { EpochTask, ResearchProjectV2, WorkerResult } from '../src/research/contracts/v2';

/** Checkpoint acceptance, task execution and evidence are independent axes. */
export function committedTaskIds(project: ResearchProjectV2): Set<string> {
  return new Set(project.epochs.filter(epoch => epoch.completedAt).flatMap(epoch => epoch.committedTaskIds));
}

export function taskPublicationLabel(task: EpochTask, committed: ReadonlySet<string>): string {
  if (committed.has(task.id)) return 'Committed at consistency gate';
  if (task.state === 'staged') return 'Staged · provisional, not committed';
  if (task.result) return 'Returned · not committed';
  if (task.state === 'running') return 'Running · no scientific result yet';
  return task.state.replaceAll('_', ' ');
}

export function evidenceLabel(result: Pick<WorkerResult, 'evidence'>): string {
  return result.evidence === 'need_data' ? 'Need Data' : result.evidence.replaceAll('_', ' ');
}

export function conditionalWarning(result: Pick<WorkerResult, 'idealizedConditions'>): string | undefined {
  return result.idealizedConditions.length
    ? 'Conditional theoretical analysis under hypothetical favorable conditions. These are not measurements or a general proof.'
    : undefined;
}

export function queuedProposalIds(commands: readonly import('../src/engine/types').UserCommand[]): Set<string> {
  const ids = new Set<string>();
  for (const command of commands) {
    if (command.kind !== 'refine') continue;
    try { const payload = JSON.parse(command.payload); if (payload?.kind === 'accept_reconstruction' && typeof payload.proposalId === 'string') ids.add(payload.proposalId); } catch { /* Ordinary refinements remain plain text. */ }
  }
  return ids;
}
export function proposalIsStale(proposal: import('../src/research/contracts/v2').ReconstructionProposal, hypothesisRevision: string): boolean {
  return proposal.status !== 'accepted' && proposal.sourceHypothesisRevision !== hypothesisRevision;
}
export function commandDisplay(command: import('../src/engine/types').UserCommand): string {
  try { const payload = JSON.parse(command.payload); if (command.kind === 'refine' && payload?.kind === 'accept_reconstruction' && typeof payload.proposalId === 'string') return `Accept hypothesis proposal ${payload.proposalId} at the next safe boundary`; } catch { /* Preserve user prose. */ }
  return command.payload || (command.kind === 'stop' ? 'Graceful stop requested' : 'Pause at the next boundary');
}
