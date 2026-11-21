import { v0Epoch } from '../research-view-v0';
import { currentResearchNumber } from '../research-scope';
import { v21Epoch } from '../research-view-v21';
import type { AnyResearchProject } from '../../src/research/contracts/loop';
import type { BranchResult } from '../../src/research/contracts/v1';
import type { WorkerResult } from '../../src/research/contracts/v2';
import type { ResearchReceipt } from '../../src/research/contracts/review';
import type { BoundaryView, ResourceRef } from '../../src/learning/research-data';
import { researchEpoch } from '../research/directions-view';

export interface ResearchMilestone {
  id: string;
  label: string;
  text: string;
  /** Full scope/provenance, available without duplicating the main timeline. */
  detail?: string;
}
export interface ResearchProgress { scope: string; milestones: ResearchMilestone[]; saved: boolean }
const unique = (values: string[]) => [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];

function loadedSkills(boundary?: BoundaryView, refs: ResourceRef[] = []): ResearchMilestone[] {
  return refs.flatMap(ref => {
    const skill = boundary?.skills?.find(skill => skill.id === ref.id && skill.version === ref.version);
    return skill ? [{ id: `skill:${ref.id}:${ref.version}`, label: 'Skill read', text: skill.name, detail: skill.description }] : [];
  });
}
function report(id: string, result: BranchResult | WorkerResult, disposition: 'provisional' | 'saved' | 'not accepted'): ResearchMilestone | undefined {
  // Execution errors are not scientific findings. Never turn missing content into a claim.
  const text = result.pathReport?.result?.trim() || result.applicability?.trim() || '';
  if (result.executionStatus !== 'completed' || !text) return undefined;
  const conditions = unique([...(result.assumptions ?? []), ...(result.pathReport?.conditions ?? [])]);
  const qualifier = 'evidence' in result ? result.evidence === 'need_data' ? ' · needs data'
    : result.evidence === 'insufficient' ? ' · insufficient evidence' : '' : '';
  return { id: `report:${id}`, label: `Scoped report${disposition === 'saved' ? '' : ` · ${disposition}`}${'incomplete' in result && result.incomplete ? ' · incomplete' : ''}${qualifier}`, text,
    detail: [conditions.length ? `Conditions: ${conditions.join('; ')}` : '', result.conclusion ? `Scoped conclusion: ${result.conclusion.replaceAll('_', ' ')}` : 'No scientific conclusion recorded.',
      'A returned report does not establish the root hypothesis.'].filter(Boolean).join('\n') };
}
function receiptMilestones(receipt?: ResearchReceipt): ResearchMilestone[] {
  return receipt?.proofArchive?.status === 'saved' && receipt.proofArchive.ref
    ? [{ id: `archive:${receipt.proofArchive.ref.caseId}:${receipt.proofArchive.ref.revision}`, label: 'Manuscript archived', text: receipt.review?.proof?.target || receipt.hypothesis,
      detail: 'The archive receipt confirms storage, not independent mathematical verification.' }]
    : [];
}

/** Pure, scope-bound projection from real snapshots; no timed or inferred phase completions. */
export function researchProgress(project: AnyResearchProject, number = currentResearchNumber(project)): ResearchProgress {
  if (project.schemaVersion === 4) {
    const epoch = v0Epoch(project, number), milestones: ResearchMilestone[] = [];
    for (const way of epoch?.selection?.candidates ?? []) milestones.push({ id: `way:${way.id}`, label: epoch?.selection?.selectedWayId === way.id ? 'Way selected' : 'Candidate Way',
      text: way.direction, detail: `Estimated p=${way.p} (heuristic, not calibrated). ${way.estimateReason}` });
    if (epoch?.solve) {
      milestones.push({ id: `answer:${epoch.solve.answerRef.id}`, label: 'Original answer saved', text: `${epoch.solve.technical.executionStatus} · ${epoch.solve.technical.completeness}`, detail: 'Technical completion does not establish a scientific conclusion.' });
      if (epoch.scientificCommitted) milestones.push({ id: 'verdict', label: 'Scientific assessment', text: epoch.solve.outcome.verdict, detail: 'Theorist self-assessment; not independent mathematical verification.' });
    }
    for (const answer of epoch?.technicalAnswers ?? []) if (answer.answerRef.id !== epoch?.solve?.answerRef.id) milestones.push({ id: `answer:${answer.answerRef.id}`, label: 'Technical-only original saved', text: `${answer.technical.executionStatus} · ${answer.technical.completeness}`, detail: 'No scientific outcome committed from this capture.' });
    if (epoch?.archive) milestones.push({ id: `archive:${epoch.archive.operationId}`, label: `Archive ${epoch.archive.status}`, text: epoch.archive.selection.way.direction, detail: 'Storage status is separate from scientific assessment.' });
    return { scope: `Epoch ${number || '—'}`, milestones, saved: !!epoch && 'completedAt' in epoch };
  }
  if (project.schemaVersion === 3) {
    const epoch = v21Epoch(project, number), milestones: ResearchMilestone[] = [];
    if (epoch?.optionalFlow) {
      const flow = epoch.optionalFlow;
      for (const artifact of flow.artifacts) milestones.push({ id: `original:${artifact.id}`, label: `${artifact.authorRole === 'theorist' ? 'Theorist' : 'Worker'} original saved`, text: artifact.route.description, detail: `${artifact.technical.executionStatus} · ${artifact.technical.completeness} · scientific ${artifact.qualification}` });
      for (const call of epoch.calls) if (call.captured && !flow.artifacts.some(artifact => artifact.originalRef.id === call.captured!.originalRef.id)) milestones.push({ id: `capture:${call.id}`, label: 'Original retained', text: `${call.captured.technical.executionStatus} · ${call.captured.technical.completeness}`, detail: 'Technical capture; scientific completion is unassessed.' });
      for (const receipt of flow.v3?.receipts ?? []) milestones.push({ id: `operation:${receipt.id}`, label: `Local check · ${receipt.status === 'completed' ? receipt.verification.kind : receipt.status}`, text: receipt.summary, detail: [receipt.status, receipt.verification.scope, ...receipt.conditionalPremises, ...receipt.missingConditions, ...receipt.errors].filter(Boolean).join('\n') });
      for (const archive of flow.archives) milestones.push({ id: `archive:${archive.operationId}`, label: `Archive ${archive.status}`, text: archive.selection.artifact.route.description, detail: 'Exact original storage; scientific qualification is separate.' });
      if (flow.conflictArtifactIds.length) milestones.push({ id: 'conflict', label: 'Needs review', text: 'Conflicting same-root claims' });
      return { scope: `Epoch ${number || '—'}`, milestones, saved: 'completedAt' in epoch && !!epoch.completedAt };
    }
    for (const task of epoch?.tasks ?? []) {
      if (task.frozen) milestones.push({ id: `question:${task.id}`, label: 'Question assigned', text: task.frozen.question.question });
      if (task.answer) milestones.push({ id: `answer:${task.answer.id}`, label: 'Original answer saved', text: `${task.answer.executionStatus} · ${task.answer.completeness}`, detail: 'Technical state does not establish a scientific conclusion.' });
    }
    for (const decision of epoch?.review?.decisions ?? []) milestones.push({ id: `review:${decision.answerId}`, label: `Review · ${decision.status}`, text: decision.conclusion, detail: decision.reason });
    for (const archive of epoch?.archives ?? []) milestones.push({ id: `archive:${archive.operationId}`, label: `Archive ${archive.status}`, text: archive.wayId, detail: 'Archive storage is distinct from independent mathematical verification.' });
    return { scope: `Epoch ${number || '—'}`, milestones, saved: !!epoch && 'completedAt' in epoch };
  }
  const scope = `${project.schemaVersion === 2 ? 'Epoch' : 'Round'} ${number || '—'}`;
  let milestones: ResearchMilestone[] = [];
  let saved = false;
  if (project.schemaVersion === 1) {
    const round = project.rounds?.find(round => round.number === number);
    if (!round) return { scope, milestones, saved };
    const assigned = new Set(round.branchIds ?? []);
    milestones = loadedSkills(round.research?.boundary, round.research?.loadedResources);
    for (const id of round.branchIds ?? []) {
      const node = project.graph?.find(node => node.id === id);
      if (!node?.question?.trim()) continue;
      milestones.push({ id: `direction:${id}`, label: 'Exploration assigned', text: node.question,
        detail: node.targetTheory && node.targetTheory !== node.question ? `Target: ${node.targetTheory}` : undefined });
    }
    for (const result of (project.results ?? []).filter(result => assigned.has(result.branchId))) {
      const finding = report(result.branchId, result, round.completedAt ? 'saved' : 'provisional');
      if (finding) milestones.push(finding);
    }
    milestones.push(...receiptMilestones(round.research));
    saved = !!round.completedAt;
  } else {
    const epoch = researchEpoch(project, number);
    if (!epoch) return { scope, milestones, saved };
    const { snapshot } = epoch;
    const tasks = epoch.tasks ?? [];
    const committed = 'committedTaskIds' in epoch ? new Set(epoch.committedTaskIds ?? []) : new Set<string>();
    // Unsealed preparation contains default routing, not an adopted knowledge selection.
    if ('number' in epoch || epoch.sealed) {
      const strategy = snapshot?.strategy;
      const domains = unique((strategy?.recommendation?.domainIds ?? []).flatMap(id => strategy?.domains?.find(domain => domain.id === id)?.label ?? []));
      if (domains.length) milestones.push({ id: 'directions', label: 'Research focus', text: domains.join(' · ') });
      for (const id of unique([...(strategy?.recommendation?.anchorIds ?? []), ...tasks.flatMap(task => task.way?.anchorIds ?? [])])) {
        const anchor = strategy?.anchors?.find(anchor => anchor.id === id);
        if (!anchor?.content?.trim() || anchor.support === 'methodological') continue;
        milestones.push({ id: `knowledge:${anchor.id}:${anchor.revision}`, label: anchor.support === 'unverified_model' ? 'Unverified knowledge' : anchor.citations?.length ? 'Source-cited knowledge' : 'Knowledge context',
          text: anchor.content, detail: [anchor.provenance, anchor.applicability ? `Scope: ${anchor.applicability}` : '', ...(anchor.assumptions ?? []).map(text => `Assumption: ${text}`), ...(anchor.citations ?? []).map(ref => `${ref.sourceId}: ${ref.locator}`)].filter(Boolean).join('\n') });
      }
      milestones.push(...loadedSkills(snapshot?.researchBoundary, 'research' in epoch ? epoch.research?.loadedResources ?? snapshot?.loadedResources : snapshot?.loadedResources));
    }
    for (const task of tasks) {
      if (!task.way?.question?.trim()) continue;
      milestones.push({ id: `direction:${task.id}`, label: 'Planned direction', text: task.way.question,
        detail: task.way.targetProposition && task.way.targetProposition !== task.way.question ? `Target: ${task.way.targetProposition}` : undefined });
    }
    const returned = tasks.filter(task => task.result && task.completedAt).toSorted((a, b) => a.completedAt!.localeCompare(b.completedAt!));
    for (const task of returned) {
      const finding = report(task.id, task.result!, committed.has(task.id) ? 'saved' : 'number' in epoch ? 'not accepted' : 'provisional');
      if (finding) milestones.push(finding);
    }
    if ('research' in epoch) milestones.push(...receiptMilestones(epoch.research));
    saved = 'completedAt' in epoch && !!epoch.completedAt;
  }
  if (saved) milestones.push({ id: 'checkpoint', label: 'Checkpoint saved', text: `${scope} findings preserved` });
  // Repeated references are one observation, never extra progress.
  const seen = new Set<string>();
  const firstOccurrences = milestones.filter(entry => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  return { scope, saved, milestones: firstOccurrences };
}
