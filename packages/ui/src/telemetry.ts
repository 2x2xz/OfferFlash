import type { TelemetryRun, TelemetrySpan } from '../../telemetry/src/contracts.js';

export const telemetryStatusLabels: Record<TelemetryRun['status'], string> = {
  running: '进行中', completed: '已完成', partial: '部分完成', cancelled: '已取消', failed: '失败', interrupted: '意外中断',
};
const stepLabels: Record<string, string> = {
  'form.observe': '读取页面控件', 'form.recognize': '识别与匹配字段', 'form.fill': '填写联系资料',
  'form.verify': '重读并核实字段', 'career.prepare': '准备经历填写', 'career.add': '新增经历分组',
  'career.fill': '填写经历字段', 'career.retry': '重新核对并重试', 'career.verify': '重读并核实经历', 'career.run': '填写多段经历',
  'model.request': '请求模型', 'tool.execute': '执行工具', 'agent.task': '执行 Agent 任务',
  'apply.run': '整次填写',
  'application.fill': '一键填写', 'manual.fill': '人工填写计时', 'application.manual': '人工填写计时',
};
export function telemetryStepLabel(name: string): string { return Object.hasOwn(stepLabels, name) ? stepLabels[name]! : '执行步骤'; }

export function telemetryDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.floor(ms % 60_000 / 1000)} 秒`;
}
export function telemetryElapsed(run: TelemetryRun, now: number): number | undefined {
  if (run.durationMs !== undefined) return run.durationMs;
  const started = Date.parse(run.startedAt);
  return run.status === 'running' && Number.isFinite(started) ? Math.max(0, now - started) : undefined;
}
export function telemetryTokenLabel(run: TelemetryRun): string {
  if (run.mode === 'manual') return '0 · 人工计时';
  if (!run.usageComplete || !run.tokens) return '未知 · 用量不完整';
  if (run.modelCalls === 0 && run.tokens.totalTokens === 0) return '0 · 未调用模型';
  return new Intl.NumberFormat('zh-CN').format(run.tokens.totalTokens);
}
export interface TelemetryLatencySummary {
  samples: number; p50Ms?: number; p95Ms?: number; modelSamples: number; modelP50Ms?: number;
}
function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction; const low = Math.floor(position); const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}
/** Descriptive local timings, for one scenario only. Never folds cancelled, fixture or unfinished records into latency. */
export function telemetryLatencySummary(runs: TelemetryRun[], scenarioKey: string): TelemetryLatencySummary {
  const eligible = runs.filter(run => run.mode === 'agent' && run.source === 'production' && run.scenarioKey === scenarioKey
    && ['completed', 'partial'].includes(run.status) && run.endedAt
    && typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs > 0);
  const durations = eligible.map(run => run.durationMs!);
  const requests = eligible.flatMap(run => run.spans.filter(span => span.name === 'model.request'
    && Number.isFinite(span.durationMs) && span.durationMs >= 0).map(span => span.durationMs));
  return { samples: eligible.length, p50Ms: percentile(durations, .5), p95Ms: durations.length >= 20 ? percentile(durations, .95) : undefined,
    modelSamples: requests.length, modelP50Ms: percentile(requests, .5) };
}
export interface TelemetryTimelineRow {
  span: TelemetrySpan; depth: number; offsetMs: number; leftPercent: number; widthPercent: number;
}
/** Only SDK times are used. Missing parents and cycles remain bounded, and never hide a recorded step. */
export function telemetryTimeline(run: TelemetryRun, now: number): TelemetryTimelineRow[] {
  const byId = new Map(run.spans.map(span => [span.id, span]));
  const started = Date.parse(run.startedAt);
  const base = Number.isFinite(started) ? started : 0;
  const spanEnd = Math.max(0, ...run.spans.map(span => {
    const time = Date.parse(span.startedAt);
    return (Number.isFinite(time) ? Math.max(0, time - base) : 0) + Math.max(0, span.durationMs);
  }));
  const total = Math.max(1, telemetryElapsed(run, now) ?? 0, spanEnd);
  return [...run.spans].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map(span => {
    let parent = span.parentId; let depth = 0; const seen = new Set([span.id]);
    while (parent && !seen.has(parent) && depth < 12) {
      const ancestor = byId.get(parent); if (!ancestor) break;
      seen.add(parent); depth++; parent = ancestor.parentId;
    }
    const time = Date.parse(span.startedAt);
    const offsetMs = Number.isFinite(time) ? Math.max(0, time - base) : 0;
    const leftPercent = Math.min(100, offsetMs / total * 100);
    const widthPercent = Math.max(0, Math.min(100 - leftPercent, Math.max(0, span.durationMs) / total * 100));
    return { span, depth, offsetMs, leftPercent, widthPercent };
  });
}

const collectionLabels: Record<string, string> = { educations: '教育', internships: '实习', projects: '项目' };
const fieldLabels: Record<string, string> = {
  fullName: '姓名', fullNameEn: '英文姓名', email: '邮箱', phone: '电话', school: '学校', schoolEn: '英文学校',
  major: '专业', majorEn: '英文专业', degree: '学历', graduationMonth: '毕业年月', startDate: '开始时间', endDate: '结束时间',
  company: '公司', title: '职务', role: '角色', name: '名称', description: '经历描述', link: '链接',
};
function vocabularyLabel(labels: Record<string, string>, value: unknown): string | undefined {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : undefined;
}
/** Labels come from the fixed public vocabulary, never arbitrary span attributes or field values. */
export function telemetrySpanLabel(span: TelemetrySpan): string {
  const collection = vocabularyLabel(collectionLabels, span.attributes.collection);
  const field = vocabularyLabel(fieldLabels, span.attributes['field.key']);
  if (span.name === 'career.add') return collection ? `新增${collection}经历` : '新增经历分组';
  if (field && ['career.fill', 'form.fill', 'career.verify', 'form.verify'].includes(span.name)) {
    return `${span.name.endsWith('verify') ? '核实' : '填写'}${collection ? `${collection} · ` : ''}${field}`;
  }
  return telemetryStepLabel(span.name);
}
export interface TelemetryStage {
  id: string; label: string; rows: TelemetryTimelineRow[]; durationMs: number; errors: number;
  segments: { leftPercent: number; widthPercent: number }[];
}
function stageKey(span: TelemetrySpan): [string, string] {
  if (['form.observe', 'form.recognize', 'model.request'].includes(span.name)) return ['recognize', '识别页面'];
  if (span.name === 'form.fill') return ['contact', '联系资料'];
  if (span.name === 'career.prepare') return ['prepare', '匹配经历'];
  if (['career.fill', 'career.add'].includes(span.name)) {
    const key = String(span.attributes.collection ?? '');
    const collection = vocabularyLabel(collectionLabels, key);
    return collection ? [key, `${collection}经历`] : ['career', '填写经历'];
  }
  if (['form.verify', 'career.verify'].includes(span.name)) return ['verify', '独立核实'];
  if (['manual.fill', 'application.manual'].includes(span.name)) return ['manual', '人工填写'];
  return ['other', '其他执行'];
}
/** Visual groups use recorded spans only. Container spans stay in the raw tree; their children are not double-counted. */
export function telemetryStages(run: TelemetryRun, now: number): TelemetryStage[] {
  const rows = telemetryTimeline(run, now);
  const containers = new Set(['application.fill', 'apply.run', 'agent.task', 'career.run']);
  const grouped = new Map<string, TelemetryStage>();
  for (const row of rows) {
    if (containers.has(row.span.name)) continue;
    const [id, label] = stageKey(row.span);
    let stage = grouped.get(id);
    if (!stage) { stage = { id, label, rows: [], durationMs: 0, errors: 0, segments: [] }; grouped.set(id, stage); }
    stage.rows.push(row); if (row.span.status === 'error') stage.errors++;
  }
  const total = Math.max(1, telemetryElapsed(run, now) ?? 0, ...rows.map(row => row.offsetMs + Math.max(0, row.span.durationMs)));
  for (const stage of grouped.values()) {
    const intervals = stage.rows.map(row => [row.offsetMs, row.offsetMs + Math.max(0, row.span.durationMs)] as [number, number]).sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push([...interval]);
    }
    stage.durationMs = merged.reduce((sum, [start, end]) => sum + end - start, 0);
    stage.segments = merged.map(([start, end]) => ({ leftPercent: Math.min(100, start / total * 100), widthPercent: Math.max(0, Math.min(100, end / total * 100) - Math.min(100, start / total * 100)) }));
  }
  return [...grouped.values()];
}
export interface TelemetryReviewDraft {
  expectedFields: string; verifiedFields: string; manualCorrections: string; interventions: string; cleanStartConfirmed: boolean;
}
export function telemetryReviewDraft(run: TelemetryRun): TelemetryReviewDraft {
  return { expectedFields: run.expectedFields?.toString() ?? '', verifiedFields: run.verifiedFields.toString(),
    manualCorrections: run.manualCorrections.toString(), interventions: run.interventions.toString(),
    cleanStartConfirmed: run.reviewed ? run.cleanStartConfirmed : false };
}
export function telemetryReviewValues(draft: TelemetryReviewDraft): {
  expectedFields: number; verifiedFields: number; manualCorrections: number; interventions: number; cleanStartConfirmed: boolean;
} | undefined {
  const keys = ['expectedFields', 'verifiedFields', 'manualCorrections', 'interventions'] as const;
  if (keys.some(key => !/^\d+$/.test(draft[key]))) return undefined;
  const values = Object.fromEntries(keys.map(key => [key, Number(draft[key])])) as Record<typeof keys[number], number>;
  if (keys.some(key => !Number.isSafeInteger(values[key]) || values[key] > 100_000)) return undefined;
  if (values.expectedFields < 1 || values.verifiedFields > values.expectedFields) return undefined;
  return { ...values, cleanStartConfirmed: draft.cleanStartConfirmed };
}
