<script lang="ts">
  import { FIELD_CATALOG, type FieldId } from './taxonomy';
  let { glyph }: { glyph: FieldId } = $props();
</script>
<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-discipline={glyph}><path d={FIELD_CATALOG[glyph].path} /></svg>
