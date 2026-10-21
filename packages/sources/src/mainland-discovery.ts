import type { JobInput, RecruitmentType, SourceCollectionOptions, SourceCollectionResult } from '../../shared/src/contracts.js';

export interface MainlandFeishuSource {
  id: string; name: string; company: string; url: string; hostname: string; websitePath: string;
  seedJobIds: string[]; seedEvidenceURLs: string[];
}
/** Public employer-linked boards and public job IDs, never private application IDs. */
export const MAINLAND_FEISHU_SOURCES: readonly MainlandFeishuSource[] = [
  { id: 'feishu-minimax-campus', name: 'MiniMax · 国内校招与实习', company: 'MiniMax',
    url: 'https://vrfi1sk8a0.jobs.feishu.cn/379481/position', hostname: 'vrfi1sk8a0.jobs.feishu.cn', websitePath: '379481',
    seedJobIds: ['7573257185578617142', '7654500111376156964', '7633405814624373030'],
    seedEvidenceURLs: ['https://minimax.cn/careers',
      'https://vrfi1sk8a0.jobs.feishu.cn/379481/m/position/7573257185578617142/detail',
      'https://vrfi1sk8a0.jobs.feishu.cn/379481/m/position/7654500111376156964/detail',
      'https://vrfi1sk8a0.jobs.feishu.cn/379481/m/position/7633405814624373030/detail'] },
  { id: 'feishu-modelbest-campus', name: '面壁智能 · 国内校招与实习', company: '面壁智能',
    url: 'https://modelbest.jobs.feishu.cn/campus/position', hostname: 'modelbest.jobs.feishu.cn', websitePath: 'campus',
    seedJobIds: ['7550158206165944639'],
    seedEvidenceURLs: ['https://www.modelbest.cn/', 'https://modelbest.jobs.feishu.cn/campus/m/position/7550158206165944639/detail'] },
  {"id": "feishu-spiritaicampus", "name": "千寻智能 · 国内公开招聘", "company": "千寻智能", "url": "https://nwd4iy9rd2s.jobs.feishu.cn/campusofSpiritAI/position", "hostname": "nwd4iy9rd2s.jobs.feishu.cn", "websitePath": "campusofSpiritAI", "seedJobIds": ["7672031985867295002", "7672033022140959003"], "seedEvidenceURLs": ["https://nwd4iy9rd2s.jobs.feishu.cn/campusofSpiritAI/position/7672031985867295002/detail", "https://nwd4iy9rd2s.jobs.feishu.cn/campusofSpiritAI/position/7672033022140959003/detail"]},
  {"id": "feishu-tarsrobot", "name": "它石智航 · 国内公开招聘", "company": "它石智航", "url": "https://tarsrobot.jobs.feishu.cn/021343/position", "hostname": "tarsrobot.jobs.feishu.cn", "websitePath": "021343", "seedJobIds": ["7564312014039435539", "7667918400576981291", "7667918558487415090", "7667923370213820681", "7667936622214220068", "7667936622214924580", "7668204630397061426", "7668218467347073334", "7668218880107759914", "7668220094622861614", "7668221926657771819", "7668221926658345259", "7668224499520096531", "7668524839929628966", "7668533063265290539", "7668566314080176410", "7680203959492151595", "7694148132846340398", "7694231276648696118"], "seedEvidenceURLs": ["https://tarsrobot.jobs.feishu.cn/021343/position/7564312014039435539/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7667918400576981291/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7667918558487415090/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7667923370213820681/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7667936622214220068/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7667936622214924580/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668204630397061426/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668218467347073334/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668218880107759914/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668220094622861614/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668221926657771819/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668221926658345259/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668224499520096531/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668524839929628966/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668533063265290539/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7668566314080176410/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7680203959492151595/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7694148132846340398/detail", "https://tarsrobot.jobs.feishu.cn/021343/position/7694231276648696118/detail"]},
  {"id": "feishu-x2robot", "name": "自变量机器人 · 国内公开招聘", "company": "自变量机器人", "url": "https://x2-robot.jobs.feishu.cn/912130/position", "hostname": "x2-robot.jobs.feishu.cn", "websitePath": "912130", "seedJobIds": ["7652253703286720814", "7677437713956505902", "7678599261966403849", "7683352576704678170", "7683862185903114550", "7685689775568013577", "7690412372905543977"], "seedEvidenceURLs": ["https://x2-robot.jobs.feishu.cn/912130/position/7652253703286720814/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7677437713956505902/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7678599261966403849/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7683352576704678170/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7683862185903114550/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7685689775568013577/detail", "https://x2-robot.jobs.feishu.cn/912130/position/7690412372905543977/detail"]},
  {"id": "feishu-desaysv", "name": "德赛西威 · 国内公开招聘", "company": "德赛西威", "url": "https://yesv-desaysv.jobs.feishu.cn/campus/position", "hostname": "yesv-desaysv.jobs.feishu.cn", "websitePath": "campus", "seedJobIds": ["7675617604505667876", "7687566688954812735", "7690396195420981558", "7694569541754046762", "7695647870176069907", "7696081044805830938", "7696081980006254875"], "seedEvidenceURLs": ["https://yesv-desaysv.jobs.feishu.cn/campus/position/7675617604505667876/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7687566688954812735/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7690396195420981558/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7694569541754046762/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7695647870176069907/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7696081044805830938/detail", "https://yesv-desaysv.jobs.feishu.cn/campus/position/7696081980006254875/detail"]},
  {"id": "feishu-innolight", "name": "中际旭创 · 国内公开招聘", "company": "中际旭创", "url": "https://zj-innolight.jobs.feishu.cn/300308/position", "hostname": "zj-innolight.jobs.feishu.cn", "websitePath": "300308", "seedJobIds": ["7674618509422528810", "7675596861859809563", "7683824810938272054", "7685198320130312454", "7685221029862541622", "7687519816043448617"], "seedEvidenceURLs": ["https://zj-innolight.jobs.feishu.cn/300308/position/7674618509422528810/detail", "https://zj-innolight.jobs.feishu.cn/300308/position/7675596861859809563/detail", "https://zj-innolight.jobs.feishu.cn/300308/position/7683824810938272054/detail", "https://zj-innolight.jobs.feishu.cn/300308/position/7685198320130312454/detail", "https://zj-innolight.jobs.feishu.cn/300308/position/7685221029862541622/detail", "https://zj-innolight.jobs.feishu.cn/300308/position/7687519816043448617/detail"]},
];
export interface MainlandDiscoveryOptions extends SourceCollectionOptions {
  /** maxPages is the recommendation graph depth: 1=public seeds, 2=their recommendations. */
  /** A local reporting label only; no profile keyword is sent over GET. */
  keyword?: string; signal?: AbortSignal; totalTimeoutMs?: number;
}
export interface MainlandDiscoveryMetadata {
  requests: number; requestURLs: string[]; detailAttempts: number; detailResponses: number;
  excludedNonMainland: number; excludedRecruitment: number; incompleteDetails: number; duplicateCount: number;
  recommendationCandidates: number; unvisitedJobIds: string[]; classificationNotes: string[];
  locationEvidence: Array<{ jobId: string; mainlandCities: string[]; otherCities: string[]; unknownCities: string[] }>;
  seedEvidenceURLs: string[]; scopeKind: 'public-recommendation-graph';
  graphDepthLimit: number; requestBudget: number;
}
export type MainlandDiscoveryResult = SourceCollectionResult & { metadata: MainlandDiscoveryMetadata };
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^\d{15,22}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const cityNames = new Set(('北京 上海 天津 重庆 深圳 广州 杭州 南京 苏州 无锡 常州 宁波 温州 嘉兴 绍兴 金华 台州 湖州 丽水 舟山 衢州 成都 西安 武汉 长沙 郑州 合肥 济南 青岛 烟台 威海 潍坊 厦门 福州 泉州 漳州 南昌 南宁 昆明 贵阳 兰州 银川 西宁 乌鲁木齐 拉萨 海口 三亚 石家庄 太原 呼和浩特 沈阳 大连 长春 哈尔滨 佛山 东莞 珠海 惠州 中山 江门 汕头 湛江 肇庆 清远 韶关 揭阳 梅州 汕尾 潮州 云浮 河源 阳江 茂名 保定 唐山 秦皇岛 邯郸 廊坊 洛阳 开封 新乡 安阳 南阳 宜昌 襄阳 荆州 衡阳 岳阳 株洲 湘潭 常德 泰州 扬州 南通 镇江 徐州 盐城 宿迁 淮安 连云港 芜湖 蚌埠 滁州 安庆 六安 阜阳 绵阳 德阳 乐山 泸州 宜宾 南充 眉山 资阳 自贡 攀枝花 大同 晋中 运城 临汾 晋城 长治 阳泉 忻州 宝鸡 咸阳 渭南 汉中 延安 榆林 遵义 大理 丽江 柳州 桂林 北海 龙岩 莆田 宁德 上饶 赣州 九江 景德镇 淄博 济宁 泰安 东营 日照 临沂 德州 聊城 滨州 菏泽 枣庄 萍乡 许昌 焦作 信阳 周口 商丘 鄂州 荆门 黄石 黄冈 孝感 咸宁 随州 十堰 娄底 邵阳 永州 怀化 益阳 张家界 牡丹江 齐齐哈尔 大庆 佳木斯 鞍山 抚顺 本溪 丹东 锦州 营口 辽阳 盘锦 葫芦岛 铁岭 朝阳 辽源 吉林 四平 通化 白山 松原 白城 延边').split(' '));
const foreignOrSAR = /香港|澳门|澳門|台湾|臺灣|台北|臺北|台中|臺中|高雄|Hong\s*Kong|Macau|Macao|Taiwan|Taipei|旧金山|三藩市|纽约|伦敦|柏林|新加坡|东京|日本|美国|英国|德国|加拿大|澳大利亚|海外|境外|San Francisco|London|Singapore|Tokyo|New York|Berlin|Toronto|Paris|Seoul|首尔|巴黎/i;
class CollectionFailure extends Error { constructor(readonly code: string) { super(code); } }
function string(value: unknown, max = 100_000): string { return typeof value === 'string' && value.length <= max ? value.trim() : ''; }
function name(value: unknown): string {
  if (typeof value === 'string') return string(value, 500);
  if (!object(value)) return '';
  return name(value.name) || string(value.zh_cn ?? value.i18n_name ?? value.i18n ?? value.en_name ?? value.en_us, 500);
}
function plain(value: unknown): string { return string(value).replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }
function timestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 946684800000 || value > 4102444800000) return null;
  return new Date(value).toISOString();
}
function type(row: Row): RecruitmentType {
  const source = object(row.recruit_type) ? row.recruit_type : object(row.job_post_info) && object(row.job_post_info.recruitment_type) ? row.job_post_info.recruitment_type : undefined;
  if (!source) return 'unknown';
  const leaf = name(source), parent = object(source.parent) ? name(source.parent) : '';
  if (/实习|\bintern(?:ship)?\b/i.test(leaf)) return 'internship';
  if (/社招|社会招聘|experienced/i.test(`${parent} ${leaf}`)) return 'experienced';
  if (/校招|校园|应届|\bcampus\b/i.test(`${parent} ${leaf}`)) return 'campus';
  return 'unknown';
}
export function mainlandCityEvidence(row: unknown): { mainlandCities: string[]; otherCities: string[]; unknownCities: string[] } {
  const result = { mainlandCities: [] as string[], otherCities: [] as string[], unknownCities: [] as string[] };
  if (!object(row)) return result;
  const entries = Array.isArray(row.city_list) && row.city_list.length ? row.city_list : object(row.city_info) ? [row.city_info] : [];
  for (const entry of entries.slice(0, 100)) {
    const label = name(entry); if (!label) continue;
    const bucket = foreignOrSAR.test(label) ? result.otherCities : cityNames.has(label.replace(/市$/, '')) ? result.mainlandCities : result.unknownCities;
    if (!bucket.includes(label)) bucket.push(label);
  }
  return result;
}

export function mainlandSourceForURL(value: string): MainlandFeishuSource | undefined {
  let url: URL; try { url = new URL(value); } catch { return; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return;
  const source = MAINLAND_FEISHU_SOURCES.find(item => item.hostname === url.hostname
    && [`/${item.websitePath}`, `/${item.websitePath}/`, `/${item.websitePath}/position`].includes(url.pathname));
  return source ? structuredClone(source) : undefined;
}
function checkedSource(value: MainlandFeishuSource): MainlandFeishuSource {
  const known = mainlandSourceForURL(value?.url);
  if (!known || value.hostname !== known.hostname || value.websitePath !== known.websitePath
    || JSON.stringify(value.seedJobIds) !== JSON.stringify(known.seedJobIds) || JSON.stringify(value.seedEvidenceURLs) !== JSON.stringify(known.seedEvidenceURLs)
    || !/^[a-z\d][a-z\d._:-]{0,129}$/i.test(value.id) || !string(value.name, 180) || value.company !== known.company) throw new TypeError('仅支持已审阅的国内官方校招入口和有公开来源的岗位种子。');
  return structuredClone(value);
}

/** Anonymous official GET graph only. Public search POST returned 405 and is not retried or bypassed. */
export async function collectMainlandJobs(sourceInput: MainlandFeishuSource, options: MainlandDiscoveryOptions = {}, request: typeof fetch = fetch): Promise<MainlandDiscoveryResult> {
  const source = checkedSource(sourceInput);
  const integer = (value: number | undefined, fallback: number, max: number, minimum = 1) => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < minimum || result > max) throw new TypeError('国内岗位采集预算无效。'); return result;
  };
  const maxPages = integer(options.maxPages, 3, 10), pageSize = integer(options.pageSize, 10, 50), detailLimit = integer(options.detailLimit, 10, 50, 0);
  const timeout = integer(options.totalTimeoutMs, 10_000, 10_000);
  if (options.keyword !== undefined && (typeof options.keyword !== 'string' || options.keyword.length > 200)) throw new TypeError('搜索说明超出长度限制。');
  const metadata: MainlandDiscoveryMetadata = { requests: 0, requestURLs: [], detailAttempts: 0, detailResponses: 0, excludedNonMainland: 0,
    excludedRecruitment: 0, incompleteDetails: 0, duplicateCount: 0, recommendationCandidates: 0, unvisitedJobIds: [], classificationNotes: [],
    locationEvidence: [], seedEvidenceURLs: [...source.seedEvidenceURLs], scopeKind: 'public-recommendation-graph', graphDepthLimit: maxPages, requestBudget: Math.min(detailLimit, 10) };
  const report: MainlandDiscoveryResult['report'] = { schemaVersion: 1, status: 'partial', query: { keyword: options.keyword ?? '', maxPages, pageSize, detailLimit },
    scope: { mode: 'official-api-pages', listURL: source.url, description: '' }, pagesRequested: 0, pagesSucceeded: 0, officialTotal: null,
    listedCount: 0, detailRequested: 0, detailSucceeded: 0, detailFailed: 0, detailResults: [], stopReason: 'pagination-unavailable', errors: [] };
  const jobs: JobInput[] = [];
  const controller = new AbortController(); let timedOut = false; let rejectStop: ((cause: CollectionFailure) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const abort = () => { controller.abort(); rejectStop?.(new CollectionFailure('ABORTED')); };
  const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStop?.(new CollectionFailure('TOTAL_TIMEOUT')); }, timeout);
  options.signal?.addEventListener('abort', abort, { once: true });
  const active = () => { if (options.signal?.aborted || controller.signal.aborted) throw new CollectionFailure(timedOut ? 'TOTAL_TIMEOUT' : 'ABORTED'); };
  const visited = new Set<string>(), queued = new Set(source.seedJobIds);
  const requestedLayers = new Set<number>(), successfulLayers = new Set<number>(), beyondDepth = new Set<string>();
  let queue: Array<{ id: string; expectedTitle?: string; depth: number }> = source.seedJobIds.map(id => ({ id, depth: 1 }));
  try {
    active();
    while (queue.length && metadata.requests < metadata.requestBudget) {
      active(); const node = queue.shift()!; if (visited.has(node.id)) { metadata.duplicateCount++; continue; }
      visited.add(node.id);
      const url = new URL(`https://${source.hostname}/api/v1/job/posts/${node.id}`);
      url.search = 'portal_type=6&with_recommend=true';
      metadata.requests++; metadata.detailAttempts++; requestedLayers.add(node.depth); report.pagesRequested = requestedLayers.size; metadata.requestURLs.push(url.toString());
      const raw = await Promise.race([stopped, (async () => {
        const response = await request(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { accept: 'application/json', 'accept-language': 'zh-CN', 'website-path': source.websitePath, 'portal-channel': 'saas-career', 'portal-platform': 'pc' } });
        active();
        if (response.redirected || response.url && response.url !== url.toString()) throw new CollectionFailure('REDIRECT_REJECTED');
        if (!response.ok) throw new CollectionFailure(`HTTP_${response.status}`);
        if (!response.headers.get('content-type')?.includes('json') || Number(response.headers.get('content-length')) > MAX_BYTES) throw new CollectionFailure('INVALID_RESPONSE');
        const reader = response.body?.getReader(); if (!reader) throw new CollectionFailure('INVALID_RESPONSE');
        let bytes = 0, body = ''; const decoder = new TextDecoder();
        try {
          while (true) { active(); const piece = await reader.read(); if (piece.done) break; bytes += piece.value.byteLength;
            if (bytes > MAX_BYTES) throw new CollectionFailure('RESPONSE_TOO_LARGE'); body += decoder.decode(piece.value, { stream: true }); }
          body += decoder.decode(); active();
        } catch (cause) { void reader.cancel().catch(() => {}); throw cause; }
        finally { reader.releaseLock(); }
        try { return JSON.parse(body) as unknown; } catch { throw new CollectionFailure('INVALID_JSON'); }
      })()]);
      active();
      if (!object(raw) || raw.code !== 0 || !object(raw.data) || !object(raw.data.job_post_detail)) throw new CollectionFailure('INVALID_PAYLOAD');
      const detail = raw.data.job_post_detail;
      if (typeof detail.id !== 'string' || detail.id !== node.id || !idPattern.test(detail.id) || !string(detail.title, 500)
        || node.expectedTitle !== undefined && string(detail.title, 500) !== node.expectedTitle) throw new CollectionFailure('DETAIL_ID_MISMATCH');
      successfulLayers.add(node.depth); report.pagesSucceeded = successfulLayers.size; metadata.detailResponses++;
      const recommendations = raw.data.recommend_job_post_List;
      if (recommendations !== undefined && (!Array.isArray(recommendations) || recommendations.length > 200)) throw new CollectionFailure('INVALID_RECOMMENDATIONS');
      const next: Array<{ id: string; expectedTitle?: string; depth: number }> = [];
      for (const item of (recommendations as unknown[] | undefined ?? []).slice(0, pageSize)) {
        metadata.recommendationCandidates++;
        if (!object(item) || typeof item.id !== 'string' || !idPattern.test(item.id) || !string(item.title, 500)) {
          metadata.classificationNotes.push('推荐列表含无法核对的岗位标识或标题，未访问该记录。'); continue;
        }
        if (queued.has(item.id) || visited.has(item.id)) { metadata.duplicateCount++; continue; }
        if (node.depth >= maxPages) { beyondDepth.add(item.id); continue; }
        queued.add(item.id); next.push({ id: item.id, expectedTitle: string(item.title, 500), depth: node.depth + 1 });
      }
      // New IDs are only learned from the already read official recommendation response.
      queue = [...next, ...queue].slice(0, maxPages * pageSize + source.seedJobIds.length);
      const locale = mainlandCityEvidence(detail);
      metadata.locationEvidence.push({ jobId: detail.id, ...locale });
      if (!locale.mainlandCities.length) { metadata.excludedNonMainland++; metadata.classificationNotes.push('仅境外或地点无法确认的岗位未作为内地候选返回。'); continue; }
      const recruitment = type(detail);
      if (recruitment === 'experienced') { metadata.excludedRecruitment++; continue; }
      if (detail.channel_online_status !== 1) { metadata.excludedRecruitment++; metadata.classificationNotes.push('未能证实仍在公开招聘渠道上线，未作为开放岗位返回。'); continue; }
      if (recruitment === 'unknown') metadata.classificationNotes.push('有岗位未明确雇佣类别，保持 unknown，不认定为校园招聘。');
      const description = plain(detail.description), requirement = plain(detail.requirement);
      const complete = description.length >= 20 && requirement.length >= 20 && !/(?:\.{3}|…)\s*$/.test(`${description}\n${requirement}`);
      const subject = object(detail.job_subject) ? name(detail.job_subject) : '';
      const city = [...locale.mainlandCities, ...locale.otherCities, ...locale.unknownCities].join('、');
      const jobURL = `https://${source.hostname}/${source.websitePath}/position/${detail.id}/detail`;
      jobs.push({ id: `${source.id}-${detail.id}`, company: source.company, title: string(detail.title, 500), city, type: recruitment,
        description, requirements: `${requirement}${subject ? `\n\n官网招聘项目：${subject}` : ''}`,
        url: jobURL, sourceId: source.id, sourceName: source.name, observedAt: new Date().toISOString(),
        publishedAt: timestamp(detail.publish_time), deadline: object(detail.job_post_info) ? timestamp(detail.job_post_info.expiry_time) : null, demo: false });
      report.detailRequested++;
      if (complete) report.detailSucceeded++; else { report.detailFailed++; metadata.incompleteDetails++; }
      report.detailResults!.push({ jobURL, status: complete ? 'success' : 'failed' });
      if (locale.otherCities.length || locale.unknownCities.length) metadata.classificationNotes.push('部分岗位同时列出内地与境外/未知地点；原地点文字保留，不能把境外地点当作内地。');
    }
    if (queue.length) report.stopReason = metadata.requests >= metadata.requestBudget ? 'page-limit' : 'pagination-unavailable';
  } catch (cause) {
    const code = cause instanceof CollectionFailure ? cause.code : 'REQUEST_FAILED';
    report.stopReason = code === 'ABORTED' || code === 'TOTAL_TIMEOUT' ? 'aborted' : code.startsWith('HTTP_') || code === 'REQUEST_FAILED' ? 'request-failed' : 'invalid-response';
    report.errors.push({ stage: 'detail', code, message: code === 'ABORTED' ? '采集已取消，保留此前已核对岗位。' : code === 'TOTAL_TIMEOUT' ? '本来源已到总时间上限，保留已核对前缀。' : '公开岗位读取未完成；没有改用登录、cookie、签名或其他写入接口。' });
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  metadata.unvisitedJobIds = [...new Set([...queue.map(node => node.id), ...beyondDepth])].filter(id => !visited.has(id));
  metadata.classificationNotes = [...new Set(metadata.classificationNotes)];
  report.listedCount = jobs.length;
  report.status = !jobs.length && report.errors.length ? 'failed' : 'partial';
  report.scope.description = `公开岗位与官方推荐链接范围；不代表关键词全列表或全官网。maxPages=${maxPages}表示推荐图层（1为公开种子，2包含一层推荐），pagesRequested/pagesSucceeded计至少尝试/成功一个节点的图层，不是官网列表分页，也不证明该层全读完。仅从公开种子及已读取官方推荐ID获取详情；未运行已拒绝的列表POST。HTTP请求 ${metadata.requests}/${metadata.requestBudget} 次，完成详情响应 ${metadata.detailResponses} 次，保留候选 ${jobs.length} 条，剩余已知图节点 ${metadata.unvisitedJobIds.length} 个。detailRequested/detailResults仅计保留候选的正文核对；排除地点/类型与全部请求详见metadata。未检查其他校园项目、全部岗位列表、登录后资格或实际申请；届别以各岗位正文及招聘项目原文为准。`;
  return { jobs, report, metadata };
}
