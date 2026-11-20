import { v0Directions } from '../research-view-v0';
import { currentResearchNumber } from '../research-scope';
import { v21Directions } from '../research-view-v21';
import type { AnyResearchProject } from '../../src/research/contracts/loop';
import type { EpochRecord, InFlightEpoch } from '../../src/research/contracts/v2';

export interface ResearchDirection {
  id: string;
  label: string;
  agent?: string;
  question: string;
  target?: string;
  conditions: string[];
  status: string;
  exploring: boolean;
}

/** Prefer the committed scope when its live marker is still being cleared. */
export function researchEpoch(project: Extract<AnyResearchProject, { schemaVersion: 2 }>, number: number): EpochRecord | InFlightEpoch | undefined {
  return project.epochs?.find(epoch => epoch.number === number)
    ?? (project.activeEpoch?.epoch === number ? project.activeEpoch : undefined);
}

/** Questions and targets only: execution steps belong in Monitor. */
export function researchDirections(project: AnyResearchProject, number = currentResearchNumber(project)): ResearchDirection[] {
  if (project.schemaVersion === 4) return v0Directions(project, number);
  if (project.schemaVersion === 3) return v21Directions(project, number);
  if (project.schemaVersion === 1) {
    const ids = project.rounds?.find(round => round.number === number)?.branchIds ?? [];
    return ids.flatMap((id, index) => {
      const node = project.graph?.find(node => node.id === id);
      if (!node?.question?.trim()) return [];
      const way = project.frontier?.find(way => way.id === id);
      const result = project.results?.find(result => result.branchId === id);
      const state = result?.executionStatus ?? node.executionStatus;
      const exploring = project.status === 'running' && number === project.round && node.status === 'active' && !state;
      return [{ id, label: `Worker ${index + 1}`, question: node.question, target: node.targetTheory || way?.targetTheory,
        conditions: way?.assumptions ?? result?.assumptions ?? [], exploring,
        status: state === 'completed' ? 'Report returned' : state === 'failed' ? 'Execution failed' : state === 'interrupted' ? 'Interrupted' : exploring ? 'Exploring' : 'Assigned direction' }];
    });
  }
  const epoch = researchEpoch(project, number);
  const tasks = epoch?.tasks ?? [];
  return tasks.filter(task => task.way?.question?.trim()).map((task, index) => {
    const assigned = !!task.startedAt || !!task.result || task.state === 'running';
    const exploring = project.status === 'running' && number === currentResearchNumber(project) && task.state === 'running';
    return { id: task.id, label: assigned ? `Worker ${index + 1}` : `Direction ${index + 1}`, question: task.way.question,
      target: task.way.targetProposition, conditions: task.way.assumptions ?? [], exploring,
      status: task.state === 'blocked' ? assigned ? 'Not accepted' : 'Not dispatched' : task.result?.executionStatus === 'failed' ? 'Execution failed'
        : task.result?.executionStatus === 'interrupted' ? 'Interrupted' : task.result ? 'Report returned'
        : exploring ? 'Exploring' : task.state === 'ready' ? 'Queued' : 'Assigned direction' };
  });
}
