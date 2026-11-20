import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AnyAgentSessionSpec } from '../research/contracts/loop.js';
import { endedAttempts as v1Attempts } from '../research/versions/v1/engine.js';
import { endedAttempts as v2Attempts } from '../research/versions/v2/engine.js';
import type { InheritedResearchView } from '../research/contracts/lineage.js';
import type { ResearchLibrary } from '../learning/research-library.js';
import { normalizeTags } from '../learning/research-data.js';

const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
/** Exact frozen read grants. No arbitrary paths, foreign exploration, or mutation tools. */
export function researchMemoryTools(spec: AnyAgentSessionSpec, library: ResearchLibrary, inherited?: InheritedResearchView): ToolDefinition[] {
  if ('contractVersion' in spec && (spec.contractVersion === '2.1' || spec.contractVersion === 'v0-test-1')) return [];
  if (spec.role !== 'theorist' || !('project' in spec.context)) return [];
  const project = spec.context.project;
  const attempts = project.schemaVersion === 1 ? v1Attempts(project) : v2Attempts(project);
  const inheritedAttempts = structuredClone(inherited?.attempts ?? []);
  const boundary = 'snapshot' in spec.context ? spec.context.snapshot.researchBoundary : spec.context.researchBoundary;
  const refs = structuredClone([...(boundary?.skills ?? []), ...(boundary?.strategies ?? [])].filter(meta => meta.enabled && meta.status === 'valid'));
  const proofs = structuredClone(boundary?.proofs ?? []);
  for (const ref of inherited?.proofs ?? []) if (!proofs.some(proof => proof.ref.caseId === ref.caseId && proof.ref.revision === ref.revision)) proofs.push({ ref: structuredClone(ref), summary: '' });
  const catalog = structuredClone(Object.values(library.snapshot().resources).filter(meta => meta.enabled && meta.status === 'valid' && (project.schemaVersion === 2 || meta.kind !== 'specific-strategy')));
  const resources = library.frozenResourceReader([...catalog, ...refs], { role: 'theorist', sessionId: project.id, loopVersion: project.schemaVersion });
  return [
    defineTool({ name: 'read_session_attempt', label: 'Read research path', description: 'Expand one exact earlier path from the own or explicitly inherited frozen attempt index. Inherited paths remain parent-owned context, never new child attempts or learning evidence.',
      parameters: Type.Object({ id: Type.String(), version: Type.String() }, { additionalProperties: false }),
      execute: async (_id, ref) => {
        const own = attempts.find(attempt => attempt.id === ref.id && attempt.version === ref.version);
        if (own) return response(own);
        const found = inheritedAttempts.find(attempt => attempt.id === ref.id && attempt.version === ref.version);
        if (!found) throw new Error('Attempt is outside the frozen session grants.');
        return { ...response(found), details: { inheritedAttemptRef: { id: found.id, version: found.version } } };
      },
    }),
    defineTool({ name: 'read_research_resource', label: 'Read research guidance', description: 'Read a Skill or Specific Strategy from the exact delivered research catalog. Guidance is conditional, not a theorem.',
      parameters: Type.Object({ id: Type.String(), version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
      execute: async (_id, ref) => {
        if (!refs.some(meta => meta.id === ref.id && meta.version === ref.version)) throw new Error('Resource is outside the delivered catalog.');
        const resource = await resources.read(ref);
        return { ...response(resource), details: { resourceRef: { ...ref, kind: resource.meta.kind } } };
      },
    }),
    defineTool({ name: 'search_research_resources', label: 'Find research guidance', description: 'Find up to twelve Skill or Specific Strategy descriptions by dimensioned subject/specialization/method tags, then read relevant exact bodies. This searches the catalog frozen for this session invocation, not exploration history.',
      parameters: Type.Object({ tags: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }),
      execute: async (_id, { tags }) => {
        const normalized = normalizeTags(tags);
        const score = (meta: typeof catalog[number]) => meta.tags.filter(tag => normalized.includes(tag)).length;
        const found = catalog.filter(meta => score(meta) > 0).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, 12);
        for (const meta of found) if (!refs.some(ref => ref.id === meta.id && ref.version === meta.version)) refs.push(meta);
        return response(found);
      },
    }),
    defineTool({ name: 'read_final_proof', label: 'Read final proof', description: 'Expand the exact archived proof behind a supplied outline. This does not grant exploration or source-file access.',
      parameters: Type.Object({ caseId: Type.String(), revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
      execute: async (_id, ref) => { const found = proofs.find(proof => proof.ref.caseId === ref.caseId && proof.ref.revision === ref.revision); if (!found) throw new Error('Proof is outside the frozen outlines.'); return { ...response(await library.proofReader(proofs.map(proof => proof.ref)).read(found.ref)), details: { proofRef: found.ref } }; },
    }),
    defineTool({ name: 'search_final_proofs', label: 'Find final proofs', description: 'Find at most eight final-proof outlines by subject/specialization/method tags. Never returns exploratory branches or private failures.',
      parameters: Type.Object({ tags: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }),
      execute: async (_id, { tags }) => {
        const found = await library.searchProofOutlines(tags);
        for (const item of found) if (!proofs.some(proof => proof.ref.caseId === item.ref.caseId && proof.ref.revision === item.ref.revision)) proofs.push({ ref: structuredClone(item.ref), summary: item.summary });
        return response(found);
      },
    }),
  ];
}
