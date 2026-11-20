import { Type } from 'typebox';

/** Immutable submissions are separate from their planning receipts. */
export type RefinementKind = 'hypothesis' | 'annotation' | 'accept_reconstruction';
export interface UserCommand {
  id: string; projectId: string; kind: 'refine' | 'pause' | 'stop'; payload: string; createdAt: string;
  requestId?: string; sequence?: number; refinementKind?: RefinementKind;
}
export type UserCommandStatus = 'pending' | 'planning' | 'applied' | 'superseded' | 'rejected' | 'legacy_unknown';
export interface UserCommandState {
  status: UserCommandStatus; boundaryId?: string; hypothesisRevision?: string; supersededBy?: string;
  message?: string; refinementIndex?: number;
}
export interface ReconstructionSelection {
  commandId: string; proposalId: string; hypothesis: string; sourceHypothesisRevision: string;
  kind: 'refine' | 'generalize' | 'reframe'; assumptions: string[];
  implication: 'hypothesis_implies_target' | 'target_implies_hypothesis' | 'equivalent' | 'counterexample'; reason: string;
}
export interface PlanningSelection {
  boundaryId: string; commandIds: string[]; hypothesisCommandId?: string; annotationCommandIds: string[];
  pendingModifications: string[]; pendingAnnotations: string[];
  reconstruction?: ReconstructionSelection;
  blockedReason?: string;
}
const text = Type.String({ minLength: 1, maxLength: 1000000 });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' });
const object = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
export const RefinementKindSchema = Type.Union(['hypothesis', 'annotation', 'accept_reconstruction'].map(value => Type.Literal(value)));
export const UserCommandStateSchema = object({
  status: Type.Union(['pending', 'planning', 'applied', 'superseded', 'rejected', 'legacy_unknown'].map(value => Type.Literal(value))),
  boundaryId: Type.Optional(id), hypothesisRevision: Type.Optional(text), supersededBy: Type.Optional(id),
  message: Type.Optional(text), refinementIndex: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const CommandStatesSchema = Type.Record(id, UserCommandStateSchema);
export const PlanningSelectionSchema = object({
  boundaryId: id, commandIds: Type.Array(id, { uniqueItems: true }), hypothesisCommandId: Type.Optional(id),
  annotationCommandIds: Type.Array(id, { uniqueItems: true }), pendingModifications: Type.Array(text, { maxItems: 1 }),
  pendingAnnotations: Type.Array(text), blockedReason: Type.Optional(text),
  reconstruction: Type.Optional(object({ commandId: id, proposalId: id, hypothesis: text, sourceHypothesisRevision: text,
    kind: Type.Union(['refine','generalize','reframe'].map(value => Type.Literal(value))), assumptions: Type.Array(text),
    implication: Type.Union(['hypothesis_implies_target','target_implies_hypothesis','equivalent','counterexample'].map(value => Type.Literal(value))), reason: text })),
});

/** Shape and cross-field validation for durable boundary selections. */
export function planningSelectionIsCoherent(selection: PlanningSelection): boolean {
  const expected = [...(selection.hypothesisCommandId ? [selection.hypothesisCommandId] : []), ...selection.annotationCommandIds];
  if (new Set(expected).size !== expected.length || new Set(selection.commandIds).size !== selection.commandIds.length
    || selection.pendingAnnotations.length !== selection.annotationCommandIds.length
    || selection.commandIds.some(id => !expected.includes(id))) return false;
  if (!selection.blockedReason && (selection.commandIds.length !== expected.length
    || selection.pendingModifications.length !== (selection.hypothesisCommandId ? 1 : 0))) return false;
  if (selection.reconstruction && (selection.reconstruction.commandId !== selection.hypothesisCommandId
    || selection.pendingModifications[0] !== selection.reconstruction.hypothesis)) return false;
  return true;
}
