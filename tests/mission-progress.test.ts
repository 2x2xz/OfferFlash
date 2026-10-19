import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMissionProgress, createMissionTracker, missionCompletionFromSave, missionEffectMode,
  missionWeek, parseMissionLedger, parseMissionPreferences, summarizeMissionProgress,
} from '../packages/ui/src/mission-progress.js';
import type { Application, ApplicationInput, ApplicationStatus } from '../packages/shared/src/contracts.js';

const now = new Date('2026-10-19T10:00:00Z');
const createdAt = '2026-10-18T10:00:00Z';
function application(id = 'one', status: ApplicationStatus = 'saved', overrides: Partial<Application> = {}): Application {
  return { id, jobId: `job-${id}`, company: '虚构企业', title: '虚构算法岗位', url: 'https://example.invalid/careers',
    status, deadline: null, notes: 'PRIVATE_NOTE_NOT_FOR_LEDGER', demo: false, createdAt, updatedAt: createdAt,
    history: [{ at: createdAt, status, note: '虚构测试记录' }], ...overrides };
}
function moved(before: Application, status: ApplicationStatus = 'applied', at = now.toISOString()): Application {
  return { ...before, status, updatedAt: at, history: [...before.history, { at, status, note: '虚构用户保存' }] };
}
function completion(before: Application | null, after: Application, id = 'receipt-one') {
  const result = missionCompletionFromSave(before ? [before] : [], [after], after, id);
  assert.ok(result); return result;
}
const baseline = (applications: Application[] = []) => advanceMissionProgress(createMissionTracker(), applications, undefined, now).tracker;

test('Shanghai weeks start Monday and handle the UTC boundary and leap day', () => {
  assert.deepEqual(missionWeek(new Date('2026-10-18T15:59:59Z')), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(missionWeek(new Date('2026-10-18T16:00:00Z')), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(missionWeek(new Date('2028-02-29T00:00:00Z')), { start: '2028-02-28', end: '2028-03-05' });
});
test('statistics require applied history and count its first occurrence rather than notes or later stages', () => {
  const before = application(); const applied = moved(before);
  const note = moved(applied, 'applied', '2026-10-26T10:00:00Z');
  const rollback = moved(moved(note, 'saved', '2026-10-27T10:00:00Z'), 'applied', '2026-10-28T10:00:00Z');
  const result = summarizeMissionProgress([rollback, application('only-interview', 'interview'), application('only-offer', 'offer')], now);
  assert.equal(result.totalRecorded, 1); assert.equal(result.weeklyRecorded, 1);
  assert.equal(summarizeMissionProgress([rollback], new Date('2026-10-28T12:00:00Z')).weeklyRecorded, 0);
});
test('missing or ambiguous first dates never become this week through updatedAt or createdAt fallback', () => {
  const unknown = application('unknown', 'applied', { history: [{ at: '', status: 'applied', note: '' }], updatedAt: now.toISOString() });
  const dateOnly = application('date-only', 'applied', { history: [{ at: '2026-10-19', status: 'applied', note: '' }] });
  const lateHistory = application('legacy', 'applied', { history: [{ at: now.toISOString(), status: 'applied', note: '只改备注' }] });
  const result = summarizeMissionProgress([unknown, dateOnly, lateHistory], now);
  assert.equal(result.totalRecorded, 3); assert.equal(result.weeklyRecorded, 0); assert.equal(result.unknownDateCount, 3);
  assert.equal(summarizeMissionProgress([application('empty', 'applied', { history: [] })], now).totalRecorded, 0);
});
test('same-company jobs stay separate even with a shared application URL and duplicate records for one job count once', () => {
  const first = moved(application('first')); const second = moved(application('second'));
  const duplicate = { ...first, id: 'duplicate-id' };
  assert.equal(summarizeMissionProgress([first, second, duplicate], now).weeklyRecorded, 2);
});
test('demo records do not count toward the real goal regardless of visible demo settings', () => {
  const real = moved(application()); const demo = moved(application('demo', 'saved', { demo: true }));
  assert.equal(summarizeMissionProgress([real, demo], now).totalRecorded, 1);
  assert.equal(advanceMissionProgress(baseline(), [demo], { id: 'demo', before: null, after: demo }, now).achievement, undefined);
});
test('the first state is only a baseline and repeated broadcasts or bulk imports never celebrate', () => {
  const first = moved(application('one')); const second = moved(application('two'));
  const initial = advanceMissionProgress(createMissionTracker(), [first], completion(application('one'), first), now);
  assert.equal(initial.achievement, undefined);
  const imported = advanceMissionProgress(initial.tracker, [first, second], undefined, now);
  assert.equal(imported.achievement, undefined);
  assert.equal(advanceMissionProgress(imported.tracker, [first, second], undefined, now).achievement, undefined);
});
test('a genuine explicit save after baseline celebrates once, including when the state broadcast arrives first', () => {
  const before = application(); const after = moved(before); const signal = completion(before, after);
  const broadcast = advanceMissionProgress(baseline([before]), [after], undefined, now);
  assert.equal(broadcast.achievement, undefined);
  const saved = advanceMissionProgress(broadcast.tracker, [after], signal, now);
  assert.deepEqual(saved.achievement, { id: 'receipt-one', kind: 'application-recorded' });
  assert.equal(advanceMissionProgress(saved.tracker, [after], signal, now).achievement, undefined);
});
test('a new target-state record only celebrates with an explicit save receipt, not mere appearance', () => {
  const after = application('new', 'applied', { createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [{ at: now.toISOString(), status: 'applied', note: '' }] });
  const seen = advanceMissionProgress(baseline(), [after], undefined, now);
  assert.equal(seen.achievement, undefined);
  assert.equal(advanceMissionProgress(seen.tracker, [after], completion(null, after), now).achievement?.kind, 'application-recorded');
});
test('manual first later-stage save can acknowledge the stage but never fabricates an applied KPI', () => {
  const before = application(); const after = moved(before, 'interview');
  assert.equal(advanceMissionProgress(baseline([before]), [after], completion(before, after), now).achievement?.kind, 'stage-recorded');
  assert.equal(summarizeMissionProgress([after], now).totalRecorded, 0);
});
test('notes, rollbacks and entering a later stage do not produce another receipt', () => {
  const before = application(); const applied = moved(before); const notes = moved(applied);
  const rollback = moved(applied, 'saved'); const reentered = moved(rollback);
  for (const [previous, next] of [[applied, notes], [rollback, reentered], [applied, moved(applied, 'interview')]] as const) {
    assert.equal(missionCompletionFromSave([previous], [next], next, 'changed'), undefined);
  }
});
test('delete and recreate for the same job cannot celebrate twice, including after a ledger reload', () => {
  const before = application(); const after = moved(before);
  const first = advanceMissionProgress(baseline([before]), [after], completion(before, after), now);
  const deleted = advanceMissionProgress(first.tracker, [], undefined, now);
  const restoredLedger = parseMissionLedger(JSON.stringify(deleted.tracker.ledger));
  const reopened = advanceMissionProgress(createMissionTracker(restoredLedger), [], undefined, now);
  const again = application('recreated', 'applied', { jobId: after.jobId, createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [{ at: now.toISOString(), status: 'applied', note: '' }] });
  assert.equal(advanceMissionProgress(reopened.tracker, [again], completion(null, again, 'again'), now).achievement, undefined);
  assert.ok(!JSON.stringify(restoredLedger).includes('PRIVATE_NOTE'));
  assert.ok(!JSON.stringify(restoredLedger).includes('example.invalid'));
  assert.ok(!JSON.stringify(restoredLedger).includes('虚构企业'));
});
test('no-job fallback preserves distinct titles and remembers a renamed application before deletion', () => {
  const before = application('manual', 'saved', { jobId: undefined }); const after = moved(before);
  const first = advanceMissionProgress(baseline([before]), [after], completion(before, after), now);
  const renamed = moved({ ...after, title: '已更正岗位名' });
  const observed = advanceMissionProgress(first.tracker, [renamed], undefined, now);
  const again = application('new-manual-id', 'applied', { jobId: undefined, title: renamed.title, createdAt: now.toISOString(), history: [{ at: now.toISOString(), status: 'applied', note: '' }], updatedAt: now.toISOString() });
  assert.equal(advanceMissionProgress(observed.tracker, [again], completion(null, again), now).achievement, undefined);
  const other = moved(application('other', 'saved', { jobId: undefined, title: '另一个岗位' }));
  assert.equal(summarizeMissionProgress([after, other], now).totalRecorded, 2);
});
test('ambiguous save matches, changed history prefixes, missing current records and old receipts fail closed', () => {
  const before = application(); const after = moved(before);
  const input: ApplicationInput = { ...after, id: undefined };
  assert.equal(missionCompletionFromSave([before], [after, { ...after, id: 'other' }], input, 'ambiguous'), undefined);
  assert.equal(missionCompletionFromSave([before], [{ ...after, history: [{ ...after.history[0]!, status: 'needs-review' }, after.history[1]!] }], after, 'changed'), undefined);
  assert.equal(advanceMissionProgress(baseline([before]), [], completion(before, after), now).achievement, undefined);
  assert.equal(advanceMissionProgress(baseline([before]), [after], completion(before, after), new Date(now.getTime() + 6 * 60_000)).achievement, undefined);
});
test('local settings validate goal bounds and motion preference does not imply automatic celebration', () => {
  assert.deepEqual(parseMissionPreferences('{broken'), { weeklyGoal: 5, effectsEnabled: true });
  for (const weeklyGoal of [0, 101, -1, 1.5, '8']) assert.equal(parseMissionPreferences({ weeklyGoal }).weeklyGoal, 5);
  assert.deepEqual(parseMissionPreferences({ weeklyGoal: 8, effectsEnabled: false }), { weeklyGoal: 8, effectsEnabled: false });
  assert.equal(missionEffectMode(true, false), 'confetti'); assert.equal(missionEffectMode(true, true), 'static'); assert.equal(missionEffectMode(false, false), 'none');
  const before = application(); const after = moved(before); const signal = completion(before, after);
  const consumedWhileDisabled = advanceMissionProgress(baseline([before]), [after], signal, now);
  assert.equal(advanceMissionProgress(consumedWhileDisabled.tracker, [after], signal, now).achievement, undefined);
});
