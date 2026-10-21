import type {
  CareerCollection, CareerHistory, CareerInput, CareerEvidence, CareerSourceInput,
  EducationInput, EducationRecord, InternshipInput, ProjectInput, PublicationInput, Profile,
} from '../../shared/src/contracts.js';

export const CAREER_COLLECTIONS: readonly CareerCollection[] = ['educations', 'internships', 'projects', 'publications'];
export function emptyCareerInput(): CareerInput {
  return { schemaVersion: 1, sources: [], educations: [], internships: [], projects: [], publications: [], primaryEducationId: null };
}

function evidence(value: CareerEvidence[]): CareerEvidence[] {
  return (value ?? []).map(item => ({ field: item.field, sourceId: item.sourceId, quote: item.quote, location: item.location, originalValue: item.originalValue }));
}
function source(item: CareerSourceInput): CareerSourceInput {
  return { id: item.id, kind: item.kind, label: item.label, text: item.text,
    ...(item.fileName !== undefined ? { fileName: item.fileName } : {}), ...(item.fileHash !== undefined ? { fileHash: item.fileHash } : {}) };
}

/** Explicit DTO projection: server confirmation/revision/timestamps never become save input. */
export function pickCareerInput(value?: CareerInput | CareerHistory): CareerInput {
  if (!value) return emptyCareerInput();
  return {
    schemaVersion: 1, sources: value.sources.map(source), primaryEducationId: value.primaryEducationId,
    educations: value.educations.map(item => ({ id: item.id, evidence: evidence(item.evidence), sourceNote: item.sourceNote,
      school: item.school, schoolEn: item.schoolEn, ...(item.college !== undefined ? {college:item.college} : {}),
      ...(item.majorCategory !== undefined ? {majorCategory:item.majorCategory} : {}), ...(item.schoolCategory !== undefined ? {schoolCategory:item.schoolCategory} : {}),
      ...(item.studyMode !== undefined ? {studyMode:item.studyMode} : {}), degree: item.degree, major: item.major, majorEn: item.majorEn,
      startDate: item.startDate, endDate: item.endDate, description: item.description })),
    internships: value.internships.map(item => ({ id: item.id, evidence: evidence(item.evidence), sourceNote: item.sourceNote,
      organization: item.organization, role: item.role, startDate: item.startDate, endDate: item.endDate,
      current: item.current, description: item.description, technologies: [...item.technologies] })),
    projects: value.projects.map(item => ({ id: item.id, evidence: evidence(item.evidence), sourceNote: item.sourceNote,
      name: item.name, role: item.role, startDate: item.startDate, endDate: item.endDate, ongoing: item.ongoing,
      description: item.description, technologies: [...item.technologies], url: item.url })),
    publications: value.publications.map(item => ({ id: item.id, evidence: evidence(item.evidence), sourceNote: item.sourceNote,
      title: item.title, authors: item.authors, venue: item.venue, publicationDate: item.publicationDate,
      status: item.status, doi: item.doi, url: item.url })),
  };
}

/** Reimport adds candidates; it never overwrites an existing user's record or default education. */
export function mergeCareerImport(current: CareerInput, imported: CareerInput): CareerInput {
  const result = pickCareerInput(current);
  const incoming = pickCareerInput(imported);
  for (const item of incoming.sources) if (!result.sources.some(existing => existing.id === item.id)) result.sources.push(item);
  for (const collection of CAREER_COLLECTIONS) {
    const items = result[collection] as Array<EducationInput | InternshipInput | ProjectInput | PublicationInput>;
    for (const item of incoming[collection]) if (!items.some(existing => existing.id === item.id)) items.push(item);
  }
  return result;
}

export function newCareerRecord<K extends CareerCollection>(collection: K, id: string = crypto.randomUUID()): CareerInput[K][number] {
  const base = { id, evidence: [], sourceNote: '' };
  const records = {
    educations: { ...base, school: '', schoolEn: '', college: '', degree: '', major: '', majorEn: '', startDate: '', endDate: '', description: '' },
    internships: { ...base, organization: '', role: '', startDate: '', endDate: '', current: false, description: '', technologies: [] },
    projects: { ...base, name: '', role: '', startDate: '', endDate: '', ongoing: false, description: '', technologies: [], url: '' },
    publications: { ...base, title: '', authors: '', venue: '', publicationDate: '', status: 'in-progress' as const, doi: '', url: '' },
  };
  return records[collection] as CareerInput[K][number];
}

/** Legacy callers retain their old fields; structured profiles use an explicitly confirmed record. */
export function getConfirmedPrimaryEducation(profile: Profile): EducationRecord | undefined {
  return profile.career?.educations.find(item => item.id === profile.career!.primaryEducationId
    && item.confirmation === 'confirmed' && item.revision > 0 && item.confirmedRevision === item.revision && !!item.confirmedAt);
}

export function withConfirmedEducation(profile: Profile): Profile {
  if (!profile.career) return profile;
  const chosen = getConfirmedPrimaryEducation(profile);
  return { ...profile, school: chosen?.school ?? '', schoolEn: chosen?.schoolEn ?? '', degree: chosen?.degree ?? '',
    major: chosen?.major ?? '', majorEn: chosen?.majorEn ?? '',
    graduationMonth: chosen && /^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{2})?$/.test(chosen.endDate) ? chosen.endDate.slice(0, 7) : '' };
}
