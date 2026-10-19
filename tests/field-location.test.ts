import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApplicationFieldLocationInput, FieldObservation, FillPlan, FormObservation } from '../packages/shared/src/contracts.js';
import type { CareerFieldObservation, CareerFillPlan, CareerFormCollection, CareerFormObservation, CareerGroupBinding, CareerPageGroup } from '../packages/forms/src/career-plan.js';
import { careerGroupSignature } from '../packages/forms/src/career-plan.js';
import { FieldLocationError, FieldLocationRegistry, validateFieldLocationInput } from '../packages/browser/src/field-location.js';

const url = 'https://example.invalid/fictional-application';
const profileVersion = 7;
const generation = 3;
const status = (expected: FieldLocationError['status'] | readonly FieldLocationError['status'][]) => (error: unknown) => {
  assert.ok(error instanceof FieldLocationError);
  assert.ok((typeof expected === 'string' ? [expected] : expected).includes(error.status), `expected ${expected}, got ${error.status}`);
  return true;
};
function ordinaryField(id: string, index: number): FieldObservation {
  return { id, index, label: '相同的虚构问题', type: 'text', value: '', required: true, editable: true,
    options: [], bounds: { x: 20, y: 40 + index * 80, width: 300, height: 32 }, signature: `ordinary-signature-${id}` };
}
function ordinaryObservation(): FormObservation {
  return { id: 'ordinary-observation', url, title: '虚构定位测试', observedAt: '2026-10-19T00:00:00Z', signature: 'ordinary-structure',
    fields: [ordinaryField('field-0', 0), ordinaryField('field-1', 1)] };
}
function ordinaryPlan(original: FormObservation, id = 'ordinary-plan'): FillPlan {
  return { id, url: original.url, title: original.title, profileVersion, observationId: original.id, createdAt: '2026-10-19T00:00:00Z',
    items: original.fields.map(field => ({ fieldId: field.id, label: field.label, status: 'review', value: '', currentValue: field.value, reason: '虚构待处理问题。' })) };
}
const ordinaryInput = (planId = 'ordinary-plan', fieldId = 'field-1'): ApplicationFieldLocationInput => ({ kind: 'ordinary', planId, fieldId });
function careerField(id: string, key: CareerFieldObservation['key'] = 'role'): CareerFieldObservation {
  return { id, key, signature: `career-field-${id}`, type: 'text', value: '', editable: true };
}
function group(id: string, collection: CareerFormCollection, fields: CareerFieldObservation[]): CareerPageGroup {
  return { id, collection, fields, signature: careerGroupSignature({ id, collection, fields }) };
}
function careerObservation(groups = [
  group('internship[0]', 'internships', [careerField('internship[0].role'), careerField('internship[0].end', 'endDate')]),
  group('project[0]', 'projects', [careerField('project[0].role'), careerField('project[0].url', 'url')]),
]): CareerFormObservation {
  return { id: 'career-observation', url, generation, signature: 'career-structure', groups, addControls: [], protectedFields: [] };
}
function careerPlan(original: CareerFormObservation, id = 'career-plan'): CareerFillPlan {
  return { id, profileVersion, url: original.url, generation: original.generation, observationId: original.id, observationSignature: original.signature,
    bindings: [], steps: [], issues: [], original, options: {} };
}
const careerInput = (patch: Partial<ApplicationFieldLocationInput> = {}): ApplicationFieldLocationInput => ({ kind: 'career', planId: 'career-plan', groupId: 'internship[0]', fieldKey: 'role', ...patch });
const binding = (target: CareerPageGroup, patch: Partial<CareerGroupBinding> = {}): CareerGroupBinding => ({ collection: target.collection,
  recordId: 'fictional-record', revision: 1, profileVersion, groupId: target.id, groupSignature: target.signature, ...patch });

test('ordinary read-only identity remains usable after its separate one-shot write plan is consumed', () => {
  const registry = new FieldLocationRegistry(() => 1_000), original = ordinaryObservation(), plan = ordinaryPlan(original);
  const writePlans = new Map([[plan.id, plan]]);
  registry.rememberOrdinary(plan, original, generation); writePlans.delete(plan.id);
  const current = structuredClone(original); current.fields[1]!.value = '虚构的用户已填内容'; current.fields[1]!.bounds.y = 650;
  assert.strictEqual(registry.ordinaryTarget(ordinaryInput(), current, generation, profileVersion), current.fields[1]);
  assert.equal(writePlans.size, 0, 'a read-only lookup must never restore filling authorization');
  assert.equal(current.fields[1]!.value, '虚构的用户已填内容');
});

test('same labels never replace the requested ordinary field ID or guess an unknown field', () => {
  const registry = new FieldLocationRegistry(), current = ordinaryObservation(); registry.rememberOrdinary(ordinaryPlan(current), current, generation);
  assert.equal(registry.ordinaryTarget(ordinaryInput(), current, generation, profileVersion).id, 'field-1');
  assert.equal(registry.ordinaryTarget(ordinaryInput('ordinary-plan', 'field-0'), current, generation, profileVersion).id, 'field-0');
  assert.throws(() => registry.ordinaryTarget(ordinaryInput('ordinary-plan', current.fields[0]!.label), current, generation, profileVersion), status('ambiguous'));
});

test('ordinary identities expire on profile, document generation, URL or unknown plan changes', () => {
  const registry = new FieldLocationRegistry(), original = ordinaryObservation(); registry.rememberOrdinary(ordinaryPlan(original), original, generation);
  assert.throws(() => registry.ordinaryTarget(ordinaryInput(), original, generation, profileVersion + 1), status('stale'));
  assert.throws(() => registry.ordinaryTarget(ordinaryInput(), original, generation + 1, profileVersion), status('stale'));
  assert.throws(() => registry.ordinaryTarget(ordinaryInput(), { ...original, url: `${url}?different=1` }, generation, profileVersion), status('stale'));
  assert.throws(() => registry.ordinaryTarget(ordinaryInput('unremembered-plan'), original, generation, profileVersion), status('stale'));
});

test('ordinary full observed structure rejects changed page signature, index, field identity and duplicates', () => {
  const registry = new FieldLocationRegistry(), original = ordinaryObservation(); registry.rememberOrdinary(ordinaryPlan(original), original, generation);
  const mutations: Array<(current: FormObservation) => void> = [
    current => { current.signature = 'changed-structure'; },
    current => { current.fields[1]!.index = 22; },
    current => { current.fields[1]!.signature = 'changed-field-identity'; },
    current => { current.fields.pop(); },
    current => { current.fields.push(ordinaryField('field-2', 2)); },
    current => { current.fields[1] = structuredClone(current.fields[0]!); },
  ];
  for (const mutate of mutations) { const current = structuredClone(original); mutate(current); assert.throws(() => registry.ordinaryTarget(ordinaryInput(), current, generation, profileVersion), status('stale')); }
});

test('ten-minute ordinary identity TTL cannot be extended by a lookup or by preparing unrelated plans', () => {
  let now = 1_000; const registry = new FieldLocationRegistry(() => now), current = ordinaryObservation();
  registry.rememberOrdinary(ordinaryPlan(current), current, generation);
  now += 600_000; assert.equal(registry.ordinaryTarget(ordinaryInput(), current, generation, profileVersion).id, 'field-1');
  registry.rememberOrdinary(ordinaryPlan(current, 'another-plan'), current, generation);
  now++; assert.throws(() => registry.ordinaryTarget(ordinaryInput(), current, generation, profileVersion), status('stale'));
  assert.equal(registry.ordinaryTarget(ordinaryInput('another-plan'), current, generation, profileVersion).id, 'field-1');
});

test('registry retains at most twenty identities per mode and clearing revokes read-only identities', () => {
  const registry = new FieldLocationRegistry(() => 1_000), ordinary = ordinaryObservation(), career = careerObservation();
  for (let index = 0; index < 21; index++) {
    registry.rememberOrdinary(ordinaryPlan(ordinary, `ordinary-${index}`), ordinary, generation);
    registry.rememberCareer(careerPlan(career, `career-${index}`));
  }
  assert.throws(() => registry.ordinaryTarget(ordinaryInput('ordinary-0'), ordinary, generation, profileVersion), status('stale'));
  assert.throws(() => registry.careerTarget(careerInput({ planId: 'career-0' }), career, profileVersion), status('stale'));
  assert.equal(registry.ordinaryTarget(ordinaryInput('ordinary-20'), ordinary, generation, profileVersion).id, 'field-1');
  assert.equal(registry.careerTarget(careerInput({ planId: 'career-20' }), career, profileVersion), 'internship[0].role');
  registry.clear();
  assert.throws(() => registry.ordinaryTarget(ordinaryInput('ordinary-20'), ordinary, generation, profileVersion), status('stale'));
  assert.throws(() => registry.careerTarget(careerInput({ planId: 'career-20' }), career, profileVersion), status('stale'));
});

test('career requests stay inside their exact group and can further narrow the field by ID', () => {
  const registry = new FieldLocationRegistry(), current = careerObservation(); registry.rememberCareer(careerPlan(current));
  assert.equal(registry.careerTarget(careerInput(), current, profileVersion), 'internship[0].role');
  assert.equal(registry.careerTarget(careerInput({ groupId: 'project[0]', fieldId: 'project[0].role' }), current, profileVersion), 'project[0].role');
  assert.equal(registry.careerTarget(careerInput({ fieldKey: undefined, fieldId: 'internship[0].end' }), current, profileVersion), 'internship[0].end');
  assert.throws(() => registry.careerTarget(careerInput({ fieldId: 'project[0].role' }), current, profileVersion), status('ambiguous'));
  assert.throws(() => registry.careerTarget(careerInput({ fieldId: 'internship[0].end', fieldKey: 'role' }), current, profileVersion), status('ambiguous'));
  assert.throws(() => registry.careerTarget(careerInput({ groupId: 'unknown-group' }), current, profileVersion), status('ambiguous'));
});

test('career repeated group IDs cannot silently select the first occurrence', () => {
  const duplicate = group('internship[0]', 'internships', [careerField('same-id.role')]);
  const current = careerObservation([duplicate, structuredClone(duplicate)]), registry = new FieldLocationRegistry();
  registry.rememberCareer(careerPlan(current));
  assert.throws(() => registry.careerTarget(careerInput(), current, profileVersion), status(['stale', 'ambiguous']));
});

test('career repeated field purposes require exact identity and repeated field IDs are ambiguous', () => {
  const duplicatedKey = careerObservation([group('internship[0]', 'internships', [careerField('role-a'), careerField('role-b')])]);
  const registry = new FieldLocationRegistry(); registry.rememberCareer(careerPlan(duplicatedKey));
  assert.throws(() => registry.careerTarget(careerInput(), duplicatedKey, profileVersion), status('ambiguous'));
  assert.equal(registry.careerTarget(careerInput({ fieldId: 'role-b' }), duplicatedKey, profileVersion), 'role-b');
  const duplicateId = careerObservation([group('internship[0]', 'internships', [careerField('same-id'), careerField('same-id')])]);
  registry.rememberCareer(careerPlan(duplicateId));
  assert.throws(() => registry.careerTarget(careerInput({ fieldId: 'same-id', fieldKey: undefined }), duplicateId, profileVersion), status('ambiguous'));
});

test('career profile, URL, generation and structure changes invalidate the original group identities', () => {
  const registry = new FieldLocationRegistry(), original = careerObservation(); registry.rememberCareer(careerPlan(original));
  assert.throws(() => registry.careerTarget(careerInput(), original, profileVersion + 1), status('stale'));
  const mutations: Array<(current: CareerFormObservation) => void> = [
    current => { current.url += '?different=1'; }, current => { current.generation++; },
    current => { current.groups[0]!.signature = 'changed-identity'; },
    current => { current.groups[0]!.collection = 'projects'; },
    current => { current.groups[0]!.fields[0]!.type = 'textarea'; current.groups[0]!.signature = careerGroupSignature(current.groups[0]!); },
    current => { current.groups.pop(); }, current => { current.groups.push(structuredClone(current.groups[0]!)); },
  ];
  for (const mutate of mutations) { const current = structuredClone(original); mutate(current); assert.throws(() => registry.careerTarget(careerInput(), current, profileVersion), status('stale')); }
});

test('career value and scroll changes do not invent writes or alter confirmed structural identity', () => {
  const registry = new FieldLocationRegistry(), original = careerObservation(); registry.rememberCareer(careerPlan(original));
  const current = structuredClone(original); current.groups[0]!.fields[0]!.value = '虚构的用户修改职位';
  current.groups[0]!.signature = careerGroupSignature(current.groups[0]!);
  const before = structuredClone(current);
  assert.equal(registry.careerTarget(careerInput(), current, profileVersion), 'internship[0].role'); assert.deepEqual(current, before);
});

test('only a trusted host result binding can add a new career group to the same read-only plan', () => {
  const registry = new FieldLocationRegistry(), original = careerObservation(); registry.rememberCareer(careerPlan(original));
  const added = group('project[1]', 'projects', [careerField('project[1].role')]), current = structuredClone(original); current.groups.push(added);
  const input = careerInput({ groupId: added.id, fieldKey: 'role' });
  assert.throws(() => registry.careerTarget(input, current, profileVersion), status('stale'));
  registry.bindCareerResult('career-plan', [binding(added)]);
  assert.equal(registry.careerTarget(input, current, profileVersion), 'project[1].role');
  assert.equal(registry.careerTarget(careerInput(), current, profileVersion), 'internship[0].role');
  assert.throws(() => registry.careerTarget(careerInput({ groupId: 'still-unknown' }), current, profileVersion), status('ambiguous'));
});

test('host result bindings cannot update an old group identity or accept a wrong version or invalid signature', () => {
  const original = careerObservation(), added = group('project[1]', 'projects', [careerField('project[1].role')]);
  for (const invalid of [binding(added, { profileVersion: profileVersion + 1 }), binding(added, { groupSignature: 'untrusted-short-signature' })]) {
    const registry = new FieldLocationRegistry(); registry.rememberCareer(careerPlan(original)); registry.bindCareerResult('career-plan', [invalid]);
    const current = structuredClone(original); current.groups.push(added);
    assert.throws(() => registry.careerTarget(careerInput({ groupId: added.id }), current, profileVersion), status('stale'));
  }
  const registry = new FieldLocationRegistry(); registry.rememberCareer(careerPlan(original));
  const changed = structuredClone(original); changed.groups[0]!.signature = 'a'.repeat(64);
  registry.bindCareerResult('career-plan', [binding(changed.groups[0]!)]);
  assert.throws(() => registry.careerTarget(careerInput(), changed, profileVersion), status('stale'));
});

test('career host result binding does not renew expired identity lifetime or create a missing plan', () => {
  let now = 1_000; const registry = new FieldLocationRegistry(() => now), current = careerObservation(); registry.rememberCareer(careerPlan(current));
  now += 600_001; registry.bindCareerResult('career-plan', [binding(current.groups[0]!)]);
  assert.throws(() => registry.careerTarget(careerInput(), current, profileVersion), status('stale'));
  registry.bindCareerResult('unremembered-plan', [binding(current.groups[0]!)]);
  assert.throws(() => registry.careerTarget(careerInput({ planId: 'unremembered-plan' }), current, profileVersion), status('stale'));
});

test('location input accepts identities but rejects selectors, coordinates, values and missing career group', () => {
  const ordinary = ordinaryInput(), career = careerInput();
  assert.deepEqual(validateFieldLocationInput(ordinary), ordinary); assert.deepEqual(validateFieldLocationInput(career), career);
  assert.deepEqual(validateFieldLocationInput(careerInput({ fieldId: 'internship[0].role', fieldKey: undefined })), careerInput({ fieldId: 'internship[0].role', fieldKey: undefined }));
  const invalid: unknown[] = [null, undefined, [], 'field-1', { ...ordinary, selector: '#question' }, { ...ordinary, x: 1, y: 2 },
    { ...ordinary, coordinates: [1, 2] }, { ...ordinary, value: '禁止写入' }, { ...ordinary, url }, { ...ordinary, groupId: 'internship[0]' },
    { ...ordinary, fieldKey: 'role' }, { ...ordinary, fieldId: undefined }, { ...ordinary, planId: '' }, { ...ordinary, planId: 'p'.repeat(301) },
    { ...ordinary, fieldId: null }, { ...ordinary, fieldId: 1 }, { ...ordinary, fieldId: '' }, { ...ordinary, fieldId: 'f'.repeat(301) },
    { ...career, groupId: undefined }, { ...career, groupId: '' }, { ...career, fieldKey: undefined }, { ...career, kind: 'unknown' }];
  for (const value of invalid) assert.throws(() => validateFieldLocationInput(value), status('unsupported'));
});

test('input kind must be a literal string enum and cannot rely on JavaScript string coercion', () => {
  for (const kind of [['ordinary'], ['career'], { toString: () => 'ordinary' }, true, 1]) {
    assert.throws(() => validateFieldLocationInput({ kind, planId: 'plan' }), status('unsupported'));
  }
});
