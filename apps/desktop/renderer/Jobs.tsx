import { useMemo, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, MapPin, Plus, Search, SlidersHorizontal, Trash2, Briefcase } from 'lucide-react';
import { Badge, Button, EmptyState, SectionHeading } from './components.js';
import { useWorkspace } from './context.js';
import { companyInitial, dateLabel, errorText, recruitmentLabels } from './helpers.js';
import { eligibilityLabel, explicitJobCities, filterSavedJobs } from '../../../packages/ui/src/job-filter.js';

export function Jobs() {
  const { state, api, setState, notify, openJob, openSources, openBrowser, navigate } = useWorkspace();
  const [query, setQuery] = useState(''); const [city, setCity] = useState(''); const [type, setType] = useState(''); const [busy, setBusy] = useState<string>();
  const visible = state.jobs.filter(job => !job.demo || state.settings.showDemo);
  const cities = [...new Set([...visible.flatMap(job => explicitJobCities(job.city)), ...state.profile.cities].filter(Boolean))];
  const jobs = useMemo(() => filterSavedJobs(visible, { query, city, type }), [visible, city, type, query]);
  const hasFilters = !!query.trim() || !!city || !!type;
  function clearFilters() { setQuery(''); setCity(''); setType(''); }
  async function save(job: (typeof state.jobs)[number]) {
    setBusy(job.id);
    try { setState(await api.trackJob(job.id)); notify('岗位已加入看板，已有申请进度保留'); }
    catch (error) { notify(errorText(error), true); } finally { setBusy(undefined); }
  }
  async function remove(id: string) {
    setBusy(id); try { setState(await api.deleteJob(id)); notify('岗位已删除'); } catch (error) { notify(errorText(error), true); } finally { setBusy(undefined); }
  }
  return <div className="page"><SectionHeading title="岗位库" description="管理已保存、导入和采集的岗位；这里的搜索只筛选已有记录" action={<div className="section-heading-actions"><Button variant="secondary" onClick={openSources}><SlidersHorizontal size={14} />管理来源</Button><Button onClick={() => openJob()}><Plus size={15} />手动添加</Button></div>} />
    <div className="card filters"><div className="search-input"><Search size={15} /><input aria-label="筛选已保存岗位" placeholder="筛选已保存的公司、岗位或关键词" value={query} onChange={event => setQuery(event.target.value)} /></div><select className="filter-select" aria-label="城市筛选" value={city} onChange={event => setCity(event.target.value)}><option value="">全部城市</option>{cities.map(item => <option key={item}>{item}</option>)}</select><select className="filter-select" aria-label="招聘类型" value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(recruitmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button variant="ghost" className="button-small jobs-clear-filters" disabled={!hasFilters} onClick={clearFilters}>清除筛选</Button><span className="filter-count" aria-live="polite">{jobs.length} / {visible.length} 个已保存岗位</span></div>
    {hasFilters && <p className="jobs-filter-summary">当前筛选：{[query.trim() && `关键词“${query.trim()}”`, city && `城市 ${city}`, type && recruitmentLabels[type as keyof typeof recruitmentLabels]].filter(Boolean).join(' · ')}。范围仅本地已保存岗位。</p>}
    {!state.profile.skills.length && <div className="notice notice-info">还没有填写技能，当前匹配仅能参考已有资料。<button className="text-link" onClick={() => navigate('profile')}>完善资料</button></div>}
    {jobs.length ? <div className="job-grid">{jobs.map(job => { const saved = state.applications.some(item => item.jobId === job.id); return <article className="card job-card" key={job.id}>
      <div className="job-heading"><span className="company-icon">{companyInitial(job.company)}</span><div className="grow"><h3 className="job-title">{job.title}</h3><div className="job-company">{job.company}</div></div><button className="icon-button" onClick={() => openJob({ id: job.id, company: job.company, title: job.title, city: job.city, type: job.type, description: job.description, requirements: job.requirements, url: job.url, sourceId: job.sourceId, sourceName: job.sourceName, observedAt: job.observedAt, publishedAt: job.publishedAt, deadline: job.deadline, demo: job.demo })} aria-label="查看与编辑岗位"><ArrowUpRight size={16} /></button></div>
      <div className="job-tags"><span className="job-location small muted"><MapPin size={12} />{job.city || '城市待确认'}</span><Badge>{recruitmentLabels[job.type]}</Badge>{job.demo && <Badge tone="amber">虚构演示</Badge>}{job.deadline && <Badge tone="blue">截止 {dateLabel(job.deadline)}</Badge>}</div>
      <p className="job-description">{job.requirements || job.description || '暂无完整岗位要求，可打开来源页面核对。'}</p>
      <div className="match-box"><div className="match-heading"><span>{eligibilityLabel(job.match.eligible)}</span><span className="match-score">匹配参考 {job.match.score}</span></div>{job.match.reasons.length ? job.match.reasons.slice(0, 2).map(reason => <div className="match-reason" key={reason}><Check size={11} />{reason}</div>) : <div className="match-reason">现有信息不足，暂不生成匹配理由。</div>}{job.match.concerns.length > 0 && <div className="match-concern">{job.match.eligible === 'unsuitable' ? '条件说明' : '待核对'}：{job.match.concerns.slice(0, 2).join('；')}</div>}{job.match.reasons.length + job.match.concerns.length > 2 && <details className="job-match-details"><summary>查看全部依据与待核对项</summary>{job.match.reasons.map(reason => <p key={`reason-${reason}`}>{reason}</p>)}{job.match.concerns.map(concern => <p key={`concern-${concern}`}>{concern}</p>)}</details>}</div>
      <div className="job-source">{job.sourceName || '手动记录'} · 首次收录 {dateLabel(job.firstSeenAt)} · 最近核对 {dateLabel(job.observedAt)}{job.publishedAt ? ` · 官网发布 ${dateLabel(job.publishedAt)}` : ' · 官网发布日期未提供'}</div>
      <div className="job-detail-evidence">{job.detailEvidence ? `详情读取于 ${dateLabel(job.detailEvidence.checkedAt, true)}` : '尚无官网详情读取记录'}</div>
      <div className="job-footer"><button className="icon-button" aria-label={`删除 ${job.title}`} disabled={busy === job.id} onClick={() => void remove(job.id)}><Trash2 size={13} /></button><div className="job-actions"><Button variant="secondary" className="button-small" busy={busy === job.id} disabled={saved} onClick={() => void save(job)}>{saved ? <Check size={13} /> : <Bookmark size={13} />}{saved ? '已在看板' : '加入看板'}</Button><Button className="button-small" onClick={() => void openBrowser(job.url)}>打开岗位<ArrowUpRight size={13} /></Button></div></div>
    </article>; })}</div> : <div className="card"><EmptyState icon={<Briefcase size={25} />} title={visible.length ? '没有符合筛选条件的岗位' : '岗位库还是空的'} description={visible.length ? '当前本地岗位没有命中这组条件；清除筛选即可查看已保存的其他岗位。' : '在申请空间找新岗位，或在这里手动添加你已发现的机会。'} action={<Button onClick={visible.length ? clearFilters : openSources}>{visible.length ? '清除筛选' : '查看招聘来源'}</Button>} /></div>}
  </div>;
}
