import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTencentCampusJobs } from '../packages/sources/src/tencent-campus-discovery.js';
import { validateCollectionReport } from '../packages/shared/src/source-collection.js';

const response = (data: unknown, status = 200) => new Response(JSON.stringify({ status: 0, message: '', data }), { status });
const mapping = () => response([
  { recruitType: 1, status: 1, recruitRangDesc: '父级旧范围2025年至2026年', subProjectList: [{ mappingId: 1, recruitType: 1, projectId: '1', projectName: '2027校园招聘', recruitYear: '2027', status: 1, recruitRangDesc: '毕业时间：2026年1月1日-2027年12月31日' }] },
  { recruitType: 2, status: 1, recruitRangDesc: '在校生范围原文', subProjectList: [{ mappingId: 104, recruitType: 2, projectId: '4,12', projectName: '日常实习', recruitYear: '2026', status: 1, recruitRangDesc: '面向全体在校生，提供实习机会' }] },
]);
const post = (postId: string, extra: Record<string, unknown> = {}) => ({ postId, positionTitle: `虚构算法岗位${postId}`, projectId: 1, projectName: '应届毕业生', recruitLabelName: '应届毕业生', workCities: '深圳总部 北京', ...extra });
const detail = (postId: string, extra: Record<string, unknown> = {}) => ({ postId, title: `虚构算法岗位${postId}`, projectId: 1, projectName: '应届毕业生', recruitLabelName: '应届毕业生', recruitType: 1,
  desc: '负责原创虚构算法研发与模型评估。', request: '需要虚构的Python能力及硕士学历。', workCityList: ['深圳总部', '北京'], ...extra });
const list = (count: number, ids: string[]) => response({ count, positionList: ids.map(value => post(value)) });
function fixture(custom?: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    assert.equal(url.origin, 'https://join.qq.com'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert(init?.signal);
    if (url.pathname.endsWith('/getProjectMapping')) return mapping();
    if (custom) return custom(url, init);
    if (url.pathname.endsWith('/searchPosition')) return list(2, ['101', '102']);
    return response(detail(url.searchParams.get('postId')!));
  };
  return { fetch, requests };
}

test('campus collector binds list/details, uses domestic mapping POST and counts every auxiliary request', async () => {
  const { fetch, requests } = fixture();
  const result = await collectTencentCampusJobs({ keyword: '算法', pageSize: 2, maxPages: 2, detailLimit: 2 }, fetch);
  assert.equal(result.report.status, 'success'); assert.equal(result.report.stopReason, 'exhausted');
  assert.equal(result.report.pagesRequested, 1); assert.equal(result.report.detailSucceeded, 2); assert.equal(result.metadata.mappingRequests, 1);
  assert.equal(result.metadata.requestCount, 4); assert.equal(result.metadata.requestURLs.length, requests.length);
  const body = JSON.parse(requests.find(entry => entry.url.pathname.endsWith('searchPosition'))!.init!.body as string);
  assert.equal(body.workCountryType, 1); assert.equal(body.keyword, '算法'); assert.deepEqual(body.projectMappingIdList, [1, 104]);
  assert.deepEqual(body.projectIdList, []); assert.deepEqual(validateCollectionReport(result.report), result.report);
  for (const job of result.jobs) {
    assert.equal(job.company, '腾讯'); assert.equal(job.type, 'campus'); assert.equal(job.publishedAt, null); assert.equal(job.deadline, null);
    assert.match(job.description, /原创虚构算法研发/); assert.match(job.requirements, /毕业时间：2026年1月1日-2027年12月31日/);
    assert.doesNotMatch(job.requirements, /父级旧范围/); assert.equal(new URL(job.url).pathname, '/post_detail.html');
  }
  assert.equal(result.metadata.mappings[0]!.groupGraduationRange, '父级旧范围2025年至2026年');
  assert(result.metadata.totalIsObservedResponseCountNotVerifiedKeywordCoverage);
});

test('page budget retains verified detail prefix without claiming entire official list was read', async () => {
  const { fetch } = fixture((url) => url.pathname.endsWith('searchPosition') ? list(454, ['101', '102']) : response(detail(url.searchParams.get('postId')!)));
  const result = await collectTencentCampusJobs({ maxPages: 1, pageSize: 2, detailLimit: 1 }, fetch);
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'page-limit'); assert.equal(result.report.officialTotal, 454);
  assert.equal(result.jobs.length, 1); assert.equal(result.report.detailSucceeded, 1); assert.equal(result.metadata.requestCount, 3);
  assert.equal(result.metadata.unverifiedLeads.length, 1); assert.equal(result.metadata.cohortEvidence.length, 1); assert.equal(result.metadata.listedEntriesRead, 2);
});

test('later list failure preserves the earlier page and does not echo transport exceptions', async () => {
  const { fetch } = fixture((url, init) => {
    if (url.pathname.endsWith('searchPosition')) { if (JSON.parse(init!.body as string).pageIndex === 2) throw new Error('private transport header must not appear'); return list(5, ['101', '102']); }
    return response(detail(url.searchParams.get('postId')!));
  });
  const result = await collectTencentCampusJobs({ maxPages: 2, pageSize: 2, detailLimit: 0 }, fetch);
  assert.equal(result.jobs.length, 0); assert.equal(result.metadata.unverifiedLeads.length, 2); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'request-failed');
  assert.equal(result.report.pagesRequested, 2); assert.equal(result.report.pagesSucceeded, 1);
  assert.equal(JSON.stringify(result).includes('private transport header'), false);
});

test('a reordered repeated page stops and overlapping IDs keep the first verified candidate', async () => {
  const { fetch } = fixture((_url, init) => list(6, JSON.parse(init!.body as string).pageIndex === 1 ? ['101', '102'] : ['102', '101']));
  const result = await collectTencentCampusJobs({ pageSize: 2, maxPages: 3, detailLimit: 0 }, fetch);
  assert.equal(result.report.stopReason, 'repeated-page'); assert.equal(result.report.status, 'partial'); assert.equal(result.metadata.uniqueListedCount, 2); assert.equal(result.metadata.listedEntriesRead, 4);
  assert.equal(result.metadata.duplicateCount, 2);
  const overlap = fixture((_url, init) => list(3, JSON.parse(init!.body as string).pageIndex === 1 ? ['101', '102'] : ['102', '103']));
  const partial = await collectTencentCampusJobs({ pageSize: 2, maxPages: 2, detailLimit: 0 }, overlap.fetch);
  assert.equal(partial.metadata.uniqueListedCount, 3); assert.equal(partial.report.status, 'partial'); assert.equal(partial.metadata.duplicateCount, 1);
});

test('wrong detail ID or title and absent duties/requirements never acquire complete-detail status', async () => {
  for (const extra of [{ postId: '999' }, { title: '另一个岗位' }, { desc: '', topicDetail: '', introduction: '只有企业介绍' }, { request: '', topicRequirement: '' }, { projectId: 2 }]) {
    const { fetch } = fixture(url => url.pathname.endsWith('searchPosition') ? list(1, ['101']) : response(detail('101', extra)));
    const result = await collectTencentCampusJobs({ pageSize: 1, maxPages: 1, detailLimit: 1 }, fetch);
    assert.equal(result.report.status, 'partial'); assert.equal(result.report.detailSucceeded, 0); assert.equal(result.report.detailFailed, 1);
    assert.equal(result.jobs.length, 0); assert.equal(result.metadata.unverifiedLeads.length, 1); assert.equal(result.metadata.cohortEvidence.length, 0);
  }
});

test('only real returned postIds construct detail requests; response URLs are inert data', async () => {
  const { fetch, requests } = fixture(url => url.pathname.endsWith('searchPosition') ? response({ count: 1, positionList: [post('101', { positionUrl: 'http://127.0.0.1/private', id: 999999 })] }) : response(detail('101')));
  const result = await collectTencentCampusJobs({ pageSize: 1, maxPages: 1, detailLimit: 1 }, fetch);
  assert.equal(result.report.detailSucceeded, 1);
  assert.equal(requests.at(-1)!.url.href, 'https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId?postId=101');
  const malicious = fixture(() => response({ count: 1, positionList: [post('https://elsewhere.example/secret')] }));
  const rejected = await collectTencentCampusJobs({ pageSize: 1, maxPages: 1, detailLimit: 1 }, malicious.fetch);
  assert.equal(rejected.report.status, 'failed'); assert.equal(rejected.report.detailRequested, 0);
});

test('internship detail and exact batch/graduation wording remain distinct from graduate hiring', async () => {
  const { fetch } = fixture(url => url.pathname.endsWith('searchPosition') ? response({ count: 1, positionList: [post('201', { projectId: 4, projectName: '日常实习', recruitLabelName: '实习生' })] })
    : response(detail('201', { projectId: 4, projectName: '日常实习', recruitLabelName: '实习生', recruitType: 2 })));
  const result = await collectTencentCampusJobs({ pageSize: 1, maxPages: 1, detailLimit: 1 }, fetch);
  assert.equal(result.jobs[0]!.type, 'internship'); assert.match(result.jobs[0]!.requirements, /面向全体在校生，提供实习机会/);
  assert.equal(result.metadata.cohortEvidence[0]!.projectId, '4'); assert.deepEqual(result.metadata.cohortEvidence[0]!.mappingIds, [104]);
});

test('empty result is valid only when consistent with the actual response total', async () => {
  const empty = fixture(() => response({ count: 0, positionList: null }));
  const success = await collectTencentCampusJobs({ detailLimit: 0 }, empty.fetch); assert.equal(success.report.status, 'success'); assert.equal(success.jobs.length, 0);
  const early = fixture((_url, init) => JSON.parse(init!.body as string).pageIndex === 1 ? list(3, ['101']) : list(3, []));
  const partial = await collectTencentCampusJobs({ pageSize: 1, maxPages: 2, detailLimit: 0 }, early.fetch);
  assert.equal(partial.report.status, 'partial'); assert.equal(partial.report.stopReason, 'empty-page'); assert(partial.report.errors.some(error => error.code === 'EARLY_EMPTY'));
});

test('invalid or unavailable mapping fails before search instead of silently searching unfiltered channels', async () => {
  let calls = 0;
  const failed = await collectTencentCampusJobs({}, async () => { calls++; return new Response('Forbidden', { status: 403 }); });
  assert.equal(calls, 1); assert.equal(failed.report.status, 'failed'); assert.equal(failed.report.pagesRequested, 0); assert.equal(failed.metadata.mappingRequests, 1);
  assert(failed.report.errors.some(error => error.code === 'HTTP_403'));
  const malformed = await collectTencentCampusJobs({}, async () => response([{ recruitType: 1, subProjectList: [] }]));
  assert.equal(malformed.report.status, 'failed'); assert.equal(malformed.report.pagesRequested, 0);
});

test('cancelled before start does not send any network request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const result = await collectTencentCampusJobs({ signal: controller.signal }, async () => { calls++; return mapping(); });
  assert.equal(calls, 0); assert.equal(result.metadata.requestCount, 0); assert.equal(result.report.stopReason, 'aborted'); assert.equal(result.report.status, 'failed');
});

test('cancellation during detail retains list prefix and reports the attempted detail as unverified', async () => {
  const controller = new AbortController();
  const { fetch } = fixture(url => { if (url.pathname.endsWith('searchPosition')) return list(2, ['101', '102']); controller.abort(); return response(detail('101')); });
  const result = await collectTencentCampusJobs({ signal: controller.signal, pageSize: 2, detailLimit: 2 }, fetch);
  assert.equal(result.jobs.length, 0); assert.equal(result.metadata.unverifiedLeads.length, 2); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'aborted');
  assert.equal(result.report.detailRequested, 1); assert.equal(result.report.detailSucceeded, 0); assert.equal(result.report.detailFailed, 1);
});

test('one total deadline covers a provider which ignores cancellation, with no automatic retry', async () => {
  let calls = 0;
  const result = await collectTencentCampusJobs({ totalTimeoutMs: 15 }, async () => { calls++; return new Promise<Response>(() => {}); });
  assert.equal(calls, 1); assert.equal(result.report.status, 'failed'); assert.equal(result.report.stopReason, 'aborted');
  assert(result.report.errors.some(error => error.code === 'TOTAL_TIMEOUT'));
});

test('redirects and oversized bodies fail closed without following an alternate origin', async () => {
  const redirect = await collectTencentCampusJobs({}, async () => { const r = mapping(); Object.defineProperty(r, 'redirected', { value: true }); return r; });
  assert.equal(redirect.report.status, 'failed'); assert.equal(redirect.metadata.requestCount, 1);
  const oversized = await collectTencentCampusJobs({}, async () => new Response('{}', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }));
  assert.equal(oversized.report.status, 'failed'); assert(oversized.report.errors.some(error => error.code === 'BODY_LIMIT'));
});

test('invalid budgets and extra parameters are rejected before any provider call', async () => {
  let calls = 0; const fetch: typeof globalThis.fetch = async () => { calls++; return mapping(); };
  for (const options of [{ maxPages: 0 }, { maxPages: 11 }, { pageSize: 51 }, { detailLimit: 51 }, { totalTimeoutMs: 0 }, { url: 'https://elsewhere.example/' }]) await assert.rejects(collectTencentCampusJobs(options as never, fetch), TypeError);
  assert.equal(calls, 0);
});

test('pure SAR/overseas or unknown cities are not mainland candidates, while mixed locations retain their original wording', async () => {
  for (const cities of [['香港', '新加坡'], ['未知地点'], []]) {
    const { fetch } = fixture(url => url.pathname.endsWith('searchPosition') ? list(1, ['101']) : response(detail('101', { workCityList: cities })));
    const result = await collectTencentCampusJobs({ maxPages: 1, pageSize: 1, detailLimit: 1 }, fetch);
    assert.equal(result.report.detailSucceeded, 1); assert.equal(result.jobs.length, 0); assert.equal(result.metadata.excludedNonMainland, 1);
    assert.equal(result.metadata.uniqueListedCount, 1); assert.equal(result.metadata.listedEntriesRead, 1);
  }
  const mixed = fixture(url => url.pathname.endsWith('searchPosition') ? list(1, ['101']) : response(detail('101', { workCityList: ['深圳总部', '香港', '未确认城市'] })));
  const result = await collectTencentCampusJobs({ maxPages: 1, pageSize: 1, detailLimit: 1 }, mixed.fetch);
  assert.equal(result.jobs[0]!.city, '深圳总部 / 香港 / 未确认城市');
  assert.deepEqual(result.metadata.locationEvidence[0]!.mainlandCities, ['深圳']);
  assert.deepEqual(result.metadata.locationEvidence[0]!.otherCities, ['香港']);
  assert.deepEqual(result.metadata.locationEvidence[0]!.unknownCities, ['未确认城市']);
});
