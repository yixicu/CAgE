import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';

type Shape = TSchema & { type?: string; properties?: Record<string, TSchema>; items?: TSchema; anyOf?: TSchema[]; required?: string[]; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; minItems?: number };
export type SlotResolver = (handle: string, schema: TSchema) => unknown;
export interface ScientificSlotsSnapshot {
  version: 1;
  fields: [string, string][];
  invalid: [string, string][];
  /** Incomplete/ambiguous submission retained for recovery, never accepted as science. */
  fragments?: [string, string][];
}
export interface SlotDiagnostics { retained: string[]; invalid: { field: string; message: string }[]; missing: string[] }
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function shapeAt(schema: TSchema, parts: string[]): TSchema {
  if (!parts.length) return schema;
  const s = schema as Shape, [key, ...rest] = parts;
  if (forbidden.has(key)) throw new Error('Invalid field path.');
  if (s.type === 'object' && s.properties && Object.hasOwn(s.properties, key)) return shapeAt(s.properties[key], rest);
  if (s.type === 'array' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < 1000 && s.items) return shapeAt(s.items, rest);
  throw new Error(`Unknown scientific slot: ${parts.join('.')}`);
}
function valueOf(raw: string, schema: TSchema, resolve?: SlotResolver): unknown {
  const s = schema as Shape;
  if (s.type === 'string' || s.anyOf?.every(item => (item as Shape).type === 'string')) {
    const choices=s.enum??(Object.hasOwn(s,'const')?[s.const]:s.anyOf?.map(item=>(item as Shape).const));
    if(choices && raw.startsWith('"')) {const parsed=JSON.parse(raw);if(choices.includes(parsed))return parsed;}
    return raw;
  }
  if (s.type === 'object' && /^[CAP]\d+$/.test(raw) && resolve) return resolve(raw, schema);
  if (s.type === 'array' && (s.items as Shape | undefined)?.type === 'string') {
    if(raw.startsWith('[')){const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||!parsed.every(item=>typeof item==='string'))throw new Error('Expected a string array; JSON items are never coerced to text.');return parsed;}
    return raw.split(/\r?\n/).map(line => line.replace(/^- /, '').trim()).filter(Boolean);
  }
  if (s.type === 'array' && raw !== '[]' && !raw.startsWith('[')) {
    const lines = raw.split(/\r?\n/).map(line => line.replace(/^- /, '').trim()).filter(Boolean);
    if (resolve && lines.every(line => /^[CAP]\d+$/.test(line))) return lines.map(line => resolve(line, s.items!));
  }
  // JSON remains an explicit compatibility form for controls, never required for prose.
  return JSON.parse(raw);
}
function checkControl(value: unknown, schema: TSchema): void {
  const s = schema as Shape;
  const choices = s.enum ?? (Object.hasOwn(s, 'const') ? [s.const] : s.anyOf?.every(item => Object.hasOwn(item, 'const')) ? s.anyOf.map(item => (item as Shape).const) : undefined);
  if (choices && !choices.some(choice => Object.is(choice, value))) throw new Error(`Choose ${choices.map(choice => JSON.stringify(choice)).join(' | ')}.`);
  if (s.type === 'boolean' && typeof value !== 'boolean') throw new Error('Choose true | false.');
  if ((s.type === 'number' || s.type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value) || s.type === 'integer' && !Number.isInteger(value))) throw new Error(`Supply a finite ${s.type}.`);
  if (typeof value === 'number' && (s.minimum !== undefined && value < s.minimum || s.maximum !== undefined && value > s.maximum)) throw new Error(`Number outside bounds ${s.minimum ?? '-infinity'}..${s.maximum ?? 'infinity'}.`);
}
function assign(root: Record<string, unknown>, parts: string[], value: unknown): void {
  let cursor: any = root;
  parts.forEach((key, i) => {
    if (i === parts.length - 1) cursor[key] = value;
    else cursor = cursor[key] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
  });
}
function compatibleParent(parent: string, raw: string, child: string): boolean {
  return raw === '[]' || child === parent + '.use' && /^C\d+$/.test(raw);
}
/** Each unambiguous field survives independently; the caller still validates scientific completeness. */
export class ScientificSlots {
  private slots = new Map<string, string>();
  private invalid = new Map<string, string>();
  private fragments = new Map<string, string>();
  constructor(private readonly schema: TSchema, private readonly resolve?: SlotResolver) {}
  snapshot(): ScientificSlotsSnapshot {
    return { version: 1, fields: [...this.slots], invalid: [...this.invalid], fragments: [...this.fragments] };
  }
  restore(snapshot: ScientificSlotsSnapshot): void {
    if (snapshot.version !== 1) throw new Error('Unsupported scientific slot snapshot.');
    const fields = new Map<string, string>();
    for (const [key, raw] of snapshot.fields) {
      shapeAt(this.schema, key.split('.'));
      if (typeof raw !== 'string' || fields.has(key)) throw new Error('Invalid scientific slot snapshot.');
      fields.set(key, raw);
    }
    this.slots = fields;
    this.invalid = new Map(snapshot.invalid);
    this.fragments = new Map(snapshot.fragments ?? []);
    for (const key of this.invalid.keys()) this.remove(key);
  }
  diagnostics(): SlotDiagnostics {
    const missing: string[] = [];
    const walk = (schema: TSchema, path: string): void => {
      const s = schema as Shape;
      if (s.type==='array' && s.items){
        const indexes=new Set([...this.slots.keys()].filter(k=>k.startsWith(path+'.')).map(k=>k.slice(path.length+1).split('.')[0]));
        for(const index of indexes)walk(s.items,`${path}.${index}`);
        return;
      }
      if (this.slots.has(path)) return;
      if (s.type === 'object') for (const key of s.required ?? []) {
        const child = path ? `${path}.${key}` : key;
        if (!this.slots.has(child) && ![...this.slots.keys()].some(key => key.startsWith(child + '.'))) missing.push(child);
        else walk(s.properties![key], child);
      }
    };
    walk(this.schema, '');
    try {
      for(const error of Value.Errors(this.schema,this.materialize()))if(error.keyword==='required'){
        const prefix=error.instancePath.replace(/^\//,'').replace(/\//g,'.');
        for(const key of (error.params as {requiredProperties:string[]}).requiredProperties)missing.push(prefix?prefix+'.'+key:key);
      }
    }catch{/* Invalid retained fragments remain diagnosed separately. */}
    return { retained: [...this.slots.keys()], invalid: [...this.invalid].map(([field, message]) => ({ field, message })), missing:[...new Set(missing)] };
  }
  captureTruncated(text: string): SlotDiagnostics {
    try { this.decode(text, { truncated: true }); } catch { /* Fields and incomplete fragments have already been retained. */ }
    return this.diagnostics();
  }
  private remove(path: string): void {
    for (const [key, raw] of this.slots) if (key === path || key.startsWith(path + '.') || path.startsWith(key + '.')) {
      this.fragments.set(`$previous:${key}`, raw);
      this.slots.delete(key);
    }
  }
  decode(text: string, options: { truncated?: boolean } = {}): unknown {
    if (text.trimStart().startsWith('{')) {
      if (options.truncated) {
        this.fragments.set('$json', text);
        this.invalid.set('$json', 'Truncated JSON has no trustworthy complete field boundary; return named fields.');
        throw new Error(this.invalid.get('$json'));
      }
      const parsed = JSON.parse(text);
      if(!Value.Check(this.schema,parsed))throw new Error([...Value.Errors(this.schema,parsed)].map(e=>`${e.instancePath || '/'}: ${e.message}`).join('; '));
      this.slots.clear();this.invalid.clear();
      const submitted: [string, string][] = [];
      const seed = (value: unknown, schema: TSchema, path: string): void => {
        const shape = schema as Shape;
        if (shape.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [key, item] of Object.entries(value)) {
            const child = path ? `${path}.${key}` : key;
            if (shape.properties?.[key]) seed(item, shape.properties[key], child);
            else submitted.push([child, JSON.stringify(item)]);
          }
        } else if (shape.type === 'array' && Array.isArray(value) && (shape.items as Shape | undefined)?.type === 'object' && value.length) {
          submitted.push([path, '[]']);
          value.forEach((item, index) => seed(item, shape.items!, `${path}.${index}`));
        } else if (path) submitted.push([path, typeof value === 'string' ? value : JSON.stringify(value)]);
      };
      seed(parsed, this.schema, '');
      // JSON is compatibility input, not a reset that discards previous raw bodies.
      return this.accept(submitted);
    }
    const matches = [...text.matchAll(/^@@([A-Za-z][\w.]*)[ \t]*$/gm)];
    if (!matches.length || text.slice(0, matches[0].index).trim()) throw new Error('Use named @@ scientific fields without a prose wrapper.');
    const submitted: [string, string][] = [];
    let tail: [string, string] | undefined;
    for (const [i, match] of matches.entries()) {
      const key = match[1];
      const raw = text.slice(match.index! + match[0].length, matches[i + 1]?.index ?? text.length).trim();
      if (options.truncated && i === matches.length - 1) {
        tail = [key, text.slice(match.index!)];
      } else {
        submitted.push([key, raw]);
      }
    }
    try { return this.accept(submitted); }
    finally {
      if (tail) {
        this.remove(tail[0]);
        this.fragments.set(tail[0], tail[1]);
        this.invalid.set(tail[0], 'Incomplete last field: submit the complete replacement field.');
        throw new Error([...this.invalid].map(([key, issue]) => `${key}: ${issue}`).join('\n'));
      }
    }
  }
  private accept(submitted: [string, string][]): unknown {
    // Unknown syntax is not a scientific field; a new named submission can correct it.
    for (const key of this.invalid.keys()) {
      try { shapeAt(this.schema, key.split('.')); } catch { this.invalid.delete(key); }
    }
    const rejected = new Map<string, string>();
    const candidates = new Map<string, string>();
    for (const [key, raw] of submitted) {
      try {
        const schema = shapeAt(this.schema, key.split('.'));
        if (candidates.has(key)) throw new Error('Repeated scientific slot; provide one unambiguous replacement.');
        candidates.set(key, raw);
        if (!raw || raw === `<${fieldHint(schema)}>` ) throw new Error('Provide an explicit value; missing science cannot be filled automatically.');
        checkControl(valueOf(raw, schema, this.resolve), schema);
      } catch (error) { rejected.set(key, error instanceof Error ? error.message : String(error)); }
    }
    for (const [parent, raw] of candidates) for (const child of candidates.keys()) {
      if (child.startsWith(parent + '.') && !compatibleParent(parent, raw, child)) {
        rejected.set(parent, `Conflicting fields ${parent} and ${child}.`);
        rejected.set(child, `Conflicting fields ${parent} and ${child}.`);
      }
    }
    for (const [key, issue] of rejected) {
      this.remove(key);
      this.invalid.set(key, issue);
      this.fragments.set(key, submitted.filter(([path]) => path === key).map(([, raw]) => raw).join('\n@@' + key + '\n'));
    }
    for (const [key, raw] of [...submitted].sort(([a],[b])=>a.split('.').length-b.split('.').length)) {
      if (rejected.has(key)) continue;
      // Replacing a whole object/list intentionally replaces its old descendants.
      for (const old of this.slots.keys()) if (old.startsWith(key + '.') && !candidates.has(old)) this.slots.delete(old);
      for (const [old, oldRaw] of this.slots) if (key.startsWith(old + '.') && !compatibleParent(old, oldRaw, key)) this.slots.delete(old);
      for (const old of this.invalid.keys()) if (old === key || old.startsWith(key + '.')) this.invalid.delete(old);
      this.fragments.delete(key);
      this.slots.set(key, raw);
    }
    return this.materialize();
  }
  /** Rebuild a restored report without a new model submission; scientific validation remains with the caller. */
  materialize(): unknown {
    if (this.invalid.size) throw new Error([...this.invalid].map(([key, issue]) => `${key}: ${issue}`).join('\n'));
    const output: Record<string, unknown> = {};
    for (const [key, raw] of [...this.slots].sort(([a], [b]) => a.split('.').length - b.split('.').length)) {
      const schema = shapeAt(this.schema, key.split('.'));
      const value = valueOf(raw, schema, this.resolve);
      checkControl(value, schema);
      assign(output, key.split('.'), value);
    }
    return output;
  }
}
function fieldHint(schema: TSchema): string {
  const s = schema as Shape;
  if (Object.hasOwn(s, 'const')) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map(value => JSON.stringify(value)).join(' | ');
  if (s.anyOf) return s.anyOf.map(fieldHint).join(' | ');
  const bounds = [s.minimum !== undefined ? `min ${s.minimum}` : '', s.maximum !== undefined ? `max ${s.maximum}` : '', s.minLength !== undefined ? `minChars ${s.minLength}` : '', s.minItems !== undefined ? `minItems ${s.minItems}` : ''].filter(Boolean).join(', ');
  if (s.type === 'array') return `items: ${fieldHint(s.items!)}; [] only if checked and none${bounds ? '; ' + bounds : ''}`;
  const base = s.type === 'boolean' ? 'true | false' : s.type === 'string' ? 'raw text' : s.type ?? 'explicit value';
  return base + (bounds ? ` (${bounds})` : '');
}
export function scientificSlotInstructions(schema: TSchema, onlyFields?: string[]): string {
  const entries: string[] = [];
  function walk(value: TSchema, path: string, optional = false, expand = false): void {
    const s = value as Shape;
    const prefix = optional ? 'optional; ' : '';
    if (s.type === 'object' && s.properties && ('chapterId' in s.properties && 'contentHash' in s.properties || 'id' in s.properties && 'version' in s.properties && Object.keys(s.properties).length === 2)) {
      entries.push(`${path}: ${prefix}granted ${'chapterId' in s.properties ? 'C' : 'A'} handle (never copy hashes)`);
      if ('use' in s.properties) entries.push(`${path}.use: raw scientific use of the selected dependency`);
    } else if (optional && !expand && (s.type === 'object' || s.type === 'array' && (s.items as Shape | undefined)?.type === 'object')) {
      entries.push(`${path}: optional section; get_report_fields(fields=["${path}"]) for its fill-in fields`);
    } else if (s.type === 'object' && s.properties) {
      for (const [key, child] of Object.entries(s.properties)) walk(child, path ? `${path}.${key}` : key, !s.required?.includes(key), expand);
    } else if (s.type === 'array' && (s.items as Shape | undefined)?.type === 'object') {
      entries.push(`${path}: ${prefix}[] if checked and none, otherwise ${path}.0.*, ${path}.1.*${s.minItems !== undefined ? `; minItems ${s.minItems}` : ''}`);
      walk(s.items!, `${path}.0`, false, expand);
    } else entries.push(`${path}: ${prefix}${fieldHint(s)}`);
  }
  if (onlyFields?.length) for (const field of [...new Set(onlyFields)]) {
    try { walk(shapeAt(schema, field.split('.')), field, false, true); }
    catch { entries.push(`${field}: unknown field; choose a listed section`); }
  } else walk(schema, '');
  return `\n[CAgE output form]\nFill @@field.path headings with raw text/LaTeX below, without JSON escaping. Select listed controls literally; no defaults. Indexed lists start at 0. Optional sections: get_report_fields(scope="report" or "chapter", fields=[section]). References use granted handles, with .use where listed. Return only repaired fields during correction; other saved fields remain. To replace a list use [] then its indexed fields.\n${entries.join('\n')}\n[/CAgE output form]\n`;
}
