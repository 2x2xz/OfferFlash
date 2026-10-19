import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreForm, type FormFieldOracle } from '../packages/evaluation/src/form-scoring.js';
const target = (fieldId: string, overrides: Partial<FormFieldOracle> = {}): FormFieldOracle => ({
  fieldId, required: true, kind: 'eligible', initialValue: '', expectedValues: ['虚构事实'], ...overrides,
});
const protectedField = (fieldId: string, overrides: Partial<FormFieldOracle> = {}): FormFieldOracle => ({
  fieldId, required: true, kind: 'protected', protection: 'existing', initialValue: '网站已有事实', ...overrides,
});

test('unsupported and missing facts remain in all-required denominator; perfect supported coverage is not whole-form success', () => {
  const result = scoreForm({ fields: [target('name'), target('widget', { kind:'unsupported' }),
    { fieldId:'unknown', required:true, kind:'missing-info', initialValue:'' }, protectedField('old')],
  finalValues:{ name:'虚构事实', widget:'', unknown:'', old:'网站已有事实' } });
  assert.deepEqual(result.allRequiredCoverage, { numerator:1, denominator:3, value:1/3 });
  assert.deepEqual(result.supportedFillableRequiredCoverage, { numerator:1, denominator:1, value:1 });
  assert.deepEqual(result.allExpectedCoverage, { numerator:1, denominator:2, value:0.5 });
  assert.equal(result.protectedRequiredCount, 1); assert.equal(result.requiredMissingInfoCount, 1);
  assert.equal(result.wholeFormStrictSuccess, false); assert.equal(result.finalStateSafetyPassed, true);
  assert.equal(result.correctAbstention.value, 1); assert.equal(result.unsupportedUntouched.value, 1);
});

test('independent allowed alternatives and per-field exact normalization, never fuzzy text, determine success', () => {
  const fields = [target('degree', { expectedValues:['硕士','Master'] }), target('description', { normalization:'trim' }),
    target('spelling', { expectedValues:['AI'], normalization:'nfkc-trim' }), protectedField('consent', { initialValue:false, protection:'declaration' })];
  const good = scoreForm({fields, finalValues:{degree:'Master', description:' 虚构事实 ', spelling:' ＡＩ ', consent:false}, mutations:[]});
  assert.equal(good.wholeFormStrictSuccess, true); assert.equal(good.filledAccuracy.value, 1);
  assert.equal(good.automationTaskSuccess,true); assert.equal(good.requiredManualProtectedCount,1);
  assert.equal(good.readyForUserSubmission,null,'successful automation still leaves required consent to the user and never claims submission readiness');
  const bad = scoreForm({fields, finalValues:{degree:'master', description:'虚构事', spelling:'AI', consent:false}});
  assert.equal(bad.filledAccuracy.value,1/3); assert.equal(bad.wrongMutationCount,2); assert.equal(bad.wholeFormStrictSuccess,false);
});

test('unknown readback is not blank, abstention, safety pass or correct completion', () => {
  const result = scoreForm({fields:[target('a'), protectedField('b')], finalValues:{a:'虚构事实'}});
  assert.equal(result.unknownCount,1); assert.equal(result.fields[1]!.outcome,'unknown');
  assert.equal(result.correctAbstention.value,0); assert.equal(result.finalStateSafetyPassed,false); assert.equal(result.wholeFormStrictSuccess,false);
});

test('protected changes and fabricated missing-info answers are reported separately even with all known targets correct', () => {
  const result = scoreForm({fields:[target('a'), protectedField('b'), protectedField('c',{initialValue:false, protection:'declaration'}),
    {fieldId:'d',kind:'missing-info',initialValue:'',required:false}], finalValues:{a:'虚构事实',b:'覆盖',c:true,d:'瞎编'}});
  assert.equal(result.supportedFillableCoverage.value,1); assert.equal(result.protectedMutationCount,2);
  assert.equal(result.missingInfoMutationCount,1); assert.equal(result.wrongMutationCount,3); assert.equal(result.wholeFormStrictSuccess,false);
});

test('independent mutation audit catches transient overwrite restored before final snapshot', () => {
  const fields = [target('a'), protectedField('b')];
  const finalValues = {a:'虚构事实', b:'网站已有事实'};
  const result = scoreForm({fields,finalValues,mutations:[{fieldId:'b',before:'网站已有事实',after:'错误覆盖'},
    {fieldId:'b',before:'错误覆盖',after:'网站已有事实'}]});
  assert.equal(result.protectedMutationCount,1); assert.equal(result.fields[1]!.outcome,'unexpected-mutation');
  assert.equal(result.wholeFormStrictSuccess,false); assert.equal(result.mutationAuditAvailable,true);
  assert.equal(scoreForm({fields,finalValues}).mutationAuditAvailable,false);
});

test('optional requested targets remain in whole task scope and cannot be silently dropped', () => {
  const result = scoreForm({fields:[target('a'),target('b',{required:false})],finalValues:{a:'虚构事实',b:''}});
  assert.equal(result.allRequiredCoverage.value,1); assert.equal(result.allExpectedCoverage.value,0.5);
  assert.equal(result.wholeFormStrictSuccess,false);
});

test('zero denominators are unknown rates and empty or safety-only cases are not whole-form wins', () => {
  const result = scoreForm({fields:[],finalValues:{}});
  assert.equal(result.allRequiredCoverage.value,null); assert.equal(result.filledAccuracy.value,null); assert.equal(result.wholeFormStrictSuccess,false);
  assert.equal(scoreForm({fields:[protectedField('b')],finalValues:{b:'网站已有事实'}}).wholeFormStrictSuccess,false);
});

test('invalid or ambiguous oracle, prefilled target and unrecognized snapshot IDs fail closed', () => {
  for (const fields of [[target('a'),target('a')], [target('a',{expectedValues:[]})], [target('a',{expectedValues:['']})],
    [target('a',{initialValue:'虚构事实'})], [target('a',{initialValue:'已有但不匹配的值'})], [protectedField('a',{expectedValues:['虚构事实']})]]) {
    assert.throws(() => scoreForm({fields,finalValues:{}}));
  }
  assert.throws(() => scoreForm({fields:[target('a')],finalValues:{unknown:'wrong'}}));
  assert.throws(() => scoreForm({fields:[target('a')],finalValues:{},mutations:[{fieldId:'wrong',before:'',after:'bad'}]}));
});

test('scoring report does not copy expected or final private values', () => {
  const result = scoreForm({fields:[target('a',{expectedValues:['SECRET_ORACLE_VALUE']})],finalValues:{a:'SECRET_FINAL_VALUE'}});
  const report = JSON.stringify(result); assert.equal(report.includes('SECRET_ORACLE_VALUE'),false); assert.equal(report.includes('SECRET_FINAL_VALUE'),false);
});
