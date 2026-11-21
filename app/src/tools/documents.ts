import {createRequire} from 'node:module';
import {dirname} from 'node:path';

export async function loadPdf(bytes:Uint8Array) {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root=dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')).replaceAll('\\','/');
  return getDocument({data:new Uint8Array(bytes),standardFontDataUrl:root+'/standard_fonts/',
    cMapUrl:root+'/cmaps/',cMapPacked:true,wasmUrl:root+'/wasm/',useSystemFonts:true});
}
export interface DocumentText { text: string; pages?: { page: number; text: string }[]; warning?: string }
/** Basic local PDF text only. No OCR, network lookups or evidence invention. */
export async function extractDocumentText(bytes: Uint8Array, name: string): Promise<DocumentText> {
  if (!name.toLowerCase().endsWith('.pdf')) return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
  const task = await loadPdf(bytes);
  const pdf = await task.promise;
  try {
    const pages: { page: number; text: string }[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push({ page, text: content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim() });
    }
    const text = pages.map((page) => `[Page ${page.page}]\n${page.text}`).join('\n\n');
    return { text, pages, warning: 'Basic PDF text extraction may omit equations, diagrams or scanned text. No OCR or mathematical verification was performed.' };
  } finally { await task.destroy(); }
}
