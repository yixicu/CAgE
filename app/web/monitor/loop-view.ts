import type { AnyResearchProject } from '../../src/research/contracts/loop';
import type { LearningTaskView } from '../api';
import type { MonitorActivitySnapshot } from '../../src/server/monitor-activity';
import { currentResearchNumber } from '../research-scope';

export interface MonitorOptions {
  connection?: 'connecting' | 'connected' | 'disconnected';
  active?: boolean;
  pendingStop?: boolean;
  pendingPause?: boolean;
  learningTasks?: LearningTaskView[];
  activity?: MonitorActivitySnapshot;
}
export interface LoopNode { id: string; label: string; detail: string; owner: string }
export interface LoopBranch extends LoopNode { returnsTo: string; condition: string; running: boolean; queued: boolean }
export interface LoopView {
  version: 1 | 2 | 3 | 4;
  title: string;
  boundary: 'Round' | 'Epoch';
  number: number;
  runKey: string;
  nodes: LoopNode[];
  branches: LoopBranch[];
  activeId?: string;
  current: string;
  previous?: string;
  receipt?: string;
  control?: string;
  live: boolean;
  stale: boolean;
  terminal: boolean;
  progress: string;
}
const v1: LoopNode[] = [
  { id: 'INTAKE', label: 'Receive goal', detail: 'Hypothesis · approved context', owner: 'Theorist + program' },
  { id: 'PLAN', label: 'Plan Ways', detail: 'H + shared Skills → specific Ways', owner: 'Theorist' },
  { id: 'PRIORITIZE', label: 'Prioritize', detail: 'Factor judgments · frozen V1 weights', owner: 'Program' },
  { id: 'DISPATCH', label: 'Assign Workers', detail: 'Directions · effort · frozen Briefs', owner: 'Theorist plan + program' },
  { id: 'VERIFY', label: 'Explore independently', detail: 'Isolated Workers · bounded budgets', owner: 'Workers' },
  { id: 'SYNTHESIZE', label: 'Synthesize paths', detail: 'All ended paths, including failures', owner: 'Theorist' },
  { id: 'REVIEW', label: 'Review findings', detail: 'Closure · anomalies · learning opportunities', owner: 'Theorist' },
  { id: 'CHECKPOINT', label: 'Save checkpoint', detail: 'Persist findings and queued commands', owner: 'Program' },
  { id: 'DECIDE', label: 'Decide next round', detail: 'Continue · refine · pause · complete · stop', owner: 'Research controls' },
];
const v2: LoopNode[] = [
  { id: 'preparing', label: 'Strategy → Directions', detail: 'H / modify · Base, User, Specific · knowledge anchors', owner: 'Theorist + program' },
  { id: 'generating', label: 'Skills → Ways → Allocation', detail: 'Frozen Fast decision · optional quick judgment · effort', owner: 'Theorist + program' },
  { id: 'executing', label: 'Explore → Review', detail: 'Independent bounded Workers · staged results · sparse audit', owner: 'Workers + Theorist' },
  { id: 'synthesizing', label: 'Synthesize all paths', detail: 'All ended reports · conditions · necessary review', owner: 'Theorist' },
  { id: 'gate', label: 'Consistency Gate', detail: 'Validate scope, references and frozen versions', owner: 'Program · Theorist findings' },
  { id: 'checkpoint', label: 'Save Epoch', detail: 'Central commit · continue or finish', owner: 'Program' },
];
const statusLabels = { idle: 'Ready to start', running: 'Research running', paused: 'Paused', completed: 'Research finished', stopped: 'Stopped', failed: 'Research interrupted' };

/** Read-only presentation. Visited phases are not proof of scientific success. */
export function projectLoopView(project: AnyResearchProject, workerSteps: Record<string, string> = {}, options: MonitorOptions = {}): LoopView {
  if (project.schemaVersion === 4) return v0LoopView(project, options);
  if (project.schemaVersion === 3) return v21LoopView(project, options);
  const version = project.schemaVersion;
  const boundary = version === 2 ? 'Epoch' : 'Round';
  const number = currentResearchNumber(project);
  const nodes = (version === 2 ? v2 : v1).map(node => ({ ...node }));
  const stale = options.connection !== undefined && options.connection !== 'connected';
  const active = options.active ?? project.status === 'running';
  const terminal = !active && project.status !== 'running';
  const live = active && !stale && project.status !== 'failed';
  let activeId: string | undefined;
  let current: string = statusLabels[project.status];
  let previous: string | undefined;
  let receipt: string | undefined;
  if (project.schemaVersion === 1) {
    if (active && project.status === 'running') activeId = project.stage;
    const round = project.rounds.find(item => item.number === number);
    const entered = round?.stages ?? [];
    const before = entered.lastIndexOf(project.stage) - 1;
    if (before >= 0) previous = v1.find(node => node.id === entered[before])?.label;
    if (activeId) current = v1.find(node => node.id === activeId)?.label ?? 'Research running';
    if (activeId === 'VERIFY') {
      const ids = round?.branchIds ?? [];
      const returned = ids.filter(id => ['completed', 'interrupted', 'failed'].includes(workerSteps[id] ?? '')).length;
      current = returned ? `Exploring paths · ${returned} returned` : 'Workers exploring independently';
    }
    const saved = project.rounds.toReversed().find(item => item.completedAt);
    if (saved) receipt = `Round ${saved.number} saved`;
  } else {
    const marker = project.activeEpoch;
    const phase = marker?.phase ?? project.phase;
    if (active && phase !== 'idle' && project.status === 'running') activeId = phase;
    if (activeId) current = v2.find(node => node.id === activeId)?.label ?? 'Research running';
    const pending = marker?.calls.filter(call => call.status === 'pending') ?? [];
    if (activeId === 'preparing') {
      current = pending.some(call => call.task === 'v2_route_knowledge') ? 'Theorist routing directions'
        : pending.some(call => call.task === 'v2_literature') ? 'Optional literature research' : 'Preparing Strategy and directions';
    }
    if (activeId === 'generating') {
      current = pending.some(call => call.task === 'v2_decision_check') ? 'Theorist checking allocation'
        : pending.some(call => call.task === 'v2_generate_ways') ? 'Theorist generating Ways' : 'Generating and allocating Ways';
    }
    if (activeId === 'executing') {
      const tasks = marker?.tasks ?? [];
      const working = tasks.filter(task => task.state === 'running').length;
      const returned = tasks.filter(task => ['staged', 'completed', 'failed', 'interrupted'].includes(task.state)).length;
      current = pending.some(call => call.task === 'v2_audit') ? 'Theorist reviewing cross-domain consistency'
        : working ? `Workers exploring · ${working} working${returned ? ` · ${returned} returned` : ''}` : 'Collecting results / preparing review';
    }
    if (activeId === 'synthesizing') current = 'Theorist synthesizing all paths';
    if (activeId === 'gate') current = 'Checking consistency and versions';
    if (activeId === 'checkpoint') current = 'Saving Epoch checkpoint';
    if (active && phase === 'idle') current = 'Finalizing saved Epoch';
    const lastCall = marker?.calls.toReversed().find(call => call.status === 'completed' && call.task !== 'v2_worker_step');
    const callLabels: Record<string, string> = { v2_route_knowledge: 'Directions returned', v2_literature: 'Literature returned', v2_generate_ways: 'Ways returned', v2_decision_check: 'Allocation check returned', v2_audit: 'Audit returned', v2_synthesize: 'Synthesis returned' };
    if (lastCall) previous = callLabels[lastCall.task];
    const saved = project.epochs.toReversed().find(item => item.completedAt);
    if (saved) receipt = `Epoch ${saved.number} saved`;
  }
  if (!active) { activeId = undefined; previous = undefined; }
  if (project.status === 'failed') activeId = undefined;
  const tasks = (options.learningTasks ?? []).filter(task => task.projectId === project.id);
  const branch = (node: LoopNode, kind: LearningTaskView['kind'], condition: string, returnsTo: string): LoopBranch => ({ ...node, condition, returnsTo,
    running: !stale && tasks.some(task => task.kind === kind && task.status === 'running'),
    queued: tasks.some(task => task.kind === kind && task.status === 'queued') });
  const branches: LoopBranch[] = [
    branch({ id: 'skills', label: 'Shared Skill learning', detail: 'Theorist · method or common failure', owner: 'Theorist' }, 'skill', 'Eligible root proof or qualifying shared failure', version === 1 ? 'Future PLAN' : 'Future Ways'),
    branch({ id: 'decision-learning', label: version === 1 ? 'V1 scoring maintenance' : 'V2 decision maintenance', detail: version === 1 ? 'Anomalies → deduplicate / batch → Moderator' : 'Theorist · recorded decision opportunity', owner: version === 1 ? 'Moderator' : 'Theorist' }, 'decision', version === 1 ? 'Enough distinct anomalies' : 'Recorded adjustment opportunity', version === 1 ? 'Future PRIORITIZE' : 'Future Fast decision'),
  ];
  if (version === 2) branches.push(branch({ id: 'slow', label: 'Slow · Specific Strategy', detail: 'Proof / tags index → batch filter → Moderator', owner: 'Moderator' }, 'strategy', 'Enough eligible archived cases; no change is valid', 'Future Strategy → Directions'));
  const control = options.pendingStop ? 'Stop requested · finishing bounded work and saving' : options.pendingPause ? `Pause queued · next ${boundary.toLowerCase()} boundary` : undefined;
  const prefix = stale ? `${options.connection === 'connecting' ? 'Connecting' : 'Connection lost'} · last reported: ` : '';
  const progress = `${prefix}${boundary} ${number || '—'} · ${current}${control ? ` · ${control}` : ''}`;
  return { version, title: version === 1 ? 'Quick research · V1' : 'Strict research · V2', boundary, number,
    runKey: `${project.id}:${version}:${number}`, nodes, branches, activeId, current, previous, receipt, control, live, stale, terminal, progress };
}

function v21LoopView(project: Extract<AnyResearchProject, { schemaVersion: 3 }>, options: MonitorOptions): LoopView {
  const v4 = project.researchLoopVersion === '4.0';
  const v3 = v4 || project.researchLoopVersion === '3.0';
  const number = currentResearchNumber(project);
  const nodes: LoopNode[] = v3 ? [
    { id: 'planning', label: 'Prepare context', detail: 'Freeze the root, knowledge and workspace for this boundary.', owner: 'Program' },
    { id: 'executing', label: 'Theorist proof', detail: 'Direct proof and continuation; Workers and local checks are optional.', owner: 'Theorist' },
    { id: 'archiving', label: v4 ? 'Retain research report' : 'Retain original', detail: 'Keep exact originals; qualified root results may also be archived. Storage does not certify a proof.', owner: 'Program' },
    { id: 'checkpoint', label: 'Save checkpoint', detail: 'Persist results and continuation state.', owner: 'Program' },
  ] : [
    { id: 'planning', label: 'Plan Ways and Questions', detail: 'Strategy → Direction → WaySkill · exact frozen inputs', owner: 'Theorist' },
    { id: 'executing', label: 'Answer Questions', detail: 'Independent original answers · assigned checks', owner: 'Workers' },
    { id: 'checking', label: 'Check answer interfaces', detail: 'All ended answers · explicit adoption and root closure', owner: 'Theorist' },
    { id: 'archiving', label: 'Archive closed Ways', detail: 'Ordered immutable original answers · no scientific rewrite', owner: 'Program' },
    { id: 'checkpoint', label: 'Save Epoch', detail: 'Durable decisions, receipts and queued commands', owner: 'Program' },
  ];
  const stale = options.connection !== undefined && options.connection !== 'connected';
  const active = options.active ?? project.status === 'running';
  const live = active && !stale && project.status === 'running';
  const phase = project.activeEpoch?.phase ?? project.phase;
  const operations = options.activity?.projectId === project.id && options.activity.available ? options.activity.operations : [];
  const pendingMain = project.activeEpoch?.calls.some(call => call.task === 'v21_theorist' && call.status === 'pending');
  const waiting = v3 && !operations.some(operation => operation.task === 'v21_theorist')
    && (operations.some(operation => operation.task === 'v21_optional_worker') || (!pendingMain && project.activeEpoch?.optionalFlow?.branches.some(branch => branch.state === 'running')));
  const activeId = live && phase !== 'idle' && !waiting ? phase : undefined;
  const current = waiting && live ? 'Waiting for Workers' : active && phase !== 'idle' ? nodes.find(node => node.id === phase)?.label ?? statusLabels[project.status] : statusLabels[project.status];
  const saved = project.epochs.at(-1);
  const control = options.pendingStop ? 'Stop requested · preserving in-flight work' : options.pendingPause ? 'Pause queued · next Epoch boundary' : undefined;
  const branches: LoopBranch[] = [
    { id: 'skills', label: 'Skill learning', detail: 'Eligible archived method or repeated scientific failure', owner: 'Theorist', returnsTo: 'Future planning', condition: 'Qualified scientific evidence', running: false, queued: false },
    ...(!v3 ? [{ id: 'decision-learning', label: 'V2 decision maintenance', detail: 'Future Epochs only', owner: 'Theorist', returnsTo: 'Future planning', condition: 'Reviewed allocation opportunity', running: false, queued: false }] : []),
    { id: 'slow', label: 'Specific Strategy', detail: 'Distinct eligible archived cases', owner: 'Moderator', returnsTo: 'Future planning', condition: 'Qualified case batch', running: false, queued: false },
  ];
  for (const branch of branches) {
    const kind = branch.id === 'skills' ? 'skill' : branch.id === 'slow' ? 'strategy' : 'decision';
    branch.running = !stale && (options.learningTasks ?? []).some(task => task.projectId === project.id && task.kind === kind && task.status === 'running');
    branch.queued = (options.learningTasks ?? []).some(task => task.projectId === project.id && task.kind === kind && task.status === 'queued');
  }
  return { version: 3, title: v4 ? 'Research · V4' : v3 ? 'Linked research · V3' : 'Strict research · V2.1', boundary: 'Epoch', number, runKey: `${project.id}:${project.researchLoopVersion}:${number}`,
    nodes, branches, activeId, current, receipt: saved ? `Epoch ${saved.epoch} saved` : undefined, control, live, stale,
    terminal: !active && project.status !== 'running', progress: `${stale ? 'Connection unavailable · last reported: ' : ''}Epoch ${number} · ${current}${control ? ` · ${control}` : ''}` };
}

function v0LoopView(project: Extract<AnyResearchProject, { schemaVersion: 4 }>, options: MonitorOptions): LoopView {
  const nodes: LoopNode[] = [
    { id: 'planning', label: 'Plan Ways', detail: 'Strategy → Direction → WaySkill; highest estimated p, first-in-plan ties', owner: 'Theorist + program' },
    { id: 'solving', label: 'Solve selected Way', detail: 'Complete original proof and self-check in the same call', owner: 'Theorist' },
    { id: 'archiving', label: 'Archive original proof', detail: 'Exact immutable original; storage is not mathematical verification', owner: 'Program' },
    { id: 'checkpoint', label: 'Save Epoch', detail: 'Persist scientific, technical and archive states separately', owner: 'Program' },
  ];
  const stale = options.connection !== undefined && options.connection !== 'connected';
  const active = options.active ?? project.status === 'running';
  const live = active && !stale && project.status === 'running';
  const phase = project.activeEpoch?.phase ?? project.phase;
  const activeId = live && phase !== 'idle' ? phase : undefined;
  const current = active && phase !== 'idle' ? nodes.find(node => node.id === phase)?.label ?? statusLabels[project.status] : statusLabels[project.status];
  const tasks = (options.learningTasks ?? []).filter(task => task.projectId === project.id);
  const branches: LoopBranch[] = [{ id: 'slow', label: 'Specific Strategy', detail: 'Distinct eligible archived cases; no current-proof review', owner: 'Moderator',
    returnsTo: 'Future planning', condition: 'Existing qualified case batch; no change is valid',
    running: !stale && tasks.some(task => task.kind === 'strategy' && task.status === 'running'), queued: tasks.some(task => task.kind === 'strategy' && task.status === 'queued') }];
  const control = options.pendingStop ? 'Stop requested · preserving in-flight work' : options.pendingPause ? 'Pause queued · next Epoch boundary' : undefined;
  const saved = project.epochs.at(-1);
  return { version: 4, title: 'V0 (test loop)', boundary: 'Epoch', number: project.epoch, runKey: `${project.id}:4:${project.epoch}`,
    nodes, branches, activeId, current, receipt: saved ? `Epoch ${saved.epoch} saved · scientific ${project.scientificVerdict} · archive ${project.archiveStatus}` : undefined,
    control, live, stale, terminal: !active && project.status !== 'running',
    progress: `${stale ? 'Connection unavailable · last reported: ' : ''}Epoch ${project.epoch} · ${current}${control ? ` · ${control}` : ''}` };
}
