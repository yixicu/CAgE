import type { ResearchLoopBundleV21 } from '../../contracts/loop.js';
import { ResearchEngineV21 } from '../v21/engine.js';
import { createProject } from '../v21/state.js';
import { parseProject, parseConfig, parseInFlight } from '../v21/schemas.js';
import { assertBoundary, validateInvocation } from '../v21/boundaries.js';
import { roleSystemPrompt, taskPrompt } from '../v21/prompts.js';
import { ResearchVersionError } from '../../contracts/errors.js';
/** V3 scientific behavior, sharing schema3 storage and the existing worker protocol. */
export const v3:ResearchLoopBundleV21=Object.freeze<ResearchLoopBundleV21>({
 version:'3.0',workerProtocolVersion:'2.1',contractVersion:'2.1',projectSchemaVersion:3,acceptsSelectionFrom:Object.freeze(['3.0']),
 create:(store,runtime,composition)=>new ResearchEngineV21(store,runtime,composition),
 createProject:input=>{if(input.researchLoopVersion!=='3.0')throw new ResearchVersionError();return createProject(input);},
 parseProject:value=>{const project=parseProject(value);if(project.researchLoopVersion!=='3.0')throw new ResearchVersionError();return project;},
 parseInFlight:value=>{const marker=parseInFlight(value);if(marker.loop.researchLoopVersion!=='3.0')throw new ResearchVersionError();return marker;},
 assertBoundary:(project,marker,purpose)=>{if(project.researchLoopVersion!=='3.0'||marker&&marker.loop.researchLoopVersion!=='3.0')throw new ResearchVersionError();assertBoundary(project,marker,purpose);},
 parseConfig: value=>parseConfig({...value as object,budgetControlEnabled:(value as {budgetControlEnabled?:boolean})?.budgetControlEnabled===undefined?true:(value as {budgetControlEnabled?:boolean}).budgetControlEnabled}),validateInvocation,roleSystemPrompt,taskPrompt,
});
