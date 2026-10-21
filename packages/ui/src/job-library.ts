import type { Job, RecruitmentType } from '../../shared/src/contracts.js';

const recruitmentTypes: RecruitmentType[] = ['campus', 'internship', 'experienced', 'unknown'];

export interface SavedJobCompanyGroup {
  key: string;
  company: string;
  jobs: Job[];
  sections: Array<{ type: RecruitmentType; jobs: Job[] }>;
}

function displayedType(type: RecruitmentType): RecruitmentType {
  return type === 'campus' || type === 'internship' || type === 'experienced' ? type : 'unknown';
}

/** Presentation only: no alias, company suffix, URL or recruitment-type inference. */
export function groupSavedJobsByCompany(jobs: readonly Job[]): SavedJobCompanyGroup[] {
  const grouped = new Map<string, SavedJobCompanyGroup>();
  for (const job of jobs) {
    const normalized = job.company.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
    const key = normalized ? `company:${normalized}` : `unnamed:${job.id}`;
    let group = grouped.get(key);
    if (!group) {
      group = { key, company: job.company.trim() || '公司待确认', jobs: [], sections: [] };
      grouped.set(key, group);
    }
    group.jobs.push(job);
  }
  for (const group of grouped.values()) {
    group.sections = recruitmentTypes.map(type => ({ type, jobs: group.jobs.filter(job => displayedType(job.type) === type) }))
      .filter(section => section.jobs.length > 0);
  }
  return [...grouped.values()];
}

export function recruitmentTypeCounts(jobs: readonly Job[]): Record<RecruitmentType | 'all', number> {
  const counts = { all: jobs.length, campus: 0, internship: 0, experienced: 0, unknown: 0 };
  for (const job of jobs) counts[displayedType(job.type)]++;
  return counts;
}
