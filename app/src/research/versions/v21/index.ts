import type {ResearchLoopBundleV21} from '../../contracts/loop.js';
import {ResearchEngineV21} from './engine.js';
import {createProject} from './state.js';
import {parseProject,parseConfig,parseInFlight} from './schemas.js';
import {assertBoundary,validateInvocation} from './boundaries.js';
import {roleSystemPrompt,taskPrompt} from './prompts.js';
export const v21:ResearchLoopBundleV21=Object.freeze<ResearchLoopBundleV21>({version:'2.1',workerProtocolVersion:'2.1',contractVersion:'2.1',projectSchemaVersion:3,acceptsSelectionFrom:Object.freeze(['2.1']),create:(store,runtime,composition)=>new ResearchEngineV21(store,runtime,composition),createProject:input=>{if(input.researchLoopVersion!=='2.1')throw new Error('V2.1 bundle requires its exact scientific version.');return createProject(input);},parseProject:value=>{const p=parseProject(value);if(p.researchLoopVersion!=='2.1')throw new Error('V2.1 bundle requires its exact scientific version.');return p;},parseConfig,parseInFlight:value=>{const m=parseInFlight(value);if(m.loop.researchLoopVersion!=='2.1')throw new Error('V2.1 marker version mismatch.');return m;},assertBoundary:(p,m,purpose)=>{if(p.researchLoopVersion!=='2.1')throw new Error('V2.1 boundary version mismatch.');assertBoundary(p,m,purpose);},validateInvocation,roleSystemPrompt,taskPrompt});
