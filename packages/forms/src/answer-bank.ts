import type { FillPlan, FormObservation } from '../../shared/src/contracts.js';
import type { AnswerSuggestion } from '../../shared/src/application-assets.js';

export interface PreparedAnswerBinding {
  fieldId: string; answerId: string; revision: number; profileVersion: number; value: string;
}

// Reusable prose may fill ordinary text questions only. A caller cannot turn a
// bank entry marked ordinary into authorization for identity, consent or law.
const excludedContext = /密码|验证码|证件|身份证|护照|银行卡|出生|生日|性别|民族|婚姻|宗教|健康|残疾|薪资|薪酬|工资|期望收入|工作许可|签证|担保|犯罪|背调|竞业|同意|声明|承诺|隐私|协议|授权|条款|紧急联系|推荐人|证明人|利益冲突|亲属|家属|他人|法律|政治|党派|国籍|雇佣资格|保密|背景调查|财务|真实性|password|passcode|captcha|verification|passport|national.?id|social.?security|bank|birth|gender|ethnicity|disability|religion|salary|compensation|sponsorship|visa|work.?authori[sz]|criminal|background.?check|non.?compete|consent|declaration|agreement|privacy|terms|accept|emergency|referee|recommender|conflicts?[\s-]*of[\s-]*interest|relatives?|family|third.?party|legal|politic|citizenship|nationality|financial|guarantee|debt/i;

export function answerBankFieldAllowed(field: FormObservation['fields'][number]): boolean {
  return field.editable && ['text', 'textarea'].includes(field.type) && !field.value.trim()
    && !!field.label.trim() && !excludedContext.test(`${field.label} ${field.section ?? ''}`);
}

/** Host-only local enrichment; neither answers nor their values enter a model request. */
export function enrichWithConfirmedAnswers(plan: FillPlan, observation: FormObservation,
  suggestions: ReadonlyMap<string, AnswerSuggestion[]>): { plan: FillPlan; bindings: PreparedAnswerBinding[] } {
  const bindings: PreparedAnswerBinding[] = [];
  if (plan.url !== observation.url || plan.observationId !== observation.id) throw new Error('答案与当前网页观察不一致。');
  const items = plan.items.map(item => {
    const field = observation.fields.find(candidate => candidate.id === item.fieldId);
    if (item.status !== 'review' || item.profileKey || !field || !answerBankFieldAllowed(field)) return item;
    const choices = (suggestions.get(item.fieldId) ?? []).filter(choice => choice.automaticEligible
      && choice.answer.risk === 'ordinary' && choice.answer.confirmedRevision === choice.answer.revision
      && choice.answer.confirmedProfileVersion === plan.profileVersion && !!choice.answer.confirmedAt);
    if (choices.length !== 1 || !choices[0]!.answer.answer.trim()) return item;
    const answer = choices[0]!.answer, value = answer.answer.trim();
    bindings.push({ fieldId: item.fieldId, answerId: answer.id, revision: answer.revision, profileVersion: plan.profileVersion, value });
    return { ...item, status: 'ready' as const, value, reason: '来自你已确认的本申请适用答案；仅精确匹配此问题，填写后重新读取核实。' };
  });
  return { plan: { ...plan, items }, bindings };
}

export function assertPreparedAnswersCurrent(bindings: PreparedAnswerBinding[], answers: AnswerSuggestion['answer'][]): void {
  for (const binding of bindings) {
    const answer = answers.find(candidate => candidate.id === binding.answerId);
    if (!answer || answer.revision !== binding.revision || answer.confirmedRevision !== binding.revision
      || answer.confirmedProfileVersion !== binding.profileVersion || !answer.confirmedAt
      || answer.risk !== 'ordinary' || answer.answer.trim() !== binding.value) throw new Error('已确认答案发生变化，请重新识别后填写。');
  }
}
