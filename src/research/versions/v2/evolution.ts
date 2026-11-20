import { basePolicy, routeStrategy, applyPolicyStrategy } from './routing.js';
import { skillContent, learnedSkillId } from './learning.js';
import { operationalLessons } from './learning-failures.js';
import { createWaySkills } from './ways.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AgentRuntimeV2, EvolutionPublication, EvolutionReview, GlobalEvolutionState, PolicySnapshot, ReplayCase, ResearchProjectV2, ResearchTrace, WaySkill, WaySkillTrace } from '../../contracts/v2.js';
import { ValidationError } from '../../contracts/errors.js';
import { PolicySchema, WaySkillSchema, validate, consistencyGate } from './schemas.js';
import { replayEffortAllowed, fuseWays, selectAuditPairs } from './decision.js';

/** Implementation gates, not empirically calibrated learning guarantees. */
export const EVOLUTION_DEFAULTS=Object.freeze({minimumCases:3,maximumCases:100,maximumRegression:0,maximumCostRatio:1.25,localLearningRate:0.1});
export interface EvolutionInput {target:'policy'|'way_skill';candidate?:unknown;caseIds:string[];heldOutCaseIds:string[];scope:string;action:'review'|'rollback';rollbackVersion?:string}
export function adaptLocalWaySkills(skills:readonly WaySkill[],traces:readonly WaySkillTrace[],completedEpoch:number):WaySkill[] {
  return skills.map(skill=>{const relevant=traces.filter(t=>t.waySkillId===skill.id&&t.waySkillVersion===skill.version&&t.executionStatus==='completed');if(!relevant.length)return structuredClone(skill);const utility=relevant.reduce((s,t)=>s+t.informationValue,0)/relevant.length;return {...structuredClone(skill),scope:'local',version:`${skill.version}-e${completedEpoch}`,effectiveFromEpoch:completedEpoch+1,preference:Math.max(0,Math.min(1,skill.preference+EVOLUTION_DEFAULTS.localLearningRate*(utility-skill.preference))),evidenceTraceIds:[...new Set([...skill.evidenceTraceIds,...relevant.map(t=>t.id)])],limitations:skill.id.startsWith('learned-')?[...skill.limitations]:[...new Set([...skill.limitations,'Local observed utility only; not a global promotion or scientific proof.'])]};});
}
export const updateLocalWaySkills=adaptLocalWaySkills;
function mean(xs:number[]):number{return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function metrics(cases:ReplayCase[]):EvolutionReview['metrics']{const train=cases.filter(c=>!c.heldOut),held=cases.filter(c=>c.heldOut);return {baseline:mean(train.map(c=>c.baselineValue)),candidate:mean(train.map(c=>c.candidateValue)),heldOutBaseline:mean(held.map(c=>c.baselineValue)),heldOutCandidate:mean(held.map(c=>c.candidateValue))};}
function traceUtility(trace:ResearchTrace):number {return trace.executionStatus==='completed'?0.75*trace.informationValue+0.25*(trace.reviewed?.informationValue??0):0;}
function traceCost(trace:ResearchTrace):number{return trace.usage?.costKnown?trace.usage.costUsd??trace.budget.maxCostUsd??0:trace.budget.maxCostUsd??0;}
/** Re-run selection on committed historical candidates; evaluate selected work against explicitly reviewed outcomes. */
export function replayCases(projects:readonly ResearchProjectV2[],target:'policy'|'way_skill',candidate:PolicySnapshot|WaySkill,heldOutCaseIds:readonly string[],scope:string):ReplayCase[]{
  const auditValues=(p:PolicySnapshot)=>({maxPairs:p.audit?.maxPairs??8,basisWeights:p.audit?.basisWeights??{anchor:1,premise:1,limit:1}});
  const auditOnly=target==='policy'&&projects.some(p=>p.epochs.some(e=>!isDeepStrictEqual(auditValues(candidate as PolicySnapshot),auditValues(e.snapshot.policy))));
  return projects.map(project=>{
    const traces=(target==='policy'?project.strategyTraces:project.waySkillTraces).filter(t=>t.reviewed);
    const outcomes=new Map(traces.map(t=>[t.taskId,t]));
    const baseline:ResearchTrace[]=[],proposed:ResearchTrace[]=[];const auditIds:string[]=[],baselineAudit:number[]=[],candidateAudit:number[]=[],baselineAuditCost:number[]=[],candidateAuditCost:number[]=[];
    for(const epoch of project.epochs){
      if(auditOnly){
        const policy=candidate as PolicySnapshot,base=epoch.snapshot.policy;
        const oldAudit=auditValues(base),newAudit=auditValues(policy);const changedAuditSettings=Number(oldAudit.maxPairs!==newAudit.maxPairs)+(['anchor','premise','limit'] as const).filter(key=>oldAudit.basisWeights[key]!==newAudit.basisWeights[key]).length;if(changedAuditSettings>1)throw new ValidationError('V2 audit settings require one independently exercised preference change per review');
        const nonAudit=(p:PolicySnapshot)=>({userPreferenceWeight:p.userPreferenceWeight??1,domains:p.domains,anchors:p.anchors,modeBias:p.modeBias,strategies:p.strategies??[],decision:{...p.decision,version:''},occam:{...p.occam,version:''}});
        if(!isDeepStrictEqual(nonAudit(policy),nonAudit(base)))throw new ValidationError('V2 audit preference changes require an independent audit-only review');
        const recorded=epoch.audits.filter(a=>a.reviewed&&!a.provisional);if(!recorded.length)continue;
        const oldPairs=selectAuditPairs(epoch.tasks,base),newPairs=selectAuditPairs(epoch.tasks,policy);
        const lookup=(ids:[string,string])=>recorded.find(a=>isDeepStrictEqual(a.resultIds,ids));
        if(!oldPairs.length||!newPairs.length||[...oldPairs,...newPairs].some(pair=>!lookup(pair.resultIds)))throw new ValidationError('V2 audit replay needs reviewed historical outcomes for every selected existing pair');
        baselineAudit.push(mean(oldPairs.map(p=>lookup(p.resultIds)!.reviewed!.informationValue)));candidateAudit.push(mean(newPairs.map(p=>lookup(p.resultIds)!.reviewed!.informationValue)));
        baselineAuditCost.push(oldPairs.length);candidateAuditCost.push(newPairs.length);auditIds.push(...recorded.map(a=>a.id));continue;
      }
      const tasks=epoch.tasks.filter(t=>outcomes.has(t.id));if(!tasks.length)continue;
      if(target==='policy'){
        const ways=tasks.map(t=>t.way),policy=candidate as PolicySnapshot;
        const recordedRecipes = new Set((epoch.snapshot.policy.strategies ?? []).map(s => `${s.id}@${s.version}`));
        if (epoch.snapshot.strategy.specializedRefs?.some(ref => !recordedRecipes.has(ref))) throw new ValidationError('Policy replay requires reproducible historical Strategy advice; external plugin outputs were not captured');
        if((policy.userPreferenceWeight??1)!==(epoch.snapshot.policy.userPreferenceWeight??1)&&epoch.snapshot.userDomainPreferences===undefined)throw new ValidationError('V2 user preference weight replay requires captured historical preferences');
        const base=fuseWays(ways,epoch.snapshot.strategy,epoch.snapshot.policy,Infinity,[],epoch.snapshot.waySkills)[0];
        if (policy.strategies?.length && !epoch.snapshot.routingStrategy) throw new ValidationError('Specialized Strategy replay requires captured pre-policy routing');
        const strategy=epoch.snapshot.routingStrategy ? applyPolicyStrategy(epoch.snapshot.routingStrategy,policy,epoch.snapshot.userDomainPreferences??{}) : {...epoch.snapshot.strategy,domains:routeStrategy(policy,epoch.snapshot.userDomainPreferences??{}).domains};
        const observedDecision=(way:import('../../contracts/v2.js').PossibleWay)=>epoch.decisions.find(d=>d.wayId===way.id&&d.taskId===tasks.find(t=>t.way.id===way.id)?.id);
        if(policy.decision.uncertaintyThreshold!==epoch.snapshot.policy.decision.uncertaintyThreshold&&epoch.decisions.some(d=>d.allocationSource))throw new ValidationError('Changed allocation review threshold requires unavailable counterfactual review evidence');
        if(policy.decision.uncertaintyThreshold!==epoch.snapshot.policy.decision.uncertaintyThreshold&&!tasks.some(t=>{const d=observedDecision(t.way),trace=outcomes.get(t.id);if(!d||!trace?.reviewed||d.outcome?.status!=='accepted'||d.outcome.informationValue!==trace.informationValue||d.outcome.executionStatus!==trace.executionStatus)return false;return [d.initialUncertainty,...(d.piCheckRan?[d.uncertainty]:[])].some(u=>u!==undefined&&u>Math.min(policy.decision.uncertaintyThreshold,epoch.snapshot.policy.decision.uncertaintyThreshold)&&u<=Math.max(policy.decision.uncertaintyThreshold,epoch.snapshot.policy.decision.uncertaintyThreshold));}))throw new ValidationError('V2 changed uncertainty threshold lacks reviewed boundary-crossing typed decision outcomes');
        if(policy.decision.deepRefillMinValue!==epoch.snapshot.policy.decision.deepRefillMinValue)throw new ValidationError('V2 selection replay does not certify changed Deep refill thresholds');
        if(policy.anchors.some(a=>![...epoch.snapshot.policy.anchors,...epoch.snapshot.strategy.anchors].some(b=>isDeepStrictEqual(a,b))))throw new ValidationError('V2 replay needs unchanged policy or existing reviewed anchor content');
        const eligibleWays=ways.filter(w=>w.anchorIds.every(id=>strategy.anchors.some(a=>a.id===id))&&w.domainIds.some(id=>strategy.domains.some(d=>d.id===id))&&replayEffortAllowed(w,observedDecision(w),policy.decision.uncertaintyThreshold));
        const next=fuseWays(eligibleWays,strategy,policy,Infinity,[],epoch.snapshot.waySkills)[0];
        const resolve=(wayId:string|undefined)=>outcomes.get(tasks.find(t=>t.way.id===wayId)?.id??'');
        const a=resolve(base?.way.id),b=resolve(next?.way.id);if(a){baseline.push(a);proposed.push(b??{...a,informationValue:0,reviewed:{...a.reviewed!,informationValue:0},usage:undefined,budget:{...a.budget,maxCostUsd:0}});}
      }else{
        const skill=candidate as WaySkill;
        const original=epoch.snapshot.waySkills.find(s=>s.id===skill.id);
        if (!original) continue; // A recipe can only be assessed after its explicit local trial.
        if (skillContent(original)!==skillContent(skill) || original.limitations.some(limit=>!skill.limitations.includes(limit))) throw new ValidationError('WaySkill review requires the exact exercised method, applicability and limitations');
        if (!tasks.some(task=>task.way.waySkillId===skill.id && outcomes.get(task.id)?.executionStatus==='completed' && outcomes.get(task.id)?.waySkillVersion===original.version)) continue;
        const rank=(skills:WaySkill[])=>fuseWays(tasks.map(t=>t.way),epoch.snapshot.strategy,epoch.snapshot.policy,Infinity,[],skills)[0];
        const resolve=(wayId:string|undefined)=>outcomes.get(tasks.find(t=>t.way.id===wayId)?.id??'');
        const a=resolve(rank(epoch.snapshot.waySkills)?.way.id),b=resolve(rank(epoch.snapshot.waySkills.map(s=>s.id===skill.id?skill:s))?.way.id);
        if(a&&b){baseline.push(a);proposed.push(b);}
      }
    }
    if(auditOnly){if(!baselineAudit.length)throw new ValidationError('V2 audit evolution needs explicitly reviewed historical audits');return {id:project.id,projectId:project.id,sourceRevision:project.contentRevision,heldOut:heldOutCaseIds.includes(project.id),reviewed:true,scope,traceIds:[],auditIds:[...new Set(auditIds)].sort(),baselineValue:mean(baselineAudit),candidateValue:mean(candidateAudit),baselineCost:mean(baselineAuditCost),candidateCost:mean(candidateAuditCost),limitations:['Independent sparse-audit routing replay on explicitly reviewed existing pair outcomes; scientific relations remain unchanged.','Cost compares audit pair work units, not provider currency. Explicit conflicts remain mandatory regardless of prior or allowance.']};}
    if (target==='policy') for (const strategy of (candidate as PolicySnapshot).strategies??[]) {
      if (!project.epochs.some(e=>e.snapshot.routingStrategy && applyPolicyStrategy(e.snapshot.routingStrategy!,candidate as PolicySnapshot,e.snapshot.userDomainPreferences??{}).specializedRefs?.includes(`${strategy.id}@${strategy.version}`))) throw new ValidationError('Specialized Strategy lacks applicable captured routing in a replay case');
    }
    if(!baseline.length||!proposed.length)throw new ValidationError('V2 replay needs committed candidates with explicitly reviewed outcomes and actual method trials');
    return {id:project.id,projectId:project.id,sourceRevision:project.contentRevision,heldOut:heldOutCaseIds.includes(project.id),reviewed:true,scope,traceIds:traces.map(t=>t.id).sort(),baselineValue:mean(baseline.map(traceUtility)),candidateValue:mean(proposed.map(traceUtility)),baselineCost:mean(baseline.map(traceCost)),candidateCost:mean(proposed.map(traceCost)),limitations:['Retrospective selection replay on reviewed cases; no causal or mathematical guarantee.','Costs may use frozen estimates when provider telemetry is unavailable.','Utility combines 75% branch information heuristic and 25% reviewed public synthesis usefulness; neither is scientific truth.']};
  });
}
function eligible(cases:ReplayCase[]):boolean{const m=metrics(cases);return m.candidate>=m.baseline&&m.heldOutCandidate>=m.heldOutBaseline&&(m.candidate>m.baseline+1e-9||m.heldOutCandidate>m.heldOutBaseline+1e-9);}
function firstMethodPromotion(skill:WaySkill,state:GlobalEvolutionState):boolean {
  return skill.id.startsWith('learned-') && !state.history.some(p=>p.waySkill?.id===skill.id && p.review.action==='approve');
}
/** A ranking gain cannot substitute for complete independent trials of new method content. */
function independentMethodTrials(skill:WaySkill,projects:ResearchProjectV2[],cases:ReplayCase[],samePreference=false):boolean {
  if (skill.id!==learnedSkillId(skill) || new Set(projects.map(p=>p.hypothesisRevision)).size<EVOLUTION_DEFAULTS.minimumCases) return false;
  return projects.every(project=>project.epochs.some(epoch=>{
    if (!epoch.completedAt || epoch.id!==epoch.snapshot.id || epoch.snapshot.hypothesisRevision!==project.hypothesisRevision) return false;
    // Reuse the original Gate read-only; a historical shape check alone is not trial evidence.
    const accepted=consistencyGate(epoch.snapshot,epoch.tasks,{summary:'',disagreements:[],unresolvedQuestions:[],decision:'pause',reason:'Validate saved method trials only.'}).accepted;
    return epoch.tasks.some(task=>{
    const result=accepted.find(r=>r.taskId===task.id);
    const original=epoch.snapshot.waySkills.find(s=>s.id===skill.id);
    if (cases.find(c=>c.projectId===project.id)?.heldOut) {
      const source=projects.find(p=>p.id===original?.trialSource?.projectId && !cases.find(c=>c.projectId===p.id)?.heldOut);
      if (!source || source.id===project.id || ![...source.waySkills,...source.epochs.flatMap(e=>e.snapshot.waySkills)].some(s=>s.id===skill.id && s.version===original?.trialSource?.skillVersion && !s.trialSource && skillContent(s)===skillContent(skill))) return false;
    }
    const trace=project.waySkillTraces.find(t=>t.taskId===task.id && t.epochId===epoch.id && t.wayId===task.way.id && t.waySkillId===skill.id && t.waySkillVersion===original?.version);
    return original && skillContent(original)===skillContent(skill) && (!samePreference || original.preference===skill.preference)
      && task.way.waySkillId===skill.id && task.way.waySkillVersion===original.version && task.brief.waySkillVersion===original.version
      && epoch.committedTaskIds.includes(task.id) && isDeepStrictEqual(task.way,task.brief.way)
      && result?.executionStatus==='completed' && !result.incomplete && trace?.executionStatus==='completed' && trace.method===skill.method
      && trace.reviewed && trace.reviewed.informationValue>=0.5 && trace.reviewed.attribution && !['execution_failure','missing_data'].includes(trace.reviewed.attribution) && trace.reviewed.attributionReason?.trim();
    });
  }));
}
/** First promotion validates an actually tried recipe; it does not claim improvement over Base. */
function validationEligible(skill:WaySkill,state:GlobalEvolutionState,projects:ResearchProjectV2[],cases:ReplayCase[]):boolean {
  if (!firstMethodPromotion(skill,state) || !independentMethodTrials(skill,projects,cases,true)) return false;
  const m=metrics(cases);
  return m.candidate>=m.baseline && m.heldOutCandidate>=m.heldOutBaseline && cases.every(c=>c.candidateCost<=Math.max(c.baselineCost*EVOLUTION_DEFAULTS.maximumCostRatio,0.000001));
}
function requireCases(cases:ReplayCase[]):void{if(cases.length<EVOLUTION_DEFAULTS.minimumCases||cases.length>EVOLUTION_DEFAULTS.maximumCases||new Set(cases.map(c=>c.projectId)).size!==cases.length||cases.some(c=>!c.reviewed||(!c.traceIds.length&&!c.auditIds?.length))||cases.filter(c=>!c.heldOut).length<2||!cases.some(c=>c.heldOut))throw new ValidationError('V2 multi-case replay requires two reviewed training projects and independent held-out project');}
export function parseEvolutionPublication(value:unknown):EvolutionPublication {
  if(!value||typeof value!=='object')throw new ValidationError('V2 evolution publication');
  const p=structuredClone(value) as EvolutionPublication;const r=p.review;
  if (r?.basis!==undefined && !['selection_replay','observed_validation'].includes(r.basis)) throw new ValidationError('V2 review basis');
  if(Object.keys(p).some(k=>!['id','recordedAt','review','policy','waySkill'].includes(k))||!p.id||!Number.isFinite(Date.parse(p.recordedAt))||!r||!['theorist','moderator'].includes(r.owner)||!['policy','way_skill'].includes(r.target)||!['approve','reject','rollback'].includes(r.action)||!r.id||!r.scope?.trim()||!/^(global|(?:project|domain):[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.test(r.scope)||!r.reason?.trim()||!r.previousVersion||!r.candidateVersion||!Number.isInteger(r.effectiveFromEpoch)||r.effectiveFromEpoch<1||!Array.isArray(r.cases)||!Array.isArray(r.limitations)||!r.metrics||Object.keys(r.metrics).sort().join(',')!=='baseline,candidate,heldOutBaseline,heldOutCandidate'||Object.keys(r).some(k=>!['basis','id','owner','target','action','candidateVersion','previousVersion','effectiveFromEpoch','scope','reason','cases','metrics','limitations'].includes(k)))throw new ValidationError('V2 evolution review shape');
  for(const c of r.cases)if(!c.id||!c.projectId||!c.sourceRevision||typeof c.heldOut!=='boolean'||typeof c.reviewed!=='boolean'||!Array.isArray(c.traceIds)||(c.auditIds!==undefined&&(!Array.isArray(c.auditIds)||c.auditIds.some(id=>typeof id!=='string')))||!Array.isArray(c.limitations)||!c.scope||[c.baselineValue,c.candidateValue,c.baselineCost,c.candidateCost].some(v=>!Number.isFinite(v)||v<0)||c.baselineValue>1||c.candidateValue>1)throw new ValidationError('V2 replay case shape');
  if(Object.keys(r.metrics).length!==4||Object.values(r.metrics).some(v=>!Number.isFinite(v)||v<0||v>1))throw new ValidationError('V2 replay metrics');
  if(r.target==='policy'){p.policy=validate<PolicySnapshot>(PolicySchema,p.policy,'V2 policy candidate');routeStrategy(p.policy);if(p.waySkill||r.owner!=='moderator')throw new ValidationError('V2 Moderator-only policy');}
  else{p.waySkill=validate<WaySkill>(WaySkillSchema,p.waySkill,'V2 WaySkill candidate');if(p.policy||r.owner!=='theorist')throw new ValidationError('V2 Theorist-only WaySkill');}
  return p;
}
export function parseGlobalEvolutionState(value:unknown):GlobalEvolutionState{if(!value||typeof value!=='object')throw new ValidationError('V2 evolution state');const s=structuredClone(value) as GlobalEvolutionState;if(s.schemaVersion!==2||typeof s.revision!=='string'||!Array.isArray(s.history)||!s.activeWaySkillVersions||typeof s.activeWaySkillVersions!=='object')throw new ValidationError('V2 evolution state');s.history=s.history.map(parseEvolutionPublication);if(new Set(s.history.map(p=>p.id)).size!==s.history.length)throw new ValidationError('V2 duplicate publication history');if(s.activePolicyVersion&&!s.history.some(p=>p.policy?.version===s.activePolicyVersion&&p.review.action!=='reject'))throw new ValidationError('V2 unknown active global policy');for(const [id,version] of Object.entries(s.activeWaySkillVersions))if(typeof version!=='string'||!s.history.some(p=>p.waySkill?.id===id&&p.waySkill.version===version&&p.review.action!=='reject'))throw new ValidationError('V2 unknown active global WaySkill');return s;}
export function assertEvolutionPublication(value:EvolutionPublication,previous:GlobalEvolutionState,projects:ResearchProjectV2[]=[]):void {
  const p=parseEvolutionPublication(value),r=p.review;requireCases(r.cases);
  if(previous.history.some(h=>h.id===p.id||h.review.id===r.id))throw new ValidationError('V2 duplicate evolution publication');
  const candidate=p.policy??p.waySkill!;if(candidate.version!==r.candidateVersion||candidate.effectiveFromEpoch!==r.effectiveFromEpoch)throw new ValidationError('V2 candidate version provenance');
  if(p.policy&&p.policy.owner!=='moderator'||p.waySkill&&p.waySkill.scope!=='global')throw new ValidationError('V2 global candidate owner');
  const current=r.target==='policy'?previous.activePolicyVersion:previous.activeWaySkillVersions[p.waySkill!.id];
  if(current&&current!==r.previousVersion)throw new ValidationError('V2 stale evolution baseline');
  const pins=r.cases.map(c=>projects.find(x=>x.id===c.projectId&&x.contentRevision===c.sourceRevision));if(pins.some(p=>!p))throw new ValidationError('V2 missing pinned replay sources');
  const computed=replayCases(pins as ResearchProjectV2[],r.target,candidate,r.cases.filter(c=>c.heldOut).map(c=>c.id),r.scope);
  if(JSON.stringify(computed)!==JSON.stringify(r.cases)||JSON.stringify(metrics(computed))!==JSON.stringify(r.metrics))throw new ValidationError('V2 forged replay metrics');
  if(r.action==='approve'&&previous.history.some(h=>h.review.target===r.target&&h.review.candidateVersion===r.candidateVersion&&h.review.action!=='reject'))throw new ValidationError('V2 immutable published version');
  if (r.action==='approve' && p.waySkill && firstMethodPromotion(p.waySkill,previous) && !independentMethodTrials(p.waySkill,pins as ResearchProjectV2[],computed)) throw new ValidationError('V2 new method lacks independent observed complete trials');
  if (r.basis==='observed_validation' && (r.target!=='way_skill' || !p.waySkill || !validationEligible(p.waySkill,previous,projects,computed))) throw new ValidationError('V2 new method lacks independent observed validation');
  if(r.action==='approve'&&r.basis!=='observed_validation'&&!eligible(computed))throw new ValidationError('V2 candidate regression');
  if(r.action==='approve'&&p.policy){
    const baseline=projects[0]?.epochs.at(-1)?.snapshot.policy;if(!baseline)throw new ValidationError('V2 missing baseline policy');
    const changes:PolicySnapshot[]=[];if((p.policy.userPreferenceWeight??1)!==(baseline.userPreferenceWeight??1)){const isolated=structuredClone(baseline);isolated.userPreferenceWeight=p.policy.userPreferenceWeight;changes.push(isolated);}
    for(const key of ['domainTemperature','explorationBudget','uncertaintyThreshold'] as const)if(p.policy.decision[key]!==baseline.decision[key]){const isolated=structuredClone(baseline);isolated.decision[key]=p.policy.decision[key];changes.push(isolated);}
    for(const key of ['complexityWeight','comparableEvidenceTolerance'] as const)if(p.policy.occam[key]!==baseline.occam[key]){const isolated=structuredClone(baseline);isolated.occam[key]=p.policy.occam[key];changes.push(isolated);}
    for(const isolated of changes){const isolatedCases=replayCases(pins as ResearchProjectV2[],'policy',isolated,r.cases.filter(c=>c.heldOut).map(c=>c.id),r.scope);if(!eligible(isolatedCases))throw new ValidationError('V2 changed decision/Occam parameter needs independent observed replay improvement; no piggyback');}
  }
  if(r.action==='rollback'){const prior=previous.history.find(h=>h.review.target===r.target&&h.review.candidateVersion===r.candidateVersion&&h.review.action==='approve');const original=prior?.policy??prior?.waySkill??(r.target==='policy'&&r.candidateVersion===basePolicy().version?{...basePolicy(),owner:'moderator' as const}:r.target==='way_skill'?createWaySkills().filter(s=>s.id===p.waySkill!.id&&s.version===r.candidateVersion).map(s=>({...s,scope:'global' as const}))[0]:undefined);if(!original||!isDeepStrictEqual({...original,effectiveFromEpoch:candidate.effectiveFromEpoch},candidate))throw new ValidationError('V2 rollback requires exact prior approved content');}
}
/** Exact portable content from training evidence only; project-specific citations stay local. */
export function sharedPolicyAnchors(projects: readonly ResearchProjectV2[]): PolicySnapshot['anchors'] {
  const pools = projects.flatMap(project => {
    const reviewed = new Set(project.strategyTraces.filter(trace => trace.reviewed).map(trace => trace.taskId));
    return project.epochs.filter(epoch => epoch.completedAt && (epoch.tasks.some(task => reviewed.has(task.id)) || epoch.audits.some(audit => audit.reviewed && !audit.provisional))).map(epoch => [...epoch.snapshot.policy.anchors, ...epoch.snapshot.strategy.anchors]);
  });
  const first = pools[0] ?? [];
  return structuredClone(first.filter((anchor, index) => first.findIndex(other => isDeepStrictEqual(anchor, other)) === index && pools.every(pool => pool.some(other => isDeepStrictEqual(anchor, other)))));
}

export async function runEvolutionReview(project:ResearchProjectV2,runtime:AgentRuntimeV2,projects:ResearchProjectV2[],state:GlobalEvolutionState,input:EvolutionInput):Promise<EvolutionPublication>{
  if(!/^(global|(?:project|domain):[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.test(input.scope))throw new ValidationError('V2 explicit global/project/domain evolution scope');
  if(project.phase!=='idle'||project.status==='running')throw new ValidationError('V2 evolution requires idle boundary');
  if(input.target==='policy'&&!project.config.moderatorEnabled)throw new ValidationError('V2 Moderator is disabled');
  if(input.heldOutCaseIds.some(id=>!input.caseIds.includes(id))||new Set(input.caseIds).size!==input.caseIds.length)throw new ValidationError('V2 distinct replay cases and held-out membership');
  const selected=input.caseIds.map(id=>projects.find(p=>p.id===id));if(selected.some(p=>!p))throw new ValidationError('V2 unknown replay case');
  const lacksReview=(p:ResearchProjectV2)=>{
    const branchReviewed=(input.target==='policy'?p.strategyTraces:p.waySkillTraces).some(t=>t.reviewed&&p.epochs.some(e=>e.completedAt&&e.tasks.some(task=>task.id===t.taskId)));
    const auditReviewed=input.target==='policy'&&p.epochs.some(e=>e.completedAt&&e.audits.some(a=>a.reviewed&&!a.provisional));return !branchReviewed&&!auditReviewed;
  };
  if(selected.length<EVOLUTION_DEFAULTS.minimumCases||selected.length>EVOLUTION_DEFAULTS.maximumCases||input.caseIds.filter(id=>!input.heldOutCaseIds.includes(id)).length<2||!input.heldOutCaseIds.length||(selected as ResearchProjectV2[]).some(lacksReview))throw new ValidationError('V2 insufficient reviewed cross-case evidence before role invocation');
  const snapshot=project.epochs.at(-1)?.snapshot;if(!snapshot)throw new ValidationError('V2 review needs completed Epoch context');
  const training=(selected as ResearchProjectV2[]).filter(p=>!input.heldOutCaseIds.includes(p.id));
  const trainingProject=training[0];if(!trainingProject)throw new ValidationError('V2 review requires training context');
  const trainingSnapshot=trainingProject.epochs.at(-1)?.snapshot;if(!trainingSnapshot)throw new ValidationError('V2 reviewed training Epoch missing');
  const role=input.target==='policy'?'moderator':'theorist';
  const historical=input.action==='rollback'?state.history.find(h=>h.review.target===input.target&&h.review.candidateVersion===input.rollbackVersion&&h.review.action==='approve'):undefined;
  const baseRollback=input.action==='rollback'&&input.target==='policy'&&input.rollbackVersion===basePolicy().version?{...basePolicy(),owner:'moderator' as const}:input.action==='rollback'&&input.target==='way_skill'?createWaySkills().filter(s=>s.version===input.rollbackVersion&&((input.candidate as {id?:string}|undefined)?.id===s.id||(Object.keys(state.activeWaySkillVersions).length===1&&Object.keys(state.activeWaySkillVersions)[0]===s.id))).map(s=>({...s,scope:'global' as const}))[0]:undefined;
  if(input.action==='rollback'&&!historical&&!baseRollback)throw new ValidationError('V2 unknown or ambiguous approved rollback version');
  const commonAnchors=input.target==='policy'&&input.action==='review'&&input.candidate===undefined?sharedPolicyAnchors(training):undefined;
  if(commonAnchors&&!commonAnchors.length)throw new ValidationError('V2 policy proposal needs shared training anchor content');
  const model=project.config.roleModels?.[role]??project.config.defaultModel;
  const session=await runtime.createSession({loop:{researchLoopVersion:'2.0',workerProtocolVersion:'2.0'},contractVersion:'2',id:`review-${randomUUID()}`,projectId:project.id,role,budget:project.config.roleBudget,model,context:{project:structuredClone(trainingProject),snapshot:{...structuredClone(trainingSnapshot),modelConfig:{defaultModel:model}}}});
  try {
    let supplied=input.action==='rollback'?(historical?.policy??historical?.waySkill??baseRollback):input.candidate;
    if(supplied===undefined){
      supplied=await runtime.invoke(session,{task:input.target==='policy'?'v2_moderate':'v2_review_way_skill',budget:{...project.config.roleBudget,maxTurns:Math.max(1,Math.floor(project.config.roleBudget.maxTurns/2)),timeoutMs:Math.max(1,Math.floor(project.config.roleBudget.timeoutMs/2)),...(project.config.roleBudget.maxTokens?{maxTokens:Math.max(1,Math.floor(project.config.roleBudget.maxTokens/2))}:{}),...(project.config.roleBudget.maxCostUsd?{maxCostUsd:project.config.roleBudget.maxCostUsd/2}:{})},input:{operation:'propose_candidate',scope:input.scope,...(commonAnchors?{sharedPolicyAnchors:commonAnchors}:{}),baseline:input.target==='policy'?trainingSnapshot.policy:trainingSnapshot.waySkills,reviewedCases:training.map(p=>({id:p.id,summary:p.summary,reviewedAudits:p.epochs.flatMap(e=>e.audits.filter(a=>a.reviewed&&!a.provisional).map(a=>({id:a.id,sharedBasis:a.sharedBasis,relation:a.relation,assessment:a.reviewed}))),reviewed:(input.target==='policy'?p.strategyTraces:p.waySkillTraces).filter(t=>t.reviewed).map(t=>({taskId:t.taskId,mode:t.mode,operationalLesson:operationalLessons(p).find(lesson=>lesson.taskId===t.taskId),domainIds:t.domainIds,waySkillId:t.waySkillId,waySkillVersion:t.waySkillVersion,informationValue:t.informationValue,executionStatus:t.executionStatus,assessment:t.reviewed})),routes:p.epochs.filter(e=>e.completedAt).map(e=>({domains:e.snapshot.strategy.domains,anchors:e.snapshot.strategy.anchors.map(a=>({id:a.id,tags:a.tags,domainIds:a.domainIds})),skills:e.snapshot.waySkills}))})),constraints:'Return one versioned candidate. Learn from successful and unsuccessful patterns using explicit reviewed attribution reasons, not low utility alone. A reviewed domain_anchor issue may justify macro-domain/anchor/mode changes. A way_formation error belongs to Fast method correction and does not establish a bad domain prior. execution_failure is an operational limitation, never evidence that a domain or theory is invalid. Preserve each failure and its scope. WaySkill candidates must preserve the exact method, description, applicability and limitations actually exercised in the reviewed cases. You may change selection preference, never invent untested guidance for global promotion. For policy review, you may create concise named specialized strategies in strategies: domainIds, anchorTags, modes, rationale and limitations only; no proof paths or code. The anchors array may contain only exact objects from sharedPolicyAnchors, whose content is common to reviewed training snapshots. Never copy project-specific source IDs or rewrite those objects. Keep other physical anchors in each project knowledge route and express specialization through strategies.anchorTags. Document how reviewed domain/anchor outcomes justify the macro change. Do not modify unrelated policy parameters without independent evidence. Audit routing changes must be proposed alone and replayed only against explicitly reviewed existing pair outcomes; conflicts are never suppressible. Policy replay supports grounded existing domain/anchor selection, mode, Occam, ranking weights and uncertainty threshold; preserve deepRefillMinValue until temporal refill replay exists; explorationBudget and domainTemperature are exercised by selection replay.',outputSchema:input.target==='policy'?PolicySchema:WaySkillSchema}});
    }
    const candidate=input.target==='policy'?validate<PolicySnapshot>(PolicySchema,supplied,'V2 candidate policy'):validate<WaySkill>(WaySkillSchema,supplied,'V2 candidate WaySkill');
    candidate.effectiveFromEpoch=project.epoch+1;
    if(input.target==='policy')(candidate as PolicySnapshot).owner='moderator';else(candidate as WaySkill).scope='global';
    const cases=replayCases(selected as ResearchProjectV2[],input.target,candidate,input.heldOutCaseIds,input.scope);requireCases(cases);
    const basis=input.target==='way_skill' && input.action==='review' && validationEligible(candidate as WaySkill,state,selected as ResearchProjectV2[],cases)?'observed_validation' as const:'selection_replay' as const;
    const response=await runtime.invoke(session,{task:input.target==='policy'?'v2_moderate':'v2_review_way_skill',input:{operation:'review_replay',basis,interpretation:basis==='observed_validation'?'First promotion of an exact locally tried method, supported by independently assessed training and held-out cases. Baseline may be the same local recipe; equal metrics are not evidence of superiority to Base. Approve only if applicability and reusable guidance are justified.':'Selection replay requires observed improvement without regression; it does not certify new method text.',candidate,cases,metrics:metrics(cases),requestedAction:input.action,scope:input.scope,outputSchema:{type:'object',additionalProperties:false,required:['action','reason','limitations'],properties:{action:{enum:['approve','reject','rollback']},reason:{type:'string'},limitations:{type:'array',items:{type:'string'}}}}}});
    const answer=response as {action:string;reason:string;limitations:string[]};if(!answer||Object.keys(answer).sort().join(',')!=='action,limitations,reason'||!['approve','reject','rollback'].includes(answer.action)||!answer.reason?.trim()||!Array.isArray(answer.limitations)||answer.limitations.some(x=>typeof x!=='string'))throw new ValidationError('V2 role review response');
    if(input.action==='rollback'&&answer.action!=='rollback'&&answer.action!=='reject'||input.action==='review'&&answer.action==='rollback')throw new ValidationError('V2 requested review action');
    const previousVersion=input.target==='policy'?state.activePolicyVersion??snapshot.policy.version:state.activeWaySkillVersions[(candidate as WaySkill).id]??snapshot.waySkills.find(s=>s.id===(candidate as WaySkill).id)?.version??'base';
    const action=answer.action==='approve'&&basis!=='observed_validation'&&!eligible(cases)?'reject':answer.action as EvolutionReview['action'];
    const review:EvolutionReview={basis,id:`review-${randomUUID()}`,owner:role,target:input.target,action,candidateVersion:candidate.version,previousVersion,effectiveFromEpoch:project.epoch+1,scope:input.scope,reason:answer.reason+(action!==answer.action?' Candidate failed baseline/held-out/cost gate.':''),cases,metrics:metrics(cases),limitations:[...answer.limitations,...(basis==='observed_validation'?['Multiple independent observed uses support scoped reuse. Superiority to Base and causal scientific improvement are not established.']:[])]};
    candidate.effectiveFromEpoch=review.effectiveFromEpoch;
    if(input.target==='policy')(candidate as PolicySnapshot).owner='moderator';else(candidate as WaySkill).scope='global';
    const publication:EvolutionPublication={id:`publication-${randomUUID()}`,recordedAt:new Date().toISOString(),review,...(input.target==='policy'?{policy:candidate as PolicySnapshot}:{waySkill:candidate as WaySkill})};
    try{assertEvolutionPublication(publication,state,selected as ResearchProjectV2[]);}catch(error){if(review.action==='approve'&&error instanceof Error&&error.message.includes('independent observed')){review.action='reject';review.reason+=` ${error.message}; candidate rejected.`;assertEvolutionPublication(publication,state,selected as ResearchProjectV2[]);}else throw error;}return publication;
  }finally{await runtime.closeSession(session);}
}

export function buildResearchTraces(snapshot:import('../../contracts/v2.js').EpochSnapshot,tasks:import('../../contracts/v2.js').EpochTask[]):{waySkillTraces:WaySkillTrace[];strategyTraces:import('../../contracts/v2.js').StrategyTrace[]} {
  const waySkillTraces:WaySkillTrace[]=[],strategyTraces:import('../../contracts/v2.js').StrategyTrace[]=[];
  for(const task of tasks){const result=task.result;if(!result)continue;const skill=snapshot.waySkills.find(s=>s.id===task.way.waySkillId);if(!skill)continue;
    const attribution=result.executionStatus!=='completed'?'execution_failure':result.evidence==='need_data'?'missing_data':result.conclusion==='contradictory'?'scientific_contradiction':result.conclusion==='inconclusive'&&task.brief.anchors.every(a=>a.support==='unverified_model')?'domain_anchor':result.conclusion==='inconclusive'?'way_formation':'informative_success';
    const base:ResearchTrace={id:`trace-${task.id}`,epochId:snapshot.id,taskId:task.id,domainIds:task.way.domainIds,policyVersion:snapshot.policy.version,strategyVersion:snapshot.strategy.version,anchorVersions:task.brief.anchors.map(a=>({id:a.id,revision:a.revision})),wayId:task.way.id,waySkillId:skill.id,waySkillVersion:skill.version,mode:task.way.mode,model:snapshot.modelConfig.roleModels?.worker??snapshot.modelConfig.defaultModel,budget:task.brief.budget,usage:task.usage,conclusion:result.conclusion,evidence:result.evidence,executionStatus:result.executionStatus,informationValue:result.executionStatus!=='completed'?0:result.conclusion==='contradictory'?0.8:result.derivationChain.length?0.5:0.1,feedback:'Automatic information-value and outcome-category heuristics; not a causal diagnosis, reviewed outcome or proof.',missingEvidence:result.missingEvidence,attribution,limitations:['Automatic attribution is a descriptive heuristic, not a causal diagnosis; user review may correct attribution without changing scientific results.','Uncalibrated automatic utility; global replay requires explicit user-visible checkpoint review.']};
    waySkillTraces.push({...base,method:skill.method,constraints:result.derivationChain,...(result.errorSummary?{failureReason:result.errorSummary}:{})});strategyTraces.push({...base,id:`strategy-${task.id}`,decisionObservationIds:[],auditIds:[]});
  }return {waySkillTraces,strategyTraces};
}

/** Global scope is explicit; descriptive free text never silently matches a project. */
export function applicableGlobalEvolution(project:ResearchProjectV2,state:GlobalEvolutionState):{policy?:PolicySnapshot;waySkills:WaySkill[];policyPublicationId?:string;waySkillPublicationIds:Record<string,string>} {
  const next=project.epoch+1,domains=new Set([...(project.policies.at(-1)?.domains.map(d=>d.id)??[]),...project.epochs.filter(e=>e.completedAt&&e.snapshot.hypothesisRevision===project.hypothesisRevision).flatMap(e=>e.snapshot.strategy.domains.map(d=>d.id))]);
  const applies=(scope:string)=>scope==='global'||scope===`project:${project.id}`||(scope.startsWith('domain:')&&domains.has(scope.slice(7)));
  const publications=state.history.filter(p=>p.review.action!=='reject'&&applies(p.review.scope));
  const latestPolicy=publications.findLast(p=>p.policy?.version===state.activePolicyVersion);const policyPublication=latestPolicy?.id!==project.globalBindings?.policyPublicationId?latestPolicy:undefined;const policy=policyPublication?.policy;const waySkillPublicationIds:Record<string,string>={};
  const waySkills=Object.entries(state.activeWaySkillVersions).flatMap(([id,version])=>{const p=publications.findLast(p=>p.waySkill?.id===id&&p.waySkill.version===version);if(p?.id===project.globalBindings?.waySkillPublicationIds[id])return [];if(p?.waySkill)waySkillPublicationIds[id]=p.id;return p?.waySkill?[{...structuredClone(p.waySkill),effectiveFromEpoch:next}]:[];});
  return {policy:policy?{...structuredClone(policy),effectiveFromEpoch:next}:undefined,waySkills,policyPublicationId:policyPublication?.id,waySkillPublicationIds};
}
