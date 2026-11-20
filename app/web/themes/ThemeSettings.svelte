<script lang="ts">
 import {themes,themeStyle} from './catalog';
 import {currentTheme,selectTheme,themeNotice} from './preference';
 import StartPageBackdrop from './StartPageBackdrop.svelte';
 import SuppliedWordmark from '../SuppliedWordmark.svelte';
 import { startPageArtwork } from './start-page-assets';
</script>
<section aria-labelledby="appearance-title" class="space-y-5">
 <div><h2 id="appearance-title" class="text-lg text-ink">Appearance</h2></div>
 <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" role="group" aria-label="Color themes">
 {#each themes as theme}
  <button class="theme-option relative flex-col items-stretch gap-0 p-0 overflow-hidden rounded-panel border text-left" class:chosen={$currentTheme.id===theme.id} aria-pressed={$currentTheme.id===theme.id} aria-label={`${theme.name} theme`} onclick={()=>selectTheme(theme.id)} style={themeStyle(theme)}>
   <span class="relative block h-32 w-full overflow-hidden bg-canvas"><StartPageBackdrop themeId={theme.id}/><span class="absolute inset-0 flex items-center justify-center text-brand"><SuppliedWordmark decorative compact /></span></span>
   <span class="flex items-center justify-between gap-2 px-4 py-3 bg-surface text-ink"><span><strong class="block text-sm font-medium">{theme.name}</strong><span class="text-xs text-muted">{startPageArtwork(theme.id).description}</span></span><span class="text-accent text-lg w-5" aria-hidden="true">{$currentTheme.id===theme.id?'✓':''}</span></span>
  </button>
 {/each}
 </div>
 {#if $themeNotice}<p role="status" class="text-sm text-muted">{$themeNotice}</p>{/if}
</section>
