import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Circle, ListChecks, LocateFixed, RefreshCw } from 'lucide-react';
import type { AppState, OfferAPI } from '../../../packages/shared/src/contracts.js';
import { APPLICATION_PROGRESS_LABELS, APPLICATION_SECTION_LABELS, applicationIssueRecord, applicationIssueFactDraft, applicationIssueFactLocation, applicationIssueEditable,
  applicationIssueCurrentValue, applicationWorkflowDirtyIssues, applicationWorkflowRecordHasDraft,
  type ApplicationWorkflow, type ApplicationWorkflowAPI, type ApplicationWorkflowIssue, type ApplicationWorkflowState } from '../../../packages/shared/src/application-workflow.js';
import './ApplicationTasks.css';
import { applicationAttention, type ApplicationAttentionItem } from '../../../packages/ui/src/application-attention.js';
import type { ConfirmedAnswer, ConfirmedAnswerInput } from '../../../packages/shared/src/application-assets.js';
import { applicationIssueCanRemember, applicationQuestionCanRemember, savedApplicationAnswer } from '../../../packages/ui/src/companion.js';

export type ApplicationTasksAPI = ApplicationWorkflowAPI & Pick<OfferAPI, 'saveProfile' | 'confirmCareerRecord' | 'getState' | 'onEvent' | 'saveAnswer' | 'confirmAnswer' | 'applicationAssets' | 'locateWorkflowIssue' | 'refreshApplicationAttention' | 'selectApplicationWorkflow'>;
const sourceValue = applicationIssueCurrentValue;

export function ApplicationTasks({ api, state, currentURL, busy, onResume, onProfile, onState, onLocatingChange }: {
  api: ApplicationTasksAPI; state: AppState; currentURL: string; busy: boolean;
  onResume: (workflow: ApplicationWorkflow) => void | Promise<void>; onProfile: () => void; onState?: (state: AppState) => void; onLocatingChange?: (locating: boolean) => void;
}) {
  const [saved, setSaved] = useState<ApplicationWorkflowState>({ workflows: [] });
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [expanded, setExpanded] = useState(false); const autoOpened = useRef('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, { question: string; value: string; reusable: boolean }>>({});
  const [savedAnswers, setSavedAnswers] = useState<Record<string, ConfirmedAnswer>>({});
  const [note, setNote] = useState('');
  const operationInFlight = useRef(false);
  const locatingCallback = useRef(onLocatingChange); locatingCallback.current = onLocatingChange;
  const activeURL = useRef(currentURL); activeURL.current = currentURL;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; locatingCallback.current?.(false); }; }, []);
  useEffect(() => {
    let alive = true; let eventReceived = false;
    const off = api.onEvent(event => {
      if (event.type === 'application-workflow') { eventReceived = true; if (alive) setSaved(event.state); }
    });
    void api.workflowState().then(value => { if (alive && !eventReceived) setSaved(value); }).catch(() => { if (alive) setError('待处理记录暂时无法读取。'); });
    return () => { alive = false; off(); };
  }, [api]);
  const matches = saved.workflows.filter(workflow => workflow.target.url === currentURL);
  // The UI never selects a company/role merely because it shares an address.
  const workflow = matches.length === 1 ? matches[0] : matches.find(workflow => workflow.id === selectedWorkflowId);
  const open = workflow?.issues.filter(issue => issue.status === 'open') ?? [];
  const attention = applicationAttention(state, open);
  useEffect(() => {
    const key = workflow && (attention.count || attention.notices.length || attention.historical.length) ? `${workflow.id}:${workflow.updatedAt}` : '';
    if (key && key !== autoOpened.current && !busy) { autoOpened.current = key; setExpanded(true); }
  }, [workflow?.id, workflow?.updatedAt, attention.count, attention.notices.length, attention.historical.length, busy]);
  useEffect(() => { setSavedAnswers({}); }, [state.profile.version]);
  const locked = busy || working;
  const dirtyIssues = new Set(workflow ? applicationWorkflowDirtyIssues(state, workflow, drafts) : []);
  const unsavedAnswerDrafts = Boolean(workflow && Object.entries(answerDrafts).some(([id, draft]) => {
    const issue = workflow.issues.find(item => item.id === id && item.status === 'open');
    if (!issue) return false;
    const saved = savedAnswers[id];
    if (saved) return saved.questionPattern !== draft.question.trim() || saved.answer !== draft.value.trim() || (saved.scope.kind === 'general') !== draft.reusable;
    return Boolean(draft.value.trim() || draft.question.trim() !== issue.label.trim() || draft.reusable);
  }));
  const refreshHasDrafts = dirtyIssues.size > 0 || unsavedAnswerDrafts;
  const pendingConfirmations = open.filter(issue => issue.attentionState !== 'not-reobserved' && applicationIssueFactLocation(state, issue).collection && sourceValue(state, issue)?.trim()
    && (() => { const record = applicationIssueRecord(state, issue); return record && (record.confirmation !== 'confirmed' || record.confirmedRevision !== record.revision); })());
  async function saveFact(issue: ApplicationWorkflowIssue) {
    if (locked || operationInFlight.current || !dirtyIssues.has(issue.id)) return; operationInFlight.current = true; setWorking(true); setError('');
    try {
      const input = applicationIssueFactDraft(state, issue, drafts[issue.id] ?? sourceValue(state, issue) ?? '');
      const next = await api.saveProfile(input, state.profile.version); onState?.(next);
      setDrafts(current => { const copy = { ...current }; delete copy[issue.id]; return copy; });
    } catch { setError('资料未保存。请核对输入与资料版本，必要时到资料页重新读取；当前网页不会因此填写。'); }
    finally { operationInFlight.current = false; setWorking(false); }
  }
  async function confirm(issue: ApplicationWorkflowIssue) {
    const location = applicationIssueFactLocation(state, issue);
    if (locked || operationInFlight.current || !location.collection || !location.recordId) return;
    if (workflow && applicationWorkflowRecordHasDraft(state, workflow, issue, drafts)) { setError('请先保存这条经历尚未保存的修改，再核对并确认当前修订。'); return; }
    const record = applicationIssueRecord(state, issue); if (!record) return;
    operationInFlight.current = true; setWorking(true); setError('');
    try { const next = await api.confirmCareerRecord(location.collection, location.recordId, state.profile.version, record.revision); onState?.(next); }
    catch { setError('本条修订未确认，请重新核对已保存资料后再确认。'); }
    finally { operationInFlight.current = false; setWorking(false); }
  }
  async function setIssueStatus(issue: ApplicationWorkflowIssue, status: 'open' | 'dismissed') {
    if (!workflow || locked || operationInFlight.current) return; operationInFlight.current = true; setWorking(true); setError('');
    try { setSaved(await api.setApplicationIssueStatus({ workflowId: workflow.id, issueId: issue.id, status })); }
    catch { setError('待处理状态未保存，请稍后重试。'); } finally { operationInFlight.current = false; setWorking(false); }
  }
  async function saveAnswer(issue: ApplicationWorkflowIssue) {
    const draft = answerDrafts[issue.id];
    if (locked || operationInFlight.current || !workflow || !draft?.value.trim() || !applicationIssueCanRemember(issue) || !applicationQuestionCanRemember(draft.question)) return;
    if (!workflow.target.applicationId && !draft.reusable) { setError('这页还没有关联申请，请明确勾选相同问题复用，或先到资料页添加限定范围的答案。'); return; }
    operationInFlight.current = true; setWorking(true); setError(''); setNote('');
    try {
      const prior = savedAnswers[issue.id];
      const before = await api.applicationAssets();
      if (before.profileVersion !== state.profile.version) { setError('个人资料已变化，请重新核对当前资料后再保存回答。'); return; }
      const request: ConfirmedAnswerInput = { ...(prior ? { id: prior.id } : {}), questionPattern: draft.question.trim(), answer: draft.value.trim(),
        scope: draft.reusable ? { kind: 'general' } : { kind: 'application', applicationId: workflow.target.applicationId! },
        demo: state.applications.find(item => item.id === workflow.target.applicationId)?.demo ?? false, risk: 'ordinary' };
      const result = await api.saveAnswer(request, prior?.revision ?? null);
      const saved = savedApplicationAnswer(before.answers, result.answers, request);
      if (!saved || result.profileVersion !== state.profile.version) { setError('无法唯一核对本次新保存的普通回答，请到个人资料查看；没有确认任何其他答案。'); return; }
      setSavedAnswers(current => ({ ...current, [issue.id]: saved }));
      setNote('回答已保存为草稿。核对问题原文和回答后，再明确确认；网页尚未填写。');
    } catch { setError('回答草稿未保存，请核对问题、回答和适用范围。'); } finally { operationInFlight.current = false; setWorking(false); }
  }
  async function confirmSavedAnswer(issue: ApplicationWorkflowIssue) {
    const answer = savedAnswers[issue.id], draft = answerDrafts[issue.id];
    if (locked || operationInFlight.current || !answer || !draft || answer.questionPattern !== draft.question.trim() || answer.answer !== draft.value.trim()
      || draft.reusable !== (answer.scope.kind === 'general')) return;
    operationInFlight.current = true; setWorking(true); setError('');
    try {
      const result = await api.confirmAnswer(answer.id, answer.revision, state.profile.version);
      const confirmed = result.answers.find(item => item.id === answer.id);
      if (confirmed) setSavedAnswers(current => ({ ...current, [issue.id]: confirmed }));
      setNote('回答已确认。点“重新读取并续填”后，仅完全相同且可自动填写的普通问题可以复用。');
    } catch { setError('回答尚未确认，请重新核对当前资料和答案修订。'); } finally { operationInFlight.current = false; setWorking(false); }
  }
  async function refreshAttention() {
    if (locked || operationInFlight.current || !workflow || refreshHasDrafts) return;
    operationInFlight.current = true; setWorking(true); setRefreshing(true); setError('');
    setNote('正在重新读取网页，只更新提示，不会填写…'); locatingCallback.current?.(true);
    const url = currentURL;
    try {
      await api.selectApplicationWorkflow(workflow.id);
      const result = await api.refreshApplicationAttention();
      if (mounted.current && activeURL.current === url) {
        setSaved(result); setNote('已按当前网页更新提示，没有填写任何字段。未能重新观察的旧提示会单独保留。');
      }
    } catch {
      if (mounted.current && activeURL.current === url) setError('提示未更新。请保持申请表打开后重试；没有填写或提交。');
    } finally { operationInFlight.current = false; if (mounted.current) { setWorking(false); setRefreshing(false); } locatingCallback.current?.(false); }
  }
  async function locateIssue(issue: ApplicationWorkflowIssue) {
    if (!workflow || locked || operationInFlight.current || issue.scope !== 'field') return;
    operationInFlight.current = true; setWorking(true); setError(''); setNote('正在定位网页字段，不会修改内容…'); locatingCallback.current?.(true);
    const url = currentURL;
    try {
      const result = await api.locateWorkflowIssue({ workflowId: workflow.id, issueId: issue.id });
      if (mounted.current && activeURL.current === url) setNote(result.message);
    } catch {
      if (mounted.current && activeURL.current === url) setError('暂时无法定位。请先重新核对当前网页；未修改任何填写内容。');
    } finally { operationInFlight.current = false; if (mounted.current) setWorking(false); locatingCallback.current?.(false); }
  }
  function renderAttentionItem(item: ApplicationAttentionItem) {
    if (!workflow) return null;
    const { issue } = item;
    const historical = issue.attentionState === 'not-reobserved';
    const location = applicationIssueFactLocation(state, issue);
    const record = applicationIssueRecord(state, issue);
    const needsConfirmation = record && (record.confirmation !== 'confirmed' || record.confirmedRevision !== record.revision);
    const confirmationOwner = [...attention.required, ...attention.optional, ...attention.notices].find(candidate => {
      const other = applicationIssueFactLocation(state, candidate.issue);
      return other.collection === location.collection && other.recordId === location.recordId;
    });
    const showConfirmation = needsConfirmation && confirmationOwner?.issue.id === issue.id;
    const recordHasDraft = applicationWorkflowRecordHasDraft(state, workflow, issue, drafts);
    const editable = !historical && applicationIssueEditable(issue) && (location.collection ? Boolean(record) : true);
    const answerDraft = answerDrafts[issue.id], savedAnswer = savedAnswers[issue.id];
    const answerConfirmed = savedAnswer && savedAnswer.confirmedRevision === savedAnswer.revision && savedAnswer.confirmedProfileVersion === state.profile.version;
    const answerUnchanged = savedAnswer && answerDraft && savedAnswer.questionPattern === answerDraft.question.trim() && savedAnswer.answer === answerDraft.value.trim()
          && answerDraft.reusable === (savedAnswer.scope.kind === 'general');
    return <article className={`application-task-item task-${item.category}${issue.scope === 'field' ? '' : ' task-notice'}`} key={issue.id} data-testid="application-task-item" data-issue-id={issue.id}>
          <div className="application-task-title"><strong>{item.displayTitle}</strong><small>{historical ? '旧提示' : issue.scope !== 'field' ? '区块提醒' : issue.required === false ? '可选' : issue.required === true ? '必填' : '要求待核对'}</small></div>
          <p className="application-task-guidance">{item.hint}</p>
          {!historical && item.locatable ? <button type="button" className="application-task-locate" data-testid="application-task-locate" disabled={locked} aria-label={`定位${item.displayTitle}`} onClick={() => void locateIssue(issue)}><LocateFixed size={13} />定位网页字段</button>
            : <p className="application-task-location-hint" data-testid="application-task-location-hint">{historical ? '先点“重新读取提示”，确认当前网页是否仍需要处理这一项。' : item.locateHint}</p>}
          {editable && <details className="application-task-edit-details" open={showConfirmation || undefined}><summary>{sourceValue(state, issue)?.trim() ? '查看 / 补充这项资料' : '补充并记住'}</summary><div className="application-task-edit">
            <input aria-label={`补充${issue.label}`} value={drafts[issue.id] ?? sourceValue(state, issue) ?? ''} disabled={locked}
              placeholder={issue.profileField === 'endDate' ? '例如 2026-08，按实际精度填写' : '填写你确认的事实'}
              onChange={event => setDrafts(current => ({ ...current, [issue.id]: event.target.value }))} />
            <button type="button" disabled={locked || !dirtyIssues.has(issue.id) || !(drafts[issue.id] ?? '').trim()} onClick={() => void saveFact(issue)}>{location.collection ? '保存为资料草稿' : '确认并保存资料'}</button>
          </div><p>保存在个人资料里。经历变更后需要确认整条修订，才会用于下次填写。</p></details>}
          {showConfirmation && <div className="application-task-confirm"><span>{recordHasDraft ? '这条经历还有未保存修改，请先保存后再确认。' : `请核对已保存的整条经历，当前修订 ${record.revision}。`}</span><button type="button" disabled={locked || recordHasDraft} onClick={() => void confirm(issue)}>我已核对，确认本条修订</button></div>}
          {!historical && applicationIssueCanRemember(issue) && <details className="application-task-answer"><summary onClick={() => { if (!answerDraft) setAnswerDrafts(current => ({ ...current, [issue.id]: { question: issue.label, value: '', reusable: false } })); }}>记成常用回答</summary>
            <label>问题原文<input data-testid="application-answer-question" aria-label={`问题原文：${issue.label}`} disabled={locked} maxLength={1000} value={answerDraft?.question ?? issue.label} onChange={event => setAnswerDrafts(current => ({ ...current, [issue.id]: { question: event.target.value, value: answerDraft?.value ?? '', reusable: answerDraft?.reusable ?? false } }))} /></label>
            <label>你确认的真实回答<textarea data-testid="application-answer-value" aria-label={`常用回答：${issue.label}`} disabled={locked} maxLength={20000} rows={3} value={answerDraft?.value ?? ''} onChange={event => setAnswerDrafts(current => ({ ...current, [issue.id]: { question: answerDraft?.question ?? issue.label, value: event.target.value, reusable: answerDraft?.reusable ?? false } }))} /></label>
            <label className="application-task-reuse"><input type="checkbox" disabled={locked} checked={answerDraft?.reusable ?? false} onChange={event => setAnswerDrafts(current => ({ ...current, [issue.id]: { question: answerDraft?.question ?? issue.label, value: answerDraft?.value ?? '', reusable: event.target.checked } }))} />以后其他申请遇到完全相同的问题也可复用</label>
            <p>请按网页核对完整问题原文。保存只是草稿，明确确认后才能用于普通文字题。</p>
            <div className="application-task-edit"><button type="button" data-testid="application-answer-save" disabled={locked || !answerDraft?.value.trim() || !applicationQuestionCanRemember(answerDraft?.question ?? '') || !workflow.target.applicationId && !answerDraft?.reusable} onClick={() => void saveAnswer(issue)}>保存回答草稿</button>{savedAnswer && answerUnchanged && !answerConfirmed && <button type="button" data-testid="application-answer-confirm" disabled={locked} onClick={() => void confirmSavedAnswer(issue)}>已核对，确认此回答</button>}{answerConfirmed && answerUnchanged && <small>已确认，重新核对网页后可复用</small>}</div>
          </details>}
          <details className="application-task-reason"><summary>为什么没有自动完成？</summary><p>{issue.reason}</p></details>
          <div className="application-task-item-actions"><button type="button" disabled={locked} onClick={onProfile}>查看完整资料</button><button type="button" disabled={locked} onClick={() => void setIssueStatus(issue, 'dismissed')}>暂时忽略</button></div>
        </article>;
  }
  return <details className={`application-tasks${attention.count ? ' has-action' : ''}`} data-testid="application-tasks" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><ListChecks size={14} /><span>{matches.length > 1 && !workflow ? '请选择当前申请' : attention.count ? `需要你帮一下 · ${attention.count} 项` : attention.optional.length ? `还有 ${attention.optional.length} 项可选补充` : attention.notices.length ? '有区块提醒，请看说明' : attention.historical.length ? '有旧提示，先重新读取' : workflow ? '本页填写记录' : '填写后在这里查看剩余事项'}</span><ChevronRight size={13} /></summary>
    {error && <p className="application-task-error" role="alert">{error}</p>}
    {note && <p className="application-task-note" role="status">{note}</p>}
    {matches.length > 1 && <label className="application-task-target">明确选择当前申请<select aria-label="选择待处理申请" disabled={locked} value={workflow?.id ?? ''} onChange={event => setSelectedWorkflowId(event.target.value)}><option value="">请选择，不按网址猜测</option>{matches.map(item => {
      const application = state.applications.find(value => value.id === item.target.applicationId);
      const job = state.jobs.find(value => value.id === item.target.jobId);
      return <option key={item.id} value={item.id}>{application ? `${application.company} · ${application.title}` : job ? `${job.company} · ${job.title}` : '未关联岗位的页面记录'} · {item.updatedAt.slice(0, 10)}</option>;
    })}</select></label>}
    {!workflow ? <p>{matches.length > 1 ? '无法仅凭这个网址选择申请，请明确核对目标。' : '自动填写后保留本轮已观察区块与缺口；未查看部分不会标为完成。'}</p> : <>
      {attention.count > 0 && <p className="application-task-lead">按下面的具体字段处理即可；可选补充和区块提醒另外列出。</p>}
      <div className="application-task-refresh-area"><button type="button" className="application-task-refresh" data-testid="application-task-refresh" disabled={locked || refreshHasDrafts} onClick={() => void refreshAttention()}><RefreshCw size={13} />{refreshing ? '正在读取提示…' : '重新读取提示'}</button><small>{refreshHasDrafts ? '请先保存或还原尚未保存的资料 / 回答，再更新提示。' : '只更新剩余事项，不填写网页。'}</small></div>
      <details className="application-task-coverage"><summary>查看本轮已检查的区块</summary><div className="application-task-sections">{workflow.sections.map(section => <div key={section.key}><span>{section.progress === 'verified' ? <Check size={12} /> : <Circle size={10} />}{APPLICATION_SECTION_LABELS[section.key]}</span><small>{APPLICATION_PROGRESS_LABELS[section.progress]}</small></div>)}</div><p className="application-task-note">仅记录本轮已观察目标；页面保存状态尚未证实，填写不等于投递。</p></details>
      {(['missing', 'retry', 'manual'] as const).map(category => {
        const items = attention.required.filter(item => item.category === category);
        return items.length > 0 && <section className="application-task-category" data-category={category} key={category}><h4>{({ missing: '补资料', retry: '重新核对后续填', manual: '需网页操作' })[category]} <span>{items.length}</span></h4>{items.map(renderAttentionItem)}</section>;
      })}
      {attention.optional.length > 0 && <details className="application-task-optional" data-testid="application-task-optional"><summary>可选补充 · {attention.optional.length} 项</summary><p>这些字段在本次观察中明确为可选，不计入上面的需处理数量。</p>{attention.optional.map(renderAttentionItem)}</details>}
      {attention.notices.length > 0 && <section className="application-task-notices" data-testid="application-task-notices"><h4>区块提醒</h4>{attention.notices.map(renderAttentionItem)}</section>}
      {attention.historical.length > 0 && <details className="application-task-historical" data-testid="application-task-historical"><summary>旧提示，需重新读取 · {attention.historical.length} 项</summary><p>这些是上一次的记录，本轮还没重新观察到，不计入当前需处理数量。点上面的“重新读取提示”更新。</p>{attention.historical.map(renderAttentionItem)}</details>}
      {workflow.issues.some(issue => issue.status === 'dismissed') && <details className="application-task-dismissed"><summary>已忽略 {workflow.issues.filter(issue => issue.status === 'dismissed').length} 项</summary><p className="application-task-note">忽略不会标记网页已完成。</p>{workflow.issues.filter(issue => issue.status === 'dismissed').map(issue => <div key={issue.id}><span>{issue.label}</span><button type="button" disabled={locked} onClick={() => void setIssueStatus(issue, 'open')}>恢复待处理</button></div>)}</details>}
      <button type="button" className="application-task-resume" data-testid="application-task-resume" disabled={locked || pendingConfirmations.length > 0 || dirtyIssues.size > 0} onClick={() => void onResume(workflow)}><RefreshCw size={13} />重新读取并续填</button>
      <p className="application-task-note">“重新读取并续填”会重新观察并生成新计划，再尝试填写；只想更新提示，请用上面的“重新读取提示”。</p>
    </>}
  </details>;
}
