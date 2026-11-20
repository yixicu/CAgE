/** Explicit optional solver types. Missing revision is historical operation8; operation9 is bound by the host. */
import type { RawAnswerRefV21, TechnicalStateV21, RootV21, RootInterpretationV21, FrozenQuestionV21, OperationPinV21 } from '../../contracts/v21.js';
import type { ResourceRef, ProofRef } from '../../../learning/research-data.js';
export const OPTIONAL_MODE_V21 = 'theorist-owned-optional-workers-v2' as const;
export const workerDispatchRule = 'Use dispatch only with outcome.resultKind=open and at least one Worker assignment. A Theorist completing an established root result and a Worker completing its assigned result use complete with no Worker assignments. Put any established intermediate findings in the public derivation.';
export type OptionalAuthorV21 = 'theorist'|'auxiliary-worker'|'way-worker';
export interface OptionalRouteV21 { methodKey:string; description:string; reason:string; resourceRefs:ResourceRef[] }
export interface OptionalOutcomeV21 {
 /** V3 actual computational dependencies only; absent in historical protocols. */
 fragmentRefs?:string[]; receiptRefs?:string[]; knowledgeRefs?:string[]; sourceRefs?:string[];
 resultKind:'open'|'supported-result'|'valid-refutation'|'empirical-exclusion'; refutationKind?:'counterexample'|'contradiction'; scope:'root'|'local';
 /** Historical operation8 declarations only; forbidden by the operation9 schema. */
 conditions?:string[]; obligationIds?:string[]; gaps:string[]; dependencyArtifactIds:string[];
 reason:string; reproducible:boolean; tags?:string[]; outline?:string[];
}
export interface OptionalWorkerRequestV21 {
 kind:'auxiliary-worker'|'way-worker'; route:OptionalRouteV21; question:string;
 /** Historical operation8 fields, never supplied by operation9 models. */
 conditions?:string[]; symbols:Record<string,string>; rootObligationIds?:string[];
 checks:string[]; effort:'shallow'|'deep'; reason:string;
}
export interface OptionalAdoptionV21 { scientificFailure?:boolean; artifactId:string; status:'valid'|'rejected'|'deferred'; outcome:OptionalOutcomeV21; reason:string }
export interface OptionalControlV21 {
 mapChanges?:import('../v4/scientific-map-write.js').ScientificMapChanges;
 publicStage?:import('../v4/fragments.js').PublicStageV4;
 failures?:{artifactIds:string[];patternKey:string;summary:string;tags:string[];scientific:boolean;generalizable:boolean}[];
 continueMain?:boolean;
 action:'dispatch'|'continue'|'complete'|'pause'; route:OptionalRouteV21; outcome:OptionalOutcomeV21;
 rootInterpretation?:RootInterpretationV21; workers:OptionalWorkerRequestV21[];
 adoptions:OptionalAdoptionV21[]; nearTieReason?:string;
}
export interface OptionalTheoristResultV21 { mapKnowledge?:import('../../../learning/knowledge-map.js').MapOpenResult[]; v3Execution?:import('../v3/integration.js').V3Execution; control:OptionalControlV21; originalRef:RawAnswerRefV21; technical:TechnicalStateV21 }
export interface OptionalProofArtifactV21 extends OptionalTheoristResultV21 {
 mapWriteReads?:import('../../../learning/knowledge-map.js').MapOpenResult[];
 publicReport?:{proofOutline?:string;body:string;bodyHash:string;pendingBranches:{id:string;state:string}[]};
 v4TheorySupport?:{sources:{projectId:string;artifactId:string}[];proofRefs:import('../../../learning/research-data.js').ProofRef[]};
 resultContract?:'scoped-refutation-v1'; operationRevision?:OptionalProtocolRevisionV21; acceptanceCommitted?:boolean;
 fragmentExposureRefs?:string[]; originalExposureRefs?:RawAnswerRefV21[]; continuationArtifactIds?:string[];
 judgment?:{callId:string;evidenceRevision:number}; scientificFailure?:boolean; id:string; authorRole:OptionalAuthorV21; root:RootV21; route:OptionalRouteV21;
 exposureArtifactIds:string[]; qualification:'unreviewed'|'valid'|'rejected'|'deferred'|'needs-review';
 acceptedOutcome?:OptionalOutcomeV21; adoptionReason?:string; createdAt:string;
}
export interface OptionalBranchV21 {
 id:string; kind:'auxiliary-worker'|'way-worker'; callId:string; frozen:FrozenQuestionV21;
 state:'ready'|'running'|'completed'|'uncertain'|'cancelled'; artifactId?:string;
}
export interface OptionalProofSelectionV21 {
 resultContract?:'scoped-refutation-v1';
 modelDirectedKnowledge?:true;
 sourceLoopVersion?:'4.0';
 operationId:string; projectId:string; epochId:string; caseGroupId:string; evidenceRevision:number;
 root:RootV21; artifact:OptionalProofArtifactV21; dependencies:OptionalProofArtifactV21[];
}
export interface OptionalArchiveReceiptV21 {
 operationId:string; artifactId:string; selectionHash:string; selection:OptionalProofSelectionV21;
 status:'pending'|'saved'; proofRef?:ProofRef; error?:string;
}
export interface OptionalFlowV21 {
 v3?:import('../v3/integration.js').V3FlowState;
 pendingEffects?:{callId:string;withdrawnIds:string[];restoredIds:string[];evidenceRevision:number;status:'pending'|'saved'}[];
 operationRevision?:OptionalProtocolRevisionV21; rawDeliveredAt?:string; rawDeliveryHistory?:{callId:string;originalRef:RawAnswerRefV21;deliveredAt:string}[];
 version:1; sequence:number; notices:string[]; artifacts:OptionalProofArtifactV21[]; branches:OptionalBranchV21[];
 archives:OptionalArchiveReceiptV21[]; evidenceRevision:number; reviewedArtifactIds:string[];
 deliveryHistory:{artifactId:string;proofRef:ProofRef;deliveredAt:string}[];
 selectedArtifactId?:string; foregroundCompletedAt?:string; conflictArtifactIds:string[];
 phase:'solve'|'collect'|'done'|'stopped'|'paused'; continuationNeeded:boolean;
}
export type OptionalProtocolRevisionV21 = 'v21-operation-8'|'v21-operation-9'|'v3-operation-1'|'v3-operation-2'|'v3-operation-3'|'v3-operation-4'|'v3-operation-5'|'v3-operation-6'|'v4-proof-2'|'v4-proof-3'|'v4-proof-4'|'v4-proof-5';
export type OptionalOperationPinV21 = OperationPinV21;
