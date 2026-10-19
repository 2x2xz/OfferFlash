import type { AppState } from '../../shared/src/contracts.js';
import type { CareerFillPending, CareerFillCollection } from '../../shared/src/career-form.js';
import { applicationIssueCurrentValue, APPLICATION_SECTION_LABELS, type ApplicationWorkflowIssue } from '../../shared/src/application-workflow.js';

export interface AttentionPresentation {
  displayTitle: string; fieldLabel: string; recordTitle: string;
  category: 'missing' | 'retry' | 'manual'; hint: string; locatable: boolean; locateHint: string;
}
export interface ApplicationAttentionItem extends AttentionPresentation { issue: ApplicationWorkflowIssue; }
export interface CareerAttentionItem extends AttentionPresentation { pending: CareerFillPending; }
export interface AttentionGroups<T> { required: T[]; optional: T[]; notices: T[]; historical: T[]; count: number; }
type ProfileState = Pick<AppState, 'profile'>;
const fieldLabels: Record<string, string> = { fullName: '姓名', fullNameEn: '英文姓名', email: '邮箱', phone: '手机号',
  school: '学校', schoolEn: '英文学校', degree: '学历', major: '专业', majorEn: '英文专业', graduationMonth: '毕业年月',
  organization: '实习单位', name: '项目名称', startDate: '开始时间', endDate: '结束时间', description: '经历说明', url: 'GitHub / 作品链接' };
const typeLabels: Record<string, string> = { text: '文字输入框', textarea: '多行输入框', select: '下拉框', combobox: '下拉框', radio: '单选题', checkbox: '勾选项', 'feishu-month': '年月控件', date: '日期控件', month: '月份控件', file: '附件栏' };
const clean = (value: string | undefined) => (value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 160);
const usableLabel = (label: string | undefined) => Boolean(clean(label) && !/^(?:unknown|undefined|null|需要核对的填写项|未命名(?:输入框|字段|控件)?|无标签)$/iu.test(clean(label)));
function recordTitle(state: ProfileState, collection: CareerFillCollection | undefined, recordId: string | undefined): string {
  if (!collection) return '';
  const records = state.profile.career?.[collection].filter(record => record.id === recordId) ?? [];
  const record = records.length === 1 ? records[0] : undefined;
  if (record && 'school' in record) return clean(record.school) || '未命名教育经历';
  if (record && 'organization' in record) return clean(record.organization) || '未命名实习经历';
  if (record && 'name' in record) return clean(record.name) || '未命名项目经历';
  return APPLICATION_SECTION_LABELS[collection];
}
function presentation(state: ProfileState, input: { section: keyof typeof APPLICATION_SECTION_LABELS; scope: 'field' | 'section' | 'application';
  collection?: CareerFillCollection; recordId?: string; key?: string; label?: string; type?: string; fieldId?: string; groupId?: string;
  reasonCode?: string; hasFact: boolean }): AttentionPresentation {
  const title = recordTitle(state, input.collection, input.recordId) || APPLICATION_SECTION_LABELS[input.section];
  const knownLabel = input.key === 'role' ? input.collection === 'internships' ? '实习职位' : '项目角色' : input.key ? fieldLabels[input.key] : undefined;
  const fieldLabel = input.scope !== 'field' ? input.scope === 'application' ? '本次填写已暂停' : '经历与网页对应关系'
    : knownLabel || (usableLabel(input.label) ? clean(input.label) : `未识别标题的${typeLabels[input.type ?? ''] ?? '网页填写项'}`);
  const locatable = input.scope === 'field' && Boolean(input.fieldId || input.collection && input.recordId && input.key || usableLabel(input.label) && input.type);
  const locateHint = input.scope !== 'field' ? '这是区块提示，不是某一个输入框。'
    : locatable ? '重新读取当前网页，唯一找到对应字段后滚动定位。' : '网页没有提供明确题目或字段身份，先重新读取页面；不会按序号猜位置。';
  let category: AttentionPresentation['category'] = 'manual'; let hint: string;
  if (input.scope !== 'field') hint = input.scope === 'application' ? '执行中断后的提醒，不计为一个待填字段。重新读取后继续。' : '先确认这条经历对应哪个网页区块；这条提示不计入待填字段数。';
  else if (input.reasonCode === 'missing-profile' && !input.hasFact) { category = 'missing'; hint = '个人资料还没有这一项。补充并确认后，下次遇到同类字段可以复用。'; }
  else if (input.reasonCode === 'unsupported-field') hint = '这项网页控件暂未适配。点“定位”到原网页处理，再重新核对。';
  else if (input.hasFact || ['not-yet-filled', 'verification-failed', 'interrupted'].includes(input.reasonCode ?? '')) {
    category = 'retry'; hint = input.hasFact ? '资料已有，先重新读取网页再续填；保留正确的已有内容。' : '这项尚未取得可靠核实结果。先重新读取网页，再决定是否续填。';
  } else hint = usableLabel(input.label) || knownLabel ? '需要你在网页核对这项内容；不会猜测个人事实或自动勾选声明。' : '页面未提供清楚的题目，暂时无法说明该填什么；重新读取后仍不明确时请在网页核对。';
  return { displayTitle: `${title} · ${fieldLabel}`, fieldLabel, recordTitle: title, category, hint, locatable, locateHint };
}
function groupAttention<T>(items: T[], identity: (item: T) => string, details: (item: T) => { scope: 'field' | 'section' | 'application'; required: boolean | null; specificity: number }): AttentionGroups<T> {
  const unique = new Map<string, T>();
  for (const item of items) { const key = identity(item), prior = unique.get(key); if (!prior || details(item).specificity > details(prior).specificity) unique.set(key, item); }
  const required: T[] = [], optional: T[] = [], notices: T[] = [];
  for (const item of unique.values()) { const info = details(item); if (info.scope !== 'field') notices.push(item); else if (info.required === false) optional.push(item); else required.push(item); }
  return { required, optional, notices, historical: [], count: required.length };
}
/** A view of open issues only. Does not resolve, dismiss, edit, or grant write permission. */
export function applicationAttention(state: ProfileState, issues: readonly ApplicationWorkflowIssue[]): AttentionGroups<ApplicationAttentionItem> {
  const items = issues.filter(issue => issue.status === 'open').map(issue => ({ issue, ...presentation(state, { section: issue.section, scope: issue.scope,
    collection: issue.collection, recordId: issue.recordId, key: issue.profileField, label: issue.label, type: issue.fieldType,
    fieldId: issue.fieldId, groupId: issue.groupId, reasonCode: issue.reasonCode,
    hasFact: Boolean(applicationIssueCurrentValue(state as AppState, issue)?.trim()) }),
    ...(issue.attentionState === 'not-reobserved' ? { hint: '旧提示待重读：本次尚未观察到这项，或没有选择这条经历。保留历史，不能认定网页已完成。' } : {}) }));
  const grouped = groupAttention(items, ({ issue }) => JSON.stringify(issue.collection && issue.recordId && issue.profileField
    ? ['career', issue.collection, issue.recordId, issue.profileField] : issue.scope !== 'field' ? [issue.scope, issue.collection ?? issue.section, issue.recordId ?? null, issue.reasonCode]
      : ['ordinary', issue.fieldId ?? issue.id]), ({ issue }) => ({ scope: issue.attentionState === 'not-reobserved' ? 'section' : issue.scope, required: issue.required,
        specificity: Number(issue.attentionState !== 'not-reobserved') * 10 + Number(Boolean(issue.fieldId)) + Number(Boolean(issue.groupId)) + Number(Boolean(issue.fieldSignature)) }));
  return { ...grouped, notices: grouped.notices.filter(item => item.issue.attentionState !== 'not-reobserved'), historical: grouped.notices.filter(item => item.issue.attentionState === 'not-reobserved') };
}
/** The live runner and the durable task list share the same field/optional/notice counting. */
export function careerPendingAttention(state: ProfileState, pending: readonly CareerFillPending[]): AttentionGroups<CareerAttentionItem> {
  const items = pending.map(item => {
    const record = state.profile.career?.[item.collection].find(record => record.id === item.recordId);
    const source = record && item.key ? (record as unknown as Record<string, unknown>)[item.key] : undefined;
    return { pending: item, ...presentation(state, { section: item.collection, scope: item.scope ?? (item.fieldId || item.key ? 'field' : 'section'),
      collection: item.collection, recordId: item.recordId, key: item.key, label: item.label, type: item.type, fieldId: item.fieldId, groupId: item.groupId,
      reasonCode: item.reasonCode, hasFact: typeof source === 'string' && !!source.trim() }) };
  });
  return groupAttention(items, ({ pending: item }) => JSON.stringify(item.key && item.recordId ? ['field', item.collection, item.recordId, item.key]
    : item.fieldId ? ['field', item.collection, item.fieldId] : ['section', item.collection, item.recordId ?? null, item.reasonCode ?? 'unbound-record']),
  ({ pending: item }) => ({ scope: item.scope ?? (item.fieldId || item.key ? 'field' : 'section'), required: item.required,
    specificity: Number(Boolean(item.fieldId)) + Number(Boolean(item.groupId)) }));
}
