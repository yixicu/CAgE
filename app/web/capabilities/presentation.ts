import type { CapabilityItem } from '../../src/server/capabilities-types';
import { classifyField, FIELD_CATALOG, type FieldId } from './taxonomy';
export type DisciplineGlyph = FieldId;
/** Labels and symbols share one field vocabulary; resource identities remain exact. */
export function presentResource(item: CapabilityItem, routeTitle?: string) {
  const glyph = classifyField(item.subjectTags), label = FIELD_CATALOG[glyph].label;
  const authored = routeTitle?.trim().replace(/\s+/gu, ' ');
  const identity = authored && authored !== item.title ? `${authored} — ${item.title}` : item.title;
  return { label, fullLabel: `${label} — ${identity}`, glyph, typeLabel: item.kind === 'strategy' ? 'Strategy' : item.kind === 'policy' ? 'Policy' : 'Skill' };
}
