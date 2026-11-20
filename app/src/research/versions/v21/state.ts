import { usesV3Proof } from '../v3/proof-version.js';
import { createHash } from 'node:crypto';
import type { ResearchProjectV21, ResearchConfigV21 } from '../../contracts/v21.js';
import { DEFAULT_CONFIG_V2 } from '../v2/state.js';
import { parseConfig, parseProject } from './schemas.js';
export const digestV21=(value:unknown):string=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const DEFAULT_CONFIG_V21:ResearchConfigV21=structuredClone(DEFAULT_CONFIG_V2);
// Token/cost observations are not scientific dispatch stops. No per-answer token cap.
for(const b of [DEFAULT_CONFIG_V21.roleBudget,...Object.values(DEFAULT_CONFIG_V21.workerBudgets)]){delete b.maxTokens;delete b.maxCostUsd;}
export function createProject(input:{id:string;name:string;hypothesis:string;config?:Partial<ResearchConfigV21>;researchLoopVersion?:string}):ResearchProjectV21 {
 if(input.researchLoopVersion!==undefined&&!['2.1','3.0','4.0'].includes(input.researchLoopVersion))throw new Error('V2.1 creation requires version 2.1.');
 const config=parseConfig({...structuredClone(DEFAULT_CONFIG_V21),...(usesV3Proof(input.researchLoopVersion)?{budgetControlEnabled:true}:{}),...input.config,epochBudget:{...DEFAULT_CONFIG_V21.epochBudget,...input.config?.epochBudget}},input.researchLoopVersion);
 const hypothesisId=`root_${digestV21([input.id,input.hypothesis]).slice(0,24)}`,revision='hypothesis_1';
 return parseProject({schemaVersion:3,researchLoopVersion:input.researchLoopVersion??'2.1',workerProtocolVersion:'2.1',id:input.id,name:input.name,rootInterpretationPending:true,originalHypothesis:input.hypothesis,hypothesis:input.hypothesis,hypothesisRevision:revision,hypothesisId,contentRevision:'initial',sources:[],config,status:'idle',phase:'idle',epoch:0,summary:'',processedCommandIds:[],refinements:[],root:{hypothesisId,revision,semanticRevision:1,originalText:input.hypothesis,workingText:input.hypothesis,workingRelation:'identical',returnToRoot:'The original user question, without weakened requirements.',domain:[],conditions:[],symbols:{},strength:'All requirements in the original user question.',completionCriteria:['Resolve all requirements of the exact original question.'],obligations:[{id:'root_obligation_1',statement:input.hypothesis}]},ways:[],questions:[],answers:[],reviews:[],epochs:[]});
}
export const createProjectState=createProject;
