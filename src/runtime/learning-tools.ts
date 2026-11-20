import {directedRouteLookup,directedRouteLookupDescription} from './directed-route-tools.js';
import {LearningDataError} from '../learning/research-data.js';
import {DirectedRouteInputError,type DirectedRouteQuery} from '../learning/directed-route.js';
import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { LearningCall } from './learning-task.js';
import type { LearningService } from '../learning/learning-service.js';
import type { ProofRef } from '../learning/research-data.js';

async function routeRead(read:()=>Promise<unknown>){
  let value:unknown;
  try{value=await read();}catch(error){if(!(error instanceof DirectedRouteInputError||error instanceof LearningDataError&&['STALE_SOURCE','NOT_FOUND'].includes(error.code)))throw error;value={readNotice:error.message};}
  return {content:[{type:'text' as const,text:JSON.stringify(value)}],details:{}};
}
export function learningTools(service: LearningService, call: LearningCall): ToolDefinition[] {
  const resources:ToolDefinition[]=call.resourceReadGrants?[defineTool({name:'read_research_resource',label:'Validate exact learning resource',description:'Validate an exact frozen learning resource grant.',
    parameters:Type.Object({id:Type.String(),version:Type.Integer({minimum:1})},{additionalProperties:false}),
    execute:async(_id,ref)=>{await service.readResource(call,ref);return {content:[],details:{}};},
  })]:[];
  if(call.modelDirectedKnowledge)resources.push(defineTool({name:'lookup_learning_routes',label:'Browse learning library',description:directedRouteLookupDescription,parameters:directedRouteLookup,execute:async(_id,args)=>routeRead(()=>service.lookupLearningRoutes(call,args as DirectedRouteQuery))}),defineTool({name:'open_learning_route',label:'Read selected learning resource',description:'Read the exact method or Strategy returned by a directory lookup, with its scope and complete body.',parameters:Type.Object({selection:Type.Integer({minimum:1})},{additionalProperties:false}),execute:async(_id,{selection})=>routeRead(()=>service.openLearningRoute(call,selection))}));
  if (call.purpose !== 'v2-strategy') return resources;
  return [...resources,defineTool({ name: 'read_final_proof', label: 'Read final proof',
    description: 'Read the exact final proof referenced by a supplied outline. No exploration records are accessible.',
    parameters: Type.Object({ ref: Type.Object({ sessionId: Type.String(), caseId: Type.String(), hypothesisId: Type.String(), hypothesisRevision: Type.String(),
      revision: Type.Integer(), semanticRevision: Type.Integer(), contentHash: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    execute: async (_id, { ref }) => ({ content: [{ type: 'text' as const, text: JSON.stringify(await service.readProof(call, ref as ProofRef)) }], details: {} }),
  })];
}
