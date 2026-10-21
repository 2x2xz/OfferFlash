import { useState } from 'react';
import type { UniversalResult } from '../../../packages/browser/src/universal-form.js';

/** Review marks belong only to this result view; they never confirm or save facts. */
export function UniversalDrafts({ result, locked = false }: { result: UniversalResult; locked?: boolean }) {
  const drafts = result.drafts ?? [];
  const [expanded, setExpanded] = useState<UniversalResult>();
  const [reviewed, setReviewed] = useState<{ result: UniversalResult; ids: string[] }>({ result, ids: [] });
  if (!drafts.length) return null;
  const visible = expanded === result ? drafts : drafts.slice(0, 5);
  const marked = reviewed.result === result ? reviewed.ids : [];
  const mark = (id: string, checked: boolean) => setReviewed(current => {
    const ids = current.result === result ? current.ids : [];
    return { result, ids: checked ? [...new Set([...ids, id])] : ids.filter(item => item !== id) };
  });
  return <section className="card card-pad" data-testid="universal-drafts" aria-labelledby="universal-drafts-title">
    <strong id="universal-drafts-title">有 {drafts.length} 项草稿需要你核对</strong>
    <p>下面是本次按来源整理或选择的草稿。请对照实际情况检查网页，最终由你提交。</p>
    <p><small>“我已核对”只保留本次界面的标记，不自动存入个人资料，不改变核实数量或申请状态。</small></p>
    <ol style={{ paddingLeft: 20, marginBlock: 12 }}>
      {visible.map(draft => {
        const characters = Array.from(draft.value), shortened = characters.length > 220;
        return <li key={draft.id} data-testid="universal-draft-row" style={{ marginBottom: 16, overflowWrap: 'anywhere' }}>
          <strong>{[draft.section, draft.label].filter(Boolean).join(' · ') || '待核对字段'}</strong>
          <p><small>{draft.kind === 'selection' ? draft.relation === 'category' ? '按本页选项分类选择的草稿' : '按等义关系选择的草稿' : '按已有事实整理的文字草稿'} · {draft.retained ? '页面已保留，待你核对' : '页面未核实保留，请手动检查'}</small></p>
          <p data-testid="universal-draft-value" style={{ whiteSpace: 'pre-wrap' }}>{shortened ? characters.slice(0, 220).join('') + '…' : draft.value}</p>
          <details data-testid="universal-draft-source"><summary>{shortened ? '查看全文、来源与整理依据' : '查看来源与整理依据'}</summary>
            {shortened && <p style={{ whiteSpace: 'pre-wrap' }}>{draft.value}</p>}
            <p><strong>整理依据：</strong>{draft.reason || '没有提供依据，请逐项核对。'}</p>
            <p><strong>来源引用：</strong>{draft.sourceRefs.length ? draft.sourceRefs.join('、') : '没有来源引用，请手动核对。'}</p>
          </details>
          <label className="row" style={{ fontSize: 12, marginTop: 8 }}><input type="checkbox" data-testid="universal-draft-reviewed" disabled={locked || !draft.retained}
            checked={marked.includes(draft.id)} onChange={event => mark(draft.id, event.currentTarget.checked)} />我已核对（本次标记）</label>
        </li>;
      })}
    </ol>
    {drafts.length > 5 && <button type="button" className="text-link" data-testid="universal-drafts-expand" disabled={locked} onClick={() => setExpanded(expanded === result ? undefined : result)}>
      {expanded === result ? '收起其余草稿' : `显示其余 ${drafts.length - 5} 项草稿`}
    </button>}
  </section>;
}
