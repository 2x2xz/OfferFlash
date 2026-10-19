import assert from 'node:assert/strict';
import test from 'node:test';
import type { Profile } from '../packages/shared/src/contracts.js';
import { emptyCareerInput } from '../packages/profile/src/career-input.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import { hasPersonalProfile, onboardingSteps, pendingCareerConfirmationCount, readOnboardingReceipt, shouldOfferOnboarding } from '../packages/ui/src/onboarding.js';

function empty(): Profile {
  return { fullName: '', fullNameEn: '', email: '', phone: '', school: '', schoolEn: '', degree: '', major: '', majorEn: '',
    graduationMonth: '', skills: [], cities: [], targetRoles: ['大模型', '算法', 'AI'], resumeText: '', career: { ...emptyCareerInput(), sources: [], educations: [], internships: [], projects: [], publications: [] }, version: 0, updatedAt: '' };
}

test('first-run help appears for a genuinely empty profile despite built-in search directions', () => {
  const profile = empty();
  assert.equal(hasPersonalProfile(profile), false);
  assert.equal(shouldOfferOnboarding(profile, undefined), true);
});

test('existing contact, career drafts, sources, or resume text suppress automatic first-run help', () => {
  const full = createCareerFormFixtureProfile();
  const candidates: Profile[] = [
    { ...empty(), fullName: '虚构用户' }, { ...empty(), email: 'fixture@example.invalid' }, { ...empty(), phone: '13000000000' },
    { ...empty(), resumeText: '虚构材料原文' }, { ...empty(), skills: ['Python'] }, { ...empty(), cities: ['杭州'] },
    { ...empty(), career: { ...empty().career!, projects: full.career!.projects } },
    { ...empty(), career: { ...empty().career!, sources: [{ id: 'fictional-source', kind: 'resume', label: '虚构简历', text: '虚构来源原文', createdAt: '' }] } },
  ];
  for (const profile of candidates) assert.equal(shouldOfferOnboarding(profile, undefined), false);
});

test('whitespace personal fields do not accidentally hide onboarding', () => {
  const profile = { ...empty(), fullName: '  ', resumeText: '\n', skills: ['  '], cities: ['\t'] };
  assert.equal(shouldOfferOnboarding(profile, undefined), true);
});

test('skip and completed receipts only suppress help; they do not invent profile readiness', () => {
  for (const status of ['skipped', 'completed'] as const) {
    const profile = empty(), before = structuredClone(profile);
    assert.equal(shouldOfferOnboarding(profile, { version: 1, status }), false);
    assert.equal(hasPersonalProfile(profile), false);
    assert.deepEqual(profile, before);
  }
});

test('malformed, oversized and unrelated local storage values are ignored', () => {
  for (const raw of [null, '', 'invalid', '[]', 'null', 'true', '{}', '{"version":2,"status":"completed"}',
    '{"version":1,"status":"confirmed"}', '{"version":1,"status":"completed","profile":"private"}', ' '.repeat(101)]) {
    assert.equal(readOnboardingReceipt(raw), undefined);
  }
  assert.deepEqual(readOnboardingReceipt('{"version":1,"status":"skipped"}'), { version: 1, status: 'skipped' });
  assert.deepEqual(readOnboardingReceipt('{"version":1,"status":"completed"}'), { version: 1, status: 'completed' });
});

test('guide stages distinguish imported draft from reviewed data and final navigation', () => {
  assert.deepEqual(onboardingSteps('import').map(step => step.status), ['current', 'upcoming', 'upcoming']);
  assert.deepEqual(onboardingSteps('review').map(step => step.status), ['complete', 'current', 'upcoming']);
  assert.deepEqual(onboardingSteps('apply').map(step => step.status), ['complete', 'complete', 'current']);
  assert.deepEqual(onboardingSteps('apply').map(step => step.id), ['import', 'review', 'apply']);
});

test('confirmation count requires a current confirmed revision and does not change any record or primary education', () => {
  const profile = createCareerFormFixtureProfile(), before = structuredClone(profile);
  const records = [...profile.career!.educations, ...profile.career!.internships, ...profile.career!.projects, ...profile.career!.publications];
  records[0]!.confirmation = 'pending'; records[0]!.confirmedRevision = null;
  records[1]!.confirmation = 'confirmed'; records[1]!.confirmedRevision = records[1]!.revision - 1;
  const expected = records.filter(record => record.confirmation !== 'confirmed' || record.confirmedRevision !== record.revision).length;
  const actualBefore = structuredClone(profile);
  assert.equal(pendingCareerConfirmationCount(profile), expected);
  assert.deepEqual(profile, actualBefore);
  assert.equal(profile.career!.primaryEducationId, before.career!.primaryEducationId);
  assert.equal(pendingCareerConfirmationCount({ ...empty(), career: undefined }), 0);
});
