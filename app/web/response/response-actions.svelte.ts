import { tick, untrack } from 'svelte';
import type { FeedbackTarget, ResearchProject } from '../api';
import type { EpochRecord } from '../../src/research/contracts/v2';
import type { CheckpointPage } from '../checkpoint-view';
import { browserExportHost, displayedResponse, responseExport, saveResponse, type DisplayedOriginal } from './export-response';
import { responseFingerprint } from './local-feedback';

export interface ResponseSelection { projectId: string; pageId: string; revision: string; label: string }
export interface ResponseActionContext {
  project?: ResearchProject; page?: CheckpointPage; feedbackEpoch?: EpochRecord;
  displayLabel?: string; disabled?: boolean; scrollContainer?: HTMLElement;
  original?: DisplayedOriginal;
}
type ActionSource = 'menu' | 'footer';
interface ResponseCallbacks {
  onfeedback: (selection: ResponseSelection, assessment: string, informationValue: number, target: FeedbackTarget) => Promise<void>;
  onfork?: (selection: ResponseSelection) => void | Promise<void>;
}

/** One selected-output action state, shared by the title menu and footer. */
export class ResponseActionController {
  readonly context: ResponseActionContext = $derived.by(() => this.readContext());
  readonly fingerprint = $derived(responseFingerprint(this.context.page?.content ?? ''));
  readonly readableResponse = $derived(displayedResponse(this.context.page, this.context.original));
  readonly identity = $derived(`${this.context.project?.id ?? ''}:${this.context.page?.id ?? ''}:${this.fingerprint}:${this.context.original?.key ?? ''}:${responseFingerprint(this.readableResponse?.content ?? '')}`);
  readonly label = $derived(this.context.displayLabel || this.context.page?.label || 'selected output');
  readonly ownSaved = $derived.by(() => {
    const { project, page } = this.context;
    if (!project || !page || page.inheritedSessionId || page.id === 'latest') return false;
    if (project.schemaVersion === 4 || project.schemaVersion === 3) return project.epochs.some(epoch => epoch.id === page.id && !!epoch.completedAt);
    const records = project.schemaVersion === 2 ? project.epochs : project.rounds;
    return records.some(record => record.id === page.id && !!(record.summary.trim() || record.completedAt || ('decision' in record && record.decision)));
  });
  readonly canRead = $derived(!!this.context.project && !!this.readableResponse?.content && (this.ownSaved || !!this.context.page?.inheritedSessionId));
  readonly canReview = $derived(this.ownSaved && (this.context.project?.schemaVersion === 1 || this.context.feedbackEpoch?.id === this.context.page?.id));
  readonly canFork = $derived.by(() => this.ownSaved && !!this.callbacks.onfork);
  readonly disabled = $derived(!!this.context.disabled);
  reviewOpen = $state(false);
  reviewSaving = $state(false);
  pending = $state<'copy' | 'export' | 'branch' | undefined>();
  notice = $state('');
  error = $state('');
  exportFailed = $state(false);
  statusSource = $state<ActionSource>('footer');
  reviewPanel?: HTMLElement;

  constructor(private readContext: () => ResponseActionContext, private callbacks: ResponseCallbacks) {
    $effect(() => {
      this.identity;
      untrack(() => { this.reviewOpen = false; this.dismissStatus(); });
    });
  }
  private capture(): ResponseSelection | undefined {
    const { project, page } = this.context;
    return project && page ? { projectId: project.id, pageId: page.id, revision: project.contentRevision, label: this.label } : undefined;
  }
  dismissStatus() { this.notice = ''; this.error = ''; this.exportFailed = false; }
  private begin(source: ActionSource) { this.dismissStatus(); this.statusSource = source; }

  async copy(source: ActionSource = 'footer') {
    if (!this.canRead || this.pending) return;
    const identity = this.identity, content = this.readableResponse!.content, label = this.label;
    this.begin(source); this.pending = 'copy';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Use Export Markdown instead.');
      await navigator.clipboard.writeText(content);
      if (this.identity === identity) this.notice = `Copied ${label} Markdown.`;
    } catch (cause) {
      if (this.identity === identity) this.error = `Copy was not completed. ${cause instanceof Error ? cause.message : 'Use Export Markdown instead.'}`;
    } finally { this.pending = undefined; }
  }
  async exportMarkdown(source: ActionSource = 'footer', downloadOnly = false) {
    if (!this.canRead || this.pending) return;
    const identity = this.identity, label = this.label;
    const snapshot = responseExport(this.context.project!, { ...this.context.page!, label, content: this.readableResponse!.content });
    this.begin(source); this.pending = 'export';
    try {
      const host = browserExportHost();
      if (downloadOnly) delete host.pick;
      const result = await saveResponse(snapshot, host);
      if (this.identity === identity) this.notice = result === 'saved' ? `Saved ${label} Markdown.` : result === 'download-started' ? `${label} download started. Your browser controls the save location.` : '';
    } catch (cause) {
      if (this.identity === identity) { this.exportFailed = true; this.error = `Export was not completed. ${cause instanceof Error ? cause.message : 'Check file permissions and available storage, then try again.'}`; }
    } finally { this.pending = undefined; }
  }
  async branch(source: ActionSource = 'footer') {
    if (!this.canFork || this.disabled || this.pending) return;
    const identity = this.identity, selection = this.capture();
    if (!selection) return;
    this.begin(source); this.pending = 'branch';
    try { await this.callbacks.onfork!(selection); }
    catch (cause) { if (this.identity === identity) this.error = `Branch was not created. ${cause instanceof Error ? cause.message : 'Try again after checking the connection.'}`; }
    finally { this.pending = undefined; }
  }
  async showReview(reveal = false) {
    if (!this.canReview) return;
    const identity = this.identity;
    this.reviewOpen = true;
    if (!reveal) return;
    await tick();
    if (identity !== this.identity || !this.reviewOpen || !this.reviewPanel) return;
    const panel = this.reviewPanel, container = this.context.scrollContainer;
    // Only move the supplied reading pane, never the document or other ancestors.
    if (container?.contains(panel)) {
      const pane = container.getBoundingClientRect(), box = panel.getBoundingClientRect();
      if (box.bottom > pane.bottom || box.top < pane.top) {
        const offset = box.height > pane.height - 48 ? box.top - pane.top - 24 : box.bottom - pane.bottom + 24;
        container.scrollTo({ top: Math.max(0, container.scrollTop + offset), behavior: 'instant' });
      }
    }
    panel.focus({ preventScroll: true });
  }
  async saveFeedback(assessment: string, informationValue: number, target: FeedbackTarget) {
    if (!this.canReview || this.disabled || this.reviewSaving) throw new Error('This saved output cannot be reviewed right now.');
    const selection = this.capture();
    if (!selection) throw new Error('No saved output is selected.');
    this.reviewSaving = true;
    try { await this.callbacks.onfeedback(selection, assessment, informationValue, target); }
    finally { this.reviewSaving = false; }
  }
}
