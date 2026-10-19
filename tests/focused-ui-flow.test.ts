import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, EducationRecord, FillPlan, FillResult, Job } from '../packages/shared/src/contracts.js';
import { deriveApplyFlow, QuickFillInterrupted, runQuickFill, summarizeApplicationFill } from '../packages/ui/src/apply-flow.js';
import { confirmResumeForApplication } from '../packages/ui/src/resume-review.js';

const now = new Date('2026-10-17T03:00:00Z');
function world(): AppState {
  return { profile: { fullName: '虚构申请者', fullNameEn: '', email: '', phone: '', school: '测试大学', schoolEn: '', degree: '硕士', major: '计算机', majorEn: '', graduationMonth: '2027-06', skills: ['Python'], cities: ['杭州'], targetRoles: ['算法'], resumeText: '', version: 3, updatedAt: now.toISOString() }, jobs: [], applications: [], sourceRuns: [], settings: { showDemo: true } };
}
function job(id: string, changes: Partial<Job> = {}): Job {
  return { id, company: '虚构流程测试企业', title: `算法 ${id}`, city: '杭州', type: 'campus', requirements: '2027届，硕士，Python', description: '仅用于行为测试', url: `https://example.invalid/${id}`, sourceId: 'fixture', sourceName: '虚构来源', publishedAt: '2026-10-01', deadline: '2026-11-01', demo: false, firstSeenAt: now.toISOString(), observedAt: now.toISOString(), match: { score: 0, eligible: 'unsuitable', concerns: ['过时的缓存'], reasons: [], profileVersion: 1 }, ...changes };
}
function education(): EducationRecord {
  return { id: 'education', school: '测试大学', schoolEn: '', degree: '硕士', major: '计算机', majorEn: '', startDate: '2025-09', endDate: '2027-06', description: '', sourceNote: '', evidence: [], revision: 2, confirmation: 'pending', confirmedRevision: null, confirmedAt: null };
}

test('the focused path recomputes matches from the saved profile and excludes demo, expired and unsuitable records', () => {
  const state = world(); state.jobs = [job('current'), job('demo', { demo: true }), job('expired', { deadline: '2026-10-16' }), job('experienced', { type: 'experienced' })];
  const original = structuredClone(state);
  const view = deriveApplyFlow(state, now);
  assert.deepEqual(view.recommended.map(item => item.id), ['current']);
  assert.equal(view.recommended[0]!.match.profileVersion, 3);
  assert.equal(view.recommended[0]!.match.eligible, 'likely');
  assert.equal(view.libraryCount, 3, 'demo records never become real recommendations even when other pages show demo');
  assert.deepEqual(state, original, 'matching changes no stored job, application or profile');
  state.profile.cities = ['上海'];
  assert.deepEqual(deriveApplyFlow(state, now).recommended, [], 'a current profile change replaces old cached recommendation eligibility');
});

test('empty and fully unconfirmed profiles expose an honest empty step without inferring a primary education', () => {
  const state = world(); state.jobs = [job('candidate')]; state.profile.version = 0;
  assert.equal(deriveApplyFlow(state, now).profileReady, false);
  assert.deepEqual(deriveApplyFlow(state, now).recommended, []);
  state.profile.version = 4;
  state.profile.career = { schemaVersion: 1, sources: [], educations: [education()], internships: [], projects: [], publications: [], primaryEducationId: null };
  const unconfirmed = deriveApplyFlow(state, now);
  assert.equal(unconfirmed.awaitingAllConfirmation, true);
  assert.equal(unconfirmed.pendingCount, 1);
  assert.deepEqual(unconfirmed.recommended, []);
  state.profile.career.educations[0] = { ...education(), confirmation: 'confirmed', confirmedRevision: 2, confirmedAt: now.toISOString() };
  assert.equal(deriveApplyFlow(state, now).profileReady, true);
  assert.equal(state.profile.career.primaryEducationId, null, 'reading a confirmed education cannot make it the default');
  state.jobs = [];
  assert.equal(deriveApplyFlow(state, now).libraryCount, 0);
  assert.deepEqual(deriveApplyFlow(state, now).recommended, []);
});

function plan(changes: Partial<FillPlan> = {}): FillPlan {
  return { id: 'new-plan', url: 'https://example.invalid/application', profileVersion: 3, title: '虚构表单', createdAt: now.toISOString(), observationId: 'observed', items: [
    { fieldId: 'name', label: '姓名', status: 'ready', value: '虚构申请者', currentValue: '', reason: '确认资料' },
    { fieldId: 'email', label: '邮箱', status: 'skip', value: '', currentValue: 'already@example.invalid', reason: '保留已有值' },
    { fieldId: 'unknown', label: '个人问题', status: 'review', value: '', currentValue: '', reason: '需用户补充' },
    { fieldId: 'contradictory', label: '有值字段', status: 'ready', value: '新值', currentValue: '原有值', reason: '保留' },
  ], recognition: { mode: 'model', mappedCount: 1, message: '模型识别已完成', modelId: 'fixture' }, ...changes };
}
const context = { url: 'https://example.invalid/application', profileVersion: 3 };
test('one quick-fill click executes only ready blank IDs from its newly prepared plan and preserves the result counts', async () => {
  const calls: Array<[string, string[]]> = []; let preview: FillPlan | undefined;
  const next = plan(); const result: FillResult = { planId: next.id, verified: [{ fieldId: 'name', label: '姓名' }], unresolved: [] };
  const actual = await runQuickFill({ context, isCurrent: () => true, prepare: async () => next, fill: async (id, ids) => { calls.push([id, ids]); return result; }, onPreview: value => { preview = value; }, onFilling: () => {} });
  assert.equal(preview, next); assert.deepEqual(calls, [['new-plan', ['name']]]); assert.equal(actual.result, result); assert.equal(actual.filled, true);
});

test('only planner-proven select placeholders can be replaced when the current DOM value is nonempty', async () => {
  const fixture = plan();
  fixture.items.push({ fieldId: 'degree', label: '学历', status: 'ready', value: 'master', currentValue: '-1', currentValueIsPlaceholder: true, reason: '原生选项的已核对占位符' });
  fixture.items.push({ fieldId: 'saved-degree', label: '已填写学历', status: 'ready', value: 'master', currentValue: 'bachelor', reason: '已有实际选择' });
  let ids: string[] = [];
  await runQuickFill({ context, isCurrent: () => true, prepare: async () => fixture, onPreview: () => {}, onFilling: () => {}, fill: async (planId, selected) => { ids = selected; return { planId, verified: selected.map(fieldId => ({ fieldId, label: fieldId })), unresolved: [] }; } });
  assert.deepEqual(ids, ['name', 'degree']);
});

test('leaving the page, replacing the profile, or a mismatched prepared target stops before any fill', async () => {
  for (const change of ['leave', 'url', 'profile'] as const) {
    let active = true; let fills = 0; let previews = 0;
    await assert.rejects(runQuickFill({ context, isCurrent: () => active, prepare: async () => {
      if (change === 'leave') active = false;
      return plan(change === 'url' ? { url: 'https://example.invalid/other' } : change === 'profile' ? { profileVersion: 4 } : {});
    }, fill: async id => { fills++; return { planId: id, verified: [], unresolved: [] }; }, onPreview: () => { previews++; }, onFilling: () => {} }), QuickFillInterrupted);
    assert.equal(fills, 0); assert.equal(previews, 0);
  }
});

test('late navigation after displaying a plan cannot quietly continue with automatic fill', async () => {
  let active = true; let fills = 0;
  await assert.rejects(runQuickFill({ context, isCurrent: () => active, prepare: async () => plan(), onPreview: () => { active = false; }, onFilling: () => {}, fill: async id => { fills++; return { planId: id, verified: [], unresolved: [] }; } }), QuickFillInterrupted);
  assert.equal(fills, 0);
});

test('model fallback and missing values never silently turn into an automatic rules fill', async () => {
  let fills = 0; let previews = 0;
  await assert.rejects(runQuickFill({ context, isCurrent: () => true, prepare: async () => plan({ recognition: { mode: 'fallback', mappedCount: 0, message: '模型识别失败，请逐项核对' } }), onPreview: () => { previews++; }, onFilling: () => {}, fill: async id => { fills++; return { planId: id, verified: [], unresolved: [] }; } }), /模型识别失败/);
  assert.equal(previews, 1); assert.equal(fills, 0);
  const noReady = await runQuickFill({ context, isCurrent: () => true, prepare: async () => plan({ items: [] }), onPreview: () => {}, onFilling: () => {}, fill: async id => { fills++; return { planId: id, verified: [], unresolved: [] }; } });
  assert.equal(noReady.filled, false); assert.equal(fills, 0);
});

test('a result for a different plan never becomes claimed success', async () => {
  await assert.rejects(runQuickFill({ context, isCurrent: () => true, prepare: async () => plan(), onPreview: () => {}, onFilling: () => {}, fill: async () => ({ planId: 'other-plan', verified: [], unresolved: [] }) }), /结果与本次计划不一致/);
});

test('the application outcome keeps sensitive, consent and upload fields visible as human work', () => {
  const next = plan();
  next.items.push(
    { fieldId: 'private', label: '身份证号', status: 'skip', value: '', currentValue: '', reason: '敏感资料或验证码由你手动填写。' },
    { fieldId: 'consent', label: '同意隐私协议', status: 'skip', value: '', currentValue: 'on', reason: '声明、上传和按钮不自动操作。' },
    { fieldId: 'upload', label: '上传附件', status: 'skip', value: '', currentValue: '', reason: '声明、上传和按钮不自动操作。' },
  );
  const original = structuredClone(next);
  const summary = summarizeApplicationFill(next, { planId: next.id, verified: [{ fieldId: 'name', label: '姓名' }], unresolved: [] });
  assert.deepEqual(summary.filled.map(item => item.fieldId), ['name']);
  assert.deepEqual(summary.preserved.map(item => item.fieldId), ['email', 'contradictory']);
  assert.deepEqual(summary.needsUser.map(item => item.fieldId), ['unknown', 'private', 'consent', 'upload']);
  assert.match(summary.needsUser.find(item => item.fieldId === 'private')!.reason, /手动填写/);
  assert.deepEqual(next, original, 'summary never upgrades a skipped item or changes personal values');
});

test('partial and mismatched outcomes cannot conceal unverified fields or a planner-proven placeholder', () => {
  const next = plan();
  next.items.push({ fieldId: 'degree', label: '学历', status: 'ready', value: 'master', currentValue: '-1', currentValueIsPlaceholder: true, reason: '已核对选项' });
  const summary = summarizeApplicationFill(next, { planId: next.id, verified: [], unresolved: [{ fieldId: 'name', label: '姓名', reason: '网页重读未通过' }] });
  assert.equal(summary.filled.length, 0);
  assert.equal(summary.needsUser.find(item => item.fieldId === 'name')!.reason, '网页重读未通过');
  assert.match(summary.needsUser.find(item => item.fieldId === 'degree')!.reason, /尚未核实/);
  const unrelated = summarizeApplicationFill(next, { planId: 'old-plan', verified: [{ fieldId: 'name', label: '姓名' }], unresolved: [] });
  assert.equal(unrelated.filled.length, 0);
  assert.ok(unrelated.needsUser.some(item => item.fieldId === 'name'));
});

test('stopping recognition ignores a late successful model response and never invokes filling', async () => {
  let active = true; let previews = 0; let fills = 0;
  let complete!: (value: FillPlan) => void;
  const prepared = new Promise<FillPlan>(resolve => { complete = resolve; });
  const running = runQuickFill({ context, isCurrent: () => active, prepare: () => prepared,
    onPreview: () => { previews++; }, onFilling: () => { assert.fail('cancelled recognition cannot enter filling'); },
    fill: async id => { fills++; return { planId: id, verified: [], unresolved: [] }; } });
  active = false;
  complete(plan());
  await assert.rejects(running, QuickFillInterrupted);
  assert.equal(previews, 0); assert.equal(fills, 0);
});

test('the short resume review confirms only the explicitly selected education and chains current versions', async () => {
  const initial = world(); initial.profile.career = { schemaVersion: 1, sources: [], educations: [education(), { ...education(), id: 'other', school: '另一测试学校' }], internships: [], projects: [], publications: [], primaryEducationId: null };
  initial.profile.career.sources = [{ id: 'resume-source', kind: 'resume', label: '虚构材料', text: '测试大学 硕士 2027-06', fileName: 'fixture.txt', fileHash: 'fixture-hash', createdAt: now.toISOString() }];
  initial.profile.career.educations[0]!.evidence = [{ field: 'school', sourceId: 'resume-source', quote: '测试大学 硕士 2027-06', location: '教育段第1行', originalValue: '测试大学' }];
  let saved = structuredClone(initial); const calls: string[] = []; const published: AppState[] = [];
  const updated = await confirmResumeForApplication({ state: initial, draft: initial.profile, dirty: true, expectedVersion: 3, educationId: 'education', onSaved: value => { published.push(value); }, api: {
    saveProfile: async (profile, version) => { calls.push(`save:${version}:${profile.career?.primaryEducationId}`); assert.equal(version, saved.profile.version); saved = { ...saved, profile: { ...saved.profile, ...profile, career: { ...saved.profile.career!, primaryEducationId: profile.career?.primaryEducationId ?? null }, version: saved.profile.version + 1 } }; return saved; },
    confirmCareerRecord: async (collection, id, version, revision) => { calls.push(`confirm:${collection}:${id}:${version}:${revision}`); assert.equal(version, 4); saved = { ...saved, profile: { ...saved.profile, version: 5, career: { ...saved.profile.career!, educations: saved.profile.career!.educations.map(item => item.id === id ? { ...item, confirmation: 'confirmed', confirmedRevision: item.revision, confirmedAt: now.toISOString() } : item) } } }; return saved; },
  } });
  assert.deepEqual(calls, ['save:3:null', 'confirm:educations:education:4:2', 'save:5:education']);
  assert.equal(updated.profile.version, 6); assert.equal(published.length, 3);
  assert.equal(updated.profile.career!.primaryEducationId, 'education');
  assert.equal(updated.profile.career!.educations.find(item => item.id === 'other')!.confirmation, 'pending');
  assert.deepEqual(updated.profile.career!.sources, initial.profile.career.sources);
  assert.deepEqual(updated.profile.career!.educations[0]!.evidence, initial.profile.career.educations[0]!.evidence, 'short confirmation retains source text and record evidence');
  assert.equal(initial.profile.career.educations[0]!.confirmation, 'pending', 'input snapshots and other histories remain unchanged');
});

test('the short resume review does not guess an education and never advances after a failed confirmation', async () => {
  const initial = world(); initial.profile.career = { schemaVersion: 1, sources: [], educations: [education()], internships: [], projects: [], publications: [], primaryEducationId: null };
  let saves = 0; let confirmations = 0; let lastSaved: AppState | undefined;
  const api = {
    saveProfile: async () => { saves++; return { ...initial, profile: { ...initial.profile, version: 4 } }; },
    confirmCareerRecord: async () => { confirmations++; throw new Error('资料修订冲突'); },
  };
  await assert.rejects(confirmResumeForApplication({ state: initial, draft: initial.profile, dirty: true, expectedVersion: 3, educationId: '', onSaved: value => { lastSaved = value; }, api }), /明确选择/);
  assert.equal(saves, 0); assert.equal(confirmations, 0);
  await assert.rejects(confirmResumeForApplication({ state: initial, draft: initial.profile, dirty: true, expectedVersion: 3, educationId: 'education', onSaved: value => { lastSaved = value; }, api }), /资料修订冲突/);
  assert.equal(saves, 1, 'the failed confirm cannot proceed to the default-education save'); assert.equal(confirmations, 1);
  assert.equal(lastSaved?.profile.version, 4, 'the successfully saved draft is retained for the UI to retry');
  assert.equal(lastSaved?.profile.career?.primaryEducationId, null);
});

test('an existing confirmed default education is reused without creating new confirmations or profile versions', async () => {
  const initial = world(); initial.profile.career = { schemaVersion: 1, sources: [], educations: [{ ...education(), confirmation: 'confirmed', confirmedRevision: 2, confirmedAt: now.toISOString() }], internships: [], projects: [], publications: [], primaryEducationId: 'education' };
  const updated = await confirmResumeForApplication({ state: initial, draft: initial.profile, dirty: false, expectedVersion: 3, educationId: 'education', onSaved: () => { assert.fail('no update expected'); }, api: { saveProfile: async () => { throw new Error('unexpected save'); }, confirmCareerRecord: async () => { throw new Error('unexpected confirmation'); } } });
  assert.equal(updated, initial);
});
