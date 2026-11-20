import type { InheritedResearchView } from './contracts/lineage.js';
import { createHash } from 'node:crypto';
import { deliveredComponents } from './component-delivery.js';
import { defaultDecision, type BoundaryQuery, type BoundaryView, type ResourceRef } from '../learning/research-data.js';
import { stableHash } from '../learning/research-hash.js';
import type { Continuation, EndedAttempt, LoadedResource, ResearchComposition, ResourceReadRef, ResearchReceipt, ScientificReview } from './contracts/review.js';

export const REVIEW_INSTRUCTIONS=`# Scientific review

## Root closure and learning eligibility
A proof proposal is allowed only after the ROOT hypothesis is completely closed under explicitly stated conditions and the public derivation is reproducible: target must equal the frozen root text, supply targetKey, methodKey, conditions, tags, summary, full proof, rootClosed:true, reproducible:true, semanticChange, logicalRelation and linkReason.

### Do not manufacture closure
A necessary consequence alone never closes the root. Keep a genuinely sufficient/equivalent/counterexample return to the root explicit. Completion because no useful work remains is not proof closure. Use supported tag dimensions subject:, specialization:, method:, problem-type:, pitfall:. Method Skill eligibility follows one closed reproducible case; failure Skill eligibility is separate and may precede closure. Never fabricate a completed proof to trigger learning.

## Incremental adoption and targeted checks
Workers deliver corrected component interfaces after their checks. By default assess the conclusion, conditions, symbol domains, approximation order and obligation coverage, not the proof body, including on first adoption. Reuse accepted conclusions without reproving them. Inspect only relevant steps when a concrete inconsistency or missing property needed for a new use requires it; requesting a stronger property does not invalidate the original result. Compare join conditions and declared symbols. New connecting inferences need justification, but unchanged components need no repeated validation. Execution completed and sufficient are not formal proof certificates. A substantive unresolved conflict remains a named gap; do not close the root to satisfy formatting. Read every newly delivered or changed explicit path report; use exact readers for necessary derivation bodies. Report complete corrected component chapters accepted as prerequisites in adoptedChapters, preserving their exact conditions and version. Their explicit scientific interface is enough for adoption; do not claim a body read that did not occur. Ordinary legacy chapters without a component interface still require targeted reading before legacy adoption. Old exploratory DERIVE/CHECK notes are not automatically adopted.

### Delivery eligibility and prohibited shortcuts
Only completed Workers' explicitly delivered versions are adoption candidates; failed/interrupted Workers' chapters are recovery drafts even when complete:true. Use a scoped continuation to finish their missing checks, never adopt them to bypass a tool failure.

### Corrections: inspect only concrete conflicts
When a correction is declared, inspect its new interface against the existing conclusions for a concrete contradiction (for example preserved signature versus a claimed positive form); a CHECK label or correction ledger alone is not a repaired proof. Retain correct independent results and restrict any necessary inspection to the conflicting equations. A Worker's optional plan is not a new obligation of the user's hypothesis.

## Conditional parallel connections
For conditional parallel tasks, a downstream component proves only its frozen assumption implies its local conclusion. To use it for root closure, select completed source evidence with the exact scoped statement, and save your own connecting component referencing exact upstream and downstream versions. Preserve all remaining conditions, check symbol domains and whether upstream conditions actually follow from the root. Include the connecting chapter and its evidence in the final proof. Never silently turn a failed or narrower upstream result into the assumed statement; retain the conditional result and request only the missing connection.

## Local issues and dependency repair
Record concrete component questions in componentIssues with exact ref, kind (clarification or conflict), affected use, question and actual evidence; empty evidence is permitted for a genuine information request, not invented findings. Existing resolved issues in componentState need no repetition without new evidence. An unresolved conflict stays a gap for the affected use; clarification alone does not withdraw a valid claim.

### Explicit updates; host-owned propagation
Use componentUpdates only for explicit scientific withdrawal, replacement or interface-preserving revalidation, with reasons; never redeclare adoption to erase invalidation. A proof must identify the component evidence it actually uses. For unrelated pending components, unusedComponents gives exact refs and scientific reasons they are not used; it cannot exclude an ancestor of a used conclusion. Do not output affectedChapters: it is derived by the host, not a model assertion.

## Attempt coverage, failures and anomalies
Review every explicit attempt, including unsuccessful scientific paths and execution failures; use the complete attemptIndex and previouslyRead versions.

### Reading receipts
Return attemptsRead containing the exact id/version of every path you actually inspected. Never claim to read an omitted path. Preserve obstacles, conditions and potential continuations. A failed API/tool call is not a scientific failure.

### Failure learning
If multiple different Workers in this session encountered a generalizable scientific failure, optionally report failures with exact attemptIds, patternKey, concise summary, dimensioned tags, generalizable:true and scientific:true. Do not use retry count as evidence.

### Scoring anomalies
Report anomalies only for an unexpected completed scientific outcome that reveals a mismatch with the allocation scores, such as a low-ranked direction producing a useful result; mark scientific:true and identify that mismatch. Tool/API failure, permissions, malformed output and wording defects are ordinary attempt/review records, never scoring anomalies. Scores still do not establish scientific truth.

## Manuscript reuse and output location
Use unchangedProof only while the exact old body is still in the current context. A prior delivered body need not be reread; after context loss read it again. A missing proposal is never a saved revision. Save long final manuscripts in own chapters; evidenceChapters lists the exact Worker component versions used, not a claim of reading their bodies. Include researchReview in this review/synthesis. The proof submission belongs only at researchReview.proof, never a top-level proof.

## Final assembly
Explicitly order own connecting/presentation chapters and accepted components in proof.chapters to assemble the final manuscript without rewriting component bodies.

## Prior final proofs and revisions
Inspect relevant current-session final proof outlines and use read_final_proof for a required body. If a previous proof is scientifically invalid, report retractProofs with its exact delivered ref and concrete reason; do not retract unrelated sessions or merely old wording. For a wording-only revision (semanticChange:false) of the same hypothesis and method, copy targetKey, methodKey, conditions and logicalRelation exactly from the delivered proof outline metadata; do not shorten conditions or rename the target key. A genuine scientific change requires semanticChange:true with an explicit explanation; a new target must first pass the planning boundary. Original history remains preserved while dependent resources await repair.`;
export const PREPARATION_BOUNDARY_INSTRUCTIONS=`## 1. Root authority and planning boundary
During PLAN or knowledge routing, pendingModifications contains only the latest user hypothesis candidate selected at this boundary and has priority. Older superseded candidates are historical records, never additional active instructions. pendingAnnotations contains all annotations selected at this boundary; consider their scientific context without treating an annotation as authorization to replace the root. Later submissions belong to a later boundary. If pendingModifications is present and nonempty, return planningChange: classify wording (same scientific target), material (same target with changed scientific conditions), or new_target (genuinely different target); supply the complete hypothesis text, stable targetKey, conditions, logicalRelation and linkReason. If selectedReconstruction is supplied, its hypothesis is the exact user-selected replacement text. Preserve every selected assumption verbatim in planningChange.conditions, inspect its proposed implication and reason, and explain your scientific classification in linkReason; do not silently rewrite the target or discard conditions.

### Working targets and prohibited root changes
With no user hypothesis modification, any useful working H-prime must use kind:working and an explicit equivalent/sufficient/counterexample return to the unchanged root. Way generation uses that already frozen target and does not return planningChange. Do not erase old proofs or silently revise the root.`;
export const PLANNING_INSTRUCTIONS=`# Planning

${PREPARATION_BOUNDARY_INSTRUCTIONS}

## 2. Task granularity and ownership
Group continuous derivations sharing intermediate calculations and one scientific goal into one task. Split for genuine parallel work, a completed external prerequisite or an explicit independent verification objective, not simply for each lemma or chapter. One Worker may deliver several reusable components. Before dispatching a follow-up, distinguish root obligations from a Worker's optional self-imposed FORMULATE checklist. A checked conclusion is not deficient merely because the Worker chose a different valid proof method. For a repair, name the exact disputed component/use, the concrete defect or missing property, the reusable conclusions, and only the remaining work in continuation.obstacle/newWork/reuse/redo. Do not replace a local wording, reference or applicability correction with a fresh full-spectrum/full-proof audit.

### Independent verification and duplicate work
Purposeful independent verification remains allowed when its specific risk and scope are stated. Give each obligation a primary owner; distinguish purposeful alternative verification from accidental duplicate calculation. Do not extend a task into unrequested new goals.

## 3. Module handoff
Each candidate includes self-contained task-relevant proofContext with scope:module, local symbols/definitions, only necessary conditions/applicability and assigned obligations. Select needed root premises explicitly; omission is not permission to strengthen the claim. Instantiate needed user strategy in the assignment; do not copy the whole problem. Workers do not receive the root hypothesis and report only their module.

### Missing inputs and exact continuation references
A missing input is a scoped clarification, not a request to replan the whole problem; the program freezes conventionVersion. Continuations select exact ended parent chapters, with explicit reuse and redo judgments.

## 4. Continuations: new work only
Each continuation must name parentAttemptId, the unresolved obstacle, and actual newWork; repeated summaries or renamed duplicate paths are not new work.

## 5. Skills: concrete methods, not authority
Skills are reusable guidance with conditions, not logical truth. Only claim skillRefs that are available and whose loaded body you used; reference exact id/version. Instantiate the needed method, checks and applicability conditions in each Worker's assignment, question and assumptions. Workers receive those concrete instructions, not Skill-library access; an ID alone is not a method handoff.

## 6. Allocation: program scores, Theorist judgment
You own concrete directions, allocation, effort and division of labor. The program computes scores with the frozen decision factors; return exact factor IDs, each 0..4 with a scientific rationale, and never treat the weighted sum as truth or automatic closure.`;
export const WORKER_RESOURCE_INSTRUCTIONS=`Skill references are provenance identifiers, never file paths or permission to read the library or its source records. Execute the concrete method and checks in your own frozen question, assignment and assumptions. Read files only at explicitly authorized source paths, never by passing a Skill ID to a file tool. If the brief lacks a necessary method detail, state the unresolved requirement or derive it within the authorized task; do not invent a source or expand access.`;
export const TAG_INSTRUCTIONS=`Return researchTags describing the scientific subject and useful specialization/method/problem-type/pitfall, using these exact dimension prefixes. Maintain tags by meaning, not literal overlap with the hypothesis words. When relevant guidance is not in the initial catalog, use search_research_resources(tags) then read_research_resource(id,version) for applicable entries. Search metadata is not a read or a theorem. Existing same-session finals and search_final_proofs provide proof outlines; read a relevant exact body when needed. Never request another session's raw attempts or failures.`;

/** A recalled catalog is metadata. Only these successful reads are claimed as loaded guidance. */
export async function loadResources<P>(composition:ResearchComposition<P>,boundary:BoundaryView,query:BoundaryQuery):Promise<LoadedResource[]> {
  if(!composition.readResource)return [];
  const selected=[...boundary.skills.slice(0,3),...(query.loopVersion===2?boundary.strategies.slice(0,3):[])],loaded:LoadedResource[]=[];
  for(const meta of selected){
    if(!meta.enabled||meta.status!=='valid')continue;
    try{const resource=await composition.readResource({id:meta.id,version:meta.version},query);if(resource.meta.id===meta.id&&resource.meta.version===meta.version&&resource.meta.enabled&&resource.meta.status==='valid')loaded.push(resource);}catch{/* A stale resource is not loaded or silently substituted. */}
  }
  return loaded;
}
/** Read-only prompt view; inherited bodies stay behind exact scoped readers. */
export function inheritedContextInput(view: InheritedResearchView | undefined): Record<string, unknown> {
  if (!view) return {};
  return { inheritedContext: structuredClone({ manifestId: view.manifestId, ...view.context,
    attemptIndex: view.attempts.map(attemptIndexEntry), chapters: view.chapters, proofs: view.proofs,
    instruction: 'This is inherited read-only public research context, not work executed by this child. Read exact path bodies with read_session_attempt using inherited id and version; use exact chapter/proof readers when needed. Use inherited attempt handles only for continuation.parentAttemptId. New candidates attach to a current child graph root, not inherited graph IDs. Do not include inherited handles in researchReview.attemptsRead, failures or anomalies; those fields describe this child own scientific attempts. Inherited reads are recorded by the host. Parent proof ownership is unchanged; never claim it as this child unchangedProof.' }) };
}
/** Readable drafts remain indexed, but are never advertised as publication candidates. */
function attemptIndexEntry(attempt: EndedAttempt) {
  const { path: _path, ...index } = attempt;
  const candidates = attempt.executionStatus === 'completed' ? deliveredComponents(attempt) : [];
  return { ...index, chapterAccess: attempt.executionStatus === 'completed' ? 'Only selected completed delivery is eligible for scientific adoption; other chapters are audit drafts.' : 'Recovery drafts only: finish the missing Worker checks before adoption.',
    adoptableChapters: candidates.map(({ sessionId, attemptId, chapterId, hypothesisRevision, conventionVersion, contentHash }) => ({ sessionId, attemptId, chapterId, hypothesisRevision, conventionVersion, contentHash })) };
}
export function attemptInput(attempts:readonly EndedAttempt[],previouslyRead:Readonly<Record<string,string>>):{attempts:EndedAttempt[];attemptIndex:Omit<EndedAttempt,'path'>[];previouslyRead:Record<string,string>} {
  return {attempts:attempts.filter(attempt=>previouslyRead[attempt.id]!==attempt.version).map(attempt=>({...structuredClone(attempt),path:attemptOutline(attempt.path)})),attemptIndex:attempts.map(attemptIndexEntry),previouslyRead:{...previouslyRead}};
}
/** Request view only: never alter saved attempts or their version hashes. */
export function attemptOutline(path:string):string {
  try {
    const body=JSON.parse(path);
    // Old records without an explicit report retain their full scientific path.
    if(!body.pathReport)return path;
    const keys=['pathReport','executionStatus','conclusion','evidence','assumptions','applicability','missingEvidence','idealizedConditions','theoryOnlyAlternatives','conflictingPropositions','checkedLimits','unresolvedQuestions','proposedFollowups','verificationQuality','strongestObjection','incomplete','errorSummary','evidenceWarnings','chapters','componentDelivery'];
    const outline=Object.fromEntries(keys.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
    const components=Array.isArray(body.chapters)?deliveredComponents(body):[];
    if(body.executionStatus==='completed'&&body.componentDelivery)outline.chapters=components;
    else if(body.executionStatus==='completed'&&components.length)outline.chapters=components;
    if(body.executionStatus!=='completed')outline.adoption='Recovery draft only, not eligible for adoption even if a chapter is fully written.';
    return JSON.stringify({...outline,bodyAccess:'Use the corrected component interfaces by default. Original exploratory chapters remain in the authorized attemptIndex for concrete questions; read only relevant steps when needed. This is not a claim that their bodies were read.'});
  } catch{return path;}
}
/** Prompt projection only: exact saved paths stay in the session spec and narrow read tool. */
export function promptProject(project:object,attempts:readonly EndedAttempt[]):Record<string,unknown> {
  const value=structuredClone(project) as Record<string,unknown>;
  delete value.results;delete value.summary;delete value.experiences;delete value.waySkillTraces;delete value.strategyTraces;delete value.activeEpoch;
  // The immutable submission history is UI/audit data. Only the engine's explicit
  // boundary selection may provide active instructions to a model invocation.
  delete value.refinements;delete value.commandStates;delete value.pendingModificationIds;delete value.plannedRefinementCount;delete value.userInputWarnings;delete value.reconstructionProposals;
  if(Array.isArray(value.rounds))value.rounds=value.rounds.map(round=>({number:round.number,branchIds:round.branchIds,decision:round.decision,reason:round.reason}));
  if(Array.isArray(value.epochs))value.epochs=value.epochs.map(epoch=>({id:epoch.id,number:epoch.number,decision:epoch.decision,reason:epoch.reason,committedTaskIds:epoch.committedTaskIds}));
  return {...value,attemptIndex:attempts.map(attemptIndexEntry)};
}
export function promptContext(context:unknown,attempts:readonly EndedAttempt[]):unknown {
  if(!context||typeof context!=='object'||!('project' in context)||!context.project||typeof context.project!=='object')return context;
  return {...context,project:promptProject(context.project,attempts)};
}
export function endedAttempt(input: Omit<EndedAttempt,'version'>): EndedAttempt {
  const attempt = {...structuredClone(input),version:stableHash(input)};
  // The explicit result is already engine-validated; preserve its delivery manifest in the index.
  try { const body = JSON.parse(input.path); if (body.componentDelivery) attempt.componentDelivery = structuredClone(body.componentDelivery); } catch { /* Legacy plain paths have no manifest. */ }
  return attempt;
}
export function explicitResult(result:{derivationRef?:string}):string {
  const value=structuredClone(result);delete value.derivationRef;
  const canonical=(input:unknown):unknown=>Array.isArray(input)?input.map(canonical):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):input;
  return JSON.stringify(canonical(value));
}
export function emptyBoundary(loopVersion:1|2):BoundaryView { return {decision:defaultDecision(loopVersion),skills:[],strategies:[]}; }
export function evaluateDecision(boundary:BoundaryView,scores:Record<string,number>,rationales?:Record<string,string>):number {
  const factors=boundary.decision.factors,ids=factors.map(factor=>factor.id);
  if(new Set(ids).size!==ids.length||Math.abs(factors.reduce((sum,f)=>sum+f.weight,0)-1)>1e-8||ids.some(id=>!Number.isFinite(scores[id])||scores[id]<0||scores[id]>4||rationales&&!rationales[id]?.trim())||Object.keys(scores).some(id=>!ids.includes(id)))throw new Error('Scores must cover exactly the frozen decision factors with 0–4 judgments and rationales.');
  return factors.reduce((sum,factor)=>sum+factor.weight*scores[factor.id],0);
}
/** The runtime's successful read manifest, not model claims or search metadata, grants use. */
export function declaredSkillsAreLoaded(refs:readonly ResourceRef[],boundary:BoundaryView,reads:readonly ResourceReadRef[]):boolean {
  return refs.every(ref=>reads.some(read=>read.id===ref.id&&read.version===ref.version&&(read.kind==='method-skill'||read.kind==='failure-skill'||read.kind===undefined&&boundary.skills.some(skill=>skill.id===ref.id&&skill.version===ref.version&&skill.enabled&&skill.status==='valid'))));
}
export function continuationAllowed(value:Continuation|undefined,attempts:readonly Pick<EndedAttempt,'id'|'chapters'>[]):boolean { return !value||Boolean(value.obstacle.trim()&&value.newWork.trim()&&attempts.some(attempt=>attempt.id===value.parentAttemptId&&(value.chapters??[]).every(ref=>(attempt.chapters??[]).some(saved=>stableHash(saved)===stableHash(ref))))&&(!(value.chapters?.length)||value.reuse?.trim()&&value.redo?.trim())); }
/** Coverage gates proof/learning eligibility; it never rewrites or discards scientific results. */
export function makeReceipt(input:Omit<ResearchReceipt,'designRevision'|'coverageComplete'|'attempts'|'review'>,attempts:readonly EndedAttempt[],review:ScientificReview|undefined,previouslyRead:Readonly<Record<string,string>>={},sessionId?:string):ResearchReceipt {
  const coverageComplete=Boolean(review&&attempts.every(attempt=>previouslyRead[attempt.id]===attempt.version||review.attemptsRead.some(ref=>ref.id===attempt.id&&ref.version===attempt.version))&&review.attemptsRead.every(ref=>attempts.some(attempt=>attempt.id===ref.id&&attempt.version===ref.version)));
  const approved=coverageComplete&&review?structuredClone(review):undefined;
  if(approved?.proof&&(!approved.proof.proof?.trim()||!approved.proof.rootClosed||!approved.proof.reproducible||approved.proof.logicalRelation==='necessary_only'||!approved.proof.linkReason.trim()||approved.proof.target!==input.hypothesis))delete approved.proof;
  if(approved?.failures)approved.failures=approved.failures.filter(failure=>failure.generalizable&&failure.scientific&&new Set(failure.attemptIds.flatMap(id=>attempts.filter(attempt=>attempt.id===id).map(attempt=>attempt.workerId))).size>=2&&failure.attemptIds.every(id=>attempts.some(attempt=>attempt.id===id&&attempt.hypothesisRevision===input.hypothesisRevision&&attempt.executionStatus==='completed')));
  if(approved?.anomalies)approved.anomalies=approved.anomalies.filter(anomaly=>anomaly.scientific===true&&attempts.some(attempt=>attempt.id===anomaly.attemptId&&attempt.executionStatus==='completed'));
  if(approved?.retractProofs)approved.retractProofs=approved.retractProofs.filter(item=>Boolean(sessionId&&item.ref.sessionId===sessionId&&item.reason.trim()&&input.boundary.proofs?.some(proof=>stableHash(proof.ref)===stableHash(item.ref))));
  return {...structuredClone(input),designRevision:'2026-10-15',attempts:attempts.map(({id,version})=>({id,version})),coverageComplete,...(approved?{review:approved}:{})};
}
export function hypothesisRevision(text:string):string { return createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'); }
