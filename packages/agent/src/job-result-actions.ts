import type { ApplicationStatus } from '../../shared/src/contracts.js';
import type { RuntimeRunOptions, RuntimeWorkflowResult } from '../../runtime/src/runtime.js';
import { classifyJobSearchIntent } from './job-search-intent.js';

export interface JobResultCandidate { id: string; company: string; title: string; url: string }
export type JobResultActionHost = (name: 'add_to_tracker' | 'open_job', args: { jobId: string }, signal?: AbortSignal) => Promise<unknown>;
type Workflow = NonNullable<RuntimeRunOptions['workflow']>;
type Operation = 'track' | 'open' | 'apply';
type Parsed = { operation: Operation; indices: number[] } | { clarification: string };
type Confirmed = { index: number; jobId: string; action: 'track'; applicationStatus: ApplicationStatus }
  | { index: number; jobId: string; action: 'open'; opening: 'exact-url' | 'same-origin-redirect' };

const statusLabels = {
  'needs-review': '待核对', saved: '待申请', applied: '已申请', assessment: '测评', interview: '面试',
  offer: 'Offer', rejected: '未通过', withdrawn: '已撤回',
} satisfies Record<ApplicationStatus, string>;
const numberToken = '(?:[0-9]+|[零〇一二两三四五六七八九十百]+)';
const ordinalGroup = new RegExp(`第\\s*${numberToken}(?:\\s*[、和与及]\\s*(?:第\\s*)?${numberToken})*\\s*(?:个|条|项|份|家)?(?![A-Za-z0-9零〇一二两三四五六七八九十百个条项份家./+半])`, 'gu');
const numberPattern = new RegExp(numberToken, 'gu');
const recentPlural = /这些|这几个|这几条|上面(?:的|这)?(?:几个|几条|岗位|职位)|上述|以上(?:这些)?(?:岗位|职位)|刚才(?:的|这)?(?:几个|几条|岗位|职位)/u;
const trackPattern = /(?:加入|加到|加进|放入|放到|添加到|添加至|添加进|添加).{0,8}(?:待申请|待投递|跟踪|追踪)|跟踪|追踪/u;
const openPattern = /打开|(?:进入|访问).{0,30}(?:网申|申请|岗位|职位)|去网申/u;
const applyPattern = /(?:开始)?申请\s*(?:第|这些|这几个|上面|上述|以上)|(?:第\s*[0-9零〇一二两三四五六七八九十百]+(?:个|条)?).{0,8}(?:开始申请|去申请)/u;

function outsideQuotes(input: string): string {
  return input.replace(/^\s*>[^\n]*(?:\n|$)/gmu, ' ')
    .replace(/```[\s\S]*?(?:```|$)/gu, ' ').replace(/`[^`\n]*(?:`|$)/gu, ' ')
    .replace(/“[^”]*(?:”|$)|‘[^’]*(?:’|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|《[^》]*(?:》|$)/gu, ' ')
    .replace(/(^|[\s:：])"(?:[^"\\]|\\.)*"|(^|[\s:：])'(?:[^'\\]|\\.)*'/gmu, ' ')
    .replace(/(^|[\s:：])["'][^\n]*$/gmu, ' ');
}
function operations(text: string): Operation[] {
  const result: Operation[] = [];
  if (trackPattern.test(text)) result.push('track');
  if (openPattern.test(text)) result.push('open');
  if (applyPattern.test(text)) result.push('apply');
  return result;
}
function ordinalValue(token: string): number {
  if (/^[0-9]+$/u.test(token)) return Number(token);
  const digit: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (token.length === 1 && Object.hasOwn(digit, token)) return digit[token]!;
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/u.test(token)) {
    const [tens, units] = token.split('十'); return (tens ? digit[tens]! : 1) * 10 + (units ? digit[units]! : 0);
  }
  return Number.NaN;
}
function ordinals(text: string): number[] {
  return [...text.matchAll(ordinalGroup)].flatMap(group => [...group[0].matchAll(numberPattern)].map(item => ordinalValue(item[0])));
}
function parse(input: string): Parsed | undefined {
  if (typeof input !== 'string' || !input.trim() || input.length > 20_000) return undefined;
  const original = input.normalize('NFKC');
  // Searching changes the numbered result set. Let the search workflow present it first;
  // a follow-up in the same sentence must never act on the previous snapshot.
  if (classifyJobSearchIntent(original)) return undefined;
  const text = outsideQuotes(original).trim();
  if (!operations(text).length) {
    return operations(original).length && /第|这些|上面|上述/u.test(original)
      ? { clarification: '引用或示例中的操作没有执行。请直接说明要操作上一轮第几个岗位。' } : undefined;
  }
  const clarify = (clarification: string): Parsed => ({ clarification });
  if (/(?:如何|怎么|怎样|为何|为什么|解释|说明|教程|方法|意思|原理|举例|例如|比如|假如|假设|如果|用户说|用户输入)|(?:什么|哪些|需要什么).{0,12}(?:工具|功能|能力)|(?:MCP|SDK).{0,20}(?:能|可以|支持)/u.test(text)) {
    return clarify('本次按说明或方法问题处理，没有操作岗位。若要执行，请直接说“把第一个加入待申请”或“打开第二个网申”。');
  }
  // A request to avoid submission is compatible with opening a page. It is not a denial of opening.
  const commandText = text.replace(/(?:不要|不用|不必|先别|别|不)(?:自动|帮我|替我)?(?:提交(?:申请)?|投递(?:申请)?|填写|填表)/gu, ' ');
  if (/(?:不要|先别|暂时别|别|不用|不必|不需要|不想|暂时不|暂不|先不|不再|不会|不能|不可|不允许|不准备|不打算|不希望|不|取消|停止|不是让你|并非让你).{0,30}(?:加入|添加|加到|放入|打开|访问|进入|申请|跟踪|追踪)|第.{0,8}(?:不要|不选)/u.test(commandText)) {
    return clarify('本次没有操作岗位。请明确要加入待申请或打开的编号后再执行。');
  }
  if (/提交|自动(?:填写|填表|投递)|(?:替我|帮我|直接)(?:填写|填表|投递)/u.test(commandText)) {
    return clarify('这里只能加入待申请或打开岗位页面；自动填写需要在页面点击按钮，最终提交由你操作。本次未执行。');
  }
  if (/或者|或是|或|任选|任意|随便|看着办|除了|除去|其余|剩下|前[零〇一二两三四五六七八九十百0-9]+个|最后|倒数|第.{0,15}(?:到|至|[-~～—]).{0,15}第?/u.test(commandText)) {
    return clarify('岗位选择有多种解释，本次未操作。请使用上一轮展示的明确编号，例如“第一、第三个”，或“这些全部加入待申请”。');
  }
  const kinds = [...new Set(operations(commandText))];
  if (kinds.length !== 1) return clarify('请先选择一种操作：加入待申请，或打开一个网申页面。本次没有执行组合操作。');
  const operation = kinds[0]!;
  const clauses = commandText.split(/[，,。！？!?；;\n]+/u).filter(clause => operations(clause).includes(operation));
  const selections: number[] = [];
  for (const clause of clauses) {
    const numbered = ordinals(clause);
    if (clause.replace(ordinalGroup, '').includes('第')) return clarify('岗位编号无法完整核对，请使用整数编号，例如“第一个”或“第一、第三个”。本次未操作。');
    if (numbered.length && recentPlural.test(clause) && /全部|全都|都/u.test(clause)) return clarify('请使用明确编号或上一轮全部候选，不要混合两种选择。本次未操作。');
    if (numbered.length) selections.push(...numbered);
    else if (recentPlural.test(clause)) selections.push(-1); // Sentinel for an explicit recent-result plural, never the literal ordinal zero.
    else return clarify('请指定上一轮第几个岗位；不会按公司名称、用户提供的 ID 或整库猜测目标。');
  }
  if (!selections.length || selections.includes(-1) && selections.some(value => value !== -1)) {
    return clarify('请明确选择编号，或明确选择上一轮展示的全部候选。本次未操作。');
  }
  if (selections.some(value => !Number.isSafeInteger(value) || value < -1 || value === 0)) return clarify('岗位编号无法核对，本次未操作。');
  const indices = [...new Set(selections)];
  if (operation !== 'track' && (indices.length !== 1 || indices[0] === -1)) {
    return clarify('一次只能打开一个岗位。请明确说“打开第一个网申”或“申请第二个”。');
  }
  return { operation, indices };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function httpURL(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/u.test(value)) return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; }
  catch { return undefined; }
}
function snapshot(candidates: readonly JobResultCandidate[] | undefined): JobResultCandidate[] | undefined {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 6) return undefined;
  const ids = new Set<string>(), result: JobResultCandidate[] = [];
  for (const item of candidates) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id !== item.id.trim() || item.id.length > 256 || /[\u0000-\u001f\u007f]/u.test(item.id)
      || ids.has(item.id) || typeof item.company !== 'string' || !item.company.trim() || item.company.length > 300
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 || !httpURL(item.url)) return undefined;
    ids.add(item.id); result.push({ id: item.id, company: item.company, title: item.title, url: item.url });
  }
  return result;
}
function result(status: RuntimeWorkflowResult['status'], operation: Operation | 'clarify', summary: string, facts: Record<string, unknown> = {}): RuntimeWorkflowResult {
  return { status, summary, context: JSON.stringify({ kind: 'job-result-action', operation, status, ...facts,
    didNotRequestFill: true, didNotRequestSubmission: true }) };
}
function clarification(summary: string): Workflow {
  return async ({ signal, progress }) => {
    progress(signal.aborted ? 'cancelled' : 'clarify');
    return result(signal.aborted ? 'cancelled' : 'completed', 'clarify', signal.aborted ? '本轮操作已停止，没有执行岗位操作。' : summary, { confirmed: [] });
  };
}
function confirmedLine(item: Confirmed): string {
  if (item.action === 'track') return item.applicationStatus === 'saved' ? `第${item.index}个：已加入待申请。`
    : `第${item.index}个：已在进度中，保留原状态（${statusLabels[item.applicationStatus]}）。`;
  return item.opening === 'exact-url' ? `第${item.index}个：已打开岗位页面。登录后点击“自动填写”，提交申请由你操作。`
    : `第${item.index}个：已触发打开，发生站内跳转，请核对目标。登录后点击“自动填写”，提交申请由你操作。`;
}

/** Host-only follow-up over the last displayed results. This is not a model/tool-text parser. */
export function createJobResultActionWorkflow(input: string, candidates: readonly JobResultCandidate[] | undefined, host: JobResultActionHost): Workflow | undefined {
  const parsed = parse(input);
  if (!parsed) return undefined;
  if ('clarification' in parsed) return clarification(parsed.clarification);
  const jobs = snapshot(candidates);
  if (!jobs) return clarification('没有可核对的上一轮候选列表。请先查找岗位，看到编号后再操作；本次没有修改进度或打开页面。');
  const indices = parsed.indices[0] === -1 ? jobs.map((_, index) => index + 1) : parsed.indices;
  if (indices.some(index => index < 1 || index > jobs.length)) return clarification(`上一轮只展示了 ${jobs.length} 个候选，请指定范围内的编号。本次未操作。`);
  const steps = indices.flatMap(index => (parsed.operation === 'apply' ? ['track', 'open'] as const : [parsed.operation] as const)
    .map(action => ({ index, action, candidate: jobs[index - 1]! })));
  let consumed = false;
  return async ({ signal, progress }) => {
    if (consumed) { progress('clarify'); return result('completed', 'clarify', '这次操作已执行或已停止；没有重复操作。若需重试，请先核对进度，再发出明确指令。', { confirmed: [], reason: 'already-consumed' }); }
    consumed = true;
    const confirmed: Confirmed[] = [];
    let cursor = 0, unconfirmedIndex: number | undefined, failure: string | undefined;
    for (; cursor < steps.length; cursor++) {
      if (signal.aborted) break;
      const step = steps[cursor]!;
      progress(step.action === 'track' ? 'track-results' : 'open-result');
      try {
        // Do not race a mutation against abort and pretend it never happened. Retain its actual receipt first.
        const raw = await host(step.action === 'track' ? 'add_to_tracker' : 'open_job', { jobId: step.candidate.id }, signal);
        const receipt = record(raw);
        if (step.action === 'track') {
          if (!receipt || receipt.jobId !== step.candidate.id || typeof receipt.status !== 'string' || !Object.hasOwn(statusLabels, receipt.status)) {
            failure = 'unverified-track-result'; unconfirmedIndex = step.index; break;
          }
          confirmed.push({ index: step.index, jobId: step.candidate.id, action: 'track', applicationStatus: receipt.status as ApplicationStatus });
        } else {
          const opened = httpURL(receipt?.url), target = httpURL(step.candidate.url)!;
          if (!receipt || receipt.jobId !== undefined && receipt.jobId !== step.candidate.id || receipt.error
            || !opened || opened.origin !== target.origin) {
            failure = 'unverified-open-result'; unconfirmedIndex = step.index; break;
          }
          confirmed.push({ index: step.index, jobId: step.candidate.id, action: 'open', opening: opened.href === target.href ? 'exact-url' : 'same-origin-redirect' });
        }
      } catch {
        failure = 'host-error'; unconfirmedIndex = step.index; break;
      }
    }
    const cancelled = signal.aborted;
    const status = cancelled ? 'cancelled' : failure ? 'failed' : 'completed';
    const lines = confirmed.map(confirmedLine);
    if (cancelled) lines.push('后续操作已停止。已收到确认的操作保留；没有自动重试。');
    if (unconfirmedIndex !== undefined) lines.push(`第${unconfirmedIndex}个的操作回执无法核对，请先检查页面或申请进度；没有继续后续操作或自动重试。`);
    if (!lines.length) lines.push('本轮已停止，没有执行岗位操作。');
    if (parsed.operation === 'track' && confirmed.length) lines.push('本次只更新待申请跟踪，没有填写或提交申请。');
    progress(cancelled ? 'cancelled' : failure ? 'failed' : 'results');
    return result(status, parsed.operation, lines.join('\n\n'), { requestedIndices: indices, candidateCount: jobs.length, confirmed,
      unconfirmedIndices: unconfirmedIndex === undefined ? [] : [unconfirmedIndex],
      unconfirmedSteps: unconfirmedIndex === undefined ? [] : [{ index: unconfirmedIndex, action: steps[cursor]!.action }],
      unstartedSteps: steps.slice(unconfirmedIndex === undefined ? cursor : cursor + 1).map(step => ({ index: step.index, action: step.action })),
      ...(failure ? { reason: failure } : {}) });
  };
}
