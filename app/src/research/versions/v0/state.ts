import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ArchiveSelectionV0, PlanOutputV0, ResearchConfigV0, ResearchProjectV0, RootV0, SelectionV0, SolveOutcomeV0 } from '../../contracts/v0.js';
import { DEFAULT_CONFIG_V21 } from '../v21/state.js';
import { parseConfig, parseProject } from './schemas.js';
export const digestV0=(value:unknown):string=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const DEFAULT_CONFIG_V0:ResearchConfigV0=structuredClone(DEFAULT_CONFIG_V21);
export function createProject(input:{id:string;name:string;hypothesis:string;config?:Partial<ResearchConfigV0>;researchLoopVersion?:string}):ResearchProjectV0 {
 if(input.researchLoopVersion!==undefined&&input.researchLoopVersion!=='0')throw new Error('V0 creation requires exact version 0.');
 const config=parseConfig({...structuredClone(DEFAULT_CONFIG_V0),...input.config,epochBudget:{...DEFAULT_CONFIG_V0.epochBudget,...input.config?.epochBudget}});
 const hypothesisId=`root_${digestV0([input.id,input.hypothesis]).slice(0,24)}`,revision='hypothesis_1';
 return parseProject({schemaVersion:4,researchLoopVersion:'0',workerProtocolVersion:'v0-native-1',contractVersion:'v0-test-1',id:input.id,name:input.name,originalHypothesis:input.hypothesis,hypothesis:input.hypothesis,hypothesisId,hypothesisRevision:revision,contentRevision:'initial',sources:[],config,status:'idle',phase:'idle',epoch:0,summary:'',processedCommandIds:[],refinements:[],root:{hypothesisId,revision,semanticRevision:1,originalText:input.hypothesis,domain:[],conditions:[],symbols:{},strength:'All exact original requirements.',returnToRoot:'Resolve the complete original user question.',completionCriteria:[],obligations:[]},rootInterpretationPending:true,scientificVerdict:'open',archiveStatus:'none',epochs:[]});
}
export const createProjectState=createProject;
export function selectWayV0(plan:PlanOutputV0,epochId:string,selectedAt:string):SelectionV0 {
 let best=-1;const candidates=plan.candidates.map((candidate,i)=>{if(!Number.isFinite(candidate.p)||candidate.p<0||candidate.p>1)throw new Error('Invalid finite route probability.');if(best<0||candidate.p>plan.candidates[best]!.p)best=i;return {...structuredClone(candidate),id:`${epochId}_route_${i+1}`};});
 if(!candidates.length&&!plan.blockers.length)throw new Error('No candidate requires explicit blockers.');
 return {planHash:digestV0(plan),candidates,selectedWayId:best<0?null:candidates[best]!.id,maxScore:best<0?null:candidates[best]!.p,tieRule:'first-in-plan',selectedAt};
}
export function assertSelectionV0(plan:PlanOutputV0,selection:SelectionV0,epochId:string):void {if(!isDeepStrictEqual(selectWayV0(plan,epochId,selection.selectedAt),selection))throw new Error('Selection differs from exact deterministic plan argmax.');}
/** Structural statements only; mathematical judgment remains the Theorist's. */
export function validateOutcomeV0(outcome:SolveOutcomeV0,root:RootV0,selectedWayId:string,sources:readonly {id:string}[]):void {
 if(outcome.rootId!==root.hypothesisId||outcome.rootRevision!==root.revision||outcome.selectedWayId!==selectedWayId)throw new Error('Outcome changed frozen root or selected route.');
 const ids=outcome.obligations.map(o=>o.id);if(new Set(ids).size!==ids.length||ids.length!==root.obligations.length||root.obligations.some(o=>!ids.includes(o.id)))throw new Error('Outcome must cover every exact root obligation once.');
 if(outcome.dependencySourceIds?.some(id=>!sources.some(s=>s.id===id)))throw new Error('Unknown scientific source dependency.');
 if(new Set(outcome.conditions).size!==outcome.conditions.length||new Set(outcome.conditionChecks.map(c=>c.condition)).size!==outcome.conditionChecks.length||outcome.conditionChecks.length!==outcome.conditions.length||outcome.conditions.some(c=>!outcome.conditionChecks.some(check=>check.condition===c)))throw new Error('Each used condition needs one explicit condition judgment.');
 if(outcome.conditionChecks.some(c=>c.basis==='root-context'&&!root.conditions.includes(c.condition)))throw new Error('Root-context condition must name an exact frozen root condition; establish other conditions scientifically.');
 if(outcome.verdict!=='open'&&(outcome.gaps.length||outcome.obligations.some(o=>o.status==='open')||outcome.conditionChecks.some(c=>c.basis==='unresolved')))throw new Error('Unresolved gaps, obligations or conditions cannot close original root.');
 if(outcome.verdict==='solved'&&outcome.obligations.some(o=>o.status!=='satisfied'))throw new Error('Solved requires all original obligations satisfied.');
}
export function validateArchiveSelectionV0(selection:ArchiveSelectionV0):void {
 if(selection.outcome.verdict==='open'||selection.answerRef.completeness!=='complete')throw new Error('Only complete original-root conclusions can archive.');
 validateOutcomeV0(selection.outcome,selection.root,selection.way.id,selection.possibleDependencySources);
 const r=selection.answerRef;if(r.projectId!==selection.projectId||r.epochId!==selection.epochId||r.rootId!==selection.root.hypothesisId||r.rootRevision!==selection.root.revision||r.planHash!==selection.planHash||r.routeId!==selection.way.id||r.protocolVersion!=='v0-native-1')throw new Error('Archive raw owner does not match the exact selection.');
}

/** Scientific premise identity preserves exact provenance but ignores a checkpoint-only locator revision when byte fingerprints agree. */
export function samePremiseV0(a:import('../../contracts/v0.js').SourceRevisionRef,b:import('../../contracts/v0.js').SourceRevisionRef):boolean {return a.id===b.id&&a.path===b.path&&a.external===b.external&&(a.fingerprint&&b.fingerprint?a.fingerprint===b.fingerprint:a.revision===b.revision);}

export class StaleEvidenceV0Error extends Error { constructor(message:string){super(message);this.name='StaleEvidenceV0Error';} }
