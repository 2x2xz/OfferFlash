import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookmarkPlus, Check, ChevronDown, Globe, MapPin, Plus, Search, SlidersHorizontal, Square } from 'lucide-react';
import type { DiscoveryAPI, DiscoveryReport, DiscoveryResult, DiscoverySource, DiscoveryState } from '../../../packages/shared/src/discovery.js';
import type { Application, Job, OfferAPI } from '../../../packages/shared/src/contracts.js';
import { Button, ErrorMessage } from './components.js';
import { errorText, statusLabels } from './helpers.js';
import './DiscoveryPanel.css';

const statusLabel = { success: '范围完成', partial: '部分完成', failed: '未完成', cancelled: '已取消', skipped: '未查看' };
const domestic = (source: DiscoverySource) => ['feishu', 'tencent-campus'].includes(String(source.provider));
const mainlandScope = (source: DiscoverySource) => domestic(source) || String(source.provider) === 'tencent';
const automatic = (source: DiscoverySource) => source.enabled && String(source.provider) !== 'candidate';
const candidateRank = { likely: 0, review: 1, unsuitable: 2 } as const;
interface CurrentResults { reportId: string; keys: Array<{ sourceId: string; url: string }>; }
interface DiscoveryMemory {
  selected: string[]; includeExperienced: boolean; sources: DiscoverySource[];
  report?: DiscoveryReport; currentResults?: CurrentResults;
}
const memory = new WeakMap<object, DiscoveryMemory>();
function newerReport(previous?: DiscoveryReport, incoming?: DiscoveryReport): DiscoveryReport | undefined {
  return !previous || incoming && previous.startedAt <= incoming.startedAt ? incoming : previous;
}
function boundCandidates(jobs: readonly Job[], report?: DiscoveryReport, currentResults?: CurrentResults): Job[] {
  const ids = new Set(report?.sources.flatMap(source => source.jobIds) ?? []);
  const keys = currentResults?.reportId === report?.id ? currentResults?.keys ?? [] : [];
  const seen = new Set<string>();
  return jobs.filter(job => !job.demo && (ids.has(job.id)
    || keys.some(key => key.sourceId === job.sourceId && key.url === job.url))).filter(job => {
      const key = `${job.sourceId}\n${job.url}`; if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((left, right) => candidateRank[left.match.eligible] - candidateRank[right.match.eligible]
      || right.match.score - left.match.score || left.id.localeCompare(right.id));
}
/** Restore the same library exclusion before the first remount layout, not in a later effect. */
export function cachedDiscoveryCandidateIds(api: object, jobs: readonly Job[]): string[] {
  const saved = memory.get(api); return boundCandidates(jobs, saved?.report, saved?.currentResults).map(job => job.id);
}
function sourceDescription(source: DiscoverySource): string {
  switch (String(source.provider)) {
    case 'feishu': return '国内公开招聘 · 校招与实习资格逐岗核对';
    case 'tencent-campus': return '腾讯校园招聘 · 官网公开岗位';
    case 'tencent': return '经验岗位 · 需主动启用社招';
    case 'candidate': return '已登记入口 · 尚未自动采集';
    default: return '海外公开招聘 · 地点与应届资格逐岗核对';
  }
}
function reportTime(report: DiscoveryReport): string {
  const value = new Date(report.startedAt);
  return Number.isFinite(value.getTime()) ? value.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间待核对';
}
export function DiscoveryPanel({ api, jobs = [], applications = [], onTrack, onApply, onViewLibrary, onCandidatesChange, onComplete, onOpenSource, disabled = false,hideCandidates=false }: {
  api: DiscoveryAPI & Partial<Pick<OfferAPI, 'onEvent'>>; onComplete?: (result: DiscoveryResult) => void | Promise<void>;
  applications?: Application[]; onTrack?: (job: Job) => Promise<void>;
  jobs?: Job[]; onApply?: (job: Job) => void; onViewLibrary?: () => void;
  onCandidatesChange?: (jobIds: string[]) => void;
  onOpenSource?: (url: string) => void; disabled?: boolean;hideCandidates?:boolean;
}) {
  const remembered = memory.get(api);
  const initialized = useRef(!!remembered);
  const [sources, setSources] = useState<DiscoverySource[]>(() => remembered?.sources ?? []);
  const [selected, setSelected] = useState<string[]>(() => remembered?.selected ?? []);
  const [includeExperienced, setIncludeExperienced] = useState(() => remembered?.includeExperienced ?? false);
  const [report, setReport] = useState<DiscoveryReport | undefined>(() => remembered?.report); const [busy, setBusy] = useState(false); const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>(); const [company, setCompany] = useState(''); const [url, setURL] = useState('');
  const [stopping, setStopping] = useState(false); const [loading, setLoading] = useState(!remembered);
  const [trackingId, setTrackingId] = useState<string>();
  const trackingActive = useRef(false);
  const [currentResults, setCurrentResults] = useState<CurrentResults | undefined>(() => remembered?.currentResults);
  useEffect(() => {
    let current = true, eventRevision = 0;
    function accept(state: DiscoveryState) {
      if (!current) return;
      const existing = initialized.current; initialized.current = true;
      const saved = memory.get(api);
      const selectedIds = existing ? (saved?.selected ?? []).filter(id => state.sources.some(source => source.id === id && automatic(source)))
        : state.sources.filter(source => automatic(source) && domestic(source)).map(source => source.id);
      const latest = newerReport(saved?.report, [...state.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]);
      memory.set(api, { selected: selectedIds, includeExperienced: saved?.includeExperienced ?? false, sources: state.sources,
        report: latest, currentResults: saved?.currentResults?.reportId === latest?.id ? saved?.currentResults : undefined });
      setSources(state.sources); setLoading(false);
      setSelected(previous => existing ? previous.filter(id => state.sources.some(source => source.id === id && automatic(source)))
        : state.sources.filter(source => automatic(source) && domestic(source)).map(source => source.id));
      setReport(previous => newerReport(previous, latest));
    }
    const initialRevision = eventRevision;
    const unsubscribe = api.onEvent?.(event => { if (!current || event.type !== 'discovery') return; eventRevision++; accept(event.state); });
    void api.discoveryState().then(state => { if (current && eventRevision === initialRevision) accept(state); })
      .catch(cause => { if (current && eventRevision === initialRevision) { setError(errorText(cause)); setLoading(false); } });
    return () => { current = false; unsubscribe?.(); };
  }, [api]);
  useEffect(() => {
    const saved = memory.get(api);
    if (initialized.current && saved) memory.set(api, { ...saved, selected: [...selected], includeExperienced });
  }, [api, selected, includeExperienced]);
  const selectedSources = sources.filter(source => selected.includes(source.id) && automatic(source)
    && (String(source.provider) !== 'tencent' || includeExperienced));
  const domesticSources = sources.filter(mainlandScope);
  const otherSources = sources.filter(source => !mainlandScope(source));
  const mainlandSelected = selectedSources.filter(mainlandScope).length;
  const region: 'mainland' | 'overseas' | 'all' = mainlandSelected === selectedSources.length ? 'mainland' : mainlandSelected === 0 ? 'overseas' : 'all';
  const regionLabel = region === 'mainland' ? '国内公开来源（默认）' : region === 'overseas' ? '海外公开来源（已选择）' : '国内＋海外（已选择）';
  const candidateJobs = boundCandidates(jobs, report, currentResults);
  const candidateKey = JSON.stringify(candidateJobs.map(job => job.id));
  useEffect(() => { onCandidatesChange?.(JSON.parse(candidateKey) as string[]); }, [candidateKey, onCandidatesChange]);
  async function collect() {
    if (busy || disabled || trackingId || !selectedSources.length) return;
    setBusy(true); setStopping(false); setError(undefined);
    try { const result = await api.discoverJobs({ sourceIds: selectedSources.map(source => source.id), includeExperienced, region });
      const saved = memory.get(api), latest = newerReport(saved?.report, result.report);
      const keys = { reportId: result.report.id, keys: result.jobs.map(job => ({ sourceId: job.sourceId, url: job.url })) };
      const nextResults = latest?.id === result.report.id ? keys : saved?.currentResults;
      memory.set(api, { selected: saved?.selected ?? selected, includeExperienced: saved?.includeExperienced ?? includeExperienced,
        sources: saved?.sources ?? sources, report: latest, currentResults: nextResults });
      setCurrentResults(nextResults); setReport(current => newerReport(current, latest)); await onComplete?.(result); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); setStopping(false); }
  }
  async function stop() {
    if (!busy || stopping) return;
    setStopping(true);
    try { await api.cancelDiscovery(); } catch (cause) { setStopping(false); setError(errorText(cause)); }
  }
  async function add() {
    if (busy || disabled || adding || !company.trim() || !url.trim()) return;
    setAdding(true); setError(undefined);
    try {
      const source = await api.addDiscoverySource({ company: company.trim(), url: url.trim() });
      const saved = memory.get(api);
      if (saved) memory.set(api, { ...saved, sources: [...saved.sources.filter(item => item.id !== source.id), source] });
      setSources(current => [...current.filter(item => item.id !== source.id), source]);
      if (automatic(source) && String(source.provider) !== 'tencent') setSelected(current => [...new Set([...current, source.id])]);
      setCompany(''); setURL('');
    } catch (cause) { setError(errorText(cause)); } finally { setAdding(false); }
  }
  async function track(job: Job) {
    if (!onTrack || busy || disabled || trackingActive.current || applications.some(item => item.jobId === job.id)) return;
    trackingActive.current = true; setTrackingId(job.id); setError(undefined);
    try { await onTrack(job); } catch (cause) { setError(errorText(cause)); } finally { trackingActive.current = false; setTrackingId(undefined); }
  }
  const sourceRows = (items: DiscoverySource[]) => items.map(source => <div key={source.id} className={`discovery-source-row${domestic(source) ? ' domestic' : ''}`} data-source-id={source.id} data-provider={source.provider}><label><input type="checkbox" checked={selected.includes(source.id)}
    disabled={busy || adding || disabled || !automatic(source) || String(source.provider) === 'tencent' && !includeExperienced} onChange={event => setSelected(current => event.target.checked ? [...new Set([...current, source.id])] : current.filter(id => id !== source.id))} />
    <span>{source.name}<small>{sourceDescription(source)}</small></span></label>
    {onOpenSource && <button type="button" className="text-link" disabled={busy || disabled} onClick={() => onOpenSource(source.url)}>查看入口</button>}</div>);
  return <details className="discovery-panel discovery-primary" data-testid="job-discovery" open>
    <summary><span><Globe size={17} />找新岗位</span><span data-testid="discovery-region" data-region={region}>{busy ? stopping ? '正在停止…' : '正在读取招聘官网…' : regionLabel}<ChevronDown size={14} /></span></summary>
    <div className="discovery-panel-body">
      <div className="discovery-primary-action"><div><h3>用你的经历，查找新的机会</h3><p>读取国内招聘官网；配置百炼 qwen-flash 后，同时搜索更多公开招聘网页。无需招聘表。</p></div>
        {busy ? <Button variant="secondary" disabled={stopping} onClick={() => void stop()} data-testid="discovery-stop"><Square size={13} />{stopping ? '等待停止' : '停止查找'}</Button>
          : <Button disabled={disabled || adding || loading || !!trackingId || !selectedSources.length} onClick={() => void collect()} data-testid="discovery-start"><Search size={15} />按我的资料找新岗位</Button>}
      </div>
      <details className="discovery-settings" data-testid="discovery-source-settings"><summary><span><SlidersHorizontal size={13} />{loading ? '正在读取来源…' : `本轮选中 ${selectedSources.length} 个来源`}</span><span className="discovery-selected-names">{selectedSources.map(source => source.company).join('、') || '选择招聘来源'}</span><span className="discovery-adjust">调整来源<ChevronDown size={12} /></span></summary>
        <div className="discovery-source-options" aria-label="本轮招聘来源">
          {domesticSources.length > 0 && <><h4 className="discovery-source-heading">国内公开招聘 · 默认校招与实习</h4>{sourceRows(domesticSources)}</>}
          {otherSources.length > 0 && <><h4 className="discovery-source-heading">海外来源（需主动选择）与已登记入口</h4>{sourceRows(otherSources)}</>}
        </div>
        <label className="discovery-experienced"><input type="checkbox" checked={includeExperienced} disabled={busy || disabled} onChange={event => { setIncludeExperienced(event.target.checked); if (!event.target.checked) setSelected(current => current.filter(id => sources.find(source => source.id === id)?.provider !== 'tencent')); }} />同时查看社招候选（默认关闭）</label>
        <details className="discovery-add"><summary><Plus size={12} />添加企业招聘入口</summary><div className="discovery-add-fields">
          <label>企业名称<input aria-label="发现来源企业名称" value={company} disabled={busy || adding || disabled} onChange={event => setCompany(event.target.value)} maxLength={120} placeholder="企业名称" /></label>
          <label>公开招聘网址<input aria-label="发现来源招聘网址" type="url" value={url} disabled={busy || adding || disabled} onChange={event => setURL(event.target.value)} maxLength={2048} placeholder="企业的公开招聘入口" /></label>
          <Button variant="secondary" busy={adding} disabled={busy || disabled || !company.trim() || !url.trim()} onClick={() => void add()}>添加入口</Button>
        </div><p>已适配的公开入口可读取；其他网址保留为候选入口，需在浏览器核对。</p></details>
      </details>
      {!loading && !selectedSources.length && <p className="discovery-selection-note">请在“调整来源”中选择已接入的招聘入口。查找范围以实际来源报告为准。</p>}
      <ErrorMessage message={error} />
      {report && <section className={`discovery-last-report ${report.status}`} data-testid="discovery-report"><div><strong>{statusLabel[report.status]} · 本轮候选 {report.uniqueJobs} 条</strong><time dateTime={report.startedAt}>{reportTime(report)}</time></div>
        <p><span data-testid="discovery-report-region" data-region={report.options.region ?? 'unknown'}>本轮范围：{report.options.region === 'mainland' ? '国内' : report.options.region === 'overseas' ? '海外' : report.options.region === 'all' ? '国内与海外' : '以来源报告为准'}</span> · {report.completeDetails} 条完整正文 · {report.duplicateCount} 条重复已去重<span className="discovery-report-query">关键词：{report.plan.keywords.join(' / ')}{report.plan.cities.length ? `；意向城市：${report.plan.cities.join('、')}` : ''}</span></p>
        {report.publicSearch && <section data-testid="public-job-search"><strong>公开网页搜索 · {report.publicSearch.leads.length} 条待核实线索</strong>
          <p>{report.publicSearch.reason}{report.publicSearch.totalTokens !== null ? ` 本次搜索 ${report.publicSearch.totalTokens} token。` : ''}</p>
          <div className="discovery-candidate-grid">{report.publicSearch.leads.map(lead => <article key={lead.url}><div><h4>{lead.title}</h4><p>搜索来源 · 正文、地点与开放状态待核实</p></div>
            {onOpenSource && <Button variant="secondary" disabled={busy || disabled || !!trackingId} onClick={() => onOpenSource(lead.url)}>打开核实<ArrowRight size={12} /></Button>}</article>)}</div>
        </section>}
        {!hideCandidates&&candidateJobs.length > 0 && <div className="discovery-candidates" data-testid="discovery-candidates" data-report-id={report.id} data-matched-count={candidateJobs.length}><div className="discovery-candidate-grid">{candidateJobs.slice(0, 6).map((job, index) => { const tracked = applications.find(item => item.jobId === job.id); return <article key={job.id} data-testid="discovery-candidate" data-job-id={job.id}><div><h4><span className="discovery-candidate-ordinal">{index + 1}.</span>{job.title}</h4><p>{job.company}</p><span><MapPin size={10} />{job.city || '地点待核对'}</span></div><div className="discovery-candidate-actions">{onTrack && <Button variant="ghost" data-testid="discovery-track" busy={trackingId === job.id} disabled={disabled || busy || !!trackingId || !!tracked} onClick={() => void track(job)}>{tracked ? <><Check size={11} />已加入 · {statusLabels[tracked.status]}</> : <><BookmarkPlus size={11} />加入待申请</>}</Button>}{onApply && <Button variant="secondary" data-testid="discovery-apply" disabled={disabled || busy || !!trackingId || !job.url.trim()} onClick={() => onApply(job)}>去网申<ArrowRight size={12} /></Button>}</div></article>; })}</div>{candidateJobs.length > 6 && <p className="discovery-candidate-more">先显示 6 / {candidateJobs.length} 条本轮候选{onViewLibrary && <button type="button" className="text-link" onClick={onViewLibrary}>前往岗位库<ArrowRight size={11} /></button>}</p>}</div>}
        {!hideCandidates&&!candidateJobs.length && report.uniqueJobs > 0 && <p className="discovery-selection-note">本轮候选尚未对应到当前岗位库记录。请查看下方来源范围，或到岗位库核对。</p>}
        {hideCandidates&&<p className="discovery-selection-note">本轮模型筛选结果见下方；来源范围仍按本报告记录。</p>}
        <details><summary>查找范围与未覆盖渠道<ChevronDown size={12} /></summary>{report.sources.map(source => <div className="discovery-report-source" key={source.sourceId}><strong>{source.name} · {statusLabel[source.status]}</strong>
          <p>{source.reason}</p><p>{source.provider === 'feishu' ? '推荐图层' : '列表页'} {source.pagesSucceeded}/{source.pagesRequested} · 查看 {source.entriesRead} 条 · 核对正文 {source.detailChecked} 条 · 留存 {source.matchedCount} 条</p>
          {source.audit && <p>公开请求 {source.audit.requests} 次 · 排除境外 / 地点不明 {source.audit.excludedNonMainland} 条 · 排除招聘类型 {source.audit.excludedRecruitment} 条{source.audit.notes.map(note => `；${note}`).join('')}</p>}
          {[...source.unviewed, ...source.warnings].map((warning, index) => <p key={index}>{warning}</p>)}</div>)}
          {report.unviewedSources.map(source => <p key={source.sourceId}>未查看 {source.name}：{source.reason}</p>)}<p>{report.scopeNote}</p>
        </details>
      </section>}
    </div>
  </details>;
}
