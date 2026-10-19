import { createHash } from 'node:crypto';
import type { BrowserBounds, JobInput, SourceCollectionReport, SourceCollectionResult } from '../../shared/src/contracts.js';

export interface BrowserCollectionOptions {
  sourceId: string; maxPages?: number; detailLimit?: number; keyword?: string; signal?: AbortSignal;
}
export interface PaginationTarget {
  index: number; signature: string; bounds: BrowserBounds; disabled: boolean; href: string;
}
export interface BrowserListPage {
  url: string; title: string; recognized: boolean; fingerprint: string; scopeKey: string;
  jobs: JobInput[]; links: string[]; next: PaginationTarget | null;
}
/** The driver reads pages and sends validated native input; it never runs instructions from page text. */
export interface BrowserCollectionDriver {
  observeList(signal?: AbortSignal): Promise<BrowserListPage>;
  advance(page: BrowserListPage, signal?: AbortSignal): Promise<BrowserListPage>;
  readDetail(job: JobInput, signal?: AbortSignal): Promise<Partial<JobInput>>;
}

export const BROWSER_COLLECTION_SOURCES = {
  'bytedance-campus': { origin: 'https://jobs.bytedance.com', company: '字节跳动', name: '字节跳动校园招聘' },
  'tencent-campus': { origin: 'https://join.qq.com', company: '腾讯', name: '腾讯校园招聘' },
} as const;

export function browserCollectionSource(sourceId: string): (typeof BROWSER_COLLECTION_SOURCES)[keyof typeof BROWSER_COLLECTION_SOURCES] {
  const source = BROWSER_COLLECTION_SOURCES[sourceId as keyof typeof BROWSER_COLLECTION_SOURCES];
  if (!source) throw new Error('这个来源尚未接入受控浏览器分页。');
  return source;
}

/** Explicit known detail paths only. A same-origin link alone is insufficient. */
export function isCollectionDetailURL(raw: string, sourceId: string): boolean {
  try {
    const source = browserCollectionSource(sourceId);
    const url = new URL(raw);
    if (url.origin !== source.origin || url.username || url.password) return false;
    if (sourceId === 'bytedance-campus') return /^\/campus\/position\/[\w-]+\/detail\/?$/.test(url.pathname);
    if (/^\/(?:postdetail|positiondetail|jobdetail|jobdesc)(?:\.html)?\/?$/i.test(url.pathname)) {
      return [...url.searchParams.entries()].some(([key, value]) => /^(?:id|postid|positionid|jobid)$/i.test(key) && /^[\w-]+$/.test(value));
    }
    if (url.pathname === '/post.html') return [...url.searchParams.entries()].some(([key, value]) => /^(?:id|postid)$/i.test(key) && /^[\w-]+$/.test(value));
    return /^#\/(?:postdetail|positiondetail|jobdetail)(?:\/(?:[\w-]+)|\?(?:id|postId|positionId)=)[\w=&%-]*$/i.test(url.hash);
  } catch { return false; }
}

export function isCollectionListURL(raw: string, sourceId: string): boolean {
  try {
    const url = new URL(raw);
    if (url.origin !== browserCollectionSource(sourceId).origin || url.username || url.password || isCollectionDetailURL(raw, sourceId)) return false;
    if (sourceId === 'bytedance-campus') return /^\/campus\/position\/?$/.test(url.pathname);
    return !/(?:login|apply|application|resume|profile|myapply|account)/i.test(url.pathname + url.hash)
      && /^(?:\/|\/(?:post|position|jobs?|joblist|list)(?:\.html)?\/?)$/i.test(url.pathname);
  } catch { return false; }
}

export function collectionFingerprint(links: string[], jobs: JobInput[]): string {
  return createHash('sha256').update(JSON.stringify({ links: [...new Set(links)].sort(), jobs: jobs.map(job => [job.url, job.title, job.city, job.description]).sort() })).digest('hex');
}

export function collectionScopeKey(raw: string, filters: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) if (/^(?:page|pageindex|pagenum|offset)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return createHash('sha256').update(`${url.origin}${url.pathname}?${url.searchParams.toString()}|${url.hash.replace(/([?&](?:page|pageIndex|pageNum)=)\d+/g, '$1')}|${filters}`).digest('hex');
}

export function checkCollectionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('采集已取消。', 'AbortError');
}

function limit(value: number | undefined, fallback: number, max: number, name: string, min = 1): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${name}必须是 ${min}–${max} 的整数。`);
  return result;
}

/** Bounded traversal. Missing pagination never implies all positions have been visited. */
export async function runBrowserCollection(options: BrowserCollectionOptions, driver: BrowserCollectionDriver): Promise<SourceCollectionResult> {
  const source = browserCollectionSource(options.sourceId);
  const maxPages = limit(options.maxPages, 3, 10, '最多页数');
  const detailLimit = limit(options.detailLimit, 10, 50, '详情数量', 0);
  if (options.keyword !== undefined && (typeof options.keyword !== 'string' || options.keyword.length > 200)) throw new Error('采集关键词必须是最多 200 字的文本。');
  const keyword = options.keyword?.trim() ?? '';
  const report: SourceCollectionReport = {
    schemaVersion: 1, status: 'failed', query: { keyword, pageSize: null, maxPages, detailLimit },
    scope: { mode: 'browser-list-pages', listURL: source.origin, description: '当前官网列表及已设置的筛选条件；只采集 AI / 大模型 / 算法相关链接，覆盖范围不代表全站。输入关键词仅作记录，不自动填写官网搜索框。' },
    pagesRequested: 0, pagesSucceeded: 0, officialTotal: null, listedCount: 0,
    detailRequested: 0, detailSucceeded: 0, detailFailed: 0,
    stopReason: 'pagination-unavailable', errors: [], detailResults: [],
  };
  const found = new Map<string, JobInput>();
  const fingerprints = new Set<string>();
  let initialScope: string | undefined;
  let page: BrowserListPage | undefined;
  try {
    checkCollectionAborted(options.signal);
    report.pagesRequested++;
    page = await driver.observeList(options.signal);
    try { const start = new URL(page.url); if (/^https?:$/.test(start.protocol) && !start.username && !start.password) report.scope.listURL = start.href; } catch { /* Keep known official scope for malformed observations. */ }
    initialScope = page.scopeKey;
    for (;;) {
      checkCollectionAborted(options.signal);
      if (!isCollectionListURL(page.url, options.sourceId) || page.scopeKey !== initialScope) {
        report.stopReason = 'scope-changed';
        report.errors.push({ stage: 'list', pageIndex: report.pagesRequested, code: 'scope-changed', message: '网页离开本次官网列表或筛选条件变化，保留已读取结果。' });
        break;
      }
      if (!page.recognized) {
        report.stopReason = 'pagination-unavailable';
        report.errors.push({ stage: 'list', pageIndex: report.pagesRequested, code: 'list-not-recognized', message: '没有识别到已接入官网职位列表；请手动进入职位列表后重试。' });
        break;
      }
      if (fingerprints.has(page.fingerprint)) { report.stopReason = 'repeated-page'; break; }
      fingerprints.add(page.fingerprint);
      report.pagesSucceeded++;
      for (const job of page.jobs) if (isCollectionDetailURL(job.url, options.sourceId) && !found.has(job.url)) found.set(job.url, { ...job });
      if (!page.next) { report.stopReason = 'pagination-unavailable'; break; }
      if (page.next.disabled) { report.stopReason = 'exhausted'; break; }
      if (report.pagesSucceeded >= maxPages) { report.stopReason = 'page-limit'; break; }
      report.pagesRequested++;
      page = await driver.advance(page, options.signal);
    }
  } catch (error) {
    report.stopReason = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted'
      : error instanceof Error && error.name === 'ScopeChangedError' ? 'scope-changed' : 'request-failed';
    report.errors.push({ stage: 'list', pageIndex: report.pagesRequested || 1, code: report.stopReason, message: error instanceof Error ? error.message.slice(0, 5000) : '列表读取失败，保留已读取结果。' });
  }
  report.listedCount = found.size;
  if (report.stopReason !== 'aborted' && report.stopReason !== 'scope-changed') {
    for (const [url, job] of [...found].slice(0, detailLimit)) {
      let requested = false;
      try {
        checkCollectionAborted(options.signal);
        report.detailRequested++; requested = true;
        const details = await driver.readDetail(job, options.signal);
        checkCollectionAborted(options.signal);
        // Detail readers cannot change the stable source, identity or invent dates.
        found.set(url, { ...job, description: details.description ?? job.description, requirements: details.requirements ?? job.requirements,
          city: details.city || job.city, observedAt: new Date().toISOString(), publishedAt: null, deadline: null });
        report.detailSucceeded++;
        report.detailResults!.push({ jobURL: job.url, status: 'success' });
      } catch (error) {
        const cancelled = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
        if (requested) { report.detailFailed++; report.detailResults!.push({ jobURL: job.url, status: 'failed' }); }
        report.errors.push({ stage: 'detail', jobId: `browser-${createHash('sha256').update(job.url).digest('hex').slice(0, 24)}`,
          code: cancelled ? 'aborted' : 'detail-read-failed', message: error instanceof Error ? error.message.slice(0, 5000) : '岗位详情读取失败。' });
        if (cancelled) { report.stopReason = 'aborted'; break; }
        if (error instanceof Error && error.name === 'ScopeChangedError') { report.stopReason = 'scope-changed'; break; }
      }
    }
  }
  const unread = Math.max(0, report.listedCount - report.detailSucceeded);
  report.scope.description += ` 已成功读取 ${report.pagesSucceeded} 页、列出 ${report.listedCount} 条，${report.detailSucceeded} 条详情已读取，${unread} 条仍保留列表信息；发布时间未推测。`;
  report.status = report.pagesSucceeded === 0 ? 'failed' : report.stopReason === 'exhausted' && report.detailFailed === 0 ? 'success' : 'partial';
  return { jobs: [...found.values()], report };
}
