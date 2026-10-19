import test from 'node:test';
import assert from 'node:assert/strict';
import { MAINLAND_FEISHU_SOURCES, mainlandSourceForURL, mainlandCityEvidence, collectMainlandJobs } from '../packages/sources/src/mainland-discovery.js';
import { validateCollectionReport } from '../packages/shared/src/source-collection.js';
import { matchJob } from '../packages/domain/src/matching.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';

const source = () => structuredClone(MAINLAND_FEISHU_SOURCES[0]!);
const seed = () => source().seedJobIds[0]!;
const child = '9000000000000000001', grandchild = '9000000000000000002';
const row = (id: string, changes: Record<string, unknown> = {}) => ({ id, title: '虚构算法实习生',
  description: '参与虚构模型训练与离线评估，仅使用原创合成数据构建测试系统。',
  requirement: '2027届本科或硕士在读，掌握Python和机器学习基础，具有原创虚构项目经验。',
  recruit_type: { name: '实习', parent: { name: '校招' } }, city_list: [{ name: '北京', code: 'CT_11' }],
  job_subject: { name: { zh_cn: '2027届校园招聘' } }, channel_online_status: 1,
  publish_time: Date.UTC(2026, 8, 1), job_post_info: { expiry_time: 0 }, ...changes });
const response = (detail: unknown, recommendations: unknown[] = []) => new Response(JSON.stringify({ code: 0, data: { job_post_detail: detail, recommend_job_post_List: recommendations } }), { headers: { 'content-type': 'application/json' } });
const fetcher = (handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) => (async (input: URL | RequestInfo, init?: RequestInit) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://vrfi1sk8a0.jobs.feishu.cn'); assert.match(url.pathname, /^\/api\/v1\/job\/posts\/\d{15,22}$/);
  assert.equal(url.searchParams.get('with_recommend'), 'true'); assert.equal(url.searchParams.get('portal_type'), '6');
  assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.equal(init?.body, undefined);
  assert.deepEqual(Object.keys(init?.headers ?? {}).sort(), ['accept', 'accept-language', 'portal-channel', 'portal-platform', 'website-path']);
  return handler(url, init);
}) as typeof fetch;

test('two official source configurations carry public seed evidence and reject unreviewed tenants or apply URLs', () => {
  assert.equal(MAINLAND_FEISHU_SOURCES.length, 2);
  assert.equal(mainlandSourceForURL('https://modelbest.jobs.feishu.cn/campus/position')?.company, '面壁智能');
  assert.equal(mainlandSourceForURL('https://vrfi1sk8a0.jobs.feishu.cn/379481/')?.company, 'MiniMax');
  for (const url of ['http://modelbest.jobs.feishu.cn/campus', 'https://127.0.0.1/campus', 'https://other.jobs.feishu.cn/campus',
    'https://modelbest.jobs.feishu.cn/campus/resume/123/apply', 'https://user:pass@modelbest.jobs.feishu.cn/campus',
    'https://modelbest.jobs.feishu.cn/campus?token=secret']) assert.equal(mainlandSourceForURL(url), undefined);
  for (const known of MAINLAND_FEISHU_SOURCES) assert.ok(known.seedEvidenceURLs.some(url => url.includes(known.seedJobIds[0]!)));
});

test('source, seed and time-budget forgery is rejected before networking', async () => {
  let called = 0; const request = fetcher(() => { called++; return response(row(seed())); });
  for (const invalid of [{ ...source(), hostname: '127.0.0.1' }, { ...source(), seedJobIds: [child] }, { ...source(), websitePath: 'private' }]) {
    await assert.rejects(collectMainlandJobs(invalid, {}, request));
  }
  for (const options of [{ maxPages: 11 }, { pageSize: 51 }, { detailLimit: -1 }, { totalTimeoutMs: 10001 }, { keyword: 'a'.repeat(201) }]) await assert.rejects(collectMainlandJobs(source(), options, request));
  assert.equal(called, 0);
});

test('GET graph follows only returned numeric IDs and verifies their titles, complete JD and recruitment metadata', async () => {
  const calls: string[] = [];
  const result = await collectMainlandJobs(source(), { maxPages: 2, detailLimit: 2 }, fetcher(url => {
    calls.push(url.pathname);
    return url.pathname.endsWith(seed()) ? response(row(seed()), [{ id: child, title: '虚构新校招岗位' }])
      : response(row(child, { title: '虚构新校招岗位', recruit_type: { name: '正式', parent: { name: '校招' } } }));
  }));
  assert.equal(result.jobs.length, 2); assert.equal(result.metadata.requests, 2); assert.ok(calls[1]!.endsWith(child));
  assert.deepEqual(result.jobs.map(job => job.type), ['internship', 'campus']); assert.equal(result.report.detailSucceeded, 2);
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.officialTotal, null);
  assert.match(result.report.scope.description, /公开岗位与官方推荐链接范围/); assert.match(result.report.scope.description, /不代表关键词全列表/);
  assert.equal(result.metadata.seedEvidenceURLs.length, source().seedEvidenceURLs.length);
  validateCollectionReport(result.report);
});

test('local keyword reporting never sends profile terms, email or resume text to the official API', async () => {
  const privateMarker = 'fictional-resume-contact@example.invalid';
  const result = await collectMainlandJobs(source(), { keyword: privateMarker, maxPages: 1, detailLimit: 1 }, fetcher((url, init) => {
    assert.ok(!url.toString().includes(privateMarker)); assert.ok(!JSON.stringify(init?.headers).includes(privateMarker)); return response(row(seed()));
  }));
  assert.equal(result.report.query.keyword, privateMarker); assert.ok(result.metadata.requestURLs.every(url => !url.includes(privateMarker)));
});

test('mainland, Hong Kong/Macau/Taiwan, overseas and unknown cities remain distinct', () => {
  assert.deepEqual(mainlandCityEvidence({ city_list: [{ name: '深圳市' }, { name: '中国香港' }, { name: '台北' }, { name: '新加坡' }, { name: '旧金山' }, { name: '地点待定' }] }),
    { mainlandCities: ['深圳市'], otherCities: ['中国香港', '台北', '新加坡', '旧金山'], unknownCities: ['地点待定'] });
});

test('only overseas or unknown-location postings are not imported as mainland jobs', async () => {
  for (const cities of [['中国香港'], ['澳门'], ['台湾'], ['London'], ['地点待定'], []]) {
    const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { city_list: cities.map(name => ({ name })) }))));
    assert.equal(result.jobs.length, 0); assert.equal(result.metadata.excludedNonMainland, 1);
    assert.equal(result.report.detailRequested, 0); assert.equal(result.metadata.detailResponses, 1); validateCollectionReport(result.report);
  }
});

test('a mixed-city posting preserves original locations and records which are mainland without calling Hong Kong mainland', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { city_list: [{ name: '上海' }, { name: '中国香港' }] }))));
  assert.equal(result.jobs[0]!.city, '上海、中国香港'); assert.deepEqual(result.metadata.locationEvidence[0]!.mainlandCities, ['上海']);
  assert.deepEqual(result.metadata.locationEvidence[0]!.otherCities, ['中国香港']); assert.ok(result.metadata.classificationNotes.some(note => note.includes('不能把境外地点')));
});

test('unknown recruiting type is not promoted from a title and a social-hiring parent is excluded', async () => {
  const unknown = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { title: '虚构2027校招算法岗', recruit_type: undefined }))));
  assert.equal(unknown.jobs[0]!.type, 'unknown'); assert.ok(unknown.metadata.classificationNotes.some(note => note.includes('unknown')));
  const experienced = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { recruit_type: { name: '正式', parent: { name: '社招' } } }))));
  assert.equal(experienced.jobs.length, 0); assert.equal(experienced.metadata.excludedRecruitment, 1);
});

test('a 2026 campaign is retained as exact employer evidence and is rejected for a confirmed 2027 graduate', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), {
    recruit_type: { name: '正式', parent: { name: '校招' } }, job_subject: { name: { zh_cn: '2026校园招聘' } },
    requirement: '2026届硕士毕业，掌握Python和算法实现，有自然语言处理基础。',
  }))));
  assert.match(result.jobs[0]!.requirements, /2026校园招聘/);
  const profile = createCareerFormFixtureProfile(); profile.cities = []; profile.targetRoles = ['算法'];
  assert.equal(matchJob(profile, result.jobs[0]!).eligible, 'unsuitable');
});

test('only actual publish/expiry timestamps are mapped, missing or unsupported values remain null', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed()))));
  assert.equal(result.jobs[0]!.publishedAt, '2026-09-01T00:00:00.000Z'); assert.equal(result.jobs[0]!.deadline, null);
  const missing = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { publish_time: undefined, job_post_info: { expiry_time: '2027' } }))));
  assert.equal(missing.jobs[0]!.publishedAt, null); assert.equal(missing.jobs[0]!.deadline, null);
});

test('a recommendation preview is never accepted as complete JD before its own exact ID GET', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed()), [row(child)])));
  assert.equal(result.jobs.length, 1); assert.equal(result.report.detailSucceeded, 1);
  assert.ok(result.metadata.unvisitedJobIds.includes(child)); assert.ok(!result.report.detailResults!.some(item => item.jobURL.includes(child)));
});

test('missing requirement, hidden/offline channel and truncated text cannot acquire success detail evidence', async () => {
  for (const changes of [{ requirement: '' }, { description: '太短' }, { requirement: '这是需要人工继续读取的职位要求，当前正文还没有完整给出……' }]) {
    const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), changes))));
    assert.equal(result.report.detailSucceeded, 0); assert.equal(result.report.detailFailed, 1); assert.equal(result.report.detailResults![0]!.status, 'failed');
    validateCollectionReport(result.report);
  }
  const offline = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 1 }, fetcher(() => response(row(seed(), { channel_online_status: 0 }))));
  assert.equal(offline.jobs.length, 0);
});

test('request, page, detail and recommendation-row budgets bound the graph and always retain partial coverage', async () => {
  const zero = await collectMainlandJobs(source(), { detailLimit: 0 }, fetcher(() => { throw new Error('must not fetch'); }));
  assert.equal(zero.metadata.requests, 0); assert.equal(zero.report.status, 'partial'); validateCollectionReport(zero.report);
  const result = await collectMainlandJobs(source(), { maxPages: 5, detailLimit: 1, pageSize: 1 }, fetcher(() => response(row(seed()), [{ id: child, title: '甲' }, { id: grandchild, title: '乙' }])));
  assert.equal(result.metadata.requests, 1); assert.equal(result.metadata.recommendationCandidates, 1);
  assert.ok(result.metadata.unvisitedJobIds.includes(child)); assert.ok(!result.metadata.unvisitedJobIds.includes(grandchild));
});

test('duplicate recommendation IDs never repeat requests and invalid IDs cannot become arbitrary URLs', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 2, detailLimit: 2 }, fetcher(url => response(row(url.pathname.split('/').at(-1)!), [
    { id: seed(), title: '虚构算法实习生' }, { id: child, title: '虚构算法实习生' }, { id: child, title: '虚构算法实习生' },
    { id: 'http://127.0.0.1/private', title: '禁止' },
  ])));
  assert.equal(result.metadata.requests, 2); assert.equal(new Set(result.metadata.requestURLs).size, 2); assert.ok(result.metadata.duplicateCount >= 2);
  assert.ok(result.metadata.classificationNotes.some(note => note.includes('无法核对')));
});

test('a substituted detail ID or title stops the graph and preserves only the checked prefix', async () => {
  for (const changes of [{ id: grandchild }, { title: '替换后的岗位' }]) {
    const result = await collectMainlandJobs(source(), { maxPages: 2, detailLimit: 2 }, fetcher(url => url.pathname.endsWith(seed())
      ? response(row(seed()), [{ id: child, title: '虚构算法实习生' }]) : response(row(child, changes))));
    assert.equal(result.jobs.length, 1); assert.ok(result.report.errors.some(item => item.code === 'DETAIL_ID_MISMATCH')); validateCollectionReport(result.report);
  }
});

test('HTTP rejection, redirect and malformed payload fail once without cookie, signature or search-method retries', async () => {
  const redirected = response(row(seed())); Object.defineProperty(redirected, 'redirected', { value: true });
  for (const bad of [new Response('', { status: 405 }), redirected, new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }), new Response(JSON.stringify({ code: 401, data: {} }), { headers: { 'content-type': 'application/json' } })]) {
    let calls = 0; const result = await collectMainlandJobs(source(), {}, fetcher(() => { calls++; return bad; }));
    assert.equal(calls, 1); assert.equal(result.report.status, 'failed'); assert.equal(result.jobs.length, 0); validateCollectionReport(result.report);
  }
});

test('oversized response bodies are bounded before JSON parsing', async () => {
  const result = await collectMainlandJobs(source(), {}, fetcher(() => new Response('x', { headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) } })));
  assert.equal(result.report.status, 'failed'); assert.equal(result.metadata.requests, 1);
});

test('cancellation releases a pending request and atomically retains the previously checked prefix in the result', async () => {
  const controller = new AbortController(); let arrived!: () => void; const held = new Promise<void>(resolve => { arrived = resolve; });
  const pending = collectMainlandJobs(source(), { maxPages: 2, signal: controller.signal }, fetcher(url => {
    if (url.pathname.endsWith(seed())) return response(row(seed()), [{ id: child, title: '虚构算法实习生' }]);
    arrived(); return new Promise<Response>(() => {});
  }));
  await held; controller.abort(); const result = await pending;
  assert.equal(result.jobs.length, 1); assert.equal(result.metadata.requests, 2); assert.equal(result.report.stopReason, 'aborted'); validateCollectionReport(result.report);
  const stopped = new AbortController(); stopped.abort();
  const none = await collectMainlandJobs(source(), { signal: stopped.signal }, fetcher(() => { throw new Error('never'); }));
  assert.equal(none.metadata.requests, 0); assert.equal(none.report.errors[0]!.code, 'ABORTED');
});

test('one total deadline bounds all network requests and keeps a completed prefix on timeout', async () => {
  const result = await collectMainlandJobs(source(), { maxPages: 2, totalTimeoutMs: 30 }, fetcher(url => url.pathname.endsWith(seed())
    ? response(row(seed()), [{ id: child, title: '虚构算法实习生' }]) : new Promise<Response>(() => {})));
  assert.equal(result.jobs.length, 1); assert.equal(result.report.errors[0]!.code, 'TOTAL_TIMEOUT'); assert.equal(result.report.status, 'partial'); validateCollectionReport(result.report);
});

test('two graph layers allow several real detail GETs while deeper recommendation IDs remain unvisited', async () => {
  const tooDeep = '9000000000000000003'; const calls: string[] = [];
  const result = await collectMainlandJobs(source(), { maxPages: 2, detailLimit: 4 }, fetcher(url => {
    const id = url.pathname.split('/').at(-1)!; calls.push(id);
    return response(row(id), id === seed() ? [{ id: child, title: '虚构算法实习生' }, { id: grandchild, title: '虚构算法实习生' }]
      : id === child ? [{ id: tooDeep, title: '不可进入第三层' }] : []);
  }));
  assert.equal(result.metadata.requests, 4); assert.equal(result.report.pagesRequested, 2); assert.equal(result.report.pagesSucceeded, 2);
  assert.ok(calls.includes(child) && calls.includes(grandchild)); assert.ok(!calls.includes(tooDeep));
  assert.ok(result.metadata.unvisitedJobIds.includes(tooDeep)); assert.equal(result.metadata.graphDepthLimit, 2);
  assert.match(result.report.scope.description, /不是官网列表分页/); validateCollectionReport(result.report);
});

test('one graph layer reads public seeds only rather than treating it as one list page', async () => {
  const calls: string[] = [];
  const result = await collectMainlandJobs(source(), { maxPages: 1, detailLimit: 10 }, fetcher(url => {
    const id = url.pathname.split('/').at(-1)!; calls.push(id); return response(row(id), [{ id: child, title: '下一图层' }]);
  }));
  assert.deepEqual(calls, source().seedJobIds); assert.ok(!calls.includes(child)); assert.equal(result.report.pagesRequested, 1);
  assert.equal(result.metadata.requests, 3); assert.equal(result.report.status, 'partial'); validateCollectionReport(result.report);
});
