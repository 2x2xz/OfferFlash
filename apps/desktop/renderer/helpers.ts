import type { ApplicationStatus, ProfileInput, RecruitmentType } from '../../../packages/shared/src/contracts.js';

export const statusLabels: Record<ApplicationStatus, string> = {
  'needs-review': '待核对',
  saved: '待投递', applied: '已投递', assessment: '笔试 / 测评', interview: '面试中', offer: '收到 Offer', rejected: '已结束', withdrawn: '已撤回',
};
export const applicationStatuses: ApplicationStatus[] = ['needs-review', 'saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'];
export const recruitmentLabels: Record<RecruitmentType, string> = { campus: '校园招聘', internship: '实习', experienced: '社会招聘', unknown: '类型待确认' };
export function dateLabel(value?: string | null, withTime = false): string {
  if (!value) return '未提供';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}
export function inputDate(value?: string | null): string { return value?.slice(0, 10) ?? ''; }
export function parseList(value: string): string[] { return [...new Set(value.split(/[,，;；\n]+/).map(item => item.trim()).filter(Boolean))]; }
export function errorText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
export function profileFields(profile: ProfileInput): Array<{ name: string; complete: boolean }> {
  return [
    { name: '姓名', complete: !!profile.fullName }, { name: '邮箱', complete: !!profile.email }, { name: '手机号', complete: !!profile.phone },
    { name: '学校', complete: !!profile.school }, { name: '学历', complete: !!profile.degree }, { name: '专业', complete: !!profile.major },
    { name: '毕业月份', complete: !!profile.graduationMonth }, { name: '技能', complete: profile.skills.length > 0 },
    { name: '期望城市', complete: profile.cities.length > 0 }, { name: '岗位方向', complete: profile.targetRoles.length > 0 },
  ];
}
export function companyInitial(company: string): string { return company.trim().slice(0, 1) || '职'; }
