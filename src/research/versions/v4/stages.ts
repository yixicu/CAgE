import type { InFlightEpochV21, ResearchProjectV21 } from '../../contracts/v21.js';
import { publicFragmentsV4 } from './fragments.js';

/** Read-only baseline for V4 window measurements. Stage references confer no read grant. */
export function inspectStageWindows(project: ResearchProjectV21) {
  const markers = new Map<string, InFlightEpochV21 | ResearchProjectV21['epochs'][number]>(
    project.epochs.map(epoch => [epoch.snapshot.id, epoch]),
  );
  if (project.activeEpoch) markers.set(project.activeEpoch.snapshot.id, project.activeEpoch);

  return Array.from(markers.values(), ({ snapshot, calls, optionalFlow }) => {
    const mainCalls = calls.filter(call => call.task === 'v21_theorist');
    const artifacts = new Map(optionalFlow?.artifacts.map(item => [item.originalRef.callId, item]));
    const stages = mainCalls.flatMap((call, index) => {
      const item = artifacts.get(call.id);
      if (!item?.acceptanceCommitted || item.authorRole !== 'theorist'
          || item.technical.executionStatus !== 'completed' || item.technical.completeness !== 'complete'
          || item.originalRef.completeness !== 'complete' || item.originalRef.projectId !== project.id
          || item.originalRef.epochId !== snapshot.id || item.control.outcome.resultKind !== 'open'
          || item.control.action !== 'continue') return [];
      const next = mainCalls[index + 1];
      return [{
        callId: call.id, artifactId: item.id, createdAt: item.createdAt,
        rootRevision: item.root.revision, qualification: item.qualification,
        ...(snapshot.theoryRevision==='v4-operation-4'?{publicSummaries:publicFragmentsV4(item).map(s=>({body:s.passage,version:s.bodyHash,conditions:s.conditions,authority:'public-history-requires-current-grant' as const}))}:{}),
        nextCallId: next?.id ?? null, nextCallStatus: next?.status ?? null,
      }];
    });
    return { epochId: snapshot.id, mainCallCount: mainCalls.length, stages };
  });
}
