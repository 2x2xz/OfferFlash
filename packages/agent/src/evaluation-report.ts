/** OfferAgent's own implementation, inspired by per-run evidence and comparison reports.
 * No upstream Python source or provider-specific evaluator is bundled or executed.
 */
export type EvaluationMode = 'fixture' | 'live' | 'unknown';
export type ContractStatus = 'passed' | 'failed' | 'unknown' | 'missing';

export interface EvaluationMetadata {
  suiteVersion: string | null;
  scenarioIds: string[] | null;
  worldHash: string | null;
  toolsHash: string | null;
  graderVersion: string | null;
  model: string | null;
  budgets: Record<string, unknown> | null;
  runId: string | null;
}
export interface EvaluationRow {
  id: string;
  occurrence: number;
  kind: 'observed' | 'missing' | 'invalid';
  contract: ContractStatus;
  runtimeStatus: string | null;
  errors: string[];
  trace: unknown;
  finalText: string | null;
  model: string | null;
  semanticReview: 'not-evaluated-scripted' | 'pending-human-review' | 'unknown';
  durationMs: number | null;
  totalTokens: number | null;
}
export interface MetricSummary {
  available: number;
  total: number;
  mean: number | null;
}
export interface EvaluationSummary {
  mode: EvaluationMode;
  scripted: boolean | null;
  policyHash: string | null;
  policyVersion: string | null;
  injectedViolation: string | null | undefined;
  metadata: EvaluationMetadata;
  complete: boolean;
  issues: string[];
  rows: EvaluationRow[];
  counts: { expected: number | null; observed: number; passed: number; failed: number; unknown: number; missing: number; duplicateIds: string[] };
  toolContractPassRate: number | null;
  metrics: { durationMs: MetricSummary; totalTokens: MetricSummary };
  modelQualityClaim: false;
}
export interface EvaluationComparison {
  comparable: boolean;
  mode: EvaluationMode;
  reasons: string[];
  baselinePolicyHash: string | null;
  candidatePolicyHash: string | null;
  toolContractPassRateDelta: number | null;
  durationMsDelta: number | null;
  totalTokensDelta: number | null;
  modelQualityClaim: false;
}

const requiredMetadataStrings = ['suiteVersion', 'worldHash', 'toolsHash', 'graderVersion', 'model'] as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function metric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function integer(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function summarizeMetric(rows: EvaluationRow[], key: 'durationMs' | 'totalTokens', expected: number | null): MetricSummary {
  const observed = rows.filter(row => row.kind !== 'missing');
  const values = observed.flatMap(row => row[key] === null ? [] : [row[key]!]);
  return {
    available: values.length, total: expected ?? observed.length,
    // Missing measurements are unknown, and partial samples cannot stand in for a full-run average.
    mean: expected !== null && expected > 0 && observed.length === expected && values.length === expected
      && rows.every(row => row.kind === 'observed') && new Set(observed.map(row => row.id)).size === expected
      ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  };
}

export function summarizeEvaluationReport(value: unknown): EvaluationSummary {
  const issues: string[] = [];
  const report = record(value) ? value : {};
  if (!record(value)) issues.push('报告根节点不是对象。');
  const mode: EvaluationMode = report.mode === 'fixture' || report.mode === 'live' ? report.mode : 'unknown';
  if (mode === 'unknown') issues.push('缺少有效的 fixture/live 模式。');
  const scripted = typeof report.scripted === 'boolean' ? report.scripted : null;
  if (scripted === null) issues.push('缺少 scripted 标记，不能确定运行性质。');
  else if (mode !== 'unknown' && scripted !== (mode === 'fixture')) issues.push('mode 与 scripted 标记矛盾。');
  const policyHash = text(report.policyHash);
  if (!policyHash) issues.push('缺少实际策略 policyHash。');
  let injectedViolation: EvaluationSummary['injectedViolation'];
  if (report.injectedViolation === null) injectedViolation = null;
  else if (text(report.injectedViolation)) injectedViolation = report.injectedViolation as string;
  else { injectedViolation = undefined; issues.push('缺少有效的 injectedViolation 标记；正常运行应明确为 null。'); }
  const rawMetadata = record(report.metadata) ? report.metadata : report;
  const metadata: EvaluationMetadata = {
    suiteVersion: text(rawMetadata.suiteVersion), scenarioIds: null,
    worldHash: text(rawMetadata.worldHash), toolsHash: text(rawMetadata.toolsHash), graderVersion: text(rawMetadata.graderVersion),
    model: text(rawMetadata.model), budgets: null, runId: text(rawMetadata.runId),
  };
  for (const field of requiredMetadataStrings) if (!metadata[field]) issues.push(`缺少评测元数据 ${field}。`);
  if (Array.isArray(rawMetadata.scenarioIds) && rawMetadata.scenarioIds.length > 0
    && rawMetadata.scenarioIds.every(id => typeof id === 'string' && id.trim())) {
    metadata.scenarioIds = [...rawMetadata.scenarioIds] as string[];
    if (new Set(metadata.scenarioIds).size !== metadata.scenarioIds.length) issues.push('scenarioIds 中存在重复场景。');
  } else issues.push('缺少非空的预期场景清单 scenarioIds。');
  if (record(rawMetadata.budgets)) {
    metadata.budgets = { ...rawMetadata.budgets };
    for (const key of ['maxToolCalls', 'timeoutMs', 'maxOutputTokens']) {
      const budget = metric(metadata.budgets[key]);
      if (budget === null || budget === 0 || !Number.isSafeInteger(budget)) issues.push(`预算 ${key} 必须明确为正安全整数。`);
    }
  } else issues.push('缺少实际执行预算 budgets。');

  const rawRows = Array.isArray(report.results) ? report.results : [];
  if (!Array.isArray(report.results)) issues.push('缺少 results 数组。');
  const occurrences = new Map<string, number>();
  const rows: EvaluationRow[] = rawRows.map((item, index) => {
    const raw = record(item) ? item : {};
    const realId = text(raw.id);
    const id = realId ?? `未命名结果 #${index + 1}`;
    if (!realId) issues.push(`第 ${index + 1} 个结果没有有效场景 ID。`);
    const occurrence = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, occurrence);
    const errors = Array.isArray(raw.errors) ? raw.errors.map(error => typeof error === 'string' ? error : safeFormat(error)) : [];
    if (typeof raw.error === 'string' && raw.error) errors.push(raw.error);
    let contract: ContractStatus = typeof raw.toolContractPassed === 'boolean' ? raw.toolContractPassed ? 'passed' : 'failed' : 'unknown';
    if (contract === 'unknown') issues.push(`${id} 缺少明确的工具契约判定。`);
    const runtimeStatus = text(raw.status);
    if (contract === 'passed' && (errors.length > 0 || runtimeStatus === 'failed' || runtimeStatus === 'cancelled')) {
      contract = 'failed';
      issues.push(`${id} 的通过标记与失败/取消证据矛盾。`);
    }
    const resultModel = text(raw.model);
    if (metadata.model && resultModel && resultModel !== metadata.model) issues.push(`${id} 的模型与评测元数据不一致。`);
    const rawMetrics = record(raw.metrics) ? raw.metrics : raw;
    return {
      id, occurrence, kind: realId ? 'observed' : 'invalid', contract, runtimeStatus, errors,
      trace: Object.hasOwn(raw, 'trace') ? raw.trace : null, finalText: typeof raw.finalText === 'string' ? raw.finalText : null,
      model: resultModel, semanticReview: mode === 'fixture' ? 'not-evaluated-scripted' : mode === 'live' ? 'pending-human-review' : 'unknown',
      durationMs: metric(rawMetrics.durationMs), totalTokens: integer(rawMetrics.totalTokens),
    };
  });
  const duplicateIds = [...occurrences.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicateIds.length) issues.push(`结果重复场景：${duplicateIds.join('、')}。`);
  const expectedIds = metadata.scenarioIds ? new Set(metadata.scenarioIds) : null;
  if (expectedIds) {
    for (const row of rows) if (!expectedIds.has(row.id)) issues.push(`结果包含预期清单之外的场景：${row.id}。`);
    for (const id of expectedIds) if (!occurrences.has(id)) {
      issues.push(`缺失场景：${id}。`);
      rows.push({ id, occurrence: 0, kind: 'missing', contract: 'missing', runtimeStatus: null, errors: ['该场景没有运行结果，保留在分母中。'], trace: null, finalText: null, model: null,
        semanticReview: mode === 'fixture' ? 'not-evaluated-scripted' : mode === 'live' ? 'pending-human-review' : 'unknown', durationMs: null, totalTokens: null });
    }
  }
  const declared = integer(report.scenarios);
  if (Object.hasOwn(report, 'scenarios') && declared === null) issues.push('scenarios 数量无效。');
  if (declared !== null && declared !== rawRows.length) issues.push('scenarios 与实际结果数量不一致。');
  if (declared !== null && expectedIds && declared !== expectedIds.size) issues.push('scenarios 与预期场景数量不一致。');
  const expected = expectedIds ? expectedIds.size : declared;
  if (expected === 0) issues.push('没有可评估场景。');
  const counts = {
    expected, observed: rawRows.length,
    passed: rows.filter(row => row.kind !== 'missing' && row.contract === 'passed').length,
    failed: rows.filter(row => row.kind !== 'missing' && row.contract === 'failed').length,
    unknown: rows.filter(row => row.kind !== 'missing' && row.contract === 'unknown').length,
    missing: rows.filter(row => row.kind === 'missing').length, duplicateIds,
  };
  const complete = issues.length === 0;
  return {
    mode, scripted, policyHash, policyVersion: text(report.policyVersion), injectedViolation, metadata, complete, issues, rows, counts,
    toolContractPassRate: complete && expected !== null && expected > 0 ? counts.passed / expected : null,
    metrics: { durationMs: summarizeMetric(rows, 'durationMs', expected), totalTokens: summarizeMetric(rows, 'totalTokens', expected) },
    modelQualityClaim: false,
  };
}

export function compareEvaluationReports(baseline: EvaluationSummary, candidate: EvaluationSummary): EvaluationComparison {
  const reasons: string[] = [];
  if (!baseline.complete) reasons.push('基准报告不完整。');
  if (!candidate.complete) reasons.push('当前报告不完整。');
  if (baseline.mode !== candidate.mode || baseline.scripted !== candidate.scripted) reasons.push('运行模式不同，脚本化与真实模型结果不能混合比较。');
  for (const field of requiredMetadataStrings) {
    if (!baseline.metadata[field] || !candidate.metadata[field]) reasons.push(`缺少 ${field}，无法核对。`);
    else if (baseline.metadata[field] !== candidate.metadata[field]) reasons.push(`${field} 不一致。`);
  }
  if (!baseline.metadata.scenarioIds || !candidate.metadata.scenarioIds) reasons.push('缺少固定场景清单，无法核对分母。');
  else if (canonical([...baseline.metadata.scenarioIds].sort()) !== canonical([...candidate.metadata.scenarioIds].sort())) reasons.push('scenarioIds 不一致。');
  if (!baseline.metadata.budgets || !candidate.metadata.budgets) reasons.push('缺少预算，无法核对。');
  else if (canonical(baseline.metadata.budgets) !== canonical(candidate.metadata.budgets)) reasons.push('budgets 不一致。');
  if (baseline.injectedViolation === undefined || candidate.injectedViolation === undefined) reasons.push('缺少 injectedViolation，无法区分负例检查。');
  else if (baseline.injectedViolation !== candidate.injectedViolation) reasons.push('injectedViolation 不一致，负例注入不能与正常运行直接比较。');
  const comparable = reasons.length === 0;
  const delta = (left: number | null, right: number | null) => comparable && left !== null && right !== null ? right - left : null;
  return {
    comparable, mode: candidate.mode, reasons, baselinePolicyHash: baseline.policyHash, candidatePolicyHash: candidate.policyHash,
    toolContractPassRateDelta: delta(baseline.toolContractPassRate, candidate.toolContractPassRate),
    durationMsDelta: delta(baseline.metrics.durationMs.mean, candidate.metrics.durationMs.mean),
    totalTokensDelta: delta(baseline.metrics.totalTokens.mean, candidate.metrics.totalTokens.mean), modelQualityClaim: false,
  };
}

export function escapeHtml(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function safeFormat(value: unknown): string {
  if (value === null || value === undefined) return '未知';
  try { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  catch { return '记录无法序列化。'; }
}
const gradeLabels: Record<ContractStatus, string> = { passed: '契约通过', failed: '契约失败', unknown: '判定未知', missing: '缺失结果' };
function numeric(value: number | null, digits = 1): string { return value === null ? '未知' : value.toFixed(digits); }
function rate(value: number | null): string { return value === null ? '未知（报告不完整）' : `${(value * 100).toFixed(1)}%`; }

export function renderEvaluationHtml(summary: EvaluationSummary, comparison?: EvaluationComparison, baseline?: EvaluationSummary): string {
  const label = summary.mode === 'fixture' ? '脚本化工具管线检查' : summary.mode === 'live' ? '真实模型工具契约检查' : '运行性质未知';
  const metadataLines = [
    ['报告状态', summary.complete ? '完整' : '不完整'], ['运行性质', label], ['模型', summary.metadata.model ?? '未知'],
    ['策略版本', summary.policyVersion ?? '未知'], ['策略 hash', summary.policyHash ?? '未知'],
    ['场景版本', summary.metadata.suiteVersion ?? '未知'], ['world hash', summary.metadata.worldHash ?? '未知'],
    ['tools hash', summary.metadata.toolsHash ?? '未知'], ['判分版本', summary.metadata.graderVersion ?? '未知'],
    ['预算', safeFormat(summary.metadata.budgets)], ['负例注入', summary.injectedViolation === undefined ? '未知' : summary.injectedViolation ?? '无'],
  ];
  const metadataHtml = metadataLines.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  const issuesHtml = summary.issues.length ? `<section><h2>报告缺口</h2><ul>${summary.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></section>` : '';
  const comparisonHtml = comparison ? `<section><h2>配置对照：${comparison.comparable ? '可比较工具契约结果' : '不可直接比较'}</h2>
    <p>基准策略：${escapeHtml(comparison.baselinePolicyHash ?? '未知')}<br>当前策略：${escapeHtml(comparison.candidatePolicyHash ?? '未知')}</p>
    ${comparison.comparable ? `<p>工具契约通过率差值（当前减基准）：${comparison.toolContractPassRateDelta === null ? '未知' : `${(comparison.toolContractPassRateDelta * 100).toFixed(1)} 个百分点`}；平均耗时差值：${numeric(comparison.durationMsDelta)} ms；token 差值：${numeric(comparison.totalTokensDelta, 0)}。</p>` : `<ul>${comparison.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><p>不计算差值。</p>`}
    <p>${summary.mode === 'fixture' ? '对照仅检查脚本化管线，不能衡量提示词理解或模型能力。' : '对照仅覆盖工具契约，回答的事实依据、未知条件和成功声明仍待人工评阅。'}</p></section>` : '';
  const baselineById = baseline ? new Map(baseline.rows.map(row => [row.id, row])) : null;
  const rowsHtml = summary.rows.map(row => `<tr><td>${escapeHtml(row.id)}${row.occurrence > 1 ? `（重复 #${row.occurrence}）` : ''}</td>
    <td>${escapeHtml(gradeLabels[row.contract])}</td>${baselineById ? `<td>${escapeHtml(baselineById.has(row.id) ? gradeLabels[baselineById.get(row.id)!.contract] : '缺失结果')}</td>` : ''}
    <td>${escapeHtml(row.runtimeStatus ?? '未知')}</td><td>${numeric(row.durationMs)} ms / ${numeric(row.totalTokens, 0)} tokens</td>
    <td>${row.semanticReview === 'not-evaluated-scripted' ? '未评测（脚本化）' : row.semanticReview === 'pending-human-review' ? '待人工评阅' : '未知'}</td>
    <td><details><summary>查看证据</summary><h3>错误</h3><pre>${escapeHtml(row.errors.length ? row.errors.join('\n') : '无已记录错误；缺失证据不代表成功。')}</pre>
    <h3>实际工具记录</h3><pre>${escapeHtml(safeFormat(row.trace))}</pre><h3>最终回答</h3><pre>${escapeHtml(row.finalText ?? '未知')}</pre></details></td></tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>OfferAgent 评测证据报告</title><style>
body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#1d2939;margin:0;padding:24px;line-height:1.6}main{max-width:1400px;margin:auto}section{background:white;padding:20px;margin:16px 0;border:1px solid #d0d5dd;border-radius:8px}h1,h2,h3{line-height:1.3}dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:6px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #d0d5dd}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f4f6f8;padding:10px}details{max-width:650px}.table{overflow-x:auto}.boundary{border-left:5px solid #365f92}summary{cursor:pointer}@media(max-width:700px){body{padding:12px}dl{grid-template-columns:1fr}dd{margin-bottom:10px}}
</style></head><body><main><h1>OfferAgent 评测证据报告</h1><section class="boundary"><p><strong>${escapeHtml(label)}</strong>。报告状态：<strong>${summary.complete ? '完整' : '不完整'}</strong>。</p>
<p>工具契约通过不代表岗位判断、事实表达或真实投递成功。fixture 使用预设工具轨迹，不评测模型理解；live 回答仍待人工语义评阅。本报告不作模型质量提升声明。</p></section>
<section><h2>运行记录</h2><dl>${metadataHtml}</dl><p>预期场景：${summary.counts.expected ?? '未知'}；实际结果：${summary.counts.observed}；通过：${summary.counts.passed}；失败：${summary.counts.failed}；未知：${summary.counts.unknown}；缺失：${summary.counts.missing}。重复结果全部保留，不能充作新增样本。</p>
<p>工具契约通过率：${rate(summary.toolContractPassRate)}。完整样本平均耗时：${numeric(summary.metrics.durationMs.mean)} ms（${summary.metrics.durationMs.available}/${summary.metrics.durationMs.total} 条有数据）；平均 tokens：${numeric(summary.metrics.totalTokens.mean, 0)}（${summary.metrics.totalTokens.available}/${summary.metrics.totalTokens.total} 条有数据）。</p></section>
${issuesHtml}${comparisonHtml}<section><h2>逐场景证据</h2><div class="table"><table><thead><tr><th>场景</th><th>当前契约结果</th>${baselineById ? '<th>基准契约结果</th>' : ''}<th>运行状态</th><th>实际指标</th><th>语义评阅</th><th>证据</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section></main></body></html>`;
}
