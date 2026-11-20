<script lang="ts">
 import type { CrystalTheme } from './catalog';
 import {crystalClusters} from './crystal-geometry';
 let {theme,compact=false}:{theme:CrystalTheme;compact?:boolean}=$props();
 const uid=$props.id();let width=$state(1200);
 let narrow=$derived(width<600&&!compact);
 let groups=$derived(crystalClusters(theme,narrow));
</script>
<div class="absolute inset-0 pointer-events-none overflow-hidden" bind:clientWidth={width}>
<svg class="absolute inset-0 h-full w-full" viewBox={narrow?'0 0 700 960':'0 0 1440 960'} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
 <defs>
  <radialGradient id={`${uid}-quiet`}><stop stop-color={theme.colors.canvas}/><stop offset=".6" stop-color={theme.colors.canvas} stop-opacity=".96"/><stop offset="1" stop-color={theme.colors.canvas} stop-opacity="0"/></radialGradient>
  {#each groups as group,g}{#each group as face,i}<linearGradient id={`${uid}-${g}-${i}`} x1="0" y1="0" x2="1" y2="1"><stop stop-color={face.fill}/><stop offset="1" stop-color={face.shade}/></linearGradient>{/each}{/each}
 </defs>
 <rect width="1440" height="960" fill={theme.colors.canvas}/>
 {#each groups as group,g}<g data-crystal-cluster={g}>
  {#each group as face,i}<polygon points={face.points} fill={`url(#${uid}-${g}-${i})`} fill-opacity={theme.dark?.66:theme.material?.opacity??.62} stroke={face.edge} stroke-opacity={theme.dark?.13:.48} stroke-width=".8" stroke-linejoin="round"/>{/each}
 </g>{/each}
 <ellipse cx={narrow?300:760} cy="405" rx={narrow?260:520} ry="440" fill={`url(#${uid}-quiet)`}/>
</svg>
</div>
