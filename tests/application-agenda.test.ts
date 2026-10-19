import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplicationAgenda, type ApplicationAgendaArgs } from '../packages/domain/src/agenda.js';
import type { AppState, Application } from '../packages/shared/src/contracts.js';

function application(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id, company: '同一家虚构企业', title: `测试岗位 ${id}`, status: 'saved', deadline: '2026-10-12',
    notes: 'PRIVATE_NOTE_MUST_NOT_ENTER_AGENDA', url: 'https://example.invalid/application', demo: false,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', history: [], ...overrides,
  };
}
function state(applications: Application[], showDemo = false): Pick<AppState, 'applications' | 'settings'> {
  return { applications, settings: { showDemo } };
}
const now = new Date('2026-10-12T00:00:00Z');

test('agenda uses Shanghai midnight rather than the UTC calendar date', () => {
  const input = state([application('due', { deadline: '2026-10-11' })]);
  const before = buildApplicationAgenda(input, {}, new Date('2026-10-11T15:59:59Z'));
  const after = buildApplicationAgenda(input, {}, new Date('2026-10-11T16:00:00Z'));
  assert.equal(before.timeZone, 'Asia/Shanghai');
  assert.equal(before.today, '2026-10-11');
  assert.equal(before.items[0]?.urgency, 'today');
  assert.equal(after.today, '2026-10-12');
  assert.equal(after.items[0]?.urgency, 'overdue');
  assert.equal(after.rangeEnd, '2026-10-18');
});

test('the inclusive calendar window handles leap day and keeps date-only values', () => {
  const result = buildApplicationAgenda(state([
    application('past', { deadline: '2028-02-28' }),
    application('leap', { deadline: '2028-02-29' }),
    application('end', { deadline: '2028-03-06' }),
    application('beyond', { deadline: '2028-03-07' }),
  ]), { days: 7 }, new Date('2028-02-28T16:00:00Z'));
  assert.equal(result.today, '2028-02-29');
  assert.equal(result.rangeEnd, '2028-03-06');
  assert.deepEqual(result.items.map(item => [item.id, item.date, item.urgency]), [
    ['past', '2028-02-28', 'overdue'], ['leap', '2028-02-29', 'today'], ['end', '2028-03-06', 'upcoming'],
  ]);
  assert.equal(result.counts.outsideRange, 1);
  assert.ok(result.items.every(item => item.date === null || /^\d{4}-\d{2}-\d{2}$/.test(item.date)));
});

test('overdue records retain application status and a submitted record does not become a new submission task', () => {
  const input = state([
    application('saved', { deadline: '2020-01-01' }),
    application('submitted', { status: 'applied', deadline: '2020-01-01' }),
  ]);
  const snapshot = structuredClone(input);
  Object.freeze(input.applications[0]); Object.freeze(input.applications[1]); Object.freeze(input.applications); Object.freeze(input);
  const result = buildApplicationAgenda(input, {}, now);
  const saved = result.items.find(item => item.id === 'saved')!;
  const submitted = result.items.find(item => item.id === 'submitted')!;
  assert.equal(saved.status, 'saved');
  assert.equal(saved.waitingOn, 'user');
  assert.match(saved.nextStep, /先核实/);
  assert.equal(submitted.status, 'applied');
  assert.equal(submitted.waitingOn, 'other');
  assert.match(submitted.nextStep, /不表示需要重新投递/);
  assert.deepEqual(input, snapshot);
});

test('assessment and interview dates are not confirmations and an offer remains the user decision', () => {
  const result = buildApplicationAgenda(state([
    application('assessment', { status: 'assessment' }),
    application('interview', { status: 'interview' }),
    application('offer', { status: 'offer' }),
  ]), {}, now);
  for (const id of ['assessment', 'interview']) {
    const item = result.items.find(item => item.id === id)!;
    assert.match(item.nextStep, /不等于企业确认/);
    assert.equal(item.waitingOn, 'user');
  }
  assert.match(result.items.find(item => item.id === 'offer')!.nextStep, /由你决定是否接受/);
});

test('two roles at the same company remain separate and ordering uses urgency then date', () => {
  const result = buildApplicationAgenda(state([
    application('unknown', { deadline: null }), application('later', { deadline: '2026-10-17' }),
    application('today-b'), application('old-b', { deadline: '2026-10-10' }),
    application('today-a'), application('old-a', { deadline: '2026-10-09' }),
  ]), {}, now);
  assert.deepEqual(result.items.map(item => item.id), ['old-a', 'old-b', 'today-a', 'today-b', 'later', 'unknown']);
  assert.equal(result.total, 6);
  assert.deepEqual(result.items.filter(item => item.urgency === 'today').map(item => item.title), ['测试岗位 today-a', '测试岗位 today-b']);
});

test('demo visibility follows settings and closed records are excluded without exposing private notes', () => {
  const input = state([
    application('real'), application('demo', { demo: true }),
    application('rejected', { status: 'rejected' }), application('withdrawn', { status: 'withdrawn' }),
  ]);
  const hidden = buildApplicationAgenda(input, {}, now);
  assert.deepEqual(hidden.items.map(item => item.id), ['real']);
  assert.equal(hidden.counts.excludedDemo, 1);
  assert.equal(hidden.counts.excludedClosed, 2);
  assert.ok(!JSON.stringify(hidden).includes('PRIVATE_NOTE_MUST_NOT_ENTER_AGENDA'));
  assert.deepEqual(Object.keys(hidden.items[0]!).sort(), ['company', 'date', 'demo', 'id', 'nextStep', 'status', 'title', 'urgency', 'waitingOn'].sort());
  const visible = buildApplicationAgenda({ ...input, settings: { showDemo: true } }, {}, now);
  assert.equal(visible.total, 2);
  assert.equal(visible.items.find(item => item.id === 'demo')?.demo, true);
});

test('truncation counts the full bounded match set and separately reports future and excluded undated records', () => {
  const result = buildApplicationAgenda(state([
    ...Array.from({ length: 25 }, (_, index) => application(`today-${String(index).padStart(2, '0')}`)),
    application('future', { deadline: '2026-10-19' }), application('undated', { deadline: null }),
  ]), { includeUndated: false }, now);
  assert.equal(result.total, 25);
  assert.equal(result.returnedCount, 20);
  assert.equal(result.truncated, true);
  assert.equal(result.counts.today, 25);
  assert.equal(result.counts.undated, 1);
  assert.equal(result.counts.excludedUndated, 1);
  assert.equal(result.counts.outsideRange, 1);
  assert.ok(!result.items.some(item => item.id === 'undated' || item.id === 'future'));
});

test('a one-day window contains today, overdue and optional undated items but no tomorrow', () => {
  const result = buildApplicationAgenda(state([
    application('today'), application('tomorrow', { deadline: '2026-10-13' }), application('none', { deadline: null }),
  ]), { days: 1, limit: 100 }, now);
  assert.equal(result.rangeEnd, result.today);
  assert.equal(result.total, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.counts.outsideRange, 1);
});

test('invalid query arguments and invalid host time fail instead of silently changing scope', () => {
  const input = state([]);
  const invalid: unknown[] = [
    null, [], 'seven', { days: 0 }, { days: 91 }, { days: 1.5 }, { days: '7' }, { days: null },
    { days: NaN }, { days: Infinity }, { limit: 0 }, { limit: 101 }, { limit: 2.5 },
    { includeUndated: 'true' }, { includeUndated: null }, { includeDemo: true },
  ];
  for (const args of invalid) assert.throws(() => buildApplicationAgenda(input, args as ApplicationAgendaArgs, now), TypeError);
  assert.throws(() => buildApplicationAgenda(input, {}, new Date('invalid')), /当前时间无效/);
});

test('editing a saved date changes the derived agenda without another persistent agenda state', () => {
  const input = state([application('edit', { deadline: '2026-10-19' })]);
  assert.equal(buildApplicationAgenda(input, {}, now).total, 0);
  input.applications[0]!.deadline = '2026-10-12';
  const result = buildApplicationAgenda(input, {}, now);
  assert.equal(result.items[0]?.id, 'edit');
  assert.equal(result.items[0]?.urgency, 'today');
});
