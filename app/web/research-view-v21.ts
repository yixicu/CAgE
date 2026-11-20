import type { ResearchProjectV21 } from '../src/research/contracts/v21';
import type { CheckpointPage, ProofOutcome } from './checkpoint-view';
import { currentResearchNumber } from './research-scope';


export function v21CurrentOptionalArchive(flow:NonNullable<import('../src/research/contracts/v21').InFlightEpochV21['optionalFlow']>,artifact:import('../src/research/versions/v21/optional-types').OptionalProofArtifactV21) {
  // Stricter than a mere artifact ID: an earlier saved judgment is not a receipt for its replacement.
  const evidence=(a:typeof artifact)=>JSON.stringify([a.acceptedOutcome,a.adoptionReason,a.judgment]);
  return flow.archives.findLast(r=>r.artifactId===artifact.id&&r.status==='saved'&&evidence(r.selection.artifact)===evidence(artifact));
}

/** Read-only schema3 projections. Neither technical completion nor pruning is adoption. */
export function v21Epoch(project: ResearchProjectV21, number = currentResearchNumber(project)) {
  return (project.activeEpoch?.epoch === number ? project.activeEpoch : undefined)
    ?? project.epochs.find(epoch => epoch.epoch === number);
}
export function v21CheckpointPages(project: ResearchProjectV21): CheckpointPage[] {
  const active=project.activeEpoch;
  const records=active?.optionalFlow&&!project.epochs.some(e=>e.epoch===active.epoch)
    ?[...project.epochs,{...active,id:active.snapshot.id,completedAt:'',decision:'pause' as const,reason:'Research in progress; retained originals do not imply root completion.'}]:project.epochs;
  return records.map(saved => {
    const epoch=project.activeEpoch?.epoch===saved.epoch?{...saved,...project.activeEpoch}:saved;
    if(epoch.optionalFlow){
      const flow=epoch.optionalFlow, selected=flow.artifacts.find(a=>a.id===flow.selectedArtifactId);
      const valid=selected?.qualification==='valid'&&selected.acceptedOutcome?.scope==='root'&&!!v21CurrentOptionalArchive(flow,selected)&&!flow.conflictArtifactIds.length;
      const result=valid?selected.acceptedOutcome:undefined;
      const outcome:ProofOutcome=result?.resultKind==='empirical-exclusion'?'empirical-exclusion':result?.resultKind==='valid-refutation'?'refuted':result?.resultKind==='supported-result'?'proved':'progress';
      const outcomeLabel=outcome==='empirical-exclusion'?'Empirical exclusion · Theorist assessment'
        :outcome==='refuted'?(result?.refutationKind==='contradiction'?'Contradiction':result?.refutationKind==='counterexample'?'Counterexample':'Refuted')+' · Theorist assessment'
        :outcome==='proved'?'Proof complete · Theorist assessment':flow.conflictArtifactIds.length?'Needs review':'Open';
      const content=[flow.conflictArtifactIds.length?'Conflicting same-root claims: prior proof needs review.':valid?`Default proof: ${selected.authorRole} · ${selected.route.description}`:epoch.calls.some(c=>c.captured)||flow.artifacts.length?'Original saved; completion unassessed or open until an exact root archive is qualified.':'No qualified root proof yet.',...flow.artifacts.map(a=>`${a.authorRole}: ${a.route.description} · ${a.qualification} · ${a.technical.executionStatus}/${a.technical.completeness}`),'Read exact originals and retained alternative proofs in Ways · Questions.'].join('\n\n');
      return {id:epoch.id,number:epoch.epoch,label:`Epoch ${epoch.epoch}`,content,time:epoch.completedAt,hypothesis:epoch.snapshot.root.originalText,hypothesisRevision:epoch.snapshot.root.revision,inputRevision:epoch.snapshot.inputRevision,outcome,outcomeLabel,interrupted:epoch.decision==='stop',reason:epoch.reason};
    }
    const closures = epoch.review?.closures ?? [];
    const outcome: ProofOutcome = closures.some(closure => closure.resultKind === 'valid-refutation') ? 'refuted'
      : closures.length ? 'proved' : epoch.review?.decisions.some(decision => decision.status === 'adopted') ? 'partial' : 'progress';
    const archives = epoch.archives.map(archive => `Way ${archive.wayId}: archive ${archive.status}`).join('\n');
    // This is the check's own recorded summary, never a synthesized proof body.
    const content = ['Review summary (original Worker answers are available in Ways · Questions)', epoch.check?.summary || epoch.reason, archives].filter(Boolean).join('\n\n');
    return { id: epoch.id, number: epoch.epoch, label: `Epoch ${epoch.epoch}`, content,
      time: epoch.completedAt, hypothesis: epoch.snapshot.root.originalText,
      hypothesisRevision: epoch.snapshot.root.revision, inputRevision: epoch.snapshot.inputRevision,
      outcome, outcomeLabel: outcome === 'refuted' ? 'Refuted' : outcome === 'proved' ? 'Proof complete' : outcome === 'partial' ? 'Partial proof' : 'In progress',
      interrupted: epoch.decision === 'stop', reason: epoch.reason };
  }).sort((a, b) => a.number - b.number);
}
export function v21Directions(project: ResearchProjectV21, number = currentResearchNumber(project)) {
  const epoch = v21Epoch(project, number);
  if(epoch?.optionalFlow)return [...epoch.optionalFlow.artifacts.map(a=>({id:a.id,agent:a.authorRole,label:`${a.authorRole} · ${a.route.description}`,question:epoch.snapshot.root.originalText,target:a.route.reason,conditions:a.operationRevision==='v21-operation-9'?a.root.conditions:a.control.outcome.conditions??[],exploring:false,status:`${a.technical.executionStatus} · ${a.qualification}${a.exposureArtifactIds.length?' · informed by delivered evidence':''}`})),...epoch.optionalFlow.branches.filter(b=>!b.artifactId).map(b=>({id:b.id,agent:b.kind,label:`${b.kind} · ${b.frozen.way.direction}`,question:b.frozen.question.question,target:b.frozen.question.purpose,conditions:b.frozen.question.conditions,exploring:b.state==='running',status:b.state}))];
  return (epoch?.tasks ?? []).flatMap(task => {
    const question = task.frozen?.question ?? project.questions.find(question => question.id === task.questionId && question.revision === task.questionRevision);
    if (!question) return [];
    const way = task.frozen?.way ?? project.ways.find(way => way.id === question.wayId);
    const answer = task.answer;
    const review = answer && epoch?.review?.decisions.find(decision => decision.answerId === answer.id);
    return [{ id: task.id, label: `${way?.direction || question.wayId} · Q${question.order}`, question: question.question,
      target: question.purpose, conditions: question.conditions,
      exploring: project.status === 'running' && number === currentResearchNumber(project) && task.state === 'running',
      status: [task.state, answer ? `${answer.executionStatus} · ${answer.completeness}` : '', review ? `Review: ${review.status}` : 'Not adopted', way ? `Way: ${way.utilityStatus}` : ''].filter(Boolean).join(' · ') }];
  });
}
export function v21LatestReview(project: ResearchProjectV21, answerId: string) {
  let decision: import('../src/research/contracts/v21').ReviewDecisionV21 | undefined;
  for (const receipt of [...project.reviews, ...(project.activeEpoch?.review ? [project.activeEpoch.review] : [])]) {
    if (decision && receipt.invalidatedAnswerIds.includes(answerId)) decision = { ...decision, status: 'needs_review' };
    const updated = receipt.decisions.find(item => item.answerId === answerId);
    if (updated) decision = updated;
  }
  return decision;
}

export function v21OptionalEpochs(project:ResearchProjectV21){return [...new Map([...project.epochs,...(project.activeEpoch?[project.activeEpoch]:[])].map(e=>[e.snapshot.id,e])).values()].filter(e=>e.optionalFlow);}

/** Choose only an owned, same-root immutable reference. Fetch uses the existing hash-verifying raw API. */
export function v21DefaultOptionalOriginal(project:ResearchProjectV21, number?:number) {
  const epoch=number===undefined?v21OptionalEpochs(project).at(-1):v21OptionalEpochs(project).find(e=>e.epoch===number),flow=epoch?.optionalFlow;
  if(!epoch||!flow)return;
  const owned=(ref:import('../src/research/contracts/v21').RawAnswerRefV21)=>ref.projectId===project.id&&ref.owner===project.id&&ref.hypothesisId===epoch.snapshot.root.hypothesisId&&ref.hypothesisRevision===epoch.snapshot.root.revision&&ref.byteLength>0;
  const selected=flow.artifacts.find(a=>a.id===flow.selectedArtifactId);
  const archive=selected&&owned(selected.originalRef)&&selected.qualification==='valid'&&selected.acceptedOutcome?.scope==='root'&&!flow.conflictArtifactIds.length?v21CurrentOptionalArchive(flow,selected):undefined;
  if(archive&&archive.selection.projectId===project.id)return {artifactId:archive.artifactId,epochId:epoch.snapshot.id,kind:'archive' as const,id:archive.operationId,key:`${project.id}:archive:${archive.operationId}`,label:'Archived original · model-assessed root completion'};
  // Prefer the latest main answer over an auxiliary result, without hiding retained Worker originals.
  const calls=[...epoch.calls].reverse();
  for(const call of [...calls.filter(c=>c.task==='v21_theorist'),...calls.filter(c=>c.task!=='v21_theorist')]) {
    const artifact=flow.artifacts.find(a=>a.originalRef.callId===call.id),result=call.result as import('../src/research/versions/v21/optional-types').OptionalTheoristResultV21|undefined,ref=artifact?.originalRef??call.captured?.originalRef??result?.originalRef;
    if(!ref||ref.callId!==call.id||!owned(ref))continue;
    if(call.operation?.revision==='v21-operation-9'&&(ref.inputHash!==call.operation.inputHash||ref.epochId!==epoch.snapshot.id))continue;
    if(!artifact&&!call.captured&&(!call.operation||ref.inputHash!==call.operation.inputHash))continue;
    const outcome=artifact?.acceptedOutcome??artifact?.control.outcome;
    const label=ref.completeness!=='complete'?'Partial original saved · completion unassessed':flow.conflictArtifactIds.length?'Original saved · conflicting claims require review':!outcome?'Original saved · completion unassessed':outcome.resultKind==='open'||outcome.gaps.length?'Original saved · open result':outcome.scope==='local'?'Original saved · local result, root remains open':artifact?.qualification==='valid'?'Original saved · model-assessed completion, archive pending':'Original saved · completion unassessed';
    return {artifactId:artifact?.id,epochId:epoch.snapshot.id,kind:'raw' as const,id:ref.id,key:`${project.id}:raw:${ref.id}`,label};
  }
}
