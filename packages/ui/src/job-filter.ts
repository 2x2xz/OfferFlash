import type { Job, RecruitmentType } from '../../shared/src/contracts.js';

export function explicitJobCities(raw: string): string[] {
  return raw.split(/[、,，;；/|]/).map(city => city.trim().replace(/等\s*(?:(?:\d+|多|若干)\s*个?\s*)?(?:城市|地点|地区)?\s*$/, '').trim()).filter(Boolean);
}

function canonicalCity(value: string): string { return value.trim().toLocaleLowerCase().replace(/市$/, ''); }

export function jobMatchesCity(raw: string, city: string): boolean {
  if (!city.trim()) return true;
  if (raw.trim() === city.trim()) return true;
  const expected = canonicalCity(city);
  return explicitJobCities(raw).some(value => canonicalCity(value) === expected);
}

export function filterSavedJobs(jobs: readonly Job[], filters: { query: string; city: string; type: string }): Job[] {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter(job => jobMatchesCity(job.city, filters.city) && (!filters.type || job.type === filters.type as RecruitmentType)
    && terms.every(term => `${job.title} ${job.company} ${job.city} ${job.requirements} ${job.description}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => b.match.score - a.match.score);
}

export function eligibilityLabel(status: Job['match']['eligible']): string {
  return status === 'likely' ? '符合已知条件' : status === 'review' ? '有条件待核对' : '不符合已知条件';
}
