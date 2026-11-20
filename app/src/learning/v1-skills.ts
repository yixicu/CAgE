import { createHash } from 'node:crypto';
import { atomicWrite, exists, readJson } from '../storage/atomic.js';
import { parseProject, validate } from '../research/versions/v1/schemas.js';
import type { AgentSessionSpec, ResearchProject } from '../research/contracts/v1.js';

import { StateSchema, ReviewInputSchema, VerdictSchema, ContentSchema } from './v1-skill-contracts.js';
import type { V1SkillState, V1SkillReader, V1SkillCandidate, V1SkillReviewInput, V1SkillReviewer, V1SkillOperation, V1SkillEvidence, V1SkillSource, V1SkillCase, V1SkillVerdict, V1SkillResource } from './v1-skill-contracts.js';
export { ReviewInputSchema } from './v1-skill-contracts.js';
export type * from './v1-skill-contracts.js';

export class V1SkillError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'STALE_REVISION' | 'INSUFFICIENT_EVIDENCE' | 'REVIEW_PENDING' | 'ID_CONFLICT', message: string) { super(message); this.name = 'V1SkillError'; }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
function relevant(value: string, terms: string[]): boolean { const haystack = normalized(value); return terms.every(term => haystack.includes(normalized(term))); }
function requireEvidence(condition: unknown, message: string): asserts condition { if (!condition) throw new V1SkillError('INSUFFICIENT_EVIDENCE', message); }
function stateRevision(state: Omit<V1SkillState, 'revision'> | V1SkillState): string { return digest({ schemaVersion: state.schemaVersion, skills: state.skills, operations: state.operations }); }

/** Explicit idle review and bounded next-session retrieval; V1 scientific records remain untouched. */
export class V1SkillService {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly filename: string, private readonly reader: V1SkillReader, private state: V1SkillState) {}
  static async open(filename: string, reader: V1SkillReader): Promise<V1SkillService> {
    const empty = { schemaVersion: 1 as const, skills: [], operations: [] };
    const state = await exists(filename) ? validate<V1SkillState>(StateSchema, await readJson(filename), 'V1 reviewed Skill registry') : { ...empty, revision: stateRevision(empty) };
    if (state.revision !== stateRevision(state) || new Set(state.skills.map(s => s.id)).size !== state.skills.length || new Set(state.operations.map(o => o.id)).size !== state.operations.length) throw new V1SkillError('INVALID_INPUT', 'Invalid V1 Skill registry revision or duplicate identities.');
    for (const skill of state.skills) if (skill.version !== digest({ content: skill.content, scope: skill.scope }) || skill.id !== `v1-skill-${skill.version.slice(0, 24)}` || !state.operations.some(o => o.id === skill.review.id && o.status === 'approved' && o.skillId === skill.id)) throw new V1SkillError('INVALID_INPUT', 'Invalid V1 reviewed Skill provenance.');
    return new V1SkillService(filename, reader, state);
  }
  snapshot(): V1SkillState { return structuredClone(this.state); }
  private serial<T>(action: () => Promise<T>): Promise<T> { const next = this.queue.then(action); this.queue = next.catch(() => {}); return next; }
  private async save(next: V1SkillState): Promise<void> {
    next.revision = stateRevision(next);
    validate(StateSchema, next, 'V1 Skill registry update');
    await atomicWrite(this.filename, `${JSON.stringify(next, null, 2)}\n`);
    this.state = next;
  }
  private expected(value: string): void { if (value !== this.state.revision) throw new V1SkillError('STALE_REVISION', 'V1 Skill registry changed; reload before updating.'); }
  private async pinned(projectId: string, contentRevision: string): Promise<ResearchProject> {
    let project: ResearchProject;
    try { project = parseProject(JSON.parse(new TextDecoder().decode(await this.reader.readRevision(projectId, contentRevision, 'project.json')))); }
    catch { throw new V1SkillError('INVALID_INPUT', 'V1 evidence revision is unavailable or invalid.'); }
    if (project.id !== projectId) throw new V1SkillError('INVALID_INPUT', 'V1 evidence project identity mismatch.');
    return { ...project, contentRevision };
  }
  private candidate(project: ResearchProject, source: V1SkillSource): V1SkillCandidate {
    const item = project.experiences[source.experienceIndex];
    requireEvidence(item?.kind === 'candidate_skill' && item.status === 'unreviewed', 'The pinned source must be an original unreviewed candidate_skill.');
    const content = validate<V1SkillCandidate['content']>(ContentSchema, { context: item.context, lesson: item.lesson, limitations: item.limitations }, 'bounded V1 candidate content');
    requireEvidence(Object.values(content).every(v => v.trim()), 'Candidate context, reusable method and limitations are required.');
    const round = project.rounds.find(r => r.number === item.round && r.completedAt);
    requireEvidence(round, 'The candidate must originate from a completed Round.');
    return { source: structuredClone(source), round: item.round, hypothesisRevision: round.hypothesisRevision, content };
  }
  async listCandidates(projectId: string): Promise<V1SkillCandidate[]> {
    const current = parseProject(await this.reader.loadProject(projectId));
    const project = await this.pinned(projectId, current.contentRevision);
    return project.experiences.flatMap((e, experienceIndex) => {
      if (e.kind !== 'candidate_skill') return [];
      try { return [this.candidate(project, { projectId, contentRevision: current.contentRevision, experienceIndex })]; } catch { return []; }
    });
  }
  private async evidence(input: V1SkillCase, scope: V1SkillReviewInput['scope']): Promise<V1SkillEvidence> {
    const project = await this.pinned(input.projectId, input.contentRevision);
    const round = project.rounds.find(r => r.number === input.round && r.completedAt);
    requireEvidence(round && round.summary.trim() && input.assessment.trim(), 'Each evidence case needs a completed public Round and explicit assessment.');
    const results: V1SkillEvidence['results'] = [];
    for (const branchId of round.branchIds) {
      const result = project.results.find(r => r.branchId === branchId);
      const node = project.graph.find(n => n.id === branchId && n.hypothesisRevision === round.hypothesisRevision);
      if (result?.executionStatus !== 'completed' || !result.conclusion || !result.verificationQuality?.trim() || !node || node.status === 'needs_review' || node.executionStatus !== 'completed') continue;
      let derivation = result.derivationMarkdown ?? '';
      if (result.derivationRef === `branches/${branchId}.md`) derivation = new TextDecoder().decode(await this.reader.readRevision(input.projectId, input.contentRevision, result.derivationRef));
      if (!derivation.trim() || !result.applicability.trim() || !result.strongestObjection?.trim()) continue;
      results.push({ branchId, conclusion: result.conclusion, assumptions: [...result.assumptions], applicability: result.applicability, derivation: derivation.slice(0, 12000), verificationQuality: result.verificationQuality });
    }
    requireEvidence(results.length > 0, 'An empty, failed, interrupted or needs-review Round cannot validate a Skill.');
    requireEvidence(relevant(`${project.hypothesis}\n${round.summary}\n${results.map(r => `${r.applicability}\n${r.derivation}`).join('\n')}`, scope.terms), 'Evidence is outside the explicitly declared Skill scope.');
    return { ...structuredClone(input), hypothesisRevision: round.hypothesisRevision, branchIds: results.map(r => r.branchId), roundSummaryHash: digest(round.summary), hypothesis: project.hypothesis, summary: round.summary.slice(0, 12000), results };
  }
  async review(value: V1SkillReviewInput, reviewer: V1SkillReviewer): Promise<V1SkillOperation> {
    const input = validate<V1SkillReviewInput>(ReviewInputSchema, value, 'V1 Skill review request');
    if (input.scope.terms.some(t => t !== t.trim()) || new Set(input.scope.terms.map(normalized)).size !== input.scope.terms.length) throw new V1SkillError('INVALID_INPUT', 'Scope terms must be nonempty and distinct.');
    const { expectedRevision: _revision, ...request } = input;
    const inputDigest = digest(request);
    return this.serial(async () => {
      const prior = this.state.operations.find(o => o.id === input.id);
      if (prior) {
        if (prior.inputDigest !== inputDigest) throw new V1SkillError('ID_CONFLICT', 'Review id already belongs to a different request.');
        if (prior.status === 'pending') throw new V1SkillError('REVIEW_PENDING', 'Prior model review is unresolved; it will not be automatically repeated.');
        return structuredClone(prior);
      }
      this.expected(input.expectedRevision);
      const current = parseProject(await this.reader.loadProject(input.candidate.projectId));
      requireEvidence(current.status !== 'running' && current.contentRevision === input.candidate.contentRevision, 'Candidate review requires its current saved idle boundary.');
      const source = await this.pinned(input.candidate.projectId, input.candidate.contentRevision);
      const candidate = this.candidate(source, input.candidate);
      requireEvidence(relevant(`${candidate.content.context}\n${candidate.content.lesson}`, input.scope.terms), 'Declared scope does not match the candidate method.');
      requireEvidence(input.cases.some(c => c.projectId === candidate.source.projectId && c.contentRevision === candidate.source.contentRevision && c.round === candidate.round), 'Evidence must include the exact candidate source Round.');
      requireEvidence(new Set(input.cases.map(c => c.projectId)).size === input.cases.length, 'Review requires distinct research projects, not repeated Rounds of one case.');
      const cases = await Promise.all(input.cases.map(c => this.evidence(c, input.scope)));
      requireEvidence(new Set(cases.map(c => c.hypothesisRevision)).size === cases.length, 'Copied hypotheses do not count as independent cases.');
      const pending: V1SkillOperation = { ...request, inputDigest, status: 'pending', createdAt: new Date().toISOString(), reason: 'Explicit Theorist review has started; outcome is not yet committed.' };
      await this.save({ ...this.snapshot(), operations: [...this.state.operations, pending] });
      try {
        const verdict = validate<V1SkillVerdict>(VerdictSchema, await reviewer({ project: structuredClone(source), candidate, scope: structuredClone(input.scope), cases }), 'explicit V1 Theorist Skill review');
        requireEvidence(verdict.reason.trim() && verdict.limitations.every(v => v.trim()), 'Review must state rationale and scientific limitations.');
        const after = parseProject(await this.reader.loadProject(input.candidate.projectId));
        requireEvidence(after.status !== 'running' && after.contentRevision === input.candidate.contentRevision, 'Candidate source changed during review; approval was not applied.');
        const next = this.snapshot(), operation = next.operations.find(o => o.id === input.id)!;
        operation.status = verdict.approved ? 'approved' : 'rejected'; operation.reason = verdict.reason; operation.finishedAt = new Date().toISOString();
        if (verdict.approved) {
          const version = digest({ content: candidate.content, scope: input.scope }), skillId = `v1-skill-${version.slice(0, 24)}`;
          operation.skillId = skillId;
          if (!next.skills.some(s => s.id === skillId)) next.skills.push({ id: skillId, version, content: structuredClone(candidate.content), scope: structuredClone(input.scope), source: structuredClone(candidate.source), sourceRound: candidate.round, evidence: cases.map(({ hypothesis: _h, summary: _s, results: _r, ...record }) => record), review: { id: input.id, at: operation.finishedAt, owner: 'theorist', reason: verdict.reason, limitations: [...verdict.limitations] }, enabled: true });
        }
        await this.save(next); return structuredClone(operation);
      } catch (error) {
        const next = this.snapshot(), operation = next.operations.find(o => o.id === input.id)!;
        operation.status = 'failed'; operation.finishedAt = new Date().toISOString(); operation.reason = 'Review failed or its source changed; no Skill was published and no model retry was scheduled.';
        await this.save(next); throw error;
      }
    });
  }
  async setEnabled(skillId: string, enabled: boolean, expectedRevision: string): Promise<V1SkillState> {
    return this.serial(async () => {
      this.expected(expectedRevision); const next = this.snapshot(), skill = next.skills.find(s => s.id === skillId);
      if (!skill || typeof enabled !== 'boolean') throw new V1SkillError('INVALID_INPUT', 'Unknown V1 reviewed Skill or enable state.');
      skill.enabled = enabled; await this.save(next); return this.snapshot();
    });
  }
  resolve(spec: AgentSessionSpec): V1SkillResource[] {
    if (spec.role !== 'theorist' || (spec.loop?.researchLoopVersion ?? '1.0') !== '1.0' || !('project' in spec.context)) return [];
    const project = spec.context.project;
    if (project.schemaVersion !== 1 || project.status !== 'running' || project.round < 1) return [];
    return this.state.skills.filter(s => s.enabled && relevant(project.hypothesis, s.scope.terms) && (s.source.projectId !== project.id || project.round > s.sourceRound)).slice(0, 3).map(s => ({ kind: 'reviewed_v1_skill', id: s.id, version: s.version, content: structuredClone(s.content), scope: structuredClone(s.scope), review: structuredClone(s.review), sources: s.evidence.map(e => ({ projectId: e.projectId, contentRevision: e.contentRevision, hypothesisRevision: e.hypothesisRevision, round: e.round })) }));
  }
}
