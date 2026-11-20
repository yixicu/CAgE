<script lang="ts">
  import { onMount } from 'svelte';
  import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
  import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  let { data, name }: { data: Uint8Array; name: string } = $props();
  let canvas: HTMLCanvasElement;
  let pdf: PDFDocumentProxy | undefined;
  let renderTask: RenderTask | undefined;
  let page = $state(1);
  let pages = $state(0);
  let loading = $state(true);
  let error = $state('');
  let pageText = $state('');
  let zoom = $state(1);
  let serial = 0;
  async function renderPage() {
    if (!pdf || !canvas) return;
    const version = ++serial;
    loading = true;
    try {
      renderTask?.cancel();
      const documentPage = await pdf.getPage(page);
      if (version !== serial) return;
      const original = documentPage.getViewport({ scale: 1 });
      const width = Math.min(canvas.parentElement?.clientWidth ?? 720, 1000);
      const scale = Math.max(0.3, (width - 32) / original.width) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = documentPage.getViewport({ scale: scale * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / ratio}px`;
      canvas.style.height = `${viewport.height / ratio}px`;
      renderTask = documentPage.render({ canvas, viewport });
      await renderTask.promise;
      const text = await documentPage.getTextContent();
      if (version === serial) pageText = text.items.map(item => 'str' in item ? item.str : '').join(' ');
    } catch (cause) {
      if (version === serial && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) error = 'Unable to render this PDF page.';
    } finally { if (version === serial) loading = false; }
  }
  onMount(() => {
    GlobalWorkerOptions.workerSrc = workerUrl;
    const task = getDocument({ data: data.slice(), enableXfa: false });
    let disposed = false;
    task.promise.then(document => {
      if (disposed) { return; }
      pdf = document; pages = document.numPages; void renderPage();
    }).catch(() => { error = 'Unable to open this PDF. It may be encrypted or unsupported.'; loading = false; });
    return () => { disposed = true; serial += 1; renderTask?.cancel(); void task.destroy(); };
  });
  function move(delta: number) { page += delta; error = ''; void renderPage(); }
  function changeZoom(value: number) { zoom = Math.max(0.5, Math.min(3, value)); error = ''; void renderPage(); }
</script>
<div class="pdf-view">
  <div class="toolbar">
    <strong>{name}</strong>
    <div class="inline-actions">
      <button onclick={() => move(-1)} disabled={page <= 1 || loading} aria-label="Previous PDF page">←</button>
      <span>Page {page} of {pages || '…'}</span>
      <button onclick={() => move(1)} disabled={page >= pages || loading} aria-label="Next PDF page">→</button>
      <button onclick={() => changeZoom(zoom - 0.25)} disabled={zoom <= 0.5 || loading} aria-label="Zoom out PDF" title="Zoom out">−</button>
      <button onclick={() => changeZoom(1)} disabled={loading} aria-label="Fit PDF width" title="Fit width">{Math.round(zoom * 100)}%</button>
      <button onclick={() => changeZoom(zoom + 0.25)} disabled={zoom >= 3 || loading} aria-label="Zoom in PDF" title="Zoom in">＋</button>
    </div>
  </div>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if loading}<p class="muted" role="status">Loading PDF…</p>{/if}
  <div class="pdf-canvas"><canvas bind:this={canvas} aria-label={`${name}, page ${page}`}></canvas></div>
  {#if pageText}<details><summary>Accessible page text</summary><p class="pdf-text">{pageText}</p></details>{/if}
</div>
