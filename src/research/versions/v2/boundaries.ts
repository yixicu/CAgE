import { isDeepStrictEqual } from 'node:util';
import { WORKER_PROTOCOL } from '../../contracts/v1.js';
import type { AgentInvocationV2, AgentSessionSpecV2, InFlightEpoch, ResearchProjectV2 } from '../../contracts/v2.js';
import { ResearchSelectionError, ValidationError } from '../../contracts/errors.js';
export function assertBoundary(project:ResearchProjectV2,marker:InFlightEpoch|undefined,purpose:'execute'|'select'):void {
  if(project.schemaVersion!==2||project.researchLoopVersion!=='2.0'||project.workerProtocolVersion!=='2.0')throw new ValidationError('V2 version provenance');
  if(marker&&(marker.loop.researchLoopVersion!=='2.0'||marker.loop.workerProtocolVersion!=='2.0'||marker.projectId!==project.id))throw new ValidationError('V2 in-flight provenance');
  if(purpose==='select'&&(marker||project.phase!=='idle'||project.status==='running'))throw new ResearchSelectionError('RESEARCH_VERSION_BUSY','V2 selection requires a saved idle Epoch boundary.');
}
export function validateInvocation(spec:AgentSessionSpecV2,invocation:AgentInvocationV2):void {
  const allowed:Record<string,readonly string[]>={theorist:['v2_generate_ways','v2_synthesize','v2_decision_check','v2_audit','v2_route_knowledge','v2_review_way_skill'],worker:['v2_worker_step'],moderator:['v2_moderate'],literature:['v2_literature']};
  if(spec.contractVersion!=='2'||spec.loop.researchLoopVersion!=='2.0'||!allowed[spec.role]?.includes(invocation.task))throw new ValidationError('V2 role task');
  if(spec.role==='worker'){
    const input=invocation.input as {brief?:unknown;step?:unknown}|null;
    if(!('brief' in spec.context)||!invocation.step||!WORKER_PROTOCOL.includes(invocation.step)||!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='brief,step'||input.step!==invocation.step||!isDeepStrictEqual(input.brief,spec.context.brief))throw new ValidationError('V2 isolated Worker protocol');
  }
  if(spec.role!=='worker'&&invocation.step)throw new ValidationError('V2 step only for Worker');
}
