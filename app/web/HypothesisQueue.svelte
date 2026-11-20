<script lang="ts">
  import type { UserCommand } from './api';
  import MarkdownView from './MarkdownView.svelte';
  import { commandDisplay } from './research-view-v2';
  let { commands, active, boundary }: { commands: UserCommand[]; active: boolean; boundary: string } = $props();
</script>

{#if commands.length}
  <details class="hypothesis-queue" aria-label="Hypothesis modifications pending planning completion">
    <summary><span>Theorist queue</span><span class="queue-count">{commands.length}</span><span class="queue-timing">{active ? 'Pending' : 'On next start'}</span></summary>
    <ol>{#each commands as command (command.id)}<li><MarkdownView content={commandDisplay(command)} /></li>{/each}</ol>
  </details>
  <span class="visually-hidden" role="status">{commands.length} hypothesis modification{commands.length === 1 ? '' : 's'} awaiting planning completion at a safe {boundary} boundary; no confirmed adoption yet.</span>
{/if}
