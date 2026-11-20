import { createHash } from 'node:crypto';
import type { DecisionObservation, DecisionPolicy, PolicySnapshot, PossibleWay, StrategySnapshot, WaySkill } from '../../contracts/v2.js';
import { ValidationError } from '../../contracts/errors.js';
export type DecisionKind='effort'|'overlap'|'mode'|'refill'|'audit';
const choices:Record<DecisionKind,readonly string[]>={effort:['shallow','deep','defer'],overlap:['distinct','duplicate','defer'],mode:['conservative','exploring','challenge','defer'],refill:['dispatch','defer'],audit:['audit','defer']};
export interface DecisionInput { id:string; kind:DecisionKind; scores:Record<string,number>; uncertainty?:number; rationale:string }
export interface DecisionJudgment { selectedAction:string; uncertainty:number; rationale:string }
export async function fastDecision(input:DecisionInput,policy:DecisionPolicy,piCheck?:(input:DecisionInput,choices:readonly string[])=>Promise<unknown>):Promise<DecisionObservation> {
  const allowed=choices[input.kind];
  if(!allowed||(input.uncertainty===undefined ? input.kind!=='effort' : !Number.isFinite(input.uncertainty)||input.uncertainty<0||input.uncertainty>1)||Object.entries(input.scores).some(([k,v])=>!allowed.includes(k)||!Number.isFinite(v)||v<0||v>1))throw new ValidationError('V2 bounded decision input');
  const ordered=Object.entries(input.scores).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const uncertainty=input.uncertainty===undefined?undefined:Math.max(input.uncertainty,ordered.length>1?1-(ordered[0][1]-ordered[1][1]):ordered.length?0:1);
  const out:DecisionObservation={id:input.id,inputDigest:createHash('sha256').update(JSON.stringify(input)).digest('hex'),choices:[...allowed],ruleAction:ordered[0]?.[0],...(input.kind==='effort'?{allocationSource:'theorist' as const}:{}),...(uncertainty===undefined?{}:{initialUncertainty:uncertainty,uncertainty}),selectedAction:ordered[0]?.[0],reliable:uncertainty!==undefined&&uncertainty<=policy.uncertaintyThreshold,piCheckRan:false,policyVersion:policy.version,rationale:input.rationale,escalated:false};
  if(out.reliable)return out;
  if(piCheck){out.piCheckRan=true;try{const value=await piCheck(structuredClone(input),allowed);if(!value||typeof value!=='object')throw new Error();const check=value as DecisionJudgment;if(Object.keys(check).sort().join(',')!=='rationale,selectedAction,uncertainty'||!allowed.includes(check.selectedAction)||!Number.isFinite(check.uncertainty)||check.uncertainty<0||check.uncertainty>1||typeof check.rationale!=='string'||!check.rationale.trim())throw new Error();if(check.selectedAction!==out.selectedAction)out.disagreement=`Rule ${out.selectedAction??'none'}; CAgE review ${check.selectedAction}`;out.selectedAction=check.selectedAction;if(input.kind==='effort')out.allocationSource='review';out.uncertainty=check.uncertainty;out.rationale=check.rationale;out.reliable=check.uncertainty<=policy.uncertaintyThreshold;}catch{out.rationale+='; the CAgE review failed validation or execution.';}}
  if(!out.reliable){out.escalated=true;if(input.kind!=='effort')out.selectedAction='defer';else if(out.allocationSource!=='review'){out.allocationSource='fallback';out.rationale+='; optional allocation review unavailable or invalid: retain the Theorist planned effort, without claiming allocation confidence or scientific success.';}}
  return out;
}
export interface FusedWay { way:PossibleWay; score:number; factors:Record<string,number> }
/** New effort observations record an advisory allocation, never a risk veto. */
export function replayEffortAllowed(way: PossibleWay, observed: DecisionObservation | undefined, threshold: number): boolean {
  if (observed?.allocationSource) return observed.selectedAction === way.effort;
  // Historical records retain their original dispatch semantics.
  if (!observed) return way.priorityInputs.uncertainty <= threshold;
  if (observed.initialUncertainty !== undefined && observed.initialUncertainty <= threshold) return observed.ruleAction === way.effort;
  return observed.piCheckRan && observed.uncertainty !== undefined && observed.uncertainty <= threshold && observed.selectedAction === way.effort;
}
/** Dispatch ranking only: never emits a scientific verdict, and complexity cannot veto. */
export function fuseWays(ways:readonly PossibleWay[],strategy:StrategySnapshot,policy:PolicySnapshot,_remainingCost=Infinity,selectedDomains:readonly string[]=[],skills:readonly WaySkill[]=[]):FusedWay[] {
  const seen=new Set<string>();const ranked:FusedWay[]=[];
  for(const way of ways){if(seen.has(way.dedupeKey))continue;seen.add(way.dedupeKey);const p=way.priorityInputs,w=policy.decision.weights;
    const allocation=way.domainIds.reduce((sum,id)=>sum+(strategy.domains.find(d=>d.id===id)?.allocation??0),0);
    const preference = skills.find(skill => skill.id === way.waySkillId)?.preference ?? 0.5;
    const factors={allocation,relevance:p.relevance*w.relevance,discrimination:p.discrimination*w.discrimination,novelty:p.novelty*w.novelty,duplication:-p.duplication*w.duplication,diversity:p.diversity*w.diversity*(way.domainIds.some(id=>!selectedDomains.includes(id))?1:0),uncertainty:-p.uncertainty*0.05,exploration:policy.decision.explorationBudget*p.novelty*p.diversity,mode:strategy.recommendation.modes[way.mode]*0.05,skill:(preference-0.5)*w.relevance};
    ranked.push({way:structuredClone(way),score:Object.values(factors).reduce((a,b)=>a+b,0),factors});
  }
  ranked.sort((a,b)=>b.score-a.score||a.way.id.localeCompare(b.way.id));
  // Fixed evidence bands preserve a transitive sort; Occam adjusts only genuinely comparable neighbors.
  for(let start=0;start<ranked.length;){const first=ranked[start],tol=policy.occam.comparableEvidenceTolerance;let end=start+1;
    while(end<ranked.length&&Math.abs(ranked[end].score-first.score)<=tol&&Math.abs(ranked[end].way.priorityInputs.relevance-first.way.priorityInputs.relevance)<=tol&&Math.abs(ranked[end].way.priorityInputs.discrimination-first.way.priorityInputs.discrimination)<=tol)end++;
    const band=ranked.slice(start,end).sort((a,b)=>(b.score-policy.occam.complexityWeight*b.way.priorityInputs.complexity)-(a.score-policy.occam.complexityWeight*a.way.priorityInputs.complexity)||a.way.id.localeCompare(b.way.id));ranked.splice(start,band.length,...band);start=end;
  }return ranked;
}
export const decisionFusion=fuseWays;

export interface AuditPair { resultIds:[string,string]; sharedBasis:string[]; demonstrableConflict:boolean }
/** Inverted provenance index, never an up-front Cartesian product of domains. */
export function selectAuditPairs(tasks:readonly import('../../contracts/v2.js').EpochTask[],maximumPairsOrPolicy:number|PolicySnapshot=8):AuditPair[]{
  const audit=typeof maximumPairsOrPolicy==='number'?{maxPairs:maximumPairsOrPolicy,basisWeights:{anchor:1,premise:1,limit:1}}:maximumPairsOrPolicy.audit??{maxPairs:8,basisWeights:{anchor:1,premise:1,limit:1}};const maximumPairs=audit.maxPairs;
  if(!Number.isInteger(maximumPairs)||maximumPairs<1||maximumPairs>100)throw new ValidationError('V2 audit bound');
  const index=new Map<string,import('../../contracts/v2.js').EpochTask[]>(),pairs=new Map<string,AuditPair>();
  for(const task of tasks){if(task.result?.executionStatus!=='completed')continue;const r=task.result;const keys=[...task.way.anchorIds.map(x=>`anchor:${x}`),...r.assumptions.map(x=>`premise:${x}`),...r.checkedLimits.map(x=>`limit:${x}`),...r.conflictingPropositions.map(x=>`conflict:${x}`)];
    for(const key of new Set(keys)){const prior=index.get(key)??[];
      // Compare a sparse representative; explicit contradictory propositions remain unsuppressed.
      const candidates=prior.slice(-1); // A sparse witness chain also preserves explicit conflicts without a quadratic pair expansion.
      for(const other of candidates){if(task.way.domainIds.every(id=>other.way.domainIds.includes(id)))continue;const ids=[other.id,task.id].sort() as [string,string],pairKey=ids.join(':');const actual=key.startsWith('conflict:')&&(r.conclusion==='contradictory'||other.result?.conclusion==='contradictory');const pair=pairs.get(pairKey)??{resultIds:ids,sharedBasis:[],demonstrableConflict:false};pair.sharedBasis.push(key);pair.demonstrableConflict ||= actual;pairs.set(pairKey,pair);}
      prior.push(task);index.set(key,prior);
    }
  }const score=(pair:AuditPair)=>pair.sharedBasis.reduce((n,key)=>n+(audit.basisWeights[key.split(':')[0] as keyof typeof audit.basisWeights]??0),0);const ordered=[...pairs.values()].sort((a,b)=>Number(b.demonstrableConflict)-Number(a.demonstrableConflict)||score(b)-score(a)||a.resultIds.join(':').localeCompare(b.resultIds.join(':')));return [...ordered.filter(p=>p.demonstrableConflict),...ordered.filter(p=>!p.demonstrableConflict).slice(0,maximumPairs)];
}
export function auditPairsToRecords(pairs:readonly AuditPair[],tasks:readonly import('../../contracts/v2.js').EpochTask[],provisional=true):import('../../contracts/v2.js').CrossDomainAudit[]{return pairs.map(pair=>({id:`audit-${pair.resultIds.join('-')}`,resultIds:pair.resultIds,sharedBasis:pair.sharedBasis,relation:'unresolved',rationale:pair.demonstrableConflict?'Explicit conflicting propositions require consistency review regardless of domain prior.':'Grounded shared basis merits comparison; no scientific relation inferred from score.',provisional,premises:[...new Set(pair.resultIds.flatMap(id=>tasks.find(t=>t.id===id)?.result?.assumptions??[]))]}));}
