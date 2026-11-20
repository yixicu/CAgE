import { Type } from 'typebox';
import { normalizeTags } from '../../../learning/research-data.js';
/** Reject values which would become an empty suffix or extra colon under the
 * existing library's NFKC normalization. These are all Unicode compatibility
 * characters whose decomposition contains ':'; no submitted text is rewritten.
 * The nonblank suffix lookahead uses the same ECMAScript whitespace semantics
 * as the library's trim/whitespace normalization. */
export const V21_TAG_PATTERN = '^(subject|specialization|method|problem-type|pitfall):(?=[\\s\\S]*\\S)[^:⩴︓﹕：]+$';
export const TagsSchemaV21 = Type.Array(Type.String({minLength:1,maxLength:200,pattern:V21_TAG_PATTERN,description:'At most 200 UTF-16 code units; this exact library limit is checked by local semantic preflight. Provider maxLength is a Unicode-codepoint structural approximation.'}),{minItems:1,maxItems:64});
/** Read-only compatibility check: normalization is never returned or persisted. */
export function validTagsV21(value:unknown):value is string[] {
 if(!Array.isArray(value)||value.length<1||value.length>64||value.some(tag=>typeof tag!=='string'||tag.length>200||!new RegExp(V21_TAG_PATTERN,'u').test(tag)))return false;
 try{normalizeTags(value);return true;}catch{return false;}
}
