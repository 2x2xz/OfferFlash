import { useEffect, useState } from 'react';
import { Calendar, ClipboardList, Columns3, List, Plus, ArrowUpRight, Bookmark } from 'lucide-react';
import type { ApplicationStatus } from '../../../packages/shared/src/contracts.js';
import { AGENDA_URGENCIES, buildApplicationAgenda, type AgendaUrgency, type ApplicationAgendaResult } from '../../../packages/domain/src/agenda.js';
import { activateFromKeyboard } from '../../../packages/ui/src/keyboard.js';
import { Badge, Button, EmptyState, SectionHeading } from './components.js';
import { useWorkspace } from './context.js';
import { applicationStatuses, dateLabel, statusLabels } from './helpers.js';
import { ApplicationCalendar } from './ApplicationCalendar.js';

const columns: ApplicationStatus[] = ['needs-review', 'saved', 'applied', 'assessment', 'interview', 'offer'];
export function Applications() {
  const { state, openApplication } = useWorkspace(); const [mode, setMode] = useState<'board' | 'list' | 'agenda' | 'calendar'>('board');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('');
  const [agendaLimit, setAgendaLimit] = useState(20); const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const allApplications = state.applications.filter(item => !item.demo || state.settings.showDemo);
  const applications = allApplications.filter(item => !statusFilter || item.status === statusFilter);
  const closed = applications.filter(item => ['rejected', 'withdrawn'].includes(item.status));
  const agenda = buildApplicationAgenda(state, { limit: agendaLimit }, now);
  const heading = <SectionHeading title="每一步，都心里有数" description="同一家公司的不同岗位独立记录；待核对表示尚未确认实际投递进度" action={<div className="section-heading-actions">{!['agenda', 'calendar'].includes(mode) && <select className="filter-select" aria-label="筛选申请状态" value={statusFilter} onChange={event => setStatusFilter(event.target.value as ApplicationStatus | '')}><option value="">全部状态</option>{applicationStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>}<div className="pill-switch" role="group" aria-label="申请视图"><button className={mode === 'board' ? 'active' : ''} onClick={() => setMode('board')} aria-label="看板视图" aria-pressed={mode === 'board'}><Columns3 size={14} /></button><button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')} aria-label="列表视图" aria-pressed={mode === 'list'}><List size={14} /></button><button className={mode === 'agenda' ? 'active' : ''} onClick={() => setMode('agenda')} aria-label="事项视图" aria-pressed={mode === 'agenda'}><ClipboardList size={14} /></button><button className={mode === 'calendar' ? 'active' : ''} onClick={() => setMode('calendar')} aria-label="日历视图" aria-pressed={mode === 'calendar'}><Calendar size={14} /></button></div><Button onClick={() => openApplication()}><Plus size={15} />新增申请</Button></div>} />;
  if (mode === 'calendar') return <div className="page">{heading}<ApplicationCalendar /></div>;
  if (mode === 'agenda') return <div className="page">{heading}<ApplicationAgendaView agenda={agenda} onOpen={id => { const item = state.applications.find(application => application.id === id); if (item) openApplication(item); }} onMore={() => setAgendaLimit(current => Math.min(100, current + 20))} /></div>;
  return <div className="page">{heading}
    {!applications.length ? <div className="card"><EmptyState icon={<Bookmark size={24} />} title={allApplications.length ? '当前状态没有记录' : '还没有申请记录'} description={allApplications.length ? '切换状态筛选，查看其他申请与招聘线索。' : '收藏岗位后会出现在待投递列；导入后未确认的进度会放在待核对列。'} action={<Button onClick={() => openApplication()}>记录一份申请</Button>} /></div> : mode === 'board' ? <><div className="kanban">{columns.filter(status => !statusFilter || status === statusFilter).map(status => <div className="kanban-column" key={status}><div className="kanban-title"><span>{statusLabels[status]}</span><span className="kanban-count">{applications.filter(item => item.status === status).length}</span></div>{applications.filter(item => item.status === status).map(item => <article role="button" tabIndex={0} className="application-card keyboard-activatable" key={item.id} data-application-id={item.id} aria-label={`查看申请：${item.company} · ${item.title}`} onClick={() => openApplication(item)} onKeyDown={event => activateFromKeyboard(event, () => openApplication(item))}><div className="application-company">{item.company}{item.demo && <Badge tone="amber">演示</Badge>}</div><div className="application-title">{item.title}</div>{item.notes && <div className="application-note">{item.notes}</div>}<div className="application-bottom"><span className="row">{item.deadline ? <><Calendar size={11} />{dateLabel(item.deadline)} 截止</> : <>更新 {dateLabel(item.updatedAt)}</>}</span><ArrowUpRight size={11} /></div></article>)}{!applications.some(item => item.status === status) && <div className="kanban-empty">暂时没有记录</div>}</div>)}</div>{closed.length > 0 && <section className="card card-pad"><SectionHeading title="已结束的申请" description="记录保留，方便回看整个求职过程" /><div className="closed-applications">{closed.map(item => <Button variant="secondary" key={item.id} onClick={() => openApplication(item)}>{item.company} · {item.title}{item.demo && <Badge tone="amber">演示</Badge>}<Badge>{statusLabels[item.status]}</Badge></Button>)}</div></section>}</> : <div className="card application-list-mode"><div className="table-heading"><span>公司与岗位</span><span>状态</span><span>截止日期</span><span>最近更新</span><span /></div>{[...applications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <div className="table-row keyboard-activatable" role="button" tabIndex={0} key={item.id} data-application-id={item.id} aria-label={`查看申请：${item.company} · ${item.title}`} onClick={() => openApplication(item)} onKeyDown={event => activateFromKeyboard(event, () => openApplication(item))}><div><div className="table-title">{item.title}</div><span>{item.company}{item.demo ? ' · 虚构演示' : ''}</span></div><div><Badge tone={item.status === 'offer' ? 'green' : 'muted'}>{statusLabels[item.status]}</Badge></div><span>{dateLabel(item.deadline)}</span><span>{dateLabel(item.updatedAt)}</span><ArrowUpRight size={13} /></div>)}</div>}
  </div>;
}

const urgencyLabels: Record<AgendaUrgency, string> = { overdue: '日期已过，先核实', today: '今天', upcoming: '未来 7 天', undated: '日期待确认' };
function ApplicationAgendaView({ agenda, onOpen, onMore }: { agenda: ApplicationAgendaResult; onOpen: (id: string) => void; onMore: () => void }) {
  return <div className="application-agenda" data-agenda-date={agenda.today} data-agenda-total={agenda.total}>
    <section className="card card-pad">
      <SectionHeading title="申请事项" description={`${agenda.today} 至 ${agenda.rangeEnd} · Asia/Shanghai · 含过去未结束事项与日期待确认项`} />
      <p className="source-select-text">截止日期只精确到天。日期已过不会自动结束申请；已投递仍保留等待企业的状态，面试日期需和企业邀请核对。</p>
      <p className="filter-count" style={{ marginTop: 12 }}>范围内 {agenda.total} 项，显示 {agenda.returnedCount} 项；另有 {agenda.counts.outsideRange} 项日期在范围之后，{agenda.counts.excludedClosed} 项已结束。</p>
      {agenda.counts.excludedDemo > 0 && <p className="filter-count" style={{ marginTop: 8 }}>演示数据已隐藏。</p>}
    </section>
    {agenda.total === 0 && <div className="card"><EmptyState icon={<ClipboardList size={24} />} title="当前范围没有申请事项" description="可以查看全部申请，或在申请记录中补充下一事项截止日期。" /></div>}
    {AGENDA_URGENCIES.map(urgency => {
      const items = agenda.items.filter(item => item.urgency === urgency);
      if (!items.length) return null;
      return <section className="card card-pad" key={urgency} style={{ marginTop: 16 }}>
        <SectionHeading title={urgencyLabels[urgency]} description={`${agenda.counts[urgency]} 项，当前显示 ${items.length} 项`} />
        {items.map(item => <article className="application-card" data-application-id={item.id} data-urgency={item.urgency} key={item.id} style={{ marginBottom: 10 }}>
          <div className="application-company">{item.company}{item.demo && <Badge tone="amber">演示</Badge>}</div>
          <div className="application-title">{item.title}</div>
          <div className="row" style={{ marginTop: 8, gap: 8 }}><Badge tone={item.status === 'offer' ? 'green' : 'muted'}>{statusLabels[item.status]}</Badge><Badge>{item.waitingOn === 'other' ? '等待企业' : '由你处理'}</Badge><span className="filter-count">{item.date ?? '截止日期未注明'}</span></div>
          <p className="application-note" style={{ marginTop: 10 }}>{item.nextStep}</p>
          <Button variant="ghost" className="button-small" onClick={() => onOpen(item.id)}>核对申请记录<ArrowUpRight size={13} /></Button>
        </article>)}
      </section>;
    })}
    {agenda.truncated && <div className="notice notice-warning" style={{ marginTop: 16 }}>
      <p>还有 {agenda.total - agenda.returnedCount} 项未显示，清单按日期紧急程度排序。</p>
      {agenda.limit < 100 ? <Button variant="secondary" onClick={onMore}>显示更多事项</Button> : <p>当前最多展示 100 项；请切换列表视图查看其余申请。</p>}
    </div>}
  </div>;
}
