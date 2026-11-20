import type { UserCommand } from '../../src/engine/types';
import type { AnyResearchProject } from '../../src/research/contracts/loop';
import type { MonitorActivitySnapshot } from '../../src/server/monitor-activity';
import { commandDisplay } from '../research-view-v2';
import { commandStateProjection, compareCommandOrder } from '../../src/research/user-commands';

export type ModifiedHypothesisStatus = 'in progress' | 'in queue' | 'history';
export interface ModifiedHypothesisEntry {
  id: string;
  createdAt: string;
  content: string;
  status: ModifiedHypothesisStatus;
  detail?: string;
}
export interface ModifiedHistoryOptions {
  /** True only while the selected project's snapshot and connection are current. */
  connected: boolean;
  activity?: MonitorActivitySnapshot;
}
type HistoryProject = Pick<AnyResearchProject, 'id' | 'schemaVersion' | 'status' | 'processedCommandIds' | 'pendingModificationIds' | 'commandStates' | 'userInputWarnings' | 'refinements' | 'plannedRefinementCount'>;

/** Read-only command history. A planning batch can contain several modifications. */
export function modifiedHypothesisHistory(
  project: HistoryProject,
  commandHistory: readonly UserCommand[],
  { activity, connected }: ModifiedHistoryOptions,
): ModifiedHypothesisEntry[] {
  const states = commandStateProjection(project, commandHistory);
  const planningTask = project.schemaVersion === 4 ? 'v0_plan' : project.schemaVersion === 3 ? 'v21_plan' : project.schemaVersion === 2 ? 'v2_route_knowledge' : 'plan';
  const planning = connected && project.status === 'running'
    && activity?.projectId === project.id && activity.available
    && activity.operations.some(operation => operation.role === 'theorist' && operation.task === planningTask);

  return commandHistory
    .filter(command => command.projectId === project.id && command.kind === 'refine')
    .sort(compareCommandOrder)
    .map(command => ({
      id: command.id,
      createdAt: command.createdAt,
      content: commandDisplay(command),
      // Unconsumed commands arriving during a plan are still waiting for a later boundary.
      status: states[command.id]?.status === 'planning' ? planning ? 'in progress' : 'in queue'
        : states[command.id]?.status === 'pending' ? 'in queue' : 'history',
      detail: states[command.id]?.status === 'superseded'
        ? `Replaced by a newer hypothesis candidate before planning. This submitted text remains in history.${states[command.id]?.message ? ' Earlier attempt: ' + states[command.id].message : ''}`
        : states[command.id]?.message ?? (
        states[command.id]?.status === 'applied' ? 'Planning processed this submission; this is not a claim of completed research.'
        : states[command.id]?.status === 'legacy_unknown' ? 'Legacy history has no reliable planning receipt. This entry was retained but is not automatically replayed.'
        : states[command.id]?.status === 'rejected' ? 'This submitted modification was rejected and was not applied.' : undefined),
    }));
}
