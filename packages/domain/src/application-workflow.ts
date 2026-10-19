import { createHash } from 'node:crypto';
import type { Database } from 'sql.js';
import type { AppState, Application, FillPlan, FillResult, Job, Profile } from '../../shared/src/contracts.js';
import type { CareerFillOutcome, CareerFillPreview, CareerFillCollection } from '../../shared/src/career-form.js';
import { APPLICATION_ISSUE_REASONS, type ApplicationIssueReason, type ApplicationSectionKey, type ApplicationWorkflow,
  type ApplicationWorkflowIssue, type ApplicationWorkflowState, type ApplicationWorkflowTarget } from '../../shared/src/application-workflow.js';
import { deleteDocument, readDocument, readDocuments, writeDocument, type DatabaseFile } from './sqlite.js';

const KIND = 'application_workflow';
const sections = ['contact', 'educations', 'internships', 'projects', 'other'] as const;
const ordinaryKeys = new Set(['fullName', 'fullNameEn', 'email', 'phone', 'school', 'schoolEn', 'degree', 'major', 'majorEn', 'graduationMonth']);
const careerKeys = new Set(['school', 'schoolEn', 'degree', 'major', 'majorEn', 'organization', 'name', 'role', 'startDate', 'endDate', 'description', 'url']);
const labels: Record<string, string> = { fullName: '姓名', fullNameEn: '英文姓名', email: '邮箱', phone: '手机号', school: '学校', schoolEn: '英文学校', degree: '学历', major: '专业', majorEn: '英文专业', graduationMonth: '毕业年月', organization: '实习单位', name: '项目名称', role: '职务 / 角色', startDate: '开始时间', endDate: '结束时间', description: '经历说明', url: '项目链接' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identifier(value: unknown): value is string { return typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(value); }
function validURL(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 4000) throw new Error('缺少明确的申请网页地址。');
  let parsed: URL; try { parsed = new URL(value); } catch { throw new Error('申请网页地址无效。'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
    || [...parsed.searchParams.keys()].some(key => /(?:token|password|secret|authorization|api[_-]?key|session)/iu.test(key))) throw new Error('申请地址不能包含凭据或会话信息。');
}
function validateTarget(target: ApplicationWorkflowTarget) {
  if (!target || typeof target !== 'object' || Object.keys(target).some(key => !['url', 'applicationId', 'jobId', 'profileVersion'].includes(key))) throw new Error('申请目标参数无效。');
  validURL(target.url);
  if (!Number.isSafeInteger(target.profileVersion) || target.profileVersion < 0
    || target.applicationId !== undefined && !identifier(target.applicationId) || target.jobId !== undefined && !identifier(target.jobId)) throw new Error('申请目标版本或关联记录无效。');
}
/** Exact URL only; a company name or a similar URL can never establish ownership. */
export function resolveApplicationWorkflowTarget(state: Pick<AppState, 'profile' | 'applications' | 'jobs'>, url: string,
  ids: { applicationId?: string; jobId?: string } = {}): ApplicationWorkflowTarget {
  validURL(url);
  if (Object.keys(ids).some(key => !['applicationId', 'jobId'].includes(key))) throw new Error('申请关联参数无效。');
  const applications = state.applications.filter(item => item.url === url);
  const application = ids.applicationId ? state.applications.find(item => item.id === ids.applicationId) : applications.length === 1 ? applications[0] : undefined;
  if (ids.applicationId && (!application || application.url !== url)) throw new Error('申请记录与当前精确网页不一致。');
  if (!ids.applicationId && applications.length > 1) throw new Error('同一网址对应多条申请，请明确选择当前申请。');
  const jobs = state.jobs.filter(item => item.url === url);
  const explicitJobId = ids.jobId ?? application?.jobId;
  const job = explicitJobId ? state.jobs.find(item => item.id === explicitJobId) : jobs.length === 1 ? jobs[0] : undefined;
  if (explicitJobId && (!job || job.url !== url)) throw new Error('岗位记录与当前精确网页不一致。');
  if (!explicitJobId && jobs.length > 1) throw new Error('同一网址对应多条岗位，请明确选择当前岗位。');
  if (application?.jobId && ids.jobId && application.jobId !== ids.jobId) throw new Error('申请与岗位的关联不一致。');
  const target = { url, profileVersion: state.profile.version, ...(application ? { applicationId: application.id } : {}), ...(job ? { jobId: job.id } : {}) };
  validateTarget(target); return target;
}
function assertCurrent(db: Database, target: ApplicationWorkflowTarget) {
  validateTarget(target);
  const profile = readDocument<Profile>(db, 'profile', 'current');
  if (!profile || profile.version !== target.profileVersion) throw new Error('资料已变化，请重新观察申请网页。');
  const resolved = resolveApplicationWorkflowTarget({ profile, applications: readDocuments<Application>(db, 'application'), jobs: readDocuments<Job>(db, 'job') }, target.url,
    { ...(target.applicationId ? { applicationId: target.applicationId } : {}), ...(target.jobId ? { jobId: target.jobId } : {}) });
  if (resolved.applicationId !== target.applicationId || resolved.jobId !== target.jobId) throw new Error('申请关联已变化，请重新确认当前目标。');
  return profile;
}
function identity(target: ApplicationWorkflowTarget) { return hash([target.url, target.applicationId ?? null, target.jobId ?? null]); }
function snapshot(db: Database): ApplicationWorkflowState { return { workflows: readDocuments<ApplicationWorkflow>(db, KIND).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }; }
function getWorkflow(db: Database, target: ApplicationWorkflowTarget, now: string): ApplicationWorkflow {
  const id = identity(target); const prior = readDocument<ApplicationWorkflow>(db, KIND, id);
  if (prior) {
    if (prior.schemaVersion !== 1) throw new Error('申请进度版本尚不支持，原记录已保留。');
    if (prior.target.profileVersion !== target.profileVersion) {
      prior.sections = prior.sections.map(section => ({ ...section, progress: section.inspected ? 'unknown' : 'uninspected', verifiedFields: 0 }));
      // Old resolved issues are historical evidence, identified by their checked
      // profile version. Only a fresh observed gap may reopen that exact issue.
    }
    prior.target = { ...target }; return prior;
  }
  return { id, schemaVersion: 1, target: { ...target }, status: 'idle', createdAt: now, updatedAt: now,
    coverage: 'observed-targets-only', requiresFreshObservation: true,
    sections: sections.map(key => ({ key, progress: 'uninspected', inspected: false, observedFields: 0, verifiedFields: 0, saved: null })), issues: [] };
}
function safeLabel(value: string | undefined): string {
  return (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
    .replace(/\b(?:sk-[A-Za-z0-9_.-]{12,}|gh[pousr]_[A-Za-z0-9]{16,})\b/gu, '[凭据已隐藏]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[联系方式已隐藏]').slice(0, 160) || '需要核对的填写项';
}
function ordinaryRef(plan: FillPlan, item: FillPlan['items'][number]): string {
  const label = safeLabel(item.label); const same = plan.items.filter(value => sectionFor(value.profileKey) === sectionFor(item.profileKey) && safeLabel(value.label) === label);
  return hash([sectionFor(item.profileKey), label, same.indexOf(item)]);
}
type IssueData = Pick<ApplicationWorkflowIssue, 'section' | 'scope' | 'required' | 'reasonCode'> & Partial<Pick<ApplicationWorkflowIssue, 'collection' | 'recordId' | 'profileField' | 'label' | 'groupId' | 'fieldId' | 'fieldType' | 'fieldSignature' | 'groupSignature'>> & { fieldRef?: string; ongoingEndDate?: boolean };
const fieldIdentity = (value: unknown): value is string => typeof value === 'string' && /^[\p{L}\p{N}_.:\[\]-]{1,240}$/u.test(value);
const signature = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function ongoingEndDate(collection: CareerFillCollection, key: string | undefined, record: unknown): boolean {
  return key === 'endDate' && !!record && typeof record === 'object'
    && (collection === 'internships' && 'current' in record && record.current === true
      || collection === 'projects' && 'ongoing' in record && record.ongoing === true);
}
function addIssue(workflow: ApplicationWorkflow, input: IssueData, now: string) {
  const key = input.profileField && (input.collection ? careerKeys : ordinaryKeys).has(input.profileField) ? input.profileField : undefined;
  const recordId = identifier(input.recordId) ? input.recordId : undefined;
  const id = hash([workflow.id, input.section, input.scope, input.collection ?? null, recordId ?? null, key ?? null, key ? null : input.fieldRef ?? null]);
  const old = workflow.issues.find(issue => issue.id === id);
  const next: ApplicationWorkflowIssue = { id, section: input.section, scope: input.scope, required: input.required,
    reasonCode: input.reasonCode,
    reason: input.ongoingEndDate ? '资料已声明至今/仍在进行；若网页提供“至今”请手动选择，当前执行器不代填结束时间，不需要填写虚构结束日期' : APPLICATION_ISSUE_REASONS[input.reasonCode],
    label: input.label ? safeLabel(input.label) : key ? labels[key]! : '需要核对的填写项',
    ...(input.collection ? { collection: input.collection } : {}), ...(recordId ? { recordId } : {}), ...(key ? { profileField: key } : {}),
    ...(fieldIdentity(input.groupId) ? { groupId: input.groupId } : {}), ...(fieldIdentity(input.fieldId) ? { fieldId: input.fieldId } : {}),
    ...(typeof input.fieldType === 'string' && /^[a-z-]{1,40}$/u.test(input.fieldType) ? { fieldType: input.fieldType } : {}),
    ...(signature(input.fieldSignature) ? { fieldSignature: input.fieldSignature } : {}), ...(signature(input.groupSignature) ? { groupSignature: input.groupSignature } : {}),
    ...(!key && input.fieldRef ? { fieldRef: hash(input.fieldRef) } : {}),
    status: old?.status === 'dismissed' ? 'dismissed' : 'open', createdAt: old?.createdAt ?? now, updatedAt: now,
    lastCheckedProfileVersion: workflow.target.profileVersion, readbackVerified: false, attentionState: 'current' };
  if (old) workflow.issues.splice(workflow.issues.indexOf(old), 1, next); else workflow.issues.push(next);
}
function resolveIssue(workflow: ApplicationWorkflow, section: ApplicationSectionKey, key: string | undefined, recordId: string | undefined, now: string, fieldRef?: string,
  evidence: ApplicationWorkflowIssue['resolutionEvidence'] = 'write-readback') {
  if (!key && !fieldRef) return;
  for (const issue of workflow.issues) if (issue.section === section && issue.recordId === recordId && (key ? issue.profileField === key : !issue.profileField && issue.fieldRef === hash(fieldRef))) {
    issue.status = 'resolved'; issue.readbackVerified = true; issue.resolvedAt = now; issue.updatedAt = now;
    issue.lastCheckedProfileVersion = workflow.target.profileVersion;
    issue.resolutionEvidence = evidence;
    issue.attentionState = 'current';
  }
}
/** Existing contents only clear a gap when this fresh, explicitly bound record proves that same fact. */
function matchesConfirmedCareerFact(profile: Profile, preview: CareerFillPreview, step: CareerFillPreview['steps'][number], item: NonNullable<CareerFillPreview['steps'][number]['items']>[number]): boolean {
  if (step.kind !== 'fill-group' || !step.groupId || item.status !== 'skip' || !item.currentValue.trim()) return false;
  const group = preview.groups.find(group => group.id === step.groupId && group.collection === step.collection);
  const field = group?.fields.find(field => field.id === item.fieldId && field.key === item.key);
  const records = profile.career?.[step.collection].filter(record => record.id === step.recordId) ?? [];
  const record = records.length === 1 ? records[0] : undefined;
  const bindings = preview.bindings.filter(binding => binding.collection === step.collection && binding.recordId === step.recordId && binding.groupId === step.groupId);
  if (!group || !field || field.value !== item.currentValue || !record || record.confirmation !== 'confirmed' || record.confirmedRevision !== record.revision || !record.confirmedAt
    || bindings.length !== 1 || bindings[0]!.revision !== record.revision || bindings[0]!.profileVersion !== profile.version || bindings[0]!.groupSignature !== group.signature) return false;
  const raw = (record as unknown as Record<string, unknown>)[item.key];
  if (item.key === 'endDate' && ongoingEndDate(step.collection, item.key, record)) return (raw === '' || raw === undefined) && field.type === 'feishu-month' && field.supportsUntilNow === true && item.currentValue.trim() === '至今';
  return typeof raw === 'string' && !!raw.trim() && raw.trim() === item.currentValue.trim();
}
function resolveSectionNotices(workflow: ApplicationWorkflow, collection: CareerFillCollection, recordId: string, now: string) {
  for (const issue of workflow.issues) if (issue.status === 'open' && issue.scope === 'section' && issue.reasonCode === 'unbound-record'
    && issue.collection === collection && issue.recordId === recordId) {
    issue.status = 'resolved'; issue.updatedAt = now; issue.resolvedAt = now; issue.readbackVerified = false;
    issue.resolutionEvidence = 'fresh-observation'; issue.lastCheckedProfileVersion = workflow.target.profileVersion;
  }
}
function sectionFor(key: string | undefined): ApplicationSectionKey { return key && ['school', 'schoolEn', 'degree', 'major', 'majorEn', 'graduationMonth'].includes(key) ? 'educations' : key && ordinaryKeys.has(key) ? 'contact' : 'other'; }
function ordinaryReason(item: FillPlan['items'][number]): ApplicationIssueReason {
  return item.profileKey && ordinaryKeys.has(item.profileKey) && !item.value.trim() && !item.currentValue.trim() ? 'missing-profile'
    : /不支持|手动|控件|日期/u.test(item.reason) ? 'unsupported-field' : 'needs-review';
}
function put(db: Database, workflow: ApplicationWorkflow, now: string) { workflow.updatedAt = now; writeDocument(db, KIND, workflow.id, workflow, now); }

export interface ApplicationWorkflowStore {
  workflowState(): Promise<ApplicationWorkflowState>;
  recordOrdinaryPlan(target: ApplicationWorkflowTarget, plan: FillPlan): Promise<ApplicationWorkflow>;
  recordOrdinaryResult(target: ApplicationWorkflowTarget, plan: FillPlan, result: FillResult): Promise<ApplicationWorkflow>;
  recordCareerPreview(target: ApplicationWorkflowTarget, preview: CareerFillPreview): Promise<ApplicationWorkflow>;
  /** Reconciles host-only observations. Never registers a runnable plan or grants filling authority. */
  reconcileReadOnly(target: ApplicationWorkflowTarget, input: { ordinary?: FillPlan; career?: CareerFillPreview }): Promise<ApplicationWorkflow>;
  recordCareerOutcome(target: ApplicationWorkflowTarget, preview: CareerFillPreview, outcome: CareerFillOutcome,
    verifiedFields?: Array<{ collection: CareerFillCollection; recordId: string; key: string }>): Promise<ApplicationWorkflow>;
  startWorkflow(target: ApplicationWorkflowTarget): Promise<ApplicationWorkflow>;
  interruptWorkflow(target: ApplicationWorkflowTarget): Promise<ApplicationWorkflow>;
  finishWorkflow(target: ApplicationWorkflowTarget): Promise<ApplicationWorkflow>;
  setApplicationIssueStatus(input: { workflowId: string; issueId: string; status: 'open' | 'dismissed' }): Promise<ApplicationWorkflowState>;
}
/** Called inside the owner's application-deletion transaction. */
export function removeApplicationWorkflows(db: Database, applicationId: string): void {
  for (const workflow of readDocuments<ApplicationWorkflow>(db, KIND)) if (workflow.target.applicationId === applicationId) deleteDocument(db, KIND, workflow.id);
}

/** Host-only evidence methods share the already-owned SQLite queue and file. No extra database or authority. */
export function createApplicationWorkflowStore(file: DatabaseFile): ApplicationWorkflowStore {
  const ordinary = new Map<string, string>(); const career = new Map<string, string>();
  const recovery = file.transact(db => {
    const now = new Date().toISOString();
    for (const workflow of readDocuments<ApplicationWorkflow>(db, KIND)) {
      if (workflow.status === 'running') {
        workflow.status = 'interrupted'; delete workflow.pendingPlan;
        workflow.sections = workflow.sections.map(section => section.inspected && section.progress !== 'verified' ? { ...section, progress: 'unknown' } : section);
        addIssue(workflow, { section: 'other', scope: 'application', required: null, reasonCode: 'interrupted' }, now); put(db, workflow, now);
      } else if (workflow.pendingPlan) { delete workflow.pendingPlan; put(db, workflow, now); }
    }
  });
  const mutate = async (target: ApplicationWorkflowTarget, fn: (workflow: ApplicationWorkflow, now: string, profile: Profile) => void) => {
    await recovery;
    return file.transact(db => { const profile = assertCurrent(db, target), now = new Date().toISOString(), workflow = getWorkflow(db, target, now); fn(workflow, now, profile); put(db, workflow, now); return structuredClone(workflow); });
  };
  const start = (workflow: ApplicationWorkflow, kind: 'ordinary' | 'career', planId: string) => {
    workflow.status = 'idle'; workflow.pendingPlan = { kind, hash: hash(planId) };
  };
  const checkPlan = (target: ApplicationWorkflowTarget, plan: { url: string; profileVersion: number }, id: string) => {
    if (!identifier(id) || plan.url !== target.url || plan.profileVersion !== target.profileVersion) throw new Error('填写计划与当前申请目标不一致。');
  };
  const inspectOrdinary = (workflow: ApplicationWorkflow, now: string, profile: Profile, plan: FillPlan) => {
        for (const issue of workflow.issues) if (issue.status === 'open' && issue.scope === 'field' && !issue.collection) issue.attentionState = 'not-reobserved';
        for (const item of plan.items) {
          if (!ordinaryKeys.has(item.profileKey ?? '') && item.status === 'skip') continue;
          const key = ordinaryKeys.has(item.profileKey ?? '') ? item.profileKey : undefined, section = sectionFor(key);
          const state = workflow.sections.find(value => value.key === section)!;
          state.inspected = true; state.lastObservedAt = now; state.observedFields = plan.items.filter(value => sectionFor(value.profileKey) === section).length;
          if (item.status !== 'skip') state.progress = 'needs-user';
          else if (state.progress !== 'verified') state.progress = 'filled-unsaved';
          if (item.status === 'skip' && key && item.currentValue.trim()) {
            const source = (profile as unknown as Record<string, unknown>)[key];
            if (section === 'contact' && typeof source === 'string' && source.trim() && source.trim() === item.currentValue.trim()) resolveIssue(workflow, section, key, undefined, now, ordinaryRef(plan, item), 'fresh-observation');
          }
          const priorGap = workflow.issues.some(issue => issue.status === 'open' && issue.scope === 'field' && issue.section === section
            && (key ? issue.profileField === key : issue.fieldRef === hash(ordinaryRef(plan, item))));
          if (item.status === 'review' || item.status === 'ready' && (!item.value.trim() || priorGap)) addIssue(workflow, { section, scope: 'field', required: item.required ?? null,
            reasonCode: item.status === 'ready' && item.value.trim() ? 'not-yet-filled' : ordinaryReason(item), profileField: key, fieldRef: ordinaryRef(plan, item), label: item.label,
            fieldId: item.fieldId, fieldType: item.type, fieldSignature: item.fieldSignature }, now);
        }
  };
  const inspectCareer = (workflow: ApplicationWorkflow, now: string, profile: Profile, preview: CareerFillPreview) => {
        for (const issue of workflow.issues) if (issue.status === 'open' && issue.collection) issue.attentionState = 'not-reobserved';
        for (const collection of ['educations', 'internships', 'projects'] as const) {
          const groups = preview.groups.filter(group => group.collection === collection);
          const steps = preview.steps.filter(step => step.collection === collection);
          if (!groups.length && !steps.length) continue;
          const section = workflow.sections.find(value => value.key === collection)!;
          section.inspected = true; section.lastObservedAt = now; section.observedFields = groups.reduce((sum, group) => sum + group.fields.length, 0); section.progress = 'needs-user';
          for (const step of steps) for (const item of step.items ?? []) {
            const group = groups.find(group => group.id === step.groupId);
            const field = group?.fields.find(field => field.id === item.fieldId);
            if (matchesConfirmedCareerFact(profile, preview, step, item)) {
              resolveIssue(workflow, collection, item.key, step.recordId, now, item.fieldId, 'fresh-observation');
              resolveSectionNotices(workflow, collection, step.recordId, now);
              continue;
            }
            const priorGap = workflow.issues.some(issue => issue.status === 'open' && issue.scope === 'field' && issue.collection === collection && issue.recordId === step.recordId && issue.profileField === item.key);
            if (item.status !== 'review' && !(item.status === 'skip' && !item.currentValue.trim() && !item.value.trim() && field?.required !== false) && !priorGap) continue;
            const record = profile.career?.[collection].find(value => value.id === step.recordId);
            const source = item.key && record ? (record as unknown as Record<string, unknown>)[item.key] : undefined;
            const ongoing = ongoingEndDate(collection, item.key, record);
            addIssue(workflow, { section: collection, collection, recordId: step.recordId, profileField: item.key, fieldRef: item.fieldId, scope: 'field', required: field?.required ?? null,
              groupId: step.groupId, fieldId: item.fieldId, fieldType: field?.type, fieldSignature: field?.signature, groupSignature: group?.signature,
              ongoingEndDate: ongoing && item.status !== 'ready', reasonCode: item.status === 'ready' ? 'not-yet-filled' : item.currentValue.trim() ? 'needs-review'
                : ongoing || field?.editable === false ? 'unsupported-field' : source === '' || source === undefined ? 'missing-profile' : 'needs-review' }, now);
          }
          const selected = preview.selectedRecordIds[collection] ?? [];
          if (selected.length && !preview.issues.some(issue => issue.collection === collection)
            && selected.every(recordId => preview.bindings.some(binding => binding.collection === collection && binding.recordId === recordId))) {
            for (const issue of workflow.issues) if (issue.status === 'open' && issue.scope === 'section' && issue.collection === collection && issue.reasonCode === 'unbound-record' && !issue.recordId) {
              issue.status = 'resolved'; issue.readbackVerified = false; issue.updatedAt = now; issue.resolvedAt = now;
              issue.resolutionEvidence = 'fresh-observation'; issue.lastCheckedProfileVersion = profile.version;
            }
          }
        }
        for (const issue of preview.issues) addIssue(workflow, { section: issue.collection, collection: issue.collection, recordId: issue.recordId, scope: 'section', required: null, reasonCode: 'unbound-record', label: '经历与网页对应关系' }, now);
  };
  return {
    async workflowState(): Promise<ApplicationWorkflowState> { await recovery; return file.read(snapshot); },
    async reconcileReadOnly(target: ApplicationWorkflowTarget, input: { ordinary?: FillPlan; career?: CareerFillPreview }) {
      if (!input || !input.ordinary && !input.career || Object.keys(input).some(key => !['ordinary', 'career'].includes(key))) throw new Error('缺少本次只读观察。');
      if (input.ordinary) checkPlan(target, input.ordinary, input.ordinary.id);
      if (input.career) checkPlan(target, input.career, input.career.planId);
      const updated = await mutate(target, (workflow, now, profile) => {
        if (workflow.status === 'running') throw new Error('正在填写，请结束后再重新读取提示。');
        // Absence is not completion: retain old issues as open, but don't present
        // an unobserved/unchosen field as a fresh must-fill request.
        for (const issue of workflow.issues) if (issue.status === 'open') issue.attentionState = 'not-reobserved';
        if (input.ordinary) inspectOrdinary(workflow, now, profile, input.ordinary);
        if (input.career) inspectCareer(workflow, now, profile, input.career);
        delete workflow.pendingPlan;
      });
      ordinary.delete(updated.id); career.delete(updated.id); return updated;
    },
    async startWorkflow(target: ApplicationWorkflowTarget) {
      return mutate(target, workflow => {
        const planId = workflow.pendingPlan?.kind === 'ordinary' ? ordinary.get(workflow.id) : career.get(workflow.id);
        if (!planId || !workflow.pendingPlan || workflow.pendingPlan.hash !== hash(planId)) throw new Error('请重新观察页面并生成新计划后再开始填写。');
        workflow.status = 'running';
      });
    },
    async recordOrdinaryPlan(target: ApplicationWorkflowTarget, plan: FillPlan) {
      checkPlan(target, plan, plan.id);
      const result = await mutate(target, (workflow, now, profile) => {
        start(workflow, 'ordinary', plan.id);
        inspectOrdinary(workflow, now, profile, plan);
      });
      ordinary.set(result.id, plan.id); return result;
    },
    async recordOrdinaryResult(target: ApplicationWorkflowTarget, plan: FillPlan, result: FillResult) {
      checkPlan(target, plan, plan.id);
      if (result.planId !== plan.id || ordinary.get(identity(target)) !== plan.id) throw new Error('没有可核对的本次普通填写计划。');
      const ids = new Set(plan.items.map(item => item.fieldId));
      if (result.verified.some(item => !ids.has(item.fieldId)) || result.unresolved.some(item => !ids.has(item.fieldId))
        || new Set(result.verified.map(item => item.fieldId)).size !== result.verified.length
        || result.verified.some(item => result.unresolved.some(other => other.fieldId === item.fieldId))) throw new Error('填写结果不属于本次观察。');
      const updated = await mutate(target, (workflow, now) => {
        if (workflow.pendingPlan?.hash !== hash(plan.id) || workflow.pendingPlan.kind !== 'ordinary') throw new Error('普通填写结果已失效。');
        for (const verified of result.verified) {
          const item = plan.items.find(item => item.fieldId === verified.fieldId)!;
          if (item.status !== 'ready' || !item.value.trim()) throw new Error('不能核实未计划填写的字段。');
          const section = sectionFor(item.profileKey), state = workflow.sections.find(value => value.key === section)!;
          state.verifiedFields++; resolveIssue(workflow, section, item.profileKey, undefined, now, ordinaryRef(plan, item));
        }
        for (const unresolved of result.unresolved) {
          const item = plan.items.find(item => item.fieldId === unresolved.fieldId)!;
          addIssue(workflow, { section: sectionFor(item.profileKey), scope: 'field', required: item.required ?? null, reasonCode: 'verification-failed', profileField: item.profileKey, fieldRef: ordinaryRef(plan, item), label: item.label,
            fieldId: item.fieldId, fieldType: item.type, fieldSignature: item.fieldSignature }, now);
        }
        for (const item of plan.items) if (item.status === 'ready' && !result.verified.some(value => value.fieldId === item.fieldId) && !result.unresolved.some(value => value.fieldId === item.fieldId)) {
          addIssue(workflow, { section: sectionFor(item.profileKey), scope: 'field', required: item.required ?? null, reasonCode: 'not-yet-filled', profileField: item.profileKey, fieldRef: ordinaryRef(plan, item), label: item.label,
            fieldId: item.fieldId, fieldType: item.type, fieldSignature: item.fieldSignature }, now);
        }
        for (const state of workflow.sections.filter(value => value.inspected)) {
          if (workflow.issues.some(issue => issue.section === state.key && issue.status === 'open')) state.progress = 'needs-user';
          else if (state.verifiedFields) state.progress = 'verified';
        }
        workflow.lastExecution = { kind: 'ordinary', verifiedCount: result.verified.length, addedCount: 0 };
        workflow.status = 'idle'; delete workflow.pendingPlan;
      });
      ordinary.delete(updated.id); return updated;
    },
    async recordCareerPreview(target: ApplicationWorkflowTarget, preview: CareerFillPreview) {
      checkPlan(target, preview, preview.planId);
      const updated = await mutate(target, (workflow, now, profile) => {
        start(workflow, 'career', preview.planId);
        inspectCareer(workflow, now, profile, preview);
      });
      career.set(updated.id, preview.planId); return updated;
    },
    async recordCareerOutcome(target: ApplicationWorkflowTarget, preview: CareerFillPreview, outcome: CareerFillOutcome,
      verifiedFields: Array<{ collection: CareerFillCollection; recordId: string; key: string }> = []) {
      checkPlan(target, preview, preview.planId);
      if (career.get(identity(target)) !== preview.planId) throw new Error('没有可核对的本次经历填写计划。');
      if (![outcome.verifiedCount, outcome.addedCount].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('经历核实计数无效。');
      const expectedRecords = new Set([...Object.values(preview.selectedRecordIds).flat(), ...preview.steps.map(step => step.recordId), ...preview.bindings.map(binding => binding.recordId)]);
      const belongs = (collection: CareerFillCollection, recordId: string) => preview.selectedRecordIds[collection]?.includes(recordId)
        || preview.steps.some(step => step.collection === collection && step.recordId === recordId)
        || preview.bindings.some(binding => binding.collection === collection && binding.recordId === recordId);
      if (outcome.pending.some(item => item.recordId && (!expectedRecords.has(item.recordId) || !belongs(item.collection, item.recordId)))
        || outcome.bindings.some(binding => !belongs(binding.collection, binding.recordId) || binding.profileVersion !== target.profileVersion)) throw new Error('经历结果不属于本次选中的记录。');
      if (!Array.isArray(verifiedFields) || verifiedFields.some(item => !sections.includes(item.collection) || !belongs(item.collection, item.recordId) || !careerKeys.has(item.key))) throw new Error('经历逐项核实证据无效。');
      const proofs = [...new Map(verifiedFields.map(item => [JSON.stringify([item.collection, item.recordId, item.key]), item])).values()];
      if (proofs.length > outcome.verifiedCount || proofs.some(proof => outcome.pending.some(item => item.collection === proof.collection && item.recordId === proof.recordId && item.key === proof.key))) throw new Error('经历核实证据与待处理结果冲突。');
      const updated = await mutate(target, (workflow, now, profile) => {
        if (workflow.pendingPlan?.hash !== hash(preview.planId) || workflow.pendingPlan.kind !== 'career') throw new Error('经历填写结果已失效。');
        for (const pending of outcome.pending) {
          const record = pending.recordId ? profile.career?.[pending.collection].find(value => value.id === pending.recordId) : undefined;
          const source = record && pending.key ? (record as unknown as Record<string, unknown>)[pending.key] : undefined;
          const ongoing = ongoingEndDate(pending.collection, pending.key, record);
          const candidateBindings = outcome.bindings.filter(binding => binding.collection === pending.collection && binding.recordId === pending.recordId);
          const groupId = pending.groupId ?? (candidateBindings.length === 1 ? candidateBindings[0]!.groupId : undefined);
          const group = preview.groups.find(group => group.id === groupId && group.collection === pending.collection);
          const field = group?.fields.find(field => field.id === pending.fieldId && field.key === pending.key);
          const reasonCode = pending.reasonCode ?? (pending.fieldId ? ongoing ? 'unsupported-field' : source === '' || source === undefined ? 'missing-profile' : 'needs-review' : 'unbound-record');
          addIssue(workflow, { section: pending.collection, collection: pending.collection, recordId: pending.recordId, profileField: pending.key, fieldRef: pending.fieldId,
            groupId, fieldId: pending.fieldId, fieldType: field?.type ?? pending.type, fieldSignature: field?.signature, groupSignature: group?.signature,
            label: pending.key ? labels[pending.key] : '经历与网页对应关系', scope: pending.scope ?? (pending.fieldId || pending.key ? 'field' : 'section'), required: typeof pending.required === 'boolean' ? pending.required : null,
            ongoingEndDate: ongoing, reasonCode }, now);
        }
        const ready = preview.steps.flatMap(step => (step.items ?? []).filter(item => item.status === 'ready').map(item => ({ step, item })));
        for (const proof of proofs) resolveIssue(workflow, proof.collection, proof.key, proof.recordId, now);
        for (const collection of ['educations', 'internships', 'projects'] as const) {
          const section = workflow.sections.find(value => value.key === collection)!;
          const selectedSteps = preview.steps.filter(step => step.collection === collection);
          if (!section.inspected && !selectedSteps.length) continue;
          const planned = ready.filter(value => value.step.collection === collection);
          const count = proofs.filter(proof => proof.collection === collection).length;
          const completeReadyProof = planned.every(value => proofs.some(proof => proof.collection === collection && proof.recordId === value.step.recordId && proof.key === value.item.key));
          section.verifiedFields = count;
          section.progress = outcome.status === 'stopped' ? 'unknown'
            : workflow.issues.some(issue => issue.section === collection && issue.status === 'open') ? 'needs-user'
              : selectedSteps.some(step => step.kind === 'add-then-reobserve') ? 'filled-unsaved'
                : completeReadyProof && count > 0 ? 'verified' : outcome.verifiedCount > 0 ? 'filled-unsaved' : 'needs-user';
        }
        workflow.lastExecution = { kind: 'career', verifiedCount: outcome.verifiedCount, addedCount: outcome.addedCount };
        workflow.status = outcome.status === 'stopped' ? 'interrupted' : 'idle'; delete workflow.pendingPlan;
        if (outcome.status === 'stopped') addIssue(workflow, { section: 'other', scope: 'application', required: null, reasonCode: 'interrupted' }, now);
      });
      career.delete(updated.id); return updated;
    },
    async interruptWorkflow(target: ApplicationWorkflowTarget) {
      const updated = await mutate(target, (workflow, now) => {
        workflow.status = 'interrupted'; delete workflow.pendingPlan;
        workflow.sections = workflow.sections.map(section => section.inspected ? { ...section, progress: 'unknown' } : section);
        addIssue(workflow, { section: 'other', scope: 'application', required: null, reasonCode: 'interrupted' }, now);
      }); ordinary.delete(updated.id); career.delete(updated.id); return updated;
    },
    async finishWorkflow(target: ApplicationWorkflowTarget) {
      const updated = await mutate(target, workflow => { workflow.status = 'idle'; delete workflow.pendingPlan; });
      ordinary.delete(updated.id); career.delete(updated.id); return updated;
    },
    async setApplicationIssueStatus(input: { workflowId: string; issueId: string; status: 'open' | 'dismissed' }): Promise<ApplicationWorkflowState> {
      if (!input || Object.keys(input).some(key => !['workflowId', 'issueId', 'status'].includes(key))
        || !identifier(input.workflowId) || !identifier(input.issueId) || !['open', 'dismissed'].includes(input.status)) throw new Error('待处理状态参数无效。');
      await recovery;
      return file.transact(db => {
        const workflow = readDocument<ApplicationWorkflow>(db, KIND, input.workflowId);
        const issue = workflow?.issues.find(issue => issue.id === input.issueId);
        if (!workflow || !issue || workflow.status === 'running') throw new Error('待处理记录不存在或正在执行。');
        if (issue.status === 'resolved') throw new Error('网页已核实的历史不能改成忽略；请重新观察。');
        const now = new Date().toISOString(); issue.status = input.status; issue.updatedAt = now; issue.readbackVerified = false;
        put(db, workflow, now); return snapshot(db);
      });
    },
  };
}
