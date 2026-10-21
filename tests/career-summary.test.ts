import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../packages/domain/src/store.js';
import { getProfileSummary } from '../packages/agent/src/profile-summary.js';
import { validateDomainToolResult } from '../packages/agent/src/tools.js';
import { emptyCareerInput, mergeCareerImport, newCareerRecord, pickCareerInput, withConfirmedEducation } from '../packages/profile/src/career-input.js';
import { buildFillPlan } from '../packages/forms/src/index.js';
import { matchJob } from '../packages/domain/src/matching.js';
import type { FormObservation, Profile, ProfileInput } from '../packages/shared/src/contracts.js';

const basic: Omit<ProfileInput, 'career' | 'personal'> = { fullName: '虚构姓名', fullNameEn: '', email: 'private@example.invalid', phone: '13800000000',
  school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: ['Python'], cities: [], targetRoles: ['算法'], resumeText: 'PRIVATE_FULL_RESUME' };

test('only current confirmed professional facts enter the shared model summary, never raw sources or private descriptions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'offeragent-summary-'));
  const store = await createStore({ directory: dir });
  try {
    const career = emptyCareerInput();
    career.projects.push({ ...newCareerRecord('projects', 'project-one'), name: '检索增强项目', role: '开发', technologies: ['RAG'], description: 'PRIVATE_PROJECT_DESCRIPTION' });
    career.publications.push({ ...newCareerRecord('publications', 'paper-one'), title: '虚构论文', authors: 'PRIVATE_AUTHOR', venue: '虚构会议', status: 'submitted' });
    let profile = (await store.saveProfile({ ...basic, career }, 0)).profile;
    assert.deepEqual(getProfileSummary(profile).careerSummary?.projects, []);
    assert.equal(getProfileSummary(profile).careerSummary?.pendingCount, 2);
    profile = (await store.confirmCareerRecord('projects', 'project-one', profile.version, 1)).profile;
    profile = (await store.confirmCareerRecord('publications', 'paper-one', profile.version, 1)).profile;
    const summary = getProfileSummary(profile);
    validateDomainToolResult('get_profile_summary', summary);
    assert.equal(summary.careerSummary?.projects[0]?.name, '检索增强项目');
    assert.equal(summary.careerSummary?.publications[0]?.status, 'submitted');
    for (const secret of [basic.fullName, basic.email, basic.phone, basic.resumeText, 'PRIVATE_PROJECT_DESCRIPTION', 'PRIVATE_AUTHOR', 'quote', 'fileHash', 'sourceNote']) assert.ok(!JSON.stringify(summary).includes(secret), secret);
    const input = pickCareerInput(profile.career);
    input.projects[0]!.role = '修改后的角色';
    profile = (await store.saveProfile({ ...basic, career: input }, profile.version)).profile;
    assert.deepEqual(getProfileSummary(profile).careerSummary?.projects, []);
    assert.equal(getProfileSummary(profile).careerSummary?.publications[0]?.status, 'submitted');
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('DTO projection strips server metadata and reimport preserves the existing record plus selected education', () => {
  const current = emptyCareerInput();
  current.projects.push({ ...newCareerRecord('projects', 'same-project'), name: '用户已修改名称' });
  current.primaryEducationId = 'chosen';
  const incoming = emptyCareerInput();
  incoming.projects.push({ ...newCareerRecord('projects', 'same-project'), name: '旧候选' }, { ...newCareerRecord('projects', 'new-project'), name: '新候选' });
  const merged = mergeCareerImport(current, incoming);
  assert.equal(merged.projects.length, 2);
  assert.equal(merged.projects[0]!.name, '用户已修改名称');
  assert.equal(merged.primaryEducationId, 'chosen');
  incoming.projects[1]!.name = '外部对象修改';
  assert.equal(merged.projects[1]!.name, '新候选');
  const stored = { ...current, projects: current.projects.map(record => ({ ...record, revision: 3, confirmation: 'confirmed', confirmedAt: '2026-10-12T01:00:00Z', confirmedRevision: 3 })) } as NonNullable<Profile['career']>;
  assert.ok(!JSON.stringify(pickCareerInput(stored)).includes('confirmedAt'));
  assert.ok(!JSON.stringify(pickCareerInput(stored)).includes('revision'));
});

test('pending or unselected structured education cannot bypass confirmation through legacy scalar fields', () => {
  const career = emptyCareerInput();
  career.educations.push({ ...newCareerRecord('educations', 'education-one'), school: '未确认学校', degree: '硕士', endDate: '2027' });
  const profile: Profile = { ...basic, school: 'STALE_SCHOOL', degree: '硕士', graduationMonth: '2027-06', version: 1, updatedAt: '2026-10-12T01:00:00Z', career: {
    ...career, educations: career.educations.map(record => ({ ...record, revision: 1, confirmation: 'pending', confirmedAt: null, confirmedRevision: null })), internships: [], projects: [], publications: [], sources: [], primaryEducationId: 'education-one',
  } };
  assert.equal(withConfirmedEducation(profile).school, '');
  assert.equal(getProfileSummary(profile).degree, '');
  const job = { company: '虚构公司', title: '算法岗位', city: '', type: 'campus' as const, description: '', requirements: '硕士学历，2027届', url: 'https://example.invalid/role', sourceId: 'test', sourceName: 'test', publishedAt: null, deadline: null, demo: true };
  assert.ok(matchJob(profile, job).concerns.some(value => value.includes('学历需确认')));
});

test('multiple education records never all receive the default school in repeated form sections', () => {
  const confirmed = { revision: 1, confirmation: 'confirmed' as const, confirmedAt: '2026-10-12T01:00:00Z', confirmedRevision: 1 };
  const career = emptyCareerInput();
  const profile: Profile = { ...basic, version: 1, updatedAt: confirmed.confirmedAt, career: { ...career,
    educations: [{ ...newCareerRecord('educations', 'bachelor'), ...confirmed, school: '本科院校', degree: '本科' }, { ...newCareerRecord('educations', 'master'), ...confirmed, school: '硕士院校', degree: '硕士', endDate: '2027' }],
    internships: [], projects: [], publications: [], sources: [], primaryEducationId: 'master',
  } };
  assert.equal(withConfirmedEducation(profile).graduationMonth, '', 'year-only never acquires a guessed month');
  const observation: FormObservation = { id: 'observation', url: 'https://example.invalid/application', title: '虚构表单', observedAt: confirmed.confirmedAt, signature: 'fixture', fields: [0, 1].map(index => ({
    id: `field-${index}`, index, label: '学校', type: 'text', value: '', required: false, editable: true, options: [], bounds: { x: 0, y: index * 50, width: 100, height: 20 }, signature: `field-${index}`, section: `教育经历${index + 1}`,
  })) };
  assert.ok(buildFillPlan(observation, profile).items.every(item => item.status === 'review' && item.value === ''));
  const bachelorOnly = { ...observation, fields: [{ ...observation.fields[0]!, section: '本科教育经历' }] };
  const scoped = buildFillPlan(bachelorOnly, profile).items[0]!;
  assert.equal(scoped.status, 'ready', 'a unique confirmed bachelor section can bind its own record');
  assert.equal(scoped.value, '本科院校');
  assert.notEqual(scoped.value, profile.career!.educations[1]!.school);
});

test('a confirmed year-only education supports cohort checks while month windows remain unknown', () => {
  const confirmed = { revision: 1, confirmation: 'confirmed' as const, confirmedAt: '2026-10-12T01:00:00Z', confirmedRevision: 1 };
  const career = emptyCareerInput();
  const profile: Profile = { ...basic, version: 1, updatedAt: confirmed.confirmedAt, career: { ...career,
    educations: [{ ...newCareerRecord('educations', 'year-only'), ...confirmed, school: '虚构院校', degree: '本科', endDate: '2026' }],
    sources: [], internships: [], projects: [], publications: [], primaryEducationId: 'year-only',
  } };
  const job = { company: '虚构公司', title: '算法校招', city: '', type: 'campus' as const, description: '', requirements: '2027届', url: 'https://example.invalid/year', sourceId: 'fixture', sourceName: 'fixture', publishedAt: null, deadline: null, demo: true };
  assert.equal(matchJob(profile, job).eligible, 'unsuitable');
  assert.ok(matchJob(profile, { ...job, requirements: '2026届' }).reasons.some(value => value.includes('毕业年份符合')));
  assert.ok(matchJob(profile, { ...job, requirements: '2026届，毕业时间2026年9月-2027年8月' }).concerns.some(value => value.includes('毕业时间需确认')));
  assert.equal(withConfirmedEducation(profile).graduationMonth, '');
});
