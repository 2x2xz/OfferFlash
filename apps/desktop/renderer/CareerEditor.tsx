import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import type { CareerCollection, CareerHistory, CareerInput, CareerRecordState, CareerSourceInput, EducationInput, InternshipInput, ProjectInput, PublicationInput } from '../../../packages/shared/src/contracts.js';
import { newCareerRecord, pickCareerInput } from '../../../packages/profile/src/career-input.js';
import { Badge, Button, Field } from './components.js';
import { parseList } from './helpers.js';

type CareerRecord = EducationInput | InternshipInput | ProjectInput | PublicationInput;
const collectionLabels: Record<CareerCollection, string> = { educations: '教育经历', internships: '实习经历', projects: '项目经历', publications: '论文与研究成果' };
const fieldLabels: Record<string, string> = { majorCategory: '专业类别', schoolCategory: '学校类别', studyMode: '学习形式', college: '学院 / 院系', school: '学校', schoolEn: '英文学校', degree: '学历', major: '专业', majorEn: '英文专业', startDate: '开始日期', endDate: '结束日期', description: '说明 / 内容', organization: '单位', role: '职位 / 角色', current: '至今', technologies: '技术', name: '项目名称', ongoing: '进行中', url: '链接', title: '标题', authors: '作者', venue: '期刊 / 会议', publicationDate: '成果日期', status: '成果状态', doi: 'DOI' };
const publicationLabels: Record<PublicationInput['status'], string> = { published: '已发表', accepted: '已接收', preprint: '预印本', submitted: '已投稿', 'in-progress': '研究中' };
const dateHint = '支持 YYYY、YYYY-MM、YYYY-MM-DD；保留你提供的精度，不补月份或日期';

export function sameCareerRecord(left: CareerRecord, right?: CareerRecord): boolean {
  if (!right) return false;
  const keys = Object.keys(left) as Array<keyof CareerRecord>;
  return keys.length === Object.keys(right).length && keys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.join('，');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value ?? '');
}

function TechnologiesField({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join('，'));
  useEffect(() => { if (JSON.stringify(parseList(text)) !== JSON.stringify(value)) setText(value.join('，')); }, [value]);
  return <Field label="技术与工具" hint="多个条目用逗号分隔；只填写实际使用过的技术"><input value={text} placeholder="例如：Python，PyTorch" onChange={event => { setText(event.target.value); onChange(parseList(event.target.value)); }} /></Field>;
}

function Sources({ record, sources }: { record: CareerRecord; sources: CareerSourceInput[] }) {
  return <details className="career-sources"><summary>事实来源与原始候选{record.evidence.length ? `（${record.evidence.length} 条）` : '（手工草稿）'}</summary>
    {!record.evidence.length && <p className="field-hint">手动添加的草稿。保存时会记录手填内容的来源；下方说明可补充材料名称和核对依据。</p>}
    {record.evidence.map((item, index) => {
      const source = sources.find(value => value.id === item.sourceId);
      const current = (record as unknown as Record<string, unknown>)[item.field];
      const original = item.originalValue;
      const differs = Array.isArray(current) ? JSON.stringify(current) !== JSON.stringify(original.split(/[,，;；、\n]+/).map(value => value.trim()).filter(Boolean)) : String(current ?? '') !== original;
      return <div className="career-evidence" key={`${item.sourceId}-${item.field}-${index}`}>
        <div className="career-evidence-title">{fieldLabels[item.field] ?? item.field} · {source?.kind === 'manual' ? '手动填写' : source?.kind === 'legacy' ? '旧资料迁移' : '简历候选'}</div>
        <dl><div><dt>原始候选</dt><dd>{original || '留空'}</dd></div>{differs && <div><dt>当前编辑值</dt><dd>{valueText(current) || '留空'}</dd></div>}<div><dt>位置</dt><dd>{item.location}</dd></div><div><dt>来源</dt><dd>{source?.fileName ?? source?.label ?? '来源记录缺失，请核对'}</dd></div>{source?.fileHash && <div><dt>文件 hash</dt><dd className="career-hash">{source.fileHash}</dd></div>}</dl>
        <blockquote>{item.quote}</blockquote>{differs && <p className="career-difference">当前值与原文写法不同，请对照原文核对。格式整理或手动修改都不会替换原始出处。</p>}
      </div>;
    })}
  </details>;
}

function RecordCard({ record, saved, savedInput, sources, title, children, dirty, busy, confirming, onRemove, onConfirm, onSourceNote }: {
  record: CareerRecord; saved?: CareerRecord & CareerRecordState; savedInput?: CareerRecord; sources: CareerSourceInput[]; title: string; children: ReactNode;
  dirty: boolean; busy: boolean; confirming: boolean; onRemove: () => void; onConfirm: () => void; onSourceNote: (value: string) => void;
}) {
  const changed = !sameCareerRecord(record, savedInput);
  const confirmed = !changed && saved?.confirmation === 'confirmed' && saved.confirmedRevision === saved.revision;
  const edited = !confirmed && ((changed && !!saved) || (saved?.revision ?? 0) > 1);
  // The frequently missed role/link fields must be visible for existing work
  // and projects, as well as for newly added records.
  const [expanded, setExpanded] = useState(!saved || 'role' in record);
  return <article className="career-card" data-career-record-id={record.id} data-confirmation={confirmed ? 'confirmed' : 'pending'}>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary className="career-card-summary"><span className="career-record-title">{title}</span><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '已确认' : edited ? '修改待核对' : '待确认'}</Badge>{changed && <span className="career-unsaved">未保存</span>}</summary>
      <div className="career-card-body"><fieldset disabled={busy} className="career-fieldset"><div className="form-grid">{children}</div><Sources record={record} sources={sources} /><Field label="来源说明（可选）" hint="可写材料名称、页码或你核对这条经历的依据；不会替换原始出处"><textarea rows={2} maxLength={2000} value={record.sourceNote} onChange={event => onSourceNote(event.target.value)} /></Field></fieldset></div>
    </details>
    <div className="career-record-actions"><span className="field-hint">{confirmed ? `本条已核对 · 修订 ${saved.revision}` : dirty ? '先保存当前资料，再逐条确认' : '核对本条内容和出处后确认'}</span><div className="row"><Button variant="ghost" disabled={busy} onClick={onRemove} aria-label={`移除${title}`}><Trash2 size={13} />移除</Button><Button variant="secondary" disabled={busy || dirty || !saved || confirmed || changed} busy={confirming} onClick={onConfirm}><CheckCircle2 size={13} />{confirmed ? '已确认' : '确认本条'}</Button></div></div>
  </article>;
}

export function CareerEditor({ career, saved, dirty, busy, confirmingId, onChange, onConfirm }: {
  career: CareerInput; saved?: CareerHistory; dirty: boolean; busy: boolean; confirmingId?: string;
  onChange: (career: CareerInput) => void; onConfirm: (collection: CareerCollection, id: string) => void;
}) {
  const savedInput = pickCareerInput(saved);
  function update<K extends CareerCollection>(collection: K, record: CareerInput[K][number]) {
    onChange({ ...career, [collection]: career[collection].map(item => item.id === record.id ? record : item), ...(collection === 'educations' && career.primaryEducationId === record.id ? { primaryEducationId: null } : {}) });
  }
  function add(collection: CareerCollection) { onChange({ ...career, [collection]: [...career[collection], newCareerRecord(collection)] }); }
  function remove(collection: CareerCollection, id: string) { onChange({ ...career, [collection]: career[collection].filter(item => item.id !== id), ...(collection === 'educations' && career.primaryEducationId === id ? { primaryEducationId: null } : {}) }); }
  function card(collection: CareerCollection, record: CareerRecord, title: string, children: ReactNode) {
    return <RecordCard key={record.id} record={record} saved={saved?.[collection].find(item => item.id === record.id)} savedInput={savedInput[collection].find(item => item.id === record.id)} sources={career.sources} title={title} dirty={dirty} busy={busy} confirming={confirmingId === record.id} onRemove={() => remove(collection, record.id)} onConfirm={() => onConfirm(collection, record.id)} onSourceNote={sourceNote => update(collection, { ...record, sourceNote })}>{children}</RecordCard>;
  }
  function section(collection: CareerCollection, children: ReactNode) {
    const count = career[collection].length;
    return <section className="career-section"><div className="career-section-heading"><h4>{collectionLabels[collection]} <span>{count}</span></h4><Button variant="secondary" disabled={busy} onClick={() => add(collection)}><Plus size={14} />添加{collectionLabels[collection]}</Button></div>{count ? children : <p className="career-empty">还没有{collectionLabels[collection]}。可以手动添加，或从简历导入候选。</p>}</section>;
  }
  return <div className="career-editor"><div className="career-intro"><p>支持多条教育、实习、项目与论文记录。保存只保留草稿；助手概要只使用逐条确认的经历。</p><p className="field-hint">日期{dateHint}。移除在保存后生效；编辑默认教育会取消其默认选择，重新确认后可再选择。</p></div>
    {section('educations', career.educations.map(record => card('educations', record, record.school || '未命名教育经历', <>
      <Field label="学校" required><input maxLength={500} placeholder="学校全称" value={record.school} onChange={event => update('educations', { ...record, school: event.target.value })} /></Field><Field label="学历"><input maxLength={100} list="career-degrees" placeholder="例如：本科、硕士" value={record.degree} onChange={event => update('educations', { ...record, degree: event.target.value })} /></Field>
      <Field label="学院 / 院系" hint="填写正式名称，不从学校或专业推测"><input maxLength={500} value={record.college ?? ''} onChange={event => update('educations', { ...record, college: event.target.value })} /></Field><div className="field-full"><Field label="专业"><input maxLength={500} value={record.major} onChange={event => update('educations', { ...record, major: event.target.value })} /></Field></div><Field label="专业类别（可选）" hint="填写你已核实的分类，不从专业名称推定"><input maxLength={500} value={record.majorCategory ?? ''} onChange={event => update('educations', { ...record, majorCategory: event.target.value })} /></Field><Field label="学校类别（可选）" hint="以用户确认或官网分类为准"><input maxLength={500} value={record.schoolCategory ?? ''} onChange={event => update('educations', { ...record, schoolCategory: event.target.value })} /></Field><Field label="学习形式（可选）" hint="例如全日制；未明确时留空"><input maxLength={500} value={record.studyMode ?? ''} onChange={event => update('educations', { ...record, studyMode: event.target.value })} /></Field><Field label="开始日期"><input maxLength={10} placeholder="例如：2022-09" value={record.startDate} onChange={event => update('educations', { ...record, startDate: event.target.value })} /></Field><Field label="结束 / 预计毕业日期" hint={dateHint}><input maxLength={10} placeholder="例如：2026 或 2026-06" value={record.endDate} onChange={event => update('educations', { ...record, endDate: event.target.value })} /></Field>
      <div className="field-full"><Field label="说明"><textarea rows={3} maxLength={50000} placeholder="研究方向、课程或其他已核实的信息" value={record.description} onChange={event => update('educations', { ...record, description: event.target.value })} /></Field></div><div className="field-full"><details className="career-optional"><summary>英文教育信息（可选）</summary><div className="form-grid"><Field label="英文学校"><input maxLength={500} value={record.schoolEn} onChange={event => update('educations', { ...record, schoolEn: event.target.value })} /></Field><Field label="英文专业"><input maxLength={500} value={record.majorEn} onChange={event => update('educations', { ...record, majorEn: event.target.value })} /></Field></div></details></div>
    </>)))}
    {section('internships', career.internships.map(record => card('internships', record, [record.organization, record.role].filter(Boolean).join(' · ') || '未命名实习经历', <>
      <Field label="单位" required><input maxLength={500} value={record.organization} onChange={event => update('internships', { ...record, organization: event.target.value })} /></Field><Field label="实习职位名称" hint="按实际职位填写，保存并确认后可自动填入企业网申"><input maxLength={500} placeholder="例如：算法实习生" value={record.role} onChange={event => update('internships', { ...record, role: event.target.value })} /></Field><Field label="开始日期"><input maxLength={10} placeholder="YYYY / YYYY-MM / YYYY-MM-DD" value={record.startDate} onChange={event => update('internships', { ...record, startDate: event.target.value })} /></Field><Field label="结束日期"><input maxLength={10} disabled={record.current} placeholder={record.current ? '至今' : 'YYYY / YYYY-MM / YYYY-MM-DD'} value={record.endDate} onChange={event => update('internships', { ...record, endDate: event.target.value })} /></Field>
      <div className="field-full"><label className="career-checkbox"><input type="checkbox" checked={record.current} onChange={event => update('internships', { ...record, current: event.target.checked, endDate: event.target.checked ? '' : record.endDate })} />至今仍在这段实习中（勾选后清空结束日期）</label></div><div className="field-full"><TechnologiesField value={record.technologies} onChange={technologies => update('internships', { ...record, technologies })} /></div><div className="field-full"><Field label="实习内容"><textarea rows={4} maxLength={50000} value={record.description} onChange={event => update('internships', { ...record, description: event.target.value })} /></Field></div>
    </>)))}
    {section('projects', career.projects.map(record => card('projects', record, record.name || '未命名项目经历', <>
      <Field label="项目名称" required><input maxLength={500} value={record.name} onChange={event => update('projects', { ...record, name: event.target.value })} /></Field><Field label="项目中担任的角色" hint="填写你本人承担的角色，不从项目名称推测"><input maxLength={500} placeholder="例如：主要开发者、主要负责人" value={record.role} onChange={event => update('projects', { ...record, role: event.target.value })} /></Field><Field label="开始日期"><input maxLength={10} placeholder="YYYY / YYYY-MM / YYYY-MM-DD" value={record.startDate} onChange={event => update('projects', { ...record, startDate: event.target.value })} /></Field><Field label="结束日期"><input maxLength={10} disabled={record.ongoing} placeholder={record.ongoing ? '进行中' : 'YYYY / YYYY-MM / YYYY-MM-DD'} value={record.endDate} onChange={event => update('projects', { ...record, endDate: event.target.value })} /></Field>
      <div className="field-full"><label className="career-checkbox"><input type="checkbox" checked={record.ongoing} onChange={event => update('projects', { ...record, ongoing: event.target.checked, endDate: event.target.checked ? '' : record.endDate })} />项目仍在进行中（勾选后清空结束日期）</label></div><div className="field-full"><TechnologiesField value={record.technologies} onChange={technologies => update('projects', { ...record, technologies })} /></div><div className="field-full"><Field label="项目说明"><textarea rows={4} maxLength={50000} value={record.description} onChange={event => update('projects', { ...record, description: event.target.value })} /></Field></div><div className="field-full"><Field label="项目 GitHub / 作品链接" hint="粘贴这个项目的仓库或作品地址，保存确认后供网申使用；不会自动访问"><input maxLength={4096} placeholder="https://github.com/你的账号/项目仓库" value={record.url} onChange={event => update('projects', { ...record, url: event.target.value })} /></Field></div>
    </>)))}
    {section('publications', career.publications.map(record => card('publications', record, record.title || '未命名论文 / 研究成果', <>
      <div className="field-full"><Field label="论文 / 成果标题" required><input maxLength={1000} value={record.title} onChange={event => update('publications', { ...record, title: event.target.value })} /></Field></div><div className="field-full"><Field label="作者" hint="保留署名顺序和共同作者说明"><input maxLength={3000} value={record.authors} onChange={event => update('publications', { ...record, authors: event.target.value })} /></Field></div><Field label="期刊 / 会议 / 平台"><input maxLength={1000} value={record.venue} onChange={event => update('publications', { ...record, venue: event.target.value })} /></Field><Field label="成果状态" hint="已投稿、已接收与已发表分别保存"><select value={record.status} onChange={event => update('publications', { ...record, status: event.target.value as PublicationInput['status'] })}>{Object.entries(publicationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="成果日期" hint={dateHint}><input maxLength={10} placeholder="按当前状态填写已知日期" value={record.publicationDate} onChange={event => update('publications', { ...record, publicationDate: event.target.value })} /></Field><Field label="DOI"><input maxLength={500} placeholder="未知可留空" value={record.doi} onChange={event => update('publications', { ...record, doi: event.target.value })} /></Field><div className="field-full"><Field label="论文 / 预印本链接" hint="作为文字保存；不会自动访问"><input maxLength={4096} placeholder="https://..." value={record.url} onChange={event => update('publications', { ...record, url: event.target.value })} /></Field></div>
    </>)))}
    <datalist id="career-degrees"><option value="本科" /><option value="硕士" /><option value="博士" /><option value="专科" /></datalist>
  </div>;
}
