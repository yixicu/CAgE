import { createHash } from 'node:crypto';
import type { EpochSnapshot, EpochTask, ResearchProjectV2, WaySkill, WaySkillProposal, WaySkillTrace } from '../../contracts/v2.js';
import { ValidationError } from '../../contracts/errors.js';

/** Method content, independent of preference, version and observed outcomes. */
export function skillContent(skill: Pick<WaySkill, 'method' | 'description' | 'applicability' | 'limitations' | 'correction'>): string {
  return JSON.stringify({ method: skill.method, description: skill.description.trim(),
    domainIds: [...(skill.applicability?.domainIds ?? [])].sort(), anchorTags: [...(skill.applicability?.anchorTags ?? [])].sort(), limitations: [...new Set(skill.limitations)].sort(), ...(skill.correction ? { correction: { category: skill.correction.category, pattern: skill.correction.pattern, check: skill.correction.check, ...(skill.correction.selfReview ? { selfReview: { taskId: skill.correction.selfReview.taskId, claim: skill.correction.selfReview.claim, witness: skill.correction.selfReview.witness } } : {}) } } : {}) });
}
export function learnedSkillId(skill: Pick<WaySkill, 'method' | 'description' | 'applicability' | 'limitations' | 'correction'>): string { return `learned-${createHash('sha256').update(skillContent(skill)).digest('hex').slice(0, 24)}`; }

/** Theorist proposals become local guidance only after their evidence passes the Gate. */
export function learnLocalSkills(skills: WaySkill[], proposals: readonly WaySkillProposal[], snapshot: EpochSnapshot, tasks: readonly EpochTask[], traces: readonly WaySkillTrace[], history?: Pick<ResearchProjectV2, 'epochs' | 'waySkillTraces'>): WaySkill[] {
  const next = structuredClone(skills);
  for (const proposal of proposals.slice(0, 2)) {
    const prior = proposal.correction ? history?.epochs.filter(e => e.snapshot.hypothesisRevision === snapshot.hypothesisRevision).flatMap(e => e.tasks) ?? [] : [];
    const sourceTraces = proposal.correction ? [...(history?.waySkillTraces ?? []), ...traces] : traces;
    const evidence = proposal.evidenceTaskIds.map(id => [...tasks, ...prior].find(t => t.id === id));
    if (!evidence.length || evidence.some(t => !t || t.result?.executionStatus !== 'completed' || !t.result.derivationChain.length || !sourceTraces.some(trace => trace.taskId === t.id && trace.executionStatus === 'completed'))) continue;
    const sourceSkills = evidence.map(t => sourceTraces.find(s => s.taskId === t!.id));
    const selfReview = proposal.correction?.selfReview;
    if (selfReview) {
      const source = evidence.find(t => t!.id === selfReview.taskId)?.result;
      if (!source || !selfReview.claim.trim() || !selfReview.witness.trim() || ![...source.derivationChain, source.derivationMarkdown ?? ''].some(text => text.includes(selfReview.claim))) continue;
    }
    // Local self-review verifies provenance only; it must never impersonate independent review.
    const reviewedError = (trace: WaySkillTrace | undefined) => trace?.reviewed?.attribution === 'way_formation' && Boolean(trace.reviewed.attributionReason?.trim());
    if (proposal.correction && sourceSkills.some(trace => trace?.reviewed ? !reviewedError(trace) : selfReview?.taskId !== trace?.taskId)) continue;
    const independentlyReviewed = sourceSkills.every(reviewedError);
    // A successful serial attempt cannot certify a never-exercised counterexample method.
    if (sourceSkills.some(s => s?.method !== proposal.method)) continue;
    if (!proposal.domainIds.length || proposal.domainIds.some(id => !evidence.some(t => t!.way.domainIds.includes(id)))) continue;
    const anchors = evidence.flatMap(t => t!.brief.anchors);
    if (proposal.anchorTags.some(tag => !anchors.some(a => a.tags.includes(tag)))) continue;
    const partial = evidence.some(t => t!.result!.incomplete || t!.result!.evidence !== 'sufficient');
    const conditions = partial || proposal.correction ? evidence.flatMap(t => [`Observed source scope: ${t!.result!.applicability}`, ...t!.result!.assumptions.map(a => `Observed source premise: ${a}`)]) : [];
    const content = { method: proposal.method, description: proposal.description.trim(), applicability: { domainIds: [...new Set(proposal.domainIds)], anchorTags: [...new Set(proposal.anchorTags)] }, limitations: [...new Set([...proposal.limitations, ...conditions, ...(partial ? ['Local candidate from partial or conditional work; neither a complete proof nor validated global method.'] : []), ...(proposal.correction ? [independentlyReviewed ? 'Proposed correction from reviewed error; effectiveness requires new completed trials.' : 'Unreviewed Theorist self-review: only source provenance was checked, not mathematical validity. Neutral local trial only; independent review and fresh complete trials are required for global promotion.'] : [])])], ...(proposal.correction ? { correction: structuredClone(proposal.correction) } : {}) };
    if (!content.description || content.limitations.length > 1000 || content.limitations.some(limit => !limit.trim() || limit.length > 1000000) || proposal.correction && (!proposal.correction.pattern.trim() || !proposal.correction.check.trim())) continue;
    if (next.some(skill => skillContent(skill) === skillContent(content))) continue;
    const id = learnedSkillId(content);
    const used = sourceTraces.filter(t => proposal.evidenceTaskIds.includes(t.taskId));
    next.push({ ...content, id, version: '1', scope: 'local', preference: partial || proposal.correction ? 0.5 : used.reduce((sum, t) => sum + t.informationValue, 0) / used.length,
      effectiveFromEpoch: snapshot.number + 1, evidenceTraceIds: used.map(t => t.id) });
  }
  return next;
}

/** Explicit cross-case trial, never global promotion or modification of the source. */
export function trialSkill(project: ResearchProjectV2, source: ResearchProjectV2, skillId: string, version: string): ResearchProjectV2 {
  if (project.status === 'running' || project.phase !== 'idle' || project.activeEpoch || source.id === project.id) throw new ValidationError('Skill trial requires a distinct saved idle target');
  const skill = source.waySkills.find(s => s.id === skillId && s.version === version);
  if (!skill || skill.id !== learnedSkillId(skill) || !skill.evidenceTraceIds.length || !source.waySkillTraces.some(t => skill.evidenceTraceIds.includes(t.id) && t.executionStatus === 'completed')) throw new ValidationError('Trial requires an existing evidence-backed local method');
  if (project.waySkills.some(s => s.id === skill.id)) throw new ValidationError('Skill already present; select its existing version in Capabilities');
  const next = structuredClone(project);
  next.waySkills.push({ ...structuredClone(skill), scope: 'local', effectiveFromEpoch: next.epoch + 1,
    trialSource: { projectId: source.id, revision: source.contentRevision, skillVersion: skill.version } });
  return next;
}

/** Verify trial provenance from the exact saved source, before publishing any global recipe. */
export async function verifyTrialSources(skillId: string, projects: readonly ResearchProjectV2[], read: (id: string, revision: string) => Promise<unknown>): Promise<void> {
  const checked = new Set<string>();
  for (const project of projects) for (const epoch of project.epochs) for (const skill of epoch.snapshot.waySkills) {
    const source = skill.trialSource;
    if (skill.id !== skillId || !source) continue;
    const key = `${source.projectId}:${source.revision}:${source.skillVersion}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (!/^[a-f0-9]{40}$/.test(source.revision) || source.projectId === project.id) throw new ValidationError('V2 invalid trial source');
    const pinned = await read(source.projectId, source.revision) as ResearchProjectV2;
    if (pinned.schemaVersion !== 2 || !pinned.waySkills.some(s => s.id === skill.id && s.version === source.skillVersion && skillContent(s) === skillContent(skill))) throw new ValidationError('V2 trial source does not contain the exact method');
  }
}
