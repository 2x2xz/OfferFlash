import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { applicationLocalTimeToUTC, applicationUTCToLocal, type ApplicationCalendarEvent, type ApplicationCalendarEventInput } from '../../../packages/shared/src/application-assets.js';
import { Badge, Button, Field, Notice } from './components.js';
import { ApplicationResumePicker, useApplicationAssets } from './ApplicationAssets.js';
import { errorText } from './helpers.js';
import './ApplicationCalendar.css';

const labels = { assessment: '笔试', interview: '面试', other: '其他事项' };
const defaultZone = 'Asia/Shanghai';
const dateKey = (utc: string, zone = defaultZone) => applicationUTCToLocal(utc, zone).slice(0, 10);
function dateLabel(event: ApplicationCalendarEvent) {
  const options: Intl.DateTimeFormatOptions = { timeZone: event.timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  const format = new Intl.DateTimeFormat('zh-CN', options);
  return `${format.format(new Date(event.startsAt))} — ${format.format(new Date(event.endsAt))} · ${event.timeZone}`;
}
function nextDraft(applicationId: string): ApplicationCalendarEventInput {
  const start = Math.ceil(Date.now() / 1800_000) * 1800_000;
  return { applicationId, kind: 'interview', title: '面试', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600_000).toISOString(), timeZone: defaultZone, location: '', notes: '', status: 'scheduled' };
}
export function ApplicationCalendar({ applicationId }: { applicationId?: string } = {}) {
  const { api, assets, state, setAssets, notify, error, loading, reload } = useApplicationAssets();
  const [filter, setFilter] = useState(''), [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(() => dateKey(new Date().toISOString()).slice(0, 7));
  const [draft, setDraft] = useState<ApplicationCalendarEventInput>(), [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const [localStart, setLocalStart] = useState(''), [localEnd, setLocalEnd] = useState('');
  const applications = state.applications.filter(item => !item.demo || state.settings.showDemo);
  const ownerId = applicationId ?? filter;
  const owner = applications.find(item => item.id === ownerId);
  const events = assets.calendarEvents.filter(item => (!ownerId || item.applicationId === ownerId) && applications.some(application => application.id === item.applicationId));
  useEffect(() => {
    if (filter && !applications.some(item => item.id === filter)) setFilter('');
    if (draft && !applications.some(item => item.id === draft.applicationId)) setDraft(undefined);
  }, [state.applications, state.settings.showDemo, filter, draft?.applicationId]);
  const days = useMemo(() => {
    const [year, value] = month.split('-').map(Number); const first = new Date(Date.UTC(year!, value! - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(first.getTime() + (index - offset) * 86400_000).toISOString().slice(0, 10));
  }, [month]);
  if (applicationId && !owner) return null;
  async function mutate(operation: () => Promise<typeof assets>, message: string) {
    if (busy) return; setBusy(true);
    try { setAssets(await operation()); notify(message); setDraft(undefined); }
    catch (err) { notify(errorText(err), true); await reload(); } finally { setBusy(false); }
  }
  function edit(event?: ApplicationCalendarEvent) {
    const next = event ?? nextDraft(owner?.id ?? applications[0]?.id ?? '');
    setDraft({ ...next }); setExpectedRevision(event?.revision ?? null);
    setLocalStart(applicationUTCToLocal(next.startsAt, next.timeZone)); setLocalEnd(applicationUTCToLocal(next.endsAt, next.timeZone));
  }
  function shiftMonth(delta: number) { const [year, value] = month.split('-').map(Number); setMonth(new Date(Date.UTC(year!, value! - 1 + delta, 1)).toISOString().slice(0, 7)); }
  return <section className="application-calendar" data-testid="application-calendar">
    <div className="calendar-heading"><div><h3><CalendarDays size={16} />笔试与面试</h3><p>每份申请可有多个安排；日历不会更改投递状态。</p></div><div className="asset-actions"><Button variant="ghost" disabled={busy || !events.length} onClick={() => void api.exportApplicationCalendar(ownerId || undefined).then(result => { if (!result.cancelled) notify('已导出日历，可导入系统日历。'); }).catch(err => notify(errorText(err), true))}><Download size={13} />导出日历</Button><Button variant="secondary" disabled={busy || !applications.length} onClick={() => edit()} data-testid="calendar-add"><Plus size={13} />添加安排</Button></div></div>
    {error && <Notice tone="warning">{error}</Notice>}
    {!applicationId && <Field label="查看申请"><select value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部申请</option>{applications.map(item => <option value={item.id} key={item.id}>{item.company} · {item.title}{item.demo ? '（演示）' : ''}</option>)}</select></Field>}
    {owner && <ApplicationResumePicker applicationId={owner.id} />}
    {draft && <form className="asset-editor calendar-editor" data-testid="calendar-editor" onSubmit={event => { event.preventDefault(); try { const input = { ...draft, startsAt: applicationLocalTimeToUTC(localStart, draft.timeZone), endsAt: applicationLocalTimeToUTC(localEnd, draft.timeZone) }; void mutate(() => api.saveCalendarEvent(input, expectedRevision), '日历安排已保存，投递状态保持。'); } catch (err) { notify(errorText(err), true); } }}>
      <div className="asset-editor-grid"><Field label="所属申请"><select value={draft.applicationId} disabled={!!draft.id} required onChange={event => setDraft(current => current ? { ...current, applicationId: event.target.value } : current)}><option value="" disabled>选择申请</option>{applications.map(item => <option value={item.id} key={item.id}>{item.company} · {item.title}</option>)}</select></Field><Field label="类型"><select value={draft.kind} onChange={event => setDraft(current => current ? { ...current, kind: event.target.value as ApplicationCalendarEventInput['kind'] } : current)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
      <Field label="事项名称"><input required maxLength={240} value={draft.title} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="例如：算法一面 / 在线笔试" /></Field>
      <Field label="时间所属时区" hint="下面的时间按此时区解释；夏令时不存在或重复的时间会要求重新选择。"><input required maxLength={80} list="calendar-timezones" value={draft.timeZone} onChange={event => setDraft(current => current ? { ...current, timeZone: event.target.value } : current)} /><datalist id="calendar-timezones"><option value="Asia/Shanghai" /><option value="Asia/Hong_Kong" /><option value="UTC" /><option value="America/New_York" /><option value="Europe/London" /></datalist></Field>
      <div className="asset-editor-grid"><Field label="开始（上述时区）"><input type="datetime-local" required data-testid="calendar-start" value={localStart} onChange={event => setLocalStart(event.target.value)} /></Field><Field label="结束（上述时区）"><input type="datetime-local" required data-testid="calendar-end" value={localEnd} onChange={event => setLocalEnd(event.target.value)} /></Field></div>
      <Field label="地点 / 会议入口"><input maxLength={2000} value={draft.location} onChange={event => setDraft(current => current ? { ...current, location: event.target.value } : current)} /></Field><Field label="备注"><textarea rows={2} maxLength={10000} value={draft.notes} onChange={event => setDraft(current => current ? { ...current, notes: event.target.value } : current)} /></Field>
      <div className="asset-actions"><Button type="submit" busy={busy} data-testid="calendar-save">保存安排</Button><Button variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>取消编辑</Button></div>
    </form>}
    <div className="calendar-month-toolbar"><div><button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={15} /></button><strong>{month.replace('-', ' 年 ')} 月</strong><button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={15} /></button><button type="button" className="calendar-today" onClick={() => setMonth(dateKey(new Date().toISOString()).slice(0, 7))}>本月</button></div><span>日历显示时区：Asia/Shanghai</span></div>
    <div className="calendar-month" aria-label={`${month}安排日历`} data-testid="calendar-month">{['一', '二', '三', '四', '五', '六', '日'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}{days.map(day => { const items = events.filter(item => dateKey(item.startsAt) === day); return <div className={`calendar-day ${day.startsWith(month) ? '' : 'outside'} ${day === dateKey(new Date().toISOString()) ? 'today' : ''}`} key={day}><span>{Number(day.slice(-2))}</span>{items.slice(0, 2).map(item => <button type="button" key={item.id} className={`calendar-chip ${item.kind} ${item.status}`} onClick={() => edit(item)} title={`${item.title} · ${dateLabel(item)}`}>{item.status === 'cancelled' ? '已取消 · ' : ''}{item.title}</button>)}{items.length > 2 && <small>另有 {items.length - 2} 项，见下方清单</small>}</div>; })}</div>
    <div className="calendar-event-list" data-testid="calendar-events">{events.map(event => { const application = applications.find(item => item.id === event.applicationId)!; return <article key={event.id} className={`calendar-event ${event.status}`} data-testid="calendar-event" data-event-id={event.id}><div><div className="asset-tags"><Badge tone={event.status === 'cancelled' ? 'muted' : event.kind === 'interview' ? 'green' : 'blue'}>{event.status === 'cancelled' ? '已取消' : labels[event.kind]}</Badge><strong>{event.title}</strong></div><p>{application.company} · {application.title}</p><p>{dateLabel(event)}</p>{event.location && <p>{event.location}</p>}{event.notes && <p className="calendar-notes">{event.notes}</p>}</div><div className="asset-actions"><Button variant="ghost" disabled={busy} onClick={() => edit(event)}>编辑</Button>{event.status !== 'cancelled' && <Button variant="ghost" disabled={busy} onClick={() => void mutate(() => api.saveCalendarEvent({ ...event, status: 'cancelled' }, event.revision), '安排已标记取消，申请进度保持。')}>取消安排</Button>}<Button variant="ghost" disabled={busy} onClick={() => void mutate(() => api.deleteCalendarEvent(event.applicationId, event.id, event.revision), '安排已删除，申请进度保持。')}>删除</Button></div></article>; })}{!events.length && !loading && <p className="asset-empty">还没有安排。可以为同一申请分别记录笔试、一面、二面等事项。</p>}</div>
  </section>;
}
