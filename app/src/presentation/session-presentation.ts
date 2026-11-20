import { Type } from 'typebox';
import { Value } from 'typebox/value';

/** Optional display metadata; never a premise, scientific verdict or loop gate. */
export interface SessionPresentation {
  title: string;
  conditions: { kind: 'if' | 'if not'; text: string }[];
  claim: string;
}
export const SessionPresentationSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 160 }),
  conditions: Type.Array(Type.Object({ kind: Type.Union([Type.Literal('if'), Type.Literal('if not')]), text: Type.String({ minLength: 1, maxLength: 4000 }) }, { additionalProperties: false }), { maxItems: 32 }),
  claim: Type.String({ minLength: 1, maxLength: 20000 }),
}, { additionalProperties: false });
export interface SessionDisplay {
  name: string; nameSource?: 'user' | 'theorist'; hypothesisRevision: string;
  presentation?: SessionPresentation & { hypothesisRevision: string };
}
export const StoredPresentationSchema = Type.Object({ ...SessionPresentationSchema.properties, hypothesisRevision: Type.String() }, { additionalProperties: false });
export const PRESENTATION_INSTRUCTIONS = 'Include display metadata in this existing response, without an extra call: use the presentation field and its explicit presence choice in the tool schema. Use a short informative session title in the user language (not a copied input). Organize the exact current root hypothesis, preserving quantifiers, negations, symbols and every condition. conditions=[] only when there are no premises. This is display metadata, never a scientific replacement. If planningChange changes the root, describe that accepted root; a working subgoal must not replace the displayed root.';
export function applyPresentation(project: SessionDisplay, value: unknown, topic?: string): void {
  // Title and structured conditions are independent display conveniences.
  const title = value && typeof value === 'object' && 'title' in value ? value.title : undefined;
  if (project.nameSource !== 'user' && typeof title === 'string' && title.trim() && title.trim().length <= 160) {
    project.name = title.trim(); project.nameSource = 'theorist';
  }
  // If display metadata was omitted, reuse a short topic already supplied by the
  // Theorist's planning call. No copied user input or extra naming invocation.
  if (project.nameSource !== 'user' && (!project.name.trim() || project.name === 'New research') && topic?.trim()) {
    project.name = topic.trim().slice(0, 160); project.nameSource = 'theorist';
  }
  // Malformed optional UI metadata must not interrupt scientific planning.
  if (!Value.Check(SessionPresentationSchema, value)) return;
  const display = value as SessionPresentation;
  if (!display.title.trim() || !display.claim.trim()) return;
  project.presentation = { ...structuredClone(display), hypothesisRevision: project.hypothesisRevision };
  if (project.nameSource !== 'user') { project.name = display.title.trim(); project.nameSource = 'theorist'; }
}
