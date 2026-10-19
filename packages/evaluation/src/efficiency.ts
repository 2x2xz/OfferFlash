/** Offline benchmark statistics. All durations are measured; this module never estimates missing usage or a human baseline. */
export const EFFICIENCY_STATISTICS_VERSION = 'offerflash-efficiency-v1';
export const MIN_PERCENTILE_SAMPLES = 20;
export interface BenchmarkTokenUsage {
  /** Pi-normalized noncached input; cached components are disjoint. */
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
}
export interface BenchmarkRequestAttempt {
  id: string; source: 'real-model' | 'scripted'; status: 'succeeded' | 'failed' | 'cancelled';
  durationMs: number | null; usage?: BenchmarkTokenUsage | null;
}
export interface BenchmarkOracle { expectedFields: number; correctFields: number }
export interface BenchmarkReview {
  cleanStartConfirmed: boolean; reviewed: boolean; totalDurationMs: number | null;
  /** Must be explicitly true for a human comparison. Automated fixture entry is never a manual baseline. */
  humanOperated?: boolean;
}
export type BenchmarkRunStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export interface BenchmarkEfficiencyRun {
  id: string; scenarioId: string; mode: 'agent' | 'manual'; status: BenchmarkRunStatus;
  durationMs: number | null; requests: BenchmarkRequestAttempt[];
  /** Independent final-state oracle count, never an executor/model self-reported count. */
  oracle?: BenchmarkOracle | null; review?: BenchmarkReview | null;
}
export interface LatencyStatistics {
  samples: number; missingSamples: number; minMs: number | null; maxMs: number | null; meanMs: number | null;
  p50Ms: number | null; p95Ms: number | null; percentileMinimumSamples: number;
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const statuses: readonly BenchmarkRunStatus[] = ['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'];
const zeroTokens = (): BenchmarkTokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
function validUsage(value: unknown): value is BenchmarkTokenUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as BenchmarkTokenUsage;
  return tokenKeys.every(key => count(usage[key]))
    && usage.input + usage.output + usage.cacheRead + usage.cacheWrite === usage.totalTokens;
}
function unique(items: readonly { id: string }[]): void {
  if (items.some(item => !identifier(item.id)) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Invalid or duplicate benchmark IDs.');
}

/** Linear interpolation at (n-1)*q, only after the frozen minimum sample count is reached. */
export function summarizeLatencies(values: readonly (number | null)[]): LatencyStatistics {
  if (values.some(value => value !== null && !duration(value))) throw new Error('Invalid measured duration.');
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const percentile = (q: number) => {
    if (known.length < MIN_PERCENTILE_SAMPLES) return null;
    const position = (known.length - 1) * q; const low = Math.floor(position); const high = Math.ceil(position);
    return known[low]! + (known[high]! - known[low]!) * (position - low);
  };
  return { samples: known.length, missingSamples: values.length - known.length,
    minMs: known[0] ?? null, maxMs: known.at(-1) ?? null,
    meanMs: known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null,
    p50Ms: percentile(.5), p95Ms: percentile(.95), percentileMinimumSamples: MIN_PERCENTILE_SAMPLES };
}

export interface RequestAttemptStatistics {
  attempts: number; realAttempts: number; scriptedAttempts: number;
  succeededAttempts: number; failedAttempts: number; cancelledAttempts: number;
  measuredRealUsageAttempts: number; missingRealUsageAttempts: number;
  usageComplete: boolean; tokens: BenchmarkTokenUsage | null;
  /** Standard OTel inclusive input, not Pi's disjoint noncached component. */
  inputTokensIncludingCache: number | null;
  latency: LatencyStatistics; realLatency: LatencyStatistics;
}
export function summarizeRequestAttempts(attempts: readonly BenchmarkRequestAttempt[]): RequestAttemptStatistics {
  unique(attempts);
  if (attempts.some(attempt => !['real-model', 'scripted'].includes(attempt.source)
    || !['succeeded', 'failed', 'cancelled'].includes(attempt.status))) throw new Error('Invalid request attempt.');
  const real = attempts.filter(attempt => attempt.source === 'real-model');
  const measured = real.filter(attempt => validUsage(attempt.usage));
  const sum = zeroTokens(); let overflow = false;
  for (const attempt of measured) for (const key of tokenKeys) {
    sum[key] += attempt.usage![key]; if (!count(sum[key])) overflow = true;
  }
  // Scripted responses are excluded from real usage evidence, even when they return convincing-looking numbers.
  // Zero attempts is an observed rule-only run, not missing model usage.
  const usageComplete = attempts.length === real.length && measured.length === real.length && !overflow;
  return { attempts: attempts.length, realAttempts: real.length, scriptedAttempts: attempts.length - real.length,
    succeededAttempts: attempts.filter(attempt => attempt.status === 'succeeded').length,
    failedAttempts: attempts.filter(attempt => attempt.status === 'failed').length,
    cancelledAttempts: attempts.filter(attempt => attempt.status === 'cancelled').length,
    measuredRealUsageAttempts: measured.length, missingRealUsageAttempts: real.length - measured.length,
    usageComplete, tokens: usageComplete ? sum : null,
    inputTokensIncludingCache: usageComplete ? sum.input + sum.cacheRead + sum.cacheWrite : null,
    latency: summarizeLatencies(attempts.map(attempt => attempt.durationMs)),
    realLatency: summarizeLatencies(real.map(attempt => attempt.durationMs)) };
}

export interface BenchmarkSpanInterval { id: string; parentId?: string; startMs: number; endMs: number }
export interface SpanWallTime {
  spans: number; orphanSpans: number; summedSpanMs: number; unionMs: number;
  rootUnionMs: number; childUnionMs: number; overlapMs: number;
}
function intervalUnion(spans: readonly BenchmarkSpanInterval[]): number {
  const intervals = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let total = 0; let start: number | undefined; let end = 0;
  for (const span of intervals) {
    if (start === undefined) { start = span.startMs; end = span.endMs; }
    else if (span.startMs <= end) end = Math.max(end, span.endMs);
    else { total += end - start; start = span.startMs; end = span.endMs; }
  }
  return total + (start === undefined ? 0 : end - start);
}
/** Root and child wall time are separate diagnostic views; unionMs is the only non-overcounted total. */
export function spanWallTime(spans: readonly BenchmarkSpanInterval[]): SpanWallTime {
  unique(spans);
  if (spans.some(span => !duration(span.startMs) || !duration(span.endMs) || span.endMs < span.startMs
    || (span.parentId !== undefined && !identifier(span.parentId)))) throw new Error('Invalid span interval.');
  const byId = new Map(spans.map(span => [span.id, span]));
  for (const span of spans) {
    const seen = new Set([span.id]); let parent = span.parentId;
    while (parent && byId.has(parent)) {
      if (seen.has(parent)) throw new Error('Cyclic span ancestry.');
      seen.add(parent); parent = byId.get(parent)!.parentId;
    }
  }
  const roots = spans.filter(span => !span.parentId || !byId.has(span.parentId));
  const children = spans.filter(span => span.parentId && byId.has(span.parentId));
  const summedSpanMs = spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
  const unionMs = intervalUnion(spans);
  return { spans: spans.length, orphanSpans: roots.filter(span => !!span.parentId).length,
    summedSpanMs, unionMs, rootUnionMs: intervalUnion(roots), childUnionMs: intervalUnion(children), overlapMs: summedSpanMs - unionMs };
}

function validOracle(oracle: BenchmarkOracle | null | undefined): oracle is BenchmarkOracle {
  return !!oracle && count(oracle.expectedFields) && count(oracle.correctFields) && oracle.correctFields <= oracle.expectedFields;
}
function validateRun(run: BenchmarkEfficiencyRun): void {
  if (!identifier(run.scenarioId) || !['agent', 'manual'].includes(run.mode) || !statuses.includes(run.status)
    || (run.durationMs !== null && !duration(run.durationMs)) || !Array.isArray(run.requests)
    || (run.oracle != null && !validOracle(run.oracle))) throw new Error('Invalid efficiency run.');
}
export interface RunDurationStatistics {
  runs: number; knownDurationRuns: number; observedDurationMs: number; totalDurationMs: number | null; latency: LatencyStatistics;
}
function durationStats(runs: readonly BenchmarkEfficiencyRun[]): RunDurationStatistics {
  const known = runs.filter(run => run.durationMs !== null);
  const observedDurationMs = known.reduce((sum, run) => sum + run.durationMs!, 0);
  return { runs: runs.length, knownDurationRuns: known.length, observedDurationMs,
    totalDurationMs: known.length === runs.length ? observedDurationMs : null, latency: summarizeLatencies(runs.map(run => run.durationMs)) };
}
export interface EfficiencyStatistics {
  runCount: number; byStatus: Record<BenchmarkRunStatus, RunDurationStatistics>; allAttempts: RunDurationStatistics;
  oracleRuns: number; missingOracleRuns: number; oracleCorrectFields: number; oracleExpectedFields: number;
  verifiedSuccessRuns: number; falseCompletionRuns: number;
  allAttemptCorrectFieldsPerSecond: number | null;
  successOnlyCorrectFieldsPerSecond: number | null;
  requestStatistics: RequestAttemptStatistics;
}
/** Pass one frozen scenario+method+mode at a time. Failures and partial runs remain in all-attempt duration. */
export function summarizeEfficiencyRuns(runs: readonly BenchmarkEfficiencyRun[]): EfficiencyStatistics {
  unique(runs); runs.forEach(validateRun);
  if (new Set(runs.map(run => `${run.scenarioId}:${run.mode}`)).size > 1) throw new Error('Cannot pool different benchmark scenarios or modes.');
  const allAttempts = durationStats(runs);
  const oracleRuns = runs.filter(run => validOracle(run.oracle));
  const successes = oracleRuns.filter(run => run.status === 'succeeded' && run.oracle!.expectedFields > 0
    && run.oracle!.correctFields === run.oracle!.expectedFields);
  const successDuration = durationStats(successes);
  const correct = oracleRuns.reduce((sum, run) => sum + run.oracle!.correctFields, 0);
  const successCorrect = successes.reduce((sum, run) => sum + run.oracle!.correctFields, 0);
  return { runCount: runs.length, allAttempts,
    byStatus: Object.fromEntries(statuses.map(status => [status, durationStats(runs.filter(run => run.status === status))])) as Record<BenchmarkRunStatus, RunDurationStatistics>,
    oracleRuns: oracleRuns.length, missingOracleRuns: runs.length - oracleRuns.length,
    oracleCorrectFields: correct, oracleExpectedFields: oracleRuns.reduce((sum, run) => sum + run.oracle!.expectedFields, 0),
    verifiedSuccessRuns: successes.length,
    falseCompletionRuns: oracleRuns.filter(run => run.status === 'succeeded' && run.oracle!.correctFields < run.oracle!.expectedFields).length,
    allAttemptCorrectFieldsPerSecond: oracleRuns.length === runs.length && allAttempts.totalDurationMs !== null && allAttempts.totalDurationMs > 0
      ? correct * 1000 / allAttempts.totalDurationMs : null,
    successOnlyCorrectFieldsPerSecond: successDuration.totalDurationMs !== null && successDuration.totalDurationMs > 0
      ? successCorrect * 1000 / successDuration.totalDurationMs : null,
    requestStatistics: summarizeRequestAttempts(runs.flatMap(run => run.requests)) };
}

export interface ManualEfficiencyComparison {
  comparable: boolean; reason: 'comparable' | 'missing-manual' | 'different-task' | 'not-reviewed' | 'not-fully-correct' | 'missing-time' | 'scripted-evidence';
  agentTotalMs: number | null; manualTotalMs: number | null; timeSavedFraction: number | null; speedup: number | null;
}
export function compareManualEfficiency(agent: BenchmarkEfficiencyRun, manual: BenchmarkEfficiencyRun | null | undefined): ManualEfficiencyComparison {
  const result = (reason: ManualEfficiencyComparison['reason'], agentTotalMs: number | null = null, manualTotalMs: number | null = null): ManualEfficiencyComparison => ({
    comparable: reason === 'comparable', reason, agentTotalMs, manualTotalMs,
    timeSavedFraction: reason === 'comparable' ? (manualTotalMs! - agentTotalMs!) / manualTotalMs! : null,
    speedup: reason === 'comparable' ? manualTotalMs! / agentTotalMs! : null });
  validateRun(agent); if (!manual) return result('missing-manual'); validateRun(manual);
  if (agent.mode !== 'agent' || manual.mode !== 'manual' || agent.scenarioId !== manual.scenarioId
    || !validOracle(agent.oracle) || !validOracle(manual.oracle) || agent.oracle.expectedFields !== manual.oracle.expectedFields) return result('different-task');
  if (agent.requests.some(attempt => attempt.source === 'scripted') || manual.requests.length) return result('scripted-evidence');
  if (manual.review?.humanOperated !== true || ![agent, manual].every(run => run.review?.cleanStartConfirmed === true && run.review.reviewed === true)) return result('not-reviewed');
  if (![agent, manual].every(run => run.status === 'succeeded' && run.oracle!.expectedFields > 0
    && run.oracle!.correctFields === run.oracle!.expectedFields)) return result('not-fully-correct');
  if (![agent, manual].every(run => duration(run.review!.totalDurationMs) && run.review!.totalDurationMs! > 0
    && run.durationMs !== null && run.review!.totalDurationMs! >= run.durationMs)) return result('missing-time');
  return result('comparable', agent.review!.totalDurationMs, manual.review!.totalDurationMs);
}
