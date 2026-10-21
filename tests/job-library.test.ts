import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job, RecruitmentType } from '../packages/shared/src/contracts.js';
import { filterSavedJobs } from '../packages/ui/src/job-filter.js';
import { groupSavedJobsByCompany, recruitmentTypeCounts } from '../packages/ui/src/job-library.js';

function job(id: string, company: string, type: RecruitmentType, changes: Partial<Job> = {}): Job {
  return { id, company, type, title: `虚构算法岗位 ${id}`, city: '杭州', description: 'Python', requirements: '',
    url: `https://example.invalid/${id}`, sourceId: 'fixture', sourceName: '虚构来源', demo: true,
    publishedAt: null, deadline: null, observedAt: '2026-10-21T00:00:00Z', firstSeenAt: '2026-10-21T00:00:00Z',
    match: { score: 50, eligible: 'review', concerns: [], reasons: [], profileVersion: 1 }, ...changes };
}

test('interleaved companies are grouped in first-seen order without changing job objects or their ranking', () => {
  const jobs = [job('a-intern', '虚构甲公司', 'internship'), job('b-campus', '虚构乙公司', 'campus'),
    job('a-campus', '虚构甲公司', 'campus'), job('a-experienced', '虚构甲公司', 'experienced'),
    job('b-intern', '虚构乙公司', 'internship'), job('a-unknown', '虚构甲公司', 'unknown'), job('a-campus-second', '虚构甲公司', 'campus')];
  const original = structuredClone(jobs);
  const groups = groupSavedJobsByCompany(jobs);
  assert.deepEqual(groups.map(group => group.company), ['虚构甲公司', '虚构乙公司']);
  assert.deepEqual(groups[0]!.jobs.map(item => item.id), ['a-intern', 'a-campus', 'a-experienced', 'a-unknown', 'a-campus-second']);
  assert.deepEqual(groups[0]!.sections.map(section => section.type), ['campus', 'internship', 'experienced', 'unknown']);
  assert.deepEqual(groups[0]!.sections.map(section => section.jobs.map(item => item.id)), [['a-campus', 'a-campus-second'], ['a-intern'], ['a-experienced'], ['a-unknown']]);
  assert.equal(groups[0]!.jobs[0], jobs[0]);
  assert.equal(groups[0]!.sections[1]!.jobs[0], jobs[0]);
  assert.deepEqual(jobs, original);
});

test('company identity normalizes only Unicode compatibility, case and whitespace', () => {
  const jobs = [job('first', '  ＡＣＭＥ　 LAB  ', 'campus'), job('second', 'acme\t lab', 'internship'),
    job('suffix', 'ACME LAB有限公司', 'campus'), job('subsidiary', 'ACME LAB（杭州）', 'campus'),
    job('alias', '虚构艾克米', 'campus'), job('no-space', 'ACMELAB', 'campus')];
  jobs.forEach(item => { item.url = 'https://same.example.invalid/apply'; });
  const groups = groupSavedJobsByCompany(jobs);
  assert.equal(groups.length, 5, 'a shared URL cannot merge legal suffixes, subsidiaries or aliases');
  assert.deepEqual(groups[0]!.jobs.map(item => item.id), ['first', 'second']);
  assert.equal(groups[0]!.company, 'ＡＣＭＥ　 LAB', 'the first displayed company spelling is retained');
});

test('blank company names stay isolated by job ID and unknown recruitment types remain unknown', () => {
  const unknownType = job('future', '虚构公司', 'future' as RecruitmentType);
  const jobs = [job('blank-a', '', 'unknown'), job('blank-b', '　 \t', 'internship'),
    job('literal', '公司待确认', 'campus'), unknownType];
  const groups = groupSavedJobsByCompany(jobs);
  assert.equal(groups.length, 4);
  assert.equal(new Set(groups.map(group => group.key)).size, 4);
  assert.deepEqual(groups[3]!.sections.map(section => section.type), ['unknown']);
  assert.equal(unknownType.type, 'future', 'presentation never rewrites stored classification');
  assert.deepEqual(recruitmentTypeCounts(jobs), { all: 4, campus: 1, internship: 1, experienced: 0, unknown: 2 });
});

test('type tab counts reflect the current search and city scope, including unknown records', () => {
  const jobs = [job('campus', '虚构甲', 'campus'), job('internship', '虚构甲', 'internship'),
    job('other-city', '虚构甲', 'experienced', { city: '上海' }), job('other-company', '虚构乙', 'unknown'),
    job('unknown', '虚构甲', 'unknown')];
  const original = structuredClone(jobs);
  const filtered = filterSavedJobs(jobs, { query: '虚构甲', city: '杭州', type: '' });
  assert.deepEqual(recruitmentTypeCounts(filtered), { all: 3, campus: 1, internship: 1, experienced: 0, unknown: 1 });
  assert.deepEqual(recruitmentTypeCounts(filterSavedJobs(jobs, { query: '虚构甲', city: '杭州', type: 'internship' })),
    { all: 1, campus: 0, internship: 1, experienced: 0, unknown: 0 });
  assert.deepEqual(jobs, original);
});

test('an empty result has no company sections and zero counts in every type', () => {
  assert.deepEqual(groupSavedJobsByCompany([]), []);
  assert.deepEqual(recruitmentTypeCounts([]), { all: 0, campus: 0, internship: 0, experienced: 0, unknown: 0 });
});
