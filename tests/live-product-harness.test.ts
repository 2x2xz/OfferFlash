import test from 'node:test';
import assert from 'node:assert/strict';
import type { FillPlan } from '../packages/shared/src/contracts.js';
import { contactCategory, LIVE_CONTACT_VALUES, resolveLiveProductTarget, validateLiveContactSelection,
  type LiveReadFields } from '../apps/desktop/live-product-targets.js';

function scenario() {
  const target = resolveLiveProductTarget('https://jobs.lever.co/portcast/d206930c-1ecd-41fe-b603-b28ad98a5ea4/apply');
  const before: LiveReadFields = { url: target.url, title: 'Public test application', fields: [
    { index: 0, label: 'Full name ✱', type: 'text', value: '', editable: true },
    { index: 1, label: 'Email ✱', type: 'email', value: '', editable: true },
    { index: 2, label: 'Phone', type: 'tel', value: '', editable: true },
  ] };
  const keys = ['fullNameEn', 'email', 'phone'] as const;
  const plan: FillPlan = { id: 'synthetic-plan', url: target.url, title: before.title, profileVersion: 1,
    observationId: 'synthetic-observation', createdAt: '2026-10-18T00:00:00.000Z',
    items: before.fields.map((field, index) => ({ fieldId: `field-${field.index}`, label: field.label,
      value: LIVE_CONTACT_VALUES[keys[index]!], currentValue: '', status: 'ready', reason: 'synthetic', profileKey: keys[index] })) };
  return { target, before, plan };
}

test('real-page acceptance catalog requires an exact known URL and matching case', () => {
  const { target } = scenario();
  assert.equal(resolveLiveProductTarget(target.url, target.id).id, 'portcast-senior');
  assert.throws(() => resolveLiveProductTarget(`${target.url}?tracking=1`), /EXPLICIT_KNOWN_TARGET_REQUIRED/);
  assert.throws(() => resolveLiveProductTarget(target.url, 'verantos-greenhouse'), /EXPLICIT_KNOWN_TARGET_REQUIRED/);
  assert.throws(() => resolveLiveProductTarget('https://example.invalid/application'), /EXPLICIT_KNOWN_TARGET_REQUIRED/);
});

test('contact-only acceptance can measure a safe partial selection without forcing three ready fields', () => {
  const { target, before, plan } = scenario();
  assert.equal(validateLiveContactSelection(plan, ['field-0', 'field-1', 'field-2'], before, target).length, 3);
  assert.equal(validateLiveContactSelection(plan, ['field-1'], before, target).length, 1);
  assert.throws(() => validateLiveContactSelection(plan, [], before, target), /BOUNDED_UNIQUE_CONTACT_SELECTION_REQUIRED/);
});

test('independent contact guard rejects split names, incorrect synthetic values and preserved contents', () => {
  for (const label of ['First name', 'Last name', 'Family name', 'Emergency contact name', 'Newsletter email']) {
    const { target, before, plan } = scenario(); before.fields[0]!.label = label;
    assert.throws(() => validateLiveContactSelection(plan, ['field-0'], before, target), /EXPLICIT_CONTACT_SEMANTICS_REQUIRED/);
  }
  const wrong = scenario(); wrong.plan.items[0]!.value = 'Another Value';
  assert.throws(() => validateLiveContactSelection(wrong.plan, ['field-0'], wrong.before, wrong.target), /SYNTHETIC_CONTACT_VALUE_REQUIRED/);
  const existing = scenario(); existing.before.fields[0]!.value = 'existing';
  assert.throws(() => validateLiveContactSelection(existing.plan, ['field-0'], existing.before, existing.target), /ONLY_BLANK_NATIVE_CONTACT_FIELDS_ALLOWED/);
  const unsupported = scenario(); unsupported.before.fields[2]!.type = 'combobox';
  assert.throws(() => validateLiveContactSelection(unsupported.plan, ['field-2'], unsupported.before, unsupported.target), /ONLY_BLANK_NATIVE_CONTACT_FIELDS_ALLOWED/);
});

test('independent contact guard rejects duplicate categories and cross-form contacts before writes', () => {
  const duplicate = scenario(); duplicate.before.fields[2]!.label = 'Email'; duplicate.before.fields[2]!.type = 'email';
  duplicate.plan.items[2]!.profileKey = 'email'; duplicate.plan.items[2]!.value = LIVE_CONTACT_VALUES.email;
  assert.throws(() => validateLiveContactSelection(duplicate.plan, ['field-1', 'field-2'], duplicate.before, duplicate.target), /DUPLICATE_CONTACT_CATEGORY_REJECTED/);
  const cross = scenario();
  cross.before.fields.forEach((field, index) => { field.metadata = { id: '', name: '', autocomplete: '',
    formIndex: index ? 1 : 0, formId: '', formName: '', formAction: cross.target.url,
    nativeValid: true, validationMessage: '', ariaInvalid: '', errorText: '' }; });
  assert.throws(() => validateLiveContactSelection(cross.plan, ['field-0', 'field-1'], cross.before, cross.target), /CROSS_FORM_CONTACT_SELECTION_REJECTED/);
});

test('Greenhouse case keeps unsupported split-name semantics separate from two supported contact categories', () => {
  const target = resolveLiveProductTarget('https://job-boards.greenhouse.io/verantos/jobs/6132688004', 'verantos-greenhouse');
  assert.deepEqual(target.expectedContactCategories, ['email', 'phone']);
  assert.deepEqual(target.expectedManualContactLabels, ['First Name', 'Last Name']);
  assert.equal(contactCategory('Email address *'), 'email');
  assert.equal(contactCategory('Your full name:'), 'name');
  assert.equal(contactCategory('First Name'), undefined);
});
