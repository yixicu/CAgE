/** Opt-in frozen boundary metadata; historical shared resource schemas remain unchanged. */
import {Type,type TSchema} from 'typebox';
import {BoundaryViewSchema,ResourceRefSchema} from '../../contracts/review.js';
const obj=(properties:Record<string,TSchema>)=>Type.Object(properties,{additionalProperties:false});
const short=Type.String({minLength:1,maxLength:10000});
const proofRef=obj({sessionId:short,caseId:short,hypothesisId:short,hypothesisRevision:short,revision:Type.Integer({minimum:1}),semanticRevision:Type.Integer({minimum:1}),contentHash:short});
const supportBase={recipe:Type.Literal('strategy-support-v1'),parent:Type.Optional(ResourceRefSchema),directSourceRefs:Type.Array(proofRef,{minItems:1,maxItems:64})};
const support=Type.Union([
 obj({...supportBase,mode:Type.Literal('revise')}),
 obj({...supportBase,mode:Type.Literal('independent-rebuild'),justification:Type.String({minLength:1,maxLength:4000,pattern:'\\S'})}),
]);
const historical=(BoundaryViewSchema.properties.skills as {items:TSchema}).items;
export const ResourceMetadataSchemaV3=Type.Union([historical,obj({...(historical as {properties:Record<string,TSchema>}).properties,kind:Type.Literal('specific-strategy'),strategySupport:support})]);
