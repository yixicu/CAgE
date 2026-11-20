<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    edit: 'M16 3l5 5-12 12-6 1 1-6L16 3ZM14 5l5 5', thumbsUp: 'M7 10v11H3V10h4ZM7 10l5-8 2 1v6h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7', thumbsDown: 'M7 14V3H3v11h4ZM7 14l5 8 2-1v-6h5a2 2 0 0 0 2-2l-2-8a2 2 0 0 0-2-2H7', more: 'M5 12h.01M12 12h.01M19 12h.01',
    chevronDown: 'M6 9l6 6 6-6', chevronUp: 'M6 15l6-6 6 6',
    capabilities: 'M12 2l4 4-4 4-4-4 4-4ZM5 13l4 4-4 4-4-4 4-4ZM19 13l4 4-4 4-4-4 4-4Z',
    plus: 'M12 5v14M5 12h14', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    back:'M20 12H4m6-6-6 6 6 6', panelRight:'M15 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1',
    panel: 'M9 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1',
    chat: 'M21 11a8 8 0 0 1-8 8H7l-4 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8Z',
    folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    tree: 'M12 3v7M5 10h14M5 10v6M19 10v6M3 16h4v5H3zM17 16h4v5h-4zM10 1h4v4h-4z',
    close: 'M6 6l12 12M6 18 18 6', arrow: 'M12 20V4M5 11l7-7 7 7',
    play: 'M7 4l14 8-14 8V4Z', pause: 'M8 5v14M16 5v14', stop: 'M5 5h14v14H5z',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2',
    power: 'M12 2v10M6 5a9 9 0 1 0 12 0', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    upload: 'M12 16V3M7 8l5-5 5 5M4 16v5h16v-5', check: 'M5 12l4 4L19 6',
  };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] || paths.file} /></svg>
