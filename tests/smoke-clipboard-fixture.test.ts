import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { INSTALL_SMOKE_CLIPBOARD_FIXTURE, RESTORE_SMOKE_CLIPBOARD_FIXTURE } from '../apps/desktop/smoke-chat-ui.js';

function fixture(own = false) {
  let osWrites = 0;
  const original = async (_value: string) => { osWrites++; throw new Error('OS clipboard must not be used in this test'); };
  const clipboard = Object.create({ writeText: original }) as { writeText(value: string): Promise<void> };
  if (own) Object.defineProperty(clipboard, 'writeText', { value: original, configurable: true, enumerable: true, writable: false });
  const descriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
  const context = createContext({ window: {}, navigator: { clipboard } });
  return { clipboard, original, descriptor, context, osWrites: () => osWrites };
}

test('copy fixture captures exact multiline UI payload without invoking OS methods and restores inherited methods', async () => {
  const f = fixture();
  runInContext(INSTALL_SMOKE_CLIPBOARD_FIXTURE, f.context);
  const text = '## 虚构说明\n\n| 测试 | 内容 |\n| --- | --- |\n| A | **原文** |';
  await f.clipboard.writeText(text);
  assert.equal(runInContext('window.__offerAgentSmokeClipboard.writes[0]', f.context), text);
  assert.equal(f.osWrites(), 0);
  assert.equal(runInContext(RESTORE_SMOKE_CLIPBOARD_FIXTURE, f.context), true);
  assert.equal(Object.hasOwn(f.clipboard, 'writeText'), false);
  assert.equal(f.clipboard.writeText, f.original);
  assert.equal(runInContext('Object.hasOwn(window,"__offerAgentSmokeClipboard")', f.context), false);
});

test('fixture cleanup restores the exact own descriptor after an interrupted copy check', async () => {
  const f = fixture(true);
  runInContext(INSTALL_SMOKE_CLIPBOARD_FIXTURE, f.context);
  try {
    await f.clipboard.writeText('synthetic reply');
    throw new Error('simulated UI check failure');
  } catch (error) { assert.match((error as Error).message, /simulated UI check failure/); }
  finally { assert.equal(runInContext(RESTORE_SMOKE_CLIPBOARD_FIXTURE, f.context), true); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.clipboard, 'writeText'), f.descriptor);
  assert.equal(f.osWrites(), 0);
});

test('fixture refuses nested adapters and an immutable target instead of touching clipboard contents', () => {
  const f = fixture();
  runInContext(INSTALL_SMOKE_CLIPBOARD_FIXTURE, f.context);
  assert.throws(() => runInContext(INSTALL_SMOKE_CLIPBOARD_FIXTURE, f.context), /already installed/);
  runInContext(RESTORE_SMOKE_CLIPBOARD_FIXTURE, f.context);
  Object.defineProperty(f.clipboard, 'writeText', { value: f.original, configurable: false, writable: false });
  assert.throws(() => runInContext(INSTALL_SMOKE_CLIPBOARD_FIXTURE, f.context), /Cannot redefine property/);
  assert.equal(f.clipboard.writeText, f.original);
  assert.equal(f.osWrites(), 0);
  assert.equal(runInContext('Object.hasOwn(window,"__offerAgentSmokeClipboard")', f.context), false);
});
