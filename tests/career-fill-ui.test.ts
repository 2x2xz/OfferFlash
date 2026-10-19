import assert from 'node:assert/strict';
import test from 'node:test';
import type { Profile } from '../packages/shared/src/contracts.js';
import type { CareerFillPreview } from '../packages/shared/src/career-form.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import { careerFillRequest, confirmedCareerFillRecords, emptyCareerFillSelection, moveCareerFillRecord } from '../packages/ui/src/career-fill.js';

const confirmed = { revision: 3, confirmation: 'confirmed' as const, confirmedRevision: 3, confirmedAt: '2026-10-18T00:00:00Z' };
function profile(): Profile {
  return { version: 9, updatedAt: '', fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '',
    degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '',
    career: { ...emptyCareerInput(), sources: [],
      educations: [
        { ...newCareerRecord('educations', 'education-one'), ...confirmed, school: '虚构北城大学', degree: '本科', startDate: '2020', endDate: '2024-06' },
        { ...newCareerRecord('educations', 'education-two'), ...confirmed, school: '虚构南城大学', degree: '硕士' },
      ],
      internships: [{ ...newCareerRecord('internships', 'internship-one'), ...confirmed, organization: '虚构公司', role: '算法实习生' }],
      projects: [{ ...newCareerRecord('projects', 'project-one'), ...confirmed, name: '虚构研究项目', ongoing: true }],
      publications: [], primaryEducationId: null,
    } };
}
function observation(): CareerFillPreview {
  return { planId: 'observation-only', url: 'https://example.invalid/apply', profileVersion: 9,
    groups: [{ id: 'web-education', collection: 'educations', signature: 'education-structure', fields: [
      { id: 'web-school', key: 'school', type: 'text', value: '网页已有学校，不能据此猜对应', editable: true },
    ] }, { id: 'web-project', collection: 'projects', signature: 'project-structure', fields: [] }],
    bindings: [], selectedRecordIds: {}, preserveGroupIds: [], steps: [], issues: [] };
}

test('career fill selection includes only the current explicitly confirmed revision', () => {
  const value = profile();
  value.career!.educations[0]!.confirmedRevision = 2;
  value.career!.internships[0]!.confirmation = 'pending';
  value.career!.projects[0]!.confirmedAt = null;
  const before = structuredClone(value);
  const records = confirmedCareerFillRecords(value);
  assert.deepEqual(records.educations.map(record => record.id), ['education-two']);
  assert.deepEqual(records.internships, []); assert.deepEqual(records.projects, []);
  assert.deepEqual(value, before, 'displaying records never confirms or changes the saved profile');
});

test('every observed group needs an explicit binding or preservation, including existing nonempty groups', () => {
  const value = profile(); const page = observation();
  const selected = { ...emptyCareerFillSelection(), educations: ['education-one'] };
  assert.throws(() => careerFillRequest(value, page, selected, {}), /每个已有网页组/);
  assert.throws(() => careerFillRequest(value, page, selected, { 'web-education': { kind: 'bind', recordId: 'education-one' } }), /每个已有网页组/);
  const result = careerFillRequest(value, page, selected, {
    'web-education': { kind: 'bind', recordId: 'education-one' }, 'web-project': { kind: 'preserve' },
  });
  assert.deepEqual(result.bindings, [{ collection: 'educations', recordId: 'education-one', revision: 3,
    profileVersion: 9, groupId: 'web-education', groupSignature: 'education-structure' }]);
  assert.deepEqual(result.preserveGroupIds, ['web-project']);
});

test('record order is the explicit user order and moving it never mutates saved record arrays', () => {
  const original = ['education-one', 'education-two'];
  const moved = moveCareerFillRecord(original, 'education-two', -1);
  assert.deepEqual(moved, ['education-two', 'education-one']); assert.deepEqual(original, ['education-one', 'education-two']);
  assert.deepEqual(moveCareerFillRecord(original, 'education-one', -1), original);
  const result = careerFillRequest(profile(), observation(), { ...emptyCareerFillSelection(), educations: moved }, {
    'web-education': { kind: 'preserve' }, 'web-project': { kind: 'preserve' },
  });
  assert.deepEqual(result.selectedRecordIds?.educations, moved);
  assert.deepEqual(result.bindings, [], 'preservation does not silently bind the first selected record');
});

test('a record cannot bind twice or cross collections and unselected records cannot be used', () => {
  const value = profile(); const page = observation();
  const selected = { ...emptyCareerFillSelection(), educations: ['education-one'], projects: ['project-one'] };
  assert.throws(() => careerFillRequest(value, page, selected, {
    'web-education': { kind: 'bind', recordId: 'education-two' }, 'web-project': { kind: 'preserve' },
  }), /本次选中/);
  assert.throws(() => careerFillRequest(value, page, selected, {
    'web-education': { kind: 'preserve' }, 'web-project': { kind: 'bind', recordId: 'education-one' },
  }), /本次选中/);
  page.groups.push({ ...page.groups[0]!, id: 'second-web-education', signature: 'second-structure' });
  assert.throws(() => careerFillRequest(value, page, selected, {
    'web-education': { kind: 'bind', recordId: 'education-one' }, 'web-project': { kind: 'preserve' },
    'second-web-education': { kind: 'bind', recordId: 'education-one' },
  }), /不能绑定到两个/);
});

test('stale profile, pending selection and duplicate selection are rejected before calling the API', () => {
  const value = profile(); const page = observation(); const choices = { 'web-education': { kind: 'preserve' as const }, 'web-project': { kind: 'preserve' as const } };
  assert.throws(() => careerFillRequest({ ...value, version: 10 }, page, emptyCareerFillSelection(), choices), /资料已变化/);
  assert.throws(() => careerFillRequest(value, page, { ...emptyCareerFillSelection(), educations: ['education-one', 'education-one'] }, choices), /所选经历已变化/);
  value.career!.educations[0]!.confirmation = 'pending';
  assert.throws(() => careerFillRequest(value, page, { ...emptyCareerFillSelection(), educations: ['education-one'] }, choices), /尚未确认/);
});
