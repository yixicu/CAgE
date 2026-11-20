import type { ResearchLoopBundleV0 } from '../../contracts/loop.js';
import { ResearchEngineV0 } from './engine.js';
import { createProject } from './state.js';
import { parseProject,parseConfig,parseInFlight } from './schemas.js';
import { createOperationV0 } from './operation-contract.js';
import { roleSystemPrompt,taskPrompt } from './prompts.js';
export const v0:ResearchLoopBundleV0=Object.freeze<ResearchLoopBundleV0>({version:'0',workerProtocolVersion:'v0-native-1',contractVersion:'v0-test-1',projectSchemaVersion:4,acceptsSelectionFrom:Object.freeze(['0']),create:(s,r,c)=>new ResearchEngineV0(s,r,c),createProject,parseProject,parseConfig,parseInFlight,roleSystemPrompt,taskPrompt,
 assertBoundary(project,marker){parseProject(project);if(marker){parseInFlight(marker);if(marker.projectId!==project.id)throw new Error('V0 marker project mismatch.');}},
 validateInvocation(spec,inv){if(spec.contractVersion!=='v0-test-1'||spec.loop.researchLoopVersion!=='0'||spec.loop.workerProtocolVersion!=='v0-native-1'||spec.role!=='theorist'||inv.input.projectId!==spec.projectId||!['v0_plan','v0_solve','v0_single'].includes(inv.task))throw new Error('V0 invocation boundary mismatch.');createOperationV0(inv.task,inv.input,undefined,inv.operation);}
});
