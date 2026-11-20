<script lang="ts">
  /** Original geometric lettering, not a bundled font or converted font outline. */
  let { decorative = false }: { decorative?: boolean } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5.64 0 554 156" class="block h-auto w-[clamp(280px,38vw,480px)] max-w-full text-brand" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'CAgE'} aria-hidden={decorative ? true : undefined} focusable="false">
  <!-- Horizontal viewport gutters are balanced around actual stroke bounds. -->
  <g fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <!-- Broad open C; an arch-shaped A; single-storey g with a visible descender. -->
    <path d="M92 34 C81 16 57 12 39 23 C10 41 10 80 35 98 C54 112 79 108 92 89" />
    <path d="M174 104 V53 C174 7 246 7 246 53 V104 M174 70 H246" />
    <path d="M392 62 A34 34 0 1 1 324 62 A34 34 0 1 1 392 62 V109 C392 139 365 151 342 132" />
    <!-- Rounded modular E, with a shorter middle arm to reduce visual mass. -->
    <path d="M526 24 H478 V104 H526 M478 64 H518" />
  </g>
</svg>
