import { Type } from 'typebox';
import { exact } from './strict-schema.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { AnyAgentInvocation, AnyAgentSessionSpec } from '../research/contracts/loop.js';
import { workerContext } from './worker-context.js';

/** Supplies frozen local inputs, never a mathematical judgment of their sufficiency. */
export function moduleContract(spec: AnyAgentSessionSpec, requested: readonly string[] = []) {
  if ('contractVersion' in spec && spec.contractVersion === '2.1') return undefined;
  if (!('brief' in spec.context) || spec.context.brief.proofContext?.scope !== 'module') return undefined;
  const brief = (workerContext(spec) as { brief: Record<string, unknown> }).brief;
  const way = 'way' in spec.context.brief ? spec.context.brief.way : undefined;
  const interfaces = (way as { proofInterfaces?: { id: string; statement: string }[] } | undefined)?.proofInterfaces ?? [];
  const premises = (way?.conditionalPremises ?? []) as { sourceInterfaceId?: string; statement: string }[];
  const known = new Set([...interfaces.map(item => item.id), ...premises.flatMap(item => item.sourceInterfaceId ? [item.sourceInterfaceId] : [])]);
  return {
    target: brief.target, assignment: brief.assignment, definitions: brief.proofContext,
    assumptions: brief.assumptions,
    interfaces: interfaces.filter(item => !requested.length || requested.includes(item.id)),
    conditionalPremises: premises.filter(item => !requested.length || Boolean(item.sourceInterfaceId && requested.includes(item.sourceInterfaceId))),
    unknownReferences: requested.filter(id => !known.has(id)),
    adoptedChapters: brief.adoptedChapters,
    instruction: 'This is the frozen input contract, not a proof or a sufficiency assessment. Identify missing scientific definitions, extra premises or conflicts yourself. Use premise IDs; do not rederive upstream claims.',
  };
}

export function moduleContractTool(spec: AnyAgentSessionSpec) {
  if (!moduleContract(spec)) return undefined;
  return defineTool({ name: 'get_module_contract', label: 'Inspect module inputs',
    description: 'Inspect the frozen local definitions and premise interfaces before deriving. Optionally select known interface IDs. Unknown IDs are reported, not invented; scientific input sufficiency remains your responsibility.',
    parameters: Type.Object({ references: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 128 })) }, { additionalProperties: false }),
    execute: async (_id, { references }) => ({ content: [{ type: 'text' as const, text: JSON.stringify(moduleContract(spec, references)) }], details: {} }),
  });
}

export function combinesFormulate(call: AnyAgentInvocation): boolean {
  if (!['worker_step', 'v2_worker_step'].includes(call.task) || call.step !== 'FORMULATE') return false;
  return (call.input as { brief?: { proofContext?: { scope?: string } } }).brief?.proofContext?.scope === 'module';
}

export const FORMULATE_DERIVE_INSTRUCTION = `# Local input check and first derivation
The FORMULATE and DERIVE responsibilities share this invocation. Inspect get_module_contract when you need the frozen definitions or premise interfaces; it does not judge mathematical sufficiency.
## Boundaries
Work only on your assigned module. Reuse accepted interfaces within their conditions instead of rederiving them. Never certify an upstream premise using its descendant; do not read live sibling work or silently duplicate another owner's proof. For a concrete conflict, identify the affected interface and local evidence. Use only authorized references and preserve additional conditions.
## Incremental work
First identify ONLY new missing inputs, additional assumptions or conflicts. Do not repeat the brief or write a separate detailed plan. Then develop this module's proof once. Any useful calculation belongs to the derivation, never repeat it in the check.
Use conditional interfaces by their IDs. Unknown inputs are not established facts. If a declared extra assumption permits useful progress, mark conditional and retain that assumption explicitly. If an essential missing input blocks progress, mark blocked and report the precise missing input; omit the derivation slot.
Submit inputStatus (ready/conditional/blocked), formulate (new input assessment), and derive (actual new derivation or saved chapter reference) through submit_research_result. For ready/conditional, derive is required; blocked must explicitly omit derive. DERIVE consumes this result; never defer it to a duplicate response.`;

export const FORMULATE_DERIVE_SCHEMA = Type.Object({ inputStatus: Type.Union([Type.Literal('ready'), Type.Literal('conditional'), Type.Literal('blocked')]), formulate: Type.String({minLength:1}), derive: Type.Optional(Type.String({minLength:1})) }, {additionalProperties:false});

/** No scientific defaults: a blocked assessment explicitly records that no derivation occurred. */
export function decodeFormulateDerive(text: string | Record<string, string>): { formulate: string; derive: string; status: 'ready' | 'conditional' | 'blocked' } {
  let fields: Record<string,string>;
  if (typeof text !== 'string') { exact(FORMULATE_DERIVE_SCHEMA,text); fields={...text}; } else {
  fields={};
  const raw = text;
  const matches = [...raw.matchAll(/^@@(\w+)\s*$/gm)];
  if (!matches.length || raw.slice(0, matches[0].index).trim()) throw new Error('Return raw inputStatus, formulate and (unless blocked) derive slots.');

  for (const [index, match] of matches.entries()) {
    if (!['inputStatus', 'formulate', 'derive'].includes(match[1]) || Object.hasOwn(fields, match[1])) throw new Error('Unknown or repeated input-check slot.');
    fields[match[1]] = raw.slice(match.index! + match[0].length, matches[index + 1]?.index ?? raw.length).trim();
  }

  }
  if (!['ready', 'conditional', 'blocked'].includes(fields.inputStatus) || !fields.formulate) throw new Error('Explicit inputStatus and scientific input assessment are required.');
  if (fields.inputStatus === 'blocked' && fields.derive) throw new Error('Blocked input check cannot also submit a derivation. Choose conditional only with explicit retained assumptions.');
  if (fields.inputStatus !== 'blocked' && !fields.derive) throw new Error('Supply the actual derivation or saved chapter references; do not defer or invent it.');
  return { status: fields.inputStatus as 'ready' | 'conditional' | 'blocked', formulate: `${fields.inputStatus}: ${fields.formulate}`,
    derive: fields.inputStatus === 'blocked' ? `No derivation performed: local input check reported blocked. ${fields.formulate}` : fields.derive };
}
