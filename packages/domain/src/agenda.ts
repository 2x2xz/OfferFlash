import type { AppState, Application, ApplicationStatus } from '../../shared/src/contracts.js';

export const AGENDA_TIME_ZONE = 'Asia/Shanghai';
export const AGENDA_URGENCIES = ['overdue', 'today', 'upcoming', 'undated'] as const;
export const AGENDA_WAITING_ON = ['user', 'other'] as const;
export type AgendaUrgency = typeof AGENDA_URGENCIES[number];
export type AgendaWaitingOn = typeof AGENDA_WAITING_ON[number];

export interface ApplicationAgendaArgs {
  days?: number;
  includeUndated?: boolean;
  limit?: number;
}
export interface ApplicationAgendaItem {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  date: string | null;
  urgency: AgendaUrgency;
  nextStep: string;
  waitingOn: AgendaWaitingOn;
  demo: boolean;
}
export interface ApplicationAgendaResult {
  timeZone: typeof AGENDA_TIME_ZONE;
  today: string;
  rangeEnd: string;
  days: number;
  includeUndated: boolean;
  limit: number;
  showDemo: boolean;
  counts: Record<AgendaUrgency, number> & {
    outsideRange: number;
    excludedClosed: number;
    excludedDemo: number;
    excludedUndated: number;
  };
  total: number;
  returnedCount: number;
  truncated: boolean;
  items: ApplicationAgendaItem[];
}

function calendarDate(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('当前时间无效。');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENDA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextAction(application: Application, urgency: AgendaUrgency): Pick<ApplicationAgendaItem, 'nextStep' | 'waitingOn'> {
  switch (application.status) {
    case 'needs-review': return {
      waitingOn: 'user',
      nextStep: urgency === 'undated'
        ? '核对这个具体岗位的投递记录，再确认当前进度和下一事项日期；待核对不表示未投递或企业已收到申请。'
        : '记录中的日期仅作为核对待办，先核对这个具体岗位的投递记录和实际期限；待核对不表示未投递或企业已收到申请。',
    };
    case 'saved': return {
      waitingOn: 'user',
      nextStep: urgency === 'overdue'
        ? '记录中的截止日期已过，先核实岗位是否仍接受申请；未提交前保留待投递状态。'
        : urgency === 'undated'
          ? '核实申请截止日期，再准备资料；最终提交由你完成。'
          : '核对岗位和已确认资料，准备申请；最终提交由你完成。',
    };
    case 'applied': return { waitingOn: 'other', nextStep: '等待企业通知，可核对申请进展；记录中的日期不表示需要重新投递。' };
    case 'assessment': return { waitingOn: 'user', nextStep: '核对测评通知和实际截止要求，再完成测评；记录中的日期不等于企业确认。' };
    case 'interview': return { waitingOn: 'user', nextStep: '核对企业邀请中的时间、时区和方式，再准备面试；记录中的日期不等于企业确认。' };
    case 'offer': return { waitingOn: 'user', nextStep: '核对 Offer 条件和回复期限，由你决定是否接受。' };
    default: throw new TypeError('已结束的申请不能进入事项清单。');
  }
}

export function buildApplicationAgenda(
  state: Pick<AppState, 'applications' | 'settings'>,
  args: ApplicationAgendaArgs = {},
  now: Date = new Date(),
): ApplicationAgendaResult {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['days', 'includeUndated', 'limit'].includes(key))) {
    throw new TypeError('事项查询参数无效。');
  }
  const { days = 7, includeUndated = true, limit = 20 } = args;
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new TypeError('days 必须是 1 至 90 的整数。');
  if (typeof includeUndated !== 'boolean') throw new TypeError('includeUndated 必须为布尔值。');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit 必须是 1 至 100 的整数。');
  const today = calendarDate(now);
  // UTC is used only for calendar arithmetic; no event time is inferred from a deadline.
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  const rangeEnd = end.toISOString().slice(0, 10);
  const counts: ApplicationAgendaResult['counts'] = {
    overdue: 0, today: 0, upcoming: 0, undated: 0,
    outsideRange: 0, excludedClosed: 0, excludedDemo: 0, excludedUndated: 0,
  };
  const items: ApplicationAgendaItem[] = [];
  for (const application of state.applications) {
    if (application.demo && !state.settings.showDemo) { counts.excludedDemo++; continue; }
    if (['rejected', 'withdrawn'].includes(application.status)) { counts.excludedClosed++; continue; }
    const date = application.deadline;
    if (date !== null && date > rangeEnd) { counts.outsideRange++; continue; }
    const urgency: AgendaUrgency = date === null ? 'undated' : date < today ? 'overdue' : date === today ? 'today' : 'upcoming';
    counts[urgency]++;
    if (urgency === 'undated' && !includeUndated) { counts.excludedUndated++; continue; }
    items.push({
      id: application.id, company: application.company, title: application.title, status: application.status,
      date, urgency, ...nextAction(application, urgency), demo: application.demo,
    });
  }
  items.sort((a, b) => AGENDA_URGENCIES.indexOf(a.urgency) - AGENDA_URGENCIES.indexOf(b.urgency)
    || (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id));
  const returned = items.slice(0, limit);
  return {
    timeZone: AGENDA_TIME_ZONE, today, rangeEnd, days, includeUndated, limit, showDemo: state.settings.showDemo,
    counts, total: items.length, returnedCount: returned.length, truncated: returned.length < items.length, items: returned,
  };
}
