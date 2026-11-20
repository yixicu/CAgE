import type { EpochSnapshot, PossibleWay, WaySkill } from '../../contracts/v2.js';
import { ValidationError } from '../../contracts/errors.js';
export function createWaySkills(): WaySkill[] { return (['serial','parallel','necessary','sufficient','equivalent','counterexample'] as const).map(method => ({ id: `base-${method}`, version: '1', scope: 'local', method, description: `Theorist ${method} anchor composition with explicit assumptions and implication direction.`, preference: 0.5, effectiveFromEpoch: 1, evidenceTraceIds: [], limitations: ['Method selection heuristic, not a theorem or guarantee.'] })); }
export function logicalWayIssues(way: Partial<PossibleWay>, snapshot: EpochSnapshot): string[] {
  const issues: string[] = [];
  if (typeof way.hypothesisRevision === 'string' && way.hypothesisRevision !== snapshot.hypothesisRevision) issues.push('V2 stale way hypothesis');
  const skill = snapshot.waySkills.find(s => s.id === way.waySkillId && s.version === way.waySkillVersion && s.effectiveFromEpoch <= snapshot.number);
  if (!skill && typeof way.waySkillId === 'string' && typeof way.waySkillVersion === 'string') issues.push('V2 unknown WaySkill version');
  const expected = { necessary: 'hypothesis_implies_target', sufficient: 'target_implies_hypothesis', equivalent: 'equivalent', counterexample: 'counterexample' } as const;
  if (skill && skill.method in expected && typeof way.implication === 'string' && way.implication !== expected[skill.method as keyof typeof expected]) issues.push(`V2 implication direction for ${way.id}: ${skill.id} (${skill.method}) requires ${expected[skill.method as keyof typeof expected]}, received ${way.implication}. Select the constructor matching the intended scientific implication; do not reverse the logical relation merely to fit a skill`);
  return issues;
}
export function wayIssues(way: PossibleWay, snapshot: EpochSnapshot, routingValid = true): string[] {
  const issues = logicalWayIssues(way, snapshot);
  if (way.dependencyChapters?.length && (!way.dependencyUse?.reuse.trim() || !way.dependencyUse.recheck.trim())) issues.push('Selected dependencyChapters require dependencyUse.reuse and dependencyUse.recheck: state the reusable claims and conditions/conventions to verify before Worker dispatch.');
  const skill = snapshot.waySkills.find(s => s.id === way.waySkillId && s.version === way.waySkillVersion && s.effectiveFromEpoch <= snapshot.number);
  if (routingValid && skill?.applicability && (!way.domainIds.some(id => skill.applicability!.domainIds.includes(id)) || skill.applicability.anchorTags.length && !snapshot.strategy.anchors.some(a => way.anchorIds.includes(a.id) && a.tags.some(tag => skill.applicability!.anchorTags.includes(tag))))) issues.push('V2 WaySkill applicability');
  const anchors = new Set(snapshot.strategy.anchors.map(a => a.id));
  if (routingValid && (!way.anchorIds.length || way.anchorIds.some(id => !anchors.has(id)) || way.domainIds.some(id => !snapshot.strategy.domains.some(d => d.id === id)))) issues.push('V2 ungrounded way');
  if (way.anchorConnections.some(c => c.from===c.to || !way.anchorIds.includes(c.from) || !way.anchorIds.includes(c.to))) issues.push('V2 anchor connection membership');
  if (way.mode === 'challenge' && !way.changedPremises.length) issues.push('V2 Challenge changed premises');
  if(skill?.method==='parallel'&&(way.anchorConnections.filter(c=>c.kind==='parallel').length<2||new Set(way.anchorConnections.filter(c=>c.kind==='parallel').map(c=>c.from)).size<2))issues.push('V2 independent parallel anchor inputs');
  if (skill && (skill.method === 'serial' || skill.method === 'parallel') && !way.anchorConnections.some(c => c.kind === skill.method)) issues.push('V2 explicit anchor composition');
  return issues;
}
export function validateWay(way: PossibleWay, snapshot: EpochSnapshot): PossibleWay {
  const issues = wayIssues(way, snapshot);
  if (issues.length) throw new ValidationError(issues.join('; '));
  return structuredClone(way);
}
