import {validTagsV21} from './tags.js';
import { stableHash } from '../../../learning/research-hash.js';
import type { AnswerDeliveryV21, ArchiveSelectionV21, CheckOutputV21, FrozenQuestionV21, InFlightEpochV21, ResearchProjectV21, ReviewDecisionV21, WorkerAnswerV21 } from '../../contracts/v21.js';
import { activeAssumptionMenus, deliveryIsValid, endedAnswers, frozenOwner, latestDecisions } from './check-view.js';

export interface ReviewContextV21 { project: ResearchProjectV21; marker: InFlightEpochV21; deliveries: AnswerDeliveryV21[] }
export class V21ReviewValidationError extends Error {
  readonly diagnostics: { path: string; message: string }[];
  constructor(diagnostics: { path: string; message: string }[]) {
    super('V2.1 scientific review has unresolved structural requirements.');
    this.name = 'V21ReviewValidationError';
    this.diagnostics = diagnostics.slice(0, 32);
  }
}
const same = (a: unknown, b: unknown): boolean => stableHash(a) === stableHash(b);
const setEqual = (a: readonly string[], b: readonly string[]): boolean => a.length === new Set(a).size && b.length === new Set(b).size && a.length === b.length && a.every(value => b.includes(value));
const substantive = (decision: ReviewDecisionV21): boolean => Boolean(decision.reason.trim() && decision.evidence.length && decision.evidence.every(item => item.trim()));
/** Host-owned exact scientific use identity; excludes transport and review prose. */
export function adoptionHashV21(answer: WorkerAnswerV21, decision: ReviewDecisionV21): string {
  return stableHash({ root: [answer.hypothesisId, answer.hypothesisRevision], input: answer.scientificInputHash, body: answer.bodyHash, questionRevision: answer.questionRevision, conclusion: decision.conclusion, conclusionVersion: decision.conclusionVersion, use: decision.use, conditions: decision.conditions, activeAssumptionIds: decision.activeAssumptionIds, resultKind: decision.resultKind, rootObligationIds: decision.rootObligationIds, actualDependencyIds: decision.actualDependencyIds, possibleDependencyIds: decision.possibleDependencyIds, dependencyBindings: decision.dependencyBindings, dischargedInterfaces: decision.dischargedInterfaces });
}
function sameUse(a: ReviewDecisionV21, b: ReviewDecisionV21): boolean {
  const use = (d: ReviewDecisionV21) => ({ answerId: d.answerId, answerHash: d.answerHash, questionRevision: d.questionRevision, conclusion: d.conclusion, conclusionVersion: d.conclusionVersion, use: d.use, conditions: d.conditions, activeAssumptionIds: d.activeAssumptionIds, resultKind: d.resultKind, rootObligationIds: d.rootObligationIds, actualDependencyIds: d.actualDependencyIds, possibleDependencyIds: d.possibleDependencyIds, dischargedInterfaces: d.dischargedInterfaces, excludedPremises: d.excludedPremises });
  return same(use(a), use(b));
}
function evidenceDelivered(context: ReviewContextV21, answer: WorkerAnswerV21, decision: ReviewDecisionV21, allowCache: boolean): boolean {
  const valid = (delivery: AnswerDeliveryV21, mode: string | undefined) => deliveryIsValid(delivery, answer.answerRef) && (delivery.kind === 'full-original' || mode === 'interface-v1' && delivery.body.trim().length > 0);
  if (context.deliveries.some(delivery => valid(delivery, context.marker.reviewMode))) return true;
  if (!allowCache) return false;
  const latest = latestDecisions(context.project).get(answer.id);
  if (!latest || latest.status !== 'adopted' || !sameUse(latest, decision)) return false;
  return context.project.reviews.some(receipt => receipt.hypothesisId === context.marker.snapshot.root.hypothesisId && receipt.hypothesisRevision === context.marker.snapshot.root.revision && receipt.decisions.some(old => old.status === 'adopted' && sameUse(old, decision) && old.adoptionHash === latest.adoptionHash) && receipt.answerDeliveries.some(delivery => valid(delivery, receipt.reviewMode)));
}
/** Local transitive invalidation. History is preserved; callers persist the returned affected IDs. */
export function invalidatedDependentsV21(decisions: readonly ReviewDecisionV21[], changedIds: readonly string[]): string[] {
  const affected = new Set(changedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const decision of decisions) if (!affected.has(decision.answerId) && [...decision.actualDependencyIds, ...decision.possibleDependencyIds].some(id => affected.has(id))) { affected.add(decision.answerId); changed = true; }
  }
  return [...affected];
}
/** Pure, clone-before-validation. No scientific field is repaired and no state is written. */
export function validateCheckOutput(context: ReviewContextV21, original: CheckOutputV21, options:{legacyTags?:boolean}={}): CheckOutputV21 {
  const validTags=options.legacyTags?(tags:string[])=>tags.length>0&&tags.every(tag=>/^(subject|specialization|method|problem-type|pitfall):[^:]+$/.test(tag)):validTagsV21;
  const output = structuredClone(original), issues: { path: string; message: string }[] = [];
  const issue = (path: string, message: string) => { if (issues.length < 32) issues.push({ path, message }); };
  const { project, marker } = context, root = marker.snapshot.root;
  if (!root.obligations.length) issue('/root/obligations', 'A reviewed root requires explicit nonempty completion obligations.');
  const answers = new Map(endedAnswers(project, marker).map(answer => [answer.id, answer]));
  const prior = latestDecisions(project), decisions = new Map(prior), submitted = new Map<string, ReviewDecisionV21>();
  const menus = new Map(activeAssumptionMenus(project, marker).map(menu => [menu.answerId, menu]));
  const owners = new Map<string, FrozenQuestionV21>();
  for (const [id, answer] of answers) { const frozen = frozenOwner(project, marker, answer); if (frozen) owners.set(id, frozen); }
  for (const delivery of context.deliveries) {
    const answer = [...answers.values()].find(item => same(item.answerRef, delivery.answerRef));
    if (!answer || !deliveryIsValid(delivery, answer.answerRef)) throw new Error('Untrusted answer delivery or unknown answer authority.');
  }
  output.decisions.forEach((decision, index) => {
    const path = `/decisions/${index}`, answer = answers.get(decision.answerId);
    if (!answer) throw new Error('Review references an unknown ended answer.');
    if (submitted.has(decision.answerId)) issue(`${path}/answerId`, 'Each answer has one explicit review decision.');
    submitted.set(decision.answerId, decision); decisions.set(decision.answerId, decision);
    if (decision.answerHash !== answer.bodyHash || decision.questionRevision !== answer.questionRevision) issue(path, 'Use the exact ended answer hash and question revision.');
    if (!decision.reason.trim()) issue(`${path}/reason`, 'A substantive reason is required.');
    if (decision.status !== 'adopted') { delete decision.adoptionHash; return; }
    const frozen = owners.get(answer.id), menu = menus.get(answer.id);
    if (!frozen || !menu?.available) { issue(path, 'Adoption requires a unique exact frozen owner and available assumption menu.'); return; }
    if (answer.executionStatus !== 'completed' || answer.completeness !== 'complete' || answer.answerRef.completeness !== 'complete') issue(path, 'Only technically complete originals can be adopted.');
    if (answer.hypothesisId !== root.hypothesisId || answer.hypothesisRevision !== root.revision) issue(path, 'Answer belongs to a different frozen root version.');
    if (!['supported-result', 'valid-refutation'].includes(decision.resultKind)) issue(`${path}/resultKind`, 'Inconclusive or technical results cannot be adopted as established evidence.');
    if (!decision.conclusion.trim() || !decision.conclusionVersion.trim() || !decision.use.trim() || !substantive(decision)) issue(path, 'Adoption requires an exact conclusion/version/use and substantive reason and evidence.');
    if (decision.rootObligationIds.some(id => !root.obligations.some(obligation => obligation.id === id))) issue(`${path}/rootObligationIds`, 'Unknown root obligation.');
    const excluded = decision.excludedPremises ?? [];
    if (new Set(excluded.map(item => item.answerId)).size !== excluded.length || excluded.some(item => !frozen.adoptedAnswerIds.includes(item.answerId) || !item.reason.trim() || decision.actualDependencyIds.includes(item.answerId))) issue(`${path}/excludedPremises`, 'Exclude only an actually granted unused premise with a scientific reason.');
    const expectedPossible = frozen.adoptedAnswerIds.filter(id => !decision.actualDependencyIds.includes(id) && !excluded.some(item => item.answerId === id));
    decision.possibleDependencyIds = [...new Set([...decision.possibleDependencyIds, ...expectedPossible])];
    const permitted = new Set([...frozen.adoptedAnswerIds, ...decision.dischargedInterfaces.map(discharge => discharge.sourceAnswerId)]);
    if ([...decision.actualDependencyIds, ...decision.possibleDependencyIds].some(id => !permitted.has(id) || id === answer.id)) issue(`${path}/actualDependencyIds`, 'Dependencies must be exact frozen premises or explicit conditional producers, never self-dependencies.');
    if (!evidenceDelivered(context, answer, decision, true)) issue(path, 'Adoption requires actual full delivery or an explicit interface-v1 nonempty excerpt; unchanged exact uses alone may reuse a valid receipt.');
    const expectedActive = new Set(menu.interfaceIds ?? []), seenDischarge = new Set<string>();
    for (const discharge of decision.dischargedInterfaces) {
      if (seenDischarge.has(discharge.interfaceId)) issue(`${path}/dischargedInterfaces`, 'An assumption can be discharged only once.');
      seenDischarge.add(discharge.interfaceId);
      const definitions = (menu.interfaces ?? []).filter(contract => contract.id === discharge.interfaceId && contract.version === discharge.interfaceVersion);
      const contracts = [...new Map(definitions.map(contract => [stableHash(contract), contract])).values()];
      const source = answers.get(discharge.sourceAnswerId), sourceOwner = source && owners.get(source.id);
      if (!expectedActive.has(discharge.interfaceId) || contracts.length !== 1 || !source || !sourceOwner || !discharge.reason.trim()) { issue(`${path}/dischargedInterfaces`, 'Discharge requires an active exact interface, unique frozen definition and substantive producer-matching reason.'); continue; }
      const contract = contracts[0]!;
      if (sourceOwner.conditionalInterfaces.filter(item => item.id === contract.id && item.version === contract.version).length !== 1 || !sourceOwner.conditionalInterfaces.some(item => same(item, contract)) || source.questionId !== contract.producerQuestionId || source.questionRevision !== contract.producerQuestionRevision || !sourceOwner.interfaceUses.some(use => use.purpose === 'establish' && use.interfaceId === contract.id && use.interfaceVersion === contract.version && use.producerQuestionId === contract.producerQuestionId && use.producerQuestionRevision === contract.producerQuestionRevision)) issue(`${path}/dischargedInterfaces`, 'Producer must establish this exact interface and question version.');
      expectedActive.delete(discharge.interfaceId);
      if (!decision.actualDependencyIds.includes(source.id)) decision.actualDependencyIds.push(source.id);
    }
    if (!setEqual(decision.activeAssumptionIds, [...expectedActive])) issue(`${path}/activeAssumptionIds`, 'Preserve every active own/inherited assumption unless explicitly discharged; establish is not assume.');
  });
  // Every newly ended, unread, or invalidated path is reviewed, not only successful paths.
  for (const [id, answer] of answers) {
    const old = prior.get(id), current = submitted.get(id);
    if ((!old || old.answerHash !== answer.bodyHash || old.questionRevision !== answer.questionRevision || old.status === 'needs_review' || marker.answers.some(item => item.id === id)) && !current) issue('/decisions', `Missing review of ended or affected answer ${id}.`);
  }
  const visiting = new Set<string>(), complete = new Set<string>();
  const bind = (id: string): ReviewDecisionV21 | undefined => {
    const decision = decisions.get(id), answer = answers.get(id);
    if (!decision || !answer || decision.status !== 'adopted') return undefined;
    if (visiting.has(id)) { issue('/decisions/dependencies', 'Scientific dependency cycle.'); return undefined; }
    if (complete.has(id)) return decision;
    visiting.add(id);
    const ids = [...new Set([...decision.actualDependencyIds, ...decision.possibleDependencyIds])];
    const bindings = ids.flatMap(sourceId => {
      const source = bind(sourceId), sourceAnswer = answers.get(sourceId);
      if (!source || !sourceAnswer || !source.adoptionHash) { issue('/decisions/dependencies', `Dependency ${sourceId} is not currently adopted.`); return []; }
      return [{ answerId: sourceId, bodyHash: sourceAnswer.bodyHash, adoptionHash: source.adoptionHash, questionRevision: sourceAnswer.questionRevision }];
    });
    for (const discharge of decision.dischargedInterfaces) {
      const source = decisions.get(discharge.sourceAnswerId);
      if (!source || source.status !== 'adopted' || source.resultKind !== 'supported-result') issue('/decisions/dischargedInterfaces', 'Only an adopted supported-result establishes an assumption; a valid refutation does not.');
      if (source?.activeAssumptionIds.some(assumption => !decision.activeAssumptionIds.includes(assumption))) issue('/decisions/activeAssumptionIds', 'A conditional producer cannot silently erase its own remaining assumptions.');
    }
    const old = prior.get(id);
    if (submitted.has(id)) {
      if (old && (old.status === 'needs_review' || !same(old.dependencyBindings, bindings))) {
        if (!decision.recheckedPremises.some(reason => reason.trim()) || !evidenceDelivered(context, answer, decision, false) || bindings.some(binding => !old.dependencyBindings.some(previous => same(previous, binding)) && (!answers.get(binding.answerId) || !decisions.get(binding.answerId) || !evidenceDelivered(context, answers.get(binding.answerId)!, decisions.get(binding.answerId)!, false)))) issue('/decisions/recheckedPremises', `Changed dependencies of ${id} require a substantive local recheck and actual fresh delivery.`);
      }
      decision.dependencyBindings = bindings; decision.adoptionHash = adoptionHashV21(answer, decision);
    } else if (!same(decision.dependencyBindings, bindings) || decision.adoptionHash !== adoptionHashV21(answer, decision)) {
      issue('/decisions/dependencies', `Cached adoption ${id} is stale and requires explicit affected-use review.`);
    }
    visiting.delete(id); complete.add(id); return decision;
  };
  for (const [id, decision] of submitted) if (decision.status === 'adopted') bind(id);
  const closureWays = new Set<string>();
  output.closures.forEach((closure, index) => {
    const path = `/closures/${index}`, way = project.ways.find(item => item.id === closure.wayId);
    if (closureWays.has(closure.wayId)) issue(`${path}/wayId`, 'Duplicate Way closure.');
    closureWays.add(closure.wayId);
    if (!way || way.revision !== closure.wayRevision) issue(path, 'Closure requires an exact current Way version.');
    if (closure.target !== 'original-root' || closure.hypothesisId !== root.hypothesisId || closure.hypothesisRevision !== root.revision || closure.rootClosed !== true) issue(path, 'Only complete exact original-root closures are archival candidates.');
    if (!same(closure.conditions, root.conditions)) issue(`${path}/conditions`, 'Root closure must preserve the frozen root conditions, without silently adding or removing assumptions.');
    if(marker.theoristMode==='judgment-batch-v1'&&closure.reproducible!==true)issue(`${path}/reproducible`,'Operation6 qualified closure requires explicit reproducible:true.');
    if (!closure.reason.trim() || !closure.outline.length || closure.outline.some(item => !item.trim())) issue(path, 'A substantive original-root return judgment and faithful outline are required.');
    if (!validTags(closure.tags)) issue(`${path}/tags`, 'Use the shared scientific dimensioned tag vocabulary.');
    if (!setEqual(closure.obligations.map(obligation => obligation.obligationId), root.obligations.map(obligation => obligation.id))) issue(`${path}/obligations`, 'Each independently closed Way must cover every root obligation itself.');
    if (!closure.answerIds.length || closure.answerIds.length !== new Set(closure.answerIds).size) issue(`${path}/answerIds`, 'Select a nonempty ordered set of exact original answers.');
    for (const id of closure.answerIds) {
      const decision = bind(id), answer = answers.get(id);
      if (!decision || !answer || decision.activeAssumptionIds.length) { issue(`${path}/answerIds`, `Answer ${id} is not unconditional currently adopted evidence.`); continue; }
      if (!evidenceDelivered(context, answer, decision, true)) issue(`${path}/answerIds`, `Answer ${id} has no valid exact-use review delivery.`);
      if ([...decision.actualDependencyIds, ...decision.possibleDependencyIds].some(dependency => !closure.answerIds.includes(dependency))) issue(`${path}/answerIds`, 'The selected originals must include the complete scientific dependency closure.');
    }
    for (const support of closure.obligations) {
      if (!support.reason.trim() || !support.answerIds.length || !support.answerIds.some(id => answers.get(id)?.wayId === closure.wayId)) issue(`${path}/obligations`, 'Each obligation needs explicit substantive support.');
      for (const id of support.answerIds) {
        const decision = decisions.get(id);
        if (!closure.answerIds.includes(id) || decision?.status !== 'adopted' || !decision.rootObligationIds.includes(support.obligationId)) issue(`${path}/obligations`, 'Obligation support must use selected adopted answers explicitly supporting that obligation.');
      }
    }
    const reachable = new Set(closure.answerIds.filter(id => answers.get(id)?.wayId === closure.wayId));
    let expanded = true;
    while (expanded) { expanded = false; for (const id of [...reachable]) { const d = decisions.get(id); for (const dependency of [...(d?.actualDependencyIds ?? []), ...(d?.possibleDependencyIds ?? [])]) if (!reachable.has(dependency)) { reachable.add(dependency); expanded = true; } } }
    if (!reachable.size || closure.answerIds.some(id => !reachable.has(id))) issue(path, 'Cross-Way originals must be explicit dependencies of this Way, not a union of partial Ways.');
    if (closure.resultKind === 'supported-result' && closure.rootRelation === 'necessary' || closure.resultKind === 'valid-refutation' && closure.rootRelation === 'sufficient') issue(`${path}/rootRelation`, 'The declared implication direction does not return this result to the original root.');
    if (closure.rootRelation === 'explicit-bridge' && (!closure.bridgeAnswerIds.length || closure.bridgeAnswerIds.some(id => !closure.answerIds.includes(id) || decisions.get(id)?.status !== 'adopted' || decisions.get(id)?.resultKind !== 'supported-result'))) issue(`${path}/bridgeAnswerIds`, 'An explicit bridge needs actual selected adopted positive evidence.');
    if (closure.resultKind === 'valid-refutation' && !closure.answerIds.some(id => decisions.get(id)?.resultKind === 'valid-refutation')) issue(`${path}/resultKind`, 'Root refutation needs an actual adopted refutation and an explicit exact-root scope judgment.');
  });
  if (output.rootSupport.kind === 'closure' && !output.closures.some(closure => closure.wayId === (output.rootSupport as { kind: 'closure'; wayId: string }).wayId)) issue('/rootSupport', 'Select one independently complete closure, never a union of partial Ways.');
  if (output.rootSupport.kind === 'explicit') {
    if (new Set(output.rootSupport.obligations.map(item => item.obligationId)).size !== output.rootSupport.obligations.length || output.rootSupport.obligations.some(item => !root.obligations.some(obligation => obligation.id === item.obligationId))) issue('/rootSupport/obligations', 'Explicit progress has unique known root obligations.');
  }
  if (output.decision === 'complete' && !output.closures.length) issue('/decision', 'Explicit progress or partial routes cannot complete the root without an independent closure.');
  if (new Set(output.wayDecisions.map(item => item.wayId)).size !== output.wayDecisions.length || output.wayDecisions.some(item => !project.ways.some(way => way.id === item.wayId) || !item.reason.trim())) issue('/wayDecisions', 'Way utility judgments require unique known Ways and reasons, separate from scientific validity.');
  for (const [index, failure] of (output.failures ?? []).entries()) {
    const sources = failure.answerIds.map(id => answers.get(id));
    if (!failure.scientific || !failure.generalizable || !failure.patternKey.trim() || !failure.summary.trim() || !validTags(failure.tags) || sources.some(answer => !answer || answer.executionStatus !== 'completed' || answer.hypothesisId !== root.hypothesisId || answer.hypothesisRevision !== root.revision) || new Set(sources.map(answer => answer?.attemptId)).size < 2 || new Set(sources.map(answer => answer?.questionId)).size < 2 || failure.answerIds.some(id => { const d = decisions.get(id); return !d || d.resultKind !== 'scientific-failure' || d.status !== 'rejected' || !substantive(d); })) issue(`/failures/${index}`, 'Failure learning requires similar generalizable scientific failures from different completed Workers, not technical errors, pruning, valid refutations, or mere incompleteness.');
  }
  // Run the same archive eligibility gate before accepting a closed scientific proposal.
  // Current and retained receipts remain separate; no prefix is upgraded to a full read.
  if (!issues.length) for (const closure of output.closures) {
    const selected = closure.answerIds.map(id => answers.get(id)!.answerRef);
    const oldReceipts = project.reviews.filter(receipt => receipt.hypothesisId === root.hypothesisId && receipt.hypothesisRevision === root.revision && receipt.reviewMode === marker.reviewMode);
    try {
      validateArchiveSelection({ operationId: 'preflight', projectId: project.id, epochId: marker.snapshot.id, wayId: closure.wayId, wayRevision: closure.wayRevision, root, methodKey: project.ways.find(way => way.id === closure.wayId)!.methodKey, answers: selected, closure, conditions: closure.conditions, tags: closure.tags, outline: closure.outline, review: { id: 'preflight', epochId: marker.snapshot.id, hypothesisId: root.hypothesisId, hypothesisRevision: root.revision, scientificInputHash: '', reviewMode: marker.reviewMode, decisions: [...decisions.values()], answerDeliveries: [...context.deliveries, ...oldReceipts.flatMap(receipt => receipt.answerDeliveries)], cachedAnswerDeliveries: [], deliveredAnswerRefs: [], cachedAnswerRefs: [], invalidatedAnswerIds: [], closures: output.closures, createdAt: '' } },options);
    } catch (error) { if (error instanceof V21ReviewValidationError) for (const diagnostic of error.diagnostics) issue(diagnostic.path, diagnostic.message); else throw error; }
  }
  if (issues.length) throw new V21ReviewValidationError(issues);
  return output;
}

/** Archive gate shares the check's exact adopted-use semantics; it never upgrades prefixes to full reads.
 * The storage adapter additionally verifies immutable whole bodies and each receipt's byte range. */
export function validateArchiveSelection(selection: ArchiveSelectionV21, options:{legacyTags?:boolean}={}): void {
  const validTags=options.legacyTags?(tags:string[])=>tags.length>0&&tags.every(tag=>/^(subject|specialization|method|problem-type|pitfall):[^:]+$/.test(tag)):validTagsV21;
  const diagnostics: {path:string;message:string}[] = [];
  const fail = (path:string,message:string) => { if(diagnostics.length < 32) diagnostics.push({path,message}); };
  const {root,closure,review} = selection;
  if((review.theoristMode==='judgment-batch-v1')!==(['v21-operation-6','v21-operation-7'].includes(review.operationRevision??'')))fail('/review/operationRevision',review.operationRevision==='v21-operation-7'?'Consolidated review mode and operation7 must remain exactly paired.':'Consolidated review mode and operation6 must remain exactly paired.');
  if(['v21-operation-6','v21-operation-7'].includes(review.operationRevision??'')&&(closure.reproducible!==true||review.closures.some(c=>c.reproducible!==true)))fail('/closure/reproducible',review.operationRevision==='v21-operation-7'?'Operation7 archive requires the explicit reproducibility attestation from its accepted review.':'Operation6 archive requires the explicit reproducibility attestation from its accepted review.');
  if(review.promptRevision!==undefined&&review.promptRevision!=='categorized-v1'||(review.promptRevision==='categorized-v1')!==(review.operationRevision==='v21-operation-7'))fail('/review/promptRevision','Categorized prompt revision and operation7 must remain exactly paired.');
  if (!root.obligations.length) fail('/root/obligations','Root closure needs explicit nonempty obligations.');
  const refs = new Map(selection.answers.map(ref => [ref.id,ref]));
  const decisions = new Map(review.decisions.map(decision => [decision.answerId,decision]));
  if(selection.wayId !== closure.wayId || selection.wayRevision !== closure.wayRevision || closure.target !== 'original-root' || closure.rootClosed !== true || closure.hypothesisId !== root.hypothesisId || closure.hypothesisRevision !== root.revision || review.hypothesisId !== root.hypothesisId || review.hypothesisRevision !== root.revision || !review.closures.some(item => same(item,closure))) fail('/closure','Selection, receipt, Way and exact original root must agree.');
  if(!same(selection.conditions,closure.conditions) || !same(closure.conditions,root.conditions) || !same(selection.tags,closure.tags) || !same(selection.outline,closure.outline)) fail('/closure','Archive metadata must be the exact validated closure metadata.');
  if(!setEqual(closure.obligations.map(item=>item.obligationId),root.obligations.map(item=>item.id))) fail('/closure/obligations','Each Way independently covers every original-root obligation.');
  if(!same(selection.answers.map(ref=>ref.id),closure.answerIds) || !closure.answerIds.length || refs.size !== selection.answers.length) fail('/answers','Embed the exact nonempty ordered selected original answers.');
  if(!closure.reason.trim() || !closure.outline.length || closure.outline.some(item=>!item.trim())) fail('/closure/outline','Substantive closure evidence and a nonblank faithful outline are required.');
  if(!validTags(closure.tags)) fail('/closure/tags','Use valid dimensioned tags accepted by the canonical library validator.');
  if(closure.resultKind === 'supported-result' && closure.rootRelation === 'necessary' || closure.resultKind === 'valid-refutation' && closure.rootRelation === 'sufficient') fail('/closure/rootRelation','Invalid implication direction for original-root closure.');
  if(closure.rootRelation === 'explicit-bridge' && (!closure.bridgeAnswerIds.length || closure.bridgeAnswerIds.some(id=>!refs.has(id) || decisions.get(id)?.resultKind !== 'supported-result'))) fail('/closure/bridgeAnswerIds','An explicit bridge needs selected positive original evidence.');
  const matches = closure.conditionMatches ?? [];
  if (new Set(matches.map(match => JSON.stringify([match.answerId, match.condition]))).size !== matches.length) fail('/closure/conditionMatches','Condition compatibility judgments must be unique per exact answer and condition.');
  for (const match of matches) {
    const decision = decisions.get(match.answerId);
    if (!refs.has(match.answerId) || !decision?.conditions.includes(match.condition) || !match.reason.trim()) fail('/closure/conditionMatches','Match an actual selected condition with a substantive scientific judgment.');
    if (match.basis === 'root-context') {
      if (match.sourceAnswerIds.length) fail('/closure/conditionMatches','Root-context matching uses the exact frozen root, not unbound result sources.');
    } else if (match.basis === 'established') {
      if (!match.sourceAnswerIds.length || new Set(match.sourceAnswerIds).size !== match.sourceAnswerIds.length || match.sourceAnswerIds.some(id => id === match.answerId || !refs.has(id) || decisions.get(id)?.status !== 'adopted' || decisions.get(id)?.resultKind !== 'supported-result' || !decision?.actualDependencyIds.includes(id))) fail('/closure/conditionMatches','Established conditions require exact selected positive dependencies, never a self-supporting assumption.');
    } else fail('/closure/conditionMatches','Unknown condition compatibility basis.');
  }
  for (const [id] of refs) for (const condition of decisions.get(id)?.conditions ?? []) {
    if (!root.conditions.includes(condition) && !matches.some(match => match.answerId === id && match.condition === condition)) fail('/closure/conditionMatches','An extra or differently stated answer condition requires an explicit root-context matching judgment or established positive evidence; it cannot silently close an unconditional root.');
  }
  const receipts = [...review.answerDeliveries,...review.cachedAnswerDeliveries];
  for(const [id,ref] of refs) {
    const decision = decisions.get(id);
    if(ref.completeness !== 'complete' || ref.hypothesisId !== root.hypothesisId || ref.hypothesisRevision !== root.revision || !decision || decision.status !== 'adopted' || decision.answerHash !== ref.bodyHash || decision.questionRevision !== ref.questionRevision || decision.activeAssumptionIds.length || review.invalidatedAnswerIds.includes(id) || !substantive(decision)) {fail('/answers',`Selected answer ${id} is not complete current unconditional adopted evidence.`);continue;}
    if(decision.adoptionHash !== adoptionHashV21({...ref,answerRef:ref,executionStatus:'completed'},decision)) fail('/review/decisions','Adoption hash does not match its exact scientific scope.');
    const dependencies = [...new Set([...decision.actualDependencyIds,...decision.possibleDependencyIds])];
    if(!setEqual(decision.dependencyBindings.map(binding=>binding.answerId),dependencies)) fail('/review/dependencyBindings','Every actual and possible dependency must be exactly bound.');
    for(const dependency of dependencies) {
      const source = refs.get(dependency), d = decisions.get(dependency), binding = decision.dependencyBindings.find(item=>item.answerId===dependency);
      if(!source || !d || d.status !== 'adopted' || !binding || binding.bodyHash !== source.bodyHash || binding.questionRevision !== source.questionRevision || binding.adoptionHash !== d.adoptionHash) fail('/review/dependencyBindings','Selected originals must retain the exact current dependency closure.');
    }
    if(decision.dischargedInterfaces.some(discharge=>!discharge.reason.trim() || !decision.actualDependencyIds.includes(discharge.sourceAnswerId) || decisions.get(discharge.sourceAnswerId)?.resultKind !== 'supported-result')) fail('/review/dischargedInterfaces','Only exact adopted positive dependencies can discharge conditional premises.');
    const delivered = receipts.some(receipt=>same(receipt.answerRef,ref) && Number.isSafeInteger(receipt.startByte) && Number.isSafeInteger(receipt.endByte) && receipt.startByte >= 0 && receipt.endByte <= ref.byteLength && receipt.endByte > receipt.startByte && receipt.bodyContinues === (receipt.endByte < ref.byteLength) && (receipt.kind !== 'handoff-prefix' || receipt.startByte === 0) && (receipt.kind === 'full-original' ? receipt.startByte === 0 && receipt.endByte === ref.byteLength && receipt.excerptHash === ref.bodyHash : review.reviewMode === 'interface-v1') && (!('body' in receipt) || deliveryIsValid(receipt as AnswerDeliveryV21,ref)));
    if(!delivered) fail('/review/answerDeliveries','An actual matching review delivery is required; a naked full-read reference is not a receipt.');
  }
  for(const support of closure.obligations) {
    if(!support.reason.trim() || !support.answerIds.length || !support.answerIds.some(id=>refs.get(id)?.wayId===closure.wayId) || support.answerIds.some(id=>!refs.has(id) || !decisions.get(id)?.rootObligationIds.includes(support.obligationId))) fail('/closure/obligations','Each obligation needs selected local-Way support; foreign prerequisites do not replace a local module.');
  }
  const visiting = new Set<string>(), visited = new Set<string>(), reachable = new Set<string>();
  const visit = (id:string) => {
    if(visiting.has(id)){fail('/review/dependencies','Dependency cycle.');return;}
    reachable.add(id); if(visited.has(id))return; visiting.add(id);
    const decision=decisions.get(id); for(const dependency of [...(decision?.actualDependencyIds??[]),...(decision?.possibleDependencyIds??[])])visit(dependency);
    visiting.delete(id);visited.add(id);
  };
  for(const [id,ref] of refs)if(ref.wayId===closure.wayId)visit(id);
  if(!reachable.size || [...refs.keys()].some(id=>!reachable.has(id)))fail('/answers','Foreign Way answers may only be explicit prerequisites of selected local-Way derivations, never a partial-Way union.');
  if(closure.resultKind==='valid-refutation' && ![...decisions.values()].some(decision=>refs.has(decision.answerId)&&decision.resultKind==='valid-refutation'))fail('/closure/resultKind','A root refutation requires an actual adopted refutation.');
  if(diagnostics.length)throw new V21ReviewValidationError(diagnostics);
}
