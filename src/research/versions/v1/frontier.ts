import { parseCandidate, ValidationError } from './schemas.js';
import type { Criterion, FrontierCandidate, FrontierItem, FrontierPolicy, ResearchRole, Weights } from '../../contracts/v1.js';
import { evaluateDecision } from '../../review.js';
export const BASELINE_WEIGHTS: Readonly<Weights> = Object.freeze({ M: 0.35, R: 0.25, D: 0.25, N: 0.10, E: 0.05 });
export const CRITERIA = ['M', 'R', 'D', 'N', 'E'] as const;
const EPSILON = 1e-9;
export function validateWeights(weights: Weights): void {
  if (Object.keys(weights).length !== 5 || CRITERIA.some((key) => !Number.isFinite(weights[key]) || weights[key] < BASELINE_WEIGHTS[key] * .9 - EPSILON || weights[key] > BASELINE_WEIGHTS[key] * 1.1 + EPSILON) || Math.abs(CRITERIA.reduce((sum, key) => sum + weights[key], 0) - 1) > EPSILON) throw new ValidationError('relative ±10% normalized frontier weights');
}
export function updateWeightPolicy(current: FrontierPolicy, weights: Weights, role: ResearchRole, moderatorEnabled: boolean, round: number, reason: string, applicability: string): FrontierPolicy {
  if (role !== 'moderator' || !moderatorEnabled) throw new Error('Only an enabled Moderator may update frontier weights.');
  validateWeights(weights);
  if (!reason.trim() || !applicability.trim()) throw new ValidationError('weight change reason and applicability');
  return { weights: { ...weights }, version: current.version + 1, effectiveFromRound: round + 1, changeReason: reason, changedBy: 'moderator', applicability };
}
export const normalizeDirection = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const division = (item: FrontierCandidate) => item.wayId&&item.assignment?normalizeDirection(item.assignment):'';
const candidateKey = (item: FrontierCandidate) => [normalizeDirection(item.dedupeKey),division(item)].join(':');
const signature = (item: FrontierCandidate) => [normalizeDirection(item.question), normalizeDirection(item.targetTheory ?? ''), item.mode, [...item.assumptions].map(normalizeDirection).sort().join('|'),division(item)].join(':');
export function rankFrontier(candidates: FrontierCandidate[], existing: FrontierItem[], policy: FrontierPolicy, hypothesisRevision: string): FrontierItem[] {
  if (!policy.boundary) validateWeights(policy.weights);
  const allIds = new Set(existing.map((item) => item.id));
  const scoped = existing.filter((item) => item.hypothesisRevision === hypothesisRevision);
  const keys = new Set(scoped.map(candidateKey));
  const directions = new Set(scoped.map(signature));
  const result: FrontierItem[] = [];
  for (const raw of candidates) {
    const item = parseCandidate(raw);
    const key = candidateKey(item);
    const continuation=Boolean(item.continuation?.obstacle.trim()&&item.continuation?.newWork.trim());
    if (!normalizeDirection(item.dedupeKey) || allIds.has(item.id) || !continuation&&(keys.has(key) || directions.has(signature(item)))) continue;
    if (item.exceptionReason !== undefined && !item.exceptionReason.trim()) throw new ValidationError('documented high-value exception rationale');
    allIds.add(item.id); keys.add(key); directions.add(signature(item));
    const priority = policy.boundary ? evaluateDecision(policy.boundary,item.scores,item.rationales) : CRITERIA.reduce((sum, key: Criterion) => sum + policy.weights[key] * item.scores[key], 0);
    result.push({ ...item, priority, state: item.allocation==='defer'?'deferred':'pending', hypothesisRevision });
  }
  return result.sort(compareFrontier);
}
export function compareFrontier(a: FrontierItem, b: FrontierItem): number { return Number(Boolean(b.exceptionReason)) - Number(Boolean(a.exceptionReason)) || b.priority - a.priority || a.id.localeCompare(b.id); }
