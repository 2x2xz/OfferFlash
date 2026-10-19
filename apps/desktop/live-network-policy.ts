import { createHash } from 'node:crypto';
import { REVIEWED_ASHBY_QUERY, REVIEWED_ASHBY_QUERY_TOKEN_SHA256,
  REVIEWED_ASHBY_ORGANIZATION_QUERY, REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256 } from './live-ashby-query.js';
import { LIVE_CONTACT_VALUES } from './live-product-targets.js';

/** Test-only network policy. The ordinary browser session never installs this. */
export interface LiveNetworkRequest { url: string; method: string; uploadData?: unknown }
export type LiveNetworkDecision = {
  allowed: boolean;
  reason: 'read-method' | 'reviewed-ashby-query' | 'nonread-method' | 'invalid-url'
    | 'insecure-url' | 'test-value-query' | 'unapproved-read-query';
  ruleId?: 'ashby-oakslab-api-job-posting-v1' | 'ashby-oakslab-api-organization-v1';
};
const MAX_BODY_BYTES = 32_768;

// The reviewed query has names, punctuation and variable references only. We
// accept layout changes, but reject comments, strings, numbers and any extra
// tokens. Joining tokens preserves boundaries ("query Name" != "queryName").
export function liveQueryTokenHash(query: string): string | undefined {
  if (query.length > MAX_BODY_BYTES) return undefined;
  const tokens = query.match(/\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[!$():=@\[\]{|}]|[\s,]+|./gu);
  if (!tokens) return undefined;
  const normalized: string[] = [];
  for (const token of tokens) {
    if (/^[\s,]+$/u.test(token)) continue;
    if (!/^(?:\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[!$():=@\[\]{|}])$/u.test(token)) return undefined;
    normalized.push(token);
  }
  return createHash('sha256').update(normalized.join(' ')).digest('hex');
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function bodyBytes(uploadData: unknown): Buffer | undefined {
  if (!Array.isArray(uploadData) || uploadData.length < 1 || uploadData.length > 4) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for (const entry of uploadData) {
    if (!object(entry) || !(exactKeys(entry, ['bytes'])
      || exactKeys(entry, ['type', 'bytes']) && entry.type === 'rawData')
      || !(entry.bytes instanceof Uint8Array)) return undefined;
    size += entry.bytes.byteLength;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(Buffer.from(entry.bytes));
  }
  return size ? Buffer.concat(chunks) : undefined;
}

// JSON.parse otherwise accepts duplicate keys, whose interpretation can differ
// between servers. All five permitted keys must occur once, literally. This
// scanner reads strings only; it never evaluates a request or GraphQL document.
function canonicalUniqueKeys(text: string): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '"') continue;
    const start = index++;
    for (; index < text.length; index++) {
      if (text[index] === '\\') { index++; continue; }
      if (text[index] === '"') break;
    }
    if (index >= text.length) return false;
    let next = index + 1;
    while (/\s/u.test(text[next] ?? '') && next < text.length) next++;
    if (text[next] !== ':') continue;
    const raw = text.slice(start, index + 1);
    let key: unknown;
    try { key = JSON.parse(raw); } catch { return false; }
    if (typeof key !== 'string' || raw !== JSON.stringify(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return seen.size === 5;
}

function approvedAshbyRead(request: LiveNetworkRequest, url: URL, caseId: string): LiveNetworkDecision['ruleId'] {
  if (caseId !== 'oakslab-ashby' || request.method.toUpperCase() !== 'POST'
    || url.origin !== 'https://jobs.ashbyhq.com' || url.pathname !== '/api/non-user-graphql'
    || url.username || url.password || url.hash) return undefined;
  const operation = url.search === '?op=ApiJobPosting' ? 'ApiJobPosting'
    : url.search === '?op=ApiOrganizationFromHostedJobsPageName' ? 'ApiOrganizationFromHostedJobsPageName' : undefined;
  if (!operation) return undefined;
  const bytes = bodyBytes(request.uploadData);
  if (!bytes) return undefined;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
  if (!canonicalUniqueKeys(text)) return undefined;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return undefined; }
  if (!object(body) || !exactKeys(body, ['operationName', 'variables', 'query'])
    || body.operationName !== operation || typeof body.query !== 'string'
    || !object(body.variables) || body.variables.organizationHostedJobsPageName !== 'oakslab') return undefined;
  // Pin both the readable source and received document to a separately reviewed
  // digest. A site change must be reviewed, rather than broadening POST access.
  if (operation === 'ApiJobPosting') {
    return exactKeys(body.variables, ['organizationHostedJobsPageName', 'jobPostingId'])
      && body.variables.jobPostingId === '3fb1bab3-5182-4866-bc17-9b18199f4468'
      && liveQueryTokenHash(REVIEWED_ASHBY_QUERY) === REVIEWED_ASHBY_QUERY_TOKEN_SHA256
      && liveQueryTokenHash(body.query) === REVIEWED_ASHBY_QUERY_TOKEN_SHA256
      ? 'ashby-oakslab-api-job-posting-v1' : undefined;
  }
  return exactKeys(body.variables, ['organizationHostedJobsPageName', 'searchContext'])
    && body.variables.searchContext === 'JobPosting'
    && liveQueryTokenHash(REVIEWED_ASHBY_ORGANIZATION_QUERY) === REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256
    && liveQueryTokenHash(body.query) === REVIEWED_ASHBY_ORGANIZATION_QUERY_TOKEN_SHA256
    ? 'ashby-oakslab-api-organization-v1' : undefined;
}

export function evaluateLiveNetworkRequest(request: LiveNetworkRequest, caseId: string): LiveNetworkDecision {
  let url: URL;
  try { url = new URL(request.url); } catch { return { allowed: false, reason: 'invalid-url' }; }
  if (['http:', 'ws:', 'wss:'].includes(url.protocol)) return { allowed: false, reason: 'insecure-url' };
  let query: string;
  try { query = decodeURIComponent(url.search).replace(/\+/gu, ' ').toLowerCase(); }
  catch { return { allowed: false, reason: 'invalid-url' }; }
  if (Object.values(LIVE_CONTACT_VALUES).some(value => query.includes(value.toLowerCase()))) {
    return { allowed: false, reason: 'test-value-query' };
  }
  if (['GET', 'HEAD'].includes(request.method.toUpperCase())) return { allowed: true, reason: 'read-method' };
  const ruleId = approvedAshbyRead(request, url, caseId);
  if (ruleId) return { allowed: true, reason: 'reviewed-ashby-query', ruleId };
  return { allowed: false, reason: request.method.toUpperCase() === 'POST' ? 'unapproved-read-query' : 'nonread-method' };
}
