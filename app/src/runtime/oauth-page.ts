import { readFileSync } from 'node:fs';

let icon: string | undefined;

function resultPage(title: string, message: string): string {
  icon ??= 'data:image/png;base64,' + readFileSync(new URL('../web/branding/engine-96.png', import.meta.url)).toString('base64');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title} · CAgE</title><link rel="icon" href="${icon}">
<style>
:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
main{text-align:center;padding:2rem;max-width:30rem}img{width:72px;height:72px}
h1{font-size:1.5rem;margin:1rem 0 .4rem}p{margin:0}
</style></head><body><main><img src="${icon}" alt="Carnot Agent Engine">
<h1>${title}</h1><p>${message}</p></main></body></html>`;
}

// Keep codes, callback parameters and raw provider errors off the result page.
export function oauthSuccessHtml(): string {
  return resultPage('Sign-in received', 'Return to CAgE to check your connection. You can close this tab.');
}

export function oauthErrorHtml(): string {
  return resultPage('Sign-in failed', 'Return to CAgE and start provider sign-in again.');
}
