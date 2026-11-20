import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AnyResearchProject, AnyAgentRuntime } from '../research/contracts/loop.js';
import type { ResearchRole, ReviewOutput } from '../research/contracts/v1.js';
import { V1SkillService, V1SkillError, ReviewInputSchema, type V1SkillReviewInput } from '../learning/v1-skills.js';

interface Services {
  skills: V1SkillService; runtime: AnyAgentRuntime;
  snapshot(id: string): Promise<AnyResearchProject>; requireIdle(id: string): void;
  serial<T>(id: string, work: () => Promise<T>): Promise<T>;
  assertRoleModels(project: AnyResearchProject, roles: ResearchRole[]): Promise<void>;
}
/** Explicit idle review reuses the V1 Theorist's existing REVIEW task, without adding a loop stage. */
export function registerSkillRoutes(app: FastifyInstance, services: Services): void {
  const { skills, runtime, snapshot, requireIdle, serial, assertRoleModels } = services;
  const identifier = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };
  app.get('/api/skills/v1', async () => skills.snapshot());
  app.get<{ Params: { id: string } }>('/api/projects/:id/skills/candidates', { schema: { params: { type: 'object', properties: { id: identifier }, required: ['id'], additionalProperties: false } } }, async request => skills.listCandidates(request.params.id));
  app.post<{ Params: { id: string }; Body: V1SkillReviewInput }>('/api/projects/:id/skills/review', { schema: { params: { type: 'object', properties: { id: identifier }, required: ['id'], additionalProperties: false }, body: ReviewInputSchema } }, async request => serial(request.params.id, async () => {
    requireIdle(request.params.id);
    const project = await snapshot(request.params.id);
    if (project.schemaVersion !== 1 || request.body?.candidate?.projectId !== project.id) throw new V1SkillError('INVALID_INPUT', 'Choose the originating idle V1 session for Skill review.');
    await assertRoleModels(project, ['theorist']);
    return skills.review(request.body, async context => {
      const session = await runtime.createSession({ id: `skill-review-${randomUUID()}`, projectId: project.id, loop: { researchLoopVersion: '1.0', workerProtocolVersion: '1.0' }, role: 'theorist', model: project.config.roleModels?.theorist ?? project.config.defaultModel, budget: project.config.roleBudget, context: { project: context.project } });
      try {
        const result = await runtime.invoke(session, { task: 'review', input: { project: context.project, methodReview: context,
          instruction: 'Review this one candidate research method against the independently assessed completed cases. Assess shared applicability, reproducibility, assumptions, limitations and scientific usefulness. This is method reuse review, not a new research round or a proof verdict. Endorse only by returning exactly this candidate as one experiences item with kind candidate_skill and unchanged context, lesson, limitations. Otherwise return no candidate_skill item. decision does not grant approval. Give the detailed approval/rejection reason in reason; preserve uncertainties in nextQuestions.' } }) as ReviewOutput;
        const endorsed = result.experiences?.some(item => item.kind === 'candidate_skill' && item.context === context.candidate.content.context && item.lesson === context.candidate.content.lesson && item.limitations === context.candidate.content.limitations) ?? false;
        return { approved: endorsed, reason: result.reason, limitations: [context.candidate.content.limitations, ...result.nextQuestions].slice(0, 8) };
      } finally { await runtime.closeSession(session); }
    });
  }));
  app.put<{ Params: { id: string }; Body: { enabled: boolean; expectedRevision: string } }>('/api/skills/v1/:id', { schema: { params: { type: 'object', properties: { id: identifier }, required: ['id'], additionalProperties: false }, body: { type: 'object', properties: { enabled: { type: 'boolean' }, expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['enabled', 'expectedRevision'], additionalProperties: false } } }, request => skills.setEnabled(request.params.id, request.body.enabled, request.body.expectedRevision));
}
