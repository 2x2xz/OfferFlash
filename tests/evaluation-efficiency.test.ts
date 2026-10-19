import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRequestAttempts, summarizeLatencies, spanWallTime, summarizeEfficiencyRuns, compareManualEfficiency,
  type BenchmarkRequestAttempt, type BenchmarkEfficiencyRun } from '../packages/evaluation/src/efficiency.js';

const request = (id: string): BenchmarkRequestAttempt => ({ id, source: 'real-model', status: 'succeeded', durationMs: 100,
  usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 3, totalTokens: 38 } });
const run = (id: string): BenchmarkEfficiencyRun => ({ id, scenarioId: 'form-a', mode: 'agent', status: 'succeeded', durationMs: 1000,
  requests: [], oracle: { expectedFields: 10, correctFields: 10 }, review: { cleanStartConfirmed: true, reviewed: true, totalDurationMs: 1500 } });

test('real usage sums disjoint Pi components exactly once and failed billable attempts are retained', () => {
  const summary = summarizeRequestAttempts([request('first'), { ...request('retry'), status: 'failed', durationMs: 200 }]);
  assert.equal(summary.attempts, 2); assert.equal(summary.realAttempts, 2); assert.equal(summary.failedAttempts, 1);
  assert.equal(summary.usageComplete, true);
  assert.deepEqual(summary.tokens, { input: 20, output: 10, cacheRead: 40, cacheWrite: 6, totalTokens: 76 });
  assert.equal(summary.inputTokensIncludingCache, 66); assert.equal(summary.latency.meanMs, 150);
});

test('scripted usage and missing or inconsistent real usage never turn into genuine zero/known token evidence', () => {
  for (const attempts of [[{ ...request('script'), source: 'scripted' as const }], [{ ...request('missing'), usage: undefined }],
    [{ ...request('bad'), usage: { ...request('a').usage!, totalTokens: 999 } }], [{ ...request('nan'), usage: { ...request('a').usage!, input: NaN } }]]) {
    const result = summarizeRequestAttempts(attempts);
    assert.equal(result.usageComplete, false); assert.equal(result.tokens, null); assert.equal(result.inputTokensIncludingCache, null);
  }
  const fixture = summarizeRequestAttempts([{ ...request('script'), source: 'scripted' }]);
  assert.equal(fixture.realAttempts, 0); assert.equal(fixture.scriptedAttempts, 1); assert.equal(fixture.measuredRealUsageAttempts, 0);
  assert.equal(fixture.realLatency.samples, 0);
  const unknown = summarizeRequestAttempts([{ ...request('missing'), status: 'cancelled', usage: null }]);
  assert.equal(unknown.cancelledAttempts, 1); assert.equal(unknown.missingRealUsageAttempts, 1);
  const rule = summarizeRequestAttempts([]); assert.equal(rule.usageComplete, true); assert.equal(rule.tokens?.totalTokens, 0);
});

test('latency percentiles require twenty measured attempts and report missing samples instead of dropping them invisibly', () => {
  const small = summarizeLatencies([10, 20, null]);
  assert.equal(small.samples, 2); assert.equal(small.missingSamples, 1); assert.equal(small.meanMs, 15);
  assert.equal(small.p50Ms, null); assert.equal(small.p95Ms, null);
  const enough = summarizeLatencies(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(enough.p50Ms, 10.5); assert.equal(enough.p95Ms, 19.05); assert.equal(enough.percentileMinimumSamples, 20);
  assert.equal(summarizeLatencies([]).meanMs, null);
  assert.throws(() => summarizeLatencies([NaN]), /duration/); assert.throws(() => summarizeLatencies([-1]), /duration/);
});

test('root and child durations use interval union, never root plus all overlapping child lengths', () => {
  const result = spanWallTime([{ id: 'root', startMs: 0, endMs: 100 },
    { id: 'a', parentId: 'root', startMs: 10, endMs: 60 }, { id: 'b', parentId: 'root', startMs: 40, endMs: 80 },
    { id: 'nested', parentId: 'a', startMs: 20, endMs: 30 }]);
  assert.equal(result.summedSpanMs, 200); assert.equal(result.unionMs, 100);
  assert.equal(result.rootUnionMs, 100); assert.equal(result.childUnionMs, 70); assert.equal(result.overlapMs, 100);
  assert.equal(spanWallTime([{ id: 'orphan', parentId: 'missing', startMs: 200, endMs: 220 }]).orphanSpans, 1);
  assert.equal(spanWallTime([]).unionMs, 0);
  assert.throws(() => spanWallTime([{ id: 'x', parentId: 'x', startMs: 0, endMs: 5 }]), /Cyclic/);
  assert.throws(() => spanWallTime([{ id: 'x', startMs: 2, endMs: 1 }]), /interval/);
});

test('all-attempt throughput retains failure/partial/cancelled time; success-only rate is clearly separate and uses oracle', () => {
  const result = summarizeEfficiencyRuns([run('success'), { ...run('failed'), status: 'failed', durationMs: 5000, oracle: { expectedFields: 10, correctFields: 0 } },
    { ...run('partial'), status: 'partial', durationMs: 2000, oracle: { expectedFields: 10, correctFields: 4 } },
    { ...run('cancelled'), status: 'cancelled', durationMs: 2000, oracle: { expectedFields: 10, correctFields: 0 } }]);
  assert.equal(result.allAttempts.totalDurationMs, 10000); assert.equal(result.allAttempts.runs, 4);
  assert.equal(result.byStatus.failed.totalDurationMs, 5000); assert.equal(result.byStatus.partial.totalDurationMs, 2000);
  assert.equal(result.allAttemptCorrectFieldsPerSecond, 1.4); assert.equal(result.successOnlyCorrectFieldsPerSecond, 10);
  assert.equal(result.verifiedSuccessRuns, 1); assert.equal(result.oracleCorrectFields, 14);
  const falseCompletion = summarizeEfficiencyRuns([{ ...run('claim'), oracle: { expectedFields: 10, correctFields: 2 } }]);
  assert.equal(falseCompletion.falseCompletionRuns, 1); assert.equal(falseCompletion.verifiedSuccessRuns, 0);
  assert.equal(falseCompletion.successOnlyCorrectFieldsPerSecond, null);
});

test('missing duration or final oracle makes all-attempt throughput unknown, never self-reported executor success', () => {
  const noOracle = summarizeEfficiencyRuns([run('known'), { ...run('unknown'), oracle: null }]);
  assert.equal(noOracle.missingOracleRuns, 1); assert.equal(noOracle.allAttemptCorrectFieldsPerSecond, null);
  const noDuration = summarizeEfficiencyRuns([run('known'), { ...run('unknown'), durationMs: null }]);
  assert.equal(noDuration.allAttempts.observedDurationMs, 1000); assert.equal(noDuration.allAttempts.totalDurationMs, null);
  assert.equal(noDuration.allAttempts.latency.missingSamples, 1); assert.equal(noDuration.allAttemptCorrectFieldsPerSecond, null);
  assert.throws(() => summarizeEfficiencyRuns([run('a'), { ...run('b'), scenarioId: 'different' }]), /pool/);
  assert.throws(() => summarizeEfficiencyRuns([{ ...run('bad'), oracle: { expectedFields: 2, correctFields: 3 } }]), /run/);
});

test('manual comparison needs a genuine reviewed human pair including correction time; missing baseline yields no improvement', () => {
  const agent = run('agent'); const manual: BenchmarkEfficiencyRun = { ...run('manual'), mode: 'manual', durationMs: 5000,
    review: { humanOperated: true, cleanStartConfirmed: true, reviewed: true, totalDurationMs: 6000 } };
  const absent = compareManualEfficiency(agent, null); assert.equal(absent.reason, 'missing-manual'); assert.equal(absent.timeSavedFraction, null);
  const result = compareManualEfficiency(agent, manual);
  assert.equal(result.comparable, true); assert.equal(result.agentTotalMs, 1500); assert.equal(result.speedup, 4); assert.equal(result.timeSavedFraction, .75);
  assert.equal(compareManualEfficiency(agent, { ...manual, review: { ...manual.review!, humanOperated: false } }).comparable, false);
  assert.equal(compareManualEfficiency(agent, { ...manual, review: { ...manual.review!, totalDurationMs: null } }).reason, 'missing-time');
  assert.equal(compareManualEfficiency(agent, { ...manual, oracle: { expectedFields: 10, correctFields: 9 } }).reason, 'not-fully-correct');
  assert.equal(compareManualEfficiency({ ...agent, requests: [{ ...request('faux'), source: 'scripted' }] }, manual).reason, 'scripted-evidence');
});

test('duplicate IDs and invalid request source cannot silently pool retries or fabricate evidence', () => {
  assert.throws(() => summarizeRequestAttempts([request('same'), request('same')]), /duplicate/);
  assert.throws(() => summarizeRequestAttempts([{ ...request('bad'), source: 'made-up' as 'real-model' }]), /attempt/);
  assert.throws(() => summarizeEfficiencyRuns([run('same'), run('same')]), /duplicate/);
});
