import {conditionalNameReview} from './field-review.js';
import { createHash, randomUUID } from 'node:crypto';
import {resolveEducationField} from './education-fields.js';
import { withConfirmedEducation } from '../../profile/src/career-input.js';
import type {
  FieldObservation, FillItem, FillPlan, FormObservation, Profile, ProfileInput,
} from '../../shared/src/contracts.js';

const aliases: Array<[keyof ProfileInput, string[]]> = [
  ['fullName', ['姓名', '真实姓名', '中文姓名', '申请人姓名', '称呼', '如何称呼您', '怎么称呼你', '候选人姓名', 'name', 'fullname', 'candidatename', 'applicantname']],
  ['fullNameEn', ['英文姓名', 'nameinenglish', 'englishname']],
  ['email', ['邮箱', '电子邮箱', '电子邮件', '邮箱地址', '接收通知的邮件地址', '通知邮箱', '联系邮箱', '联系邮件地址', '电邮', 'contactemail', 'emailfornotifications', 'email', 'emailaddress', 'email地址']],
  ['phone', ['手机', '手机号', '手机号码', '联系电话', '电话号码', '便于联系您的号码', '联系号码', '联系电话号码', '联系手机', 'contactnumber', 'contactphone', '电话', 'phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'tel']],
  ['school', ['学校', '院校', '毕业院校', '学校名称', '就读院校', 'school', 'university', 'college', 'institution', 'schoolname']],
  ['degree', ['学历', '最高学历', '学位', '最高学位', 'degree', 'educationlevel', 'highestdegree', 'qualification']],
  ['major', ['专业', '专业名称', '所学专业', 'major', 'fieldofstudy']],
  ['graduationMonth', ['毕业时间', '预计毕业时间', '毕业年月', '预计毕业年月', 'graduationdate', 'graduationmonth', 'expectedgraduationdate', 'expectedgraduation']],
];

const otherPerson = /紧急联系|推荐人|联系人(?:姓名|电话|手机|邮箱|邮件|电邮)|亲属|配偶|父亲|母亲|家长|监护|证明人|emergency|referee|reference|recommender|guardian|spouse|parent|supervisor/i;
const sensitive = /密码|验证码|身份证|证件号码|护照|银行卡|银行账号|出生|生日|性别|民族|婚姻|宗教|健康|残疾|password|passcode|verification|captcha|passport|national.?id|social.?security|bank|birth|gender|ethnicity|disability|religion/i;
const declaration = /同意|声明|承诺|隐私|协议|授权|条款|consent|declaration|agreement|privacy|terms|accept|authorization/i;
const placeholder = /^(?:请选择|请选|选择|select|choose|please select|please choose|[-—\s]+$)/i;
const supportedTextTypes = new Set(['text', 'email', 'tel', 'search', 'textarea', 'month', 'date']);

export function normalizeFieldLabel(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s_*✱∗:：()（）\[\]【】.\-\/]/g, '').trim();
}

export function fieldSignature(field: Pick<FieldObservation, 'index' | 'label' | 'type' | 'editable' | 'required' | 'options' | 'section' | 'customSelect' | 'checked'>): string {
  return createHash('sha256').update(JSON.stringify({
    index: field.index, label: field.label, type: field.type, editable: field.editable,
    required: field.required, options: field.options, section: field.section ?? '',
    ...(field.customSelect ? { customSelect: field.customSelect } : {}),
    ...(field.checked !== undefined ? { checked: field.checked } : {}),
  })).digest('hex');
}

export function pageSignature(fields: FieldObservation[]): string {
  return createHash('sha256').update(JSON.stringify(fields.map(field => [field.id, field.signature]))).digest('hex');
}

export function hasExistingValue(field: FieldObservation): boolean {
  if (field.value.trim() === '') return false;
  if (field.type === 'select') {
    const selected = field.options.find(option => option.value === field.value);
    if (selected && placeholder.test(selected.label.trim())) return false;
  }
  return true;
}

export function matchProfileKey(field: FieldObservation): keyof ProfileInput | undefined {
  const label = normalizeFieldLabel(field.label).replace(/^(?:(?:请填写|请输入|请提供)|您的|你的|本人)+/,'');
  for (const [key, labels] of aliases) {
    if (labels.some(alias => normalizeFieldLabel(alias) === label)) return key;
  }
  return undefined;
}

const degreeGroups = [
  ['本科', '学士', 'bachelor', 'bachelors', "bachelor's", "bachelor's degree", 'bachelordegree'],
  ['硕士', 'master', 'masters', "master's", "master's degree", 'masterdegree'],
  ['博士', 'phd', 'ph.d.', 'doctorate', 'doctoral'],
  ['专科', '大专', 'associate', 'associate degree'],
];

function equivalentOptionLabels(value: string, key?: keyof ProfileInput): string[] {
  const normalized = normalizeFieldLabel(value);
  if (key !== 'degree') return [normalized];
  const group = degreeGroups.find(terms => terms.some(term => normalizeFieldLabel(term) === normalized));
  return group ? group.map(normalizeFieldLabel) : [normalized];
}

export function matchSelectOption(
  value: string, options: FieldObservation['options'], key?: keyof ProfileInput,
): { label: string; value: string } | undefined {
  const equivalents = equivalentOptionLabels(value, key);
  const matching = options.filter(option => option.value !== '' && !placeholder.test(option.label.trim())
    && (equivalents.includes(normalizeFieldLabel(option.label)) || normalizeFieldLabel(option.value) === normalizeFieldLabel(value)));
  return matching.length === 1 ? matching[0] : undefined;
}

function profileValue(profile: Profile, key: keyof ProfileInput, field: FieldObservation): { key: keyof ProfileInput; value: string } {
  const englishLabel = /[a-z]/i.test(field.label) && !/[\u3400-\u9fff]/u.test(field.label);
  let chosen = key;
  if (englishLabel && key === 'fullName' && profile.fullNameEn.trim()) chosen = 'fullNameEn';
  if (englishLabel && key === 'school' && profile.schoolEn.trim()) chosen = 'schoolEn';
  if (englishLabel && key === 'major' && profile.majorEn.trim()) chosen = 'majorEn';
  const value = profile[chosen];
  return { key: chosen, value: typeof value === 'string' ? value.trim() : '' };
}

export function matchFields(observation: FormObservation, profile: Profile, mappings?: ReadonlyMap<string, keyof ProfileInput>): FillItem[] {
  profile = withConfirmedEducation(profile);
  const multiEducation = (profile.career?.educations.filter(item => item.confirmation === 'confirmed'
    && item.confirmedRevision === item.revision && !!item.confirmedAt).length ?? 0) > 1;
  const educationKeys = new Set<keyof ProfileInput>(['school', 'schoolEn', 'major', 'majorEn', 'degree', 'graduationMonth']);
  return observation.fields.map(field => {
    const base = { fieldId: field.id, label: field.label, value: '', currentValue: field.value,
      ...(field.type === 'select' && field.value.trim() !== '' && !hasExistingValue(field) ? { currentValueIsPlaceholder: true } : {}) };
    const context = `${field.label} ${field.section ?? ''}`;
    if (otherPerson.test(context)) return { ...base, status: 'skip', reason: '这是其他联系人或证明人的字段，保留人工处理。' };
    if (sensitive.test(context) || field.type === 'password') return { ...base, status: 'skip', reason: '敏感资料或验证码由你手动填写。' };
    if (declaration.test(context) || ['checkbox', 'radio', 'file', 'submit', 'button', 'hidden'].includes(field.type)) {
      return { ...base, status: 'skip', reason: '声明、上传和按钮不自动操作。' };
    }
    if (!field.editable) return { ...base, status: 'skip', reason: '字段不可编辑。' };
    if (hasExistingValue(field)) return { ...base, status: 'skip', reason: '已有值，保留网页当前内容。' };
    if (field.type === 'combobox' && !field.customSelect) return { ...base, status: 'review', reason: '该自定义下拉缺少可核实的单选关联或已选值读取方式，请手动选择。' };
    // A nearby section title may also surround a widget's internal search or
    // helper input. It cannot identify an otherwise unlabeled editable field.
    if (!field.label.trim()) return { ...base, status: 'review', reason: '字段缺少明确标签，不能仅根据所属段落推测用途，请手动核对。' };
    if (/^(?:姓|名)$|姓名拼音|姓名拼写|first.?name|last.?name|given.?name|surname|family.?name/i.test(field.label)) {
      return { ...base, status: 'review', reason: '需要拆分或改写姓名，现有资料没有独立确认值。' };
    }
    const conditionalName=conditionalNameReview(field);
    if(conditionalName)return {...base,status:'review',reason:conditionalName};
    // A model can name a controlled key for an unfamiliar label. It cannot
    // replace a known deterministic mapping or supply the personal value.
    const key = matchProfileKey(field) ?? mappings?.get(field.id);
    const scoped=resolveEducationField(field,profile,key);
    if(scoped.handled&&!scoped.value)return {...base,status:'review',reason:scoped.reason??'教育经历待确认。'};
    if(!scoped.handled&&key&&educationKeys.has(key)&&/实习|工作经历|项目经历|任职|internship|employment|project|work experience/i.test(context))return {...base,status:'review',reason:'此项属于其他经历，不使用默认教育资料猜填。'};
    if(field.type==='month'&&!scoped.handled&&!/毕业|学业|graduat|educat|academic|study/i.test(context))return {...base,status:'review',reason:'月份用途尚未明确为教育时间，不能用毕业月份代替。'};
    if (!key&&!scoped.handled) return { ...base, status: 'review', reason: '没有明确的个人资料字段对应关系。' };
    const recordScopedEducation = /本科|学士|硕士|博士|专科|大专|bachelor|master|ph\.?d|doctorate|第\s*[一二三四五六七八九十\d]+\s*(?:段|条|个)|(?:教育|education)\s*(?:经历)?\s*[一二三四五六七八九十\d]+/i.test(field.section ?? '');
    if (!scoped.handled && profile.career && key && educationKeys.has(key) && recordScopedEducation) {
      return { ...base, status: 'review', reason: '该字段属于特定教育记录，需逐组对应；此版不将默认教育自动当作该段经历。', profileKey: key };
    }
    if (!scoped.handled && !/默认教育|最高学历|最高教育|primary education|highest education/i.test(field.section??'') && multiEducation && key && educationKeys.has(key) && observation.fields.filter(other => {const otherKey=matchProfileKey(other)??mappings?.get(other.id);return otherKey===key&&!(other.type==='date'&&key==='graduationMonth')&&!resolveEducationField(other,profile,otherKey).handled;}).length > 1) {
      return { ...base, status: 'review', reason: '有多段已确认教育，重复字段需要逐组对应；此版不把默认教育写入所有经历。', profileKey: key };
    }
    if (!['select', 'combobox'].includes(field.type) && !supportedTextTypes.has(field.type)) return { ...base, status: 'review', reason: '该控件需要人工确认。' };
    const selected = scoped.handled?{key:scoped.key,value:scoped.value??''}:profileValue(profile,key!,field);
    if (!selected.value) return { ...base, status: 'review', reason: '个人资料中没有已确认值。', profileKey: selected.key };
    if (selected.key === 'graduationMonth' && field.type === 'date') {
      return { ...base, status: 'review', reason: '资料只有毕业月份，不能推测具体日期。', profileKey: selected.key };
    }
    if (field.type === 'date' || field.type==='month'&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(selected.value)) {
      return { ...base, status: 'review', reason: '这是原生分段日期控件，此版尚未验证其区域格式，请手动填写；不会补出未知日期。', profileKey: selected.key };
    }
    if (field.type === 'combobox') {
      if(field.customSelect?.kind==='local-single-select'&&!matchSelectOption(selected.value,field.options,selected.key))return {...base,status:'review',reason:'本地候选菜单没有唯一匹配的真实选项，请核对网页；不会把资料当作新选项输入。',profileKey:selected.key};
      return { ...base, value: selected.value, status: 'ready', reason: '将展开此单选菜单，只选择与已确认资料唯一匹配的真实选项；选择后重新读取网页核实。', profileKey: selected.key };
    }
    if (field.type === 'select') {
      const option = matchSelectOption(selected.value, field.options, selected.key);
      if (!option) return { ...base, status: 'review', reason: '没有唯一匹配的真实下拉选项，不能猜选项。', profileKey: selected.key };
      return { ...base, value: option.value, status: 'ready', reason: `匹配页面真实选项“${option.label}”；执行后仍需验证。`, profileKey: selected.key };
    }
    return { ...base, value: selected.value, status: 'ready', reason: scoped.reason??'来自你保存的个人资料，执行后重新读取网页验证。', profileKey: selected.key };
  });
}

export function buildFillPlan(observation: FormObservation, profile: Profile, mappings?: ReadonlyMap<string, keyof ProfileInput>): FillPlan {
  return {
    id: randomUUID(), url: observation.url, title: observation.title,
    profileVersion: profile.version, observationId: observation.id,
    createdAt: new Date().toISOString(), items: matchFields(observation, profile, mappings),
  };
}

/** Validate against the private original observation before any native action. */
export function validateApprovedFields(
  plan: FillPlan, original: FormObservation, current: FormObservation,
  profileVersion: number, fieldIds: string[],
): Array<{ item: FillItem; field: FieldObservation }> {
  if (plan.observationId !== original.id) throw new Error('填写预览与原始观察不一致，请重新生成。');
  if (plan.profileVersion !== profileVersion) throw new Error('个人资料已更新，请重新生成填写预览。');
  if (plan.url !== current.url || original.url !== current.url) throw new Error('网页地址已变化，请重新观察并生成预览。');
  if (original.signature !== current.signature) throw new Error('网页字段已变化，请重新生成填写预览。');
  if (fieldIds.length === 0 || new Set(fieldIds).size !== fieldIds.length) throw new Error('请选择不重复的待填写字段。');
  return fieldIds.map(fieldId => {
    const item = plan.items.find(candidate => candidate.fieldId === fieldId);
    const previous = original.fields.find(candidate => candidate.id === fieldId);
    const field = current.fields.find(candidate => candidate.id === fieldId);
    if (!item || item.status !== 'ready' || !previous || !field) throw new Error('批准内容包含无法自动填写的字段。');
    if (previous.signature !== field.signature || previous.value !== field.value || !field.editable || hasExistingValue(field)) {
      throw new Error('字段已由网页或你修改，请重新生成填写预览。');
    }
    return { item, field };
  });
}

export function isVerifiedValue(actual: string, expected: string, type: string): boolean {
  return type === 'select' ? actual === expected : actual.trim() === expected.trim();
}
