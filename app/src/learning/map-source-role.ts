import type {MapSource} from './knowledge-map.js';

/** Preserve the recorded evidence class when a public result returns to map maintenance. */
export function isEmpiricalMapSource(source:MapSource):boolean {
 const origin=source.origin as {empiricalEvidence?:boolean;seed?:{kind?:string}}|undefined;
 return origin?.empiricalEvidence===true || (source.ref.kind==='user-seed'&&origin?.seed?.kind==='observation');
}
