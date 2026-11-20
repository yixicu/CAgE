<script lang="ts">
  import type { ResearchProjectV2 } from '../src/research/contracts/v2';
  import LogicBlock from './LogicBlock.svelte';
  let { project, onopen }: { project: ResearchProjectV2; onopen: (path: string) => void } = $props();
  let current = $derived(project.activeEpoch || project.epochs.at(-1));
  let tasks = $derived(current?.tasks || []);
  let live = $derived(tasks.filter(task => !project.results.some(result => result.taskId === task.id)));
  let resources = $derived(current?.snapshot.researchBoundary);
  let skillNames = $derived([...new Set(tasks.flatMap(task => task.way.skillRefs?.map(ref => resources?.skills.find(skill => skill.id === ref.id)?.name || ref.id) || [project.waySkills.find(skill => skill.id === task.way.waySkillId)?.method || task.way.waySkillId]))]);
  let strategyNames = $derived(['Occam', ...(current?.snapshot.policy.userRef ? ['User strategy'] : []), ...(current?.snapshot.strategy.specializedRefs || []).map(id => resources?.strategies.find(strategy => strategy.id === id)?.name || current?.snapshot.policy.strategies?.find(strategy => strategy.id === id)?.name || id)]);
</script>
<div class="execution-overview">
  <div class="flex flex-wrap gap-2 my-3"><span class="state-tag tone-running">{tasks.filter(task => task.state === 'running').length} working</span><span class="state-tag tone-idle">{tasks.length} tasks</span></div>
  {#each live as task (task.id)}<details class="live-task disclosure-list"><summary><span class="wrap-anywhere">{task.way.question}</span></summary><span class="state-tag tone-idle">{task.state}</span><LogicBlock conditions={task.way.assumptions.map(text => ({kind:'if',text}))} claim={task.way.targetProposition} label="try" otherwise={task.blockReason ? [task.blockReason] : []} /></details>{/each}
  <details class="disclosure-list"><summary>WaySkills <span class="count">{skillNames.length}</span></summary><ul class="resource-name-list">{#each skillNames as name}<li>{name}</li>{:else}<li class="text-muted">None selected</li>{/each}</ul></details>
  <details class="disclosure-list"><summary>Strategies <span class="count">{strategyNames.length}</span></summary><ul class="resource-name-list">{#each strategyNames as name}<li>{name}</li>{/each}</ul></details>
</div>
