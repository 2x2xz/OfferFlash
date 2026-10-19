import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, rename, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT_CONTEXT, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import type {
  TelemetryBeginInput, TelemetryFinishInput, TelemetryReviewInput, TelemetryRun,
  TelemetryState, TelemetryStepName, TelemetryTokens,
} from './contracts.js';

const MAX_RUNS = 100, MAX_SPANS = 3000;
const STEP_NAMES = new Set<TelemetryStepName>(['form.observe', 'form.recognize', 'form.fill', 'form.verify',
  'career.prepare', 'career.add', 'career.fill', 'career.retry', 'career.verify', 'career.run', 'model.request', 'tool.execute', 'agent.task']);
const ZERO = (): TelemetryTokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
const safeToken = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/u.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000_000;
const finiteCount = (value: unknown, name: string): number => { if (!count(value)) throw new TypeError(`无效${name}。`); return value; };
const ns = (time: readonly [number, number]): string => (BigInt(time[0]) * 1_000_000_000n + BigInt(time[1])).toString();
const milliseconds = (time: readonly [number, number]): number => time[0] * 1000 + time[1] / 1_000_000;
const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
function validUsage(value: unknown): value is TelemetryTokens {
  return !!value && typeof value === 'object' && tokenKeys.every(key => count((value as Record<string, unknown>)[key]));
}

/** Values and free text are deliberately absent from this vocabulary. */
export function safeTelemetryAttributes(input?: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== 'object') return output;
  const enums: Record<string, readonly string[]> = {
    'action.kind': ['add', 'fill', 'observe', 'verify', 'recognize', 'retry'],
    'collection': ['educations', 'internships', 'projects'],
    'field.key': ['fullName', 'fullNameEn', 'email', 'phone', 'school', 'schoolEn', 'major', 'majorEn', 'degree',
      'graduationMonth', 'startDate', 'endDate', 'company', 'title', 'role', 'name', 'description', 'link'],
    'status': ['running', 'completed', 'partial', 'cancelled', 'failed', 'interrupted', 'verified', 'unknown', 'intent', 'rules', 'model', 'fallback'],
    'run.mode': ['agent', 'manual'], 'run.source': ['production', 'fixture'],
  };
  for (const [key, value] of Object.entries(input)) {
    if (enums[key]?.includes(value as string)) output[key] = value as string;
    else if (['attempt', 'count', 'verifiedFields', 'pendingFields', 'addedGroups', 'gen_ai.usage.input_tokens',
      'gen_ai.usage.output_tokens', 'gen_ai.usage.cache_read_tokens', 'gen_ai.usage.cache_write_tokens',
      'gen_ai.usage.total_tokens', 'modelCalls'].includes(key) && count(value)) output[key] = value;
    else if (['gen_ai.provider.name', 'gen_ai.request.model', 'scenario.key'].includes(key) && safeToken(value)) output[key] = value;
    else if (['usageComplete', 'fixture'].includes(key) && typeof value === 'boolean') output[key] = value;
  }
  return output;
}

interface Archive { version: 1; runs: TelemetryRun[]; }
function validateArchive(value: unknown): TelemetryRun[] {
  if (!value || typeof value !== 'object') throw new Error('执行记录格式无效，原文件已保留。');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !Array.isArray(raw.runs) || raw.runs.length > MAX_RUNS) throw new Error('执行记录格式无效，原文件已保留。');
  const runs = raw.runs as TelemetryRun[];
  const ids = new Set<string>();
  for (const run of runs) {
    if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(run.id) || ids.has(run.id)
      || !/^[0-9a-f]{32}$/u.test(run.traceId) || !safeToken(run.scenarioKey)
      || !['agent', 'manual'].includes(run.mode) || !['production', 'fixture'].includes(run.source)
      || !['running', 'completed', 'partial', 'cancelled', 'failed', 'interrupted'].includes(run.status)
      || !Number.isFinite(Date.parse(run.startedAt)) || (run.endedAt !== undefined && !Number.isFinite(Date.parse(run.endedAt)))
      || (run.durationMs !== undefined && (!Number.isFinite(run.durationMs) || run.durationMs < 0))
      || (run.reviewedAt !== undefined && !Number.isFinite(Date.parse(run.reviewedAt)))
      || (run.reviewDurationMs !== undefined && (!Number.isFinite(run.reviewDurationMs) || run.reviewDurationMs < 0))
      || (run.totalDurationMs !== undefined && (!Number.isFinite(run.totalDurationMs) || run.totalDurationMs < 0))
      || (run.totalDurationMs !== undefined && (!run.reviewedAt || run.reviewDurationMs === undefined || run.durationMs === undefined
        || Math.abs(run.totalDurationMs - run.durationMs - run.reviewDurationMs) > 0.001))
      || (run.expectedFields !== undefined && !count(run.expectedFields))
      || !['verifiedFields', 'observedVerifiedFields', 'pendingFields', 'addedGroups', 'manualCorrections', 'interventions', 'modelCalls'].every(key => count((run as unknown as Record<string, unknown>)[key]))
      || !['usageComplete', 'reviewed', 'cleanStartConfirmed'].every(key => typeof (run as unknown as Record<string, unknown>)[key] === 'boolean')
      || (run.tokens !== null && !validUsage(run.tokens))
      || !Array.isArray(run.spans) || run.spans.length > MAX_SPANS) throw new Error('执行记录格式无效，原文件已保留。');
    ids.add(run.id);
    for (const span of run.spans) {
      if (!span || typeof span !== 'object' || !/^[0-9a-f]{16}$/u.test(span.id)
        || (span.parentId !== undefined && !/^[0-9a-f]{16}$/u.test(span.parentId))
        || !['apply.run', ...STEP_NAMES].includes(span.name) || !Number.isFinite(Date.parse(span.startedAt))
        || !Number.isFinite(span.durationMs) || span.durationMs < 0 || !['ok', 'error', 'unset'].includes(span.status)
        || !/^\d{1,30}$/u.test(span.startTimeUnixNano) || !/^\d{1,30}$/u.test(span.endTimeUnixNano)
        || !span.attributes || typeof span.attributes !== 'object') throw new Error('执行记录格式无效，原文件已保留。');
      // Archives are also untrusted input: discard unknown attributes before any display/export.
      span.attributes = safeTelemetryAttributes(span.attributes);
    }
  }
  return runs.map(run => ({ id: run.id, traceId: run.traceId, mode: run.mode, scenarioKey: run.scenarioKey,
    startedAt: run.startedAt, ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}), status: run.status,
    ...(run.reviewedAt !== undefined ? { reviewedAt: run.reviewedAt } : {}),
    ...(run.reviewDurationMs !== undefined ? { reviewDurationMs: run.reviewDurationMs } : {}),
    ...(run.totalDurationMs !== undefined ? { totalDurationMs: run.totalDurationMs } : {}),
    ...(run.expectedFields !== undefined ? { expectedFields: run.expectedFields } : {}),
    verifiedFields: run.verifiedFields, observedVerifiedFields: run.observedVerifiedFields,
    pendingFields: run.pendingFields, addedGroups: run.addedGroups, manualCorrections: run.manualCorrections,
    interventions: run.interventions, modelCalls: run.modelCalls,
    tokens: run.tokens === null ? null : Object.fromEntries(tokenKeys.map(key => [key, run.tokens![key]])) as unknown as TelemetryTokens,
    usageComplete: run.usageComplete, reviewed: run.reviewed, cleanStartConfirmed: run.cleanStartConfirmed, source: run.source,
    spans: run.spans.map(span => ({ id: span.id, ...(span.parentId ? { parentId: span.parentId } : {}), name: span.name,
      startedAt: span.startedAt, durationMs: span.durationMs, status: span.status, attributes: safeTelemetryAttributes(span.attributes),
      startTimeUnixNano: span.startTimeUnixNano, endTimeUnixNano: span.endTimeUnixNano })) }));
}

/** Real SDK tracing with a local-only exporter. No global registration or network instrumentation. */
export class TelemetryStore {
  private readonly provider: BasicTracerProvider;
  private readonly tracer;
  private runs: TelemetryRun[] = [];
  private activeRunId?: string;
  private activeSpan?: Span;
  private activeStart?: number;
  private storageError?: string;
  private readonly context = new AsyncLocalStorage<{ runId: string; span: Span }>();
  private readonly reviewClocks = new Map<string, { performanceEnd: number; wallEnd: number }>();
  private writes: Promise<void> = Promise.resolve();
  private writing = false;
  private dirty = false;
  private closed = false;
  private constructor(private readonly directory?: string) {
    if (!directory) this.storageError = '执行记录文件暂时无法读取，本轮轨迹仅保存在内存，重启后丢失；原存档已保留。';
    const exporter: SpanExporter = {
      export: (spans, callback) => {
        try { for (const span of spans) this.acceptSpan(span); callback({ code: 0 }); }
        catch { this.storageError = '轨迹记录暂时失败，业务操作未因此重试。'; callback({ code: 1 }); }
      },
      shutdown: async () => {},
    };
    this.provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    this.tracer = this.provider.getTracer('offeragent-local-trajectory', '1.0.0');
  }
  /** Keeps the application usable without replacing, moving or repairing a damaged archive. */
  static volatile(_reason?: string): TelemetryStore {
    // Arbitrary exception text must never reach the renderer or exported trajectory.
    return new TelemetryStore();
  }
  static async create(directory: string): Promise<TelemetryStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const store = new TelemetryStore(directory);
    try { store.runs = validateArchive(JSON.parse(await readFile(join(directory, 'trajectory.json'), 'utf8'))); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        await store.provider.shutdown(); throw new Error('执行记录无法读取，原文件已保留。');
      }
    }
    let changed = false;
    for (const run of store.runs) if (run.status === 'running') {
      run.status = 'interrupted'; run.endedAt = new Date().toISOString();
      // No guessed completion time: elapsed time is unknown after process interruption.
      delete run.durationMs; changed = true;
    }
    if (changed) await store.persist();
    return store;
  }
  state(): TelemetryState {
    return structuredClone({ runs: this.runs, ...(this.activeRunId ? { activeRunId: this.activeRunId } : {}),
      ...(this.storageError ? { storageError: this.storageError } : {}) });
  }
  private currentAgent(): TelemetryRun | undefined { return this.runs.find(run => run.id === this.activeRunId && run.mode === 'agent' && run.status === 'running'); }
  private assertOpen() { if (this.closed) throw new Error('轨迹记录已关闭。'); }
  async begin(input: TelemetryBeginInput): Promise<TelemetryRun> {
    this.assertOpen();
    if (!input || !['agent', 'manual'].includes(input.mode) || !safeToken(input.scenarioKey)
      || (input.source !== undefined && !['production', 'fixture'].includes(input.source))
      || (input.cleanStartConfirmed !== undefined && typeof input.cleanStartConfirmed !== 'boolean')) throw new TypeError('无效任务记录。');
    if (input.expectedFields !== undefined) finiteCount(input.expectedFields, '目标字段数');
    const active = this.runs.find(run => run.id === this.activeRunId);
    if (active) {
      if (input.mode === 'agent' && active.mode === 'agent') return structuredClone(active);
      throw new Error('请先结束当前计时，再开始另一轮。');
    }
    const startedAt = new Date().toISOString();
    const span = this.tracer.startSpan('apply.run', { attributes: safeTelemetryAttributes({ 'run.mode': input.mode,
      'run.source': input.source ?? 'production', 'scenario.key': input.scenarioKey }) }, ROOT_CONTEXT);
    const run: TelemetryRun = { id: randomUUID(), traceId: span.spanContext().traceId, mode: input.mode,
      scenarioKey: input.scenarioKey, startedAt, status: 'running', ...(input.expectedFields !== undefined ? { expectedFields: input.expectedFields } : {}),
      verifiedFields: 0, observedVerifiedFields: 0, pendingFields: 0, addedGroups: 0, manualCorrections: 0, interventions: 0, modelCalls: 0,
      tokens: ZERO(), usageComplete: true, reviewed: false, cleanStartConfirmed: input.cleanStartConfirmed ?? false,
      source: input.source ?? 'production', spans: [] };
    this.runs.push(run); this.runs = this.runs.slice(-MAX_RUNS);
    for (const id of this.reviewClocks.keys()) if (!this.runs.some(candidate => candidate.id === id)) this.reviewClocks.delete(id);
    this.activeRunId = run.id; this.activeSpan = span; this.activeStart = performance.now();
    await this.persist(); return structuredClone(run);
  }
  async finish(input: TelemetryFinishInput): Promise<TelemetryRun> {
    this.assertOpen();
    if (!input || !['completed', 'partial', 'cancelled', 'failed'].includes(input.status)) throw new TypeError('无效任务结束状态。');
    const run = this.runs.find(candidate => candidate.id === input.id);
    if (!run || run.id !== this.activeRunId || run.status !== 'running') throw new Error('本轮计时已结束或不存在。');
    run.status = input.status; run.endedAt = new Date().toISOString();
    run.durationMs = Math.max(0, performance.now() - this.activeStart!);
    this.reviewClocks.set(run.id, { performanceEnd: performance.now(), wallEnd: Date.parse(run.endedAt) });
    this.activeSpan?.setAttributes(safeTelemetryAttributes({ status: run.status, verifiedFields: run.verifiedFields,
      pendingFields: run.pendingFields, addedGroups: run.addedGroups, modelCalls: run.modelCalls, usageComplete: run.usageComplete }));
    this.activeSpan?.setStatus({ code: input.status === 'failed' || input.status === 'cancelled' ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    this.activeSpan?.end(); this.activeRunId = undefined; this.activeSpan = undefined; this.activeStart = undefined;
    await this.provider.forceFlush(); await this.persist(); return structuredClone(run);
  }
  async review(input: TelemetryReviewInput): Promise<TelemetryRun> {
    this.assertOpen();
    const run = this.runs.find(candidate => candidate.id === input?.id);
    if (!run || run.status === 'running') throw new Error('请先结束本轮计时，再复核结果。');
    const expected = finiteCount(input.expectedFields, '目标字段数'), verified = finiteCount(input.verifiedFields, '核实字段数');
    const corrections = finiteCount(input.manualCorrections, '修正次数'), interventions = finiteCount(input.interventions, '接管次数');
    if (typeof input.cleanStartConfirmed !== 'boolean' || verified > expected) throw new TypeError('核实字段数不能超过目标字段数。');
    run.expectedFields = expected; run.verifiedFields = verified; run.manualCorrections = corrections;
    run.interventions = interventions; run.cleanStartConfirmed = input.cleanStartConfirmed;
    if (!run.reviewed) {
      const now = Date.now(), clock = this.reviewClocks.get(run.id);
      run.reviewedAt = new Date(now).toISOString();
      if (clock && run.durationMs !== undefined) {
        const wallElapsed = now - clock.wallEnd, monotonicElapsed = performance.now() - clock.performanceEnd;
        // Clock changes or a reopened process make a fair end-to-end duration unknown.
        // A few milliseconds allow Date's integer precision without trusting a clock jump.
        if (wallElapsed >= 0 && monotonicElapsed >= 0 && Math.abs(wallElapsed - monotonicElapsed) <= 5) {
          run.reviewDurationMs = wallElapsed; run.totalDurationMs = run.durationMs + wallElapsed;
        }
      }
      this.reviewClocks.delete(run.id);
    }
    run.reviewed = true;
    await this.persist(); return structuredClone(run);
  }
  async step<T>(name: TelemetryStepName, fn: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
    const run = this.currentAgent();
    if (!run || !this.activeSpan || !STEP_NAMES.has(name)) return fn();
    const span = this.createChild(name, attributes);
    if (!span) return fn();
    return this.context.run({ runId: run.id, span }, async () => {
      try { const result = await fn(); try { span.setStatus({ code: SpanStatusCode.OK }); } catch { /* passive */ } return result; }
      catch (error) { try { span.setStatus({ code: SpanStatusCode.ERROR }); } catch { /* passive */ } throw error; }
      finally { try { span.end(); } catch { this.storageError = '轨迹记录暂时失败，业务操作未因此重试。'; } }
    });
  }
  private createChild(name: TelemetryStepName, attributes?: Record<string, unknown>): Span | undefined {
    const run = this.currentAgent(); if (!run || !this.activeSpan || !STEP_NAMES.has(name)) return undefined;
    const inherited = this.context.getStore();
    const parent = inherited?.runId === run.id ? inherited.span : this.activeSpan;
    try { return this.tracer.startSpan(name, { attributes: safeTelemetryAttributes(attributes) }, trace.setSpan(ROOT_CONTEXT, parent)); }
    catch { this.storageError = '轨迹记录暂时失败，业务操作未因此重试。'; return undefined; }
  }
  /** For executor journals whose intent/result arrive as separate callbacks. */
  startStep(name: TelemetryStepName, attributes?: Record<string, unknown>): { end(error?: boolean): Promise<void> } {
    const span = this.createChild(name, attributes); let ended = false;
    return { end: async (error = false) => {
      if (ended) return; ended = true;
      try { span?.setStatus({ code: error ? SpanStatusCode.ERROR : SpanStatusCode.OK }); span?.end(); }
      catch { this.storageError = '轨迹记录暂时失败，业务操作未因此重试。'; }
      await this.persist();
    } };
  }
  async addCounts(input: { verifiedFields?: number; pendingFields?: number; addedGroups?: number }): Promise<void> {
    const run = this.currentAgent(); if (!run) return;
    for (const key of ['verifiedFields', 'pendingFields', 'addedGroups'] as const) {
      if (input[key] !== undefined && count(input[key]) && count(run[key] + input[key]!)) run[key] += input[key]!;
    }
    run.observedVerifiedFields = run.verifiedFields;
    await this.persist();
  }
  async modelCall(usage: TelemetryTokens | undefined, options: { provider?: string; modelId?: string; fixture?: boolean } = {}): Promise<void> {
    const run = this.currentAgent(); if (!run) return;
    run.modelCalls++;
    if (options.fixture) run.source = 'fixture';
    if (!validUsage(usage) || options.fixture || !run.usageComplete) { run.usageComplete = false; run.tokens = null; }
    else {
      const next = Object.fromEntries(tokenKeys.map(key => [key, run.tokens![key] + usage[key]])) as unknown as TelemetryTokens;
      if (validUsage(next)) run.tokens = next; else { run.tokens = null; run.usageComplete = false; }
    }
    const attrs = safeTelemetryAttributes({ 'gen_ai.provider.name': options.provider, 'gen_ai.request.model': options.modelId,
      'gen_ai.usage.input_tokens': validUsage(usage) ? usage.input + usage.cacheRead + usage.cacheWrite : undefined, 'gen_ai.usage.output_tokens': usage?.output,
      'gen_ai.usage.cache_read_tokens': usage?.cacheRead, 'gen_ai.usage.cache_write_tokens': usage?.cacheWrite,
      'gen_ai.usage.total_tokens': usage?.totalTokens, fixture: options.fixture === true });
    try {
      this.activeSpan?.setAttributes(safeTelemetryAttributes({ modelCalls: run.modelCalls, usageComplete: run.usageComplete,
        'gen_ai.usage.input_tokens': run.tokens ? run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite : undefined,
        'gen_ai.usage.output_tokens': run.tokens?.output, 'gen_ai.usage.cache_read_tokens': run.tokens?.cacheRead,
        'gen_ai.usage.cache_write_tokens': run.tokens?.cacheWrite, 'gen_ai.usage.total_tokens': run.tokens?.totalTokens }));
      const inherited = this.context.getStore();
      if (inherited?.runId === run.id) inherited.span.setAttributes(attrs);
      else { const usageSpan = this.createChild('model.request', attrs); usageSpan?.setStatus({ code: SpanStatusCode.OK }); usageSpan?.end(); }
    } catch { /* passive diagnostics */ }
    await this.persist();
  }
  private acceptSpan(span: ReadableSpan): void {
    const context = span.spanContext(); const run = this.runs.find(candidate => candidate.traceId === context.traceId);
    if (!run || run.spans.length >= MAX_SPANS || (span.name !== 'apply.run' && run.spans.length >= MAX_SPANS - 1)) return;
    const parentId = span.parentSpanContext?.spanId;
    run.spans.push({ id: context.spanId, ...(parentId ? { parentId } : {}), name: span.name,
      startedAt: new Date(milliseconds(span.startTime)).toISOString(), durationMs: milliseconds(span.duration),
      status: span.status.code === SpanStatusCode.OK ? 'ok' : span.status.code === SpanStatusCode.ERROR ? 'error' : 'unset',
      attributes: safeTelemetryAttributes(span.attributes), startTimeUnixNano: ns(span.startTime), endTimeUnixNano: ns(span.endTime) });
    void this.persist();
  }
  private persist(): Promise<void> {
    if (!this.directory) return Promise.resolve();
    const directory = this.directory;
    this.dirty = true;
    if (this.writing) return this.writes;
    this.writing = true;
    const file = join(directory, 'trajectory.json');
    this.writes = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          const snapshot: Archive = { version: 1, runs: structuredClone(this.runs) };
          const temporary = join(directory, `.trajectory-${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
            await chmod(temporary, 0o600); await rename(temporary, file); this.storageError = undefined;
          } catch { this.storageError = '执行记录暂时无法保存，请检查本地存储；原存档已保留。'; }
        }
      } finally { this.writing = false; }
    })().catch(() => { this.storageError = '执行记录暂时无法保存，请检查本地存储；原存档已保留。'; });
    return this.writes;
  }
  jsonOTLP(): Record<string, unknown> {
    const spans = this.runs.flatMap(run => run.spans.map(span => ({
      traceId: run.traceId, spanId: span.id, ...(span.parentId ? { parentSpanId: span.parentId } : {}), name: span.name, kind: 1,
      startTimeUnixNano: span.startTimeUnixNano, endTimeUnixNano: span.endTimeUnixNano,
      attributes: Object.entries(safeTelemetryAttributes(span.attributes)).map(([key, value]) => ({ key, value:
        typeof value === 'number' ? { intValue: String(value) } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } })),
      status: { code: span.status === 'ok' ? 1 : span.status === 'error' ? 2 : 0 },
    })));
    return { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'offeragent-local' } }] },
      scopeSpans: [{ scope: { name: 'offeragent-local-trajectory', version: '1.0.0' }, spans }] }] };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    const run = this.runs.find(candidate => candidate.id === this.activeRunId);
    if (run) { run.status = 'interrupted'; run.endedAt = new Date().toISOString(); delete run.durationMs;
      this.activeSpan?.setStatus({ code: SpanStatusCode.ERROR }); this.activeSpan?.end(); }
    this.activeRunId = undefined; this.activeSpan = undefined; this.closed = true;
    this.reviewClocks.clear();
    await this.provider.forceFlush(); await this.persist(); await this.provider.shutdown();
  }
}
