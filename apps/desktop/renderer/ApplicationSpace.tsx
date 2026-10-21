import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction, type PointerEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, ChartNoAxesCombined, ChevronLeft, ChevronRight, ListChecks, Search } from 'lucide-react';
import type { ApplyListBrowseState } from '../../../packages/ui/src/apply-list.js';
import type { BrowserPanelLayout } from '../../../packages/ui/src/browser-panel-layout.js';
import { applicationDockWidth, applicationDockWidthForKey } from '../../../packages/ui/src/application-space.js';
import { useWorkspace, type Page } from './context.js';
import { AgentPage } from './Agent.js';
import { BrowserPage } from './Browser.js';
import {BrowserTabsBar} from './BrowserTabs.js';
import {pruneBrowserPageMemory} from './browser-page-memory.js';
import { ApplyFlow } from './ApplyFlow.js';
import { TelemetryPage } from './Telemetry.js';
import { ApplicationTasks } from './ApplicationTasks.js';
import type { ApplicationWorkflow } from '../../../packages/shared/src/application-workflow.js';
import { QueuePanel } from './QueuePanel.js';
import type { ApplicationQueueState } from '../../../packages/shared/src/application-queue.js';
import { BACKGROUND_QUEUE_CAPABILITY } from '../../../packages/shared/src/application-queue.js';

type DockTab = 'chat' | 'activity' | 'details';
export function ApplicationSpace({ page, browseMemory, panelLayout, onPanelLayoutChange, onLayoutBusyChange, assistantCollapsed, onAssistantCollapsedChange, assistantPreferredWidth, onAssistantPreferredWidthChange }: {
  page: Page; browseMemory: RefObject<ApplyListBrowseState | undefined>; panelLayout: BrowserPanelLayout;
  onPanelLayoutChange: Dispatch<SetStateAction<BrowserPanelLayout>>; onLayoutBusyChange: (busy: boolean) => void;
  assistantCollapsed: boolean; onAssistantCollapsedChange: Dispatch<SetStateAction<boolean>>;
  assistantPreferredWidth: number; onAssistantPreferredWidthChange: Dispatch<SetStateAction<number>>;
}) {
  const { agentQuestion,api, state, setState, setBrowser, browser, agentBusy, navigate, overlayOpen, notify, browserFocusMode, toggleBrowserFocus } = useWorkspace();
  const [tab, setTab] = useState<DockTab>('chat');
  useEffect(()=>{if(agentQuestion){setTab('chat');onAssistantCollapsedChange(false);}},[agentQuestion?.id]);
  const effectiveFocus=browserFocusMode&&!agentQuestion;
  const [queue, setQueue] = useState<ApplicationQueueState>({ id: null, status: 'idle', profileVersion: null, items: [], completedCount: 0, totalCount: 0, activeItemId: null, sessionOnly: true, capability: BACKGROUND_QUEUE_CAPABILITY });
  const [queueRequest, setQueueRequest] = useState(0);
  const [recentPages, setRecentPages] = useState<Array<{url:string;label:string}>>([]);
  useEffect(()=>{if(browser.tabs)pruneBrowserPageMemory(browser.tabs.map(tab=>tab.id),browser.activeTabId,browser.documentRevision??0);},[browser.tabs,browser.activeTabId,browser.documentRevision]);
  const emptyBrowser = !browser.url || browser.url === 'about:blank';
  useEffect(() => {
    let current = true;
    if (emptyBrowser && typeof api.workflowState === 'function') void api.workflowState().then(saved => {
      if (!current) return; const seen = new Set<string>();
      const pages = [...saved.workflows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).flatMap(workflow => {
        let url:URL; try { url = new URL(workflow.target.url); } catch { return []; }
        if (url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) return [];
        seen.add(url.href); return [{url:url.href,label:url.hostname}];
      }).slice(0,5); setRecentPages(pages);
    }).catch(()=>{});
    return () => { current = false; };
  },[api,emptyBrowser]);
  useEffect(() => {
    let alive = true, eventReceived = false;
    const off = api.onEvent(event => { if (event.type === 'application-queue') { eventReceived = true; if (alive) setQueue(event.state); } });
    if (typeof api.queueState === 'function') void api.queueState().then(next => { if (alive && !eventReceived) setQueue(next); }).catch(() => {});
    return () => { alive = false; off(); };
  }, [api]);
  const collapsed = assistantCollapsed; const setCollapsed = onAssistantCollapsedChange;
  const preferredWidth = assistantPreferredWidth; const setPreferredWidth = onAssistantPreferredWidthChange;
  const [width, setWidth] = useState(1200); const [busy, setBusy] = useState(false); const [resizing, setResizing] = useState(false);
  const [readOnlyBusy, setReadOnlyBusy] = useState(false);
  const [detailsHost, setDetailsHost] = useState<HTMLDivElement | null>(null);
  const [resumeRequest, setResumeRequest] = useState<{ id: number; url: string; profileVersion: number }>();
  async function resumeApplication(workflow: ApplicationWorkflow) {
    if (locked || resizing) return;
    try {
      navigate('browser');
      if (browser.url !== workflow.target.url) setBrowser(await api.browserNavigate(workflow.target.url));
      await api.selectApplicationWorkflow(workflow.id);
      const current = await api.getState(); setState(current);
      setResumeRequest({ id: Date.now(), url: workflow.target.url, profileVersion: current.profile.version });
    } catch { notify('未能恢复申请页面，请打开原网页后再点自动填写。', true); }
  }
  const root = useRef<HTMLDivElement>(null), divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | undefined>(undefined);
  const fullTelemetry = page === 'telemetry';
  const recommendations = !fullTelemetry && page !== 'browser' && (page === 'apply' || emptyBrowser);
  const locked = busy || readOnlyBusy || agentBusy || overlayOpen;
  const controlsLocked = locked || resizing;
  const size = applicationDockWidth(preferredWidth, width);
  useLayoutEffect(() => {
    if (!root.current) return;
    const read = () => setWidth(root.current!.getBoundingClientRect().width);
    read(); const observer = new ResizeObserver(read); observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (page === 'agent' || fullTelemetry) setTab('chat'); }, [page, fullTelemetry]);
  function endResize() {
    const active = drag.current; drag.current = undefined; setResizing(false);
    try { if (active && divider.current?.hasPointerCapture(active.id)) divider.current.releasePointerCapture(active.id); } catch { /* Native view may have released capture. */ }
  }
  useEffect(() => {
    window.addEventListener('blur', endResize); return () => window.removeEventListener('blur', endResize);
  }, []);
  useEffect(() => { if (locked) endResize(); }, [locked]);
  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (locked || collapsed || browserFocusMode || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, width: size.width }; setResizing(true);
  }
  function selectTab(next: DockTab) {
    if (locked || resizing) return;
    if (browserFocusMode) toggleBrowserFocus();
    setTab(next); setCollapsed(false);
    if (next === 'details') onPanelLayoutChange(current => ({ ...current, collapsed: false }));
  }
  function showQueue() { if (controlsLocked) return; selectTab('chat'); setQueueRequest(value => value + 1); }
  const reportBusy = (value: boolean) => { setBusy(value); };
  // Stable callback identity matters: a new callback must not trigger BrowserPage's
  // cleanup (and release its execution lock) on each message/trace update.
  const reportRef = useRef(reportBusy); reportRef.current = reportBusy;
  const stableBusy = useRef((value: boolean) => reportRef.current(value)).current;
  useLayoutEffect(() => { onLayoutBusyChange(busy || readOnlyBusy || resizing); }, [busy, readOnlyBusy, resizing, onLayoutBusyChange]);
  useLayoutEffect(() => () => { onLayoutBusyChange(false); }, [onLayoutBusyChange]);
  return <div ref={root} className={`application-space${collapsed ? ' dock-collapsed' : ''}${resizing ? ' dock-resizing' : ''}${effectiveFocus ? ' browser-focus-space' : ''}`} data-testid="application-space" data-browser-focus={effectiveFocus} style={{ gridTemplateColumns: effectiveFocus ? '0px 0px minmax(0,1fr)' : `${collapsed ? 44 : size.width}px ${collapsed ? 0 : 7}px minmax(0,1fr)` }}>
    <aside className="workspace-dock" data-testid="workspace-dock" aria-label="Agent 与执行过程" hidden={browserFocusMode}>
      <div className="workspace-dock-tabs" role="tablist" aria-label="申请助手">
        <button role="tab" id="space-chat-tab" aria-controls="space-chat" aria-selected={tab === 'chat'} title="对话" disabled={controlsLocked} data-testid="workspace-tab-chat" onClick={() => selectTab('chat')}><Bot size={15} /><span>对话</span></button>
        <button role="tab" id="space-activity-tab" aria-controls="space-activity" aria-selected={tab === 'activity'} title="执行过程" disabled={controlsLocked} data-testid="workspace-tab-activity" onClick={() => selectTab('activity')}><ChartNoAxesCombined size={15} /><span>过程</span></button>
        <button role="tab" id="space-details-tab" aria-controls="space-details" aria-selected={tab === 'details'} title="填写详情" disabled={controlsLocked} data-testid="workspace-tab-details" onClick={() => selectTab('details')}><ListChecks size={15} /><span>详情</span></button>
        <button type="button" className="workspace-dock-toggle" aria-label={collapsed ? '展开 Agent 面板' : '收起 Agent 面板'} title={collapsed ? '展开 Agent 面板' : '收起 Agent 面板'} disabled={controlsLocked} data-testid="workspace-dock-toggle" onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button>
      </div>
      <div id="space-chat" role="tabpanel" aria-labelledby="space-chat-tab" className="workspace-dock-pane" hidden={tab !== 'chat' || collapsed || effectiveFocus}><AgentPage embedded inputLocked={(busy || readOnlyBusy || resizing) && !agentBusy}><QueuePanel api={api} queue={queue} state={state} busy={locked || resizing} onQueueState={setQueue} currentURL={browser.url} currentPageRequest={queueRequest} /><ApplicationTasks api={api} state={state} currentURL={browser.url} busy={locked || resizing} onState={setState} onProfile={() => navigate('profile')} onResume={resumeApplication} onLocatingChange={setReadOnlyBusy} /></AgentPage></div>
      <div id="space-activity" role="tabpanel" aria-labelledby="space-activity-tab" className="workspace-dock-pane workspace-activity" inert={controlsLocked || undefined} aria-busy={controlsLocked} hidden={tab !== 'activity' || collapsed}>{!fullTelemetry && <TelemetryPage compact />}</div>
      <div id="space-details" role="tabpanel" aria-labelledby="space-details-tab" className="workspace-dock-pane workspace-details" hidden={tab !== 'details' || collapsed} ref={setDetailsHost} />
    </aside>
    <div ref={divider} className="workspace-dock-resizer" role="separator" aria-label="调整 Agent 面板宽度" aria-orientation="vertical" aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={size.width} aria-disabled={locked || collapsed || effectiveFocus} tabIndex={locked || collapsed || browserFocusMode ? -1 : 0} data-testid="workspace-dock-resizer" onPointerDown={startResize} onPointerMove={event => { const active = drag.current; if (active && active.id === event.pointerId && !locked && !browserFocusMode) setPreferredWidth(applicationDockWidth(active.width + event.clientX - active.x, width).width); }} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={event => { if (locked || collapsed || browserFocusMode) return; const next = applicationDockWidthForKey(event.key, size.width, width, event.shiftKey); if (next !== undefined) { event.preventDefault(); setPreferredWidth(next); } }} />
    <section className="workspace-canvas" data-testid="workspace-browser">
      <div className="workspace-canvas-tabs"><div className="workspace-page-tabs"><button type="button" className={`workspace-browse-jobs${recommendations?' selected':''}`} disabled={controlsLocked} data-testid="workspace-show-jobs" onClick={()=>navigate('apply')}><Search size={13}/><span>找新岗位</span></button>{browser.tabs?.length?<BrowserTabsBar disabled={controlsLocked} selected={!recommendations&&!fullTelemetry}/>:<button type="button" className={!recommendations&&!fullTelemetry?'selected':''} disabled={controlsLocked} data-testid="workspace-show-web" onClick={()=>navigate('browser')}><ArrowUpRight size={13}/><span>{emptyBrowser?'打开网页':browser.title||'当前网页'}</span></button>}{fullTelemetry && <span className="workspace-current-label">执行与对比</span>}</div><span className="workspace-canvas-note">{readOnlyBusy ? '正在读取或定位，不会填写' : busy ? '正在处理当前表单' : '填写后核对，提交由你完成'}</span></div>
      {!recommendations && !fullTelemetry && emptyBrowser && recentPages.length>0 && <div className="card" data-testid="recent-application-pages" style={{margin:12,padding:12}}><strong>恢复已保存的申请页面</strong><p>只打开网页，不自动填写；网页草稿是否保留，以企业网站为准。</p><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{recentPages.map((item,index)=><button type="button" className="button button-secondary" data-testid={`restore-application-page-${index}`} key={item.url} disabled={controlsLocked} onClick={()=>{void api.browserNavigate(item.url).then(setBrowser).catch(()=>notify('页面未能恢复，请检查登录状态或在地址栏打开原网址。',true));}}>打开 {item.label}</button>)}</div></div>}
      <div className="workspace-browser-host" hidden={recommendations || fullTelemetry}>
        <BrowserPage embedded externalReadOnlyBusy={readOnlyBusy} active={!recommendations && !fullTelemetry && !resizing} resumeRequest={resumeRequest} panelLayout={panelLayout} onPanelLayoutChange={onPanelLayoutChange} onLayoutBusyChange={stableBusy} detailsContainer={detailsHost} detailsVisible={tab === 'details' && !collapsed && !browserFocusMode} onToggleDetails={() => selectTab(tab === 'details' ? 'chat' : 'details')} onShowDetails={() => { if (browserFocusMode) toggleBrowserFocus(); setTab('details'); setCollapsed(false); setPreferredWidth(360); }} onShowActivity={() => selectTab('activity')} onAutomaticStart={() => setTab(current => current === 'chat' ? 'chat' : 'activity')} queue={queue} onShowQueue={showQueue} onNeedsInfo={() => selectTab('details')} />
      </div>
      {recommendations && <div className="page-scroll workspace-recommendations" data-testid="workspace-recommendations"><ApplyFlow browseMemory={browseMemory} /></div>}
      {fullTelemetry && <div className="page-scroll workspace-telemetry-full"><TelemetryPage /></div>}
    </section>
  </div>;
}
