import type { AppState, Job, MatchResult, RecruitmentType } from '../../shared/src/contracts.js';
import type { DiscoveryReport } from '../../shared/src/discovery.js';

export type Eligibility = MatchResult['eligible'];
export interface JobQueryArgs {
  keyword?: string;
  city?: string;
  recruitmentType?: RecruitmentType;
  eligibility?: Eligibility;
  offset?: number;
  limit?: number;
}

export interface JobEvidence {
  id: string; company: string; title: string; city: string; type: RecruitmentType;
  requirements: string; description: string; descriptionTruncated: boolean;
  sourceId: string; sourceName: string; url: string;
  publishedAt: string | null; observedAt: string; firstSeenAt: string; deadline: string | null;
  match: MatchResult; demo: boolean; contentTrust: 'untrusted';
  detailEvidence?: { url: string; checkedAt: string };
}

export interface JobQueryResult {
  jobs: JobEvidence[];
  totalMatched: number; returnedCount: number; offset: number; nextOffset: number | null;
  hasMore: boolean; coverage: 'local-snapshot'; profileVersion: number;
  filters: { keyword: string; city: string; recruitmentType: RecruitmentType | null; eligibility: Eligibility | null };
}

const recruitmentTypes: readonly RecruitmentType[] = ['campus', 'internship', 'experienced', 'unknown'];
const eligibilities: readonly Eligibility[] = ['likely', 'review', 'unsuitable'];
const queryKeys = new Set(['keyword', 'city', 'recruitmentType', 'eligibility', 'offset', 'limit']);

/** Revalidate at the host boundary; a model/tool schema is not the final gate. */
export function validateJobQueryArgs(value: unknown): JobQueryArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('岗位查询参数必须为对象。');
  }
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !queryKeys.has(key))) {
    throw new Error('岗位查询包含不支持的参数。');
  }
  const args = value as Record<string, unknown>;
  for (const name of ['keyword', 'city'] as const) {
    if (Object.hasOwn(args, name) && typeof args[name] !== 'string') throw new Error(`${name} 必须为文字。`);
  }
  if (Object.hasOwn(args, 'recruitmentType') && !recruitmentTypes.includes(args.recruitmentType as RecruitmentType)) {
    throw new Error('招聘类型无效。');
  }
  if (Object.hasOwn(args, 'eligibility') && !eligibilities.includes(args.eligibility as Eligibility)) {
    throw new Error('匹配条件无效。');
  }
  if (Object.hasOwn(args, 'offset') && (!Number.isSafeInteger(args.offset) || (args.offset as number) < 0)) {
    throw new Error('offset 必须为大于等于零的安全整数。');
  }
  if (Object.hasOwn(args, 'limit') && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 20)) {
    throw new Error('limit 必须为 1 到 20 的整数。');
  }
  return { ...args } as JobQueryArgs;
}

function projectJob(job: Job, descriptionLimit?: number): JobEvidence {
  return {
    id: job.id, company: job.company, title: job.title, city: job.city, type: job.type,
    requirements: job.requirements,
    description: descriptionLimit === undefined ? job.description : job.description.slice(0, descriptionLimit),
    descriptionTruncated: descriptionLimit !== undefined && job.description.length > descriptionLimit,
    sourceId: job.sourceId, sourceName: job.sourceName, url: job.url,
    publishedAt: job.publishedAt, observedAt: job.observedAt, firstSeenAt: job.firstSeenAt, deadline: job.deadline,
    match: { ...job.match, reasons: [...job.match.reasons], concerns: [...job.match.concerns] },
    demo: job.demo, contentTrust: 'untrusted',
    ...(job.detailEvidence ? { detailEvidence: { ...job.detailEvidence } } : {}),
  };
}

export function compactJob(job: Job): JobEvidence { return projectJob(job, 3000); }

export function queryJobs(state: Pick<AppState, 'profile' | 'jobs'>, value: unknown): JobQueryResult {
  const args = validateJobQueryArgs(value);
  const keyword = (args.keyword ?? '').trim();
  const city = (args.city ?? '').trim();
  const keywordFolded = keyword.toLocaleLowerCase();
  const cityFolded = city.toLocaleLowerCase();
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  const matches = state.jobs.filter(job =>
    (!keyword || `${job.company} ${job.title} ${job.requirements} ${job.description}`.toLocaleLowerCase().includes(keywordFolded))
    && (!city || job.city.toLocaleLowerCase().includes(cityFolded))
    && (!args.recruitmentType || job.type === args.recruitmentType)
    && (!args.eligibility || job.match.eligible === args.eligibility),
  ).sort((left, right) => eligibilities.indexOf(left.match.eligible) - eligibilities.indexOf(right.match.eligible)
    || right.match.score - left.match.score || left.id.localeCompare(right.id));
  const jobs = matches.slice(offset, offset + limit).map(compactJob);
  const hasMore = offset + jobs.length < matches.length;
  return {
    jobs, totalMatched: matches.length, returnedCount: jobs.length, offset,
    nextOffset: hasMore ? offset + jobs.length : null, hasMore,
    coverage: 'local-snapshot', profileVersion: state.profile.version,
    filters: { keyword, city, recruitmentType: args.recruitmentType ?? null, eligibility: args.eligibility ?? null },
  };
}

/** The persisted report owns the candidate IDs; another source sharing a URL is not this search result. */
export function queryDiscoveryJobs(state: Pick<AppState, 'profile' | 'jobs'>, report: DiscoveryReport): JobQueryResult {
  const identities = new Map(report.sources.flatMap(source => source.jobIds.map(id => [id, source.sourceId] as const)));
  return queryJobs({ ...state, jobs: state.jobs.filter(job => identities.get(job.id) === job.sourceId && !job.demo) }, {});
}

/** Detail lookup deliberately depends only on jobs, never the user's personal profile. */
export function getJobDetails(state: Pick<AppState, 'jobs'>, jobId: unknown): JobEvidence {
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('请指定真实岗位 ID。');
  const job = state.jobs.find(item => item.id === jobId);
  if (!job) throw new Error('岗位不存在。请先查询本地岗位，使用查询返回的真实 ID。');
  return projectJob(job);
}
