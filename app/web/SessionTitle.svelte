<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  let { title, editable = false, disabled = false, onopen, onsave }: {
    title: string; editable?: boolean; disabled?: boolean; onopen: () => void; onsave: (name: string) => Promise<void>;
  } = $props();
  let editing = $state(false), value = $state(''), saving = $state(false), error = $state('');
  let input = $state<HTMLInputElement>(), trigger = $state<HTMLButtonElement>();
  async function begin() { value = ''; error = ''; editing = true; await tick(); input?.focus(); }
  async function cancel() { if (saving) return; editing = false; await tick(); trigger?.focus(); }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (saving || disabled || !value.trim()) return;
    saving = true; error = '';
    try { await onsave(value.trim()); editing = false; await tick(); trigger?.focus(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Title could not be saved. Try again.'; }
    finally { saving = false; }
  }
</script>
<div class="session-title">
  {#if editing}
    <form class="inline-title-editor" onsubmit={save}>
      <input bind:this={input} bind:value maxlength="160" required aria-label="Session title" placeholder="Session title" disabled={saving} aria-invalid={!!error} onkeydown={event => {
        if (event.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void cancel(); }
      }} />
      <button class="icon-button" aria-label="Save session title" title="Save title (Enter)" disabled={disabled || saving || !value.trim()}><Icon name="check" size={16} /></button>
      <button class="icon-button" type="button" aria-label="Cancel rename" title="Cancel (Escape)" disabled={saving} onclick={cancel}><Icon name="close" size={16} /></button>
      {#if error}<p class="rename-error" role="alert">{error}</p>{/if}
    </form>
  {:else}
    <button class="workspace-title" onclick={onopen} title={title}>{title}</button>
    {#if editable}<button bind:this={trigger} class="icon-button" aria-label="Rename session" title={disabled ? 'Rename when research is idle' : 'Rename session'} {disabled} onclick={begin}><Icon name="edit" size={15} /></button>{/if}
  {/if}
</div>
