import type { EpochRecord, EpochSnapshot, EpochTask, InFlightEpoch, ResearchProjectV2 } from '../../contracts/v2.js';
import type { InheritedResearchView } from '../../contracts/lineage.js';
import { eligibleAdoptedChapters } from './preparation.js';

/** Admission only, never scientific adoption: failed drafts and empty allocations are not evidence. */
export function hasSynthesisMaterial(project: ResearchProjectV2, current: readonly EpochTask[] = [], inherited?: InheritedResearchView): boolean {
  if (eligibleAdoptedChapters(project).length) return true;
  const results = [...project.results, ...project.epochs.flatMap(epoch => epoch.tasks.flatMap(task => task.result ? [task.result] : [])),
    ...current.flatMap(task => task.result ? [task.result] : [])];
  if (results.some(result => result.executionStatus === 'completed' && result.hypothesisRevision === project.hypothesisRevision
    && Boolean(result.conclusion || result.pathReport || result.derivationMarkdown?.trim() || result.derivationRef
      || result.derivationChain.length || result.unresolvedQuestions.length || result.chapters?.some(ref => ref.complete)))) return true;
  // Inherited context was resolved by the existing exact, read-only fork grants.
  return Boolean(inherited && (inherited.proofs.length || inherited.chapters.some(ref => ref.complete
    && inherited.attempts.some(attempt => attempt.id === ref.attemptId && attempt.executionStatus === 'completed'))
    || inherited.attempts.some(attempt => attempt.executionStatus === 'completed' && Boolean(attempt.path.trim() || attempt.conclusion))));
}

/** Old technical failures remain resumable; scientific partial findings do not. */
export function pendingSynthesis(record: EpochRecord | undefined): boolean {
  return Boolean(record && (record.synthesis?.status === 'pending'
    || record.synthesis?.status === 'complete' && Boolean(record.research?.attempts.length) && !record.research?.coverageComplete
    || !record.synthesis && !record.research?.review && record.summary.startsWith('Theorist synthesis was unavailable.')));
}

export function assertSynthesisRecovery(project: ResearchProjectV2, record: EpochRecord): void {
  if (record.number !== project.epoch || record.snapshot.hypothesisRevision !== project.hypothesisRevision
    || record.snapshot.hypothesis !== project.hypothesis || project.pendingModificationIds?.length)
    throw new Error('Synthesis recovery requires the unchanged hypothesis and no pending modification. Saved evidence is preserved.');
  if (record.tasks.some(task => ['ready', 'running'].includes(task.state)
    || task.epochId !== record.snapshot.id || task.brief.inputRevision !== record.snapshot.inputRevision
    || task.brief.rootHypothesisRevision !== record.snapshot.hypothesisRevision))
    throw new Error('Synthesis recovery requires settled tasks with the original frozen input versions.');
}

export function synthesisRecoveryMarker(project: ResearchProjectV2, record: EpochRecord): InFlightEpoch {
  assertSynthesisRecovery(project, record);
  return {
    schemaVersion: 2, loop: { researchLoopVersion: '2.0', workerProtocolVersion: '2.0' },
    projectId: project.id, epoch: record.number, phase: 'synthesizing', sealed: true,
    snapshot: structuredClone(record.snapshot), tasks: structuredClone(record.tasks),
    decisions: structuredClone(record.decisions), calls: [], startedAt: new Date().toISOString(),
    synthesis: { status: 'pending', attempt: (record.synthesis?.attempt ?? 0) + 1 },
  };
}

/** Previously acknowledged report versions, not a claim that proof bodies remain in context. */
export function synthesisReadVersions(project: ResearchProjectV2, snapshot: EpochSnapshot): Record<string,string> {
  return Object.assign({}, snapshot.previouslyRead, ...project.epochs.flatMap(epoch => epoch.research?.review?.attemptsRead.map(ref => ({[ref.id]:ref.version})) ?? []));
}
