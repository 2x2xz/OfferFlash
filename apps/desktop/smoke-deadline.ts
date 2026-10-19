export class SmokeDeadlineError extends Error {
  constructor(readonly scope: string, readonly stage: string, readonly operation: string, readonly timeoutMs: number) {
    super(`${scope} / ${stage} / ${operation} exceeded ${timeoutMs}ms; the pending native/renderer operation is not cancelled, so this UI scope has stopped.`);
    this.name = 'SmokeDeadlineError';
  }
}

/** A test-side deadline stops follow-up UI work; it cannot cancel Electron operations already in flight. */
export class SmokeStepRunner {
  private stage = 'initializing';
  private operation = '';
  private running = false;
  private timedOut: SmokeDeadlineError | undefined;

  constructor(private readonly scope: string) {}

  setStage(stage: string) { this.stage = stage; }

  assertActive() {
    if (this.timedOut) throw this.timedOut;
  }

  snapshot() {
    return {
      scope: this.scope,
      stage: this.stage,
      operation: this.operation,
      status: this.timedOut ? 'timed-out' : this.running ? 'running' : 'idle',
      ...(this.timedOut ? { timeoutMs: this.timedOut.timeoutMs, pendingOperationCancelled: false, followupUIStopped: true } : {}),
    };
  }

  async run<T>(operation: string, work: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
    this.assertActive();
    if (this.running) throw new Error(`${this.scope}: overlapping UI smoke operations are not allowed.`);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('UI smoke deadline must be positive.');
    this.running = true;
    this.operation = operation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.timedOut = new SmokeDeadlineError(this.scope, this.stage, operation, timeoutMs);
            reject(this.timedOut);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.running = false;
    }
  }
}
