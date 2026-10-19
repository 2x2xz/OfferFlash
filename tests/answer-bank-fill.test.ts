import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichWithConfirmedAnswers, assertPreparedAnswersCurrent } from '../packages/forms/src/answer-bank.js';
import type { FillPlan, FormObservation } from '../packages/shared/src/contracts.js';
import type { AnswerSuggestion } from '../packages/shared/src/application-assets.js';

function fixture(label = '为什么选择这个岗位？', type = 'textarea') {
  const observation: FormObservation = { id: 'observation', url: 'https://example.invalid/application/1', title: '测试', observedAt: new Date().toISOString(), signature: 'page', fields: [{ id: 'field', index: 0, label, type, value: '', required: true, editable: true, options: [], bounds: { x: 0, y: 0, width: 200, height: 30 }, signature: 'field' }] };
  const plan: FillPlan = { id: 'plan', url: observation.url, title: '测试', profileVersion: 2, observationId: observation.id, createdAt: observation.observedAt, items: [{ fieldId: 'field', label, value: '', currentValue: '', status: 'review', reason: '没有资料对应关系' }] };
  const choice: AnswerSuggestion = { automaticEligible: true, reason: '', answer: { id: 'answer', questionPattern: label, answer: '我的已确认项目与岗位职责相关。', scope: { kind: 'application', applicationId: 'application' }, demo: false, risk: 'ordinary', revision: 1, createdAt: observation.observedAt, updatedAt: observation.observedAt, confirmedAt: observation.observedAt, confirmedRevision: 1, confirmedProfileVersion: 2 } };
  return { observation, plan, choice };
}

test('confirmed exact local prose joins a fresh plan and retains an answer revision binding', () => {
  const f = fixture(), result = enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', [f.choice]]]));
  assert.equal(result.plan.items[0]!.status, 'ready'); assert.equal(result.bindings.length, 1);
  assertPreparedAnswersCurrent(result.bindings, [f.choice.answer]);
  assert.throws(() => assertPreparedAnswersCurrent(result.bindings, [{ ...f.choice.answer, answer: '已修改' }]), /重新识别/);
  assert.throws(() => assertPreparedAnswersCurrent(result.bindings, []), /重新识别/);
});
test('unconfirmed, changed-profile and conflicting answers stay pending', () => {
  const f = fixture();
  for (const choices of [[{ ...f.choice, automaticEligible: false }], [f.choice, f.choice], [{ ...f.choice, answer: { ...f.choice.answer, confirmedProfileVersion: 1 } }]]) {
    assert.equal(enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', choices]])).bindings.length, 0);
  }
});
test('bank cannot authorize sensitive, declaration, upload, dropdown or existing fields', () => {
  for (const [label, type] of [['期望薪资', 'text'], ['是否需要签证担保', 'textarea'], ['I accept the terms', 'textarea'], ['为什么选择这个岗位？', 'file'], ['为什么选择这个岗位？', 'select']]) {
    const f = fixture(label, type);
    assert.equal(enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', [f.choice]]])).bindings.length, 0);
  }
  const f = fixture(); f.observation.fields[0]!.value = '保留原值';
  assert.equal(enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', [f.choice]]])).bindings.length, 0);
  f.observation.fields[0]!.value = ''; f.plan.items[0]!.status = 'skip';
  assert.equal(enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', [f.choice]]])).bindings.length, 0);
});
test('a neutral question label cannot hide a sensitive section', () => {
  for (const section of ['利益冲突与亲属关系', 'Conflicts of interest', 'Legal and family disclosures']) {
    const f = fixture('Additional details'); f.observation.fields[0]!.section = section;
    assert.equal(enrichWithConfirmedAnswers(f.plan, f.observation, new Map([['field', [f.choice]]])).bindings.length, 0);
  }
});
