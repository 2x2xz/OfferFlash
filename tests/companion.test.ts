import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION_ISSUE_REASONS, type ApplicationWorkflowIssue } from '../packages/shared/src/application-workflow.js';
import { applicationIssueCanRemember, applicationIssueGuidance, applicationQuestionCanRemember, companionPreferences, companionProgress,
  COMPANION_STATUS_HINTS, COMPANION_STATUS_LABELS, queueCurrentPageCandidates, savedApplicationAnswer, queueJobHostname } from '../packages/ui/src/companion.js';
import type { ConfirmedAnswer, ConfirmedAnswerInput } from '../packages/shared/src/application-assets.js';

function issue(reasonCode: ApplicationWorkflowIssue['reasonCode'] = 'missing-profile'): ApplicationWorkflowIssue {
  return { id: 'fictional-issue', section: 'internships', status: 'open', scope: 'field', required: true,
    reasonCode, reason: APPLICATION_ISSUE_REASONS[reasonCode], label: '实习职位', collection: 'internships', recordId: 'fictional-record', profileField: 'role',
    createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', lastCheckedProfileVersion: 1, readbackVerified: false };
}

test('companion only reports percentage when both real counts provide a consistent denominator', () => {
  assert.deepEqual(companionProgress({ verifiedCount: 4, totalCount: 10, pendingCount: 2 }), { verified: 4, total: 10, pending: 2, percent: 40, label: '已核实 4 / 10 项' });
  assert.equal(companionProgress({ verifiedCount: 1, totalCount: 3 }).percent, 33);
  assert.equal(companionProgress({ verifiedCount: 0, totalCount: 3 }).percent, 0);
  assert.equal(companionProgress({ verifiedCount: 3, totalCount: 3 }).percent, 100);
});

test('unknown, zero and inconsistent totals never become an invented complete progress bar', () => {
  for (const input of [{}, { verifiedCount: 3 }, { totalCount: 10 }, { verifiedCount: 0, totalCount: 0 }, { verifiedCount: 11, totalCount: 10 }]) {
    assert.equal(companionProgress(input).percent, undefined);
    assert.equal(companionProgress(input).total, undefined);
  }
  assert.equal(companionProgress({}).label, '核实数量尚未返回');
  assert.equal(companionProgress({ verifiedCount: 3 }).label, '已核实 3 项');
});

test('nonfinite, fractional and negative counts do not leak misleading progress', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(companionProgress({ verifiedCount: invalid, totalCount: 10 }).percent, undefined);
    assert.equal(companionProgress({ verifiedCount: 2, totalCount: invalid }).percent, undefined);
    assert.equal(companionProgress({ pendingCount: invalid }).pending, undefined);
  }
});

test('local companion preference parsing accepts only strict booleans and never imports actions', () => {
  assert.deepEqual(companionPreferences({ collapsed: true, muted: true, reducedMotion: true, action: 'submit', currentURL: 'private' }), { collapsed: true, muted: true, reducedMotion: true });
  for (const invalid of [null, [], 'true', 1, undefined]) assert.deepEqual(companionPreferences(invalid), { collapsed: false, muted: false, reducedMotion: false });
  assert.deepEqual(companionPreferences({ collapsed: 'true', muted: 1, reducedMotion: {} }), { collapsed: false, muted: false, reducedMotion: false });
});

test('completed companion language leaves final submission with the user', () => {
  assert.equal(COMPANION_STATUS_LABELS.completed, '本轮填写结束');
  assert.match(COMPANION_STATUS_HINTS.completed, /最终提交由你/u);
  for (const label of Object.values(COMPANION_STATUS_LABELS)) assert.doesNotMatch(label, /已投递|申请成功|已提交/u);
  assert.match(COMPANION_STATUS_HINTS['waiting-login'], /账号和验证码由你操作/u);
});

test('an existing fact is a re-observation problem rather than a missing personal-information prompt', () => {
  const original = issue(); const before = structuredClone(original);
  const guide = applicationIssueGuidance(original, true, true);
  assert.equal(guide.kind, 'retry'); assert.equal(guide.badge, '资料已有'); assert.equal(guide.action, 'resume');
  assert.doesNotMatch(guide.title, /还缺/u); assert.deepEqual(original, before);
});

test('editable missing facts offer explicit save and non-editable missing facts go to full profile', () => {
  assert.equal(applicationIssueGuidance(issue(), false, true).action, 'edit');
  assert.equal(applicationIssueGuidance(issue(), false, true).actionLabel, '补充并记住');
  assert.equal(applicationIssueGuidance(issue(), false, false).action, 'profile');
  assert.match(applicationIssueGuidance(issue(), false, true).hint, /保存并确认后/u);
});

test('unsupported controls including ongoing dates stay manual, even when a source fact exists', () => {
  const ongoing = { ...issue('unsupported-field'), label: '结束时间', profileField: 'endDate' };
  for (const hasFact of [false, true]) {
    const result = applicationIssueGuidance(ongoing, hasFact, false);
    assert.equal(result.kind, 'manual'); assert.equal(result.action, 'manual'); assert.match(result.hint, /暂未适配/u);
  }
});

test('interruption and verification failure never claim that a missing value was learned or a form finished', () => {
  for (const reason of ['verification-failed', 'not-yet-filled', 'interrupted'] as const) {
    const result = applicationIssueGuidance(issue(reason), false, false);
    assert.equal(result.kind, 'retry'); assert.equal(result.action, 'resume'); assert.match(result.hint, /不能当作已完成/u);
  }
  assert.equal(applicationIssueGuidance(issue('unbound-record'), false, false).action, 'profile');
});

test('only a specific ordinary unknown question can propose a user-authored reusable answer', () => {
  const ordinary: ApplicationWorkflowIssue = { ...issue('needs-review'), section: 'other', label: '请简要介绍你的项目经验', collection: undefined, recordId: undefined, profileField: undefined };
  assert.equal(applicationIssueCanRemember(ordinary), true);
  assert.equal(applicationIssueCanRemember({ ...ordinary, section: 'internships' }), false);
  assert.equal(applicationIssueCanRemember({ ...ordinary, profileField: 'email' }), false);
  assert.equal(applicationIssueCanRemember({ ...ordinary, reasonCode: 'unsupported-field' }), false);
  assert.equal(applicationIssueCanRemember({ ...ordinary, scope: 'section' }), false);
  assert.equal(applicationIssueCanRemember({ ...ordinary, label: '需要核对的填写项' }), false);
});

test('remember-answer editor refuses high-impact, identity, agreement and redacted question contexts', () => {
  for (const question of ['期望薪资', '是否同意隐私协议', '请输入身份证号码', '工作许可与签证情况', '请输入验证码', 'Background check consent', '期望工资', '[联系方式已隐藏]', 'a'.repeat(1001)]) {
    assert.equal(applicationQuestionCanRemember(question), false, question);
  }
  assert.equal(applicationQuestionCanRemember('请介绍一个你独立负责的项目'), true);
});

test('current-page queue choices are exact HTTPS origin candidates, never an automatic job choice', () => {
  const jobs = [{ id: 'one', url: 'https://careers.example.invalid/job/one' }, { id: 'two', url: 'https://careers.example.invalid/job/two' },
    { id: 'other', url: 'https://another.example.invalid/job' }, { id: 'spoof', url: 'https://careers.example.invalid.evil.invalid/job' },
    { id: 'creds', url: 'https://user:password@careers.example.invalid/job' }, { id: 'http', url: 'http://careers.example.invalid/job' }];
  const result = queueCurrentPageCandidates(jobs, 'https://careers.example.invalid/application/current');
  assert.deepEqual(result.map(item => item.id), ['one', 'two']); assert.equal(result[0], jobs[0]);
  assert.equal('currentPageForJobId' in result, false);
  assert.deepEqual(jobs.map(item => item.id), ['one', 'two', 'other', 'spoof', 'creds', 'http']);
});

test('current-page queue candidates reject absent URLs, browser internals, credentials and insecure addresses', () => {
  const jobs = [{ id: 'one', url: 'https://careers.example.invalid/job' }];
  for (const url of ['', 'invalid', 'about:blank', 'file:///tmp/apply', 'http://careers.example.invalid/apply', 'https://user@careers.example.invalid/apply']) assert.deepEqual(queueCurrentPageCandidates(jobs, url), []);
});

const answerRequest: ConfirmedAnswerInput = { questionPattern: '请介绍独立负责的项目', answer: '虚构原创回答', scope: { kind: 'application', applicationId: 'fictional-app' }, demo: false, risk: 'ordinary' };
function answer(id: string, extra: Partial<ConfirmedAnswer> = {}): ConfirmedAnswer {
  return { ...answerRequest, id, revision: 1, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', confirmedRevision: null, confirmedProfileVersion: null, confirmedAt: null, ...extra };
}

test('new answer save binds only the newly host-created ID even if an identical confirmed answer already exists', () => {
  const old = answer('old-confirmed', { revision: 2, confirmedRevision: 2, confirmedProfileVersion: 7, confirmedAt: '2026-10-19T00:01:00Z' });
  const created = answer('host-created');
  assert.equal(savedApplicationAnswer([old], [old, created], answerRequest), created);
  assert.equal(savedApplicationAnswer([old], [old], answerRequest), undefined);
  assert.equal(old.confirmedRevision, 2);
});

test('ambiguous newly created twins, changed scope or changed content never choose another answer to confirm', () => {
  const created = answer('new-one');
  assert.equal(savedApplicationAnswer([], [created, answer('new-two')], answerRequest), undefined);
  for (const different of [answer('changed-question', { questionPattern: '另一个问题' }), answer('changed-answer', { answer: '另一份回答' }),
    answer('changed-scope', { scope: { kind: 'general' } }), answer('changed-application', { scope: { kind: 'application', applicationId: 'another-app' } }),
    answer('changed-demo', { demo: true }), answer('changed-risk', { risk: 'high-impact' })]) {
    assert.equal(savedApplicationAnswer([], [different], answerRequest), undefined);
  }
});

test('new save never rebinds an already confirmed or revised record as the requested fresh draft', () => {
  for (const changed of [answer('old', { confirmedRevision: 1 }), answer('old', { confirmedProfileVersion: 7 }),
    answer('old', { confirmedAt: '2026-10-19T00:01:00Z' }), answer('old', { revision: 2 })]) assert.equal(savedApplicationAnswer([], [changed], answerRequest), undefined);
});

test('editing a saved answer remains bound to its exact existing host ID and next revision', () => {
  const old = answer('existing'), updated = answer('existing', { revision: 2 }), unrelated = answer('unrelated');
  const request = { ...answerRequest, id: old.id };
  assert.equal(savedApplicationAnswer([old], [updated, unrelated], request), updated);
  assert.equal(savedApplicationAnswer([], [updated], request), undefined);
  assert.equal(savedApplicationAnswer([old], [answer('existing', { revision: 3 })], request), undefined);
});

test('queue destination labels show actual HTTPS hostname without private application path or query', () => {
  assert.equal(queueJobHostname('https://careers.example.invalid/application/private-id?token=private#secret'), 'careers.example.invalid');
  assert.equal(queueJobHostname('https://CAREERS.EXAMPLE.INVALID:9443/job'), 'careers.example.invalid');
  for (const invalid of ['', 'not-a-url', 'http://careers.example.invalid/job', 'file:///tmp/private', 'https://user:password@careers.example.invalid/job']) assert.equal(queueJobHostname(invalid), undefined);
});
