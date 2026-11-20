import type { ProjectSummary } from '../api';

export interface HistorySession {
  project: ProjectSummary;
  children: HistorySession[];
  label: string;
  matches: boolean;
}

/** Read-only grouping: a missing or cyclic parent must never hide a session. */
export function sessionHistory(projects: readonly ProjectSummary[], search = '', context: readonly ProjectSummary[] = projects): HistorySession[] {
  // Keep the first occurrence so keyed rendering remains safe during a refresh.
  const summaries = new Map<string, ProjectSummary>();
  const catalog = new Map(context.map(project => [project.id, project]));
  for (const project of projects) if (!summaries.has(project.id)) summaries.set(project.id, project);
  const parents = new Map<string, string>();
  for (const project of summaries.values()) {
    const parentId = project.fork?.parentSessionId;
    if (parentId && parentId !== project.id && summaries.has(parentId)) parents.set(project.id, parentId);
  }

  // Break one edge per malformed cycle, without recursing through saved history.
  const resolved = new Set<string>();
  for (const id of summaries.keys()) {
    const path = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && !resolved.has(cursor)) {
      if (path.has(cursor)) { parents.delete(cursor); break; }
      path.add(cursor);
      cursor = parents.get(cursor);
    }
    for (const visited of path) resolved.add(visited);
  }

  const query = search.trim().toLocaleLowerCase();
  const matching = new Set([...summaries.values()]
    .filter(project => project.name.toLocaleLowerCase().includes(query))
    .map(project => project.id));
  const visible = new Set<string>();
  for (const id of matching) {
    let cursor: string | undefined = id;
    while (cursor !== undefined && !visible.has(cursor)) {
      visible.add(cursor);
      cursor = parents.get(cursor);
    }
  }

  const nodes = new Map<string, HistorySession>();
  for (const project of summaries.values()) {
    if (!visible.has(project.id)) continue;
    const fork = project.fork;
    const parent = fork && catalog.get(fork.parentSessionId);
    // fork.number is the parent's engine scope, not its visible inherited Epoch.
    const origin = fork ? ` · Branch of ${parent?.name || 'unavailable session'}` : '';
    const unavailable = fork && !parents.has(project.id) && (!parent || summaries.has(fork.parentSessionId)) ? ' · Parent link unavailable' : '';
    nodes.set(project.id, { project, children: [], label: `${project.name}${origin}${unavailable}`, matches: matching.has(project.id) });
  }

  const roots: HistorySession[] = [];
  // Bootstrap order is retained for roots and for siblings within each parent.
  for (const [id, node] of nodes) {
    const parentId = parents.get(id);
    const parent = parentId && nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
