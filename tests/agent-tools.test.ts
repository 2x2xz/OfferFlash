import assert from 'node:assert/strict';
import test from 'node:test';
import { compactJob, getJobDetails, queryJobs, validateJobQueryArgs } from '../packages/agent/src/job-query.js';
import { createDomainTools, DOMAIN_TOOL_SPECS, validateDomainToolArguments, validateDomainToolResult } from '../packages/agent/src/tools.js';
import type { AppState, Job } from '../packages/shared/src/contracts.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

function execute(tool: ToolDefinition<any, any>, id: string, args: unknown, signal?: AbortSignal) {
  // These host adapters do not inspect the SDK extension context.
  return tool.execute(id, args, signal, undefined, {} as Parameters<typeof tool.execute>[4]);
}

function world(): AppState {
  return {
    profile: {
      version: 7, updatedAt: '2026-10-11T00:00:00.000Z', fullName: '仅本地测试姓名', fullNameEn: '',
      email: 'private@example.invalid', phone: '00000000000', school: '虚构大学', schoolEn: '',
      degree: '硕士', major: '计算机', majorEn: '', graduationMonth: '2027-06', skills: ['Python'], cities: ['杭州'],
      targetRoles: ['算法'], resumeText: 'PRIVATE_RESUME_NOT_FOR_JOB_DETAILS',
    },
    jobs: Array.from({ length: 28 }, (_, index): Job => ({
      id: `job-${index.toString().padStart(2, '0')}`, company: index < 6 ? '测试甲公司' : '测试乙公司',
      title: `算法岗位 ${index}`, city: index % 2 ? '上海' : '杭州',
      type: (['campus', 'internship', 'experienced', 'unknown'] as const)[index % 4]!,
      description: index === 4 ? `${'长'.repeat(3001)}尾部限制要求` : '虚构岗位描述',
      requirements: index === 6 ? '需具备唯一技能证据 Python' : '届别待确认',
      url: `https://example.invalid/careers/${index}`, sourceId: 'fixture-source', sourceName: '虚构招聘来源',
      publishedAt: null, observedAt: '2026-10-11T01:00:00.000Z', firstSeenAt: '2026-10-10T00:00:00.000Z',
      deadline: '2026-11-30', demo: true,
      match: { score: index === 2 ? 99 : 20 + index, reasons: ['技能证据：Python'], concerns: ['届别待确认'],
        eligible: (['likely', 'review', 'unsuitable'] as const)[index % 3]!, profileVersion: 7 },
    })),
    applications: [], sourceRuns: [], settings: { showDemo: true },
  };
}

test('local job pages cover all 28 mixed jobs and prioritize eligibility before a misleading high score', () => {
  const state = world();
  const first = queryJobs(state, {});
  assert.equal(first.totalMatched, 28);
  assert.equal(first.returnedCount, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 20);
  assert.equal(first.coverage, 'local-snapshot');
  assert.equal(first.profileVersion, 7);
  const second = queryJobs(state, { offset: first.nextOffset! });
  assert.equal(second.returnedCount, 8);
  assert.equal(second.nextOffset, null);
  assert.equal(second.hasMore, false);
  const all = [...first.jobs, ...second.jobs];
  assert.equal(new Set(all.map(job => job.id)).size, 28);
  const firstUnsuitable = all.findIndex(job => job.match.eligible === 'unsuitable');
  assert.ok(firstUnsuitable > all.findLastIndex(job => job.match.eligible === 'review'));
  assert.equal(all[0]?.id, 'job-27', 'the highest likely score is first');
  assert.equal(all[firstUnsuitable]?.id, 'job-02', '99-point unsuitable stays behind review');
  assert.deepEqual(state.jobs.map(job => job.id), world().jobs.map(job => job.id), 'sorting never rearranges the store snapshot');
  const pastEnd = queryJobs(state, { offset: 500 });
  assert.deepEqual(pastEnd.jobs, []);
  assert.equal(pastEnd.totalMatched, 28);
  assert.equal(pastEnd.hasMore, false);
});

test('company/requirements search and recruitment/eligibility filters apply before pagination', () => {
  const state = world();
  const company = queryJobs(state, { keyword: '  测试甲公司  ', limit: 2 });
  assert.equal(company.totalMatched, 6);
  assert.equal(company.returnedCount, 2);
  assert.equal(company.filters.keyword, '测试甲公司');
  assert.ok(company.jobs.every(job => job.company === '测试甲公司'));
  const requirements = queryJobs(state, { keyword: '唯一技能证据' });
  assert.deepEqual(requirements.jobs.map(job => job.id), ['job-06']);
  const compound = queryJobs(state, { city: '杭州', recruitmentType: 'campus', eligibility: 'likely' });
  assert.deepEqual(compound.jobs.map(job => job.id), ['job-24', 'job-12', 'job-00']);
  assert.equal(compound.totalMatched, 3);
  assert.deepEqual(compound.filters, { keyword: '', city: '杭州', recruitmentType: 'campus', eligibility: 'likely' });
  assert.equal(queryJobs(state, { keyword: 'no-such-role' }).totalMatched, 0);
});

test('the host rejects unknown query keys, wrong types, invalid enums and unsafe pagination', () => {
  for (const input of [null, [], '杭州', { city: 2 }, { keyword: null }, { city: undefined },
    { recruitmentType: 'all' }, { eligibility: 'probable' }, { offset: -1 }, { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 }, { limit: 0 }, { limit: 21 }, { limit: Number.NaN },
    { silentSubmit: true }, { [Symbol('hidden-action')]: true }]) {
    assert.throws(() => queryJobs(world(), input), /./, JSON.stringify(input));
  }
  assert.throws(() => validateJobQueryArgs(Object.create({ city: '杭州' })), /必须为对象/);
  assert.equal(queryJobs(world(), { offset: 0, limit: 1 }).returnedCount, 1);
});

test('compact results retain source/date evidence, mark truncation, and never project personal data', () => {
  const state = world();
  const job = state.jobs[4]!;
  const compact = compactJob(job);
  assert.equal(compact.description.length, 3000);
  assert.equal(compact.descriptionTruncated, true);
  assert.equal(compact.contentTrust, 'untrusted');
  assert.equal(compact.sourceId, 'fixture-source');
  assert.equal(compact.sourceName, '虚构招聘来源');
  assert.equal(compact.url, job.url);
  assert.equal(compact.publishedAt, null, 'observation time never becomes publication date');
  assert.equal(compact.observedAt, job.observedAt);
  assert.equal(compact.firstSeenAt, job.firstSeenAt);
  assert.equal(compact.deadline, job.deadline);
  const text = JSON.stringify(queryJobs(state, {}));
  for (const secret of [state.profile.fullName, state.profile.email, state.profile.phone, state.profile.resumeText]) {
    assert.ok(!text.includes(secret));
  }
  compact.match.reasons.push('mutated response');
  assert.deepEqual(job.match.reasons, ['技能证据：Python']);
});

test('details require a real returned ID and preserve full untrusted body without accessing profile', () => {
  const state = world();
  const jobsOnly = { jobs: state.jobs };
  const detail = getJobDetails(jobsOnly, 'job-04');
  assert.equal(detail.description, state.jobs[4]?.description);
  assert.equal(detail.descriptionTruncated, false);
  assert.ok(detail.description.endsWith('尾部限制要求'));
  assert.equal(detail.contentTrust, 'untrusted');
  assert.throws(() => getJobDetails(jobsOnly, 'made-up-id'), /岗位不存在/);
  assert.throws(() => getJobDetails(jobsOnly, ' job-04'), /岗位不存在/);
  assert.throws(() => getJobDetails(jobsOnly, ''), /真实岗位 ID/);
  assert.throws(() => getJobDetails(jobsOnly, 4), /真实岗位 ID/);
});

test('shared tool declarations expose only the registered business tools and gate bad parameters before the host', async () => {
  let calls = 0;
  const tools = createDomainTools(async () => { calls++; return {}; });
  assert.deepEqual(tools.map(tool => tool.name), [
    'request_user_input',
    'get_profile_summary', 'query_jobs', 'refresh_jobs', 'list_applications', 'add_to_tracker',
    'open_job', 'prepare_form_preview', 'get_job_details', 'get_task_guide', 'get_application_agenda', 'compare_jobs',
  ]);
  assert.equal(DOMAIN_TOOL_SPECS.length, 12);
  const query = tools.find(tool => tool.name === 'query_jobs')!;
  await assert.rejects(execute(query, 'bad-query', { limit: 21 }), /limit/);
  const track = tools.find(tool => tool.name === 'add_to_tracker')!;
  await assert.rejects(execute(track, 'bad-track', { jobId: 'job-01', submit: true }), /参数/);
  assert.equal(calls, 0);
  assert.throws(() => validateDomainToolArguments('submit_application', {}), /没有此项/);
  assert.throws(() => validateDomainToolArguments('refresh_jobs', { sourceId: 'tencent-whatever' }), /参数/);
});

test('invalid or contradictory host results cannot become successful model-visible results', async () => {
  const valid = queryJobs(world(), {});
  const query = createDomainTools(async () => ({ ...valid, returnedCount: 1 })).find(tool => tool.name === 'query_jobs')!;
  await assert.rejects(execute(query, 'wrong-count', {}), /分页结果不一致/);
  assert.throws(() => validateDomainToolResult('query_jobs', { jobs: valid.jobs }), /不符合工具约定/);
  const details = createDomainTools(async () => getJobDetails(world(), 'job-01')).find(tool => tool.name === 'get_job_details')!;
  await assert.rejects(execute(details, 'wrong-id', { jobId: 'job-04' }), /目标不一致/);
  const profile = createDomainTools(async () => ({
    version: 7, school: '虚构大学', major: '计算机', degree: '硕士', graduationMonth: '2027-06', skills: [], cities: [], targetRoles: [],
    email: 'unexpected-private@example.invalid',
  })).find(tool => tool.name === 'get_profile_summary')!;
  await assert.rejects(execute(profile, 'private-field', {}), /不符合工具约定/);
});

test('query, refresh and preview outcomes carry structured facts and preserve the UI confirmation boundary', async () => {
  const state = world();
  const tools = createDomainTools(async name => {
    if (name === 'query_jobs') return queryJobs(state, { recruitmentType: 'campus' });
    if (name === 'refresh_jobs') return { ...queryJobs(state, { recruitmentType: 'campus' }), sourceRun: {
      id: 'run-1', sourceId: 'tencent-campus', sourceName: '虚构校招来源', status: 'success', count: 7, observedAt: '2026-10-11T00:00:00Z',
    } };
    return { planId: 'plan-1', url: 'https://example.invalid/form', readyFields: ['姓名'], keptFields: ['邮箱'],
      unresolved: [{ label: '期望薪资', reason: '没有确认值' }], previewOnly: true, next: '请在本地界面查看并确认。' };
  });
  const result = await execute(tools.find(tool => tool.name === 'query_jobs')!, 'query', { recruitmentType: 'campus' });
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0]!.type === 'text' ? result.content[0]!.text : 'null'));
  await execute(tools.find(tool => tool.name === 'refresh_jobs')!, 'refresh', { sourceId: 'tencent-campus' });
  const preview = await execute(tools.find(tool => tool.name === 'prepare_form_preview')!, 'preview', {});
  assert.equal((preview.structuredContent as { previewOnly: boolean }).previewOnly, true);
  assert.deepEqual((preview.structuredContent as { keptFields: string[] }).keptFields, ['邮箱']);
});

test('the shared adapter honors SDK cancellation and does not misstate an already executed host action', async () => {
  const already = new AbortController();
  already.abort();
  let executions = 0;
  const first = createDomainTools(async () => { executions++; return { jobId: 'job-01', status: 'saved' }; }).find(tool => tool.name === 'add_to_tracker')!;
  await assert.rejects(execute(first, 'pre-cancelled', { jobId: 'job-01' }, already.signal), { name: 'AbortError' });
  assert.equal(executions, 0);
  const during = new AbortController();
  const second = createDomainTools(async (_name, _args, signal) => {
    assert.equal(signal, during.signal);
    executions++;
    during.abort();
    return { jobId: 'job-01', status: 'saved' };
  }).find(tool => tool.name === 'add_to_tracker')!;
  await assert.rejects(execute(second, 'host-settled-after-abort', { jobId: 'job-01' }, during.signal), { name: 'AbortError' });
  assert.equal(executions, 1, 'host facts remain the host responsibility; cancellation is not rollback');
  const fail = createDomainTools(async () => { throw new Error('fixture host failed'); }).find(tool => tool.name === 'list_applications')!;
  await assert.rejects(execute(fail, 'host-error', {}), /fixture host failed/);
});
