import type { ProofRef } from '../../../learning/research-data.js';
import type { ResearchProjectV2 } from '../../contracts/v2.js';

/** Session completion comes from the current archived root proof, not Worker execution. */
export function completeArchivedProof(project: ResearchProjectV2, isValid?: (ref: ProofRef) => boolean): boolean {
  const epoch = project.epochs.at(-1), receipt = epoch?.research, proof = receipt?.review?.proof;
  const ref = receipt?.proofArchive?.status === 'saved' ? receipt.proofArchive.ref : undefined;
  if (project.phase !== 'idle' || project.status === 'stopped' || epoch?.decision === 'stop'
    || epoch?.reason === 'User requested boundary pause.' || project.pendingModificationIds?.length
    || Object.values(project.commandStates ?? {}).some(state => state.status === 'pending' || state.status === 'planning')) return false;
  if (!epoch || epoch.number !== project.epoch || epoch.synthesis?.status === 'pending'
    || !receipt?.coverageComplete || !proof?.rootClosed || !proof.reproducible || !ref
    || proof.logicalRelation === 'necessary_only' || proof.target !== project.hypothesis
    || receipt.hypothesisRevision !== project.hypothesisRevision || receipt.hypothesisId !== project.hypothesisId
    || ref.sessionId !== project.id || ref.hypothesisId !== project.hypothesisId || ref.hypothesisRevision !== project.hypothesisRevision) {
    if (project.status !== 'completed') return false;
    project.status = 'paused';
    if (epoch) { epoch.decision = 'pause'; epoch.reason = 'No valid archived proof closes the current hypothesis.'; }
    return true;
  }
  if (isValid && !isValid(ref)) {
    if (project.status !== 'completed') return false;
    project.status = 'paused'; epoch.decision = 'pause'; epoch.reason = 'The archived proof requires review before research can be marked complete.';
    return true;
  }
  const reason = 'The current hypothesis proof is archived. Worker execution records remain unchanged.';
  const changed = project.status !== 'completed' || epoch.decision !== 'complete' || epoch.reason !== reason || Boolean(project.lastError);
  project.status = 'completed'; epoch.decision = 'complete';
  epoch.reason = reason;
  delete project.lastError;
  return changed;
}
