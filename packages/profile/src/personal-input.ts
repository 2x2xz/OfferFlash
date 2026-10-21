import type { PersonalProfile, PersonalProfileInput, Profile, ProfileInput } from '../../shared/src/contracts.js';

export function emptyPersonalInput(): PersonalProfileInput {
  return { schemaVersion: 1, languages: [], software: [], awards: [], selfEvaluation: '', sourceNote: '' };
}
/** Save DTO: confirmation is produced by the host, never copied from a draft. */
export function pickPersonalInput(value: PersonalProfileInput): PersonalProfileInput {
  return { schemaVersion: 1,
    languages: value.languages.map(item => ({ id: item.id, language: item.language, examName: item.examName, score: item.score,
      certificateName: item.certificateName, selfAssessment: item.selfAssessment, listeningSpeaking: item.listeningSpeaking, readingWriting: item.readingWriting, sourceNote: item.sourceNote })),
    software: value.software.map(item => ({ id: item.id, name: item.name, proficiency: item.proficiency, description: item.description, sourceNote: item.sourceNote })),
    awards: value.awards.map(item => ({ id: item.id, name: item.name, issuer: item.issuer, date: item.date, description: item.description, sourceNote: item.sourceNote })),
    selfEvaluation: value.selfEvaluation, sourceNote: value.sourceNote };
}
export function personalHasContent(value?: PersonalProfileInput): boolean {
  return !!value && (!!value.selfEvaluation.trim() || value.languages.some(item => !!item.language.trim())
    || value.software.some(item => !!item.name.trim()) || value.awards.some(item => !!item.name.trim()));
}
export function confirmedPersonalProfile(profile: Profile): PersonalProfile | undefined {
  const personal = profile.personal;
  return personal && personal.revision > 0 && personal.confirmedRevision === personal.revision && personal.confirmedAt ? personal : undefined;
}
function equal(left: PersonalProfileInput, right: PersonalProfileInput): boolean {
  return JSON.stringify(pickPersonalInput(left)) === JSON.stringify(pickPersonalInput(right));
}
/** Omitted optional fields from older callers preserve saved data; explicit empty values clear it. */
export function personalProfileOnSave<T extends ProfileInput>(input: T, previous: Profile): Omit<T, 'personal'> & { personal?: PersonalProfile } {
  const { personal, ...base } = input;
  const result: Omit<T, 'personal'> & { personal?: PersonalProfile } = { ...base,
    ...(input.birthDate === undefined && previous.birthDate !== undefined ? { birthDate: previous.birthDate } : {}) };
  if (personal === undefined) {
    if (previous.personal) result.personal = structuredClone(previous.personal);
  } else if (previous.personal && equal(personal, previous.personal)) result.personal = structuredClone(previous.personal);
  else result.personal = { ...pickPersonalInput(personal), revision: (previous.personal?.revision ?? 0) + 1, confirmedRevision: null, confirmedAt: null };
  return result;
}
