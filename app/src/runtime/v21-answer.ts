import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
export type AnswerCaptureEvent =
  | { kind: 'delta'; index: number; text: string }
  | { kind: 'block'; index: number; text: string }
  | { kind: 'snapshot'; index: number; text: string }
  | { kind: 'snapshot-delta'; index:number; offset:number; text:string }
  | { kind: 'terminal'; text: string; stopReason: string; protocolInvalid: boolean; mismatch?: boolean; rawStopReason?:string };
/** Public SDK text only. Mutable partial objects are never retained. Final snapshots
 * are authoritative; interrupted snapshots may only extend compatible public blocks. */
export class V21AnswerCollector {
  private blocks = new Map<number, string[]>();
  private terminalText?: string;
  private snapshot = new Map<number, string>();
  private snapshotParts = new Map<number, {length:number;parts:string[]}>();
  stopReason?: string;
  rawStopReason?: string;
  terminal = false;
  protocolInvalid = false;
  mismatch = false;
  constructor(private readonly persist?: (event: AnswerCaptureEvent) => void) {}
  observe(event: AssistantMessageEvent): void {
    if ('partial' in event) {
      const snapshot = new Map<number, string>();
      event.partial.content.forEach((part, index) => { if (part.type === 'text') snapshot.set(index, part.text); });
      for (const [index,text] of snapshot) {
        const previous = this.snapshotParts.get(index) ?? {length:0,parts:[]};
        if (text.length < previous.length || (text.length === previous.length && text !== (this.snapshot.get(index) ?? ''))) {
          this.mismatch = true; this.snapshotParts.set(index,{length:text.length,parts:[text]}); this.persist?.({kind:'snapshot',index,text});
        } else if (text.length > previous.length) {
          const suffix = text.slice(previous.length); this.persist?.({kind:'snapshot-delta',index,offset:previous.length,text:suffix});
          previous.parts.push(suffix); previous.length=text.length; this.snapshotParts.set(index,previous);
        }
      }
      this.snapshot = snapshot;
    }
    if (event.type.startsWith('toolcall_')) this.protocolInvalid = true;
    if (event.type === 'text_delta') {
      const row = this.blocks.get(event.contentIndex) ?? [];
      row.push(event.delta); this.blocks.set(event.contentIndex, row);
      this.persist?.({ kind: 'delta', index: event.contentIndex, text: event.delta });
    } else if (event.type === 'text_end') {
      const prior = this.blocks.get(event.contentIndex)?.join('');
      if (prior !== undefined && prior !== event.content) this.mismatch = true;
      this.blocks.set(event.contentIndex, [event.content]);
      this.persist?.({ kind: 'block', index: event.contentIndex, text: event.content });
    }
    if (event.type === 'done' || event.type === 'error') this.finish(event.type === 'done' ? event.message : event.error);
  }
  private partialText(): string {
    const indices = [...new Set([...this.blocks.keys(), ...this.snapshot.keys()])].sort((a,b) => a-b);
    return indices.map(index => {
      const streamed = this.blocks.get(index)?.join('') ?? '', snapshot = this.snapshot.get(index) ?? '';
      if (snapshot.startsWith(streamed)) return snapshot;
      if (streamed.startsWith(snapshot)) return streamed;
      this.mismatch = true; return streamed; // Never splice contradictory scientific text.
    }).join('');
  }
  finish(message: AssistantMessage): void {
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
    if (message.content.some(part => part.type === 'toolCall')) this.protocolInvalid = true;
    for (const [index,row] of this.snapshotParts) if (this.snapshot.get(index) !== row.parts.join('')) this.mismatch = true;
    const partial = this.partialText();
    const interrupted = ['error', 'aborted'].includes(message.stopReason);
    if (text) {
      if (partial && partial !== text && !(interrupted && text.startsWith(partial))) this.mismatch = true;
      this.terminalText = interrupted && partial.startsWith(text) ? partial : text;
    } else {
      this.terminalText = partial;
      if (partial && !interrupted) this.mismatch = true;
    }
    if (typeof message.rawStopReason === 'string') this.rawStopReason = message.rawStopReason;
    this.stopReason = message.stopReason; this.terminal = true;
    this.persist?.({ kind: 'terminal', text: this.terminalText, stopReason: message.stopReason, protocolInvalid: this.protocolInvalid, mismatch:this.mismatch, ...(this.rawStopReason === undefined ? {} : {rawStopReason:this.rawStopReason}) });
  }
  restore(event: AnswerCaptureEvent): void {
    if (event.kind === 'delta') { const row = this.blocks.get(event.index) ?? []; row.push(event.text); this.blocks.set(event.index, row); }
    else if (event.kind === 'snapshot') this.snapshot.set(event.index,event.text);
    else if (event.kind === 'snapshot-delta') { const before=this.snapshot.get(event.index) ?? ''; if (before.length !== event.offset) this.mismatch=true; else this.snapshot.set(event.index,before+event.text); }
    else if (event.kind === 'block') this.blocks.set(event.index, [event.text]);
    else { this.terminalText = event.text; this.stopReason = event.stopReason; this.protocolInvalid = event.protocolInvalid; this.mismatch = !!event.mismatch; this.rawStopReason = event.rawStopReason; this.terminal = true; }
  }
  get text(): string { return this.terminalText ?? this.partialText(); }
  get complete(): boolean { return this.terminal && this.stopReason === 'stop' && !this.protocolInvalid && !this.mismatch && !!this.text; }
}
