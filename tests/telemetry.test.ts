import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryStore, safeTelemetryAttributes } from '../packages/telemetry/src/store.js';
import { compareTelemetryRuns } from '../packages/telemetry/src/comparison.js';
import type { TelemetryRun } from '../packages/telemetry/src/contracts.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-telemetry-'));
  const store = await TelemetryStore.create(directory);
  return { directory, store, async clean() { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 12));
const usage = { input: 10, output: 5, cacheRead: 20, cacheWrite: 3, totalTokens: 38 };

test('real OpenTelemetry SDK records nested parents, precise timing, status and OTLP IDs', async () => {
  const f = await fixture();
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'fixture:paired-form', source: 'fixture' });
    await f.store.step('career.run', async () => {
      await f.store.step('career.fill', async () => { await pause(); return 'same-result'; }, { 'field.key': 'school', value: 'PRIVATE-VALUE' });
      const action = f.store.startStep('career.verify', { count: 1 }); await pause(); await action.end(); await action.end();
    });
    await f.store.addCounts({ verifiedFields: 1, addedGroups: 1 });
    const done = await f.store.finish({ id: run.id, status: 'completed' });
    assert.equal(done.spans.length, 4);
    const root = done.spans.find(span => span.name === 'apply.run')!;
    const career = done.spans.find(span => span.name === 'career.run')!;
    const fill = done.spans.find(span => span.name === 'career.fill')!;
    const verify = done.spans.find(span => span.name === 'career.verify')!;
    assert.equal(career.parentId, root.id); assert.equal(fill.parentId, career.id); assert.equal(verify.parentId, career.id);
    assert.equal(root.parentId, undefined); assert.equal(fill.status, 'ok'); assert.ok(fill.durationMs >= 8);
    assert.ok(BigInt(fill.endTimeUnixNano) > BigInt(fill.startTimeUnixNano));
    assert.equal(fill.attributes['field.key'], 'school'); assert.equal(fill.attributes.value, undefined);
    assert.equal(done.observedVerifiedFields, 1);
    const otlp = f.store.jsonOTLP() as any;
    const exported = otlp.resourceSpans[0].scopeSpans[0].spans;
    assert.equal(exported.length, 4); assert.equal(exported.find((span: any) => span.name === 'career.fill').parentSpanId, career.id);
    assert.ok(exported.every((span: any) => span.traceId === done.traceId));
    assert.doesNotMatch(JSON.stringify(otlp), /PRIVATE-VALUE/u);
  } finally { await f.clean(); }
});

test('rules have zero model usage; genuine usage accumulates cache without double-counting total', async () => {
  const f = await fixture();
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    assert.deepEqual(run.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
    await f.store.step('form.recognize', async () => f.store.step('model.request', async () => {
      await f.store.modelCall(usage, { provider: 'test-provider', modelId: 'test-model' });
    }));
    await f.store.modelCall(usage);
    const done = await f.store.finish({ id: run.id, status: 'completed' });
    assert.equal(done.modelCalls, 2); assert.equal(done.usageComplete, true);
    assert.deepEqual(done.tokens, { input: 20, output: 10, cacheRead: 40, cacheWrite: 6, totalTokens: 76 });
    const model = done.spans.find(span => span.name === 'model.request')!;
    assert.equal(model.attributes['gen_ai.usage.input_tokens'], 33);
    assert.equal(model.attributes['gen_ai.usage.total_tokens'], 38);
    const root = done.spans.find(span => span.name === 'apply.run')!;
    assert.equal(root.attributes['gen_ai.usage.input_tokens'], 66);
    assert.equal(root.attributes['gen_ai.usage.total_tokens'], 76);
  } finally { await f.clean(); }
});

test('missing usage remains unknown and fixture responses cannot become real token evidence', async () => {
  const f = await fixture();
  try {
    const first = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    await f.store.modelCall(undefined); await f.store.modelCall(usage);
    const unknown = await f.store.finish({ id: first.id, status: 'partial' });
    assert.equal(unknown.tokens, null); assert.equal(unknown.usageComplete, false); assert.equal(unknown.modelCalls, 2);
    const second = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    await f.store.modelCall(usage, { fixture: true });
    const scripted = await f.store.finish({ id: second.id, status: 'completed' });
    assert.equal(scripted.source, 'fixture'); assert.equal(scripted.tokens, null);
  } finally { await f.clean(); }
});

test('one active run, no manual takeover, safe step rejection and no cross-run parenting', async () => {
  const f = await fixture();
  try {
    const manual = await f.store.begin({ mode: 'manual', scenarioKey: 'form:test' });
    await assert.rejects(f.store.begin({ mode: 'agent', scenarioKey: 'form:test' }));
    let calls = 0;
    assert.equal(await f.store.step('form.fill', async () => { calls++; return 7; }), 7);
    assert.equal(calls, 1); assert.equal(f.store.state().runs[0]!.spans.length, 0);
    await f.store.finish({ id: manual.id, status: 'completed' });
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    assert.equal((await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' })).id, run.id);
    const error = new Error('PRIVATE-PROVIDER-ERROR');
    await assert.rejects(f.store.step('form.fill', async () => { throw error; }), actual => actual === error);
    const done = await f.store.finish({ id: run.id, status: 'failed' });
    assert.equal(done.spans.find(span => span.name === 'form.fill')!.status, 'error');
    assert.doesNotMatch(JSON.stringify(f.store.jsonOTLP()), /PRIVATE-PROVIDER-ERROR/u);
    await assert.rejects(f.store.begin({ mode: 'agent', scenarioKey: 'https://private.example/apply' }));
  } finally { await f.clean(); }
});

test('review preserves executor evidence and comparison requires a complete paired review', async () => {
  const f = await fixture();
  try {
    const a = await f.store.begin({ mode: 'agent', scenarioKey: 'pair:1', expectedFields: 3, cleanStartConfirmed: true });
    await f.store.addCounts({ verifiedFields: 2 }); await pause(); await f.store.finish({ id: a.id, status: 'partial' });
    const agent = await f.store.review({ id: a.id, expectedFields: 3, verifiedFields: 3, manualCorrections: 1, interventions: 1, cleanStartConfirmed: true });
    assert.equal(agent.observedVerifiedFields, 2); assert.equal(agent.verifiedFields, 3);
    const m = await f.store.begin({ mode: 'manual', scenarioKey: 'pair:1', expectedFields: 3, cleanStartConfirmed: true });
    await pause(); await f.store.finish({ id: m.id, status: 'completed' });
    const manual = await f.store.review({ id: m.id, expectedFields: 3, verifiedFields: 3, manualCorrections: 0, interventions: 0, cleanStartConfirmed: true });
    const paired = compareTelemetryRuns({ ...agent, durationMs: 80, reviewDurationMs: 20, totalDurationMs: 100 },
      { ...manual, durationMs: 300, reviewDurationMs: 100, totalDurationMs: 400 });
    assert.equal(paired.comparable, true); assert.equal(paired.timeSavedPercent, 75);
    for (const patch of [{ reviewed: false }, { cleanStartConfirmed: false }, { scenarioKey: 'pair:2' },
      { source: 'fixture' }, { status: 'failed' }, { verifiedFields: 2 }, { expectedFields: 0 }, { totalDurationMs: undefined }, { reviewedAt: undefined }]) {
      assert.equal(compareTelemetryRuns(agent, { ...manual, ...patch } as TelemetryRun).comparable, false);
    }
    await assert.rejects(f.store.review({ id: a.id, expectedFields: 2, verifiedFields: 3, manualCorrections: 0, interventions: 0, cleanStartConfirmed: true }));
  } finally { await f.clean(); }
});

test('private persistence has restrictive permissions and crash recovery does not invent elapsed time', async () => {
  const f = await fixture();
  let recovered: TelemetryStore | undefined;
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    await f.store.step('form.observe', async () => {});
    // Simulate process loss: recovery sees the durable running record, with no synthetic end span.
    recovered = await TelemetryStore.create(f.directory);
    const interrupted = recovered.state().runs.find(value => value.id === run.id)!;
    assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.durationMs, undefined);
    assert.equal(recovered.state().activeRunId, undefined);
    assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(f.directory, 'trajectory.json'))).mode & 0o777, 0o600);
  } finally { await recovered?.close(); await f.clean(); }
});

test('unknown archive fields and sensitive attributes are removed; damaged archives are never overwritten', async () => {
  const f = await fixture();
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    await f.store.step('form.fill', async () => {}, { count: 1 }); await f.store.finish({ id: run.id, status: 'completed' });
    await f.store.close();
    const path = join(f.directory, 'trajectory.json');
    const archive = JSON.parse(await readFile(path, 'utf8'));
    archive.secret = 'PRIVATE-ARCHIVE'; archive.runs[0].profile = 'PRIVATE-RUN';
    archive.runs[0].spans[0].text = 'PRIVATE-SPAN'; archive.runs[0].spans[0].attributes.url = 'PRIVATE-URL';
    await writeFile(path, JSON.stringify(archive));
    const restored = await TelemetryStore.create(f.directory);
    assert.doesNotMatch(JSON.stringify(restored.state()), /PRIVATE/u); assert.doesNotMatch(JSON.stringify(restored.jsonOTLP()), /PRIVATE/u);
    await restored.close();
    const broken = '{"version":1,"runs":["broken"]}'; await writeFile(path, broken);
    await assert.rejects(TelemetryStore.create(f.directory)); assert.equal(await readFile(path, 'utf8'), broken);
    assert.deepEqual(safeTelemetryAttributes({ 'action.kind': 'submit', 'field.key': 'password', url: 'private',
      'gen_ai.request.model': 'https://private/key', count: -1, pendingFields: 4, fixture: true }), { pendingFields: 4, fixture: true });
  } finally { await f.clean(); }
});

test('local exporter storage failure stays visible without repeating or changing business work', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, 'trajectory.json'));
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    let calls = 0;
    assert.equal(await f.store.step('form.fill', async () => { calls++; return 'business-result'; }), 'business-result');
    await f.store.finish({ id: run.id, status: 'completed' });
    assert.equal(calls, 1); assert.ok(f.store.state().storageError);
  } finally { await f.clean(); }
});

test('retention is bounded and preserves the real root span after many child operations', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 101; index++) {
      const run = await f.store.begin({ mode: 'agent', scenarioKey: 'fixture:retention', source: 'fixture' });
      await f.store.finish({ id: run.id, status: 'completed' });
    }
    assert.equal(f.store.state().runs.length, 100);
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'fixture:span-limit', source: 'fixture' });
    for (let index = 0; index < 3005; index++) await f.store.step('form.observe', async () => {});
    const done = await f.store.finish({ id: run.id, status: 'completed' });
    assert.equal(done.spans.length, 3000); assert.equal(done.spans.filter(span => span.name === 'apply.run').length, 1);
    assert.equal(f.store.state().runs.length, 100);
  } finally { await f.clean(); }
});

test('volatile fallback keeps a damaged archive untouched and records business work once in memory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-telemetry-volatile-'));
  const path = join(directory, 'trajectory.json'), broken = '{"private":"PRIVATE-RAW-ERROR"';
  await writeFile(path, broken);
  await assert.rejects(TelemetryStore.create(directory));
  const store = TelemetryStore.volatile('PRIVATE-UNTRUSTED-ERROR');
  try {
    const run = await store.begin({ mode: 'agent', scenarioKey: 'form:test' });
    let calls = 0;
    assert.equal(await store.step('form.fill', async () => { calls++; return 42; }), 42);
    await store.addCounts({ verifiedFields: 1 });
    const result = await store.finish({ id: run.id, status: 'completed' });
    assert.equal(calls, 1); assert.equal(result.spans.length, 2); assert.equal(result.observedVerifiedFields, 1);
    assert.match(store.state().storageError!, /仅保存在内存/u);
    assert.doesNotMatch(JSON.stringify(store.state()), /PRIVATE/u);
    assert.equal(await readFile(path, 'utf8'), broken); assert.deepEqual(await readdir(directory), ['trajectory.json']);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('first final review includes checking time and repeated edits cannot shorten or reset it', async () => {
  const f = await fixture();
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'pair:review', expectedFields: 1 });
    await f.store.step('form.fill', async () => pause()); await f.store.addCounts({ verifiedFields: 1 });
    const execution = await f.store.finish({ id: run.id, status: 'completed' });
    assert.equal(execution.totalDurationMs, undefined);
    await new Promise<void>(resolve => setTimeout(resolve, 25));
    const input = { id: run.id, expectedFields: 1, verifiedFields: 1, manualCorrections: 0, interventions: 0, cleanStartConfirmed: true };
    const first = await f.store.review(input);
    assert.ok(first.reviewedAt); assert.ok(first.reviewDurationMs! >= 20);
    assert.equal(first.totalDurationMs, first.durationMs! + first.reviewDurationMs!);
    await pause();
    const edited = await f.store.review({ ...input, manualCorrections: 1 });
    assert.equal(edited.reviewedAt, first.reviewedAt); assert.equal(edited.reviewDurationMs, first.reviewDurationMs);
    assert.equal(edited.totalDurationMs, first.totalDurationMs); assert.equal(edited.manualCorrections, 1);
  } finally { await f.clean(); }
});

test('a first review after restart or a wall-clock rollback never invents comparable total timing', async () => {
  const f = await fixture(); let recovered: TelemetryStore | undefined;
  try {
    const run = await f.store.begin({ mode: 'agent', scenarioKey: 'pair:restart' });
    await f.store.finish({ id: run.id, status: 'completed' }); await f.store.close();
    recovered = await TelemetryStore.create(f.directory);
    const input = { id: run.id, expectedFields: 1, verifiedFields: 1, manualCorrections: 0, interventions: 0, cleanStartConfirmed: true };
    const reviewed = await recovered.review(input);
    assert.equal(reviewed.reviewed, true); assert.ok(reviewed.reviewedAt);
    assert.equal(reviewed.totalDurationMs, undefined); assert.equal(reviewed.reviewDurationMs, undefined);
    assert.equal(compareTelemetryRuns(reviewed, { ...reviewed, mode: 'manual', totalDurationMs: 100 }).comparable, false);
    const rollback = await recovered.begin({ mode: 'agent', scenarioKey: 'pair:rollback' });
    const finished = await recovered.finish({ id: rollback.id, status: 'completed' });
    const actualNow = Date.now;
    try {
      Date.now = () => Date.parse(finished.endedAt!) - 10;
      const result = await recovered.review({ ...input, id: rollback.id });
      assert.equal(result.totalDurationMs, undefined); assert.equal(result.reviewDurationMs, undefined);
    } finally { Date.now = actualNow; }
  } finally { await recovered?.close(); await f.clean(); }
});
