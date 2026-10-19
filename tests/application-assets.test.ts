import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Application, Profile } from '../packages/shared/src/contracts.js';
import { applicationLocalTimeToUTC, applicationUTCToLocal, type ApplicationCalendarEventInput, type ConfirmedAnswerInput, type ResumeFileMetadata } from '../packages/shared/src/application-assets.js';
import { createApplicationAssetsStore, isHighImpactQuestion, normalizeAnswerQuestion, removeApplicationAssets } from '../packages/domain/src/application-assets.js';
import { deleteDocument, openDatabaseFile, readDocument, writeDocument } from '../packages/domain/src/sqlite.js';

const now = '2026-10-19T02:00:00.000Z';
const profile: Profile = { version: 3, updatedAt: now, fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '' };
function application(id: string, demo = false): Application { return { id, company: '虚构企业', title: '大模型算法工程师', status: 'applied', url: 'https://example.invalid/application', deadline: null, notes: '', demo, createdAt: now, updatedAt: now, history: [{ at: now, status: 'applied', note: '虚构测试记录' }] }; }
const answer = (changes: Partial<ConfirmedAnswerInput> = {}): ConfirmedAnswerInput => ({ questionPattern: '请介绍你的项目经验', answer: '原创虚构项目回答。', scope: { kind: 'general' }, risk: 'ordinary', demo: false, ...changes });
const resume = (changes: Partial<ResumeFileMetadata> = {}): ResumeFileMetadata => ({ label: '算法版', directions: ['大模型', '算法'], demo: false, fileId: randomUUID(), fileName: 'fictional-resume.pdf', sha256: 'a'.repeat(64), sizeBytes: 1000, ...changes });
const event = (changes: Partial<ApplicationCalendarEventInput> = {}): ApplicationCalendarEventInput => ({ applicationId: 'real-application', kind: 'interview', title: '虚构一面', startsAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T07:00:00.000Z', timeZone: 'Asia/Shanghai', status: 'scheduled', location: '虚构线上会议', notes: '测试备注', ...changes });
async function withAssets(body: (context: { file: Awaited<ReturnType<typeof openDatabaseFile>>; assets: ReturnType<typeof createApplicationAssetsStore>; directory: string }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-assets-')); const file = await openDatabaseFile({ directory });
  try { await file.transact(db => { writeDocument(db, 'profile', 'current', profile, now); writeDocument(db, 'settings', 'current', { showDemo: false }, now); for (const item of [application('real-application'), application('other-application'), application('demo-application', true)]) writeDocument(db, 'application', item.id, item, now); });
    await body({ file, assets: createApplicationAssetsStore(file), directory });
  } finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
}

test('answer drafts require explicit revision and current-profile confirmation; edits and profile changes invalidate eligibility', async () => withAssets(async ({ file, assets }) => {
  const initial = await assets.saveAnswer(answer(), null); const draft = initial.answers[0]!;
  assert.equal(draft.confirmedRevision, null); assert.equal((await assets.answerSuggestions(draft.questionPattern, 'real-application'))[0]!.automaticEligible, false);
  const saved = await assets.confirmAnswer(draft.id, draft.revision, 3); const confirmed = saved.answers[0]!;
  assert.equal(confirmed.revision, 2); assert.equal(confirmed.confirmedRevision, 2); assert.equal(confirmed.confirmedProfileVersion, 3);
  assert.equal((await assets.answerSuggestions(draft.questionPattern, 'real-application'))[0]!.automaticEligible, true);
  const outcomes = await Promise.allSettled([assets.saveAnswer({ ...confirmed, answer: '虚构修改一' }, 2), assets.saveAnswer({ ...confirmed, answer: '虚构修改二' }, 2)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  const changed = (await assets.getState()).answers[0]!; assert.equal(changed.confirmedRevision, null);
  await assert.rejects(assets.confirmAnswer(changed.id, changed.revision, 2), /资料已变化/u);
  await assets.confirmAnswer(changed.id, changed.revision, 3);
  await file.transact(db => writeDocument(db, 'profile', 'current', { ...profile, version: 4 }, now));
  assert.equal((await assets.answerSuggestions(draft.questionPattern, 'real-application'))[0]!.automaticEligible, false);
}));

test('answer matching is whole-question exact, scope-specific, demo-isolated and ambiguous duplicates are never automatic', async () => withAssets(async ({ file, assets }) => {
  const global = (await assets.saveAnswer(answer(), null)).answers[0]!; await assets.confirmAnswer(global.id, 1, 3);
  assert.equal((await assets.answerSuggestions('请介绍你的项目经验？', 'real-application')).length, 1);
  assert.equal((await assets.answerSuggestions('请介绍你的项目经验及期望薪资', 'real-application')).length, 0);
  const company = (await assets.saveAnswer(answer({ answer: '虚构企业专用回答', scope: { kind: 'application', applicationId: 'real-application' } }), null)).answers.find(item => item.scope.kind === 'application')!;
  await assets.confirmAnswer(company.id, 1, 3);
  assert.deepEqual((await assets.answerSuggestions(company.questionPattern, 'real-application')).map(item => item.answer.id), [company.id]);
  assert.deepEqual((await assets.answerSuggestions(global.questionPattern, 'other-application')).map(item => item.answer.id), [global.id]);
  await assets.saveAnswer(answer({ scope: { kind: 'application', applicationId: 'real-application' } }), null);
  assert.ok((await assets.answerSuggestions(company.questionPattern, 'real-application')).every(item => !item.automaticEligible));
  assert.deepEqual(await assets.answerSuggestions(global.questionPattern, 'demo-application'), []);
  await assert.rejects(assets.saveAnswer(answer({ scope: { kind: 'application', applicationId: 'demo-application' } }), null), /演示/u);
  await assets.saveAnswer(answer({ demo: true }), null); assert.equal((await assets.getState()).answers.some(item => item.demo), false);
  await file.transact(db => writeDocument(db, 'settings', 'current', { showDemo: true }, now)); assert.equal((await assets.getState()).answers.filter(item => item.demo).length, 1);
}));

test('host high-impact classification cannot be downgraded by renderer risk flags or confirmation', async () => withAssets(async ({ assets }) => {
  for (const question of ['你的期望薪资', '是否需要工作签证', '是否同意上述协议', '本人家属是否在职', 'Have you any legal restrictions?', 'Work authorization status', 'Conflicts of interest', 'Conflict-of-interest declaration']) assert.equal(isHighImpactQuestion(question), true, question);
  const draft = (await assets.saveAnswer(answer({ questionPattern: '你的期望薪资', risk: 'ordinary' }), null)).answers[0]!;
  assert.equal(draft.risk, 'high-impact'); const confirmed = (await assets.confirmAnswer(draft.id, 1, 3)).answers[0]!;
  assert.equal((await assets.answerSuggestions(draft.questionPattern, 'real-application'))[0]!.automaticEligible, false);
  const changed = (await assets.saveAnswer({ ...confirmed, questionPattern: '普通问题', risk: 'ordinary' }, confirmed.revision)).answers[0]!;
  assert.equal(changed.risk, 'high-impact', 'an existing high-impact record cannot be relabelled into an automatic answer');
  assert.notEqual(normalizeAnswerQuestion('C++ 项目'), normalizeAnswerQuestion('C# 项目'));
  assert.notEqual(normalizeAnswerQuestion('A / B'), normalizeAnswerQuestion('A + B'));
}));

test('stale deletes cannot erase edits and deleted answers cannot be resurrected by a stale draft', async () => withAssets(async ({ assets }) => {
  const draft = (await assets.saveAnswer(answer(), null)).answers[0]!;
  await assets.confirmAnswer(draft.id, 1, 3);
  await assert.rejects(assets.deleteAnswer(draft.id, 1), /更新/u); await assets.deleteAnswer(draft.id, 2);
  await assert.rejects(assets.saveAnswer(draft, null), /删除/u);
  await assert.rejects(assets.confirmAnswer(draft.id, 2, 3), /更新|删除/u);
}));

test('resume metadata accepts controlled host IDs only, recommends matching directions and explicit selection never mutates applications', async () => withAssets(async ({ file, assets }) => {
  const before = await file.read(db => readDocument(db, 'application', 'real-application'));
  const data = resume(); const state = await assets.importResumeVersion(data); const version = state.resumeVersions[0]!;
  assert.equal(version.profileVersion, 3); assert.equal(version.fileId, data.fileId); assert.equal('path' in version, false);
  assert.deepEqual(state.resumeRecommendations['real-application']![0]!.matchedDirections, ['大模型', '算法']);
  assert.equal(state.resumeSelections.length, 0, 'a recommendation does not select or upload a file');
  const selected = await assets.selectApplicationResume('real-application', version.id, null); assert.equal(selected.resumeSelections[0]!.resumeVersionId, version.id);
  await assert.rejects(assets.selectApplicationResume('real-application', null, null), /更新/u);
  await assert.rejects(assets.selectApplicationResume('demo-application', version.id, null), /演示/u);
  assert.deepEqual(await file.read(db => readDocument(db, 'application', 'real-application')), before);
  await assert.rejects(assets.importResumeVersion(data), /文件标识/u);
  for (const changes of [{ fileId: '../../private' }, { fileName: '../private.pdf' }, { fileName: 'fake.exe' }, { sizeBytes: 0 }, { sizeBytes: 21 * 1024 * 1024 }, { sha256: 'not-a-hash' }]) await assert.rejects(assets.importResumeVersion(resume(changes)));
}));

test('resume edits use optimistic revisions and deletion clears selections with a newer revision', async () => withAssets(async ({ assets }) => {
  const version = (await assets.importResumeVersion(resume())).resumeVersions[0]!;
  await assets.selectApplicationResume('real-application', version.id, null);
  await assets.saveResumeVersion({ id: version.id, label: '虚构新版说明', directions: ['研究'] }, 1);
  await assert.rejects(assets.deleteResumeVersion(version.id, 1), /更新/u);
  const state = await assets.deleteResumeVersion(version.id, 2); assert.equal(state.resumeVersions.length, 0);
  assert.equal(state.resumeSelections[0]!.resumeVersionId, null); assert.equal(state.resumeSelections[0]!.revision, 2);
  await assert.rejects(assets.selectApplicationResume('real-application', null, 1), /更新/u);
}));

test('calendar supports multiple bound events, revisions, cancellation and no application-status side effects', async () => withAssets(async ({ file, assets }) => {
  const before = await file.read(db => readDocument(db, 'application', 'real-application'));
  let state = await assets.saveCalendarEvent(event(), null); const first = state.calendarEvents[0]!;
  state = await assets.saveCalendarEvent(event({ title: '虚构笔试', kind: 'assessment', startsAt: '2026-10-21T06:00:00Z', endsAt: '2026-10-21T07:00:00Z' }), null);
  assert.equal(state.calendarEvents.length, 2); assert.equal(first.timeZone, 'Asia/Shanghai');
  await assert.rejects(assets.saveCalendarEvent({ ...first, applicationId: 'other-application' }, 1), /另一申请/u);
  await assert.rejects(assets.deleteCalendarEvent('other-application', first.id, 1), /不属于/u);
  const cancelled = await assets.saveCalendarEvent({ ...first, status: 'cancelled' }, 1); assert.equal(cancelled.calendarEvents.find(item => item.id === first.id)!.status, 'cancelled');
  await assert.rejects(assets.deleteCalendarEvent('real-application', first.id, 1), /更新/u); await assets.deleteCalendarEvent('real-application', first.id, 2);
  await assert.rejects(assets.saveCalendarEvent(first, null), /删除/u);
  assert.deepEqual(await file.read(db => readDocument(db, 'application', 'real-application')), before);
}));

test('calendar rejects ambiguous instants, nonexistent dates, invalid zones and unsafe duration ranges', async () => withAssets(async ({ assets }) => {
  for (const changes of [ { startsAt: '2026-10-20T14:00:00+08:00' }, { startsAt: '2026-02-30T06:00:00Z' }, { timeZone: 'invalid/private' },
    { endsAt: '2026-10-20T05:00:00Z' }, { endsAt: '2026-12-20T07:00:00Z' } ]) await assert.rejects(assets.saveCalendarEvent(event(changes), null));
  assert.equal((await assets.getState()).calendarEvents.length, 0, 'invalid updates leave no partial calendar document');
}));

test('IANA wall-time conversion is explicit and rejects DST gaps and duplicate local times', () => {
  assert.equal(applicationLocalTimeToUTC('2026-10-20T14:00', 'Asia/Shanghai'), '2026-10-20T06:00:00.000Z');
  assert.equal(applicationUTCToLocal('2026-10-20T06:00:00.000Z', 'Asia/Shanghai'), '2026-10-20T14:00');
  assert.equal(applicationLocalTimeToUTC('2026-10-20T14:00', 'America/New_York'), '2026-10-20T18:00:00.000Z');
  assert.throws(() => applicationLocalTimeToUTC('2026-03-08T02:30', 'America/New_York'), /不存在/u);
  assert.throws(() => applicationLocalTimeToUTC('2026-11-01T01:30', 'America/New_York'), /重复/u);
  assert.throws(() => applicationLocalTimeToUTC('2026-02-29T10:30', 'Asia/Shanghai'), /无效/u);
});

test('ICS preserves stable event IDs, UTC times, revision and cancellations; content cannot inject extra events', async () => withAssets(async ({ assets }) => {
  const longTitle = '虚构中文面试'.repeat(20);
  const created = (await assets.saveCalendarEvent(event({ title: longTitle, notes: '第一行\nBEGIN:VEVENT\nSUMMARY:不能注入', location: '地点;逗号,反斜杠\\' }), null)).calendarEvents[0]!;
  await assets.saveCalendarEvent({ ...created, status: 'cancelled' }, 1);
  const ics = await assets.exportCalendar('real-application'); const unfolded = ics.replace(/\r\n /gu, '');
  assert.equal((unfolded.match(/^BEGIN:VEVENT$/gmu) ?? []).length, 1); assert.ok(unfolded.includes(`UID:${created.id}@offeragent.local`));
  assert.ok(unfolded.includes('DTSTART:20261020T060000Z')); assert.ok(unfolded.includes('SEQUENCE:2')); assert.ok(unfolded.includes('STATUS:CANCELLED'));
  assert.ok(unfolded.includes('DESCRIPTION:第一行\\nBEGIN:VEVENT\\nSUMMARY:不能注入'));
  assert.ok(unfolded.includes('LOCATION:地点\\;逗号\\,反斜杠\\\\'));
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75), 'UTF-8 folding stays within the RFC line length');
  assert.ok(!ics.includes('\uFFFD')); assert.equal((await assets.exportCalendar('other-application')).includes('BEGIN:VEVENT'), false);
}));

test('deleted applications disappear from answer, selection and calendar UI even before optional physical cleanup', async () => withAssets(async ({ file, assets }) => {
  const specific = (await assets.saveAnswer(answer({ scope: { kind: 'application', applicationId: 'real-application' } }), null)).answers[0]!;
  const version = (await assets.importResumeVersion(resume())).resumeVersions[0]!; await assets.selectApplicationResume('real-application', version.id, null); await assets.saveCalendarEvent(event(), null);
  await file.transact(db => deleteDocument(db, 'application', 'real-application'));
  const state = await assets.getState(); assert.equal(state.answers.length, 0); assert.equal(state.resumeSelections.length, 0); assert.equal(state.calendarEvents.length, 0); assert.equal(state.resumeVersions.length, 1);
  await assert.rejects(assets.answerSuggestions(specific.questionPattern, 'real-application'), /不存在/u);
  await assert.rejects(assets.saveCalendarEvent(event(), null), /不存在/u);
  await file.transact(db => removeApplicationAssets(db, 'real-application'));
  assert.equal(await file.read(db => readDocument(db, 'confirmed_answer', specific.id)), undefined);
}));

test('assets share the exact business SQLite transaction owner and survive a close/reopen without loose parallel stores', async () => withAssets(async ({ file, assets, directory }) => {
  const draft = (await assets.saveAnswer(answer(), null)).answers[0]!;
  await assets.confirmAnswer(draft.id, 1, 3);
  const version = (await assets.importResumeVersion(resume())).resumeVersions[0]!;
  await assets.selectApplicationResume('real-application', version.id, null);
  await assets.saveCalendarEvent(event(), null);
  await file.close();
  const reopened = await openDatabaseFile({ directory });
  try {
    const restored = await createApplicationAssetsStore(reopened).getState();
    assert.equal(restored.answers[0]!.confirmedRevision, 2);
    assert.equal(restored.resumeVersions[0]!.fileId, version.fileId);
    assert.equal(restored.resumeSelections[0]!.resumeVersionId, version.id);
    assert.equal(restored.calendarEvents[0]!.applicationId, 'real-application');
    assert.equal(await reopened.read(db => readDocument<Profile>(db, 'profile', 'current')?.version), 3);
  } finally { await reopened.close(); }
}));

test('calendar export rejects invalid explicit scopes instead of silently broadening to all applications', async () => withAssets(async ({ assets }) => {
  await assets.saveCalendarEvent(event(), null);
  await assets.saveCalendarEvent(event({ applicationId: 'other-application', title: '另一虚构申请的笔试' }), null);
  const count = (value: string) => (value.match(/^BEGIN:VEVENT$/gmu) ?? []).length;
  assert.equal(count(await assets.exportCalendar()), 2, 'only an omitted scope explicitly means all visible applications');
  assert.equal(count(await assets.exportCalendar('real-application')), 1);
  for (const invalid of ['', null, 0, false]) await assert.rejects(assets.exportCalendar(invalid as unknown as string), /ID无效/u);
  await assert.rejects(assets.exportCalendar('nonexistent-application'), /不存在/u);
}));
