import {Type} from 'typebox';
import type {ProofRef} from './research-data.js';

const text=Type.String({pattern:'\\S'});
export const objectionFields={claim:text,inference:text,body:text};
export const reviewSchema=Type.Union([
 Type.Object({status:Type.Literal('conditional'),condition:text,body:text},{additionalProperties:false}),
 Type.Object({status:Type.Union([Type.Literal('confirmed'),Type.Literal('unsupported')]),body:text},{additionalProperties:false}),
]);
export function matchesPendingReview(current:ReportUpdate|undefined,review?:ReportUpdate){
 return current?.status==='pending'&&review?.status==='pending'&&current.id===review.id&&current.revision===review.revision&&current.projectId===review.projectId&&current.epochId===review.epochId&&current.rootId===review.rootId&&current.artifactId===review.artifactId&&current.bodyHash===review.bodyHash;
}
export interface ReportObjection {claim:string;inference:string;body:string}
export type ReportDecision={status:'conditional';condition:string;body:string}|{status:'confirmed'|'unsupported';body:string};
export interface ReportUpdate extends ReportObjection {
 id:string; revision:number; projectId:string; epochId:string; rootId:string; artifactId:string; bodyHash:string;
 proofRef:ProofRef; opposingArtifactId?:string; status:'queued'|'pending'|ReportDecision['status']; previousCondition?:string; previousReview?:string; decisionHash?:string; condition?:string; review?:string;
}
