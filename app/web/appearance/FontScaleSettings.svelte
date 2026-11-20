<script lang="ts">
  import { fontScale, fontScaleNotice, selectFontScale, MIN_FONT_SCALE, MAX_FONT_SCALE } from './font-scale';
  let dragging = false;
  function adjust(input: HTMLInputElement) {
    const value = input.valueAsNumber, tick = Math.round(value / 10) * 10;
    selectFontScale(dragging && Math.abs(tick-value)<=1 ? tick : value);
    input.value = String($fontScale);
  }
</script>
<svelte:window onpointerup={()=>dragging=false} onpointercancel={()=>dragging=false}/>
<section class="scale-row settings-panel" aria-label="Text size">
  <label for="font-scale">Text size</label>
  <input id="font-scale" type="range" min={MIN_FONT_SCALE} max={MAX_FONT_SCALE} step="1" value={$fontScale}
    aria-valuetext={`${$fontScale}%`} onpointerdown={()=>dragging=true} onkeydown={()=>dragging=false} oninput={e=>adjust(e.currentTarget)}/>
  <output for="font-scale">{$fontScale}%</output><button disabled={$fontScale===100} onclick={()=>selectFontScale(100)}>Reset</button>
  {#if $fontScaleNotice}<small role="status">{$fontScaleNotice}</small>{/if}
</section>
<style>
.scale-row{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}.scale-row label{margin:0}.scale-row input{flex:1;min-width:70px;width:0;padding:0;accent-color:var(--color-accent)}output{min-width:4ch;font-variant-numeric:tabular-nums}
</style>