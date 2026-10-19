import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';

const MAX_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Only an explicitly supplied stdin line; no environment, file, Keychain, logging, or persistence. */
export function readBenchmarkCredential(
  input: NodeJS.ReadStream = process.stdin,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<string> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) return Promise.reject(new Error('BENCHMARK_CREDENTIAL_INVALID_TIMEOUT'));
  return new Promise<string>((resolve, reject) => {
    let interface_: Interface | undefined; let settled = false; let firstLineEnded = false; let bytes = 0;
    const wasRaw = input.isRaw === true;
    // In terminal mode readline directs its normal key echo here, never to stdout/stderr.
    const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const timer = setTimeout(() => finish('BENCHMARK_CREDENTIAL_TIMEOUT'), timeoutMs);
    function finish(errorCode: string | null, value?: string): void {
      if (settled) return; settled = true;
      clearTimeout(timer);
      input.removeListener('data', onData); input.removeListener('error', onError);
      interface_?.removeListener('line', onLine); interface_?.removeListener('close', onClose); interface_?.removeListener('SIGINT', onCancel);
      try { interface_?.close(); } catch { /* Never surface raw stream failures or credentials. */ }
      // An input 'error' emit may already have snapshotted readline's forwarding listener.
      // Retain the sanitizing interface listener until that synchronous emission has finished.
      queueMicrotask(() => { interface_?.removeListener('error', onError); });
      if (wasRaw && input.isTTY && typeof input.setRawMode === 'function') {
        try { input.setRawMode(true); } catch { /* Best-effort restoration only. */ }
      }
      silent.destroy();
      if (errorCode) reject(new Error(errorCode)); else resolve(value!);
    }
    function onError(): void { finish('BENCHMARK_CREDENTIAL_READ_FAILED'); }
    function onCancel(): void { finish('BENCHMARK_CREDENTIAL_CANCELLED'); }
    function onClose(): void { finish('BENCHMARK_CREDENTIAL_CANCELLED'); }
    function onLine(line: string): void {
      if (Buffer.byteLength(line, 'utf8') > MAX_BYTES) { finish('BENCHMARK_CREDENTIAL_TOO_LONG'); return; }
      if (!line.trim()) { finish('BENCHMARK_CREDENTIAL_EMPTY'); return; }
      finish(null, line);
    }
    function onData(chunk: unknown): void {
      if (settled || firstLineEnded) return;
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.isBuffer(chunk) ? chunk : null;
      if (!buffer) { finish('BENCHMARK_CREDENTIAL_READ_FAILED'); return; }
      let end = buffer.length;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 3) { finish('BENCHMARK_CREDENTIAL_CANCELLED'); return; }
        if (buffer[i] === 10 || buffer[i] === 13) { end = i; firstLineEnded = true; break; }
      }
      bytes += end;
      if (bytes > MAX_BYTES) finish('BENCHMARK_CREDENTIAL_TOO_LONG');
    }
    try {
      if (input.destroyed || input.readableEnded) { finish('BENCHMARK_CREDENTIAL_CANCELLED'); return; }
      input.on('data', onData); input.on('error', onError);
      interface_ = createInterface({ input, output: silent, terminal: input.isTTY === true, crlfDelay: Infinity, historySize: 0 });
      interface_.on('line', onLine); interface_.on('close', onClose); interface_.on('SIGINT', onCancel); interface_.on('error', onError);
    } catch { finish('BENCHMARK_CREDENTIAL_READ_FAILED'); }
  });
}
