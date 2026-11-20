import type { AnyResearchProject } from '../../src/research/contracts/loop';
import type { MonitorActivitySnapshot, MonitorOperation } from '../../src/server/monitor-activity';
import type { LoopView } from './loop-view';

export interface DiagramNode { id: string; label: string; owner: string; detail: string }
export interface DiagramBranch extends DiagramNode {
  kind: 'skill' | 'decision' | 'strategy' | 'documents' | 'user-input' | 'worker' | 'computation';
  running: boolean;
  queued: boolean;
  sourceId: string;
  targetId: string;
  placementId?: string;
  condition: string;
}
export interface DiagramView {
  version: 1 | 2 | 3 | 4;
  nodes: DiagramNode[];
  branches: DiagramBranch[];
  activeIds: string[];
  current: string;
  live: boolean;
  stale: boolean;
}

const v1: readonly DiagramNode[] = [
  { id: 'INTAKE', label: 'Receive hypothesis', owner: 'Theorist + program', detail: 'Receive the current hypothesis, approved context and queued changes.' },
  { id: 'skills', label: 'Skill pick', owner: 'Theorist', detail: 'Select relevant shared method or failure guidance while planning. This conceptual substep has no separate activity signal.' },
  { id: 'PLAN', label: 'Identify Ways', owner: 'Theorist', detail: 'Construct specific proving or refuting paths using the hypothesis and applicable Skills.' },
  { id: 'PRIORITIZE', label: 'Score Ways', owner: 'Program', detail: 'Apply the frozen V1 factors and weights to rank Ways. Optional literature work also belongs to this stage.' },
  { id: 'DISPATCH', label: 'Distribute tasks', owner: 'Theorist plan + program', detail: 'Prepare independent Worker briefs, directions, effort and bounded budgets.' },
  { id: 'VERIFY', label: 'Explore proofs', owner: 'Workers', detail: 'Independent Workers formulate, derive, challenge, check, reflect and return their findings.' },
  { id: 'SYNTHESIZE', label: 'Merge results', owner: 'Theorist', detail: 'Collect and synthesize all ended paths, including failed or interrupted work. V1 has no independent collection stage.' },
  { id: 'REVIEW', label: 'Review findings', owner: 'Theorist', detail: 'Review root closure, allocation outcomes, final manuscripts and conditional learning opportunities.' },
  { id: 'CHECKPOINT', label: 'Save findings', owner: 'Program', detail: 'Persist research findings and queued commands at the safe boundary.' },
  { id: 'DECIDE', label: 'Next round', owner: 'Research controls', detail: 'Continue, refine, pause, complete or stop within the existing research loop.' },
];
const v2: readonly DiagramNode[] = [
  { id: 'receive', label: 'Receive hypothesis', owner: 'Theorist + program', detail: 'Receive the hypothesis and next-Epoch modifications. No separate live substep is exposed.' },
  { id: 'strategy', label: 'Strategy pick', owner: 'Theorist', detail: 'Use Base, User and applicable Specific Strategy to select subject-level directions and knowledge anchors.' },
  { id: 'skills', label: 'WaySkill pick', owner: 'Theorist', detail: 'Find reusable method or failure guidance for constructing Ways. Resource selection is not separately instrumented.' },
  { id: 'ways', label: 'Identify Ways', owner: 'Theorist', detail: 'Instantiate directions and applicable WaySkills as concrete proving or refuting paths.' },
  { id: 'score', label: 'Score Ways', owner: 'Program + Theorist', detail: 'Apply frozen scoring weights and bounded allocation rules; the optional Theorist call checks effort uncertainty. This does not update the weights.' },
  { id: 'dispatch', label: 'Distribute tasks', owner: 'Theorist plan + program', detail: 'Prepare and admit independent Worker tasks within the frozen budgets. Dispatch has no independent live signal.' },
  { id: 'explore', label: 'Explore proofs', owner: 'Workers', detail: 'Workers independently formulate, derive, challenge, check and reflect under bounded budgets.' },
  { id: 'collect', label: 'Collect results', owner: 'Workers + Theorist', detail: 'Workers return findings; the Theorist may audit returned cross-domain results. Other Workers can still be exploring.' },
  { id: 'merge', label: 'Merge answer', owner: 'Theorist', detail: 'Synthesize all ended paths and reconcile their conditions, evidence and unresolved questions.' },
  { id: 'gate', label: 'Check result', owner: 'Program', detail: 'Validate scope, references and frozen versions before accepting results.' },
  { id: 'checkpoint', label: 'Save findings', owner: 'Program', detail: 'Commit the Epoch findings and register eligible final proof and learning outcomes.' },
  { id: 'decision', label: 'Next Epoch', owner: 'Research controls', detail: 'Continue or finish according to the synthesis and safe-boundary controls. There is no separate live decision phase.' },
];

function operationNode(operation: Pick<MonitorOperation, 'task' | 'step'>, version: 1 | 2): string | undefined {
  if (version === 1) {
    if (operation.task === 'plan') return 'PLAN';
    if (operation.task === 'worker_step') return 'VERIFY';
    if (operation.task === 'synthesize') return 'SYNTHESIZE';
    if (operation.task === 'review') return 'REVIEW';
    return undefined;
  }
  if (operation.task === 'v2_route_knowledge') return 'strategy';
  if (operation.task === 'v2_generate_ways') return 'ways';
  if (operation.task === 'v2_decision_check') return 'score';
  if (operation.task === 'v2_worker_step') return operation.step === 'RETURN' ? 'collect' : 'explore';
  if (operation.task === 'v2_audit') return 'collect';
  if (operation.task === 'v2_synthesize') return 'merge';
  return undefined;
}

/** Display-only projection. A conceptual box is not evidence that its operation is running. */
export function projectDiagramView(project: AnyResearchProject, loopView: LoopView, activity?: MonitorActivitySnapshot, input: { userInputPending?: boolean } = {}): DiagramView {
  if (project.schemaVersion === 4) {
    const activeIds = new Set<string>();
    if (loopView.live && !loopView.stale) {
      if (loopView.activeId) activeIds.add(loopView.activeId);
      const scoped = activity && activity.projectId === project.id && activity.available ? activity.operations : [];
      for (const operation of scoped) {
        if (operation.task === 'v0_plan') activeIds.add('planning');
        if (operation.task === 'v0_solve') activeIds.add('solving');
      }
    }
    return { version: 4, nodes: loopView.nodes, branches: loopView.branches.map(branch => ({ ...branch,
      kind: 'strategy', sourceId: 'checkpoint', targetId: 'planning' })), activeIds: [...activeIds],
      current: loopView.current, live: loopView.live, stale: loopView.stale };
  }
  if (project.schemaVersion === 3) {
    const v4 = project.researchLoopVersion === '4.0';
    if (v4 || project.researchLoopVersion === '3.0') {
      const operations = activity?.projectId === project.id && activity.available ? activity.operations : undefined;
      const live = loopView.live && !loopView.stale;
      const activeIds = new Set<string>();
      if (live) {
        if (operations) {
          if (operations.some(operation => operation.task === 'v21_theorist')) activeIds.add('executing');
          if (operations.some(operation => operation.task === 'v21_plan')) activeIds.add('planning');
          if (!operations.length && loopView.activeId && loopView.activeId !== 'executing') activeIds.add(loopView.activeId);
        } else if (loopView.activeId) activeIds.add(loopView.activeId);
      }
      const running = (task: string) => live && !!operations?.some(operation => operation.task === task);
      const checks = live && !!operations?.some(operation => ['execute_registered_operations', 'retrieve_knowledge', 'read_operation_artifact'].includes(operation.toolName ?? ''));
      const branches: DiagramBranch[] = loopView.branches.map(branch => ({ ...branch, kind: branch.id === 'skills' ? 'skill' : 'strategy', sourceId: 'checkpoint', targetId: 'planning' }));
      branches.unshift(
        { id: 'workers', kind: 'worker', label: 'Optional Workers', owner: 'Workers', detail: 'Scoped independent or auxiliary work requested by the Theorist.', sourceId: 'executing', targetId: 'executing', placementId: 'executing', condition: 'An optional Worker is executing', running: running('v21_optional_worker'), queued: false },
        { id: 'checks', kind: 'computation', label: 'Tools / local checks', owner: 'Program', detail: 'Registered checks and scoped knowledge/artifact reads; local results do not certify the root proof.', sourceId: 'executing', targetId: 'executing', placementId: 'executing', condition: 'A local check or knowledge read is executing', running: checks, queued: false },
      );
      if (input.userInputPending) branches.unshift({ id: 'user-input', kind: 'user-input', label: 'User input', owner: 'User', detail: 'Submitted changes wait for the next safe boundary.', sourceId: 'planning', targetId: 'planning', placementId: 'planning', condition: 'A submitted change is queued', running: !loopView.stale, queued: true });
      return { version: v4 ? 4 : 3, nodes: loopView.nodes, branches, activeIds: [...activeIds], current: loopView.current, live: loopView.live, stale: loopView.stale };
    }
    const taskNodes: Record<string, string> = { v21_plan: 'planning', v21_worker_answer: 'executing', v21_check: 'checking' };
    const activeIds = new Set<string>();
    if (loopView.live && !loopView.stale) {
      if (loopView.activeId) activeIds.add(loopView.activeId);
      const scoped = activity && activity.projectId === project.id && activity.available ? activity.operations : [];
      for (const operation of scoped) if (operation.task && taskNodes[operation.task]) activeIds.add(taskNodes[operation.task]);
    }
    return { version: 3, nodes: loopView.nodes, branches: loopView.branches.map(branch => ({ ...branch,
      kind: branch.id === 'slow' ? 'strategy' : branch.id === 'skills' ? 'skill' : 'decision', sourceId: 'checkpoint', targetId: 'planning' })),
      activeIds: [...activeIds], current: loopView.current, live: loopView.live, stale: loopView.stale };
  }
  const version = project.schemaVersion;
  const nodes = (version === 1 ? v1 : v2).map(node => ({ ...node }));
  const active = new Set<string>();
  const live = loopView.live && !loopView.stale && project.status === 'running';
  const scopedActivity = activity && (!('projectId' in activity) || activity.projectId === project.id) ? activity : undefined;
  const operations = scopedActivity?.available ? scopedActivity.operations : undefined;
  if (live) {
    if (operations) {
      for (const operation of operations) {
        const id = operationNode(operation, version);
        if (id) active.add(id);
      }
    } else if (project.schemaVersion === 2) {
      const marker = project.activeEpoch;
      for (const call of marker?.calls ?? []) {
        if (call.status !== 'pending') continue;
        const step = call.task === 'v2_worker_step' && marker?.tasks.some(task => call.id === `${task.id}_RETURN`) ? 'RETURN' as const : undefined;
        const id = operationNode({ task: call.task, step }, version);
        if (id) active.add(id);
      }
    }
    const foregroundOperations = operations?.some(operation => operation.task !== 'research_learn');
    if (!foregroundOperations) {
      if (project.schemaVersion === 2) {
        const phase = project.activeEpoch?.phase ?? project.phase;
        if (phase === 'gate') active.add('gate');
        if (phase === 'checkpoint') active.add('checkpoint');
      } else if (['INTAKE', 'DISPATCH', 'CHECKPOINT', 'DECIDE'].includes(project.stage)) active.add(project.stage);
      else if (project.stage === 'PRIORITIZE' && (operations !== undefined || !project.config.literatureEnabled)) active.add('PRIORITIZE');
    }
  }

  const runningBranch = (id: string) => !loopView.stale && loopView.branches.some(branch => branch.id === id && branch.running);
  const queuedBranch = (id: string) => loopView.branches.some(branch => branch.id === id && branch.queued);
  const outcome = version === 1 ? 'REVIEW' : 'merge';
  const score = version === 1 ? 'PRIORITIZE' : 'score';
  const checkpoint = version === 1 ? 'CHECKPOINT' : 'checkpoint';
  const merge = version === 1 ? 'SYNTHESIZE' : 'merge';
  const explore = version === 1 ? 'VERIFY' : 'explore';
  const branches: DiagramBranch[] = [
    { id: 'skills-learning', kind: 'skill', label: 'Making skills', owner: 'Theorist', detail: 'Extract reusable methods from eligible closed root proofs, or corrective guidance from qualifying shared scientific failures. Future planning reads the resulting version.',
      sourceId: outcome, targetId: 'skills', condition: 'Eligible root proof or generalizable shared failure', running: runningBranch('skills'), queued: queuedBranch('skills') },
    { id: 'decision-learning', kind: 'decision', label: 'Adjust weights', owner: version === 1 ? 'Moderator' : 'Theorist', detail: version === 1 ? 'Maintain V1 factors and weights from deduplicated anomaly batches. Changes apply in future rounds.' : 'Maintain the V2 Fast decision file only when a reviewed allocation opportunity warrants it. Changes apply in future Epochs.',
      sourceId: outcome, targetId: score, condition: version === 1 ? 'Enough distinct anomalies' : 'Recorded decision-adjustment opportunity', running: runningBranch('decision-learning'), queued: queuedBranch('decision-learning') },
  ];
  if (version === 2) branches.push({ id: 'strategy-learning', kind: 'strategy', label: 'Learn strategy', owner: 'Moderator', detail: 'Slow learning uses eligible archived final proofs and their tags to identify or revise Specific Strategy. It does not alter Fast weights or current Ways.',
    sourceId: checkpoint, targetId: 'strategy', condition: 'Eligible archived final-proof cases; no change is valid', running: runningBranch('slow'), queued: queuedBranch('slow') });
  const writers = live ? (operations ?? []).filter(operation => operation.toolName === 'save_proof_chapter' && (operation.role === 'worker' || operation.role === 'theorist')) : [];
  const workerOnly = writers.length > 0 && writers.every(operation => operation.role === 'worker');
  const writer = writers.find(operation => operation.role === 'theorist') ?? writers[0];
  const documentSource = writer ? operationNode(writer, version) ?? (workerOnly ? explore : outcome) : outcome;
  branches.push({ id: 'documents', kind: 'documents', label: 'Write docs', owner: workerOnly ? 'Workers' : 'Theorist · optional Worker chapters',
    detail: 'Optional Worker derivation chapters and Theorist final-manuscript chapters. Lit only while a save_proof_chapter tool is actually executing; a saved draft or archive receipt is not live writing.',
    sourceId: documentSource, targetId: checkpoint, placementId: merge, condition: 'An actual proof-chapter write is running', running: writers.length > 0, queued: false });
  branches.unshift({ id: 'user-input', kind: 'user-input', label: 'User input', owner: 'User',
    detail: 'A submitted hypothesis modification is waiting for the next planning boundary. Editing an unsent draft does not activate this block. A queued instruction is not an executing model task.',
    sourceId: version === 1 ? 'INTAKE' : 'receive', targetId: version === 1 ? 'INTAKE' : 'receive',
    placementId: version === 1 ? 'INTAKE' : 'receive', condition: 'Submitted modify is queued or awaiting planning',
    running: !loopView.stale && input.userInputPending === true, queued: input.userInputPending === true });
  const activeIds = nodes.filter(node => active.has(node.id)).map(node => node.id);
  return { version, nodes, branches, activeIds, current: activeIds.length ? nodes.filter(node => active.has(node.id)).map(node => node.label).join(' · ') : loopView.current, live, stale: loopView.stale };
}
