import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, LocateFixed, Square, WandSparkles } from 'lucide-react';
import { Button, ErrorMessage } from './components.js';
import { useWorkspace } from './context.js';
import { errorText } from './helpers.js';
import type { CareerFillCollection, CareerFillOptions, CareerFillOutcome, CareerFillPending, CareerFillPreview } from '../../../packages/shared/src/career-form.js';
import {
  CAREER_FIELD_LABELS, CAREER_FILL_COLLECTIONS, CAREER_FILL_LABELS, careerFillRequest,
  confirmedCareerFillRecords, emptyCareerFillSelection, moveCareerFillRecord,
  type CareerFillSelection, type CareerGroupChoices,
} from '../../../packages/ui/src/career-fill.js';
import { prepareOneClickCareer, type OneClickCareerIssue } from '../../../packages/ui/src/one-click-career.js';
import './CareerFillPanel.css';
import { careerPendingAttention, type CareerAttentionItem } from '../../../packages/ui/src/application-attention.js';

export interface CareerFillPanelProps { disabled: boolean; onBusyChange: (busy: boolean) => void; onLocatingChange?: (locating: boolean) => void; onStatusChange?: (message: string) => void; onPrepareCareerSpace?: () => Promise<void>; onOutcomeChange?: (outcome: CareerFillOutcome | undefined) => void; onPhaseChange?: (phase: Phase | undefined) => void; }
export interface CareerFillPanelHandle { autoFill(): Promise<void>; stop(): Promise<void>; invalidateWritePlan(): void; }
export type Phase = 'reading' | 'preparing' | 'running' | 'stopping' | 'locating';
const stopLabels: Record<string, string> = {
  aborted: '操作已取消，请重新读取剩余内容。', timeout: '等待超时，本次已停止。',
  'action-limit': '已达到本次操作上限，请核对后重新读取。', 'profile-changed': '资料发生变化，请重新核对。',
  'page-changed': '网页发生变化，请重新读取。', inactive: '窗口失焦或网页隐藏，本次已停止。',
  'verification-failed': '重读结果与计划不一致，请检查网页。', 'host-error': '控件操作未完成，请检查网页后重新读取。',
};

export const CareerFillPanel = forwardRef<CareerFillPanelHandle, CareerFillPanelProps>(function CareerFillPanel({ disabled, onBusyChange, onLocatingChange, onStatusChange, onPrepareCareerSpace, onOutcomeChange, onPhaseChange }, ref) {
  const { api, state, browser, overlayOpen } = useWorkspace();
  const [observation, setObservation] = useState<CareerFillPreview>();
  const [preview, setPreview] = useState<CareerFillPreview>();
  const [selection, setSelection] = useState<CareerFillSelection>(emptyCareerFillSelection);
  const [choices, setChoices] = useState<CareerGroupChoices>({});
  const [outcome, setOutcome] = useState<CareerFillOutcome>();
  const outcomeCallback = useRef(onOutcomeChange); outcomeCallback.current = onOutcomeChange;
  useEffect(() => { outcomeCallback.current?.(outcome); }, [outcome]);
  const [phase, setPhase] = useState<Phase>();
  const phaseCallback = useRef(onPhaseChange); phaseCallback.current=onPhaseChange;
  const [error, setError] = useState<string>();
  const [used, setUsed] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [autoIssues, setAutoIssues] = useState<OneClickCareerIssue[]>([]);
  const [needsDecision, setNeedsDecision] = useState(false);
  const [status, setStatus] = useState<string>();
  const [contactVerified, setContactVerified] = useState(0);
  const [locateMessage, setLocateMessage] = useState<string>();
  const [showAllPending, setShowAllPending] = useState(false);
  const mounted = useRef(true); const busy = useRef(false); const operation = useRef(0); const cancelled = useRef(false);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const locatingCallback = useRef(onLocatingChange); locatingCallback.current = onLocatingChange;
  const statusCallback = useRef(onStatusChange); statusCallback.current = onStatusChange;
  const careerSpaceCallback = useRef(onPrepareCareerSpace); careerSpaceCallback.current = onPrepareCareerSpace;
  const contextKey = JSON.stringify([browser.url, state.profile.version, browser.loading, overlayOpen]);
  const latest = useRef({ url: browser.url, version: state.profile.version, profile: state.profile, contextKey });
  latest.current = { url: browser.url, version: state.profile.version, profile: state.profile, contextKey };
  const activeContext = useRef(contextKey);
  const previousContext = useRef(contextKey);
  const records = confirmedCareerFillRecords(state.profile);
  const selectedCount = CAREER_FILL_COLLECTIONS.reduce((count, collection) => count + selection[collection].length, 0);
  const inactive = disabled || Boolean(phase) || browser.loading || overlayOpen;

  useLayoutEffect(() => { busyCallback.current(Boolean(phase)); locatingCallback.current?.(phase === 'locating'); phaseCallback.current?.(phase); }, [phase]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; operation.current++;
      void api.cancelCareerFill().catch(() => {});
      busyCallback.current(false);
      locatingCallback.current?.(false);
      phaseCallback.current?.(undefined);
    };
  }, [api]);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey; operation.current++;
    setObservation(undefined); setPreview(undefined); setOutcome(undefined); setUsed(false);
    setSelection(emptyCareerFillSelection()); setChoices({}); setError(undefined);
    setAutoIssues([]); setNeedsDecision(false); setManualExpanded(false); setContactVerified(0); setStatus(undefined); setLocateMessage(undefined); setShowAllPending(false);
    void api.cancelCareerFill().catch(() => {});
    if (busy.current) { cancelled.current = true; setPhase('stopping'); statusCallback.current?.('网页或资料已变化，正在停止，不会继续下一步。'); }
    else statusCallback.current?.('');
  }, [contextKey, api]);

  function begin(next: Phase): number | undefined {
    if (inactive || busy.current) return undefined;
    busy.current = true; cancelled.current = false; setPhase(next); setError(undefined);
    activeContext.current = latest.current.contextKey;
    return ++operation.current;
  }
  function current(token: number, url: string, version: number): boolean {
    return mounted.current && operation.current === token && latest.current.url === url && latest.current.version === version
      && activeContext.current === latest.current.contextKey;
  }
  function finish() { busy.current = false; if (mounted.current) setPhase(undefined); }
  function clearPreview() { setPreview(undefined); setOutcome(undefined); setUsed(false); setError(undefined); setLocateMessage(undefined); setShowAllPending(false); }
  function report(message: string) { if (mounted.current) setStatus(message); statusCallback.current?.(message); }
  function isActive(token: number, url: string, version: number) { return current(token, url, version) && !cancelled.current; }
  function checkPreview(result: CareerFillPreview, url: string, version: number) {
    if (result.url !== url || result.profileVersion !== version) throw new Error('网页或资料已变化，请重新读取。');
  }
  function sameGroups(before: CareerFillPreview, after: CareerFillPreview) { return JSON.stringify(before.groups) === JSON.stringify(after.groups); }
  function hasActions(value: CareerFillPreview) { return value.steps.some(step => step.kind === 'add-then-reobserve' || step.items?.some(item => item.status === 'ready')); }
  function issueLabel(issue: OneClickCareerIssue) {
    return { 'unknown-group': '网页已有内容没有唯一对应的已确认经历，请选择对应记录或保留。',
      'ambiguous-group': '网页已有内容对应多条经历，请明确选择一条。', 'duplicate-binding': '多个网页组对应同一条经历，请明确处理方式。',
      'duplicate-record': '个人资料中有重复记录，请先到“个人资料”核对。' }[issue.reason];
  }
  async function executeFresh(token: number, url: string, version: number, options: CareerFillOptions,
    expectedGroups: CareerFillPreview, contacts: number) {
    if (!isActive(token, url, version)) return;
    setPhase('preparing'); report('正在核对经历与网页，准备自动填写…');
    const next = await api.prepareCareerFill(options);
    if (!isActive(token, url, version)) return;
    checkPreview(next, url, version);
    if (!sameGroups(expectedGroups, next)) {
      await api.cancelCareerFill();
      if (!isActive(token, url, version)) return;
      throw new Error('网页经历内容在识别期间变化，本次已停止，请重新点击一键自动填写。');
    }
    setPreview(next);
    if (!hasActions(next)) {
      report(contacts ? `联系资料已核实 ${contacts} 项；当前没有可自动填写的经历项，已有内容保留。` : '当前没有可自动填写的空白项，已有内容保留；可在手动调整中查看详情。');
      return;
    }
    if (!isActive(token, url, version)) return;
    setUsed(true); setNeedsDecision(false); setAutoIssues([]); setPhase('running'); report('正在自动新增、填写并核对，请保持窗口在前台…');
    const result = await api.runCareerFill(next.planId);
    if (!current(token, url, version)) return;
    setOutcome(result);
    if (result.status === 'stopped') report(result.failureMessage || stopLabels[result.stopReason ?? ''] || '本次已停止，请检查网页后重新一键填写。');
    else report(`${result.status === 'partial' ? '部分完成' : '填写完成'}：联系资料 ${contacts} 项，经历核实 ${result.verifiedCount} 项，新增 ${result.addedCount} 组${result.pending.length ? `，需处理 ${careerPendingAttention(state, result.pending).count} 项` : ''}。请核对后自行提交。`);
  }
  async function autoFill() {
    const token = begin('reading'); if (token === undefined) return;
    const { url, version, profile } = latest.current;
    clearPreview(); setObservation(undefined); setSelection(emptyCareerFillSelection()); setChoices({});
    setAutoIssues([]); setNeedsDecision(false); setManualExpanded(false); setContactVerified(0);
    report('正在读取并填写已确认的联系资料…');
    let contacts = 0;
    try {
      // Local rules only: the page's education fields never enter this ordinary contact batch.
      const contactKeys = new Set(['fullName', 'fullNameEn', 'email', 'phone']);
      const verifiedContacts = new Set<string>();
      for (;;) {
        setPhase('reading');
        const contactPlan = await api.prepareFill({ scope: 'contacts' });
        if (!isActive(token, url, version)) return;
        if (contactPlan.url !== url || contactPlan.profileVersion !== version) throw new Error('网页或资料已变化，请重新一键填写。');
        const next = contactPlan.items.find(item => item.status === 'ready' && item.profileKey && contactKeys.has(item.profileKey) && !item.currentValue.trim());
        if (!next) break;
        if (verifiedContacts.has(next.fieldId)) { report('刚核实的联系字段又变为空白，本次已停止，请检查网页后再继续。'); return; }
        if (contacts >= 8) { report('已达到本次联系字段上限，已停止后续经历填写，请检查网页。'); return; }
        setPhase('running');
        const contactResult = await api.fillApproved(contactPlan.id, [next.fieldId]);
        if (!isActive(token, url, version)) return;
        if (contactResult.unresolved.length) {
          report(`联系资料已核实 ${contacts} 项，另有 ${contactResult.unresolved.length} 项未完成；已停止后续经历填写，请先检查网页。`);
          return;
        }
        if (contactResult.verified.length !== 1 || contactResult.verified[0]?.fieldId !== next.fieldId) throw new Error('联系字段未得到完整核实，本次已停止。');
        verifiedContacts.add(next.fieldId); contacts++; setContactVerified(contacts);
      }
      if (!isActive(token, url, version)) return;
      report('正在准备经历填写区域，请稍候…');
      await careerSpaceCallback.current?.();
      if (!isActive(token, url, version)) return;
      setPhase('reading'); report('正在读取教育、实习和项目经历…');
      const read = await api.prepareCareerFill({ profileVersion: version, selectedRecordIds: emptyCareerFillSelection(), bindings: [], preserveGroupIds: [] });
      if (!isActive(token, url, version)) return;
      checkPreview(read, url, version); setObservation(read);
      const prepared = prepareOneClickCareer(profile, read);
      setSelection(prepared.selection); setChoices(prepared.choices);
      if (prepared.status === 'no-data') { report(contacts ? `联系资料已核实 ${contacts} 项；尚无已确认经历，请先到“个人资料”确认。` : '尚无可填写的已确认经历，请先到“个人资料”逐条确认。'); return; }
      if (prepared.status === 'review') {
        setAutoIssues(prepared.issues); setNeedsDecision(true); setManualExpanded(true);
        report('有网页经历无法唯一对应，已暂停自动填写；请在手动调整中只核对这些组。'); return;
      }
      await executeFresh(token, url, version, prepared.options, read, contacts);
    } catch (cause) {
      if (current(token, url, version) && !cancelled.current) { setError(errorText(cause)); report('本次自动填写未完成，请检查提示后重试。'); }
    } finally { finish(); }
  }
  async function continueAutomatic() {
    if (!observation || !selectedCount) return;
    const token = begin('reading'); if (token === undefined) return;
    const { url, version, profile } = latest.current;
    clearPreview(); report('正在准备经历填写区域，请稍候…');
    try {
      await careerSpaceCallback.current?.();
      if (!isActive(token, url, version)) return;
      report('正在重新核对网页，再继续自动填写…');
      const read = await api.prepareCareerFill({ profileVersion: version, selectedRecordIds: emptyCareerFillSelection(), bindings: [], preserveGroupIds: [] });
      if (!isActive(token, url, version)) return;
      checkPreview(read, url, version);
      if (!sameGroups(observation, read)) {
        setObservation(read); const revised = prepareOneClickCareer(profile, read); setSelection(revised.selection); setChoices(revised.choices);
        setAutoIssues(revised.status === 'review' ? revised.issues : []);
        report('网页经历内容已经变化，已重新读取；请核对新的对应关系后再继续。'); return;
      }
      const options = careerFillRequest(profile, read, selection, choices);
      await executeFresh(token, url, version, options, read, contactVerified);
    } catch (cause) {
      if (current(token, url, version) && !cancelled.current) { setError(errorText(cause)); report('对应关系尚未确认，未继续填写。'); }
    } finally { finish(); }
  }
  const recordTitle = (collection: CareerFillCollection, id: string) => records[collection].find(record => record.id === id)?.title || '经历已变化';

  async function readGroups() {
    const token = begin('reading'); if (token === undefined) return;
    const { url, version } = latest.current;
    setObservation(undefined); clearPreview(); setChoices({}); setSelection(emptyCareerFillSelection());
    setAutoIssues([]); setNeedsDecision(false); report('正在读取网页经历组…');
    try {
      const result = await api.prepareCareerFill({ profileVersion: version, selectedRecordIds: emptyCareerFillSelection(), bindings: [], preserveGroupIds: [] });
      if (!current(token, url, version) || cancelled.current) return;
      if (result.url !== url || result.profileVersion !== version) throw new Error('网页或资料已变化，请重新读取。');
      setObservation(result);
    } catch (cause) { if (current(token, url, version) && !cancelled.current) setError(errorText(cause)); }
    finally { finish(); }
  }
  function toggleRecord(collection: CareerFillCollection, id: string, checked: boolean) {
    if (inactive) return;
    clearPreview();
    setSelection(value => ({ ...value, [collection]: checked ? [...value[collection], id] : value[collection].filter(recordId => recordId !== id) }));
    if (!checked) setChoices(value => Object.fromEntries(Object.entries(value).filter(([groupId, choice]) => choice?.kind !== 'bind'
      || choice.recordId !== id || observation?.groups.find(group => group.id === groupId)?.collection !== collection)));
  }
  function moveRecord(collection: CareerFillCollection, id: string, direction: -1 | 1) {
    if (inactive) return;
    clearPreview(); setSelection(value => ({ ...value, [collection]: moveCareerFillRecord(value[collection], id, direction) }));
  }
  async function prepare() {
    if (!observation || !selectedCount) return;
    let options;
    try { options = careerFillRequest(state.profile, observation, selection, choices); }
    catch (cause) { setError(errorText(cause)); return; }
    const token = begin('preparing'); if (token === undefined) return;
    const { url, version } = latest.current;
    clearPreview();
    try {
      const result = await api.prepareCareerFill(options);
      if (!current(token, url, version) || cancelled.current) return;
      if (result.url !== url || result.profileVersion !== version) throw new Error('网页或资料已变化，请重新读取。');
      setPreview(result);
    } catch (cause) { if (current(token, url, version) && !cancelled.current) setError(errorText(cause)); }
    finally { finish(); }
  }
  async function run() {
    if (!preview || used || preview.url !== browser.url || preview.profileVersion !== state.profile.version) return;
    const token = begin('running'); if (token === undefined) return;
    const { url, version } = latest.current;
    setUsed(true); setOutcome(undefined);
    try {
      const result = await api.runCareerFill(preview.planId);
      if (current(token, url, version)) setOutcome(result);
    } catch (cause) { if (current(token, url, version)) setError(errorText(cause)); }
    finally { finish(); }
  }
  async function stop() {
    if (!busy.current || phase === 'stopping' || phase === 'locating') return;
    cancelled.current = true; setPhase('stopping'); report('正在停止，等待当前字段核对结束，不会开始下一步。');
    try { await api.cancelCareerFill(); }
    catch { if (mounted.current) setError('已请求停止，正在等待当前操作结束。请保持页面不变。'); }
  }
  function fieldLocation(item: CareerFillPending) {
    if (!preview) return undefined;
    const bindings = (outcome?.bindings ?? preview.bindings).filter(binding => binding.collection === item.collection && binding.recordId === item.recordId);
    const fieldGroups = item.fieldId ? preview.groups.filter(group => group.collection === item.collection && group.fields.some(field => field.id === item.fieldId)) : [];
    const groupId = item.groupId ?? (bindings.length === 1 ? bindings[0]?.groupId : undefined)
      ?? (fieldGroups.length === 1 ? fieldGroups[0]?.id : undefined);
    if (!groupId || !item.fieldId && !item.key) return undefined;
    return { kind: 'career' as const, planId: preview.planId, fieldId: item.fieldId, groupId, fieldKey: item.key };
  }
  async function locateField(item: CareerFillPending) {
    const input = fieldLocation(item); if (!input) return;
    const token = begin('locating'); if (token === undefined) return;
    const { url, version } = latest.current; setLocateMessage(undefined);
    try {
      const response = await api.locateApplicationField(input);
      if (current(token, url, version)) setLocateMessage(response.message);
    } catch (cause) { if (current(token, url, version)) setLocateMessage(errorText(cause)); }
    finally { finish(); }
  }

  const unansweredGroups = observation?.groups.filter(group => !choices[group.id]).length ?? 0;
  const actionable = preview?.steps.some(step => step.kind === 'add-then-reobserve' || step.items?.some(item => item.status === 'ready')) ?? false;
  const readyCount = preview?.steps.reduce((count, step) => count + (step.items?.filter(item => item.status === 'ready').length ?? 0), 0) ?? 0;
  const decisionGroups = observation?.groups.filter(group => !choices[group.id]
    || autoIssues.some(issue => issue.groupId === group.id)) ?? [];
  const shownGroups = needsDecision ? decisionGroups : observation?.groups ?? [];
  const pendingFields: CareerFillPending[] = outcome?.pending ?? preview?.steps.flatMap(step => (step.items ?? []).filter(item => item.status === 'review').map(item => {
    const observed = preview.groups.filter(group => group.id === step.groupId && group.collection === step.collection)
      .flatMap(group => group.fields.filter(field => field.id === item.fieldId));
    return { collection: step.collection, recordId: step.recordId, groupId: step.groupId, fieldId: item.fieldId, key: item.key,
      required: item.required ?? (observed.length === 1 ? observed[0]!.required ?? null : null),
      label: CAREER_FIELD_LABELS[item.key], type: observed.length === 1 ? observed[0]!.type : undefined, reason: item.reason };
  })) ?? [];
  const attention = careerPendingAttention(state, pendingFields);
  function renderPending(item: CareerAttentionItem, index: number) {
    const pending = item.pending, location = fieldLocation(pending);
    const locationHint = location ? '' : !pending.groupId && !pending.fieldId && pending.recordId
      ? '这条经历尚未对应到网页组，请先在网页添加或到“手动调整”核对对应关系。'
      : '当前网页没有唯一可核对的字段位置，请重新读取后定位。';
    return <li key={`${pending.collection}-${pending.recordId ?? pending.groupId ?? index}-${pending.fieldId ?? pending.key ?? index}`} data-category={item.category}>
      <div className="application-attention-row"><div className="career-attention-copy"><strong>{item.displayTitle}</strong>
        <p className="career-attention-hint">{item.hint}</p>
        {!location && <p className="career-attention-location-hint">{locationHint}</p>}
        <details className="application-attention-reason"><summary aria-disabled={inactive} onClick={event => { if (inactive) event.preventDefault(); }} onKeyDown={event => { if (inactive && ['Enter', ' '].includes(event.key)) event.preventDefault(); }}>查看具体原因</summary><p>{pending.reason}</p></details></div>
        <button type="button" className="application-field-locate" data-testid="career-field-locate" data-field-id={pending.fieldId} data-field-key={pending.key} data-record-id={pending.recordId} data-collection={pending.collection} disabled={inactive || !location} aria-label={`定位${item.displayTitle}`} title={location ? '滚动到对应的网页字段' : locationHint} onClick={() => void locateField(pending)}><LocateFixed size={13} />定位</button>
      </div>
    </li>;
  }
  const pendingList = pendingFields.length > 0 && <section className="career-needs-user" data-testid="career-needs-user" aria-label="经历待处理字段"><h4>{attention.count ? '需我处理' : '其余提醒'} <span>{attention.count ? `${attention.count} 项` : ''}</span></h4>
    {(['missing', 'retry', 'manual'] as const).map(category => {
      const items = attention.required.filter(item => item.category === category);
      return items.length > 0 && <div className="career-attention-category" data-category={category} key={category}><h5>{({ missing: '补资料', retry: '重新核对后续填', manual: '需网页操作' })[category]}</h5><ul className="application-attention-list">{items.slice(0, showAllPending ? undefined : 4).map(renderPending)}</ul>{items.length > 4 && <button type="button" className="text-link" disabled={inactive} aria-expanded={showAllPending} onClick={() => setShowAllPending(value => !value)}>{showAllPending ? '收起' : `展开其余 ${items.length - 4} 项`}</button>}</div>;
    })}
    {attention.optional.length > 0 && <details className="career-attention-optional" data-testid="career-optional"><summary>可选补充 · {attention.optional.length} 项</summary><p>这些字段在网页中明确为可选，不计入需处理数量。</p><ul className="application-attention-list">{attention.optional.map(renderPending)}</ul></details>}
    {attention.notices.length > 0 && <div className="career-attention-notices" data-testid="career-notices"><h5>区块提醒</h5>{attention.notices.map((item, index) => <div key={index}><strong>{item.displayTitle}</strong><p>{item.hint}</p><p>{item.locateHint}</p></div>)}</div>}
  </section>;
  useImperativeHandle(ref, () => ({ autoFill, stop, invalidateWritePlan: () => { setUsed(true); } }));

  return <section className="career-fill-panel" aria-labelledby="career-fill-title" data-testid="career-fill-panel">
    <div className="career-fill-heading"><h3 id="career-fill-title"><ListChecks size={16} />自动填写</h3>
      {phase && phase !== 'locating' && <Button variant="ghost" disabled={phase === 'stopping'} onClick={() => void stop()}><Square size={13} />{phase === 'stopping' ? '停止中' : '停止'}</Button>}
    </div>
    <p className="career-fill-hint">点击顶部“自动填写”，使用已确认经历并保留已有内容。</p>
    <ErrorMessage message={error} />
    {status && <p className="career-auto-status" data-testid="career-auto-status" role="status" aria-live="polite">{status}</p>}
    {contactVerified > 0 && <p className="career-contact-summary" data-testid="career-contact-summary">联系资料已核实 {contactVerified} 项。</p>}
    {phase && <p className="career-fill-progress" role="status" aria-live="polite">{{ reading: '正在读取网页经历组…', preparing: '正在核对本次填写计划…', running: '正在按计划新增并填写，请保持窗口在前台…', stopping: '正在停止，不会继续下一步…', locating: '正在定位网页字段，不会修改内容…' }[phase]}</p>}
    {!outcome && pendingList}
    {locateMessage && <p className="application-field-locate-status" data-testid="career-locate-status" role="status">{locateMessage}</p>}
    <details className="career-manual-tools" data-testid="career-manual-tools" open={manualExpanded} onToggle={event => setManualExpanded(event.currentTarget.open)}>
      <summary aria-disabled={Boolean(phase)} onClick={event => { if (phase) event.preventDefault(); }}
        onKeyDown={event => { if (phase && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }}>手动调整{needsDecision ? ' · 有对应关系待核对' : ''}</summary>
      {needsDecision && <div className="career-decision-notice" role="status"><p>其余可确定的记录已经自动整理，只需核对下面无法唯一对应的网页组。</p>
        <ul>{autoIssues.map((issue, index) => <li key={index}>{CAREER_FILL_LABELS[issue.collection]}：{issueLabel(issue)}</li>)}</ul>
      </div>}
    <Button disabled={inactive} busy={phase === 'reading'} onClick={() => void readGroups()}>1. 读取网页经历组（含学历和日期）</Button>

    {observation && <>
      <details className="career-record-adjustments" open={!needsDecision}>
      <summary aria-disabled={Boolean(phase)} onClick={event => { if (phase) event.preventDefault(); }}
        onKeyDown={event => { if (phase && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }}>调整要填写的经历与顺序</summary>
      <div className="career-fill-selection"><h4>2. 选择本次填写的已确认经历</h4><p className="career-fill-hint">编号是本次处理顺序。未确认的经历需先到“我的资料”逐条确认。</p>
        {CAREER_FILL_COLLECTIONS.map(collection => <fieldset key={collection} disabled={inactive} className="career-fill-records"><legend>{CAREER_FILL_LABELS[collection]}</legend>
          {!records[collection].length && <p className="career-fill-hint">暂无当前修订已确认的{CAREER_FILL_LABELS[collection]}。</p>}
          {[...selection[collection].flatMap(id => records[collection].filter(record => record.id === id)), ...records[collection].filter(record => !selection[collection].includes(record.id))].map(record => {
            const index = selection[collection].indexOf(record.id); const selected = index >= 0;
            return <div key={record.id} className="career-fill-record"><label><input type="checkbox" checked={selected} onChange={event => toggleRecord(collection, record.id, event.target.checked)} />
              <span>{selected && <b className="career-fill-order">{index + 1}</b>}{record.title}<small>{record.detail}</small></span></label>
              {selected && <div className="career-fill-order-actions"><button type="button" disabled={index === 0} aria-label={`上移${record.title}`} onClick={() => moveRecord(collection, record.id, -1)}><ArrowUp size={13} /></button><button type="button" disabled={index === selection[collection].length - 1} aria-label={`下移${record.title}`} onClick={() => moveRecord(collection, record.id, 1)}><ArrowDown size={13} /></button></div>}
            </div>;
          })}
        </fieldset>)}
      </div>
      </details>
      <div className="career-fill-groups"><h4>3. 核对已有网页组</h4><p className="career-fill-hint">每组都要明确选择；不按学校、文字或顺序替你猜对应。</p>
        {!observation.groups.length && <p>当前没有已有经历组；确认预览后将尝试使用已核实的新增入口。</p>}
        {shownGroups.map(group => {
          const choice = choices[group.id];
          const ordinal = observation.groups.filter(candidate => candidate.collection === group.collection).findIndex(candidate => candidate.id === group.id) + 1;
          const boundElsewhere = new Set(Object.entries(choices).flatMap(([id, item]) => id !== group.id && item?.kind === 'bind'
            && observation.groups.find(candidate => candidate.id === id)?.collection === group.collection ? [item.recordId] : []));
          return <div className="career-fill-group" key={group.id}>
            <strong>{CAREER_FILL_LABELS[group.collection]} · 网页第 {ordinal} 组</strong>
            <p className="career-fill-group-values">{group.fields.filter(field => field.value.trim()).slice(0, 3).map(field => `${CAREER_FIELD_LABELS[field.key] || field.key}：${field.value}`).join('；') || '当前组为空白'}</p>
            <label><span className="career-fill-hint">本组如何处理</span><select aria-label={`${CAREER_FILL_LABELS[group.collection]}网页第${ordinal}组对应经历`} disabled={inactive}
              value={choice?.kind === 'preserve' ? 'preserve' : choice?.kind === 'bind' ? `record:${choice.recordId}` : ''}
              onChange={event => { clearPreview(); const value = event.target.value; setChoices(previous => ({ ...previous, [group.id]: value === 'preserve' ? { kind: 'preserve' } : value.startsWith('record:') ? { kind: 'bind', recordId: value.slice(7) } : undefined })); }}>
              <option value="">请选择对应经历或保留</option><option value="preserve">保留本组，不填写</option>
              {selection[group.collection].map(id => <option key={id} value={`record:${id}`} disabled={boundElsewhere.has(id)}>{selection[group.collection].indexOf(id) + 1}. {recordTitle(group.collection, id)}</option>)}
            </select></label>
          </div>;
        })}
      </div>
      {needsDecision && <Button className="career-continue-auto" data-testid="career-continue-auto" disabled={inactive || !selectedCount || unansweredGroups > 0 || autoIssues.some(issue => issue.reason === 'duplicate-record')}
        onClick={() => void continueAutomatic()}>继续自动填写</Button>}
      <Button variant="secondary" disabled={inactive || !selectedCount || unansweredGroups > 0} busy={phase === 'preparing'} onClick={() => void prepare()}>生成本次预览{unansweredGroups > 0 ? `（还有 ${unansweredGroups} 组待核对）` : ''}</Button>
    </>}

    {preview && <div className="career-fill-preview" data-testid="career-fill-preview"><h4>4. 确认自动新增并填写</h4>
      <p>本次选中 {selectedCount} 条经历，当前有 {readyCount} 项可填写。新增后会重新读取并核对，再处理下一条。</p>
      {preview.steps.map((step, index) => <details key={`${index}-${step.recordId}`} className="career-fill-step"><summary>{step.kind === 'add-then-reobserve' ? '新增后再核对' : '填写当前组'} · {recordTitle(step.collection, step.recordId)}</summary>
        {step.items?.map(item => <div key={item.fieldId} className="career-fill-preview-item"><div className="application-attention-row"><strong>{CAREER_FIELD_LABELS[item.key] || item.key} · {{ ready: '准备填写', skip: '保留', review: '需我处理' }[item.status]}</strong>{item.status === 'review' && <button type="button" className="application-field-locate" data-testid="career-preview-locate" disabled={inactive} aria-label={`定位${CAREER_FIELD_LABELS[item.key] || item.key}`} onClick={() => void locateField({ collection: step.collection, recordId: step.recordId, groupId: step.groupId, fieldId: item.fieldId, key: item.key, required: false, reason: item.reason })}><LocateFixed size={13} />定位</button>}</div><p>{item.reason}</p>{item.value && <div className="career-fill-value">将填入：{item.value}</div>}{item.currentValue && <div className="career-fill-value">网页已有：{item.currentValue}</div>}</div>)}
      </details>)}
      {!!preview.issues.length && <ul className="career-fill-issues">{preview.issues.map((issue, index) => <li key={index}>{CAREER_FILL_LABELS[issue.collection]}{issue.recordId ? ` · ${recordTitle(issue.collection, issue.recordId)}` : ''}：{issue.reason}</li>)}</ul>}
      {!actionable && <p className="career-fill-hint">当前没有可自动执行的步骤，请处理上面的待核对项。</p>}
      <Button disabled={inactive || used || !actionable} onClick={() => void run()}><WandSparkles size={15} />{used ? '本次计划已使用，请重新读取' : '确认，自动新增并填写'}</Button>
    </div>}
    </details>
    {outcome && <div className="career-fill-outcome" role="status" data-testid="career-fill-outcome"><h4>{{ completed: '本次填写完成', partial: '本次部分完成', stopped: '本次已停止' }[outcome.status]}</h4>
      <p>新增 {outcome.addedCount} 组，重读核实 {outcome.verifiedCount} 项；需处理 {attention.count} 项{attention.optional.length ? `，另有 ${attention.optional.length} 项可选` : ''}。</p>
      {outcome.stopReason && <p>{outcome.failureMessage || stopLabels[outcome.stopReason] || '本次操作已停止，请检查网页后重新读取。'}</p>}
      {pendingList}
      <p className="career-fill-hint">请在网页核对结果；这里不会提交申请或将申请状态改成已投递。</p>
    </div>}
  </section>;
});
