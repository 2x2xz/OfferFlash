import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, Application, Job } from '../packages/shared/src/contracts.js';
import { deriveDashboardState } from '../packages/ui/src/dashboard-state.js';
import { activateFromKeyboard, type ActivationKeyEvent } from '../packages/ui/src/keyboard.js';

const now = new Date('2026-10-11T16:30:00Z'); // October 12 in Shanghai, still October 11 in UTC.
function application(id: string, status: Application['status'], deadline: string | null, demo = false): Application {
  return {
    id, company: '虚构申请公司', title: `测试岗位 ${id}`, url: `https://example.invalid/${id}`, status, deadline, demo,
    notes: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-11T01:00:00Z', history: [],
  };
}
function job(id: string, eligible: Job['match']['eligible'], score: number, demo = false): Job {
  return { id, company: '虚构岗位公司', title: `算法岗位 ${id}`, city: '杭州', type: 'campus', description: '仅用于测试的岗位', requirements: '条件按规则记录',
    url: `https://example.invalid/jobs/${id}`, sourceId: 'fixture', sourceName: '虚构测试来源', publishedAt: null, deadline: null,
    observedAt: '2026-10-11T00:00:00Z', firstSeenAt: '2026-10-10T00:00:00Z', demo,
    match: { eligible, score, reasons: ['原有规则原因'], concerns: eligible === 'likely' ? [] : ['需要核对的原始条件'], profileVersion: 2 } };
}
function world(): AppState {
  return {
    profile: { version: 2, updatedAt: '2026-10-11T00:00:00Z', fullName: '测试用户', fullNameEn: '', email: '', phone: '', school: '虚构大学', schoolEn: '', degree: '硕士', major: '计算机', majorEn: '', graduationMonth: '2027-06', skills: ['Python'], cities: ['杭州'], targetRoles: ['算法'], resumeText: '' },
    jobs: [job('high-but-unsuitable', 'unsuitable', 100), job('review', 'review', 98), job('likely', 'likely', 20), job('demo-likely', 'likely', 99, true)],
    applications: [application('waiting', 'applied', '2026-10-11'), application('todo', 'assessment', '2026-10-12'), application('reply', 'offer', '2026-10-13'),
      application('undated', 'saved', null), application('closed', 'withdrawn', '2026-10-10'), application('rejected', 'rejected', '2026-10-10'),
      application('far', 'saved', '2026-10-19'), application('demo-application', 'interview', '2026-10-12', true)],
    settings: { showDemo: false }, sourceRuns: [],
  };
}

test('dashboard recommendations prioritize known eligibility without rewriting scores or hiding unknown candidates', () => {
  const state = world();
  state.jobs[1]!.type = 'unknown';
  const before = structuredClone(state);
  const view = deriveDashboardState(state, now);
  assert.deepEqual(view.recommended.map(item => item.id), ['likely', 'review']);
  assert.equal(view.recommended[0]!.match.score, 20);
  assert.equal(view.recommended[1]!.type, 'unknown');
  assert.equal(view.recommended[1]!.match.eligible, 'review');
  assert.equal(view.visibleJobs.length, 3, 'known unsuitable jobs remain available in the normal list');
  assert.deepEqual(state, before, 'deriving dashboard state never changes stored facts, scores or history');
  const unsuitableOnly = { ...state, jobs: [state.jobs[0]!] };
  const emptyRecommendations = deriveDashboardState(unsuitableOnly, now);
  assert.equal(emptyRecommendations.counts.jobs, 1);
  assert.deepEqual(emptyRecommendations.recommended, [], 'an unsuitable-only library must not invent a recommended candidate');
});

test('dashboard agenda uses Shanghai calendar boundaries and preserves user tasks versus waiting for the employer', () => {
  const state = world(); const before = structuredClone(state);
  const view = deriveDashboardState(state, now);
  assert.equal(view.agenda.today, '2026-10-12');
  assert.equal(view.agenda.rangeEnd, '2026-10-18');
  assert.equal(view.agenda.total, 4, 'undated matters and Offer reply deadlines belong to the existing agenda');
  assert.equal(view.agenda.returnedCount, 3);
  assert.equal(view.agenda.truncated, true);
  assert.deepEqual(view.agenda.items.map(item => [item.id, item.waitingOn, item.urgency]), [
    ['waiting', 'other', 'overdue'], ['todo', 'user', 'today'], ['reply', 'user', 'upcoming'],
  ]);
  assert.match(view.agenda.items[0]!.nextStep, /不表示需要重新投递/);
  assert.match(view.agenda.items[2]!.nextStep, /由你决定是否接受/);
  assert.equal(view.agenda.counts.excludedClosed, 2);
  assert.equal(view.agenda.counts.excludedDemo, 1);
  assert.equal(view.agenda.counts.outsideRange, 1);
  assert.deepEqual(view.counts, { jobs: 3, progressing: 2, agenda: 4, offers: 1 });
  assert.deepEqual(state, before, 'a past date does not close, resubmit or otherwise mutate an application');
});

test('showing demo data updates the same dashboard scopes and recent records keep their real update order', () => {
  const state = world();
  state.settings.showDemo = true;
  state.applications.find(item => item.id === 'reply')!.updatedAt = '2026-10-12T01:00:00Z';
  const view = deriveDashboardState(state, now);
  assert.deepEqual(view.recommended.map(item => item.id), ['demo-likely', 'likely', 'review']);
  assert.equal(view.counts.jobs, 4);
  assert.equal(view.counts.progressing, 3);
  assert.equal(view.agenda.total, 5);
  assert.equal(view.agenda.counts.excludedDemo, 0);
  assert.equal(view.recentApplications[0]!.id, 'reply');
  assert.ok(view.visibleApplications.some(item => item.status === 'withdrawn'), 'ended history remains viewable outside the agenda');
});

test('dashboard totals do not mistake the three-item preview for all matters, and empty state stays empty', () => {
  const state = world();
  state.applications = Array.from({ length: 110 }, (_, index) => application(`pending-${index}`, 'saved', null));
  const large = deriveDashboardState(state, now);
  assert.equal(large.counts.agenda, 110);
  assert.equal(large.agenda.items.length, 3);
  assert.equal(large.agenda.counts.undated, 110);
  state.applications = []; state.jobs = [];
  const empty = deriveDashboardState(state, now);
  assert.deepEqual(empty.counts, { jobs: 0, progressing: 0, agenda: 0, offers: 0 });
  assert.deepEqual(empty.agenda.items, []);
  assert.deepEqual(empty.recommended, []);
});

function event(key: string, changes: Partial<ActivationKeyEvent> = {}) {
  let prevented = 0;
  return { input: { key, preventDefault() { prevented++; }, ...changes }, prevented: () => prevented };
}
test('focusable application cards activate once with Enter or Space, suppressing their browser default', () => {
  for (const key of ['Enter', ' ']) {
    const keyEvent = event(key); let activations = 0;
    assert.equal(activateFromKeyboard(keyEvent.input, () => { activations++; }), true);
    assert.equal(activations, 1);
    assert.equal(keyEvent.prevented(), 1, 'Space must never scroll the page while opening the record');
  }
});

test('holding activation keys does not reopen records, and repeated Space still cannot scroll', () => {
  for (const key of ['Enter', ' ']) {
    const keyEvent = event(key, { repeat: true }); let activations = 0;
    assert.equal(activateFromKeyboard(keyEvent.input, () => { activations++; }), false);
    assert.equal(activations, 0);
    assert.equal(keyEvent.prevented(), 1);
  }
});

test('Tab, Escape, composition and previously handled events are not stolen by card activation', () => {
  for (const keyEvent of [event('Tab'), event('Escape'), event('ArrowDown'), event('Enter', { isComposing: true }),
    event(' ', { nativeEvent: { isComposing: true } }), event('Enter', { defaultPrevented: true })]) {
    let activations = 0;
    assert.equal(activateFromKeyboard(keyEvent.input, () => { activations++; }), false);
    assert.equal(activations, 0);
    assert.equal(keyEvent.prevented(), 0);
  }
});

test('recommendations recheck date-only and exact-time expiry after midnight without changing saved matches', () => {
  const state = world();
  const job = state.jobs.find(item => item.id === 'likely')!;
  job.deadline = '2026-10-12';
  assert.ok(deriveDashboardState(state, new Date('2026-10-12T15:59:59Z')).recommended.some(item => item.id === job.id));
  assert.ok(!deriveDashboardState(state, new Date('2026-10-12T16:00:00Z')).recommended.some(item => item.id === job.id));
  assert.ok(deriveDashboardState(state, new Date('2026-10-12T16:00:00Z')).visibleJobs.some(item => item.id === job.id));
  assert.equal(job.match.eligible, 'likely', 'view filtering does not rewrite saved facts');
  job.deadline = '2026-10-12T08:00:00Z';
  assert.ok(!deriveDashboardState(state, new Date('2026-10-12T08:00:01Z')).recommended.some(item => item.id === job.id));
});

test('merged dashboard keeps a dated needs-review record as a user verification matter without inferring submission', () => {
  const state = world();
  const review = application('verification', 'needs-review', '2026-10-12');
  review.notes = '公司级备注：已投；这个具体岗位的投递记录尚未核实。';
  review.history = [{ at: review.createdAt, status: 'needs-review', note: review.notes }];
  state.applications = [review, application('already-applied', 'applied', null), application('closed', 'withdrawn', '2026-10-12')];
  const before = structuredClone(state);

  const view = deriveDashboardState(state, now);
  const matter = view.agenda.items.find(item => item.id === review.id);
  assert.ok(matter, 'the explicitly dated verification record must remain in the dashboard agenda');
  assert.equal(matter.status, 'needs-review');
  assert.equal(matter.date, '2026-10-12');
  assert.equal(matter.urgency, 'today');
  assert.equal(matter.waitingOn, 'user');
  assert.match(matter.nextStep, /核对这个具体岗位的投递记录/);
  assert.match(matter.nextStep, /待核对不表示未投递或企业已收到申请/);
  assert.equal(view.counts.progressing, 1, 'only the separately confirmed applied record counts as an active application');
  assert.equal(view.counts.agenda, 2);
  assert.equal(view.agenda.counts.excludedClosed, 1);
  assert.deepEqual(state, before, 'dashboard projection must preserve statuses, notes, histories and other saved facts');
});
