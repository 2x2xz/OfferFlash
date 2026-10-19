import { useEffect, useState } from 'react';
import { ChevronDown, Download, FileText, Plus, Upload } from 'lucide-react';
import type { ApplicationAssetsAPI, ApplicationAssetsState, ConfirmedAnswer, ConfirmedAnswerInput, ResumeVersion } from '../../../packages/shared/src/application-assets.js';
import { Badge, Button, Field, Notice } from './components.js';
import { useWorkspace } from './context.js';
import { errorText } from './helpers.js';
import './ApplicationAssets.css';

const emptyAssets: ApplicationAssetsState = { profileVersion: 0, answers: [], resumeVersions: [], resumeSelections: [], calendarEvents: [], resumeRecommendations: {} };
export function useApplicationAssets() {
  const workspace = useWorkspace(); const api = workspace.api as typeof workspace.api & ApplicationAssetsAPI;
  const [assets, setAssets] = useState<ApplicationAssetsState>(emptyAssets); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, received = false;
    const off = api.onEvent(raw => { const event = raw as { type: string; state?: ApplicationAssetsState }; if (alive && event.type === 'application-assets' && event.state) { received = true; setAssets(event.state); setError(''); setLoading(false); } });
    void api.applicationAssets().then(next => { if (alive && !received) setAssets(next); }).catch(() => { if (alive) setError('申请资料暂时无法读取。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; off(); };
  }, [api, workspace.state.profile.version, workspace.state.applications, workspace.state.settings.showDemo]);
  async function reload() { try { setAssets(await api.applicationAssets()); setError(''); } catch { setError('申请资料暂时无法读取，请重试。'); } }
  return { ...workspace, api, assets, setAssets, loading, error, reload };
}
const splitDirections = (value: string) => [...new Set(value.split(/[,，、;；\n]/u).map(item => item.trim()).filter(Boolean))];
const blankAnswer = (): ConfirmedAnswerInput => ({ questionPattern: '', answer: '', scope: { kind: 'general' }, demo: false, risk: 'ordinary' });

export function ApplicationAssets() {
  const { api, assets, setAssets, state, loading, error, reload, notify } = useApplicationAssets();
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ConfirmedAnswerInput>(blankAnswer), [answerRevision, setAnswerRevision] = useState<number | null>(null);
  const [resumeLabel, setResumeLabel] = useState('通用简历'), [resumeDirections, setResumeDirections] = useState('');
  const [resumeEdit, setResumeEdit] = useState<ResumeVersion>(), [resumeEditDirections, setResumeEditDirections] = useState('');
  const applications = state.applications.filter(item => !item.demo || state.settings.showDemo);
  async function change(operation: () => Promise<ApplicationAssetsState>, message: string) {
    if (busy) return false; setBusy(true);
    try { setAssets(await operation()); notify(message); return true; }
    catch (err) { notify(errorText(err), true); await reload(); return false; } finally { setBusy(false); }
  }
  function editAnswer(answer?: ConfirmedAnswer) {
    setDraft(answer ? { id: answer.id, questionPattern: answer.questionPattern, answer: answer.answer, scope: answer.scope, demo: answer.demo, risk: answer.risk } : blankAnswer());
    setAnswerRevision(answer?.revision ?? null); setEditing(true);
  }
  return <section className="application-assets" data-testid="application-assets">
    {error && <Notice tone="warning">{error}</Notice>}
    <details className="asset-section" data-testid="answer-library"><summary><span>已确认答案<span>{assets.answers.length} 条 · 只精确匹配问题</span></span><ChevronDown size={15} /></summary><div className="asset-content">
      <div className="asset-section-line"><p>保存你核对过的真实回答。资料或答案变化后重新确认；薪资、身份、协议等问题仍需逐题核对。</p><Button variant="secondary" disabled={busy || loading} onClick={() => editAnswer()} data-testid="answer-add"><Plus size={13} />添加答案</Button></div>
      {editing && <form className="asset-editor" onSubmit={event => { event.preventDefault(); void change(() => api.saveAnswer(draft, answerRevision), '答案已保存为待确认。').then(ok => { if (ok) setEditing(false); }); }}>
        <Field label="问题原文"><input maxLength={1000} required data-testid="answer-question" value={draft.questionPattern} onChange={event => setDraft(current => ({ ...current, questionPattern: event.target.value }))} placeholder="例如：请简要介绍你的项目经验" /></Field>
        <Field label="真实回答"><textarea rows={4} maxLength={20000} required data-testid="answer-value" value={draft.answer} onChange={event => setDraft(current => ({ ...current, answer: event.target.value }))} /></Field>
        <div className="asset-editor-grid"><Field label="适用范围"><select data-testid="answer-scope" value={draft.scope.kind === 'application' ? draft.scope.applicationId : ''} onChange={event => { const owner = applications.find(item => item.id === event.target.value); setDraft(current => ({ ...current, scope: owner ? { kind: 'application', applicationId: owner.id } : { kind: 'general' }, demo: owner?.demo ?? current.demo })); }}><option value="">通用回答</option>{applications.map(item => <option value={item.id} key={item.id}>{item.company} · {item.title}{item.demo ? '（演示）' : ''}</option>)}</select></Field><Field label="问题类型"><select value={draft.risk} onChange={event => setDraft(current => ({ ...current, risk: event.target.value as ConfirmedAnswerInput['risk'] }))}><option value="ordinary">普通文字问题</option><option value="high-impact">需逐题核对的问题</option></select></Field></div>
        {state.settings.showDemo && draft.scope.kind === 'general' && <label className="asset-check"><input type="checkbox" checked={draft.demo} disabled={!!draft.id} onChange={event => setDraft(current => ({ ...current, demo: event.target.checked }))} />仅用于演示申请</label>}
        <div className="asset-actions"><Button type="submit" busy={busy} data-testid="answer-save">保存草稿</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>取消</Button></div>
      </form>}
      {!assets.answers.length && !loading && <p className="asset-empty">还没有保存答案。自动填写不会猜你的自由文本回答。</p>}
      {assets.answers.map(answer => { const confirmed = answer.confirmedRevision === answer.revision && answer.confirmedProfileVersion === assets.profileVersion;
        const owner = answer.scope.kind === 'application' ? applications.find(item => item.id === (answer.scope.kind === 'application' ? answer.scope.applicationId : '')) : undefined;
        return <article className="asset-row" key={answer.id} data-testid="answer-row" data-answer-id={answer.id}><div className="asset-row-main"><strong>{answer.questionPattern}</strong><p>{answer.answer}</p><div className="asset-tags"><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '已确认' : '待核对确认'}</Badge><span>{owner ? `${owner.company} · ${owner.title}` : '通用'}</span>{answer.risk === 'high-impact' && <span>每题人工核对</span>}{answer.demo && <span>演示</span>}</div></div><div className="asset-actions"><Button variant="ghost" disabled={busy} onClick={() => editAnswer(answer)}>编辑</Button>{!confirmed && <Button variant="secondary" disabled={busy} data-testid="answer-confirm" onClick={() => void change(() => api.confirmAnswer(answer.id, answer.revision, assets.profileVersion), '本修订已确认。')}>确认回答</Button>}<Button variant="ghost" disabled={busy} aria-label={`删除答案：${answer.questionPattern}`} onClick={() => void change(() => api.deleteAnswer(answer.id, answer.revision), '答案已删除。')}>删除</Button></div></article>;
      })}
    </div></details>
    <details className="asset-section" data-testid="resume-versions"><summary><span>简历版本<span>{assets.resumeVersions.length} 份 · 本地保存，按申请选择</span></span><ChevronDown size={15} /></summary><div className="asset-content">
      <p className="asset-description">可为算法、研究、Agent 等方向保留不同版本。推荐只根据你填写的方向与岗位名称匹配；选择版本不会上传文件，也不会覆盖当前个人资料。</p>
      <div className="asset-editor-grid"><Field label="版本名称"><input data-testid="resume-version-label" maxLength={120} value={resumeLabel} onChange={event => setResumeLabel(event.target.value)} placeholder="例如：算法研究版" /></Field><Field label="适用岗位方向"><input data-testid="resume-version-directions" value={resumeDirections} onChange={event => setResumeDirections(event.target.value)} placeholder="大模型、算法、Agent" /></Field></div>
      <Button variant="secondary" disabled={busy || !resumeLabel.trim()} data-testid="resume-version-import" onClick={() => void (async () => { setBusy(true); try { const result = await api.importResumeVersion({ label: resumeLabel.trim(), directions: splitDirections(resumeDirections), demo: false }); if (!result.cancelled && result.state) { setAssets(result.state); notify('简历版本已保存在本地。'); } } catch (err) { notify(errorText(err), true); } finally { setBusy(false); } })()}><Upload size={13} />选择 PDF / DOCX</Button>
      {assets.resumeVersions.map(resume => <article className="asset-row" key={resume.id} data-testid="resume-version-row"><div className="asset-row-main"><strong><FileText size={14} />{resume.label}</strong><p>{resume.fileName} · {Math.ceil(resume.sizeBytes / 1024)} KB</p><div className="asset-tags"><span>{resume.directions.join('、') || '通用版本'}</span><span>{resume.profileVersion === assets.profileVersion ? '关联当前资料版本' : '个人资料后来有更新，上传前请核对文件'}</span>{resume.demo && <Badge>演示</Badge>}</div></div><div className="asset-actions"><Button variant="ghost" disabled={busy} onClick={() => { setResumeEdit(resume); setResumeEditDirections(resume.directions.join('、')); }}>编辑</Button><Button variant="ghost" disabled={busy} onClick={() => void api.exportResumeVersion(resume.id).then(result => { if (!result.cancelled) notify('已导出，可在网申页面手动选择上传。'); }).catch(err => notify(errorText(err), true))}><Download size={12} />导出</Button><Button variant="ghost" disabled={busy} onClick={() => void change(() => api.deleteResumeVersion(resume.id, resume.revision), '简历版本已删除，申请中的选择已清除。')}>删除</Button></div></article>)}
      {resumeEdit && <form className="asset-editor" onSubmit={event => { event.preventDefault(); void change(() => api.saveResumeVersion({ id: resumeEdit.id, label: resumeEdit.label, directions: splitDirections(resumeEditDirections) }, resumeEdit.revision), '版本说明已更新。').then(ok => { if (ok) setResumeEdit(undefined); }); }}><div className="asset-editor-grid"><Field label="版本名称"><input required maxLength={120} value={resumeEdit.label} onChange={event => setResumeEdit(current => current ? { ...current, label: event.target.value } : current)} /></Field><Field label="适用方向"><input value={resumeEditDirections} onChange={event => setResumeEditDirections(event.target.value)} /></Field></div><div className="asset-actions"><Button type="submit" busy={busy}>保存版本说明</Button><Button variant="ghost" disabled={busy} onClick={() => setResumeEdit(undefined)}>取消</Button></div></form>}
      {!assets.resumeVersions.length && !loading && <p className="asset-empty">还没有本地简历版本。</p>}
    </div></details>
  </section>;
}

export function ApplicationResumePicker({ applicationId }: { applicationId: string }) {
  const { api, assets, state, setAssets, notify, reload } = useApplicationAssets(); const [busy, setBusy] = useState(false);
  const owner = state.applications.find(item => item.id === applicationId && (!item.demo || state.settings.showDemo));
  if (!owner) return null;
  const selection = assets.resumeSelections.find(item => item.applicationId === applicationId);
  const selected = assets.resumeVersions.find(item => item.id === selection?.resumeVersionId);
  const recommendations = assets.resumeRecommendations[applicationId] ?? [];
  const options = assets.resumeVersions.filter(item => item.demo === owner.demo);
  return <div className="application-resume-picker" data-testid="application-resume-picker"><Field label="本申请使用的简历"><select disabled={busy} value={selection?.resumeVersionId ?? ''} onChange={event => void (async () => { setBusy(true); try { setAssets(await api.selectApplicationResume(applicationId, event.target.value || null, selection?.revision ?? null)); notify('已记录选择，不会自动上传。'); } catch (err) { notify(errorText(err), true); await reload(); } finally { setBusy(false); } })()}><option value="">尚未选定</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}{recommendations.some(value => value.resumeVersionId === item.id) ? ' · 方向匹配' : ''}</option>)}</select></Field>{selected && <><p className="asset-description">{selected.profileVersion === assets.profileVersion ? '版本已选定，提交前仍请核对文件。' : '此版本早于当前个人资料，请核对文件后再上传。'}</p><Button variant="ghost" disabled={busy} onClick={() => void api.exportResumeVersion(selected.id).then(result => { if (!result.cancelled) notify('简历已导出，请在网站上手动上传。'); }).catch(err => notify(errorText(err), true))}><Download size={12} />导出选定简历</Button></>}</div>;
}
