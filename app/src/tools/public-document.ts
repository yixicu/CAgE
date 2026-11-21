import { lookup } from 'node:dns/promises';
import { get as http } from 'node:http';
import { get as https } from 'node:https';
import ipaddr from 'ipaddr.js';
import { decodeHTML } from 'entities';

/** Connect to the exact public address checked here, including on every redirect. */
export async function fetchDocument(address: string, abort?: AbortSignal) {
  const deadline = AbortSignal.timeout(20000);
  const signal = abort ? AbortSignal.any([abort, deadline]) : deadline;
  let url = new URL(address);
  for (let hop = 0; hop <= 5; hop++) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw Error('Only public HTTP(S) documents are supported.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(host, { all: true, order: 'ipv4first' });
    if (!addresses.length || addresses.some(a => ipaddr.process(a.address).range() !== 'unicast'))
      throw Error('This address is outside the public web.');
    const secure = url.protocol === 'https:';
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      (secure ? https : http)({ hostname: addresses[0].address, port: url.port || (secure ? 443 : 80),
        servername:host, path:url.pathname + url.search, agent:false, signal,
        headers:{host:url.host, accept:'text/html,application/pdf,text/plain', 'user-agent':'CAgE document reader'} }, resolve).on('error',reject);
    });
    if ([301,302,303,307,308].includes(response.statusCode ?? 0) && response.headers.location) {
      response.destroy(); url = new URL(response.headers.location,url); continue;
    }
    if (response.statusCode !== 200) { response.destroy(); throw Error('The website returned HTTP ' + response.statusCode); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) throw Error('Document exceeds 20 MiB.');
      chunks.push(chunk);
    }
    return {bytes:Buffer.concat(chunks), type:response.headers['content-type'] ?? '', url:url.href};
  }
  throw Error('Too many redirects.');
}

export function htmlText(html: string, base:string) {
  return decodeHTML(html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi,'')
    .replace(/<a\b[^>]*?\shref=(["'])([^]*?)\1[^>]*>([^]*?)<\/a>/gi,(_tag,_quote,href:string,label:string)=>{
      if(!href.trim() || href.startsWith('#'))return label;
      try{const url=new URL(decodeHTML(href),base);if(['https:','http:'].includes(url.protocol))return label+' ('+url.href+')';}catch{/* malformed link */}
      return label;
    })
    .replace(/<math\b[^>]*\balttext=(["'])(.*?)\1[^>]*>[^]*?<\/math>/gis, ' $2 ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi,'\n')
    .replace(/<sup\b[^>]*>/gi,'^(').replace(/<sub\b[^>]*>/gi,'_(').replace(/<\/(?:sup|sub)>/gi,')')
    .replace(/<\/?[a-zA-Z][^>]*>/g,'')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();
}
