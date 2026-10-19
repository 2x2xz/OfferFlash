import type { AppState, ProfileInput } from './contracts.js';
import type { CareerFillCollection } from './career-form.js';
import { pickCareerInput } from '../../profile/src/career-input.js';

export type ApplicationSectionKey = 'contact' | CareerFillCollection | 'other';
export type ApplicationSectionProgress = 'uninspected' | 'filled-unsaved' | 'verified' | 'needs-user' | 'unknown';
export type ApplicationIssueReason = 'missing-profile' | 'unsupported-field' | 'needs-review' | 'not-yet-filled' | 'verification-failed' | 'interrupted' | 'unbound-record';
export interface ApplicationWorkflowTarget {
  url: string; applicationId?: string; jobId?: string; profileVersion: number;
}
export interface ApplicationWorkflowSection {
  key: ApplicationSectionKey; progress: ApplicationSectionProgress; inspected: boolean;
  observedFields: number; verifiedFields: number; saved: null;
  lastObservedAt?: string;
}
export interface ApplicationWorkflowIssue {
  id: string; section: ApplicationSectionKey; status: 'open' | 'resolved' | 'dismissed';
  scope: 'field' | 'section' | 'application'; required: boolean | null;
  reasonCode: ApplicationIssueReason; reason: string; label: string;
  collection?: CareerFillCollection; recordId?: string; profileField?: string; fieldRef?: string;
  /** Read-only identity, never a selector, coordinate, or reusable write authorization. */
  groupId?: string; fieldId?: string; fieldType?: string;
  fieldSignature?: string; groupSignature?: string;
  /** An unobserved historical gap stays open but is not a fresh request for user input. */
  attentionState?: 'current' | 'not-reobserved';
  createdAt: string; updatedAt: string; resolvedAt?: string;
  lastCheckedProfileVersion: number;
  /** A source edit or dismiss action is never evidence of webpage verification. */
  readbackVerified: boolean;
  resolutionEvidence?: 'write-readback' | 'fresh-observation';
}
export interface ApplicationWorkflow {
  id: string; schemaVersion: 1; target: ApplicationWorkflowTarget;
  status: 'idle' | 'running' | 'interrupted'; createdAt: string; updatedAt: string;
  sections: ApplicationWorkflowSection[]; issues: ApplicationWorkflowIssue[];
  coverage: 'observed-targets-only'; requiresFreshObservation: true;
  pendingPlan?: { kind: 'ordinary' | 'career'; hash: string };
  lastExecution?: { kind: 'ordinary' | 'career'; verifiedCount: number; addedCount: number };
}
export interface ApplicationWorkflowState { workflows: ApplicationWorkflow[]; }
/** Renderer API contains no way to create verified/resolved outcomes. */
export interface ApplicationWorkflowAPI {
  workflowState(): Promise<ApplicationWorkflowState>;
  setApplicationIssueStatus(input: { workflowId: string; issueId: string; status: 'open' | 'dismissed' }): Promise<ApplicationWorkflowState>;
}
export interface ApplicationIssueFactEdit {
  profile: ProfileInput; collection?: CareerFillCollection; recordId?: string;
}
export const APPLICATION_SECTION_LABELS: Record<ApplicationSectionKey, string> = {
  contact: '联系资料', educations: '教育经历', internships: '实习经历', projects: '项目经历', other: '其他问题',
};
export const APPLICATION_PROGRESS_LABELS: Record<ApplicationSectionProgress, string> = {
  uninspected: '尚未查看', 'filled-unsaved': '已填写，保存待核对', verified: '已重读核实', 'needs-user': '待处理', unknown: '中断后待重核对',
};
export const APPLICATION_ISSUE_REASONS: Record<ApplicationIssueReason, string> = {
  'missing-profile': '已确认资料缺少这项事实，请补充资料后重新核对。',
  'unsupported-field': '本项暂不支持自动操作，请在网页处理后重新核对。',
  'needs-review': '当前对应关系尚不明确，需要重新观察或人工核对。',
  'not-yet-filled': '本项已识别，但本轮尚未取得填写核实结果；继续前会重新观察。',
  'verification-failed': '本项没有通过网页重读核对，不能当作已填写。',
  interrupted: '执行中断，当前网页结果未知；继续前必须重新观察。',
  'unbound-record': '网页经历尚未唯一对应到已确认资料，请核对对应记录。',
};
/** Used only to locate a draft record for the user's explicit edit, never to infer a fact. */
export function applicationIssueRecord(state: AppState, issue: ApplicationWorkflowIssue) {
  const location = applicationIssueFactLocation(state, issue);
  return location.collection && location.recordId
    ? state.profile.career?.[location.collection].find(record => record.id === location.recordId) : undefined;
}

export function applicationIssueFactLocation(state: AppState, issue: ApplicationWorkflowIssue): { collection?: CareerFillCollection; recordId?: string; field?: string } {
  if (issue.collection) return { collection: issue.collection, recordId: issue.recordId, field: issue.profileField };
  const fields: Record<string, string> = { school: 'school', schoolEn: 'schoolEn', degree: 'degree', major: 'major', majorEn: 'majorEn', graduationMonth: 'endDate' };
  const field = issue.profileField ? fields[issue.profileField] : undefined;
  const primary = state.profile.career?.primaryEducationId;
  if (field && primary && state.profile.career?.educations.some(record => record.id === primary)) return { collection: 'educations', recordId: primary, field };
  return { field: issue.profileField };
}

export function applicationIssueCurrentValue(state: AppState, issue: ApplicationWorkflowIssue): string | undefined {
  const location = applicationIssueFactLocation(state, issue);
  const source = location.collection ? applicationIssueRecord(state, issue) : state.profile;
  const value = source && location.field ? (source as unknown as Record<string, unknown>)[location.field] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Draft keys from other targets, restored originals and dismissed rows are not unsaved changes here. */
export function applicationWorkflowDirtyIssues(state: AppState, workflow: ApplicationWorkflow, drafts: Readonly<Record<string, string>>): string[] {
  return workflow.issues.filter(issue => issue.status === 'open' && Object.hasOwn(drafts, issue.id)
    && drafts[issue.id]!.trim() !== (applicationIssueCurrentValue(state, issue) ?? '').trim()).map(issue => issue.id);
}

/** A confirmation reviews one saved record, so every pending edit to that same record must be saved first. */
export function applicationWorkflowRecordHasDraft(state: AppState, workflow: ApplicationWorkflow,
  issue: ApplicationWorkflowIssue, drafts: Readonly<Record<string, string>>): boolean {
  const location = applicationIssueFactLocation(state, issue);
  if (!location.collection || !location.recordId) return false;
  const dirty = new Set(applicationWorkflowDirtyIssues(state, workflow, drafts));
  return workflow.issues.some(other => {
    const candidate = applicationIssueFactLocation(state, other);
    return dirty.has(other.id) && candidate.collection === location.collection && candidate.recordId === location.recordId;
  });
}

const ordinaryFields = new Set(['fullName', 'fullNameEn', 'email', 'phone', 'school', 'schoolEn', 'degree', 'major', 'majorEn', 'graduationMonth']);
const editableCareerFields = new Set(['school', 'schoolEn', 'degree', 'major', 'majorEn', 'organization', 'name', 'role', 'startDate', 'endDate', 'description', 'url']);
export function applicationIssueEditable(issue: ApplicationWorkflowIssue): boolean {
  return issue.reasonCode === 'missing-profile' && Boolean(issue.profileField)
    && (issue.collection ? Boolean(issue.recordId) && editableCareerFields.has(issue.profileField!) : ordinaryFields.has(issue.profileField!));
}
/** A local draft only. Saving and confirmation still go through the existing versioned host APIs. */
export function applicationIssueFactDraft(state: AppState, issue: ApplicationWorkflowIssue, value: string): ProfileInput {
  if (!applicationIssueEditable(issue) || typeof value !== 'string' || !value.trim() || value.length > 20_000) throw new Error('请填写可核对的资料。');
  const location = applicationIssueFactLocation(state, issue);
  if (location.field === 'startDate' || location.field === 'endDate' || issue.profileField === 'graduationMonth') {
    if (!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(value.trim())) throw new Error('日期请保留已知的年、月或日精度，不补猜。');
    const text = value.trim();
    if (text.startsWith('0000') || text.length === 10 && (!Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text)) throw new Error('请输入真实日期，不补猜日期精度。');
  }
  if (issue.profileField === 'url') { const url = new URL(value.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('项目链接必须是没有账号凭据的 HTTP(S) 地址。'); }
  const { profile } = state;
  const draft: ProfileInput = { fullName: profile.fullName, fullNameEn: profile.fullNameEn, email: profile.email, phone: profile.phone,
    school: profile.school, schoolEn: profile.schoolEn, degree: profile.degree, major: profile.major, majorEn: profile.majorEn,
    graduationMonth: profile.graduationMonth, skills: [...profile.skills], cities: [...profile.cities], targetRoles: [...profile.targetRoles], resumeText: profile.resumeText,
    ...(profile.career ? { career: pickCareerInput(profile.career) } : {}) };
  if (location.collection) {
    const record = draft.career?.[location.collection].find(record => record.id === location.recordId);
    if (!record) throw new Error('对应经历已不存在，请到资料页核对。');
    (record as unknown as Record<string, unknown>)[location.field!] = value.trim();
  } else (draft as unknown as Record<string, unknown>)[issue.profileField!] = value.trim();
  return draft;
}
