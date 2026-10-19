import type { AppState } from '../../shared/src/contracts.js';
import { matchJob } from '../../domain/src/matching.js';
import { compactJob } from './job-query.js';

export function compareJobs(state: Pick<AppState, 'profile' | 'jobs'>, args: unknown, now = new Date()) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'jobIds')) throw new Error('岗位对比参数无效。');
  const ids = (args as { jobIds?: unknown }).jobIds;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 5 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error('请选择两到五个不同的真实岗位。');
  if (!Number.isFinite(now.getTime())) throw new Error('检查日期无效。');
  const jobs = ids.map(id => {
    const job = state.jobs.find(item => item.id === id);
    if (!job) throw new Error(`岗位不存在：${id}。请重新查询，不使用过期或猜测的 ID。`);
    return compactJob({ ...job, match: matchJob(state.profile, job, now) });
  });
  return { jobs, profileVersion: state.profile.version, checkedAt: now.toISOString(), coverage: 'selected-local-jobs' as const, scoreMeaning: 'rule-ranking-not-hiring-probability' as const };
}
