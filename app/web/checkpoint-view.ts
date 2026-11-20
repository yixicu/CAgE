import { v0CheckpointPages } from './research-view-v0';
import { v21CheckpointPages } from './research-view-v21';
import { epochOutput } from '../src/presentation/checkpoint-output';
import type { ResearchProject } from './api';
import type { ResearchReceipt } from '../src/research/contracts/review';
export type ProofOutcome = 'progress' | 'partial' | 'refuted' | 'proved' | 'empirical-exclusion';
export const outcomeLabels: Record<ProofOutcome,string> = {progress:'In progress', partial:'Partial proof', refuted:'Refuted', proved:'Proof complete','empirical-exclusion':'Empirical exclusion'};
export interface CheckpointPage { id: string; number: number; label: string; content: string; time: string; hypothesis?: string; hypothesisRevision?: string; inputRevision?: string; outcome: ProofOutcome; outcomeLabel: string; interrupted?: boolean; reason?: string; inheritedSessionId?: string }
/** Scientific color never follows execution status or words in the summary. */
export function proofOutcome(receipt?: ResearchReceipt, partial = false): ProofOutcome {
  const proof = receipt?.review?.proof;
  if (receipt?.coverageComplete && proof?.rootClosed && proof.reproducible && proof.logicalRelation !== 'necessary_only') return proof.logicalRelation === 'counterexample' ? 'refuted' : 'proved';
  const unchanged = receipt?.review?.unchangedProof;
  const old = unchanged && receipt?.boundary.proofs?.find(p => p.ref.caseId === unchanged.caseId && p.ref.contentHash === unchanged.contentHash);
  if (receipt?.coverageComplete && old?.meta && old.meta.logicalRelation !== 'necessary_only') return old.meta.logicalRelation === 'counterexample' ? 'refuted' : 'proved';
  return partial ? 'partial' : 'progress';
}
export function checkpointPages(project?: ResearchProject): CheckpointPage[] {
  if (!project) return [];
  if (project.schemaVersion === 4) return v0CheckpointPages(project);
  if (project.schemaVersion === 3) return v21CheckpointPages(project);
  const records = project.schemaVersion === 2 ? project.epochs : project.rounds;
  const pages = records.filter(record => record.summary.trim() || record.completedAt || ('decision' in record && record.decision)).map(record => {
    const partial = 'tasks' in record ? record.tasks.some(task => record.committedTaskIds.includes(task.id) && task.result?.executionStatus === 'completed' && task.result.evidence === 'sufficient' && ['compatible','conditionally_compatible'].includes(task.result.conclusion || '') && task.result.derivationChain.length > 0) : project.results.some(result => record.branchIds.includes(result.branchId) && result.executionStatus === 'completed' && ['compatible','conditionally_compatible'].includes(result.conclusion || '') && !!(result.pathReport?.keySteps.length || result.derivationChain?.length));
    const outcome = proofOutcome(record.research,partial);
    const output = 'tasks' in record ? epochOutput(record) : {content:record.summary || 'No synthesis was saved for this round.',interrupted:false,reason:undefined};
    return { ...output, id:record.id, number:record.number, label:`${project.schemaVersion === 2 ? 'Epoch' : 'Round'} ${record.number}`, content:output.content, time:record.completedAt || '', outcome, outcomeLabel:outcomeLabels[outcome],
      ...('snapshot' in record ? {hypothesis:record.snapshot.hypothesis,hypothesisRevision:record.snapshot.hypothesisRevision,inputRevision:record.snapshot.inputRevision} : {hypothesisRevision:record.hypothesisRevision,inputRevision:record.inputRevision}) };
  }).sort((a,b)=>a.number-b.number);
  return pages.length ? pages : project.summary.trim() ? [{id:'latest',number:0,label:'Synthesis',content:project.summary,time:'',outcome:'progress',outcomeLabel:outcomeLabels.progress}] : [];
}
export function selectedCheckpoint(pages: CheckpointPage[],id?: string) { return pages.find(page=>page.id===id) || pages.at(-1); }
