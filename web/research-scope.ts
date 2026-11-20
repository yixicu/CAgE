import type { ResearchProject } from './api';

/** A live boundary can be newer than the last committed project checkpoint. */
export function currentResearchNumber(project?: ResearchProject): number {
  if (!project) return 0;
  return project.schemaVersion === 1 ? project.round : Math.max(project.epoch, project.activeEpoch?.epoch ?? 0);
}
