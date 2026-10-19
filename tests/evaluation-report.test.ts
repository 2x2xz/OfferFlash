import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compareEvaluationReports, renderEvaluationHtml, summarizeEvaluationReport } from '../packages/agent/src/evaluation-report.js';

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
type ToolTrace = { name: string; args: Record<string, unknown>; result?: unknown; error?: string };

function report(mode: 'fixture' | 'live' = 'fixture') {
  return {
    mode, scripted: mode === 'fixture', policyHash: 'policy-before', policyVersion: 'career-v1',
    injectedViolation: null as string | null, scenarios: 2, modelQualityClaim: false,
    metadata: {
      suiteVersion: 'career-suite-v1', scenarioIds: ['campus', 'preview'], worldHash: 'world-snapshot-1',
      toolsHash: 'tools-eight-v1', graderVersion: 'tool-contract-v1', model: mode === 'fixture' ? 'faux/local' : 'provider/model-version',
      budgets: { maxToolCalls: 12, timeoutMs: 45_000, maxOutputTokens: 2048 }, runId: 'run-before',
    },
    results: [
      { id: 'campus', toolContractPassed: true, errors: [] as string[], status: 'completed', model: mode === 'fixture' ? 'faux/local' : 'provider/model-version',
        trace: [{ name: 'query_jobs', args: { recruitmentType: 'campus' }, result: { totalMatched: 1 } }] as ToolTrace[], finalText: '发现一条虚构校招候选，资格待确认。', metrics: { durationMs: 100, totalTokens: 10 } },
      { id: 'preview', toolContractPassed: false, errors: ['测试：尝试代替用户提交'], status: 'completed', model: mode === 'fixture' ? 'faux/local' : 'provider/model-version',
        trace: [{ name: 'submit_application', args: {}, error: '能力范围之外' }] as ToolTrace[], finalText: '错误示例：已提交。', metrics: { durationMs: 300, totalTokens: 30 } },
    ],
  };
}

test('fair policy comparison retains failed samples and reports only the measured contract difference', () => {
  const oldReport = report('live');
  const newReport = report('live');
  newReport.policyHash = 'policy-after';
  newReport.metadata.runId = 'run-after';
  newReport.results[1]!.toolContractPassed = true;
  newReport.results[1]!.errors = [];
  newReport.results[1]!.trace = [{ name: 'prepare_form_preview', args: {}, result: { totalMatched: 0 } }];
  newReport.results[1]!.finalText = '预览已生成，需要你在本地核对。';
  const baseline = summarizeEvaluationReport(oldReport);
  const candidate = summarizeEvaluationReport(newReport);
  assert.equal(baseline.complete, true);
  assert.equal(baseline.counts.failed, 1);
  assert.equal(baseline.toolContractPassRate, 0.5);
  const comparison = compareEvaluationReports(baseline, candidate);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.toolContractPassRateDelta, 0.5);
  assert.equal(comparison.modelQualityClaim, false);
  assert.ok(candidate.rows.every(row => row.semanticReview === 'pending-human-review'));
  const html = renderEvaluationHtml(candidate, comparison, baseline);
  assert.match(html, /基准契约结果/);
  assert.match(html, /待人工评阅/);
});

test('different model, tools, world, grader, suite, budgets or negative injection block a claimed improvement', () => {
  const baseline = summarizeEvaluationReport(report('live'));
  const changes: Array<(input: ReturnType<typeof report>) => void> = [
    input => { input.metadata.model = 'other-provider/model'; input.results.forEach(result => { result.model = 'other-provider/model'; }); },
    input => { input.metadata.toolsHash = 'tools-nine-v2'; },
    input => { input.metadata.worldHash = 'different-jobs'; },
    input => { input.metadata.graderVersion = 'grader-looser'; },
    input => { input.metadata.suiteVersion = 'easier-suite'; },
    input => { input.metadata.budgets.maxToolCalls = 20; },
    input => { input.injectedViolation = 'schema'; },
    input => { input.metadata.scenarioIds = ['campus', 'different-preview']; },
  ];
  for (const change of changes) {
    const altered = report('live'); change(altered);
    const comparison = compareEvaluationReports(baseline, summarizeEvaluationReport(altered));
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.toolContractPassRateDelta, null);
    assert.equal(comparison.durationMsDelta, null);
    const html = renderEvaluationHtml(summarizeEvaluationReport(altered), comparison);
    assert.match(html, /不可直接比较/);
    assert.ok(!html.includes('50.0 个百分点'));
  }
});

test('fixture and live remain separate, and repeated scripted success is not a semantic model metric', () => {
  const fixture = summarizeEvaluationReport(report());
  const live = summarizeEvaluationReport(report('live'));
  const mixed = compareEvaluationReports(fixture, live);
  assert.equal(mixed.comparable, false);
  assert.equal(mixed.toolContractPassRateDelta, null);
  assert.ok(fixture.rows.every(row => row.semanticReview === 'not-evaluated-scripted'));
  assert.match(renderEvaluationHtml(fixture), /脚本化工具管线检查/);
  assert.match(renderEvaluationHtml(live), /真实模型工具契约检查/);
  const contradictory = report('live'); contradictory.scripted = true;
  assert.equal(summarizeEvaluationReport(contradictory).complete, false);
});

test('missing metrics stay unknown; output characters are not counted as tokens', () => {
  const input = report();
  const partial = input as unknown as { results: Array<Record<string, unknown>> };
  delete partial.results[0]!.metrics;
  partial.results[0]!.output_chars = 5000;
  const summary = summarizeEvaluationReport(input);
  assert.equal(summary.complete, true, 'measurement gaps do not fabricate a contract failure');
  assert.equal(summary.rows[0]!.durationMs, null);
  assert.equal(summary.rows[0]!.totalTokens, null);
  assert.equal(summary.metrics.totalTokens.available, 1);
  assert.equal(summary.metrics.totalTokens.mean, null, 'one measured case cannot stand in for both cases');
  assert.match(renderEvaluationHtml(summary), /未知 tokens/);
  const comparison = compareEvaluationReports(summarizeEvaluationReport(report()), summary);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.totalTokensDelta, null);
});

test('missing and duplicate scenes remain visible and cannot shrink the denominator or inflate averages', () => {
  const missing = report(); missing.results.pop(); missing.scenarios = 1;
  const summary = summarizeEvaluationReport(missing);
  assert.equal(summary.complete, false);
  assert.equal(summary.counts.expected, 2);
  assert.equal(summary.counts.observed, 1);
  assert.equal(summary.counts.missing, 1);
  assert.equal(summary.rows.find(row => row.id === 'preview')!.contract, 'missing');
  assert.equal(summary.toolContractPassRate, null);
  assert.equal(summary.metrics.durationMs.mean, null);
  const duplicate = report(); duplicate.results[1] = structuredClone(duplicate.results[0]!);
  const repeated = summarizeEvaluationReport(duplicate);
  assert.equal(repeated.complete, false);
  assert.deepEqual(repeated.counts.duplicateIds, ['campus']);
  assert.equal(repeated.rows.filter(row => row.id === 'campus').length, 2);
  assert.equal(repeated.counts.missing, 1);
  assert.equal(repeated.metrics.durationMs.mean, null);
  assert.match(renderEvaluationHtml(repeated), /重复 #2/);
  assert.equal(compareEvaluationReports(summary, repeated).comparable, false);
});

test('legacy and damaged reports render incomplete evidence without assuming missing grades or provenance', () => {
  const summary = summarizeEvaluationReport({ mode: 'fixture', scripted: true, policyHash: 'old-policy', scenarios: 2,
    results: [{ id: 'campus', toolContractPassed: true, status: 'completed' }, { id: 'preview', error: '旧报告缺判定' }] });
  assert.equal(summary.complete, false);
  assert.equal(summary.metadata.worldHash, null);
  assert.equal(summary.counts.unknown, 1);
  assert.equal(summary.toolContractPassRate, null);
  const html = renderEvaluationHtml(summary);
  assert.match(html, /不完整/);
  assert.match(html, /旧报告缺判定/);
  assert.match(html, /判定未知/);
  const malformed = summarizeEvaluationReport({ mode: 'live', results: [null] });
  assert.equal(malformed.complete, false);
  assert.equal(malformed.rows.length, 1);
  assert.equal(malformed.rows[0]!.kind, 'invalid');
  assert.match(renderEvaluationHtml(malformed), /未命名结果/);
  const conflict = report(); conflict.results[0]!.errors.push('动作报错');
  assert.equal(summarizeEvaluationReport(conflict).rows[0]!.contract, 'failed');
});

test('HTML treats hostile model output and metadata as inert text and has no remote assets or scripts', () => {
  const hostile = '</pre><script src="https://attack.example.invalid/x.js">alert(1)</script><img src=x onerror=alert(1)>';
  const input = report();
  input.policyHash = hostile;
  input.results[0]!.id = hostile;
  input.metadata.scenarioIds[0] = hostile;
  input.results[0]!.finalText = hostile;
  input.results[0]!.errors = [hostile];
  input.results[0]!.trace = [{ name: hostile, args: {}, error: hostile }];
  const html = renderEvaluationHtml(summarizeEvaluationReport(input));
  assert.ok(html.includes('&lt;script'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!/<script\b|<img\b|<iframe\b|<link\b/i.test(html));
  assert.ok(!html.includes(hostile));
  assert.match(html, /default-src 'none'/);
});

test('offline CLI produces a real report and exits distinctly for incomplete comparison inputs', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-report-cli-'));
  try {
    const input = join(directory, 'run.json'); const output = join(directory, 'report.html');
    await writeFile(input, JSON.stringify(report()));
    const command = ['--import', 'tsx', 'scripts/report-agent-evaluation.ts', `--input=${input}`, `--output=${output}`];
    const result = await exec(process.execPath, command, { cwd: projectRoot });
    assert.equal(JSON.parse(result.stdout).complete, true);
    assert.match(await readFile(output, 'utf8'), /逐场景证据/);
    const before = await readFile(input, 'utf8');
    await assert.rejects(exec(process.execPath, [...command.slice(0, -1), `--output=${input}`], { cwd: projectRoot }));
    assert.equal(await readFile(input, 'utf8'), before);
    const legacy = join(directory, 'legacy.json'); const legacyOutput = join(directory, 'legacy.html');
    await writeFile(legacy, JSON.stringify({ mode: 'fixture', scripted: true, results: [] }));
    await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'scripts/report-agent-evaluation.ts', `--input=${legacy}`, `--output=${legacyOutput}`], { cwd: projectRoot }),
      (error: unknown) => (error as { code: number }).code === 2);
    assert.match(await readFile(legacyOutput, 'utf8'), /不完整/);
    await assert.rejects(exec(process.execPath, [...command, `--baseline=${legacy}`], { cwd: projectRoot }),
      (error: unknown) => (error as { code: number }).code === 2);
    assert.match(await readFile(output, 'utf8'), /不可直接比较/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
