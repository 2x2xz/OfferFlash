/** Public, value-free tool trajectory. No prompts, resume values, URLs or error messages. */
export interface TelemetryTokens {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
}
export type TelemetryMode = 'agent' | 'manual';
export type TelemetryRunStatus = 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'interrupted';
export type TelemetrySource = 'production' | 'fixture';
export interface TelemetrySpan {
  id: string; parentId?: string; name: string; startedAt: string; durationMs: number;
  status: 'ok' | 'error' | 'unset'; attributes: Record<string, string | number | boolean>;
  /** Exact timestamps recorded by the OpenTelemetry SDK; used only for OTLP export. */
  startTimeUnixNano: string; endTimeUnixNano: string;
}
export interface TelemetryRun {
  id: string; traceId: string; mode: TelemetryMode; scenarioKey: string;
  startedAt: string; endedAt?: string; durationMs?: number; status: TelemetryRunStatus;
  /** First review timing includes the user's final checking/corrections; never inferred after restart. */
  reviewedAt?: string; reviewDurationMs?: number; totalDurationMs?: number;
  expectedFields?: number; verifiedFields: number; observedVerifiedFields: number; pendingFields: number; addedGroups: number;
  manualCorrections: number; interventions: number; modelCalls: number;
  tokens: TelemetryTokens | null; usageComplete: boolean; reviewed: boolean;
  cleanStartConfirmed: boolean; source: TelemetrySource; spans: TelemetrySpan[];
}
export interface TelemetryState { runs: TelemetryRun[]; activeRunId?: string; storageError?: string; }
export interface TelemetryBeginInput {
  mode: TelemetryMode; scenarioKey: string; expectedFields?: number;
  cleanStartConfirmed?: boolean; source?: TelemetrySource;
}
export interface TelemetryFinishInput { id: string; status: 'completed' | 'partial' | 'cancelled' | 'failed'; }
export interface TelemetryReviewInput {
  id: string; expectedFields: number; verifiedFields: number; manualCorrections: number;
  interventions: number; cleanStartConfirmed: boolean;
}
export interface TelemetryComparison {
  comparable: boolean; reason: string; agentRunId?: string; manualRunId?: string;
  /** Both durations include execution and the first final review/correction interval. */
  agentDurationMs?: number; manualDurationMs?: number; timeSavedPercent?: number;
}
export type TelemetryStepName = 'form.observe' | 'form.recognize' | 'form.fill' | 'form.verify'
  | 'career.prepare' | 'career.add' | 'career.fill' | 'career.retry' | 'career.verify' | 'career.run'
  | 'model.request' | 'tool.execute' | 'agent.task';
