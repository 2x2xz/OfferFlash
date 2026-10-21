import type { AppState, FillPlan, FillResult, Job, Profile } from '../../shared/src/contracts.js';
import { isJobDeadlineExpired, matchJob } from '../../domain/src/matching.js';

/** Recompute from today's saved profile; no stored match or application is rewritten. */
export function deriveApplyFlow(state: Pick<AppState, 'profile' | 'jobs'>, now = new Date()) {
  const { profile } = state;
  const records = profile.career ? [...profile.career.educations, ...profile.career.internships, ...profile.career.projects, ...profile.career.publications] : [];
  const confirmed = records.filter(item => item.confirmation === 'confirmed' && item.confirmedRevision === item.revision);
  const pendingCount = records.length - confirmed.length;
  const hasSavedProfile = profile.version > 0 && !!(profile.fullName || profile.skills.length || profile.targetRoles.length || confirmed.length);
  const awaitingAllConfirmation = records.length > 0 && confirmed.length === 0;
  const jobs = state.jobs.filter(job => !job.demo);
  const ranked: Job[] = hasSavedProfile && !awaitingAllConfirmation ? jobs.map(job => ({ ...job, match: matchJob(profile, job, now) }))
    .filter(job => job.match.eligible !== 'unsuitable' && !isJobDeadlineExpired(job.deadline, now))
    .sort((a, b) => Number(a.match.eligible === 'review') - Number(b.match.eligible === 'review') || b.match.score - a.match.score || a.id.localeCompare(b.id)) : [];
  return { hasSavedProfile, pendingCount, confirmedCount: confirmed.length, awaitingAllConfirmation, libraryCount: jobs.length,
    recommended: ranked, profileReady: hasSavedProfile && !awaitingAllConfirmation };
}

export interface QuickFillContext { url: string; profileVersion: Profile['version']; }

/** A skipped sensitive/upload/consent field still needs a person, not a success label. */
export function summarizeApplicationFill(plan: FillPlan, result?: FillResult) {
  const currentResult = result?.planId === plan.id ? result : undefined;
  const verifiedIds = new Set(currentResult?.verified.map(item => item.fieldId) ?? []);
  const unresolved = new Map(currentResult?.unresolved.map(item => [item.fieldId, item.reason]) ?? []);
  const filled: Array<{ fieldId: string; label: string; reason: string }> = [];
  const needsUser: typeof filled = [];
  const preserved: typeof filled = [];
  for (const item of plan.items) {
    const row = { fieldId: item.fieldId, label: item.label, reason: unresolved.get(item.fieldId) ?? item.reason };
    if (verifiedIds.has(item.fieldId)) filled.push({ ...row, reason: '已重新读取网页并核实填写值。' });
    else if (unresolved.has(item.fieldId)) needsUser.push(row);
    else if (item.currentValue.trim() && !item.currentValueIsPlaceholder
      && (item.status === 'ready' || item.status === 'skip' && /已有值|已有内容|保留已有|保留网页当前内容/.test(item.reason))) preserved.push(row);
    else needsUser.push(item.status === 'ready'
      ? { ...row, reason: `本次尚未核实填写。${item.reason}` } : row);
  }
  return { filled, needsUser, preserved };
}

/** Execution outcome only; never equates a finished model request with a completed application. */
export function quickFillOutcome(plan:FillPlan,result?:FillResult):{status:'completed'|'partial'|'failed';message:string}{
  const summary=summarizeApplicationFill(plan,result);
  if(!result){
    const unknown=plan.items.filter(item=>/^(?:请输入.*|请选择.*|未识别.*|未命名.*)?$/.test(item.label.trim())).length;
    return {status:'partial',message:`本次没有写入。识别到 ${plan.items.length} 项${unknown?`，其中 ${unknown} 项没读到明确字段名`:''}；保留已有 ${summary.preserved.length} 项，${summary.needsUser.length} 项需要核对。已展开具体原因。`};
  }
  if(!summary.filled.length)return{status:'failed',message:`本次没有核实成功的写入，${summary.needsUser.length} 项仍待检查。请查看详细原因，不要连续重复点击。`};
  return{status:summary.needsUser.length?'partial':'completed',message:`已核实填写 ${summary.filled.length} 项${summary.needsUser.length?`，${summary.needsUser.length} 项仍需处理`:''}。仅覆盖本次字段，不代表整份申请完成。`};
}

export class QuickFillInterrupted extends Error {
  constructor() { super('页面、资料或当前操作已变化，本次自动填写已停止；请回到目标表单后重新点击。'); }
}

/** The UI click authorizes one newly prepared plan, never a cached or later plan. */
export async function runQuickFill(options: {
  context: QuickFillContext;
  isCurrent: () => boolean;
  prepare: () => Promise<FillPlan>;
  fill: (planId: string, fieldIds: string[]) => Promise<FillResult>;
  onPreview: (plan: FillPlan) => void;
  onFilling: (plan: FillPlan) => void;
}): Promise<{ plan: FillPlan; result?: FillResult; filled: boolean }> {
  const plan = await options.prepare();
  const current = () => options.isCurrent() && plan.url === options.context.url && plan.profileVersion === options.context.profileVersion;
  if (!current()) throw new QuickFillInterrupted();
  options.onPreview(plan);
  if (plan.recognition?.mode === 'fallback') throw new Error(plan.recognition.message || '模型识别未完成；请核对后使用逐项预览，本次不会继续自动填写。');
  // A contradictory ready item with an existing value is still preserved.
  const readyIds = [...new Set(plan.items.filter(item => item.status === 'ready' && (!item.currentValue.trim() || item.currentValueIsPlaceholder === true) && !!item.value.trim()).map(item => item.fieldId))];
  if (!readyIds.length) return { plan, filled: false };
  if (!current()) throw new QuickFillInterrupted();
  options.onFilling(plan);
  if (!current()) throw new QuickFillInterrupted();
  const result = await options.fill(plan.id, readyIds);
  if (result.planId !== plan.id) throw new Error('填写结果与本次计划不一致，请在网页中核对；不会自动重试。');
  return { plan, result, filled: true };
}
