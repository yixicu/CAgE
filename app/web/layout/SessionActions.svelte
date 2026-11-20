<script lang="ts">
  import Icon from '../Icon.svelte';
  let { groups=[], group, onmove, name, archived = false, running = false, disabled = false, onaction }: {
    groups?:string[]; group?:string; onmove?:(group:string)=>Promise<void>; name: string; archived?: boolean; running?: boolean; disabled?: boolean;
    onaction: (action: 'archive' | 'restore' | 'export' | 'delete') => void;
  } = $props();
  const id = $props.id();
  let popup = $state<HTMLDivElement>(), trigger = $state<HTMLButtonElement>();
  let open = $state(false), left = $state(0), top = $state(0);
  let moving=$state(false), destination=$state('');
  function position() {
    moving=false;destination=group??'';
    const rect = trigger!.getBoundingClientRect();
    left = Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184));
    top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 160));
  }
  function choose(action: 'archive' | 'restore' | 'export' | 'delete') {
    popup?.hidePopover(); trigger?.focus({ preventScroll: true }); onaction(action);
  }
</script>

<button type="button" class="session-action-trigger" bind:this={trigger} aria-label={`Session actions for ${name}`} title="Session actions"
  aria-expanded={open} popovertarget={id} {disabled} onclick={position}><Icon name="plus" size={14} /></button>
<div id={id} bind:this={popup} popover="auto" ontoggle={event => open = event.newState === 'open'}
  class="session-action-popup" style:left={`${left}px`} style:top={`${top}px`}>
  {#if onmove}
    {#if moving}
      <form onsubmit={async e=>{e.preventDefault();await onmove?.(destination.trim());popup?.hidePopover()}}>
        <label>Move to<input aria-label="Session group" bind:value={destination} maxlength="80" placeholder="Unclassified" list={id+'-groups'}/></label>
        <datalist id={id+'-groups'}>{#each groups as entry}<option value={entry}></option>{/each}</datalist>
        <button type="submit">Move</button>
      </form>
    {:else}<button type="button" onclick={()=>moving=true}>Move to group…</button>{/if}
  {/if}
  <button type="button" onclick={() => choose(archived ? 'restore' : 'archive')}>{archived ? 'Unarchive' : 'Archive'}</button>
  <button type="button" onclick={() => choose('export')}>Export / handoff</button>
  <button type="button" class="text-danger" disabled={running} title={running ? 'Stop research before deleting this session' : undefined} onclick={() => choose('delete')}>Delete</button>
</div>

<style>
  .session-action-trigger {
    flex: none; width: 28px; min-height: 28px; padding: 0; border: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--color-muted); background: transparent;
  }
  .session-action-trigger:hover, .session-action-trigger[aria-expanded='true'] { background: var(--color-hover); color: var(--color-accent); }
  .session-action-popup {
    position: fixed; inset: auto; margin: 0; width: 176px; max-width: calc(100vw - 16px);
    padding: 6px; border: 1px solid var(--color-line); border-radius: var(--radius-control);
    background: var(--color-surface); color: var(--color-ink); box-shadow: 0 4px 18px #0002;
    font-family: var(--font-ui);
  }
  .session-action-popup:popover-open { display: grid; gap: 2px; }
  .session-action-popup > button { width: 100%; min-height: 36px; justify-content: flex-start; padding: 6px 10px; border: 0; font-size: 12px; }
  @media (pointer: coarse) { .session-action-trigger { width: 36px; min-height: 36px; } .session-action-popup > button { min-height: 44px; } }
</style>
