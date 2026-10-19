import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowCareerTarget, workflowOrdinaryTarget } from '../packages/browser/src/workflow-location.js';
import { FieldLocationError } from '../packages/browser/src/field-location.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import type { ApplicationWorkflowIssue, FieldObservation, FormObservation } from '../packages/shared/src/contracts.js';
import type { CareerFieldObservation, CareerFormObservation, CareerPageGroup } from '../packages/forms/src/career-plan.js';

const url = 'https://example.invalid/fictional-application';
const issue = (patch: Partial<ApplicationWorkflowIssue> = {}): ApplicationWorkflowIssue => ({ id: 'fictional-issue', section: 'other', status: 'open', scope: 'field',
  required: null, reasonCode: 'needs-review', reason: '固定只读诊断', label: '为什么选择这个岗位', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
  lastCheckedProfileVersion: 1, readbackVerified: false, ...patch });
const status = (expected: FieldLocationError['status']) => (error: unknown) => error instanceof FieldLocationError && error.status === expected;
function field(id: string, label = '为什么选择这个岗位', patch: Partial<FieldObservation> = {}): FieldObservation {
  return { id, index: 0, label, type: 'text', value: '', required: false, editable: true, options: [], bounds: { x: 10, y: 20, width: 300, height: 35 }, signature: `signature-${id}`, ...patch };
}
function ordinary(fields = [field('field-0')]): FormObservation {
  return { id: 'fresh-observation', url, title: '原创只读定位测试', observedAt: '2026-10-19T00:00:00Z', signature: 'current-page', fields };
}
const careerField = (id: string, key: CareerFieldObservation['key'], value = '', patch: Partial<CareerFieldObservation> = {}): CareerFieldObservation => ({ id, key, value,
  type: 'text', editable: true, signature: `signature-${id}`, ...patch });
function group(id: string, fields: CareerFieldObservation[], collection: CareerPageGroup['collection'] = 'internships'): CareerPageGroup {
  return { id, collection, signature: `signature-${id}`, fields };
}
function career(groups: CareerPageGroup[]): CareerFormObservation { return { id: 'fresh-career', url, generation: 3, signature: 'career-signature', groups, addControls: [] }; }
function internshipGroup(id = 'internship[0]'): CareerPageGroup {
  return group(id, [careerField(`${id}.company`, 'organization', '虚构星河智能实验室'), careerField(`${id}.title`, 'role')]);
}
function internshipIssue(patch: Partial<ApplicationWorkflowIssue> = {}): ApplicationWorkflowIssue {
  return issue({ section: 'internships', collection: 'internships', recordId: 'fictional-internship-search', profileField: 'role', label: '实习职位', ...patch });
}

test('ordinary persisted identity requires the exact current signature and type, never falling back to an old index', () => {
  const profile = createCareerFormFixtureProfile(), current = ordinary();
  const saved = issue({ fieldId: 'field-0', fieldSignature: 'signature-field-0', fieldType: 'text' });
  assert.strictEqual(workflowOrdinaryTarget(saved, current, profile), current.fields[0]);
  for (const patch of [{ signature: 'new-structure' }, { type: 'textarea' }, { id: 'field-1' }]) {
    assert.throws(() => workflowOrdinaryTarget(saved, ordinary([{ ...current.fields[0]!, ...patch }]), profile), status('stale'));
  }
});
test('legacy ordinary records locate only a single exact label and compatible type, without using the old field id', () => {
  const profile = createCareerFormFixtureProfile(), current = ordinary([field('field-9')]);
  assert.equal(workflowOrdinaryTarget(issue({ fieldId: 'field-0', fieldType: 'text' }), current, profile).id, 'field-9');
  assert.throws(() => workflowOrdinaryTarget(issue({ fieldType: 'textarea' }), current, profile), status('ambiguous'));
  assert.throws(() => workflowOrdinaryTarget(issue({ label: '为什么选择' }), current, profile), status('ambiguous'));
  assert.throws(() => workflowOrdinaryTarget(issue(), ordinary([field('field-0'), field('field-9')]), profile), status('ambiguous'));
});
test('unknown ordinary captions cannot become reliable semantics merely because only one control is visible', () => {
  const profile = createCareerFormFixtureProfile();
  for (const label of ['', 'unknown', '未命名输入框', '需要核对的填写项', '无标签']) {
    assert.throws(() => workflowOrdinaryTarget(issue({ label }), ordinary([field('field-0', label)]), profile), status('ambiguous'));
  }
});
test('ordinary semantic correspondence remains available after the user has already entered a value', () => {
  const profile = createCareerFormFixtureProfile();
  const current = ordinary([field('field-7', '电子邮箱', { type: 'email', value: profile.email })]);
  assert.equal(workflowOrdinaryTarget(issue({ label: '电子邮箱', profileField: 'email', fieldType: 'email' }), current, profile).id, 'field-7');
  const english = ordinary([field('field-name', 'Name', { value: profile.fullNameEn })]);
  assert.equal(workflowOrdinaryTarget(issue({ label: 'Name', profileField: 'fullNameEn' }), english, profile).id, 'field-name');
});
test('known purpose still refuses two matching ordinary fields and incompatible saved purpose', () => {
  const profile = createCareerFormFixtureProfile();
  const current = ordinary([field('field-0', '邮箱'), field('field-1', '邮箱')]);
  assert.throws(() => workflowOrdinaryTarget(issue({ label: '邮箱', profileField: 'email' }), current, profile), status('ambiguous'));
  assert.throws(() => workflowOrdinaryTarget(issue({ label: '邮箱', profileField: 'phone' }), ordinary([field('field-0', '邮箱')]), profile), status('ambiguous'));
});
test('section and career issues cannot be passed through the ordinary locator', () => {
  const profile = createCareerFormFixtureProfile();
  assert.throws(() => workflowOrdinaryTarget(issue({ scope: 'section' }), ordinary(), profile), status('ambiguous'));
  assert.throws(() => workflowOrdinaryTarget(internshipIssue(), ordinary(), profile), status('ambiguous'));
});
test('career uses unique confirmed record facts and exact field purpose instead of an array ordinal', () => {
  const profile = createCareerFormFixtureProfile(), target = internshipGroup('internship[4]');
  const current = career([internshipGroup('internship[2]'), target]); current.groups[0]!.fields[0]!.value = '虚构云杉软件研究院';
  const before = structuredClone({ profile, current });
  assert.deepEqual(workflowCareerTarget(internshipIssue({ groupId: 'internship[0]', fieldId: 'internship[0].title' }), current, profile), { groupId: 'internship[4]', fieldId: 'internship[4].title', fieldKey: 'role' });
  assert.deepEqual({ profile, current }, before, 'mapping never changes facts, groups or field values');
});
test('career certified structural identity never falls back after its signature changes', () => {
  const profile = createCareerFormFixtureProfile(), current = career([internshipGroup()]);
  const saved = internshipIssue({ groupId: 'internship[0]', groupSignature: 'signature-internship[0]', fieldId: 'internship[0].title', fieldSignature: 'signature-internship[0].title', fieldType: 'text' });
  assert.deepEqual(workflowCareerTarget(saved, current, profile), { groupId: 'internship[0]', fieldId: 'internship[0].title', fieldKey: 'role' });
  const changed = structuredClone(current); changed.groups[0]!.signature = 'changed';
  assert.throws(() => workflowCareerTarget(saved, changed, profile), status('stale'));
  const changedField = structuredClone(current); changedField.groups[0]!.fields[1]!.signature = 'changed';
  assert.throws(() => workflowCareerTarget(saved, changedField, profile), status('stale'));
});
test('duplicate matching records or duplicate matching webpage groups remain ambiguous even with an old group index', () => {
  const profile = createCareerFormFixtureProfile();
  const duplicateRecord = structuredClone(profile.career!.internships[0]!); duplicateRecord.id = 'another-confirmed-record'; profile.career!.internships.push(duplicateRecord);
  assert.throws(() => workflowCareerTarget(internshipIssue({ groupId: 'internship[0]' }), career([internshipGroup()]), profile), status('ambiguous'));
  const clean = createCareerFormFixtureProfile();
  assert.throws(() => workflowCareerTarget(internshipIssue({ groupId: 'internship[0]' }), career([internshipGroup(), internshipGroup('internship[1]')]), clean), status('ambiguous'));
});
test('an unconfirmed or revised source record cannot establish a restored career correspondence', () => {
  for (const patch of [{ confirmation: 'pending' as const }, { confirmedRevision: 0 }, { confirmedAt: undefined }]) {
    const profile = createCareerFormFixtureProfile(); Object.assign(profile.career!.internships[0]!, patch);
    assert.throws(() => workflowCareerTarget(internshipIssue(), career([internshipGroup()]), profile), status('ambiguous'));
  }
});
test('empty repeated groups never bind a record solely from an old index or a sole source record', () => {
  const profile = createCareerFormFixtureProfile(); profile.career!.internships = profile.career!.internships.slice(0, 1);
  const blank = internshipGroup(); blank.fields[0]!.value = '';
  const repeated = structuredClone(blank); repeated.id = 'internship[1]';
  assert.throws(() => workflowCareerTarget(internshipIssue({ groupId: 'internship[0]' }), career([blank, repeated]), profile), status('ambiguous'));
});
test('career degree evidence supports the actual native select value and the established degree dictionary', () => {
  const profile = createCareerFormFixtureProfile(), record = profile.career!.educations[0]!;
  for (const degree of [careerField('education[0].degree', 'degree', 'Master', { type: 'combobox' }),
    careerField('education[0].degree', 'degree', '2', { type: 'select', options: [{ label: '硕士', value: '2' }] })]) {
    const g = group('education[0]', [careerField('education[0].school', 'school', record.school), degree, careerField('education[0].major', 'major')], 'educations');
    assert.deepEqual(workflowCareerTarget(issue({ section: 'educations', collection: 'educations', recordId: record.id, profileField: 'major' }), career([g]), profile),
      { groupId: 'education[0]', fieldId: 'education[0].major', fieldKey: 'major' });
  }
});
test('ongoing evidence requires the reviewed month representation and never manufactures an end month', () => {
  const profile = createCareerFormFixtureProfile(), record = profile.career!.internships[0]!; record.current = true; record.endDate = '';
  const g = group('internship[0]', [careerField('internship[0].end', 'endDate', '至今', { type: 'feishu-month' }), careerField('internship[0].title', 'role')]);
  assert.equal(workflowCareerTarget(internshipIssue(), career([g]), profile).fieldKey, 'role');
  g.fields[0]!.type = 'text'; assert.throws(() => workflowCareerTarget(internshipIssue(), career([g]), profile), status('ambiguous'));
  assert.equal(record.endDate, '');
});
test('career refuses missing field purpose, incompatible type and duplicated target controls', () => {
  const profile = createCareerFormFixtureProfile(), current = career([internshipGroup()]);
  assert.throws(() => workflowCareerTarget(internshipIssue({ profileField: undefined, fieldId: 'internship[0].title' }), current, profile), status('ambiguous'));
  assert.throws(() => workflowCareerTarget(internshipIssue({ fieldType: 'select' }), current, profile), status('ambiguous'));
  current.groups[0]!.fields.push(careerField('internship[0].another-title', 'role'));
  assert.throws(() => workflowCareerTarget(internshipIssue(), current, profile), status('ambiguous'));
});
