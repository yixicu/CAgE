import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { V21AnswerCollector, type AnswerCaptureEvent } from './v21-answer.js';
/** Text integrity only. Original terminal/control shape is independently checked by V0Control. */
export class V0AnswerCollector {
  private readonly textCollector: V21AnswerCollector;
  originalStopReason?: string;
  constructor(persist?: (event: AnswerCaptureEvent) => void) { this.textCollector = new V21AnswerCollector(persist); }
  observe(event: AssistantMessageEvent): void {
    if (event.type === 'done' || event.type === 'error') {
      const message = event.type === 'done' ? event.message : event.error;
      this.originalStopReason = message.stopReason;
      const projected: AssistantMessage = {...message,content:message.content.filter(part=>part.type==='text'),stopReason:message.stopReason==='toolUse'?'stop':message.stopReason};
      this.textCollector.finish(projected);
    } else if (!event.type.startsWith('toolcall_')) this.textCollector.observe(event);
  }
  get text(): string { return this.textCollector.text; }
  get complete(): boolean { return this.textCollector.complete; }
  get terminal(): boolean { return this.textCollector.terminal; }
  get mismatch(): boolean { return this.textCollector.mismatch; }
  get rawStopReason(): string | undefined { return this.textCollector.rawStopReason; }
}
