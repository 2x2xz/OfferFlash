import type { JobInput, SourceCollectionOptions, SourceCollectionReport, SourceCollectionResult } from '../../shared/src/contracts.js';
import { validateCollectionReport } from '../../shared/src/source-collection.js';
import { mainlandCityEvidence } from './mainland-discovery.js';

const ORIGIN = 'https://join.qq.com';
const MAPPING = '/api/v1/position/getProjectMapping', SEARCH = '/api/v1/position/searchPosition';
const DETAIL = '/api/v1/jobDetails/getJobDetailsByPostId';
const BODY_LIMIT = 4 * 1024 * 1024;
type FetchKind = 'mapping' | 'list' | 'detail';
interface Mapping {
  mappingId: number; recruitType: number; projectIds: string[]; projectName: string; recruitYear: string;
  graduationRange: string; groupGraduationRange: string;
}
interface Post {
  postId: string; title: string; projectId: string; projectName: string; recruitLabelName: string; city: string;
}
export interface TencentCampusMetadata {
  requestURLs: string[]; requests: Array<{ kind: FetchKind; method: 'GET' | 'POST'; url: string }>;
  requestCount: number; mappingRequests: number; maxRequests: number; totalTimeoutMs: number; duplicateCount: number;
  workCountryType: 1; keyword: string; mappingIds: number[]; mappings: Mapping[];
  listedEntriesRead: number; uniqueListedCount: number; excludedNonMainland: number;
  unverifiedLeads: Array<{ postId: string; title: string; jobURL: string; reason: 'detail-unverified' }>;
  locationEvidence: Array<{ postId: string; rawCities: string[]; mainlandCities: string[]; otherCities: string[]; unknownCities: string[] }>;
  cohortEvidence: Array<{ postId: string; jobURL: string; projectId: string; recruitType: number | null;
    projectName: string; recruitLabelName: string; mappingIds: number[]; graduationRanges: string[] }>;
  totalIsObservedResponseCountNotVerifiedKeywordCoverage: true;
}
export type TencentCampusCollectionResult = SourceCollectionResult & { metadata: TencentCampusMetadata };
class CampusError extends Error {
  constructor(readonly code: string) { super(code); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function integer(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError(`${label}超出允许的采集预算。`);
  return result;
}
function text(value: unknown, limit = 500): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new CampusError('INVALID_RESPONSE');
  return value;
}
function id(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string' || !/^\d{1,30}$/u.test(value)) throw new CampusError('INVALID_POST_ID');
  return value;
}
function payload(value: unknown): unknown {
  if (!object(value) || value.status !== 0 || !Object.hasOwn(value, 'data')) throw new CampusError('INVALID_RESPONSE');
  return value.data;
}
function parseMapping(value: unknown): Mapping[] {
  const groups = payload(value); if (!Array.isArray(groups) || groups.length > 30) throw new CampusError('INVALID_MAPPING');
  const result: Mapping[] = [], seen = new Set<number>();
  for (const group of groups) {
    if (!object(group) || !Array.isArray(group.subProjectList) || group.subProjectList.length > 100) throw new CampusError('INVALID_MAPPING');
    if (group.status === 0) continue;
    for (const raw of group.subProjectList) {
      if (!object(raw)) throw new CampusError('INVALID_MAPPING'); if (raw.status === 0) continue;
      if (typeof raw.mappingId !== 'number' || !Number.isSafeInteger(raw.mappingId) || raw.mappingId < 1 || seen.has(raw.mappingId)) throw new CampusError('INVALID_MAPPING');
      seen.add(raw.mappingId);
      const recruitType = raw.recruitType ?? group.recruitType;
      if (typeof recruitType !== 'number' || ![1, 2, 999].includes(recruitType)) throw new CampusError('INVALID_MAPPING');
      const projectIds = text(raw.projectId, 200).split(',').map(value => value.trim()).filter(Boolean);
      if (!projectIds.length || projectIds.some(value => !/^\d{1,10}$/u.test(value))) throw new CampusError('INVALID_MAPPING');
      result.push({ mappingId: raw.mappingId, recruitType, projectIds, projectName: text(raw.projectName), recruitYear: text(raw.recruitYear, 20),
        graduationRange: text(raw.recruitRangDesc, 2000), groupGraduationRange: text(group.recruitRangDesc, 2000) });
    }
  }
  if (!result.length) throw new CampusError('INVALID_MAPPING'); return result;
}
function parsePost(value: unknown): Post {
  if (!object(value)) throw new CampusError('INVALID_POST');
  const title = text(value.positionTitle).trim(); if (!title) throw new CampusError('INVALID_POST');
  return { postId: id(value.postId), title, projectId: id(value.projectId), projectName: text(value.projectName),
    recruitLabelName: text(value.recruitLabelName), city: text(value.workCities, 1000).trim() };
}
const pageURL = (postId: string) => `${ORIGIN}/post_detail.html?postid=${postId}`;
function kind(recruitType: unknown, name: string): JobInput['type'] {
  if (recruitType === 1) return 'campus'; if (recruitType === 2) return 'internship';
  if (/实习/u.test(name)) return 'internship'; if (/应届|毕业生|校园招聘/u.test(name)) return 'campus'; return 'unknown';
}
function cohort(post: Post, mappings: Mapping[]): Mapping[] { return mappings.filter(mapping => mapping.projectIds.includes(post.projectId)); }
function cohortText(post: Post, mappings: Mapping[]): string {
  const matches = cohort(post, mappings);
  return [`招聘项目（官网列表原文）：${post.projectName || '未注明'}`, `招聘标签（官网列表原文）：${post.recruitLabelName || '未注明'}`,
    ...matches.flatMap(mapping => [mapping.projectName ? `招聘批次（官网原文）：${mapping.projectName}` : '',
      mapping.graduationRange ? `批次毕业范围（官网原文）：${mapping.graduationRange}`
        : mapping.groupGraduationRange ? `项目组毕业范围（官网原文）：${mapping.groupGraduationRange}` : '毕业范围未注明'])].filter(Boolean).join('\n');
}
function listJob(post: Post, mappings: Mapping[], observedAt: string): JobInput {
  return { id: `tencent-campus-${post.postId}`, company: '腾讯', title: post.title, city: post.city,
    type: kind(undefined, `${post.recruitLabelName} ${post.projectName}`), description: `官网列表线索，尚未核实完整职责与任职要求。\n${cohortText(post, mappings)}`,
    requirements: cohortText(post, mappings), url: pageURL(post.postId), sourceId: 'tencent-campus', sourceName: '腾讯校园招聘 · 国内官网', observedAt,
    publishedAt: null, deadline: null, demo: false };
}
function cleanHTML(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '').replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>/giu, '\n').replace(/<[^>]*>/gu, '').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').trim();
}
function detailJob(value: unknown, post: Post, mappings: Mapping[], observedAt: string): { job: JobInput; evidence: TencentCampusMetadata['cohortEvidence'][number]; rawCities: string[] } {
  const raw = payload(value); if (!object(raw) || id(raw.postId) !== post.postId) throw new CampusError('DETAIL_ID_MISMATCH');
  const title = text(raw.title).trim();
  if (title.replace(/\s+/gu, ' ') !== post.title.replace(/\s+/gu, ' ')) throw new CampusError('DETAIL_TITLE_MISMATCH');
  if (raw.projectId !== undefined && id(raw.projectId) !== post.projectId) throw new CampusError('DETAIL_PROJECT_MISMATCH');
  const duties = [...new Set([text(raw.desc, 90_000), text(raw.topicDetail, 90_000)].map(cleanHTML).filter(Boolean))].join('\n\n');
  const requirements = [...new Set([text(raw.request, 90_000), text(raw.topicRequirement, 90_000)].map(cleanHTML).filter(Boolean))].join('\n\n');
  if (!duties || !requirements) throw new CampusError('INCOMPLETE_DETAIL');
  const details = [duties, cleanHTML(text(raw.introduction, 30_000))].filter(Boolean).join('\n\n');
  const combinedRequirements = `${requirements}\n\n${cohortText(post, mappings)}`;
  if (details.length > 100_000 || combinedRequirements.length > 100_000) throw new CampusError('DETAIL_TOO_LARGE');
  if (!Array.isArray(raw.workCityList) || raw.workCityList.length > 50 || raw.workCityList.some(city => typeof city !== 'string' || city.length > 100)) throw new CampusError('INVALID_DETAIL_CITIES');
  const recruitType = [1, 2, 999].includes(raw.recruitType as number) ? raw.recruitType as number : null;
  const detailKind = kind(recruitType, `${text(raw.projectName)} ${text(raw.recruitLabelName)}`), originalKind = kind(undefined, `${post.projectName} ${post.recruitLabelName}`);
  if (detailKind !== 'unknown' && originalKind !== 'unknown' && detailKind !== originalKind) throw new CampusError('DETAIL_TYPE_MISMATCH');
  const related = cohort(post, mappings);
  return { rawCities: [...raw.workCityList as string[]], job: { ...listJob(post, mappings, observedAt), title, city: (raw.workCityList as string[]).join(' / '), type: detailKind,
    description: details, requirements: combinedRequirements }, evidence: { postId: post.postId, jobURL: pageURL(post.postId), projectId: post.projectId,
    recruitType, projectName: text(raw.projectName), recruitLabelName: text(raw.recruitLabelName), mappingIds: related.map(item => item.mappingId),
    graduationRanges: related.map(item => item.graduationRange || item.groupGraduationRange).filter(Boolean) } };
}

/** Public campus reads only: the fixed search POST is a query, never an application write. */
export async function collectTencentCampusJobs(options: SourceCollectionOptions & { keyword?: string; signal?: AbortSignal; totalTimeoutMs?: number } = {},
  request: typeof fetch = fetch): Promise<TencentCampusCollectionResult> {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['keyword', 'maxPages', 'pageSize', 'detailLimit', 'signal', 'totalTimeoutMs'].includes(key))) throw new TypeError('腾讯校园采集参数无效。');
  const maxPages = integer(options.maxPages, 2, 1, 10, '页数'), pageSize = integer(options.pageSize, 20, 1, 50, '每页条数');
  const detailLimit = integer(options.detailLimit, 10, 0, 50, '详情数'), totalTimeoutMs = integer(options.totalTimeoutMs, 10_000, 1, 30_000, '整批时间');
  if (options.keyword !== undefined && (typeof options.keyword !== 'string' || options.keyword.length > 200 || /[\u0000-\u001f\u007f]/u.test(options.keyword))) throw new TypeError('搜索词无效。');
  const keyword = options.keyword?.trim() ?? '', observedAt = new Date().toISOString();
  const report: SourceCollectionReport = { schemaVersion: 1, status: 'success', query: { keyword, maxPages, pageSize, detailLimit },
    scope: { mode: 'official-api-pages', listURL: `${ORIGIN}${SEARCH}`, description: `腾讯官网国内校园渠道，国内筛选 workCountryType=1；搜索词“${keyword || '全部'}”，最多${maxPages}页、每页${pageSize}项、核对${detailLimit}条详情。包含校招与实习，按官网实际招聘类型区分；批次与毕业范围保留原文，不推断届别或发布日期。` },
    pagesRequested: 0, pagesSucceeded: 0, officialTotal: null, listedCount: 0, detailRequested: 0, detailSucceeded: 0, detailFailed: 0,
    detailResults: [], stopReason: 'page-limit', errors: [] };
  const metadata: TencentCampusMetadata = { requestURLs: [], requests: [], requestCount: 0, mappingRequests: 0, maxRequests: 1 + maxPages + detailLimit,
    totalTimeoutMs, duplicateCount: 0, workCountryType: 1, keyword, mappingIds: [], mappings: [], cohortEvidence: [], listedEntriesRead: 0, uniqueListedCount: 0,
    excludedNonMainland: 0, unverifiedLeads: [], locationEvidence: [], totalIsObservedResponseCountNotVerifiedKeywordCoverage: true };
  const posts = new Map<string, Post>(), jobs = new Map<string, JobInput>(), pages = new Set<string>();
  const controller = new AbortController(); let stopCode = 'ABORTED';
  const abort = () => { stopCode = 'ABORTED'; controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { stopCode = 'TOTAL_TIMEOUT'; controller.abort(); }, totalTimeoutMs);
  const error = (cause: unknown, stage: 'list' | 'detail', pageIndex?: number, jobId?: string) => {
    const code = cause instanceof CampusError ? cause.code : controller.signal.aborted ? stopCode : 'REQUEST_FAILED';
    report.errors.push({ stage, code, message: code === 'ABORTED' ? '本轮已取消，保留此前已取得的岗位。' : code === 'TOTAL_TIMEOUT' ? '达到本轮整批时间上限，未继续请求，保留已取得前缀。' : `腾讯官网响应未通过 ${code} 核对；未采纳未验证内容。`, ...(pageIndex ? { pageIndex } : {}), ...(jobId ? { jobId } : {}) });
    return code;
  };
  const json = async (path: string, requestKind: FetchKind, body?: unknown): Promise<unknown> => {
    if (controller.signal.aborted) throw new CampusError(stopCode);
    const url = new URL(path, ORIGIN), method = body === undefined ? 'GET' : 'POST';
    if (url.origin !== ORIGIN || ![MAPPING, SEARCH, DETAIL].includes(url.pathname) || url.username || url.password || url.hash) throw new CampusError('UNSAFE_URL');
    metadata.requestURLs.push(url.href); metadata.requests.push({ kind: requestKind, method, url: url.href }); metadata.requestCount++;
    if (requestKind === 'mapping') metadata.mappingRequests++;
    let listener!: () => void;
    const aborted = new Promise<never>((_, reject) => { listener = () => reject(new CampusError(stopCode)); controller.signal.addEventListener('abort', listener, { once: true }); });
    try {
      return await Promise.race([aborted, (async () => {
        const response = await request(url, { method, redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.redirected || response.url && response.url !== url.href) throw new CampusError('UNSAFE_REDIRECT');
        if (!response.ok) throw new CampusError(`HTTP_${response.status}`);
        if (Number(response.headers.get('content-length')) > BODY_LIMIT) throw new CampusError('BODY_LIMIT');
        const reader = response.body?.getReader(); if (!reader) throw new CampusError('MISSING_BODY');
        let size = 0, result = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
        try { for (;;) { const part = await reader.read(); if (controller.signal.aborted) throw new CampusError(stopCode); if (part.done) break;
          size += part.value.byteLength; if (size > BODY_LIMIT) throw new CampusError('BODY_LIMIT'); result += decoder.decode(part.value, { stream: true }); }
          result += decoder.decode();
        } catch (cause) { void reader.cancel().catch(() => {}); throw cause; } finally { reader.releaseLock(); }
        try { return JSON.parse(result) as unknown; } catch { throw new CampusError('INVALID_JSON'); }
      })()]);
    } finally { controller.signal.removeEventListener('abort', listener); }
  };
  try {
    try { metadata.mappings = parseMapping(await json(MAPPING, 'mapping')); metadata.mappingIds = metadata.mappings.map(mapping => mapping.mappingId); }
    catch (cause) { const code = error(cause, 'list'); report.stopReason = code === 'ABORTED' || code === 'TOTAL_TIMEOUT' ? 'aborted' : code.startsWith('HTTP_') || code === 'REQUEST_FAILED' ? 'request-failed' : 'invalid-response'; }
    if (metadata.mappingIds.length) for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
      if (controller.signal.aborted) { error(new CampusError(stopCode), 'list', pageIndex); report.stopReason = 'aborted'; break; }
      report.pagesRequested++;
      try {
        const raw = payload(await json(SEARCH, 'list', { projectIdList: [], projectMappingIdList: metadata.mappingIds, keyword, bgList: [], workCountryType: 1,
          workCityList: [], recruitCityList: [], positionFidList: [], pageIndex, pageSize }));
        if (!object(raw) || typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count) || raw.count < 0 || raw.count > 1_000_000
          || !(Array.isArray(raw.positionList) || raw.count === 0 && raw.positionList === null)) throw new CampusError('INVALID_LIST');
        const entries = raw.positionList ?? []; if (!Array.isArray(entries) || entries.length > pageSize || entries.length > raw.count) throw new CampusError('INVALID_LIST');
        const valid = entries.map(parsePost); report.pagesSucceeded++; metadata.listedEntriesRead += valid.length;
        if (report.officialTotal !== null && report.officialTotal !== raw.count) error(new CampusError('TOTAL_CHANGED'), 'list', pageIndex);
        report.officialTotal = raw.count;
        if (!valid.length) { report.stopReason = 'empty-page'; if (posts.size < raw.count) error(new CampusError('EARLY_EMPTY'), 'list', pageIndex); break; }
        const fingerprint = [...new Set(valid.map(post => post.postId))].sort().join(',');
        if (pages.has(fingerprint)) { metadata.duplicateCount += valid.length; error(new CampusError('REPEATED_PAGE'), 'list', pageIndex); report.stopReason = 'repeated-page'; break; }
        pages.add(fingerprint); const before = posts.size;
        let duplicates = 0;
        for (const post of valid) if (!posts.has(post.postId)) { posts.set(post.postId, post); jobs.set(post.postId, listJob(post, metadata.mappings, observedAt)); } else duplicates++;
        if (duplicates) { metadata.duplicateCount += duplicates; error(new CampusError('DUPLICATE_POST_ID'), 'list', pageIndex); }
        if (posts.size === before) { error(new CampusError('NO_NEW_ITEMS'), 'list', pageIndex); report.stopReason = 'no-new-items'; break; }
        if (posts.size >= raw.count) { report.stopReason = 'exhausted'; if (posts.size > raw.count) error(new CampusError('TOTAL_INCONSISTENT'), 'list', pageIndex); break; }
      } catch (cause) { const code = error(cause, 'list', pageIndex); report.stopReason = code === 'ABORTED' || code === 'TOTAL_TIMEOUT' ? 'aborted' : code.startsWith('HTTP_') || code === 'REQUEST_FAILED' ? 'request-failed' : 'invalid-response'; break; }
    }
    if (!controller.signal.aborted) for (const post of [...posts.values()].slice(0, detailLimit)) {
      if (controller.signal.aborted) break; report.detailRequested++;
      try {
        const parsed = detailJob(await json(`${DETAIL}?postId=${post.postId}`, 'detail'), post, metadata.mappings, observedAt);
        const rawCities = parsed.rawCities, normalized = rawCities.map(label => label === '深圳总部' ? '深圳' : label);
        const locale = mainlandCityEvidence({ city_list: normalized });
        metadata.locationEvidence.push({ postId: post.postId, rawCities, ...locale });
        if (locale.mainlandCities.length) jobs.set(post.postId, parsed.job); else { jobs.delete(post.postId); metadata.excludedNonMainland++; }
        metadata.cohortEvidence.push(parsed.evidence); report.detailSucceeded++;
        report.detailResults!.push({ jobURL: parsed.job.url, status: 'success' });
      } catch (cause) { report.detailFailed++; report.detailResults!.push({ jobURL: pageURL(post.postId), status: 'failed' }); error(cause, 'detail', undefined, `tencent-campus-${post.postId}`); }
    }
    if (controller.signal.aborted) { report.stopReason = 'aborted'; if (!report.errors.some(item => item.code === stopCode)) error(new CampusError(stopCode), 'list'); }
    const detailed = new Set(metadata.cohortEvidence.map(item => item.postId));
    for (const post of posts.values()) if (!detailed.has(post.postId)) {
      metadata.unverifiedLeads.push({ postId: post.postId, title: post.title, jobURL: pageURL(post.postId), reason: 'detail-unverified' }); jobs.delete(post.postId);
    }
    metadata.uniqueListedCount = posts.size;
    report.listedCount = jobs.size;
    report.status = report.errors.length || metadata.unverifiedLeads.length || !['exhausted', 'empty-page'].includes(report.stopReason) ? posts.size ? 'partial' : 'failed' : 'success';
    report.scope.description += `实际读取${report.pagesSucceeded}页/${metadata.listedEntriesRead}条列表记录、去重${posts.size}条、核实${report.detailSucceeded}/${report.detailRequested}条详情，仅返回职责要求完整且详情至少含一个已识别内地城市的${jobs.size}条候选；未核实详情${metadata.unverifiedLeads.length}条仅为线索，不入库。纯港澳台/海外或地点未确认排除${metadata.excludedNonMainland}条；混合地点保留原文。列表count仅为该次官网响应值，不据此声称同数量岗位都匹配关键词。额外批次字典请求${metadata.mappingRequests}次，本批总请求${metadata.requestCount}次，均计入整批时间。`;
    return { jobs: [...jobs.values()], report: validateCollectionReport(report), metadata };
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
