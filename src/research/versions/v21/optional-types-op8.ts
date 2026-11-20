/** Small explicit operation8 spine. Historical operation1–7 records never use it. */
import type { RawAnswerRefV21, TechnicalStateV21, RootV21, RootInterpretationV21, FrozenQuestionV21, OperationPinV21 } from '../../contracts/v21.js';
import type { ResourceRef, ProofRef } from '../../../learning/research-data.js';
export const OPTIONAL_MODE_V21 = 'theorist-owned-optional-workers-v2' as const;
export type OptionalAuthorV21 = 'theorist'|'auxiliary-worker'|'way-worker';
export interface OptionalRouteV21 { methodKey:string; description:string; reason:string; resourceRefs:ResourceRef[] }
export interface OptionalOutcomeV21 {
 resultKind:'open'|'supported-result'|'valid-refutation'; scope:'root'|'local';
 conditions:string[]; gaps:string[]; obligationIds:string[]; dependencyArtifactIds:string[];
 reason:string; reproducible:boolean; tags:string[]; outline:string[];
}
export interface OptionalWorkerRequestV21 {
 kind:'auxiliary-worker'|'way-worker'; route:OptionalRouteV21; question:string;
 conditions:string[]; symbols:Record<string,string>; rootObligationIds:string[];
 checks:string[]; effort:'shallow'|'deep'; reason:string;
}
export interface OptionalAdoptionV21 { scientificFailure?:boolean; artifactId:string; status:'valid'|'rejected'|'deferred'; outcome:OptionalOutcomeV21; reason:string }
export interface OptionalControlV21 {
 failures?:{artifactIds:string[];patternKey:string;summary:string;tags:string[];scientific:boolean;generalizable:boolean}[];
 action:'dispatch'|'continue'|'complete'|'pause'; route:OptionalRouteV21; outcome:OptionalOutcomeV21;
 rootInterpretation?:RootInterpretationV21; workers:OptionalWorkerRequestV21[];
 adoptions:OptionalAdoptionV21[]; nearTieReason?:string;
}
export interface OptionalTheoristResultV21 { control:OptionalControlV21; originalRef:RawAnswerRefV21; technical:TechnicalStateV21 }
export interface OptionalProofArtifactV21 extends OptionalTheoristResultV21 {
 judgment?:{callId:string;evidenceRevision:number}; scientificFailure?:boolean; id:string; authorRole:OptionalAuthorV21; root:RootV21; route:OptionalRouteV21;
 exposureArtifactIds:string[]; qualification:'unreviewed'|'valid'|'rejected'|'deferred'|'needs-review';
 acceptedOutcome?:OptionalOutcomeV21; adoptionReason?:string; createdAt:string;
}
export interface OptionalBranchV21 {
 id:string; kind:'auxiliary-worker'|'way-worker'; callId:string; frozen:FrozenQuestionV21;
 state:'ready'|'running'|'completed'|'uncertain'|'cancelled'; artifactId?:string;
}
export interface OptionalProofSelectionV21 {
 operationId:string; projectId:string; epochId:string; caseGroupId:string; evidenceRevision:number;
 root:RootV21; artifact:OptionalProofArtifactV21; dependencies:OptionalProofArtifactV21[];
}
export interface OptionalArchiveReceiptV21 {
 operationId:string; artifactId:string; selectionHash:string; selection:OptionalProofSelectionV21;
 status:'pending'|'saved'; proofRef?:ProofRef; error?:string;
}
export interface OptionalFlowV21 {
 version:1; sequence:number; notices:string[]; artifacts:OptionalProofArtifactV21[]; branches:OptionalBranchV21[];
 archives:OptionalArchiveReceiptV21[]; evidenceRevision:number; reviewedArtifactIds:string[];
 deliveryHistory:{artifactId:string;proofRef:ProofRef;deliveredAt:string}[];
 selectedArtifactId?:string; foregroundCompletedAt?:string; conflictArtifactIds:string[];
 phase:'solve'|'collect'|'done'|'stopped'|'paused'; continuationNeeded:boolean;
}
export type OptionalOperationPinV21 = OperationPinV21;
