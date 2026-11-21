<script lang="ts">
  import ResearchWaysV0 from './research/ResearchWaysV0.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { alignReadingColumn } from './reading-column';
  import { showNotices } from './appearance/notifications';
  import StartPageBackdrop from './themes/StartPageBackdrop.svelte';
  import { startPageArtwork } from './themes/start-page-assets';
  import { currentTheme } from './themes/preference';
  import InspectorViewSwitch from './layout/InspectorViewSwitch.svelte';
  import SessionHistory from './layout/SessionHistory.svelte';
  import { stageComposerFiles, isResearchModelReady, COMPOSER_SOURCE_ACCEPT } from './composer-state';
  import { modifiedHypothesisHistory } from './hypothesis/modified-history';
  import { sessionScrollbar, hiddenSidebarScrollbar } from './themes/session-presentation';
  import type { WorkspaceEvent as ResearchEvent } from './api';
  import { api, ApiError, subscribeEvents, type Bootstrap, type ResearchProject, type DocumentEntry, type DocumentContent, type UserCommand } from './api';
  import MarkdownView from './MarkdownView.svelte';
  import StickyHypothesis from './layout/StickyHypothesis.svelte';
  import ResizeHandle from './layout/ResizeHandle.svelte';
  import { resizeSidebars } from './layout/sidebar-resize';
  import HypothesisInspector from './HypothesisInspector.svelte';
  import ResearchPaper from './ResearchPaper.svelte';
  import ReportUpdateView from './research/ReportUpdateView.svelte';
  import KnowledgeUpdates from './research/KnowledgeUpdates.svelte';
  import type {ReportUpdate} from './api';
  import ArchivedRefutationView from './research/ArchivedRefutationView.svelte';
  import type { ArchivedRefutation } from '../src/learning/research-data';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import HypothesisTree from './HypothesisTree.svelte';
  import { v21DefaultOptionalOriginal } from './research-view-v21';
  import ResearchTreeV21 from './research/ResearchTreeV21.svelte';
  import HypothesisTreeV2 from './HypothesisTreeV2.svelte';
  import ResearchDirections from './research/DirectionPanel.svelte';
  import ReconstructionProposals from './ReconstructionProposals.svelte';
  import ResponseActions from './response/ResponseActions.svelte';
  import ProjectHandoff from './response/ProjectHandoff.svelte';
  import ResponseActionMenu from './response/ResponseActionMenu.svelte';
  import { ResponseActionController, type ResponseSelection } from './response/response-actions.svelte';
  import { inheritedPages } from './response/inherited-pages';
  import InheritedContextNotice from './response/InheritedContextNotice.svelte';
  import type { InheritedResearchView } from '../src/research/contracts/lineage';
  import LoopMonitor from './monitor/LoopMonitor.svelte';
  import LoopActivity from './monitor/LoopActivity.svelte';
  import { projectLoopView } from './monitor/loop-view';
  import { projectDiagramView } from './monitor/diagram-view';
  import type { MonitorActivitySnapshot } from '../src/server/monitor-activity';
  import type { LearningTaskView } from './api';

  import Icon from './Icon.svelte';
  import BrandMark from './BrandMark.svelte';
  import NavigationWordmark from './NavigationWordmark.svelte';
  import SessionOutline from './SessionOutline.svelte';
  import SystemSettings from './SystemSettings.svelte';
  import MaintenancePage from './MaintenancePage.svelte';
  import ResearchComposer from './ResearchComposer.svelte';
  import { researchModes, DEFAULT_RESEARCH_MODE, researchModeLocked, type ResearchMode } from './research-mode';
  import { developerMode } from './developer-mode';
  import { currentResearchNumber } from './research-scope';
  import ModifiedHypothesisHistory from './hypothesis/ModifiedHypothesisHistory.svelte';
  import { CommandRequestTracker } from './hypothesis/command-request';
  import { pendingModificationCommands } from '../src/research/user-commands';
  import HypothesisEntry from './HypothesisEntry.svelte';
  import RoundRibbon from './RoundRibbon.svelte';
  import { checkpointPages, selectedCheckpoint } from './checkpoint-view';
  import KnowledgeCanvas from './KnowledgeCanvas.svelte';
  let mapOpen = $state(false);

  import CapabilitiesPage from './CapabilitiesPage.svelte';
  import LearningStatus from './LearningStatus.svelte';
  import WorkspaceTabs from './WorkspaceTabs.svelte';
  import { canonicalCapabilityView, type CapabilityView } from './capabilities/navigation';
  type Screen = 'research' | 'document' | 'settings' | 'maintenance' | CapabilityView;
  type Page = Exclude<Screen,'fast'|'slow'>;
  let workspaceTabs = $state<Page[]>(['research']);
  const pageFor=(s:Screen):Page=>s==='fast'||s==='slow'?'knowledge':s;
  function registerPage(next:Screen){const page=pageFor(next);if(!workspaceTabs.includes(page))workspaceTabs.push(page)}

  let researchScrollTop = 0;
  let search = $state('');
  let treeOpen = $state(false);
  let inspectorView = $state<'research' | 'monitor'>('research');
  let learningTasks = $state<LearningTaskView[]>([]);
  let snapshotStale = $state(false);
  let observationSerial = 0;
  let sidebarOpen = $state(false);
  let smallScreen = $state(false);
  let hypothesisExpanded = $state(true);
  let outlineLocation = $state('hypothesis');
  let outlineTarget = '';
  let hypothesisBlock = $state<HTMLElement>();
  let transcript = $state<HTMLDivElement>();
  let readingColumn = $state<HTMLDivElement>();
  let bootstrap = $state<Bootstrap | undefined>();
  let sessionGroups=$derived([...new Set((bootstrap?.projects??[]).map(p=>p.group).filter((group):group is string=>!!group))].sort());
  async function moveSession(id:string,group:string){
    try{await api.moveSession(id,group);await refresh()}catch(cause){error=cause instanceof Error?cause.message:'Could not move the session.'}
  }
  let groupingSession=$state(''), newGroup=$state('');
  function startGroup(event:DragEvent){
    event.preventDefault();
    const id=event.dataTransfer?.getData('application/x-carnot-session');
    if(id && bootstrap?.projects.some(p=>p.id===id)){
      groupingSession=id;newGroup='';
      void tick().then(()=>window.document.querySelector<HTMLInputElement>('.new-group input')?.focus());
    }
  }
  function dropSession(event:DragEvent,group:string){
    event.preventDefault();
    const id=event.dataTransfer?.getData('application/x-carnot-session');
    if(id&&bootstrap?.projects.some(p=>p.id===id))void moveSession(id,group);
  }

  let project = $state<ResearchProject | undefined>();
  let inheritedContext = $state<InheritedResearchView | null>();
  let pages = $derived([...inheritedPages(inheritedContext), ...checkpointPages(project)]);
  const forkOperations = new Map<string, string>();
  let selectedPageId = $state<string>();
  let selectedPage = $derived(selectedCheckpoint(pages, selectedPageId));
  let optionalOriginal = $derived(project?.schemaVersion===3&&!selectedPage?.inheritedSessionId?v21DefaultOptionalOriginal(project,selectedPage?.number):undefined);
  let optionalOriginalKey=$derived(optionalOriginal?.key);
  let optionalBody=$state(''),optionalBodyError=$state(''),optionalBodyLoading=$state(false);
  let reportUpdates=$state<ReportUpdate[]>([]);
  let loadedAssessment=$state<ReportUpdate>();
  let optionalAssessment=$derived(reportUpdates.findLast(row=>row.projectId===project?.id&&row.epochId===optionalOriginal?.epochId&&row.artifactId===optionalOriginal?.artifactId&&row.status!=='queued')??loadedAssessment);
  let optionalRefutation=$state<ArchivedRefutation>();
  let optionalBodyKey=$state<string>();
  let displayedOriginal=$derived(optionalOriginal ? { ...optionalOriginal, content: optionalBodyKey === optionalOriginal.key && !optionalBodyLoading && !optionalBodyError ? optionalBody : undefined } : undefined);
  $effect(()=>{
    const key=optionalOriginalKey,choice=untrack(()=>optionalOriginal),id=untrack(()=>project?.id);
    let current=true;
    optionalBody='';loadedAssessment=undefined;optionalRefutation=undefined;optionalBodyKey=undefined;optionalBodyError='';optionalBodyLoading=!!choice;
    if(key&&choice&&id){
      const pending=choice.kind==='archive'?api.wayArchive(id,choice.id):api.rawAnswer(id,choice.id);
      void pending.then(value=>{if(current){optionalBody=value.body;loadedAssessment='operationId' in value?value.assessment:undefined;optionalRefutation='operationId' in value?value.refutation:undefined;optionalBodyKey=key;}},cause=>{if(current)optionalBodyError=cause instanceof Error?cause.message:'Original unavailable.';}).finally(()=>{if(current)optionalBodyLoading=false;});
    }
    return ()=>{current=false;};
  });

  let readingHypothesis = $state('');
  let premiseLoading = $state(false);
  let premiseError = $state('');
  let premiseProjectId = $derived(project?.id);
  let inheritedPremiseMissing = $derived(!!selectedPage?.inheritedSessionId && selectedPage.hypothesis === undefined);
  let premiseText = $derived(inheritedPremiseMissing ? '' : selectedPage?.hypothesis ?? project?.hypothesis ?? '');
  let premiseRevision = $derived(selectedPage?.hypothesis === undefined && selectedPage?.hypothesisRevision && selectedPage.hypothesisRevision !== project?.hypothesisRevision ? selectedPage.inputRevision : undefined);
  $effect(() => {
    const id = premiseProjectId, revision = premiseRevision, text = premiseText, missing = inheritedPremiseMissing;
    let cancelled = false;
    premiseError = ''; premiseLoading = false;
    if (missing) { readingHypothesis = ''; premiseError = 'The exact saved premise for this inherited output is unavailable.'; return; }
    if (!id || !revision) { readingHypothesis = text; return; }
    readingHypothesis = ''; premiseLoading = true;
    void api.document(id, 'hypothesis.md', revision).then(saved => { if (!cancelled) readingHypothesis = saved.content; }).catch(() => { if (!cancelled) premiseError = 'Saved premise is unavailable for this output.'; }).finally(() => { if (!cancelled) premiseLoading = false; });
    return () => { cancelled = true; };
  });
  let documents = $state<DocumentEntry[]>([]);
  let commands = $state<UserCommand[]>([]);
  let commandHistory = $state<UserCommand[]>([]);
  let waitingRefinements = $derived(project ? pendingModificationCommands(project, commandHistory) : []);

  let screen = $state<Screen>('research');
  let sessionView = $derived(!!project && (screen === 'research' || screen === 'document'));
  let connection = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
  let workspaceReady = $derived(connection === 'connected' && !snapshotStale);
  let busy = $state(false);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let projectName = $state('');
  let draftMode = $state<ResearchMode>(DEFAULT_RESEARCH_MODE);
  async function chooseMode(mode: ResearchMode) {
    if (!$developerMode || busy) return;
    if (!project) { draftMode = mode; return; }
    if (researchModeLocked(project)) return;
    const {id, contentRevision} = project, current = captureView();
    await run(async () => {
      const changed = await api.selectResearchMode(id, mode, contentRevision);
      if (current() && project?.id === id) project = changed;
      await refresh();
    }, current);
  }
  let hypothesis = $state('');
  let homeFiles = $state<File[]>([]);
  let sessionFiles = $state<Record<string, File[]>>({});
  let stagedFiles = $derived(project ? sessionFiles[project.id] || [] : homeFiles);
  let modifiedHistory = $state<{ reveal: () => void }>();
  let refinement = $state('');
  let composer = $state<{ focusInput: (moveCursorToEnd?: boolean) => void }>();
  const refinementDrafts = new Map<string,string>();
  let annotations = $state<Record<string,string>>({});
  let controlBusy = $state(false);
  let externalPath = $state('');
  let grantOpen = $state(false);
  let grantConsent = $state(false);
  let noteName = $state('');
  let noteOpen = $state(false);
  let document = $state<DocumentContent | undefined>();
  let draft = $state('');
  let pdfData = $state<Uint8Array | undefined>();
  let selectedEntry = $state<DocumentEntry | undefined>();
  let annotationKey = $derived(`${project?.id}:${selectedEntry?.path}`);
  let documentLoading = $state(false);
  let preview = $state(false);
  let sourceChanged = $state(false);
  let historicalRevision = $state('');
  let workerSteps = $state<Record<string, string>>({});
  let monitorActivity = $state<MonitorActivitySnapshot>();
  let exitOpen = $state(false);
  let exportProjectId = $state<string>();
  let deleteTarget = $state<{ id: string; name: string }>();
  $effect(() => { if (exportProjectId && project?.id !== exportProjectId) exportProjectId = undefined; });
  let exitState = $state<'kept' | 'stopping' | 'closed' | undefined>();
  let importInput = $state<HTMLInputElement>();
  let stopEvents: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let eventRefreshRunning = false, eventRefreshPending = false;
  let refreshFailures = 0;
  let selectionSerial = 0;
  let documentSerial = 0;
  let refreshSerial = 0;
  let disposed = false;
  let rightShown = $derived(!loading && (screen === 'research' || screen === 'document') && !!project && treeOpen);
  let dirty = $derived(!!document && draft !== document.content);
  let immutableDocument = $derived(!!document && (document.path.startsWith('branches/') || (document.path === 'hypothesis.md' && !!project && researchModeLocked(project))));
  let active = $derived(!!project && (bootstrap?.activeProjectIds.includes(project.id) || project.status === 'running'));
  let recoveryPending = $derived((project?.schemaVersion === 2 || project?.schemaVersion === 3 || project?.schemaVersion === 4) && !!project.activeEpoch && !active);
  let chosenModel = $derived(active ? project?.config.defaultModel : bootstrap?.preferences.defaultModel);
  let modelReady = $derived(isResearchModelReady(bootstrap, chosenModel));
  let queuedCount = $derived(project ? modifiedHypothesisHistory(project, commandHistory, { activity: monitorActivity, connected: connection === 'connected' && !snapshotStale }).filter(entry => entry.status === 'in queue').length : 0);
  let pendingStop = $derived(commands.some(command => command.kind === 'stop'));
  let pendingPause = $derived(commands.some(command => command.kind === 'pause'));
  let loopView = $derived(project ? projectLoopView(project, workerSteps, { connection: snapshotStale ? 'connecting' : connection, active, pendingStop, pendingPause, learningTasks, activity: monitorActivity }) : undefined);
  let diagramView = $derived(project && loopView ? projectDiagramView(project, loopView, monitorActivity, { userInputPending: waitingRefinements.length > 0 }) : undefined);
  let boundary = $derived(project?.schemaVersion === 1 ? 'round' : 'Epoch');
  let researchNumber = $derived(currentResearchNumber(project));
  let feedbackEpoch = $derived(project?.schemaVersion === 2 ? project.epochs.find(epoch => epoch.id === selectedPage?.id && epoch.summary.trim()) : undefined);
  let inputHistory = $derived((project?.schemaVersion === 4 || project?.schemaVersion === 3) ? project.epochs.map(epoch => ({ id: epoch.id, number: epoch.epoch, inputRevision: epoch.snapshot.inputRevision })) : project?.schemaVersion === 2 ? project.epochs.map(epoch => ({ id: epoch.id, number: epoch.number, inputRevision: epoch.snapshot.inputRevision })) : project?.rounds || []);
  const readable = (value: string) => value.replaceAll('_', ' ');
  const shortRevision = (value?: string) => value ? value.slice(0, 10) : 'not committed';

  const responseActions = new ResponseActionController(() => ({
    project, page: selectedPage, feedbackEpoch, original: displayedOriginal,
    displayLabel: selectedPage ? `Epoch ${pages.findIndex(page => page.id === selectedPage.id) + 1}` : undefined,
    disabled: active || busy || !workspaceReady, scrollContainer: transcript,
  }), {
    onfeedback: async (selection, assessment, informationValue, target) => {
      const isCurrent = captureView();
      const updated = await api.feedback(selection.projectId, selection.pageId, assessment, informationValue, selection.revision, target);
      if (isCurrent() && project?.id === selection.projectId) project = updated;
      await refresh();
    },
    onfork: selection => forkSelectedPage(selection),
  });
  const commandRequests = new CommandRequestTracker();
  async function queueUserCommand(id: string, kind: UserCommand['kind'], payload = '', refinementKind?: 'hypothesis' | 'annotation') {
    const token = await commandRequests.begin({ projectId: id, kind, payload, refinementKind });
    await api.command(id, kind, payload, { requestId: token.requestId, ...(refinementKind ? { refinementKind } : {}) });
    commandRequests.confirm(token);
  }
  function rememberRefinement() { if (project) refinementDrafts.set(project.id,refinement); }
  async function editCurrentHypothesis() {
    if (!project || loading || busy || !project.hypothesis.trim()) return;
    const id = project.id, source = project.hypothesis;
    const replacing = refinement !== source;
    if (replacing && refinement.length && !window.confirm('Replace the unsent hypothesis modification with the current hypothesis source?')) return;
    if (replacing) { refinement = source; rememberRefinement(); }
    await tick();
    if (project?.id === id && screen === 'research') composer?.focusInput(replacing);
  }
  function canLeaveDraft(): boolean { return !dirty || window.confirm('Discard the unsaved Markdown edits in this page?'); }
  // A response may finish after browser history or file navigation has moved on.
  function captureView() {
    const id = project?.id, selection = selectionSerial, selected = documentSerial, view = screen, page = selectedPageId;
    return () => !disposed && project?.id === id && selectionSerial === selection && documentSerial === selected && screen === view && selectedPageId === page;
  }
  async function run(action: () => Promise<void>, isCurrent: () => boolean = () => !disposed) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try { await action(); } catch (cause) {
      if (isCurrent()) {
        error = cause instanceof Error ? cause.message : 'The operation could not be completed.';
        if (cause instanceof ApiError && cause.status === 409 && dirty) sourceChanged = true;
      }
    } finally { busy = false; }
  }
  async function refresh() {
    const version = ++refreshSerial, selection = selectionSerial, id = project?.id;
    const isCurrent = () => !disposed && version === refreshSerial && selection === selectionSerial && id === project?.id;
    try {
      const [workspace, session, listing, journal] = await Promise.allSettled([
        api.bootstrap(), id ? api.project(id) : undefined, id ? api.documents(id) : undefined, id ? api.commandHistory(id) : undefined,
      ]);
      if (!isCurrent()) return;
      // Preserve workspace-level quarantine notices even if this session cannot load.
      if (workspace.status === 'fulfilled') bootstrap = workspace.value;
      if (workspace.status === 'rejected') throw workspace.reason;
      if (session.status === 'rejected') throw session.reason;
      if (listing.status === 'rejected') throw listing.reason;
      if (journal.status === 'rejected') throw journal.reason;
      const nextProject = session.value, nextDocuments = listing.value, nextCommands = journal.value;
      if (id && nextProject) {
        project = nextProject; documents = nextDocuments!.documents; commandHistory = nextCommands!; commands = nextCommands!.filter(item => !nextProject.processedCommandIds.includes(item.id));
        if (document && !historicalRevision && !selectedEntry?.sourceId && document.revision !== nextDocuments!.revision) {
          if (dirty) sourceChanged = true;
          else if (screen === 'document' && selectedEntry?.kind !== 'pdf') {
            const selected = documentSerial;
            const content = await api.document(id, document.path);
            if (isCurrent() && selected === documentSerial && document?.path === content.path && !historicalRevision && !dirty) { document = content; draft = content.content; sourceChanged = false; }
          }
        }
      }
      if (isCurrent()) { snapshotStale = false; refreshFailures = 0; }
    } catch (cause) {
      if (!isCurrent()) return;
      snapshotStale = true; refreshFailures = Math.min(refreshFailures + 1, 5);
      // HTTP snapshot health is separate from the notification stream. A quiet,
      // still-open stream must recover without needing another event or reload.
      const unavailable = bootstrap?.unavailableProjects?.find(item => item.id === id);
      if (unavailable) error = `Session ${unavailable.id} is unavailable. ${unavailable.message}`;
      else if (connection === 'connected') queueRefresh();
      throw cause;
    }
  }
  function queueRefresh() {
    eventRefreshPending = true;
    if (refreshTimer || eventRefreshRunning || disposed) return;
    const delay = refreshFailures ? Math.min(1000 * 2 ** (refreshFailures - 1), 10000) : 200;
    refreshTimer = setTimeout(async () => {
      refreshTimer = undefined; eventRefreshRunning = true; eventRefreshPending = false;
      try { await refresh(); } catch { /* refresh records scoped staleness and schedules recovery. */ }
      finally { eventRefreshRunning = false; if (eventRefreshPending) queueRefresh(); }
    }, delay);
  }
  function eventReceived(event: ResearchEvent) {
    observationSerial++;
    if (event.projectId === project?.id && event.type === 'worker.status' && event.branchId && event.status) workerSteps = { ...workerSteps, [event.branchId]: event.status };
    queueRefresh();
  }
  // Observation only: sampled active runtime calls/tools, never scientific input.
  $effect(() => {
    const id = project?.id, connected = workspaceReady && (screen === 'research' || rightShown && inspectorView === 'monitor');
    const poll=active || rightShown && inspectorView === 'monitor';
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    monitorActivity = undefined;
    async function observeActivity() {
      if (cancelled || !id || !connected) return;
      if (!window.document.hidden) {
        try {
          const next = await api.monitorActivity(id);
          if (!cancelled && project?.id === id && next.projectId === id) monitorActivity = next;
        } catch {
          // A failed observation cannot leave a document/tool operation illuminated.
          if (!cancelled && project?.id === id) monitorActivity = { projectId: id, available: true, operations: [] };
        }
      } else if (!cancelled) monitorActivity = { projectId: id, available: true, operations: [] };
      if (!cancelled && poll) timer = setTimeout(() => void observeActivity(), 1000);
    }
    if (id && connected) void observeActivity();
    return () => { cancelled = true; clearTimeout(timer); };
  });
  // Existing events notify transitions; pending V2 calls can change within a
  // phase without an event. Read only the selected live snapshot, never start work.
  $effect(() => {
    const id = project?.id, enabled = active && connection === 'connected';
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function observe() {
      if (cancelled || !id || !enabled) return;
      if (!window.document.hidden && !busy && !eventRefreshRunning && !eventRefreshPending) {
        const revision = project?.contentRevision, serial = observationSerial, refreshVersion = refreshSerial;
        try {
          const next = await api.project(id);
          if (!cancelled && project?.id === id && serial === observationSerial && refreshVersion === refreshSerial && project.contentRevision === revision && !busy && !eventRefreshRunning) {
            project = next;
          }
        } catch {
          if (!cancelled && project?.id === id && serial === observationSerial && refreshVersion === refreshSerial && project.contentRevision === revision) { snapshotStale = true; queueRefresh(); }
        }
      }
      if (!cancelled) timer = setTimeout(() => void observe(), 3000);
    }
    if (id && enabled) timer = setTimeout(() => void observe(), 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  });
  function connectEvents() {
    stopEvents?.();
    stopEvents = subscribeEvents(eventReceived, connected => { connection = connected ? 'connected' : 'disconnected'; if (connected) queueRefresh(); }, async () => { workerSteps = {}; await refresh(); });
  }
  async function openProject(id: string, checkDraft = true, writeHistory = true, savedDraft?: ResearchProject) {
    if (checkDraft && !canLeaveDraft()) return false;
    rememberRefinement();
    const version = ++selectionSerial;
    ++documentSerial; ++refreshSerial;
    loading = true; snapshotStale = true; error = ''; screen = 'research'; registerPage('research'); closeNavigation(); hypothesisExpanded = true; outlineLocation = 'hypothesis'; outlineTarget = '';
    selectedPageId = undefined;
    project = undefined; inheritedContext = undefined; documents = []; commands = []; commandHistory = []; document = undefined; draft = ''; pdfData = undefined; selectedEntry = undefined; workspaceTabs=workspaceTabs.filter(p=>p!=='document');
    documentLoading = false;
    try {
      const [session, listing, journal, workspace, lineage] = await Promise.allSettled([api.project(id), api.documents(id), api.commandHistory(id), api.bootstrap(), api.forkContext(id)]);
      if (disposed || version !== selectionSerial) return false;
      if (workspace.status === 'fulfilled') bootstrap = workspace.value;
      const unavailable = bootstrap?.unavailableProjects?.find(item => item.id === id);
      if (unavailable) throw new Error(`Session ${unavailable.id} is unavailable. ${unavailable.message}`);
      if (session.status === 'rejected') throw session.reason;
      if (listing.status === 'rejected') throw listing.reason;
      if (journal.status === 'rejected') throw journal.reason;
      if (workspace.status === 'rejected') throw workspace.reason;
      if (lineage.status === 'rejected') throw lineage.reason;
      const next = session.value, docs = listing.value, queue = journal.value;
      project = next; inheritedContext = lineage.value; documents = docs.documents; commandHistory = queue; commands = queue.filter(item => !next.processedCommandIds.includes(item.id)); document = undefined; draft = ''; pdfData = undefined; selectedEntry = undefined; workspaceTabs=workspaceTabs.filter(p=>p!=='document');
      snapshotStale = false; refreshFailures = 0; sourceChanged = false; historicalRevision = ''; workerSteps = {}; refinement = refinementDrafts.get(id) || ''; noteOpen = false; grantOpen = false;
      if (writeHistory && window.location.hash !== `#${encodeURIComponent(id)}`) window.history.pushState(null, '', `#${encodeURIComponent(id)}`);
      return true;
    } catch (cause) {
      if (version === selectionSerial) {
        error = cause instanceof Error ? cause.message : 'Unable to open project.';
        queueRefresh();
        if (savedDraft && savedDraft.id === id) {
          project = savedDraft; refinement = refinementDrafts.get(id) || ''; snapshotStale = true;
          window.history.replaceState(null, '', `#${encodeURIComponent(id)}`);
          notice = 'Draft saved. Loading was interrupted; refresh before starting. Pending attachments are retained.';
        }
      }
      return false;
    }
    finally { if (version === selectionSerial) loading = false; }
  }
  async function init() {
    loading = true; error = '';
    try {
      bootstrap = await api.bootstrap();
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && bootstrap.projects.some(item => item.id === id)) await openProject(id, false, false);
      else if (id) {
        const unavailable = bootstrap.unavailableProjects?.find(item => item.id === id);
        if (unavailable) error = `Session ${unavailable.id} is unavailable. ${unavailable.message}`;
      }

      connectEvents();
    } catch { error = 'Could not connect to the local CAgE backend. Start it, then reconnect.'; connection = 'disconnected'; }
    finally { loading = false; }
  }
  onMount(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const resize = () => { smallScreen = media.matches; if(smallScreen){sidebarOpen=false;treeOpen=false;} };
    resize();
    media.addEventListener('change', resize);
    void init();
    const historyChanged = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id === project?.id) return;
      if (!canLeaveDraft()) { if (project) window.history.pushState(null, '', `#${encodeURIComponent(project.id)}`); return; }
      if (id) void openProject(id, false, false);
      else { rememberRefinement(); ++selectionSerial; ++documentSerial; ++refreshSerial; project = undefined; inheritedContext = undefined; document = undefined; selectedEntry = undefined; workspaceTabs=workspaceTabs.filter(p=>p!=='document'); draft = ''; documents = []; commands = []; commandHistory = []; pdfData = undefined; screen = 'research'; registerPage('research'); selectedPageId = undefined; loading = false; documentLoading = false; refreshFailures = 0; if (snapshotStale) void refresh().catch(() => {}); }
    };
    window.addEventListener('popstate', historyChanged);
    return () => { disposed = true; media.removeEventListener('change', resize); stopEvents?.(); if (refreshTimer) clearTimeout(refreshTimer); window.removeEventListener('popstate', historyChanged); };
  });
  function navigate(next: Screen) {
    if (screen === 'document' && !canLeaveDraft()) return;
    if (dirty) { draft = document!.content; sourceChanged = false; }
    if (screen === 'research') researchScrollTop = transcript?.scrollTop || 0;
    screen = next; registerPage(next); error = '';
    if (next === 'research') void tick().then(() => transcript?.scrollTo({ top: researchScrollTop }));
    if (next === 'settings') void refresh().catch(() => { /* refresh owns snapshot health and recovery. */ });
  }
  function openCapability(view: CapabilityView) {

    const canonical = canonicalCapabilityView(view);
    navigate(canonical);
    if (screen !== canonical) return;
    closeNavigation();
  }
  function closePage(page:Page){
    const open=workspaceTabs.filter(p=>p!=='document'||selectedEntry);
    const remaining=open.filter(p=>p!==page);
    if(!remaining.length){
      if(busy)return;
      home();
      if(!project && screen==='research')workspaceTabs=['research'];
      return;
    }
    if(pageFor(screen)===page){
      const next=remaining[Math.max(0,open.indexOf(page)-1)]!;
      navigate(next);
      if(pageFor(screen)!==next)return;
    }
    workspaceTabs=remaining;
  }
  function home() {
    if (busy || !canLeaveDraft()) return;
    rememberRefinement();
    ++selectionSerial; ++documentSerial; ++refreshSerial;
    selectedPageId = undefined;
    project = undefined; inheritedContext = undefined; documents = []; commands = []; commandHistory = []; document = undefined; selectedEntry = undefined; workspaceTabs=workspaceTabs.filter(p=>p!=='document');
    draft = ''; pdfData = undefined; screen = 'research'; registerPage('research'); loading = false; documentLoading = false; refreshFailures = 0; if (snapshotStale) void refresh().catch(() => {}); closeNavigation(); hypothesisExpanded = true; outlineLocation = 'hypothesis'; outlineTarget = '';
    window.history.pushState(null, '', window.location.pathname);
  }
  async function importStagedFiles(id: string) {
    const isCurrent = captureView();
    // Only remove a file after its upload is acknowledged. Each session owns its retry list.
    for (const file of [...(sessionFiles[id] || [])]) {
      const updated = await api.importSource(id, file);
      sessionFiles[id] = (sessionFiles[id] || []).filter(item => item !== file);
      if (isCurrent() && project?.id === id) project = updated;
    }
  }
  async function retryAttachments() {
    if (!project || active) return;
    const id = project.id, isCurrent = captureView();
    await run(async () => { await importStagedFiles(id); await refresh(); }, isCurrent);
  }
  async function startResearch() {
    if (!project || active || !workspaceReady || (!recoveryPending && !modelReady)) return;
    if (!$developerMode && researchModeLocked(project) && (project.schemaVersion !== 3 || !['3.0','4.0'].includes(project.researchLoopVersion))) return;
    const migrateRevision = !$developerMode && !researchModeLocked(project) && project.researchLoopVersion!==DEFAULT_RESEARCH_MODE ? project.contentRevision : undefined;
    const id = project.id, recoverOnly = recoveryPending, isCurrent = captureView();
    await run(async () => {
      if (recoverOnly) {
        const recovered = await api.start(id, true);
        if (isCurrent() && project?.id === id) project = recovered;
        await refresh(); return;
      }
      if(migrateRevision)await api.selectResearchMode(id,DEFAULT_RESEARCH_MODE,migrateRevision);
      await importStagedFiles(id);
      const started = await api.start(id);
      if (isCurrent() && project?.id === id) project = started;
      await refresh();
    }, isCurrent);
  }
  function removeStagedFile(index: number) {
    if (busy) return;
    if (project) sessionFiles[project.id] = (sessionFiles[project.id] || []).filter((_, i) => i !== index);
    else homeFiles = homeFiles.filter((_, i) => i !== index);
  }
  function openModelSettings() { navigate('settings'); }
  async function backToComposer() {
    navigate('research');
    await tick(); composer?.focusInput();
  }
  async function openMonitor(showHistory = false) {
    inspectorView = 'monitor'; treeOpen = true;
    if (smallScreen) sidebarOpen = false;
    await tick();
    if (showHistory) modifiedHistory?.reveal();
  }
  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!workspaceReady || busy) return;
    if (!project) {
      if (!hypothesis.trim()) return;
      const submitted = hypothesis, submittedName = projectName, mode = $developerMode ? draftMode : DEFAULT_RESEARCH_MODE;
      const files = [...homeFiles], shouldStart = modelReady, submittedSelection = selectionSerial;
      await run(async () => {
        const created = await api.createProject(submittedName.trim() || 'New research', submitted.trim(), mode);
        sessionFiles[created.id] = files;
        homeFiles = homeFiles.filter(file => !files.includes(file));
        // Persisted draft owns the text/files once creation succeeds, including hydration failures.
        if (projectName === submittedName) projectName = '';
        if (hypothesis === submitted) hypothesis = '';
        if (selectionSerial !== submittedSelection) { await refresh(); notice = 'Draft saved in History. Research has not started.'; return; }
        const loaded = await openProject(created.id, false, true, created);
        if (!loaded) return;
        const isCurrent = captureView();
        await importStagedFiles(created.id);
        if (!isCurrent()) { await refresh(); return; }
        if (shouldStart && isResearchModelReady(bootstrap)) {
          const started = await api.start(created.id);
          if (isCurrent() && project?.id === created.id) project = started;
        } else notice = 'Draft saved. Connect a model when you are ready.';
        await refresh();
      });
    } else {
      if (!refinement.trim()) return;
      await run(async () => {
        const id = project!.id, submitted = refinement;
        await queueUserCommand(id, 'refine', project!.researchLoopVersion === '4.0' ? submitted : submitted.trim(), 'hypothesis');
        if (project?.id === id && refinement === submitted) refinement = '';
        if (refinementDrafts.get(id) === submitted) refinementDrafts.delete(id);
        await refresh();
      });
    }
  }
  async function openDocument(path: string, revision?: string) {
    if (!project || !canLeaveDraft()) return;
    const id = project.id;
    const version = ++documentSerial;
    const entry = documents.find(item => item.path === path) || { path, title: path, kind: 'markdown' as const };
    selectedEntry = entry; historicalRevision = revision || ''; screen = 'document'; registerPage('document'); documentLoading = true; error = ''; document = undefined; draft = ''; pdfData = undefined; sourceChanged = false;
    try {
      if (entry.kind === 'pdf') {
        if (!entry.sourceId) throw new Error('This PDF is missing a source reference.');
        const bytes = await api.pdf(id, entry.sourceId);
        if (version === documentSerial && id === project?.id) pdfData = bytes;
      } else {
        const content = await api.document(id, path, revision);
        if (version === documentSerial && id === project?.id) { document = content; draft = content.content; preview = !!revision; }
      }
    } catch (cause) { if (version === documentSerial) error = cause instanceof Error ? cause.message : 'Unable to open document.'; }
    finally { if (version === documentSerial) documentLoading = false; }
  }
  async function saveDocument() {
    if (!project || !document || immutableDocument) return;
    const id = project.id, path = document.path, text = draft, revision = document.revision, isCurrent = captureView();
    await run(async () => {
      const committed = await api.saveDocument(id, path, text, revision);
      if (isCurrent() && document?.path === path) { document = { ...document, content: text, revision: committed.contentRevision }; sourceChanged = false; }
      await refresh();
      if (!isCurrent()) return;
      const saved = await api.document(id, path);
      if (!isCurrent()) return;
      if (draft === text) { document = saved; draft = saved.content; sourceChanged = false; }
      else if (saved.content === text) { document = saved; sourceChanged = false; }
      else sourceChanged = true;
      notice = 'Saved a new revision. Dependent research is marked for review when its premises change.';
    }, isCurrent);
  }
  async function submitCommand(kind: UserCommand['kind'], text = '') {
    if (!project || controlBusy) return;
    const id = project.id;
    controlBusy = true;
    try {
      await queueUserCommand(id, kind, text);
      const queue = await api.commands(id);
      if (project?.id === id) {
        commands = queue;
        notice = kind === 'stop' ? 'Finishing active work, then saving and stopping.' : kind === 'pause' ? `Pausing after this ${boundary}.` : `Queued for the next ${boundary}.`;
      }
    } catch (cause) { if (project?.id === id) error = cause instanceof Error ? cause.message : 'Request not confirmed. Refresh to check the current state.'; }
    finally { controlBusy = false; }
  }
  async function submitAnnotation(event: SubmitEvent) {
    event.preventDefault();
    if (!project) return;
    const key = annotationKey, text = annotations[key] || '', id = project.id, path = selectedEntry?.path;
    if (!text.trim()) return;
    const body = project.researchLoopVersion === '4.0' ? text : text.trim();
    await run(async () => {
      await queueUserCommand(id, 'refine', `Annotation on ${path || 'document'}:\n${body}`, 'annotation');
      if (annotations[key] === text) delete annotations[key];
      await refresh();
    });
  }
  async function acceptProposal(proposalId: string) {
    if (!project || busy) throw new Error('Wait for the current operation to finish.');
    const id = project.id, revision = project.contentRevision;
    busy = true;
    try {
      await api.acceptReconstruction(id, proposalId, revision);
      const queue = await api.commands(id);
      if (project?.id === id) commands = queue;
      await refresh();
      notice = 'Hypothesis acceptance queued for a safe Epoch boundary. Start research when idle to apply it before the next Epoch.';
    } finally { busy = false; }
  }
  async function importFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files || []); input.value = '';
    if (!files.length || busy || active) return;
    const result = stageComposerFiles(stagedFiles, files);
    if (result.errors.length) error = result.errors.join(' ');
    if (!project) { homeFiles = result.files; return; }
    const id = project.id;
    sessionFiles[id] = result.files;
    await run(async () => { await importStagedFiles(id); await refresh(); });
    if (result.errors.length) error = [error, ...result.errors].filter(Boolean).join(' ');
  }
  async function grantSource(event: SubmitEvent) {
    event.preventDefault();
    if (!project || !grantConsent) return;
    const id = project.id, path = externalPath, isCurrent = captureView();
    await run(async () => {
      await api.grantSource(id, path.trim()); await refresh();
      if (!isCurrent()) return;
      if (externalPath === path) { externalPath = ''; grantConsent = false; grantOpen = false; }
      notice = 'External file authorized for read-only research access.';
    }, isCurrent);
  }
  async function createNote(event: SubmitEvent) {
    event.preventDefault();
    if (!project) return;
    const id = project.id, revision = project.contentRevision, submittedName = noteName, isCurrent = captureView();
    const name = submittedName.trim().replace(/\.md$/i, '');
    if (!/^[\p{L}\p{N} _-]+$/u.test(name)) { error = 'Use letters, numbers, spaces, dashes, or underscores for the note name.'; return; }
    const path = `notes/${name}.md`;
    if (documents.some(item => item.path === path)) { error = 'A note with this name already exists. Choose a different name or open the existing note.'; return; }
    await run(async () => {
      await api.saveDocument(id, path, `# ${name}\n`, revision); await refresh();
      if (!isCurrent() || noteName !== submittedName) return;
      noteName = ''; noteOpen = false; await openDocument(path);
    }, isCurrent);
  }
  function openDialog(node: HTMLDialogElement) { node.showModal(); return { destroy() { node.close(); } }; }
  async function editableCopy() {
    if (!project || !document) return;
    const id = project.id, revision = project.contentRevision, content = document.content, isCurrent = captureView();
    const base = (selectedEntry?.title || 'Source notes').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '_') || 'Source notes';
    let path = `notes/${base}-copy.md`;
    for (let count = 2; documents.some(item => item.path === path); count++) path = `notes/${base}-copy-${count}.md`;
    await run(async () => {
      await api.saveDocument(id, path, content, revision); await refresh();
      if (!isCurrent()) return;
      notice = 'Editable project copy created. The original source stays read-only.';
      await openDocument(path);
    }, isCurrent);
  }
  async function showExit() {
    if (!canLeaveDraft()) return;
    await run(async () => { bootstrap = await api.bootstrap(); exitOpen = true; });
  }
  async function sessionAction(id: string, action: 'archive' | 'restore' | 'export' | 'delete') {
    if (busy) return;
    if (action === 'export') {
      if (project?.id !== id && !await openProject(id)) return;
      if (project?.id === id) exportProjectId = id;
      return;
    }
    if (action === 'delete') {
      error = '';
      const target = bootstrap?.projects.find(item => item.id === id);
      if (target) deleteTarget = { id, name: target.name };
      return;
    }
    await changeSessionState(id, action === 'restore' ? 'active' : 'archived');
  }
  async function changeSessionState(id: string, state: 'active' | 'archived' | 'deleted') {
    const leaving = project?.id === id && state !== 'active';
    if (leaving && !canLeaveDraft()) return;
    let changed = false;
    await run(async () => {
      await api.setSessionState(id, state);
      changed = true; deleteTarget = undefined;
      bootstrap = await api.bootstrap();
    });
    if (changed && leaving && project?.id === id) {
      if (document) draft = document.content;
      home();
    }
  }
  async function exit(mode: 'background' | 'shutdown') {
    await run(async () => {
      const result = await api.exit(mode); exitState = result.status; exitOpen = false;
      if (bootstrap) bootstrap.activeProjectIds = result.activeProjectIds;
      if (mode === 'background' || result.status === 'closed') stopEvents?.();
    });
  }

  function closeNavigation() { if (smallScreen && sidebarOpen) closePanel('left'); }
  function closePanel(side: 'left' | 'right') {
    if (side === 'left') sidebarOpen = false;
    else treeOpen = false;
    void tick().then(() => window.document.querySelector<HTMLButtonElement>(side === 'left' ? '.sidebar-toggle' : '.inspector-toggle')?.focus());
  }
  async function toggleNavigation() {
    sidebarOpen = !sidebarOpen;
    if (smallScreen && sidebarOpen) {
      treeOpen = false;
      await tick();
      requestAnimationFrame(() => { if (sidebarOpen) window.document.querySelector<HTMLButtonElement>('#workspace-sidebar .brand-home')?.focus({ preventScroll: true }); });
    }
  }
  async function toggleInspector() {
    treeOpen = !treeOpen;
    if (smallScreen) {
      sidebarOpen = false;
      await tick();
      requestAnimationFrame(() => { if (rightShown) window.document.querySelector<HTMLElement>('#workspace-inspector button')?.focus({ preventScroll: true }); });
    }
  }
  function panelKeyboard(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || window.document.querySelector('dialog[open]')) return;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) && transcript?.contains(event.target as Node)) outlineTarget = '';
    if (!smallScreen || !(sidebarOpen || rightShown) || exitOpen) return;
    const side = sidebarOpen ? 'left' : 'right';
    if (event.key === 'Escape') { event.preventDefault(); closePanel(side); return; }
    // These are non-modal panels: native Tab order includes the persistent topbar.
    // Only the covered workspace body is inert; Escape returns to its toggle.
  }
  function trackHypothesis() {
    // Keep the disclosure state stable while scrolling.
    if (!transcript || screen !== 'research') return;
    let location = 'hypothesis';
    const readingLine = transcript.getBoundingClientRect().top + (hypothesisBlock?.getBoundingClientRect().height || 0) + 20;
    for (const section of transcript.querySelectorAll<HTMLElement>('.paper-section')) {
      if (section.getBoundingClientRect().top > readingLine) break;
      const article = section.closest<HTMLElement>('[data-outline-id]');
      const name = Array.from(section.classList).find(value => value.startsWith('paper-') && value !== 'paper-section')?.slice(6);
      if (article && name) location = `${article.dataset.outlineId}:${name}`;
    }
    outlineLocation = outlineTarget || location;
  }
  function watchReadingArea(node: HTMLElement) {
    const observer = new ResizeObserver(trackHypothesis);
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }
  async function openSection(id: string, section?: string) {
    if (id !== 'hypothesis' && pages.some(page => page.id === id)) selectedPageId = id === pages.at(-1)?.id ? undefined : id;
    navigate('research');
    if (screen !== 'research') return;
    closeNavigation(); await tick();
    outlineTarget = section ? `${id}:${section}` : id;
    outlineLocation = outlineTarget;
    const article = Array.from(transcript?.querySelectorAll<HTMLElement>('[data-outline-id]') || []).find(el => el.dataset.outlineId === id);
    const target = section ? article?.querySelector<HTMLElement>(`.paper-${section}`) : article;
    if (target && transcript) {
      const disclosure = target.matches('details') ? target as HTMLDetailsElement : target.querySelector<HTMLDetailsElement>('details');
      if (disclosure) disclosure.open = true;
      for (let ancestor = target.parentElement; ancestor && ancestor !== transcript; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
      await tick();
      const offset = id === 'hypothesis' ? 0 : (hypothesisBlock?.getBoundingClientRect().height || 0) + 20;
      const top = id === 'hypothesis' ? 0 : transcript.scrollTop + target.getBoundingClientRect().top - transcript.getBoundingClientRect().top - offset;
      transcript.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }
  async function forkSelectedPage(selection: ResponseSelection) {
    if (active || busy || !workspaceReady) return;
    const id = selection.projectId, checkpoint = selection.pageId, revision = selection.revision, isCurrent = captureView();
    const key = `${id}:${checkpoint}:${revision}`;
    const operationId = forkOperations.get(key) || `fork_${crypto.randomUUID().replaceAll('-', '_')}`;
    forkOperations.set(key, operationId);
    await run(async () => {
      const child = await api.forkProject(id, checkpoint, revision, operationId);
      forkOperations.delete(key);
      if (!isCurrent()) { await refresh(); return; }
      const loaded = await openProject(child.id, false);
      if (loaded) notice = 'Branch created. Prior saved context is read-only; new work stays in this session.';
    }, isCurrent);
  }
  async function choosePage(id?: string) {
    selectedPageId = id; outlineLocation = 'hypothesis'; outlineTarget = ''; hypothesisExpanded = true;
    await tick(); transcript?.scrollTo({ top: 0 });
  }
  async function renameCurrentSession(name:string){
    if(!project)return;
    const {id,contentRevision}=project,isCurrent=captureView();
    const updated=await api.rename(id,name,contentRevision);
    if(isCurrent() && project?.id===id)project=updated;
    await refresh();
  }
  async function saveQuickModel(model: NonNullable<Bootstrap['preferences']['defaultModel']>,role:'theorist'|'moderator'='theorist') {
    if (!bootstrap) return;
    const mode=researchModes.find(m=>m.version===project?.researchLoopVersion)?.version??($developerMode?draftMode:DEFAULT_RESEARCH_MODE);
    const config=bootstrap.researchDefaults[mode];
    await api.preferences({...bootstrap.preferences,...(role==='theorist'?{defaultModel:model}:{}),researchDefaults:{...bootstrap.preferences.researchDefaults,[mode]:{...config,roleModels:{...config.roleModels,[role]:model}}}});
    await refresh();
  }
  async function openDirection(id: string, path?: string) {
    closeNavigation();
    if (path) { await openDocument(path); return; }
    inspectorView = 'research'; treeOpen = true; await tick();
    const button = Array.from(window.document.querySelectorAll<HTMLButtonElement>('[data-node-id]')).find(el => el.dataset.nodeId === id);
    if (button) { button.focus(); if (button.getAttribute('aria-expanded') !== 'true') button.click(); }
  }
</script>
<svelte:window onkeydown={panelKeyboard} onpointerdown={event => { if (transcript?.contains(event.target as Node)) outlineTarget = ''; }} />
{#snippet outline()}
{#if project}{#key project.id}<SessionOutline checkpoints={pages} summary={project.summary} nodes={project.schemaVersion === 4 || project.schemaVersion === 3 ? [] : project.graph} active={outlineLocation} onsection={openSection} onnode={openDirection} originalPages={project.schemaVersion === 3 && (project.researchLoopVersion === '3.0' || !!optionalOriginal)} displayed={selectedPage ? { id: selectedPage.id, content: optionalOriginal ? displayedOriginal?.content : selectedPage.content } : undefined} />{/key}{/if}
{/snippet}
{#snippet researchComposer()}
  <ResearchComposer {draftMode} onmode={chooseMode} bind:this={composer} {project} {bootstrap} {active} {busy} {recoveryPending} connected={workspaceReady} bind:hypothesis bind:refinement bind:projectName onsubmit={send} onstart={startResearch} onattach={() => importInput?.click()} onmodel={saveQuickModel} onsettings={openModelSettings} {stagedFiles} onremovefile={removeStagedFile} onretryfiles={retryAttachments} {queuedCount} onqueuehistory={() => openMonitor(true)} {modelReady} />
{/snippet}
{#snippet runningControls()}<button class="icon-button" type="button" aria-label={`Pause after ${boundary}`} title={`Pause after ${boundary}`} disabled={controlBusy || pendingPause || pendingStop} onclick={() => submitCommand('pause')}><Icon name="pause" /></button><button class="icon-button stop-button" type="button" aria-label={pendingStop ? 'Stop queued' : 'Graceful stop'} title="Finish active work and stop" disabled={controlBusy || pendingStop} onclick={() => submitCommand('stop')}><Icon name="stop" size={16} /></button>{/snippet}
<input class="visually-hidden" tabindex="-1" aria-label="Attach source files" bind:this={importInput} type="file" accept={COMPOSER_SOURCE_ACCEPT} multiple onchange={importFiles} />
<svelte:head><title>{project ? `${project.name} · CAgE` : 'Carnot Agent Engine'}</title></svelte:head>
{#if exitState}
  <main class="exit-screen"><p class="wordmark">CAgE</p><h1>{exitState === 'kept' ? 'Research continues in the background' : exitState === 'closed' ? 'Workspace closed' : 'Saving research…'}</h1><p>Your saved projects stay on this computer.</p>{#if exitState === 'kept'}<button onclick={() => { exitState = undefined; void init(); }}>Return to workspace</button>{/if}</main>
{:else}
<div class="app-shell" use:resizeSidebars={{ left: sidebarOpen, right: rightShown }} style="--topbar-height:44px" class:is-home={!project && screen === 'research'} class:left-open={sidebarOpen} class:right-open={rightShown}>
  {#if !smallScreen && sidebarOpen}<ResizeHandle side="left" />{/if}
  {#if !smallScreen && rightShown}<ResizeHandle side="right" />{/if}
  <div class="workspace-art" aria-hidden="true"><StartPageBackdrop themeId={$currentTheme.id} /></div>
  <aside id="workspace-sidebar" class={`sidebar min-[901px]:relative bg-linear-to-b ${startPageArtwork($currentTheme.id).sidebarClass} ring-1 ring-line/40 [@media(max-width:900px)]:top-[var(--topbar-height)] [&_nav_button]:text-xs [&_summary]:text-xs [&_nav_.chosen]:bg-selected [&_nav_.chosen]:text-accent [&_nav_.chosen]:font-semibold`} class:sidebar-open={sidebarOpen} inert={!sidebarOpen} aria-label="Workspace navigation">
    <div class="brand"><button class="brand-home gap-2.5" onclick={home} aria-label="CAgE home" disabled={busy}><BrandMark size={28} /><NavigationWordmark decorative /></button></div>
    <button class="nav-action new-project bg-surface/90 border-line/60 text-control" onclick={home} disabled={busy || !bootstrap}><Icon name="plus" />New research</button>
    <button class="nav-action" class:chosen={screen === 'maintenance'} onclick={() => { navigate('maintenance'); closeNavigation(); }}><Icon name="settings" size={17} />Maintenance Assistant</button>
    <div class="cages-row"><button class="nav-action" class:chosen={screen==='knowledge'} onclick={()=>openCapability('knowledge')}><Icon name="tree" size={17}/>cages</button>
      <button class="map-switch" role="switch" aria-label="Knowledge map" aria-checked={mapOpen} onclick={()=>{openCapability('knowledge');if(screen==='knowledge')mapOpen=!mapOpen}}><span>Skill</span><span>Knowledge</span></button></div>
    <label class="search-field"><Icon name="search" size={15} /><input aria-label="Search projects" bind:value={search} placeholder="Search history" /></label>
    <div class={`sidebar-sections ${hiddenSidebarScrollbar}`}><details class="contents-nav disclosure-list" open><summary ondragover={e=>{if(e.dataTransfer?.types.includes('application/x-carnot-session'))e.preventDefault()}} ondrop={startGroup}>Contents</summary>
      {#if groupingSession}<form class="new-group" onsubmit={async e=>{e.preventDefault();if(newGroup.trim()){const id=groupingSession;groupingSession='';await moveSession(id,newGroup.trim())}}}>
        <input aria-label="New group name" placeholder="Group name" maxlength="80" required bind:value={newGroup}/>
        <button type="submit">Move</button><button type="button" aria-label="Cancel grouping" onclick={()=>groupingSession=''}>×</button>
      </form>{/if}
      {#each [...sessionGroups,''] as group (group)}
        {@const members=(bootstrap?.projects??[]).filter(p=>(p.group??'')===group)}
        <details class="session-group" open={!!search.trim() && members.some(p=>p.name.toLowerCase().includes(search.trim().toLowerCase()))} ondragover={e=>{if(e.dataTransfer?.types.includes('application/x-carnot-session'))e.preventDefault()}} ondrop={e=>dropSession(e,group)}>
          <summary>{group||'Unclassified'} <span class="count">{members.length}</span></summary>
          <SessionHistory {outline} projects={members} catalog={bootstrap?.projects} groups={sessionGroups} onmove={moveSession} selectedId={project?.id} {search} busy={busy||!workspaceReady} onselect={id=>{void openProject(id)}} onaction={sessionAction}/>
        </details>
      {/each}
    </details>
    <details class="sidebar-projects disclosure-list" open><summary>History <span class="count">{(bootstrap?.projects??[]).filter(p=>!p.group).length+(bootstrap?.unavailableProjects?.length??0)}</span></summary>
      <SessionHistory projects={(bootstrap?.projects??[]).filter(p=>!p.group)} catalog={bootstrap?.projects} groups={sessionGroups} onmove={moveSession} unavailableProjects={bootstrap?.unavailableProjects??[]} selectedId={project?.id} {search} busy={busy||!workspaceReady} onselect={id=>{void openProject(id)}} onaction={sessionAction}/>
    </details>

    {#if project}
      <details class="document-nav disclosure-list bg-surface/45" open><summary>Files</summary>
        <div class="section-heading"><div class="inline-actions"><button class="icon-button" aria-label="Import files" title="Import Markdown / PDF" disabled={active || busy} onclick={() => importInput?.click()}><Icon name="upload" size={15} /></button><button class="icon-button" aria-label="Create Markdown note" title="New note" disabled={active || busy} onclick={() => noteOpen = !noteOpen}><Icon name="plus" size={15} /></button><button class="icon-button" aria-label="Authorize external file" title="Link a read-only source" disabled={active || busy} onclick={() => { grantOpen = !grantOpen; grantConsent = false; }}><Icon name="link" size={15} /></button></div></div>
        {#if noteOpen}<form class="compact-form" onsubmit={createNote}><label>Note name<input bind:value={noteName} required /></label><button disabled={busy || !noteName.trim()}>Create note</button></form>{/if}
        {#if grantOpen}<form class="compact-form" onsubmit={grantSource}><label>Full file path<input bind:value={externalPath} required /></label><label class="check-label"><input type="checkbox" bind:checked={grantConsent} />Allow project agents to read this file.</label><button disabled={busy || !grantConsent || !externalPath.trim()}>Authorize</button></form>{/if}
        <nav aria-label="Project documents">{#each documents as entry (entry.path)}<button class:chosen={screen === 'document' && selectedEntry?.path === entry.path} onclick={() => { closeNavigation(); void openDocument(entry.path); }} title={entry.path}><Icon name="file" size={15} /><span class="truncate">{entry.title || entry.path}</span>{#if entry.kind === 'pdf'}<span class="file-kind">PDF</span>{/if}</button>{/each}</nav>

      </details>
    {:else}<details class="document-nav disclosure-list bg-surface/45"><summary>Files</summary><p class="sidebar-empty">No files</p></details>{/if}
    </div>
    <footer class="sidebar-footer"><button class="nav-action" class:chosen={screen === 'settings'} onclick={() => { navigate('settings'); closeNavigation(); }}><Icon name="settings" />Settings</button><div class="backend-state"><span class={`connection-dot ${connection}`}></span><span>{connection === 'connected' ? (snapshotStale ? 'Refreshing workspace…' : 'Local workspace') : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span><button class="icon-button" aria-label="Exit CAgE" title="Exit CAgE" onclick={showExit} disabled={busy || !bootstrap}><Icon name="power" size={15} /></button></div></footer>
  </aside>
  <main class={`main-pane ${sessionView ? '[@media(min-width:901px)]:mx-1' : ''}`}>
    <header class="topbar h-[var(--topbar-height)] gap-2 bg-canvas/80 px-3 [&_.inline-actions]:gap-1 [@media(max-width:900px)]:relative [@media(max-width:900px)]:z-30"><div class="inline-actions"><button class="icon-button sidebar-toggle" aria-label="Toggle sidebar" title="Toggle sidebar" aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onclick={toggleNavigation}><Icon name="panel" /></button>{#if screen !== "research"}<button class="icon-button" aria-label="Back to conversation" title="Back to conversation" onclick={backToComposer}><Icon name="back" /></button>{/if}<WorkspaceTabs tabs={workspaceTabs} active={pageFor(screen)} researchTitle={project?.name||'New session'} documentTitle={selectedEntry?.title||'Document'} onrename={project?renameCurrentSession:undefined} renameDisabled={active||busy||!workspaceReady} onselect={navigate} onclose={closePage}/></div><div class="inline-actions">{#if project && (screen === 'research' || screen === 'document')}<button class="icon-button inspector-toggle" class:chosen={rightShown} aria-label="Toggle research tree" title="Research tree" aria-controls="workspace-inspector" aria-expanded={rightShown} onclick={toggleInspector}><Icon name="panelRight" /></button>{/if}{#if project && active && screen !== 'maintenance'}<div class="run-controls" aria-label="Running research controls">{@render runningControls()}</div>{/if}</div></header>
    <div class="flex min-h-0 flex-1 flex-col" inert={smallScreen && (sidebarOpen || rightShown)}>

    {#if bootstrap}<LearningStatus compact onstate={tasks => learningTasks = tasks} />{/if}
    {#if error}<div class="notice error" role="alert">{error}<button class="icon-button" aria-label="Dismiss error" onclick={() => error = ''}><Icon name="close" size={15} /></button>{#if !bootstrap}<button onclick={init}>Reconnect</button>{/if}</div>{/if}
    {#if notice && $showNotices}<div class="notice success" role="status">{notice}<button class="icon-button" aria-label="Dismiss notification" onclick={() => notice = ''}><Icon name="close" size={15} /></button></div>{/if}
    <div class={`main-scroll ${sessionView ? sessionScrollbar : ''} ${project && screen === 'research' ? '[scrollbar-gutter:stable] flex flex-col px-1 pb-0' : ''}`} class:chat-scroll={screen === 'research'} bind:this={transcript} use:watchReadingArea onscroll={trackHypothesis} onwheel={() => outlineTarget = ''}>
      {#if loading}<p class="loading-message" role="status">Opening workspace…</p>
      {:else if screen === 'maintenance' && bootstrap}<MaintenancePage {bootstrap} onsettings={openModelSettings} onmodel={async model=>{if(bootstrap){await api.preferences({...bootstrap.preferences,maintenanceModel:model});await refresh()}}}/>
      {:else if screen === 'settings' && bootstrap}<SystemSettings {bootstrap} onchange={refresh} />
      {:else if screen === 'knowledge' || screen === 'fast' || screen === 'slow'}{#key `knowledge:${project?.id || ''}`}{#if mapOpen}<KnowledgeCanvas/>{:else}<CapabilitiesPage projects={bootstrap?.projects??[]} kind="knowledge" projectId={project?.id} onchange={refresh} />{/if}{/key}
      {:else if !project}
        <HypothesisEntry {hypothesis} showSubtitle={true}>{@render researchComposer()}</HypothesisEntry>
      {:else if project && screen === 'document'}
        <section class="document-panel"><div class="section-heading"><div><p class="eyebrow">Project document</p><h2>{selectedEntry?.title || selectedEntry?.path}</h2></div>{#if document}<button onclick={() => preview = !preview}>{preview ? (immutableDocument ? 'View source' : 'Show editor') : 'Preview'}</button>{/if}</div>
          {#if documentLoading}<p role="status">Loading document…</p>{:else if pdfData && selectedEntry}{#key selectedEntry.path}{#await import('./PdfView.svelte')}<p role="status">Loading PDF viewer…</p>{:then module}<module.default data={pdfData} name={selectedEntry.title} />{:catch}<p class="notice error">The PDF viewer could not be loaded.</p>{/await}{/key}
          {:else if document}
            <p class="document-meta">{historicalRevision ? 'Historical source revision' : 'Revision'} {shortRevision(document.revision)} · {document.path}{dirty ? ' · Unsaved changes' : ''}</p>
            {#if !selectedEntry?.sourceId && inputHistory.length}<label class="revision-picker">Inspect saved source version<select value={historicalRevision} onchange={event => openDocument(document!.path, event.currentTarget.value || undefined)}><option value="">Latest saved version</option>{#each inputHistory as round (round.id)}<option value={round.inputRevision}>{boundary} {round.number} inputs · {shortRevision(round.inputRevision)}</option>{/each}</select></label>{/if}
            {#if historicalRevision}<p class="notice">Historical source content is read-only. A branch created after this revision may not exist in it.</p>{/if}
            {#if immutableDocument}<p class="notice">{document.path === 'hypothesis.md' ? 'Use Modify hypothesis or queue an annotation for the next planning boundary.' : 'Saved Worker results are read-only. Record corrections in notes or queue an annotation.'}</p>{/if}
            {#if selectedEntry?.sourceId}<p class="notice">This imported or authorized source is a frozen, read-only reference. Create a project note copy to edit its content.</p>{/if}
            {#if active}<p class="notice">This {boundary} uses frozen source revisions. Shared text is read-only while research runs. Add an annotation below for the next boundary.</p>{/if}
            {#if sourceChanged}<div class="notice error" role="alert"><p>A newer project revision is available. Your draft is preserved. Copy or review it before reloading; saving with this older revision will be rejected.</p><button onclick={() => openDocument(document!.path)}>Reload saved version…</button></div>{/if}
            {#if preview}<MarkdownView content={draft} />{:else}<MarkdownEditor value={draft} readonly={immutableDocument || active || busy || !!selectedEntry?.sourceId || !!historicalRevision} label={`${document.path} Markdown editor`} onchange={value => draft = value} />{/if}
            <div class="document-actions">{#if selectedEntry?.sourceId}<button disabled={active || busy || !workspaceReady} onclick={editableCopy}>Create editable note copy</button>{:else if !immutableDocument}<button class="primary" disabled={!dirty || active || busy || !!historicalRevision || !workspaceReady} onclick={saveDocument}>Save new revision</button><span class="muted small">Previous revisions are retained.</span>{/if}</div>
          {/if}
          <form class="refinement-form" onsubmit={submitAnnotation}><label>Annotation<textarea value={annotations[annotationKey] || ''} oninput={event => annotations[annotationKey] = event.currentTarget.value} rows="3" placeholder="Annotate this document for the next research cycle."></textarea></label><button disabled={busy || !(annotations[annotationKey] || '').trim() || !workspaceReady}>Queue annotation</button></form>
        </section>

      {:else}

        <div class="conversation w-full max-w-206 flex-[1_0_auto] rounded-t-panel rounded-b-none bg-surface shadow-none px-5 py-7 min-[901px]:px-7" bind:this={readingColumn} aria-label="Research conversation">
          <article class="hypothesis-heading border-0 sticky top-0 z-10 bg-surface pt-2 pb-5 mb-5" data-outline-id="hypothesis" bind:this={hypothesisBlock} use:watchReadingArea><div class="section-heading flex-wrap gap-x-3 gap-y-1 mb-2"><div class="flex min-w-0 flex-wrap items-center gap-2"><h1 class="text-2xl font-normal leading-tight text-accent">Hypothesis</h1><button class="icon-button w-auto! gap-1 px-1.5!" type="button" aria-label="Edit current hypothesis" title={selectedPageId || premiseLoading || premiseError || readingHypothesis !== project.hypothesis ? 'Copy the current hypothesis Markdown/LaTeX source into Modify hypothesis, not the saved premise shown above' : 'Copy the current hypothesis Markdown/LaTeX source into Modify hypothesis'} disabled={busy || !project.hypothesis.trim()} onclick={editCurrentHypothesis}><Icon name="edit" size={16} />{#if selectedPageId}<span class="ml-1 text-xs text-accent">Edit current</span>{/if}</button><span class="loop-badge">V{researchModeLocked(project)?project.researchLoopVersion:DEFAULT_RESEARCH_MODE}</span></div><span class="muted small">{readable(project.status)}</span></div>{#if premiseLoading}<p role="status">Loading saved premise…</p>{:else if premiseError}<p class="notice error" role="alert">{premiseError}</p>{:else}<StickyHypothesis text={readingHypothesis} bind:expanded={hypothesisExpanded} />{/if}</article>
          {#if loopView && (active || selectedPage) && (!selectedPage?.inheritedSessionId || (active && !selectedPageId))}{#key project.id}<LoopActivity {project} commentary={monitorActivity?.projectId===project.id?monitorActivity?.commentary:undefined} view={loopView} number={selectedPageId ? selectedPage?.number : undefined} onmonitor={() => openMonitor()} hasOutput={!!selectedPage && !selectedPage.inheritedSessionId && selectedPage.number === researchNumber && (project.schemaVersion !== 3 || project.researchLoopVersion !== '3.0' || displayedOriginal?.content !== undefined)} />{/key}{/if}
          {#if selectedPage && (project.schemaVersion !== 3 || project.researchLoopVersion !== '3.0' || selectedPage.time || optionalOriginal || selectedPage.inheritedSessionId)}
            <div class="message assistant-message" id="selected-research-output" role="tabpanel" tabindex="0" aria-labelledby={`round-tab-${selectedPage.id}`} data-outline-id={selectedPage.id}>
              <div class="message-label mb-6 flex flex-wrap items-center gap-2"><BrandMark size={22} />CAgE<span class={`epoch-badge outcome-${selectedPage.outcome}`} title={selectedPage.outcomeLabel}>{responseActions.label}<span class="outcome-dot" aria-hidden="true"></span><span class="visually-hidden"> · {selectedPage.outcomeLabel}</span></span><span class="ml-auto"><ResponseActionMenu actions={responseActions} /></span></div>
              {#if selectedPage.inheritedSessionId}<InheritedContextNotice limitations={inheritedContext?.limitations} />{/if}
              {#if selectedPage.interrupted}<div class="checkpoint-notice" role="status"><strong>Synthesis interrupted</strong><span>Saved findings below · no final proof accepted</span></div>
              {:else if selectedPage.outcome === 'partial'}<div class="checkpoint-notice partial"><strong>Partial proof</strong><span>See Restriction for remaining conditions and gaps.</span></div>{/if}
              {#if optionalOriginal}
                <p role="status">{optionalOriginal.label}</p>
                {#if optionalAssessment}<ReportUpdateView update={optionalAssessment} />{/if}{#if optionalRefutation}<ArchivedRefutationView result={optionalRefutation} />{/if}
                {#if optionalBodyLoading}<p role="status">Loading saved original…</p>{:else if optionalBodyError}<p role="alert">{optionalBodyError}</p>{:else}<ResearchPaper content={optionalBody} />{/if}
              {:else}<ResearchPaper content={selectedPage.content} />{/if}
              <div class="message-footer"><span>{selectedPage.time ? new Date(selectedPage.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Saved output'}</span></div>
          <ResponseActions actions={responseActions} />
            </div>
          {/if}

          {#if !selectedPage&&optionalOriginal}<section aria-label="Saved original answer"><p role="status">{optionalOriginal.label}</p>{#if optionalAssessment}<ReportUpdateView update={optionalAssessment} />{/if}{#if optionalRefutation}<ArchivedRefutationView result={optionalRefutation} />{/if}{#if optionalBodyLoading}<p role="status">Loading saved original…</p>{:else if optionalBodyError}<p role="alert">{optionalBodyError}</p>{:else}<ResearchPaper content={optionalBody} />{/if}</section>{/if}
          {#if project.schemaVersion===3&&project.researchLoopVersion==='4.0'}{#key project.id}<KnowledgeUpdates onmaintenance={()=>navigate('maintenance')} onreports={rows=>{reportUpdates=rows;}} projectId={project.id} epochs={project.epochs.map(e=>({id:e.snapshot.id,number:e.snapshot.number}))}/>{/key}{/if}
          {#if project.lastError}<p class="notice error" role="alert">{project.lastError}</p>{/if}
          {#if !active && !recoveryPending && !project.summary && !selectedPage}<div class="start-hint"><BrandMark size={22} /><p>{modelReady ? 'Ready when you are.' : 'Connect a model to begin.'}</p></div>{/if}
          {#if project.schemaVersion === 2 && project.reconstructionProposals?.length}<ReconstructionProposals {project} {commands} disabled={busy || !workspaceReady} onaccept={acceptProposal} />{/if}

        </div>
      {/if}
    </div>
    {#if project && screen === 'research' && !loading}<footer class="reader-dock bg-transparent px-3 pt-0 pb-4"><div class="reader-dock-inner rounded-b-panel bg-surface [&_.composer]:rounded-t-none [&_.composer]:bg-surface [&_.composer]:shadow-none" use:alignReadingColumn={readingColumn}><RoundRibbon {project} {commandHistory} {pages} selected={selectedPage?.id} onselect={choosePage} />{@render researchComposer()}</div></footer>{/if}
    </div>
  </main>
  {#if project}<aside id="workspace-inspector" class={`right-pane min-[901px]:relative bg-linear-to-b ${sessionView && !$currentTheme.dark ? 'from-surface via-surface to-rail' : 'from-rail/95 via-tint/75 to-surface/85'} ${hiddenSidebarScrollbar} ring-1 ring-line/40 [@media(max-width:900px)]:top-[var(--topbar-height)] [&_.graph-node.chosen]:outline-accent`} inert={!rightShown} aria-label="Research inspector">
    <header class="inspector-header sticky top-0 z-10 border-line/60 bg-surface px-3 py-2"><InspectorViewSwitch value={inspectorView} onselect={view => inspectorView = view} /></header>
    {#if inspectorView === 'monitor' && loopView && diagramView}<div class="min-w-0 px-3 pt-3 pb-4">{#key project.id}<div class="mb-3"><ModifiedHypothesisHistory bind:this={modifiedHistory} {project} {commandHistory} activity={monitorActivity} connected={connection === 'connected' && !snapshotStale} /></div>{#each (monitorActivity?.operations ?? []).filter(operation => !operation.toolName && operation.softDeadline && !['waiting','disabled'].includes(operation.softDeadline.status)) as operation (operation.sessionId)}<p class="muted small" role="status">{operation.role}: {operation.softDeadline?.status === 'delivered' ? 'Wrap-up requested; still running.' : 'Time target reached; wrap-up notice pending delivery.'}</p>{/each}{#each (monitorActivity?.operations ?? []).filter(operation => !operation.toolName && operation.budget?.capacityPolicy) as operation (operation.sessionId)}<p class="muted small" role="status">{operation.role}: calls {operation.counters?.turns ?? 0}{operation.budget?.capacityPolicy?.controlsEnabled ? ` / ${operation.budget.maxTurns}` : ' (budget OFF)'}, tools {operation.counters?.toolCalls ?? 0}{operation.budget?.capacityPolicy?.controlsEnabled ? ` / ${operation.budget.maxToolCalls}` : ''}. Tokens {operation.counters?.tokens ?? 'unavailable'}{operation.budget?.maxTokens !== undefined ? ` / ${operation.budget.maxTokens}` : ''}; cost USD {operation.counters?.costUsd ?? 'unavailable'}{operation.budget?.maxCostUsd !== undefined ? ` / ${operation.budget.maxCostUsd}` : ''}.</p>{/each}<LoopMonitor learning={workspaceReady && learningTasks.some(task=>task.projectId===project?.id && task.status==='running')} background={monitorActivity?.background} view={loopView} diagram={diagramView} />{/key}</div>{:else}
    {#if project.researchLoopVersion!=='4.0' || (project.presentation?.hypothesisRevision===project.hypothesisRevision && project.presentation?.conditions?.length && project.presentation.claim?.trim() && project.presentation.claim.trim()!==project.hypothesis.trim())}<HypothesisInspector {project} />{/if}
    {#if project.schemaVersion === 4}{#key project.id}<ResearchWaysV0 {project} />{/key}{:else if project.schemaVersion === 3}{#key project.id}<ResearchTreeV21 {project} {reportUpdates} />{/key}{:else if project.schemaVersion === 2}<HypothesisTreeV2 {project} onopen={openDocument} />{:else}<HypothesisTree {project} onopen={openDocument} />{/if}<ResearchDirections {project} onmonitor={() => openMonitor()} />
    {/if}
  </aside>{/if}
  {#if smallScreen && (sidebarOpen || rightShown)}<button class="panel-backdrop top-[var(--topbar-height)] h-auto" tabindex="-1" aria-label="Close open panel" onclick={() => closePanel(sidebarOpen ? 'left' : 'right')}></button>{/if}
</div>
{/if}
{#if exitOpen}
  <dialog use:openDialog aria-labelledby="exit-title" class="exit-dialog" oncancel={event => { event.preventDefault(); if (!busy) exitOpen = false; }}>
      <p class="eyebrow">Local backend lifecycle</p><h2 id="exit-title">Exit CAgE</h2>
      {#if bootstrap?.activeProjectIds.length}<p><strong>{bootstrap.activeProjectIds.length} research project{bootstrap.activeProjectIds.length === 1 ? '' : 's'} running.</strong> Full shutdown stops new work, preserves active research results and waits for runtime cleanup.</p>{:else}<p><strong>No tasks running.</strong> You can close the backend now.</p>{/if}
      <p class="muted">Closing a browser tab directly always leaves the backend running. Your browser may require you to close this tab yourself.</p>
      <div class="exit-options"><button class="primary" disabled={busy} onclick={() => exit('background')}>Keep backend running</button><button class="danger" disabled={busy} onclick={() => exit('shutdown')}>{bootstrap?.activeProjectIds.length ? 'Save & fully shut down' : 'Fully shut down'}</button><button disabled={busy} onclick={() => exitOpen = false}>Cancel</button></div>
  </dialog>
{/if}
{#if exportProjectId && project?.id === exportProjectId}
  <dialog use:openDialog aria-labelledby="project-export-title" class="exit-dialog max-h-[90dvh] overflow-y-auto" oncancel={() => exportProjectId = undefined}>
    <div class="flex items-center justify-between gap-3"><h2 id="project-export-title" class="m-0">Export / handoff</h2><button type="button" class="icon-button" aria-label="Close export" onclick={() => exportProjectId = undefined}><Icon name="close" size={18} /></button></div>
    <p class="my-3 truncate text-muted" title={project.name}>{project.name}</p>
    <ProjectHandoff {project} page={selectedPage} original={displayedOriginal} disabled={!workspaceReady} />
  </dialog>
{/if}
{#if deleteTarget}
  <dialog use:openDialog aria-labelledby="delete-session-title" class="exit-dialog" oncancel={event => { event.preventDefault(); if (!busy) deleteTarget = undefined; }}>
    <h2 id="delete-session-title">Delete session?</h2>
    <p>Remove “{deleteTarget.name}” from this workspace? This cannot be undone in the app. Underlying research records are retained for linked proofs.</p>
    {#if error}<p class="text-danger" role="alert">{error}</p>{/if}
    <div class="exit-options"><button type="button" disabled={busy} onclick={() => deleteTarget = undefined}>Cancel</button><button type="button" class="danger" disabled={busy} onclick={() => changeSessionState(deleteTarget!.id, 'deleted')}>Delete session</button></div>
  </dialog>
{/if}

<style>
:global([data-theme=obsidian] .capability-page.network-page){--tree-ink:var(--color-ink);--tree-line:var(--color-line-strong);--tree-dot:var(--color-line)}
:global([data-theme=obsidian] :is(.network-page,.map) :is(.network-minimap,.network-find-state,.node-state)){background:var(--color-surface);color:var(--color-ink);border-color:var(--color-line)}
:global([data-theme=obsidian] .map){color:var(--color-ink)}

.sidebar .brand{padding:0 0 5px}.sidebar .brand-home{justify-content:center;width:100%;padding:7px 16px;border:1px solid var(--color-line);background:linear-gradient(var(--color-surface),var(--color-rail));border-radius:10px}
.sidebar .nav-action{padding:5px 9px}.sidebar .new-project,.sidebar .search-field{margin:0 0 3px}.sidebar-sections :global(.disclosure-list),.sidebar-footer{margin:4px 0 0;padding:4px;min-height:0;max-height:none;border:1px solid var(--color-line);background:color-mix(in srgb,var(--color-surface) 84%,transparent);border-radius:9px}
.sidebar-sections :global(summary){padding:4px 7px;cursor:pointer}.sidebar-sections :global(.project-button){padding:3px 7px;min-height:27px}.session-group{margin:2px 0 2px 6px;border-left:1px solid var(--color-line);padding-left:3px}.sidebar-sections :global(summary:hover),.brand-home:hover{background:var(--color-hover)}.sidebar :global(button:active){background:var(--color-selected)}
.sidebar-footer .backend-state{padding:0 8px}.cages-row{display:flex;align-items:center;gap:4px}.cages-row .nav-action{flex:1;min-width:0}
.cages-row{border-radius:8px;padding-right:6px;min-height:32px}.cages-row:hover,.cages-row:has(.chosen){background:var(--color-hover)}.cages-row .nav-action,.cages-row .nav-action:hover{width:auto;align-self:stretch;justify-content:flex-start;background:transparent}
.map-switch{--skill:2.6em;position:relative;isolation:isolate;display:grid;grid-template-columns:var(--skill) 5.4em;align-items:center;gap:0;box-sizing:border-box;border:1px solid var(--color-line);background:var(--color-rail);border-radius:20px;height:20px;min-height:20px;padding:1px;font-size:calc(10px * var(--ui-font-scale,1));line-height:1}
.map-switch span{text-align:center}.map-switch:before{content:"";position:absolute;inset:1px auto 1px 1px;width:var(--skill);border-radius:20px;background:var(--color-selected);z-index:-1;transition:width .16s,transform .16s}.map-switch[aria-checked=true]:before{width:5.4em;transform:translateX(var(--skill))}
.topbar>.inline-actions:first-child{flex:1;min-width:0;flex-wrap:nowrap}.topbar :global(.workspace-tabs){flex:1;min-width:0;min-height:0;height:34px;padding:0;border:0;background:none}.topbar :global(.workspace-tabs button){padding-block:3px}.main-pane{min-width:0}.sidebar .brand-home:hover{border-color:var(--color-line-strong)}
@media(min-width:901px){.app-shell>.sidebar{grid-column:1;grid-row:1}.app-shell>.main-pane{grid-column:2;grid-row:1}.app-shell>.right-pane{grid-column:3;grid-row:1}.app-shell:not(.left-open)>.main-pane{margin-left:0}.app-shell:not(.right-open)>.main-pane{margin-right:0}}
.main-pane{container-type:inline-size}
@container(max-width:690px){
  :global(.network-page .knowledge-tree-header){flex-wrap:nowrap;padding-inline:5px;gap:5px}
  :global(.network-page .knowledge-tree-header h1){flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;min-width:0;font-size:1rem}
  :global(.network-header-actions){flex:1;min-width:0;gap:4px;flex-wrap:nowrap}
  :global(.network-page .network-search){min-width:36px;flex:1 1 65px;width:auto}
  :global(.network-header-actions select){min-width:44px;max-width:100px;flex:1 1 75px}
  :global(.network-page .network-filters){padding-left:4px;gap:2px}
}
.sidebar-sections :global(.disclosure-list>:not(summary)){margin-top:2px}
@media(prefers-reduced-motion:reduce){.map-switch:before,.app-shell,.app-shell>.sidebar,.app-shell>.right-pane{transition:none}}
.new-group{display:flex;align-items:center;gap:3px}.new-group input{width:0;flex:1;min-width:0}.new-group button{padding:3px 6px}

.sidebar{--rail-stroke:color-mix(in srgb,var(--color-line-strong) 68%,var(--color-ink));border:1px solid var(--rail-stroke);box-shadow:2px 3px 5px var(--color-scrim),4px 7px 16px var(--color-scrim)}
.sidebar-sections{padding:0 4px 8px}
.sidebar-sections :global(.disclosure-list),.sidebar-footer{margin-top:8px;border:1px solid var(--rail-stroke);box-shadow:0 2px 3px var(--color-scrim),0 4px 8px var(--color-scrim)}
.sidebar-sections :global(.disclosure-list[open]>summary)::after{content:"";display:block;height:1px;margin:5px 2px 0;background:var(--rail-stroke)}
.sidebar :global(.disclosure-list>summary){font-size:calc(14px * var(--ui-font-scale,1));font-weight:600;color:var(--color-ink)}
.sidebar .nav-action,.sidebar-sections .session-group>summary{font-size:calc(13px * var(--ui-font-scale,1))}
.sidebar-sections :global(.project-button){font-size:calc(12px * var(--ui-font-scale,1))}
.sidebar-sections :global(.inline-outline){margin-inline:12px}.sidebar-sections :global(.inline-outline :is(summary,button)),.sidebar-footer .backend-state{font-size:calc(11px * var(--ui-font-scale,1));color:var(--color-muted)}
.sidebar-sections :global(nav[aria-label="Research projects"] li+li)::before{content:"";display:block;height:1px;margin:4px 9px;background:var(--rail-stroke)}
.right-pane{box-shadow:-3px 2px 14px color-mix(in srgb,var(--color-scrim) 26%,transparent)}
.right-pane :global(.proof-group),.right-pane :global(section.rounded-xl){box-shadow:0 2px 7px color-mix(in srgb,var(--color-scrim) 22%,transparent)}
.sidebar-sections :global(summary),.sidebar-sections :global(.session-row),.sidebar-sections :global(nav>button),.sidebar .nav-action{box-sizing:border-box;border-radius:6px}
.sidebar-sections :global(summary){width:100%;margin-inline:0}
.sidebar-sections :global(.session-row){width:100%;align-items:stretch}
.sidebar-sections :global(.session-row:hover){background:var(--color-hover)}
.sidebar-sections :global(.session-row .project-button){width:auto;border-radius:6px 0 0 6px;background:transparent}
.sidebar-sections :global(.session-row .session-action-trigger){align-self:center;width:28px;border-radius:5px}
.sidebar-sections :global(.session-row:has(.chosen)){background:var(--color-selected)}
.sidebar-footer .nav-action,.sidebar-sections :global(.session-outline button){border-radius:6px;max-width:100%}
</style>
