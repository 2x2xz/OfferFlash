import assert from 'node:assert/strict';
import test from 'node:test';
import type { FieldObservation, FormObservation, Profile } from '../packages/shared/src/contracts.js';
import {
  buildFillPlan, fieldSignature, hasExistingValue, isVerifiedValue, matchFields,
  matchSelectOption, pageSignature, validateApprovedFields,
} from '../packages/forms/src/index.js';
import { isAllowedNavigation } from '../packages/browser/src/navigation-policy.js';

const profile: Profile = {
  version: 7, updatedAt: '2026-10-11T00:00:00.000Z',
  fullName: '演示用户', fullNameEn: 'Example Candidate',
  email: 'candidate@example.invalid', phone: '13800000000',
  school: '虚构大学', schoolEn: 'Example University',
  degree: '硕士', major: '计算机科学', majorEn: 'Computer Science',
  graduationMonth: '2027-06', skills: [], cities: [], targetRoles: [], resumeText: '',
};

function field(index: number, label: string, changes: Partial<FieldObservation> = {}): FieldObservation {
  const data: FieldObservation = {
    id: `field-${index}`, index, label, type: 'text', value: '', required: false,
    editable: true, options: [], bounds: { x: 20, y: index * 50, width: 260, height: 32 },
    signature: '', ...changes,
  };
  data.signature = fieldSignature(data);
  return data;
}

function observation(fields: FieldObservation[], url = 'https://example.invalid/campus/apply'): FormObservation {
  return {
    id: 'observation-1', title: '虚构测试申请页', url,
    observedAt: '2026-10-11T00:00:00.000Z', fields, signature: pageSignature(fields),
  };
}

test('exact Chinese and English labels choose saved profile fields and language-specific names', () => {
  const rows = matchFields(observation([
    field(0, '姓名'), field(1, 'Full name'), field(2, 'Email address'),
    field(3, '手机号码'), field(4, 'University'), field(5, 'Major'), field(6, '毕业年月'),
  ]), profile);
  assert.deepEqual(rows.map(row => row.status), Array(7).fill('ready'));
  assert.deepEqual(rows.map(row => row.value), [
    profile.fullName, profile.fullNameEn, profile.email, profile.phone,
    profile.schoolEn, profile.majorEn, profile.graduationMonth,
  ]);
});

test('other-person sections, sensitive fields and declarations cannot receive candidate values', () => {
  const rows = matchFields(observation([
    field(0, '姓名', { section: '紧急联系人' }),
    field(1, 'Phone', { section: 'Reference contact' }),
    field(2, '身份证号码'), field(3, '验证码'), field(4, 'Password', { type: 'password' }),
    field(5, '同意隐私协议', { type: 'checkbox' }),
    field(6, '简历上传', { type: 'file' }),
  ]), profile);
  assert.ok(rows.every(row => row.status === 'skip' && row.value === ''));
});

test('pre-existing values and read-only controls are preserved', () => {
  const rows = matchFields(observation([
    field(0, '姓名', { value: '网站当前姓名' }),
    field(1, '邮箱', { editable: false }),
  ]), profile);
  assert.equal(rows[0]?.currentValue, '网站当前姓名');
  assert.ok(rows.every(row => row.status === 'skip'));
});

test('an unknown or combined label is reviewed rather than matched by keyword substring', () => {
  const rows = matchFields(observation([
    field(0, '邮箱或手机'), field(1, '期望薪资'), field(2, '姓名拼音备注'),
  ]), profile);
  assert.ok(rows.every(row => row.status === 'review' && row.value === ''));
});

test('an unlabeled widget helper cannot receive a phone value from its surrounding section or a forced mapping', () => {
  // Public Greenhouse shape: the phone widget has an unlabeled plain-text
  // helper, an unsupported country combobox and the actual labeled tel input.
  const original = observation([
    field(0, '', { section: 'Phone', type: 'text' }),
    field(1, 'Country', { section: 'Phone', type: 'combobox' }),
    field(2, 'Phone', { section: 'Phone', type: 'tel' }),
    field(3, ' \t\n ', { section: 'Phone', type: 'text' }),
  ]);
  const rows = matchFields(original, profile, new Map([
    ['field-0', 'phone'], ['field-1', 'phone'], ['field-2', 'phone'], ['field-3', 'phone'],
  ]));
  assert.deepEqual(rows.map(row => row.status), ['review', 'review', 'ready', 'review']);
  for (const index of [0, 3]) {
    assert.equal(rows[index]?.value, '');
    assert.equal(rows[index]?.profileKey, undefined);
    assert.match(rows[index]!.reason, /缺少明确标签.*不能仅根据所属段落/);
  }
  assert.equal(rows[2]?.value, profile.phone);
  const plan = buildFillPlan(original, profile, new Map([['field-0', 'phone']]));
  assert.throws(() => validateApprovedFields(plan, original, original, profile.version, ['field-0']), /无法自动填写/);
});

test('a degree select uses a unique real equivalent option without inventing its value', () => {
  const options = [
    { label: '请选择学历', value: '-1' },
    { label: 'Bachelor', value: 'b1' }, { label: "Master's degree", value: 'm2' },
  ];
  const select = field(0, 'Degree', { type: 'select', value: '-1', options });
  assert.equal(hasExistingValue(select), false);
  const item = matchFields(observation([select]), profile)[0];
  assert.equal(item?.status, 'ready');
  assert.equal(item?.value, 'm2');
  assert.deepEqual(matchSelectOption('硕士', options, 'degree'), options[2]);
});

test('missing and ambiguous real options require review', () => {
  const missing = field(0, '学历', { type: 'select', options: [{ label: '本科', value: 'b' }] });
  const ambiguous = field(1, '学历', {
    type: 'select', options: [{ label: '硕士', value: 'm1' }, { label: 'Master', value: 'm2' }],
  });
  assert.ok(matchFields(observation([missing, ambiguous]), profile).every(row => row.status === 'review'));
});

test('a real existing select choice is preserved and a month never becomes a guessed day', () => {
  const items = matchFields(observation([
    field(0, '学历', { type: 'select', value: 'b', options: [{ label: '本科', value: 'b' }, { label: '硕士', value: 'm' }] }),
    field(1, '毕业时间', { type: 'date' }),
  ]), profile);
  assert.equal(items[0]?.status, 'skip');
  assert.equal(items[1]?.status, 'review');
  assert.equal(items[1]?.value, '');
});

test('missing confirmed profile values remain unresolved', () => {
  const incomplete = { ...profile, phone: '' };
  const items = matchFields(observation([field(0, '联系电话')]), incomplete);
  assert.equal(items[0]?.status, 'review');
  assert.equal(items[0]?.value, '');
});

test('approval requires the same profile version, URL, field structure and original value', () => {
  const original = observation([field(0, '邮箱')]);
  const plan = buildFillPlan(original, profile);
  assert.equal(validateApprovedFields(plan, original, original, 7, ['field-0'])[0]?.item.value, profile.email);
  assert.throws(() => validateApprovedFields(plan, original, original, 8, ['field-0']), /资料已更新/);
  assert.throws(() => validateApprovedFields(plan, original, { ...original, url: `${original.url}#new-step` }, 7, ['field-0']), /地址已变化/);
  const changedStructure = observation([field(0, '邮箱', { type: 'password' })]);
  assert.throws(() => validateApprovedFields(plan, original, changedStructure, 7, ['field-0']), /字段已变化/);
  const changedValue = observation([field(0, '邮箱', { value: 'already@example.invalid' })]);
  assert.throws(() => validateApprovedFields(plan, original, changedValue, 7, ['field-0']), /字段已由网页/);
});

test('approval cannot include skipped, unknown, duplicate or empty field selections', () => {
  const original = observation([field(0, '邮箱'), field(1, '身份证号码')]);
  const plan = buildFillPlan(original, profile);
  assert.throws(() => validateApprovedFields(plan, original, original, 7, []), /请选择/);
  assert.throws(() => validateApprovedFields(plan, original, original, 7, ['field-0', 'field-0']), /不重复/);
  assert.throws(() => validateApprovedFields(plan, original, original, 7, ['field-1']), /无法自动填写/);
  assert.throws(() => validateApprovedFields(plan, original, original, 7, ['not-observed']), /无法自动填写/);
});

test('verification compares actual text and exact select values, not a model success statement', () => {
  assert.equal(isVerifiedValue(' candidate@example.invalid ', profile.email, 'email'), true);
  assert.equal(isVerifiedValue('different@example.invalid', profile.email, 'email'), false);
  assert.equal(isVerifiedValue('m2', 'm2', 'select'), true);
  assert.equal(isVerifiedValue('Master', 'm2', 'select'), false);
});

test('remote browser navigation permits web pages but refuses executable/local protocols', () => {
  assert.equal(isAllowedNavigation('https://careers.example.invalid/campus'), true);
  assert.equal(isAllowedNavigation('http://127.0.0.1:3456/test'), true);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'about:blank', 'https://user:password@example.invalid']) {
    assert.equal(isAllowedNavigation(url), false);
  }
});

test('the trusted fixture exception permits only the exact application-owned file URL', () => {
  const fixture = 'file:///tmp/offeragent-fixture/application.html';
  assert.equal(isAllowedNavigation(fixture, fixture), true);
  assert.equal(isAllowedNavigation('file:///tmp/offeragent-fixture/other.html', fixture), false);
  assert.equal(isAllowedNavigation(`${fixture}?redirect=file:///etc/passwd`, fixture), false);
  assert.equal(isAllowedNavigation('file:///etc/passwd', fixture), false);
});
