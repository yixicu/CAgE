import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import type { TechnicalStateV21, RawAnswerRefV21 } from '../research/contracts/v21.js';
import type { OptionalControlV21, OptionalTheoristResultV21 } from '../research/versions/v21/optional-types.js';
import { V21Control } from './v21-control.js';
import { V0AnswerCollector } from './v0-answer.js';
import { SUBMIT_RESULT } from './stage-contract.js';
import { RuntimeError } from './errors.js';
import type { OperationJournal } from './operation-journal.js';
export interface OptionalRetainedV21 { originalRef: RawAnswerRefV21; technical: TechnicalStateV21 }
/** Operation8 has one natural scientific reply, plus strictly non-scientific repairs.
 * Originals belong to the calling author; no synthetic Worker answer is created. */
export class OptionalProofControlV21 extends V21Control {
  private original?: V0AnswerCollector;
  private originalStarted = false;
  private readonly retainedState: { value?: OptionalRetainedV21 };
  constructor(journal: OperationJournal, tools: ToolDefinition[], schema: TSchema,
    prepare: (value: unknown) => OptionalControlV21,
    private readonly saveBody: (text: string, collector: V0AnswerCollector, forceIncomplete: boolean) => Promise<OptionalRetainedV21>,
    private readonly cancelled: () => boolean) {
    const retained: { value?: OptionalRetainedV21 } = {};
    super(journal, tools.filter(tool=>tool.name===SUBMIT_RESULT), schema, value => {
      if (!retained.value || retained.value.technical.completeness !== 'complete') throw new RuntimeError('INVALID_OUTPUT');
      return { control: prepare(value), ...retained.value } satisfies OptionalTheoristResultV21;
    }, true, {
      optionalProof: true, singleScientificResponse: true, cancelled,
      resultReady: value => journal.capture({kind:'v21-optional-result-ready',result:value}),
      metadataTagPaths: [/^\/outcome\/tags$/, /^\/adoptions\/\d+\/outcome\/tags$/],
    });
    this.retainedState = retained;
  }
  get retained(): OptionalRetainedV21 | undefined { return this.retainedState.value; }
  override startDispatch(): void {
    super.startDispatch();
    if (!this.originalStarted) {
      this.originalStarted = true;
      this.original = new V0AnswerCollector(event=>{void this.journal.capture({kind:'v21-optional-text',event}).catch(()=>{});});
    }
  }
  override observe(event: AssistantMessageEvent): void {
    super.observe(event);
    if (!this.correction && !this.original?.terminal) this.original?.observe(event);
  }
  async preserveOriginal(forceIncomplete = false): Promise<void> {
    if (!this.retained && this.original?.text) {
      await this.journal.flush();
      this.retainedState.value = await this.saveBody(this.original.text,this.original,forceIncomplete);
      await this.journal.capture({kind:'v21-optional-original',...this.retainedState.value});
    }
  }
  override async prepareMessage(message: AssistantMessage): Promise<void> {
    // A save outage must not lose the exact reply needed for local reconciliation.
    await this.journal.capture({kind:'v21-optional-message',dispatch:this.journal.state.dispatches,correction:this.correction,message:{...message,content:message.content.filter(part=>part.type!=='thinking')}});
    for (const evidence of this.evidence.values()) await this.journal.capture({kind:'v21-optional-arguments',dispatch:this.journal.state.dispatches,evidence});
    await this.preserveOriginal();
    if (this.cancelled()) { this.fatal = new RuntimeError('BUDGET_EXHAUSTED'); return; }
    if (!this.retained || this.retained.technical.completeness !== 'complete' || !this.original?.text.trim()) { this.fatal = new RuntimeError('INVALID_OUTPUT'); return; }
    await super.prepareMessage(message);
  }
}
