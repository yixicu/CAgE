import { foregroundBudgetV4 } from '../v4/foreground-budget.js';
import { usesV3Proof } from '../v3/proof-version.js';
import {isDeepStrictEqual} from 'node:util';
import {assertFrozenCapacityV3} from '../v3/capacity-policy.js';
import type {ResearchProjectV21,InFlightEpochV21,AgentSessionSpecV21,AgentInvocationV21} from '../../contracts/v21.js';
import {ResearchVersionError} from '../../contracts/errors.js';
import {parseProject,parseInFlight} from './schemas.js';
import {digestV21} from './state.js';
export function assertBoundary(project:ResearchProjectV21,marker:InFlightEpochV21|undefined,_purpose:'execute'|'select'):void {parseProject(project);if(marker){parseInFlight(marker);if(marker.projectId!==project.id||marker.loop.researchLoopVersion!==project.researchLoopVersion)throw new ResearchVersionError();}}
export function validateInvocation(spec:AgentSessionSpecV21,inv:AgentInvocationV21):void {
 if(spec.contractVersion!=='2.1'||!['2.1','3.0','4.0'].includes(spec.loop.researchLoopVersion)||spec.loop.workerProtocolVersion!=='2.1'||!['v21_plan','v21_check','v21_worker_answer','v21_theorist','v21_optional_worker'].includes(inv.task))throw new ResearchVersionError();
 const theoryRevision='brief'in spec.context?spec.context.brief.theoryRevision:spec.context.marker.snapshot.theoryRevision;
 if((spec.loop.researchLoopVersion==='4.0')!==(['v4-operation-1','v4-operation-2','v4-operation-3','v4-operation-4','v4-operation-5'].includes(theoryRevision??'')))throw new ResearchVersionError('Session and frozen theory revision differ.');
 if('marker'in spec.context&&(spec.context.marker.loop.researchLoopVersion!==spec.loop.researchLoopVersion||spec.context.project.researchLoopVersion!==spec.loop.researchLoopVersion))throw new ResearchVersionError('Session and project versions differ.');
 if('marker'in spec.context&&spec.context.marker.snapshot.capacityPolicy){assertFrozenCapacityV3(spec.context.marker);if(!isDeepStrictEqual(spec.context.snapshot,spec.context.marker.snapshot)||!isDeepStrictEqual(spec.budget,foregroundBudgetV4(spec.context.snapshot))||!isDeepStrictEqual(spec.model,spec.context.snapshot.modelConfig.roleModels?.[spec.role]??spec.context.snapshot.modelConfig.defaultModel))throw new ResearchVersionError('Frozen foreground capacity differs.');}
 if(['v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(inv.operation?.revision??'')&&spec.loop.researchLoopVersion!=='4.0')throw new ResearchVersionError('Canonical V4 proof pin cannot execute in another scientific family.');
 if(inv.task==='v21_theorist'||inv.task==='v21_optional_worker'){
  if(!['v21-operation-8','v21-operation-9','v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(inv.operation?.revision??'')||inv.operation?.solverMode!=='theorist-owned-optional-workers-v2'||inv.operation?.task!==inv.task||inv.operation?.inputHash!==digestV21(inv.input))throw new ResearchVersionError('Optional proof invocation requires its exact explicit operation8/9 pin.');
  if((['v3-operation-1','v3-operation-2','v3-operation-3','v3-operation-4','v3-operation-5','v3-operation-6','v4-proof-2','v4-proof-3','v4-proof-4','v4-proof-5'].includes(inv.operation?.revision??''))!==(usesV3Proof(spec.loop.researchLoopVersion)))throw new ResearchVersionError('V3 execution cannot alias historical operation pins.');
  if(spec.loop.researchLoopVersion==='4.0'&&inv.operation?.revision!==(theoryRevision==='v4-operation-5'?'v4-proof-5':theoryRevision==='v4-operation-4'?'v4-proof-4':theoryRevision==='v4-operation-3'?'v4-proof-3':theoryRevision==='v4-operation-2'?'v4-proof-2':'v3-operation-6'))throw new ResearchVersionError('V4 requires the operation-6 proof contract.');
  const declaredRevision='brief'in spec.context?spec.context.brief.operationRevision:spec.context.marker.optionalFlow?.operationRevision;
  if((declaredRevision??'v21-operation-8')!==inv.operation?.revision)throw new ResearchVersionError('Optional invocation protocol differs from its frozen execution context.');
  const input=inv.input as Record<string,unknown>;if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.boundaryId!=='string'||!input.boundaryId)throw new ResearchVersionError('Optional proof boundary identity is missing.');
  if(inv.task==='v21_optional_worker'){
   if(spec.role!=='worker'||!('brief'in spec.context)||!spec.context.brief.solverRole||input.boundaryId!==spec.context.brief.callId)throw new ResearchVersionError('Optional worker invocation requires its frozen role and call identity.');
   const {boundaryId:_,...frozen}=input;if(digestV21(frozen)!==digestV21(spec.context.brief))throw new ResearchVersionError('Optional worker input differs from its frozen assignment.');
  }else if(spec.role!=='theorist'||!('project'in spec.context)||spec.context.project.id!==spec.projectId||spec.context.marker.solverMode!=='theorist-owned-optional-workers-v2'||spec.context.marker.snapshot.solverMode!=='theorist-owned-optional-workers-v2'||digestV21(input.root)!==digestV21(spec.context.marker.snapshot.root))throw new ResearchVersionError('Optional Theorist boundary differs from its explicitly frozen mode/root.');
  return;
 }
 if(('brief'in spec.context&&spec.context.brief.solverRole)||('marker'in spec.context&&spec.context.marker.solverMode))throw new ResearchVersionError('Explicit optional proof boundaries cannot dispatch a historical operation.');
 if(inv.task==='v21_worker_answer'){if(spec.role!=='worker'||!('brief'in spec.context)||spec.context.brief.projectId!==spec.projectId||digestV21(inv.input)!==digestV21(spec.context.brief))throw new ResearchVersionError('Worker invocation differs from its immutable frozen input.');}
 else if(spec.role!=='theorist'||!('project'in spec.context)||spec.context.project.id!==spec.projectId||!inv.operation||inv.operation?.task!==inv.task||inv.operation?.inputHash!==digestV21(inv.input))throw new ResearchVersionError('Control invocation requires its exact frozen operation pin.');
}
