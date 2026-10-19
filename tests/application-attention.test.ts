import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import { applicationAttention, careerPendingAttention } from '../packages/ui/src/application-attention.js';
import type { ApplicationWorkflowIssue } from '../packages/shared/src/application-workflow.js';
import type { CareerFillPending } from '../packages/shared/src/career-form.js';

const state = () => ({ profile: createCareerFormFixtureProfile() });
function issue(overrides: Partial<ApplicationWorkflowIssue> = {}): ApplicationWorkflowIssue {
  return { id: 'fictional-issue', section: 'internships', scope: 'field', required: true, status: 'open', reasonCode: 'verification-failed',
    reason: '固定诊断', label: '职务 / 角色', collection: 'internships', recordId: 'fictional-internship-search', profileField: 'role',
    createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', lastCheckedProfileVersion: 1, readbackVerified: false, ...overrides };
}
test('attention counts actual required/unknown fields separately from optional fields and section notices', () => {
  const result = applicationAttention(state(), [issue(), issue({ id: 'optional', profileField: 'endDate', required: false }),
    issue({ id: 'unknown-required', profileField: 'description', required: null }),
    issue({ id: 'section', scope: 'section', profileField: undefined, reasonCode: 'unbound-record' }),
    issue({ id: 'application', scope: 'application', section: 'other', collection: undefined, recordId: undefined, profileField: undefined, reasonCode: 'interrupted' })]);
  assert.equal(result.count, 2); assert.equal(result.required.length, 2); assert.equal(result.optional.length, 1); assert.equal(result.notices.length, 2);
  assert.equal(result.required[1]!.issue.required, null); assert(result.notices.every(item => !item.locatable));
});
test('attention explains exact record and field without record-array ordinals', () => {
  const result = applicationAttention(state(), [issue()]).required[0]!;
  assert.equal(result.displayTitle, '虚构星河智能实验室 · 实习职位');
  assert.equal(result.category, 'retry'); assert.match(result.hint, /资料已有/u); assert.equal(result.locatable, true);
  const project = applicationAttention(state(), [issue({ collection: 'projects', section: 'projects', recordId: state().profile.career!.projects[0]!.id })]).required[0]!;
  assert.equal(project.fieldLabel, '项目角色'); assert.match(project.displayTitle, new RegExp(state().profile.career!.projects[0]!.name, 'u'));
});
test('duplicate legacy and exact career identities count once and preserve the more specific read-only target', () => {
  const values = [issue(), issue({ id: 'specific', fieldId: 'internship[0].title', groupId: 'internship[0]', fieldSignature: 'a'.repeat(64) })];
  const before = structuredClone(values); const result = applicationAttention(state(), values);
  assert.equal(result.count, 1); assert.equal(result.required[0]!.issue.id, 'specific'); assert.deepEqual(values, before);
});
test('unlabelled ordinary inputs are honest and not offered an invented locator or remembered fact', () => {
  const result = applicationAttention(state(), [issue({ id: 'unknown-1', collection: undefined, recordId: undefined, section: 'other', profileField: undefined, label: 'unknown', fieldType: 'radio', reasonCode: 'needs-review' }),
    issue({ id: 'unknown-2', collection: undefined, recordId: undefined, section: 'other', profileField: undefined, label: 'unknown', fieldType: 'radio', reasonCode: 'needs-review' })]);
  assert.equal(result.count, 2); assert.equal(result.required[0]!.fieldLabel, '未识别标题的单选题');
  assert.equal(result.required[0]!.locatable, false); assert.match(result.required[0]!.locateHint, /不会按序号猜/u);
  assert.match(result.required[0]!.hint, /页面未提供清楚的题目/u);
});
test('only open issues are presented and distinct ordinary field identities remain separate', () => {
  const result = applicationAttention(state(), [issue({ id: 'resolved', status: 'resolved' }), issue({ id: 'dismissed', status: 'dismissed' }),
    issue({ id: 'mail-1', section: 'contact', collection: undefined, recordId: undefined, profileField: 'email', fieldId: 'field-1' }),
    issue({ id: 'mail-2', section: 'contact', collection: undefined, recordId: undefined, profileField: 'email', fieldId: 'field-2' })]);
  assert.equal(result.count, 2);
});
test('unobserved old gaps stay open but move to historical notices without a must-fill count', () => {
  const legacy = issue({ attentionState: 'not-reobserved' }), current = issue({ id: 'current', profileField: 'description', attentionState: 'current' });
  const result = applicationAttention(state(), [legacy, current]);
  assert.equal(result.count, 1); assert.equal(result.historical.length, 1); assert.equal(result.notices.length, 0);
  assert.equal(result.historical[0]!.issue.status, 'open'); assert.match(result.historical[0]!.hint, /不能认定网页已完成/u);
});
test('career live pending uses the same grouping and does not turn a binding warning into another missing fact', () => {
  const value = state(); value.profile.career!.internships[0]!.role = '';
  const pending: CareerFillPending[] = [
    { collection: 'internships', recordId: 'fictional-internship-search', groupId: 'internship[0]', fieldId: 'internship[0].title', key: 'role', required: true, scope: 'field', type: 'text', reasonCode: 'missing-profile', reason: '资料缺少' },
    { collection: 'internships', recordId: 'fictional-internship-search', required: null, scope: 'section', reasonCode: 'unbound-record', reason: '需核对对应关系' },
    { collection: 'projects', recordId: value.profile.career!.projects[0]!.id, fieldId: 'project[0].link', key: 'url', required: false, type: 'text', reasonCode: 'missing-profile', reason: '链接缺少' },
  ];
  const result = careerPendingAttention(value, pending);
  assert.equal(result.count, 1); assert.equal(result.optional.length, 1); assert.equal(result.notices.length, 1);
  assert.equal(result.required[0]!.category, 'missing'); assert.equal(result.required[0]!.displayTitle, '虚构星河智能实验室 · 实习职位');
  assert.equal(result.notices[0]!.locatable, false);
});
