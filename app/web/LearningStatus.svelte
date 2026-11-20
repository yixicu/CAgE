<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type LearningTaskView } from './api';
  import Icon from './Icon.svelte';
  let { projects=[],projectId, kind, compact = false, onsettled = () => {}, onstate = () => {} }: {projects?:{id:string;name:string}[]; projectId?: string; kind?: 'fast' | 'slow'; compact?: boolean; onsettled?: () => void | Promise<void>; onstate?: (tasks: LearningTaskView[], available: boolean) => void } = $props();
  let tasks = $state<LearningTaskView[]>([]);
  let error = $state('');
  let loaded = $state(false);
  let dismissed = $state<string[]>([]);
  let visible = $derived(tasks.filter(task => !kind || (kind === 'slow' ? task.kind === 'strategy' : task.kind !== 'strategy')));
  let activeTask = $derived(visible.find(task => task.status === 'running') || visible.find(task => task.status === 'queued'));
  let failure = $derived(visible.toReversed().find(task => task.status === 'failed' && !dismissed.includes(task.id)));
  const labels = { review: 'Moderator review', skill: 'Skill', decision: 'Decision', strategy: 'Specific Strategy', publication: 'Research registration' };
  const statuses = { queued: 'Queued', running: 'Learning', completed: 'Completed', 'no-change': 'No change', failed: 'Failed', paused: 'Paused' };
  const settled = (items: LearningTaskView[]) => items.filter(task => task.status === 'completed' || task.status === 'no-change').map(task => `${task.id}:${task.status}`).join('|');
  function dismiss(id: string) {
    dismissed = [...dismissed, id].slice(-100);
    try { sessionStorage.setItem('cage.learning.dismissed', JSON.stringify(dismissed)); } catch { /* Opaque IDs remain in memory when storage is unavailable. */ }
  }
  onMount(() => {
    if (compact) { try { const ids: unknown = JSON.parse(sessionStorage.getItem('cage.learning.dismissed') || '[]'); if (Array.isArray(ids)) dismissed = ids.filter((id): id is string => typeof id === 'string').slice(-100); } catch { /* No persisted dismissal. */ } }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const view = await api.learning(projectId);
        if (disposed) return;
        const changed = loaded && settled(tasks) !== settled(view.tasks);
        tasks = view.tasks; error = ''; loaded = true;
        onstate(tasks, true);
        if (changed) await onsettled();
      } catch (cause) {
        if (disposed) return;
        error = cause instanceof Error ? cause.message : 'Learning status unavailable.';
        onstate([], false);
      }
      if (!disposed) timer = setTimeout(() => void refresh(), tasks.some(task => task.status === 'queued' || task.status === 'running') ? 2000 : 10000);
    }
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  });
</script>

{#if compact}
  {#if error || activeTask || failure}<div class="flex-none border-b border-line px-7.5 py-1.5 text-xs" aria-label="Workspace learning">
    {#if error}<span class="text-muted" title={error}>Learning status unavailable</span>
    {:else if activeTask}<div class="flex items-center gap-2 text-muted" role="status"><Icon name="refresh" size={13} /><span>{statuses[activeTask.status]} · {labels[activeTask.kind]}</span></div>{/if}
    {#if failure}<div class="flex items-center justify-between gap-3" role="alert"><span>{labels[failure.kind]}{failure.kind === 'publication' ? '' : ' learning'} failed{failure.message ? `: ${failure.message}` : '.'}</span><button class="icon-button" aria-label="Dismiss learning failure" onclick={() => dismiss(failure!.id)}><Icon name="close" size={14} /></button></div>{/if}
  </div>{/if}
{:else}
<section class="capability-group" aria-label="Automatic learning">
  {#if error}<p class="notice error" role="alert">{error}</p>
  {:else if !loaded}<p class="muted small" role="status">Loading learning status…</p>
  {:else if !visible.length}<p class="empty-capability">No learning tasks yet.</p>
  {/if}
  {#if visible.length}<div class="ledger"><table><thead><tr><th>Skill / Strategy</th><th>Time</th><th>Session</th><th>Status</th></tr></thead><tbody>
    {#each visible.toReversed() as task (task.id)}<tr><td>{task.name || labels[task.kind]}</td><td>{task.createdAt?new Date(task.createdAt).toLocaleString():'—'}</td><td>{projects.find(p=>p.id===task.projectId)?.name??task.projectId}</td><td><span data-status={task.status} title={task.message}>{statuses[task.status]}</span></td></tr>{/each}
  </tbody></table></div>{/if}
</section>
{/if}
<style>
.ledger{max-height:22rem;overflow:auto;border:1px solid var(--color-line);border-radius:10px}table{border-collapse:collapse;width:100%;text-align:left;background:var(--color-surface)}th,td{padding:8px 12px;border-bottom:1px solid var(--color-line)}th{position:sticky;top:0;background:var(--color-rail);color:var(--color-muted);font-size:12px}td span{border-radius:12px;background:var(--color-rail);padding:2px 8px;white-space:nowrap}span[data-status=completed]{color:var(--color-success)}span[data-status=failed]{color:var(--color-danger)}
</style>
