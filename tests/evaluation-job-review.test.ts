import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { renderJobReviewHtml, safeJobReviewSourceURL, validateReviewedLabels, type JobReviewSnapshot } from '../packages/evaluation/src/job-review.js';

const snapshot: JobReviewSnapshot = {
  snapshotHash: 'a'.repeat(64), items: [
    { id: 'fictional-job-1', contentHash: 'b'.repeat(64), url: 'https://careers.example.com/jobs/one', company: '虚构雇主甲', title: '虚构检索岗位', city: '北京', description: '完整虚构职责：设计检索与评估。', requirements: '完整虚构要求：2027届，Python。' },
    { id: 'fictional-job-2', contentHash: 'c'.repeat(64), url: 'https://careers.example.invalid/two', company: '虚构雇主乙', title: '虚构策略岗位', city: '上海', description: '完整虚构职责：研究策略。', requirements: '完整虚构要求：博士优先。' },
  ],
};

class FakeNode {
  id = ''; textContent = ''; className = ''; value = ''; checked = false; type = ''; rows = 0; maxLength = 0;
  placeholder = ''; href = ''; target = ''; rel = ''; referrerPolicy = ''; download = ''; open = false;
  children: FakeNode[] = []; handlers = new Map<string, Array<() => void>>(); clicks = 0;
  constructor(readonly tagName: string) {}
  append(...nodes: FakeNode[]) { this.children.push(...nodes); }
  addEventListener(event: string, fn: () => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); }
  fire(event: string) { this.handlers.get(event)?.forEach(fn => fn()); }
  click() { this.clicks++; this.fire('click'); }
}
function runReview(input: JobReviewSnapshot = snapshot) {
  const html = renderJobReviewHtml(input), dataText = /<script id="job-review-data" type="application\/json">([\s\S]*?)<\/script>/u.exec(html)![1]!;
  const script = /<script>([\s\S]*?)<\/script>\s*<\/body>/u.exec(html)![1]!;
  const roots = ['job-review-data', 'reviewer-alias', 'comparison-cv', 'job-cards', 'review-count', 'review-message', 'export-preview', 'profile-binding', 'clear-cv', 'download-review'];
  const nodes = roots.map(id => { const node = new FakeNode('ROOT'); node.id = id; return node; });
  nodes.find(node => node.id === 'job-review-data')!.textContent = dataText;
  const blobs: Blob[] = [], revoked: string[] = [];
  class LocalURL extends URL {
    static createObjectURL(blob: Blob) { blobs.push(blob); return 'blob:owned-review-fixture'; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  }
  const get = (id: string) => { const node = nodes.find(node => node.id === id); assert.ok(node, `Missing owned node ${id}`); return node; };
  const noNetwork = () => { throw new Error('Offline review attempted a network or storage capability'); };
  vm.runInNewContext(script, {
    document: { getElementById: get, createElement(tag: string) { const node = new FakeNode(tag); nodes.push(node); return node; } },
    URL: LocalURL, Blob, setTimeout(fn: () => void) { fn(); }, fetch: noNetwork, XMLHttpRequest: noNetwork,
    localStorage: { setItem: noNetwork, getItem: noNetwork }, sessionStorage: { setItem: noNetwork, getItem: noNetwork },
    FileReader: noNetwork, WebSocket: noNetwork,
  });
  const exported = () => JSON.parse(get('export-preview').textContent);
  function select(id: string, value: string) { get(id).value = value; get(id).fire('change'); }
  function enter(id: string, value: string) { get(id).value = value; get(id).fire('input'); }
  function confirm(index: number, relevance = '3', eligibility = 'eligible') {
    select(`relevance-${index}`, relevance); select(`eligibility-${index}`, eligibility);
    enter(`rationale-${index}`, '虚构履历的检索评估项目支持该职责；资格范围已对照。');
    get(`human-confirm-${index}`).checked = true; get(`human-confirm-${index}`).fire('change'); get(`confirm-${index}`).click();
  }
  return { html, nodes, get, exported, select, enter, confirm, blobs, revoked };
}

test('review HTML is offline, source text uses textContent, and malicious strings cannot break script boundaries', () => {
  const hostile = structuredClone(snapshot);
  hostile.items[0]!.description = '</script><img src=x onerror="alert(1)"><script>alert(2)</script>\u2028';
  hostile.items[0]!.title = 'bad </title><svg onload=alert(3)>';
  hostile.items[0]!.url = 'javascript:alert(4)';
  const page = runReview(hostile);
  assert.match(page.html, /connect-src 'none'/u);
  assert.match(page.html, /default-src 'none'/u);
  assert.match(page.html, /form-action 'none'/u);
  assert.ok(!page.html.includes('</script><img'));
  assert.ok(!page.html.includes('<svg onload'));
  assert.ok(!page.html.includes('innerHTML'));
  assert.ok(!page.html.includes('javascript:alert'));
  assert.ok(page.nodes.some(node => node.textContent === hostile.items[0]!.description));
  assert.ok(page.nodes.some(node => node.textContent === '1. ' + hostile.items[0]!.title));
  assert.equal(page.nodes.filter(node => node.tagName === 'a').length, 0, 'unsafe and reserved invalid sources are not clickable');
});

test('only explicit public HTTPS source links can be opened and source authenticity is not asserted', () => {
  const page = runReview();
  const links = page.nodes.filter(node => node.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0]!.href, snapshot.items[0]!.url);
  assert.equal(links[0]!.rel, 'noopener noreferrer');
  assert.equal(links[0]!.referrerPolicy, 'no-referrer');
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', 'http://example.com', 'https://user:pass@example.com', 'https://127.0.0.1/x', 'https://[::1]/', 'https://host.local/x', 'https://example.invalid/x']) assert.equal(safeJobReviewSourceURL(value), null);
  assert.match(page.html, /链接可用并不证明来源真实/u);
});

test('all initial and unconfirmed draft labels export as null rather than fabricated human gold', () => {
  const page = runReview();
  let value = page.exported();
  assert.equal(value.humanOperated, false); assert.equal(value.reviewedAt, null); assert.equal(value.reviewer, '');
  assert.equal(value.profileSnapshotHash, null);
  assert.match(page.get('profile-binding').textContent, /未绑定简历哈希.+不能跨CV复用/u);
  assert.ok(value.items.every((row: any) => row.relevance === null && row.eligibility === null && row.reviewedAt === null && row.humanOperated === false));
  page.select('relevance-0', '0'); page.select('eligibility-0', 'ineligible'); page.enter('rationale-0', '草稿理由');
  page.get('confirm-0').click();
  value = page.exported(); assert.equal(value.items[0].relevance, null);
  page.enter('reviewer-alias', 'reviewer-A'); page.get('confirm-0').click();
  assert.equal(page.exported().items[0].relevance, null, 'missing explicit human checkbox cannot confirm');
  const validation = validateReviewedLabels(page.exported(), snapshot);
  assert.equal(validation.valid, true); assert.equal(validation.reviewedCount, 0); assert.equal(validation.allItemsConfirmed, false);
  assert.equal(validation.humanOperationVerified, false); assert.equal(validation.requiresIndependentVerification, true);
});

test('explicit item confirmation binds exact snapshot/content hashes; unknown eligibility is a real selected label', () => {
  const page = runReview(); page.enter('reviewer-alias', 'reviewer-A'); page.confirm(0, '0', 'unknown');
  const value = page.exported(), validation = validateReviewedLabels(value, snapshot);
  assert.equal(value.snapshotHash, snapshot.snapshotHash);
  assert.equal(value.items[0].contentHash, snapshot.items[0]!.contentHash);
  assert.equal(value.items[0].relevance, 0); assert.equal(value.items[0].eligibility, 'unknown');
  assert.equal(value.items[0].humanOperated, true); assert.equal(typeof value.items[0].reviewedAt, 'string');
  assert.equal(value.items[1].relevance, null);
  assert.equal(validation.valid, true); assert.equal(validation.reviewedCount, 1); assert.equal(validation.unreviewedCount, 1);
  assert.equal(validation.humanOperationVerified, false, 'the same API accepts structural records, not proof that a human created them');
  page.enter('rationale-0', '修改理由后须重新确认');
  assert.equal(page.exported().items[0].relevance, null);
});

test('CV stays outside exported JSON and changing CV or reviewer invalidates prior confirmations', async () => {
  const page = runReview();
  const marker = 'PRIVATE-CV-FICTIONAL-MARKER-DO-NOT-EXPORT';
  page.enter('comparison-cv', marker); page.enter('reviewer-alias', 'reviewer-A'); page.confirm(0);
  assert.equal(page.exported().humanOperated, true);
  assert.ok(!page.get('export-preview').textContent.includes(marker));
  page.get('download-review').click(); assert.equal(page.blobs.length, 1);
  const downloaded = await page.blobs[0]!.text();
  assert.ok(!downloaded.includes(marker)); assert.ok(!downloaded.includes('comparison-cv'));
  assert.equal(validateReviewedLabels(JSON.parse(downloaded), snapshot).reviewedCount, 1);
  assert.deepEqual(page.revoked, ['blob:owned-review-fixture']);
  page.enter('comparison-cv', marker + '-new'); assert.equal(page.exported().items[0].relevance, null);
  page.confirm(0); page.enter('reviewer-alias', 'reviewer-B'); assert.equal(page.exported().items[0].relevance, null);
  page.get('clear-cv').click(); assert.equal(page.get('comparison-cv').value, '');
});

test('review validator rejects tampering, duplicate or missing IDs, extra CV fields and forged confirmation states', () => {
  const page = runReview(); page.enter('reviewer-alias', 'reviewer-A'); page.confirm(0);
  const valid = page.exported();
  const mutations: Array<(value: any) => void> = [
    value => { value.snapshotHash = 'f'.repeat(64); },
    value => { value.profileSnapshotHash = 'd'.repeat(64); },
    value => { value.items[0].contentHash = 'e'.repeat(64); },
    value => { value.items[1].id = value.items[0].id; },
    value => { value.items.pop(); },
    value => { value.cv = 'DO-NOT-IMPORT'; },
    value => { value.items[0].relevance = 4; },
    value => { value.items[0].humanOperated = false; },
    value => { value.items[0].reviewedAt = null; },
    value => { value.items[0].rationale = ''; },
    value => { value.reviewer = 'person@example.invalid'; },
    value => { value.humanOperated = false; },
    value => { value.reviewedAt = '2000-01-01T00:00:00.000Z'; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(valid); mutate(changed); const result = validateReviewedLabels(changed, snapshot); assert.equal(result.valid, false); assert.equal(result.data, null); }
  assert.equal(validateReviewedLabels(valid, { ...snapshot, snapshotHash: 'bad' }).valid, false);
  assert.throws(() => renderJobReviewHtml({ ...snapshot, items: [...snapshot.items, snapshot.items[0]!] }), /duplicate/u);
  assert.throws(() => renderJobReviewHtml({ ...snapshot, snapshotHash: 'not-a-hash' }), /snapshot/u);
});

test('optional fictional profile digest is shown by suffix and binds labels to the exact CV snapshot', async () => {
  const fictionalProfileHash = 'd'.repeat(56) + '1234abcd';
  const bound = { ...snapshot, profileSnapshotHash: fictionalProfileHash };
  const page = runReview(bound);
  assert.match(page.get('profile-binding').textContent, /本轮简历哈希 · 末8位 1234abcd/u);
  assert.ok(!page.get('profile-binding').textContent.includes(fictionalProfileHash));
  assert.equal(page.exported().profileSnapshotHash, fictionalProfileHash);
  page.enter('reviewer-alias', 'reviewer-A'); page.confirm(0);
  const value = page.exported();
  assert.equal(validateReviewedLabels(value, bound).valid, true);
  assert.equal(validateReviewedLabels(value, snapshot).valid, false, 'bound labels cannot be silently reused for an unbound CV');
  assert.equal(validateReviewedLabels(value, { ...bound, profileSnapshotHash: 'e'.repeat(64) }).valid, false);
  const missing = structuredClone(value); delete missing.profileSnapshotHash;
  assert.equal(validateReviewedLabels(missing, bound).valid, false);
  page.get('download-review').click();
  assert.equal(JSON.parse(await page.blobs[0]!.text()).profileSnapshotHash, fictionalProfileHash);
  assert.equal(validateReviewedLabels(value, bound).humanOperationVerified, false);
  assert.throws(() => renderJobReviewHtml({ ...bound, profileSnapshotHash: 'private-cv-text-not-a-hash' }), /snapshot/u);
});
