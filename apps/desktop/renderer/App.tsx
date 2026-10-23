import type {AgentQuestionRequest,AgentQuestionResponse} from '../../../packages/shared/src/agent-questions.js';
import {ApplicationQuestionBroker,applicationContext,applicationReportText,applicationReportIntent,APPLICATION_UI_READY_KEY,APPLICATION_REPORT_KEY,APPLICATION_ACTIVE_KEY,APPLICATION_LOCATE_KEY,APPLICATION_READONLY_KEY,sameApplicationContext,type ApplicationReport,type ApplicationReportKind} from '../../../packages/ui/src/application-fill-workflow.js';
import {ApplicationSetupDialog} from './ApplicationSetup.js';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowUpRight, Briefcase, Calendar, CheckCircle2, ChevronRight, Columns3, Globe, LayoutDashboard, LoaderCircle, Plus, Sparkles, Trash2, User, X } from 'lucide-react';
import type { AppState, Application, ApplicationInput, BrowserState, CapturedPage, JobInput, ModelStatus, SourceDefinition } from '../../../packages/shared/src/contracts.js';
import { Button, Badge, EmptyState, ErrorMessage, Field, Modal, Notice } from './components.js';
import { WorkspaceContext, createFormPreviewState, useWorkspace, type FormPreviewState, type Page, type Workspace } from './context.js';
import { agentUiReducer, canSubmitComposer, createAgentUiState, type AgentUiAction } from '../../../packages/ui/src/agent-state.js';
import { applicationStatuses, dateLabel, errorText, inputDate, recruitmentLabels, statusLabels } from './helpers.js';
import { MissionHome } from './MissionHome.js';
import { MissionProgress } from './MissionProgress.js';
import { missionCompletionFromSave, type MissionCompletion } from '../../../packages/ui/src/mission-progress.js';
import { Jobs } from './Jobs.js';
import { Applications } from './Applications.js';
import { ProfilePage } from './Profile.js';
import { BrowserPage } from './Browser.js';
import { AgentPage } from './Agent.js';
import { SourcesDialog } from './SourcesDialog.js';
import { ModelDialog } from './ModelSettings.js';
import { ApplyFlow } from './ApplyFlow.js';
import type { ApplyListBrowseState } from '../../../packages/ui/src/apply-list.js';
import { DEFAULT_BROWSER_PANEL_LAYOUT } from '../../../packages/ui/src/browser-panel-layout.js';
import { DEFAULT_BROWSER_VIEWPORT, toggleBrowserFocus as toggleViewportFocus, type BrowserViewportState } from '../../../packages/ui/src/browser-viewport.js';
import { Sidebar } from './Sidebar.js';
import { ApplicationSpace } from './ApplicationSpace.js';
import { ApplicationCalendar } from './ApplicationCalendar.js';
import { TelemetryPage } from './Telemetry.js';
import { OnboardingDialog } from './Onboarding.js';
import { hasPersonalProfile, ONBOARDING_STORAGE_KEY, pendingCareerConfirmationCount, readOnboardingReceipt, shouldOfferOnboarding, type OnboardingStep } from '../../../packages/ui/src/onboarding.js';

type Overlay = { kind: 'job'; input?: JobInput; capture?: CapturedPage } | { kind: 'application'; record?: Application | ApplicationInput } | { kind: 'sources' } | { kind: 'model' } | { kind: 'settings' } | {kind:'application-setup'};
const pages: Array<{ id: Page; label: string; icon: typeof LayoutDashboard; description: string }> = [
  { id: 'apply', label: '开始申请', icon: Sparkles, description: '确认简历 → 选择推荐岗位 → 一键填写网申' },
  { id: 'dashboard', label: '任务总览', icon: LayoutDashboard, description: '把机会与进展放在一起' },
  { id: 'jobs', label: '岗位库', icon: Briefcase, description: '管理已保存、导入和采集的岗位' },
  { id: 'applications', label: '申请进度', icon: Columns3, description: '从待核对到最终结果，记录每一个阶段' },
  { id: 'profile', label: '个人资料', icon: User, description: '你确认过的经历，是每一次推荐的依据' },
  { id: 'browser', label: '内置浏览器', icon: Globe, description: '浏览、核对与填写，在同一个工作台完成' },
  { id: 'telemetry', label: '执行过程与对比', icon: Sparkles, description: '查看每一步耗时、token 用量，记录人工与 Agent 的实际对比' },
  { id: 'agent', label: 'AI 助手', icon: Sparkles, description: '用自然语言处理任务，看见实际执行进度' },
];

export function App() {
  const api = window.offer;
  const [state, setState] = useState<AppState>(); const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [browser, setBrowser] = useState<BrowserState>({ url: '', title: '', loading: false, canGoBack: false, canGoForward: false, visible: false });
  const [model, setModel] = useState<ModelStatus>({ mode: 'demo', provider: '', modelId: '', configured: false });
  const [page, setPage] = useState<Page>(()=>{try{return sessionStorage.getItem(APPLICATION_REPORT_KEY)?'browser':'dashboard';}catch{return'dashboard';}}); const [overlay, setOverlay] = useState<Overlay>(); const [bootError, setBootError] = useState<string>();
  const applyListMemory = useRef<ApplyListBrowseState | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [assistantCollapsed, setAssistantCollapsed] = useState(true);
  const [assistantPreferredWidth, setAssistantPreferredWidth] = useState(320);
  const [browserViewport, setBrowserViewport] = useState<BrowserViewportState>({ ...DEFAULT_BROWSER_VIEWPORT });
  const [browserPanelLayout, setBrowserPanelLayout] = useState({ ...DEFAULT_BROWSER_PANEL_LAYOUT, collapsed: true });
  const [browserLayoutBusy, setBrowserLayoutBusy] = useState(false);
  const browserLayoutBusyRef = useRef(false);
  const reportBrowserLayoutBusy = useCallback((value: boolean) => { browserLayoutBusyRef.current = value; setBrowserLayoutBusy(value); }, []);
  const [resumeImportRequest, setResumeImportRequest] = useState(0); const [focusedProfile, setFocusedProfile] = useState(true);
  const [onboarding, setOnboarding] = useState<{ step: OnboardingStep; surface: 'dialog' | 'profile'; automatic: boolean }>();
  const onboardingChecked = useRef(false);
  const [toast, setToast] = useState<{ message: string; error: boolean }>(); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [demoBusy, setDemoBusy] = useState(false);
  const [missionCompletion, setMissionCompletion] = useState<MissionCompletion>();
  const [agentQuestion,setAgentQuestion]=useState<AgentQuestionRequest|null>(null);
  const [reportReading,setReportReading]=useState(false);const reportReadingRef=useRef(false);
  const [chat, dispatch] = useReducer(agentUiReducer, undefined, ()=>{const initial=createAgentUiState();try{const text=sessionStorage.getItem('offerflash.workbench-chat.v1');sessionStorage.removeItem('offerflash.workbench-chat.v1');if(text){const saved=JSON.parse(text);if(Array.isArray(saved.messages))initial.messages=saved.messages.filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.id==='string'&&typeof m.text==='string').slice(-150);if(typeof saved.composerDraft==='string')initial.composerDraft=saved.composerDraft;}}catch{}return initial;});
  const chatRef = useRef(chat); chatRef.current = chat;
  const dispatchChat = useCallback((action: AgentUiAction) => { chatRef.current = agentUiReducer(chatRef.current, action); dispatch(action); }, []);
  const [,setReportRevision]=useState(0);
  const reports=useRef(new Map<string,ApplicationReport>()),reportChoice=useRef<ApplicationReportKind|undefined>(undefined);
  const reportKey=(context:ApplicationReport['context'])=>JSON.stringify([context.profileVersion,context.tabId,context.documentRevision,context.url]);
  const recordApplicationReport=useCallback((report:ApplicationReport)=>{reports.current.set(reportKey(report.context),report);while(reports.current.size>20)reports.current.delete(reports.current.keys().next().value!);(window as any).__offerflashLastReport=report;setReportRevision(v=>v+1);},[]);
  const applicationQuestions=useRef<ApplicationQuestionBroker|undefined>(undefined);
  if(!applicationQuestions.current)applicationQuestions.current=new ApplicationQuestionBroker(()=>applicationContext(api),request=>setAgentQuestion(request),(request,result)=>dispatchChat({type:'application-messages',messages:[{id:request.id+'-prompt',role:'assistant',text:request.questions.map(q=>q.prompt).join('\n')},{id:request.id+'-reply',role:'user',text:result.status==='answered'?result.answers.map(a=>a.answer).join('\n'):result.status==='none'?'无 / 不适用':'本次暂时跳过'}]}));
  useEffect(()=>{try{sessionStorage.setItem(APPLICATION_UI_READY_KEY,'1');const raw=sessionStorage.getItem(APPLICATION_REPORT_KEY);sessionStorage.removeItem(APPLICATION_REPORT_KEY);if(raw){const report=JSON.parse(raw);if(report?.context&&report.result&&Array.isArray(report.result.remaining)&&typeof report.checkedAt==='string')recordApplicationReport(report);}}catch{}return()=>applicationQuestions.current?.cancel();},[recordApplicationReport]);
  async function showApplicationReport(kind:ApplicationReportKind){
    if(reportReadingRef.current)return;reportReadingRef.current=true;setReportReading(true);let token:string|undefined;
    try{const context=await applicationContext(api);let report=reports.current.get(reportKey(context)),note='';
      if(api.runUniversalFill&&!sessionStorage.getItem(APPLICATION_ACTIVE_KEY)){
        token=crypto.randomUUID();sessionStorage.setItem(APPLICATION_READONLY_KEY,JSON.stringify({id:token,context}));
        try{const result=await api.runUniversalFill({profileVersion:context.profileVersion,overwriteExisting:false});if(!sameApplicationContext(await applicationContext(api),context))throw Error('页面或资料变化，未采用旧回执。');report={context,checkedAt:new Date().toISOString(),result};recordApplicationReport(report);}
        catch{note='本次未取得新的回读，以下仅显示同一页面与资料版本的已有回执。\n\n';}
      }
      dispatchChat({type:'application-messages',messages:[{id:'report-'+crypto.randomUUID(),role:'assistant',text:note+applicationReportText(report,context,kind)}]});
    }finally{if(token){try{const current=JSON.parse(sessionStorage.getItem(APPLICATION_READONLY_KEY)??'null');if(current?.id===token)sessionStorage.removeItem(APPLICATION_READONLY_KEY);}catch{}}reportReadingRef.current=false;setReportReading(false);}
  }
  async function locateApplicationReview(report:ApplicationReport,target:import('../../../packages/ui/src/application-review.js').ApplicationReviewTarget){
    if(reportReadingRef.current||agentQuestion||chatRef.current.active)return;const context=await applicationContext(api);if(!sameApplicationContext(context,report.context))throw Error('页面或资料已变化，请先重新核对。');
    reportReadingRef.current=true;setReportReading(true);const id=crypto.randomUUID();
    try{sessionStorage.setItem(APPLICATION_LOCATE_KEY,JSON.stringify({id,context,target:{label:target.label,section:target.section,...(target.key?{key:target.key}:{})}}));
      if(!api.runUniversalFill)throw Error('安装包缺少定位接口');const result=await api.runUniversalFill({profileVersion:context.profileVersion,overwriteExisting:false});if(!sameApplicationContext(context,await applicationContext(api)))throw Error('页面已变化，旧定位已结束。');
      if(!result.location)throw Error('定位模块尚未加载，请稍后重试。');recordApplicationReport({context,checkedAt:new Date().toISOString(),result});notify(result.location.message,result.location.status!=='located');
    }finally{sessionStorage.removeItem(APPLICATION_LOCATE_KEY);reportReadingRef.current=false;setReportReading(false);}
  }
  const messages = chat.messages; const events = chat.events; const streamText = chat.active?.text ?? ''; const agentBusy = !!chat.active||!!agentQuestion||reportReading;
  const [formPreviews,setFormPreviews]=useState<Record<string,FormPreviewState|undefined>>({});
  const browserRef=useRef(browser);browserRef.current=browser;
  const formPreview=formPreviews[JSON.stringify([browser.activeTabId??'legacy',browser.documentRevision??0])];
  const setFormPreview=useCallback<import('react').Dispatch<import('react').SetStateAction<FormPreviewState|undefined>>>(update=>{
    const id=JSON.stringify([browserRef.current.activeTabId??'legacy',browserRef.current.documentRevision??0]);setFormPreviews(previous=>({...previous,[id]:typeof update==='function'?update(previous[id]):update}));
  },[]);
  useEffect(()=>{if(!browser.tabs)return;const ids=new Set(browser.tabs.map(tab=>tab.id));setFormPreviews(previous=>Object.keys(previous).some(key=>{const [id]=JSON.parse(key);return id!=='legacy'&&!ids.has(id);})?Object.fromEntries(Object.entries(previous).filter(([key])=>{const [id]=JSON.parse(key);return id==='legacy'||ids.has(id);})):previous);},[browser.tabs]);
  const browserFocusMode = browserViewport.mode === 'focus' && page === 'browser';
  const onboardingDialogOpen = onboarding?.surface === 'dialog';
  useEffect(() => {
    if (!state) return;
    if (!onboardingChecked.current) {
      onboardingChecked.current = true;
      let receipt;
      try { receipt = readOnboardingReceipt(localStorage.getItem(ONBOARDING_STORAGE_KEY)); } catch { /* Help still works when storage is unavailable. */ }
      if (shouldOfferOnboarding(state.profile, receipt)) setOnboarding({ step: 'import', surface: 'dialog', automatic: true });
    }
    // A restored/seeded profile must never leave a first-run dialog covering an existing user's work.
    if (onboarding?.automatic && onboarding.step === 'import' && onboarding.surface === 'dialog' && hasPersonalProfile(state.profile)) setOnboarding(undefined);
  }, [state?.profile, onboarding]);
  function finishOnboarding(completed = onboarding?.step === 'apply') {
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, status: completed ? 'completed' : 'skipped' })); } catch { /* Dismissing help must not depend on local storage. */ }
    setOnboarding(undefined);
  }
  function importForOnboarding() {
    setOverlay(undefined); setFocusedProfile(true); setPage('profile');
    setOnboarding(current => ({ step: 'import', surface: 'profile', automatic: current?.automatic ?? false }));
    setResumeImportRequest(value => value + 1);
  }
  useEffect(() => {
    // Temporary hiding must not become a new sidebar preference on another page.
    if (page !== 'browser') setBrowserViewport(current => current.mode === 'focus' ? { mode: 'split', zoomPercent: current.zoomPercent } : current);
  }, [page]);
  function toggleBrowserFocus() {
    if (page !== 'browser' || !browser.url || browser.url === 'about:blank' || browser.loading || browserLayoutBusyRef.current
      || browserLayoutBusy || !!chatRef.current.active || !!formPreview?.filling || !!overlay) return;
    const next = toggleViewportFocus(browserViewport, { navigationCollapsed: sidebarCollapsed, assistantCollapsed, assistantPreferredWidth });
    setBrowserViewport(next.state);
    // Focus uses a temporary zero-width layout. Keep stored preferences intact
    // while hidden, and restore the captured choices only when explicitly exiting.
    if (next.state.mode === 'split') {
      setSidebarCollapsed(next.layout.navigationCollapsed); setAssistantCollapsed(next.layout.assistantCollapsed);
      if (next.layout.assistantPreferredWidth !== undefined) setAssistantPreferredWidth(next.layout.assistantPreferredWidth);
    }
  }
  const notify = useCallback((message: string, error = false) => { clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(undefined), error ? 7000 : 4000); }, []);
  useEffect(() => {
    if (!api) { setBootError('请从 OfferFlash 桌面应用打开工作台。'); return; }
    let alive = true,questionEventReceived=false;
    const unsubscribe = api.onEvent(event => {
      if (!alive) return;
      if (event.type === 'state') setState(event.state);
      else if (event.type === 'browser') {browserRef.current=event.state;setBrowser(event.state);}
      else if (event.type === 'form-preview') { setFormPreview(createFormPreviewState(event.plan)); setPage('browser'); }
      else if (event.type === 'model') setModel(event.status);
      else if (event.type === 'navigate') setPage(event.page);
      else if (event.type === 'error') notify(event.message, true);
      else if(event.type==='agent-question'){questionEventReceived=true;setAgentQuestion(event.request);if(event.request)dispatchChat({type:'resume-question',request:event.request});}
      else if(event.type==='agent-question-answered'){questionEventReceived=true;dispatchChat({type:'question-answer',request:event.request,result:event.result});setAgentQuestion(current=>current?.id===event.request.id?null:current);}
      else if (event.type === 'agent') dispatchChat({ type: 'event', event: event.event });
    });
    if(api.pendingAgentQuestion)void api.pendingAgentQuestion().then(request=>{if(alive&&!questionEventReceived&&request){setAgentQuestion(request);dispatchChat({type:'resume-question',request});}}).catch(()=>{});
    void Promise.all([api.getState(), api.getSources(), api.browserState(), api.modelStatus()]).then(([initial, available, initialBrowser, status]) => { if (alive) { setState(initial); setSources(available); setBrowser(initialBrowser); setModel(status); } }).catch(error => { if (alive) setBootError(errorText(error)); });
    return () => { alive = false; unsubscribe(); clearTimeout(toastTimer.current); };
  }, [api, notify, dispatchChat]);
  useEffect(() => { if (api && !['browser', 'agent', 'apply', 'telemetry'].includes(page)) void api.browserBounds({ x: 0, y: 0, width: 0, height: 0 }, false).catch(() => {}); }, [api, page]);
  const showOverlay = (next: Overlay) => { void api.browserBounds({ x: 0, y: 0, width: 0, height: 0 }, false).catch(() => {}).finally(() => setOverlay(next)); };
  async function openBrowser(url: string) { if (!url.trim()) { notify('这条记录还没有填写来源链接', true); return; } try { setBrowser(await api.browserNavigate(url)); setPage('browser'); } catch (error) { notify(errorText(error), true); } }
  async function answerAgentQuestion(response:AgentQuestionResponse){try{if(applicationQuestions.current?.current()?.id===response.requestId){await applicationQuestions.current.respond(response);return;}const choice=response.answers.map(a=>agentQuestion?.questions.find(q=>q.id===a.questionId)?.options?.find(o=>o.id===a.optionId)?.label??a.text??'').join('');const kind=applicationReportIntent(choice);if(kind&&agentQuestion?.questions.some(q=>/查看|核对|待处理/.test(q.prompt)))reportChoice.current=kind;await api.respondAgentQuestion(response);}catch(error){notify(errorText(error),true);throw error;}}
  async function runAgent(input: string) {
    if (!canSubmitComposer(input, !!chatRef.current.active)) return;
    const reportIntent=applicationReportIntent(input);if(reportIntent){dispatchChat({type:'draft',text:''});dispatchChat({type:'application-messages',messages:[{id:'report-request-'+crypto.randomUUID(),role:'user',text:input}]});await showApplicationReport(reportIntent);return;}
    const requestId = crypto.randomUUID();
    dispatchChat({ type: 'start', requestId, input, startedAt: Date.now() });
    try {
      const result = await api.runAgent(input);
      const failure = result.events.findLast(event => event.taskId === result.taskId && event.type === 'task_error');
      dispatchChat({ type: 'finish', requestId, taskId: result.taskId, status: result.status, finalText: result.finalText,
        ...(typeof failure?.data.message === 'string' ? { error: errorText(failure.data.message) } : {}) });
      if(reportChoice.current){const kind=reportChoice.current;reportChoice.current=undefined;await showApplicationReport(kind);}
    } catch (error) {
      dispatchChat({ type: 'finish', requestId, status: 'failed', finalText: '', error: errorText(error) });
    }
  }
  function restoreAgentRequest(messageId: string) {
    if (chatRef.current.composerDraft.trim()) { notify('输入框已有新草稿，请先保留或清空它，再恢复之前的问题。'); return; }
    const action: AgentUiAction = { type: 'restore', messageId };
    if (agentUiReducer(chatRef.current, action) === chatRef.current) return;
    dispatchChat(action); notify('问题已放回输入框，核对后再手动发送。');
  }
  async function demo(clear = false) { setDemoBusy(true); try { setState(await (clear ? api.clearDemo() : api.loadDemo())); notify(clear ? '虚构演示记录已清除，你的真实资料保留' : '已载入独立标记的虚构演示岗位与申请记录'); } catch (error) { notify(errorText(error), true); } finally { setDemoBusy(false); } }
  async function exportData() { try { const result = await api.exportData(); if (!result.cancelled) notify('数据已导出到你选择的位置'); } catch (error) { notify(errorText(error), true); } }
  if (bootError && !state) return <div className="loading-page"><div className="brand-mark"><Briefcase size={22} /></div><h2>工作台暂时没有连接上</h2><p>{bootError}</p><Button onClick={() => window.location.reload()}>重新打开工作台</Button></div>;
  if (!state) return <div className="loading-page"><LoaderCircle className="spin" size={27} /><span>正在准备你的本地工作台…</span></div>;
  const isApplicationSpace = ['browser', 'agent', 'apply', 'telemetry'].includes(page);
  const currentPage = pages.find(item => item.id === page)!;
  const context: Workspace = {
    api, state, sources, browser, model, agentBusy,agentQuestion,answerAgentQuestion,askApplicationQuestion:typeof api.respondAgentQuestion==='function'?(...args)=>applicationQuestions.current!.ask(...args):undefined,cancelApplicationQuestion:()=>applicationQuestions.current?.cancel(),currentApplicationReport:reports.current.get(reportKey({profileVersion:state.profile.version,tabId:browser.activeTabId??'legacy',documentRevision:browser.documentRevision??0,url:browser.url})),locateApplicationReview,recordApplicationReport,getApplicationReport:context=>reports.current.get(reportKey(context)),showApplicationReport, messages, events, streamText, overlayOpen: !!overlay || onboardingDialogOpen, browserFocusMode, toggleBrowserFocus,
    composerDraft: chat.composerDraft, setComposerDraft: text => dispatchChat({ type: 'draft', text }), restoreAgentRequest,
    formPreview, setFormPreview,
    setState, setBrowser, setModel, navigate: next => { if (next === 'profile') setFocusedProfile(false); setPage(next); }, openBrowser, notify, runAgent,
    openJob: (input, capture) => showOverlay({ kind: 'job', ...(input ? { input } : {}), ...(capture ? { capture } : {}) }),
    openApplication: record => showOverlay({ kind: 'application', ...(record ? { record } : {}) }),
    openApplicationSetup:()=>showOverlay({kind:'application-setup'}),openSources: () => showOverlay({ kind: 'sources' }), openModel: () => showOverlay({ kind: 'model' }),
    startResumeImport: () => { setFocusedProfile(true); setPage('profile'); setResumeImportRequest(value => value + 1); },
  };
  const showDemo = state.settings.showDemo && state.jobs.some(job => job.demo);
  return <WorkspaceContext.Provider value={context}><div className={`app-shell workbench${sidebarCollapsed ? ' sidebar-collapsed' : ''}${isApplicationSpace ? ' in-application-space' : ''}${browserFocusMode ? ' browser-focus-mode' : ''}`}><Sidebar page={page} collapsed={sidebarCollapsed} layoutLocked={browserLayoutBusy || !!formPreview?.filling || agentBusy} applicationCount={state.applications.length} showDemo={showDemo} demoBusy={demoBusy} onToggle={() => setSidebarCollapsed(value => !value)} onNavigate={next => { if (next === 'profile') setFocusedProfile(false); setPage(next); }} onReviewProfile={() => setPage('profile')} onDemo={() => void demo(showDemo)} onExport={() => void exportData()} onSettings={() => showOverlay({ kind: 'settings' })} />
      <main className="workspace"><header className="topbar"><div className="console-page-title"><span className="pixel-label">OFFERFLASH / WORKSPACE</span><h1>{currentPage.label}</h1></div><div className="topbar-right"><MissionProgress state={state} completion={missionCompletion} /><span className="date-pill"><Calendar size={12} />{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span><span className="avatar">{state.profile.fullName.slice(0, 1) || '我'}</span></div></header>
        {showDemo && <div style={{ padding: page === 'browser' ? '0 27px 12px' : '0 36px 16px' }}><div className="demo-banner"><Badge tone="amber">虚构演示</Badge><span>带演示标记的公司、岗位和申请没有真实投递；真实记录独立保留。</span><button className="text-link" disabled={demoBusy} onClick={() => void demo(true)}>清除演示<X size={12} /></button></div></div>}
        {isApplicationSpace ? <ApplicationSpace page={page} browseMemory={applyListMemory} panelLayout={browserPanelLayout} onPanelLayoutChange={setBrowserPanelLayout} onLayoutBusyChange={reportBrowserLayoutBusy} assistantCollapsed={assistantCollapsed} onAssistantCollapsedChange={setAssistantCollapsed} assistantPreferredWidth={assistantPreferredWidth} onAssistantPreferredWidthChange={setAssistantPreferredWidth} /> : page !== 'profile' ? <div className="page-scroll">{page === 'dashboard' ? <MissionHome /> : page === 'jobs' ? <Jobs /> : <Applications />}</div> : null}<div className="page-scroll" style={{ display: page === 'profile' ? undefined : 'none' }}><ProfilePage importRequest={resumeImportRequest} focused={focusedProfile} onboardingStep={onboarding?.surface === 'profile' && onboarding.step !== 'apply' ? onboarding.step : undefined} onResumeImportResult={result => { if (result === 'imported') setOnboarding(current => current?.surface === 'profile' ? { ...current, step: 'review' } : current); }} onOnboardingConfirmed={() => setOnboarding(current => current ? { ...current, step: 'apply', surface: 'dialog' } : current)} onDismissOnboarding={() => finishOnboarding(false)} /></div>
      </main>{overlay?.kind === 'job' && <JobDialog key={overlay.input?.id ?? overlay.capture?.url ?? 'new-job'} input={overlay.input} capture={overlay.capture} onClose={() => setOverlay(undefined)} />}{overlay?.kind === 'application' && <ApplicationDialog key={overlay.record?.id ?? 'new-application'} onRecorded={completion => { if (completion) setMissionCompletion(completion); }} record={overlay.record} onClose={() => setOverlay(undefined)} />}{overlay?.kind === 'sources' && <SourcesDialog onClose={() => setOverlay(undefined)} />}{overlay?.kind==='application-setup'&&<ApplicationSetupDialog onClose={()=>setOverlay(undefined)}/>} {overlay?.kind === 'model' && <ModelDialog onClose={() => setOverlay(undefined)} />}{overlay?.kind === 'settings' && <Modal title="设置与工具" description="按需要配置，申请主流程保持简单" onClose={() => setOverlay(undefined)}><div className="workbench-settings"><Button variant="secondary" onClick={()=>showOverlay({kind:'application-setup'})}>网申资料引导</Button><Button variant="secondary" onClick={() => showOverlay({ kind: 'model' })}>模型服务与 API</Button><Button variant="secondary" onClick={() => showOverlay({ kind: 'sources' })}>招聘来源</Button><Button variant="secondary" onClick={() => void exportData()}>导出本地资料</Button><Button variant="secondary" data-testid="onboarding-reopen" onClick={() => { setOverlay(undefined); setOnboarding({ step: 'import', surface: 'dialog', automatic: false }); }}>重新查看上手引导</Button><details><summary>演示资料</summary><p>演示岗位与真实资料独立标记。</p><Button variant="ghost" disabled={demoBusy} onClick={() => void demo(showDemo)}>{showDemo ? '清除虚构演示' : '载入虚构演示'}</Button></details></div></Modal>}
      {onboardingDialogOpen && onboarding && <OnboardingDialog step={onboarding.step === 'apply' ? 'apply' : 'import'} pendingCount={pendingCareerConfirmationCount(state.profile)} onImport={importForOnboarding} onBrowse={() => { finishOnboarding(true); setPage('apply'); }} onSkip={() => finishOnboarding()} />}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <X size={16} /> : <CheckCircle2 size={16} />}<span>{toast.message}</span><button className="icon-button" onClick={() => setToast(undefined)} aria-label="关闭提示" style={{ color: '#cbdad0' }}><X size={14} /></button></div>}
    </div></WorkspaceContext.Provider>;
}

function JobDialog({ input, capture, onClose }: { input?: JobInput; capture?: CapturedPage; onClose: () => void }) {
  const { api, state, setState, notify } = useWorkspace();
  const [draft, setDraft] = useState<JobInput>(() => input ?? { company: '', title: capture?.title ?? '', city: state.profile.cities[0] ?? '', type: 'unknown', description: capture?.text.slice(0, 30000) ?? '', requirements: '', url: capture?.url ?? '', sourceId: capture ? 'browser-manual' : 'manual', sourceName: capture ? '浏览器人工确认' : '手动添加', publishedAt: null, deadline: null, demo: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  function change<K extends keyof JobInput>(key: K, value: JobInput[K]) { setDraft(current => ({ ...current, [key]: value })); }
  async function save() {
    setBusy(true); setError(undefined);
    const payload: JobInput = { ...(draft.id ? { id: draft.id } : {}), company: draft.company, title: draft.title, city: draft.city, type: draft.type, description: draft.description, requirements: draft.requirements, url: draft.url, sourceId: draft.sourceId, sourceName: draft.sourceName, ...(draft.observedAt ? { observedAt: draft.observedAt } : {}), publishedAt: draft.publishedAt, deadline: draft.deadline, demo: draft.demo };
    try { setState(await api.saveJob(payload)); notify('岗位已保存，匹配理由已更新'); onClose(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title={draft.id ? '查看与编辑岗位' : '保存一个招聘机会'} description="只保存你已核对的信息；没有官网发布日期或截止日期时，可以留空" wide onClose={() => { if (!busy) onClose(); }} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button busy={busy} disabled={!draft.company.trim() || !draft.title.trim() || !draft.url.trim()} onClick={() => void save()}>确认保存岗位</Button></>}><ErrorMessage message={error} />{capture && <div style={{ marginBottom: 17 }}><Notice tone="warning">网页标题和文本只是候选信息，请确认公司、岗位名称与招聘类型。没有核对的内容不会自动变成正式岗位。</Notice></div>}{draft.demo && <div style={{ marginBottom: 17 }}><Notice tone="warning">这是一条虚构演示岗位，修改后仍保留演示标记。</Notice></div>}<div className="form-grid"><Field label="公司" required><input placeholder="企业名称" value={draft.company} onChange={event => change('company', event.target.value)} /></Field><Field label="岗位名称" required><input placeholder="官网中的准确职位名称" value={draft.title} onChange={event => change('title', event.target.value)} /></Field><Field label="城市"><input placeholder="未知可留空" value={draft.city} onChange={event => change('city', event.target.value)} /></Field><Field label="招聘类型"><select value={draft.type} onChange={event => change('type', event.target.value as JobInput['type'])}>{Object.entries(recruitmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><div className="field-full"><Field label="来源链接" required><input type="url" placeholder="https://..." value={draft.url} onChange={event => change('url', event.target.value)} /></Field></div><Field label="官网发布日期"><input type="date" value={inputDate(draft.publishedAt)} onChange={event => change('publishedAt', event.target.value || null)} /></Field><Field label="投递截止日期"><input type="date" value={inputDate(draft.deadline)} onChange={event => change('deadline', event.target.value || null)} /></Field><div className="field-full"><Field label="岗位要求"><textarea rows={4} placeholder="毕业年份、技能、学历、经验等原始要求" value={draft.requirements} onChange={event => change('requirements', event.target.value)} /></Field></div><div className="field-full"><Field label="岗位描述 / 当前页文本"><textarea rows={6} value={draft.description} onChange={event => change('description', event.target.value)} /></Field></div></div></Modal>;
}

function ApplicationDialog({ record, onClose, onRecorded }: { record?: Application | ApplicationInput; onClose: () => void; onRecorded?: (completion: MissionCompletion | undefined) => void }) {
  const { api, state, setState, notify, openBrowser } = useWorkspace();
  const [draft, setDraft] = useState<ApplicationInput>(() => ({ ...(record?.id ? { id: record.id } : {}), ...(record?.jobId ? { jobId: record.jobId } : {}), company: record?.company ?? '', title: record?.title ?? '', url: record?.url ?? '', status: record?.status ?? 'saved', deadline: record?.deadline ?? null, notes: record?.notes ?? '' }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const history = record && 'history' in record ? record.history : [];
  function change<K extends keyof ApplicationInput>(key: K, value: ApplicationInput[K]) { setDraft(current => ({ ...current, [key]: value })); }
  async function save() {
    setBusy(true); setError(undefined);
    const payload: ApplicationInput = { ...(draft.id ? { id: draft.id } : {}), ...(draft.jobId ? { jobId: draft.jobId } : {}), company: draft.company, title: draft.title, url: draft.url, status: draft.status, deadline: draft.deadline, notes: draft.notes };
    const beforeApplications = state.applications;
    try { const next = await api.saveApplication(payload); setState(next);
      // Presentation feedback consumes only this successful, explicit manual save.
      // It must never turn a saved application into a UI failure.
      try { onRecorded?.(missionCompletionFromSave(beforeApplications, next.applications, payload, crypto.randomUUID())); } catch { /* Achievement feedback is optional. */ }
      notify('申请记录已保存'); onClose(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function remove() { if (!draft.id) return; setBusy(true); try { setState(await api.deleteApplication(draft.id)); notify('申请记录已删除'); onClose(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  return <Modal title={draft.id ? '这份申请的下一步' : '记录一份申请'} description="待核对表示尚未确认投递进度；选择实际状态后保存。网页填写完成不会自动等于已投递" onClose={() => { if (!busy) onClose(); }} footer={<>{draft.id && <Button variant="danger" disabled={busy} onClick={() => void remove()}><Trash2 size={13} />删除</Button>}<Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button busy={busy} disabled={!draft.company.trim() || !draft.title.trim()} onClick={() => void save()}>保存记录</Button></>}><ErrorMessage message={error} /><div className="form-grid"><Field label="公司" required><input value={draft.company} onChange={event => change('company', event.target.value)} /></Field><Field label="岗位" required><input value={draft.title} onChange={event => change('title', event.target.value)} /></Field><Field label="当前状态"><select value={draft.status} onChange={event => change('status', event.target.value as ApplicationInput['status'])}>{applicationStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></Field><Field label="下一事项截止日期"><input type="date" value={inputDate(draft.deadline)} onChange={event => change('deadline', event.target.value || null)} /></Field><div className="field-full"><Field label="申请网址（可选）"><div className="row"><input type="url" placeholder="https://..." value={draft.url} onChange={event => change('url', event.target.value)} />{draft.url && <button className="icon-button" aria-label="打开申请页面" onClick={() => { onClose(); void openBrowser(draft.url); }}><ArrowUpRight size={17} /></button>}</div></Field></div><div className="field-full"><Field label="备注与下一步"><textarea rows={4} placeholder="例如：收到测评邮件，周五前完成；或记录面试时间与联系人" value={draft.notes} onChange={event => change('notes', event.target.value)} /></Field></div></div>{draft.id && <details className="details-section"><summary>简历版本与笔试 / 面试日程</summary><ApplicationCalendar applicationId={draft.id} /></details>}{history.length > 0 && <><div className="divider" /><h3 className="form-section-title">状态历史</h3><div className="history-list">{[...history].reverse().map((item, index) => <div className="history-item" key={`${item.at}-${index}`}><span className="history-item-date">{dateLabel(item.at, true)}</span><div><Badge>{statusLabels[item.status]}</Badge>{item.note && <div className="history-note">{item.note}</div>}</div></div>)}</div></>}</Modal>;
}
