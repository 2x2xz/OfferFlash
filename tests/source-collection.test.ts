import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTencentJobs, fetchTencentJobs } from '../packages/sources/src/catalog.js';
import { validateCollectionReport } from '../packages/shared/src/source-collection.js';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  PostId: id, RecruitPostName: `虚构算法岗位 ${id}`, LocationName: '虚构城市', Responsibility: `列表职责 ${id}`,
  RequireWorkYearsName: '三年以上工作经验', LastUpdateTime: '2026年09月15日',
  PostURL: `http://careers.tencent.com/jobdesc.html?postId=${id}`, ...extra,
});
const response = (Data: unknown, status = 200) => new Response(JSON.stringify({ Code: 200, Data }), { status });
const list = (Count: unknown, ids: string[]) => response({ Count, Posts: ids.map(id => item(id)) });
const requested = (input: RequestInfo | URL) => new URL(String(input));

test('official pagination visits each page, deduplicates by ID and preserves experienced/update-date meaning', async () => {
  const urls: URL[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = requested(input); urls.push(url);
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    if (url.pathname.endsWith('/ByPostId')) return response(item(url.searchParams.get('postId')!, { Requirement: '详情要求：虚构的 Python 能力' }));
    assert.equal(url.searchParams.get('keyword'), '算法'); assert.equal(url.searchParams.get('pageSize'), '2');
    return list(3, url.searchParams.get('pageIndex') === '1' ? ['101', '102'] : ['103']);
  };
  const result = await collectTencentJobs({ keyword: ' 算法 ', pageSize: 2, maxPages: 3, detailLimit: 3 }, fake);
  assert.equal(result.report.status, 'success'); assert.equal(result.report.stopReason, 'exhausted');
  assert.equal(result.report.pagesRequested, 2); assert.equal(result.report.pagesSucceeded, 2); assert.equal(result.report.officialTotal, 3);
  assert.equal(result.report.detailRequested, 3); assert.equal(result.report.detailSucceeded, 3); assert.equal(result.report.detailFailed, 0);
  assert.deepEqual(result.report.detailResults?.map(detail => detail.status), ['success', 'success', 'success']);
  assert.deepEqual(new Set(result.report.detailResults?.map(detail => detail.jobURL)), new Set(result.jobs.map(job => job.url)));
  assert.deepEqual(validateCollectionReport(result.report), result.report);
  assert.deepEqual(result.jobs.map(job => job.id), ['tencent-101', 'tencent-102', 'tencent-103']);
  for (const job of result.jobs) {
    assert.equal(job.type, 'experienced'); assert.equal(job.publishedAt, null); assert.equal(job.deadline, null);
    assert.match(job.description, /更新时间.*不是发布日期/); assert.match(job.requirements, /详情要求/);
    assert.equal(new URL(job.url).origin, 'https://careers.tencent.com');
  }
  assert.ok(urls.every(url => url.origin === 'https://careers.tencent.com'));
});

test('reaching a page budget reports partial scope and does not pretend to have visited the whole official list', async () => {
  const result = await collectTencentJobs({ pageSize: 2, maxPages: 1, detailLimit: 0 }, async () => list(12, ['201', '202']));
  assert.equal(result.jobs.length, 2); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'page-limit');
  assert.equal(result.report.officialTotal, 12); assert.equal(result.report.pagesRequested, 1); assert.equal(result.report.detailRequested, 0);
  assert.deepEqual(result.report.query, { keyword: '', pageSize: 2, maxPages: 1, detailLimit: 0 });
  assert.match(result.report.scope.description, /未请求的详情/);
});

test('a later network failure retains an earlier page and records the failed page number', async () => {
  const fake: typeof fetch = async input => {
    if (requested(input).searchParams.get('pageIndex') === '2') throw new Error('虚构连接中断');
    return list(6, ['301', '302']);
  };
  const result = await collectTencentJobs({ pageSize: 2, detailLimit: 0 }, fake);
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'request-failed');
  assert.equal(result.jobs.length, 2); assert.equal(result.report.pagesRequested, 2); assert.equal(result.report.pagesSucceeded, 1);
  assert.deepEqual(result.report.errors[0], { stage: 'list', pageIndex: 2, code: 'REQUEST_FAILED', message: '虚构连接中断' });
});

test('a repeated page stops safely even if the server reorders its IDs', async () => {
  const result = await collectTencentJobs({ pageSize: 2, detailLimit: 0 }, async input => list(8, requested(input).searchParams.get('pageIndex') === '1' ? ['401', '402'] : ['402', '401']));
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'repeated-page');
  assert.equal(result.jobs.length, 2); assert.equal(result.report.pagesRequested, 2);
  assert.equal(result.report.errors[0]?.code, 'REPEATED_PAGE');
});

test('overlapping page IDs keep the first candidate and expose imperfect list coverage', async () => {
  const result = await collectTencentJobs({ pageSize: 2, maxPages: 3, detailLimit: 0 }, async input => {
    const index = requested(input).searchParams.get('pageIndex');
    return index === '1' ? list(3, ['501', '502']) : response({ Count: 3, Posts: [item('502', { Responsibility: '重复页的不同文字' }), item('503')] });
  });
  assert.equal(result.jobs.length, 3); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'exhausted');
  assert.equal(result.jobs[1]?.description.startsWith('列表职责 502'), true); assert.equal(result.report.errors[0]?.code, 'DUPLICATE_ID');
});

test('a page with only already seen IDs stops as no-new-items', async () => {
  const result = await collectTencentJobs({ pageSize: 2, detailLimit: 0 }, async input => list(8, requested(input).searchParams.get('pageIndex') === '1' ? ['601', '602'] : ['601']));
  assert.equal(result.report.stopReason, 'no-new-items'); assert.equal(result.report.status, 'partial'); assert.equal(result.jobs.length, 2);
});

test('official zero results succeed, while an early empty page cannot prove complete coverage', async () => {
  const empty = await collectTencentJobs({}, async () => list(0, []));
  assert.equal(empty.report.status, 'success'); assert.equal(empty.report.officialTotal, 0); assert.equal(empty.jobs.length, 0);
  const early = await collectTencentJobs({ pageSize: 1, detailLimit: 0 }, async input => list(3, requested(input).searchParams.get('pageIndex') === '1' ? ['701'] : []));
  assert.equal(early.report.status, 'partial'); assert.equal(early.report.stopReason, 'empty-page'); assert.equal(early.jobs.length, 1);
  assert.equal(early.report.errors[0]?.code, 'EARLY_EMPTY_PAGE');
});

test('missing, fractional, conflicting or malformed official counters and posts are rejected without guessed data', async () => {
  const values = [
    { Posts: [item('801')] }, { Count: '1', Posts: [item('801')] }, { Count: 1.5, Posts: [] },
    { Count: 1, Total: 2, Posts: [item('801')] }, { Count: 0, Posts: [item('801')] },
    { Count: 1, Posts: {} }, { Count: 1, Posts: [item('801', { RecruitPostName: '' })] },
    { Count: 1, Posts: [item('801', { PostId: 'https://external.invalid' })] },
    { Count: 1, Posts: [item('801', { Responsibility: 3 })] },
  ];
  for (const value of values) {
    const result = await collectTencentJobs({ detailLimit: 0 }, async () => response(value));
    assert.equal(result.report.status, 'failed', JSON.stringify(value)); assert.equal(result.report.stopReason, 'invalid-response');
    assert.equal(result.jobs.length, 0); assert.equal(result.report.pagesSucceeded, 0);
  }
  const compatible = await collectTencentJobs({ detailLimit: 0 }, async () => response({ Total: 1, Posts: [item('802')] }));
  assert.equal(compatible.report.status, 'success'); assert.equal(compatible.report.officialTotal, 1);
});

test('a malformed later page preserves validated previous jobs', async () => {
  const result = await collectTencentJobs({ pageSize: 1, detailLimit: 0 }, async input => requested(input).searchParams.get('pageIndex') === '1' ? list(4, ['901']) : response({ Count: 4, Posts: [item('902'), item('903')] }));
  assert.equal(result.jobs.length, 1); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'invalid-response');
  assert.equal(result.report.errors[0]?.pageIndex, 2);
});

test('list totals changing between pages remain visible and invalidate a stable complete-coverage claim', async () => {
  const result = await collectTencentJobs({ pageSize: 1, detailLimit: 0 }, async input => requested(input).searchParams.get('pageIndex') === '1' ? list(3, ['1001']) : list(2, ['1002']));
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.officialTotal, 2); assert.equal(result.jobs.length, 2);
  assert.equal(result.report.errors[0]?.code, 'TOTAL_CHANGED');
});

test('a failed or mismatched detail keeps the list candidate and never adopts another job requirements', async () => {
  const result = await collectTencentJobs({ pageSize: 2, detailLimit: 2 }, async input => {
    const url = requested(input);
    if (url.pathname.endsWith('/Query')) return list(2, ['1101', '1102']);
    if (url.searchParams.get('postId') === '1101') return response(item('99999', { Requirement: '不属于目标岗位的文字' }));
    return response({}, 503);
  });
  assert.equal(result.report.status, 'partial'); assert.equal(result.jobs.length, 2);
  assert.equal(result.report.detailRequested, 2); assert.equal(result.report.detailSucceeded, 0); assert.equal(result.report.detailFailed, 2);
  assert.deepEqual(result.report.detailResults?.map(detail => detail.status), ['failed', 'failed']);
  assert.deepEqual(new Set(result.report.detailResults?.map(detail => detail.jobURL)), new Set(result.jobs.map(job => job.url)));
  assert.deepEqual(validateCollectionReport(result.report), result.report);
  assert.equal(result.report.errors.some(error => error.code === 'DETAIL_ID_MISMATCH' && error.jobId === 'tencent-1101'), true);
  assert.equal(result.report.errors.some(error => error.code === 'HTTP_ERROR' && error.jobId === 'tencent-1102'), true);
  assert.ok(result.jobs.every(job => !job.requirements.includes('不属于')));
});

test('detail budgets and a maximum of four concurrent detail requests are enforced', async () => {
  let active = 0, peak = 0, completed = 0;
  const result = await collectTencentJobs({ pageSize: 10, detailLimit: 5 }, async input => {
    const url = requested(input);
    if (url.pathname.endsWith('/Query')) return list(10, Array.from({ length: 10 }, (_, index) => String(1201 + index)));
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--; completed++;
    return response(item(url.searchParams.get('postId')!, { Requirement: '已取得详情' }));
  });
  assert.equal(result.jobs.length, 10); assert.equal(completed, 5); assert.equal(peak, 4); assert.equal(result.report.detailRequested, 5);
  assert.equal(result.jobs.filter(job => job.requirements.includes('已取得详情')).length, 5);
  assert.equal(result.report.detailResults?.length, 5);
  assert.deepEqual(new Set(result.report.detailResults?.map(detail => detail.jobURL)), new Set(result.jobs.slice(0, 5).map(job => job.url)));
  assert.deepEqual(validateCollectionReport(result.report), result.report);
  assert.match(result.report.scope.description, /详情最多 5 条/);
});

test('a detail lacking explicit responsibility or requirements is not marked complete; explicit empty fields remain distinct', async () => {
  const invalidDetails = [
    { PostId: '1251', RecruitPostName: '虚构算法岗位 1251', Responsibility: '详情职责' },
    { PostId: '1251', RecruitPostName: '虚构算法岗位 1251', Requirement: '详情要求' },
    { PostId: '1251', RecruitPostName: '虚构算法岗位 1251', Responsibility: '详情职责', Requirement: null },
  ];
  for (const detail of invalidDetails) {
    const result = await collectTencentJobs({ pageSize: 1, detailLimit: 1 }, async input => requested(input).pathname.endsWith('/Query') ? list(1, ['1251']) : response(detail));
    assert.equal(result.report.status, 'partial'); assert.equal(result.report.detailSucceeded, 0); assert.equal(result.report.detailFailed, 1);
    assert.equal(result.report.errors[0]?.code, 'INVALID_DETAIL');
    assert.deepEqual(result.report.detailResults, [{ jobURL: result.jobs[0]!.url, status: 'failed' }]);
    assert.match(result.jobs[0]!.description, /列表职责/); assert.deepEqual(validateCollectionReport(result.report), result.report);
  }
  const empty = await collectTencentJobs({ pageSize: 1, detailLimit: 1 }, async input => requested(input).pathname.endsWith('/Query') ? list(1, ['1252']) : response(item('1252', { Responsibility: '', Requirement: '' })));
  assert.equal(empty.report.status, 'success'); assert.equal(empty.report.detailSucceeded, 1);
  assert.equal(empty.report.detailResults?.[0]?.status, 'success'); assert.doesNotMatch(empty.jobs[0]!.description, /列表职责/);
});

test('injected redirect responses and untrusted site-provided URLs never become detail fetch destinations', async () => {
  for (const url of ['https://external.invalid/jobdesc.html?postId=1301', 'https://careers.tencent.com/jobdesc.html?postId=999', 'https://careers.tencent.com@external.invalid/jobdesc.html?postId=1301']) {
    let calls = 0;
    const result = await collectTencentJobs({}, async () => { calls++; return response({ Count: 1, Posts: [item('1301', { PostURL: url })] }); });
    assert.equal(result.report.status, 'failed'); assert.equal(result.report.errors[0]?.code, 'INVALID_POST_URL'); assert.equal(calls, 1);
  }
  const result = await collectTencentJobs({}, async () => {
    const value = list(1, ['1302']); Object.defineProperty(value, 'url', { value: 'https://external.invalid/list' }); return value;
  });
  assert.equal(result.report.status, 'failed'); assert.equal(result.report.errors[0]?.code, 'UNSAFE_REDIRECT');
});

test('cancelling before a request or between pages stops promptly and preserves earlier collected jobs', async () => {
  const before = new AbortController(); before.abort();
  const empty = await collectTencentJobs({ signal: before.signal }, async () => { throw new Error('必须不请求'); });
  assert.equal(empty.report.status, 'failed'); assert.equal(empty.report.stopReason, 'aborted'); assert.equal(empty.report.pagesRequested, 0);
  const during = new AbortController();
  const result = await collectTencentJobs({ pageSize: 1, signal: during.signal }, async input => {
    if (requested(input).searchParams.get('pageIndex') === '2') { during.abort(); return list(3, ['1402']); }
    return list(3, ['1401']);
  });
  assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'aborted');
  assert.deepEqual(result.jobs.map(job => job.id), ['tencent-1401']); assert.equal(result.report.detailRequested, 0);
});

test('cancelling during details retains list data and never starts the remaining detail requests', async () => {
  const controller = new AbortController(); let details = 0;
  const result = await collectTencentJobs({ pageSize: 3, detailLimit: 3, signal: controller.signal }, async input => {
    const url = requested(input);
    if (url.pathname.endsWith('/Query')) return list(3, ['1501', '1502', '1503']);
    details++; controller.abort(); throw new Error('虚构取消');
  });
  assert.equal(result.jobs.length, 3); assert.equal(result.report.status, 'partial'); assert.equal(result.report.stopReason, 'aborted');
  assert.equal(details, 1); assert.equal(result.report.detailFailed, 1);
  assert.deepEqual(result.report.detailResults, [{ jobURL: result.jobs[0]!.url, status: 'failed' }]);
  assert.deepEqual(validateCollectionReport(result.report), result.report);
});

test('invalid budgets fail before network access and the old one-page function remains compatible', async () => {
  const invalid = [{ maxPages: 11 }, { maxPages: 0 }, { pageSize: 51 }, { pageSize: 1.5 }, { detailLimit: 51 }, { detailLimit: -1 }, { keyword: 'x'.repeat(201) }];
  for (const options of invalid) await assert.rejects(collectTencentJobs(options, async () => { throw new Error('必须不请求'); }), TypeError);
  const legacy = await fetchTencentJobs('算法', async () => response({ Posts: [item('1601')] }));
  assert.equal(legacy[0]?.id, 'tencent-1601'); assert.equal(legacy[0]?.publishedAt, null); assert.equal(legacy[0]?.type, 'experienced');
});

test('invalid JSON and oversized response streams fail without accepting an unbounded body', async () => {
  const malformed = await collectTencentJobs({}, async () => new Response('<html>虚构错误页</html>'));
  assert.equal(malformed.report.status, 'failed'); assert.equal(malformed.report.errors[0]?.code, 'INVALID_RESPONSE');
  let reads = 0, cancelled = false;
  const oversized = await collectTencentJobs({}, async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })));
  assert.equal(oversized.report.status, 'failed'); assert.equal(oversized.report.errors[0]?.code, 'INVALID_RESPONSE');
  assert.ok(reads <= 10, 'do not drain an unbounded response'); assert.equal(cancelled, true);
});
