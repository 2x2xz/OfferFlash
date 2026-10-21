import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileText, ShieldCheck, Upload, User } from 'lucide-react';
import type { CareerCollection, Profile, ProfileInput, ResumeImport } from '../../../packages/shared/src/contracts.js';
import { emptyCareerInput, mergeCareerImport, pickCareerInput } from '../../../packages/profile/src/career-input.js';
import { Button, ErrorMessage, Field, Notice, SectionHeading } from './components.js';
import { CareerEditor, sameCareerRecord } from './CareerEditor.js';
import { useWorkspace } from './context.js';
import { errorText, parseList, profileFields } from './helpers.js';
import { confirmResumeForApplication } from '../../../packages/ui/src/resume-review.js';
import { SensitiveIdentityPanel } from './SensitiveIdentity.js';
import { ApplicationAssets } from './ApplicationAssets.js';
import { ApplicationFactsReview } from './ApplicationFactsReview.js';
import type { ApplicationFactsPreview } from '../../../packages/profile/src/application-facts.js';
import { OnboardingProfileGuide } from './Onboarding.js';
import { pickPersonalInput } from '../../../packages/profile/src/personal-input.js';
import { PersonalProfileEditor } from './PersonalProfileEditor.js';

const importFieldLabels: Record<string, string> = { fullName: '姓名', phone: '手机号', email: '邮箱', school: '学校', degree: '学历', major: '专业', graduationMonth: '毕业月份', skills: '技能提及', link: '链接' };
export function pickProfile(profile: ProfileInput): ProfileInput {
  return { fullName: profile.fullName, fullNameEn: profile.fullNameEn, email: profile.email, phone: profile.phone, school: profile.school, schoolEn: profile.schoolEn, degree: profile.degree, major: profile.major, majorEn: profile.majorEn, graduationMonth: profile.graduationMonth, skills: [...profile.skills], cities: [...profile.cities], targetRoles: [...profile.targetRoles], resumeText: profile.resumeText, ...(profile.birthDate !== undefined ? { birthDate: profile.birthDate } : {}), ...(profile.personal ? { personal: pickPersonalInput(profile.personal) } : {}), ...(profile.acceptedRecruitmentTypes?{acceptedRecruitmentTypes:[...profile.acceptedRecruitmentTypes]}:{}), ...(profile.career ? { career: pickCareerInput(profile.career) } : {}) };
}

function listValues(profile: ProfileInput) { return { skills: profile.skills.join('，'), cities: profile.cities.join('，'), targetRoles: profile.targetRoles.join('，') }; }

export function ProfilePage({ importRequest = 0, focused = false, onboardingStep, onResumeImportResult, onOnboardingConfirmed, onDismissOnboarding }: {
  importRequest?: number; focused?: boolean; onboardingStep?: 'import' | 'review';
  onResumeImportResult?: (result: 'imported' | 'cancelled') => void;
  onOnboardingConfirmed?: () => void; onDismissOnboarding?: () => void;
}) {
  const { state, api, setState, notify, navigate, openApplicationSetup } = useWorkspace();
  const [draft, setDraft] = useState(() => pickProfile(state.profile));
  const [listInputs, setListInputs] = useState(() => listValues(state.profile));
  const [version, setVersion] = useState(state.profile.version); const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'import' | 'confirm' | 'reload'>(); const [confirmingId, setConfirmingId] = useState<string>(); const [error, setError] = useState<string>(); const [imported, setImported] = useState<string>();
  const [factsPreview, setFactsPreview] = useState<ApplicationFactsPreview>();
  const [factsSelected, setFactsSelected] = useState<string[]>([]);
  const [importReview, setImportReview] = useState<ResumeImport>();
  const consumedImportRequest = useRef(0);
  const [selectedEducationId, setSelectedEducationId] = useState(state.profile.career?.primaryEducationId ?? '');
  const career = draft.career ?? emptyCareerInput();
  const selectedEducation = career.educations.find(item => item.id === selectedEducationId);
  const savedCareerInput = pickCareerInput(state.profile.career);
  const confirmedEducations = career.educations.filter(item => {
    const saved = state.profile.career?.educations.find(record => record.id === item.id);
    return saved?.confirmation === 'confirmed' && saved.confirmedRevision === saved.revision && sameCareerRecord(item, savedCareerInput.educations.find(record => record.id === item.id));
  });
  const primary = confirmedEducations.find(item => item.id === career.primaryEducationId);
  const defaultEducation = draft.career ? { school: primary?.school ?? '', schoolEn: primary?.schoolEn ?? '', degree: primary?.degree ?? '', major: primary?.major ?? '', majorEn: primary?.majorEn ?? '', graduationMonth: primary?.endDate && /^\d{4}-\d{2}(?:-\d{2})?$/.test(primary.endDate) ? primary.endDate.slice(0, 7) : '' } : { school: draft.school, schoolEn: draft.schoolEn, degree: draft.degree, major: draft.major, majorEn: draft.majorEn, graduationMonth: draft.graduationMonth };
  const fields = profileFields({ ...draft, ...defaultEducation }); const completed = fields.filter(field => field.complete).length;
  const conflict = dirty && state.profile.version !== version;
  useEffect(() => { if (!dirty && version !== state.profile.version) { setDraft(pickProfile(state.profile)); setListInputs(listValues(state.profile)); setVersion(state.profile.version); } }, [state.profile, dirty, version]);
  useEffect(() => { if (!dirty && !selectedEducationId && state.profile.career?.primaryEducationId) setSelectedEducationId(state.profile.career.primaryEducationId); }, [dirty, selectedEducationId, state.profile.career?.primaryEducationId]);
  useEffect(() => {
    if (importRequest > consumedImportRequest.current) { consumedImportRequest.current = importRequest; void importResume(); }
  }, [importRequest]);
  function change<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) { setDraft(current => ({ ...current, [key]: value })); setDirty(true); setError(undefined); }
  function changeList(key: 'skills' | 'cities' | 'targetRoles', value: string) { setListInputs(current => ({ ...current, [key]: value })); change(key, parseList(value)); }
  function loadSaved(profile: Profile) { setDraft(pickProfile(profile)); setListInputs(listValues(profile)); setVersion(profile.version); setDirty(false); }
  async function refreshStateAfterFailure() { try { setState(await api.getState()); } catch { /* Keep the editable draft and original error when rereading fails. */ } }
  async function reload() {
    setBusy('reload'); setError(undefined);
    try { const updated = await api.getState(); setState(updated); loadSaved(updated.profile); setImported(undefined); setImportReview(undefined); }
    catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function save() {
    if (busy || conflict) return;
    setBusy('save'); setError(undefined);
    try { const updated = await api.saveProfile(pickProfile(draft), version); setState(updated); loadSaved(updated.profile); setImported(undefined); setImportReview(undefined); notify('基础资料已确认保存；履历草稿请逐条核对确认'); }
    catch (err) { setError(errorText(err)); await refreshStateAfterFailure(); } finally { setBusy(undefined); }
  }
  async function importFacts() {
    if (busy || dirty || conflict) return;
    setFactsPreview(undefined); setFactsSelected([]);
    setBusy('import'); setError(undefined);
    try {
      const result = await api.importApplicationFacts();
      if (!result.cancelled && result.preview) {
        setFactsPreview(result.preview); setFactsSelected(result.preview.candidates.filter(candidate => candidate.status === 'empty').map(candidate => candidate.id));
      }
    } catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function applyFacts() {
    if (!factsPreview || busy || dirty || conflict || factsPreview.profileVersion !== version) return;
    setBusy('import'); setError(undefined);
    try {
      const next = await api.applyApplicationFactsImport(factsPreview.id, factsSelected, version);
      setDraft(pickProfile(next)); setListInputs(listValues(next)); setDirty(true); setImported(factsPreview.source.fileName ?? '网申履历补充资料');
      setFactsPreview(undefined); setFactsSelected([]); notify('已补入当前资料草稿。请保存，再确认修改的经历，之后可供自动填写。');
    } catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function downloadFactsTemplate() {
    if (busy) return; setBusy('import'); setError(undefined);
    try { const result = await api.exportApplicationFactsTemplate(); if (!result.cancelled) notify('已保存空白履历模板。填写现有经历名称或记录ID、角色、日期及项目链接后可导入。'); }
    catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function confirm(collection: CareerCollection, id: string) {
    if (busy || dirty || state.profile.version !== version) return;
    const record = state.profile.career?.[collection].find(item => item.id === id);
    if (!record) { setError('本条尚未保存，请先保存资料。'); return; }
    setBusy('confirm'); setConfirmingId(id); setError(undefined);
    try { const updated = await api.confirmCareerRecord(collection, id, version, record.revision); setState(updated); loadSaved(updated.profile); notify('本条经历已确认；教育经历可再选择为默认教育'); }
    catch (err) { setError(errorText(err)); await refreshStateAfterFailure(); } finally { setBusy(undefined); setConfirmingId(undefined); }
  }
  async function confirmPersonal() {
    if (busy || dirty || state.profile.version !== version || !state.profile.personal) return;
    setBusy('confirm'); setError(undefined);
    try { const updated = await api.confirmPersonalProfile(version, state.profile.personal.revision); setState(updated); loadSaved(updated.profile); notify('语言、软件、荣誉和自我评价已确认当前修订。'); }
    catch (err) { setError(errorText(err)); await refreshStateAfterFailure(); } finally { setBusy(undefined); }
  }
  async function importApplyDock() {
    if (busy || dirty) { setError('请先保存或放弃当前草稿，再导入 ApplyDock。'); return; }
    setBusy('import'); setError(undefined);
    try {
      const result = await api.importApplyDock();
      if (!result.cancelled && result.state) {
        setState(result.state); loadSaved(result.state.profile);
        setImported('ApplyDock 已保存资料');
        notify(`已补入 ${result.addedFields ?? 0} 项，保留 ${result.conflictCount ?? 0} 项已有差异；改动的经历请核对确认。`);
        if (result.warnings?.length) setError(result.warnings.join('；'));
      }
    } catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function importResume() {
    if (busy) return;
    setBusy('import'); setError(undefined);
    try { const result = await api.importResume(); if (!result.cancelled) {
      // Education candidates belong to records. Importing cannot select or replace a default education.
      const { school, schoolEn, degree, major, majorEn, graduationMonth, career: suggestedCareer, ...baseSuggested } = result.suggested ?? {};
      setDraft(current => pickProfile({ ...current, ...baseSuggested, resumeText: result.text ?? current.resumeText, career: mergeCareerImport(pickCareerInput(current.career), pickCareerInput(result.career ?? suggestedCareer)) }));
      setListInputs(current => ({ ...current, ...(result.suggested?.skills ? { skills: result.suggested.skills.join('，') } : {}), ...(result.suggested?.cities ? { cities: result.suggested.cities.join('，') } : {}), ...(result.suggested?.targetRoles ? { targetRoles: result.suggested.targetRoles.join('，') } : {}) })); setDirty(true); setImported(result.fileName ?? '导入的简历'); setImportReview(result); onResumeImportResult?.('imported');
    } else onResumeImportResult?.('cancelled'); }
    catch (err) { setError(errorText(err)); } finally { setBusy(undefined); }
  }
  async function confirmAndRecommend() {
    if (busy || conflict || (career.educations.length > 0 && !selectedEducation)) return;
    setBusy('save'); setError(undefined);
    try {
      await confirmResumeForApplication({ state, draft: pickProfile(draft), dirty, expectedVersion: version, educationId: selectedEducationId, api,
        onSaved: updated => { setState(updated); loadSaved(updated.profile); } });
      notify('资料已确认，已按当前岗位库重新匹配。其他履历草稿仍保留待确认。'); onOnboardingConfirmed?.(); navigate('apply');
    } catch (err) { setError(errorText(err)); await refreshStateAfterFailure(); }
    finally { setBusy(undefined); }
  }
  function changeSelectedEducation(key: 'school' | 'college' | 'degree' | 'major' | 'startDate' | 'endDate', value: string) {
    if (!selectedEducation) return;
    change('career', { ...career, educations: career.educations.map(item => item.id === selectedEducation.id ? { ...item, [key]: value } : item) });
  }
  return <div className="page">{onboardingStep && <OnboardingProfileGuide step={onboardingStep} busy={!!busy} onImport={() => void importResume()} onSkip={() => onDismissOnboarding?.()} />}<SectionHeading title={focused ? '核对网申资料，开始申请' : '网申资料'} description={focused ? '先确认联系信息，再明确选择一条用于匹配和普通网申的教育。其他经历稍后补充。' : '资料保存在本机。基础资料确认保存，履历保存为草稿后逐条核对确认'} action={<div className="row">{openApplicationSetup&&<Button variant="secondary" disabled={!!busy||dirty} onClick={openApplicationSetup}>填写前资料引导</Button>}<Button variant="secondary" disabled={!!busy || dirty} data-testid="import-applydock" onClick={() => void importApplyDock()}>导入 ApplyDock 资料</Button><Button variant="secondary" busy={busy === 'import'} disabled={!!busy} data-testid="profile-import-resume" onClick={() => void importResume()}><Upload size={15} />导入 TXT / PDF / DOCX</Button></div>} />
    {!onboardingStep && <section className="card card-pad" data-testid="application-profile-guide">
      <h3 className="form-section-title">先准备资料，网申时直接用</h3>
      <p className="profile-privacy">在下方填写教育、实习职位、项目角色、时间、说明，以及每个项目自己的 GitHub / 作品链接。保存并确认经历后，Agent 会从对应记录取值，不会凭空猜角色或链接。</p>
      <p className="form-source-note">实习 / 项目 {career.internships.length + career.projects.length} 条 · 尚未填写职位或角色 {career.internships.filter(item => !item.role.trim()).length + career.projects.filter(item => !item.role.trim()).length} 条 · 项目链接待补 {career.projects.filter(item => !item.url.trim()).length} 条（可稍后补）</p>
      <div className="section-heading-actions" style={{ marginTop: 14 }}><Button data-testid="application-facts-import" variant="secondary" disabled={!!busy || dirty || conflict} busy={busy === 'import'} onClick={() => void importFacts()}>导入履历补充资料</Button><Button data-testid="application-facts-template" variant="ghost" disabled={!!busy} onClick={() => void downloadFactsTemplate()}>下载填写模板</Button></div>
      <p className="field-hint">简历用上方按钮导入；补充模板支持 JSON，按已有经历名称或记录 ID 对应，先预览差异。也可以直接在下方粘贴项目链接。至今 / 进行中的经历保留原状态，不补猜结束日期。</p>
      <ErrorMessage message={error} />
    </section>}
    {factsPreview && <ApplicationFactsReview preview={factsPreview} selected={factsSelected} busy={!!busy} blocked={dirty || conflict || factsPreview.profileVersion !== version} onSelected={setFactsSelected} onApply={() => void applyFacts()} onCancel={() => { setFactsPreview(undefined); setFactsSelected([]); }} />}
    {focused && <section className="card card-pad focused-resume-review" data-testid="resume-review"><ErrorMessage message={error} />{imported && <div className="import-preview"><FileText size={17} /><div>已提取 {imported} 的候选信息。请对照简历核对下方内容，确认后即可匹配。</div></div>}{conflict && <Notice tone="warning">已保存资料版本发生变化，当前草稿保留。请在下方完整资料中重新载入后再确认。</Notice>}{importReview?.warnings?.map(warning => <Notice key={warning} tone="warning">{warning}</Notice>)}<fieldset className="profile-fieldset" disabled={!!busy}><div className="form-grid"><Field label="姓名"><input value={draft.fullName} onChange={event => change('fullName', event.target.value)} /></Field><Field label="手机号"><input inputMode="tel" value={draft.phone} onChange={event => change('phone', event.target.value)} /></Field><div className="field-full"><Field label="邮箱"><input type="email" value={draft.email} onChange={event => change('email', event.target.value)} /></Field></div><div className="field-full"><Field label="选择用于匹配和普通网申的一条教育" hint="点击下方确认按钮，将确认这里显示的教育并设为默认；不会替你选择最高学历。"><select data-testid="resume-education" value={selectedEducation?.id ?? ''} onChange={event => setSelectedEducationId(event.target.value)}><option value="">请明确选择一条教育</option>{career.educations.map(item => <option key={item.id} value={item.id}>{[item.school, item.degree, item.major].filter(Boolean).join(' · ') || '待补充教育'}</option>)}</select></Field></div>{selectedEducation && <><Field label="学校"><input value={selectedEducation.school} onChange={event => changeSelectedEducation('school', event.target.value)} /></Field><Field label="学院 / 院系"><input maxLength={500} value={selectedEducation.college ?? ''} onChange={event => changeSelectedEducation('college', event.target.value)} /></Field><Field label="学历"><input value={selectedEducation.degree} onChange={event => changeSelectedEducation('degree', event.target.value)} /></Field><Field label="专业"><input value={selectedEducation.major} onChange={event => changeSelectedEducation('major', event.target.value)} /></Field><Field label="入学时间"><input placeholder="保留简历提供的精度" value={selectedEducation.startDate} onChange={event => changeSelectedEducation('startDate', event.target.value)} /></Field><Field label="毕业时间" hint="按简历原有的年/月/日精度填写，不补猜月份"><input placeholder="例如：2027-06" value={selectedEducation.endDate} onChange={event => changeSelectedEducation('endDate', event.target.value)} /></Field><div className="field-full focused-education-evidence">{(selectedEducation.schoolEn || selectedEducation.majorEn) && <p>英文：{[selectedEducation.schoolEn, selectedEducation.majorEn].filter(Boolean).join(' · ')}</p>}{selectedEducation.description && <p>{selectedEducation.description}</p>}<strong>这条教育的原始出处</strong>{selectedEducation.evidence.length ? selectedEducation.evidence.slice(0, 5).map((item, index) => <p key={`${item.field}-${index}`}>{item.quote} <small>{item.location}</small></p>) : <p>{selectedEducation.sourceNote || '没有可用原文，请与自己的简历核对。'}</p>}</div></>}</div><p className="focused-profile-summary">已掌握技能：{draft.skills.join('、') || '暂未提供'}<br />目标方向：{draft.targetRoles.join('、') || '暂未提供'} · 意向城市：{draft.cities.join('、') || '不限'}</p></fieldset><div className="form-actions"><Button variant="ghost" disabled={!!busy} onClick={() => navigate('apply')}>返回</Button><Button data-testid="resume-confirm" disabled={!!busy || conflict || !draft.fullName.trim() || (career.educations.length > 0 && !selectedEducation)} busy={busy === 'save' || busy === 'confirm'} onClick={() => void confirmAndRecommend()}><CheckCircle2 size={15} />确认资料并推荐岗位</Button></div><p className="form-source-note">只确认当前显示的基础资料和所选教育；其他实习、项目、论文候选仍需在完整资料中逐条确认。</p></section>}
    <details className="profile-complete-editor" open={!onboardingStep || !focused}><summary>完整网申资料与履历</summary>
    <div className="profile-layout"><section className="card card-pad"><ErrorMessage message={error} />{imported && <div className="import-preview"><FileText size={17} /><div><strong>已从 {imported} 提取候选信息</strong><br />请核对姓名、学校、日期和技能。已有经历保留，新的履历候选需保存后逐条确认；导入不会替你选择默认教育。</div></div>}{conflict && <Notice tone="warning">已保存资料发生变化（草稿基于版本 {version}，当前版本 {state.profile.version}）。你的草稿仍保留，保存与确认已暂停。只有点击“重新载入”才会丢弃当前草稿。</Notice>}
      {importReview?.warnings?.map(warning => <Notice key={warning} tone="warning">{warning}</Notice>)}
      {!!importReview?.evidence?.length && <details className="details-section" open><summary>导入候选与原文出处</summary><p>对照原文核对下方资料。多个候选不会自动选择；链接仅显示文字。</p><div style={{ overflowX: 'auto' }}><table><thead><tr><th>字段</th><th>候选值</th><th>出处与原文</th></tr></thead><tbody>{importReview.evidence.map((item, index) => <tr key={`${item.field}-${index}`}><td>{importFieldLabels[item.field] ?? item.field}</td><td style={{ overflowWrap: 'anywhere' }}>{item.value}</td><td>{item.source}<br /><small>{item.quote}</small></td></tr>)}</tbody></table></div></details>}
      <fieldset disabled={!!busy} className="profile-fieldset"><div className="form-section"><h3 className="form-section-title">基本与联系信息</h3><div className="form-grid"><Field label="姓名"><input autoComplete="name" placeholder="你的真实姓名" value={draft.fullName} onChange={event => change('fullName', event.target.value)} /></Field><Field label="手机号"><input inputMode="tel" autoComplete="tel" placeholder="企业联系你的号码" value={draft.phone} onChange={event => change('phone', event.target.value)} /></Field><Field label="出生日期（可选）" hint="只填写完整日期；不会从年龄或证件号码推算"><input type="date" data-testid="profile-birth-date" value={draft.birthDate ?? ''} onChange={event => change('birthDate', event.target.value)} /></Field><div className="field-full"><Field label="邮箱"><input type="email" autoComplete="email" placeholder="常用的求职邮箱" value={draft.email} onChange={event => change('email', event.target.value)} /></Field></div></div></div>
      <div className="form-section"><h3 className="form-section-title">匹配与普通表单默认教育</h3><Field label="选择一条已确认教育" hint="只列出已保存、逐条确认且当前未修改的记录。选择后保存生效，不自动猜最高学历。"><select value={primary?.id ?? ''} onChange={event => change('career', { ...career, primaryEducationId: event.target.value || null })}><option value="">暂不指定默认教育</option>{confirmedEducations.map(item => <option key={item.id} value={item.id}>{[item.school, item.degree, item.major].filter(Boolean).join(' · ')}</option>)}</select></Field><p className="form-source-note" style={{ marginTop: 12 }}>{dirty ? `以下是当前草稿的默认教育；保存前，岗位匹配仍使用已保存版本 ${state.profile.version}。` : '以下是当前用于岗位匹配和普通表单预览的教育字段。'}</p><div className="form-grid"><Field label="学校"><input readOnly value={defaultEducation.school} placeholder="尚未指定" /></Field><Field label="学历"><input readOnly value={defaultEducation.degree} placeholder="尚未指定" /></Field><Field label="专业"><input readOnly value={defaultEducation.major} placeholder="尚未指定" /></Field><Field label="毕业月份" hint="只有明确提供月份才用于毕业月份；年份级日期不补月份"><input readOnly value={defaultEducation.graduationMonth} placeholder="未提供明确月份" /></Field></div>{!draft.career && [draft.school, draft.degree, draft.major, draft.graduationMonth].some(Boolean) && <Notice tone="warning">旧单条教育资料仍保留。请在下方履历中核对迁移记录，逐条确认后再选择默认教育。</Notice>}</div>
      <div className="form-section"><h3 className="form-section-title">教育、实习与项目 · 提前填写供网申使用</h3><CareerEditor career={career} saved={state.profile.career} dirty={dirty || conflict} busy={!!busy} confirmingId={confirmingId} onChange={value => change('career', value)} onConfirm={(collection, id) => void confirm(collection, id)} /></div>
      <div className="form-section"><h3 className="form-section-title">求职方向与技能</h3><div className="form-grid"><Field label="期望城市" hint="多个城市用逗号分隔"><input placeholder="例如：杭州，北京" value={listInputs.cities} onChange={event => changeList('cities', event.target.value)} /></Field><Field label="招聘类型" hint="保存后用于排除不接受的岗位类型；未知类型仍待核对"><select value={draft.acceptedRecruitmentTypes?.slice().sort().join(',')??'default'} onChange={event=>change('acceptedRecruitmentTypes',event.target.value==='default'?undefined:event.target.value.split(',') as Array<'campus'|'internship'|'experienced'>)}><option value="default">校招优先，实习待核对</option><option value="campus">只找正式校招</option><option value="internship">只找实习</option><option value="campus,internship">校招和实习都接受</option><option value="campus,experienced,internship">也接受社招</option></select></Field><Field label="目标方向" hint="多个方向用逗号分隔"><input placeholder="例如：大模型，算法，AI 应用" value={listInputs.targetRoles} onChange={event => changeList('targetRoles', event.target.value)} /></Field><div className="field-full"><Field label="已掌握的技能" hint="只填写你能在简历和面试中说明的技能，用逗号分隔"><textarea rows={3} placeholder="例如：Python，PyTorch，RAG，模型训练" value={listInputs.skills} onChange={event => changeList('skills', event.target.value)} /></Field></div></div></div>
      <PersonalProfileEditor value={draft.personal} saved={state.profile.personal} dirty={dirty || conflict} busy={!!busy} onChange={value => change('personal', value)} onConfirm={() => void confirmPersonal()} />
      <details className="details-section"><summary>简历全文与原始材料文字</summary><Field label="简历内容" hint="可以导入后修改，也可以直接粘贴文字。正文保存不会自动确认结构化经历，也不会替你补写事实"><textarea rows={8} placeholder="教育背景、项目经历、实习与研究经历……" value={draft.resumeText} onChange={event => change('resumeText', event.target.value)} /></Field></details>
      <details className="details-section"><summary>英文网申资料（可选）</summary><div className="form-grid"><Field label="英文姓名"><input value={draft.fullNameEn} onChange={event => change('fullNameEn', event.target.value)} /></Field><Field label="默认教育的英文学校"><input readOnly value={defaultEducation.schoolEn} placeholder="在教育经历卡片中填写" /></Field><div className="field-full"><Field label="默认教育的英文专业"><input readOnly value={defaultEducation.majorEn} placeholder="在教育经历卡片中填写" /></Field></div></div></details></fieldset>
      <div className="form-actions profile-save-actions">{dirty && <Button variant="ghost" disabled={!!busy} busy={busy === 'reload'} onClick={() => void reload()}>重新载入已保存资料（丢弃草稿）</Button>}<Button data-testid="profile-save" disabled={!dirty || !!busy || conflict} busy={busy === 'save'} onClick={() => void save()}><CheckCircle2 size={15} />确认基础资料并保存履历草稿</Button></div>
    </section><aside className="profile-side"><div className="card card-pad"><SectionHeading title="资料检查" action={<User size={15} color="#a3b1a6" />} /><div className="profile-mini"><div className="progress-row"><span>当前编辑内容</span><span>{completed} / {fields.length}</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${completed / fields.length * 100}%` }} /></div></div><div className="checklist">{fields.map(field => <div className={`checklist-item ${field.complete ? 'complete' : ''}`} key={field.name}><span>{field.name}</span>{field.complete ? <CheckCircle2 size={14} /> : <span className="tiny-circle" />}</div>)}</div></div><div className="card card-pad"><div className="row" style={{ fontSize: 12, color: '#789883', marginBottom: 10 }}><ShieldCheck size={16} />由你确认，由你掌握</div><p className="profile-privacy">基础资料确认保存后用于匹配与表单；履历草稿需逐条确认，教育还需明确选择为默认。开启在线 AI 时，相关上下文会发给你选择的服务；联系方式不会因为“本地保存”而自动加密。</p></div></aside></div>
    </details>
    <SensitiveIdentityPanel disabled={!!busy} />
    <ApplicationAssets />
  </div>;
}
