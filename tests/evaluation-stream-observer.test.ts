import test from 'node:test';
import assert from 'node:assert/strict';
import { observeModelStreams, type ObservedModelStream } from '../packages/evaluation/src/stream-observer.js';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const usage = { input: 10, output: 5, cacheRead: 20, cacheWrite: 3, totalTokens: 38 };
const result = () => ({ usage: { ...usage, cost: { total: 99 }, private: 'PRIVATE-USAGE' }, stopReason: 'toolUse',
  content: [{ type: 'text', text: 'PRIVATE-MODEL-CONTENT' }], errorMessage: 'PRIVATE-ERROR' });

test('observer preserves exact stream/this/context/options identities and never consumes an event', async () => {
  const final = deferred<unknown>(); let iterations = 0; let resultReads = 0; const stream = {
    result() { resultReads++; assert.equal(this, stream); return final.promise; },
    [Symbol.asyncIterator]() { iterations++; throw new Error('Observer consumed events'); },
  };
  const context = { messages: [{ text: 'PRIVATE-PROMPT' }] }; const options = { apiKey: 'PRIVATE-KEY' };
  const model = { id: 'qwen-flash', provider: 'custom-eval', apiKey: 'PRIVATE-MODEL-KEY' };
  const seen: ObservedModelStream[] = [];
  class Runtime { marker = 'instance'; stream(input: unknown, inputContext: unknown, inputOptions: unknown) {
    assert.equal(this.marker, 'instance'); assert.equal(input, model); assert.equal(inputContext, context); assert.equal(inputOptions, options); return stream;
  } }
  const original = Runtime.prototype.stream; const restore = observeModelStreams(Runtime.prototype, value => { seen.push(value); });
  try {
    const returned = new Runtime().stream(model, context, options); assert.equal(returned, stream); assert.equal(iterations, 0);
    const response = result(); final.resolve(response); assert.equal(await returned.result(), response); await flush();
    assert.equal(resultReads, 2); assert.equal(seen.length, 1); assert.equal(iterations, 0);
    assert.deepEqual(seen[0]?.usage, usage); assert.equal(seen[0]?.provider, 'custom-eval'); assert.equal(seen[0]?.model, 'qwen-flash');
    assert.equal(seen[0]?.stopReason, 'toolUse'); assert.ok(Number.isFinite(seen[0]?.durationMs)); assert.ok(seen[0]!.durationMs >= 0);
    assert.doesNotMatch(JSON.stringify(seen), /PRIVATE|cost|content|apiKey|messages/u);
  } finally { restore(); }
  assert.equal(Runtime.prototype.stream, original);
});

test('nested streamSimple to stream observes shared stream once and descriptor restore is idempotent', async () => {
  const final = deferred<unknown>(); let reads = 0; const stream = { result() { reads++; return final.promise; } };
  const seen: ObservedModelStream[] = [];
  class Runtime { stream(_model: unknown) { return stream; } streamSimple(model: unknown) { return this.stream(model); } }
  const descriptors = ['stream', 'streamSimple'].map(name => Object.getOwnPropertyDescriptor(Runtime.prototype, name));
  const restore = observeModelStreams(Runtime.prototype, value => { seen.push(value); });
  const runtime = new Runtime(); runtime.streamSimple({ id: 'qwen-flash', provider: 'custom' }); runtime.stream({ id: 'qwen-flash', provider: 'custom' });
  final.resolve(result()); await flush(); assert.equal(reads, 1); assert.equal(seen.length, 1);
  restore(); restore();
  assert.deepEqual(['stream', 'streamSimple'].map(name => Object.getOwnPropertyDescriptor(Runtime.prototype, name)), descriptors);
});

test('rejected final promise is handled and reports only fixed error with unknown usage', async () => {
  const final = deferred<unknown>(); const seen: ObservedModelStream[] = [];
  class Runtime { stream() { return { result() { return final.promise; } }; } }
  const restore = observeModelStreams(Runtime.prototype, observation => { seen.push(observation); });
  try {
    new Runtime().stream(); final.reject(new Error('PRIVATE-ERROR')); await flush();
    assert.equal(seen[0]?.stopReason, 'error'); assert.equal(seen[0]?.usage, null);
    assert.doesNotMatch(JSON.stringify(seen), /PRIVATE/u);
  } finally { restore(); }
});

test('synchronous and asynchronous observer callback failures cannot reject or mutate Agent result', async () => {
  for (const callback of [() => { throw new Error('observer failure'); }, async () => { throw new Error('async observer failure'); }]) {
    const expected = result();
    class Runtime { stream() { return { result() { return Promise.resolve(expected); } }; } }
    const restore = observeModelStreams(Runtime.prototype, callback);
    try { assert.equal(await new Runtime().stream().result(), expected); await flush(); await flush(); }
    finally { restore(); }
  }
});

test('invalid or errored final usage remains null and unsafe metadata/raw stop reasons are not copied', async () => {
  for (const response of [{ ...result(), usage: { ...usage, totalTokens: 999 } }, { ...result(), usage: undefined },
    { ...result(), stopReason: 'error' }, { ...result(), stopReason: 'aborted' }, { ...result(), stopReason: 'PRIVATE-STOP' }]) {
    const seen: ObservedModelStream[] = [];
    class Runtime { stream(_model: unknown) { return { result() { return Promise.resolve(response); } }; } }
    const restore = observeModelStreams(Runtime.prototype, observation => { seen.push(observation); });
    try {
      new Runtime().stream({ id: 'sk-PRIVATE-KEY', provider: 'https://private.example?key=PRIVATE' }); await flush();
      assert.equal(seen[0]?.usage, null); assert.equal(seen[0]?.model, null); assert.equal(seen[0]?.provider, null);
      assert.doesNotMatch(JSON.stringify(seen), /PRIVATE/u);
    } finally { restore(); }
  }
});

test('restore cancels pending passive callbacks without touching stream settlement or other instrumentation', async () => {
  const final = deferred<unknown>(); let callbacks = 0;
  class Runtime { stream() { return { result() { return final.promise; } }; } }
  const original = Runtime.prototype.stream;
  const restore = observeModelStreams(Runtime.prototype, () => { callbacks++; });
  const stream = new Runtime().stream(); restore(); const expected = result(); final.resolve(expected);
  assert.equal(await stream.result(), expected); await flush(); assert.equal(callbacks, 0); assert.equal(Runtime.prototype.stream, original);
  const restoreAgain = observeModelStreams(Runtime.prototype, () => { callbacks++; });
  const replacement = function () { return { result() { return Promise.resolve(expected); } }; };
  Runtime.prototype.stream = replacement; restoreAgain(); assert.equal(Runtime.prototype.stream, replacement);
});

test('original synchronous stream error is preserved unchanged and observer never invents a duplicate result', () => {
  const expected = new Error('PRIVATE-ORIGINAL'); let callbacks = 0;
  class Runtime { stream() { throw expected; } }
  const restore = observeModelStreams(Runtime.prototype, () => { callbacks++; });
  try { assert.throws(() => new Runtime().stream(), error => error === expected); assert.equal(callbacks, 0); }
  finally { restore(); }
});

test('installation rejects duplicates/unsupported prototypes and atomically restores on partial patch failure', () => {
  assert.throws(() => observeModelStreams({}, () => {}), /No stream/);
  const prototype = { stream() { return {}; } };
  const restore = observeModelStreams(prototype, () => {});
  try { assert.throws(() => observeModelStreams(prototype, () => {}), /already/); } finally { restore(); }
  const original = prototype.stream;
  Object.defineProperty(prototype, 'streamSimple', { value: () => ({}), configurable: false, writable: false });
  assert.throws(() => observeModelStreams(prototype, () => {})); assert.equal(prototype.stream, original);
});
