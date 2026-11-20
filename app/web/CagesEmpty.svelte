<script lang="ts">
  let { message, showHint = true }: { message: string; showHint?: boolean } = $props();
</script>

<div class="cages-empty" role="status">
  <span aria-hidden="true">◇</span>
  <p>{message}</p>
  {#if showHint}<p class="hint">import existing cages to Maintenance...or let cages grow itself.</p>{/if}
</div>

<style>
  .cages-empty {
    display: grid;
    align-content: center;
    justify-items: center;
    box-sizing: border-box;
    padding: 24px;
    text-align: center;
    color: var(--color-muted);
  }
  span { font-size: 42px; line-height: 1; opacity: .42; margin-bottom: 14px; }
  p { margin: 0; font-size: 14px; line-height: 1.7; letter-spacing: .075em; }
  .hint { margin-top: 5px; max-width: 100%; font-size: 13px; letter-spacing: .095em; color: var(--color-placeholder); text-wrap: balance; }
</style>
