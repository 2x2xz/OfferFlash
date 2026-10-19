import assert from 'node:assert/strict';
import test from 'node:test';
import type { EducationRecord, FieldObservation, FormObservation, Profile } from '../packages/shared/src/contracts.js';
import { fieldSignature, pageSignature, validateApprovedFields, buildFillPlan } from '../packages/forms/src/index.js';
import { buildModelFormInput, parseModelMappings, recognizeModelForm, validateModelFormInput } from '../packages/forms/src/model-recognition.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';

const profile: Profile = {
  version: 7, updatedAt: '2026-10-17T00:00:00Z', fullName: '虚构候选人', fullNameEn: 'Fictional Candidate',
  email: 'fictional@example.invalid', phone: '13800000000', school: '虚构高校', schoolEn: 'Fictional University',
  degree: '硕士', major: '人工智能', majorEn: 'Artificial Intelligence', graduationMonth: '2027-06',
  skills: [], cities: [], targetRoles: [], resumeText: 'PRIVATE_RESUME_MARKER',
};
function field(index: number, label: string, changes: Partial<FieldObservation> = {}): FieldObservation {
  const value = { id: `field-${index}`, index, label, type: 'text', value: '', required: false, editable: true,
    options: [], bounds: { x: 10, y: 10, width: 200, height: 30 }, signature: '', ...changes };
  value.signature = fieldSignature(value);
  return value;
}
function observe(fields: FieldObservation[]): FormObservation {
  return { id: 'fictional-observation', url: 'https://fictional.example.invalid/apply?token=PRIVATE_URL_MARKER', title: '虚构申请表',
    observedAt: '2026-10-17T00:00:00Z', signature: pageSignature(fields), fields };
}
const answer = (mappings: unknown) => async () => ({ text: JSON.stringify({ mappings }), modelId: 'fixture-model' });
test('real pilot failures cannot map company, LinkedIn or salary to education facts',()=>{
 for(const [label,key] of [['Current company ✱','school'],['LinkedIn URL ✱','major'],['Expected Fixed/Base Salary in your local currency ✱','degree'],['Citizenship','fullName'],['How did you hear about us?','school'],
 ['What is the name of your current manager?','fullName'],['Name Pronunciation | How do you pronounce your name?','fullNameEn'],['Preferred Name | What would you like us to call you?','fullName']]){
  const original=observe([field(0,label!)]),input=buildModelFormInput(original,profile);
  assert.throws(()=>parseModelMappings(JSON.stringify({mappings:[{fieldId:'field-0',profileKey:key}]}),input,original),/语义/);
 }
});

test('supported ARIA single-select semantics are mapped without sending values or DOM binding IDs to the model', async () => {
  const customSelect = { kind: 'aria-single-select', relationship: 'controls', popupId: 'PRIVATE_POPUP_MARKER', valueSource: 'input-value' } as const;
  const original = observe([field(0, '取得的学位', { type: 'combobox', customSelect }), field(1, '未知下拉', { type: 'combobox' })]);
  const input = buildModelFormInput(original, profile);
  validateModelFormInput(input);
  assert.deepEqual(input.fields.map(item => item.fieldId), ['field-0']);
  for (const secret of ['PRIVATE_POPUP_MARKER', profile.fullName, profile.email, profile.resumeText, profile.degree]) {
    assert.equal(JSON.stringify(input).includes(secret), false);
  }
  const plan = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-0', profileKey: 'degree' }]));
  assert.equal(plan.recognition?.mode, 'model'); assert.equal(plan.items[0]!.status, 'ready');
  assert.equal(plan.items[0]!.value, profile.degree);
  assert.equal(plan.items[1]!.status, 'review', 'an arbitrary custom widget is not opened just because it has a combobox role');
});

test('ARIA bindings and observed checked state remain part of stale-plan validation', async () => {
  const customSelect = { kind: 'aria-single-select', relationship: 'controls', popupId: 'degree-options', valueSource: 'input-value' } as const;
  const original = observe([field(0, '学历', { type: 'combobox', customSelect }), field(1, '同意条款', { type: 'checkbox', checked: false, value: 'on' })]);
  const plan = await recognizeModelForm(original, profile);
  assert.equal(plan.items[0]!.status, 'ready');
  const rebound = observe([field(0, '学历', { type: 'combobox', customSelect: { ...customSelect, popupId: 'different-options' } }), original.fields[1]!]);
  assert.throws(() => validateApprovedFields(plan, original, rebound, profile.version, ['field-0']), /字段已变化/);
  const checked = observe([original.fields[0]!, field(1, '同意条款', { type: 'checkbox', checked: true, value: 'on' })]);
  assert.throws(() => validateApprovedFields(plan, original, checked, profile.version, ['field-0']), /字段已变化/);
});

test('model semantics resolve unfamiliar labels using values only from the local saved profile', async () => {
  const original = observe([field(0, '您的称呼'), field(1, '接收通知的邮件地址'), field(2, '便于联系您的号码')]);
  const local = await recognizeModelForm(original, profile);
  assert.equal(local.recognition?.mode, 'rules');
  assert.ok(local.items.every(item => item.status === 'ready'), 'ordinary notification/contact phrases now have deterministic mappings');
  const plan = await recognizeModelForm(original, profile, answer([
    { fieldId: 'field-0', profileKey: 'fullName' }, { fieldId: 'field-1', profileKey: 'email' }, { fieldId: 'field-2', profileKey: 'phone' },
  ]));
  assert.equal(plan.recognition?.mode, 'model');
  assert.equal(plan.recognition?.mappedCount, 3);
  assert.deepEqual(plan.items.map(item => item.value), [profile.fullName, profile.email, profile.phone]);
  assert.equal(validateApprovedFields(plan, original, original, 7, ['field-0'])[0]?.item.value, profile.fullName);
});

test('model request contains field structure and option labels without private values, current values, selectors or URL', () => {
  const input = buildModelFormInput(observe([
    field(0, '您的称呼'), field(1, '邮件地址', { value: 'CURRENT_VALUE_MARKER' }),
    field(2, '最高学位', { type: 'select', options: [{ label: '硕士', value: 'PRIVATE_OPTION_VALUE' }] }),
    field(3, '紧急联系人姓名'), field(4, '验证码'),
  ]), profile);
  validateModelFormInput(input);
  assert.deepEqual(input.fields.map(item => item.fieldId), ['field-0', 'field-2']);
  const text = JSON.stringify(input);
  for (const value of [profile.fullName, profile.email, profile.phone, profile.resumeText, 'CURRENT_VALUE_MARKER', 'PRIVATE_OPTION_VALUE', 'PRIVATE_URL_MARKER', 'selector']) assert.equal(text.includes(value), false);
  assert.ok(text.includes('硕士'));
  assert.throws(() => validateModelFormInput({ ...input, resumeText: 'private' }), /无效/);
  assert.throws(() => validateModelFormInput({ fields: [input.fields[0], input.fields[0]] }), /无效/);
});

test('unknown field IDs, forbidden keys, duplicated IDs and generated values are rejected as a whole', () => {
  const original = observe([field(0, '您的称呼'), field(1, '就读高校')]);
  const input = buildModelFormInput(original, profile);
  for (const mappings of [
    [{ fieldId: 'unknown', profileKey: 'fullName' }],
    [{ fieldId: 'field-0', profileKey: 'resumeText' }],
    [{ fieldId: 'field-0', profileKey: '__proto__' }],
    [{ fieldId: 'field-0', profileKey: 'fullName' }, { fieldId: 'field-0', profileKey: 'email' }],
    [{ fieldId: 'field-0', profileKey: 'fullName', value: 'fabricated' }],
    [{ fieldId: 'field-0', profileKey: 'fullName', selector: 'input' }],
  ]) assert.throws(() => parseModelMappings(JSON.stringify({ mappings }), input, original), /模型/);
  assert.throws(() => parseModelMappings('{"mappings":[],"script":"doWork()"}', input, original), /格式/);
});

test('model cannot overwrite existing fields or fill sensitive, other-person, agreement or unsupported controls', async () => {
  const original = observe([
    field(0, '姓名', { value: '网站当前值' }), field(1, '验证码'), field(2, '姓名', { section: '紧急联系人' }),
    field(3, '同意隐私协议', { type: 'checkbox' }), field(4, '联系电话', { editable: false }),
    field(5, '您的称呼'),
  ]);
  const input = buildModelFormInput(original, profile);
  assert.deepEqual(input.fields.map(item => item.fieldId), ['field-5']);
  const attacked = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-0', profileKey: 'fullName' }]));
  assert.equal(attacked.recognition?.mode, 'fallback');
  assert.ok(attacked.items.slice(0, 5).every(item => item.status === 'skip' && item.value === ''));
  assert.equal(attacked.items[0]?.currentValue, '网站当前值');
});

test('explicit field meaning and typed controls cannot be redirected to a different profile value', async () => {
  for (const original of [observe([field(0, '邮箱')]), observe([field(0, '收信地址', { type: 'email' })])]) {
    const plan = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-0', profileKey: 'phone' }]));
    assert.equal(plan.recognition?.mode, 'fallback');
    assert.notEqual(plan.items[0]?.value, profile.phone);
  }
});

test('model cannot split a full name or reuse candidate details for another contact', async () => {
  const original = observe([field(0, 'Given name'), field(1, '联系人邮箱')]);
  const plan = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-0', profileKey: 'fullName' }]));
  assert.equal(plan.items[0]?.status, 'review');
  assert.equal(plan.items[0]?.value, '');
  assert.equal(plan.items[1]?.status, 'skip');
});

test('unlabeled phone-widget helpers are excluded from model input while the actual labeled phone remains fillable', async () => {
  const original = observe([
    field(0, '', { section: 'Phone', type: 'text' }),
    field(1, 'Country', { section: 'Phone', type: 'combobox' }),
    field(2, 'Phone', { section: 'Phone', type: 'tel' }),
    field(3, ' \t ', { section: 'Phone', type: 'text' }),
  ]);
  const input = buildModelFormInput(original, profile);
  assert.deepEqual(input.fields.map(item => item.fieldId), ['field-2']);
  validateModelFormInput(input);
  const plan = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-2', profileKey: 'phone' }]));
  assert.equal(plan.recognition?.mode, 'model');
  assert.equal(plan.recognition?.mappedCount, 1);
  assert.deepEqual(plan.items.map(item => item.status), ['review', 'review', 'ready', 'review']);
  assert.equal(plan.items[2]?.value, profile.phone);
  assert.equal(plan.items[0]?.value, '');
});

test('a model cannot force an unlabeled helper into a phone mapping even when its section says Phone', async () => {
  const original = observe([field(0, '', { section: 'Phone' }), field(1, 'Phone', { type: 'tel', section: 'Phone' })]);
  const input = buildModelFormInput(original, profile);
  const forced = [{ fieldId: 'field-0', profileKey: 'phone' }, { fieldId: 'field-1', profileKey: 'phone' }];
  assert.throws(() => parseModelMappings(JSON.stringify({ mappings: [forced[0]] }), input, original), /模型/);
  // Even a mismatched caller-supplied input cannot override the original observation's empty label.
  const forgedInput = { fields: [{ ...input.fields[0]!, fieldId: 'field-0' }] };
  assert.throws(() => parseModelMappings(JSON.stringify({ mappings: [forced[0]] }), forgedInput, original), /缺少明确字段标签/);
  for (const label of ['', ' \t\n ']) assert.throws(() => validateModelFormInput({ fields: [{ ...input.fields[0], label }] }), /无效/);
  const plan = await recognizeModelForm(original, profile, answer(forced));
  assert.equal(plan.recognition?.mode, 'fallback');
  assert.equal(plan.items[0]?.status, 'review');
  assert.equal(plan.items[0]?.value, '');
  assert.equal(plan.items[1]?.value, profile.phone);
});

test('model education mappings still require confirmed default education and never guess a date day', async () => {
  const pending: EducationRecord = { ...newCareerRecord('educations', 'fictional-education'), school: '待核对高校', degree: '硕士',
    endDate: '2027-06', revision: 1, confirmation: 'pending', confirmedRevision: null, confirmedAt: null };
  const structured: Profile = { ...profile, career: { ...emptyCareerInput(), sources: [], internships: [], projects: [], publications: [], educations: [pending], primaryEducationId: pending.id } };
  const original = observe([field(0, '就读高校'), field(1, '学业结束日', { type: 'date' })]);
  const plan = await recognizeModelForm(original, structured, answer([
    { fieldId: 'field-0', profileKey: 'school' }, { fieldId: 'field-1', profileKey: 'graduationMonth' },
  ]));
  assert.ok(plan.items.every(item => item.status === 'review' && item.value === ''));
  const date = await recognizeModelForm(observe([field(0, '学业结束日', { type: 'date' })]), profile,
    answer([{ fieldId: 'field-0', profileKey: 'graduationMonth' }]));
  assert.equal(date.items[0]?.status, 'review');
  assert.match(date.items[0]!.reason, /不能推测/);
});

test('exact month mappings become fillable while unknown days, existing values and sensitive controls stay blocked', async () => {
  const original = observe([
    field(0, '毕业年月', { type: 'month' }),
    field(1, '学业结束月份', { type: 'month' }),
    field(2, '学业结束日', { type: 'date' }),
    field(3, '学业结束月份'),
    field(4, '毕业年月', { type: 'month', value: '2026-05' }),
    field(5, '出生日期', { type: 'date' }),
    field(6, '毕业年月', { type: 'month', editable: false }),
  ]);
  const plan = await recognizeModelForm(original, profile, answer([0, 1, 2, 3].map(index => ({
    fieldId: `field-${index}`, profileKey: 'graduationMonth',
  }))));
  assert.equal(plan.recognition?.mode, 'model', 'the mapping itself is valid; native control support is decided locally');
  assert.deepEqual(plan.items.map(item => item.status), ['ready', 'ready', 'review', 'ready', 'skip', 'skip', 'skip']);
  assert.equal(plan.recognition?.mappedCount, 3, 'month values remain exact and day values stay unresolved');
  for (const index of [2]) {
    assert.equal(plan.items[index]?.value, '');
    assert.throws(() => validateApprovedFields(plan, original, original, profile.version, [`field-${index}`]), /无法自动填写/);
  }
  for(const index of [0,1])assert.equal(validateApprovedFields(plan,original,original,profile.version,[`field-${index}`])[0]?.item.value,profile.graduationMonth);
  assert.match(plan.items[2]!.reason, /资料只有毕业月份，不能推测具体日期/);
  assert.equal(plan.items[3]?.value, profile.graduationMonth);
  assert.equal(plan.items[4]?.currentValue, '2026-05', 'existing date values remain untouched');
  assert.match(plan.items[5]!.reason, /敏感资料/);
  assert.match(plan.items[6]!.reason, /不可编辑/);
});

test('model mapping preserves education group limits and real select option matching', async () => {
  const original = observe([field(0, '就读高校', { section: '本科教育' }), field(1, '获得的最高学位', { type: 'select', value: '-1',
    options: [{ label: '请选择', value: '-1' }, { label: '本科', value: 'b' }, { label: '硕士', value: 'real-master-id' }] })]);
  const primary: EducationRecord = { ...newCareerRecord('educations', 'fictional-master'), school: profile.school, degree: '硕士',
    endDate: '2027-06', revision: 1, confirmation: 'confirmed', confirmedRevision: 1, confirmedAt: '2026-10-17T00:00:00Z' };
  const structured: Profile = { ...profile, career: { ...emptyCareerInput(), sources: [], internships: [], projects: [], publications: [], educations: [primary], primaryEducationId: primary.id } };
  const plan = await recognizeModelForm(original, structured, answer([
    { fieldId: 'field-0', profileKey: 'school' }, { fieldId: 'field-1', profileKey: 'degree' },
  ]));
  assert.equal(plan.items[0]?.status, 'review');
  assert.equal(plan.items[1]?.value, 'real-master-id');
  assert.equal(plan.items[1]?.status, 'ready');
  assert.equal(plan.items[1]?.currentValue, '-1');
  assert.equal(plan.items[1]?.currentValueIsPlaceholder, true);
  assert.equal(validateApprovedFields(plan, original, original, profile.version, ['field-1'])[0]?.field.value, '-1');
});

test('a failed provider produces a recoverable rule plan without exposing provider secrets or claiming model success', async () => {
  const plan = await recognizeModelForm(observe([field(0, '邮箱')]), profile, async () => { throw new Error('provider https://SECRET_KEY'); });
  assert.equal(plan.recognition?.mode, 'fallback');
  assert.equal(plan.items[0]?.value, profile.email);
  assert.equal(JSON.stringify(plan).includes('SECRET_KEY'), false);
});

test('recognition exposes only bounded provider status and integer usage counts', async () => {
  const original = observe([field(0, '邮箱')]);
  const response = { text: JSON.stringify({ mappings: [{ fieldId: 'field-0', profileKey: 'email' }] }), modelId: 'fixture-model',
    httpStatus: 200, usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, privateResponse: 'SECRET_MARKER' } };
  const plan = await recognizeModelForm(original, profile, async () => response);
  assert.deepEqual(plan.recognition?.usage, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5 });
  assert.equal(plan.recognition?.httpStatus, 200);
  assert.equal(JSON.stringify(plan.recognition).includes('SECRET_MARKER'), false);
  const invalid = await recognizeModelForm(original, profile, async () => ({ ...response, httpStatus: 999,
    usage: { ...response.usage, input: -1 } }));
  assert.equal(invalid.recognition?.httpStatus, undefined);
  assert.equal(invalid.recognition?.usage, undefined);
});

test('known form provider errors give fixed useful diagnostics without forwarding raw messages', async () => {
  for (const [code, httpStatus, expected] of [['provider', 401, /凭据/], ['provider', 429, /额度不足/], ['timeout', undefined, /20 秒/]] as const) {
    const plan = await recognizeModelForm(observe([field(0, '邮箱')]), profile, async () => {
      throw Object.assign(new Error('SECRET_MARKER'), { name: 'FormModelRequestError', code, httpStatus });
    });
    assert.equal(plan.recognition?.mode, 'fallback');
    assert.equal(plan.recognition?.httpStatus, httpStatus);
    assert.match(plan.recognition!.message, expected);
    assert.equal(JSON.stringify(plan.recognition).includes('SECRET_MARKER'), false);
  }
  const unknown = await recognizeModelForm(observe([field(0, '邮箱')]), profile, async () => {
    throw Object.assign(new Error('SECRET_MARKER'), { name: 'OtherError', httpStatus: 401 });
  });
  assert.equal(unknown.recognition?.httpStatus, undefined);
  assert.doesNotMatch(unknown.recognition!.message, /凭据/);
});

test('model-produced plans retain stale profile, navigation and page-edit guards', async () => {
  const original = observe([field(0, '接收通知的邮件地址')]);
  const plan = await recognizeModelForm(original, profile, answer([{ fieldId: 'field-0', profileKey: 'email' }]));
  assert.throws(() => validateApprovedFields(plan, original, original, 8, ['field-0']), /资料已更新/);
  assert.throws(() => validateApprovedFields(plan, original, { ...original, url: `${original.url}#next` }, 7, ['field-0']), /地址已变化/);
  assert.throws(() => validateApprovedFields(plan, original, observe([field(0, '接收通知的邮件地址', { value: 'new@example.invalid' })]), 7, ['field-0']), /字段已由网页/);
});
test('conditional or alternative names cannot reuse ordinary full name, while unconditional legal name remains eligible',()=>{
 for(const label of ['Legal Name (if different than above)','Full name, if applicable','Other names used','Previous legal name','姓名（如与上述不同）','如有，填写其他姓名','曾用名']){
  const original=observe([field(0,label)]),input=buildModelFormInput(original,profile);
  assert.throws(()=>parseModelMappings(JSON.stringify({mappings:[{fieldId:'field-0',profileKey:'fullName'}]}),input,original),/语义/);
  assert.equal(buildFillPlan(original,profile,new Map([['field-0','fullName']])).items[0]!.status,'review');
 }
 for(const label of ['Full name','Legal name','Please state your full legal name']){
  const original=observe([field(0,label)]),input=buildModelFormInput(original,profile);
  assert.equal(parseModelMappings(JSON.stringify({mappings:[{fieldId:'field-0',profileKey:'fullName'}]}),input,original).get('field-0'),'fullName');
 }
});
