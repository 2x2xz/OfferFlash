import type { JobInput, SourceCollectionOptions, SourceCollectionReport, SourceCollectionResult } from '../../shared/src/contracts.js';

const ORIGIN = 'https://careers.tencent.com';
const LIST_PATH = '/tencentcareer/api/post/Query';
const DETAIL_PATH = '/tencentcareer/api/post/ByPostId';
const SOURCE_ID = 'tencent-experienced';
const SOURCE_NAME = '腾讯招聘 · 经验岗位';
const BODY_LIMIT = 8 * 1024 * 1024;

interface TencentPost {
  PostId: string; RecruitPostName: string; LocationName?: string; Responsibility?: string;
  Requirement?: string; RequireWorkYearsName?: string; LastUpdateTime?: string; PostURL?: string;
}

class CollectionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new TypeError(`${label}必须为 ${minimum}–${maximum} 的整数。`);
  return result;
}

function post(value: unknown, expectedId?: string): TencentPost {
  if (!object(value) || typeof value.PostId !== 'string' || !/^\d{1,30}$/.test(value.PostId)
    || typeof value.RecruitPostName !== 'string' || !value.RecruitPostName.trim() || value.RecruitPostName.length > 500) {
    throw new CollectionError('INVALID_POST', '官网岗位缺少可信数字 PostId 或有效岗位名称。');
  }
  if (expectedId !== undefined && value.PostId !== expectedId) throw new CollectionError('DETAIL_ID_MISMATCH', '官网详情返回的 PostId 与列表岗位不一致，未采用该详情。');
  if (expectedId !== undefined && (typeof value.Responsibility !== 'string' || typeof value.Requirement !== 'string')) {
    throw new CollectionError('INVALID_DETAIL', '官网详情未明确返回职责或任职要求文字，保留列表候选；未把缺失字段当作完整详情。');
  }
  const lengths: Record<string, number> = { LocationName: 300, Responsibility: 90_000, Requirement: 90_000, RequireWorkYearsName: 500, LastUpdateTime: 100, PostURL: 4096 };
  for (const [key, maximum] of Object.entries(lengths)) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > maximum)) {
      throw new CollectionError('INVALID_POST', `官网岗位的 ${key} 格式有误或超出长度限制。`);
    }
  }
  // A site-provided URL is evidence only. Never follow it or allow it to change the official host.
  if (typeof value.PostURL === 'string' && value.PostURL) {
    let address: URL;
    try { address = new URL(value.PostURL); } catch { throw new CollectionError('INVALID_POST_URL', '官网岗位链接无法解析。'); }
    if (!['https:', 'http:'].includes(address.protocol) || address.hostname !== 'careers.tencent.com' || address.port
      || address.username || address.password || address.pathname !== '/jobdesc.html' || address.searchParams.get('postId') !== value.PostId) {
      throw new CollectionError('INVALID_POST_URL', '官网岗位链接与可信岗位 ID 或官方主机不一致。');
    }
  }
  return value as unknown as TencentPost;
}

function asJob(item: TencentPost, observedAt: string): JobInput {
  return {
    id: `tencent-${item.PostId}`, company: '腾讯', title: item.RecruitPostName.trim(), city: item.LocationName?.trim() ?? '', type: 'experienced',
    description: `${item.Responsibility ?? ''}${item.LastUpdateTime ? `\n\n官网更新时间：${item.LastUpdateTime}（不是发布日期）` : ''}`,
    requirements: [item.RequireWorkYearsName, item.Requirement].filter(Boolean).join('\n\n'),
    url: `${ORIGIN}/jobdesc.html?postId=${item.PostId}`, sourceId: SOURCE_ID, sourceName: SOURCE_NAME,
    observedAt, publishedAt: null, deadline: null, demo: false,
  };
}

async function officialJSON(url: URL, signal: AbortSignal | undefined, request: typeof fetch): Promise<unknown> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await request(url, {
      redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (signal?.aborted) throw new CollectionError('ABORTED', '采集已取消，保留此前取得的岗位。');
    throw new CollectionError('REQUEST_FAILED', error instanceof Error ? error.message : '官网请求失败。');
  }
  if (response.redirected || (response.url && new URL(response.url).origin !== ORIGIN)) throw new CollectionError('UNSAFE_REDIRECT', '官网响应发生重定向或离开官方来源，未采用响应。');
  if (!response.ok) throw new CollectionError('HTTP_ERROR', `腾讯来源返回 HTTP ${response.status}。`);
  if (Number(response.headers.get('content-length')) > BODY_LIMIT) throw new CollectionError('INVALID_RESPONSE', '官网响应超出采集大小限制。');
  let text: string;
  try {
    // Enforce the byte budget while reading, rather than after buffering an unbounded body.
    const reader = response.body?.getReader();
    const parts: string[] = [];
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (reader) {
        signal?.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > BODY_LIMIT) throw new CollectionError('INVALID_RESPONSE', '官网响应超出采集大小限制。');
        parts.push(decoder.decode(part.value, { stream: true }));
      }
      parts.push(decoder.decode());
      text = parts.join('');
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throw error;
    } finally { reader?.releaseLock(); }
    signal?.throwIfAborted();
  } catch (error) {
    if (signal?.aborted) throw new CollectionError('ABORTED', '采集已取消，保留此前取得的岗位。');
    if (error instanceof CollectionError) throw error;
    throw new CollectionError('REQUEST_FAILED', '官网响应读取失败。');
  }
  try { return JSON.parse(text) as unknown; }
  catch { throw new CollectionError('INVALID_RESPONSE', '官网响应不是可解析的 JSON。'); }
}

function payload(value: unknown): unknown {
  if (!object(value) || value.Code !== 200 || !object(value.Data)) throw new CollectionError('INVALID_RESPONSE', '腾讯来源响应 Code/Data 结构变化，未采用未经核对的数据。');
  return value.Data;
}

function listPayload(value: unknown, pageSize: number): { total: number; posts: TencentPost[] } {
  const data = payload(value) as Record<string, unknown>;
  // Tencent currently exposes Count. Total is accepted for an explicit compatible response,
  // but conflicting counters must not be silently treated as a complete collection.
  const total = data.Count ?? data.Total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total > 1_000_000
    || (data.Count !== undefined && data.Total !== undefined && data.Count !== data.Total)
    || !Array.isArray(data.Posts) || data.Posts.length > pageSize || data.Posts.length > total) {
    throw new CollectionError('INVALID_RESPONSE', '腾讯列表 Count/Total 或 Posts 结构变化，未采用该页。');
  }
  return { total, posts: data.Posts.map(item => post(item)) };
}

function reportError(report: SourceCollectionReport, error: unknown, stage: 'list' | 'detail', pageIndex?: number, jobId?: string): void {
  const code = error instanceof CollectionError ? error.code : 'REQUEST_FAILED';
  const message = error instanceof Error ? error.message.slice(0, 1200) : '采集失败。';
  report.errors.push({ stage, ...(pageIndex === undefined ? {} : { pageIndex }), ...(jobId === undefined ? {} : { jobId }), code, message });
}

/** Collect a bounded official list and bounded details; a failed later page never discards earlier jobs. */
export async function collectTencentJobs(
  options: SourceCollectionOptions & { keyword?: string; signal?: AbortSignal } = {}, request: typeof fetch = fetch,
): Promise<SourceCollectionResult> {
  const maxPages = integerOption(options.maxPages, 3, 1, 10, '最多页数');
  const pageSize = integerOption(options.pageSize, 20, 1, 50, '每页岗位数');
  const detailLimit = integerOption(options.detailLimit, 10, 0, 50, '详情上限');
  if (options.keyword !== undefined && (typeof options.keyword !== 'string' || options.keyword.length > 200)) throw new TypeError('搜索关键词必须是最多 200 字的文本。');
  const keyword = options.keyword?.trim() ?? '';
  const report: SourceCollectionReport = {
    schemaVersion: 1, status: 'success', query: { keyword, pageSize, maxPages, detailLimit },
    scope: { mode: 'official-api-pages', listURL: `${ORIGIN}${LIST_PATH}`, description: `腾讯官方经验岗位列表，关键词“${keyword || '全部'}”，从第 1 页开始，最多 ${maxPages} 页、每页 ${pageSize} 条；详情最多 ${detailLimit} 条。官网更新时间不是发布日期。` },
    pagesRequested: 0, pagesSucceeded: 0, officialTotal: null, listedCount: 0,
    detailRequested: 0, detailSucceeded: 0, detailFailed: 0, detailResults: [], stopReason: 'page-limit', errors: [],
  };
  const observedAt = new Date().toISOString();
  const posts = new Map<string, TencentPost>();
  const fingerprints = new Set<string>();
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
    if (options.signal?.aborted) {
      report.stopReason = 'aborted';
      reportError(report, new CollectionError('ABORTED', '采集已取消，保留此前取得的岗位。'), 'list', pageIndex);
      break;
    }
    const url = new URL(LIST_PATH, ORIGIN);
    url.search = new URLSearchParams({ pageIndex: String(pageIndex), pageSize: String(pageSize), language: 'zh-cn', area: 'cn', keyword }).toString();
    report.pagesRequested++;
    try {
      const page = listPayload(await officialJSON(url, options.signal, request), pageSize);
      report.pagesSucceeded++;
      if (report.officialTotal !== null && report.officialTotal !== page.total) {
        reportError(report, new CollectionError('TOTAL_CHANGED', `官网总量在采集期间从 ${report.officialTotal} 变为 ${page.total}，本次不能证明稳定完整覆盖。`), 'list', pageIndex);
      }
      report.officialTotal = page.total;
      if (page.posts.length === 0) {
        report.stopReason = 'empty-page';
        if (posts.size < page.total) reportError(report, new CollectionError('EARLY_EMPTY_PAGE', '官网返回空页，但已取得数量尚未达到官网总量。'), 'list', pageIndex);
        break;
      }
      const fingerprint = [...new Set(page.posts.map(item => item.PostId))].sort().join(',');
      if (fingerprints.has(fingerprint)) {
        report.stopReason = 'repeated-page';
        reportError(report, new CollectionError('REPEATED_PAGE', '官网重复返回已有页的岗位 ID，停止翻页并保留已取得岗位。'), 'list', pageIndex);
        break;
      }
      fingerprints.add(fingerprint);
      const before = posts.size;
      let duplicates = 0;
      for (const item of page.posts) {
        if (posts.has(item.PostId)) duplicates++;
        else posts.set(item.PostId, item);
      }
      if (duplicates) reportError(report, new CollectionError('DUPLICATE_ID', `该页含 ${duplicates} 个已取得的岗位 ID，已有候选优先，未重复导入。`), 'list', pageIndex);
      if (posts.size === before) {
        report.stopReason = 'no-new-items';
        break;
      }
      if (posts.size >= page.total) {
        report.stopReason = 'exhausted';
        if (posts.size > page.total) reportError(report, new CollectionError('TOTAL_INCONSISTENT', '不同页的唯一岗位数超过官网当前总量，未认定完整稳定覆盖。'), 'list', pageIndex);
        break;
      }
    } catch (error) {
      reportError(report, error, 'list', pageIndex);
      report.stopReason = options.signal?.aborted || (error instanceof CollectionError && error.code === 'ABORTED') ? 'aborted'
        : error instanceof CollectionError && ['INVALID_RESPONSE', 'INVALID_POST', 'INVALID_POST_URL', 'UNSAFE_REDIRECT'].includes(error.code) ? 'invalid-response' : 'request-failed';
      break;
    }
  }
  const entries = [...posts.values()];
  const jobs = entries.map(item => asJob(item, observedAt));
  report.listedCount = jobs.length;
  // Four bounded workers avoid one long serial chain and never issue arbitrary site-provided URLs.
  const detailCount = Math.min(detailLimit, entries.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < detailCount && !options.signal?.aborted) {
      const index = next++;
      const item = entries[index]!;
      const url = new URL(DETAIL_PATH, ORIGIN);
      url.search = new URLSearchParams({ postId: item.PostId, language: 'zh-cn' }).toString();
      report.detailRequested++;
      try {
        const detail = post(payload(await officialJSON(url, options.signal, request)), item.PostId);
        // Missing optional detail fields keep the observed list data; an empty stated field is retained as empty.
        jobs[index] = asJob({ ...item, ...detail }, observedAt);
        report.detailSucceeded++;
        report.detailResults!.push({ jobURL: jobs[index]!.url, status: 'success' });
      } catch (error) {
        report.detailFailed++;
        report.detailResults!.push({ jobURL: jobs[index]!.url, status: 'failed' });
        reportError(report, error, 'detail', undefined, `tencent-${item.PostId}`);
      }
    }
  };
  if (report.stopReason !== 'aborted') await Promise.all(Array.from({ length: Math.min(4, detailCount) }, () => worker()));
  if (options.signal?.aborted && report.stopReason !== 'aborted') {
    report.stopReason = 'aborted';
    if (!report.errors.some(item => item.code === 'ABORTED')) reportError(report, new CollectionError('ABORTED', '采集已取消，保留此前取得的岗位。'), 'detail');
  }
  const incomplete = report.errors.length > 0 || !['exhausted', 'empty-page'].includes(report.stopReason);
  report.status = incomplete ? jobs.length ? 'partial' : 'failed' : 'success';
  report.scope.description += `本次取得 ${jobs.length} 个唯一岗位，请求 ${report.detailRequested} 条详情，成功 ${report.detailSucceeded} 条；未请求的详情不代表已经核实。`;
  return { jobs, report };
}
