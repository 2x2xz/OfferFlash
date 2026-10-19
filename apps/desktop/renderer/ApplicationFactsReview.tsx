import type { ApplicationFactsPreview, ApplicationFactValue } from '../../../packages/profile/src/application-facts.js';
import { Button, Notice } from './components.js';

function valueText(value?: ApplicationFactValue): string {
  return value === undefined || value === '' ? '未填写' : typeof value === 'boolean' ? value ? '是' : '否' : Array.isArray(value) ? value.join('、') : value;
}
const statusText = { empty: '补充空白', conflict: '与已有值不同', unchanged: '保持原值', unmatched: '尚无对应经历', ambiguous: '对应经历不唯一' };

export function ApplicationFactsReview({ preview, selected, busy, blocked, onSelected, onApply, onCancel }: {
  preview: ApplicationFactsPreview; selected: string[]; busy: boolean; blocked: boolean;
  onSelected: (ids: string[]) => void; onApply: () => void; onCancel: () => void;
}) {
  return <section className="card card-pad application-facts-review" data-testid="application-facts-preview" aria-label="网申履历导入预览">
    <h3 className="form-section-title">核对要补入的网申资料</h3>
    <p className="field-hint">只默认勾选已有经历的空白项。与已有值不同的内容由你逐项选择；应用后仍需保存并确认修改的经历。</p>
    {preview.warnings.map((warning, index) => <Notice key={index} tone="warning">{warning}</Notice>)}
    {blocked && <Notice tone="warning">资料版本已变化或当前已有未保存修改。请先保存当前草稿，再重新导入，避免覆盖编辑内容。</Notice>}
    <div style={{ overflowX: 'auto', maxHeight: 420, marginTop: 14 }}><table><thead><tr><th>选用</th><th>经历与字段</th><th>已有资料</th><th>导入候选</th><th>核对</th></tr></thead><tbody>{preview.candidates.map(candidate => {
      const selectable = candidate.status === 'empty' || candidate.status === 'conflict';
      return <tr key={candidate.id} data-testid="application-facts-candidate" data-candidate-id={candidate.id} data-status={candidate.status} data-fact-status={candidate.status}>
        <td><input type="checkbox" aria-label={`选用${candidate.recordLabel}的${candidate.label}`} disabled={busy || blocked || !selectable} checked={selected.includes(candidate.id)} onChange={event => onSelected(event.target.checked ? [...selected, candidate.id] : selected.filter(id => id !== candidate.id))} /></td>
        <td>{candidate.recordLabel}<br /><strong>{candidate.label}</strong></td><td style={{ overflowWrap: 'anywhere' }}>{valueText(candidate.currentValue)}</td><td style={{ overflowWrap: 'anywhere' }}>{valueText(candidate.value)}</td><td>{statusText[candidate.status]}</td>
      </tr>;
    })}</tbody></table></div>
    {!preview.candidates.length && <p className="field-hint">文件没有可补充内容。先填写模板，或在下方添加对应的教育、实习、项目后重新导入。</p>}
    <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={onCancel}>取消导入</Button><Button data-testid="application-facts-apply" disabled={busy || blocked || !selected.length} busy={busy} onClick={onApply}>应用 {selected.length} 项到资料草稿</Button></div>
  </section>;
}
