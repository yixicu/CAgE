<script lang="ts">
  import { startPageArtwork } from './start-page-assets';
  let { themeId }: { themeId: string } = $props();
  const artwork = $derived(startPageArtwork(themeId));
</script>

<!-- One continuous, replaceable artwork layer beneath sidebar and main pane.
     Foreground identity, editable subtitle, input and navigation are separate. -->
<img
  src={artwork.src}
  alt=""
  aria-hidden="true"
  draggable="false"
  decoding="async"
  class={`absolute inset-0 h-full w-full object-fill pointer-events-none select-none ${artwork.opacityClass}`}
  data-start-page-backdrop={themeId}
  data-blue-reference-backdrop={themeId === 'blue' ? '' : undefined}
/>
