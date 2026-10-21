import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ChevronDown, MapPin, Plus, Search, SlidersHorizontal, Trash2, Briefcase, Building2 } from 'lucide-react';
import type { Job, RecruitmentType } from '../../../packages/shared/src/contracts.js';
import { Badge, Button, EmptyState, SectionHeading } from './components.js';
import { useWorkspace } from './context.js';
import { companyInitial, dateLabel, errorText, recruitmentLabels } from './helpers.js';
import { eligibilityLabel, explicitJobCities, filterSavedJobs } from '../../../packages/ui/src/job-filter.js';
import { groupSavedJobsByCompany, recruitmentTypeCounts } from '../../../packages/ui/src/job-library.js';
import './Jobs.css';

const viewKey = 'offerflash-job-library-view-v1';
const types: Array<{ value: '' | RecruitmentType; label: string }> = [
  { value: '', label: '全部岗位' }, { value: 'campus', label: '校招' }, { value: 'internship', label: '实习' },
  { value: 'experienced', label: '社招' }, { value: 'unknown', label: '类型待确认' },
];
const sectionLabels: Record<RecruitmentType, string> = { campus: '校招岗位', internship: '实习岗位', experienced: '社招岗位', unknown: '招聘类型待确认' };
interface LibraryView { query: string; city: string; type: '' | RecruitmentType; collapsed: string[]; scrollTop: number; }
function readView(): LibraryView {
  const empty: LibraryView = { query: '', city: '', type: '', collapsed: [], scrollTop: 0 };
  try {
    const raw = sessionStorage.getItem(viewKey); if (!raw || raw.length > 64_000) return empty;
    const saved = JSON.parse(raw);
    return { query: typeof saved.query === 'string' ? saved.query.slice(0, 500) : '', city: typeof saved.city === 'string' ? saved.city.slice(0, 160) : '',
      type: types.some(type => type.value === saved.type) ? saved.type : '',
      collapsed: Array.isArray(saved.collapsed) ? saved.collapsed.filter((key: unknown): key is string => typeof key === 'string' && key.length <= 500).slice(0, 1000) : [],
      scrollTop: Number.isFinite(saved.scrollTop) && saved.scrollTop >= 0 ? Math.min(saved.scrollTop, 10_000_000) : 0 };
  } catch { return empty; }
}
function rememberView(view: LibraryView) { try { sessionStorage.setItem(viewKey, JSON.stringify(view)); } catch { /* Browsing also works without session storage. */ } }

export function Jobs() {
  const { state, api, setState, notify, openJob, openSources, openBrowser, navigate } = useWorkspace();
  const [view, setView] = useState(readView); const { query, city, type } = view;
  const [busy, setBusy] = useState<string>();
  const root = useRef<HTMLDivElement>(null), latestView = useRef(view), scrollTop = useRef(view.scrollTop); latestView.current = view;
  useEffect(() => rememberView({ ...view, scrollTop: scrollTop.current }), [view]);
  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('.page-scroll'); if (!scroller) return;
    scroller.scrollTop = scrollTop.current;
    const onScroll = () => { scrollTop.current = scroller.scrollTop; };
    const remember = () => rememberView({ ...latestView.current, scrollTop: scrollTop.current });
    scroller.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('pagehide', remember);
    return () => { remember(); scroller.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', remember); };
  }, []);
  const visible = useMemo(() => state.jobs.filter(job => !job.demo || state.settings.showDemo), [state.jobs, state.settings.showDemo]);
  const cities = [...new Set([...visible.flatMap(job => explicitJobCities(job.city)), ...state.profile.cities].filter(Boolean))];
  const queryJobs = useMemo(() => filterSavedJobs(visible, { query, city, type: '' }), [visible, city, query]);
  const counts = useMemo(() => recruitmentTypeCounts(queryJobs), [queryJobs]);
  const jobs = useMemo(() => queryJobs.filter(job => !type || (type === 'unknown' ? !['campus', 'internship', 'experienced'].includes(job.type) : job.type === type)), [queryJobs, type]);
  const groups = useMemo(() => groupSavedJobsByCompany(jobs), [jobs]);
  const collapsed = new Set(view.collapsed), allCollapsed = groups.length > 0 && groups.every(group => collapsed.has(group.key));
  const hasFilters = !!query.trim() || !!city || !!type;
  function filter(next: Partial<Pick<LibraryView, 'query' | 'city' | 'type'>>) {
    scrollTop.current = 0; const scroller = root.current?.closest<HTMLElement>('.page-scroll'); if (scroller) scroller.scrollTop = 0;
    setView(current => ({ ...current, ...next, scrollTop: 0 }));
  }
  function clearFilters() { filter({ query: '', city: '', type: '' }); }
  function toggleCompany(key: string) { setView(current => ({ ...current, collapsed: current.collapsed.includes(key) ? current.collapsed.filter(item => item !== key) : [...current.collapsed, key] })); }
  function toggleAll() {
    const keys = new Set(groups.map(group => group.key));
    setView(current => ({ ...current, collapsed: allCollapsed ? current.collapsed.filter(key => !keys.has(key)) : [...new Set([...current.collapsed, ...keys])] }));
  }
  async function save(job: (typeof state.jobs)[number]) {
    setBusy(job.id);
    try { setState(await api.trackJob(job.id)); notify('岗位已加入看板，已有申请进度保留'); }
    catch (error) { notify(errorText(error), true); } finally { setBusy(undefined); }
  }
  async function remove(id: string) {
    setBusy(id); try { setState(await api.deleteJob(id)); notify('岗位已删除'); } catch (error) { notify(errorText(error), true); } finally { setBusy(undefined); }
  }
  function jobCard(job: Job) { const saved = state.applications.some(item => item.jobId === job.id); return <article className="card job-card" key={job.id} data-testid="job-library-card" data-job-id={job.id}>
      <div className="job-heading"><div className="grow"><h4 className="job-title">{job.title}</h4></div><button className="icon-button" data-testid="job-library-edit" onClick={() => openJob({ id: job.id, company: job.company, title: job.title, city: job.city, type: job.type, description: job.description, requirements: job.requirements, url: job.url, sourceId: job.sourceId, sourceName: job.sourceName, observedAt: job.observedAt, publishedAt: job.publishedAt, deadline: job.deadline, demo: job.demo })} aria-label={`查看与编辑岗位：${job.company} · ${job.title}`}><ArrowUpRight size={16} /></button></div>
      <div className="job-tags"><span className="job-location small muted"><MapPin size={12} />{job.city || '城市待确认'}</span><Badge>{recruitmentLabels[job.type] || recruitmentLabels.unknown}</Badge>{job.demo && <Badge tone="amber">虚构演示</Badge>}{job.deadline && <Badge tone="blue">截止 {dateLabel(job.deadline)}</Badge>}</div>
      <p className="job-description">{job.requirements || job.description || '暂无完整岗位要求，可打开来源页面核对。'}</p>
      <div className="match-box"><div className="match-heading"><span>{eligibilityLabel(job.match.eligible)}</span><span className="match-score">匹配参考 {job.match.score}</span></div>{job.match.reasons.length ? job.match.reasons.slice(0, 2).map(reason => <div className="match-reason" key={reason}><Check size={11} />{reason}</div>) : <div className="match-reason">现有信息不足，暂不生成匹配理由。</div>}{job.match.concerns.length > 0 && <div className="match-concern">{job.match.eligible === 'unsuitable' ? '条件说明' : '待核对'}：{job.match.concerns.slice(0, 2).join('；')}</div>}{job.match.reasons.length + job.match.concerns.length > 2 && <details className="job-match-details"><summary>查看全部依据与待核对项</summary>{job.match.reasons.map(reason => <p key={`reason-${reason}`}>{reason}</p>)}{job.match.concerns.map(concern => <p key={`concern-${concern}`}>{concern}</p>)}</details>}</div>
      <div className="job-source">{job.sourceName || '手动记录'} · 首次收录 {dateLabel(job.firstSeenAt)} · 最近核对 {dateLabel(job.observedAt)}{job.publishedAt ? ` · 官网发布 ${dateLabel(job.publishedAt)}` : ' · 官网发布日期未提供'}</div>
      <div className="job-detail-evidence">{job.detailEvidence ? `详情读取于 ${dateLabel(job.detailEvidence.checkedAt, true)}` : '尚无官网详情读取记录'}</div>
      <div className="job-footer"><button className="icon-button" aria-label={`删除 ${job.title}`} disabled={busy === job.id} onClick={() => void remove(job.id)}><Trash2 size={13} /></button><div className="job-actions"><Button variant="secondary" className="button-small" data-testid="job-library-track" busy={busy === job.id} disabled={saved} onClick={() => void save(job)}>{saved ? <Check size={13} /> : <Bookmark size={13} />}{saved ? '已在看板' : '加入看板'}</Button><Button className="button-small" data-testid="job-library-open" onClick={() => void openBrowser(job.url)}>打开岗位<ArrowUpRight size={13} /></Button></div></div>
    </article>; }
  return <div className="page job-library" ref={root} data-testid="jobs-library"><SectionHeading title="岗位库" description="同一家公司的岗位放在一起，校招与实习分开查看" action={<div className="section-heading-actions"><Button variant="secondary" onClick={openSources}><SlidersHorizontal size={14} />管理来源</Button><Button onClick={() => openJob()}><Plus size={15} />手动添加</Button></div>} />
    <div className="jobs-type-tabs" role="tablist" aria-label="岗位招聘分类">{types.map((item, index) => <button key={item.value || 'all'} id={`jobs-type-tab-${item.value || 'all'}`} data-testid={`jobs-type-tab-${item.value || 'all'}`} type="button" role="tab" aria-selected={type === item.value} aria-controls="job-library-results" tabIndex={type === item.value ? 0 : -1} onClick={() => filter({ type: item.value })} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % types.length : event.key === 'ArrowLeft' ? (index + types.length - 1) % types.length : event.key === 'Home' ? 0 : event.key === 'End' ? types.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); const target = types[next]!; filter({ type: target.value }); document.getElementById(`jobs-type-tab-${target.value || 'all'}`)?.focus(); }
    }}><span>{item.label}</span><span className="jobs-type-count">{counts[item.value || 'all']}</span></button>)}</div>
    <div className="card filters"><div className="search-input"><Search size={15} /><input aria-label="筛选已保存岗位" maxLength={500} placeholder="筛选已保存的公司、岗位或关键词" value={query} onChange={event => filter({ query: event.target.value })} /></div><select className="filter-select" aria-label="城市筛选" value={city} onChange={event => filter({ city: event.target.value })}><option value="">全部城市</option>{cities.map(item => <option key={item}>{item}</option>)}</select><Button variant="ghost" className="button-small jobs-clear-filters" data-testid="jobs-clear-filters" disabled={!hasFilters} onClick={clearFilters}>清除筛选</Button><span className="filter-count" aria-live="polite">{jobs.length} 个岗位 · {groups.length} 家公司</span></div>
    {hasFilters && <p className="jobs-filter-summary">当前筛选：{[query.trim() && `关键词“${query.trim()}”`, city && `城市 ${city}`, type && recruitmentLabels[type as keyof typeof recruitmentLabels]].filter(Boolean).join(' · ')}。范围仅本地已保存岗位。</p>}
    {!state.profile.skills.length && <div className="notice notice-info">还没有填写技能，当前匹配仅能参考已有资料。<button className="text-link" onClick={() => navigate('profile')}>完善资料</button></div>}
    <div id="job-library-results" role="tabpanel" aria-labelledby={`jobs-type-tab-${type || 'all'}`}>
      {jobs.length ? <><div className="jobs-group-toolbar"><span><Building2 size={14} />按公司归类</span><button type="button" className="text-link" data-testid="jobs-collapse-all" onClick={toggleAll}>{allCollapsed ? '全部展开' : '全部收起'}</button></div><div className="job-company-list">{groups.map((group, index) => {
        const expanded = !collapsed.has(group.key), panelId = `job-company-content-${index}`, headingId = `job-company-heading-${index}`;
        return <section className="card job-company-group" key={group.key} data-testid="job-company-group" data-company-key={group.key} data-company-label={group.company} aria-labelledby={headingId}>
          <h2 className="job-company-heading" id={headingId}><button type="button" className="job-company-toggle" data-testid="job-company-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleCompany(group.key)}><span className="company-icon" aria-hidden="true">{companyInitial(group.company)}</span><span className="job-company-name">{group.company}<small>{group.jobs.length} 个岗位</small></span><span className="job-company-types">{group.sections.map(section => <span key={section.type} data-type={section.type}>{recruitmentLabels[section.type]} {section.jobs.length}</span>)}</span><ChevronDown size={17} className="job-company-chevron" /></button></h2>
          <div id={panelId} className="job-company-content" data-testid="job-company-content" hidden={!expanded}>{group.sections.map(section => <section key={section.type} className="job-type-section" data-testid="job-type-section" data-recruitment-type={section.type}><h3><span className="job-type-dot" data-type={section.type} />{sectionLabels[section.type]}<span>{section.jobs.length}</span></h3><div className="job-grid">{section.jobs.map(jobCard)}</div></section>)}</div>
        </section>;
      })}</div></> : <div className="card"><EmptyState icon={<Briefcase size={25} />} title={visible.length ? '没有符合筛选条件的岗位' : '岗位库还是空的'} description={visible.length ? '当前本地岗位没有命中这组条件；清除筛选即可查看已保存的其他岗位。' : '在申请空间找新岗位，或在这里手动添加你已发现的机会。'} action={<Button onClick={visible.length ? clearFilters : openSources}>{visible.length ? '清除筛选' : '查看招聘来源'}</Button>} /></div>}
    </div>
  </div>;
}
