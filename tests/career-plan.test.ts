import assert from 'node:assert/strict';
import test from 'node:test';
import type { Profile } from '../packages/shared/src/contracts.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import {
  buildCareerPlan, careerDatePrecision, careerGroupSignature, resumeCareerPlanAfterAdd, validateCareerAddStep, validateCareerGroupFill,
  type CareerAddGroupStep, type CareerFieldKey, type CareerFieldObservation, type CareerFillGroupStep, type CareerFormCollection,
  type CareerFormObservation, type CareerGroupBinding, type CareerPageGroup,
} from '../packages/forms/src/career-plan.js';

const state = { confirmation: 'confirmed' as const, revision: 2, confirmedRevision: 2, confirmedAt: '2026-10-18T00:00:00Z' };
function profile(): Profile {
  return { version: 5, updatedAt: '2026-10-18T00:00:00Z', fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '',
    degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '', career: {
      ...emptyCareerInput(), sources: [],
      educations: [
        { ...newCareerRecord('educations', 'e-bachelor'), ...state, school: '虚构北城大学', degree: '本科', major: '计算机', startDate: '2020', endDate: '2024-06' },
        { ...newCareerRecord('educations', 'e-master'), ...state, school: '虚构南城大学', degree: '硕士', major: '人工智能', startDate: '2025-09', endDate: '2027-06' },
      ],
      internships: [{ ...newCareerRecord('internships', 'i-one'), ...state, organization: '虚构星河公司', role: '算法实习生', startDate: '2025-06', endDate: '2025-09', description: '实现虚构检索评估。' }],
      projects: [{ ...newCareerRecord('projects', 'p-one'), ...state, name: '虚构检索项目', role: '开发', startDate: '2025-10', endDate: '', ongoing: true, description: '开发虚构文档检索。', url: 'https://example.invalid/project' }],
      publications: [], primaryEducationId: 'e-master',
    } };
}
function field(id: string, key: CareerFieldKey, patch: Partial<CareerFieldObservation> = {}): CareerFieldObservation {
  return { id, key, signature: `signature-${id}`, type: 'text', value: '', editable: true, ...patch };
}
function group(id: string, collection: CareerFormCollection, fields: CareerFieldObservation[]): CareerPageGroup {
  return { id, collection, fields, signature: careerGroupSignature({ id, collection, fields }) };
}
function observation(groups: CareerPageGroup[] = []): CareerFormObservation {
  return { id: 'obs-one', url: 'https://example.invalid/fictional-application', generation: 3, signature: 'page-structure-one', groups,
    addControls: ['educations', 'internships', 'projects'].map(collection => ({ id: `add-${collection}`, collection: collection as CareerFormCollection, signature: `sig-add-${collection}`, enabled: true })) };
}
function bound(p: Profile, g: CareerPageGroup, recordId: string): CareerGroupBinding {
  return { collection: g.collection, groupId: g.id, groupSignature: g.signature, profileVersion: p.version, recordId, revision: 2 };
}
function fillStep(plan: ReturnType<typeof buildCareerPlan>, collection: CareerFormCollection): CareerFillGroupStep {
  const step = plan.steps.find(candidate => candidate.kind === 'fill-group' && candidate.binding.collection === collection);
  assert.ok(step?.kind === 'fill-group'); return step;
}
function addStep(plan: ReturnType<typeof buildCareerPlan>, collection: CareerFormCollection): CareerAddGroupStep {
  const step = plan.steps.find(candidate => candidate.kind === 'add-then-reobserve' && candidate.collection === collection);
  assert.ok(step?.kind === 'add-then-reobserve'); return step;
}
const ordered = { selectedRecordIds: { educations: ['e-bachelor', 'e-master'] } };

test('ordered education binds a specific confirmed record instead of copying the default master into every group', () => {
  const p = profile(); const g = group('education-1', 'educations', [field('school-1', 'school'), field('degree-1', 'degree'), field('major-1', 'major')]);
  const original = observation([g]); const plan = buildCareerPlan(p, original, ordered); const step = fillStep(plan, 'educations');
  assert.equal(step.binding.recordId, 'e-bachelor'); assert.equal(step.binding.revision, 2); assert.equal(step.binding.profileVersion, 5);
  assert.deepEqual(step.items.map(item => item.value), ['虚构北城大学', '本科', '计算机']);
  assert.equal(validateCareerGroupFill(plan, step, original, p).length, 3);
  assert.equal(plan.steps.some(candidate => candidate.kind === 'add-then-reobserve' && candidate.collection === 'educations'), false);
});

test('multiple candidates without an approved order do not guess which record belongs to an existing empty group', () => {
  const plan = buildCareerPlan(profile(), observation([group('education-1', 'educations', [field('school', 'school')])]));
  assert.equal(plan.steps.some(step => step.kind === 'fill-group' && step.binding.collection === 'educations'), false);
  assert.match(plan.issues.find(item => item.collection === 'educations')!.reason, /顺序/);
});

test('a single confirmed internship can bind the sole empty internship group', () => {
  const step = fillStep(buildCareerPlan(profile(), observation([group('intern-1', 'internships', [field('org', 'organization'), field('role', 'role')])])), 'internships');
  assert.equal(step.binding.recordId, 'i-one'); assert.deepEqual(step.items.map(item => item.value), ['虚构星河公司', '算法实习生']);
});

test('unknown nonempty groups are preserved and block automatic assignment or addition in that collection', () => {
  const original = observation([group('education-existing', 'educations', [field('school', 'school', { value: '网页已有大学' })])]);
  const before = structuredClone(original); const plan = buildCareerPlan(profile(), original, ordered);
  assert.ok(plan.issues.some(item => item.collection === 'educations' && /已有经历/.test(item.reason)));
  assert.ok(!plan.steps.some(step => step.kind === 'fill-group' ? step.binding.collection === 'educations' : step.collection === 'educations'));
  assert.deepEqual(original, before);
});

test('multiple unbound empty groups are not guessed from their order', () => {
  const plan = buildCareerPlan(profile(), observation(['a', 'b'].map(id => group(id, 'educations', [field(`school-${id}`, 'school')]))), ordered);
  assert.ok(plan.issues.some(item => /多个未绑定空组/.test(item.reason)));
  assert.equal(plan.bindings.filter(binding => binding.collection === 'educations').length, 0);
});

test('a trusted explicit binding preserves existing values and fills only empty fields from the same record', () => {
  const p = profile(); const g = group('education-1', 'educations', [field('school', 'school', { value: '网页用户已修改学校' }), field('major', 'major')]);
  const step = fillStep(buildCareerPlan(p, observation([g]), { ...ordered, bindings: [bound(p, g, 'e-master')] }), 'educations');
  assert.equal(step.items[0]!.status, 'skip'); assert.equal(step.items[0]!.currentValue, '网页用户已修改学校'); assert.equal(step.items[0]!.value, '');
  assert.equal(step.items[1]!.value, '人工智能');
});

test('missing values and ongoing project dates are not invented from a current flag or today', () => {
  const step = fillStep(buildCareerPlan(profile(), observation([group('project', 'projects', [field('name', 'name'), field('end', 'endDate', { datePrecision: 'source' })])])), 'projects');
  assert.equal(step.items[1]!.status, 'review'); assert.equal(step.items[1]!.value, '');
});

test('confirmed ongoing ends become 至今 only on an explicitly supported Feishu end-month control', () => {
  for (const collection of ['internships', 'projects'] as const) {
    const p = profile(); const record = p.career![collection][0]!;
    if ('current' in record) record.current = true; else record.ongoing = true;
    record.endDate = '';
    const g = group(`${collection}-date`, collection, [field('end', 'endDate', { type: 'feishu-month', datePrecision: 'month', supportsUntilNow: true })]);
    const plan = buildCareerPlan(p, observation([g]), { selectedRecordIds: { [collection]: [record.id] } });
    const item = fillStep(plan, collection).items[0]!;
    assert.equal(item.status, 'ready'); assert.equal(item.value, '至今'); assert.match(item.reason, /仍在进行.*独立重读/);
    assert.equal(validateCareerGroupFill(plan, fillStep(plan, collection), plan.original, p)[0]!.value, '至今');
  }
});

test('an ongoing end without a proven month-control capability is manual, never a missing personal fact', () => {
  for (const patch of [{ type: 'feishu-month' }, { type: 'feishu-month', supportsUntilNow: false }, { type: 'text', supportsUntilNow: true }, { type: 'month', supportsUntilNow: true }]) {
    const p = profile(); const record = p.career!.internships[0]!; record.current = true; record.endDate = '';
    const g = group('ongoing-intern', 'internships', [field('end', 'endDate', { datePrecision: 'month', ...patch })]);
    const plan = buildCareerPlan(p, observation([g])); const item = fillStep(plan, 'internships').items[0]!;
    assert.equal(item.status, 'review'); assert.equal(item.value, ''); assert.match(item.reason, /已确认至今.*尚未核实/);
    assert.doesNotMatch(item.reason, /没有此项资料/); assert.deepEqual(validateCareerGroupFill(plan, fillStep(plan, 'internships'), plan.original, p), []);
  }
});

test('until-now capability cannot invent an unknown end, change a start date or conceal contradictory source facts', () => {
  const p = profile(); const record = p.career!.internships[0]!; record.current = false; record.endDate = '';
  const month = { type: 'feishu-month', datePrecision: 'month' as const, supportsUntilNow: true };
  const g = group('intern-dates', 'internships', [field('start', 'startDate', month), field('end', 'endDate', month)]);
  let step = fillStep(buildCareerPlan(p, observation([g])), 'internships');
  assert.equal(step.items[0]!.value, '2025-06'); assert.equal(step.items[0]!.status, 'ready');
  assert.equal(step.items[1]!.status, 'review'); assert.match(step.items[1]!.reason, /没有此项资料/);
  record.current = true; record.endDate = '2025-09';
  step = fillStep(buildCareerPlan(p, observation([g])), 'internships');
  assert.equal(step.items[1]!.status, 'review'); assert.equal(step.items[1]!.value, ''); assert.match(step.items[1]!.reason, /同时声明/);
  record.startDate = '2025'; record.endDate = '';
  step = fillStep(buildCareerPlan(p, observation([g])), 'internships');
  assert.equal(step.items[0]!.status, 'review'); assert.equal(step.items[0]!.value, '', 'the supported end action never upgrades year-only start precision');
});

test('a selected until-now value stays preserved and a changed capability invalidates the old plan', () => {
  const p = profile(); const record = p.career!.internships[0]!; record.current = true; record.endDate = '';
  const g = group('intern-until-now', 'internships', [field('end', 'endDate', { type: 'feishu-month', datePrecision: 'month', supportsUntilNow: true })]);
  const plan = buildCareerPlan(p, observation([g])); const step = fillStep(plan, 'internships');
  const changed = structuredClone(plan.original); changed.groups[0]!.fields[0]!.supportsUntilNow = false;
  changed.groups[0]!.signature = careerGroupSignature(changed.groups[0]!);
  assert.throws(() => validateCareerGroupFill(plan, step, changed, p), /已变化/);
  const selected = group('selected-until-now', 'internships', [field('end', 'endDate', { type: 'feishu-month', datePrecision: 'month', value: '至今', supportsUntilNow: true })]);
  const kept = fillStep(buildCareerPlan(p, observation([selected]), { bindings: [bound(p, selected, record.id)] }), 'internships').items[0]!;
  assert.equal(kept.status, 'skip'); assert.equal(kept.currentValue, '至今'); assert.equal(kept.value, '');
});

test('text dates preserve source precision and a year cannot become a month or day', () => {
  const p = profile(); const g = group('education', 'educations', [field('start', 'startDate', { datePrecision: 'source' }), field('end', 'endDate', { datePrecision: 'day' })]);
  const step = fillStep(buildCareerPlan(p, observation([g]), ordered), 'educations');
  assert.equal(step.items[0]!.value, '2020'); assert.equal(step.items[0]!.status, 'ready');
  assert.equal(step.items[1]!.status, 'review'); assert.equal(step.items[1]!.value, '');
});

test('unreviewed date controls and native segmented dates stay manual', () => {
  for (const patch of [{}, { type: 'month', datePrecision: 'month' as const }, { type: 'date', datePrecision: 'day' as const }]) {
    const plan = buildCareerPlan(profile(), observation([group('internship', 'internships', [field('start', 'startDate', patch)])]));
    assert.equal(fillStep(plan, 'internships').items[0]!.status, 'review');
  }
});

test('a reviewed Feishu month adapter can use confirmed YYYY-MM but never invents a month from a year', () => {
  const p = profile();
  const g = group('education', 'educations', [field('start', 'startDate', { type: 'feishu-month', datePrecision: 'month' }), field('end', 'endDate', { type: 'feishu-month', datePrecision: 'month' })]);
  const step = fillStep(buildCareerPlan(p, observation([g]), ordered), 'educations');
  assert.equal(step.items[0]!.status, 'review'); assert.equal(step.items[0]!.value, '');
  assert.equal(step.items[1]!.status, 'ready'); assert.equal(step.items[1]!.value, '2024-06');
  const unreviewed = group('education', 'educations', [field('end', 'endDate', { type: 'feishu-month', datePrecision: 'source' })]);
  assert.equal(fillStep(buildCareerPlan(p, observation([unreviewed]), ordered), 'educations').items[0]!.status, 'review');
  const nonDate = group('education', 'educations', [field('school', 'school', { type: 'feishu-month', datePrecision: 'month' })]);
  assert.equal(fillStep(buildCareerPlan(p, observation([nonDate]), ordered), 'educations').items[0]!.status, 'review');
});

test('interrupted nonempty Feishu month endpoints stay review without overwriting or treating partial display as completion', () => {
  for (const key of ['startDate', 'endDate'] as const) for (const value of ['2025-MM', 'YYYY-09', 'YYYY-MM', '2025', '2025-13', '0000-01', '2025-09-01', ' 2025-MM ']) {
    const p = profile(); const g = group('education', 'educations', [field('month', key, { type: 'feishu-month', datePrecision: 'month', value })]);
    const original = observation([g]); const before = structuredClone(original);
    const plan = buildCareerPlan(p, original, { selectedRecordIds: { educations: ['e-master'] }, bindings: [bound(p, g, 'e-master')] });
    const step = fillStep(plan, 'educations');
    assert.equal(step.items[0]!.status, 'review'); assert.equal(step.items[0]!.currentValue, value); assert.equal(step.items[0]!.value, '');
    assert.match(step.items[0]!.reason, /年月未完整.*保留当前内容/);
    assert.deepEqual(validateCareerGroupFill(plan, step, original, p), []); assert.deepEqual(original, before);
  }
});

test('complete existing Feishu months and explicit 至今 stay preserved, without silently completing any other date type', () => {
  for (const value of ['2025-09', '2027-06', '至今', ' 2025-09 ']) {
    const p = profile(); const g = group('education', 'educations', [field('month', 'endDate', { type: 'feishu-month', datePrecision: 'month', value })]);
    const step = fillStep(buildCareerPlan(p, observation([g]), { selectedRecordIds: { educations: ['e-master'] }, bindings: [bound(p, g, 'e-master')] }), 'educations');
    assert.equal(step.items[0]!.status, 'skip'); assert.equal(step.items[0]!.currentValue, value); assert.equal(step.items[0]!.value, '');
  }
  const p = profile(); const g = group('education', 'educations', [field('text', 'startDate', { type: 'text', value: '2025-MM' })]);
  assert.equal(fillStep(buildCareerPlan(p, observation([g]), { selectedRecordIds: { educations: ['e-master'] }, bindings: [bound(p, g, 'e-master')] }), 'educations').items[0]!.status, 'skip', 'the recovery exception is limited to the reviewed Feishu month control');
});

test('date precision rejects invalid dates without inventing corrections', () => {
  for (const [value, expected] of [['2024', 'year'], ['2024-02', 'month'], ['2024-02-29', 'day']] as const) assert.equal(careerDatePrecision(value), expected);
  for (const value of ['2023-02-29', '2024-04-31', '2024-13', '2024-00', '2024-01-00', '2024-01-01-extra', '0000', '至今', '2024-2', '2024-01-01T00:00Z']) assert.equal(careerDatePrecision(value), undefined);
});

test('only the current confirmed revision is eligible, including selected ids and stale bindings', () => {
  for (const patch of [{ confirmation: 'pending' as const }, { confirmedRevision: 1 }, { confirmedAt: null }, { revision: 0, confirmedRevision: 0 }]) {
    const p = profile(); Object.assign(p.career!.educations[0]!, patch);
    const plan = buildCareerPlan(p, observation(), { selectedRecordIds: { educations: ['e-bachelor'] } });
    assert.ok(plan.issues.some(item => /尚未确认/.test(item.reason))); assert.ok(!plan.steps.some(step => step.kind === 'add-then-reobserve' && step.collection === 'educations'));
  }
});

test('duplicate record ids, selected ids or record/group bindings are rejected per collection', () => {
  const p = profile(); p.career!.educations.push(structuredClone(p.career!.educations[0]!));
  assert.match(buildCareerPlan(p, observation(), ordered).issues[0]!.reason, /重复/);
  const other = profile(); const g = group('e', 'educations', [field('school', 'school')]); const binding = bound(other, g, 'e-bachelor');
  for (const options of [{ selectedRecordIds: { educations: ['e-bachelor', 'e-bachelor'] } }, { ...ordered, bindings: [binding, binding] }]) {
    assert.match(buildCareerPlan(other, observation([g]), options).issues[0]!.reason, /重复/);
  }
});

test('field and group identity collisions or repeated semantic keys are invalid observations', () => {
  const a = group('a', 'educations', [field('a-school', 'school')]);
  assert.throws(() => buildCareerPlan(profile(), observation([a, a])), /身份重复/);
  assert.throws(() => buildCareerPlan(profile(), observation([a, group('b', 'projects', [field('a-school', 'name')])])), /字段身份重复/);
  assert.throws(() => buildCareerPlan(profile(), observation([group('a', 'educations', [field('a-school', 'school'), field('another-school', 'school')])])), /重复字段用途/);
});

test('incorrect record revision/profile version or group signature invalidates supplied binding', () => {
  const p = profile(); const g = group('education', 'educations', [field('school', 'school')]);
  for (const patch of [{ revision: 1 }, { profileVersion: 4 }, { groupSignature: 'different' }, { groupId: 'other' }]) {
    const plan = buildCareerPlan(p, observation([g]), { ...ordered, bindings: [{ ...bound(p, g, 'e-bachelor'), ...patch }] });
    assert.ok(plan.issues.some(item => /已变化/.test(item.reason)));
  }
});

test('an add step targets one record and one exact enabled control', () => {
  const p = profile(); const original = observation(); const plan = buildCareerPlan(p, original, ordered); const step = addStep(plan, 'educations');
  assert.equal(step.recordId, 'e-bachelor'); assert.equal(step.revision, 2); assert.equal(step.controlId, 'add-educations');
  assert.equal(plan.steps.filter(candidate => candidate.kind === 'add-then-reobserve' && candidate.collection === 'educations').length, 1);
  assert.equal(validateCareerAddStep(plan, step, original, p).id, 'add-educations');
});

test('ambiguous or disabled add controls stay manual', () => {
  for (const variant of ['duplicate', 'disabled', 'missing']) {
    const obs = observation();
    if (variant === 'duplicate') obs.addControls.push({ ...obs.addControls[0]!, id: 'add-education-two' });
    else if (variant === 'disabled') obs.addControls[0]!.enabled = false;
    else obs.addControls = obs.addControls.filter(control => control.collection !== 'educations');
    const plan = buildCareerPlan(profile(), obs, ordered);
    assert.ok(!plan.steps.some(step => step.kind === 'add-then-reobserve' && step.collection === 'educations'));
    assert.ok(plan.issues.some(issue => /新增按钮/.test(issue.reason)));
  }
});

test('add then reobserve binds exactly the new empty group and generates a new fill plan', () => {
  const p = profile(); const initial = observation(); const plan = buildCareerPlan(p, initial, ordered); const step = addStep(plan, 'educations');
  const current = { ...initial, id: 'obs-after-add', signature: 'page-with-education', groups: [group('new-education', 'educations', [field('new-school', 'school')])] };
  const resumed = resumeCareerPlanAfterAdd(plan, step, current, p); const fill = fillStep(resumed, 'educations');
  assert.notEqual(resumed.id, plan.id); assert.equal(resumed.observationId, 'obs-after-add');
  assert.equal(fill.binding.groupId, 'new-education'); assert.equal(fill.binding.recordId, 'e-bachelor'); assert.equal(fill.items[0]!.value, '虚构北城大学');
});

test('after a verified first group, next replan adds the next record instead of filling another copy', () => {
  const p = profile(); const g = group('education-1', 'educations', [field('school', 'school', { value: '虚构北城大学' })]);
  const plan = buildCareerPlan(p, observation([g]), { ...ordered, bindings: [bound(p, g, 'e-bachelor')] });
  const step = addStep(plan, 'educations'); assert.equal(step.recordId, 'e-master');
  assert.equal(fillStep(plan, 'educations').items[0]!.status, 'skip');
});

test('add failure to create a group never yields a fill or a blind retry', () => {
  const p = profile(); const initial = observation(); const plan = buildCareerPlan(p, initial, ordered);
  assert.throws(() => resumeCareerPlanAfterAdd(plan, addStep(plan, 'educations'), initial, p), /恰好一组.*不自动重试/);
});

test('add result rejects two groups, wrong collection, nonempty new group or removal/replacement of an old group', () => {
  const p = profile(); const existing = group('old-internship', 'internships', [field('old-org', 'organization', { value: '已有机构' })]);
  const initial = observation([existing]); const plan = buildCareerPlan(p, initial, ordered); const step = addStep(plan, 'educations');
  const fresh = group('new-education', 'educations', [field('new-school', 'school')]);
  const variants = [[existing, fresh, group('extra', 'educations', [field('extra-school', 'school')])],
    [existing, group('wrong', 'projects', [field('new-name', 'name')])],
    [existing, group('nonempty', 'educations', [field('new-school', 'school', { value: '网站预填机构' })])],
    [fresh], [group('replaced', 'internships', [field('old-org', 'organization', { value: '已有机构' })]), fresh]];
  for (const groups of variants) assert.throws(() => resumeCareerPlanAfterAdd(plan, step, { ...initial, groups }, p), /停止/);
});

test('add result rejects changes to previous fields or other collection controls', () => {
  const p = profile(); const existing = group('old-internship', 'internships', [field('old-org', 'organization', { value: '已有机构' })]);
  const initial = observation([existing]); const plan = buildCareerPlan(p, initial, ordered); const step = addStep(plan, 'educations');
  const current = { ...initial, groups: [existing, group('new-education', 'educations', [field('new-school', 'school')])] };
  const changed = structuredClone(current); changed.groups[0]!.fields[0]!.value = '网站悄悄改写';
  assert.throws(() => resumeCareerPlanAfterAdd(plan, step, changed, p), /原有内容不变/);
  const buttons = structuredClone(current); buttons.addControls[1]!.enabled = false;
  assert.throws(() => resumeCareerPlanAfterAdd(plan, step, buttons, p), /其他经历区的按钮/);
});

test('profile changes, navigation or generation changes invalidate both fill and add', () => {
  const p = profile(); const initial = observation([group('internship', 'internships', [field('org', 'organization')])]);
  const plan = buildCareerPlan(p, initial, ordered); const fill = fillStep(plan, 'internships'); const add = addStep(plan, 'educations');
  for (const current of [{ ...initial, url: `${initial.url}#another-step` }, { ...initial, generation: 4 }]) {
    assert.throws(() => validateCareerGroupFill(plan, fill, current, p), /已变化/);
    assert.throws(() => validateCareerAddStep(plan, add, current, p), /已变化/);
  }
  assert.throws(() => validateCareerGroupFill(plan, fill, initial, { ...p, version: 6 }), /资料已更新/);
  assert.throws(() => validateCareerAddStep(plan, add, initial, { ...p, version: 6 }), /资料已更新/);
});

test('field original values, structure and button changes invalidate the entire approved observation', () => {
  const p = profile(); const initial = observation([group('internship', 'internships', [field('org', 'organization')])]);
  const plan = buildCareerPlan(p, initial, ordered); const fill = fillStep(plan, 'internships'); const add = addStep(plan, 'educations');
  for (const change of [(current: CareerFormObservation) => { current.groups[0]!.fields[0]!.value = 'new'; },
    (current: CareerFormObservation) => { current.groups[0]!.fields[0]!.type = 'password'; },
    (current: CareerFormObservation) => { current.addControls[0]!.signature = 'changed'; }]) {
    const current = structuredClone(initial); change(current);
    assert.throws(() => validateCareerGroupFill(plan, fill, current, p), /已变化/);
    assert.throws(() => validateCareerAddStep(plan, add, current, p), /已变化/);
  }
});

test('a forged fill value or add target cannot bypass the local confirmed record', () => {
  const p = profile(); const initial = observation([group('internship', 'internships', [field('org', 'organization')])]);
  const plan = buildCareerPlan(p, initial, ordered); const fill = structuredClone(fillStep(plan, 'internships'));
  fill.items[0]!.value = '模型编造的公司';
  assert.throws(() => validateCareerGroupFill(plan, fill, initial, p), /不属于本次计划/);
  const add = { ...addStep(plan, 'educations'), recordId: 'e-master' };
  assert.throws(() => validateCareerAddStep(plan, add, initial, p), /不属于本次计划/);
});

test('project details, link and role come only from the bound project; protocol links remain manual', () => {
  const p = profile(); const initial = observation([group('project', 'projects', [field('name', 'name'), field('role', 'role'), field('description', 'description', { type: 'textarea' }), field('url', 'url', { type: 'url' })])]);
  assert.deepEqual(fillStep(buildCareerPlan(p, initial), 'projects').items.map(item => item.value), ['虚构检索项目', '开发', '开发虚构文档检索。', 'https://example.invalid/project']);
  p.career!.projects[0]!.url = 'javascript:alert(1)';
  assert.equal(fillStep(buildCareerPlan(p, initial), 'projects').items[3]!.status, 'review');
});

test('degree select uses a unique real equivalent while ambiguous and unbound custom widgets stay manual', () => {
  const p = profile();
  for (const patch of [
    { type: 'select', options: [{ label: "Master's degree", value: 'master-code' }] },
    { type: 'select', options: [{ label: '硕士', value: 'm1' }, { label: 'Master', value: 'm2' }] },
    { type: 'combobox', customSelectSupported: true }, { type: 'combobox' },
  ]) {
    const g = group('education', 'educations', [field('degree', 'degree', patch)]);
    const step = fillStep(buildCareerPlan(p, observation([g]), { selectedRecordIds: { educations: ['e-master'] } }), 'educations');
    const expectedReady = patch.type === 'select' ? patch.options!.length === 1 : !!patch.customSelectSupported;
    assert.equal(step.items[0]!.status, expectedReady ? 'ready' : 'review');
    if (patch.type === 'select' && expectedReady) assert.equal(step.items[0]!.value, 'master-code');
  }
});

test('planning is isolated from caller mutation and never changes the profile, source evidence or observations', () => {
  const p = profile(); const initial = observation([group('intern', 'internships', [field('org', 'organization')])]);
  const pBefore = structuredClone(p); const originalBefore = structuredClone(initial); const options = structuredClone(ordered);
  const plan = buildCareerPlan(p, initial, options);
  assert.deepEqual(p, pBefore); assert.deepEqual(initial, originalBefore);
  initial.groups[0]!.fields[0]!.value = 'caller changed'; options.selectedRecordIds.educations[0] = 'e-master';
  assert.equal(plan.original.groups[0]!.fields[0]!.value, ''); assert.equal(plan.options.selectedRecordIds!.educations![0], 'e-bachelor');
});

test('an explicitly preserved existing group stays unbound and permits adding the approved record', () => {
  const p = profile(); const existing = group('preserved-education', 'educations', [field('existing-school', 'school', { value: '网页已有学校' })]);
  const plan = buildCareerPlan(p, observation([existing]), { ...ordered, preserveGroupIds: [existing.id] });
  assert.equal(plan.bindings.length, 0); assert.equal(addStep(plan, 'educations').recordId, 'e-bachelor');
  assert.equal(plan.issues.some(issue => issue.collection === 'educations'), false);
});

test('preserved group ids must be unique, observed and disjoint from all fill bindings', () => {
  const p = profile(); const existing = group('education', 'educations', [field('school', 'school')]); const original = observation([existing]);
  assert.throws(() => buildCareerPlan(p, original, { ...ordered, preserveGroupIds: ['missing'] }), /不存在/);
  assert.throws(() => buildCareerPlan(p, original, { ...ordered, preserveGroupIds: [existing.id, existing.id] }), /重复/);
  assert.throws(() => buildCareerPlan(p, original, { ...ordered, preserveGroupIds: [existing.id], bindings: [bound(p, existing, 'e-bachelor')] }), /同时保留和绑定/);
});

test('add resume preserves every explicitly preserved group value and retains the preserve authorization', () => {
  const p = profile(); const existing = group('old-education', 'educations', [field('old-school', 'school', { value: '网页已有学校' })]);
  const original = observation([existing]); const plan = buildCareerPlan(p, original, { ...ordered, preserveGroupIds: [existing.id] });
  const current = { ...original, groups: [existing, group('new-education', 'educations', [field('new-school', 'school')])] };
  const resumed = resumeCareerPlanAfterAdd(plan, addStep(plan, 'educations'), current, p);
  assert.deepEqual(resumed.options.preserveGroupIds, [existing.id]); assert.equal(fillStep(resumed, 'educations').binding.groupId, 'new-education');
  const changed = structuredClone(current); changed.groups[0]!.fields[0]!.value = '意外改写';
  assert.throws(() => resumeCareerPlanAfterAdd(plan, addStep(plan, 'educations'), changed, p), /原有内容不变/);
});

test('unselected collections with existing values are preserved without adding irrelevant pending work', () => {
  const existing = group('old-project', 'projects', [field('old-name', 'name', { value: '网页已有项目' })]);
  const plan = buildCareerPlan(profile(), observation([existing]), { selectedRecordIds: { educations: [], internships: [], projects: [] } });
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.steps, []);
});
