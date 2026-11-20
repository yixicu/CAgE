import type { PositionedNode } from './layout';
type Graph = { width: number; height: number; nodes: PositionedNode[] };
export type Viewport = { left: number; top: number; width: number; height: number };
export type ScrollAnchor = { key: string; dx: number; dy: number };
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const clamp = (value: number, max: number) => Math.max(0, Math.min(finite(value), Math.max(0, finite(max))));
export function captureAnchor(graph: Graph, view: Viewport): ScrollAnchor | undefined {
  const visible = graph.nodes.filter(node => node.x + node.width > view.left && node.x < view.left + view.width && node.y + node.height > view.top && node.y < view.top + view.height);
  const node = visible.sort((a, b) => Math.hypot(a.x - view.left, a.y - view.top) - Math.hypot(b.x - view.left, b.y - view.top) || a.item.key.localeCompare(b.item.key))[0];
  return node ? { key: node.item.key, dx: node.x - view.left, dy: node.y - view.top } : undefined;
}
export function reconcileViewport(graph: Graph, view: Viewport, anchor?: ScrollAnchor) {
  const node = anchor && graph.nodes.find(node => node.item.key === anchor.key);
  return { left: clamp(node && anchor ? node.x - anchor.dx : view.left, graph.width - view.width), top: clamp(node && anchor ? node.y - anchor.dy : view.top, graph.height - view.height) };
}
export function revealNode(node: PositionedNode, view: Viewport, graph: Pick<Graph, 'width' | 'height'>) {
  const margin = 24;
  const reveal = (start: number, size: number, offset: number, window: number) => start < offset + margin ? start - margin : start + size > offset + window - margin ? start + size - window + margin : offset;
  return { left: clamp(reveal(node.x, node.width, view.left, view.width), graph.width - view.width), top: clamp(reveal(node.y, node.height, view.top, view.height), graph.height - view.height) };
}
