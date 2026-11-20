import type { PlanningSelection, ReconstructionSelection, RefinementKind, UserCommand, UserCommandState } from './contracts/user-commands.js';
export type { PlanningSelection, RefinementKind, UserCommandState } from './contracts/user-commands.js';

/** Small shared projection. This module never changes a scientific hypothesis or deletes a submission. */
export interface CommandProject {
  researchLoopVersion?: string;
  id: string; hypothesisRevision?: string; processedCommandIds: string[]; refinements?: string[];
  plannedRefinementCount?: number; pendingModificationIds?: string[];
  commandStates?: Record<string, UserCommandState>; userInputWarnings?: string[];
  reconstructionProposals?: (Omit<ReconstructionSelection, 'commandId' | 'proposalId'> & { id: string; status: 'proposed' | 'accepted'; acceptedCommandId?: string; acceptedAtEpoch?: number })[];
}
function reconstructionPayload(command: UserCommand): { proposalId: string; sourceHypothesisRevision: string } | undefined {
  try {
    const value: unknown = JSON.parse(command.payload);
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'accept_reconstruction'
      && 'proposalId' in value && typeof value.proposalId === 'string'
      && 'sourceHypothesisRevision' in value && typeof value.sourceHypothesisRevision === 'string') {
      return { proposalId: value.proposalId, sourceHypothesisRevision: value.sourceHypothesisRevision };
    }
  } catch { /* Ordinary hypothesis text is not JSON. */ }
  return undefined;
}
export function commandRefinementKind(command: UserCommand): RefinementKind | undefined {
  if (command.kind !== 'refine') return undefined;
  if (command.refinementKind) return command.refinementKind;
  // Only the exact historical UI envelope is recognized; ordinary prose is still a hypothesis instruction.
  if (reconstructionPayload(command)) return 'accept_reconstruction';
  return /^Annotation on [^\r\n]+:\r?\n/u.test(command.payload) ? 'annotation' : 'hypothesis';
}
/** STOP priority is an execution concern, never the definition of the newest hypothesis. */
export function compareCommandOrder(a: UserCommand, b: UserCommand): number {
  if (a.sequence !== undefined || b.sequence !== undefined) {
    if (a.sequence === undefined) return -1;
    if (b.sequence === undefined) return 1;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  }
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
function warn(project: CommandProject, message: string): void {
  const warnings = project.userInputWarnings ??= [];
  if (!warnings.includes(message)) warnings.push(message);
}
function syncPending(project: CommandProject): void {
  project.pendingModificationIds = Object.entries(project.commandStates ?? {})
    .filter(([, state]) => state.status === 'pending' || state.status === 'planning').map(([id]) => id);
}
function syncWatermark(project: CommandProject): void {
  // The old count remains a compatibility projection, never an acknowledgement mechanism.
  // Unknown historical outcomes must not silently become processed merely because a new request succeeds.
  const states = Object.values(project.commandStates ?? {}), refinements = project.refinements ?? [];
  const unresolved = states.filter(state => ['pending', 'planning', 'legacy_unknown'].includes(state.status))
    .flatMap(state => state.refinementIndex === undefined ? [] : [state.refinementIndex]);
  const mapped = new Set(states.flatMap(state => state.refinementIndex === undefined ? [] : [state.refinementIndex]));
  for (let index = 0; index < refinements.length; index++) if (!mapped.has(index) && index >= (project.plannedRefinementCount ?? 0)) unresolved.push(index);
  project.plannedRefinementCount = unresolved.length ? Math.min(...unresolved) : refinements.length;
}
/** Compatibility is explicit: a missing legacy watermark is not proof of application. */
export function initializeCommandStates(project: CommandProject, allCommands: readonly UserCommand[]): void {
  const states = project.commandStates ??= {}, refinements = project.refinements ?? [];
  const pending = new Set(project.pendingModificationIds ?? []), journal = new Map(allCommands.filter(command => command.projectId === project.id).map(command => [command.id, command]));
  const used = new Set(Object.values(states).flatMap(state => state.refinementIndex === undefined ? [] : [state.refinementIndex]));
  for (const commandId of project.processedCommandIds) {
    const command = journal.get(commandId);
    if (!command || command.kind !== 'refine' || states[command.id]) continue;
    const index = refinements.findIndex((text, i) => !used.has(i) && text === command.payload);
    if (index >= 0) used.add(index);
    const status = pending.has(command.id) ? 'pending'
      : project.plannedRefinementCount !== undefined && index >= 0 ? index < project.plannedRefinementCount ? 'applied' : 'pending'
        : 'legacy_unknown';
    states[command.id] = { status, ...(index >= 0 ? { refinementIndex: index } : {}),
      ...(status === 'legacy_unknown' ? { message: 'This legacy submission has no reliable planning receipt. Its history was retained; it was not automatically replayed.' } : {}) };
  }
  for (const commandId of pending) if (!states[commandId]) {
    states[commandId] = { status: 'pending' };
    if (!journal.has(commandId)) warn(project, `Pending user input ${commandId} is missing its command journal record. Restore the record before planning.`);
  }
  if (Object.values(states).some(state => state.status === 'legacy_unknown')
    || project.plannedRefinementCount === undefined && refinements.length > used.size) {
    warn(project, 'Some legacy user inputs have no reliable planning receipt. All history is retained. Review and resubmit any still-needed instruction; these ambiguous entries will not be automatically replayed.');
  }
  syncPending(project);
}
export function ingestCommands(project: CommandProject, commands: readonly UserCommand[]): { stop: boolean; pause: boolean; refine: boolean } {
  const control = { stop: false, pause: false, refine: false }, states = project.commandStates ??= {};
  for (const command of [...commands].sort(compareCommandOrder)) {
    if (command.projectId !== project.id || project.processedCommandIds.includes(command.id)) continue;
    if (command.kind === 'stop') control.stop = true;
    if (command.kind === 'pause') control.pause = true;
    if (command.kind === 'refine') {
      const refinements = project.refinements ??= [];
      states[command.id] = { status: 'pending', refinementIndex: refinements.length };
      refinements.push(command.payload); control.refine = true;
    }
    project.processedCommandIds.push(command.id);
  }
  syncPending(project); return control;
}
function supersedePending(project: CommandProject, commands: readonly UserCommand[]): void {
  // V4 classifies successive discussion turns against the root produced by the preceding turn.
  if (project.researchLoopVersion === '4.0') return;
  const states = project.commandStates ??= {};
  const hypotheses = commands.filter(command => command.projectId === project.id && command.kind === 'refine'
    && commandRefinementKind(command) !== 'annotation' && states[command.id]?.status === 'pending').sort(compareCommandOrder);
  const latest = hypotheses.at(-1);
  if (!latest) return;
  for (const command of hypotheses.slice(0, -1)) states[command.id] = { ...states[command.id]!, status: 'superseded', supersededBy: latest.id };
  syncPending(project);
}
/** Pure UI projection includes unreceived commands without pretending the engine has adopted them. */
export function commandStateProjection(project: CommandProject, allCommands: readonly UserCommand[]): Record<string, UserCommandState> {
  const view: CommandProject = {
    id: project.id, researchLoopVersion: project.researchLoopVersion, hypothesisRevision: project.hypothesisRevision,
    processedCommandIds: [...project.processedCommandIds], refinements: project.refinements,
    plannedRefinementCount: project.plannedRefinementCount,
    pendingModificationIds: [...(project.pendingModificationIds ?? [])],
    commandStates: Object.fromEntries(Object.entries(project.commandStates ?? {}).map(([id, state]) => [id, { ...state }])), userInputWarnings: [...(project.userInputWarnings ?? [])],
  };
  if (project.commandStates === undefined) initializeCommandStates(view, allCommands);
  const states = view.commandStates!;
  for (const command of allCommands) if (command.projectId === project.id && command.kind === 'refine' && !states[command.id]) {
    states[command.id] = { status: project.processedCommandIds.includes(command.id) ? 'legacy_unknown' : 'pending' };
  }
  supersedePending(view, allCommands); return states;
}
export function pendingModificationCommands(project: CommandProject, allCommands: readonly UserCommand[]): UserCommand[] {
  const states = commandStateProjection(project, allCommands);
  return allCommands.filter(command => command.projectId === project.id && command.kind === 'refine'
    && (states[command.id]?.status === 'pending' || states[command.id]?.status === 'planning')).sort(compareCommandOrder);
}
/** Capture this exactly once at PLAN/routing entry. Later submissions belong to a later boundary. */
export function selectPlanningInputs(project: CommandProject, allCommands: readonly UserCommand[], boundaryId: string): PlanningSelection {
  initializeCommandStates(project, allCommands);
  supersedePending(project, allCommands);
  const states = project.commandStates!, pending = allCommands.filter(command => command.projectId === project.id && command.kind === 'refine'
    && states[command.id]?.status === 'pending').sort(compareCommandOrder);
  const hypotheses = pending.filter(command => commandRefinementKind(command) !== 'annotation');
  const [hypothesis, nextHypothesis] = hypotheses;
  const annotations = pending.filter(command => commandRefinementKind(command) === 'annotation'
    && (!nextHypothesis || compareCommandOrder(command, nextHypothesis) < 0));
  const selection: PlanningSelection = { boundaryId, commandIds: [], annotationCommandIds: annotations.map(command => command.id),
    pendingModifications: [], pendingAnnotations: annotations.map(command => command.payload) };
  const missing = Object.entries(states).find(([commandId, state]) => state.status === 'pending' && !allCommands.some(command => command.id === commandId && command.projectId === project.id));
  if (missing) selection.blockedReason = `Pending user input ${missing[0]} is missing its command journal record. Restore the record before planning.`;
  if (hypothesis) {
    selection.hypothesisCommandId = hypothesis.id;
    if (commandRefinementKind(hypothesis) === 'accept_reconstruction') {
      const payload = reconstructionPayload(hypothesis), proposal = payload && project.reconstructionProposals?.find(item => item.id === payload.proposalId);
      if (!payload || !proposal || proposal.status !== 'proposed' || proposal.sourceHypothesisRevision !== payload.sourceHypothesisRevision
        || project.hypothesisRevision !== proposal.sourceHypothesisRevision) {
        const message = 'The selected hypothesis proposal is unavailable, already accepted, or refers to an earlier hypothesis. Review the current hypothesis and submit a fresh candidate.';
        states[hypothesis.id] = { ...states[hypothesis.id]!, status: 'rejected', message };
        selection.blockedReason = message; warn(project, message);
      } else {
        selection.reconstruction = { commandId: hypothesis.id, proposalId: proposal.id, hypothesis: proposal.hypothesis, sourceHypothesisRevision: proposal.sourceHypothesisRevision,
          kind: proposal.kind, assumptions: [...proposal.assumptions], implication: proposal.implication, reason: proposal.reason };
        selection.pendingModifications = [proposal.hypothesis];
      }
    } else selection.pendingModifications = [hypothesis.payload];
  }
  selection.commandIds = [...(hypothesis && states[hypothesis.id]?.status === 'pending' ? [hypothesis.id] : []), ...selection.annotationCommandIds];
  syncPending(project); return selection;
}
export function markPlanningInputs(project: CommandProject, selection: PlanningSelection): void {
  if (selection.blockedReason) throw new Error(selection.blockedReason);
  const states = project.commandStates ??= {};
  for (const id of selection.commandIds) {
    const state = states[id];
    if (!state || state.status !== 'pending' && !(state.status === 'planning' && state.boundaryId === selection.boundaryId)) throw new Error('Planning selection no longer matches the pending user inputs.');
  }
  for (const id of selection.commandIds) {
    const state = states[id]!;
    states[id] = { ...state, status: 'planning', boundaryId: selection.boundaryId }; delete states[id]!.message;
  }
  syncPending(project);
}
/** Acknowledge only this captured selection; never all refinements that happen to exist now. */
export function finishPlanningInputs(project: CommandProject, selection: PlanningSelection, hypothesisRevision: string): void {
  if (selection.blockedReason) throw new Error(selection.blockedReason);
  const states = project.commandStates ??= {};
  const proposal = selection.reconstruction && project.reconstructionProposals?.find(item => item.id === selection.reconstruction!.proposalId);
  if (selection.reconstruction && (!proposal || proposal.hypothesis !== selection.reconstruction.hypothesis
    || proposal.sourceHypothesisRevision !== selection.reconstruction.sourceHypothesisRevision
    || proposal.kind !== selection.reconstruction.kind || proposal.implication !== selection.reconstruction.implication
    || proposal.reason !== selection.reconstruction.reason || JSON.stringify(proposal.assumptions) !== JSON.stringify(selection.reconstruction.assumptions))) throw new Error('Accepted hypothesis proposal no longer matches the captured planning selection.');
  for (const id of selection.commandIds) {
    const state = states[id];
    if (state?.status === 'applied' && state.boundaryId === selection.boundaryId && state.hypothesisRevision === hypothesisRevision) continue;
    if (state && !['pending', 'planning'].includes(state.status)) throw new Error('A planning receipt conflicts with an existing user-input outcome.');
  }
  for (const id of selection.commandIds) {
    states[id] = { ...states[id], status: 'applied', boundaryId: selection.boundaryId, hypothesisRevision };
    delete states[id]!.message;
  }
  if (selection.reconstruction && proposal) {
    proposal.status = 'accepted'; proposal.acceptedCommandId = selection.reconstruction.commandId;
    const epoch = /^epoch_(\d+)$/u.exec(selection.boundaryId); if (epoch) proposal.acceptedAtEpoch = Number(epoch[1]);
  }
  syncPending(project); syncWatermark(project);
}
export function releasePlanningInputs(project: CommandProject, selection: PlanningSelection, message?: string): void {
  const states = project.commandStates ??= {};
  for (const id of selection.commandIds) {
    const state = states[id];
    if (state?.status === 'planning' && state.boundaryId === selection.boundaryId) {
      states[id] = { ...state, status: 'pending', ...(message ? { message } : {}) }; delete states[id]!.boundaryId;
    }
  }
  syncPending(project);
}
