import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Profile, ProfileInput } from '../packages/shared/src/contracts.js';
import { scoreForm, type FormFieldOracle, type FormValue } from '../packages/evaluation/src/form-scoring.js';

interface DatasetField extends Omit<FormFieldOracle, 'fieldId'> {
  domId: string; label: string; type: string; section: string;
  profileKey?: keyof ProfileInput; options?: Array<{ label: string; value: string }>; multiline?: boolean;
}
interface DatasetCase { id: string; split: 'dev' | 'test'; templateFamily: string; title: string; description: string;
  fields: DatasetField[]; behavior?: 'none' | 'reset-first-input' | 'mutate-other-on-input' | 'delayed-reset'; }
interface FormDataset { schemaVersion: 1; suiteId: string; asOf: string;
  labelProvenance: 'authored-synthetic-diagnostic'; humanGold: false; profile: Profile; cases: DatasetCase[]; }
const dataset = JSON.parse(await readFile(new URL('../benchmarks/offerflash-v1/forms.json', import.meta.url), 'utf8')) as FormDataset;
const oracles = (scenario: DatasetCase): FormFieldOracle[] => scenario.fields.map(({ domId, label:_label, type:_type,
  section:_section, profileKey:_key, options:_options, multiline:_multiline, ...oracle }) => ({ fieldId:domId, ...oracle }));

test('form diagnostic dataset explicitly labels synthetic provenance and freezes exactly 8 dev / 8 test tasks', () => {
  assert.equal(dataset.schemaVersion,1); assert.equal(dataset.suiteId,'offerflash-forms-v1');
  assert.match(dataset.asOf,/^\d{4}-\d{2}-\d{2}$/); assert.equal(dataset.labelProvenance,'authored-synthetic-diagnostic');
  assert.equal(dataset.humanGold,false); assert.equal(dataset.cases.length,16);
  assert.equal(dataset.cases.filter(item=>item.split==='dev').length,8); assert.equal(dataset.cases.filter(item=>item.split==='test').length,8);
  assert.equal(new Set(dataset.cases.map(item=>item.id)).size,16);
});

test('template families and case IDs do not cross development and final test splits', () => {
  const families = new Map<string,string>();
  for (const item of dataset.cases) {
    assert.match(item.id,/^forms-(dev|test)-\d{2}$/); assert.ok(item.id.includes(`-${item.split}-`));
    assert.ok(item.templateFamily.trim()); assert.ok(item.title.trim()); assert.ok(item.description.trim());
    const split = families.get(item.templateFamily); assert.ok(split===undefined || split===item.split);
    families.set(item.templateFamily,item.split);
  }
  assert.equal(families.size,16,'independent authored task families; do not inflate held-out claims by changing only persona values');
});

test('one fictional profile supplies complete contacts, two confirmed education records and explicit default education', () => {
  const profile = dataset.profile;
  assert.ok(profile.fullName.includes('虚构')); assert.match(profile.email,/@[^@]+\.invalid$/);
  assert.match(profile.phone,/^0+$/); assert.ok(profile.resumeText.includes('完全虚构'));
  for (const key of ['fullName','fullNameEn','email','phone','school','schoolEn','degree','major','majorEn','graduationMonth'] as const) assert.ok(profile[key].trim());
  assert.ok(profile.career); assert.equal(profile.career.educations.length,2);
  assert.deepEqual(profile.career.internships,[]); assert.deepEqual(profile.career.projects,[]);
  const primary = profile.career.educations.find(item=>item.id===profile.career!.primaryEducationId);
  assert.equal(primary?.degree,'硕士'); assert.equal(primary?.school,profile.school); assert.equal(primary?.endDate,profile.graduationMonth);
  for (const education of profile.career.educations) {
    assert.ok(education.school.includes('虚构')); assert.equal(education.confirmation,'confirmed');
    assert.equal(education.confirmedRevision,education.revision); assert.ok(education.confirmedAt);
    assert.ok(education.evidence.length>0); assert.ok(education.evidence.every(item=>profile.career!.sources.some(source=>source.id===item.sourceId)));
  }
});

test('field schema and independent gold are internally valid without invoking production planner or model', () => {
  for (const item of dataset.cases) {
    assert.ok(item.fields.length>0); assert.equal(new Set(item.fields.map(field=>field.domId)).size,item.fields.length);
    for (const field of item.fields) {
      assert.match(field.domId,/^[a-z][a-z0-9-]*$/); assert.ok(field.label.trim()); assert.equal(typeof field.section,'string');
      assert.equal(typeof field.required,'boolean'); assert.ok(['string','boolean'].includes(typeof field.initialValue));
      if (field.kind==='eligible') {
        assert.ok(['text','email','tel','textarea','select','month'].includes(field.type));
        assert.ok(field.profileKey); assert.ok(field.expectedValues?.length);
      }
      if (field.kind==='protected') { assert.ok(field.protection); assert.equal(field.expectedValues,undefined); }
      if (field.kind==='missing-info') assert.equal(field.expectedValues,undefined);
      if (field.type==='select') {
        assert.ok(field.options?.length); assert.ok(field.options!.some(option=>option.value===field.initialValue));
        for (const value of field.expectedValues??[]) assert.ok(field.options!.some(option=>option.value===value));
      }
    }
    // All initial states must score as incomplete or safety-only, not as a successful fill.
    const result = scoreForm({fields:oracles(item), finalValues:Object.fromEntries(item.fields.map(field=>[field.domId,field.initialValue]))});
    assert.equal(result.wholeFormStrictSuccess,false); assert.equal(result.wrongMutationCount,0); assert.equal(result.unknownCount,0);
  }
});

test('known expected values originate in authored profile facts or explicit degree options, not evaluator-generated planner output', () => {
  const profile = dataset.profile;
  const known = new Set<string>([profile.fullName,profile.fullNameEn,profile.email,profile.phone,profile.school,profile.schoolEn,
    profile.degree,profile.major,profile.majorEn,profile.graduationMonth,
    ...profile.career!.educations.flatMap(item=>[item.school,item.schoolEn,item.degree,item.major,item.majorEn,item.startDate,item.endDate])]);
  for (const item of dataset.cases) for (const field of item.fields) for (const value of field.expectedValues??[]) {
    assert.equal(typeof value,'string');
    assert.ok(known.has(String(value)) || field.options?.some(option=>option.value===value && known.has(option.label)), `${item.id}/${field.domId} must cite an authored fact or genuine option`);
  }
});

test('matrix preserves unsupported and missing-information denominators alongside protected controls and long-form evidence', () => {
  const all = dataset.cases.flatMap(item=>item.fields);
  assert.ok(all.some(field=>field.type==='month'&&field.kind==='eligible'));
  assert.ok(all.some(field=>field.type==='textarea'&&field.multiline===true&&field.kind==='eligible'));
  assert.ok(all.some(field=>field.type==='date'&&field.kind==='missing-info'));
  assert.ok(all.some(field=>field.type==='combobox'&&field.kind==='unsupported'));
  for (const protection of ['existing','sensitive','declaration','upload','other-person']) assert.ok(all.some(field=>field.protection===protection));
  for (const type of ['checkbox','radio','file','hidden']) assert.ok(all.some(field=>field.type===type&&field.kind==='protected'));
  assert.ok(dataset.cases.some(item=>item.fields.length>=20));
  const scoped = dataset.cases.find(item=>item.templateFamily==='record-scoped-multieducation')!;
  assert.equal(scoped.fields.length,6); assert.ok(scoped.fields.every(field=>field.required&&field.kind==='unsupported'));
  const result = scoreForm({fields:oracles(scoped), finalValues:Object.fromEntries(scoped.fields.map(field=>[field.domId,field.initialValue]))});
  assert.equal(result.allRequiredCoverage.denominator,6); assert.equal(result.supportedFillableRequiredCoverage.denominator,0);
  assert.equal(result.allRequiredCoverage.numerator,0);
});

test('controlled recovery cases declare the exact eligible/protected anchors the browser runner needs', () => {
  const behaviors = new Set(dataset.cases.map(item=>item.behavior));
  for (const behavior of ['none','reset-first-input','mutate-other-on-input','delayed-reset']) assert.ok(behaviors.has(behavior as DatasetCase['behavior']));
  for (const item of dataset.cases.filter(item=>item.behavior!=='none')) assert.ok(item.fields.some(field=>field.kind==='eligible'));
  const mutation = dataset.cases.find(item=>item.behavior==='mutate-other-on-input')!;
  assert.ok(mutation.fields.some(field=>field.kind==='protected'&&field.protection==='existing'&&field.initialValue!==''));
});

test('perfect known target state still does not erase required missing facts or manual declaration gates', () => {
  for (const item of dataset.cases) {
    const finalValues: Record<string,FormValue> = Object.fromEntries(item.fields.map(field=>[field.domId,field.expectedValues?.[0]??field.initialValue]));
    const result = scoreForm({fields:oracles(item),finalValues,mutations:[]});
    assert.equal(result.allExpectedCoverage.value,1); assert.equal(result.readyForUserSubmission,null);
    const missingRequired = item.fields.some(field=>field.required&&field.kind==='missing-info');
    assert.equal(result.wholeFormStrictSuccess,!missingRequired);
    if (item.fields.some(field=>field.required&&field.kind==='protected'&&field.protection!=='existing')) assert.ok(result.requiredManualProtectedCount>0);
  }
});
