import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Check, ChevronDown, Download, Play, Square, Timer } from 'lucide-react';
import type { TelemetryRun, TelemetryState } from '../../../packages/telemetry/src/contracts.js';
import { compareTelemetryRuns } from '../../../packages/telemetry/src/comparison.js';
import { telemetryDuration, telemetryElapsed, telemetryLatencySummary, telemetryReviewDraft, telemetryReviewValues, telemetryStatusLabels,
  telemetrySpanLabel, telemetryStages, telemetryTimeline, telemetryTokenLabel } from '../../../packages/ui/src/telemetry.js';
import { Badge, Button, EmptyState, Field, Notice, SectionHeading } from './components.js';
import { useWorkspace } from './context.js';
import './Telemetry.css';

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '时间未知';
}
function runLabel(run: TelemetryRun): string { return `${run.mode === 'agent' ? 'Agent' : '人工'} · ${timeLabel(run.startedAt)}`; }
function statusTone(run: TelemetryRun): 'green' | 'amber' | 'red' | 'blue' | 'muted' {
  return run.status === 'running' ? 'blue' : run.status === 'completed' ? 'green' : run.status === 'partial' ? 'amber' : ['failed', 'interrupted'].includes(run.status) ? 'red' : 'muted';
}

export function TelemetryPage({ compact = false }: { compact?: boolean } = {}) {
  const { api, browser, navigate, notify } = useWorkspace();
  const [state, setState] = useState<TelemetryState>({ runs: [] });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [selectedId, setSelectedId] = useState<string>();
  const [stageId, setStageId] = useState<string>();
  const [agentId, setAgentId] = useState(''); const [manualId, setManualId] = useState('');
  const [now, setNow] = useState(Date.now());
  const [expected, setExpected] = useState(''); const [cleanStart, setCleanStart] = useState(false);
  useEffect(() => {
    let disposed = false; let receivedEvent = false;
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'telemetry') { receivedEvent = true; setState(event.state); setLoading(false); setError(''); }
    });
    void api.telemetryState().then(result => { if (!disposed && !receivedEvent) setState(result); })
      .catch(() => { if (!disposed) setError('执行记录暂时无法读取，请稍后重试。'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; unsubscribe(); };
  }, [api]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const runs = useMemo(() => [...state.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [state.runs]);
  const selected = runs.find(run => run.id === selectedId) ?? runs[0];
  const active = runs.find(run => run.id === state.activeRunId || run.status === 'running');
  const agents = runs.filter(run => run.mode === 'agent'); const manuals = runs.filter(run => run.mode === 'manual');
  const agent = agents.find(run => run.id === agentId) ?? agents[0];
  const manual = manuals.find(run => run.id === manualId) ?? manuals.find(run => run.scenarioKey === agent?.scenarioKey) ?? manuals[0];
  const comparison = agent && manual ? compareTelemetryRuns(agent, manual) : undefined;
  const rows = selected ? telemetryTimeline(selected, now) : [];
  const stages = selected ? telemetryStages(selected, now) : [];
  const currentStage = stages.find(stage => stage.id === stageId);
  const latency = telemetryLatencySummary(runs, selected?.scenarioKey ?? '');
  async function refresh() { setState(await api.telemetryState()); }
  async function beginManual() {
    if (active || busy) return;
    const expectedFields = expected.trim() ? Number(expected) : undefined;
    if (expectedFields !== undefined && (!/^\d+$/.test(expected) || !Number.isSafeInteger(expectedFields) || expectedFields < 1 || expectedFields > 100_000)) {
      notify('目标字段数请填写大于 0 的整数，也可以先留空。', true); return;
    }
    setBusy(true);
    try {
      const run = await api.beginMeasurement({ mode: 'manual', expectedFields, cleanStartConfirmed: cleanStart });
      setSelectedId(run.id); setManualId(run.id); setCleanStart(false); await refresh(); navigate('browser');
      notify('人工计时已开始。填写完后，点浏览器顶部“结束人工计时”。');
    } catch { notify('无法开始计时，请确认没有其他执行任务，并打开要测试的网申页面。', true); }
    finally { setBusy(false); }
  }
  async function finishManual(status: 'completed' | 'cancelled') {
    if (active?.mode !== 'manual' || busy) return;
    setBusy(true);
    try { await api.finishMeasurement({ id: active.id, status }); setSelectedId(active.id); await refresh(); notify(status === 'completed' ? '计时已结束。补充人工复核后，才能做公平对比。' : '本轮人工计时已取消，记录保留。'); }
    catch { notify('结束计时失败，请重试。', true); }
    finally { setBusy(false); }
  }
  async function exportTraces() {
    setBusy(true);
    try { const result = await api.exportTelemetry(); if (!result.cancelled) notify('已导出 OpenTelemetry 执行轨迹。'); }
    catch { notify('执行轨迹导出失败，请重试。', true); }
    finally { setBusy(false); }
  }
  const stageView = <div className="telemetry-stage-view" data-testid="telemetry-stage-view">
    {stages.length ? <>
      <div className="telemetry-stage-flow" aria-label="已记录的执行阶段">{stages.map((stage, index) => <button type="button" key={stage.id} data-testid="telemetry-stage" data-stage-id={stage.id} data-span-count={stage.rows.length} aria-pressed={currentStage?.id === stage.id} className={`telemetry-stage ${stage.errors ? 'has-error' : ''} ${currentStage?.id === stage.id ? 'selected' : ''}`} onClick={() => setStageId(stageId === stage.id ? undefined : stage.id)}>
        <span className="telemetry-stage-number">{stage.errors ? '!' : <Check size={12} aria-hidden="true" />}</span><strong>{stage.label}</strong><span className="telemetry-stage-duration">{telemetryDuration(stage.durationMs)}</span><small>{stage.rows.length} 步{stage.errors ? ` · ${stage.errors} 未完成` : ''}</small>{index < stages.length - 1 && <ArrowRight className="telemetry-stage-arrow" size={13} aria-hidden="true" />}
      </button>)}</div>
      <div className="telemetry-stage-timing" data-testid="telemetry-stage-timing" aria-label="阶段耗时分布">{stages.map(stage => <button type="button" key={stage.id} className={`telemetry-stage-lane ${stage.errors ? 'has-error' : ''}`} aria-label={`查看${stage.label}的 ${stage.rows.length} 个步骤，阶段用时 ${telemetryDuration(stage.durationMs)}`} onClick={() => setStageId(stageId === stage.id ? undefined : stage.id)}><span>{stage.label}</span><span className="telemetry-stage-track">{stage.segments.map((segment, index) => <i key={index} style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }} />)}</span><span>{telemetryDuration(stage.durationMs)}</span></button>)}</div>
      {currentStage && <div className="telemetry-stage-steps" data-testid="telemetry-stage-steps"><div className="telemetry-steps-heading"><strong>{currentStage.label} · {currentStage.rows.length} 步</strong><button type="button" onClick={() => setStageId(undefined)} aria-label="收起阶段步骤">收起</button></div>{currentStage.rows.map(row => <div className={`telemetry-step-row ${row.span.status}`} key={row.span.id} data-testid="telemetry-stage-step" data-span-id={row.span.id}><span className="telemetry-step-marker" aria-hidden="true">{row.span.status === 'error' ? '!' : '·'}</span><span>{telemetrySpanLabel(row.span)}</span><small>+{telemetryDuration(row.offsetMs)}</small><span>{telemetryDuration(row.span.durationMs)}</span></div>)}</div>}
      <p className="telemetry-note">{compact ? '点阶段查看具体字段与耗时。' : '点阶段查看步骤。时间条按真实记录定位；同阶段重叠时间只计算一次，阶段之间仍可能重叠。字段步骤包含内部填写与重读；仅有独立核实片段时显示核实阶段。'}</p>
    </> : <p className="telemetry-empty-steps">{selected?.status === 'running' ? '正在执行，步骤结束后会出现对应阶段。' : selected?.mode === 'manual' ? '本轮仅计人工填写时间，不记录你的键盘或点击过程。' : '本轮只有整体计时，尚无独立步骤记录。'}</p>}
  </div>;
  return <div className={`telemetry-page ${compact ? 'telemetry-compact' : 'page'}`} data-testid="telemetry-panel" data-compact={compact} data-run-count={runs.length} data-active-mode={active?.mode ?? 'none'}>
    <header className="telemetry-intro"><div><h2><Activity size={compact ? 14 : 19} />{compact ? '执行轨迹' : '执行过程'}</h2>{!compact && <p>先看结果，再按需展开每个阶段。</p>}</div><div className="telemetry-run-picker">{selected && <><select data-testid="telemetry-run-select" aria-label="选择执行轮次" value={selected.id} onChange={event => { setSelectedId(event.target.value); setStageId(undefined); }}>{runs.map(run => <option value={run.id} key={run.id}>{runLabel(run)} · {telemetryStatusLabels[run.status]}</option>)}</select><Badge tone={statusTone(selected)}>{telemetryStatusLabels[selected.status]}</Badge></>}{!compact && <Button variant="ghost" onClick={() => navigate('browser')}>回到网申<ArrowRight size={14} /></Button>}</div></header>
    {error && <Notice tone="warning">{error}</Notice>}
    {state.storageError && <Notice tone="warning">执行记录暂时无法保存，请导出留存。</Notice>}
    {loading ? <p className="telemetry-note">正在读取执行记录…</p> : !runs.length ? <div data-testid="telemetry-empty">{compact ? <p className="telemetry-note">自动填写后，这里会显示耗时、字段和执行阶段。</p> : <EmptyState compact icon={<Activity size={22} />} title="还没有执行记录" description="去网页点一次自动填写，就能看到真实步骤和耗时。" action={<Button onClick={() => navigate('browser')}>去网申页面</Button>} />}</div> : selected && <>
      <div className="telemetry-overview" data-testid="telemetry-metrics" data-selected-run={selected.id}>
        <dl><dt>执行耗时</dt><dd data-testid="telemetry-duration">{telemetryDuration(telemetryElapsed(selected, now))}</dd></dl>
        <dl><dt>{selected.mode === 'agent' ? '已核实 / 待处理' : '人工核实 / 目标'}</dt><dd data-testid="telemetry-field-count">{selected.mode === 'agent' ? selected.observedVerifiedFields : selected.reviewed ? selected.verifiedFields : '待复核'}<em> / {selected.mode === 'agent' ? selected.pendingFields : selected.expectedFields ?? '未设定'}</em></dd></dl>
        <dl><dt>模型请求</dt><dd data-testid="telemetry-model-calls">{selected.modelCalls}<em> 次</em></dd></dl>
        <dl><dt>Token</dt><dd data-testid="telemetry-tokens">{telemetryTokenLabel(selected)}</dd></dl>
      </div>
      {compact ? <details className="telemetry-compact-expand" data-testid="telemetry-compact-details" open><summary>执行路线 <ChevronDown size={12} /></summary>{stageView}<Button variant="ghost" onClick={() => navigate('telemetry')}>对比实验与完整记录<ArrowRight size={12} /></Button></details> : <section className="telemetry-detail" data-testid="telemetry-detail"><div className="telemetry-section-caption"><span>执行路线</span><span>{selected.spans.length} 条原始片段 · 新增 {selected.addedGroups} 组</span></div>{stageView}<div className="telemetry-detail-counts"><span>执行器核实 {selected.observedVerifiedFields} 项</span><span>{selected.reviewed ? `人工复核 ${selected.verifiedFields} 项正确` : '待人工复核'}</span><span data-testid="telemetry-total-duration">含核对总耗时：{selected.reviewed ? selected.totalDurationMs === undefined ? '未知，不能比较' : telemetryDuration(selected.totalDurationMs) : '待确认复核'}</span>{selected.source === 'fixture' && <span>虚构验收，不参与对比</span>}</div></section>}
    </>}
    {!compact && <details className="telemetry-experiments" data-testid="telemetry-experiments"><summary><span><Timer size={15} />对比实验<span className="telemetry-summary-description">人工计时、复核与效率对照</span></span><ChevronDown size={15} /></summary><div className="telemetry-experiment-content">
      <section className="telemetry-manual" data-testid="telemetry-manual"><SectionHeading title="记录一轮纯人工填写" description="同一表单与资料，分别从空白起点完成填写和核对。" />
        {active ? <><p role="status">{active.mode === 'manual' ? '人工计时中' : 'Agent 正在执行'} · <strong data-testid="telemetry-active-duration">{telemetryDuration(telemetryElapsed(active, now))}</strong></p><div className="telemetry-detail-actions"><Button onClick={() => navigate('browser')}>回到网申</Button>{active.mode === 'manual' && <><Button data-testid="telemetry-manual-finish" variant="secondary" busy={busy} onClick={() => void finishManual('completed')}><Square size={12} />结束人工计时</Button><Button variant="ghost" busy={busy} onClick={() => void finishManual('cancelled')}>取消本轮</Button></>}</div></> : <><div className="telemetry-manual-grid"><Field label="目标字段数" hint="不确定可以先留空。"><input data-testid="telemetry-manual-expected" type="number" min="1" max="100000" step="1" value={expected} placeholder="例如 23" onChange={event => setExpected(event.target.value)} /></Field><label className="telemetry-confirm"><input data-testid="telemetry-manual-clean" type="checkbox" checked={cleanStart} onChange={event => setCleanStart(event.target.checked)} /><span>已恢复同一空白起点、使用同一套资料，本轮将连续完成。未确认只计时，不算提升。</span></label></div><Button data-testid="telemetry-manual-start" busy={busy} disabled={!browser.url || browser.loading} onClick={() => void beginManual()}><Play size={13} />开始人工计时并去填写</Button></>}
      </section>
      {selected && selected.status !== 'running' && <MeasurementReview key={selected.id} run={selected} busy={busy} onSave={async values => {
        setBusy(true); try { await api.reviewMeasurement({ id: selected.id, ...values }); await refresh(); notify('人工复核已保存。'); return true; }
        catch { notify('复核未保存，请检查数字后重试。', true); return false; } finally { setBusy(false); }
      }} />}
      {!!runs.length && <><section className="telemetry-comparison" data-testid="telemetry-comparison" data-comparable={comparison?.comparable ?? false}><SectionHeading title="人工与 Agent 对照" description="比较含人工核对的总耗时；两轮需同场景、同目标、同空白起点且均连续完成并复核。" />
        <div className="telemetry-pair-selects"><Field label="Agent 轮次"><select data-testid="telemetry-agent-select" value={agent?.id ?? ''} onChange={event => { setAgentId(event.target.value); setManualId(''); }}><option value="" disabled>暂无 Agent 记录</option>{agents.map(run => <option value={run.id} key={run.id}>{runLabel(run)} · {telemetryStatusLabels[run.status]}</option>)}</select></Field><Field label="人工轮次"><select data-testid="telemetry-manual-select" value={manual?.id ?? ''} onChange={event => setManualId(event.target.value)}><option value="" disabled>暂无人工记录</option>{manuals.map(run => <option value={run.id} key={run.id}>{runLabel(run)} · {telemetryStatusLabels[run.status]}</option>)}</select></Field></div>
        {agent && manual && <table className="telemetry-comparison-table"><thead><tr><th>指标</th><th>Agent</th><th>纯人工</th></tr></thead><tbody><tr><td>含人工核对总耗时</td><td>{agent.reviewed ? telemetryDuration(agent.totalDurationMs) : '待复核'}</td><td>{manual.reviewed ? telemetryDuration(manual.totalDurationMs) : '待复核'}</td></tr><tr><td>填写执行耗时</td><td>{telemetryDuration(telemetryElapsed(agent, now))}</td><td>{telemetryDuration(telemetryElapsed(manual, now))}</td></tr><tr><td>结束后人工核对耗时</td><td>{agent.reviewed ? telemetryDuration(agent.reviewDurationMs) : '待复核'}</td><td>{manual.reviewed ? telemetryDuration(manual.reviewDurationMs) : '待复核'}</td></tr><tr><td>目标 / 人工核实正确</td><td>{agent.expectedFields ?? '未知'} / {agent.reviewed ? agent.verifiedFields : '待复核'}</td><td>{manual.expectedFields ?? '未知'} / {manual.reviewed ? manual.verifiedFields : '待复核'}</td></tr><tr><td>执行器核实</td><td>{agent.observedVerifiedFields}</td><td>—</td></tr><tr><td>人工修改 / 接管</td><td>{agent.reviewed ? `${agent.manualCorrections} / ${agent.interventions}` : '待复核'}</td><td>{manual.reviewed ? `${manual.manualCorrections} / ${manual.interventions}` : '待复核'}</td></tr><tr><td>Token 消耗</td><td>{telemetryTokenLabel(agent)}</td><td>{telemetryTokenLabel(manual)}</td></tr></tbody></table>}
        {comparison?.comparable && comparison.timeSavedPercent !== undefined ? <div className="telemetry-comparison-result" data-testid="telemetry-savings">本组含人工核对的总耗时{comparison.timeSavedPercent >= 0 ? '减少' : '增加'} <strong>{Math.abs(comparison.timeSavedPercent).toFixed(1)}%</strong>。仅代表所选两轮。</div> : <Notice>{comparison?.reason || '还需要一轮同表单人工计时，目前不显示提升比例。'}</Notice>}
      </section>
      <section className="telemetry-latency" data-testid="telemetry-latency" data-sample-count={latency.samples}><strong>同表单本地耗时观察 · {latency.samples} 轮</strong><dl><div><dt>中位 P50</dt><dd>{telemetryDuration(latency.p50Ms)}</dd></div><div><dt>长尾 P95</dt><dd>{latency.samples >= 20 ? telemetryDuration(latency.p95Ms) : '样本不足 20 轮'}</dd></div><div><dt>模型请求中位耗时</dt><dd>{latency.modelSamples ? telemetryDuration(latency.modelP50Ms) : '暂无模型请求'}</dd></div></dl><p className="telemetry-note">仅正常产品中完成或部分完成的 Agent 执行，不含人工核对与 fixture；目标可能不同，非正式评测。模型为完整请求时间，不是首字延迟。</p></section></>}
    </div></details>}
    {!compact && !!runs.length && <details className="telemetry-advanced" data-testid="telemetry-advanced"><summary><span>高级记录<span className="telemetry-summary-description">原始轨迹、历史与导出</span></span><ChevronDown size={15} /></summary><div className="telemetry-experiment-content">
      <div className="telemetry-actions"><Button variant="secondary" data-testid="telemetry-export" onClick={() => void exportTraces()} busy={busy} disabled={!runs.length || !!active}><Download size={14} />导出 OpenTelemetry</Button><span className="telemetry-note">只含动作、计数和时间，不含资料值或私有思考。</span></div>
      <details className="telemetry-history"><summary>全部轮次 · {runs.length}</summary>{runs.map(run => <button type="button" key={run.id} data-testid="telemetry-run" data-run-id={run.id} data-mode={run.mode} aria-pressed={selected?.id === run.id} className={`telemetry-run-button ${selected?.id === run.id ? 'active' : ''}`} onClick={() => { setSelectedId(run.id); setStageId(undefined); }}>{runLabel(run)}<Badge tone={statusTone(run)}>{telemetryStatusLabels[run.status]}</Badge><span>{telemetryDuration(telemetryElapsed(run, now))}</span></button>)}</details>
      {selected && <details className="telemetry-raw-trace" data-testid="telemetry-raw-trace"><summary>原始片段与父子关系 · {rows.length}</summary><div className="telemetry-timeline" data-testid="telemetry-timeline" data-span-count={rows.length}>{rows.map(row => <div className={`telemetry-span ${row.span.status}`} key={row.span.id} data-testid="telemetry-span" data-span-id={row.span.id} data-parent-id={row.span.parentId ?? ''} data-depth={row.depth}><div className="telemetry-span-label" style={{ paddingLeft: row.depth * 10 }}><strong>{telemetrySpanLabel(row.span)}</strong><small>+{telemetryDuration(row.offsetMs)}</small></div><div className="telemetry-span-track" role="img" aria-label={`${telemetrySpanLabel(row.span)}，开始于 ${telemetryDuration(row.offsetMs)}，耗时 ${telemetryDuration(row.span.durationMs)}`}><i className="telemetry-span-bar" style={{ left: `${row.leftPercent}%`, width: `${row.widthPercent}%` }} /></div><span className="telemetry-span-duration">{telemetryDuration(row.span.durationMs)}</span></div>)}</div><p className="telemetry-trace-id">Trace ID: {selected.traceId}</p></details>}
      {selected && <p className="telemetry-note">{selected.tokens && selected.usageComplete && selected.modelCalls > 0 ? `输入 ${selected.tokens.input} · 输出 ${selected.tokens.output} · 缓存读 ${selected.tokens.cacheRead} / 写 ${selected.tokens.cacheWrite}` : '规则路径可为 0 Token；模型用量不完整时显示未知，费用以服务商账单为准。'}</p>}
    </div></details>}
  </div>;
}

function MeasurementReview({ run, busy, onSave }: {
  run: TelemetryRun; busy: boolean;
  onSave: (values: NonNullable<ReturnType<typeof telemetryReviewValues>>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => telemetryReviewDraft(run)); const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const fields = [ ['expectedFields', '目标字段数'], ['verifiedFields', '人工核实正确的字段数'], ['manualCorrections', '手动修改次数'], ['interventions', '人工接管次数'] ] as const;
  return <details className="telemetry-review" data-testid="telemetry-review" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{run.reviewed ? '人工复核已保存 · 可以修订' : '补充人工复核（对比前必填）'}</summary><p className="telemetry-note" style={{ marginTop: 10 }}>先在网页完成逐项检查和必要修正，再立即确认复核。结束计时到首次确认复核的间隔也计入总耗时；中途搁置的记录请勿用于对比。修改或接管均可为 0；未复核不会当作 0 次。</p><div className="telemetry-review-grid">{fields.map(([key, label]) => <Field key={key} label={label}><input type="number" min={key === 'expectedFields' ? 1 : 0} max="100000" step="1" data-testid={`telemetry-review-${key}`} value={draft[key]} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setInvalid(false); }} /></Field>)}</div><label className="telemetry-confirm"><input type="checkbox" data-testid="telemetry-review-clean" checked={draft.cleanStartConfirmed} onChange={event => setDraft(current => ({ ...current, cleanStartConfirmed: event.target.checked }))} /><span>我确认本轮使用相同空白起点、资料和目标，且从填写到核对连续完成、未中途搁置。没有核实就不要勾选。</span></label>{invalid && <p role="alert" className="inline-error">请填写整数；目标至少 1 项，正确字段不能多于目标。</p>}<Button data-testid="telemetry-review-save" variant="secondary" busy={busy} onClick={() => void (async () => { const values = telemetryReviewValues(draft); if (!values) { setInvalid(true); return; } if (await onSave(values)) setOpen(false); })()}>{run.reviewed ? '保存复核修订' : '确认复核并记录总耗时'}</Button></details>;
}
