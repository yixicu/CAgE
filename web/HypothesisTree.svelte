<script lang="ts">
  import type { ResearchProject } from '../src/engine/types';
  import { researchNodeLabel } from './research-view';
  import { executionTone, fields, readable, type TreeNodeView } from './tree-view';
  import ResearchTree from './ResearchTree.svelte';
  let { project, onopen }: { project: ResearchProject; onopen: (path: string) => void } = $props();
  let nodes = $derived<TreeNodeView[]>(project.graph.map(node => {
    const result = project.results.find(item => item.branchId === node.id);
    const tags: NonNullable<TreeNodeView['tags']> = [];
    const state = result?.executionStatus || node.executionStatus;
    tags.push({label:state || (['active','running'].includes(node.status) ? 'working' : 'unassessed'),tone:executionTone(node.status,state),category:'Execution'});
    if (result) {
      tags.push({label:'unassessed',tone:'idle',category:'Evidence'});
      tags.push({label:result.pathReport?.method || 'unclassified',tone:'idle',category:'Proof type'});
      if (result.conclusion) tags.push({label:readable(result.conclusion),tone:result.conclusion === 'contradictory' ? 'failed' : result.conclusion === 'inconclusive' ? 'review' : 'idle',category:'Scoped conclusion'});
    }

    const execution = result?.executionStatus ?? node.executionStatus;
    return { tags, conditions:[...new Set([...(result?.assumptions || []), ...(result?.pathReport?.conditions || [])])], steps:result?.pathReport?.keySteps || result?.derivationChain || [], obstacles:[...(result?.pathReport?.obstacles || []), ...(result?.unresolvedQuestions || []), ...(result?.errorSummary ? [result.errorSummary] : [])], finding:result?.pathReport?.result || result?.applicability, id: node.id, parentId: node.parentId, title: node.question, caption: !node.parentId ? project.name : undefined, status: researchNodeLabel(node),
      tone: executionTone(node.status, execution), path: node.resultPath,
      summary: [node.targetTheory, result?.applicability, node.mode && readable(node.mode)].filter(Boolean).join(' · ') || node.question,
      details: fields({ Status: researchNodeLabel(node), Execution: execution, 'Scientific conclusion': result?.conclusion ? readable(result.conclusion) : 'No scientific conclusion',
        Theory: node.targetTheory, Mode: node.mode, Effort: node.effort, Priority: node.priority?.toFixed(2), 'Premise revision': node.hypothesisRevision,
        Scope: result?.applicability, Assumptions: result?.assumptions.join('; '), 'Strongest objection': result?.strongestObjection,
        'Verification quality': result?.verificationQuality, Error: result?.errorSummary,
        Sources: result?.citations.map(item => `${item.sourceId}: ${item.locator} (${item.verified ? 'verified reference' : 'not verified'})`).join('\n'),
        'Open questions': result?.unresolvedQuestions.join('\n'), 'Proposed follow-ups': result?.proposedFollowups.join('\n'),
        'Related branches': node.relatedNodeIds?.join(', '), 'Review note': 'AI-generated derivations require review of their assumptions and scope.' }) };
  }));
</script>
{#key project.id}<ResearchTree {nodes} {onopen} />{/key}
