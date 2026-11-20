import type { AnyResearchProject, ApplicationResearchStore } from '../research/contracts/loop.js';
import type { EndedAttempt } from '../research/contracts/review.js';
import type { ArchiveSubject } from './research-data.js';
import { stableHash } from './research-hash.js';
import type { ResearchLibrary } from './research-library.js';

interface MaintenanceStore extends Pick<ApplicationResearchStore, 'listCommands' | 'loadInFlight'> { library: ResearchLibrary }
interface MaintenanceOptions {
  now?: string; pinnedSessionIds?: readonly string[];
  endedAttempts?: (project: AnyResearchProject) => readonly EndedAttempt[];
  onUnavailable?: (projectId: string, error: unknown) => void | Promise<void>;
}
/** Metadata maintenance at startup/checkpoint; no Provider, deletion, proof-body reads or recurring process. */
export async function archiveResearch(store: MaintenanceStore, projects: readonly AnyResearchProject[], tasks: readonly { projectId: string; status: string }[], options: MaintenanceOptions = {}): Promise<string[]> {
  const now = options.now ?? new Date().toISOString(), snapshot = store.library.snapshot();
  const metadata = (await Promise.all(projects.map(async project => {
    try {
      const [commands, inFlight] = await Promise.all([store.listCommands(project.id), store.loadInFlight(project.id)]);
      const records = project.schemaVersion === 1 ? project.rounds : project.epochs;
      const dates = [project.startedAt, ...records.map(r => r.completedAt), ...commands.map(c => c.createdAt)].filter((v): v is string => Boolean(v) && Number.isFinite(Date.parse(v!)));
      return { project, commands, inFlight, initialAt: dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] };
    } catch (error) {
      if (!options.onUnavailable) throw error;
      await options.onUnavailable(project.id, error);
      return undefined; // Do not archive or replace the unavailable project's protections.
    }
  }))).filter(item => item !== undefined);
  const activity = await store.library.recordActivity(metadata.map(({ project, commands, initialAt }) => ({
    sessionId: project.id, fingerprint: stableHash({ revision: project.contentRevision, commands: commands.map(c => c.id) }), initialAt,
  })), now);
  const subjects: ArchiveSubject[] = [];
  for (const { project, commands, inFlight } of metadata) {
    const attempts = project.schemaVersion===3||project.schemaVersion===4 ? undefined : options.endedAttempts?.(project);
    const seen = snapshot.inspectedAttempts[project.id] ?? {};
    const unread = attempts ? attempts.some(a => seen[a.id] !== a.version) : project.schemaVersion===3 ? project.answers.some(answer=>seen[answer.id]!==answer.bodyHash) : project.schemaVersion===4 ? project.epochs.some(epoch=>epoch.solve&&seen[epoch.solve.answerRef.id]!==epoch.solve.answerRef.bodyHash) : project.results.length > 0;
    const queuedContinuation = commands.some(c => c.kind === 'refine' && !project.processedCommandIds.includes(c.id))
      || (project.schemaVersion === 1 ? project.frontier.some(item => item.state === 'pending' && Boolean(item.continuation))
        : project.schemaVersion===3 ? project.questions.some(question=>question.allocation==='dispatch'&&!project.answers.some(answer=>answer.questionId===question.id&&answer.questionRevision===question.revision)) : project.schemaVersion===4 ? false : (project.activeEpoch?.tasks ?? []).some(task => ['ready', 'blocked'].includes(task.state) && Boolean(task.way.continuation)));
    const protections = { running: project.status === 'running', queuedContinuation, recoveryPinned: Boolean(inFlight),
      learningPinned: tasks.some(task => task.projectId === project.id && ['queued', 'running', 'paused'].includes(task.status)),
      userPinned: options.pinnedSessionIds?.includes(project.id) ?? false, unread };
    const lastActivityAt = activity[project.id]!.lastActivityAt;
    subjects.push({ id: `session:${project.id}`, kind: 'session', sessionId: project.id, lastActivityAt, ended: project.status !== 'running',
      hasValidProof: Object.values(snapshot.proofs).some(p => p.sessionId === project.id && p.status === 'valid'), ...protections });
    for (const result of project.schemaVersion===3||project.schemaVersion===4 ? [] : project.results) {
      const attemptId = project.schemaVersion === 2 && 'taskId' in result ? result.taskId : result.branchId;
      subjects.push({ id: `attempt:${project.id}:${attemptId}`, kind: 'attempt', sessionId: project.id, lastActivityAt, ended: true, ...protections });
    }
    if(project.schemaVersion===4) for(const epoch of project.epochs)if(epoch.solve)subjects.push({id:`attempt:${project.id}:${epoch.solve.answerRef.id}`,kind:'attempt',sessionId:project.id,lastActivityAt,ended:true,...protections});
    if(project.schemaVersion===3) for(const answer of project.answers) subjects.push({id:`attempt:${project.id}:${answer.id}`,kind:'attempt',sessionId:project.id,lastActivityAt,ended:true,...protections});
    for (const failure of Object.values(snapshot.failures).filter(f => f.sessionId === project.id)) subjects.push({
      id: `failure:${project.id}:${failure.id}`, kind: 'failure', sessionId: project.id, lastActivityAt, ended: true, ...protections,
    });
  }
  return store.library.archive(subjects, now);
}
