import test from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryStore } from '../packages/telemetry/src/store.js';
import { TelemetryHost } from '../apps/desktop/telemetry-host.js';

test('host binds comparison to the actual page and profile without recording their values', async () => {
  const store = TelemetryStore.volatile();
  let version = 5;
  const host = new TelemetryHost(store, async () => ({ url: 'https://fictional.example/apply/private-candidate-123', version }), () => {}, false);
  try {
    const run = await host.begin({ mode: 'agent' });
    assert.match(run.scenarioKey, /^form:[a-f0-9]{24}$/u);
    await host.finish({ id: run.id, status: 'completed' });
    version++;
    await assert.rejects(host.begin({ mode: 'manual', scenarioKey: run.scenarioKey }), /不同/u);
    assert.doesNotMatch(JSON.stringify(host.state()), /private-candidate|fictional\.example/u);
    await assert.rejects(host.begin({ mode: 'manual', source: 'production' } as never), /无效/u);
  } finally { await store.close(); }
});

test('a detached UI cannot replace a business result or duplicate model usage', async () => {
  const store = TelemetryStore.volatile();
  const host = new TelemetryHost(store, async () => ({ url: 'https://fictional.example/apply', version: 1 }), () => { throw new Error('renderer detached'); }, false);
  let calls = 0;
  try {
    const run = await host.begin({ mode: 'agent' });
    const result = await host.step('model.request', async () => {
      calls++;
      await host.modelCall({ input: 10, output: 4, cacheRead: 3, cacheWrite: 0, totalTokens: 17 }, 'custom', 'fictional-model');
      return 'business-value';
    });
    assert.equal(result, 'business-value'); assert.equal(calls, 1);
    await host.counts(2, 1);
    const finished = await host.finish({ id: run.id, status: 'completed' });
    assert.equal(finished.modelCalls, 1); assert.equal(finished.tokens?.totalTokens, 17);
    assert.equal(finished.status, 'partial'); assert.equal(finished.observedVerifiedFields, 2);
  } finally { await store.close(); }
});

test('host retains an execution error and cancellation without inventing a successful result', async () => {
  const store = TelemetryStore.volatile();
  const host = new TelemetryHost(store, async () => ({ url: '', version: 0 }), () => { throw new Error('detached'); }, true);
  try {
    const run = await host.begin({ mode: 'agent' });
    const failure = new Error('private provider text');
    await assert.rejects(host.step('form.fill', async () => { throw failure; }), error => error === failure);
    const finished = await host.finish({ id: run.id, status: 'completed' });
    assert.equal(finished.status, 'failed'); assert.equal(finished.source, 'fixture');
    assert.doesNotMatch(JSON.stringify(host.state()), /private provider/u);
    const next = await host.begin({ mode: 'agent' }); host.cancel();
    assert.equal((await host.finish({ id: next.id, status: 'completed' })).status, 'cancelled');
  } finally { await store.close(); }
});
