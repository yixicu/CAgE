import type { HypothesisNode } from '../src/engine/types';

/** Execution completion and scientific promotion are separate. Use snapshot
 * fields, not transient SSE messages, so refresh preserves the actual count. */
export function awaitsSynthesis(node: HypothesisNode): boolean {
  return node.status === 'active' && node.executionStatus !== undefined;
}

export function activeWorkerNodes(nodes: readonly HypothesisNode[] = []): HypothesisNode[] {
  return nodes.filter(node => node.parentId !== undefined && node.status === 'active' && !awaitsSynthesis(node));
}

export function researchNodeLabel(node: HypothesisNode): string {
  return awaitsSynthesis(node)
    ? `Execution ${node.executionStatus} · awaiting synthesis`
    : node.status.replaceAll('_', ' ');
}
