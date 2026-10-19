import assert from 'node:assert/strict';
import test from 'node:test';
import type { TelemetryRun, TelemetrySpan } from '../packages/telemetry/src/contracts.js';
import { telemetryDuration, telemetryElapsed, telemetryLatencySummary, telemetryReviewDraft, telemetryReviewValues, telemetryStepLabel,
  telemetrySpanLabel, telemetryStages, telemetryTimeline, telemetryTokenLabel } from '../packages/ui/src/telemetry.js';

function run(overrides: Partial<TelemetryRun> = {}): TelemetryRun {
  return { id: 'fictional-run', traceId: '0123456789abcdef0123456789abcdef', mode: 'agent', scenarioKey: 'fictional-scenario',
    startedAt: '2026-10-19T02:00:00.000Z', status: 'completed', durationMs: 1000,
    verifiedFields: 3, observedVerifiedFields: 3, pendingFields: 1, addedGroups: 0, manualCorrections: 0, interventions: 0,
    modelCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, usageComplete: true,
    reviewed: false, cleanStartConfirmed: false, source: 'fixture', spans: [], ...overrides };
}
function span(id: string, ms: number, durationMs: number, parentId?: string): TelemetrySpan {
  return { id, parentId, name: 'form.fill', startedAt: new Date(Date.parse('2026-10-19T02:00:00Z') + ms).toISOString(),
    durationMs, status: 'ok', attributes: {}, startTimeUnixNano: '0', endTimeUnixNano: '0' };
}
test('unknown or partial model usage cannot be rendered as free zero-token filling', () => {
  assert.equal(telemetryTokenLabel(run({ tokens: null, usageComplete: false, modelCalls: 1 })), '未知 · 用量不完整');
  assert.equal(telemetryTokenLabel(run({ usageComplete: false, modelCalls: 1 })), '未知 · 用量不完整');
  assert.equal(telemetryTokenLabel(run()), '0 · 未调用模型');
  assert.equal(telemetryTokenLabel(run({ mode: 'manual' })), '0 · 人工计时');
  assert.equal(telemetryTokenLabel(run({ modelCalls: 1, tokens: { input: 1200, output: 34, cacheRead: 100, cacheWrite: 0, totalTokens: 1334 } })), '1,334');
});
test('running elapsed time advances locally but interrupted or missing finished durations are not fabricated', () => {
  const now = Date.parse('2026-10-19T02:00:12Z');
  assert.equal(telemetryElapsed(run({ status: 'running', durationMs: undefined }), now), 12_000);
  assert.equal(telemetryElapsed(run({ status: 'interrupted', durationMs: undefined }), now), undefined);
  assert.equal(telemetryElapsed(run({ status: 'running', startedAt: 'invalid', durationMs: undefined }), now), undefined);
  assert.equal(telemetryDuration(undefined), '—'); assert.equal(telemetryDuration(Number.NaN), '—');
  assert.equal(telemetryDuration(20), '20 毫秒'); assert.equal(telemetryDuration(1500), '1.5 秒');
  assert.equal(telemetryDuration(65_000), '1 分 5 秒');
});
test('timeline places nested spans using real relative timestamps and preserves overlapping execution', () => {
  const value = run({ durationMs: 1000, spans: [span('child', 200, 400, 'root'), span('root', 0, 1000), span('peer', 300, 600, 'root')] });
  const before = structuredClone(value); const rows = telemetryTimeline(value, 0);
  assert.deepEqual(rows.map(row => [row.span.id, row.depth, row.leftPercent, row.widthPercent]), [
    ['root', 0, 0, 100], ['child', 1, 20, 40], ['peer', 1, 30, 60],
  ]);
  assert.deepEqual(value, before, 'drawing the timeline does not rewrite recorded SDK timestamps or parent IDs');
});
test('missing parents and cyclic parent links do not hide spans or create an unbounded timeline', () => {
  const rows = telemetryTimeline(run({ spans: [span('orphan', 0, 100, 'missing'), span('a', 100, 100, 'b'), span('b', 200, 100, 'a')] }), 0);
  assert.equal(rows.length, 3); assert.equal(rows[0]!.depth, 0);
  assert.ok(rows.every(row => Number.isFinite(row.leftPercent) && row.leftPercent >= 0 && row.leftPercent + row.widthPercent <= 100 && row.depth <= 12));
});
test('review never assumes an expected field count or confirms a blank starting point', () => {
  const draft = telemetryReviewDraft(run());
  assert.equal(draft.expectedFields, ''); assert.equal(draft.cleanStartConfirmed, false);
  assert.equal(telemetryReviewDraft(run({ cleanStartConfirmed: true })).cleanStartConfirmed, false,
    'a starting-point declaration before filling cannot confirm continuity through the later review');
  assert.equal(telemetryReviewDraft(run({ reviewed: true, cleanStartConfirmed: true })).cleanStartConfirmed, true);
  assert.equal(telemetryReviewValues(draft), undefined);
  assert.deepEqual(telemetryReviewValues({ ...draft, expectedFields: '4' }), {
    expectedFields: 4, verifiedFields: 3, manualCorrections: 0, interventions: 0, cleanStartConfirmed: false,
  });
});
test('manual review requires bounded nonnegative integers and cannot report more correct targets than the target set', () => {
  const draft = { ...telemetryReviewDraft(run()), expectedFields: '4' };
  for (const change of [{ expectedFields: '0' }, { verifiedFields: '5' }, { manualCorrections: '-1' },
    { interventions: '0.5' }, { expectedFields: '1e2' }, { expectedFields: '100001' }]) {
    assert.equal(telemetryReviewValues({ ...draft, ...change }), undefined);
  }
  assert.equal(telemetryStepLabel('career.add'), '新增经历分组');
  assert.equal(telemetryStepLabel('unrecognized.private_name'), '执行步骤', 'unknown labels do not expose arbitrary recorded names');
});
test('local latency excludes unfinished, failed, manual, other-scenario and fixture records; P95 needs 20 actual rounds', () => {
  const complete = (durationMs: number) => run({ durationMs, source: 'production', endedAt: '2026-10-19T02:00:10Z' });
  const requests = { ...span('model', 0, 200), name: 'model.request' };
  const records = [complete(1000), { ...complete(3000), status: 'partial' as const, spans: [requests] },
    { ...complete(50_000), source: 'fixture' as const }, { ...complete(50_000), status: 'failed' as const },
    { ...complete(50_000), status: 'cancelled' as const }, { ...complete(50_000), status: 'interrupted' as const },
    { ...complete(50_000), status: 'running' as const }, { ...complete(50_000), mode: 'manual' as const },
    { ...complete(50_000), scenarioKey: 'another-scenario' }, { ...complete(50_000), endedAt: undefined }];
  assert.deepEqual(telemetryLatencySummary(records, 'fictional-scenario'), { samples: 2, p50Ms: 2000, p95Ms: undefined, modelSamples: 1, modelP50Ms: 200 });
  const twenty = Array.from({ length: 20 }, (_, i) => complete((i + 1) * 1000));
  assert.equal(telemetryLatencySummary(twenty, 'fictional-scenario').p95Ms, 19050);
  assert.equal(telemetryLatencySummary([], 'fictional-scenario').p50Ms, undefined);
});

test('visual stages group only recorded actions and union overlapping spans instead of adding parent duration twice', () => {
  const spans: TelemetrySpan[] = [
    { ...span('root', 0, 1000), name: 'application.fill' },
    { ...span('recognize', 0, 300, 'root'), name: 'form.recognize' },
    { ...span('model', 100, 180, 'recognize'), name: 'model.request' },
    { ...span('contact', 300, 100, 'root'), attributes: { 'field.key': 'email' } },
    { ...span('career-run', 400, 600, 'root'), name: 'career.run' },
    { ...span('education', 500, 100, 'career-run'), name: 'career.fill', attributes: { collection: 'educations', 'field.key': 'school' } },
    { ...span('project', 700, 200, 'career-run'), name: 'career.add', attributes: { collection: 'projects' } },
  ];
  const value = run({ spans }); const before = structuredClone(value);
  const stages = telemetryStages(value, 0);
  assert.deepEqual(stages.map(stage => [stage.id, stage.label, stage.durationMs, stage.rows.length]), [
    ['recognize', '识别页面', 300, 2], ['contact', '联系资料', 100, 1],
    ['educations', '教育经历', 100, 1], ['projects', '项目经历', 200, 1],
  ]);
  assert.deepEqual(stages[0]!.segments, [{ leftPercent: 0, widthPercent: 30 }]);
  assert.deepEqual(stages[3]!.segments, [{ leftPercent: 70, widthPercent: 20 }]);
  assert.equal(stages.some(stage => stage.id === 'verify'), false, 'a visual verification node requires its own actual span');
  assert.deepEqual(value, before, 'stage grouping never rewrites source spans or SDK times');
  assert.equal(telemetryTimeline(value, 0).length, 7, 'all containers remain available in the raw parent/child view');
});
test('stage gaps stay visible, failed steps stay attributed, and an empty or container-only trace invents no phases', () => {
  const value = run({ spans: [span('first', 100, 100), { ...span('second', 500, 200), status: 'error' }] });
  const stages = telemetryStages(value, 0);
  assert.equal(stages[0]!.durationMs, 300);
  assert.equal(stages[0]!.errors, 1);
  assert.deepEqual(stages[0]!.segments, [{ leftPercent: 10, widthPercent: 10 }, { leftPercent: 50, widthPercent: 20 }]);
  assert.deepEqual(telemetryStages(run(), 0), []);
  assert.deepEqual(telemetryStages(run({ spans: [{ ...span('root', 0, 1000), name: 'application.fill' }] }), 0), []);
  assert.deepEqual(telemetryStages(run({ spans: [{ ...span('check', 900, 100), name: 'career.verify' }] }), 0).map(stage => stage.id), ['verify']);
});
test('readable span labels expose only fixed collection and field categories, never unknown free text or inherited keys', () => {
  assert.equal(telemetrySpanLabel({ ...span('education', 0, 1), name: 'career.fill', attributes: { collection: 'educations', 'field.key': 'degree' } }), '填写教育 · 学历');
  assert.equal(telemetrySpanLabel({ ...span('project', 0, 1), name: 'career.add', attributes: { collection: 'projects' } }), '新增项目经历');
  assert.equal(telemetrySpanLabel({ ...span('unknown', 0, 1), attributes: { collection: 'private-company', 'field.key': 'private-value' } }), '填写联系资料');
  assert.equal(telemetrySpanLabel({ ...span('unknown', 0, 1), name: 'unknown.private-name', attributes: { collection: '__proto__', 'field.key': 'toString' } }), '执行步骤');
  assert.equal(telemetryStepLabel('toString'), '执行步骤');
});
