<script lang="ts">
  import CagesEmpty from './CagesEmpty.svelte';
  import {FIELD_CATALOG,classifyField} from './capabilities/taxonomy';
  let field=$state('');
  import {movable} from './capabilities/movable';
  import { onMount, tick } from 'svelte';
  import LearningStatus from './LearningStatus.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import Icon from './Icon.svelte';
  import ResourceNetwork from './capabilities/ResourceNetwork.svelte';
  import { reconcileSelection } from './capabilities/selection';
  import { networkRequests } from './capabilities/network-requests';
  import { requestGate } from './capabilities/requests';
  import { containDialogFocus } from './capabilities/dialog-focus';
  import { resourceReadingBody } from './capabilities/resource-body';
  import { routeKey } from './capabilities/layout';
  import { api, ApiError, type CapabilityItem, type CapabilityNetwork, type ConnectionReview } from './api';
  let { kind, projectId, onchange,projects=[] }: { projects?:{id:string;name:string}[]; kind?: 'fast' | 'slow' | 'knowledge'; projectId?: string; onchange: () => Promise<void> } = $props();
  let network = $state<CapabilityNetwork>();
  let loading = $state(true), refreshing = $state(false), saving = $state(false), error = $state(''), message = $state('');
  let query = $state(''), filter = $state<'all' | 'skill' | 'strategy'>('all');
  let findRequest = $state(0), selectionRequest = $state(0);
  let composing = false;
  // Measure the unsplit host (clientWidth includes its reservation padding), not the window.
  let canvasHostWidth = $state(0);
  const sideDialog = $derived(canvasHostWidth >= 804); // <=460 panel + 24 gap + >=320 graph, before gutters.
  let detailStale = $state(false);
  let selected = $state<CapabilityItem>(), body = $state(''), detailLoading = $state(false), detailError = $state('');
  let detailHeading = $state<HTMLHeadingElement>();
  let editing = $state(false), draft = $state(''), editError = $state(''), editConflict = $state(false), detailMessage = $state('');
  let editor = $state<HTMLTextAreaElement>();
  let editBase: { id: string; version: number; expectedRevision: string } | undefined;
  let page: HTMLElement;
  let detailRevision = '';
  let detailSuccess = $state(false);
  type ReviewRequest = Parameters<typeof api.reassessCapabilityConnections>[0];
  type ReviewState = { review?: ConnectionReview | null; loading?: boolean; submitting?: boolean; acknowledging?: boolean; error?: string; requestError?: string; priorReviewId?: string; pendingRequest?: ReviewRequest };
  let connectionReviews = $state<Record<string, ReviewState>>({});
  const reviewTimers = new Map<string, ReturnType<typeof setTimeout>>(), reviewGenerations = new Map<string, number>(), appliedReviews = new Set<string>();
  const selectedReview = $derived(selected ? connectionReviews[routeKey(selected)] : undefined);
  const reviewPending = (review?: ConnectionReview | null) => review?.status === 'queued' || review?.status === 'running';
  const reviewBusy = $derived(!!selectedReview?.loading || !!selectedReview?.submitting || !!selectedReview?.acknowledging || reviewPending(selectedReview?.review));
  const reviewCoverage = $derived(selectedReview?.review?.coverage);
  const coverageNotice = $derived(reviewCoverage && reviewCoverage.omittedCount > 0 ? ` · reviewed ${reviewCoverage.includedCount} of ${reviewCoverage.candidateCount} candidates` : '');
  const reviewNotice = $derived(selectedReview?.submitting ? 'Starting Moderator…' : selectedReview?.error || selectedReview?.requestError || (selectedReview?.review ? reviewPending(selectedReview.review) ? 'Moderator is reassessing connections…' : selectedReview.review.status === 'completed' ? `Connections updated${coverageNotice}` : selectedReview.review.status === 'no-change' ? `No connection changes${coverageNotice}` : selectedReview.review.message || 'Reassessment paused or failed. Try again.' : ''));
  const reviewFailed = $derived(!!selectedReview?.error || !!selectedReview?.requestError || selectedReview?.review?.status === 'failed' || selectedReview?.review?.status === 'paused');
  let activeRead: Promise<void> | undefined, refreshQueued = false, disposed = false;
  const requests = networkRequests<CapabilityNetwork>();
  const loads = requestGate(), details = requestGate(), saves = requestGate();
  const items = $derived(network?.capabilities.items.filter(item => (!item.scope.startsWith('project:') || item.scope === `project:${projectId}`)) ?? []);
  const visible = $derived(items.filter(item => (filter === 'all' || item.kind === filter)&&(!field||field===classifyField(item.subjectTags))));
  const selectedRoutes = $derived(new Set(network?.routes.filter(route => selected && route.resourceRef.id === selected.id && String(route.resourceRef.version) === selected.version).map(routeKey) ?? []));
  const relations = $derived(network?.links.filter(link => selectedRoutes.has(routeKey(link.from)) || selectedRoutes.has(routeKey(link.to))) ?? []);
  function linkedItem(ref: {id: string; version: number}) {
    const route = network?.routes.find(route => routeKey(route) === routeKey(ref));
    return items.find(item => item.id === route?.resourceRef.id && item.version === String(route.resourceRef.version));
  }
  async function acceptNetwork(value: CapabilityNetwork, preserveSelection: boolean, waitForDetail = false) {
    network = value;
    // Consult selection at commit time: a new click or Close while the read was pending wins.
    if (preserveSelection && selected) {
      const next = reconcileSelection(selected, value.capabilities.items);
      selected = next.item; detailStale = next.stale;
      if (editing) {
        if (next.stale || value.revision !== editBase?.expectedRevision) { editConflict = true; editError = 'The library changed. Your draft is kept. Cancel and close, then refresh the tree.'; }
        return;
      }
      if (next.stale) { details.cancel(); detailSuccess = false; detailRevision = ''; body = ''; detailLoading = false; detailError = 'This exact resource is no longer available. Close this popup to choose a current resource.'; }
      else { const read = open(next.item, false); if (waitForDetail) await read; }
    }
  }
  async function readNetwork(background = false) {
    const current = loads.begin();
    if (!background) { details.cancel(); detailSuccess = false; detailRevision = ''; selected = undefined; body = ''; loading = true; message = ''; }
    error = '';
    try { await requests.run(() => api.capabilityNetwork(projectId), value => acceptNetwork(value, background)); }
    catch (cause) { if (current()) {
      if (!background) network = undefined;
      error = cause instanceof Error ? cause.message : 'Could not load resources.';
      if (background && selected) { details.cancel(); detailSuccess = false; detailRevision = ''; body = ''; detailLoading = false; detailStale = true; detailError = 'Could not confirm this resource is current. Refresh to retry.'; }
      if (editing) { editConflict = true; editError = 'Could not confirm the current resource. Your draft is kept; cancel and refresh to retry.'; }
    } }
    finally { if (current()) loading = false; }
  }
  function drainRefresh() {
    if (disposed || saving || activeRead || !refreshQueued) return;
    refreshQueued = false; void load(true);
  }
  function load(background = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (saving) { refreshQueued = true; return Promise.resolve(); }
    if (activeRead) return activeRead;
    refreshing = background;
    const operation = readNetwork(background); activeRead = operation;
    const finish = () => {
      if (activeRead !== operation) return;
      activeRead = undefined; refreshing = false; drainRefresh();
    };
    void operation.then(finish, finish);
    return operation;
  }
  function settledRefresh() {
    if (saving || activeRead) { refreshQueued = true; return; }
    void load(true);
  }
  onMount(() => { void load(); return () => { disposed = true; refreshQueued = false; activeRead = undefined; loads.cancel(); requests.cancel(); details.cancel(); saves.cancel(); for (const timer of reviewTimers.values()) clearTimeout(timer); reviewTimers.clear(); }; });
  function reviewResult(ref: { id: string; version: number }, review: ConnectionReview | null, requestError?: string, priorReviewId?: string, pendingRequest?: ReviewRequest) {
    if (review && (review.resource.id !== ref.id || review.resource.version !== ref.version)) throw new Error('Connection status did not match this resource.');
    const key = routeKey(ref);
    if (requestError && (!review || review.id === priorReviewId)) { connectionReviews[key] = { requestError, priorReviewId, pendingRequest }; return; }
    connectionReviews[key] = { review };
    if (reviewPending(review)) reviewTimers.set(key, setTimeout(() => void inspectReview(ref), 2000));
    else if (review && (review.status === 'completed' || review.status === 'no-change') && !appliedReviews.has(review.id)) { appliedReviews.add(review.id); settledRefresh(); }
  }
  async function inspectReview(ref: { id: string; version: number }) {
    if (disposed) return;
    const key = routeKey(ref), previous = connectionReviews[key];
    if (previous?.submitting || previous?.loading) return;
    clearTimeout(reviewTimers.get(key)); reviewTimers.delete(key);
    const generation = (reviewGenerations.get(key) ?? 0) + 1; reviewGenerations.set(key, generation);
    connectionReviews[key] = { ...previous, loading: true };
    try { const result = await api.capabilityConnectionReview(ref.id, ref.version); if (!disposed && reviewGenerations.get(key) === generation) reviewResult(ref, result.review, previous?.requestError, previous?.priorReviewId, previous?.pendingRequest); }
    catch (cause) {
      if (!disposed && reviewGenerations.get(key) === generation) {
        connectionReviews[key] = { ...previous, loading: false, error: cause instanceof Error ? cause.message : 'Could not check connections.' };
        if (reviewPending(previous?.review) || previous?.acknowledging) reviewTimers.set(key, setTimeout(() => void inspectReview(ref), 5000));
      }
    }
  }
  async function reassessConnections() {
    if (!selected?.editable || !selected.enabled || !network || saving || refreshing || editing || detailStale || reviewBusy) return;
    const ref = { id: selected.id, version: Number(selected.version) }, key = routeKey(ref);
    const previous = connectionReviews[key], priorReviewId = previous?.priorReviewId ?? previous?.review?.id;
    // A null status can precede server admission. An explicit retry must reuse the
    // entire uncertain request, including its revision, rather than create another job.
    const request = previous?.pendingRequest ?? { ...ref, expectedRevision: network.revision, requestId: crypto.randomUUID() }; detailMessage = '';
    clearTimeout(reviewTimers.get(key)); reviewTimers.delete(key);
    const generation = (reviewGenerations.get(key) ?? 0) + 1; reviewGenerations.set(key, generation);
    connectionReviews[key] = { submitting: true, pendingRequest: request, priorReviewId };
    try {
      const result = await api.reassessCapabilityConnections(request);
      if (!disposed && reviewGenerations.get(key) === generation) reviewResult(ref, result.review);
    } catch (cause) {
      if (!disposed && reviewGenerations.get(key) === generation) {
        const uncertain = !(cause instanceof ApiError) || cause.status >= 500;
        connectionReviews[key] = { requestError: cause instanceof Error ? cause.message : 'Could not start Moderator reassessment.', acknowledging: uncertain, priorReviewId, ...(uncertain ? { pendingRequest: request } : {}) };
        // Resolve an uncertain acknowledgement by reading durable state, never by automatically reposting.
        if (uncertain) reviewTimers.set(key, setTimeout(() => void inspectReview(ref), 2000));
      }
    }
  }
  async function open(item: CapabilityItem, focus = true) {
    if (editing) return;
    if (focus) void inspectReview({ id: item.id, version: Number(item.version) });
    const revision = network?.revision ?? '';
    const reusable = selected?.key === item.key && selected.id === item.id && selected.version === item.version
      && item.available && !detailStale && detailRevision === revision && (detailLoading || detailSuccess);
    if (reusable) {
      selected = item;
      if (focus) { selectionRequest++; await tick(); if (selected?.key === item.key && !disposed) detailHeading?.focus(); }
      return;
    }
    const current = details.begin(); selected = item; if (focus) selectionRequest++; detailStale = false; detailMessage = '';
    detailRevision = revision; detailSuccess = false; body = ''; detailError = ''; detailLoading = item.available;
    await tick(); if (!current()) return; if (focus) detailHeading?.focus();
    if (!item.available || !network) return;
    try {
      const result = await api.capabilityResource(item.id, Number(item.version), revision);
      if (current()) { body = result.body; detailSuccess = true; }
    } catch (cause) { if (current()) detailError = cause instanceof Error ? cause.message : 'Could not read this resource.'; }
    finally { if (current()) detailLoading = false; }
  }
  async function close() {
    if (saving) return;
    if (editing) { await cancelEdit(); return; }
    const key = selected?.key; details.cancel(); detailSuccess = false; detailRevision = ''; selected = undefined; body = ''; detailError = ''; detailLoading = false;
    await tick();
    const button = [...page.querySelectorAll<HTMLButtonElement>('[data-resource-key]')].find(button => button.dataset.resourceKey === key);
    (button ?? page.querySelector<HTMLInputElement>('.network-search input'))?.focus();
  }
  async function beginEdit() {
    if (!selected?.editable || !network || !detailSuccess || detailStale || saving) return;
    editBase = { id: selected.id, version: Number(selected.version), expectedRevision: network.revision };
    draft = body; editError = ''; editConflict = false; detailMessage = ''; editing = true;
    await tick(); editor?.focus();
  }
  async function cancelEdit() {
    if (saving) return;
    editing = false; draft = ''; editError = ''; editConflict = false; editBase = undefined;
    if (selected && !detailStale) await open(selected, false);
    else if (detailStale) { body = ''; detailError = 'This exact resource is no longer available. Close to choose the current resource.'; }
    await tick(); page.querySelector<HTMLButtonElement>('.resource-edit-button')?.focus();
  }
  async function saveEdit() {
    if (!editing || !editBase || saving || editConflict || detailStale || !draft.trim() || draft === body) return;
    const current = saves.begin(), input = { ...editBase, body: draft, ...(projectId ? { projectId } : {}) };
    loads.cancel(); requests.cancel(); activeRead = undefined; refreshing = false; saving = true; editError = '';
    try {
      const result = await api.editCapabilityResource(input);
      if (!current()) return;
      network = result.network;
      const next = result.network.capabilities.items.find(item => item.id === result.resource.id && item.version === String(result.resource.version));
      editing = false; editBase = undefined; draft = ''; details.cancel();
      if (!next) { detailStale = true; body = ''; detailError = 'Saved, but this resource is no longer available. Close to refresh.'; return; }
      selected = next; body = result.resource.body; detailRevision = result.network.revision; detailSuccess = true; detailStale = false; detailLoading = false; detailError = ''; detailMessage = 'Saved'; selectionRequest++;
      await tick(); detailHeading?.focus();
      try { await onchange(); } catch { if (current()) detailMessage = 'Saved. Workspace refresh unavailable.'; }
    } catch (cause) {
      if (current()) {
        editConflict = cause instanceof ApiError && cause.status === 409;
        editError = editConflict ? 'The library changed. Your draft is kept. Cancel and close, then refresh the tree.' : cause instanceof Error ? cause.message : 'Could not save. Your draft is kept.';
      }
    } finally { if (current()) { saving = false; drainRefresh(); } }
  }
  async function toggle(item: CapabilityItem, enabled: boolean) {
    if (!network || saving) return;
    const current = saves.begin(); loads.cancel(); activeRead = undefined; refreshing = false; saving = true; error = ''; message = '';
    const revision = network.revision;
    try {
      await requests.run(async () => {
        await api.selectCapability({ expectedRevision: revision, key: item.key, enabled, ...(projectId ? { projectId } : {}) });
        return api.capabilityNetwork(projectId);
      }, async value => { message = 'Saved for the next round.'; await acceptNetwork(value, true, true); });
      if (current()) await onchange();
    } catch (cause) { if (current()) {
      error = cause instanceof Error ? cause.message : 'Could not save selection. Refresh and try again.';
      if (selected) { details.cancel(); detailSuccess = false; detailRevision = ''; body = ''; detailLoading = false; detailStale = true; detailError = 'Could not confirm this resource is current. Refresh to retry.'; }
    } }
    finally { if (current()) { saving = false; drainRefresh(); } }
  }

  function searchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || composing || event.keyCode === 229 || !query.trim()) return;
    event.preventDefault(); findRequest += event.shiftKey ? -1 : 1;
  }
</script>
<section class="capability-page network-page" class:details-open={!!selected} class:side-dialog={sideDialog} bind:this={page} aria-label="Resource network">
  <header class="knowledge-tree-header"><h1>Skill / Strategy</h1><div class="network-header-actions"><label class="network-search"><span class="visually-hidden">Search resources</span><Icon name="search" size={17}/><input type="search" placeholder="Search" aria-label="Search resources" bind:value={query} onkeydown={searchKeydown} oncompositionstart={() => composing = true} oncompositionend={() => composing = false} /></label><select aria-label="Scientific field" style="width:auto" bind:value={field}><option value="">All fields</option>{#each [...new Set(items.map(i=>classifyField(i.subjectTags)))].sort() as f}<option value={f}>{FIELD_CATALOG[f].label}</option>{/each}</select><div class="network-filters" role="group" aria-label="Resource type"><button type="button" class:chosen={filter === 'strategy'} aria-label="Filter Strategies" aria-pressed={filter === 'strategy'} onclick={() => filter = filter === 'strategy' ? 'all' : 'strategy'}><i class="legend-strategy" aria-hidden="true"></i><span>Strategy</span></button><button type="button" class:chosen={filter === 'skill'} aria-label="Filter Skills" aria-pressed={filter === 'skill'} onclick={() => filter = filter === 'skill' ? 'all' : 'skill'}><i class="legend-skill" aria-hidden="true"></i><span>Skill</span></button></div><button class="icon-button" type="button" aria-label="Refresh network" title="Refresh network" disabled={loading || saving || refreshing} aria-busy={refreshing} onclick={() => load(true)}><Icon name="refresh" size={18} /></button></div></header>
  {#if refreshing}<p class="save-state" role="status">Refreshing resources…</p>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if loading}<p class="muted" role="status">Loading resources…</p>
  {:else if network}
      <div class="network-canvas-content" bind:clientWidth={canvasHostWidth}>
      {#if !visible.length}<div class="network-empty"><CagesEmpty message={items.length ? 'No matching resources.' : 'No resources yet.'} showHint={!items.length && !refreshing && !error} /></div>{:else}<ResourceNetwork items={visible} {network} selectedKey={selected?.key} {query} {findRequest} {selectionRequest} onselect={open} />{/if}
    </div>
    {#if selected}
      <div class="resource-dialog-layer">
      <div class="resource-dialog-backdrop" aria-hidden="true" style="pointer-events:none"></div>
      <div class="resource-detail resource-dialog" use:movable={'dialog'} class:resource-editing={editing} role="dialog" aria-modal="true" aria-labelledby="resource-detail-title" aria-busy={saving} tabindex="-1" use:containDialogFocus={() => void close()}>
        <div class="dialog-head"><div class="resource-dialog-actions">{#if !editing}<button type="button" class="resource-reassess-button icon-button" class:review-pending={reviewBusy} aria-label="Reassess connections" title="Reassess connections" aria-busy={reviewBusy} disabled={!selected.editable || !selected.enabled || detailStale || saving || refreshing || reviewBusy} onclick={reassessConnections}><Icon name="refresh" size={18} /></button><button type="button" class="resource-edit-button icon-button" aria-label="Edit resource" title={selected.editable ? 'Edit resource' : 'Read-only resource'} disabled={!selected.editable || !detailSuccess || detailStale || saving} onclick={beginEdit}><Icon name="edit" size={18} /></button>{/if}<button type="button" class="icon-button" aria-label={editing ? 'Cancel editing' : 'Close resource details'} disabled={saving} onclick={close}><Icon name="close" size={18} /></button></div>
        <div class="resource-heading"><h2 id="resource-detail-title" bind:this={detailHeading} tabindex="-1">{selected.title}</h2><label class="resource-switch"><input type="checkbox" role="switch" checked={selected.enabled} aria-checked={selected.enabled} aria-label={`Load ${selected.title}`} disabled={saving || detailStale || (!selected.available && !selected.enabled)} onchange={event => void toggle(selected!, event.currentTarget.checked)} /></label></div></div><div class="dialog-scroll">
        {#if editing}
          <form class="resource-editor" onsubmit={event => { event.preventDefault(); void saveEdit(); }}>

            <label class="visually-hidden" for="resource-editor-body">Resource content (Markdown)</label>
            <textarea id="resource-editor-body" bind:this={editor} bind:value={draft} spellcheck="false" disabled={saving} aria-describedby={editError ? 'resource-editor-error' : undefined}></textarea>
            {#if editError}<p id="resource-editor-error" class="notice error" role="alert">{editError}</p>{/if}
            <div class="resource-editor-actions"><button type="button" disabled={saving} onclick={cancelEdit}>Cancel</button><button type="submit" class="resource-save-button" disabled={saving || editConflict || !draft.trim() || draft === body}>{saving ? 'Saving…' : 'Save'}</button></div>
          </form>
        {:else}
        {#if detailMessage}<p class="resource-saved" role="status">{detailMessage}</p>{/if}
        {#if reviewNotice}<p class="resource-review-status" class:review-error={reviewFailed} role={reviewFailed ? 'alert' : 'status'} title={selectedReview?.review?.message}>{reviewNotice}</p>{/if}
        {#if selected.reason}<p class="resource-reason">{selected.reason}</p>{/if}
        {#if detailLoading}<p class="muted" role="status">Reading resource…</p>
        {:else if detailError}<p class="notice error" role="alert">{detailError}</p>
        {:else if body}<MarkdownView content={resourceReadingBody(body, selected.title)} />
        {:else}<p>{selected.description}</p>{/if}
        {#if relations.length}
          <details class="resource-relations"><summary>Connections · {relations.length}</summary>
            {#each relations as relation (`${relation.id}@${relation.version}`)}
              {@const source = linkedItem(relation.from)}{@const target = linkedItem(relation.to)}
              <article><div class="relation-endpoints"><button disabled={!source || saving} onclick={() => source && open(source)}>{source?.title ?? relation.from.id}</button><span aria-label={relation.relation} title={relation.relation}>{['requires','supports','refutes'].includes(relation.relation) ? '→' : '—'} {relation.relation}</span><button disabled={!target || saving} onclick={() => target && open(target)}>{target?.title ?? relation.to.id}</button></div><p>{relation.basis}</p>{#if relation.bridgeConditions.length}<ul>{#each relation.bridgeConditions as condition}<li>{condition}</li>{/each}</ul>{/if}</article>
            {/each}
          </details>
        {/if}
        <details class="resource-metadata"><summary>Metadata</summary><dl><dt>Resource</dt><dd>{selected.id} · v{selected.version}</dd><dt>Scope</dt><dd>{selected.scope}</dd><dt>Owner</dt><dd>{selected.owner}</dd>{#if selected.userEdited}<dt>Last edit</dt><dd>User</dd>{/if}</dl>{#if selected.limitations.length}<ul>{#each selected.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</details>
        {/if}
      </div></div>
      </div>
    {/if}
  {/if}
  <details class="network-learning"><summary>Learning</summary><LearningStatus {projects} {projectId} onsettled={settledRefresh} /></details>
</section>
