import type { CheckpointPage } from '../checkpoint-view';

export interface ResponseExport { readonly filename: string; readonly content: string }
export interface WritableExport { write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
export interface ExportHost {
  pick?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<WritableExport> }>;
  download: (blob: Blob, filename: string) => void;
}
export type ExportResult = 'saved' | 'download-started' | 'cancelled';
/** Undefined content means the selected original is still loading or unavailable. */
export interface DisplayedOriginal { key: string; id: string; label: string; content?: string }
export function displayedResponse(page?: CheckpointPage, original?: DisplayedOriginal) {
  if (original) return original.content === undefined ? undefined : { content: original.content, label: original.label };
  return page ? { content: page.content, label: page.label } : undefined;
}
export function responseExport(project: { name: string }, page: CheckpointPage): ResponseExport {
  const stem = `${project.name}-${page.label}-${page.id}`.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/g, '').slice(0, 140).replace(/[. ]+$/g, '') || 'research-response';
  const safe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem) ? `research-${stem}` : stem;
  // Exact saved presentation Markdown. No re-rendering, trimming, BOM or fabricated proof text.
  return Object.freeze({ filename: `${safe}.md`, content: page.content });
}
export function browserExportHost(): ExportHost {
  const browser = window as Window & { showSaveFilePicker?: ExportHost['pick'] };
  return {
    ...(browser.showSaveFilePicker ? { pick: browser.showSaveFilePicker.bind(browser) } : {}),
    download(blob, filename) {
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.hidden = true;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    },
  };
}
/** Invoke directly from the click handler: no awaited work before the native picker. */
export async function saveResponse(snapshot: ResponseExport, host: ExportHost): Promise<ExportResult> {
  if (!host.pick) { host.download(new Blob([snapshot.content], { type: 'text/markdown;charset=utf-8' }), snapshot.filename); return 'download-started'; }
  let handle: Awaited<ReturnType<NonNullable<ExportHost['pick']>>>;
  try { handle = await host.pick({ suggestedName: snapshot.filename, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] }); }
  catch (error) { if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled'; throw error; }
  const writable = await handle.createWritable();
  try { await writable.write(new Blob([snapshot.content], { type: 'text/markdown;charset=utf-8' })); await writable.close(); }
  catch (error) { try { await writable.abort?.(); } catch { /* Keep the original write error. */ } throw error; }
  return 'saved';
}
