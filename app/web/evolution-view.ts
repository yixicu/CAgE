import type { EvolutionCaseView, EvolutionRequest, EvolutionOperationView } from './api';
import type { GlobalEvolutionState, ResearchProjectV2 } from '../src/research/contracts/v2';

export type CaseSelection = Record<string, 'training' | 'held_out' | ''>;
export function selectedCases(cases: readonly EvolutionCaseView[], selection: CaseSelection, target: EvolutionRequest['target']) {
  const eligible = cases.filter(item => (target === 'policy' ? item.reviewedPolicyTraceCount + (item.reviewedAuditCount || 0) : item.reviewedWaySkillTraceCount) > 0);
  return {
    caseIds: eligible.filter(item => selection[item.id]).map(item => item.id),
    heldOutCaseIds: eligible.filter(item => selection[item.id] === 'held_out').map(item => item.id),
    trainingIds: eligible.filter(item => selection[item.id] === 'training').map(item => item.id),
  };
}
export function approvedVersions(state: GlobalEvolutionState | undefined, target: EvolutionRequest['target']) {
  return [...new Set(state?.history.filter(item => item.review.target === target && item.review.action === 'approve').map(item => item.review.candidateVersion) || [])];
}
const operations = new Map<string, string>();
const key = (projectId: string) => `carnot.evolution.operation.${projectId}`;
/** Persist only an opaque request ID, never credentials or research content. */
export function rememberOperation(projectId: string, operationId: string): void {
  operations.set(projectId, operationId);
  try { sessionStorage.setItem(key(projectId), operationId); } catch { /* In-memory tracking still survives view navigation. */ }
}
export function rememberedOperation(projectId: string): string | undefined {
  try { return operations.get(projectId) || sessionStorage.getItem(key(projectId)) || undefined; } catch { return operations.get(projectId); }
}
export function forgetOperation(projectId: string): void {
  operations.delete(projectId);
  try { sessionStorage.removeItem(key(projectId)); } catch { /* Storage may be disabled. */ }
}
/** Outcome reconciliation is strictly read-only; never retry POST or allocate another ID. */
export async function checkRememberedOperation(projectId: string, query: (projectId: string, operationId: string) => Promise<EvolutionOperationView>): Promise<EvolutionOperationView | undefined> {
  const operationId = rememberedOperation(projectId);
  return operationId ? query(projectId, operationId) : undefined;
}

export function evolutionScope(kind: 'project' | 'global' | 'domain', projectId: string, domainId: string): string {
  return kind === 'project' ? `project:${projectId}` : kind === 'global' ? 'global' : domainId ? `domain:${domainId}` : '';
}

export function availableScopeDomains(project: ResearchProjectV2): string[] {
  const policy = project.policies.filter(item => item.effectiveFromEpoch <= project.epoch + 1).at(-1);
  return [...new Set([...(policy?.domains.map(domain => domain.id) || []), ...project.epochs.filter(epoch => epoch.completedAt && epoch.snapshot.hypothesisRevision === project.hypothesisRevision).flatMap(epoch => epoch.snapshot.strategy.domains.map(domain => domain.id))])];
}
