import {prepareApplicationResume} from '../../../packages/ui/src/resume-preparation.js';
import { createPortal } from 'react-dom';
import {useBrowserPageState} from './browser-page-memory.js';
import {BrowserTabsBar} from './BrowserTabs.js';
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { MessageCircleQuestion, ArrowLeft, ArrowRight, Briefcase, CheckCircle2, ClipboardList, FileText, Globe, LoaderCircle, LocateFixed, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorMessage, Field } from './components.js';
import { createFormPreviewState, useWorkspace } from './context.js';
import { errorText } from './helpers.js';
import { SensitiveIdentityFillPanel } from './SensitiveIdentity.js';
import { CollectionReport, collectionRunMessage } from './CollectionReport.js';
import type { AppState, BrowserState, FillPlan, FillResult, TelemetryState, CareerFillOutcome, ApplicationQueueState } from '../../../packages/shared/src/contracts.js';
import { AgentCompanion } from './AgentCompanion.js';
import {PixelArrow} from './PixelGuide.js';
import {UniversalQuestions} from './UniversalQuestions.js';
import {UniversalDrafts} from './UniversalDrafts.js';
import {UniversalFillResult} from './UniversalFillResult.js';
import { displayBrowserAddress, normalizeBrowserAddress } from '../../../packages/ui/src/browser-input.js';
import { formPreviewCounts, formPreviewRows, selectablePreviewIds } from '../../../packages/ui/src/form-preview.js';
import { QuickFillInterrupted, runQuickFill, summarizeApplicationFill, quickFillOutcome } from '../../../packages/ui/src/apply-flow.js';
import { BROWSER_PANEL_HANDLE_WIDTH, DEFAULT_BROWSER_PANEL_LAYOUT, browserPanelSize, browserPanelWidthForDrag, browserPanelWidthForKey, type BrowserPanelLayout } from '../../../packages/ui/src/browser-panel-layout.js';
import { CareerFillPanel, type CareerFillPanelHandle, type Phase as CareerFillPhase } from './CareerFillPanel.js';
import './Browser.css';
import { applicationAttention, careerPendingAttention } from '../../../packages/ui/src/application-attention.js';
import type { ApplicationWorkflowIssue } from '../../../packages/shared/src/application-workflow.js';

/** Display only: exact field metadata joins by ID; this never creates a durable issue or a write plan. */
function ordinaryAttention(state: AppState, plan: FillPlan, result?: FillResult) {
  const unresolved = new Set(result?.unresolved.map(item => item.fieldId) ?? []);
  const issues: ApplicationWorkflowIssue[] = summarizeApplicationFill(plan, result).needsUser.map(item => {
    const fields = plan.items.filter(field => field.fieldId === item.fieldId);
    const field = fields.length === 1 ? fields[0] : undefined;
    return { id: item.fieldId, fieldId: item.fieldId, section: field?.profileKey ? 'contact' : 'other', status: 'open', scope: 'field',
      required: field?.required ?? null, fieldType: field?.type, fieldSignature: field?.fieldSignature, profileField: field?.profileKey,
      reasonCode: unresolved.has(item.fieldId) ? 'verification-failed' : field?.type && ['radio','checkbox','file','date'].includes(field.type) ? 'unsupported-field' : 'needs-review',
      label: item.label, reason: item.reason, createdAt: plan.createdAt, updatedAt: plan.createdAt, lastCheckedProfileVersion: plan.profileVersion, readbackVerified: false };
  });
  return applicationAttention(state, issues);
}

interface BrowserPageProps {
  externalReadOnlyBusy?: boolean;
  queue?: ApplicationQueueState; onShowQueue?: () => void; onNeedsInfo?: () => void;
  resumeRequest?: { id: number; url: string; profileVersion: number };
  embedded?: boolean; active?: boolean; detailsContainer?: HTMLElement | null; detailsVisible?: boolean;
  onToggleDetails?: () => void; onShowDetails?: () => void; onShowActivity?: () => void; onAutomaticStart?: () => void;
  panelLayout?: BrowserPanelLayout;
  onPanelLayoutChange?: Dispatch<SetStateAction<BrowserPanelLayout>>;
  onLayoutBusyChange?: (busy: boolean) => void;
}

export function BrowserPage({ panelLayout: savedPanelLayout, onPanelLayoutChange, onLayoutBusyChange, embedded = false, active = true, detailsContainer, detailsVisible = false, onToggleDetails, onShowDetails, onShowActivity, onAutomaticStart, resumeRequest, queue, onShowQueue, onNeedsInfo, externalReadOnlyBusy = false }: BrowserPageProps = {}) {
  const { api, state, browser, model, agentBusy, setBrowser, setState, overlayOpen, openJob, openModel, openApplicationSetup, navigate, notify, formPreview, setFormPreview, browserFocusMode, toggleBrowserFocus } = useWorkspace();
  const browserPageKey=JSON.stringify([browser.activeTabId??'legacy',browser.documentRevision??0,browser.url,state.profile.version]);
  const [localPanelLayout, setLocalPanelLayout] = useState(DEFAULT_BROWSER_PANEL_LAYOUT);
  const panelLayout = savedPanelLayout ?? localPanelLayout; const setPanelLayout = onPanelLayoutChange ?? setLocalPanelLayout;
  const grid = useRef<HTMLDivElement>(null); const [gridWidth, setGridWidth] = useState(0);
  const panelSeparator = useRef<HTMLDivElement>(null);
  const [panelResizing, setPanelResizing] = useState(false);
  const panelDrag = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(undefined);
  const holder = useRef<HTMLDivElement>(null); const addressInput = useRef<HTMLInputElement>(null); const [address, setAddress] = useBrowserPageState(browserPageKey,'address',displayBrowserAddress(browser.url)); const [addressDirty, setAddressDirty] = useBrowserPageState(browserPageKey,'addressDirty',false); const [addressError, setAddressError] = useBrowserPageState<string|undefined>(browserPageKey,'addressError',undefined);
  const [localBusy, setBusy] = useState<string>(); const [error, setError] = useState<string>();
  const [careerBusy, setCareerBusy] = useState(false);
  const [careerLocating, setCareerLocating] = useState(false);
  const careerPanel = useRef<CareerFillPanelHandle>(null);
  const [careerStatus, setCareerStatus] = useBrowserPageState(browserPageKey,'careerStatus','');
  const [careerPhase, setCareerPhase] = useState<CareerFillPhase>();
  const [careerOutcome, setCareerOutcome] = useBrowserPageState<CareerFillOutcome|undefined>(browserPageKey,'careerOutcome',undefined);
  const [careerOutcomeContext] = useBrowserPageState<{current:{url:string;version:number}|undefined}>(browserPageKey,'careerContext',{current:undefined});
  const currentCareerOutcome = careerOutcomeContext.current?.url === browser.url && careerOutcomeContext.current.version === state.profile.version ? careerOutcome : undefined;
  const [retryNotice, setRetryNotice] = useState<{label:string;attempt:number;maxAttempts:number}>();
  const [showQueueProgress, setShowQueueProgress] = useState(false);
  const [workflowPending, setWorkflowPending] = useState(0);
  useEffect(() => { if (queue?.id) setShowQueueProgress(true); }, [queue?.id]);
  useEffect(() => {
    let alive = true, eventReceived = false; setWorkflowPending(0);
    const accept = (value: import('../../../packages/shared/src/application-workflow.js').ApplicationWorkflowState) => {
      const matches = value.workflows.filter(workflow => workflow.target.url === browser.url);
      if (alive) setWorkflowPending(matches.length === 1 ? applicationAttention(state, matches[0]!.issues).count : 0);
    };
    const off = api.onEvent(event => { if (event.type === 'application-workflow') { eventReceived = true; accept(event.state); } });
    if (typeof api.workflowState === 'function') void api.workflowState().then(value => { if (!eventReceived) accept(value); }).catch(() => {});
    return () => { alive = false; off(); };
  }, [api, browser.url, state.profile.version]);
  useEffect(() => api.onEvent(event => { if (event.type === 'form-retry') setRetryNotice(event); }), [api]);
  const [autoLayout, setAutoLayout] = useState(false);
  const [automaticBusy, setAutomaticBusy] = useState(false);
  const [universalBusy,setUniversalBusy]=useState(false);
  const [universalResult,setUniversalResult]=useBrowserPageState<import('../../../packages/browser/src/universal-form.js').UniversalResult|undefined>(browserPageKey,'universalResult',undefined);
  useEffect(()=>api.onEvent(event=>{if(event.type==='universal-fill-progress')setQuickStatus(event.message);}),[api]);
  const missingQuestions = [...new Map((universalResult?.remaining ?? []).filter(item => item.reasonCode === 'missing-data' && item.question).map(item => [item.question!.key, item.question!])).values()];
  const [answeredQuestionKeys,setAnsweredQuestionKeys] = useBrowserPageState<string[]>(browserPageKey,'answeredQuestions',[]);
  const unansweredQuestions = missingQuestions.filter(q => !answeredQuestionKeys.includes(q.key));
  const [shownResult] = useBrowserPageState<{current:unknown}>(browserPageKey,'shownResult',{current:undefined});
  const showDetailsRef = useRef(onShowDetails); showDetailsRef.current = onShowDetails;
  const automaticOperation = useRef(false);
  const automaticCancelled = useRef(false);
  const handledResume = useRef<number | undefined>(undefined);
  const [telemetryState, setTelemetryState] = useState<TelemetryState>({ runs: [] });
  useEffect(() => {
    let alive = true;
    if (typeof api.telemetryState === 'function') void api.telemetryState().then(next => { if (alive) setTelemetryState(next); }).catch(() => {});
    const off = api.onEvent(event => { if (alive && event.type === 'telemetry') setTelemetryState(event.state); });
    return () => { alive = false; off(); };
  }, [api]);
  const manualTiming = telemetryState.runs.some(run => run.id === telemetryState.activeRunId && run.mode === 'manual');
  const [overwriteExisting,setOverwriteExisting]=useBrowserPageState(browserPageKey,'overwriteExisting',true);
  const [quickStatus, setQuickStatus] = useBrowserPageState<string|undefined>(browserPageKey,'quickStatus',undefined); const [previewExpanded, setPreviewExpanded] = useBrowserPageState(browserPageKey,'previewExpanded',false);
  const quickFinishStatus=useRef<'completed'|'partial'|'failed'|'cancelled'>('failed');
  const revealNoWriteDetails=useRef(false);
  const [quickPhase, setQuickPhase] = useState<'identifying' | 'filling' | 'stopping'>();
  const [showAllNeeds, setShowAllNeeds] = useState(false);
  const [locateMessage, setLocateMessage] = useState<string>();
  const locating = useRef(false);
  const mounted = useRef(true); const operation = useRef(0); const quickRunning = useRef(false); const quickCancelled = useRef(false); const quickWriting = useRef(false);
  const latest = useRef({ url: browser.url, version: state.profile.version, loading: browser.loading, overlayOpen, modelMode: model.mode, provider: model.provider, modelId: model.modelId, configured: model.configured });
  latest.current = { url: browser.url, version: state.profile.version, loading: browser.loading, overlayOpen, modelMode: model.mode, provider: model.provider, modelId: model.modelId, configured: model.configured };
  const [collectionScope, setCollectionScope] = useState<'current-page' | 'bounded-list'>('current-page');
  const [maxPages, setMaxPages] = useState(3); const [detailLimit, setDetailLimit] = useState(0);
  const plan = formPreview?.plan; const selected = new Set(formPreview?.selectedFieldIds ?? []); const result = formPreview?.result;
  const currentPlanId = useRef(plan?.id); currentPlanId.current = plan?.id;
  const ownBusy = localBusy ?? (autoLayout ? 'auto-layout' : formPreview?.filling ? 'fill' : careerBusy ? 'career' : panelResizing ? 'layout' : automaticBusy ? 'automatic' : undefined);
  const busy = ownBusy ?? (externalReadOnlyBusy ? 'external-read-only' : undefined); const used = formPreview?.used ?? false;
  const panelControlsDisabled = externalReadOnlyBusy || autoLayout || !!localBusy || !!formPreview?.filling || careerBusy || agentBusy || overlayOpen;
  const panelSize = browserPanelSize(panelLayout.preferredWidth, gridWidth);
  const detailsOpen = embedded ? detailsVisible : !panelLayout.collapsed;
  const navigationBlocked = !!busy || browser.loading;
  const viewportControlsDisabled = navigationBlocked || agentBusy || overlayOpen || automaticOperation.current;
  const previewRows = plan ? formPreviewRows(plan, result) : [];
  const previewCounts = plan ? formPreviewCounts(plan, [...selected], result) : undefined;
  const fillSummary = plan ? summarizeApplicationFill(plan, result) : undefined;
  const ordinaryPending = plan ? ordinaryAttention(state, plan, result) : undefined;
  useEffect(() => {
    // Current receipts replace older observations; a later explicit read-only
    // refresh may replace these counts in turn. Never take a historical maximum.
    if (currentCareerOutcome) setWorkflowPending(careerPendingAttention(state, currentCareerOutcome.pending).count);
    else if (result && plan && plan.url === browser.url && plan.profileVersion === state.profile.version) setWorkflowPending(ordinaryAttention(state, plan, result).count);
  }, [currentCareerOutcome, result, plan?.id, browser.url, state.profile.version]);
  const petQueue = showQueueProgress ? queue : undefined;
  const companionPending = petQueue ? petQueue.items.reduce((sum,item) => sum + item.pendingCount, 0) : (universalResult?.pending ?? workflowPending);
  const activeQueueItem = petQueue?.items.find(item=>item.id===petQueue.activeItemId);
  const nativeWriting = universalBusy || careerPhase==='running' || quickPhase==='filling' || (localBusy==='fill'||localBusy==='identity') || formPreview?.filling;
  const nativeReading = careerPhase==='reading' || careerPhase==='preparing' || quickPhase==='identifying' || localBusy==='inspect';
  const companionStatus = petQueue?.status==='running' ? activeQueueItem?.activity==='retrying' ? 'retrying' : activeQueueItem?.status==='loading' ? 'reading' : 'filling'
    : careerPhase==='stopping' || quickPhase==='stopping' ? 'stopped'
    : nativeWriting ? retryNotice ? 'retrying' : 'filling' : nativeReading ? 'reading'
    : petQueue?.items.some(item=>item.status==='waiting-user'&&item.attention==='login') ? 'waiting-login'
    : petQueue?.items.some(item=>item.status==='waiting-user') ? 'needs-info'
    : petQueue?.status==='finished' ? 'completed' : petQueue?.status==='cancelled' || currentCareerOutcome?.status==='stopped' ? 'stopped'
    : companionPending ? 'needs-info' : currentCareerOutcome || universalResult || result ? 'completed' : 'idle';
  const speedsterAllowed = !externalReadOnlyBusy && active && !overlayOpen && !panelResizing && !autoLayout && !careerLocating
    && (!localBusy || ['quick','fill','inspect','universal'].includes(localBusy));
  useEffect(() => { if (!busy) setRetryNotice(undefined); }, [busy]);
  const hasPage = !!browser.url && browser.url !== 'about:blank';
  const online = model.mode === 'live' && model.configured;
  const automaticButtonLabel = externalReadOnlyBusy ? '正在读取提示…' : careerLocating ? '正在定位…' : autoLayout ? '准备填写…' : careerBusy || busy === 'quick' || busy === 'fill' ? '正在自动填写…' : '自动填写';
  let feishuCareerPage = false;
  try { const url = new URL(browser.url); feishuCareerPage = url.origin === 'https://modelbest.jobs.feishu.cn' && /\/(?:resume|application)\//u.test(url.pathname); } catch {}
  const validCollectionBudget = collectionScope === 'current-page' || (Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 10 && Number.isInteger(detailLimit) && detailLimit >= 0 && detailLimit <= 50);
  const latestCollection = [...state.sourceRuns].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).find(run => {
    if (!run.report || run.report.scope.mode === 'official-api-pages' || !hasPage) return false;
    try { return new URL(run.report.scope.listURL).origin === new URL(browser.url).origin; } catch { return false; }
  });
  useEffect(() => { if (!addressDirty) setAddress(displayBrowserAddress(browser.url)); }, [browser.url, addressDirty]);
  useEffect(()=>{if(active&&browser.activeTabId&&(!browser.url||browser.url==='about:blank'))addressInput.current?.focus();},[browser.activeTabId,browser.url,active]);
  useEffect(() => {
    if (!resumeRequest || handledResume.current === resumeRequest.id || !active || browser.loading) return;
    handledResume.current = resumeRequest.id;
    if (resumeRequest.url !== browser.url || resumeRequest.profileVersion !== state.profile.version || busy || overlayOpen || agentBusy) {
      notify('页面或资料已变化，请在当前页面重新点击自动填写。', true); return;
    }
    // Continue is a fresh one-click operation after layout settles, never a replay.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { void autoFillPage(); }); });
    return () => cancelAnimationFrame(frame);
  }, [resumeRequest, active, browser.loading]);
  useEffect(() => { setError(undefined); }, [browser.url, plan?.id]);
  useEffect(() => { setLocateMessage(undefined); }, [browser.url, state.profile.version, plan?.id]);
  useEffect(() => { setShowAllNeeds(false); }, [plan?.id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; setFormPreview(current => current?.filling ? { ...current, filling: false } : current); }; }, [setFormPreview]);
  useEffect(() => { operation.current++; }, [browser.activeTabId,browser.url, browser.loading, state.profile.version, model.mode, model.provider, model.modelId, model.configured, overlayOpen]);
  useLayoutEffect(() => { onLayoutBusyChange?.(!!ownBusy || agentBusy); }, [ownBusy, agentBusy, onLayoutBusyChange]);
  useLayoutEffect(() => () => { onLayoutBusyChange?.(false); }, [onLayoutBusyChange]);
  useLayoutEffect(() => {
    const element = grid.current; if (!element) return;
    const measure = () => setGridWidth(element.getBoundingClientRect().width);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const finish = () => endPanelResize();
    window.addEventListener('blur', finish);
    return () => window.removeEventListener('blur', finish);
  }, []);
  useEffect(() => { if (panelControlsDisabled) endPanelResize(); }, [panelControlsDisabled]);
  useLayoutEffect(() => {
    const element = holder.current; if (!element) return;
    let frame = 0; let disposed = false;
    const update = () => {
      if (disposed) return;
      const rect = element.getBoundingClientRect();
      const bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) };
      void api.browserBounds(bounds, active && hasPage && !overlayOpen && !panelResizing && bounds.width > 0 && bounds.height > 0).catch(() => {});
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update(); const observer = new ResizeObserver(schedule); observer.observe(element);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); void api.browserBounds({ x: 0, y: 0, width: 0, height: 0 }, false).catch(() => {}); };
  }, [api, hasPage, overlayOpen, panelResizing, active]);
  function endPanelResize(element: HTMLDivElement | null = panelSeparator.current) {
    const drag = panelDrag.current;
    panelDrag.current = undefined; setPanelResizing(false);
    // A native child view or a detached element may have already released pointer capture.
    try { if (drag && element?.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId); } catch {}
  }
  function startPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (panelControlsDisabled || event.button !== 0 || event.isPrimary === false || panelLayout.collapsed || panelDrag.current) return;
    event.preventDefault();
    try { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }
    catch { notify('暂时无法拖动，可选中分隔线后用方向键调整宽度。'); return; }
    panelDrag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelSize.width };
    setPanelResizing(true);
  }
  function movePanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panelDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || panelControlsDisabled) return;
    event.preventDefault();
    const preferredWidth = browserPanelWidthForDrag(drag.startWidth, drag.startX, event.clientX, gridWidth);
    setPanelLayout(current => ({ ...current, preferredWidth }));
  }
  function finishPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (panelDrag.current?.pointerId !== event.pointerId) return;
    endPanelResize(event.currentTarget);
  }
  async function action(name: string, work: () => Promise<void>) { setBusy(name); setError(undefined); try { await work(); } catch (err) { setError(errorText(err)); } finally { setBusy(undefined); } }
  async function updateNavigation(work: () => Promise<BrowserState>, waitsForLoad = false) {
    const next = await work(); setBrowser(next);
    // Back/forward/reload return immediately and may still carry an earlier load error.
    // Explicit URL and fixture navigation wait for loading, so their errors belong to this request.
    if (waitsForLoad && next.error) throw new Error(next.error);
    setAddress(displayBrowserAddress(next.url)); setAddressDirty(false); setAddressError(undefined);
  }
  async function openAddress() {
    if (navigationBlocked) return;
    setAddressError(undefined);
    let url: string;
    try { url = normalizeBrowserAddress(address); } catch (err) { setAddressError(errorText(err)); addressInput.current?.focus(); return; }
    setBusy('navigate');
    try { await updateNavigation(() => (api.browserNavigateCurrent??api.browserNavigate)(url), true); }
    catch (err) { setAddressError(errorText(err)); }
    finally { setBusy(undefined); }
  }
  function chooseFields(all: boolean) {
    if (!plan || busy || stale || used) return;
    setFormPreview(current => current?.plan.id === plan.id && !current.used ? { ...current, selectedFieldIds: all ? selectablePreviewIds(plan, result) : [] } : current);
  }
  const stale = !!plan && (plan.profileVersion !== state.profile.version || plan.url !== browser.url);
  async function inspect() { const next = await api.prepareFill(); if (mounted.current) { setFormPreview(createFormPreviewState(next)); setPreviewExpanded(true); } }
  async function quickFill() {
    if (!online) { openModel(); return; }
    if (quickRunning.current || busy || browser.loading || !hasPage || overlayOpen || agentBusy) return;
    quickRunning.current = true;
    quickCancelled.current = false; quickWriting.current = false;
    const token = ++operation.current; const snapshot = { url: browser.url, profileVersion: state.profile.version }; const originalModel = model.modelId; const originalProvider = model.provider;
    const isCurrent = () => mounted.current && operation.current === token && latest.current.url === snapshot.url && latest.current.version === snapshot.profileVersion && !latest.current.loading && !latest.current.overlayOpen && latest.current.modelMode === 'live' && latest.current.configured && latest.current.provider === originalProvider && latest.current.modelId === originalModel;
    setBusy('quick'); setQuickPhase('identifying'); setFormPreview(undefined); setPreviewExpanded(false); setError(undefined); setQuickStatus('模型正在识别当前页面的填写项…');
    quickFinishStatus.current='failed';revealNoWriteDetails.current=false;
    let preparedId: string | undefined;
    try {
      const next = await runQuickFill({ context: snapshot, isCurrent,
        prepare: () => api.prepareFill({ useModel: true }),
        fill: (id, ids) => api.fillApproved(id, ids),
        onPreview: prepared => { preparedId = prepared.id; setFormPreview(createFormPreviewState(prepared)); },
        onFilling: prepared => { quickWriting.current = true; setQuickPhase('filling'); setQuickStatus('正在填写并逐项核实网页结果，请稍候，不要重复点击。'); setFormPreview(current => current?.plan.id === prepared.id ? { ...current, used: true, filling: true } : current); },
      });
      if (!isCurrent()) throw new QuickFillInterrupted();
      const outcome=quickFillOutcome(next.plan,next.result);quickFinishStatus.current=outcome.status;setQuickStatus(outcome.message);
      if (next.result) {
        const completed = next.result;
        setFormPreview(current => current?.plan.id === next.plan.id ? { ...current, result: completed, used: true, filling: false, selectedFieldIds: current.selectedFieldIds.filter(id => !completed.verified.some(item => item.fieldId === id)) } : current);
      } else revealNoWriteDetails.current=true;
    } catch (err) {
      if (mounted.current) {
        quickFinishStatus.current=quickCancelled.current?'cancelled':'failed';revealNoWriteDetails.current=!quickWriting.current;
        if (quickCancelled.current) { setError(undefined); setQuickStatus('已停止识别，未继续自动填写。可以重新点击，生成新的填写计划。'); }
        else { setError(errorText(err)); setQuickStatus('本次自动填写未完成。请核对网页与待处理项；再次点击会重新识别，不会重用旧计划。'); }
      }
    } finally {
      quickRunning.current = false; quickWriting.current = false;
      if (mounted.current) { setBusy(undefined); setQuickPhase(undefined); setFormPreview(current => current && current.plan.id === preparedId ? { ...current, filling: false } : current); }
    }
  }
  async function prepareAutomaticLayout(collapsed: boolean) {
    const expected = { url: browser.url, version: state.profile.version };
    const layoutToken = ++operation.current;
    const active = () => mounted.current && operation.current === layoutToken && latest.current.url === expected.url
      && latest.current.version === expected.version && !latest.current.loading && !latest.current.overlayOpen;
    setAutoLayout(true);
    setCareerStatus(collapsed ? '正在展开网页空间，准备填写经历…' : '正在准备联系信息填写区域…');
    setPanelLayout(current => ({ ...current, collapsed }));
    try {
      let previous = '';
      for (let sample = 0; sample < 20; sample++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active()) throw new Error('网页或资料在准备布局时变化，未继续填写。');
        const rect = holder.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('网页区域尚未准备好，请稍后再点自动填写。');
        const bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        const key = JSON.stringify(bounds);
        if (key === previous) {
          await api.browserBounds(bounds, true);
          if (!active()) throw new Error('网页或资料在准备布局时变化，未继续填写。');
          return;
        }
        previous = key;
      }
      throw new Error('网页布局仍在变化，请稍后再点自动填写。');
    } finally { if (mounted.current) setAutoLayout(false); }
  }
  async function autoFillPage(retryFailed=false) {
    if (!hasPage || browser.loading || busy || overlayOpen || agentBusy || automaticOperation.current) return;
    if (manualTiming) { notify('请先结束人工计时，再开始 Agent 填写。', true); return; }
    setShowQueueProgress(false);
    onAutomaticStart?.();
    setAutomaticBusy(true);
    automaticOperation.current = true; automaticCancelled.current = false; quickCancelled.current = false;
    let measurementId: string | undefined;
    quickFinishStatus.current='failed';revealNoWriteDetails.current=false;
    let finishStatus:'completed'|'partial'|'failed'|'cancelled'='failed';
    setFormPreview(undefined); setQuickStatus(undefined);
    try {
      const setup=await api.applicationSetup?.();
      if(setup&&!setup.confirmedAt){openApplicationSetup?.();return;}
      measurementId = (await api.beginMeasurement({ mode: 'agent' })).id;
      if (!feishuCareerPage) {
        if(api.runUniversalFill){
          setUniversalBusy(true);setBusy('universal');setUniversalResult(undefined);setAnsweredQuestionKeys([]);setQuickStatus('Agent 正在观察表单，逐项操作并核对…');
          try{if(setup&&api.inspectResumeUpload&&api.uploadApplicationResume)await prepareApplicationResume({setup,profileVersion:state.profile.version,inspect:()=>api.inspectResumeUpload!(),upload:input=>api.uploadApplicationResume!(input),current:page=>latest.current.url===page.url&&latest.current.version===state.profile.version,cancelled:()=>automaticCancelled.current,progress:setQuickStatus});
            if(automaticCancelled.current)return;
            const result=await api.runUniversalFill({profileVersion:state.profile.version,overwriteExisting,...(retryFailed?{retryFailed:true}:{})});finishStatus=result.status;
            if(mounted.current){setUniversalResult(result);setQuickStatus(result.message);}
          }finally{if(mounted.current){setUniversalBusy(false);setBusy(undefined);}}
        }else throw new Error('安装包缺少填写接口，Agent 尚未启动。请更新应用；网页内容已保留。');
        return;
      }
      // Keep ordinary contacts in their verified split view, then give the
      // reviewed legacy career form its wider native viewport. Each phase
      // settles bounds before preparing a new authorization.
      await prepareAutomaticLayout(false);
      if (!mounted.current) return;
      await careerPanel.current?.autoFill();
      finishStatus='completed';
    } catch (cause) {
      if (mounted.current) { setError(errorText(cause)); setQuickStatus('本次未完成：'+errorText(cause)); setCareerStatus('网页区域没有准备好，本次未继续自动填写。'); if(!feishuCareerPage)onShowDetails?.(); }
    } finally {
      if (measurementId) await api.finishMeasurement({ id: measurementId, status: automaticCancelled.current || quickCancelled.current ? 'cancelled' : finishStatus }).catch(() => notify('填写已结束，但轨迹保存未完成。', true));
      automaticOperation.current = false;
      if (mounted.current) setAutomaticBusy(false);
      if(mounted.current&&!feishuCareerPage&&revealNoWriteDetails.current){setPreviewExpanded(true);onShowDetails?.();}
    }
  }
  async function stopRecognition() {
    if (!quickRunning.current || quickWriting.current || quickCancelled.current) return;
    quickCancelled.current = true; operation.current++;
    setQuickPhase('stopping'); setQuickStatus('正在停止识别，不会继续填写。等待本次请求结束后可重新开始。');
    try { await api.cancelAgent(); }
    catch { if (mounted.current && quickRunning.current) setQuickStatus('已阻止后续自动填写，正在等待识别请求结束。'); }
  }
  async function collect() {
    const next = await api.collectPageJobs({ scope: collectionScope, maxPages: collectionScope === 'current-page' ? 1 : maxPages, detailLimit: collectionScope === 'current-page' ? 0 : detailLimit });
    setState(next);
    const run = [...next.sourceRuns].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    if (run) notify(collectionRunMessage(run), run.status === 'failed');
  }
  async function fill() {
    if (!plan || used || stale || !selected.size || externalReadOnlyBusy) return;
    setFormPreview(current => current?.plan.id === plan.id ? { ...current, used: true, filling: true } : current);
    try {
      const next = await api.fillApproved(plan.id, [...selected]);
      setFormPreview(current => current?.plan.id === plan.id ? { ...current, result: next, selectedFieldIds: current.selectedFieldIds.filter(id => !next.verified.some(item => item.fieldId === id)) } : current);
      notify(next.unresolved.length ? `已验证 ${next.verified.length} 项，${next.unresolved.length} 项待处理` : `已验证填写 ${next.verified.length} 项`);
    } finally {
      setFormPreview(current => current?.plan.id === plan.id ? { ...current, filling: false } : current);
    }
  }
  async function locateOrdinaryField(fieldId: string) {
    if (!plan || stale || viewportControlsDisabled || locating.current) return;
    const expected = { url: browser.url, version: state.profile.version, planId: plan.id };
    locating.current = true; setBusy('locate'); setLocateMessage(undefined);
    try {
      const response = await api.locateApplicationField({ kind: 'ordinary', planId: expected.planId, fieldId });
      if (mounted.current && latest.current.url === expected.url && latest.current.version === expected.version && currentPlanId.current === expected.planId && !latest.current.loading) setLocateMessage(response.message);
    } catch (cause) {
      if (mounted.current && latest.current.url === expected.url && latest.current.version === expected.version && currentPlanId.current === expected.planId) setLocateMessage(errorText(cause));
    } finally { locating.current = false; if (mounted.current) setBusy(undefined); }
  }
  async function changeBrowserZoom(percent: 80 | 90 | 100) {
    if (viewportControlsDisabled) return;
    await action('zoom', async () => {
      setBrowser(await api.browserZoom(percent));
      setFormPreview(current => current ? { ...current, used: true } : current);
      careerPanel.current?.invalidateWritePlan();
    });
  }
  const ordinaryFillTools = <>{stale && <div className="notice notice-warning" role="status">网页或简历资料已变化。请重新识别；上次计划和结果不会用于继续填写。</div>}{busy === 'quick' && quickPhase !== 'filling' && <Button variant="secondary" className="button-full quick-stop-button" disabled={quickPhase === 'stopping'} onClick={() => void stopRecognition()}>{quickPhase === 'stopping' ? '等待识别结束…' : '停止识别'}</Button>}{(quickPhase === 'filling' || busy === 'fill') && <p className="quick-writing-note" role="status">正在执行并核实已授权字段。此阶段不提供中途取消，请等待结果后再操作。</p>}{quickStatus && !universalResult && <div className="quick-fill-status" data-testid="quick-fill-status" role="status">{quickStatus}</div>}{plan?.recognition && <p className={`quick-recognition ${plan.recognition.mode}`} data-testid="recognition-status">{plan.recognition.message}</p>}{plan && fillSummary && (!busy || busy === 'locate') && !stale && <section className="quick-fill-result" data-testid="quick-fill-result" aria-label="本次填写结果">
        <div className="quick-result-counts"><strong>已核实 {fillSummary.filled.length} 项</strong><span>需我处理 {ordinaryPending?.count ?? 0} 项</span><span>保留 {fillSummary.preserved.length} 项</span></div>
        {(ordinaryPending?.required.length ?? 0) > 0 && <div className="quick-needs-user" data-testid="ordinary-needs-user"><h3>需我处理</h3><ul className="application-attention-list">{ordinaryPending!.required.slice(0, showAllNeeds ? undefined : 5).map(({ issue, displayTitle, hint, locatable, locateHint }) => <li key={issue.fieldId}>
          <div className="application-attention-row"><details className="application-attention-reason"><summary aria-disabled={viewportControlsDisabled} onClick={event => { if (viewportControlsDisabled) event.preventDefault(); }} onKeyDown={event => { if (viewportControlsDisabled && ['Enter', ' '].includes(event.key)) event.preventDefault(); }}>{displayTitle}</summary><p>{hint}</p><p>{issue.reason}</p></details>
            {locatable ? <button type="button" className="application-field-locate" data-testid="ordinary-field-locate" data-field-id={issue.fieldId} aria-label={`定位${displayTitle}`} disabled={viewportControlsDisabled} onClick={() => void locateOrdinaryField(issue.fieldId!)}><LocateFixed size={13} />定位</button> : <small>{locateHint}</small>}</div>
        </li>)}</ul>{ordinaryPending!.required.length > 5 && <button className="text-link" disabled={viewportControlsDisabled} aria-expanded={showAllNeeds} onClick={() => setShowAllNeeds(value => !value)}>{showAllNeeds ? '收起' : `展开其余 ${ordinaryPending!.required.length - 5} 项`}</button>}</div>}
        {(ordinaryPending?.optional.length ?? 0) > 0 && <details data-testid="ordinary-optional" className="career-attention-optional"><summary>可选补充 · {ordinaryPending!.optional.length} 项</summary><ul className="application-attention-list">{ordinaryPending!.optional.map(({ issue, displayTitle, hint }) => <li key={issue.fieldId}><div className="application-attention-row"><div><strong>{displayTitle}</strong><p>{hint}</p></div><button type="button" className="application-field-locate" data-testid="ordinary-field-locate" data-field-id={issue.fieldId} disabled={viewportControlsDisabled} aria-label={`定位${displayTitle}`} onClick={() => void locateOrdinaryField(issue.fieldId!)}><LocateFixed size={13} />定位</button></div></li>)}</ul></details>}
        {locateMessage && <p className="application-field-locate-status" data-testid="ordinary-locate-status" role="status">{locateMessage}</p>}
        <p className="quick-result-scope">仅覆盖本次识别的字段，核对整份申请后自行提交。</p>
      </section>}
      <details className="browser-manual-tools" data-testid="ordinary-preview-details" open={previewExpanded} onToggle={event => setPreviewExpanded(event.currentTarget.open)}><summary aria-disabled={!!busy || agentBusy || overlayOpen} onClick={event => { if (busy || agentBusy || overlayOpen) event.preventDefault(); }} onKeyDown={event => { if ((busy || agentBusy || overlayOpen) && ['Enter', ' '].includes(event.key)) event.preventDefault(); }}>全部字段与手动调整</summary><p className="quick-fill-consent">点击即同意将本页空白、可确定的字段填入已确认资料。未知、敏感和协议项留给你，不点击提交。</p><div className="quick-model-status"><span>{online ? `${model.provider} · ${model.modelId}` : '尚未配置在线模型'}</span><button className="text-link" disabled={!!busy} onClick={openModel}>模型设置</button></div><div className="browser-panel-actions"><Button variant="secondary" disabled={!hasPage || browser.loading || !!busy || agentBusy} busy={busy === 'inspect'} onClick={() => void action('inspect', inspect)}><ClipboardList size={15} />{plan ? '重新识别表单' : '识别表单与填写计划'}</Button></div>
        {plan ? <>
          <div className="divider" />
          <div className="row space-between" style={{ fontSize: 11, color: '#839989' }}><span>填写预览</span><Badge>{previewCounts?.ready ?? 0} 项可填写</Badge></div>
          <p className="form-source-note" style={{ marginTop: 10 }}>资料版本 {plan.profileVersion} · 只勾选你同意填写的字段</p>
          <div className="preview-selection-tools"><Button variant="ghost" className="button-small" disabled={!!busy || stale || used || !previewCounts?.ready} onClick={() => chooseFields(true)}>选择可填写项</Button><Button variant="ghost" className="button-small" disabled={!!busy || stale || used || !previewCounts?.selected} onClick={() => chooseFields(false)}>清空选择</Button></div>
          {previewCounts && <p className="preview-counts" aria-live="polite">选中 {previewCounts.selected} 项 · 已有内容保留 {fillSummary?.preserved.length ?? 0} 项 · 需你处理 {ordinaryPending?.count ?? 0} 项{result ? ` · 已验证 ${previewCounts.verified} 项 · 未完成 ${previewCounts.unresolved} 项` : ''}</p>}
          {used && !formPreview?.filling && <div className="notice notice-warning">本次预览已用于填写。继续处理未完成项时，请先重新识别表单。</div>}
          <div className="form-preview" data-plan-id={plan.id}>{previewRows.map(row => {
            const { item } = row; const verified = row.status === 'verified';
            const needsUser = fillSummary?.needsUser.some(entry => entry.fieldId === item.fieldId);
            return <div className={`preview-row ${row.status}`} key={item.fieldId}>
              <div className="preview-heading">
                <label className="preview-select-label" htmlFor={`preview-${plan.id}-${item.fieldId}`}>
                {row.status === 'ready' ? <input id={`preview-${plan.id}-${item.fieldId}`}
                  type="checkbox" checked={selected.has(item.fieldId)} disabled={!!busy || stale || used}
                  onChange={event => {
                    const checked = event.target.checked;
                    setFormPreview(current => {
                      if (!current || current.plan.id !== plan.id || current.used) return current;
                      const next = new Set(current.selectedFieldIds);
                      checked ? next.add(item.fieldId) : next.delete(item.fieldId);
                      return { ...current, selectedFieldIds: [...next] };
                    });
                  }} aria-label={`允许填写 ${item.label}`}
                /> : verified ? <CheckCircle2 size={14} color="#77a388" /> : <span style={{ width: 15 }} />}
                <span className="grow">{item.label}</span>
                </label>
                <Badge tone={verified ? 'green' : needsUser ? 'amber' : 'muted'}>{verified ? '已核实' : row.status === 'ready' ? '可填写' : needsUser ? '需我处理' : '保留已有'}</Badge>
                {needsUser && <button type="button" className="application-field-locate" data-testid="ordinary-preview-locate" data-field-id={item.fieldId} disabled={viewportControlsDisabled || stale} aria-label={`定位${item.label || '未命名字段'}`} onClick={() => void locateOrdinaryField(item.fieldId)}><LocateFixed size={13} />定位</button>}
              </div>
              <div className="preview-value">{item.value || item.currentValue || '暂无可用资料'}</div>
              <div className="preview-reason">{row.reason}</div>
            </div>;
          })}</div>
          <div className="fill-confirm"><p>点击后仅填写勾选项，不提交申请、不接受协议。已有值和无法确定的字段会保留。</p><Button className="button-full" disabled={!previewCounts?.selected || stale || used || !!busy || browser.loading} busy={busy === 'fill'} onClick={() => void action('fill', fill)}><CheckCircle2 size={15} />确认填写 {previewCounts?.selected ?? 0} 项</Button></div>
          {result && <div className="fill-result"><strong>已验证 {result.verified.length} 项</strong>{result.unresolved.map(item => <div key={item.fieldId}>{item.label}：{item.reason}</div>)}</div>}
        </> : <EmptyState compact icon={<ClipboardList size={22} />} title="先看清字段，再决定填写" description="识别后会展示资料来源、候选值和待处理项。确认之前不会填写。" />}
        </details></>;
  function focusAnswerGuide() {
    const guide = document.querySelector<HTMLElement>('[data-testid="universal-missing-questions"]');
    if (!guide?.getClientRects().length) return;
    guide.scrollIntoView({ block: 'start' });
    (guide.querySelector<HTMLElement>('textarea,select,.answer-options button') ?? guide.querySelector<HTMLElement>('h3'))?.focus();
  }
  function revealAnswerGuide() {
    if (embedded) onShowDetails?.(); else setPanelLayout(current => ({ ...current, collapsed: false }));
    requestAnimationFrame(() => requestAnimationFrame(focusAnswerGuide));
  }
  useEffect(() => {
    if (!universalResult || busy || automaticBusy || agentBusy || overlayOpen || shownResult.current === universalResult) return;
    // The parent releases its layout lock after our busy callback commits.
    // Wait for that commit before leaving focus mode; never resize mid-write.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      shownResult.current = universalResult;
      if (universalResult.remaining?.some(item => item.reasonCode==='missing-data' && item.question && !answeredQuestionKeys.includes(item.question.key)) || universalResult.drafts?.length) {
        if (embedded) showDetailsRef.current?.();
        else setPanelLayout(current => ({ ...current, collapsed: false }));
        frame = requestAnimationFrame(focusAnswerGuide);
      }
    }); });
    return () => cancelAnimationFrame(frame);
  }, [universalResult, busy, automaticBusy, agentBusy, overlayOpen, embedded]);
  const fillPanel = <aside id="browser-fill-panel" className="browser-panel" hidden={embedded ? !detailsVisible : panelLayout.collapsed} aria-labelledby="browser-fill-panel-title">{browser.error && <div className="browser-permission-note" role="status">{browser.error}</div>}<button className="text-link browser-back-to-jobs" onClick={() => navigate('apply')}>← 返回推荐岗位</button><h2 id="browser-fill-panel-title">填写详情</h2><p className="browser-panel-sub">按已确认资料填写，提交前请核对网页。</p><ErrorMessage message={error} />{!feishuCareerPage && <label className="row" style={{fontSize:12,marginBottom:12}}><input type="checkbox" data-testid="overwrite-profile" checked={overwriteExisting} disabled={!!busy||automaticBusy} onChange={event=>setOverwriteExisting(event.target.checked)} />用已确认资料覆盖网页现有内容</label>}<Button variant="ghost" disabled={!!busy||automaticBusy||agentBusy||overlayOpen} onClick={()=>void autoFillPage(true)}>重试未完成控件</Button>{universalResult && <UniversalQuestions key={browserPageKey} result={universalResult} locked={!!busy||automaticBusy||agentBusy||overlayOpen} onBusy={value=>setBusy(value?"answers":undefined)} onContinue={()=>autoFillPage()} onAnsweredChange={setAnsweredQuestionKeys}/>}{universalResult && <UniversalDrafts result={universalResult} locked={!!busy||automaticBusy||agentBusy||overlayOpen}/>}{universalResult && <UniversalFillResult result={universalResult}/>}{feishuCareerPage && <CareerFillPanel key={browser.activeTabId??browser.url} ref={careerPanel} onPhaseChange={setCareerPhase} onOutcomeChange={value => { careerOutcomeContext.current = { url: browser.url, version: state.profile.version }; setCareerOutcome(value); }} onStatusChange={setCareerStatus} onPrepareCareerSpace={() => prepareAutomaticLayout(true)} disabled={externalReadOnlyBusy || !!localBusy || !!formPreview?.filling || panelResizing || agentBusy || overlayOpen} onBusyChange={setCareerBusy} onLocatingChange={setCareerLocating} />}{feishuCareerPage ? <details key={browser.url} className="browser-manual-tools" data-testid="generic-fill-tools">
        <summary aria-disabled={!!busy || agentBusy || overlayOpen} onClick={event => { if (busy || agentBusy || overlayOpen) event.preventDefault(); }} onKeyDown={event => { if ((busy || agentBusy || overlayOpen) && ['Enter', ' '].includes(event.key)) event.preventDefault(); }}>姓名、邮箱等通用字段</summary>
        <p className="notice notice-warning">学历和经历请使用上方，包括学历选择、起止日期和自动新增。本区保留原通用识别流程，需单独配置模型。</p>
        {ordinaryFillTools}
      </details> : ordinaryFillTools}<SensitiveIdentityFillPanel key={browser.activeTabId??browser.url} disabled={!!busy || agentBusy || overlayOpen || browser.loading || !hasPage} onBusyChange={value => setBusy(value ? 'identity' : undefined)} /><details className="browser-other-tools"><summary>岗位采集与保存</summary>        <details className="browser-collection-settings"><summary>岗位采集范围与上限</summary><div className="stack"><Field label="本次范围"><select value={collectionScope} disabled={!!busy} onChange={event => setCollectionScope(event.target.value as typeof collectionScope)} aria-label="网页岗位采集范围"><option value="current-page">只采集当前已加载页面</option><option value="bounded-list">读取列表并按上限翻页</option></select></Field>{collectionScope === 'bounded-list' ? <><Field label="最多列表页数" hint="1–10 页，使用已识别的官网下一页入口"><input type="number" min={1} max={10} step={1} value={maxPages} disabled={!!busy} onChange={event => setMaxPages(Number(event.target.value))} aria-label="网页最多列表页数" /></Field><Field label="最多补全详情" hint="0–50 条，0 表示保留列表候选"><input type="number" min={0} max={50} step={1} value={detailLimit} disabled={!!busy} onChange={event => setDetailLimit(Number(event.target.value))} aria-label="网页最多详情数" /></Field></> : <p>当前页范围只读取 1 页列表，不打开岗位详情（详情上限为 0）。</p>}{!validCollectionBudget && <ErrorMessage message="请按标注范围填写整数；详情数量可以为 0。" />}<p>采集只访问本次招聘来源。登录、验证码、未知翻页或页面变化会停止；部分成功也会保留报告。</p></div></details>
        <div className="browser-panel-actions"><Button variant="secondary" disabled={!hasPage || browser.loading || !!busy || !validCollectionBudget} busy={busy === 'collect'} onClick={() => void action('collect', collect)}><Briefcase size={14} />{collectionScope === 'current-page' ? '采集当前页岗位' : `采集列表（最多 ${maxPages} 页）`}</Button><Button variant="ghost" disabled={!hasPage || browser.loading || !!busy} busy={busy === 'capture'} onClick={() => void action('capture', async () => { const page = await api.capturePage(); openJob(undefined, page); })}><FileText size={14} />手动保存这页为岗位</Button></div>
        {latestCollection && <CollectionReport run={latestCollection} compact />}
</details>
        <p className="browser-hint-footer">最终提交由你在网页中完成。网页可能即时保存输入，确认前请核对目标企业与资料。</p>
      </aside>;
  return <div className={`browser-page${embedded ? ' embedded-browser' : ''}`}>{!embedded&&<BrowserTabsBar disabled={!!busy||agentBusy||overlayOpen}/>}<div className="browser-toolbar"><button className="icon-button" disabled={!browser.canGoBack || navigationBlocked} aria-label="返回" onClick={() => void action('back', () => updateNavigation(() => api.browserBack()))}><ArrowLeft size={16} /></button><button className="icon-button" disabled={!browser.canGoForward || navigationBlocked} aria-label="前进" onClick={() => void action('forward', () => updateNavigation(() => api.browserForward()))}><ArrowRight size={16} /></button><button className="icon-button" disabled={!hasPage || navigationBlocked} aria-label="刷新" onClick={() => void action('reload', () => updateNavigation(() => api.browserReload()))}><RefreshCw size={15} className={browser.loading ? 'spin' : ''} /></button><form className="browser-address" onSubmit={event => { event.preventDefault(); void openAddress(); }}><ShieldCheck size={14} /><input ref={addressInput} aria-label="网页地址" aria-invalid={!!addressError} aria-describedby={addressError ? 'browser-address-error' : undefined} placeholder="输入招聘网址或域名，回车或点击打开" value={address} disabled={!!busy} onChange={event => { setAddress(event.target.value); setAddressDirty(true); setAddressError(undefined); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setAddress(displayBrowserAddress(browser.url)); setAddressDirty(false); setAddressError(undefined); } }} /><Button type="submit" variant="secondary" className="button-small" disabled={navigationBlocked} busy={busy === 'navigate'}>打开</Button></form><Button className="browser-auto-fill" title={automaticButtonLabel} data-testid="quick-fill" disabled={!hasPage || browser.loading || !!busy || overlayOpen || agentBusy} busy={autoLayout || careerBusy || universalBusy || busy === 'quick'} onClick={() => void autoFillPage()}><Sparkles size={18} /><span>{automaticButtonLabel}</span></Button><Button variant="secondary" data-testid="stop-auto-fill" disabled={!universalBusy && (!careerBusy || careerLocating) && !(busy === 'quick' && quickPhase !== 'filling')} onClick={() => { automaticCancelled.current = true; if(universalBusy){setQuickStatus('正在停止，等待已发出的页面操作结束…');void api.cancelUniversalFill?.();return;} if (careerBusy) void careerPanel.current?.stop(); else void stopRecognition(); }}>停止</Button><Button variant="secondary" className="button-small" disabled={viewportControlsDisabled} onClick={openApplicationSetup} data-testid="application-setup-open">填写设置</Button><Button variant="secondary" className="button-small browser-focus-toggle" data-testid="browser-focus-toggle" disabled={viewportControlsDisabled} aria-label={browserFocusMode ? '返回并排' : '专注网页'} aria-pressed={browserFocusMode} onClick={toggleBrowserFocus}>{browserFocusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}<span>{browserFocusMode ? '返回并排' : '专注网页'}</span></Button><label className="browser-zoom-control"><span className="browser-control-label">网页缩放</span><select data-testid="browser-zoom" aria-label="网页缩放" value={browser.zoomPercent ?? 100} disabled={!hasPage || viewportControlsDisabled} onChange={event => { const percent = Number(event.target.value); if (percent === 80 || percent === 90 || percent === 100) void changeBrowserZoom(percent); }}><option value={100}>100%</option><option value={90}>90%</option><option value={80}>80%</option></select></label><Button variant="secondary" className="button-small" disabled={navigationBlocked} onClick={() => void action('test', () => updateNavigation(() => api.openTestForm(), true))}>测试表单</Button><Button variant="secondary" className="button-small browser-panel-toggle" disabled={panelControlsDisabled || panelResizing} aria-label={detailsOpen ? '收起填写面板' : '展开填写面板'} aria-expanded={detailsOpen} aria-controls="browser-fill-panel" data-testid="browser-panel-toggle" title={panelControlsDisabled ? '请等待当前操作结束后调整布局' : detailsOpen ? '收起填写面板' : '查看填写详情'} onClick={() => { if (!panelControlsDisabled && !panelResizing) { if (embedded) onToggleDetails?.(); else setPanelLayout(current => ({ ...current, collapsed: !current.collapsed })); } }}>{detailsOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}<span>{embedded ? '填写详情' : detailsOpen ? '收起填写栏' : '展开填写栏'}</span></Button></div>
    <div className="browser-companion-strip" data-testid="page-auto-fill-status">
      <AgentCompanion status={companionStatus} runKey={petQueue?.id ?? plan?.id ?? `foreground-${operation.current}`} motionAllowed={speedsterAllowed} controlsLocked={externalReadOnlyBusy || !!nativeWriting&&!petQueue} onMotionOptions={options => { void api.setFieldCompanionMotion(options).catch(() => {}); }}
        message={externalReadOnlyBusy ? '正在只读核对或定位，不会修改表单。' : manualTiming ? '人工计时进行中，请手动填写并核对。' : petQueue?.status === 'running' ? petQueue.items.find(item => item.id === petQueue.activeItemId)?.message : petQueue?.status === 'finished' ? '后台已处理本组页面，请逐份检查草稿；复杂控件仍需要你完成。' : busy && retryNotice ? `正在重新核对并重试：${retryNotice.label}` : (feishuCareerPage ? careerStatus : universalResult ? (universalResult.failureCode || universalResult.status === 'failed' ? '本轮已中断，请查看待处理项。' : universalResult.status === 'cancelled' ? '本轮已停止。' : universalResult.pending ? `还有 ${universalResult.pending} 项待处理。` : '本轮核对完成，请检查网页。') : quickStatus) || '点击自动填写，或选择后台队列，让小助手按顺序准备申请。'}
        verifiedCount={petQueue ? petQueue.items.reduce((sum,item) => sum + item.verifiedCount, 0) : universalResult?.verified ?? currentCareerOutcome?.verifiedCount ?? fillSummary?.filled.length}
        pendingCount={companionPending} retry={busy ? retryNotice : undefined} queue={petQueue && petQueue.totalCount ? { completed: petQueue.completedCount, total: petQueue.totalCount } : undefined}
        action={!busy && !agentBusy && !overlayOpen ? { label: companionPending ? unansweredQuestions.length?'查看并补充':'核对未完成项' : '后台填写', onClick: () => petQueue ? onShowQueue?.() : companionPending ? onNeedsInfo?.() : onShowQueue?.() } : undefined}
        onStop={petQueue?.status === 'running' ? () => { void api.cancelApplicationQueue(); } : careerBusy ? () => { void careerPanel.current?.stop(); } : undefined} stopDisabled={careerLocating} />
      <button type="button" className="text-link companion-trace-link" data-testid="browser-telemetry" disabled={!!busy || careerBusy || autoLayout} onClick={() => embedded && !manualTiming ? onShowActivity?.() : navigate('telemetry')}>{manualTiming ? '结束计时' : '过程'}</button>
    </div>
    {!!unansweredQuestions.length && <section className="application-answer-alert" role="status" data-testid="application-answer-alert"><div className="answer-alert-icon"><MessageCircleQuestion size={21} /></div><div><strong>需要你回答 {unansweredQuestions.length} 个问题</strong></div><Button disabled={!!busy || automaticBusy || agentBusy || overlayOpen} onClick={revealAnswerGuide}><PixelArrow/>去回答</Button></section>}
    {addressError && <div id="browser-address-error" className="browser-address-error" role="alert">{addressError}</div>}
    <div ref={grid} className={`browser-grid browser-grid-adjustable ${panelLayout.collapsed ? 'browser-grid-panel-collapsed' : ''} ${panelResizing ? 'browser-grid-resizing' : ''}`} style={{ gridTemplateColumns: embedded || panelLayout.collapsed ? 'minmax(0, 1fr)' : `minmax(0, 1fr) ${Math.min(BROWSER_PANEL_HANDLE_WIDTH, Math.max(0, gridWidth))}px ${panelSize.width}px` }}><section className="browser-content"><div className="browser-content-heading"><span className="row"><Globe size={12} />{browser.title || '内置浏览器'}</span><span>{browser.loading ? '页面加载中…' : hasPage ? '可在网页中手动操作' : '打开招聘网站开始'}</span></div><div className="browser-placeholder" ref={holder}>{!hasPage && <EmptyState icon={<Globe size={30} />} title="企业官网，就在工作台里" description="输入招聘网址，可以浏览岗位、登录网申，再在右侧核对填写计划。" />}{(overlayOpen || panelResizing) && <div className="native-cover-note">{panelResizing ? '正在调整布局，松开后恢复网页' : '核对资料期间，网页暂时隐藏'}</div>}</div></section>
      {!embedded && !panelLayout.collapsed && <div ref={panelSeparator} className="browser-panel-resizer" role="separator" aria-orientation="vertical" aria-label="调整填写面板宽度" aria-controls="browser-fill-panel" aria-valuemin={panelSize.min} aria-valuemax={panelSize.max} aria-valuenow={panelSize.width} aria-valuetext={`填写面板宽度 ${panelSize.width} 像素`} aria-disabled={panelControlsDisabled} tabIndex={panelControlsDisabled ? -1 : 0} title="拖动调整宽度；方向键微调，Shift 加速，Home / End 到最窄 / 最宽" data-testid="browser-panel-resizer" onPointerDown={startPanelResize} onPointerMove={movePanelResize} onPointerUp={finishPanelResize} onPointerCancel={finishPanelResize} onLostPointerCapture={finishPanelResize} onKeyDown={event => {
        if (panelControlsDisabled || panelResizing) return;
        const preferredWidth = browserPanelWidthForKey(event.key, panelSize.width, gridWidth, event.shiftKey);
        if (preferredWidth === undefined) return;
        event.preventDefault(); setPanelLayout(current => ({ ...current, preferredWidth }));
      }} />}
      {embedded ? detailsContainer ? createPortal(fillPanel, detailsContainer) : null : fillPanel}</div>
  </div>;
}
