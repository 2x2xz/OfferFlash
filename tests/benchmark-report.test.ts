import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import type { BenchmarkReport } from '../packages/evaluation/src/contracts.js';
import { renderBenchmarkHtml } from '../packages/evaluation/src/report.js';
import { scoreForm } from '../packages/evaluation/src/form-scoring.js';
import { scoreRanking } from '../packages/evaluation/src/ranking-scoring.js';
import { summarizeEfficiencyRuns } from '../packages/evaluation/src/efficiency.js';
import { evaluateRetrieval } from '../packages/evaluation/src/retrieval.js';

function emptyReport(): BenchmarkReport {
  return { schemaVersion: 1, id: 'fictional-benchmark-run', createdAt: '2026-10-19T00:00:00.000Z',
    labelProvenance: 'authored-synthetic-diagnostic', independentHumanGold: false,
    protocol: { id: 'fictional-protocol', asOf: '2026-10-19', hash: 'a'.repeat(64), sourceHashes: {}, codeHash: 'b'.repeat(64), codeFrozen: true },
    matching: [], forms: [], retrieval: [], acquisition: [], traces: [], limitations: ['原创虚构诊断集，无独立人工 gold'], efficiency: {},
    live: { requested: false, provider: 'none', model: 'none', requestAttempts: 0, completedResponses: 0, status: 'not-run', usageFromProvider: false },
    browserEvidence: { run: false, engines: [], externalRequests: 0, normalUserDataRead: false, submissions: 0 } };
}

class Element {
  readonly children: Element[] = [];
  readonly events = new Map<string, () => void>();
  text = ''; className = ''; value = ''; style: Record<string, string> = {};
  constructor(readonly tag = 'div') {}
  set textContent(value: string) { this.text = value; this.children.length = 0; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(' '); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.text = ''; this.children.length = 0; this.children.push(...children); }
  addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
  get innerHTML(): never { throw new Error('Unsafe HTML sink'); }
  set innerHTML(_value: string) { throw new Error('Unsafe HTML sink'); }
}
function renderClient(report: BenchmarkReport) {
  const html = renderBenchmarkHtml(report);
  const json = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u.exec(html)![1]!;
  const script = /<script>([\s\S]*?)<\/script>/u.exec(html)![1]!;
  const elements = new Map<string, Element>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  get('report-data').textContent = json;
  const context = { document: { getElementById: get, createElement: (name: string) => new Element(name) } };
  runInNewContext(script, context, { timeout: 1000 });
  return { html, get, select(id: string, index: number) { get(id).value = String(index); get(id).events.get('change')!(); } };
}
function formScore(filled: boolean) {
  return scoreForm({ fields: [{ fieldId: 'role', required: true, kind: 'eligible', initialValue: '', expectedValues: ['主要开发者'] }],
    finalValues: { role: filled ? '主要开发者' : '' }, mutations: [] });
}

test('empty report plainly says unrun and keeps synthetic/human/live limitations prominent without invented samples', () => {
  const { html, get } = renderClient(emptyReport());
  assert.match(html, /没有独立人工标注 gold/u); assert.match(html, /不是公开排行榜/u);
  assert.match(get('matching-results').textContent, /未运行岗位排序/u);
  assert.match(get('form-results').textContent, /未运行独立页面填写/u);
  assert.match(get('retrieval-results').textContent, /未运行/u);
  assert.match(get('efficiency-results').textContent, /尚无可汇总/u);
  assert.match(get('filter-count').textContent, /0\/0/u);
  assert.equal(get('engine-filter').children.length, 1); assert.equal(get('split-filter').children.length, 1);
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)=/u.test(html));
  assert.match(html, /connect-src 'none'/u);
});

test('default form headline excludes planner-only cases; filters derive actual engines and splits and change real displayed rows', () => {
  const report = emptyReport();
  report.forms = [
    { caseId: 'planner-only', engine: 'planner-live-model', split: 'dev', repeat: 0, durationMs: 1, status: 'succeeded', score: formScore(true), independentFinalRead: false, mutationAuditAvailable: false, environmentMutations: 0, submissions: 0 },
    { caseId: 'actual-browser', engine: 'production-background-dom', split: 'test', repeat: 0, durationMs: 3, status: 'partial', score: formScore(false), independentFinalRead: true, mutationAuditAvailable: true, environmentMutations: 0, submissions: 0 },
  ];
  const client = renderClient(report);
  assert.match(client.get('form-results').textContent, /production-background-dom/u);
  assert.doesNotMatch(client.get('form-results').textContent, /planner-live-model/u);
  assert.match(client.get('form-results').textContent, /0\/1/u);
  assert.match(client.get('planner-results').textContent, /planner-live-model/u);
  assert.equal(client.get('engine-filter').children.length, 3); assert.equal(client.get('split-filter').children.length, 3);
  client.select('engine-filter', 1);
  assert.match(client.get('form-results').textContent, /未运行独立页面填写/u);
  assert.match(client.get('planner-results').textContent, /planner-live-model/u);
  assert.match(client.get('filter-count').textContent, /1\/2/u);
  client.select('engine-filter', 0); client.select('split-filter', 2);
  assert.match(client.get('form-results').textContent, /production-background-dom/u);
  assert.match(client.get('planner-results').textContent, /未运行/u);
});

test('ranking nDCG/P@5 and unjudged values keep per-engine split denominators and never average unknown as zero', () => {
  const report = emptyReport();
  const known = scoreRanking(['job-a'], [{ jobId: 'job-a', relevance: 3, eligibility: 'eligible' }], 5);
  const unknown = scoreRanking(['job-a'], [{ jobId: 'job-a', relevance: null, eligibility: 'unknown' }], 5);
  report.matching = [
    { personaId: 'a', split: 'dev', engine: 'rules', ranking: ['job-a'], durationMs: 1, metrics: { '5': known } },
    { personaId: 'b', split: 'dev', engine: 'rules', ranking: ['job-a'], durationMs: 1, metrics: { '5': unknown } },
  ];
  const client = renderClient(report); const text = client.get('matching-results').textContent;
  assert.match(text, /1\.000 · n=1\/2 · unknown=1/u);
  assert.match(text, /0\.200 · n=1\/2 · unknown=1/u);
  assert.match(text, /unknown资格=1/u); assert.match(text, /0\/1/u);
  assert.match(text, /语义nDCG@5（资格独立）/u);
});

test('ranking API errors are visibly counted and cannot inflate semantic quality even if stale metrics exist', () => {
  const report = emptyReport(); const known = scoreRanking(['a'], [{ jobId: 'a', relevance: 3, eligibility: 'eligible' }], 5);
  report.matching = [
    { personaId: 'ok', engine: 'live', split: 'test', ranking: ['a'], durationMs: 2, metrics: { '5': known } },
    { personaId: 'failed', engine: 'live', split: 'test', ranking: ['a'], durationMs: 2, metrics: { '5': known }, errorCode: 'API_FAILED' },
  ];
  const text = renderClient(report).get('matching-results').textContent;
  assert.match(text, /失败 \/ 无效（errorCode）/u);
  assert.match(text, /1\.000 · n=1\/2 · unknown=1/u);
  assert.match(text, /API \/ 解析失败单列/u);
});

test('strict success does not accept a final-state-only claim when independent mutation audit is missing', () => {
  const report = emptyReport(); report.forms = [{ caseId: 'read-no-audit', engine: 'production-background-dom', split: 'test', repeat: 0,
    durationMs: 3, status: 'succeeded', score: { ...formScore(true), mutationAuditAvailable: false }, independentFinalRead: true,
    mutationAuditAvailable: false, environmentMutations: 0, submissions: 0 }];
  const text = renderClient(report).get('form-results').textContent;
  assert.match(text, /strictAutomationSuccess）：0\/0/u); assert.match(text, /unknown=1/u);
});

test('null submission observations stay unknown and cannot satisfy strict automation evidence', () => {
  const report = emptyReport(); report.browserEvidence.submissions = null;
  report.forms = [{ caseId: 'unobserved-submission', engine: 'production-background-dom', split: 'test', repeat: 0,
    durationMs: 3, status: 'succeeded', score: formScore(true), independentFinalRead: true,
    mutationAuditAvailable: true, environmentMutations: 0, submissions: null }];
  const client = renderClient(report);
  assert.match(client.get('provenance').textContent, /提交=unknown/u);
  assert.match(client.get('form-results').textContent, /strictAutomationSuccess）：0\/0/u);
  assert.match(client.get('form-results').textContent, /提交观测 unknown=1/u);
});

test('efficiency numbers come from true report summaries and incomplete usage remains unknown', () => {
  const report = emptyReport(); const summary = summarizeEfficiencyRuns([{ id: 'run', scenarioId: 'form-a', mode: 'agent', status: 'succeeded',
    durationMs: 250, oracle: { expectedFields: 2, correctFields: 2 }, requests: [{ id: 'request', source: 'real-model', status: 'succeeded',
      durationMs: 20, usage: { input: 30, cacheRead: 5, cacheWrite: 0, output: 7, totalTokens: 42 } }] }]);
  report.efficiency = { actual: summary };
  const text = renderClient(report).get('efficiency-results').textContent;
  assert.match(text, /真实 total token：42/u); assert.match(text, /input（含缓存）：35/u);
  assert.match(text, /mean=250\.000ms；P50=unknownms/u);
  assert.match(text, /oracle 正确字段\/秒（含失败耗时）：8\.000/u);
  report.efficiency = { unknown: { ...summary, requestStatistics: { ...summary.requestStatistics, usageComplete: false, tokens: null, inputTokensIncludingCache: null } } };
  assert.match(renderClient(report).get('efficiency-results').textContent, /真实 total token：unknown/u);
});

test('separate model request summary and per-case throughput cards do not pool unlike form tasks', () => {
  const report = emptyReport();
  const a = summarizeEfficiencyRuns([{ id: 'a', scenarioId: 'case-a', mode: 'agent', status: 'succeeded', durationMs: 1000,
    requests: [], oracle: { expectedFields: 8, correctFields: 8 } }]);
  const b = summarizeEfficiencyRuns([{ id: 'b', scenarioId: 'case-b', mode: 'agent', status: 'succeeded', durationMs: 4000,
    requests: [], oracle: { expectedFields: 4, correctFields: 4 } }]);
  report.efficiency = { modelRequests: { requestStatistics: a.requestStatistics },
    formExecutions: { 'rules:case-a': a, 'rules:case-b': b }, manualBaseline: null };
  const cards = renderClient(report).get('efficiency-results').children.filter(child => child.tag === 'article');
  assert.equal(cards.length, 3);
  assert.match(cards[1]!.textContent, /formExecutions\.rules:case-a/u); assert.match(cards[1]!.textContent, /8\.000/u);
  assert.match(cards[2]!.textContent, /formExecutions\.rules:case-b/u); assert.match(cards[2]!.textContent, /1\.000/u);
  assert.doesNotMatch(cards.map(card => card.textContent).join(' '), /2\.400/u);
});

test('retrieval hit cutoffs and no-answer samples come from actual query judgments, with zero-relevant gold excluded', () => {
  const report = emptyReport();
  const labels = [{ documentId: 'answer', grade: 1 }];
  report.retrieval = [
    { queryId: 'known', split: 'test', engine: 'lexical-bm25', ranking: ['noise', 'answer'], durationMs: 1,
      metrics: Object.fromEntries([1, 3, 5].map(k => [String(k), evaluateRetrieval(['noise', 'answer'], labels, k)])), expectedNoAnswer: false, correctNoAnswer: null },
    { queryId: 'no-answer', split: 'test', engine: 'lexical-bm25', ranking: [], durationMs: 1,
      metrics: Object.fromEntries([1, 3, 5].map(k => [String(k), evaluateRetrieval([], [], k)])), expectedNoAnswer: true, correctNoAnswer: true },
  ];
  const text = renderClient(report).get('retrieval-results').textContent;
  assert.match(text, /0\.000 · n=1\/2 · unknown=1/u);
  assert.match(text, /1\.000 · n=1\/2 · unknown=1/u);
  assert.match(text, /1\/1 · unknown=0/u);
});

test('all report strings and embedded JSON resist closing-script/XSS and stay text-only during filtering', () => {
  const payload = '</script><img src=x onerror="globalThis.PWNED=true"><script>globalThis.PWNED=true</script>&\u2028\u2029';
  const report = emptyReport(); report.id = payload; report.limitations = [payload]; report.traces = [{ text: payload }];
  report.protocol.id = payload;
  report.forms = [{ caseId: payload, engine: payload, split: 'test', repeat: 0, durationMs: 1, status: 'partial', score: formScore(false),
    independentFinalRead: false, mutationAuditAvailable: false, environmentMutations: 0, submissions: 0 }];
  const { html, get, select } = renderClient(report);
  assert.equal((html.match(/<script\b/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /<img src=x/u); assert.match(html, /\\u003c\/script\\u003e/u);
  assert.match(html, /&lt;img/u); assert.equal(get('limitations').children[0]?.textContent, payload);
  assert.equal(get('engine-filter').children[1]?.textContent, payload);
  select('engine-filter', 1); assert.match(get('planner-results').textContent, /globalThis\.PWNED/u);
  assert.ok(get('trace-results').children.every(child => child.tag === 'details'));
});
