import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationWorkflowStore, removeApplicationWorkflows, resolveApplicationWorkflowTarget } from '../packages/domain/src/application-workflow.js';
import { openDatabaseFile, readDocument, readDocuments, writeDocument, type DatabaseFile } from '../packages/domain/src/sqlite.js';
import { createStore } from '../packages/domain/src/store.js';
import { pickCareerInput } from '../packages/profile/src/career-input.js';
import type { AppState, Application, FillPlan, FillResult, Job, Profile } from '../packages/shared/src/contracts.js';
import type { CareerFillOutcome, CareerFillPreview } from '../packages/shared/src/career-form.js';
import type { ApplicationWorkflow, ApplicationWorkflowTarget } from '../packages/shared/src/application-workflow.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import { applicationIssueEditable, applicationIssueFactDraft, applicationIssueFactLocation, applicationWorkflowDirtyIssues, applicationWorkflowRecordHasDraft } from '../packages/shared/src/application-workflow.js';

const url = 'https://example.invalid/campus/resume/fictional/apply';
const target: ApplicationWorkflowTarget = { url, profileVersion: 1 };
function profile() {
  const value = createCareerFormFixtureProfile();
  value.career!.internships[0]!.role = ''; value.career!.internships[0]!.endDate = '';
  value.career!.projects.forEach(record => { record.role = ''; record.url = ''; });
  return value;
}
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-workflow-test-'));
  let file = await openDatabaseFile({ directory });
  await file.transact(db => writeDocument(db, 'profile', 'current', profile(), '2026-10-19T00:00:00Z'));
  t.after(async () => { await file.close(); await rm(directory, { recursive: true, force: true }); });
  return { file, store: createApplicationWorkflowStore(file), reopen: async () => { await file.close(); file = await openDatabaseFile({ directory }); return { file, store: createApplicationWorkflowStore(file) }; } };
}
function ordinaryPlan(id = 'ordinary-plan', items?: FillPlan['items']): FillPlan {
  return { id, url, profileVersion: 1, title: '不应持久化的原始网页标题', observationId: 'fictional-observation', createdAt: '2026-10-19T00:00:00Z', items: items ?? [
    { fieldId: 'field-1', label: '不应保存的字段原文', value: 'private-contact-value', currentValue: '', status: 'ready', reason: '原始原因含 private-token-do-not-save', profileKey: 'email' },
  ] };
}
const result = (id = 'ordinary-plan'): FillResult => ({ planId: id, verified: [{ fieldId: 'field-1', label: '忽略原始标签' }], unresolved: [] });
function careerPreview(id = 'career-plan'): CareerFillPreview {
  const value = profile();
  return { planId: id, url, profileVersion: 1, groups: [], bindings: [], preserveGroupIds: [], issues: [],
    selectedRecordIds: { educations: value.career!.educations.map(record => record.id), internships: value.career!.internships.map(record => record.id), projects: value.career!.projects.map(record => record.id) },
    steps: ['educations', 'internships', 'projects'].flatMap(collection => value.career![collection as 'educations'].map(record => ({ kind: 'add-then-reobserve' as const, collection: collection as 'educations', recordId: record.id }))) };
}
function sixPending(): CareerFillOutcome {
  const value = profile();
  return { status: 'partial', verifiedCount: 21, addedCount: 4, bindings: [], pending: [
    { collection: 'internships', recordId: value.career!.internships[0]!.id, fieldId: 'internship[0].role', key: 'role', required: true, reason: 'raw private reason' },
    { collection: 'internships', recordId: value.career!.internships[0]!.id, fieldId: 'internship[0].end', key: 'endDate', required: true, reason: 'raw private reason' },
    ...value.career!.projects.flatMap((record, index) => ['role', 'url'].map(key => ({ collection: 'projects' as const, recordId: record.id, fieldId: `project[${index}].${key}`, key, required: key === 'role', reason: 'raw private reason' }))),
  ] };
}
function app(id: string, jobId?: string): Application { return { id, company: '虚构公司', title: '虚构岗位', url, status: 'saved', deadline: null, notes: '', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', demo: true, history: [], ...(jobId ? { jobId } : {}) }; }
function state(): AppState { return { profile: profile(), jobs: [], applications: [], sourceRuns: [], settings: { showDemo: false } }; }

test('workflow exact target rejects absent, credential and ambiguous URLs, never matches by company or URL prefix', () => {
  const value = state();
  for (const invalid of ['', 'not-a-url', 'file:///tmp/apply', 'https://user:password@example.invalid/apply', `${url}?token=private`]) assert.throws(() => resolveApplicationWorkflowTarget(value, invalid));
  value.applications = [app('first'), app('second')];
  assert.throws(() => resolveApplicationWorkflowTarget(value, url), /多条申请/);
  assert.deepEqual(resolveApplicationWorkflowTarget(value, url, { applicationId: 'first' }), { ...target, applicationId: 'first' });
  assert.throws(() => resolveApplicationWorkflowTarget(value, `${url}/other`, { applicationId: 'first' }));
  assert.deepEqual(resolveApplicationWorkflowTarget(value, `${url}/other`), { url: `${url}/other`, profileVersion: 1 });
});

test('workflow records use the same SQLite file and never mutate candidate/job/application documents', async t => {
  const { file, store } = await fixture(t);
  const before = await file.read(db => JSON.stringify(readDocuments(db, 'profile')));
  await store.recordOrdinaryPlan(target, ordinaryPlan()); await store.recordOrdinaryResult(target, ordinaryPlan(), result());
  assert.equal(await file.read(db => JSON.stringify(readDocuments(db, 'profile'))), before);
  assert.equal(await file.read(db => readDocuments(db, 'application').length), 0);
  assert.equal((await store.workflowState()).workflows.length, 1);
  await file.transact(db => writeDocument(db, 'another_module', 'same-owner', { preserved: true }, new Date().toISOString()));
  assert.deepEqual(await file.read(db => readDocument(db, 'another_module', 'same-owner')), { preserved: true });
});

test('ordinary result requires current observed plan, unique intended fields and consumes its local evidence once', async t => {
  const { store } = await fixture(t); const plan = ordinaryPlan();
  await assert.rejects(store.recordOrdinaryResult(target, plan, result()), /本次普通/);
  await store.recordOrdinaryPlan(target, plan);
  await assert.rejects(store.recordOrdinaryResult(target, plan, { planId: plan.id, verified: [{ fieldId: 'field-99', label: '' }], unresolved: [] }), /本次观察/);
  await assert.rejects(store.recordOrdinaryResult(target, plan, { planId: plan.id, verified: [...result().verified, ...result().verified], unresolved: [] }), /本次观察/);
  const saved = await store.recordOrdinaryResult(target, plan, result());
  assert.equal(saved.sections.find(section => section.key === 'contact')!.progress, 'verified');
  await assert.rejects(store.recordOrdinaryResult(target, plan, result()), /本次普通/);
});

test('issue persistence retains bounded real question labels but excludes values, page title and raw failure messages', async t => {
  const { file, store } = await fixture(t);
  const plan = ordinaryPlan(); await store.recordOrdinaryPlan(target, plan);
  await store.recordOrdinaryResult(target, plan, { planId: plan.id, verified: [], unresolved: [{ fieldId: 'field-1', label: 'private-label', reason: 'private-provider-secret' }] });
  const raw = await file.read(db => JSON.stringify(readDocuments(db, 'application_workflow')));
  for (const forbidden of ['private-contact-value', 'private-token-do-not-save', 'private-label', 'private-provider-secret', plan.title]) assert.equal(raw.includes(forbidden), false);
  const issue = (await store.workflowState()).workflows[0]!.issues[0]!;
  assert.equal(issue.reasonCode, 'verification-failed'); assert.equal(issue.required, null); assert.equal(issue.readbackVerified, false);
  assert.equal(issue.label, plan.items[0]!.label);
});

test('unknown ordinary field issues stay distinct and unknown requiredness is never made optional', async t => {
  const { store } = await fixture(t);
  const plan = ordinaryPlan('unknown-plan', [1, 2].map(index => ({ fieldId: `field-${index}`, label: 'unknown', value: '', currentValue: '', status: 'review', reason: '' })));
  const saved = await store.recordOrdinaryPlan(target, plan);
  assert.equal(saved.issues.length, 2); assert(saved.issues.every(issue => issue.required === null));
});

test('fresh matching contact contents resolve an old gap without another write or a fabricated execution count', async t => {
  const { store } = await fixture(t);
  const original = ordinaryPlan(); await store.recordOrdinaryPlan(target, original);
  await store.recordOrdinaryResult(target, original, { planId: original.id, verified: [], unresolved: [{ fieldId: 'field-1', label: '', reason: 'fixed' }] });
  const fresh = ordinaryPlan('fresh-existing-contact', [{ fieldId: 'field-1', profileKey: 'email', label: original.items[0]!.label, value: '', currentValue: profile().email, status: 'skip', reason: '已有值，保留网页当前内容。' }]);
  const saved = await store.recordOrdinaryPlan(target, fresh);
  assert.equal(saved.issues[0]!.status, 'resolved'); assert.equal(saved.issues[0]!.resolutionEvidence, 'fresh-observation');
  assert.equal(saved.lastExecution!.verifiedCount, 0);
});

test('fresh existing career fact resolves only with the exact confirmed record, group and signature', async t => {
  const { store, file } = await fixture(t); const current = profile(); current.career!.internships[0]!.role = '算法实习生';
  await file.transact(db => writeDocument(db, 'profile', 'current', current, '2026-10-19T00:00:00Z'));
  const record = current.career!.internships[0]!, groupId = 'internship[0]', fieldId = 'internship[0].title', groupSignature = 'a'.repeat(64);
  const preview: CareerFillPreview = { ...careerPreview('original-precise-field'),
    groups: [{ id: groupId, collection: 'internships', signature: groupSignature, fields: [{ id: fieldId, key: 'role', type: 'text', editable: true, required: true, value: '', signature: 'b'.repeat(64) }] }],
    bindings: [{ collection: 'internships', recordId: record.id, groupId, groupSignature, revision: record.revision, profileVersion: 1 }],
    steps: [{ kind: 'fill-group', collection: 'internships', recordId: record.id, groupId,
      items: [{ fieldId, key: 'role', currentValue: '', value: '', status: 'review', reason: '尚未核实' }] }], selectedRecordIds: { internships: [record.id] } };
  const gap = await store.recordCareerPreview(target, preview), issue = gap.issues[0]!;
  assert.equal(issue.groupId, groupId); assert.equal(issue.fieldId, fieldId); assert.equal(issue.fieldType, 'text');
  assert.equal(issue.fieldSignature, 'b'.repeat(64)); assert.equal(issue.groupSignature, groupSignature);
  const fresh = structuredClone(preview); fresh.planId = 'fresh-precise-field';
  fresh.groups[0]!.fields[0]!.value = record.role; Object.assign(fresh.steps[0]!.items![0]!, { status: 'skip', currentValue: record.role });
  const wrong = structuredClone(fresh); wrong.planId = 'fresh-wrong-binding'; wrong.bindings[0]!.groupSignature = 'c'.repeat(64);
  const uncertain = await store.recordCareerPreview(target, wrong); assert.equal(uncertain.issues[0]!.status, 'open');
  const fixed = await store.recordCareerPreview(target, fresh);
  assert.equal(fixed.issues.find(item => item.id === issue.id)!.status, 'resolved');
  assert.equal(fixed.issues.find(item => item.id === issue.id)!.resolutionEvidence, 'fresh-observation');
  assert.equal(fixed.lastExecution, undefined, 'a fresh existing value is not claimed as a new fill execution');
  assert.equal(fixed.sections.find(section => section.key === 'internships')!.verifiedFields, 0);
});

test('career section warnings remain section notices with a clear label and no missing-fact edit', async t => {
  const { store } = await fixture(t); const preview = { ...careerPreview('unbound-warning'), steps: [], issues: [{ collection: 'internships' as const, reason: '页面对应尚不明确' }] };
  const saved = await store.recordCareerPreview(target, preview), notice = saved.issues[0]!;
  assert.equal(notice.scope, 'section'); assert.equal(notice.required, null); assert.equal(notice.reasonCode, 'unbound-record');
  assert.equal(notice.label, '经历与网页对应关系'); assert.equal(applicationIssueEditable(notice), false);
});

test('readonly reconciliation never registers or preserves a runnable plan and does not write candidate or application facts', async t => {
  const { store, file } = await fixture(t); const plan = ordinaryPlan('old-write-plan');
  await store.recordOrdinaryPlan(target, plan);
  const before = await file.read(db => JSON.stringify({ profiles: readDocuments(db, 'profile'), applications: readDocuments(db, 'application') }));
  const observed = await store.reconcileReadOnly(target, { ordinary: ordinaryPlan('readonly-no-authority') });
  assert.equal(observed.pendingPlan, undefined);
  await assert.rejects(store.startWorkflow(target), /重新观察页面并生成新计划/u);
  await assert.rejects(store.recordOrdinaryResult(target, plan, result(plan.id)), /本次普通填写计划/u);
  await assert.rejects(store.recordOrdinaryResult(target, ordinaryPlan('readonly-no-authority'), result('readonly-no-authority')), /本次普通填写计划/u);
  assert.equal(await file.read(db => JSON.stringify({ profiles: readDocuments(db, 'profile'), applications: readDocuments(db, 'application') })), before);
});

test('contacts-only or empty career re-observation folds old unchosen issues without resolving or verifying them', async t => {
  const { store } = await fixture(t); const preview = careerPreview();
  await store.recordCareerPreview(target, preview); await store.recordCareerOutcome(target, preview, sixPending());
  const contactOnly = await store.reconcileReadOnly(target, { ordinary: ordinaryPlan('contacts-only') });
  assert.equal(contactOnly.issues.filter(issue => issue.status === 'open').length, 6);
  assert(contactOnly.issues.every(issue => issue.attentionState === 'not-reobserved' && !issue.readbackVerified && !issue.resolvedAt));
  const empty = { ...careerPreview('empty-readonly'), selectedRecordIds: {}, steps: [] };
  const emptyObserved = await store.reconcileReadOnly(target, { career: empty });
  assert.equal(emptyObserved.issues.filter(issue => issue.status === 'open').length, 6);
  assert(emptyObserved.issues.every(issue => issue.attentionState === 'not-reobserved' && !issue.readbackVerified));
  assert.equal(emptyObserved.lastExecution!.verifiedCount, 21, 'historical execution count remains historical, not a new verification');
});

test('readonly precise re-observation refreshes a real missing field while leaving unselected records as historical', async t => {
  const { store } = await fixture(t); const original = careerPreview();
  await store.recordCareerPreview(target, original); const prior = await store.recordCareerOutcome(target, original, sixPending());
  const internship = profile().career!.internships[0]!;
  const fresh: CareerFillPreview = { ...careerPreview('read-one-internship'), selectedRecordIds: { internships: [internship.id] }, issues: [],
    groups: [{ id: 'internship[0]', collection: 'internships', signature: 'a'.repeat(64), fields: [{ id: 'internship[0].title', key: 'role', type: 'text', value: '', editable: true, required: true, signature: 'b'.repeat(64) }] }],
    bindings: [{ collection: 'internships', recordId: internship.id, revision: internship.revision, profileVersion: 1, groupId: 'internship[0]', groupSignature: 'a'.repeat(64) }],
    steps: [{ kind: 'fill-group', collection: 'internships', recordId: internship.id, groupId: 'internship[0]', items: [{ fieldId: 'internship[0].title', key: 'role', value: '', currentValue: '', status: 'review', reason: '该条已确认经历没有此项资料，不推测补齐。' }] }] };
  const observed = await store.reconcileReadOnly(target, { career: fresh });
  const role = observed.issues.find(issue => issue.collection === 'internships' && issue.profileField === 'role')!;
  assert.equal(role.attentionState, 'current'); assert.equal(role.fieldId, 'internship[0].title'); assert.equal(role.status, 'open');
  assert.equal(observed.issues.filter(issue => issue.attentionState === 'not-reobserved').length, prior.issues.length - 1);
  await assert.rejects(store.recordCareerOutcome(target, fresh, { status: 'completed', verifiedCount: 0, addedCount: 0, pending: [], bindings: [] }), /本次经历填写计划/u);
});

test('readonly observations reject stale targets and in-flight runs instead of replacing active evidence', async t => {
  const { store } = await fixture(t); const plan = ordinaryPlan('active-write-plan');
  await store.recordOrdinaryPlan(target, plan); await store.startWorkflow(target); const before = await store.workflowState();
  await assert.rejects(store.reconcileReadOnly(target, { ordinary: ordinaryPlan('cannot-reconcile-running') }), /正在填写/u);
  assert.deepEqual(await store.workflowState(), before);
  await store.finishWorkflow(target);
  await assert.rejects(store.reconcileReadOnly({ ...target, profileVersion: 2 }, { ordinary: { ...ordinaryPlan('stale-target'), profileVersion: 2 } }), /资料已变化/u);
});

test('six known missing career facts persist separately, deduplicate and survive an empty observation', async t => {
  const { store } = await fixture(t); const preview = careerPreview();
  await store.recordCareerPreview(target, preview);
  let saved = await store.recordCareerOutcome(target, preview, sixPending());
  assert.equal(saved.issues.filter(issue => issue.status === 'open').length, 6);
  assert(saved.issues.every(issue => issue.reasonCode === 'missing-profile' && !issue.readbackVerified));
  assert.equal(saved.issues.filter(issue => issue.required === false).length, 2);
  const again = careerPreview('second-career-plan'); await store.recordCareerPreview(target, again);
  saved = await store.recordCareerOutcome(target, again, sixPending()); assert.equal(saved.issues.length, 6);
  const empty = { ...careerPreview('observation-only'), selectedRecordIds: {}, steps: [] };
  saved = await store.recordCareerPreview(target, empty); assert.equal(saved.issues.filter(issue => issue.status === 'open').length, 6);
  assert(saved.sections.filter(section => section.key !== 'other' && section.key !== 'contact').every(section => section.progress !== 'verified'));
});

test('renderer can dismiss/reopen an issue but cannot claim resolved or verified', async t => {
  const { store } = await fixture(t); const plan = ordinaryPlan('missing-email', [{ fieldId: 'field-1', profileKey: 'email', label: '', status: 'review', value: '', currentValue: '', reason: '' }]);
  await store.recordOrdinaryPlan(target, plan); await store.finishWorkflow(target);
  const workflow = (await store.workflowState()).workflows[0]!, issue = workflow.issues[0]!;
  await assert.rejects(store.setApplicationIssueStatus({ workflowId: workflow.id, issueId: issue.id, status: 'resolved' } as never), /参数无效/);
  let saved = await store.setApplicationIssueStatus({ workflowId: workflow.id, issueId: issue.id, status: 'dismissed' });
  assert.equal(saved.workflows[0]!.issues[0]!.readbackVerified, false);
  saved = await store.setApplicationIssueStatus({ workflowId: workflow.id, issueId: issue.id, status: 'open' });
  assert.equal(saved.workflows[0]!.issues[0]!.status, 'open');
  const fresh = ordinaryPlan('fresh-proof'); await store.recordOrdinaryPlan(target, fresh); await store.recordOrdinaryResult(target, fresh, result('fresh-proof'));
  assert.equal((await store.workflowState()).workflows[0]!.issues[0]!.status, 'resolved');
});

test('new process makes running work unknown, clears pending evidence, and cannot replay the old result', async t => {
  const setup = await fixture(t); const plan = ordinaryPlan(); await setup.store.recordOrdinaryPlan(target, plan);
  await setup.store.startWorkflow(target);
  const next = await setup.reopen(); const saved = (await next.store.workflowState()).workflows[0]!;
  assert.equal(saved.status, 'interrupted'); assert.equal(saved.pendingPlan, undefined);
  assert.equal(saved.sections.find(section => section.key === 'contact')!.progress, 'unknown');
  assert(saved.issues.some(issue => issue.reasonCode === 'interrupted' && issue.scope === 'application'));
  await assert.rejects(next.store.recordOrdinaryResult(target, plan, result()), /本次普通/);
});

test('reopening and repeated readonly state reads preserve finished verified history', async t => {
  const setup = await fixture(t); const plan = ordinaryPlan();
  await setup.store.recordOrdinaryPlan(target, plan); await setup.store.recordOrdinaryResult(target, plan, result());
  const before = await setup.store.workflowState(); const next = await setup.reopen();
  assert.deepEqual(await next.store.workflowState(), before); assert.deepEqual(await next.store.workflowState(), before);
});

test('stale profile/page evidence cannot alter saved workflow; new version needs a new plan', async t => {
  const { file, store } = await fixture(t); const plan = ordinaryPlan(); await store.recordOrdinaryPlan(target, plan);
  const before = await store.workflowState();
  await file.transact(db => { const current = readDocument<Profile>(db, 'profile', 'current')!; current.version = 2; writeDocument(db, 'profile', 'current', current, new Date().toISOString()); });
  await assert.rejects(store.recordOrdinaryResult(target, plan, result()), /资料已变化/);
  assert.deepEqual(await store.workflowState(), before);
  await assert.rejects(store.recordOrdinaryPlan({ ...target, profileVersion: 2 }, plan), /目标不一致/);
  const currentPlan = { ...ordinaryPlan('new-version'), profileVersion: 2 };
  await store.recordOrdinaryPlan({ ...target, profileVersion: 2 }, currentPlan);
  const current = await store.recordOrdinaryResult({ ...target, profileVersion: 2 }, currentPlan, result('new-version'));
  assert.equal(current.target.profileVersion, 2);
});

test('foreign career records cannot inject an editable issue or become verified', async t => {
  const { store } = await fixture(t); const preview = careerPreview(); await store.recordCareerPreview(target, preview);
  const outcome = sixPending(); outcome.pending[0]!.recordId = 'unselected-foreign-record';
  await assert.rejects(store.recordCareerOutcome(target, preview, outcome), /本次选中/);
});

test('profile repair drafts target precisely the missing fact and do not include confirmation metadata', async t => {
  const { store } = await fixture(t); const preview = careerPreview(); await store.recordCareerPreview(target, preview);
  const workflow = await store.recordCareerOutcome(target, preview, sixPending());
  const value = state();
  for (const issue of workflow.issues) {
    const text = issue.profileField === 'endDate' ? '2026-08' : issue.profileField === 'url' ? 'https://example.invalid/confirmed-project' : '本人确认的职务';
    const draft = applicationIssueFactDraft(value, issue, text);
    const original = value.profile.career![issue.collection!].find(record => record.id === issue.recordId)!;
    const patched = draft.career![issue.collection!].find(record => record.id === issue.recordId)!;
    assert.equal((patched as unknown as Record<string, unknown>)[issue.profileField!], text);
    assert.equal((original as unknown as Record<string, unknown>)[issue.profileField!], '');
    assert.equal('confirmation' in patched, false); assert.equal('confirmedRevision' in patched, false);
    assert.equal(draft.career!.primaryEducationId, value.profile.career!.primaryEducationId);
  }
  const date = workflow.issues.find(issue => issue.profileField === 'endDate')!;
  assert.throws(() => applicationIssueFactDraft(value, date, '以后再填'));
});

test('application deletion removes only its own workflow in the same transaction', async t => {
  const { file, store } = await fixture(t);
  await file.transact(db => writeDocument(db, 'application', 'app-one', app('app-one'), new Date().toISOString()));
  const linked = { ...target, applicationId: 'app-one' }; await store.recordOrdinaryPlan(linked, ordinaryPlan()); await store.recordOrdinaryResult(linked, ordinaryPlan(), result());
  await file.transact(db => { removeApplicationWorkflows(db, 'other-app'); });
  assert.equal((await store.workflowState()).workflows.length, 1);
  await file.transact(db => { removeApplicationWorkflows(db, 'app-one'); });
  assert.equal((await store.workflowState()).workflows.length, 0);
});

test('a confirmed answer-bank ready item without profileKey closes only its own question', async t => {
  const { store } = await fixture(t);
  const initial = ordinaryPlan('bank-before', [
    { fieldId: 'field-2', label: '为什么选择本岗位？', value: '', currentValue: '', status: 'review', reason: '' },
    { fieldId: 'field-3', label: '什么时候可以到岗？', value: '', currentValue: '', status: 'review', reason: '' },
  ]);
  await store.recordOrdinaryPlan(target, initial); await store.finishWorkflow(target);
  const ready = ordinaryPlan('bank-after', [
    { fieldId: 'field-17', label: '为什么选择本岗位？', value: '用户已确认的本地答案，不应写入workflow', currentValue: '', status: 'ready', reason: '' },
    { fieldId: 'field-18', label: '什么时候可以到岗？', value: '', currentValue: '', status: 'review', reason: '' },
  ]);
  await store.recordOrdinaryPlan(target, ready);
  const saved = await store.recordOrdinaryResult(target, ready, { planId: ready.id, verified: [{ fieldId: 'field-17', label: '' }], unresolved: [] });
  assert.equal(saved.issues.length, 2);
  assert.equal(saved.issues.find(issue => issue.label.startsWith('为什么'))!.status, 'resolved');
  assert.equal(saved.issues.find(issue => issue.label.startsWith('什么时候'))!.status, 'open');
  assert.equal(JSON.stringify(saved).includes(ready.items[0]!.value), false);
});

test('one verified ordinary item cannot complete a section with another ready item still unfilled', async t => {
  const { store } = await fixture(t);
  const plan = ordinaryPlan('two-contacts', [...ordinaryPlan().items, { fieldId: 'field-2', label: '电话', profileKey: 'phone', value: 'fictional-phone', currentValue: '', status: 'ready', reason: '' }]);
  await store.recordOrdinaryPlan(target, plan);
  const saved = await store.recordOrdinaryResult(target, plan, result('two-contacts'));
  assert.equal(saved.sections.find(section => section.key === 'contact')!.progress, 'needs-user');
  assert(saved.issues.some(issue => issue.profileField === 'phone' && issue.reasonCode === 'not-yet-filled' && !issue.readbackVerified));
});

test('aggregate career count cannot resolve a missing fact without the matching journal proof', async t => {
  const { store } = await fixture(t); const initial = careerPreview();
  await store.recordCareerPreview(target, initial); const pending = await store.recordCareerOutcome(target, initial, sixPending());
  const issue = pending.issues.find(item => item.collection === 'projects' && item.profileField === 'role')!;
  const ready: CareerFillPreview = { ...careerPreview('ready-role'), steps: [{ kind: 'fill-group', collection: 'projects', recordId: issue.recordId!, groupId: 'project[0]',
    items: [{ fieldId: 'project[0].role', key: 'role', value: '已确认角色', currentValue: '', status: 'ready', reason: '' }] }] };
  await store.recordCareerPreview(target, ready);
  const aggregate = await store.recordCareerOutcome(target, ready, { status: 'completed', verifiedCount: 999, addedCount: 0, pending: [], bindings: [] });
  assert.equal(aggregate.issues.find(item => item.id === issue.id)!.status, 'open');
  assert.equal(aggregate.sections.find(item => item.key === 'projects')!.verifiedFields, 0);
  const proven = { ...ready, planId: 'journal-proven-role' }; await store.recordCareerPreview(target, proven);
  const actual = await store.recordCareerOutcome(target, proven, { status: 'partial', verifiedCount: 1, addedCount: 0, pending: [], bindings: [] }, [{ collection: 'projects', recordId: issue.recordId!, key: 'role' }]);
  assert.equal(actual.issues.find(item => item.id === issue.id)!.status, 'resolved');
  assert.equal(actual.sections.find(item => item.key === 'projects')!.verifiedFields, 1);
});

test('an unexecuted preview stays idle and reopening clears its plan without declaring a write interruption', async t => {
  const setup = await fixture(t);
  const plan = ordinaryPlan('read-only-preview', [{ fieldId: 'field-1', label: '姓名', profileKey: 'fullName', value: '', currentValue: '', status: 'review', reason: '' }]);
  const observed = await setup.store.recordOrdinaryPlan(target, plan);
  assert.equal(observed.status, 'idle'); assert(observed.pendingPlan);
  const issue = observed.issues[0]!;
  await setup.store.setApplicationIssueStatus({ workflowId: observed.id, issueId: issue.id, status: 'dismissed' });
  const next = await setup.reopen(); const reopened = (await next.store.workflowState()).workflows[0]!;
  assert.equal(reopened.status, 'idle'); assert.equal(reopened.pendingPlan, undefined);
  assert.equal(reopened.issues.some(item => item.reasonCode === 'interrupted'), false);
  await assert.rejects(next.store.startWorkflow(target), /重新观察/);
});

test('existing ordinary contents are retained without inventing a verified field', async t => {
  const { store } = await fixture(t);
  const plan = ordinaryPlan('existing-value', [{ fieldId: 'field-1', label: '邮箱', profileKey: 'email', value: '', currentValue: 'existing@example.invalid', status: 'skip', reason: '保留已有值' }]);
  const saved = await store.recordOrdinaryPlan(target, plan);
  const contact = saved.sections.find(section => section.key === 'contact')!;
  assert.equal(contact.verifiedFields, 0); assert.equal(contact.progress, 'filled-unsaved');
  await assert.rejects(store.recordOrdinaryResult(target, plan, result('existing-value')), /未计划填写/);
});

test('real question labels are normalized and bounded without storing obvious embedded credentials', async t => {
  const { store } = await fixture(t);
  const plan = ordinaryPlan('question-label', [{ fieldId: 'field-1', label: `为什么\n选择此岗位？\u0000 sk-abcdefghijklmnopqrstuv ${'问'.repeat(200)}`, value: '', currentValue: '', status: 'review', reason: '' }]);
  const saved = await store.recordOrdinaryPlan(target, plan); const label = saved.issues[0]!.label;
  assert(label.startsWith('为什么 选择此岗位？')); assert(label.length <= 160);
  assert.equal(/[\u0000-\u001f]/u.test(label), false); assert.equal(label.includes('sk-abcdefghijklmnopqrstuv'), false);
});

test('ordinary education edits change the actual default career record rather than a derived flat field', async t => {
  const { store } = await fixture(t);
  const plan = ordinaryPlan('education-gap', [{ fieldId: 'field-1', label: '专业', profileKey: 'major', value: '', currentValue: '', status: 'review', reason: '' }]);
  const saved = await store.recordOrdinaryPlan(target, plan); const issue = saved.issues[0]!, value = state();
  const location = applicationIssueFactLocation(value, issue);
  assert.equal(location.collection, 'educations'); assert.equal(location.recordId, value.profile.career!.primaryEducationId);
  const draft = applicationIssueFactDraft(value, issue, '本人确认的新专业');
  assert.equal(draft.career!.educations.find(record => record.id === location.recordId)!.major, '本人确认的新专业');
  assert.equal('confirmedRevision' in draft.career!.educations[0]!, false);
});

test('source version changes invalidate current section counts but preserve dated resolved history until a real gap is reobserved', async t => {
  const { file, store } = await fixture(t);
  const missing = ordinaryPlan('missing-source', [{ fieldId: 'field-1', label: '邮箱', profileKey: 'email', value: '', currentValue: '', status: 'review', reason: '' }]);
  await store.recordOrdinaryPlan(target, missing); await store.finishWorkflow(target);
  const filled = ordinaryPlan('source-confirmed'); await store.recordOrdinaryPlan(target, filled); await store.recordOrdinaryResult(target, filled, result('source-confirmed'));
  await file.transact(db => { const current = readDocument<Profile>(db, 'profile', 'current')!; current.version = 2; writeDocument(db, 'profile', 'current', current, new Date().toISOString()); });
  const skipped = { ...ordinaryPlan('new-source-observation', [{ fieldId: 'field-1', label: '邮箱', profileKey: 'email', value: '', currentValue: 'existing@example.invalid', status: 'skip', reason: '' }]), profileVersion: 2 };
  const observed = await store.recordOrdinaryPlan({ ...target, profileVersion: 2 }, skipped);
  assert.equal(observed.issues[0]!.status, 'resolved'); assert.equal(observed.issues[0]!.lastCheckedProfileVersion, 1);
  assert.equal(observed.sections.find(section => section.key === 'contact')!.verifiedFields, 0);
  assert.notEqual(observed.sections.find(section => section.key === 'contact')!.progress, 'verified');
});

test('real profile save leaves repaired career facts pending until explicit current-revision confirmation and a fresh workflow plan', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-workflow-profile-contract-'));
  const store = await createStore({ directory });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const original = profile(); const { version: _version, updatedAt: _updated, career: _career, ...base } = original;
  let state = await store.saveProfile({ ...base, career: { ...pickCareerInput(original.career), primaryEducationId: null } }, 0);
  for (const collection of ['educations', 'internships', 'projects'] as const) for (const id of state.profile.career![collection].map(record => record.id)) {
    const current = state.profile.career![collection].find(record => record.id === id)!;
    state = await store.confirmCareerRecord(collection, id, state.profile.version, current.revision);
  }
  const before = structuredClone(state.profile);
  const currentTarget = { ...target, profileVersion: state.profile.version };
  const preview = { ...careerPreview('real-store-observed'), profileVersion: state.profile.version };
  await store.workflow.recordCareerPreview(currentTarget, preview);
  const workflow = await store.workflow.recordCareerOutcome(currentTarget, preview, sixPending());
  const issue = workflow.issues.find(value => value.collection === 'internships' && value.profileField === 'role')!;
  const oldRecord = state.profile.career!.internships.find(value => value.id === issue.recordId)!;
  state = await store.saveProfile(applicationIssueFactDraft(state, issue, '本人确认的算法实习职务'), state.profile.version);
  const changed = state.profile.career!.internships.find(value => value.id === issue.recordId)!;
  assert.equal(changed.role, '本人确认的算法实习职务'); assert.equal(changed.confirmation, 'pending'); assert.equal(changed.revision, oldRecord.revision + 1);
  assert.deepEqual(state.profile.career!.sources, before.career!.sources);
  assert.deepEqual(changed.evidence, oldRecord.evidence);
  await assert.rejects(store.confirmCareerRecord('internships', changed.id, state.profile.version, oldRecord.revision));
  state = await store.confirmCareerRecord('internships', changed.id, state.profile.version, changed.revision);
  const confirmed = state.profile.career!.internships.find(value => value.id === changed.id)!;
  assert.equal(confirmed.confirmation, 'confirmed'); assert.equal(confirmed.confirmedRevision, confirmed.revision);
  assert.equal((await store.workflow.workflowState()).workflows[0]!.issues.find(value => value.id === issue.id)!.status, 'open');
  await assert.rejects(store.workflow.recordCareerOutcome(currentTarget, preview, { status: 'completed', verifiedCount: 1, addedCount: 0, pending: [], bindings: [] }), /本次经历|资料已变化/);
  const freshTarget = { ...target, profileVersion: state.profile.version };
  const fresh = { ...careerPreview('fresh-after-explicit-confirmation'), profileVersion: state.profile.version };
  await store.workflow.recordCareerPreview(freshTarget, fresh);
  const outcome = sixPending(); outcome.pending = outcome.pending.filter(value => !(value.recordId === issue.recordId && value.key === 'role'));
  const actual = await store.workflow.recordCareerOutcome(freshTarget, fresh, outcome, [{ collection: 'internships', recordId: issue.recordId!, key: 'role' }]);
  assert.equal(actual.issues.find(value => value.id === issue.id)!.status, 'resolved');
  assert.equal(actual.issues.filter(value => value.status === 'open').length, 5);
});

test('restoring an input or retaining another workflow draft cannot permanently lock current resume', async t => {
  const { store } = await fixture(t); const preview = careerPreview(); await store.recordCareerPreview(target, preview);
  const workflow = await store.recordCareerOutcome(target, preview, sixPending()), current = state();
  const issue = workflow.issues[0]!;
  assert.deepEqual(applicationWorkflowDirtyIssues(current, workflow, { [issue.id]: '真实新职务' }), [issue.id]);
  assert.deepEqual(applicationWorkflowDirtyIssues(current, workflow, { [issue.id]: '' }), []);
  assert.deepEqual(applicationWorkflowDirtyIssues(current, workflow, { [issue.id]: '  ', 'other-workflow-issue': '保留的其他草稿' }), []);
  const ignored = structuredClone(workflow); ignored.issues[0]!.status = 'dismissed';
  assert.deepEqual(applicationWorkflowDirtyIssues(current, ignored, { [issue.id]: '忽略前的草稿' }), []);
});

test('confirming one saved revision is blocked by any unsaved field of that record but not another record', async t => {
  const { store } = await fixture(t); const preview = careerPreview(); await store.recordCareerPreview(target, preview);
  const workflow = await store.recordCareerOutcome(target, preview, sixPending()), current = state();
  const role = workflow.issues.find(issue => issue.collection === 'internships' && issue.profileField === 'role')!;
  const end = workflow.issues.find(issue => issue.collection === 'internships' && issue.profileField === 'endDate')!;
  const project = workflow.issues.find(issue => issue.collection === 'projects')!;
  assert.equal(applicationWorkflowRecordHasDraft(current, workflow, role, { [end.id]: '2026-08' }), true);
  assert.equal(applicationWorkflowRecordHasDraft(current, workflow, role, { [project.id]: '另一个记录的修改' }), false);
  current.profile.career!.internships.find(record => record.id === end.recordId)!.endDate = '2026-08';
  assert.equal(applicationWorkflowRecordHasDraft(current, workflow, role, { [end.id]: '2026-08' }), false);
});

test('ongoing internship and project end controls stay manual in preview and outcome while unknown end dates remain missing facts', async t => {
  const { file, store } = await fixture(t);
  const current = profile();
  current.career!.internships[0]!.current = true;
  current.career!.internships[1]!.current = false; current.career!.internships[1]!.endDate = '';
  current.career!.projects[0]!.ongoing = true; current.career!.projects[0]!.endDate = '';
  current.career!.projects[1]!.ongoing = false; current.career!.projects[1]!.endDate = '';
  await file.transact(db => writeDocument(db, 'profile', 'current', current, '2026-10-19T00:00:00Z'));
  const original = await file.read(db => readDocument<Profile>(db, 'profile', 'current'));
  const records = [
    ...current.career!.internships.map(record => ({ collection: 'internships' as const, recordId: record.id, ongoing: record.current })),
    ...current.career!.projects.map(record => ({ collection: 'projects' as const, recordId: record.id, ongoing: record.ongoing })),
  ];
  const preview = { ...careerPreview('ongoing-end-date-preview'), steps: records.map(record => ({
    kind: 'fill-group' as const, collection: record.collection, recordId: record.recordId,
    items: [{ fieldId: `end-${record.recordId}`, key: 'endDate', value: '', currentValue: '', status: 'review' as const, reason: '原始网站日期控件暂不支持至今' }],
  })) };
  const check = (workflow: ApplicationWorkflow) => {
    assert.equal(workflow.issues.length, 4);
    for (const record of records) {
      const issue = workflow.issues.find(item => item.collection === record.collection && item.recordId === record.recordId && item.profileField === 'endDate')!;
      assert.equal(issue.status, 'open'); assert.equal(issue.readbackVerified, false);
      assert.equal(issue.reasonCode, record.ongoing ? 'unsupported-field' : 'missing-profile');
      assert.equal(applicationIssueEditable(issue), !record.ongoing, 'only a genuinely unknown end date may show a fact-editing input');
      if (record.ongoing) {
        assert.equal(issue.reason, '资料已声明至今/仍在进行；若网页提供“至今”请手动选择，当前执行器不代填结束时间，不需要填写虚构结束日期');
        assert.throws(() => applicationIssueFactDraft({ ...state(), profile: current }, issue, '2026-10'), /可核对的资料/u);
      }
    }
  };
  check(await store.recordCareerPreview(target, preview));
  const outcome: CareerFillOutcome = { status: 'partial', verifiedCount: 0, addedCount: 0, bindings: [], pending: records.map(record => ({
    collection: record.collection, recordId: record.recordId, fieldId: `end-${record.recordId}`, key: 'endDate', required: true, reason: '网页还需手动处理',
  })) };
  check(await store.recordCareerOutcome(target, preview, outcome));
  assert.deepEqual(await file.read(db => readDocument<Profile>(db, 'profile', 'current')), original, 'classification never changes dates, current/ongoing flags or confirmed revisions');
  assert.equal((await store.workflowState()).workflows[0]!.sections.find(section => section.key === 'internships')!.progress, 'needs-user');
});
