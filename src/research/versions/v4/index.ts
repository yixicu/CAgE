import type { ResearchLoopBundleV21 } from '../../contracts/loop.js';
import { v3 } from '../v3/index.js';
import { createProject } from '../v21/state.js';
import { parseProject, parseInFlight } from '../v21/schemas.js';
import { assertBoundary, validateInvocation } from '../v21/boundaries.js';
import { roleSystemPrompt, taskPrompt } from '../v21/prompts.js';
import { ResearchVersionError } from '../../contracts/errors.js';
/** V4 stage-aware proof behavior, sharing schema3 storage and the existing worker protocol. */
export const v4:ResearchLoopBundleV21=Object.freeze<ResearchLoopBundleV21>({
 version:'4.0',workerProtocolVersion:'2.1',contractVersion:'2.1',projectSchemaVersion:3,acceptsSelectionFrom:Object.freeze(['4.0']),
 create:v3.create,
 createProject:input=>{if(input.researchLoopVersion!=='4.0')throw new ResearchVersionError();return createProject(input);},
 parseProject:value=>{const project=parseProject(value);if(project.researchLoopVersion!=='4.0')throw new ResearchVersionError();return project;},
 parseInFlight:value=>{const marker=parseInFlight(value);if(marker.loop.researchLoopVersion!=='4.0')throw new ResearchVersionError();return marker;},
 assertBoundary:(project,marker,purpose)=>{if(project.researchLoopVersion!=='4.0'||marker&&marker.loop.researchLoopVersion!=='4.0')throw new ResearchVersionError();assertBoundary(project,marker,purpose);},
 parseConfig:v3.parseConfig,validateInvocation,roleSystemPrompt,taskPrompt,
});
