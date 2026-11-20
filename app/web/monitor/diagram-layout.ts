import type { DiagramView } from './diagram-view';
export interface NodeBox { x: number; y: number; left: number; right: number; top: number; bottom: number }
export interface DiagramGeometry { width: number; height: number; points: Record<string, NodeBox> }
export interface RoutedPath { id: string; path: string; active: boolean; label?: string }
/** Layout only. Share feeders only when their scientific source is identical. */
export function routeDiagram(diagram: DiagramView, geometry: DiagramGeometry) {
  const point = (id: string) => geometry.points[id];
  const main: RoutedPath[] = [];
  for (let i = 0; i < diagram.nodes.length - 1; i++) {
    const from = diagram.nodes[i].id, to = diagram.nodes[i + 1].id, a = point(from), b = point(to);
    if (a && b) main.push({ id: `${from}:${to}`, path: `M${a.x} ${a.bottom} L${b.x} ${b.top}`, active: diagram.live && (diagram.activeIds.includes(from) || diagram.activeIds.includes(to)) });
  }
  const learning = diagram.branches.filter(branch => ['skill', 'decision', 'strategy'].includes(branch.kind) && point(branch.id) && point(branch.sourceId));
  const groups = [...new Set(learning.map(branch => branch.sourceId))].sort((a, b) => Math.min(...learning.filter(branch => branch.sourceId === a).map(branch => point(branch.id)!.y)) - Math.min(...learning.filter(branch => branch.sourceId === b).map(branch => point(branch.id)!.y)));
  const mains = diagram.nodes.map(node => point(node.id)).filter(Boolean);
  const leaves = diagram.branches.map(branch => point(branch.id)).filter(Boolean);
  const left = Math.max(0, ...mains.map(item => item.right));
  const right = leaves.length ? Math.min(...leaves.map(item => item.left)) : geometry.width;
  const feeders: RoutedPath[] = [], stems: RoutedPath[] = [], inputs: RoutedPath[] = [], outputs: RoutedPath[] = [];
  for (const [index, source] of groups.entries()) {
    const members = learning.filter(branch => branch.sourceId === source), a = point(source)!;
    const rail = left + (right - left) * (index + 1) / (groups.length + 2);
    const ys = members.map(branch => point(branch.id)!.y - 4);
    feeders.push({ id: source, path: `M${rail} ${Math.min(a.y - 4, ...ys)} V${Math.max(a.y - 4, ...ys)}`, active: false, label: 'Conditional work from this source only; not a mandatory stage.' });
    stems.push({ id: source, path: `M${a.right} ${a.y - 4} H${rail}`, active: false });
    for (const branch of members) {
      const b = point(branch.id)!;
      inputs.push({ id: branch.id, path: `M${rail} ${b.y - 4} H${b.left}`, active: branch.running, label: branch.condition });
    }
  }
  for (const [index, branch] of diagram.branches.entries()) {
    const a = point(branch.id), target = point(branch.targetId), source = point(branch.sourceId);
    if (!a || !target || !source) continue;
    const feedbackRail = left + (right - left) * (index + 1) / (diagram.branches.length + 1);
    const inputRail = left + (right - left) * .85;
    if (branch.kind === 'user-input') {
      outputs.push({ id: branch.id, path: `M${a.left} ${a.y + 4} H${feedbackRail} V${target.y + 4} H${target.right}`, active: branch.running, label: 'Queued user input applies at the next planning boundary, not to current frozen work.' });
    } else if (branch.kind === 'worker' || branch.kind === 'computation') {
      inputs.push({ id: branch.id, path: `M${source.right} ${source.y - 4} H${inputRail} V${a.y - 4} H${a.left}`, active: branch.running, label: branch.condition });
      outputs.push({ id: branch.id, path: `M${a.left} ${a.y + 4} H${feedbackRail} V${target.y + 4} H${target.right}`, active: branch.running, label: 'Scoped evidence returns to the Theorist.' });
    } else if (branch.kind === 'documents') {
      inputs.push({ id: branch.id, path: `M${source.right} ${source.y - 4} H${inputRail} V${a.y - 4} H${a.left}`, active: branch.running, label: branch.condition });
      outputs.push({ id: branch.id, path: `M${a.left} ${a.y + 4} H${feedbackRail} V${target.y + 4} H${target.right}`, active: branch.running, label: 'Documents join the existing commit.' });
    } else {
      // Keep feedback in the empty gutter, never hidden behind sibling cards.
      outputs.push({ id: branch.id, path: `M${a.left} ${a.y + 4} H${feedbackRail} V${target.y + 4} H${target.right}`, active: branch.running, label: 'Published updates affect future rounds only.' });
    }
  }
  const first = point(diagram.nodes[0]?.id), last = point(diagram.nodes.at(-1)?.id ?? '');
  const repeat = first && last ? `M${last.left} ${last.y} H1 V${first.y} H${first.left}` : '';
  return { main, feeders, stems, inputs, outputs, repeat };
}
