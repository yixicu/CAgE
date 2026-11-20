<script lang="ts">
  import StandardWordmark from './StandardWordmark.svelte';
  /** Shared home/conversation rail identity, using the exact supplied outlines. */
  let { decorative = false }: { decorative?: boolean } = $props();
</script>

<span class="block w-24 max-w-full shrink-0" data-navigation-wordmark>
  <StandardWordmark {decorative} />
</span>
