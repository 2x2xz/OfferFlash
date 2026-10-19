import { createHash, randomUUID } from 'node:crypto';
import type { EducationRecord, InternshipRecord, Profile, ProjectRecord } from '../../shared/src/contracts.js';
import { matchSelectOption } from './index.js';

export type CareerFormCollection = 'educations' | 'internships' | 'projects';
export type CareerFieldKey = 'school' | 'degree' | 'major' | 'organization' | 'role' | 'name' | 'startDate' | 'endDate' | 'description' | 'url';
export type CareerDatePrecision = 'year' | 'month' | 'day';
export interface CareerFieldObservation {
  id: string; key: CareerFieldKey; signature: string; type: string; value: string; editable: boolean;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  /** Set only by a reviewed site adapter for text date entry; never inferred from its label. */
  datePrecision?: CareerDatePrecision | 'source';
  /** The browser still has to verify its combobox relationship and real popup options. */
  customSelectSupported?: boolean;
  /** Only a reviewed host adapter may prove this end-month control has a selectable 至今 action. */
  supportsUntilNow?: boolean;
}
export interface CareerPageGroup {
  id: string; collection: CareerFormCollection; signature: string; fields: CareerFieldObservation[];
}
export interface CareerAddControl {
  id: string; collection: CareerFormCollection; signature: string; enabled: boolean;
}
export interface CareerFormObservation {
  id: string; url: string; generation: number; signature: string;
  groups: CareerPageGroup[]; addControls: CareerAddControl[];
  /** Optional full-page non-career controls, projected read-only by the host. */
  protectedFields?: Array<{ id: string; signature: string; value: string; checked?: boolean }>;
}
export interface CareerGroupBinding {
  collection: CareerFormCollection; recordId: string; revision: number; profileVersion: number;
  groupId: string; groupSignature: string;
}
export interface CareerPlannedField {
  fieldId: string; key: CareerFieldKey; value: string; currentValue: string;
  status: 'ready' | 'skip' | 'review'; reason: string;
}
export interface CareerFillGroupStep { kind: 'fill-group'; binding: CareerGroupBinding; items: CareerPlannedField[]; }
export interface CareerAddGroupStep {
  kind: 'add-then-reobserve'; collection: CareerFormCollection; recordId: string; revision: number;
  profileVersion: number; controlId: string; controlSignature: string;
}
export type CareerPlanStep = CareerFillGroupStep | CareerAddGroupStep;
export interface CareerPlanIssue { collection: CareerFormCollection; recordId?: string; reason: string; }
export interface CareerPlanOptions {
  bindings?: readonly CareerGroupBinding[];
  /** Explicit user choice to leave these observed groups untouched; never inferred by the model. */
  preserveGroupIds?: readonly string[];
  /** User-approved record order. Omitting this never guesses between multiple candidates for an existing empty group. */
  selectedRecordIds?: Partial<Record<CareerFormCollection, readonly string[]>>;
}
export interface CareerFillPlan {
  id: string; profileVersion: number; url: string; generation: number; observationId: string;
  observationSignature: string; bindings: CareerGroupBinding[]; steps: CareerPlanStep[]; issues: CareerPlanIssue[];
  /** Private host snapshot, not model context or an instruction supplied by the page. */
  original: CareerFormObservation; options: CareerPlanOptions;
}

const collections: readonly CareerFormCollection[] = ['educations', 'internships', 'projects'];
const keys: Record<CareerFormCollection, readonly CareerFieldKey[]> = {
  educations: ['school', 'degree', 'major', 'startDate', 'endDate', 'description'],
  internships: ['organization', 'role', 'startDate', 'endDate', 'description'],
  projects: ['name', 'role', 'startDate', 'endDate', 'description', 'url'],
};
type CareerRecord = EducationRecord | InternshipRecord | ProjectRecord;
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const confirmed = (record: CareerRecord) => record.confirmation === 'confirmed'
  && Number.isInteger(record.revision) && record.revision > 0
  && record.confirmedRevision === record.revision && !!record.confirmedAt;

/** Structure excludes values/coordinates: native scroll and verified text do not change identity. */
export function careerGroupSignature(group: Omit<CareerPageGroup, 'signature'>): string {
  return createHash('sha256').update(canonical({ id: group.id, collection: group.collection,
    fields: group.fields.map(({ value: _value, ...field }) => field) })).digest('hex');
}

export function careerDatePrecision(value: string): CareerDatePrecision | undefined {
  const found = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/.exec(value);
  if (!found || Number(found[1]) < 1) return undefined;
  if (found[3]) {
    const year = Number(found[1]); const month = Number(found[2]); const day = Number(found[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!) return undefined;
    return 'day';
  }
  return found[2] ? 'month' : 'year';
}

function recordFor(profile: Profile, collection: CareerFormCollection, id: string): CareerRecord | undefined {
  const found = profile.career?.[collection].filter(record => record.id === id) ?? [];
  return found.length === 1 && confirmed(found[0]!) ? found[0] : undefined;
}

function planField(field: CareerFieldObservation, record: CareerRecord, collection: CareerFormCollection): CareerPlannedField {
  const base = { fieldId: field.id, key: field.key, currentValue: field.value, value: '' };
  if (field.value.trim()) {
    if (field.type === 'feishu-month' && (field.key === 'startDate' || field.key === 'endDate')
      && field.value.trim() !== '至今' && careerDatePrecision(field.value.trim()) !== 'month') {
      return { ...base, status: 'review', reason: '网页已有年月未完整或无法核实，请核对；保留当前内容，不自动覆盖或清空。' };
    }
    return { ...base, status: 'skip', reason: '已有值，保留网页当前内容。' };
  }
  if (!field.editable) return { ...base, status: 'skip', reason: '字段不可编辑。' };
  if (!keys[collection].includes(field.key)) return { ...base, status: 'review', reason: '字段不属于当前履历类别，不能串组填写。' };
  const raw = (record as unknown as Partial<Record<CareerFieldKey, unknown>>)[field.key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  const ongoingEnd = field.key === 'endDate' && (collection === 'internships' && 'current' in record && record.current === true
    || collection === 'projects' && 'ongoing' in record && record.ongoing === true);
  if (ongoingEnd) {
    if (value) return { ...base, status: 'review', reason: '资料同时声明仍在进行和结束日期，请先核对这条经历；不自动改写状态或日期。' };
    if (field.type === 'feishu-month' && field.supportsUntilNow === true) {
      return { ...base, value: '至今', status: 'ready', reason: '该条经历已确认仍在进行；仅通过已核实支持的飞书结束控件选择“至今”，随后独立重读。' };
    }
    return { ...base, status: 'review', reason: '该条经历已确认至今/仍在进行；网页“至今”控件尚未核实支持，请手动处理，不需要补填虚构结束日期。' };
  }
  if (!value) return { ...base, status: 'review', reason: '该条已确认经历没有此项资料，不推测补齐。' };
  if (field.key === 'startDate' || field.key === 'endDate') {
    const precision = careerDatePrecision(value);
    if (!precision || !field.datePrecision || (field.datePrecision !== 'source' && field.datePrecision !== precision)
      || !['text', 'textarea', 'feishu-month'].includes(field.type)
      || (field.type === 'feishu-month' && (precision !== 'month' || field.datePrecision !== 'month'))) {
      return { ...base, status: 'review', reason: '日期精度或控件输入方式尚未核实，保留原日期，不补月日。' };
    }
    if (field.type === 'feishu-month') return { ...base, value, status: 'ready', reason: '已确认的年月只交给飞书专用月份控件执行器，选择后独立重读。' };
  }
  if (field.key === 'url') {
    try { if (!['https:', 'http:'].includes(new URL(value).protocol)) throw new Error(); }
    catch { return { ...base, status: 'review', reason: '项目链接不是明确的 HTTP(S) 地址。' }; }
  }
  if (field.type === 'select') {
    const option = matchSelectOption(value, field.options ?? [], field.key === 'degree' ? 'degree' : undefined);
    if (!option) return { ...base, status: 'review', reason: '没有唯一匹配的真实下拉选项。' };
    return { ...base, value: option.value, status: 'ready', reason: '只使用当前绑定经历与唯一真实选项。' };
  }
  if (field.type === 'combobox' && field.customSelectSupported) {
    return { ...base, value, status: 'ready', reason: '按当前绑定经历展开单选，并核实唯一真实选项。' };
  }
  if (!['text', 'textarea', 'url'].includes(field.type)) return { ...base, status: 'review', reason: '此控件尚未核实，保留人工处理。' };
  return { ...base, value, status: 'ready', reason: '来自绑定记录的当前已确认修订，填写后仍需独立重读。' };
}

function bind(group: CareerPageGroup, record: CareerRecord, version: number): CareerGroupBinding {
  return { collection: group.collection, recordId: record.id, revision: record.revision, profileVersion: version,
    groupId: group.id, groupSignature: group.signature };
}

function assertObservation(observation: CareerFormObservation): void {
  if (!observation.id || !observation.url || !observation.signature || !Number.isInteger(observation.generation)) throw new Error('网页观察身份不完整。');
  if (new Set(observation.groups.map(group => group.id)).size !== observation.groups.length) throw new Error('网页履历组身份重复。');
  const fields = observation.groups.flatMap(group => group.fields);
  if (new Set(fields.map(field => field.id)).size !== fields.length) throw new Error('网页履历字段身份重复。');
  if (new Set(observation.addControls.map(control => control.id)).size !== observation.addControls.length) throw new Error('网页新增按钮身份重复。');
  for (const group of observation.groups) {
    if (!group.id || !group.signature || !collections.includes(group.collection) || !group.fields.length
      || group.fields.some(field => !field.id || !field.signature)) throw new Error('网页履历组结构不完整。');
    if (new Set(group.fields.map(field => field.key)).size !== group.fields.length) throw new Error('履历组有重复字段用途，需要站点明确区分。');
  }
}

/** Pure planner. It never clicks, submits, deletes, reads a private store or calls a model. */
export function buildCareerPlan(profile: Profile, observation: CareerFormObservation, options: CareerPlanOptions = {}): CareerFillPlan {
  assertObservation(observation);
  const preserved = options.preserveGroupIds ?? [];
  if (new Set(preserved).size !== preserved.length || preserved.some(id => !observation.groups.some(group => group.id === id))) throw new Error('保留的网页履历组身份重复或不存在。');
  if ((options.bindings ?? []).some(binding => preserved.includes(binding.groupId))) throw new Error('同一网页组不能同时保留和绑定填写。');
  const plan: CareerFillPlan = { id: randomUUID(), profileVersion: profile.version, url: observation.url,
    generation: observation.generation, observationId: observation.id, observationSignature: observation.signature,
    original: clone(observation), options: clone(options), bindings: [], steps: [], issues: [] };
  const allBindings = options.bindings ?? [];
  for (const collection of collections) {
    const issue = (reason: string, recordId?: string) => plan.issues.push({ collection, reason, ...(recordId ? { recordId } : {}) });
    const existing = observation.groups.filter(group => group.collection === collection);
    const supplied = allBindings.filter(binding => binding.collection === collection);
    const orderedIds = options.selectedRecordIds?.[collection];
    const records = profile.career?.[collection] ?? [];
    const selected = orderedIds ?? records.filter(confirmed).map(record => record.id);
    if (!selected.length && !supplied.length) continue;
    if (new Set(records.map(record => record.id)).size !== records.length || new Set(selected).size !== selected.length
      || new Set(supplied.map(binding => binding.recordId)).size !== supplied.length
      || new Set(supplied.map(binding => binding.groupId)).size !== supplied.length) { issue('记录或网页组绑定重复，不能猜测对应。'); continue; }
    const invalid = selected.find(id => !recordFor(profile, collection, id));
    if (invalid) { issue('所选经历不存在或当前修订尚未确认。', invalid); continue; }
    let invalidBinding = false;
    for (const binding of supplied) {
      const record = recordFor(profile, collection, binding.recordId);
      const group = existing.find(candidate => candidate.id === binding.groupId);
      if (!record || !group || binding.profileVersion !== profile.version || binding.revision !== record.revision
        || binding.groupSignature !== group.signature || !selected.includes(record.id)) { invalidBinding = true; break; }
    }
    if (invalidBinding) { issue('资料版本、经历修订或网页组结构已变化，请重新核对绑定。'); continue; }
    const unbound = existing.filter(group => !preserved.includes(group.id) && !supplied.some(binding => binding.groupId === group.id));
    if (unbound.some(group => group.fields.some(field => field.value.trim()))) {
      issue('页面有尚未绑定的已有经历，保留其内容，先由你核对对应记录。'); continue;
    }
    if (unbound.length > 1) { issue('页面有多个未绑定空组，不能仅凭顺序猜测经历。'); continue; }
    const bindings = clone(supplied);
    const remaining = selected.filter(id => !bindings.some(binding => binding.recordId === id));
    if (unbound.length && remaining.length) {
      if (remaining.length > 1 && !orderedIds) { issue('有多条待填经历，请先明确本次记录顺序。'); continue; }
      const record = recordFor(profile, collection, remaining.shift()!)!;
      bindings.push(bind(unbound[0]!, record, profile.version));
    }
    plan.bindings.push(...bindings);
    for (const binding of bindings) {
      const group = existing.find(candidate => candidate.id === binding.groupId)!;
      const record = recordFor(profile, collection, binding.recordId)!;
      plan.steps.push({ kind: 'fill-group', binding: clone(binding), items: group.fields.map(field => planField(field, record, collection)) });
    }
    // Reobserve after filling the currently bound groups before planning any structural action.
    if (remaining.length && !unbound.length && !plan.steps.some(step => step.kind === 'fill-group' && step.binding.collection === collection && step.items.some(item => item.status === 'ready'))) {
      const controls = observation.addControls.filter(control => control.collection === collection && control.enabled && control.signature);
      if (controls.length !== 1) { issue('没有唯一可核实的新增按钮，请手动添加。', remaining[0]); continue; }
      const record = recordFor(profile, collection, remaining[0]!)!; const control = controls[0]!;
      plan.steps.push({ kind: 'add-then-reobserve', collection, recordId: record.id, revision: record.revision,
        profileVersion: profile.version, controlId: control.id, controlSignature: control.signature });
    }
  }
  return plan;
}

function assertPlanCurrent(plan: CareerFillPlan, current: CareerFormObservation, profile: Profile, allowAddedGroup = false): void {
  assertObservation(current);
  if (profile.version !== plan.profileVersion) throw new Error('个人资料已更新，请重新生成履历计划。');
  if (current.url !== plan.url || current.generation !== plan.generation) throw new Error('网页地址或页面代次已变化。');
  if (!allowAddedGroup && (current.signature !== plan.observationSignature || !equal(current.groups, plan.original.groups)
    || !equal(current.addControls, plan.original.addControls) || !equal(current.protectedFields ?? [], plan.original.protectedFields ?? []))) throw new Error('网页字段、原值或新增按钮已变化，请重新观察。');
}

export function validateCareerAddStep(plan: CareerFillPlan, step: CareerAddGroupStep, current: CareerFormObservation, profile: Profile): CareerAddControl {
  assertPlanCurrent(plan, current, profile);
  if (!plan.steps.some(candidate => equal(candidate, step))) throw new Error('新增动作不属于本次计划。');
  const record = recordFor(profile, step.collection, step.recordId);
  const control = current.addControls.find(candidate => candidate.id === step.controlId && candidate.collection === step.collection);
  if (!record || record.revision !== step.revision || step.profileVersion !== profile.version || !control?.enabled
    || control.signature !== step.controlSignature) throw new Error('新增按钮或确认经历已变化。');
  return control;
}

/** An add attempt is never retried. Success is exactly one empty new group and unchanged existing groups. */
export function resumeCareerPlanAfterAdd(plan: CareerFillPlan, step: CareerAddGroupStep, current: CareerFormObservation, profile: Profile): CareerFillPlan {
  validateCareerAddStep(plan, step, plan.original, profile);
  assertPlanCurrent(plan, current, profile, true);
  const before = plan.original.groups;
  if (current.groups.length !== before.length + 1 || before.some(group => !equal(current.groups.find(candidate => candidate.id === group.id), group))) {
    throw new Error('新增后未能核实恰好一组且原有内容不变，停止，不自动重试。');
  }
  const added = current.groups.filter(group => !before.some(candidate => candidate.id === group.id));
  if (added.length !== 1 || added[0]!.collection !== step.collection || added[0]!.fields.some(field => field.value.trim())) {
    throw new Error('新增组类别、身份或空白状态不明确，停止，不自动重试。');
  }
  // Other add buttons and non-career controls must survive this collection's render unchanged.
  if (!equal(current.addControls.filter(control => control.collection !== step.collection), plan.original.addControls.filter(control => control.collection !== step.collection))) throw new Error('新增时其他经历区的按钮变化，停止。');
  if (!equal(current.protectedFields ?? [], plan.original.protectedFields ?? [])) throw new Error('新增时非目标字段变化，停止。');
  const record = recordFor(profile, step.collection, step.recordId)!;
  return buildCareerPlan(profile, current, { ...plan.options, bindings: [...plan.bindings, bind(added[0]!, record, profile.version)] });
}

export function validateCareerGroupFill(plan: CareerFillPlan, step: CareerFillGroupStep, current: CareerFormObservation, profile: Profile): CareerPlannedField[] {
  assertPlanCurrent(plan, current, profile);
  if (!plan.steps.some(candidate => equal(candidate, step))) throw new Error('填写动作不属于本次计划。');
  const record = recordFor(profile, step.binding.collection, step.binding.recordId);
  const group = current.groups.find(candidate => candidate.id === step.binding.groupId && candidate.collection === step.binding.collection);
  if (!record || !group || step.binding.profileVersion !== profile.version || record.revision !== step.binding.revision
    || group.signature !== step.binding.groupSignature) throw new Error('履历组绑定已失效。');
  const expected = group.fields.map(field => planField(field, record, group.collection));
  if (!equal(expected, step.items)) throw new Error('履历填写内容不再对应已确认记录。');
  return clone(expected.filter(item => item.status === 'ready'));
}
