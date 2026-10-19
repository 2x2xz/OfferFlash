import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEWED_ASHBY_QUERY, REVIEWED_ASHBY_QUERY_TOKEN_SHA256,
  REVIEWED_ASHBY_ORGANIZATION_QUERY, REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256 } from '../apps/desktop/live-ashby-query.js';
import { evaluateLiveNetworkRequest, liveQueryTokenHash, type LiveNetworkRequest } from '../apps/desktop/live-network-policy.js';

const endpoint = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting';
const body = () => ({ operationName: 'ApiJobPosting', variables: {
  organizationHostedJobsPageName: 'oakslab', jobPostingId: '3fb1bab3-5182-4866-bc17-9b18199f4468',
}, query: REVIEWED_ASHBY_QUERY });
const request = (value: unknown = body()): LiveNetworkRequest => ({ url: endpoint, method: 'POST',
  uploadData: [{ bytes: Buffer.from(JSON.stringify(value)) }] });
const allowed = (value: LiveNetworkRequest, caseId = 'oakslab-ashby') => evaluateLiveNetworkRequest(value, caseId).allowed;

test('only the reviewed public Ashby form query is allowed as a POST in its isolated case', () => {
  assert.equal(liveQueryTokenHash(REVIEWED_ASHBY_QUERY), REVIEWED_ASHBY_QUERY_TOKEN_SHA256);
  assert.deepEqual(evaluateLiveNetworkRequest(request(), 'oakslab-ashby'), {
    allowed: true, reason: 'reviewed-ashby-query', ruleId: 'ashby-oakslab-api-job-posting-v1',
  });
  const reformatted = body(); reformatted.query = reformatted.query.replace(/\s+/gu, ' ').replace(/,/gu, '');
  assert.equal(allowed(request(reformatted)), true);
  assert.equal(allowed(request(), 'portcast-senior'), false);
  assert.equal(allowed({ ...request(), method: 'PUT' }), false);
  const bytes = Buffer.from(JSON.stringify(body()));
  assert.equal(allowed({ ...request(), uploadData: [{ bytes: bytes.subarray(0, 50) }, { bytes: bytes.subarray(50) }] }), true);
  // Electron 44 emits type: rawData in actual onBeforeRequest uploadData.
  assert.equal(allowed({ ...request(), uploadData: [{ type: 'rawData', bytes }] }), true);
  for (const type of ['file', 'blob', '', null, true, 'rawdata']) {
    assert.equal(allowed({ ...request(), uploadData: [{ type, bytes }] }), false);
  }
  assert.equal(allowed({ ...request(), uploadData: [{ type: 'rawData', bytes, file: 'fixture' }] }), false);
});

test('only the separately reviewed public organization query and route-specific search context are allowed', () => {
  assert.equal(liveQueryTokenHash(REVIEWED_ASHBY_ORGANIZATION_QUERY), REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256);
  const orgBody = { operationName: 'ApiOrganizationFromHostedJobsPageName', variables: {
    organizationHostedJobsPageName: 'oakslab', searchContext: 'JobPosting',
  }, query: REVIEWED_ASHBY_ORGANIZATION_QUERY };
  const orgRequest = (value: unknown = orgBody) => ({ ...request(value),
    url: endpoint.replace('op=ApiJobPosting', 'op=ApiOrganizationFromHostedJobsPageName') });
  assert.deepEqual(evaluateLiveNetworkRequest(orgRequest(), 'oakslab-ashby'), {
    allowed: true, reason: 'reviewed-ashby-query', ruleId: 'ashby-oakslab-api-organization-v1',
  });
  assert.equal(allowed({ ...orgRequest(), uploadData: [{ type: 'rawData', bytes: Buffer.from(JSON.stringify(orgBody)) }] }), true);
  for (const searchContext of [null, 'JobBoard', 'Other', true]) {
    assert.equal(allowed(orgRequest({ ...orgBody, variables: { ...orgBody.variables, searchContext } })), false);
  }
  assert.equal(allowed(orgRequest({ ...orgBody, variables: { ...orgBody.variables, extra: 'candidate' } })), false);
  assert.equal(allowed(orgRequest({ ...orgBody, query: orgBody.query.replace('query ', 'mutation ') })), false);
  assert.equal(allowed(orgRequest(body())), false);
  assert.equal(allowed(request(orgBody)), false);
  assert.equal(allowed(orgRequest(), 'portcast-senior'), false);
});

test('read-only POST requires exact endpoint, operation, variable names and public variable values', () => {
  for (const url of [endpoint + '&extra=1', endpoint + '#fragment', endpoint.replace('jobs.', 'app.'),
    endpoint.replace('/api/', '/unreviewed/'), endpoint.replace('https:', 'http:'),
    endpoint.replace('jobs.ashbyhq.com', 'jobs.ashbyhq.com.evil.invalid'),
    endpoint.replace('https://', 'https://user:password@')]) assert.equal(allowed({ ...request(), url }), false, url);
  for (const value of [
    { ...body(), operationName: 'ApiSubmitApplicationFormAction' },
    { ...body(), operationName: 'ApiJobPostingForApplicationRequest' },
    { ...body(), variables: { ...body().variables, jobPostingId: 'another-public-posting' } },
    { ...body(), variables: { ...body().variables, candidateEmail: 'test@example.invalid' } },
    { ...body(), variables: { ...body().variables, jobPostingId: null } },
    { ...body(), variables: { ...body().variables, organizationHostedJobsPageName: 'another-company' } },
    { ...body(), extensions: { persistedQuery: { sha256Hash: REVIEWED_ASHBY_QUERY_TOKEN_SHA256 } } },
  ]) assert.equal(allowed(request(value)), false);
});

test('operation-name spoofing, mutations and unreviewed query text are never accepted', () => {
  for (const query of [
    REVIEWED_ASHBY_QUERY.replace('query ApiJobPosting', 'mutation ApiJobPosting'),
    REVIEWED_ASHBY_QUERY + '\nmutation HiddenWrite { saveApplication { id } }',
    'query ApiJobPosting { submitApplication { id } }',
    REVIEWED_ASHBY_QUERY.replace('applicationForm', 'saveApplication'),
    REVIEWED_ASHBY_QUERY.replace('query ApiJobPosting', 'queryApiJobPosting'),
    REVIEWED_ASHBY_QUERY + '\n# unreviewed comment',
    REVIEWED_ASHBY_QUERY + '\n"ignored string"',
  ]) assert.equal(allowed(request({ ...body(), query })), false);
});

test('request envelopes reject batches, duplicate or escaped keys, malformed UTF-8 and file uploads', () => {
  for (const value of [[body()], null, 'request', { ...body(), extra: true }, { variables: body().variables, query: body().query }]) {
    assert.equal(allowed(request(value)), false);
  }
  const raw = JSON.stringify(body());
  for (const text of [
    raw.replace('{', '{"query":"mutation Spoof { save }",'),
    raw.replace('"jobPostingId":', '"jobPostingId":"other","jobPostingId":'),
    raw.replace('"query":', '"qu\\u0065ry":'),
    raw.replace('{', '{"qu\\u0065ry":"mutation Spoof { save }",'),
    raw + '{}', '{broken',
  ]) assert.equal(allowed({ ...request(), uploadData: [{ bytes: Buffer.from(text) }] }), false);
  for (const uploadData of [undefined, [], [{ file: '/private/tmp/fixture' }], [{ blobUUID: 'fixture' }],
    [{ bytes: Buffer.from(raw), file: '/private/tmp/fixture' }], [{ bytes: raw }],
    [{ bytes: new Uint8Array([0xff]) }], [{ bytes: Buffer.alloc(32_769) }],
    Array.from({ length: 5 }, () => ({ bytes: Buffer.from(' ') })),
  ]) assert.equal(allowed({ ...request(), uploadData }), false);
});

test('GET/HEAD retain synthetic-query and transport restrictions; all other writes remain blocked', () => {
  assert.equal(allowed({ url: 'https://example.invalid/public.js', method: 'GET' }), true);
  assert.equal(allowed({ url: 'https://example.invalid/public.js', method: 'HEAD' }), true);
  for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(allowed({ url: 'https://example.invalid/submit', method }), false);
  }
  for (const url of ['http://example.invalid/', 'ws://example.invalid/', 'wss://example.invalid/',
    'https://example.invalid/?value=offeragent-validation%40example.invalid',
    'https://example.invalid/?value=OfferAgent+Validation', 'https://example.invalid/?value=2025550100',
    'https://example.invalid/?value=%EF%FF', 'not a URL']) {
    assert.equal(allowed({ url, method: 'GET' }), false);
  }
});
