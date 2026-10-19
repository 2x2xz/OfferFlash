import test from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '../packages/shared/src/contracts.js';
import { validateCollectionReport } from '../packages/shared/src/source-collection.js';
import { buildDiscoveryPlan, discoverJobs as actualDiscoverJobs, discoveryOptions } from '../packages/sources/src/discovery.js';
import { defaultDiscoverySources, registerDiscoverySource, validateDiscoverySource } from '../packages/sources/src/discovery-catalog.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { queryDiscoveryJobs } from '../packages/agent/src/job-query.js';
import { createStore, type DomainStore } from '../packages/domain/src/store.js';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

// Existing foreign API fixtures explicitly cover all selected sources.
const discoverJobs: typeof actualDiscoverJobs = (profile, sources, input, dependencies) => actualDiscoverJobs(profile, sources, { region: 'all', ...input }, dependencies);

const profile = (): Profile => ({ ...createCareerFormFixtureProfile(), targetRoles: ['AI', '大模型'], skills: ['Python'], cities: [], resumeText: 'FICTIONAL_PRIVATE_RESUME_DO_NOT_SEND' });
const lever = () => registerDiscoverySource({ company: '虚构研究所', url: 'https://jobs.lever.co/fictional-lab' });
const ashby = () => registerDiscoverySource({ company: '虚构AI公司', url: 'https://jobs.ashbyhq.com/fictional.ai' });
const description = 'We build AI language models and reliable research systems. You will develop machine learning experiments, review algorithms and work with engineers on reliable data pipelines. Requirements: Python and machine learning knowledge.';
const leverPost = (id = 'role-one', extras: Record<string, unknown> = {}) => ({ id, text: 'AI Research Intern', hostedUrl: `https://jobs.lever.co/fictional-lab/${id}`,
  categories: { location: 'Hong Kong', commitment: 'Intern' }, descriptionPlain: description,
  lists: [{ text: 'Requirements', content: '<ul><li>Python and machine learning knowledge.</li></ul>' }], ...extras });
const ashbyPost = (id = 'role-one', extras: Record<string, unknown> = {}) => ({ title: 'AI Research Intern', jobUrl: `https://jobs.ashbyhq.com/fictional.ai/${id}`,
  isListed: true, employmentType: 'Intern', descriptionPlain: description, location: 'Hong Kong', publishedAt: '2026-10-01T00:00:00Z', ...extras });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const fetcher = (handle: (url: URL, init?: RequestInit) => Response | Promise<Response>) => (async (input: URL | RequestInfo, init?: RequestInit) => {
  const url = new URL(String(input)); assert.equal(url.protocol, 'https:'); assert.equal(init?.method, 'GET');
  assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.deepEqual(init?.headers, { accept: 'application/json' });
  return handle(url, init);
}) as typeof fetch;

test('discovery plan uses preferences and only the confirmed current default education, never contacts or resume text', () => {
  const value = profile(); const plan = buildDiscoveryPlan(value);
  assert.ok(plan.keywords.includes('LLM')); assert.ok(plan.keywords.includes('人工智能'));
  assert.equal(plan.profileVersion, value.version); assert.ok(!JSON.stringify(plan).includes(value.email));
  assert.ok(!JSON.stringify(plan).includes(value.fullName)); assert.ok(!JSON.stringify(plan).includes(value.resumeText));
  const chosen = value.career!.educations.find(item => item.id === value.career!.primaryEducationId)!;
  chosen.confirmation = 'pending'; value.degree = '不可采用的旧学历';
  assert.ok(!buildDiscoveryPlan(value).educationSummary.includes('不可采用'));
  assert.throws(() => buildDiscoveryPlan({ ...value, version: 0 }), /保存确认/);
});

test('default sources include three independently registered public AI boards and mark domestic browser entries as candidates', () => {
  const sources = defaultDiscoverySources(); assert.equal(sources.filter(source => ['lever', 'ashby'].includes(source.provider)).length, 3);
  assert.ok(sources.some(source => source.url === 'https://jobs.ashbyhq.com/mistral.ai'));
  assert.ok(sources.some(source => source.company === '字节跳动' && source.provider === 'candidate'));
  for (const source of sources) assert.deepEqual(validateDiscoverySource(source), source);
});

test('registration canonicalizes a posting link to its board and keeps unknown public websites inert', () => {
  assert.equal(registerDiscoverySource({ company: '虚构', url: 'https://jobs.lever.co/fictional-lab/role-one/apply' }).id, lever().id);
  assert.equal(registerDiscoverySource({ company: '虚构', url: 'https://careers.company.com/jobs' }).provider, 'candidate');
  assert.equal(ashby().url, 'https://jobs.ashbyhq.com/fictional.ai');
});

test('registration rejects private addresses, credentials, encoded paths and arbitrary API URLs cannot become active adapters', async () => {
  for (const url of ['http://jobs.lever.co/acme', 'https://127.0.0.1/jobs', 'https://[::1]/jobs', 'https://2130706433/jobs',
    'https://user:pass@jobs.lever.co/acme', 'https://jobs.lever.co:444/acme', 'https://jobs.lever.co/acme?token=secret',
    'https://corp.internal/jobs', 'https://localhost/jobs', 'https://jobs.lever.co/a%2fb', 'https://jobs.lever.co.evil.local/acme']) {
    assert.throws(() => registerDiscoverySource({ company: '虚构', url }));
  }
  let calls = 0;
  await assert.rejects(discoverJobs(profile(), [{ ...lever(), url: 'https://127.0.0.1/', provider: 'lever' }], {}, { fetch: fetcher(() => { calls++; return json([]); }) }));
  assert.equal(calls, 0);
});

test('discovery budgets reject malformed, excessive, unknown or duplicate source inputs before any network request', async () => {
  for (const options of [{ maxPages: 0 }, { detailLimit: 31 }, { maxSources: 9 }, { pageSize: '20' }, { unexpected: true }, { sourceIds: [1] }]) assert.throws(() => discoveryOptions(options as any));
  await assert.rejects(discoverJobs(profile(), [lever(), lever()]));
  await assert.rejects(discoverJobs(profile(), [lever()], { sourceIds: ['not-registered'] }));
});

test('Lever performs bounded real-shaped GET list/detail calls and binds complete JD evidence to a matching official posting', async () => {
  const post = leverPost(); const calls: URL[] = [];
  const result = await discoverJobs(profile(), [lever()], { pageSize: 2 }, { fetch: fetcher(url => { calls.push(url); return json(url.pathname.endsWith('/role-one') ? post : [post]); }) });
  assert.equal(calls.length, 2); assert.equal(calls[0]!.searchParams.get('limit'), '2');
  assert.ok(calls[1]!.pathname.endsWith('/role-one')); assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0]!.type, 'internship'); assert.equal(result.jobs[0]!.publishedAt, null);
  assert.ok(result.jobs[0]!.requirements.includes('Python')); assert.equal(result.matches[0]!.detailComplete, true);
  assert.equal(result.report.status, 'success');
  assert.equal(result.collections[0]!.result.report.scope.listURL, lever().url);
  validateCollectionReport(result.collections[0]!.result.report);
});

test('Ashby reads only isListed public postings, retains unknown eligibility and does not invent publication dates', async () => {
  const listed = ashbyPost('one', { title: 'AI Engineer', employmentType: 'FullTime' });
  const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [listed, ashbyPost('hidden', { isListed: false })] })) });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0]!.type, 'unknown'); assert.equal(result.matches[0]!.match.eligible, 'review');
  assert.equal(result.jobs[0]!.publishedAt, null); assert.equal(result.report.sources[0]!.officialTotal, 1);
  assert.equal(result.report.sources[0]!.pagesRequested, 1); assert.equal(result.report.sources[0]!.detailChecked, 1);
  validateCollectionReport(result.collections[0]!.result.report);
});

test('company AI boilerplate alone does not recommend HR or finance vacancies', async () => {
  const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [
    ashbyPost('finance', { title: 'Finance Associate', employmentType: 'FullTime' }), ashbyPost('research'),
  ] })) });
  assert.deepEqual(result.jobs.map(job => job.url), ['https://jobs.ashbyhq.com/fictional.ai/research']);
  assert.equal(result.report.sources[0]!.excludedCount, 1);
});

test('Senior stays experienced; it is excluded by default and only visible as unsuitable to campus goal when explicitly included', async () => {
  const request = fetcher(() => json({ apiVersion: '1', jobs: [ashbyPost('senior', { title: 'Senior AI Engineer', employmentType: 'FullTime' })] }));
  assert.equal((await discoverJobs(profile(), [ashby()], {}, { fetch: request })).jobs.length, 0);
  const result = await discoverJobs(profile(), [ashby()], { includeExperienced: true }, { fetch: request });
  assert.equal(result.jobs[0]!.type, 'experienced'); assert.equal(result.matches[0]!.match.eligible, 'unsuitable');
});

test('known city mismatches are excluded while unknown eligibility is retained for review', async () => {
  const value = profile(); value.cities = ['Hong Kong'];
  const result = await discoverJobs(value, [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [ashbyPost('city-a'), ashbyPost('city-b', { location: 'London' })] })) });
  assert.equal(result.jobs.length, 1); assert.equal(result.report.sources[0]!.excludedCount, 1);
});

test('detail budget and Ashby board processing limit produce explicit partial coverage', async () => {
  const result = await discoverJobs(profile(), [ashby()], { maxPages: 1, pageSize: 2, detailLimit: 1 }, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [ashbyPost('a'), ashbyPost('b'), ashbyPost('c')] })) });
  assert.equal(result.jobs.length, 1); assert.equal(result.report.status, 'partial');
  assert.equal(result.report.sources[0]!.entriesRead, 2); assert.equal(result.report.sources[0]!.detailChecked, 1);
  assert.ok(result.report.sources[0]!.unviewed.some(note => note.includes('3 条')));
  assert.ok(result.report.sources[0]!.unviewed.some(note => note.includes('正文核对预算')));
  validateCollectionReport(result.collections[0]!.result.report);
});

test('partial coverage with zero suitable candidates remains partial rather than being relabeled a failed request', async () => {
  const result = await discoverJobs(profile(), [ashby()], { maxPages: 1, pageSize: 1 }, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [
    ashbyPost('senior', { title: 'Senior AI Engineer', employmentType: 'FullTime' }), ashbyPost('later'),
  ] })) });
  assert.equal(result.jobs.length, 0); assert.equal(result.report.sources[0]!.status, 'partial');
  assert.equal(result.collections[0]!.result.report.status, 'partial');
  validateCollectionReport(result.collections[0]!.result.report);
});

test('Lever cannot claim complete coverage at a full page boundary or when the next page repeats IDs', async () => {
  const post = leverPost();
  const result = await discoverJobs(profile(), [lever()], { maxPages: 2, pageSize: 1 }, { fetch: fetcher(url => json(url.pathname.endsWith('/role-one') ? post : [post])) });
  assert.equal(result.report.status, 'partial'); assert.equal(result.jobs.length, 1);
  assert.ok(result.report.sources[0]!.warnings.some(note => note.includes('重复')));
  assert.equal(result.report.sources[0]!.pagesSucceeded, 2);
});

test('a later detail failure keeps an earlier independently checked JD and reports partial rather than discarding the prefix', async () => {
  const one = leverPost('one'), two = leverPost('two');
  const result = await discoverJobs(profile(), [lever()], { pageSize: 3 }, { fetch: fetcher(url => {
    if (url.pathname.endsWith('/one')) return json(one);
    if (url.pathname.endsWith('/two')) return new Response('', { status: 503 });
    return json([one, two]);
  }) });
  assert.equal(result.jobs.length, 1); assert.ok(result.jobs[0]!.url.endsWith('/one')); assert.equal(result.report.status, 'partial');
  validateCollectionReport(result.collections[0]!.result.report);
});

test('cancel after the first complete detail retains it and leaves later sources explicitly unviewed', async () => {
  const controller = new AbortController(); const post = leverPost();
  const request = fetcher(url => { if (url.pathname.endsWith('/role-one')) return json(post); if (url.searchParams.get('skip') === '1') controller.abort(); return json([post]); });
  const cancelled = await discoverJobs(profile(), [lever(), ashby()], { pageSize: 1, maxPages: 2 }, { fetch: request, signal: controller.signal });
  assert.equal(cancelled.report.status, 'cancelled'); assert.equal(cancelled.jobs.length, 1);
  assert.ok(cancelled.jobs[0]!.url.endsWith('/role-one')); validateCollectionReport(cancelled.collections[0]!.result.report);
  assert.ok(cancelled.report.unviewedSources.some(item => item.sourceId === ashby().id));
  let calls = 0; const preAborted = new AbortController(); preAborted.abort();
  const none = await discoverJobs(profile(), [lever()], {}, { signal: preAborted.signal, fetch: fetcher(() => { calls++; return json([]); }) });
  assert.equal(calls, 0); assert.equal(none.report.status, 'cancelled');
});

test('redirect responses, cross-board result URLs and detail ID substitutions cannot create imported evidence', async () => {
  for (const invalid of [ashbyPost('bad', { jobUrl: 'https://127.0.0.1/private' }), ashbyPost('bad', { jobUrl: 'https://jobs.ashbyhq.com/other-board/job' })]) {
    const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [invalid] })) });
    assert.equal(result.jobs.length, 0); assert.equal(result.collections[0]!.result.report.detailSucceeded, 0);
  }
  const redirected = json([]); Object.defineProperty(redirected, 'redirected', { value: true });
  assert.equal((await discoverJobs(profile(), [lever()], {}, { fetch: fetcher(() => redirected) })).report.status, 'failed');
  const result = await discoverJobs(profile(), [lever()], {}, { fetch: fetcher(url => json(url.pathname.endsWith('/role-one') ? leverPost('other') : [leverPost()])) });
  assert.equal(result.jobs.length, 0); assert.ok(result.report.sources[0]!.reason.includes('detail-id-mismatch'));
});

test('oversize, malformed and structurally invalid public responses are fixed failures without storing provider bodies', async () => {
  for (const response of [new Response('bad-json-secret'), json({ jobs: [] }), new Response('x', { headers: { 'content-length': String(5 * 1024 * 1024) } })]) {
    const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => response) });
    assert.equal(result.jobs.length, 0); assert.equal(result.report.status, 'failed'); assert.ok(!JSON.stringify(result).includes('bad-json-secret'));
    validateCollectionReport(result.collections[0]!.result.report);
  }
});

test('candidate, disabled, source-budget and unselected channels are explicitly unviewed and never fetched', async () => {
  const candidate = registerDiscoverySource({ company: '虚构企业', url: 'https://careers.company.com/jobs' });
  const result = await discoverJobs(profile(), [candidate, { ...lever(), enabled: false }, ashby()], { sourceIds: [candidate.id] }, { fetch: fetcher(() => { throw new Error('should not fetch'); }) });
  assert.equal(result.report.unviewedSources.length, 3); assert.equal(result.collections.length, 0);
  const bounded = await discoverJobs(profile(), [lever(), ashby()], { maxSources: 1 }, { fetch: fetcher(() => json([])) });
  assert.ok(bounded.report.unviewedSources.some(item => item.reason.includes('预算')));
});

test('Tencent experienced channel is never queried by default and keywords contain no contact or resume values', async () => {
  const source = defaultDiscoverySources().find(item => item.provider === 'tencent')!; let calls = 0;
  await discoverJobs(profile(), [source], {}, { collectTencent: async () => { calls++; throw new Error('never'); } }); assert.equal(calls, 0);
  const value = profile(); const requested: string[] = [];
  await discoverJobs(value, [source], { includeExperienced: true, maxPages: 2 }, { collectTencent: async options => {
    requested.push(options?.keyword ?? '');
    return { jobs: [], report: { schemaVersion: 1, status: 'success', query: { keyword: options?.keyword ?? '', pageSize: 20, maxPages: 1, detailLimit: 10 },
      scope: { mode: 'official-api-pages', listURL: 'https://careers.tencent.com/tencentcareer/api/post/Query', description: 'fictional' },
      pagesRequested: 1, pagesSucceeded: 1, officialTotal: 0, listedCount: 0, detailRequested: 0, detailSucceeded: 0, detailFailed: 0,
      stopReason: 'empty-page', errors: [], detailResults: [] } };
  } });
  assert.equal(requested.length, 2); assert.ok(!requested.join(' ').includes(value.email)); assert.ok(!requested.join(' ').includes(value.resumeText));
});

test('long company boilerplate and truncated summaries cannot become full detail evidence', async () => {
  for (const descriptionPlain of [
    'Our AI company builds language models for enterprises and offers exciting benefits to all employees in our global offices and local communities.',
    `${description} Read more…`,
    'You will build AI models and algorithms. We are an AI research team with exciting benefits and global offices for all of our employees.',
  ]) {
    const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [ashbyPost('incomplete', { descriptionPlain })] })) });
    assert.equal(result.jobs.length, 0); assert.equal(result.report.sources[0]!.detailComplete, 0);
    assert.equal(result.collections[0]!.result.report.detailSucceeded, 0);
  }
});

test('explicit cancellation releases a non-cooperative pending injected fetch without issuing another source request', async () => {
  const controller = new AbortController(); let started!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  const pending = discoverJobs(profile(), [lever(), ashby()], {}, { signal: controller.signal,
    fetch: fetcher(() => { started(); return new Promise<Response>(() => {}); }) });
  await arrived; controller.abort();
  const result = await pending;
  assert.equal(result.report.status, 'cancelled'); assert.equal(result.report.sources[0]!.requestURLs.length, 1);
  assert.equal(result.report.sources[1]!.pagesRequested, 0);
});

test('duplicates by original posting ID are not imported twice and repeated page coverage stays partial', async () => {
  const item = ashbyPost();
  const result = await discoverJobs(profile(), [ashby()], {}, { fetch: fetcher(() => json({ apiVersion: '1', jobs: [item, item] })) });
  assert.equal(result.jobs.length, 1); assert.equal(result.report.duplicateCount, 1);
  assert.equal(result.collections[0]!.result.report.detailResults!.length, 1);
});

async function withStore(work: (store: DomainStore, savedProfile: Profile, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-discovery-store-')); const store = await createStore({ directory });
  try {
    const { version, updatedAt, career, ...input } = profile();
    const state = await store.saveProfile(input, 0); await work(store, state.profile, directory);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
}
const bothSources = (value: Profile) => discoverJobs(value, [lever(), ashby()], {}, { fetch: fetcher(url => {
  if (url.hostname === 'api.ashbyhq.com') return json({ apiVersion: '1', jobs: [ashbyPost()] });
  return json(url.pathname.endsWith('/role-one') ? leverPost() : [leverPost()]);
}) });

test('discovery commits all source jobs, per-source evidence and whole report together; later-source conflicts roll back the earlier prefix', async () => withStore(async (store, value) => {
  const result = await bothSources(value); assert.equal(result.jobs.length, 2);
  await store.saveJob({ ...result.jobs[1]!, sourceId: 'manual-conflict', sourceName: '预先保存的虚构不同来源' });
  const before = await store.getState();
  await assert.rejects(store.importDiscoveryResult(result), /ID/);
  assert.deepEqual(await store.getState(), before);
  assert.equal((await store.discovery.getState()).runs.length, 0);
  assert.equal((await store.getState()).sourceRuns.length, 0);
}));

test('atomic discovery preserves a cancelled verified prefix and its cancelled whole-run report across reopening', async () => withStore(async (store, value, directory) => {
  const controller = new AbortController();
  const result = await discoverJobs(value, [lever(), ashby()], { maxPages: 2, pageSize: 1 }, { signal: controller.signal, fetch: fetcher(url => {
    if (url.pathname.endsWith('/role-one')) return json(leverPost());
    if (url.searchParams.get('skip') === '1') controller.abort();
    return json([leverPost()]);
  }) });
  assert.equal(result.report.status, 'cancelled'); assert.equal(result.jobs.length, 1);
  const state = await store.importDiscoveryResult(result);
  assert.equal(state.jobs.length, 1); assert.equal(state.sourceRuns.length, 1);
  assert.equal(state.sourceRuns[0]!.report!.stopReason, 'aborted'); assert.ok(state.jobs[0]!.detailEvidence);
  assert.equal((await store.discovery.getState()).runs[0]!.status, 'cancelled');
  await store.close(); const reopened = await createStore({ directory });
  try { assert.equal((await reopened.getState()).jobs.length, 1); assert.equal((await reopened.discovery.getState()).runs[0]!.id, result.report.id); }
  finally { await reopened.close(); }
}));

test('repeat discovery preserves firstSeen and existing application progress, and one report cannot be replayed', async () => withStore(async (store, value) => {
  const first = await bothSources(value); const saved = await store.importDiscoveryResult(first);
  await store.trackJob(saved.jobs[0]!.id); const application = (await store.getState()).applications[0]!;
  const { createdAt, updatedAt, demo, history, ...applicationInput } = application;
  await store.saveApplication({ ...applicationInput, status: 'interview', notes: '完全虚构的已有面试进度，必须保留' });
  const before = await store.getState(); const second = await bothSources(value);
  const after = await store.importDiscoveryResult(second);
  assert.equal(after.jobs.length, 2); assert.deepEqual(after.applications, before.applications);
  assert.deepEqual(after.profile, before.profile);
  for (const job of after.jobs) assert.equal(job.firstSeenAt, before.jobs.find(old => old.id === job.id)!.firstSeenAt);
  assert.equal(after.sourceRuns.reduce((count, run) => count + (run.report?.newCount ?? 0), 0), 2);
  await assert.rejects(store.importDiscoveryResult(second), /ID/);
  assert.equal((await store.discovery.getState()).runs.length, 2);
}));

test('stale profile versions and inconsistent complete-detail claims cannot commit any part of discovery', async () => withStore(async (store, value) => {
  const result = await bothSources(value); const inconsistent = structuredClone(result);
  inconsistent.matches[1]!.detailComplete = false;
  await assert.rejects(store.importDiscoveryResult(inconsistent), /不一致/);
  const { version, updatedAt, career, ...input } = profile(); await store.saveProfile(input, 1);
  await assert.rejects(store.importDiscoveryResult(result), /资料/);
  assert.equal((await store.getState()).jobs.length, 0); assert.equal((await store.getState()).sourceRuns.length, 0);
  assert.equal((await store.discovery.getState()).runs.length, 0);
}));

test('an existing whole-run report identity cannot be replaced or used to import another batch', async () => withStore(async (store, value) => {
  const result = await bothSources(value);
  await store.discovery.recordRun(result.report);
  const before = await store.getState();
  await assert.rejects(store.importDiscoveryResult(result), /ID/);
  assert.deepEqual(await store.getState(), before);
  const empty = await discoverJobs(value, [], {}); empty.report.id = randomUUID();
  await store.importDiscoveryResult(empty);
  assert.equal((await store.discovery.getState()).runs.length, 2);
}));

test('an actual SQLite failure on the final report write rolls back earlier source jobs and source reports', async () => withStore(async (store, value, directory) => {
  const result = await bothSources(value); const path = store.databasePath; await store.close();
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database(await readFile(path));
  try {
    db.run("CREATE TRIGGER reject_discovery_fixture BEFORE INSERT ON documents WHEN NEW.kind = 'discovery_run' BEGIN SELECT RAISE(ABORT, 'fixture final discovery write failed'); END");
    await writeFile(path, db.export(), { mode: 0o600 });
  } finally { db.close(); }
  const reopened = await createStore({ directory });
  try {
    const before = await reopened.getState();
    await assert.rejects(reopened.importDiscoveryResult(result), /fixture final discovery write failed/);
    assert.deepEqual(await reopened.getState(), before);
    assert.equal((await reopened.discovery.getState()).runs.length, 0);
  } finally { await reopened.close(); }
}));

test('chat discovery reports bind final deduplicated store IDs instead of losing an existing same-source URL candidate', async () => withStore(async (store, value) => {
  const result = await bothSources(value), first = result.jobs[0]!;
  await store.saveJob({ ...first, id: 'preexisting-same-source-url' });
  await store.importDiscoveryResult(result);
  const saved = (await store.getState()).jobs.find(job => job.sourceId === first.sourceId && job.url === first.url)!;
  assert.equal(saved.id, 'preexisting-same-source-url');
  const report = (await store.discovery.getState()).runs.find(run => run.id === result.report.id)!;
  assert.ok(report.sources.find(source => source.sourceId === first.sourceId)!.jobIds.includes(saved.id));
  assert.equal(report.uniqueJobs, result.jobs.length);
}));

test('default mainland guard rejects every foreign adapter before networking even with a larger source budget', async () => {
  let calls = 0;
  const result = await actualDiscoverJobs(profile(), [lever(), ashby()], { maxSources: 8 }, { fetch: fetcher(() => { calls++; return json([]); }) });
  assert.equal(calls, 0); assert.equal(result.jobs.length, 0);
  assert.ok(result.report.sources.every(source => source.status === 'skipped' && source.reason.includes('仅国内')));
  assert.equal(result.report.options.region, 'mainland');
});
test('foreign sources are only queried after an explicit overseas selection', async () => {
  let calls = 0;
  const result = await actualDiscoverJobs(profile(), [ashby()], { region: 'overseas' }, { fetch: fetcher(() => { calls++; return json({ apiVersion: '1', jobs: [ashbyPost()] }); }) });
  assert.equal(calls, 1); assert.equal(result.jobs.length, 1); assert.match(result.report.scopeNote, /明确选择的海外/);
  assert.throws(() => discoveryOptions({ region: 'anything' } as any));
});
test('default source catalog puts all three active domestic adapters ahead of opt-in foreign boards', () => {
  assert.deepEqual(defaultDiscoverySources().slice(0, 3).map(source => source.provider), ['tencent-campus', 'feishu', 'feishu']);
});


test('fresh chat candidates exclude another saved source sharing the same official URL', async () => withStore(async (store, value) => {
  const result = await bothSources(value); await store.importDiscoveryResult(result);
  const first = result.jobs[0]!;
  await store.saveJob({ ...first, id: 'manual-same-url', sourceId: 'manual-excel', sourceName: '虚构手动来源' });
  const state = await store.getState(), report = (await store.discovery.getState()).runs.find(run => run.id === result.report.id)!;
  const selected = queryDiscoveryJobs(state, report);
  assert.equal(selected.jobs.length, result.jobs.length);
  assert.ok(!selected.jobs.some(job => job.id === 'manual-same-url'));
  assert.ok(selected.jobs.every(job => report.sources.some(source => source.sourceId === job.sourceId && source.jobIds.includes(job.id))));
}));
