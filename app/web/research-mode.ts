import type { ResearchProject } from './api';

export type ResearchMode = '0' | '1.0' | '2.0' | '2.1' | '3.0' | '4.0';
export const DEFAULT_RESEARCH_MODE: ResearchMode = '4.0';
export const researchModes = [
  {version:'4.0',label:'V4'},
  { version: '3.0', label: 'Linked research · V3' },
  { version: '2.1', label: 'Strict research · V2.1' },
  { version: '2.0', label: 'Strict research · V2.0' },
  { version: '1.0', label: 'Quick research · V1' },
  { version: '0', label: 'V0 (test loop)' },
] as const;

/** A presentation guard; the server owns the durable first-start lock. */
export function researchModeLocked(project: ResearchProject): boolean {
  if (project.schemaVersion === 4) return !!project.fork || !!project.startedAt || project.status !== 'idle' || project.epoch > 0 || project.epochs.length > 0 || !!project.activeEpoch;
  if (project.schemaVersion === 3) return !!project.fork || !!project.startedAt || project.status !== 'idle' || project.epoch > 0 || project.epochs.length > 0 || !!project.activeEpoch || project.answers.length > 0 || project.ways.length > 0 || project.questions.length > 0;
  return !!project.fork || !!project.startedAt || project.status !== 'idle'
    || (project.schemaVersion === 2
      ? project.epoch > 0 || project.epochs.length > 0 || !!project.activeEpoch
      : project.round > 0 || project.rounds.length > 0)
    || project.results.length > 0;
}
