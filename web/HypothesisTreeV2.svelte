<script lang="ts">
  import type { ResearchProjectV2 } from '../src/research/contracts/v2';
  import { executionTone, fields, readable, type TreeNodeView } from './tree-view';
  import { executionExplanation } from '../src/presentation/checkpoint-output';
  import ResearchTree from './ResearchTree.svelte';
  let { project, onopen }: { project: ResearchProjectV2; onopen: (path: string) => void } = $props();
  // Only committed scientific nodes belong here. Live tasks stay in EpochOverview.
  let nodes = $derived<TreeNodeView[]>(project.graph.map(node => {
    const result = project.results.find(item => item.branchId === node.id);
    const tags: NonNullable<TreeNodeView['tags']> = [];
    const state = result?.executionStatus || node.executionStatus;
    tags.push({label:state || (['active','running'].includes(node.status) ? 'working' : 'unassessed'),tone:executionTone(node.status,state),category:'Execution'});
    if (result) {
      tags.push({label:result.evidence === 'need_data' ? 'lack-data' : result.evidence,tone:result.evidence === 'sufficient' ? 'success' : 'review',category:'Evidence'});
      tags.push({label:node.implication === 'counterexample' ? 'counterexample' : 'derivation',tone:'idle',category:'Proof type'});
      if (result.conclusion) tags.push({label:readable(result.conclusion),tone:result.conclusion === 'contradictory' ? 'failed' : result.conclusion === 'inconclusive' ? 'review' : 'idle',category:'Scoped conclusion'});
    }

    return { tags, conditions:[...new Set([...(result?.assumptions || []), ...(result?.pathReport?.conditions || []), ...node.assumptions])], steps:result?.pathReport?.keySteps || result?.derivationChain || [], obstacles:[...(result?.pathReport?.obstacles || []), ...(result?.unresolvedQuestions || []), ...(result?.errorSummary ? [executionExplanation(result.errorSummary)] : [])], finding:result?.executionStatus === 'failed' ? executionExplanation(result.errorSummary || 'The exploration failed before returning a scientific result.') : result?.pathReport?.result || result?.applicability, id: node.id, parentId: node.parentId, title: node.question, caption: !node.parentId ? project.name : undefined, status: readable(node.status),
      tone: executionTone(node.status, node.executionStatus), path: node.resultPath,
      summary: [result?.applicability, node.implication && readable(node.implication), node.evidence && readable(node.evidence)].filter(Boolean).join(' · ') || node.question,
      details: fields({ Status: readable(node.status), Execution: node.executionStatus, 'Scientific conclusion': node.conclusion ? readable(node.conclusion) : 'No scientific conclusion',
        Evidence: node.evidence && readable(node.evidence), 'Premise revision': node.hypothesisRevision, Implication: node.implication && readable(node.implication),
        Scope: result?.applicability, Assumptions: node.assumptions.join('; '), 'Missing evidence': result?.missingEvidence.join('; '),
        'Hypothetical conditions': result?.idealizedConditions.length ? 'Conditional assumptions, not measurements or general proof.\n' + result.idealizedConditions.map(item => `${item.quantity}: ${item.assumedCondition}. ${item.admissibility}`).join('\n') : undefined,
        'Related branches': node.relatedNodeIds?.join(', '), Error: result?.errorSummary,
        Sources: result?.citations.map(item => `${item.sourceId}: ${item.locator}`).join('\n'),
        'Review note': 'Committed scientific state. Task progress is separate; a compatible consequence does not prove the root hypothesis.' }) };
  }));
</script>
{#key project.id}<ResearchTree {nodes} {onopen} title="Hypothesis tree · V2" />{/key}
