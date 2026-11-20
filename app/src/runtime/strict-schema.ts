import { Type, type TSchema } from 'typebox';
import { isDeepStrictEqual } from 'node:util';
import { Value } from 'typebox/value';
import { Compile, type Validator } from 'typebox/compile';
import { RuntimeError } from './errors.js';

export const HANDOFF_VERSION = 'cage-native-2';
export const LEGACY_HANDOFF_VERSION = 'cage-strict-1';
export type HandoffVersion = typeof HANDOFF_VERSION | typeof LEGACY_HANDOFF_VERSION;
export function handoffVersion(value: unknown): HandoffVersion {
  if (value !== HANDOFF_VERSION && value !== LEGACY_HANDOFF_VERSION) throw new RuntimeError('INVALID_CONFIGURATION');
  return value;
}
/** Only this typed rejection is safe to return for bounded model correction. */
export class ContractValidationError extends Error {
  constructor(readonly issues: readonly string[], readonly kind: 'format' | 'semantic' = 'format', readonly details: readonly {path:string;keyword:string;expected?:string;message:string}[] = []) { super(issues.join('; ')); this.name = 'ContractValidationError'; }
}
const validators = new WeakMap<TSchema, Validator>();
function validator(schema: TSchema): Validator {
  let result = validators.get(schema);
  if (!result) { result = Compile(schema); validators.set(schema, result); }
  return result;
}
export function checkSchema(schema: TSchema, value: unknown): boolean { return validator(schema).Check(value); }
/** One projected-format check; host restore and the scientific gate remain separate. */
export function canonicalCodec(source: TSchema): SchemaCodec {
  const schema = JSON.parse(JSON.stringify(source)) as TSchema;
  validator(schema);
  return { schema, decode(value) { exact(schema, value); return value; } };
}
export interface SchemaCodec { schema: TSchema; decode(value: unknown): unknown }
type Shape = TSchema & { type?: string; properties?: Record<string, TSchema>; required?: string[]; items?: TSchema; anyOf?: TSchema[]; const?: unknown; enum?: unknown[]; additionalProperties?: unknown; patternProperties?: unknown };
const object = (properties: Record<string, TSchema>) => Type.Object(properties, { additionalProperties: false });
const PRESENCE_INSTRUCTIONS = 'Wire-required presence choice: use exactly {"absent":true} when this optional field is unused, or {"value":<field value>} when supplied. Never omit this member or send a bare value/null. The value must satisfy its field schema; do not invent scientific content.';
function presenceValue(schema: TSchema): TSchema | undefined {
  if (!(schema as {description?:string}).description?.includes('Wire-required presence choice:')) return;
  const choices = (schema as Shape).anyOf;
  if (choices?.length !== 2) return;
  const absent = choices.find(choice => {
    const fields = (choice as Shape).properties;
    return fields && Object.keys(fields).length === 1 && (fields.absent as Shape | undefined)?.enum?.length === 1 && (fields.absent as Shape).enum![0] === true;
  });
  const supplied = choices.find(choice => {
    const fields = (choice as Shape).properties;
    return fields && Object.keys(fields).length === 1 && fields.value;
  });
  if (absent && supplied) return (supplied as Shape).properties!.value;
}
const pointer = (path: string, key: string | number) => path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
/** Local wire guidance comes from the same schema, never from submitted scientific values. */
function presenceHints(schema: TSchema, value: unknown, path = '', hints = new Map<string, string>()): Map<string, string> {
  if (hints.size >= 32) return hints;
  const present = presenceValue(schema);
  if (present) {
    if (!Value.Check(schema, value)) {
      const shape = present as Shape;
      const kind = shape.type ?? (shape.anyOf ? 'one of the declared variants' : 'the declared field shape');
      hints.set(path || '/', `${path || '/'}: ${PRESENCE_INSTRUCTIONS} Expected wrapped field value type: ${kind}.`);
    }
    if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) presenceHints(present, (value as { value: unknown }).value, pointer(path, 'value'), hints);
    return hints;
  }
  const shape = schema as Shape;
  if (shape.type === 'object' && shape.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(shape.properties)) {
      if (Object.hasOwn(value, key) || shape.required?.includes(key) && presenceValue(child)) presenceHints(child, (value as Record<string, unknown>)[key], pointer(path, key), hints);
    }
  } else if (shape.type === 'array' && shape.items && !Array.isArray(shape.items) && Array.isArray(value)) {
    value.forEach((item, index) => presenceHints(shape.items!, item, pointer(path, index), hints));
  } else if (shape.anyOf) {
    const choice = shape.anyOf.find(candidate => Value.Check(candidate, value));
    if (choice) presenceHints(choice, value, path, hints);
  }
  return hints;
}
/** Only these two misplaced root fields receive a hint from their actual declared component schema. */
function interfaceFieldTargets(schema: TSchema, value: unknown): Map<string, string> {
  const targets = new Map<string, string>(), root = schema as Shape;
  if (root.type !== 'object' || !root.properties || !value || typeof value !== 'object' || Array.isArray(value)) return targets;
  // Conservative known save-shape ownership only, not generic recursive alias discovery.
  for (const [key, child] of Object.entries(root.properties)) {
    if (key === 'component') continue;
    const shape = child as Shape;
    if (key === 'title' || key === 'summary') { if (shape.type !== 'string') return targets; }
    else if (key === 'content') {
      if (!(shape.anyOf ?? [shape]).every(choice => (choice as Shape).type === 'object' && (choice as Shape).properties
        && Object.entries((choice as Shape).properties!).every(([name, value]) => ['text','savedBody'].includes(name) && (value as Shape).type === 'string'))) return targets;
    } else return targets;
  }
  let component = root.properties.component as Shape | undefined, path = '/component';
  if (!component) return targets;
  const wrapped = presenceValue(component); if (wrapped) { component = wrapped as Shape; path += '/value'; }
  if (component.type !== 'object' || !component.properties) return targets;
  for (const field of ['usesPremises', 'fulfillsInterfaces'])
    if (!Object.hasOwn(root.properties, field) && Object.hasOwn(value, field) && Object.hasOwn(component.properties, field)) targets.set('/' + field, path + '/' + field);
  return targets;
}
export function exact(schema: TSchema, value: unknown): void {
  if (!checkSchema(schema, value)) {
    const errors = validator(schema).Errors(value);
    const diagnostics = errors.map(error => `${error.instancePath || '/'}: ${error.message}`);
    for (const error of errors) if (error.keyword === 'additionalProperties') {
      const fields = (error.params as { additionalProperties?: unknown }).additionalProperties;
      if (Array.isArray(fields)) for (const field of fields) if (typeof field === 'string') diagnostics.push(`${pointer(error.instancePath, field)}: field is not declared in this input schema and remains in the raw draft; clarify its scientific meaning or resubmit only declared fields. Do not silently discard, rename or merge scientific content.`);
    }
    diagnostics.push(...presenceHints(schema, value).values());
    const details: {path:string;keyword:string;message:string;expected?:string}[]=errors.map(error=>({path:error.instancePath||'/',keyword:error.keyword,message:error.message,...(typeof (error.params as {type?:unknown}).type==='string'?{expected:(error.params as {type:string}).type}:{})}));
    for (const [path, target] of interfaceFieldTargets(schema, value)) {
      diagnostics.push(`${path}: this field is declared at ${target}, inside component. Resubmit it at that declared location using its active schema; preserve the raw draft and scientific meaning. Do not omit it merely to remove this error, or automatically merge conflicting copies.`);
      const detail = details.find(item => item.path === path);
      if (detail) Object.assign(detail, { expected: target });
      else details.push({path, keyword:'field-location', expected:target, message:'Use the declared component field location; raw extra fields remain rejected.'});
    }
    throw new ContractValidationError(diagnostics,'format',details);
  }
}
/** Explicit absence is a wire choice, never a null/default or a coercion of science. */
export function strictCodec(source: TSchema): SchemaCodec {
  const s = JSON.parse(JSON.stringify(source)) as Shape; // Drop TypeBox optional annotations; required is explicit.
  if(s.type==='object' && s.patternProperties && typeof s.patternProperties==='object'){
    const patterns=Object.entries(s.patternProperties);
    if(patterns.length!==1)throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
    const [pattern,item]=patterns[0], child=strictCodec(item as TSchema);
    const schema=Type.Array(object({key:Type.String({pattern}),value:child.schema}));
    return {schema,decode(value){exact(schema,value);const result:Record<string,unknown>=Object.create(null);for(const row of value as {key:string;value:unknown}[]){if(Object.hasOwn(result,row.key))throw new Error('Duplicate dictionary key: '+row.key);result[row.key]=child.decode(row.value);}exact(source,result);return result;}};
  }
  if (s.anyOf) {
    const choices = s.anyOf.map(strictCodec), schema = Type.Union(choices.map(c => c.schema));
    return {schema, decode(value) { exact(schema,value); const chosen=choices.find(c=>Value.Check(c.schema,value)); if(!chosen) throw new Error('No matching contract variant'); return chosen.decode(value); }};
  }
  if (s.type === 'object' && s.properties && !s.patternProperties && s.additionalProperties !== true && typeof s.additionalProperties !== 'object') {
    const fields = Object.entries(s.properties).map(([key, child]) => ({key, codec:strictCodec(child), optional:!s.required?.includes(key)}));
    const schema=object(Object.fromEntries(fields.map(({key,codec,optional})=>[key,optional ? Type.Union([object({absent:Type.Boolean({enum:[true]})}),object({value:codec.schema})], {description: PRESENCE_INSTRUCTIONS}) : codec.schema])));
    return {schema, decode(value) { exact(schema,value); const input=value as Record<string,unknown>, result:Record<string,unknown>={}; for(const f of fields){ const v=input[f.key]; if(f.optional){if(Object.hasOwn(v as object,'absent'))continue; result[f.key]=f.codec.decode((v as {value:unknown}).value);}else result[f.key]=f.codec.decode(v); } exact(source,result); return result; }};
  }
  if (s.type === 'array' && Array.isArray(s.items)) {
    // JSON-schema providers cannot all express tuples. A homogeneous fixed pair
    // is exactly an array of that item with equal minimum/maximum length.
    const items=s.items as TSchema[];
    if(!items.length || !items.every(item=>isDeepStrictEqual(item,items[0])))throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
    const child=strictCodec(items[0]), schema=Type.Array(child.schema,{minItems:items.length,maxItems:items.length});
    return {schema,decode(value){exact(schema,value);const result=(value as unknown[]).map(v=>child.decode(v));exact(source,result);return result;}};
  }
  if (s.type === 'array' && s.items) {
    const child=strictCodec(s.items), schema={...s,items:child.schema} as TSchema;
    return {schema, decode(value){exact(schema,value);const result=(value as unknown[]).map(v=>child.decode(v));exact(source,result);return result;}};
  }
  if (['string','number','integer','boolean'].includes(s.type ?? '')) {
    const schema={...s} as Shape; if(Object.hasOwn(schema,'const')){schema.enum=[schema.const]; delete schema.const;}
    return {schema,decode(value){exact(schema,value);return value;}};
  }
  throw new RuntimeError('STRICT_SCHEMA_UNSUPPORTED');
}
