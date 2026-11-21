import type { RuntimeProgress } from '../runtime/pi-runtime.js';

/** Live operation projection. This never changes scientific state or persists history. */
export interface MonitorOperation {
  sessionId: string;
  role: RuntimeProgress['role'];
  task?: RuntimeProgress['task'];
  step?: RuntimeProgress['step'];
  toolName?: string;
  softDeadline?: RuntimeProgress['softDeadline'];
  budget?:RuntimeProgress['budget'];
  counters?:Pick<RuntimeProgress,'turns'|'toolCalls'|'tokens'|'costUsd'>;
}
export interface MonitorActivitySnapshot { commentary?:{epoch:number;text:string}[]; background?:{reports:boolean;map:boolean}; projectId: string; available: boolean; operations: MonitorOperation[] }
interface ActiveOperation { operation: MonitorOperation; tools: Map<string, string> }

export class MonitorActivity {
  private readonly notes=new Map<string,{epoch:number;text:string}[]>();
  private readonly projects = new Map<string, Map<string, ActiveOperation>>();

  observe(progress: RuntimeProgress): void {
    const { projectId, sessionId, status } = progress;
    let sessions = this.projects.get(projectId);
    if (status === 'invocation_start') {
      if (!sessions) this.projects.set(projectId, sessions = new Map());
      sessions.set(sessionId, { operation: { sessionId, role: progress.role, softDeadline: progress.softDeadline,...(progress.budget?{budget:structuredClone(progress.budget),counters:{turns:progress.turns,toolCalls:progress.toolCalls,tokens:progress.tokens,costUsd:progress.costUsd}}:{}),
        ...(progress.task ? { task: progress.task } : {}), ...(progress.step ? { step: progress.step } : {}) }, tools: new Map() });
      return;
    }
    if (!sessions) return;
    const active = sessions.get(sessionId);
    if (!active) return;
    if(progress.role==='theorist' && progress.commentary){
      const notes=this.notes.get(projectId)??[];
      this.notes.delete(projectId);
      notes.push({epoch:progress.commentary.epoch,text:progress.commentary.text.slice(0,8192)});
      this.notes.set(projectId,notes.slice(-32));
      if(this.notes.size>64)this.notes.delete(this.notes.keys().next().value!);
    }
    if(progress.budget){active.operation.budget=structuredClone(progress.budget);active.operation.counters={turns:progress.turns,toolCalls:progress.toolCalls,tokens:progress.tokens,costUsd:progress.costUsd};}
    if (progress.softDeadline) active.operation.softDeadline = { ...progress.softDeadline };
    if (status === 'invocation_end' || status === 'closed') {
      sessions.delete(sessionId);
      if (!sessions.size) this.projects.delete(projectId);
    } else if (status === 'settled') {
      // A Pi prompt may settle before output correction in the same invocation.
      active.tools.clear();
    } else if (status === 'tool' && progress.toolCallId && progress.toolName) {
      active.tools.set(progress.toolCallId, progress.toolName);
    } else if (status === 'tool_end' && progress.toolCallId) {
      active.tools.delete(progress.toolCallId);
    }
  }

  snapshot(projectId: string): MonitorActivitySnapshot {
    const operations: MonitorOperation[] = [];
    for (const active of this.projects.get(projectId)?.values() ?? []) {
      operations.push({ ...active.operation });
      for (const toolName of active.tools.values()) operations.push({ ...active.operation, toolName });
    }
    return { projectId, available: true, operations, commentary:this.notes.get(projectId)?.slice() };
  }
}
