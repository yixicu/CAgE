import { revisePreparedProblem } from '../research/versions/v2/preparation.js';
import { conditionalPlanIssues } from '../research/versions/v2/conditional-work.js';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import type { EpochSnapshot, PossibleWay } from '../research/contracts/v2.js';
import type { ResourceReadRef } from '../research/contracts/review.js';
import { WaySchema, KnowledgeRoutingSchema } from '../research/versions/v2/schemas.js';
import { logicalWayIssues, wayIssues } from '../research/versions/v2/ways.js';
import { applyKnowledgeRouting, type KnowledgeRoutingOutput } from '../research/versions/v2/routing.js';
import { continuationAllowed, declaredSkillsAreLoaded, evaluateDecision } from '../research/review.js';
import type { ChapterRef } from '../research/contracts/documents.js';
import { selectGrantedChapter } from './chapter-selection.js';
import type { AttemptChapterIndex } from './planning-wire.js';
import { stableHash } from '../learning/research-hash.js';

const canonicalWaySchema = { ...WaySchema, additionalProperties: true };
const premiseArray = WaySchema.properties.conditionalPremises as TSchema & {items:TSchema & {required?:string[]}};
const interfaceArray = WaySchema.properties.proofInterfaces as TSchema & {items:TSchema};
const premiseShape = premiseArray.items;
/** Only fields read by the existing relationship checker; incomplete host binding remains diagnosable. */
const relationWaySchema: TSchema = { type:'object', properties:{
  id:WaySchema.properties.id, hypothesisRevision:WaySchema.properties.hypothesisRevision, targetProposition:WaySchema.properties.targetProposition,
  proofContext:{type:'object',properties:{scope:{type:'string'}},additionalProperties:true},
  proofInterfaces:{...interfaceArray,items:{...interfaceArray.items,additionalProperties:true}},
  conditionalPremises:{...premiseArray,items:{...premiseShape,
    required:(premiseShape.required??[]).filter(field=>field!=='statement'),additionalProperties:true}},
},required:['id','hypothesisRevision'],additionalProperties:true };

/** Diagnose independent fields together; nothing is repaired or accepted here. */
export function planningIssues(value: unknown, snapshot: EpochSnapshot, schema: TSchema, resourceReads: readonly ResourceReadRef[], adoptedPrerequisites?: readonly ChapterRef[], attempts?: readonly AttemptChapterIndex[], workingRevisionAllowed = false): string[] {
  const issues = [...Value.Errors(schema, value)].map(error => `${error.instancePath || '/'}: ${error.message} ${JSON.stringify(error.params)}`);
  if (!value || typeof value !== 'object') return issues;
  const output = value as { workingRevision?: unknown; routing?: unknown; ways?: unknown[] };
  const local = structuredClone(snapshot);
  if (output.workingRevision !== undefined) {
    if (!workingRevisionAllowed) issues.push('/workingRevision: Available only when the unchanged prepared problem was reused without pending user input.');
    try { local.problem = revisePreparedProblem(local.problem, output.workingRevision); }
    catch (error) { issues.push(`/workingRevision: ${error instanceof Error ? error.message : 'Invalid working revision'}`); }
  }
  let routingValid = !snapshot.problem && !output.routing;
  if (!output.routing && snapshot.problem) issues.push('/routing: Prepared research must include routing before its ways.');
  if (output.routing && typeof output.routing === 'object' && 'planningChange' in output.routing) issues.push('/routing/planningChange: Do not change the prepared target during way generation.');
  // Unknown extra properties remain errors above, but do not hide inspectable science.
  if (Value.Check({ ...KnowledgeRoutingSchema, additionalProperties: true }, output.routing)) {
    try {
      local.strategy = applyKnowledgeRouting(local.policy, structuredClone(output.routing) as unknown as KnowledgeRoutingOutput, local.sources, local.userDomainPreferences);
      routingValid = true;
    } catch (error) { issues.push(`/routing: ${error instanceof Error ? error.message : 'Invalid routing'}`); }
  }
  const ids = new Set<string>(), keys = new Set<string>();
  for (const [index, raw] of (Array.isArray(output.ways) ? output.ways : []).entries()) {
    const prefix = `/ways/${index}`;
    const canonicalErrors = [...Value.Errors(canonicalWaySchema, raw)];
    issues.push(...canonicalErrors.map(error => `${prefix}${error.instancePath || ''}: ${error.message} ${JSON.stringify(error.params)}`));
    if (canonicalErrors.some(error => error.instancePath.startsWith('/conditionalPremises')))
      issues.push(`${prefix}/conditionalPremises: Invalid or missing conditional metadata after host binding. An absent hidden statement means the host could not bind a declared source interface. Explicitly declare scientifically supported source proofInterfaces or correct the source/interface reference; do not submit hidden statement/version/conditions/symbols or infer an interface from target/assignment text.`);
    if (!raw || typeof raw !== 'object') continue;
    const partial = raw as Partial<PossibleWay>;
    issues.push(...logicalWayIssues(partial, local).map(issue => `${prefix}: ${issue}`));
    if (typeof partial.id === 'string') { if (ids.has(partial.id)) issues.push(`${prefix}/id: Duplicate way identity.`); ids.add(partial.id); }
    if (typeof partial.dedupeKey === 'string') { if (keys.has(partial.dedupeKey)) issues.push(`${prefix}/dedupeKey: Duplicate way.`); keys.add(partial.dedupeKey); }
    if (!('proofContext' in raw) || !raw.proofContext) issues.push(`${prefix}/proofContext: Include task symbols, conditions and obligations.`);
    if (canonicalErrors.length) continue;
    const way = raw as unknown as PossibleWay;
    if (attempts && !continuationAllowed(way.continuation, attempts)) issues.push(`${prefix}/continuation: Select exact chapters only from the named ended parent in attemptIndex, with obstacle, newWork and explicit reuse/redo for chapters. Another parent or an adopted-prerequisite entry alone does not grant continuation access.`);
    if (attempts && way.continuation) {
      const grants = attempts.filter(parent => parent.id === way.continuation!.parentAttemptId).flatMap(parent => parent.chapters ?? []);
      if ((way.continuation.chapters ?? []).some(ref => !selectGrantedChapter(ref, grants))) issues.push(`${prefix}/continuation/chapters: Chapter identity must uniquely match the named parent catalog.`);
    }
    for (const ref of way.dependencyChapters ?? []) {
      if (!way.dependencyTaskIds.includes(ref.attemptId) || adoptedPrerequisites && !adoptedPrerequisites.some(saved => stableHash(saved) === stableHash(ref))) {
        issues.push(`${prefix}/dependencyChapters: ${ref.chapterId} is not an exact authorized prerequisite with a declared dependencyTaskId. Select exact entries only from input.adoptedPrerequisites; other saved chapters are not adopted and must not be used as accepted premises.`);
      }
    }
    issues.push(...wayIssues(way, local, routingValid).map(issue => `${prefix}: ${issue}`));
    if (local.researchBoundary) {
      try { evaluateDecision(local.researchBoundary, way.scores ?? {}, way.rationales ?? {}); }
      catch (error) { issues.push(`${prefix}/scores: ${error instanceof Error ? error.message : 'Invalid factor scores'}`); }
      const reads = [...(local.loadedResources ?? []), ...resourceReads];
      if (!declaredSkillsAreLoaded(way.skillRefs ?? [], local.researchBoundary, reads)) issues.push(`${prefix}/skillRefs: Use only actually read method-skill or failure-skill versions, not Strategy references.`);
    }
  }
  if (Array.isArray(output.ways) && output.ways.every(way => Value.Check(relationWaySchema, way))) issues.push(...conditionalPlanIssues(output.ways as unknown as PossibleWay[]));
  return [...new Set(issues)];
}
