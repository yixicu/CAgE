/** Suppress only a duplicate opening title in the reading view, never in the saved source. */
export function resourceReadingBody(body: string, title: string): string {
  const heading = /^(?:[ \t]*\r?\n)*# +(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/u.exec(body);
  const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ');
  return heading && normalize(heading[1]!) === normalize(title) ? body.slice(heading[0].length).replace(/^\s*\r?\n/u, '') : body;
}
