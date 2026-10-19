import type { ApplicationWorkflowIssue } from '../../shared/src/application-workflow.js';
import { answerBankFieldAllowed } from '../../forms/src/answer-bank.js';
import type { ConfirmedAnswer, ConfirmedAnswerInput } from '../../shared/src/application-assets.js';

/** These states describe actual host work. In particular, completed never means submitted. */
export type CompanionStatus = 'idle' | 'reading' | 'filling' | 'retrying' | 'needs-info' | 'waiting-login' | 'completed' | 'stopped';
export interface CompanionProgress { verifiedCount?: number; totalCount?: number; pendingCount?: number; }
export const COMPANION_STATUS_LABELS: Record<CompanionStatus, string> = {
  idle: '准备好了', reading: '正在读取表单', filling: '正在填写并核对', retrying: '正在重新核对并重试',
  'needs-info': '需要你帮一下', 'waiting-login': '等你登录后继续', completed: '本轮填写结束', stopped: '已暂停填写',
};
export const COMPANION_STATUS_HINTS: Record<CompanionStatus, string> = {
  idle: '上传简历后，选岗位开始。', reading: '先确认网页上有哪些信息项。', filling: '每项填写后都会重读核对。',
  retrying: '先重读页面；正确的已有内容会保留。', 'needs-info': '补充一次，确认后下次可以复用。',
  'waiting-login': '账号和验证码由你操作，完成后再继续。', completed: '请核对网页，最终提交由你完成。',
  stopped: '保留当前网页，重新核对后才能继续。',
};
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** Never invent progress from elapsed time, animation frames or missing denominators. */
export function companionProgress(input: CompanionProgress): { verified: number | undefined; total: number | undefined; pending: number | undefined; percent: number | undefined; label: string } {
  const verified = count(input.verifiedCount), candidate = count(input.totalCount), pending = count(input.pendingCount);
  const total = candidate !== undefined && candidate > 0 && verified !== undefined && verified <= candidate ? candidate : undefined;
  const percent = total !== undefined && verified !== undefined ? Math.floor(verified / total * 100) : undefined;
  return { verified, total, pending, percent, label: verified === undefined ? '核实数量尚未返回' : total === undefined ? `已核实 ${verified} 项` : `已核实 ${verified} / ${total} 项` };
}
export interface CompanionPreferences { collapsed: boolean; muted: boolean; reducedMotion: boolean; }
export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = { collapsed: false, muted: false, reducedMotion: false };
/** Read only the three local display preferences; imported data never becomes an action. */
export function companionPreferences(value: unknown): CompanionPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COMPANION_PREFERENCES };
  const source = value as Record<string, unknown>;
  return { collapsed: source.collapsed === true, muted: source.muted === true, reducedMotion: source.reducedMotion === true };
}
export interface ApplicationIssueGuidance {
  kind: 'missing' | 'retry' | 'manual' | 'review'; badge: string; title: string; hint: string; action: 'edit' | 'resume' | 'profile' | 'manual'; actionLabel: string;
}
/** Existing facts and execution failures must never be presented as missing personal facts. */
export function applicationIssueGuidance(issue: ApplicationWorkflowIssue, hasFact: boolean, editable: boolean): ApplicationIssueGuidance {
  if (issue.reasonCode === 'missing-profile' && !hasFact) return editable
    ? { kind: 'missing', badge: '缺少资料', title: `还缺「${issue.label}」`, hint: '要加入个人资料吗？保存并确认后，今后的申请可以复用。', action: 'edit', actionLabel: '补充并记住' }
    : { kind: 'missing', badge: '需要补充', title: `需要你补充「${issue.label}」`, hint: '请到个人资料补充；自定义文字回答可以存入已确认答案。', action: 'profile', actionLabel: '去补资料 / 答案' };
  if (issue.reasonCode === 'unsupported-field') return { kind: 'manual', badge: '网页需手动', title: `请在网页处理「${issue.label}」`, hint: '这项控件暂未适配，反复重试不会补好。处理后再重新核对。', action: 'manual', actionLabel: '处理后重新核对' };
  if (hasFact || ['verification-failed', 'not-yet-filled', 'interrupted'].includes(issue.reasonCode)) return {
    kind: 'retry', badge: hasFact ? '资料已有' : '需要重核对', title: `「${issue.label}」尚未核实`,
    hint: hasFact ? '资料里已经有这一项。先重读网页，再决定续填；不会覆盖正确的已有值。' : '本轮未取得可靠结果，先重新读取网页，不能当作已完成。',
    action: 'resume', actionLabel: '重新核对并继续',
  };
  return { kind: 'review', badge: '对应待确认', title: `请核对「${issue.label}」`, hint: '需要确认网页和资料是否对应，不能凭相似名称猜测。', action: 'profile', actionLabel: '核对资料' };
}

/** Only proposes a user-authored answer draft. The host still reviews actual field type/context before reuse. */
export function applicationQuestionCanRemember(question: string): boolean {
  return question.trim().length > 1 && question.length <= 1000 && !/\[.*已隐藏\]|需要核对的填写项/u.test(question)
    && answerBankFieldAllowed({ id: '', index: 0, label: question, type: 'text', value: '', required: false, editable: true,
      options: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, signature: '' });
}
export function applicationIssueCanRemember(issue: ApplicationWorkflowIssue): boolean {
  return issue.section === 'other' && issue.scope === 'field' && !issue.profileField
    && issue.reasonCode === 'needs-review' && applicationQuestionCanRemember(issue.label);
}

/** A save response is a library snapshot. Bind a new draft by new host ID plus exact authored content/scope, never by the first same-name answer. */
export function savedApplicationAnswer(before: readonly ConfirmedAnswer[], after: readonly ConfirmedAnswer[], request: ConfirmedAnswerInput): ConfirmedAnswer | undefined {
  const beforeById = new Map(before.map(answer => [answer.id, answer]));
  if (request.id && !beforeById.has(request.id)) return undefined;
  const candidates = after.filter(answer => (request.id ? answer.id === request.id && answer.revision === beforeById.get(request.id)!.revision + 1 : !beforeById.has(answer.id) && answer.revision === 1)
    && answer.questionPattern === request.questionPattern && answer.answer === request.answer && answer.demo === request.demo
    && answer.risk === 'ordinary' && answer.confirmedRevision === null && answer.confirmedProfileVersion === null && answer.confirmedAt === null
    && (request.scope.kind === 'general' ? answer.scope.kind === 'general'
      : answer.scope.kind === 'application' && answer.scope.applicationId === request.scope.applicationId));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Only limits choices displayed to the user. Same origin is never treated as a job selection. */
export function queueCurrentPageCandidates<T extends { id: string; url: string }>(jobs: readonly T[], currentURL: string): T[] {
  let current: URL;
  try { current = new URL(currentURL); } catch { return []; }
  if (current.protocol !== 'https:' || current.username || current.password) return [];
  return jobs.filter(job => {
    try { const url = new URL(job.url); return url.protocol === 'https:' && !url.username && !url.password && url.origin === current.origin; }
    catch { return false; }
  });
}

/** Display the destination host without private path/query/application IDs. Invalid entries remain unselectable. */
export function queueJobHostname(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.hostname : undefined; }
  catch { return undefined; }
}
