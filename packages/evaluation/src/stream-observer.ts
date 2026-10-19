/** Process-local, benchmark-only observer. Does not read prompts, options, credentials or message content. */
export interface ObservedModelUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
export type ObservedStopReason = 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred' | 'unknown';
export interface ObservedModelStream {
  provider: string | null; model: string | null;
  usage: ObservedModelUsage | null; stopReason: ObservedStopReason;
  /** Monotonic elapsed time from the observed stream call until finalResultPromise settles. */
  durationMs: number;
}
type Observer = (observation: ObservedModelStream) => void | Promise<void>;
type Method = (this: unknown, ...args: unknown[]) => unknown;
const installed = new WeakSet<object>();
const stopReasons: readonly string[] = ['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const safeModelId = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/u.test(value)
  && !/(?:^sk-|api.?key|secret|bearer)/iu.test(value) ? value : null;
function usageOf(value: unknown): ObservedModelUsage | null {
  if (!record(value)) return null;
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
  if (!keys.every(key => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)) return null;
  const usage = Object.fromEntries(keys.map(key => [key, value[key]])) as unknown as ObservedModelUsage;
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite === usage.totalTokens ? usage : null;
}

/**
 * Wraps only stream/streamSimple, preserving this/argument identity and the exact returned stream.
 * result() in the pinned Pi SDK returns its independent finalResultPromise; no events are consumed.
 * Restore after the evaluated task settles: restoring also disables pending observation callbacks.
 */
export function observeModelStreams(runtimePrototype: object, callback: Observer): () => void {
  if (!runtimePrototype || typeof runtimePrototype !== 'object' || typeof callback !== 'function') throw new Error('Invalid stream observer target.');
  if (installed.has(runtimePrototype)) throw new Error('A stream observer is already installed.');
  const prototype = runtimePrototype as Record<string, unknown>;
  const seen = new WeakSet<object>();
  const patches: Array<{ name: string; originalDescriptor: PropertyDescriptor | undefined; wrapped: Method }> = [];
  let active = true;
  function deliver(metadata: { provider: string | null; model: string | null }, started: number, result: unknown, rejected: boolean): void {
    if (!active) return;
    let observation: ObservedModelStream;
    try {
      const candidate = !rejected && record(result) ? result : null;
      const stopReason: ObservedStopReason = rejected ? 'error' : candidate && typeof candidate.stopReason === 'string'
        && stopReasons.includes(candidate.stopReason) ? candidate.stopReason as ObservedStopReason : 'unknown';
      observation = { ...metadata, stopReason,
        usage: candidate && ['stop', 'length', 'toolUse'].includes(stopReason) ? usageOf(candidate.usage) : null,
        durationMs: Math.max(0, performance.now() - started) };
    } catch {
      // Hostile/invalid response getters must not alter the Agent's original result or leak errors.
      observation = { ...metadata, stopReason: 'unknown', usage: null, durationMs: Math.max(0, performance.now() - started) };
    }
    void Promise.resolve().then(() => { if (active) return callback(observation); }).catch(() => { /* passive observer only */ });
  }
  function restore(): void {
    if (!active) return; active = false;
    for (const patch of patches.reverse()) {
      // Do not overwrite instrumentation installed by somebody else after this observer.
      if (prototype[patch.name] !== patch.wrapped) continue;
      if (patch.originalDescriptor) Object.defineProperty(runtimePrototype, patch.name, patch.originalDescriptor);
      else delete prototype[patch.name];
    }
    installed.delete(runtimePrototype);
  }
  try {
    for (const name of ['stream', 'streamSimple']) {
      const original = prototype[name]; if (typeof original !== 'function') continue;
      const originalDescriptor = Object.getOwnPropertyDescriptor(runtimePrototype, name);
      const wrapped: Method = function (this: unknown, ...args: unknown[]): unknown {
        const started = performance.now();
        let metadata = { provider: null as string | null, model: null as string | null };
        try { if (record(args[0])) metadata = { provider: safeModelId(args[0].provider), model: safeModelId(args[0].id) }; } catch { /* no raw metadata */ }
        // Preserve synchronous errors unchanged. Only returned streams are observations; nested failures are not double-counted.
        const stream = Reflect.apply(original, this, args) as unknown;
        if (!active || !record(stream) || seen.has(stream)) return stream;
        seen.add(stream);
        try {
          const resultMethod = stream.result;
          if (typeof resultMethod !== 'function') { deliver(metadata, started, null, true); return stream; }
          const finalResult = Reflect.apply(resultMethod, stream, []) as unknown;
          void Promise.resolve(finalResult).then(result => { deliver(metadata, started, result, false); },
            () => { deliver(metadata, started, null, true); }).catch(() => { /* observer extraction cannot reject the stream */ });
        } catch { deliver(metadata, started, null, true); }
        return stream;
      };
      Object.defineProperty(runtimePrototype, name, originalDescriptor ? { ...originalDescriptor, value: wrapped } : {
        configurable: true, enumerable: false, writable: true, value: wrapped,
      });
      patches.push({ name, originalDescriptor, wrapped });
    }
    if (!patches.length) throw new Error('No stream methods are available to observe.');
    installed.add(runtimePrototype);
    return restore;
  } catch (error) { restore(); throw error; }
}
