<script lang="ts">
  import type { TagTone } from './research-tags';
  let { label, tone = 'idle', kind = 'term', detail }: { label: string; tone?: TagTone; kind?: 'term' | 'agent' | 'status'; detail?: string } = $props();
  const foreground = $derived(`var(--color-${kind === 'agent' ? 'on-action' : tone})`);
  const background = $derived(`var(--color-${kind === 'agent' ? tone : tone === 'accent' ? 'selected' : `${tone}-soft`})`);
</script>
<span class="research-tag" data-tag-kind={kind} data-tag-tone={tone} title={detail}
  style:--tag-foreground={foreground} style:--tag-background={background}>{label}</span>
<style>
  .research-tag {
    display: inline-flex; align-items: center; min-width: 0; max-width: 100%;
    min-height: 22px; padding: 2px 7px; border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--tag-foreground) 18%, transparent);
    color: var(--tag-foreground); background: var(--tag-background);
    font: 11px/1.35 var(--font-ui); overflow-wrap: anywhere;
  }
  .research-tag[data-tag-kind='agent'] { font-weight: 600; }
</style>
