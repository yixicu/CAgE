import { interfaceVersion } from '../research/versions/v2/conditional-work.js';
import type { PossibleWay } from '../research/contracts/v2.js';
import { ProofContextSchema } from '../research/contracts/documents.js';
import { Type } from 'typebox';
import { GenerateWaysSchema, WaySchema, KnowledgeRoutingSchema, AnchorSchema } from '../research/versions/v2/schemas.js';
import type { EpochSnapshot } from '../research/contracts/v2.js';
import type { ChapterRef } from '../research/contracts/documents.js';
import { ContinuationSchema, type EndedAttempt } from '../research/contracts/review.js';
import { ChapterSelectionSchema, selectGrantedChapter } from './chapter-selection.js';

export type AttemptChapterIndex = Pick<EndedAttempt, 'id' | 'chapters'>;
export function continuationIndex(input: unknown): AttemptChapterIndex[] | undefined {
  const value = input as { attemptIndex?: AttemptChapterIndex[]; inheritedContext?: { attemptIndex?: AttemptChapterIndex[] } };
  if (!value?.attemptIndex && !value?.inheritedContext?.attemptIndex) return undefined;
  return [...(value.attemptIndex ?? []), ...(value.inheritedContext?.attemptIndex ?? [])];
}

export const ModuleContextSchema = Type.Object({ ...ProofContextSchema.properties, scope: Type.Literal('module') }, { additionalProperties: false });

/** Only transport identities are optional; scientific slots and checks stay unchanged. */
export const WaysWireSchema = Type.Object({ ...GenerateWaysSchema.properties,
  routing: Type.Optional(Type.Object({ ...KnowledgeRoutingSchema.properties,
    domains: { ...KnowledgeRoutingSchema.properties.domains, minItems: 0 },
    anchors: Type.Array(AnchorSchema, { maxItems: 32 }),
  }, { additionalProperties: false })),
  ways: Type.Array(Type.Object({ ...WaySchema.properties,
    proofContext: ModuleContextSchema,
    conditionalPremises: Type.Optional(Type.Array(Type.Object({ sourceWayId: Type.String({minLength:1}), sourceInterfaceId: Type.String({minLength:1}), statement: Type.Optional(Type.String({minLength:1})), version: Type.Optional(Type.String({minLength:1})), conditions: Type.Optional(ProofContextSchema.properties.conditions), symbols: Type.Optional(ProofContextSchema.properties.symbols) }, {additionalProperties:false}), {maxItems:32})),
    id: Type.Optional(WaySchema.properties.id),
    hypothesisRevision: Type.Optional(WaySchema.properties.hypothesisRevision),
    waySkillVersion: Type.Optional(WaySchema.properties.waySkillVersion),
    dependencyChapters: Type.Optional(Type.Array(ChapterSelectionSchema, { maxItems: 128 })),
    continuation: Type.Optional(Type.Object({ ...ContinuationSchema.properties, chapters: Type.Optional(Type.Array(ChapterSelectionSchema, { maxItems: 128 })) }, { additionalProperties: false })),
  }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });

export function bindWayEnvelope(value: unknown, snapshot: EpochSnapshot, adoptedPrerequisites?: readonly ChapterRef[], attempts?: readonly AttemptChapterIndex[]): unknown {
  if (!value || typeof value !== 'object' || !('ways' in value) || !Array.isArray(value.ways)) return value;
  const bound = structuredClone(value) as Record<string, unknown> & { ways: unknown[] };
  // Base guidance is host-owned, not scientific text for the model to transcribe.
  const routing = bound.routing as Record<string, unknown> | undefined;
  if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
    const anchors = snapshot.policy.anchors;
    const ids = new Set(anchors.map(anchor => anchor.id));
    const domainIds = new Set(anchors.flatMap(anchor => anchor.domainIds));
    for (const domain of snapshot.policy.domains) if (domainIds.has(domain.id) && domain.parentId) domainIds.add(domain.parentId);
    const domains = snapshot.policy.domains.filter(domain => domainIds.has(domain.id));
    if (Array.isArray(routing.anchors)) routing.anchors = [...structuredClone(anchors), ...routing.anchors.filter(anchor => !anchor || typeof anchor !== 'object' || !ids.has(anchor.id))];
    if (Array.isArray(routing.domains)) routing.domains = [...structuredClone(domains), ...routing.domains.filter(domain => !domain || typeof domain !== 'object' || !domainIds.has(domain.id))];
    const recommendation = routing.recommendation as Record<string, unknown> | undefined;
    if (recommendation && typeof recommendation === 'object') {
      if (Array.isArray(recommendation.anchorIds)) recommendation.anchorIds = [...new Set([...ids, ...recommendation.anchorIds])];
      if (Array.isArray(recommendation.domainIds)) recommendation.domainIds = [...new Set([...domainIds, ...recommendation.domainIds])];
    }
  }
  const result = { ...bound, ways: bound.ways.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object') return raw;
    const way = raw as Record<string, unknown>;
    const skill = snapshot.waySkills.find(skill => skill.id === way.waySkillId);
    if (adoptedPrerequisites && Array.isArray(way.dependencyChapters)) way.dependencyChapters = way.dependencyChapters.map(ref => {
      const granted = selectGrantedChapter(ref, adoptedPrerequisites);
      return granted ? { ...ref, ...granted } : ref;
    });
    const continuation = way.continuation as { parentAttemptId?: string; chapters?: unknown[] } | undefined;
    if (attempts && continuation && Array.isArray(continuation.chapters)) {
      const grants = attempts.filter(parent => parent.id === continuation.parentAttemptId).flatMap(parent => parent.chapters ?? []);
      continuation.chapters = continuation.chapters.map(ref => {
        const granted = selectGrantedChapter(ref, grants);
        return granted ? { ...(ref as object), ...granted } : ref;
      });
    }
    return { ...way, id: way.id ?? `${snapshot.id}_way_${index + 1}`,
      hypothesisRevision: way.hypothesisRevision ?? snapshot.hypothesisRevision,
      ...(way.waySkillVersion === undefined && skill ? { waySkillVersion: skill.version } : {}) };
  }) };
  const ways = result.ways as PossibleWay[];
  for (const way of ways) for (const item of Array.isArray(way?.proofInterfaces) ? way.proofInterfaces : []) {
    if (!item || typeof item !== 'object') continue;
    const version = interfaceVersion(way, item);
    if (item.version === undefined) item.version = version;
  }
  for (const way of ways) for (const premise of Array.isArray(way?.conditionalPremises) ? way.conditionalPremises : []) {
    if (!premise || typeof premise !== 'object') continue;
    if (!premise.sourceInterfaceId) continue;
    const source = ways.find(item => item?.id === premise.sourceWayId);
    const contract = Array.isArray(source?.proofInterfaces) ? source.proofInterfaces.find(item => item && item.id === premise.sourceInterfaceId) : undefined;
    if (!contract) continue;
    // Wrong supplied values remain wrong and are diagnosed; never silently repair stale identities.
    if (premise.statement === undefined) premise.statement = contract.statement;
    if (premise.version === undefined) premise.version = contract.version;
    if (premise.conditions === undefined) premise.conditions = structuredClone(contract.conditions);
    if (premise.symbols === undefined) premise.symbols = structuredClone(contract.symbols);
  }
  return result;
}
