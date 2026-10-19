import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readBenchmarkCredential } from '../packages/evaluation/src/credential-input.js';

function pipe() { const input = new PassThrough(); return { input, read: (timeoutMs = 1000) => readBenchmarkCredential(input as unknown as NodeJS.ReadStream, { timeoutMs }) }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('pipe reads exactly the first opaque line, preserves bytes, never examines a second line and removes listeners', async () => {
  const { input, read } = pipe(); const initialData = input.listenerCount('data'); const initialError = input.listenerCount('error');
  const pending = read(); input.write('  DEMO-OPAQUE-CREDENTIAL  \r\nSECOND-LINE\n');
  assert.equal(await pending, '  DEMO-OPAQUE-CREDENTIAL  ');
  assert.equal(input.listenerCount('data'), initialData); assert.equal(input.listenerCount('error'), initialError);
  assert.equal(input.destroyed, false); input.destroy();
});

test('simulated terminal uses raw mode plus silent output, with no credential printed to stdout or stderr', async () => {
  const { input } = pipe(); const tty = input as unknown as NodeJS.ReadStream;
  tty.isTTY = true; tty.isRaw = false; const rawChanges: boolean[] = [];
  tty.setRawMode = function(mode: boolean) { rawChanges.push(mode); this.isRaw = mode; return this; };
  const outputs: string[] = [];
  const stdout = process.stdout.write; const stderr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { outputs.push(String(chunk)); return true; }) as typeof stdout;
  process.stderr.write = ((chunk: string | Uint8Array) => { outputs.push(String(chunk)); return true; }) as typeof stderr;
  try {
    const pending = readBenchmarkCredential(tty, { timeoutMs: 1000 });
    input.write('DEMO-NOT-A-REAL-KEY\r'); assert.equal(await pending, 'DEMO-NOT-A-REAL-KEY');
    assert.equal(rawChanges[0], true); assert.equal(rawChanges.at(-1), false); assert.equal(tty.isRaw, false);
    assert.deepEqual(outputs, []);
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; input.destroy(); }
});

test('terminal input that was already raw is restored to its prior mode', async () => {
  const { input } = pipe(); const tty = input as unknown as NodeJS.ReadStream;
  tty.isTTY = true; tty.isRaw = true;
  tty.setRawMode = function(mode: boolean) { this.isRaw = mode; return this; };
  const pending = readBenchmarkCredential(tty, { timeoutMs: 1000 }); input.write('DEMO-KEY\r');
  assert.equal(await pending, 'DEMO-KEY'); assert.equal(tty.isRaw, true); input.destroy();
});

test('empty line, whitespace-only line and EOF without data have fixed credential-free errors', async () => {
  for (const line of ['\n', ' \t\n']) {
    const { input, read } = pipe(); const pending = read(); input.write(line);
    await assert.rejects(pending, /^Error: BENCHMARK_CREDENTIAL_EMPTY$/u); input.destroy();
  }
  const { input, read } = pipe(); const pending = read(); input.end();
  await assert.rejects(pending, /^Error: BENCHMARK_CREDENTIAL_CANCELLED$/u);
});

test('EOF after one nonempty pipe line is accepted and timeout settles without retaining listeners', async () => {
  const complete = pipe(); const pending = complete.read(); complete.input.end('DEMO-PIPE-EOF');
  assert.equal(await pending, 'DEMO-PIPE-EOF');
  const timeout = pipe(); const timed = timeout.read(5);
  await assert.rejects(timed, /^Error: BENCHMARK_CREDENTIAL_TIMEOUT$/u);
  assert.equal(timeout.input.listenerCount('data'), 0); assert.equal(timeout.input.listenerCount('error'), 0);
  timeout.input.destroy(); await flush();
});

test('explicit Ctrl-C and input errors cancel with fixed errors without echoing private error messages', async () => {
  const ctrl = pipe(); const cancelled = ctrl.read(); ctrl.input.write('DEMO-SECRET\x03');
  await assert.rejects(cancelled, /^Error: BENCHMARK_CREDENTIAL_CANCELLED$/u); ctrl.input.destroy();
  const error = pipe(); const failed = error.read(); error.input.emit('error', new Error('PRIVATE-ERROR-CONTAINING-KEY'));
  await assert.rejects(failed, /^Error: BENCHMARK_CREDENTIAL_READ_FAILED$/u); error.input.destroy();
});

test('4096-byte cap applies before newline and handles chunked/multibyte data without exposing rejected input', async () => {
  const max = pipe(); const accepted = max.read(); max.input.write('x'.repeat(4096) + '\n');
  assert.equal((await accepted).length, 4096); max.input.destroy();
  const over = pipe(); const tooLong = over.read(); over.input.write('x'.repeat(4000)); over.input.write('PRIVATE-KEY'.repeat(20));
  await assert.rejects(tooLong, /^Error: BENCHMARK_CREDENTIAL_TOO_LONG$/u); over.input.destroy();
  const utf8 = pipe(); const unicodeTooLong = utf8.read(); utf8.input.write('字'.repeat(1366));
  await assert.rejects(unicodeTooLong, /^Error: BENCHMARK_CREDENTIAL_TOO_LONG$/u); utf8.input.destroy();
});

test('invalid timeout and already-ended inputs reject deterministically without starting a reader', async () => {
  const { input } = pipe();
  await assert.rejects(readBenchmarkCredential(input as unknown as NodeJS.ReadStream, { timeoutMs: 0 }), /BENCHMARK_CREDENTIAL_INVALID_TIMEOUT/u);
  assert.equal(input.listenerCount('data'), 0); input.destroy();
  await assert.rejects(readBenchmarkCredential(input as unknown as NodeJS.ReadStream), /BENCHMARK_CREDENTIAL_CANCELLED/u);
});
