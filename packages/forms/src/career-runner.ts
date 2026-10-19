import { randomUUID } from 'node:crypto';
import type { Profile } from '../../shared/src/contracts.js';
import { RetryableFieldPreparationError, MAX_FIELD_RETRIES } from './fill-retry.js';
import {
  buildCareerPlan, resumeCareerPlanAfterAdd, validateCareerAddStep, validateCareerGroupFill,
  type CareerAddGroupStep, type CareerFieldKey, type CareerFillGroupStep, type CareerFillPlan,
  type CareerFormCollection, type CareerFormObservation, type CareerGroupBinding, type CareerPlanOptions, type CareerPlannedField,
} from './career-plan.js';

type MaybePromise<T> = T | Promise<T>;
export interface CareerRunnerAction {
  id: string; planId: string; kind: 'add' | 'fill'; collection: CareerFormCollection; recordId: string; revision: number;
  /** Local recovery context from the host-validated plan; never provided by a model. */
  url: string; generation: number; profileVersion: number;
  groupId?: string; fieldId?: string; key?: CareerFieldKey;
}
export type CareerRunnerJournalEvent =
  | { phase: 'intent'; action: CareerRunnerAction }
  | { phase: 'retry'; action: CareerRunnerAction; attempt: number; maxAttempts: number }
  | { phase: 'result'; action: CareerRunnerAction; status: 'verified' | 'unknown'; reason?: CareerRunnerStopReason };
export interface CareerRunnerHost {
  read(): MaybePromise<CareerFormObservation>;
  getProfile(): MaybePromise<Profile>;
  assertActive(): MaybePromise<void>;
  signal?: AbortSignal;
  add(step: CareerAddGroupStep, plan: CareerFillPlan): Promise<void>;
  /** Native driver returns the exact real value it selected; this is not a success assertion. */
  fill(step: CareerFillGroupStep, item: CareerPlannedField, plan: CareerFillPlan): Promise<{ expectedValue: string }>;
  journal?(event: CareerRunnerJournalEvent): MaybePromise<void>;
}
export interface CareerRunnerOptions extends CareerPlanOptions { maxActions?: number; timeoutMs?: number; maxFillRetries?: number; }
export type CareerRunnerStopReason = 'aborted' | 'timeout' | 'action-limit' | 'profile-changed' | 'page-changed'
  | 'inactive' | 'verification-failed' | 'host-error';
export interface CareerRunnerPending {
  collection: CareerFormCollection; recordId?: string; groupId?: string; fieldId?: string; key?: CareerFieldKey;
  required: boolean | null; reason: string;
  scope?: 'field' | 'section'; label?: string; type?: string;
  reasonCode?: 'missing-profile' | 'unsupported-field' | 'needs-review' | 'not-yet-filled' | 'verification-failed' | 'unbound-record';
}
export interface CareerRunnerResult {
  status: 'completed' | 'partial' | 'stopped'; planId?: string; profileVersion?: number; stopReason?: CareerRunnerStopReason;
  added: Array<CareerRunnerAction & { groupId: string }>;
  verified: Array<CareerRunnerAction & { groupId: string; fieldId: string; key: CareerFieldKey }>;
  pending: CareerRunnerPending[]; bindings: CareerGroupBinding[]; actionsAttempted: number;
  retriesAttempted?: number;
  actions: Array<{ action: CareerRunnerAction; status: 'intent' | 'verified' | 'unknown' }>;
}

class RunnerStop extends Error { constructor(readonly reason: CareerRunnerStopReason) { super(reason); } }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);

const fieldLabels: Record<CareerFieldKey, string> = { school: '学校', degree: '学历', major: '专业', organization: '实习单位', role: '职位 / 项目角色', name: '项目名称', startDate: '开始时间', endDate: '结束时间', description: '经历说明', url: 'GitHub / 作品链接' };
function pendingFor(plan: CareerFillPlan, profile: Profile): CareerRunnerPending[] {
  const pending: CareerRunnerPending[] = plan.issues.map(issue => ({ ...issue, scope: 'section', required: null, reasonCode: 'unbound-record' }));
  for (const step of plan.steps) {
    if (step.kind !== 'fill-group') continue;
    const group = plan.original.groups.find(candidate => candidate.id === step.binding.groupId)!;
    for (const item of step.items) {
      const field = group.fields.find(candidate => candidate.id === item.fieldId)!;
      if (item.status === 'review' || (item.status === 'skip' && !item.currentValue.trim() && field.required !== false)) {
        const record = profile.career?.[step.binding.collection].find(record => record.id === step.binding.recordId);
        const source = record ? (record as unknown as Record<string, unknown>)[item.key] : undefined;
        const ongoing = item.key === 'endDate' && record && ('current' in record && record.current === true || 'ongoing' in record && record.ongoing === true);
        const reasonCode = !field.editable || ongoing ? 'unsupported-field' : !item.currentValue.trim() && (source === '' || source === undefined) ? 'missing-profile' : 'needs-review';
        pending.push({ collection: step.binding.collection, recordId: step.binding.recordId, groupId: group.id,
          fieldId: item.fieldId, key: item.key, scope: 'field', label: fieldLabels[item.key], type: field.type, reasonCode,
          required: field.type === 'feishu-month' && (item.key === 'startDate' || item.key === 'endDate') && Boolean(item.currentValue.trim()) ? true : field.required ?? null, reason: item.reason });
      }
    }
  }
  return pending;
}

/** Only the chosen field's value/signature may change. Driver success messages are never verification. */
function verifyFilledField(before: CareerFormObservation, after: CareerFormObservation, groupId: string, fieldId: string, expected: string): void {
  if (!expected.trim() || before.url !== after.url || before.generation !== after.generation
    || !equal(before.addControls, after.addControls) || !equal(before.protectedFields ?? [], after.protectedFields ?? [])
    || before.groups.length !== after.groups.length) throw new RunnerStop('verification-failed');
  const targetGroup = after.groups.find(group => group.id === groupId);
  const target = targetGroup?.fields.find(field => field.id === fieldId);
  if (!target || target.value !== expected || !target.signature || !targetGroup?.signature) throw new RunnerStop('verification-failed');
  const projected = structuredClone(after);
  for (let index = 0; index < before.groups.length; index++) {
    const original = before.groups[index]!; const current = projected.groups[index]!;
    if (current.id !== original.id) throw new RunnerStop('verification-failed');
    if (original.id !== groupId) continue;
    const originalField = original.fields.find(field => field.id === fieldId);
    const changedField = current.fields.find(field => field.id === fieldId);
    if (!originalField || !changedField) throw new RunnerStop('verification-failed');
    changedField.value = originalField.value; changedField.signature = originalField.signature;
    current.signature = original.signature;
  }
  if (!equal(before.groups, projected.groups)) throw new RunnerStop('verification-failed');
}

/**
 * One in-memory authorization, serial bounded actions. Only certified no-write preparation failures may retry.
 * A timed-out native host action may still be pending: caller must cancel that driver,
 * preserve its intent as unknown and never start another run until it has settled.
 */
export async function runCareerPlan(host: CareerRunnerHost, options: CareerRunnerOptions = {}): Promise<CareerRunnerResult> {
  const maxActions = options.maxActions ?? 100; const timeoutMs = options.timeoutMs ?? 120_000;
  const maxFillRetries = options.maxFillRetries ?? 0;
  if (!Number.isInteger(maxFillRetries) || maxFillRetries < 0 || maxFillRetries > MAX_FIELD_RETRIES) throw new TypeError('maxFillRetries 必须为 0–2。');
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 100) throw new TypeError('maxActions 必须为 1–100 的整数。');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) throw new TypeError('timeoutMs 必须为 0–600000 之间的正数。');
  const deadline = performance.now() + timeoutMs;
  const authorization: CareerPlanOptions = structuredClone({ bindings: options.bindings ?? [], selectedRecordIds: options.selectedRecordIds, preserveGroupIds: options.preserveGroupIds });
  const result: CareerRunnerResult = { status: 'stopped', added: [], verified: [], pending: [], bindings: structuredClone([...(authorization.bindings ?? [])]), actionsAttempted: 0, actions: [] };
  let profileVersion: number | undefined; let initialProfileSnapshot: Profile | undefined;
  let initialPage: { url: string; generation: number } | undefined;
  let latestPlan: CareerFillPlan | undefined; let inFlight: CareerRunnerAction | undefined;
  const consumed = new Set<string>();
  const check = () => {
    if (host.signal?.aborted) throw new RunnerStop('aborted');
    if (performance.now() >= deadline) throw new RunnerStop('timeout');
  };
  const bounded = async <T>(operation: () => MaybePromise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RunnerStop('timeout')), Math.max(1, deadline - performance.now()));
      abort = () => reject(new RunnerStop('aborted'));
      host.signal?.addEventListener('abort', abort, { once: true });
    });
    try { const value = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), stop]); check(); return value; }
    finally { if (timer) clearTimeout(timer); if (abort) host.signal?.removeEventListener('abort', abort); }
  };
  const active = async () => {
    try { await bounded(() => host.assertActive()); }
    catch (error) { if (error instanceof RunnerStop) throw error; throw new RunnerStop('inactive'); }
  };
  const readProfile = async () => {
    const profile = await bounded(() => host.getProfile());
    if ((profileVersion !== undefined && profile.version !== profileVersion)
      || (initialProfileSnapshot && !equal(profile, initialProfileSnapshot))) throw new RunnerStop('profile-changed');
    return profile;
  };
  const read = async () => {
    const observation = await bounded(() => host.read());
    if (initialPage && (observation.url !== initialPage.url || observation.generation !== initialPage.generation)) throw new RunnerStop('page-changed');
    return observation;
  };
  const journal = async (event: CareerRunnerJournalEvent) => { if (host.journal) await bounded(() => host.journal!(structuredClone(event))); };
  const recordResult = async (action: CareerRunnerAction, status: 'verified' | 'unknown', reason?: CareerRunnerStopReason) => {
    const tracked = result.actions.find(item => item.action.id === action.id)!; tracked.status = status;
    await journal({ phase: 'result', action, status, ...(reason ? { reason } : {}) });
  };
  try {
    await active();
    const initialProfile = await readProfile(); profileVersion = initialProfile.version; result.profileVersion = profileVersion;
    initialProfileSnapshot = structuredClone(initialProfile);
    const first = await read(); initialPage = { url: first.url, generation: first.generation };
    let current = first;
    for (;;) {
      await active(); const profile = await readProfile(); const fresh = await read();
      if (fresh.signature !== current.signature || !equal(fresh.groups, current.groups) || !equal(fresh.addControls, current.addControls)
        || !equal(fresh.protectedFields ?? [], current.protectedFields ?? [])) throw new RunnerStop('verification-failed');
      current = fresh;
      latestPlan = buildCareerPlan(profile, current, { ...authorization, bindings: result.bindings });
      result.planId = latestPlan.id; result.bindings = structuredClone(latestPlan.bindings); result.pending = pendingFor(latestPlan, profile);
      const fillStep = latestPlan.steps.find((step): step is CareerFillGroupStep => step.kind === 'fill-group' && step.items.some(item => item.status === 'ready'));
      const addStep = latestPlan.steps.find((step): step is CareerAddGroupStep => step.kind === 'add-then-reobserve');
      if (!fillStep && !addStep) {
        result.status = result.pending.some(item => item.required !== false) ? 'partial' : 'completed'; break;
      }
      if (result.actionsAttempted >= maxActions) throw new RunnerStop('action-limit');
      const item = fillStep?.items.find(candidate => candidate.status === 'ready');
      const step = fillStep ?? addStep!;
      const binding = step.kind === 'fill-group' ? step.binding : step;
      const action: CareerRunnerAction = { id: randomUUID(), planId: latestPlan.id, kind: step.kind === 'fill-group' ? 'fill' : 'add',
        url: latestPlan.url, generation: latestPlan.generation, profileVersion: latestPlan.profileVersion,
        collection: binding.collection, recordId: binding.recordId, revision: binding.revision,
        ...(step.kind === 'fill-group' ? { groupId: step.binding.groupId, fieldId: item!.fieldId, key: item!.key } : {}) };
      if (consumed.has(action.id)) throw new RunnerStop('host-error');
      consumed.add(action.id); result.actionsAttempted++; result.actions.push({ action, status: 'intent' }); inFlight = action;
      await journal({ phase: 'intent', action });
      // Journal writes may yield. Re-read and validate immediately before the native driver.
      const immediate = await read(); const immediateProfile = await readProfile(); await active();
      try {
        if (step.kind === 'fill-group') validateCareerGroupFill(latestPlan, step, immediate, immediateProfile);
        else validateCareerAddStep(latestPlan, step, immediate, immediateProfile);
      } catch { throw new RunnerStop('verification-failed'); }
      if (step.kind === 'fill-group') {
        const selected = item!;
        let filled: { expectedValue: string } | undefined;
        for (let attempt = 0; ; attempt++) {
          try { filled = await bounded(() => host.fill(step, selected, latestPlan!)); break; }
          catch (error) {
            if (!(error instanceof RetryableFieldPreparationError) || attempt >= maxFillRetries) throw error;
            await active(); await readProfile(); const recovery = await read();
            // No blind second input: every observed value and structural identity must be unchanged.
            if (!equal(recovery.groups, immediate.groups) || !equal(recovery.addControls, immediate.addControls)
              || !equal(recovery.protectedFields ?? [], immediate.protectedFields ?? []) || recovery.signature !== immediate.signature) throw new RunnerStop('verification-failed');
            validateCareerGroupFill(latestPlan!, step, recovery, await readProfile());
            if (result.actionsAttempted >= maxActions) throw new RunnerStop('action-limit');
            result.actionsAttempted++; result.retriesAttempted = (result.retriesAttempted ?? 0) + 1;
            await journal({ phase: 'retry', action, attempt: attempt + 2, maxAttempts: maxFillRetries + 1 });
          }
        }
        await active(); await readProfile(); const after = await read();
        if (!filled || typeof filled.expectedValue !== 'string') throw new RunnerStop('verification-failed');
        verifyFilledField(immediate, after, step.binding.groupId, selected.fieldId, filled.expectedValue);
        const actualGroup = after.groups.find(group => group.id === step.binding.groupId)!;
        result.bindings = result.bindings.map(existing => existing.groupId === actualGroup.id
          ? { ...existing, groupSignature: actualGroup.signature } : existing);
        result.verified.push({ ...action, groupId: actualGroup.id, fieldId: selected.fieldId, key: selected.key });
        current = after;
      } else {
        await bounded(() => host.add(step, latestPlan!));
        await active(); const afterProfile = await readProfile(); const after = await read();
        let resumed: CareerFillPlan;
        try { resumed = resumeCareerPlanAfterAdd(latestPlan, step, after, afterProfile); }
        catch { throw new RunnerStop('verification-failed'); }
        const newBinding = resumed.bindings.find(existing => existing.collection === step.collection && existing.recordId === step.recordId);
        if (!newBinding) throw new RunnerStop('verification-failed');
        result.bindings = structuredClone(resumed.bindings); result.added.push({ ...action, groupId: newBinding.groupId }); current = after;
      }
      await recordResult(action, 'verified'); inFlight = undefined;
    }
  } catch (error) {
    const reason = error instanceof RunnerStop ? error.reason : 'host-error';
    result.status = 'stopped'; result.stopReason = reason;
    if (inFlight) {
      const tracked = result.actions.find(item => item.action.id === inFlight!.id); if (tracked?.status === 'intent') tracked.status = 'unknown';
      try { check(); await recordResult(inFlight, tracked?.status === 'verified' ? 'verified' : 'unknown', reason); } catch { /* The intent remains recoverable as unknown. */ }
    }
  }
  if (result.status === 'stopped') {
    // A stopped ready field is still outstanding, even though its old preview did
    // not require human review. Do not describe an unknown action as a blank field.
    for (const step of latestPlan?.steps ?? []) {
      if (step.kind === 'fill-group') {
        for (const item of step.items.filter(candidate => candidate.status === 'ready')) {
          if (result.verified.some(action => action.groupId === step.binding.groupId && action.fieldId === item.fieldId)) continue;
          if (result.pending.some(pending => pending.fieldId === item.fieldId)) continue;
          const field = latestPlan!.original.groups.find(group => group.id === step.binding.groupId)?.fields.find(field => field.id === item.fieldId);
          const attempted = result.actions.some(({ action }) => action.groupId === step.binding.groupId && action.fieldId === item.fieldId);
          result.pending.push({ collection: step.binding.collection, recordId: step.binding.recordId, groupId: step.binding.groupId,
            fieldId: item.fieldId, key: item.key, scope: 'field', label: fieldLabels[item.key], type: field?.type,
            required: field?.required ?? null, reasonCode: attempted ? 'verification-failed' : 'not-yet-filled', reason: '本次未完成独立核实，请先重新观察页面，不自动重试。' });
        }
      } else if (!result.added.some(action => action.collection === step.collection && action.recordId === step.recordId)) {
        result.pending.push({ collection: step.collection, recordId: step.recordId, scope: 'section', required: null, reasonCode: 'unbound-record', reason: '这条经历尚未核实新增成功，请先重新观察页面。' });
      }
    }
    for (const collection of ['educations', 'internships', 'projects'] as const) {
      const ids = authorization.selectedRecordIds?.[collection] ?? initialProfileSnapshot?.career?.[collection]
        .filter(record => record.confirmation === 'confirmed' && record.confirmedRevision === record.revision && !!record.confirmedAt).map(record => record.id) ?? [];
      for (const recordId of ids) if (!result.bindings.some(binding => binding.collection === collection && binding.recordId === recordId)
        && !result.pending.some(pending => pending.collection === collection && (!pending.recordId || pending.recordId === recordId))) {
        result.pending.push({ collection, recordId, scope: 'section', required: null, reasonCode: 'unbound-record', reason: '本次尚未核实该条经历对应的网页组。' });
      }
    }
  }
  return result;
}
