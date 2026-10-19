import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { DiscoverySource, DiscoverySourceInput } from '../../shared/src/discovery.js';
import { MAINLAND_FEISHU_SOURCES, mainlandSourceForURL } from './mainland-discovery.js';

const ATS_HOSTS = new Map([
  ['jobs.lever.co', 'lever'], ['jobs.eu.lever.co', 'lever'], ['jobs.ashbyhq.com', 'ashby'],
] as const);
const TENCENT: DiscoverySource = { id: 'tencent-experienced', provider: 'tencent', name: '腾讯 · 经验岗位（需主动包含社招）', company: '腾讯', url: 'https://careers.tencent.com/', enabled: true };
const TENCENT_CAMPUS: DiscoverySource = { id: 'tencent-campus', provider: 'tencent-campus', name: '腾讯 · 国内校招与实习', company: '腾讯', url: 'https://join.qq.com/', enabled: true };

/** Unknown public entries remain inert candidates. They are never fetched. */
export function registerDiscoverySource(input: DiscoverySourceInput): DiscoverySource {
  if (!input || typeof input.company !== 'string' || !input.company.trim() || input.company.length > 120
    || typeof input.url !== 'string' || input.url.length > 2048 || input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 180)) {
    throw new TypeError('请填写企业名称和公开 HTTPS 招聘入口。');
  }
  let url: URL;
  try { url = new URL(input.url); } catch { throw new TypeError('招聘入口不是有效网址。'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || isIP(host.replace(/^\[|\]$/g, ''))
    || !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i.test(host)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host)
    || host.endsWith('.arpa') || url.search || url.hash) throw new TypeError('仅接收无凭据、无查询参数的公开 HTTPS 招聘入口，不访问本机或私网。');
  const provider = ATS_HOSTS.get(host as 'jobs.lever.co') ?? 'candidate';
  if (provider !== 'candidate') {
    const pieces = url.pathname.split('/').filter(Boolean);
    if (!pieces.length || pieces.length > 3 || !/^[A-Za-z\d](?:[A-Za-z\d_.-]{0,98}[A-Za-z\d])?$/.test(pieces[0]!)
      || pieces.slice(1).some(part => !/^[A-Za-z\d_-]{1,120}$/.test(part))) throw new TypeError('招聘入口缺少可识别的企业 board 名称。');
    url.pathname = `/${pieces[0]}`;
  }
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  const canonical = url.toString();
  if (canonical === TENCENT_CAMPUS.url) return { ...TENCENT_CAMPUS };
  const mainland = mainlandSourceForURL(canonical);
  if (mainland) return { id: mainland.id, provider: 'feishu', company: mainland.company, name: mainland.name, url: mainland.url, enabled: true };
  return { id: `discovery-${createHash('sha256').update(canonical).digest('hex').slice(0, 20)}`,
    provider, company: input.company.trim(), name: input.name?.trim() || `${input.company.trim()}招聘`, url: canonical, enabled: true };
}

export function defaultDiscoverySources(): DiscoverySource[] {
  return [
    { ...TENCENT_CAMPUS },
    ...MAINLAND_FEISHU_SOURCES.map(source => ({ id: source.id, provider: 'feishu' as const, company: source.company, name: source.name, url: source.url, enabled: true })),
    registerDiscoverySource({ company: 'Cohere', name: 'Cohere · 海外公开岗位', url: 'https://jobs.ashbyhq.com/cohere' }),
    registerDiscoverySource({ company: 'Portcast', name: 'Portcast · 海外公开岗位', url: 'https://jobs.lever.co/portcast' }),
    registerDiscoverySource({ company: 'Mistral AI', name: 'Mistral AI · 海外公开岗位', url: 'https://jobs.ashbyhq.com/mistral.ai' }),
    { ...TENCENT },
    registerDiscoverySource({ company: '字节跳动', name: '字节校招 · 浏览器采集入口', url: 'https://jobs.bytedance.com/campus/position' }),
  ];
}

export function validateDiscoverySource(source: DiscoverySource): DiscoverySource {
  if (source?.provider === 'tencent-campus') {
    if (source.id !== TENCENT_CAMPUS.id || source.url !== TENCENT_CAMPUS.url || source.company !== TENCENT_CAMPUS.company || typeof source.enabled !== 'boolean') throw new TypeError('腾讯校招公开来源配置无效。');
    return { ...TENCENT_CAMPUS, enabled: source.enabled };
  }
  if (source?.provider === 'tencent') {
    if (source.id !== 'tencent-experienced' || source.url !== 'https://careers.tencent.com/' || source.company !== '腾讯' || typeof source.enabled !== 'boolean') throw new TypeError('腾讯公开来源配置无效。');
    return { ...TENCENT, enabled: source.enabled };
  }
  const canonical = registerDiscoverySource(source);
  // Previously registered domestic entry URLs remain inert historical entries.
  const legacyId = `discovery-${createHash('sha256').update(source.url).digest('hex').slice(0, 20)}`;
  if (source.provider === 'candidate' && canonical.provider !== 'candidate' && source.id === legacyId && typeof source.enabled === 'boolean') return { ...source };
  if (source.id !== canonical.id || source.provider !== canonical.provider || source.url !== canonical.url || typeof source.enabled !== 'boolean') throw new TypeError('来源标识与公开招聘入口不一致。');
  return { ...canonical, enabled: source.enabled };
}
