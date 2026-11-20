import { join } from 'node:path';
import { atomicWrite, exists, readJson } from '../storage/atomic.js';
import { stableHash } from '../learning/research-hash.js';
import { HANDOFF_VERSION, handoffVersion, type HandoffVersion } from './strict-schema.js';
import { RuntimeError } from './errors.js';
import type { ScientificSlots } from './scientific-slots.js';

type Slots = ReturnType<ScientificSlots['snapshot']>;
export interface HandoffMetrics { validationMs: number; acceptanceMs: number; correctionDispatchMs: number; correctionDispatches: number; correctionToolAttempts: number }
export interface OperationReceipt { scope: string; tool: string; argumentsHash: string; status: 'pending' | 'completed' | 'uncertain'; result?: unknown; published?: boolean; code?: string }
export interface ReportDraftState {
  contractVersion?: HandoffVersion; metrics?: HandoffMetrics; recovery?: Record<string,{pending:boolean;fingerprints:Record<string,number>}>; operationReceipts?: Record<string, OperationReceipt>;
  /** Host execution metadata; excluded from the scientific draft key and receipt identity. */
  recoveryGeneration?: number;
  recoveryMetricBase?: { correctionDispatches: number; correctionToolAttempts: number };
  recoveryHistory?: { generation: number; metricBase?: ReportDraftState['recoveryMetricBase']; recovery?: ReportDraftState['recovery']; lastFailure?: ReportDraftState['lastFailure']; metrics?: HandoffMetrics }[];
  strictResult?: unknown;
  routing?: unknown;
  strictObservations?: {dispatch:number;toolCallId:string;[key:string]:unknown}[];
  lastFailure?: {tool?:string;toolCallId?:string;attemptsUsed:number;correctionRemaining:boolean;classification?:string;fingerprint?:string;noProgress?:boolean};
  version: 1; key: string; responses: { text: string; truncated: boolean; revision?: number; capturedAt?: string }[];
  report?: Slots; chapter?: Slots; handles: [string, unknown][]; issues: string[];
  savedBundles: Record<string, unknown>; pendingReport?: string; pendingChapter?: boolean; complete?: boolean;
}
/** Private recovery only: preserving text never makes it accepted scientific evidence. */
export class ReportDraft {
  private constructor(private readonly file: string, readonly state: ReportDraftState) {}
  static async open(root: string, frozen: unknown, recoveryGeneration?: number): Promise<ReportDraft> {
    const key = stableHash(frozen), file = join(root, `${key}.json`);
    const state = await exists(file) ? await readJson<ReportDraftState>(file)
      : { version: 1 as const, key, responses: [], handles: [], issues: [], savedBundles: {} };
    if (state.version !== 1 || state.key !== key || !Array.isArray(state.responses) || !Array.isArray(state.handles)) throw new Error('Invalid report recovery checkpoint.');
    const declared = (frozen as {contract?: unknown} | null)?.contract;
    const observed = state.strictObservations?.map(item => (item.contractContext as {contract?: unknown} | undefined)?.contract).filter(value => value !== undefined) ?? [];
    const recorded = state.contractVersion ?? (observed.length ? observed[0] : declared ?? HANDOFF_VERSION);
    state.contractVersion = handoffVersion(recorded);
    if (declared !== undefined && state.contractVersion !== handoffVersion(declared) || observed.some(value => value !== state.contractVersion)) throw new Error('Conflicting recorded handoff versions; preserve this draft for review.');
    const draft = new ReportDraft(file, state);
    if (recoveryGeneration !== undefined) {
      const previous = state.recoveryGeneration ?? 1;
      if (!Number.isSafeInteger(recoveryGeneration) || recoveryGeneration < 1
        || !Number.isSafeInteger(previous) || previous < 1 || recoveryGeneration < previous)
        throw new RuntimeError('INVALID_CONFIGURATION');
      for (const field of ['correctionDispatches', 'correctionToolAttempts'] as const) {
        const total = state.metrics?.[field] ?? 0, base = state.recoveryMetricBase?.[field] ?? 0;
        if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(base) || base < 0 || base > total)
          throw new RuntimeError('INVALID_CONFIGURATION');
      }
      // An uncertain durable side effect must be reconciled before admitting fresh paid work.
      if (Object.values(state.operationReceipts ?? {}).some(receipt => receipt.status !== 'completed'))
        throw new RuntimeError('OPERATION_RECONCILIATION_REQUIRED');
      if (recoveryGeneration > previous) {
        (state.recoveryHistory ??= []).push({generation:previous,
          ...(state.recoveryMetricBase ? {metricBase:structuredClone(state.recoveryMetricBase)} : {}),
          ...(state.recovery ? {recovery:structuredClone(state.recovery)} : {}),
          ...(state.lastFailure ? {lastFailure:structuredClone(state.lastFailure)} : {}),
          ...(state.metrics ? {metrics:structuredClone(state.metrics)} : {})});
        delete state.recovery;
        delete state.lastFailure;
        state.recoveryMetricBase = {correctionDispatches:state.metrics?.correctionDispatches ?? 0,
          correctionToolAttempts:state.metrics?.correctionToolAttempts ?? 0};
      }
      if (state.recoveryGeneration !== recoveryGeneration) {
        state.recoveryGeneration = recoveryGeneration;
        // One atomic publication includes both the old budget history and its renewed allowance.
        // A failed/uncertain write throws; no caller may dispatch from this in-memory transition.
        await draft.save();
      }
    }
    return draft;
  }
  /** Read an explicitly identified historical contract without rewriting its data. */
  static async readRecorded(root: string, frozen: unknown): Promise<ReportDraft | undefined> {
    const declared = (frozen as {contract?: unknown} | null)?.contract;
    if (declared === undefined) throw new Error('Historical lookup requires an explicit recorded contract version.');
    handoffVersion(declared);
    if (!await exists(join(root, `${stableHash(frozen)}.json`))) return;
    return ReportDraft.open(root, frozen);
  }
  async capture(text: string, truncated: boolean): Promise<void> {
    this.state.responses.push({text, truncated, revision:this.state.responses.length + 1, capturedAt:new Date().toISOString()});
    this.state.complete = false;
    await this.save();
  }
  /** A private byte receipt never implies a valid chapter or accepted science. */
  retainBody(argumentsValue: unknown): string | undefined {
    const body = (argumentsValue as {content?: {text?: unknown}} | null)?.content?.text;
    if (typeof body !== 'string' || !body.length || body.length > 1_000_000) return;
    const handle = 'body_' + stableHash(body);
    this.state.savedBundles[handle] = body;
    return handle;
  }
  async save(): Promise<void> { await atomicWrite(this.file, JSON.stringify(this.state)); }
}
