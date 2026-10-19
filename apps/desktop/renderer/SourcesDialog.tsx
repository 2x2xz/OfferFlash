import { useState } from 'react';
import { ArrowUpRight, Globe } from 'lucide-react';
import type { SourceDefinition } from '../../../packages/shared/src/contracts.js';
import { Button, Badge, EmptyState, ErrorMessage, Field, Modal, Notice } from './components.js';
import { useWorkspace } from './context.js';
import { errorText, recruitmentLabels } from './helpers.js';
import { CollectionReport, collectionRunMessage } from './CollectionReport.js';

export function SourcesDialog({ onClose }: { onClose: () => void }) {
  const { api, state, sources, setState, openBrowser, notify } = useWorkspace();
  const [busy, setBusy] = useState<string>(); const [query, setQuery] = useState(''); const [error, setError] = useState<string>();
  const [maxPages, setMaxPages] = useState(3); const [pageSize, setPageSize] = useState(20); const [detailLimit, setDetailLimit] = useState(10);
  const validBudget = Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 10 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50 && Number.isInteger(detailLimit) && detailLimit >= 0 && detailLimit <= 50;
  async function refresh(source: SourceDefinition) {
    if (!validBudget || busy) return;
    setBusy(source.id); setError(undefined);
    // Native browser controls need the page to be visible during a bounded list run.
    if (source.mode === 'browser') onClose();
    try {
      const next = await api.refreshSource(source.id, query.trim() || undefined, { maxPages, detailLimit, ...(source.mode === 'public-api' ? { pageSize } : {}) });
      setState(next);
      const run = [...next.sourceRuns].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).find(item => item.sourceId === source.id);
      if (run) {
        if (run.status === 'failed' && source.mode === 'public-api') setError(run.error ?? '本次采集未完成，请查看报告。');
        notify(collectionRunMessage(run), run.status === 'failed');
      }
    } catch (err) { const message = errorText(err); setError(message); notify(message, true); }
    finally { setBusy(undefined); }
  }
  return <Modal title="从可靠的来源发现机会" description="明确本次列表和详情范围；日期与招聘类型以官网信息为准" wide onClose={() => { if (!busy) onClose(); }}><ErrorMessage message={error} />
    <div className="source-collection-settings"><Field label="筛选词 / 输入记录（可选）" hint="接口来源按输入查询；浏览器来源仅记录输入，实际范围以官网页面已设置的筛选为准"><input placeholder="例如：大模型、算法、人工智能" value={query} disabled={!!busy} onChange={event => setQuery(event.target.value)} /></Field><div className="collection-budget-grid">
      <Field label="最多列表页数" hint="1–10 页"><input type="number" min={1} max={10} step={1} value={maxPages} disabled={!!busy} onChange={event => setMaxPages(Number(event.target.value))} aria-label="来源最多列表页数" /></Field>
      <Field label="最多补全详情" hint="0–50 条，0 表示只读列表"><input type="number" min={0} max={50} step={1} value={detailLimit} disabled={!!busy} onChange={event => setDetailLimit(Number(event.target.value))} aria-label="来源最多详情数" /></Field>
      <Field label="接口每页条数" hint="1–50 条，仅用于接口来源"><input type="number" min={1} max={50} step={1} value={pageSize} disabled={!!busy} onChange={event => setPageSize(Number(event.target.value))} aria-label="来源每页条数" /></Field>
    </div>{!validBudget && <ErrorMessage message="请按标注范围填写整数；详情数量可以为 0。" />}</div>
    <div className="sources-list">{sources.map(source => {
      const run = [...state.sourceRuns].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).find(item => item.sourceId === source.id);
      return <div className="source-entry" key={source.id}><div className="source-row"><span className="company-icon">{source.company.slice(0, 1)}</span><div className="grow"><div className="source-title">{source.name}<span style={{ marginLeft: 8 }}><Badge tone={source.type === 'experienced' ? 'amber' : 'muted'}>{recruitmentLabels[source.type]}</Badge></span></div><div className="source-description">{source.description}</div></div><div className="source-actions">{source.mode === 'browser' && <Button variant="secondary" disabled={!!busy} onClick={() => { onClose(); void openBrowser(source.url); }}>打开官网<ArrowUpRight size={13} /></Button>}<Button busy={busy === source.id} disabled={!!busy || !validBudget} onClick={() => void refresh(source)}>获取岗位</Button></div></div>{run && <CollectionReport run={run} compact />}</div>;
    })}{!sources.length && <EmptyState compact icon={<Globe size={23} />} title="招聘来源暂未加载" description="你仍可以打开招聘官网，或在岗位页手动保存机会。" />}</div>
    <div style={{ marginTop: 18 }}><Notice>每次获取最多 {validBudget ? maxPages : '指定'} 页和 {validBudget ? detailLimit : '指定'} 条详情。登录、验证码、未知翻页或请求失败会停止并保留报告；部分完成的岗位仍可核对。经验岗位与校招分别标识。</Notice></div>
  </Modal>;
}
