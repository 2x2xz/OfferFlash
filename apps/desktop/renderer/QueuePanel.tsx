import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ListOrdered, Play, Square, X } from 'lucide-react';
import type { AppState } from '../../../packages/shared/src/contracts.js';
import type { ApplicationQueueStartInput, ApplicationQueueState, ApplicationQueueItemStatus } from '../../../packages/shared/src/application-queue.js';
import { BACKGROUND_QUEUE_CAPABILITY } from '../../../packages/shared/src/application-queue.js';
import { queueCurrentPageCandidates, queueJobHostname } from '../../../packages/ui/src/companion.js';
import './QueuePanel.css';

export interface QueuePanelAPI {
  enqueueApplications(input: ApplicationQueueStartInput): Promise<ApplicationQueueState>;
  startApplicationQueue(): Promise<ApplicationQueueState>;
  cancelApplicationQueue(): Promise<ApplicationQueueState>;
  reviewQueuedApplication(id: string): Promise<void>;
  closeQueuedApplication(id: string): Promise<ApplicationQueueState>;
}
export interface QueuePanelProps {
  api: QueuePanelAPI; queue: ApplicationQueueState; state: AppState; busy?: boolean;
  onQueueState?: (state: ApplicationQueueState) => void; onReview?: (id: string) => void | Promise<void>;
  currentURL?: string; currentPageRequest?: number;
}
const labels: Record<ApplicationQueueItemStatus, string> = {
  queued: '排队中', loading: '打开页面中', filling: '填写并核对中', 'ready-for-review': '等你核对', 'waiting-user': '需要你处理', cancelled: '已取消',
};
export function QueuePanel({ api, queue, state, busy = false, onQueueState, onReview, currentURL = '', currentPageRequest = 0 }: QueuePanelProps) {
  const [selected, setSelected] = useState<string[]>([]), [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState(false), [useCurrentPage, setUseCurrentPage] = useState(false), [currentPageJobId, setCurrentPageJobId] = useState('');
  const [closingId, setClosingId] = useState('');
  const [useModel,setUseModel]=useState(false),[concurrency,setConcurrency]=useState<1|3|5>(1);
  const lastPageRequest = useRef(0);
  const operationInFlight = useRef(false);
  const jobs = state.jobs.filter(job => !job.demo || state.settings.showDemo);
  const currentCandidates = queueCurrentPageCandidates(jobs, currentURL);
  useEffect(() => {
    if (currentPageRequest > 0 && currentPageRequest !== lastPageRequest.current) { lastPageRequest.current = currentPageRequest; setExpanded(true); setPicker(true); }
  }, [currentPageRequest]);
  useEffect(() => { setUseCurrentPage(false); setCurrentPageJobId(''); }, [currentURL]);
  const locked = busy || working; const running = queue.status === 'running';
  const selectedJobs = selected.filter(id => jobs.some(job => job.id === id && queueJobHostname(job.url)));
  const currentSelectionValid = useCurrentPage && currentCandidates.some(job => job.id === currentPageJobId);
  const startJobs = useCurrentPage ? currentSelectionValid ? [currentPageJobId] : [] : selectedJobs;
  async function act(operation: () => Promise<ApplicationQueueState>) {
    if (working || operationInFlight.current) return; operationInFlight.current = true; setWorking(true); setError('');
    try { onQueueState?.(await operation()); } catch { setError('队列操作未完成。请保留当前页面，稍后重试。'); } finally { operationInFlight.current = false; setWorking(false); }
  }
  async function review(id: string) {
    if (locked || running || operationInFlight.current) return;
    operationInFlight.current = true; setWorking(true); setError('');
    try { if (onReview) await onReview(id); else await api.reviewQueuedApplication(id); }
    catch { setError('暂时无法打开这份草稿。队列草稿仅保留在本次应用运行期间。'); }
    finally { operationInFlight.current = false; setWorking(false); }
  }
  return <details className="queue-panel" data-testid="queue-panel" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><ListOrdered size={14} /><span>后台填写队列</span>{queue.totalCount > 0 && <small>{queue.completedCount} / {queue.totalCount}</small>}<ChevronRight size={13} /></summary>
    <p className="queue-explainer">草稿在独立后台页面准备，可选择1、3、5并发。模型模式由在线Agent观察、决定映射并调用填写工具；失败不回退规则。登录和最终提交由你完成。</p>
    {queue.executionMode==='model-agent'&&<p className="queue-footnote">模型Agent · 并发{queue.concurrency??1} · 当前进行{queue.activeItemIds?.length??0}项 · 已结束任务模型请求{queue.items.reduce((n,i)=>n+(i.modelRequests??0),0)}次 · 用量在任务结束后汇总</p>}
    {error && <p role="alert" className="queue-error">{error}</p>}
    {queue.items.length > 0 && <>
      <div className="queue-progress" aria-label="已处理的队列任务"><progress max={Math.max(1, queue.totalCount)} value={queue.completedCount} /><span>{queue.completedCount}/{queue.totalCount} 家已处理</span></div>
      <ol className="queue-items">{queue.items.map((item, index) => <li key={item.id} data-testid="queue-item" data-status={item.status}>
        <span className="queue-item-number">{index + 1}</span><div><strong>{item.company}</strong><span className="queue-item-title">{item.title}</span><p>{item.message || labels[item.status]}</p><small>{labels[item.status]}{item.verifiedCount > 0 ? ` · 核实 ${item.verifiedCount} 项` : ''}{item.pendingCount > 0 ? ` · 待处理 ${item.pendingCount} 项` : ''}</small></div>
        {item.modelRequests!==undefined&&<small>真实模型 {item.modelRequests} 次 · {item.modelTokens===null?'token用量未知':`${item.modelTokens??0} token`}</small>}
        {item.canReview && <div className="queue-item-actions"><button type="button" disabled={locked || running} data-testid="queue-review" onClick={() => void review(item.id)}>查看草稿</button><button type="button" disabled={locked || ['loading', 'filling'].includes(item.status)} data-testid="queue-close" onClick={() => setClosingId(item.id)}>关闭草稿</button></div>}
        {closingId === item.id && <div className="queue-close-confirm" role="group" aria-label="确认关闭草稿"><p>关闭会丢失这份网页尚未保存的内容，确定关闭？</p><button type="button" disabled={locked} data-testid="queue-close-confirm" onClick={() => void act(async () => { const next = await api.closeQueuedApplication(item.id); setClosingId(''); return next; })}>确认关闭</button><button type="button" disabled={working} onClick={() => setClosingId('')}>保留草稿</button></div>}
      </li>)}</ol>
      <div className="queue-controls">{queue.status === 'idle' && queue.items.some(item => item.status === 'queued') && <button type="button" disabled={locked} data-testid="queue-start-existing" onClick={() => void act(() => api.startApplicationQueue())}><Play size={12} />开始队列</button>}{['running', 'paused'].includes(queue.status) && <button type="button" disabled={working} data-testid="queue-cancel" onClick={() => void act(() => api.cancelApplicationQueue())}><Square size={12} />取消剩余</button>}</div>
      <p className="queue-footnote">“已处理”包括等待你接管的项目，不表示已投递。请逐份核对网页后自行提交。</p>
    </>}
    {!running && queue.status !== 'paused' && <><button type="button" className="queue-create" disabled={locked} aria-expanded={picker} onClick={() => setPicker(value => !value)}>{picker ? <X size={12} /> : <ListOrdered size={12} />}{picker ? '收起选择' : queue.items.length ? '新建一组填写任务' : '选择岗位加入队列'}</button>
      {picker && <div className="queue-picker" data-testid="queue-picker">
        <p>每轮最多选择 6 家，只处理你明确勾选的岗位。</p>
        <label><input type="checkbox" checked={useModel} disabled={locked} onChange={e=>setUseModel(e.target.checked)} />使用真实模型Agent（先在模型设置连接百炼 qwen-flash）</label>
        <label>同时处理 <select aria-label="后台并发数" value={concurrency} disabled={locked} onChange={e=>setConcurrency(Number(e.target.value) as 1|3|5)}><option value="1">1 家</option><option value="3">3 家</option><option value="5">5 家</option></select></label>
        {currentURL && <><label className="queue-current-page"><input type="checkbox" data-testid="queue-use-current-page" disabled={locked || !currentCandidates.length} checked={useCurrentPage} onChange={event => { setUseCurrentPage(event.target.checked); setCurrentPageJobId(''); }} /><span>用当前已打开的申请页<span>请选择对应岗位，不按同一网站猜测</span></span></label>
          {!currentCandidates.length && <p className="queue-footnote">岗位库里还没有与当前网页同官网的岗位，请先保存正确的岗位入口。</p>}
          {useCurrentPage && <div className="queue-job-list" data-testid="queue-current-page-jobs">{currentCandidates.map(job => <label key={job.id}><input type="radio" name="queue-current-page-job" disabled={locked} checked={currentPageJobId === job.id} onChange={() => setCurrentPageJobId(job.id)} /><span><strong>{job.company}</strong><small>{job.title}</small><small className="queue-job-host" data-testid="queue-job-host">{queueJobHostname(job.url)}</small></span></label>)}</div>}
        </>}
        {!useCurrentPage && (!jobs.length ? <p>先在岗位库保存带官网申请地址的岗位。</p> : <div className="queue-job-list">{jobs.map(job => { const host = queueJobHostname(job.url); return <label key={job.id} data-unavailable={!host}><input type="checkbox" disabled={locked || !host || selectedJobs.length >= 6 && !selected.includes(job.id)} checked={selected.includes(job.id)} onChange={event => setSelected(current => event.target.checked ? [...new Set([...current, job.id])] : current.filter(id => id !== job.id))} /><span><strong>{job.company}</strong><small>{job.title}</small><small className="queue-job-host" data-testid="queue-job-host">{host || '无可用 HTTPS 官网，暂不可选'}</small></span></label>; })}</div>)}
        <label className="queue-acknowledge"><input type="checkbox" data-testid="queue-autosave-ack" disabled={locked} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>我了解网页可能自动保存填写内容；不会自动提交申请。</span></label>
        <button type="button" data-testid="queue-start" disabled={locked || !acknowledged || !startJobs.length || startJobs.length > 6} onClick={() => void act(async () => { const queued = await api.enqueueApplications({ jobIds: startJobs, profileVersion: state.profile.version, acknowledgeAutosave: true,
          ...(useModel?{useModel:true}:{}),...(concurrency!==1?{concurrency}:{}),
          ...(currentSelectionValid ? { currentPageForJobId: currentPageJobId } : {}) }); onQueueState?.(queued); const next = await api.startApplicationQueue(); setPicker(false); setSelected([]); setAcknowledged(false); setUseCurrentPage(false); setCurrentPageJobId(''); return next; })}><Play size={12} />开始后台填写 · {startJobs.length} 家</button>
      </div>}
    </>}
    <details className="queue-capability"><summary>后台填写的范围</summary><p>{queue.capability || BACKGROUND_QUEUE_CAPABILITY}</p></details>
  </details>;
}
