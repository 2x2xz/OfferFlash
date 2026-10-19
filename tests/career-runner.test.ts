import assert from 'node:assert/strict';
import test from 'node:test';
import type { Profile } from '../packages/shared/src/contracts.js';
import { emptyCareerInput, newCareerRecord } from '../packages/profile/src/career-input.js';
import { careerGroupSignature, type CareerFieldKey, type CareerFormCollection, type CareerFormObservation, type CareerPageGroup } from '../packages/forms/src/career-plan.js';
import { runCareerPlan, type CareerRunnerHost, type CareerRunnerJournalEvent, type CareerRunnerOptions } from '../packages/forms/src/career-runner.js';
import { RetryableFieldPreparationError, safePreparationRetry } from '../packages/forms/src/fill-retry.js';

const confirmed = { confirmation: 'confirmed' as const, revision: 1, confirmedRevision: 1, confirmedAt: '2026-10-18T00:00:00Z' };
const onlyEducation: CareerRunnerOptions = { selectedRecordIds: { educations: ['e-one'], internships: [], projects: [] } };
test('bounded retries require a host-certified no-write preparation error and fresh identical observations', async () => {
  const { host, state } = fixture([group('empty', 'educations', ['school'])]); const fill = host.fill; let tries = 0;
  host.fill = async (step, item, plan) => { if (++tries < 3) throw new RetryableFieldPreparationError('transient focus'); return fill(step,item,plan); };
  const result = await runCareerPlan(host, { ...onlyEducation, maxFillRetries: 2 });
  assert.equal(result.status, 'completed'); assert.equal(tries, 3); assert.equal(result.verified.length, 1);
  assert.equal(result.retriesAttempted, 2); assert.equal(result.actionsAttempted, 3);
  assert.deepEqual(state.journal.filter(event => event.phase === 'retry').map(event => event.attempt), [2,3]);
});
test('retry limits stop at three attempts and never retry additions, untyped errors or changed data', async () => {
  for (const mode of ['limit', 'untyped', 'value', 'profile', 'protected', 'add'] as const) {
    const { host, state } = fixture(mode === 'add' ? [] : [group('empty', 'educations', ['school'])]); let tries = 0;
    const fail = () => { tries++; if (mode === 'value') state.observation.groups[0]!.fields[0]!.value = 'uncertain';
      if (mode === 'profile') state.profile.version++; if (mode === 'protected') state.observation.protectedFields[1]!.checked = true;
      throw mode === 'untyped' ? new Error('temporary') : new RetryableFieldPreparationError('temporary'); };
    if (mode === 'add') host.add = async () => fail(); else host.fill = async () => fail();
    const result = await runCareerPlan(host, { ...onlyEducation, maxFillRetries: 2 });
    assert.equal(result.status, 'stopped'); assert.equal(result.verified.length, 0); assert.equal(tries, mode === 'limit' ? 3 : 1);
  }
});
test('retry stage policy excludes all dispatched writes, menus and unbounded budgets', () => {
  assert.equal(safePreparationRetry('hover-field','text',0,2),true);
  for (const [stage,type,attempt,limit] of [['insert-text','text',0,2],['verify-value','text',0,2],['hover-field','select',0,2],['hover-field','text',2,2],['hover-field','text',0,99]] as const) assert.equal(safePreparationRetry(stage,type,attempt,limit),false);
});
function fixtureProfile(): Profile {
  return { version: 4, updatedAt: '2026-10-18T00:00:00Z', fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '', career: {
    ...emptyCareerInput(), sources: [], educations: [
      { ...newCareerRecord('educations', 'e-one'), ...confirmed, school: '虚构北城大学', degree: '本科', major: '计算机', startDate: '2020', endDate: '2024-06' },
      { ...newCareerRecord('educations', 'e-two'), ...confirmed, school: '虚构南城大学', degree: '硕士', major: '人工智能', startDate: '2025-09', endDate: '2027-06' },
    ], internships: [{ ...newCareerRecord('internships', 'i-one'), ...confirmed, organization: '虚构星河公司', role: '算法实习生' }],
    projects: [{ ...newCareerRecord('projects', 'p-one'), ...confirmed, name: '虚构检索项目', role: '开发' }], publications: [], primaryEducationId: 'e-two',
  } };
}
function group(id: string, collection: CareerFormCollection, keys: CareerFieldKey[] = collection === 'educations' ? ['school', 'degree'] : collection === 'internships' ? ['organization', 'role'] : ['name', 'role']): CareerPageGroup {
  const fields = keys.map(key => ({ id: `${id}-${key}`, key, signature: `field-${id}-${key}`, type: 'text', value: '', editable: true, required: true }));
  return { id, collection, fields, signature: careerGroupSignature({ id, collection, fields }) };
}
function fixture(initialGroups: CareerPageGroup[] = []) {
  const state = { profile: fixtureProfile(), observation: { id: 'initial', url: 'https://example.invalid/fictional-application', generation: 8, signature: 'page-initial', groups: initialGroups,
    addControls: (['educations', 'internships', 'projects'] as const).map(collection => ({ id: `add-${collection}`, collection, signature: `signature-add-${collection}`, enabled: true as boolean })),
    protectedFields: [{ id: 'email', signature: 'signature-email', value: 'fictional@example.invalid' }, { id: 'consent', signature: 'signature-consent', value: '', checked: false as boolean }],
  } satisfies CareerFormObservation, reads: 0, adds: 0, fills: 0, activeChecks: 0, journal: [] as CareerRunnerJournalEvent[] };
  const host: CareerRunnerHost = {
    read() { state.reads++; return structuredClone({ ...state.observation, id: `read-${state.reads}` }); },
    getProfile() { return structuredClone(state.profile); }, assertActive() { state.activeChecks++; },
    async add(step) {
      state.adds++; const next = group(`added-${state.adds}`, step.collection); state.observation.groups.push(next); state.observation.signature = `page-add-${state.adds}`;
    },
    async fill(step, item) {
      state.fills++; const target = state.observation.groups.find(group => group.id === step.binding.groupId)!.fields.find(field => field.id === item.fieldId)!;
      target.value = item.value; return { expectedValue: item.value };
    },
    journal(event) { state.journal.push(structuredClone(event)); },
  };
  return { host, state };
}

test('serial runner adds each selected education, internship and project then independently verifies each field', async () => {
  const { host, state } = fixture();
  const result = await runCareerPlan(host, { selectedRecordIds: { educations: ['e-one', 'e-two'], internships: ['i-one'], projects: ['p-one'] } });
  assert.equal(result.status, 'completed'); assert.equal(result.added.length, 4); assert.equal(result.verified.length, 8);
  assert.equal(result.actionsAttempted, 12); assert.equal(state.adds, 4); assert.equal(state.fills, 8);
  assert.deepEqual(result.bindings.map(binding => binding.recordId), ['e-one', 'e-two', 'i-one', 'p-one']);
  assert.deepEqual(state.observation.groups.filter(group => group.collection === 'educations').map(group => group.fields[0]!.value), ['虚构北城大学', '虚构南城大学']);
  assert.equal(state.observation.protectedFields[1]!.checked, false);
  assert.ok(state.reads > result.actionsAttempted * 2);
  assert.equal(state.journal.length, 24);
  for (let index = 0; index < state.journal.length; index += 2) {
    assert.equal(state.journal[index]!.phase, 'intent'); assert.equal(state.journal[index + 1]!.phase, 'result');
    assert.equal(state.journal[index]!.action.id, state.journal[index + 1]!.action.id);
  }
  assert.equal(new Set(result.actions.map(entry => entry.action.id)).size, 12);
  for (const event of state.journal) {
    assert.equal(event.action.url, state.observation.url);
    assert.equal(event.action.generation, state.observation.generation);
    assert.equal(event.action.profileVersion, state.profile.version);
    assert.ok(event.action.planId);
  }
});

test('one original empty education binds the chosen record and each next field gets a fresh plan snapshot', async () => {
  const { host, state } = fixture([group('existing-empty', 'educations')]); const plans: string[] = [];
  const fill = host.fill; host.fill = async (step, item, plan) => { plans.push(plan.id); return fill(step, item, plan); };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.status, 'completed'); assert.equal(result.added.length, 0); assert.equal(result.verified.length, 2);
  assert.equal(plans.length, new Set(plans).size); assert.equal(state.observation.groups[0]!.fields[0]!.value, '虚构北城大学');
  assert.deepEqual(state.journal.filter(event => event.phase === 'intent').map(event => event.action.planId), plans);
});

test('independent raw read, rather than a host success claim, determines whether a fill is verified', async () => {
  const { host, state } = fixture([group('empty', 'educations')]);
  host.fill = async (_step, item) => { state.fills++; return { expectedValue: item.value }; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'verification-failed');
  assert.equal(result.verified.length, 0); assert.equal(state.fills, 1); assert.equal(result.actions[0]!.status, 'unknown');
  assert.equal(result.pending.filter(pending => pending.recordId === 'e-one' && pending.fieldId).length, 2);
});

test('a real select value returned by a trusted native driver is compared exactly, not to the display label', async () => {
  const g = group('empty', 'educations', ['degree']); g.fields[0]!.type = 'combobox';
  Object.assign(g.fields[0]!, { customSelectSupported: true });
  const { host, state } = fixture([g]);
  host.fill = async () => { state.fills++; state.observation.groups[0]!.fields[0]!.value = 'actual-bachelor-code'; return { expectedValue: 'actual-bachelor-code' }; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.status, 'completed'); assert.equal(result.verified.length, 1);
});

test('wrong raw values including whitespace changes stop without retry', async () => {
  for (const value of ['wrong', ' 虚构北城大学 ', '']) {
    const { host, state } = fixture([group('empty', 'educations')]);
    host.fill = async (_step, item) => { state.fills++; state.observation.groups[0]!.fields[0]!.value = value; return { expectedValue: item.value }; };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.status, 'stopped'); assert.equal(state.fills, 1); assert.equal(result.verified.length, 0);
  }
});

test('all other career field values and structures must remain unchanged during each fill', async () => {
  for (const mutate of [
    (state: ReturnType<typeof fixture>['state']) => { state.observation.groups[0]!.fields[1]!.value = '串写其他字段'; },
    (state: ReturnType<typeof fixture>['state']) => { state.observation.groups[0]!.fields[1]!.signature = 'changed'; },
    (state: ReturnType<typeof fixture>['state']) => { state.observation.groups[0]!.fields[0]!.type = 'password'; },
    (state: ReturnType<typeof fixture>['state']) => { state.observation.groups.push(group('unexpected', 'projects')); },
  ]) {
    const { host, state } = fixture([group('empty', 'educations')]); const fill = host.fill;
    host.fill = async (step, item, plan) => { const outcome = await fill(step, item, plan); mutate(state); return outcome; };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.stopReason, 'verification-failed'); assert.equal(result.verified.length, 0); assert.equal(state.fills, 1);
  }
});

test('non-career values, checked controls and add buttons are protected during fills', async () => {
  for (const mutate of [
    (state: ReturnType<typeof fixture>['state']) => { state.observation.protectedFields[0]!.value = 'changed@example.invalid'; },
    (state: ReturnType<typeof fixture>['state']) => { state.observation.protectedFields[1]!.checked = true; },
    (state: ReturnType<typeof fixture>['state']) => { state.observation.addControls[0]!.enabled = false; },
  ]) {
    const { host, state } = fixture([group('empty', 'educations')]); const fill = host.fill;
    host.fill = async (step, item, plan) => { const outcome = await fill(step, item, plan); mutate(state); return outcome; };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.stopReason, 'verification-failed'); assert.equal(result.verified.length, 0);
  }
});

test('target signature changes are rebound only after its value and all other observations verify', async () => {
  const { host, state } = fixture([group('empty', 'educations')]); const fill = host.fill;
  host.fill = async (step, item, plan) => {
    const outcome = await fill(step, item, plan); const g = state.observation.groups[0]!;
    g.fields.find(field => field.id === item.fieldId)!.signature = `verified-${item.fieldId}`;
    g.signature = `group-after-${state.fills}`; state.observation.signature = `page-after-${state.fills}`; return outcome;
  };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.status, 'completed'); assert.equal(result.verified.length, 2);
  assert.equal(result.bindings[0]!.groupSignature, 'group-after-2');
});

test('an add call producing no group, two groups or a nonempty group stops and is never retried', async () => {
  for (const variant of ['none', 'two', 'nonempty']) {
    const { host, state } = fixture(); const add = host.add;
    host.add = async (step, plan) => {
      if (variant === 'none') { state.adds++; return; }
      await add(step, plan);
      if (variant === 'two') state.observation.groups.push(group('extra', step.collection));
      if (variant === 'nonempty') state.observation.groups[0]!.fields[0]!.value = '网页已有内容';
    };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'verification-failed'); assert.equal(state.adds, 1);
    assert.equal(state.fills, 0); assert.equal(result.added.length, 0); assert.equal(result.actions[0]!.status, 'unknown');
  }
});

test('add verifies non-career protected values before binding the newly observed group', async () => {
  const { host, state } = fixture(); const add = host.add;
  host.add = async (step, plan) => { await add(step, plan); state.observation.protectedFields[1]!.checked = true; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'verification-failed'); assert.equal(state.fills, 0); assert.equal(result.added.length, 0);
});

test('required missing source values return partial progress without guessing any content', async () => {
  const { host, state } = fixture([group('project', 'projects', ['name', 'description'])]);
  const result = await runCareerPlan(host, { selectedRecordIds: { educations: [], internships: [], projects: ['p-one'] } });
  assert.equal(result.status, 'partial'); assert.equal(result.verified.length, 1); assert.equal(state.fills, 1);
  assert.ok(result.pending.some(item => item.recordId === 'p-one' && item.key === 'description' && item.required));
});

test('optional missing fields stay visible in pending but do not claim required work remains', async () => {
  const g = group('project', 'projects', ['name', 'description']); g.fields[1]!.required = false;
  const { host } = fixture([g]);
  const result = await runCareerPlan(host, { selectedRecordIds: { educations: [], internships: [], projects: ['p-one'] } });
  assert.equal(result.status, 'completed'); assert.equal(result.pending.length, 1); assert.equal(result.pending[0]!.required, false);
});

test('runner retains precise field identity and honest requiredness without counting a section as a required input', async () => {
  const unknown = group('unknown', 'projects', ['description']); delete unknown.fields[0]!.required; unknown.signature = careerGroupSignature(unknown);
  const { host } = fixture([unknown]);
  const result = await runCareerPlan(host, { selectedRecordIds: { educations: [], internships: [], projects: ['p-one'] } });
  assert.equal(result.status, 'partial'); assert.equal(result.pending.length, 1);
  assert.deepEqual(result.pending[0], { collection: 'projects', recordId: 'p-one', groupId: 'unknown', fieldId: 'unknown-description', key: 'description',
    scope: 'field', label: '经历说明', type: 'text', reasonCode: 'missing-profile', required: null, reason: '该条已确认经历没有此项资料，不推测补齐。' });
  const g = group('foreign', 'educations'); g.fields[0]!.value = '原有大学';
  const stopped = await runCareerPlan(fixture([g]).host, onlyEducation);
  assert(stopped.pending.every(item => item.scope === 'section' && item.required === null && item.reasonCode === 'unbound-record'));
});

test('a noneditable empty field is a manual control issue rather than missing personal facts', async () => {
  const g = group('readonly', 'projects', ['description']); g.fields[0]!.editable = false; g.signature = careerGroupSignature(g);
  const { host, state } = fixture([g]);
  const result = await runCareerPlan(host, { selectedRecordIds: { educations: [], internships: [], projects: ['p-one'] } });
  assert.equal(result.pending[0]!.reasonCode, 'unsupported-field'); assert.equal(state.fills, 0);
});

test('incomplete existing Feishu months never emit fill and remain partial even for optional endpoints', async () => {
  for (const required of [true, false]) for (const value of ['2025-MM', 'YYYY-09', '2025-13']) {
    const g = group('interrupted-education', 'educations', ['startDate']);
    Object.assign(g.fields[0]!, { type: 'feishu-month', datePrecision: 'month', value, required });
    g.signature = careerGroupSignature(g);
    const { host, state } = fixture([g]);
    const result = await runCareerPlan(host, { ...onlyEducation, bindings: [{ collection: 'educations', recordId: 'e-one', revision: 1,
      profileVersion: 4, groupId: g.id, groupSignature: g.signature }] });
    assert.equal(result.status, 'partial'); assert.equal(result.pending.length, 1); assert.equal(result.pending[0]!.key, 'startDate');
    assert.match(result.pending[0]!.reason, /年月未完整/); assert.equal(state.fills, 0); assert.equal(state.adds, 0);
    assert.equal(result.actionsAttempted, 0); assert.equal(state.observation.groups[0]!.fields[0]!.value, value);
  }
});

test('valid existing Feishu months and explicit 至今 remain untouched and do not add recovery pending', async () => {
  for (const value of ['2025-09', '至今']) {
    const g = group('preserved-education', 'educations', ['endDate']);
    Object.assign(g.fields[0]!, { type: 'feishu-month', datePrecision: 'month', value }); g.signature = careerGroupSignature(g);
    const { host, state } = fixture([g]);
    const result = await runCareerPlan(host, { ...onlyEducation, bindings: [{ collection: 'educations', recordId: 'e-one', revision: 1,
      profileVersion: 4, groupId: g.id, groupSignature: g.signature }] });
    assert.equal(result.status, 'completed'); assert.deepEqual(result.pending, []); assert.equal(state.fills, 0); assert.equal(result.actionsAttempted, 0);
    assert.equal(state.observation.groups[0]!.fields[0]!.value, value);
  }
});

test('an unknown nonempty group yields partial rather than guessing a binding or deleting it', async () => {
  const g = group('existing', 'educations'); g.fields[0]!.value = '网页已有大学';
  const { host, state } = fixture([g]); const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.status, 'partial'); assert.equal(result.actionsAttempted, 0); assert.equal(state.adds, 0); assert.equal(state.fills, 0);
  assert.ok(result.pending.some(item => item.collection === 'educations' && /已有经历/.test(item.reason)));
});

test('explicit bindings preserve existing content and only fill empty fields', async () => {
  const g = group('existing', 'educations'); g.fields[0]!.value = '网页已保存的学校';
  const { host, state } = fixture([g]);
  const result = await runCareerPlan(host, { ...onlyEducation, bindings: [{ collection: 'educations', recordId: 'e-one', revision: 1, profileVersion: 4, groupId: g.id, groupSignature: g.signature }] });
  assert.equal(result.status, 'completed'); assert.equal(result.verified.length, 1); assert.equal(state.observation.groups[0]!.fields[0]!.value, '网页已保存的学校');
});

test('profile version or confirmed revision changing after intent stops before native input', async () => {
  for (const change of [(p: Profile) => { p.version++; }, (p: Profile) => { p.career!.educations[0]!.revision = 2; p.career!.educations[0]!.confirmedRevision = 2; }]) {
    const { host, state } = fixture([group('empty', 'educations')]); const journal = host.journal!;
    host.journal = event => { journal(event); if (event.phase === 'intent') change(state.profile); };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.stopReason, 'profile-changed'); assert.equal(state.fills, 0); assert.equal(result.actions[0]!.status, 'unknown');
  }
});

test('URL or generation changing after intent stops before input', async () => {
  for (const change of [(o: CareerFormObservation) => { o.url += '#another'; }, (o: CareerFormObservation) => { o.generation++; }]) {
    const { host, state } = fixture([group('empty', 'educations')]); const journal = host.journal!;
    host.journal = event => { journal(event); if (event.phase === 'intent') change(state.observation); };
    const result = await runCareerPlan(host, onlyEducation);
    assert.equal(result.stopReason, 'page-changed'); assert.equal(state.fills, 0);
  }
});

test('a changed field during asynchronous intent persistence cannot become a new implicit baseline', async () => {
  const { host, state } = fixture([group('empty', 'educations')]); const journal = host.journal!;
  host.journal = async event => { await journal(event); if (event.phase === 'intent') state.observation.groups[0]!.fields[0]!.value = '用户刚写入'; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'verification-failed'); assert.equal(state.fills, 0);
});

test('foreground loss prevents input and a returning focus is never retried by the runner', async () => {
  const { host, state } = fixture([group('empty', 'educations')]); let loseFocus = false; const journal = host.journal!;
  host.journal = event => { journal(event); if (event.phase === 'intent') loseFocus = true; };
  host.assertActive = () => { state.activeChecks++; if (loseFocus) { loseFocus = false; throw new Error('focus lost'); } };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'inactive'); assert.equal(state.fills, 0); assert.equal(result.actionsAttempted, 1);
});

test('an already aborted authorization never reads or mutates the host', async () => {
  const { host, state } = fixture(); const controller = new AbortController(); controller.abort(); host.signal = controller.signal;
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'aborted'); assert.equal(state.reads, 0); assert.equal(state.adds, 0); assert.equal(state.activeChecks, 0);
});

test('abort during a native action leaves that intent unknown and prevents all subsequent actions', async () => {
  const { host, state } = fixture([group('empty', 'educations')]); const controller = new AbortController(); host.signal = controller.signal;
  host.fill = async () => { state.fills++; controller.abort(); return { expectedValue: 'unused' }; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'aborted'); assert.equal(state.fills, 1); assert.equal(result.verified.length, 0); assert.equal(result.actions[0]!.status, 'unknown');
});

test('action budget counts consumed intents, then stops without another native action', async () => {
  const { host, state } = fixture(); const result = await runCareerPlan(host, { ...onlyEducation, maxActions: 1 });
  assert.equal(result.stopReason, 'action-limit'); assert.equal(result.added.length, 1); assert.equal(result.verified.length, 0); assert.equal(state.adds, 1); assert.equal(state.fills, 0);
  assert.equal(result.pending.filter(pending => pending.recordId === 'e-one' && pending.fieldId).length, 2);
});

test('wall-clock budget stops a stalled read without starting any action', async () => {
  const { host, state } = fixture(); host.read = () => new Promise(() => {});
  const result = await runCareerPlan(host, { ...onlyEducation, timeoutMs: 5 });
  assert.equal(result.stopReason, 'timeout'); assert.equal(result.actionsAttempted, 0); assert.equal(state.adds, 0);
});

test('a timeout cannot cancel an uncancellable host action but it never schedules a second action', async () => {
  const { host, state } = fixture([group('empty', 'educations')]); let finished = false;
  let entered!: () => void; let release!: () => void; let settled!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const completed = new Promise<void>(resolve => { settled = resolve; });
  host.fill = async () => { state.fills++; entered(); await pending; finished = true; settled(); return { expectedValue: 'late' }; };
  // Wait for the host action explicitly. An 8 ms total budget could previously
  // expire between its intent and invocation under parallel suite load.
  const running = runCareerPlan(host, { ...onlyEducation, timeoutMs: 1_000 });
  await Promise.race([started, running.then(() => assert.fail('host action must start before its timeout'))]);
  const result = await running;
  assert.equal(result.stopReason, 'timeout'); assert.equal(result.actions[0]!.status, 'unknown'); assert.equal(finished, false);
  release(); await completed; assert.equal(finished, true); assert.equal(state.fills, 1);
});

test('native driver errors stop safely and their raw message is not copied into journal results', async () => {
  const { host, state } = fixture([group('empty', 'educations')]);
  host.fill = async () => { state.fills++; throw new Error('PRIVATE_DRIVER_DETAIL'); };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'host-error'); assert.equal(state.fills, 1); assert.ok(!JSON.stringify(result).includes('PRIVATE_DRIVER_DETAIL'));
  assert.ok(!JSON.stringify(state.journal).includes('PRIVATE_DRIVER_DETAIL'));
});

test('failed intent persistence prevents the associated action from starting', async () => {
  const { host, state } = fixture([group('empty', 'educations')]);
  host.journal = event => { if (event.phase === 'intent') throw new Error('journal failure'); state.journal.push(event); };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'host-error'); assert.equal(state.fills, 0); assert.equal(result.actions[0]!.status, 'unknown');
});

test('a late change before the completion decision is not silently accepted as completed', async () => {
  const { host, state } = fixture([group('empty', 'educations', ['school'])]); const journal = host.journal!;
  host.journal = event => { journal(event); if (event.phase === 'result' && event.status === 'verified') state.observation.protectedFields[0]!.value = 'late-change@example.invalid'; };
  const result = await runCareerPlan(host, onlyEducation);
  assert.equal(result.stopReason, 'verification-failed'); assert.equal(result.verified.length, 1); assert.equal(state.fills, 1);
});

test('invalid action and time budgets are rejected before touching the host', async () => {
  const { host, state } = fixture();
  for (const maxActions of [0, 101, 1.5]) await assert.rejects(runCareerPlan(host, { maxActions }), /maxActions/);
  for (const timeoutMs of [0, -1, Infinity, 600001]) await assert.rejects(runCareerPlan(host, { timeoutMs }), /timeoutMs/);
  assert.equal(state.reads, 0); assert.equal(state.activeChecks, 0);
});

test('explicit preserve authorization survives the entire add/fill loop without writing or binding the preserved group', async () => {
  const existing = group('old-education', 'educations'); existing.fields[0]!.value = '网页已有学校'; existing.fields[1]!.value = '本科';
  const original = structuredClone(existing); const { host, state } = fixture([existing]);
  const result = await runCareerPlan(host, { ...onlyEducation, preserveGroupIds: [existing.id] });
  assert.equal(result.status, 'completed'); assert.equal(result.added.length, 1); assert.equal(result.verified.length, 2);
  assert.deepEqual(state.observation.groups[0], original); assert.equal(result.bindings.some(binding => binding.groupId === existing.id), false);
  assert.equal(result.verified.some(action => action.groupId === existing.id), false);
});

test('invalid preserve authorizations stop before any native action', async () => {
  const g = group('old-education', 'educations');
  for (const options of [{ preserveGroupIds: ['unknown'] }, { preserveGroupIds: [g.id, g.id] },
    { preserveGroupIds: [g.id], bindings: [{ collection: 'educations' as const, recordId: 'e-one', revision: 1, profileVersion: 4, groupId: g.id, groupSignature: g.signature }] }]) {
    const { host, state } = fixture([g]); const result = await runCareerPlan(host, { ...onlyEducation, ...options });
    assert.equal(result.status, 'stopped'); assert.equal(state.adds, 0); assert.equal(state.fills, 0);
  }
});
