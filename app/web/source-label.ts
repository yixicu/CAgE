/** Describe a destination locally, including opaque paper IDs, without fetching it. */
export function sourceLabel(href: string): string {
  try {
    const url = new URL(href);
    const host = url.host.replace(/^www\./i, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'arxiv.org' && ['abs', 'pdf', 'html'].includes(parts[0]) && parts[1])
      return 'arXiv · ' + parts.slice(1).join('/').replace(/\.pdf$/i, '');
    const slug = parts.at(-1);
    if (!slug) return host;
    const name = decodeURIComponent(slug).replace(/\.(html?|aspx)$/i, '').replace(/[_-]+/g, ' ').trim();
    if (!name || /^(?:index|default)$/i.test(name)) return host;
    const site = host.endsWith('.wikipedia.org') || host === 'wikipedia.org' ? 'Wikipedia' : host;
    return name + ' · ' + site;
  } catch { return href; }
}
