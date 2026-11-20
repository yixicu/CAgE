import type { EpochRecord } from '../research/contracts/v2.js';

/** Display only: execution failures never become scientific conclusions. */
export function executionExplanation(error: string): string {
  if (/INVALID_OUTPUT|validation failure|synthesis was unavailable|invalid json/i.test(error)) return 'The model response could not be read completely. Saved findings remain available; no final proof was accepted.';
  if (/budget|token|limit exceeded/i.test(error)) return 'The call reached its resource limit. Saved findings remain available.';
  if (/timeout|timed out/i.test(error)) return 'The model did not finish within the time limit. Saved findings remain available.';
  if (/interrupt|abort/i.test(error)) return 'The call was interrupted. Saved findings remain available.';
  return error;
}

export function epochOutput(epoch: EpochRecord): { content: string; interrupted: boolean; reason: string } {
  const interrupted = /^(?:Theorist synthesis was unavailable\.|Recovered factual partial record\.)/.test(epoch.summary);
  const reason = executionExplanation(epoch.reason);
  if (!interrupted && epoch.summary.trim()) return {content: epoch.summary, interrupted: false, reason};
  const results = epoch.tasks.filter(task => task.result && epoch.committedTaskIds.includes(task.id));
  const proof = results.map(task => {
    const result = task.result!;
    if (result.executionStatus !== 'completed') return `### ${task.way.question}\n\n${executionExplanation(result.errorSummary || 'This exploration did not finish. No scientific verdict was inferred.')}`;
    const report = result.pathReport;
    return [`### ${task.way.question}`, '**Worker finding · awaiting Theorist synthesis**', report?.result,
      ...(report?.keySteps.length ? report.keySteps : result.derivationChain),
      ...[...new Set([...result.assumptions, ...(report?.conditions || []).filter(condition => !result.assumptions.includes(condition))])].map(text => `- Condition: ${text}`)].filter(Boolean).join('\n\n');
  }).join('\n\n');
  const gaps = [...new Set(results.flatMap(task => [...task.result!.unresolvedQuestions, ...task.result!.missingEvidence, ...(task.result!.pathReport?.obstacles || [])]))];
  return {interrupted: true, reason,
    content: `## Summary\nThe Theorist did not complete a validated synthesis. ${results.some(task => task.result?.executionStatus === 'completed') ? 'Saved Worker findings are shown below for inspection.' : 'No completed proof is available from this epoch.'}\n\n## Proof\n${proof || 'No completed Worker findings were saved.'}\n\n## Restriction\n${reason}\n\nThe root hypothesis has not been confirmed by a completed Theorist review.${gaps.length ? '\n\n'+gaps.map(text => '- '+text).join('\n') : ''}\n\nInspect these findings before continuing or modifying the hypothesis.`};
}

/** V2.1 uses reviewed original-answer references, never legacy synthesis fields. */
export function epochOutputV21(epoch: import('../research/contracts/v21.js').EpochRecordV21): { content: string; interrupted: boolean; reason: string } {
  const reason = executionExplanation(epoch.reason);
  if(epoch.optionalFlow){const f=epoch.optionalFlow,a=f.artifacts.find(a=>a.id===f.selectedArtifactId),valid=a?.qualification==='valid'&&a.acceptedOutcome?.scope==='root'&&f.archives.some(r=>r.artifactId===a.id&&r.status==='saved'&&JSON.stringify([r.selection.artifact.acceptedOutcome,r.selection.artifact.adoptionReason,r.selection.artifact.judgment])===JSON.stringify([a.acceptedOutcome,a.adoptionReason,a.judgment]))&&!f.conflictArtifactIds.length;return {reason,interrupted:epoch.decision==='stop',content:[f.conflictArtifactIds.length?'Same-root opposing claims require review.':valid?`Qualified ${a.authorRole} original proof: ${a.acceptedOutcome?.reason}`:epoch.calls.some(c=>c.captured)||f.artifacts.length?'Original saved; completion unassessed or open. No qualified root proof is archived.':'No qualified root proof is archived.',...f.artifacts.map(a=>`${a.authorRole}: ${a.qualification}; ${a.technical.executionStatus}/${a.technical.completeness}. ${a.route.description}`),'Exact unchanged originals and alternate proof archives remain available in Ways · Questions.',reason].join('\n\n')};}
  const interrupted = !epoch.review || epoch.tasks.some(task => task.state === 'interrupted' || task.state === 'failed');
  const summary = epoch.check?.summary;
  if (summary?.trim()) return { content: summary, interrupted, reason };
  const decisions = epoch.review?.decisions ?? [];
  const findings = decisions.map(decision => [
    `### ${decision.answerId}`,
    `Review: ${decision.status}; result: ${decision.resultKind}.`,
    decision.conclusion,
    ...decision.conditions.map(condition => `- Condition: ${condition}`),
    decision.reason,
  ].filter(Boolean).join('\n\n'));
  const saved = epoch.archives.filter(receipt => receipt.status === 'saved');
  return { interrupted, reason, content: [
    '## Summary',
    epoch.review ? 'The recorded interface review is shown below. Inspect the immutable original answers for their derivations.' : 'No completed Theorist review is available. Saved execution output is not an accepted scientific conclusion.',
    '## Proof',
    findings.join('\n\n') || 'No reviewed finding is available.',
    '## Restriction',
    reason,
    saved.length ? `${saved.length} independently closed Way archive(s) were saved.` : 'No completed root-proof archive is recorded for this epoch.',
  ].filter(Boolean).join('\n\n') };
}
