<script lang="ts">
  import { currentTheme } from './themes/preference';
  import { engineAsset, engineToneMatrix, engineTintMatrix } from './branding/engine-mark';
  let { size = 30 }: { size?: number } = $props();
  const instanceId = $props.id();
  const filterId = `engine-tint-${instanceId}`;
  const viewport = engineAsset.viewport;
</script>
<!-- The approved engine silhouette is shared unchanged across every theme. -->
<svg width={size} height={size} viewBox={`${viewport.x} ${viewport.y} ${viewport.size} ${viewport.size}`} aria-hidden="true" class="brand-mark">
  <defs>
    <filter id={filterId} x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values={engineToneMatrix()} />
      <feColorMatrix type="matrix" values={engineTintMatrix($currentTheme.id)} />
    </filter>
  </defs>
  <image href={engineAsset.url} width={engineAsset.width} height={engineAsset.height} filter={`url(#${filterId})`} />
</svg>
