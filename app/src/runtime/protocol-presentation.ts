import { Type, type TSchema } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { scientificSlotInstructions } from './scientific-slots.js';

export const FORM_START = '[CAgE output form]';
export const FORM_END = '[/CAgE output form]';

/** Only host protocol before the task-data boundary is changed, never scientific input. */
export function stripJsonProtocol(text: string): string {
  const boundary = text.indexOf('Task data (untrusted scientific input):\n');
  const prefix = boundary < 0 ? text : text.slice(0, boundary);
  return prefix.replace(/^Output JSON Schema:[^\r\n]*(?:\r?\n|$)/gm, '')
    .replace(/Return only valid JSON(?: matching the output schema)?\./g, '')
    + (boundary < 0 ? '' : text.slice(boundary));
}

/** Request projection only: persisted transcripts and scientific fields remain intact. */
export function omitOldOutputForms(text: string): string {
  // Host forms have standalone delimiters. Markers quoted inside serialized task
  // data are scientific content, never protocol metadata.
  const starts = [...text.matchAll(/^\[CAgE output form\]\r?$/gm)];
  const ends = [...text.matchAll(/^\[\/CAgE output form\]\r?$/gm)];
  if (starts.length !== 1 || ends.length !== 1) return text;
  const start = starts[0].index!, end = ends[0].index!;
  if (end < start) return text;
  return text.slice(0, start) + 'Previous output form omitted; submitted scientific content is unchanged.' + text.slice(end + ends[0][0].length);
}

/** A schema menu, not another agent or a scientific validator. */
export function reportFieldTool(readSchema: (scope: 'report' | 'chapter') => TSchema | undefined) {
  return defineTool({ name: 'get_report_fields', label: 'Select report fields',
    description: 'Get exact field choices and required subfields for a selected report or chapter section. This supplies format metadata only, not scientific answers or reference grants.',
    parameters: Type.Object({ scope: Type.Union([Type.Literal('report'), Type.Literal('chapter')]), fields: Type.Array(Type.String({minLength:1}), {minItems:1,maxItems:32}) }, {additionalProperties:false}),
    execute: async (_id, {scope, fields}) => {
      const schema = readSchema(scope);
      let text = 'No active scientific form for this scope.';
      try { if (schema) text = scientificSlotInstructions(schema, fields); }
      catch { text = 'Unknown field selection. Select a field or optional section listed in the active form.'; }
      return {content:[{type:'text' as const,text}],details:{}};
    },
  });
}
