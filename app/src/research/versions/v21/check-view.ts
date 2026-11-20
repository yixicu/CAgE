import { batchModeV21, batchPlanContextV21 } from './batch-context.js';
import { createHash } from 'node:crypto';
import { stableHash } from '../../../learning/research-hash.js';
import type { AnswerDeliveryV21, ConditionalInterfaceV21, FrozenQuestionV21, InFlightEpochV21, RawAnswerRefV21, ResearchProjectV21, ReviewDecisionV21, WorkerAnswerV21 } from '../../contracts/v21.js';

export const rawBodyHash = (body: string): string => createHash('sha256').update(body, 'utf8').digest('hex');
const same = (a: unknown, b: unknown): boolean => stableHash(a) === stableHash(b);
const boundary = (bytes: Buffer, at: number): boolean => Number.isSafeInteger(at) && at >= 0 && at <= bytes.length && (at === bytes.length || (bytes[at]! & 0xc0) !== 0x80);

/** This verifies content, not authorization. The caller must first perform the scoped store read. */
export function makeAnswerDelivery(ref: RawAnswerRefV21, body: string, kind: AnswerDeliveryV21['kind'], startByte = 0, endByte = Buffer.byteLength(body)): AnswerDeliveryV21 {
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length !== ref.byteLength || rawBodyHash(body) !== ref.bodyHash) throw new Error('Raw answer integrity mismatch.');
  if (!boundary(bytes, startByte) || !boundary(bytes, endByte) || startByte > endByte) throw new Error('Answer range must be ordered UTF-8 byte boundaries.');
  if (kind === 'full-original' && (startByte !== 0 || endByte !== bytes.length)) throw new Error('Full delivery must contain the entire original.');
  if (kind === 'handoff-prefix' && startByte !== 0) throw new Error('A handoff prefix starts at byte zero.');
  const excerpt = bytes.subarray(startByte, endByte).toString('utf8');
  return { answerRef: structuredClone(ref), kind, startByte, endByte, excerptHash: rawBodyHash(excerpt), body: excerpt, bodyContinues: endByte < bytes.length };
}
export function makeAnswerPrefix(ref: RawAnswerRefV21, body: string, maxBytes = 4096): AnswerDeliveryV21 {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Prefix size must be a positive integer.');
  const bytes = Buffer.from(body, 'utf8');
  let end = Math.min(bytes.length, maxBytes);
  while (!boundary(bytes, end)) end--;
  return makeAnswerDelivery(ref, body, 'handoff-prefix', 0, end);
}
export function deliveryIsValid(delivery: AnswerDeliveryV21, ref: RawAnswerRefV21): boolean {
  return same(delivery.answerRef, ref) && Number.isSafeInteger(delivery.startByte) && Number.isSafeInteger(delivery.endByte) && delivery.startByte >= 0 && delivery.endByte >= delivery.startByte && delivery.endByte <= ref.byteLength && Buffer.byteLength(delivery.body) === delivery.endByte - delivery.startByte && rawBodyHash(delivery.body) === delivery.excerptHash && delivery.bodyContinues === (delivery.endByte < ref.byteLength) && (delivery.kind !== 'handoff-prefix' || delivery.startByte === 0) && (delivery.kind !== 'full-original' || delivery.startByte === 0 && delivery.endByte === ref.byteLength && delivery.excerptHash === ref.bodyHash);
}
export function endedAnswers(project: ResearchProjectV21, marker: InFlightEpochV21): WorkerAnswerV21[] {
  const byId = new Map<string, WorkerAnswerV21>();
  for (const answer of [...project.answers, ...marker.answers]) {
    const identity = ['owner','projectId','epochId','wayId','questionId','questionRevision','attemptId','callId','hypothesisId','hypothesisRevision','inputHash','scientificInputHash','workerProtocolVersion','bodyHash','byteLength'] as const;
    if (identity.some(key => answer[key] !== answer.answerRef[key])) throw new Error('Raw answer envelope does not match its immutable reference.');
    const old = byId.get(answer.id);
    if (old && !same(old, answer)) throw new Error('Conflicting immutable answer identity.');
    byId.set(answer.id, answer);
  }
  return [...byId.values()];
}
export function latestDecisions(project: ResearchProjectV21): Map<string, ReviewDecisionV21> {
  const result = new Map<string, ReviewDecisionV21>();
  for (const receipt of project.reviews) {
    for (const id of receipt.invalidatedAnswerIds) {
      const old = result.get(id);
      if (old) result.set(id, { ...old, status: 'needs_review' });
    }
    for (const decision of receipt.decisions) result.set(decision.answerId, decision);
  }
  return result;
}
export function frozenOwner(project: ResearchProjectV21, marker: InFlightEpochV21, answer: WorkerAnswerV21): FrozenQuestionV21 | undefined {
  const candidates = [...project.epochs.flatMap(epoch => epoch.tasks), ...marker.tasks].flatMap(task => task.frozen ? [task.frozen] : []).filter(frozen => frozen.attemptId === answer.attemptId);
  const unique = [...new Map(candidates.map(frozen => [stableHash(frozen), frozen])).values()];
  if (unique.length !== 1) return undefined;
  const frozen = unique[0]!;
  return frozen.projectId === answer.projectId && frozen.epochId === answer.epochId && frozen.callId === answer.callId && frozen.question.id === answer.questionId && frozen.question.revision === answer.questionRevision && frozen.way.id === answer.wayId && frozen.root.hypothesisId === answer.hypothesisId && frozen.root.revision === answer.hypothesisRevision && frozen.inputHash === answer.inputHash && frozen.scientificInputHash === answer.scientificInputHash ? frozen : undefined;
}
export interface ActiveAssumptionMenuV21 { answerId: string; available: boolean; interfaceIds?: string[]; interfaces?: ConditionalInterfaceV21[]; reason?: string }
/** One exact frozen owner; establish is deliberately not an assumption. */
export function activeAssumptionMenus(project: ResearchProjectV21, marker: InFlightEpochV21): ActiveAssumptionMenuV21[] {
  const answers = endedAnswers(project, marker), byId = new Map(answers.map(answer => [answer.id, answer])), current = latestDecisions(project);
  const resolve = (answer: WorkerAnswerV21, visiting: Set<string>): Map<string, ConditionalInterfaceV21> | undefined => {
    if (visiting.has(answer.id)) return undefined;
    const frozen = frozenOwner(project, marker, answer);
    if (!frozen) return undefined;
    const path = new Set(visiting).add(answer.id), result = new Map<string, ConditionalInterfaceV21>();
    const add = (contract: ConditionalInterfaceV21): boolean => {
      const old = result.get(contract.id);
      if (old && !same(old, contract)) return false;
      result.set(contract.id, contract); return true;
    };
    const own = frozen.interfaceUses.filter(use => use.purpose === 'assume');
    if (new Set(own.map(use => use.interfaceId)).size !== own.length) return undefined;
    for (const use of own) {
      const definitions = frozen.conditionalInterfaces.filter(contract => contract.id === use.interfaceId && contract.version === use.interfaceVersion && contract.producerQuestionId === use.producerQuestionId && contract.producerQuestionRevision === use.producerQuestionRevision);
      if (definitions.length !== 1 || !add(definitions[0]!)) return undefined;
    }
    for (const premise of frozen.premises) {
      const id = premise.answer?.id, saved = id && byId.get(id), adopted = id && current.get(id);
      if (!saved || saved.epochId === frozen.epochId || !adopted || adopted.status !== 'adopted' || !adopted.adoptionHash || !premise.decision?.adoptionHash || adopted.answerHash !== saved.bodyHash || adopted.questionRevision !== saved.questionRevision || !same(saved, premise.answer) || premise.decision?.answerId !== id || premise.decision.status !== 'adopted' || premise.decision.answerHash !== saved.bodyHash || premise.decision.questionRevision !== saved.questionRevision || !frozen.adoptedAnswerIds.includes(id) || !frozen.grants.some(grant => grant.purpose === 'adopted-premise' && grant.readerProjectId === frozen.projectId && same(grant.ref, saved.answerRef))) return undefined;
      const inherited = resolve(saved, path);
      if (!inherited) return undefined;
      for (const interfaceId of new Set([...premise.decision.activeAssumptionIds, ...adopted.activeAssumptionIds])) {
        const contract = inherited.get(interfaceId);
        if (!contract || !add(contract)) return undefined;
      }
    }
    return result;
  };
  return answers.map(answer => {
    const definitions = resolve(answer, new Set());
    return definitions ? { answerId: answer.id, available: true, interfaceIds: [...definitions.keys()], interfaces: structuredClone([...definitions.values()]) } : { answerId: answer.id, available: false, reason: 'Missing, conflicting, cyclic or unauthorized exact frozen assumption owner/definition.' };
  });
}
/** Whitelist only. Frozen reader material remains private, never recursively projected. */
export function projectCheckView(project: ResearchProjectV21, marker: InFlightEpochV21, deliveries: AnswerDeliveryV21[]): unknown {
  const answers = endedAnswers(project, marker);
  return structuredClone({
    root: structuredClone(marker.snapshot.root), reviewMode: marker.reviewMode,
    ...(batchModeV21(marker)?{...batchPlanContextV21(marker) as object,reviewContextPolicy:{smallOriginalBytes:65536,totalOriginalAllowanceBytes:196608,requiredPrefixesAlwaysPreserved:true,largeOriginals:'honest-prefix-and-scoped-read'}}:{}),
    ways: structuredClone(project.ways),
    endedIndex: answers.map(answer => ({ id: answer.id, answerRef: answer.answerRef, executionStatus: answer.executionStatus, completeness: answer.completeness, errorCategory: answer.errorCategory })),
    questions: answers.map(answer => {
      const frozen = frozenOwner(project, marker, answer);
      if (!frozen) return { answerId: answer.id, unavailable: true };
      const q = frozen.question;
      return { answerId: answer.id, id: q.id, revision: q.revision, wayId: q.wayId, order: q.order, question: q.question, known: q.known, unknown: q.unknown, constraints: q.constraints, definitions: q.definitions, conditions: q.conditions, symbols: q.symbols, expectedArtifact: q.expectedArtifact, workerSelfCheckRequirements: q.checks, purpose: q.purpose, rootObligationIds: q.rootObligationIds, dependencyQuestionIds: q.dependencyQuestionIds, conditionalInterfaces: frozen.conditionalInterfaces, interfaceUses: frozen.interfaceUses, sourceEvidence: frozen.sources.map(source => ({ ref: source.ref, bodyHash: source.bodyHash })), adoptedPremises: frozen.premises.map(premise => ({ answerRef: premise.answer.answerRef, decision: premise.decision })) };
    }),
    priorDecisions: [...latestDecisions(project).values()], activeAssumptionMenus: activeAssumptionMenus(project, marker),
    answerDeliveries: structuredClone(deliveries),
  });
}
