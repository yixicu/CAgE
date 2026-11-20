<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './api';
  import type { V1SkillState } from '../src/learning/v1-skill-contracts';
  let { onchange }: { onchange: () => Promise<void> } = $props();
  let registry = $state<V1SkillState>();
  let error = $state('');
  let saving = $state(false);
  let message = $state('');
  onMount(() => { void api.v1Skills().then(value => { registry = value; }).catch(cause => { error = cause.message; }); });
  async function toggle(id: string, enabled: boolean) {
    if (!registry || saving) return;
    saving = true; error = '';
    try { registry = await api.selectV1Skill(id, enabled, registry.revision); message = 'Saved for the next round.'; await onchange(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Selection failed.'; registry = await api.v1Skills().catch(() => registry); }
    finally { saving = false; }
  }
</script>
<section class="capability-group" aria-label="V1 reviewed skills">
  <div class="group-heading"><h2>V1 · Reviewed skills</h2><span>{registry?.skills.length ?? 0}</span></div>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if message}<p class="save-state" role="status">{message}</p>{/if}
  {#if registry && !registry.skills.length}<p class="empty-capability">No reviewed methods yet.</p>{/if}
  {#each registry?.skills ?? [] as skill (skill.id)}
    <article class="capability-row">
      <div class="resource-heading"><div><h3>{skill.content.context}</h3><span class="resource-origin">Reviewed · {skill.scope.terms.join(', ')}</span></div><label class="resource-switch"><span class="visually-hidden">Load {skill.id}</span><input type="checkbox" role="switch" aria-label={`Load ${skill.id}`} checked={skill.enabled} disabled={saving} onchange={event => void toggle(skill.id, event.currentTarget.checked)} /></label></div>
      <p>{skill.content.lesson}</p>
      <details><summary>Evidence and limits</summary><p>{skill.review.reason}</p><p>{skill.content.limitations}</p><dl><dt>Reviewed cases</dt><dd>{skill.evidence.length}</dd><dt>Version</dt><dd>{skill.version.slice(0, 12)}</dd></dl></details>
    </article>
  {/each}
</section>
