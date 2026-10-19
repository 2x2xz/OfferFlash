import type { Profile } from '../../shared/src/contracts.js';

export const ONBOARDING_STORAGE_KEY = 'offeragent.onboarding.v1';
export type OnboardingStep = 'import' | 'review' | 'apply';
export type OnboardingReceipt = { version: 1; status: 'skipped' | 'completed' };

/** The default search directions are not personal facts and must not hide first-run help. */
export function hasPersonalProfile(profile: Profile): boolean {
  const ordinary = [profile.fullName, profile.fullNameEn, profile.email, profile.phone, profile.school,
    profile.schoolEn, profile.degree, profile.major, profile.majorEn, profile.graduationMonth, profile.resumeText];
  if (ordinary.some(value => value.trim()) || profile.skills.some(value => value.trim()) || profile.cities.some(value => value.trim())) return true;
  const career = profile.career;
  return !!career && (career.sources.length > 0 || career.educations.length > 0 || career.internships.length > 0
    || career.projects.length > 0 || career.publications.length > 0);
}

export function readOnboardingReceipt(raw: string | null): OnboardingReceipt | undefined {
  if (!raw || raw.length > 100) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const receipt = value as Record<string, unknown>;
    if (receipt.version !== 1 || (receipt.status !== 'skipped' && receipt.status !== 'completed')
      || Object.keys(receipt).some(key => key !== 'version' && key !== 'status')) return;
    return { version: 1, status: receipt.status };
  } catch { return; }
}

export function shouldOfferOnboarding(profile: Profile, receipt: OnboardingReceipt | undefined): boolean {
  return !receipt && !hasPersonalProfile(profile);
}

/** Guide progress is a UI hint. It never confirms records, selects education, or writes profile facts. */
export function onboardingSteps(current: OnboardingStep): Array<{ id: OnboardingStep; label: string; status: 'complete' | 'current' | 'upcoming' }> {
  const steps = [{ id: 'import', label: '导入简历' }, { id: 'review', label: '核对资料' }, { id: 'apply', label: '打开网申' }] as const;
  const index = steps.findIndex(step => step.id === current);
  return steps.map((step, position) => ({ ...step, status: position < index ? 'complete' : position === index ? 'current' : 'upcoming' }));
}

export function pendingCareerConfirmationCount(profile: Profile): number {
  if (!profile.career) return 0;
  return [...profile.career.educations, ...profile.career.internships, ...profile.career.projects, ...profile.career.publications]
    .filter(record => record.confirmation !== 'confirmed' || record.confirmedRevision !== record.revision).length;
}
