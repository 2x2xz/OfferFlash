import test from 'node:test';
import assert from 'node:assert/strict';
import { JobWebSearchClient, publicJobSearchInput, parsePublicJobSearch } from '../packages/agent/src/job-web-search.js';

const input = () => publicJobSearchInput(['大模型', '算法'], ['北京'], 'mainland');
const raw = (rows: unknown[]) => ({ output: { choices: [{ finish_reason: 'stop', message: { content: '虚构链接 https://fabricated.invalid/jobs/1' } }], search_info: { search_results: rows } }, usage: { total_tokens: 123 } });
const source = { title: '算法实习生招聘', url: 'https://careers.example.org/jobs/1' };

test('search uses provider citations, never assistant-generated job URLs or requirements', () => {
  const result = parsePublicJobSearch(raw([source, source]), input());
  assert.equal(result.length, 1); assert.equal(result[0]!.verification, 'search-source-only');
  assert.deepEqual(Object.keys(result[0]!).sort(), ['title', 'url', 'verification']);
  assert.throws(() => parsePublicJobSearch({ output: { choices: [{ message: { content: JSON.stringify([source]) } }] } }, input()));
});

test('source links reject credentials, private hosts, suspicious authentication parameters and explicit overseas hits', () => {
  const links = ['http://public.example.org/jobs', 'https://127.0.0.1/jobs', 'https://[::1]/jobs', 'https://localhost/jobs', 'https://svc.internal/jobs', 'https://user:pass@careers.example.org/jobs', 'https://careers.example.org/jobs?token=private', 'javascript:alert(1)'];
  assert.deepEqual(parsePublicJobSearch(raw(links.map(url => ({ ...source, url })).concat([{ ...source, title: 'AI jobs Singapore' }])), input()), []);
  assert.equal(parsePublicJobSearch(raw([{ ...source, title: '算法 jobs Singapore' }]), { ...input(), region: 'overseas' }).length, 1);
});

test('request projects only direction/cities, forces source-backed search and never follows redirects or retries', async () => {
  let calls = 0;
  const client = new JobWebSearchClient('fictional-test-credential', async (url, init) => {
    calls++; assert.equal(String(url), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation');
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body)); assert.equal(body.parameters.enable_search, true);
    assert.equal(body.parameters.search_options.forced_search, true); assert.equal(body.parameters.search_options.enable_source, true);
    const query = JSON.parse(body.input.messages[1].content); assert.deepEqual(Object.keys(query).sort(), ['cities', 'keywords', 'region']);
    assert.ok(!String(init?.body).includes('PRIVATE_CV')); assert.ok(!String(init?.body).includes('fictional-test-credential'));
    return Response.json(raw([source]));
  });
  const r = await client.search({ ...input(), resumeText: 'PRIVATE_CV' } as any);
  assert.equal(calls, 1); assert.equal(r.status, 'completed'); assert.equal(r.totalTokens, 123); assert.equal(r.leads.length, 1);
});

test('cancellation and closed provider make no search calls; HTTP errors expose no raw response or credential', async () => {
  let calls = 0; const client = new JobWebSearchClient('fictional-test-credential', async () => { calls++; return new Response('private server content', { status: 401 }); });
  const abort = new AbortController(); abort.abort(); assert.equal((await client.search(input(), abort.signal)).status, 'cancelled'); assert.equal(calls, 0);
  const r = await client.search(input()); assert.equal(r.status, 'failed'); assert.equal(calls, 1); assert.ok(!JSON.stringify(r).includes('private server content'));
  client.clear(); assert.equal((await client.search(input())).status, 'unavailable'); assert.equal(calls, 1);
});

test('no returned citations is distinct from a successful empty set; oversized responses are bounded', async () => {
  const a = new JobWebSearchClient('fixture', async () => Response.json({ output: { choices: [{ finish_reason: 'stop' }] } }));
  assert.equal((await a.search(input())).status, 'failed');
  const b = new JobWebSearchClient('fixture', async () => Response.json(raw([]))); assert.equal((await b.search(input())).status, 'completed');
  const c = new JobWebSearchClient('fixture', async () => new Response('x'.repeat(1_000_001))); assert.equal((await c.search(input())).status, 'failed');
});

test('query builder omits contact-looking strings and rejects empty search directions', () => {
  assert.deepEqual(publicJobSearchInput(['算法', 'private@example.invalid', '13800138000'], ['北京'], 'mainland').keywords, ['算法']);
  assert.throws(() => publicJobSearchInput([], ['北京'], 'mainland'));
});
test('search citations discard job-adjacent advice articles and unrelated recruiting titles', () => {
  const result = parsePublicJobSearch(raw([source,
    { title:'大模型算法岗位多吗',url:'https://aiqicha.baidu.com/details/rankList' },
    { title:'2027校招大模型方向建议',url:'https://blog.csdn.net/fictional/article/details/1' },
    { title:'百度校招会计招聘信息',url:'https://www.zhipin.com/zhaopin/fictional/' },
  ]),input()); assert.deepEqual(result.map(r=>r.url),[source.url]);
});
