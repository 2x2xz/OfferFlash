import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Execute the actual side-effect-free startup guard without importing Electron,
// creating a store, reading the real environment or opening any window.
const source = await readFile(new URL('../apps/desktop/backend.ts', import.meta.url), 'utf8');
const start = source.indexOf("const smoke = process.argv.includes('--smoke-test');");
const end = source.indexOf('// Preview packages', start);
assert.ok(start >= 0 && end > start);
const guard = source.slice(start, end);
const modes = ['--smoke-feishu-only', '--smoke-career-ui-only', '--smoke-career-suite', '--smoke-native-pointer-only', '--smoke-telemetry-only', '--smoke-workspace-only'];
function check(argv: string[]) {
  return runInNewContext(`${guard}\n({smoke,smokeNativePointerOnly,enabledSmokeSubmodes});`,
    { process: { argv: ['node', 'fixture', ...argv], env: {} } }) as { smoke: boolean; smokeNativePointerOnly: boolean; enabledSmokeSubmodes: string[] };
}

test('every smoke submode requires isolation and incompatible exclusive submodes fail before startup', () => {
  for (const mode of modes) {
    assert.throws(() => check([mode]), /必须同时指定隔离 smoke/u);
    assert.throws(() => check(['--smoke-test', '--live-product-check', mode]), /必须分别运行/u);
  }
  for (let first = 0; first < modes.length; first++) for (let second = first + 1; second < modes.length; second++) {
    assert.throws(() => check(['--smoke-test', modes[first]!, modes[second]!]), /只能选择一个/u);
  }
});

test('the pointer-only flag selects only its focused path while ordinary and existing smoke modes remain distinct', () => {
  assert.equal(check([]).smoke, false);
  assert.equal(check([]).smokeNativePointerOnly, false);
  assert.equal(check(['--smoke-test']).enabledSmokeSubmodes.length, 0);
  for (const mode of modes) {
    const result = check(['--smoke-test', mode]);
    assert.equal(result.smoke, true);
    assert.equal(result.smokeNativePointerOnly, mode === '--smoke-native-pointer-only');
    assert.equal(JSON.stringify(result.enabledSmokeSubmodes), JSON.stringify([mode]));
  }
});
