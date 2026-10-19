import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmokeDeadlineError, SmokeStepRunner } from '../apps/desktop/smoke-deadline.js';

test('a suspended renderer step fails with its stage and permanently refuses later UI work', async () => {
  const steps = new SmokeStepRunner('fixture');
  steps.setStage('awaiting-render');
  let finish: ((value: string) => void) | undefined;
  await assert.rejects(steps.run('animation-frame', () => new Promise<string>(resolve => { finish = resolve; }), 10), (error: unknown) => {
    assert.ok(error instanceof SmokeDeadlineError);
    assert.equal(error.stage, 'awaiting-render');
    assert.equal(error.operation, 'animation-frame');
    return true;
  });
  finish!('late renderer response');
  await new Promise(resolve => setImmediate(resolve));
  let nativeFollowup = false;
  await assert.rejects(steps.run('native-click', async () => { nativeFollowup = true; }), SmokeDeadlineError);
  assert.equal(nativeFollowup, false);
  assert.equal(steps.snapshot().pendingOperationCancelled, false);
  assert.equal(steps.snapshot().status, 'timed-out');
});

test('renderer errors retain their actual cause and a completed step clears its deadline', async () => {
  const steps = new SmokeStepRunner('fixture');
  const original = new Error('missing fixture control');
  await assert.rejects(steps.run('read-control', async () => { throw original; }, 20), error => error === original);
  assert.equal(await steps.run('render-ready', async () => true, 10), true);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(await steps.run('check-result', async () => 'read back'), 'read back');
  assert.equal(steps.snapshot().status, 'idle');
});

test('a pending UI step prevents competing native operations and observes late rejection', async () => {
  const steps = new SmokeStepRunner('fixture');
  let fail: ((error: Error) => void) | undefined;
  const pending = steps.run('pending-render', () => new Promise<never>((_resolve, reject) => { fail = reject; }), 10);
  await assert.rejects(steps.run('competing-click', async () => true), /overlapping UI smoke operations/);
  await assert.rejects(pending, SmokeDeadlineError);
  fail!(new Error('late renderer rejection'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(steps.snapshot().status, 'timed-out');
});
