import {Type} from 'typebox';
import {FIELD_TAG_GUIDANCE} from '../shared/knowledge-fields.js';

export const mapNodeTypes=['definition','basic-knowledge','concept','theorem','theory','observation'] as const;
export type MapNodeType=typeof mapNodeTypes[number];
export const mapNodeTypeSchema=Type.Union(mapNodeTypes.map(value=>Type.Literal(value)));

export const authoredRelationKinds=['prerequisite','uses-definition','upper-structure','related','specializes'] as const;
export const observationRelationKinds=['tests','measures','measured-in'] as const;
export type AuthoredRelationKind=typeof authoredRelationKinds[number]|typeof observationRelationKinds[number];
export interface AuthoredRelation<T> {target:T;kind:AuthoredRelationKind;basis:string;direction:'forward'|'symmetric'}

export function validNodeType(kind:string,type:MapNodeType){
 return kind===type||kind==='concept'&&type==='definition'||(kind==='concept'||kind==='theorem')&&type==='basic-knowledge';
}

export const MAP_NODE_WRITING=[
 'Use a short searchable title naming the defined object, theorem, claim, or measured observable. Choose its scientific nodeType and domain tags. '+FIELD_TAG_GUIDANCE,
 'State the definition, law or result and its conditions in the body. Write every formula in LaTeX. Use $...$ for inline symbols and compact index formulas. In a proof or derivation, put each explanatory sentence or step on its own line. Put each equation used as a proof step, or a coherent group of equations, on its own $$...$$ line. Separate successive steps with blank lines. A verbal argument can stay entirely in prose.',
 'When an exact target is justified, label the link prerequisite, uses-definition, or upper-structure, point it from this entry to that target and explain its role. Keep the actual proof premises and their conditions with the derivation.'
].join(' ');
