import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpeedsterMotion, initialSpeedsterState, updateSpeedsterState, type SpeedsterInput } from '../packages/ui/src/speedster.js';

const normal = { enabled: true, reducedMotion: false };
const run = (status: SpeedsterInput['status'], verifiedCount?: number, runKey = 'fictional-run-one'): SpeedsterInput => ({ status, runKey, verifiedCount });

test('idle and historical counts never start a running animation', () => {
  const original = initialSpeedsterState();
  for (const input of [run('idle'), run('idle', 30), run('completed', 30)]) {
    const state = updateSpeedsterState(original, input, 1000);
    const display = getSpeedsterMotion(state, input, 1000, normal);
    assert.equal(display.animated, false);
    assert.notEqual(display.motion, 'sprint');
  }
  assert.deepEqual(original, initialSpeedsterState());
});

test('reading and filling are distinct real-work animations without a fabricated numeric progress', () => {
  for (const [status, motion] of [['reading', 'reading'], ['filling', 'running']] as const) {
    const input = run(status);
    const display = getSpeedsterMotion(updateSpeedsterState(initialSpeedsterState(), input, 10), input, 10, normal);
    assert.equal(display.motion, motion); assert.equal(display.animated, true);
    assert.equal('percent' in display, false); assert.equal('verifiedCount' in display, false);
  }
});

test('mounting an active run with a historical positive count does not manufacture a new success', () => {
  const input = run('filling', 7);
  const state = updateSpeedsterState(initialSpeedsterState(), input, 1000);
  assert.equal(getSpeedsterMotion(state, input, 1000, normal).motion, 'running');
});

test('an independently reported count increase in the same active run makes one bounded sprint', () => {
  const before = updateSpeedsterState(initialSpeedsterState(), run('filling', 0), 1000);
  const input = run('filling', 2);
  const state = updateSpeedsterState(before, input, 1100);
  assert.equal(getSpeedsterMotion(state, input, 1100, normal).motion, 'sprint');
  assert.equal(getSpeedsterMotion(state, input, 1749, normal).motion, 'sprint');
  assert.equal(getSpeedsterMotion(state, input, 1750, normal).motion, 'running');
  assert.equal(before.verifiedCount, 0);
});

test('unchanged progress does not extend the success pulse through render or timer updates', () => {
  const first = updateSpeedsterState(initialSpeedsterState(), run('filling', 0), 1000);
  const input = run('filling', 1), sprint = updateSpeedsterState(first, input, 1100);
  const same = updateSpeedsterState(sprint, input, 1700);
  assert.equal(same.pulseUntil, sprint.pulseUntil);
  assert.equal(getSpeedsterMotion(same, input, 1750, normal).motion, 'running');
});

test('cross-run, missing-run, reset and decreasing counts never trigger a success sprint', () => {
  const before = updateSpeedsterState(initialSpeedsterState(), run('filling', 4), 1000);
  for (const input of [run('filling', 5, 'fictional-other-run'), { status: 'filling', verifiedCount: 5 } as const,
    run('filling', 0), run('filling', 3), run('filling')]) {
    const state = updateSpeedsterState(before, input, 1100);
    assert.notEqual(getSpeedsterMotion(state, input, 1100, normal).motion, 'sprint');
  }
});

test('unknown, fractional, nonfinite and negative counts cannot become a success report', () => {
  const before = updateSpeedsterState(initialSpeedsterState(), run('filling', 0), 1000);
  for (const count of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const input = run('filling', count), state = updateSpeedsterState(before, input, 1100);
    assert.notEqual(getSpeedsterMotion(state, input, 1100, normal).motion, 'sprint');
  }
});

test('retry produces a return pose from explicit work state rather than an apparent success', () => {
  const input: SpeedsterInput = { ...run('retrying', 2), retryAttempt: 1 };
  const state = updateSpeedsterState(initialSpeedsterState(), input, 1000);
  const display = getSpeedsterMotion(state, input, 1000, normal);
  assert.equal(display.motion, 'retry'); assert.equal(display.spriteState, 'return'); assert.equal(display.animated, true);
});

test('needs-info, login and stopped override any earlier success pulse and stop movement', () => {
  const first = updateSpeedsterState(initialSpeedsterState(), run('filling', 0), 1000);
  const active = updateSpeedsterState(first, run('filling', 1), 1100);
  for (const status of ['needs-info', 'waiting-login', 'stopped'] as const) {
    const input = run(status, 1), state = updateSpeedsterState(active, input, 1200);
    const display = getSpeedsterMotion(state, input, 1200, normal);
    assert.equal(display.animated, false);
    assert.equal(display.motion, status === 'stopped' ? 'stopped' : 'waiting');
  }
});

test('an increased count outside filling is never converted into an active sprint', () => {
  const before = updateSpeedsterState(initialSpeedsterState(), run('filling', 0), 1000);
  for (const status of ['idle', 'reading', 'needs-info', 'waiting-login', 'completed', 'stopped'] as const) {
    const input = run(status, 3), state = updateSpeedsterState(before, input, 1100);
    assert.notEqual(getSpeedsterMotion(state, input, 1100, normal).motion, 'sprint');
  }
});

test('reduced-motion preference and disabled effects stop every active animation without mutating observed state', () => {
  for (const status of ['reading', 'filling', 'retrying'] as const) {
    const input = run(status, 1), state = updateSpeedsterState(initialSpeedsterState(), input, 1000);
    const snapshot = structuredClone(state);
    for (const preference of [{ enabled: true, reducedMotion: true }, { enabled: false, reducedMotion: false }]) {
      assert.equal(getSpeedsterMotion(state, input, 1000, preference).animated, false);
      assert.deepEqual(state, snapshot);
    }
  }
});

test('successive new verified receipts can start a fresh pulse without changing business facts', () => {
  const original = Object.freeze({ ...run('filling', 0), applicationStatus: 'planned' });
  const first = updateSpeedsterState(initialSpeedsterState(), original, 1000);
  const secondInput = Object.freeze({ ...original, verifiedCount: 1 });
  const second = updateSpeedsterState(first, secondInput, 1100);
  const thirdInput = Object.freeze({ ...original, verifiedCount: 2 });
  const third = updateSpeedsterState(second, thirdInput, 2000);
  assert.equal(getSpeedsterMotion(third, thirdInput, 2000, normal).motion, 'sprint');
  assert.equal(original.applicationStatus, 'planned'); assert.equal(secondInput.verifiedCount, 1); assert.equal('applicationStatus' in third, false);
});
