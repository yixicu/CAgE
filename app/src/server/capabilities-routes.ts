import type { FastifyInstance } from 'fastify';
import type { AnyResearchProject } from '../research/contracts/loop.js';
import { CapabilityError, type CapabilityManager } from './capabilities.js';
import type { CapabilityUpdate } from './capabilities-types.js';

/** Inherits the application's local-origin/request-token hooks; no provider or publication routes. */
export function registerCapabilityRoutes(app: FastifyInstance, capabilities: CapabilityManager, snapshot: (id: string) => Promise<AnyResearchProject>, changed: () => void): void {
  const projectId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };
  app.get<{ Querystring: { projectId?: string } }>('/api/capabilities', { schema: { querystring: { type: 'object', properties: { projectId }, additionalProperties: false } } }, async (request, reply) => {
    try { return await capabilities.view(request.query.projectId ? await snapshot(request.query.projectId) : undefined); }
    catch (error) { if (error instanceof CapabilityError) return reply.status(error.status).send({ error: error.code, message: error.message }); throw error; }
  });
  app.put<{ Body: CapabilityUpdate }>('/api/capabilities', { schema: { body: { type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: { expectedRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' }, projectId, key: { type: 'string', minLength: 1, maxLength: 600 }, enabled: { type: 'boolean' }, reset: { const: true } }, oneOf: [{ required: ['key', 'enabled'], not: { required: ['reset'] } }, { required: ['reset'], not: { anyOf: [{ required: ['key'] }, { required: ['enabled'] }] } }] } } }, async (request, reply) => {
    try { const result = await capabilities.update(request.body, request.body.projectId ? await snapshot(request.body.projectId) : undefined); changed(); return result; }
    catch (error) { if (error instanceof CapabilityError) return reply.status(error.status).send({ error: error.code, message: error.message }); throw error; }
  });
}
