import { randomUUID } from 'node:crypto';
import type { JobInput, Profile } from '../../shared/src/contracts.js';
import type { DiscoveryOptions, DiscoveryPlan, DiscoveryReport, DiscoveryResult, DiscoverySource, DiscoverySourceReport } from '../../shared/src/discovery.js';
import { matchJob } from '../../domain/src/matching.js';
import { withConfirmedEducation } from '../../profile/src/career-input.js';
import { collectTencentJobs } from './tencent.js';
import { validateDiscoverySource } from './discovery-catalog.js';
import { collectMainlandJobs, mainlandSourceForURL } from './mainland-discovery.js';
import { collectTencentCampusJobs } from './tencent-campus-discovery.js';

const MAX_BYTES = 4 * 1024 * 1024;
type Dependencies = { fetch?: typeof fetch; signal?: AbortSignal; collectTencent?: typeof collectTencentJobs };
class DiscoveryError extends Error { constructor(readonly code: string) { super(code); } }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unique = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];
const text = (value: unknown, maximum = 100_000): string => typeof value === 'string' && value.length <= maximum ? value.trim() : '';
const cleanHTML = (value: unknown) => text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function discoveryOptions(input: DiscoveryOptions = {}): Required<DiscoveryOptions> {
  if (!object(input) || Object.keys(input).some(key => !['region', 'sourceIds', 'maxSources', 'maxPages', 'pageSize', 'detailLimit', 'includeExperienced'].includes(key))) throw new TypeError('自动找岗位参数无效。');
  const number = (key: 'maxSources' | 'maxPages' | 'pageSize' | 'detailLimit', fallback: number, maximum: number) => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${key} 超出允许的采集预算。`);
    return value;
  };
  if (input.sourceIds !== undefined && (!Array.isArray(input.sourceIds) || input.sourceIds.length > 60 || input.sourceIds.some(id => typeof id !== 'string' || !id || id.length > 100))) throw new TypeError('来源列表无效。');
  if (input.includeExperienced !== undefined && typeof input.includeExperienced !== 'boolean') throw new TypeError('请明确是否包含社招。');
  const region = input.region === undefined ? 'mainland' : input.region;
  if (region !== 'mainland' && region !== 'overseas' && region !== 'all') throw new TypeError('招聘地区无效。');
  return { region, sourceIds: unique(input.sourceIds ?? []), maxSources: number('maxSources', 8, 8), maxPages: number('maxPages', 2, 5),
    pageSize: number('pageSize', 20, 50), detailLimit: number('detailLimit', 10, 30), includeExperienced: input.includeExperienced ?? false };
}

/** Only saved preferences and the current confirmed default education influence the local search plan. */
export function buildDiscoveryPlan(profile: Profile): DiscoveryPlan {
  if (!profile || !Number.isInteger(profile.version) || profile.version < 1) throw new TypeError('请先保存确认求职资料，再自动找岗位。');
  const confirmed = withConfirmedEducation(profile);
  const roles = unique(profile.targetRoles.flatMap(role => role.split(/[/／、,，;；|]/))).filter(value => value.length <= 80).slice(0, 4);
  const skills = profile.skills.filter(value => value.trim() && value.length <= 60).slice(0, 3);
  const keywords = unique([...roles, ...skills]);
  if (keywords.some(value => /大模型|\bllm\b|large language model/i.test(value))) keywords.push('LLM', '大模型');
  if (keywords.some(value => /机器学习|machine learning/i.test(value))) keywords.push('机器学习', 'machine learning');
  if (keywords.some(value => /人工智能|\bAI\b/i.test(value))) keywords.push('人工智能', 'AI');
  if (keywords.some(value => /算法|algorithm/i.test(value))) keywords.push('算法', 'algorithm');
  if (!keywords.length && confirmed.major) keywords.push(confirmed.major);
  if (!keywords.length) throw new TypeError('请先填写至少一个求职方向或已确认技能。');
  return { profileVersion: profile.version, keywords: unique(keywords).slice(0, 10), cities: unique(profile.cities).slice(0, 10),
    educationSummary: [confirmed.degree, confirmed.major, confirmed.graduationMonth].filter(Boolean).join(' · '),
    notes: ['仅搜索已接入或你添加的公开招聘入口，不代表全网覆盖。', '学历、毕业窗口与城市在本地核对；姓名、联系方式、履历全文不会发送给招聘接口。',
      '关键词来自已保存的求职方向和技能；结构化教育仅采用当前修订已确认的默认教育。'] };
}

function matchesKeywords(value: string, keywords: string[]): boolean {
  return keywords.some(keyword => {
    if (/^[\x00-\x7f]+$/.test(keyword)) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(value);
    }
    return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
  });
}
function relevantToPlan(title: string, details: string, metadata: string, plan: DiscoveryPlan): boolean {
  if (matchesKeywords(`${title}\n${metadata}`, plan.keywords)) return true;
  // Generic company descriptions mention AI on every vacancy. Do not turn HR,
  // finance or sales vacancies into algorithm recommendations from that alone.
  const aiDirection = plan.keywords.some(keyword => /人工智能|大模型|机器学习|算法|\bAI\b|\bLLM\b|machine learning|algorithm/i.test(keyword));
  if (aiDirection && !/engineer|research|scientist|algorithm|machine learning|\bdata\b|\bAI\b|\bML\b|\bLLM\b|developer|算法|人工智能|数据|模型|研发|开发/i.test(title)) return false;
  return matchesKeywords(details, plan.keywords);
}
function recruitmentType(title: string, employment: string): JobInput['type'] {
  if (/\bintern(?:ship)?\b|实习/i.test(`${title} ${employment}`)) return 'internship';
  if (/\bnew[ -]?grad(?:uate)?s?\b|\bgraduates?\b|\bcampus\b|校招|应届|毕业生|管培/i.test(title)) return 'campus';
  if (/\bsenior\b|\bstaff (?:AI|ML|software|research|engineer)|\bprincipal\b|\blead\b|\bmanager\b|\bhead of\b|\bdirector\b|资深|高级|负责人|总监|主管|首席/i.test(title)) return 'experienced';
  return 'unknown';
}
function sourceReport(source: DiscoverySource): DiscoverySourceReport {
  return { sourceId: source.id, name: source.name, url: source.url, provider: source.provider, status: 'success', reason: '',
    pagesRequested: 0, pagesSucceeded: 0, entriesRead: 0, detailChecked: 0, detailComplete: 0, matchedCount: 0, excludedCount: 0,
    officialTotal: null, requestURLs: [], warnings: [], jobIds: [], unviewed: [] };
}

/** Every request is constructed from an audited host/board, never followed from a result URL. */
async function publicJSON(url: URL, report: DiscoverySourceReport, request: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DiscoveryError('cancelled');
  if (!['api.lever.co', 'api.eu.lever.co', 'api.ashbyhq.com'].includes(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password) throw new DiscoveryError('unsafe-url');
  const controller = new AbortController();
  let rejectCancelled: ((cause: Error) => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const abort = () => { controller.abort(); rejectCancelled?.(new DiscoveryError('cancelled')); }; signal?.addEventListener('abort', abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new DiscoveryError('timeout')); }, 20_000); });
  report.requestURLs.push(url.toString());
  try {
    return await Promise.race([deadline, cancelled, (async () => {
      const response = await request(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { accept: 'application/json' } });
      if (response.redirected || response.url && response.url !== url.toString()) throw new DiscoveryError('redirect-rejected');
      if (!response.ok) throw new DiscoveryError(`http-${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new DiscoveryError('response-too-large');
      const reader = response.body?.getReader();
      if (!reader) throw new DiscoveryError('missing-body');
      const decoder = new TextDecoder(); let result = '', bytes = 0;
      try {
        while (true) {
          if (controller.signal.aborted) throw new DiscoveryError('cancelled');
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_BYTES) throw new DiscoveryError('response-too-large');
          result += decoder.decode(part.value, { stream: true });
        }
        result += decoder.decode();
      } catch (cause) { void reader.cancel().catch(() => {}); throw cause; }
      finally { reader.releaseLock(); }
      if (controller.signal.aborted) throw new DiscoveryError('cancelled');
      try { return JSON.parse(result) as unknown; } catch { throw new DiscoveryError('invalid-json'); }
    })()]);
  } finally { if (timeout) clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

function hostedJobURL(value: unknown, source: DiscoverySource): { id: string; url: string } {
  if (typeof value !== 'string') throw new DiscoveryError('invalid-posting-url');
  let url: URL;
  try { url = new URL(value); } catch { throw new DiscoveryError('invalid-posting-url'); }
  const board = new URL(source.url);
  const pieces = url.pathname.split('/').filter(Boolean);
  if (url.origin !== board.origin || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || pieces.length !== 2 || pieces[0] !== board.pathname.slice(1) || !/^[a-z\d_-]{1,120}$/i.test(pieces[1]!)) throw new DiscoveryError('invalid-posting-url');
  return { id: pieces[1]!, url: url.toString() };
}

function atsJob(raw: unknown, source: DiscoverySource, observedAt: string): { job: JobInput; complete: boolean } {
  if (!object(raw)) throw new DiscoveryError('invalid-posting');
  const title = text(raw.title ?? raw.text, 500);
  const target = hostedJobURL(source.provider === 'lever' ? raw.hostedUrl : raw.jobUrl, source);
  if (!title || source.provider === 'lever' && raw.id !== target.id || source.provider === 'ashby' && raw.isListed !== true) throw new DiscoveryError('invalid-posting');
  const categories = object(raw.categories) ? raw.categories : {};
  const lists = Array.isArray(raw.lists) ? raw.lists.filter(object).slice(0, 30).map(item => ({ heading: text(item.text, 500), content: cleanHTML(item.content) })) : [];
  const opening = text(raw.descriptionPlain) || text(raw.descriptionPlainText) || cleanHTML(raw.descriptionHtml ?? raw.description);
  const content = [opening, ...lists.map(item => `${item.heading}\n${item.content}`), text(raw.additionalPlain) || cleanHTML(raw.additional)].filter(Boolean).join('\n\n');
  const requirements = lists.filter(item => /qualific|requirement|what.*(?:bring|look)|you.*(?:have|are)|任职|要求/i.test(item.heading)).map(item => `${item.heading}\n${item.content}`).join('\n\n');
  const hasDuties = /\byou will\b|\byou['’]ll\b|responsibilit|your role|your mission|what you.*do|职责|工作内容/i.test(content);
  const hasQualifications = requirements.length >= 20 || /qualifications?|requirements?|what you.*(?:bring|need)|what we.*look|you have|you bring|ideal candidate|about you|任职|要求/i.test(content);
  const complete = content.length >= 80 && hasDuties && hasQualifications
    && !/^(?:access denied|please log in|captcha|sign in to continue)/i.test(content) && !/(?:\.{3}|…)\s*$/.test(content);
  const city = text(raw.location ?? categories.location, 500);
  const type = recruitmentType(title, text(raw.employmentType ?? categories.commitment, 100));
  return { job: { id: `${source.id}-${target.id}`, company: source.company, title, city, type,
    description: content.slice(0, 100_000), requirements, url: target.url, sourceId: source.id, sourceName: source.name,
    observedAt, publishedAt: null, deadline: null, demo: false }, complete };
}

async function collectATS(source: DiscoverySource, plan: DiscoveryPlan, options: Required<DiscoveryOptions>, report: DiscoverySourceReport,
  request: typeof fetch, signal?: AbortSignal, result: Array<{ job: JobInput; complete: boolean }> = []): Promise<Array<{ job: JobInput; complete: boolean }>> {
  const board = new URL(source.url).pathname.slice(1);
  const seen = new Set<string>(); const pages = new Set<string>();
  const now = new Date().toISOString(); let exhausted = false;
  for (let page = 0; page < (source.provider === 'ashby' ? 1 : options.maxPages); page++) {
    const url = source.provider === 'ashby' ? new URL(`https://api.ashbyhq.com/posting-api/job-board/${board}`)
      : new URL(`https://${new URL(source.url).hostname === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${board}`);
    if (source.provider === 'lever') url.search = new URLSearchParams({ mode: 'json', skip: String(page * options.pageSize), limit: String(options.pageSize) }).toString();
    report.pagesRequested++;
    const response = await publicJSON(url, report, request, signal);
    const records = source.provider === 'ashby' && object(response) && response.apiVersion === '1' ? response.jobs : response;
    if (!Array.isArray(records) || records.length > (source.provider === 'ashby' ? 10_000 : options.pageSize)) throw new DiscoveryError('invalid-list');
    report.pagesSucceeded++;
    const visible = source.provider === 'ashby' ? records.filter(item => object(item) && item.isListed === true) : records;
    if (source.provider === 'ashby') report.officialTotal = visible.length;
    const fingerprint = visible.map(item => object(item) ? String(item.id ?? item.jobUrl ?? '') : '').sort().join('|');
    if (visible.length && pages.has(fingerprint)) { report.duplicateCount = (report.duplicateCount ?? 0) + visible.length; report.warnings.push('官网重复返回相同岗位页，停止翻页。'); break; }
    pages.add(fingerprint);
    const bound = source.provider === 'ashby' ? options.maxPages * options.pageSize : options.pageSize;
    const entries = visible.slice(0, bound).sort((left, right) => {
      const direct = (item: unknown) => object(item) && matchesKeywords(`${text(item.title ?? item.text, 500)} ${JSON.stringify(item.categories ?? {})}`, plan.keywords) ? 1 : 0;
      return direct(right) - direct(left);
    });
    for (const entry of entries) {
      if (signal?.aborted) throw new DiscoveryError('cancelled');
      report.entriesRead++;
      if (!object(entry)) { report.warnings.push('跳过结构无效的岗位记录。'); continue; }
      if (!relevantToPlan(text(entry.title ?? entry.text, 500), text(entry.descriptionPlain ?? entry.descriptionPlainText) || cleanHTML(entry.descriptionHtml ?? entry.description), JSON.stringify(entry.categories ?? {}), plan)) { report.excludedCount++; continue; }
      if (report.detailChecked >= options.detailLimit) { report.unviewed.push('达到完整正文核对预算，其余方向候选尚未核实。'); continue; }
      let raw = entry;
      if (source.provider === 'lever') {
        const target = hostedJobURL(entry.hostedUrl, source);
        if (entry.id !== target.id) throw new DiscoveryError('posting-id-mismatch');
        if (seen.has(target.id)) { report.duplicateCount = (report.duplicateCount ?? 0) + 1; continue; }
        const detailURL = new URL(url); detailURL.pathname += `/${target.id}`; detailURL.search = 'mode=json';
        report.detailChecked++;
        const detail = await publicJSON(detailURL, report, request, signal);
        if (!object(detail) || detail.id !== target.id || detail.text !== entry.text || detail.hostedUrl !== entry.hostedUrl) throw new DiscoveryError('detail-id-mismatch');
        raw = detail;
      } else report.detailChecked++;
      const parsed = atsJob(raw, source, now);
      const id = parsed.job.id!;
      if (seen.has(id)) { report.duplicateCount = (report.duplicateCount ?? 0) + 1; continue; }
      seen.add(source.provider === 'lever' ? String(raw.id) : id);
      if (parsed.complete) report.detailComplete++;
      else report.warnings.push('岗位缺少可核对的完整正文，未作为推荐结果入库。');
      result.push(parsed);
    }
    if (source.provider === 'ashby') {
      exhausted = entries.length === visible.length;
      if (!exhausted) report.unviewed.push(`接口显示 ${visible.length} 条公开岗位，本次只查看前 ${entries.length} 条。`);
      break;
    }
    if (records.length < options.pageSize) { exhausted = true; report.officialTotal = page * options.pageSize + records.length; break; }
  }
  if (!exhausted) report.unviewed.push('未证明已覆盖招聘列表末尾。');
  report.warnings.push('发布日期未猜填；ATS 最近发布/重发时间不当作首次发布日期。');
  report.unviewed = unique(report.unviewed); report.warnings = unique(report.warnings);
  // The date explanation is not an error; all other warnings mean incomplete verification.
  report.status = exhausted && !report.unviewed.length && report.warnings.length === 1 ? 'success' : 'partial';
  report.reason = report.status === 'success' ? '已读完本次公开列表范围，完整正文核对仍限于关键词候选。' : '已保留完成部分，未查看范围见下方说明。';
  return result;
}

export async function discoverJobs(profile: Profile, sources: DiscoverySource[], input: DiscoveryOptions = {}, dependencies: Dependencies = {}): Promise<DiscoveryResult> {
  const options = discoveryOptions(input); const plan = buildDiscoveryPlan(profile);
  if (!Array.isArray(sources) || sources.length > 60) throw new TypeError('招聘入口数量超出上限。');
  const checkedSources = sources.map(validateDiscoverySource);
  if (new Set(checkedSources.map(source => source.id)).size !== checkedSources.length) throw new TypeError('招聘入口不能重复。');
  if (options.sourceIds.some(id => !checkedSources.some(source => source.id === id))) throw new TypeError('本次选择了未登记的招聘入口。');
  const report: DiscoveryReport = { id: randomUUID(), startedAt: new Date().toISOString(), finishedAt: '', status: 'success', plan, options,
    sources: [], unviewedSources: [], uniqueJobs: 0, completeDetails: 0, duplicateCount: 0,
    scopeNote: '默认查国内已接入官网：腾讯校招使用公开关键词查询；飞书企业站使用公开岗位与官方推荐链接图，在本地按资料筛选，尚非官网全列表关键词搜索。海外来源需主动选择。仅已接入公开范围，不依赖用户招聘表，不代表全网；未登录或提交申请。' };
  report.scopeNote = `本轮地区：${options.region === 'mainland' ? '国内' : options.region === 'overseas' ? '明确选择的海外来源' : '主动选择的国内和海外来源'}。${report.scopeNote}`;
  const jobs: JobInput[] = [], matches: DiscoveryResult['matches'] = [], collections: DiscoveryResult['collections'] = []; const seen = new Set<string>(); let tried = 0;
  for (const source of checkedSources) {
    const domestic = ['feishu', 'tencent-campus', 'tencent'].includes(source.provider);
    const reason = dependencies.signal?.aborted ? '采集已取消，未继续访问。' : !source.enabled ? '来源未启用。'
      : options.sourceIds.length && !options.sourceIds.includes(source.id) ? '本轮未选择此入口。'
      : source.provider === 'candidate' ? '仅登记候选入口；尚无对应采集适配器，可在浏览器继续核实。'
      : options.region === 'mainland' && !domestic ? '本轮默认仅国内，海外来源需明确选择海外范围。'
      : options.region === 'overseas' && domestic ? '本轮明确选择海外来源，未查询国内入口。'
      : source.provider === 'tencent' && !options.includeExperienced ? '腾讯此接口仅为社招；本轮未包含社招，不能替代腾讯校招。'
      : tried >= options.maxSources ? '达到本轮来源数量预算。' : '';
    if (reason) {
      report.unviewedSources.push({ sourceId: source.id, name: source.name, reason });
      report.sources.push({ ...sourceReport(source), status: 'skipped', reason }); continue;
    }
    tried++;
    const current = sourceReport(source); report.sources.push(current);
    let collected: Array<{ job: JobInput; complete: boolean }> = [];
    try {
      if (source.provider === 'feishu' || source.provider === 'tencent-campus') {
        const keyword = plan.keywords.some(value => /大模型|\bLLM\b/i.test(value)) ? '大模型'
          : plan.keywords.some(value => /算法|algorithm/i.test(value)) ? '算法'
          : plan.keywords.some(value => /人工智能|\bAI\b/i.test(value)) ? 'AI' : plan.keywords[0]!;
        const config = mainlandSourceForURL(source.url);
        const value = source.provider === 'feishu'
          ? await collectMainlandJobs({ ...config!, id: source.id, name: source.name }, { ...options, keyword, totalTimeoutMs: 10_000, signal: dependencies.signal }, dependencies.fetch ?? fetch)
          : await collectTencentCampusJobs({ maxPages: options.maxPages, pageSize: options.pageSize, detailLimit: options.detailLimit, keyword, totalTimeoutMs: 10_000, signal: dependencies.signal }, dependencies.fetch ?? fetch);
        current.pagesRequested = value.report.pagesRequested; current.pagesSucceeded = value.report.pagesSucceeded;
        current.entriesRead = value.report.listedCount; current.detailChecked = value.report.detailRequested; current.detailComplete = value.report.detailSucceeded;
        current.officialTotal = value.report.officialTotal; current.status = value.report.status;
        current.reason = value.report.scope.description;
        current.duplicateCount = value.metadata.duplicateCount;
        current.requestURLs.push(...value.metadata.requestURLs);
        const metadata = value.metadata as unknown as Record<string, unknown>;
        const count = (key: string, fallback = 0) => typeof metadata[key] === 'number' ? metadata[key] as number : fallback;
        current.entriesRead = source.provider === 'feishu' ? count('detailResponses') : count('listedEntriesRead', current.entriesRead);
        current.audit = { kind: source.provider === 'feishu' ? 'public-recommendation-graph' : 'public-keyword-search',
          requests: count('requestCount', count('requests')), detailResponses: count('detailResponses', current.detailComplete),
          excludedNonMainland: count('excludedNonMainland'), excludedRecruitment: count('excludedRecruitment'), incompleteDetails: count('incompleteDetails'),
          notes: Array.isArray(metadata.classificationNotes) ? metadata.classificationNotes.filter((item): item is string => typeof item === 'string') : [] };
        current.warnings.push(...value.report.errors.map(item => `${item.code}：${item.message}`));
        if (value.report.status !== 'success') current.unviewed.push(value.report.scope.description);
        for (const job of value.jobs) collected.push({ job, complete: value.report.detailResults?.some(item => item.jobURL === job.url && item.status === 'success') === true });
      } else if (source.provider === 'tencent') {
        let remainingDetails = options.detailLimit;
        for (const keyword of plan.keywords.slice(0, options.maxPages)) {
          if (dependencies.signal?.aborted) throw new DiscoveryError('cancelled');
          const value = await (dependencies.collectTencent ?? collectTencentJobs)({ keyword, maxPages: 1, pageSize: options.pageSize, detailLimit: remainingDetails, signal: dependencies.signal }, dependencies.fetch ?? fetch);
          current.pagesRequested += value.report.pagesRequested; current.pagesSucceeded += value.report.pagesSucceeded; current.entriesRead += value.report.listedCount;
          current.detailChecked += value.report.detailRequested; current.detailComplete += value.report.detailSucceeded;
          remainingDetails -= value.report.detailRequested;
          current.requestURLs.push(`https://careers.tencent.com/tencentcareer/api/post/Query?${new URLSearchParams({ keyword, pageIndex: '1', pageSize: String(options.pageSize) })}`);
          for (const job of value.jobs) collected.push({ job, complete: value.report.detailResults?.some(item => item.jobURL === job.url && item.status === 'success') === true });
          if (value.report.status !== 'success') current.unviewed.push(`关键词“${keyword}”：${value.report.stopReason}，未证明完整覆盖。`);
          current.warnings.push(...value.report.errors.map(item => `${item.stage}:${item.code}`));
        }
        current.status = current.unviewed.length || current.warnings.length ? 'partial' : 'success'; current.reason = '仅腾讯官方经验岗位，已与校招分开标识。';
      } else await collectATS(source, plan, options, current, dependencies.fetch ?? fetch, dependencies.signal, collected);
    } catch (cause) {
      current.status = current.pagesSucceeded ? 'partial' : 'failed';
      current.reason = dependencies.signal?.aborted ? '采集已取消，保留此前核对结果。' : `公开来源未完成（${cause instanceof DiscoveryError ? cause.code : 'request-failed'}），没有切换到登录或私人接口。`;
      current.unviewed.push('失败或取消之后的列表和正文尚未查看。');
    }
    for (const candidate of collected) {
      if (!candidate.complete || !relevantToPlan(candidate.job.title, `${candidate.job.description}\n${candidate.job.requirements}`, '', plan)) { current.excludedCount++; continue; }
      const match = matchJob(profile, candidate.job);
      const eligibility = candidate.job.type === 'experienced' && options.includeExperienced ? matchJob(profile, { ...candidate.job, type: 'unknown' }) : match;
      if (candidate.job.type === 'experienced' && !options.includeExperienced || eligibility.eligible === 'unsuitable') { current.excludedCount++; continue; }
      const key = candidate.job.id ?? candidate.job.url;
      if (seen.has(key)) { report.duplicateCount++; continue; }
      seen.add(key); jobs.push(candidate.job); matches.push({ jobId: candidate.job.id!, url: candidate.job.url, match, detailComplete: true });
      current.matchedCount++; current.jobIds.push(candidate.job.id!);
    }
    report.duplicateCount += current.duplicateCount ?? 0;
    const sourceJobs = jobs.filter(job => job.sourceId === source.id);
    const partial = current.status !== 'success';
    const collectionStatus = current.status === 'failed' ? 'failed' : partial ? 'partial' : 'success';
    collections.push({ source: { id: source.id, name: source.name, company: source.company, url: source.url, type: source.provider === 'tencent' ? 'experienced' : 'unknown',
      mode: 'public-api', description: '企业公开岗位正文采集；仅保留本轮核对完整且未命中已知不符合条件的方向候选。' },
      result: { jobs: sourceJobs, report: { schemaVersion: 1, status: collectionStatus,
        query: { keyword: plan.keywords.join(' / ').slice(0, 200), pageSize: source.provider === 'ashby' ? null : options.pageSize, maxPages: options.maxPages, detailLimit: options.detailLimit },
        scope: { mode: 'official-api-pages', listURL: source.url, description: `公开 API 正文来自 ${current.requestURLs.join('；')}。实际查看 ${current.entriesRead} 条、核对正文 ${current.detailChecked} 条；本报告listedCount仅记筛选后保留 ${sourceJobs.length} 条。未查看：${current.unviewed.join('；') || '本次入口预算内无额外未查看范围'}。`.slice(0, 5000) },
        pagesRequested: current.pagesRequested, pagesSucceeded: current.pagesSucceeded, officialTotal: current.officialTotal,
        listedCount: sourceJobs.length, detailRequested: sourceJobs.length, detailSucceeded: sourceJobs.length, detailFailed: 0,
        detailResults: sourceJobs.map(job => ({ jobURL: job.url, status: 'success' as const })),
        stopReason: partial ? dependencies.signal?.aborted ? 'aborted' : current.status === 'failed' ? 'request-failed' : 'page-limit' : 'exhausted',
        errors: partial ? [{ stage: 'list', code: 'DISCOVERY_INCOMPLETE', message: `${current.reason} ${current.unviewed.join('；')}`.slice(0, 1200) }] : [],
      } } });
  }
  report.uniqueJobs = jobs.length; report.completeDetails = matches.filter(item => item.detailComplete).length;
  report.finishedAt = new Date().toISOString();
  const attempted = report.sources.filter(source => source.status !== 'skipped');
  report.status = dependencies.signal?.aborted ? 'cancelled' : !attempted.length || attempted.every(source => source.status === 'failed') ? 'failed'
    : attempted.some(source => source.status !== 'success') ? 'partial' : 'success';
  return { jobs, matches, report, collections };
}
