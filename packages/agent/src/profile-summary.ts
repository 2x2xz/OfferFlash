import { Type } from 'typebox';
import type { CareerHistory, CareerRecordState, Profile } from '../../shared/src/contracts.js';
import { withConfirmedEducation } from '../../profile/src/career-input.js';

const exact = { additionalProperties: false } as const;
const text = Type.String();
const period = { startDate: text, endDate: text };
const careerSummarySchema = Type.Object({
  primaryEducationId: Type.Union([text, Type.Null()]),
  confirmedCount: Type.Integer({ minimum: 0 }), pendingCount: Type.Integer({ minimum: 0 }),
  educations: Type.Array(Type.Object({ id: text, school: text, degree: text, major: text, ...period }, exact)),
  internships: Type.Array(Type.Object({ id: text, organization: text, role: text, current: Type.Boolean(), ...period }, exact)),
  projects: Type.Array(Type.Object({ id: text, name: text, role: text, technologies: Type.Array(text), ongoing: Type.Boolean(), ...period }, exact)),
  publications: Type.Array(Type.Object({ id: text, title: text, venue: text, publicationDate: text,
    status: Type.Union(['published', 'accepted', 'preprint', 'submitted', 'in-progress'].map(value => Type.Literal(value))) }, exact)),
}, exact);

export const profileSummarySchema = Type.Object({
  version: Type.Integer({ minimum: 0 }), school: text, major: text, degree: text, graduationMonth: text,
  skills: Type.Array(text), cities: Type.Array(text), targetRoles: Type.Array(text),
  acceptedRecruitmentTypes:Type.Optional(Type.Array(Type.Union(['campus','internship','experienced'].map(v=>Type.Literal(v))))),
  careerSummary: Type.Optional(careerSummarySchema),
}, exact);

const isConfirmed = (record: CareerRecordState) => record.confirmation === 'confirmed'
  && record.revision > 0 && record.confirmedRevision === record.revision && !!record.confirmedAt;

/** Confirmed professional metadata only: no contacts, raw source, quotes, descriptions or authors. */
function professionalSummary(career: CareerHistory) {
  const all = [...career.educations, ...career.internships, ...career.projects, ...career.publications];
  return {
    primaryEducationId: career.primaryEducationId,
    confirmedCount: all.filter(isConfirmed).length, pendingCount: all.filter(item => !isConfirmed(item)).length,
    educations: career.educations.filter(isConfirmed).map(item => ({ id: item.id, school: item.school, degree: item.degree,
      major: item.major, startDate: item.startDate, endDate: item.endDate })),
    internships: career.internships.filter(isConfirmed).map(item => ({ id: item.id, organization: item.organization,
      role: item.role, startDate: item.startDate, endDate: item.endDate, current: item.current })),
    projects: career.projects.filter(isConfirmed).map(item => ({ id: item.id, name: item.name, role: item.role,
      technologies: [...item.technologies], startDate: item.startDate, endDate: item.endDate, ongoing: item.ongoing })),
    publications: career.publications.filter(isConfirmed).map(item => ({ id: item.id, title: item.title, venue: item.venue,
      publicationDate: item.publicationDate, status: item.status })),
  };
}

export function getProfileSummary(profile: Profile) {
  profile = withConfirmedEducation(profile);
  return { version: profile.version, school: profile.school, major: profile.major, degree: profile.degree,
    graduationMonth: profile.graduationMonth, skills: [...profile.skills], cities: [...profile.cities], targetRoles: [...profile.targetRoles],
    ...(profile.acceptedRecruitmentTypes?{acceptedRecruitmentTypes:[...profile.acceptedRecruitmentTypes]}:{}),
    ...(profile.career ? { careerSummary: professionalSummary(profile.career) } : {}) };
}
