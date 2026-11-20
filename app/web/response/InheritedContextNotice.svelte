<script lang="ts">
  let { limitations = [] }: { limitations?: string[] } = $props();
</script>
<details class="mb-4 rounded-lg border border-line bg-tint/30 px-3 py-2 text-xs text-muted">
  <summary class="cursor-pointer">Inherited · read-only{limitations.length ? ' · scope note' : ''}</summary>
  <p class="mb-0 mt-2">Saved public context and exact granted file versions remain parent-owned. This session writes only its own new work.</p>
  <p class="mb-0 mt-2">Private agent history, in-flight work, later parent changes and plugin credentials are not inherited. Ordinary shared-library access is unchanged.</p>
  {#each limitations as limitation}<p class="mb-0 mt-2">{limitation}</p>{/each}
</details>
