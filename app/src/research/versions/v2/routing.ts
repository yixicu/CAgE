import type { PolicySnapshot, ResearchProjectV2, StrategySnapshot, StrategyRecommendation, KnowledgeAnchor, StrategyProvider } from '../../contracts/v2.js';
import { ValidationError } from '../../contracts/errors.js';
import { isDeepStrictEqual } from 'node:util';

/** Engineering defaults, uncalibrated allocation heuristics, not proof probabilities. */
export function basePolicy(): PolicySnapshot {
  return { version: 'base-1', userPreferenceWeight:1, audit: {version:'audit-1',maxPairs:8,basisWeights:{anchor:1,premise:1,limit:1}}, effectiveFromEpoch: 1, owner: 'base', domains: [{ id: 'mathematics', label: 'Mathematics', belief: 1, allocation: 1, rationale: 'General logical consistency is applicable without a specialized provider.', uncertainty: 0.5 }], anchors: [{ id: 'logical-implication', support: 'methodological', revision: 'base-1', content: 'For an implication H implies C, C alone does not establish H; a counterexample to C refutes H only under the implication premises.', domainIds: ['mathematics'], provenance: 'Classical propositional logic; methodological anchor, not empirical evidence.', assumptions: ['Classical propositional logic'], applicability: 'Statements with explicit hypotheses and implication direction.', citations: [], tags: ['logic', 'necessary-consequence'] }], modeBias: { conservative: 0.6, exploring: 0.3, challenge: 0.1 }, occam: { version: 'occam-1', comparableEvidenceTolerance: 0.1, complexityWeight: 0.1, rationale: 'Tie preference only under comparable evidence and explanatory discrimination.' }, decision: { version: 'decision-1', uncertaintyThreshold: 0.35, explorationBudget: 0.2, domainTemperature: 1, weights: { relevance: 0.3, discrimination: 0.3, novelty: 0.15, duplication: 0.2, diversity: 0.1, cost: 0.1 }, deepRefillMinValue: 0.65 }, baseRef: 'base-1', specializedRefs: [], rationale: 'Stable optional-plugin-free base policy; scores are uncalibrated heuristics.', replayCaseIds: [] };
}
export function selectPolicy(project: ResearchProjectV2): PolicySnapshot {
  const policy = project.policies.filter(p => p.effectiveFromEpoch <= project.epoch + 1).at(-1);
  if (!policy) throw new ValidationError('V2 policy version unavailable');
  return structuredClone(policy);
}
export type { StrategyProvider } from '../../contracts/v2.js';
function normalize(values: number[]): number[] { const sum = values.reduce((a,b) => a+b,0); return values.map(v => sum ? v/sum : 1/values.length); }
export function routeStrategy(policy: PolicySnapshot, userPreferences: Record<string, number> = {}, providers: readonly StrategyProvider[] = []): StrategySnapshot {
  const copy = structuredClone(policy);
  const ids = new Set(copy.domains.map(d => d.id));
  if (ids.size !== copy.domains.length || !copy.domains.length) throw new ValidationError('V2 unique nonempty domains');
  if (copy.strategies?.length && (copy.owner !== 'moderator' || new Set(copy.strategies.map(s => s.id)).size !== copy.strategies.length)) throw new ValidationError('V2 named Strategy ownership and identity');
  for (const d of copy.domains) {
    if (d.parentId && (!ids.has(d.parentId) || copy.domains.find(x => x.id === d.parentId)?.parentId)) throw new ValidationError('V2 maximum two domain levels');
    if (!d.rationale.trim() || !Number.isFinite(d.belief) || d.belief < 0 || d.belief > 1) throw new ValidationError('V2 grounded domain belief');
  }
  for (const value of Object.values(userPreferences)) if (!Number.isFinite(value) || value < 0 || value > 10) throw new ValidationError('V2 user allocation preference');
  // User preferences affect allocation only, never the published belief or policy.
  const allocations = normalize(copy.domains.map(d => Math.pow(d.belief,1/copy.decision.domainTemperature) * Math.pow(userPreferences[d.id] ?? 1,copy.userPreferenceWeight??1)));
  copy.domains.forEach((d,i) => { d.allocation = allocations[i]; });
  const recommendation: StrategyRecommendation = { domainIds: copy.domains.map(d => d.id), anchorIds: copy.anchors.map(a => a.id), modes: {...copy.modeBias}, rationale: copy.rationale, uncertainty: Math.max(...copy.domains.map(d => d.uncertainty)) };
  for (const provider of providers) {
    try {
      const output = provider.recommend(structuredClone(copy));
      const keys = Object.keys(output).sort().join(',');
      if (keys !== 'anchorIds,domainIds,modes,rationale,uncertainty' || output.domainIds.some(id => !provider.domainIds.includes(id) || !ids.has(id)) || output.anchorIds.some(id => !copy.anchors.some(a => a.id === id))) continue;
      if (!output.rationale.trim() || !Number.isFinite(output.uncertainty) || output.uncertainty < 0 || output.uncertainty > 1 || Object.keys(output.modes).sort().join(',') !== 'challenge,conservative,exploring' || Object.values(output.modes).some(v => !Number.isFinite(v) || v < 0 || v > 1)) continue;
      recommendation.rationale += `\n${provider.id}: ${output.rationale}`;
      recommendation.modes = {...output.modes};
    } catch { /* A failed optional provider never disables the Base Strategy. */ }
  }
  return { version: `${copy.version}-routing`, policyVersion: copy.version, domains: copy.domains, anchors: copy.anchors, recommendation };
}
export function anchorIsGrounded(anchor: KnowledgeAnchor): boolean { return Boolean(anchor.provenance.trim() && anchor.applicability.trim() && anchor.content.trim()); }

export interface KnowledgeRoutingOutput { presentation?: unknown; researchTags?:string[]; planningChange?: import('../../contracts/review.js').PlanningChange; domains: PolicySnapshot['domains']; anchors: KnowledgeAnchor[]; recommendation: StrategyRecommendation }
/** A task-scoped, source-grounded recommendation; it never publishes new global priors. */
export function applyKnowledgeRouting(policy:PolicySnapshot,proposal:KnowledgeRoutingOutput,sources:readonly {id:string;revision:string}[],userPreferences:Record<string,number>={}):StrategySnapshot {
  const issues:string[]=[];
  for (const anchor of policy.anchors) {
    if (!proposal.anchors.some(candidate => isDeepStrictEqual(candidate, anchor)) || !proposal.recommendation.anchorIds.includes(anchor.id)) issues.push(`Preserve frozen Base anchor ${anchor.id} exactly in the routed guidance.`);
  }
  if(proposal.domains.length>8||proposal.anchors.length>32||!proposal.domains.length||!proposal.anchors.length)issues.push('V2 sparse knowledge routing bounds');
  if(new Set(proposal.anchors.map(a=>a.id)).size!==proposal.anchors.length)issues.push('V2 duplicate anchor identity');
  if(new Set(proposal.domains.map(d=>d.id)).size!==proposal.domains.length)issues.push('V2 duplicate domain identity');
  for(const d of proposal.domains)if(d.parentId&&(!proposal.domains.some(p=>p.id===d.parentId)||proposal.domains.find(p=>p.id===d.parentId)?.parentId))issues.push(`V2 maximum two domain levels: ${d.id}`);
  const selected=new Set(proposal.recommendation.domainIds),anchorIds=new Set(proposal.recommendation.anchorIds);
  if(!selected.size||selected.size>8||!anchorIds.size||proposal.recommendation.domainIds.some(id=>!proposal.domains.some(d=>d.id===id))||proposal.recommendation.anchorIds.some(id=>!proposal.anchors.some(a=>a.id===id)))issues.push('V2 routing selected grounded members');
  for(const a of proposal.anchors){
    if(!anchorIsGrounded(a)||a.domainIds.some(id=>!proposal.domains.some(d=>d.id===id)))issues.push(`V2 anchor grounded scope: ${a.id}`);
    if(!policy.anchors.some(p=>p.id===a.id&&p.revision===a.revision)&&!((a.support==='unverified_model'&&a.assumptions.length>0&&a.citations.length===0)||(a.citations.length>0&&a.citations.every(c=>sources.some(s=>s.id===c.sourceId)))))issues.push(`V2 new anchor requires frozen source citation or explicit unverified_model assumptions: ${a.id}. User preferences remain guidance in problem.userStrategy, not evidence anchors.`);
  }
  if(issues.length)throw new ValidationError(issues.join('; '));
  for(const a of proposal.anchors)a.citations=a.citations.map(c=>({...c,verified:false}));
  const local={...structuredClone(policy),domains:proposal.domains,anchors:proposal.anchors,modeBias:proposal.recommendation.modes,rationale:proposal.recommendation.rationale};
  const preferences=Object.fromEntries(Object.entries(userPreferences).filter(([id])=>proposal.domains.some(d=>d.id===id)));
  const routed=routeStrategy(local,preferences);
  const keep=new Set(selected);for(const d of proposal.domains)if(selected.has(d.id)&&d.parentId)keep.add(d.parentId);
  routed.domains=routed.domains.filter(d=>keep.has(d.id));routed.anchors=routed.anchors.filter(a=>anchorIds.has(a.id));routed.recommendation=structuredClone(proposal.recommendation);
  return routed;
}

function freezeDeep<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))freezeDeep(child);Object.freeze(value);}return value;}
/** One interpreter for published macro advice, used by execution and historical replay. */
export function applyPolicyStrategy(routing: StrategySnapshot, policy: PolicySnapshot, preferences: Record<string, number> = {}): StrategySnapshot {
  let next = structuredClone(routing);
  next.policyVersion = policy.version;
  if (policy.owner === 'moderator') {
    const domains = next.domains.map(domain => {
      const prior = policy.domains.find(item => item.id === domain.id);
      return prior ? { ...domain, belief: prior.belief, rationale: prior.rationale, uncertainty: prior.uncertainty } : domain;
    });
    next.domains = routeStrategy({ ...policy, domains, anchors: next.anchors }, preferences).domains;
    next.recommendation.modes = { ...policy.modeBias };
  }
  for (const strategy of policy.strategies ?? []) {
    const domainIds = strategy.domainIds.filter(id => next.domains.some(domain => domain.id === id));
    const anchors = next.anchors.filter(anchor => anchor.domainIds.some(id => domainIds.includes(id)) && (!strategy.anchorTags.length || anchor.tags.some(tag => strategy.anchorTags.includes(tag))));
    if (!domainIds.length || !anchors.length) continue;
    const ref = `${strategy.id}@${strategy.version}`;
    next = applySpecializedStrategies(next, policy, [{ id: ref, domainIds, recommend: () => ({ domainIds, anchorIds: anchors.map(a => a.id), modes: strategy.modes, rationale: strategy.rationale, uncertainty: Math.max(...next.domains.filter(d => domainIds.includes(d.id)).map(d => d.uncertainty)) }) }]);
    next.recommendation.anchorIds = [...new Set([...anchors.map(a => a.id), ...next.recommendation.anchorIds])];
  }
  return next;
}

export function applySpecializedStrategies(strategy:StrategySnapshot,policy:PolicySnapshot,providers:readonly StrategyProvider[]):StrategySnapshot {
  const next=structuredClone(strategy);next.specializedRefs ??= [];
  const local={...structuredClone(policy),domains:structuredClone(strategy.domains),anchors:structuredClone(strategy.anchors),modeBias:{...strategy.recommendation.modes},rationale:strategy.recommendation.rationale};
  for(const provider of providers){
    if(!provider.domainIds.some(id=>local.domains.some(d=>d.id===id)))continue;
    try {const r=provider.recommend(freezeDeep(structuredClone(local)));
      if(Object.keys(r).sort().join(',')!=='anchorIds,domainIds,modes,rationale,uncertainty'||!Array.isArray(r.domainIds)||!r.domainIds.length||r.domainIds.length>8||!Array.isArray(r.anchorIds)||!r.anchorIds.length||r.anchorIds.length>32||r.domainIds.some(id=>!provider.domainIds.includes(id)||!local.domains.some(d=>d.id===id))||r.anchorIds.some(id=>!local.anchors.some(a=>a.id===id&&a.domainIds.some(d=>r.domainIds.includes(d))))||Object.keys(r.modes).sort().join(',')!=='challenge,conservative,exploring'||Object.values(r.modes).some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isFinite(r.uncertainty)||r.uncertainty<0||r.uncertainty>1||typeof r.rationale!=='string'||!r.rationale.trim())continue;
      next.recommendation={domainIds:[...new Set([...next.recommendation.domainIds,...r.domainIds])],anchorIds:[...new Set([...next.recommendation.anchorIds,...r.anchorIds])],modes:{...r.modes},rationale:`${next.recommendation.rationale}\n${provider.id}: ${r.rationale}`,uncertainty:Math.max(next.recommendation.uncertainty,r.uncertainty)};
      const allocation=normalize(next.domains.map(d=>d.allocation*(r.domainIds.includes(d.id)?1.25:1)));next.domains.forEach((d,i)=>{d.allocation=allocation[i];});next.specializedRefs.push(provider.id);
    }catch{/* Optional advisory failures retain all Base/source-backed anchors and published beliefs. */}
  }return next;
}
