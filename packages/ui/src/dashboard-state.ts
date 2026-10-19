import type { AppState, Job } from '../../shared/src/contracts.js';
import { buildApplicationAgenda } from '../../domain/src/agenda.js';
import { isJobDeadlineExpired } from '../../domain/src/matching.js';

const eligibilityOrder: Record<Job['match']['eligible'], number> = { likely: 0, review: 1, unsuitable: 2 };

/** Project stored facts for the dashboard; matching scores and application states are never changed here. */
export function deriveDashboardState(state: Pick<AppState, 'jobs' | 'applications' | 'settings'>, now = new Date()) {
  const visibleJobs = state.jobs.filter(job => !job.demo || state.settings.showDemo);
  const visibleApplications = state.applications.filter(item => !item.demo || state.settings.showDemo);
  const recommended = visibleJobs.filter(job => job.match.eligible !== 'unsuitable' && !isJobDeadlineExpired(job.deadline, now))
    .sort((left, right) => eligibilityOrder[left.match.eligible] - eligibilityOrder[right.match.eligible]
      || right.match.score - left.match.score || left.id.localeCompare(right.id)).slice(0, 3);
  const agenda = buildApplicationAgenda(state, { days: 7, includeUndated: true, limit: 3 }, now);
  return {
    visibleJobs, visibleApplications, recommended, agenda,
    recentApplications: [...visibleApplications].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 3),
    counts: {
      jobs: visibleJobs.length,
      progressing: visibleApplications.filter(item => ['applied', 'assessment', 'interview'].includes(item.status)).length,
      agenda: agenda.total,
      offers: visibleApplications.filter(item => item.status === 'offer').length,
    },
  };
}
