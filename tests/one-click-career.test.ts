import assert from 'node:assert/strict';
import test from 'node:test';
import type { Profile } from '../packages/shared/src/contracts.js';
import type { CareerFillPageGroup, CareerFillPreview } from '../packages/shared/src/career-form.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import { prepareOneClickCareer } from '../packages/ui/src/one-click-career.js';

const confirmed = { revision: 3, confirmation: 'confirmed' as const, confirmedRevision: 3, confirmedAt: '2026-10-18T00:00:00Z' };
function profile(): Profile {
  return { version: 9, updatedAt: '', fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '',
    degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '',
    career: { ...emptyCareerInput(), sources: [],
      educations: [
        { ...newCareerRecord('educations', 'bachelor'), ...confirmed, school: '虚构北城大学', degree: '本科', major: '计算机', startDate: '2020-09', endDate: '2024-06' },
        { ...newCareerRecord('educations', 'master'), ...confirmed, school: '虚构南城大学', degree: '硕士', major: '人工智能', startDate: '2024-09', endDate: '2027-06' },
      ],
      internships: [{ ...newCareerRecord('internships', 'intern'), ...confirmed, organization: '虚构公司', role: '算法实习生', description: '项目甲\n内容乙' }],
      projects: [{ ...newCareerRecord('projects', 'project'), ...confirmed, name: '虚构研究项目', ongoing: true, url: 'https://example.invalid/project' }],
      publications: [], primaryEducationId: 'master',
    } };
}
function group(id: string, values: Record<string, string> = {}, collection: CareerFillPageGroup['collection'] = 'educations'): CareerFillPageGroup {
  return { id, collection, signature: `${id}-structure`, fields: Object.entries(values).map(([key, value]) => ({ id: `${id}-${key}`, key,
    type: key === 'degree' ? 'combobox' : key.endsWith('Date') ? 'feishu-month' : 'text', value, editable: true })) };
}
function page(groups: CareerFillPageGroup[]): CareerFillPreview {
  return { planId: 'read-only', url: 'https://example.invalid/apply', profileVersion: 9, groups,
    bindings: [], selectedRecordIds: {}, preserveGroupIds: [], steps: [], issues: [] };
}

test('one click selects all confirmed records and uses the explicitly chosen education first without mutating inputs', () => {
  const value = profile(); const observation = page([group('empty', { school: '' }), group('extra', {}), group('unused', {})]);
  const before = structuredClone({ value, observation }); const result = prepareOneClickCareer(value, observation);
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.deepEqual(result.selection, { educations: ['master', 'bachelor'], internships: ['intern'], projects: ['project'] });
  assert.deepEqual(result.options.bindings?.map(binding => [binding.groupId, binding.recordId, binding.revision]), [['empty', 'master', 3], ['extra', 'bachelor', 3]]);
  assert.deepEqual(result.options.preserveGroupIds, ['unused']);
  assert.deepEqual({ value, observation }, before);
});

test('without an explicit valid default, education stays in saved order and never guesses a highest degree', () => {
  const value = profile(); value.career!.primaryEducationId = null;
  assert.deepEqual(prepareOneClickCareer(value, page([])).selection.educations, ['bachelor', 'master']);
  value.career!.primaryEducationId = 'missing';
  assert.deepEqual(prepareOneClickCareer(value, page([])).selection.educations, ['bachelor', 'master']);
});

test('a second click binds already filled groups instead of adding the same records again', () => {
  const result = prepareOneClickCareer(profile(), page([
    group('filled-master', { school: '虚构南城大学', degree: "Master's degree", startDate: '2024-09', endDate: '2027-06' }),
    group('filled-bachelor', { school: '虚构北城大学', degree: '学士', major: '计算机' }),
    group('filled-intern', { organization: '虚构公司', role: '算法实习生' }, 'internships'),
    group('filled-project', { name: '虚构研究项目' }, 'projects'),
  ]));
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.deepEqual(result.options.bindings?.map(binding => binding.recordId), ['master', 'bachelor', 'intern', 'project']);
  assert.equal(result.options.bindings?.length, Object.values(result.selection).flat().length);
});

test('an actually selected 至今 end binds the same confirmed ongoing internship or project on a later click', () => {
  const value = profile(); value.career!.internships[0]!.current = true;
  const observed = page([
    group('existing-intern', { organization: '虚构公司', role: '算法实习生', endDate: '至今' }, 'internships'),
    group('existing-project', { name: '虚构研究项目', endDate: '至今' }, 'projects'),
  ]);
  const before = structuredClone({ value, observed }); const result = prepareOneClickCareer(value, observed);
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.deepEqual(result.choices, { 'existing-intern': { kind: 'bind', recordId: 'intern' }, 'existing-project': { kind: 'bind', recordId: 'project' } });
  assert.deepEqual({ value, observed }, before);
});

test('a 至今 label cannot substitute for a missing fact, a conflicting end date, a start date or an arbitrary text control', () => {
  const base = profile();
  for (const change of ['not-current', 'conflicting-end', 'text-control', 'start-date'] as const) {
    const value = structuredClone(base); const record = value.career!.internships[0]!; record.current = true;
    const observed = group('ongoing-intern', { organization: '虚构公司', endDate: '至今' }, 'internships');
    if (change === 'not-current') record.current = false;
    if (change === 'conflicting-end') record.endDate = '2026-06';
    if (change === 'text-control') observed.fields[1]!.type = 'text';
    if (change === 'start-date') observed.fields[1]!.key = 'startDate';
    const result = prepareOneClickCareer(value, page([observed]));
    assert.equal(result.status, 'review', change); if (result.status !== 'review') continue;
    assert.equal(result.issues[0]!.reason, 'unknown-group'); assert.equal('options' in result, false);
  }
});

test('ongoing flag equivalence never relaxes the other existing fields or resolves ambiguous record identities', () => {
  const value = profile(); value.career!.internships[0]!.current = true;
  const conflict = prepareOneClickCareer(value, page([group('different-intern', { organization: '另一家企业', endDate: '至今' }, 'internships')]));
  assert.equal(conflict.status, 'review');
  value.career!.internships.push({ ...structuredClone(value.career!.internships[0]!), id: 'another-ongoing-intern' });
  const ambiguous = prepareOneClickCareer(value, page([group('ambiguous-intern', { endDate: '至今' }, 'internships')]));
  assert.equal(ambiguous.status, 'review'); if (ambiguous.status !== 'review') return;
  assert.equal(ambiguous.issues[0]!.reason, 'ambiguous-group'); assert.equal('options' in ambiguous, false);
});

test('nonempty uniquely identified groups reserve their records before earlier blank groups', () => {
  const result = prepareOneClickCareer(profile(), page([group('first-empty', {}), group('partial-master', { school: '虚构南城大学', degree: '', major: '' })]));
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.deepEqual(result.choices, { 'partial-master': { kind: 'bind', recordId: 'master' }, 'first-empty': { kind: 'bind', recordId: 'bachelor' } });
});

test('every existing nonempty field must match the same record, including readonly values and complete dates', () => {
  const conflicts: Record<string, string>[] = [{ school: '虚构南城大学', major: '错误专业' }, { school: '虚构南城大学', startDate: '2024' }, { school: '虚构南城大学', endDate: '2027-MM' }, { school: '虚构南城大学', unrecognized: '未知值' }];
  for (const values of conflicts) {
    const result = prepareOneClickCareer(profile(), page([group('conflict', values)]));
    assert.equal(result.status, 'review'); if (result.status !== 'review') return;
    assert.equal(result.issues[0]?.reason, 'unknown-group'); assert.equal('options' in result, false);
  }
});

test('ambiguous partial groups request a decision and do not preassign their candidate to an empty group', () => {
  const value = profile(); value.career!.educations[1]!.school = value.career!.educations[0]!.school;
  const result = prepareOneClickCareer(value, page([group('empty-first', {}), group('ambiguous', { school: '虚构北城大学' })]));
  assert.equal(result.status, 'review'); if (result.status !== 'review') return;
  assert.deepEqual(result.issues, [{ collection: 'educations', groupId: 'ambiguous', reason: 'ambiguous-group', candidateRecordIds: ['bachelor', 'master'] }]);
  assert.equal(result.choices['empty-first'], undefined); assert.equal('options' in result, false);
});

test('two existing groups matching one record both require review instead of silently rebinding or adding', () => {
  const result = prepareOneClickCareer(profile(), page([group('copy-one', { school: '虚构南城大学' }), group('copy-two', { school: '虚构南城大学' })]));
  assert.equal(result.status, 'review'); if (result.status !== 'review') return;
  assert.deepEqual(result.issues.map(issue => issue.reason), ['duplicate-binding', 'duplicate-binding']);
  assert.deepEqual(result.choices, {}); assert.equal('options' in result, false);
});

test('only the current confirmed revision is selected; no confirmed data yields a dedicated no-data result', () => {
  const value = profile(); value.career!.educations[1]!.confirmedRevision = 2;
  value.career!.internships[0]!.confirmation = 'pending'; value.career!.projects[0]!.confirmedAt = null;
  const result = prepareOneClickCareer(value, page([group('blank', {})]));
  assert.equal(result.status, 'ready'); assert.deepEqual(result.selection, { educations: ['bachelor'], internships: [], projects: [] });
  value.career!.educations[0]!.confirmation = 'pending';
  assert.equal(prepareOneClickCareer(value, page([])).status, 'no-data');
  assert.throws(() => prepareOneClickCareer({ ...value, version: 10 }, page([])), /资料已变化/);
});

test('ordinary text uses only trim and canonical Unicode, preserving case and internal whitespace differences', () => {
  const value = profile(); value.career!.projects[0]!.name = 'Café Agent';
  const equivalent = prepareOneClickCareer(value, page([group('normalized', { name: '  Cafe\u0301 Agent  ' }, 'projects')]));
  assert.equal(equivalent.status, 'ready');
  for (const name of ['café Agent', 'Café  Agent']) assert.equal(prepareOneClickCareer(value, page([group('different', { name }, 'projects')])).status, 'review');
  const changedDescription = prepareOneClickCareer(value, page([group('intern-description', { organization: '虚构公司', description: '项目甲 内容乙' }, 'internships')]));
  assert.equal(changedDescription.status, 'review');
});

test('duplicate saved IDs and duplicate page group identities never produce automatic options', () => {
  const value = profile(); value.career!.educations.push({ ...value.career!.educations[0]!, confirmation: 'pending' });
  const result = prepareOneClickCareer(value, page([group('blank', {})]));
  assert.equal(result.status, 'review'); if (result.status !== 'review') return;
  assert.equal(result.issues[0]?.reason, 'duplicate-record');
  assert.throws(() => prepareOneClickCareer(profile(), page([group('same'), group('same')])), /身份重复/);
});
