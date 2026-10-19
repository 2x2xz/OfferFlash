import type { JobInput, SourceDefinition } from '../../shared/src/contracts.js';
export { collectTencentJobs } from './tencent.js';

export const SOURCES: SourceDefinition[] = [
  {
    id: 'bytedance-campus', name: '字节跳动校园招聘', company: '字节跳动',
    url: 'https://jobs.bytedance.com/campus/position', type: 'campus', mode: 'browser',
    description: '打开官方岗位列表并采集当前已显示的职位链接；分页和筛选可在网页中操作。',
  },
  {
    id: 'tencent-campus', name: '腾讯校园招聘', company: '腾讯',
    url: 'https://join.qq.com/', type: 'campus', mode: 'browser',
    description: '打开官方校招网站；进入职位列表后可采集可见岗位，或保存当前职位详情。',
  },
  {
    id: 'tencent-experienced', name: '腾讯招聘 · 经验岗位', company: '腾讯',
    url: 'https://careers.tencent.com/', type: 'experienced', mode: 'public-api',
    description: '官方公开经验岗位接口，支持有界列表分页及详情采集并报告范围；与校招分开标识，不自动当作应届岗位。',
  },
];

/** Only attribute a browser candidate when both page and job belong to the known official origin. */
export function attributeBrowserJobs(jobs: JobInput[], pageURL: string): JobInput[] {
  const origin = new URL(pageURL).origin;
  const source = SOURCES.find(item => item.mode === 'browser' && new URL(item.url).origin === origin);
  if (!source) return jobs;
  return jobs.map(job => new URL(job.url).origin !== origin ? job : ({
    ...job, sourceId: source.id, sourceName: source.name,
    company: !job.company || job.company === '企业名称待确认' ? source.company : job.company,
    type: job.type === 'unknown' ? source.type : job.type,
  }));
}

interface TencentPost {
  PostId: string; RecruitPostName: string; LocationName: string; Responsibility: string;
  RequireWorkYearsName?: string; LastUpdateTime?: string; PostURL?: string;
}

export async function fetchTencentJobs(keyword: string, request: typeof fetch = fetch): Promise<JobInput[]> {
  const url = new URL('https://careers.tencent.com/tencentcareer/api/post/Query');
  url.search = new URLSearchParams({ pageIndex: '1', pageSize: '20', language: 'zh-cn', area: 'cn', keyword }).toString();
  const response = await request(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`腾讯来源返回 HTTP ${response.status}`);
  const json = await response.json() as { Code?: number; Data?: { Posts?: TencentPost[] } };
  if (json.Code !== 200 || !Array.isArray(json.Data?.Posts)) throw new Error('腾讯来源数据结构变化，未导入未经验证的岗位。');
  const observedAt = new Date().toISOString();
  return json.Data.Posts.filter(post => post.PostId && post.RecruitPostName).map(post => {
    return {
      id: `tencent-${post.PostId}`, company: '腾讯', title: post.RecruitPostName,
      city: post.LocationName || '', type: 'experienced', description: `${post.Responsibility || ''}${post.LastUpdateTime ? `\n\n官网更新时间：${post.LastUpdateTime}（不是发布日期）` : ''}`,
      requirements: post.RequireWorkYearsName || '',
      url: `https://careers.tencent.com/jobdesc.html?postId=${encodeURIComponent(post.PostId)}`,
      sourceId: 'tencent-experienced', sourceName: '腾讯招聘 · 经验岗位', observedAt,
      publishedAt: null,
      deadline: null, demo: false,
    };
  });
}
