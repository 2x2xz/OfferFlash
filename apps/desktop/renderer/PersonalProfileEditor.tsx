import type { PersonalProfile, PersonalProfileInput } from '../../../packages/shared/src/contracts.js';
import { emptyPersonalInput, personalHasContent, pickPersonalInput } from '../../../packages/profile/src/personal-input.js';
import { Badge, Button, Field } from './components.js';
import './personal-profile.css';

export function PersonalProfileEditor({ value, saved, dirty, busy, onChange, onConfirm }: {
  value?: PersonalProfileInput; saved?: PersonalProfile; dirty: boolean; busy: boolean;
  onChange: (value: PersonalProfileInput) => void; onConfirm: () => void;
}) {
  const draft = value ?? emptyPersonalInput();
  const same = !!saved && JSON.stringify(pickPersonalInput(saved)) === JSON.stringify(pickPersonalInput(draft));
  const confirmed = same && saved.confirmedRevision === saved.revision && !!saved.confirmedAt;
  const collection = <K extends 'languages' | 'software' | 'awards'>(key: K, next: PersonalProfileInput[K]) => onChange({ ...draft, [key]: next });
  return <section className="personal-profile-editor" data-testid="personal-profile-editor">
    <div className="personal-profile-heading"><h3 className="form-section-title">语言、软件、荣誉与自我评价</h3><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '已确认当前修订' : personalHasContent(draft) ? '待保存或确认' : '尚未填写'}</Badge></div>
    <p className="field-hint">保留你明确提供的事实。考试成绩、自评和听说读写分别填写，不互相推断；未提供的内容可留空。先保存资料，再确认本区，才供自动填写使用。</p>
    <fieldset disabled={busy} className="profile-fieldset">
      <div className="personal-profile-heading"><h4>语言能力</h4><Button variant="secondary" data-testid="personal-add-language" onClick={() => collection('languages', [...draft.languages, { id: `language-${crypto.randomUUID()}`, language: '', examName: '', score: '', certificateName: '', selfAssessment: '', listeningSpeaking: '', readingWriting: '', sourceNote: '' }])}>添加语言</Button></div>
      {draft.languages.map((item, index) => {
        const update = (field: keyof typeof item, value: string) => collection('languages', draft.languages.map(row => row.id === item.id ? { ...row, [field]: value } : row));
        return <article key={item.id} className="personal-profile-row" data-testid="personal-language-row"><div className="personal-profile-heading"><strong>语言 {index + 1}</strong><Button variant="ghost" aria-label={`移除语言 ${index + 1}`} onClick={() => collection('languages', draft.languages.filter(row => row.id !== item.id))}>移除</Button></div><div className="form-grid">
          <Field label="语言"><input maxLength={200} value={item.language} onChange={event => update('language', event.target.value)} /></Field>
          <Field label="考试名称"><input maxLength={500} value={item.examName} onChange={event => update('examName', event.target.value)} /></Field>
          <Field label="成绩 / 等级" hint="原样填写，不换算或推定级别"><input maxLength={200} value={item.score} onChange={event => update('score', event.target.value)} /></Field>
          <Field label="证书名称"><input maxLength={500} value={item.certificateName} onChange={event => update('certificateName', event.target.value)} /></Field>
          <Field label="听说能力"><input maxLength={500} value={item.listeningSpeaking} onChange={event => update('listeningSpeaking', event.target.value)} /></Field>
          <Field label="读写能力"><input maxLength={500} value={item.readingWriting} onChange={event => update('readingWriting', event.target.value)} /></Field>
          <div className="field-full"><Field label="语言自评" hint="保留你自己的描述，不根据考试成绩自动生成"><textarea rows={2} maxLength={2000} value={item.selfAssessment} onChange={event => update('selfAssessment', event.target.value)} /></Field></div>
          <div className="field-full"><Field label="本条来源 / 核对说明"><input maxLength={2000} value={item.sourceNote} onChange={event => update('sourceNote', event.target.value)} /></Field></div>
        </div></article>;
      })}
      {!draft.languages.length && <p className="personal-profile-empty">尚未填写语言；旧答案库中的原文不会自动拆成语言事实。</p>}
      <div className="personal-profile-heading"><h4>软件与工具</h4><Button variant="secondary" data-testid="personal-add-software" onClick={() => collection('software', [...draft.software, { id: `software-${crypto.randomUUID()}`, name: '', proficiency: '', description: '', sourceNote: '' }])}>添加软件 / 工具</Button></div>
      {draft.software.map((item, index) => {
        const update = (field: keyof typeof item, value: string) => collection('software', draft.software.map(row => row.id === item.id ? { ...row, [field]: value } : row));
        return <article key={item.id} className="personal-profile-row" data-testid="personal-software-row"><div className="personal-profile-heading"><strong>软件 / 工具 {index + 1}</strong><Button variant="ghost" aria-label={`移除软件 ${index + 1}`} onClick={() => collection('software', draft.software.filter(row => row.id !== item.id))}>移除</Button></div><div className="form-grid">
          <Field label="软件 / 工具名称"><input maxLength={500} value={item.name} onChange={event => update('name', event.target.value)} /></Field><Field label="熟练程度" hint="仅填写你明确确认的程度"><input maxLength={500} value={item.proficiency} onChange={event => update('proficiency', event.target.value)} /></Field>
          <div className="field-full"><Field label="使用说明"><textarea rows={2} maxLength={10000} value={item.description} onChange={event => update('description', event.target.value)} /></Field></div><div className="field-full"><Field label="本条来源 / 核对说明"><input maxLength={2000} value={item.sourceNote} onChange={event => update('sourceNote', event.target.value)} /></Field></div>
        </div></article>;
      })}
      <div className="personal-profile-heading"><h4>荣誉与奖励</h4><Button variant="secondary" data-testid="personal-add-award" onClick={() => collection('awards', [...draft.awards, { id: `award-${crypto.randomUUID()}`, name: '', issuer: '', date: '', description: '', sourceNote: '' }])}>添加荣誉 / 奖励</Button></div>
      {draft.awards.map((item, index) => {
        const update = (field: keyof typeof item, value: string) => collection('awards', draft.awards.map(row => row.id === item.id ? { ...row, [field]: value } : row));
        return <article key={item.id} className="personal-profile-row" data-testid="personal-award-row"><div className="personal-profile-heading"><strong>荣誉 / 奖励 {index + 1}</strong><Button variant="ghost" aria-label={`移除荣誉 ${index + 1}`} onClick={() => collection('awards', draft.awards.filter(row => row.id !== item.id))}>移除</Button></div><div className="form-grid">
          <Field label="荣誉 / 奖励名称"><input maxLength={1000} value={item.name} onChange={event => update('name', event.target.value)} /></Field><Field label="颁发机构"><input maxLength={1000} value={item.issuer} onChange={event => update('issuer', event.target.value)} /></Field>
          <Field label="获奖日期" hint="已知年份即可，不补月份或日期"><input maxLength={10} placeholder="YYYY / YYYY-MM / YYYY-MM-DD" value={item.date} onChange={event => update('date', event.target.value)} /></Field><Field label="本条来源 / 核对说明"><input maxLength={2000} value={item.sourceNote} onChange={event => update('sourceNote', event.target.value)} /></Field>
          <div className="field-full"><Field label="荣誉说明"><textarea rows={2} maxLength={10000} value={item.description} onChange={event => update('description', event.target.value)} /></Field></div>
        </div></article>;
      })}
      <Field label="自我评价原文" hint="保留原文与换行；自动填写不擅自扩写"><textarea data-testid="personal-self-evaluation" rows={6} maxLength={20000} value={draft.selfEvaluation} onChange={event => onChange({ ...draft, selfEvaluation: event.target.value })} /></Field>
      <Field label="本区资料来源 / 核对说明"><textarea rows={2} maxLength={2000} value={draft.sourceNote} onChange={event => onChange({ ...draft, sourceNote: event.target.value })} /></Field>
    </fieldset>
    <div className="personal-profile-confirm"><Button variant="secondary" data-testid="personal-profile-confirm" disabled={busy || dirty || !same || confirmed || !personalHasContent(draft)} onClick={onConfirm}>已核对，确认这些网申资料</Button><p className="field-hint">{dirty ? '请先用下方按钮保存草稿，再确认本区资料。' : confirmed ? '编辑后需要重新保存和确认，旧确认不会用于新内容。' : '确认只针对已保存的当前修订，不会改写旧答案库。'}</p></div>
  </section>;
}
