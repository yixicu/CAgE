import { Type, type TSchema } from 'typebox';

/** Public derivations, never private reasoning or arbitrary filesystem grants. */
export interface ProofContext {
  scope?: 'module';
  symbols: { symbol: string; meaning: string }[];
  conditions: string[]; obligations: string[];
}
export interface ChapterIdentity {
  sessionId: string; attemptId: string; chapterId: string;
  hypothesisRevision: string; conventionVersion: string; contentHash: string;
}
export interface ProofInterface {
  id: string; statement: string; conditions: string[]; symbols: { symbol: string; meaning: string }[]; version?: string;
}
export interface ProofComponent {
  usesPremises?: string[]; fulfillsInterfaces?: string[];
  statement: string; conditions: string[]; symbols: { symbol: string; meaning: string }[];
  dependencies: (ChapterIdentity & { use: string })[]; unresolved: string[];
}
export interface ChapterRef extends ChapterIdentity {
  title: string; summary: string; complete: boolean;
  component?: ProofComponent;
}
export interface ComponentDelivery {
  chapters: ChapterIdentity[];
  corrections: { previous: ChapterIdentity; replacement: ChapterIdentity; reason: string }[];
}
export interface PathReport {
  method: string; keySteps: string[]; conditions: string[]; result: string;
  obstacles: string[]; nextSteps: string[]; conventionChanges: string[];
}
const text = Type.String({ minLength: 1, maxLength: 10000 });
const strings = Type.Array(text, { maxItems: 128 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const ProofContextSchema = obj({ scope: Type.Optional(Type.Literal('module')), symbols: Type.Array(obj({ symbol: text, meaning: text }), { maxItems: 128 }), conditions: strings, obligations: strings });
export const ChapterIdentitySchema = obj({ sessionId: text, attemptId: text, chapterId: text, hypothesisRevision: text, conventionVersion: text,
  contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }) });
export const ComponentDependencySchema = obj({ ...ChapterIdentitySchema.properties, use: text });
export const ProofInterfaceSchema = obj({ id: text, statement: text, conditions: strings, symbols: ProofContextSchema.properties.symbols, version: Type.Optional(text) });
export const ProofComponentSchema = obj({ usesPremises: Type.Optional({ ...strings, description: 'Place this field inside component, never at the save-tool top level. For a Worker, explicitly list every assigned frozen conditional premise ID used by this module; use get_module_contract for its required IDs. Prose mentioning an ID does not replace this array.' }), fulfillsInterfaces: Type.Optional({ ...strings, description: 'Place this field inside component, never at the save-tool top level. Explicitly select only assigned interface IDs actually fulfilled by this scientific component; do not claim all interfaces merely to satisfy a format check. Use get_module_contract for the allowed menu.' }), statement: text, conditions: { ...strings, description: 'State the actual premises and scope of this component conclusion. A conditional conclusion must preserve its premises and dependency obligations; do not relabel a missing proof as a condition to claim closure.' }, symbols: ProofContextSchema.properties.symbols,
  dependencies: Type.Array(ComponentDependencySchema, { maxItems: 128, description: 'Declare each exact component actually used and its use. Do not list unrelated Workers. Dependencies record scientific provenance and obligations; they do not append chapter bodies to the final manuscript.' }), unresolved: { ...strings, description: 'Record the still-unproved obligations of the conclusion actually claimed. Distinguish these from stated scope restrictions or stronger properties not claimed. Make this scientific judgment explicitly; do not erase genuine gaps or move them into conditions to obtain eligibility. Nonempty unresolved prevents final-manuscript use.' } });
export const ChapterRefSchema = obj({ ...ChapterIdentitySchema.properties, title: text, summary: text, complete: Type.Boolean(), component: Type.Optional(ProofComponentSchema) });
export const ChaptersSchema = Type.Array(ChapterRefSchema, { maxItems: 128 });
export const PathReportSchema = obj({ method: text, keySteps: strings, conditions: strings, result: text, obstacles: strings, nextSteps: strings, conventionChanges: strings });

export const ComponentDeliverySchema = obj({ chapters: Type.Array(ChapterIdentitySchema, { maxItems: 128 }),
  corrections: Type.Array(obj({ previous: ChapterIdentitySchema, replacement: ChapterIdentitySchema, reason: text }), { maxItems: 128 }) });
