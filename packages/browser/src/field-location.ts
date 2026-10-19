import type { ApplicationFieldLocationInput, FieldObservation, FillPlan, FormObservation } from '../../shared/src/contracts.js';
import type { CareerFillPlan, CareerFormObservation, CareerGroupBinding } from '../../forms/src/career-plan.js';

export class FieldLocationError extends Error {
  constructor(readonly status: 'stale' | 'ambiguous' | 'unsupported' | 'blocked', message: string) { super(message); }
}
interface Context { url: string; generation: number; profileVersion: number; }
interface Snapshot extends Context { createdAt: number; }
interface OrdinarySnapshot extends Snapshot { signature: string; fields: Array<Pick<FieldObservation, 'id' | 'index' | 'signature'>>; }
interface CareerSnapshot extends Snapshot { groups: Map<string, { signature: string; collection: string }>; }
const stale = () => new FieldLocationError('stale', '页面或资料已变化，请重新读取待处理项。');

export function validateFieldLocationInput(value: unknown): ApplicationFieldLocationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FieldLocationError('unsupported', '定位参数无效。');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['kind', 'planId', 'fieldId', 'groupId', 'fieldKey'].includes(key))
    || typeof input.kind !== 'string' || !['ordinary', 'career'].includes(input.kind)
    || typeof input.planId !== 'string' || !input.planId || input.planId.length > 300
    || ['fieldId', 'groupId', 'fieldKey'].some(key => input[key] !== undefined
      && (typeof input[key] !== 'string' || !input[key] || (input[key] as string).length > 300))
    || (input.kind === 'ordinary' && (!input.fieldId || input.groupId !== undefined || input.fieldKey !== undefined))
    || (input.kind === 'career' && (!input.groupId || (!input.fieldId && !input.fieldKey)))) {
    throw new FieldLocationError('unsupported', '请从当前待处理列表选择一个明确的字段。');
  }
  return input as unknown as ApplicationFieldLocationInput;
}

/** Read-only identities outlive consumed write plans. They can never authorize filling. */
export class FieldLocationRegistry {
  private ordinary = new Map<string, OrdinarySnapshot>();
  private career = new Map<string, CareerSnapshot>();
  constructor(private now: () => number = Date.now) {}
  clear(): void { this.ordinary.clear(); this.career.clear(); }
  private trim<T extends Snapshot>(map: Map<string, T>): void {
    for (const [id, value] of map) if (this.now() - value.createdAt > 600_000) map.delete(id);
    while (map.size > 20) map.delete(map.keys().next().value!);
  }
  rememberOrdinary(plan: FillPlan, original: FormObservation, generation: number): void {
    this.ordinary.set(plan.id, { url: plan.url, profileVersion: plan.profileVersion, generation, createdAt: this.now(),
      signature: original.signature, fields: original.fields.map(({ id, index, signature }) => ({ id, index, signature })) });
    this.trim(this.ordinary);
  }
  rememberCareer(plan: CareerFillPlan): void {
    this.career.set(plan.id, { url: plan.url, profileVersion: plan.profileVersion, generation: plan.generation, createdAt: this.now(),
      groups: new Map(plan.original.groups.map(group => [group.id, { collection: group.collection, signature: group.signature }])) });
    this.trim(this.career);
  }
  /** Only the host runner calls this with independently verified, newly added groups. */
  bindCareerResult(planId: string, bindings: readonly CareerGroupBinding[]): void {
    const saved = this.career.get(planId);
    if (!saved) return;
    for (const binding of bindings) if (binding.profileVersion === saved.profileVersion && /^[a-f0-9]{64}$/u.test(binding.groupSignature)) {
      const previous = saved.groups.get(binding.groupId);
      if (!previous) saved.groups.set(binding.groupId, { collection: binding.collection, signature: binding.groupSignature });
    }
  }
  private check<T extends Snapshot>(snapshot: T | undefined, context: Context): T {
    if (!snapshot || this.now() - snapshot.createdAt > 600_000
      || snapshot.url !== context.url || snapshot.generation !== context.generation || snapshot.profileVersion !== context.profileVersion) throw stale();
    return snapshot;
  }
  ordinaryTarget(input: ApplicationFieldLocationInput, current: FormObservation, generation: number, profileVersion: number): FieldObservation {
    const saved = this.check(this.ordinary.get(input.planId), { url: current.url, generation, profileVersion });
    if (saved.signature !== current.signature || saved.fields.length !== current.fields.length
      || saved.fields.some(field => current.fields.filter(next => next.id === field.id && next.signature === field.signature && next.index === field.index).length !== 1)) throw stale();
    const targets = current.fields.filter(field => field.id === input.fieldId);
    if (targets.length !== 1) throw new FieldLocationError('ambiguous', '不能唯一确定这个字段，请重新读取。');
    return targets[0]!;
  }
  careerTarget(input: ApplicationFieldLocationInput, current: CareerFormObservation, profileVersion: number): string {
    const saved = this.check(this.career.get(input.planId), { url: current.url, generation: current.generation, profileVersion });
    if (current.groups.length !== saved.groups.size || [...saved.groups].some(([id, original]) =>
      current.groups.filter(group => group.id === id && group.signature === original.signature && group.collection === original.collection).length !== 1)) throw stale();
    const groups = current.groups.filter(group => group.id === input.groupId);
    if (groups.length !== 1) throw new FieldLocationError('ambiguous', '这条经历的网页位置不明确，请重新读取。');
    const fields = groups[0]!.fields.filter(field => (!input.fieldId || field.id === input.fieldId) && (!input.fieldKey || field.key === input.fieldKey));
    if (fields.length !== 1) throw new FieldLocationError('ambiguous', '这条经历有多个可能的字段，请重新读取。');
    return fields[0]!.id;
  }
}
