import type { AgentInvocation, AgentSessionSpec, InFlightRound, ResearchProject, ResearchRole } from '../../contracts/v1.js';
import { ResearchSelectionError, ResearchVersionError, ValidationError } from '../../contracts/errors.js';

/** v1's existing recovery/selection rules; application writer and revision guards remain outside. */
export function assertBoundary(project: ResearchProject, marker: InFlightRound | undefined, purpose: 'execute' | 'select'): void {
  const pending = project.rounds.find(round => round.decisionContext);
  for (const record of [marker, pending]) if (record) {
    const pin = record.loop ?? { researchLoopVersion: '1.0', workerProtocolVersion: '1.0' };
    if (pin.researchLoopVersion !== project.researchLoopVersion || pin.workerProtocolVersion !== project.workerProtocolVersion) throw new ResearchVersionError('Unfinished work belongs to a different loop or protocol. Restore its compatible implementation before recovery; no fallback was performed.');
  }
  if (purpose !== 'select') return;
  const last = project.rounds.at(-1);
  const initial = project.round === 0 && project.stage === 'INTAKE' && project.rounds.length === 0;
  const completedBoundary = project.stage === 'DECIDE' && last?.number === project.round && Boolean(last.completedAt && last.decision);
  if ((!initial && !completedBoundary) || project.rounds.some(round => round.decisionContext) || project.frontier.some(item => item.state === 'active') || project.graph.some(node => node.status === 'active')) {
    throw new ResearchSelectionError('RESEARCH_VERSION_BUSY', 'A loop can be selected only at a saved idle round boundary without in-flight work. Reconcile with the original version first.');
  }
}
export function validateInvocation(spec: AgentSessionSpec, invocation: AgentInvocation): void {
  if (spec.promptRevision !== undefined && spec.promptRevision !== 'categorized-v1' || invocation.promptRevision !== undefined && invocation.promptRevision !== spec.promptRevision) throw new ValidationError('prompt revision');
  const tasks: Record<ResearchRole, string[]> = { theorist: ['plan', 'synthesize', 'review'], worker: ['worker_step'], moderator: ['moderate_plan', 'moderate_review'], literature: ['literature'] };
  if (!tasks[spec.role].includes(invocation.task)) throw new ValidationError('role task');
}
