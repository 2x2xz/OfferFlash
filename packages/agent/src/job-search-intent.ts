/** Narrow host task intent, not a model router or another agent loop. */
export type JobSearchIntent = 'fresh' | 'local';
export const JOB_SEARCH_DEADLINE_MS = 35_000;
export const JOB_SEARCH_DISCOVERY_BUDGET = Object.freeze({
  maxSources: 3, maxPages: 2, pageSize: 20, detailLimit: 10, includeExperienced: false,
});
export interface JobSearchTask {
  intent: JobSearchIntent; scope: 'mainland-official' | 'overseas-official' | 'local-snapshot'; deadlineMs: number;
  region: 'mainland' | 'overseas';
  discoveryOptions?: typeof JOB_SEARCH_DISCOVERY_BUDGET;
}
export interface JobSearchExecutionEvidence {
  intent: JobSearchIntent; profileRead: boolean;
  searchStatus: 'not-started' | 'completed' | 'partial' | 'failed' | 'cancelled';
  scope: 'mainland-official' | 'overseas-official' | 'local-snapshot'; jobCount: number;
  region?: 'mainland' | 'overseas';
  attemptedSources?: number; unviewedSources?: number;
}
export type JobSearchExecutionStatus = JobSearchExecutionEvidence['searchStatus'];

const jobs = /岗位|职位|招聘|工作机会|就业机会|实习机会|\b(?:jobs?|positions?|roles?|vacanc(?:y|ies)|internships?|career opportunities)\b/iu;
const jobTarget = '(?:岗位|职位|招聘|工作机会|就业机会|实习机会|\\b(?:jobs?|positions?|roles?|vacanc(?:y|ies)|internships?|career opportunities)\\b)';
const action = '(?:查找|查询|查查|查一下|查下|查|找找|找一下|找|搜索|搜搜|搜|推荐|筛选|匹配|看看|看一下|看下|\\b(?:find|search|recommend|match|show|list|look(?:\\s+up|\\s+for)?)\\b)';
const requestWithTarget = new RegExp(`${action}.{0,120}${jobTarget}|${jobTarget}.{0,60}(?:有哪些|有什么|有没有|适合我|匹配我|推荐给我|查一下|帮我查)|(?:有哪些|有什么|有没有|哪些).{0,60}${jobTarget}`, 'iu');
const methodQuestion = new RegExp(`(?:如何|怎么|怎样|为何|为什么).{0,50}${action}.{0,100}${jobTarget}|\\bhow\\b.{0,60}(?:find|search|recommend|match).{0,100}${jobTarget}`, 'iu');
const negatedAction = /(?:不要|先别|暂时别|别|不用|不必|不需要|不想|停止|取消)(?:再|继续|帮我|替我|为我|去|直接|自动|给我|帮忙|进行)?(?:查找|查询|查|找|搜|推荐|筛选|匹配)|\b(?:do not|don't|stop|no need to|never)\s+(?:(?:help|me|please|automatically|keep)\s+){0,3}(?:find|search|recommend|look|list|show|matching)\b/iu;
const technicalCapability = /(?:\bMCP\b|\bPlaywright\b|浏览器工具|搜索工具).{0,25}(?:能|可以|是否|如何|怎么)|(?:怎么|如何|是否|怎样).{0,35}(?:\bMCP\b|\bPlaywright\b)|\b(?:can|does|how)\b.{0,25}\b(?:mcp|playwright)\b/iu;
const providedComparison = /(?:比较|对比|分析|解释|评估|看看|看一下|推荐).{0,18}(?:这(?:两|几|些|个)|那(?:两|几|些|个)|已给|给你的|上面|上述|提供的).{0,30}(?:岗位|职位|JD)|(?:这两个|这几个|上述|我给你的|上面的).{0,25}(?:岗位|职位|JD)|\b(?:compare|evaluate|analyze|analyse)\b.{0,50}\b(?:these|those|provided|given|above)\b.{0,30}\b(?:jobs?|positions?|roles?)\b/iu;

function outsideQuotes(input: string): string {
  return input.replace(/^\s*>[^\n]*(?:\n|$)/gmu, ' ')
    .replace(/```[\s\S]*?(?:```|$)/gu, ' ')
    .replace(/`[^`\n]*(?:`|$)/gu, ' ')
    .replace(/“[^”]*(?:”|$)|‘[^’]*(?:’|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|《[^》]*(?:》|$)/gu, ' ')
    .replace(/(^|[\s:：])"(?:[^"\\]|\\.)*"|(^|[\s:：])'(?:[^'\\]|\\.)*'/gmu, ' ')
    .replace(/(^|[\s:：])["'][^\n]*$/gmu, ' ');
}
function localConstraint(input: string): boolean {
  // "Don't ONLY search the local database" requests broader research, while
  // "don't go online" constrains an otherwise authorized job search to local.
  const positive = input
    .replace(/(?:不要|别|不用|不必|不是)(?:只|仅)(?:查找|查询|查|看|从)?[^，,。！？?;\n]{0,25}(?:本地(?:岗位)?库|岗位库|本地|已保存(?:的岗位)?|现有岗位|当前库)/gu, ' ')
    .replace(/\b(?:do not|don't|not)\s+(?:only|just)\s+(?:search|query|look at|use).{0,35}\b(?:local database|saved jobs|stored jobs)\b/giu, ' ');
  return /(?:不要|别|禁止|无需|不用|不)(?:再|自动)?(?:联网|上网|访问网络|访问官网)|\b(?:do not|don't|no|without|never)\s+(?:go(?:ing)?\s+online|internet|network|web(?:\s+search)?|brows(?:e|ing))\b/iu.test(positive)
    || /岗位库|本地(?:岗位|职位|库|数据库)|(?:已经保存|已保存|已采集|收藏|现有|当前)(?:的)?(?:岗位|职位|库)|\b(?:local\s+(?:job\s+)?database|saved\s+(?:jobs?|positions?)|stored\s+(?:jobs?|positions?)|offline)\b/iu.test(positive);
}

/** A question about workflow or a quoted example is never authorization to search. */
export function classifyJobSearchIntent(input: string): JobSearchIntent | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 20_000) return null;
  const text = outsideQuotes(input.normalize('NFKC')).replace(/\r/gu, '');
  if (!jobs.test(text)) return null;
  const hypothetical = /(?:如果|假如|假设|例如|比如|示例|举例|当用户|用户说|用户输入|用户问).{0,45}(?:查|找|搜|推荐).{0,60}(?:岗位|职位)|\b(?:for example|suppose|if a user|someone says)\b.{0,100}\b(?:find|search|recommend)\b/iu.test(text);
  const explanation = /解释|说明|意思|识别|如何处理|怎么处理|怎么回复|如何回复|原理|工作流|流程|教程|\b(?:explain|classify|meaning|respond|handle)\b/iu.test(text);
  if (hypothetical && explanation && !/(?:请实际|现在直接|直接执行|实际执行|现在就).{0,12}(?:查|找|搜|推荐)/u.test(text)) return null;
  const clauses = text.split(/[，,。！？!?；;\n]+/u).map(value => value.trim()).filter(Boolean);
  const executable = clauses.filter(clause => {
    if (!jobs.test(clause) || !requestWithTarget.test(clause)) return false;
    if (methodQuestion.test(clause) || technicalCapability.test(clause) || providedComparison.test(clause)) return false;
    if (/^(?:请|帮我|给我)?(?:解释|说明|讲讲|介绍|了解|分析原理)|\b(?:explain|describe|teach)\b/iu.test(clause)) return false;
    if (/(?:写|撰写|生成|整理).{0,35}(?:方法|流程|教程|原理|提示词|说明|介绍)|\bwrite\b.{0,40}\b(?:guide|tutorial|prompt|instructions)\b/iu.test(clause)) return false;
    if (negatedAction.test(clause) && !/(?:不要|别|不用|不必)(?:只|仅)(?:查|找|看|搜)|\b(?:don't|do not)\s+(?:only|just)\b/iu.test(clause)) return false;
    return true;
  });
  if (!executable.length) return null;
  const allowedText = clauses.filter(clause => !negatedAction.test(clause) || /(?:不要|别|不用|不必)(?:只|仅)|\b(?:don't|do not)\s+(?:only|just)\b/iu.test(clause)).join('，');
  return localConstraint(allowedText) ? 'local' : 'fresh';
}

export function createJobSearchTask(input: string): JobSearchTask | null {
  const intent = classifyJobSearchIntent(input); if (!intent) return null;
  const text = outsideQuotes(input.normalize('NFKC')).replace(/(?:不要|别|不找|不用|排除|不考虑|不含|不想)(?:再找|找|搜索|搜|查|看)?(?:国外|海外|境外)|\b(?:no|not|without|exclude)\s+(?:overseas|foreign|international)\b/giu, '');
  const region = intent === 'fresh' && /国外|海外|境外|\b(?:overseas|foreign|international)\s+(?:jobs?|positions?|roles?)\b/iu.test(text) ? 'overseas' : 'mainland';
  return intent === 'local' ? { intent, region, scope: 'local-snapshot', deadlineMs: JOB_SEARCH_DEADLINE_MS }
    : { intent, region, scope: region === 'overseas' ? 'overseas-official' : 'mainland-official', deadlineMs: JOB_SEARCH_DEADLINE_MS, discoveryOptions: { ...JOB_SEARCH_DISCOVERY_BUDGET } };
}

/** Only trusted host execution facts count. Assistant promises/stopReason are intentionally absent. */
export function assessJobSearchExecution(evidence: JobSearchExecutionEvidence): JobSearchExecutionStatus {
  if (!evidence || !['fresh', 'local'].includes(evidence.intent) || typeof evidence.profileRead !== 'boolean'
    || !['not-started', 'completed', 'partial', 'failed', 'cancelled'].includes(evidence.searchStatus)
    || !Number.isSafeInteger(evidence.jobCount) || evidence.jobCount < 0
    || evidence.attemptedSources !== undefined && (!Number.isSafeInteger(evidence.attemptedSources) || evidence.attemptedSources < 0 || evidence.attemptedSources > 8)
    || evidence.unviewedSources !== undefined && (!Number.isSafeInteger(evidence.unviewedSources) || evidence.unviewedSources < 0 || evidence.unviewedSources > 60)) return 'failed';
  if (evidence.searchStatus === 'cancelled') return 'cancelled';
  if (evidence.searchStatus === 'failed') return 'failed';
  if (evidence.searchStatus === 'not-started') return 'not-started';
  if (!evidence.profileRead || evidence.scope !== (evidence.intent === 'fresh' ? evidence.region === 'overseas' ? 'overseas-official' : 'mainland-official' : 'local-snapshot')) return 'failed';
  if (evidence.intent === 'fresh' && !(evidence.attemptedSources && evidence.attemptedSources > 0)) return 'failed';
  return evidence.searchStatus === 'partial' || evidence.unviewedSources ? 'partial' : 'completed';
}
