import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { FORM_MAPPING_PROMPT, validateModelFormInput, type ModelFormInput, type ModelFormResult } from '../../forms/src/model-recognition.js';

export interface FormModelUsage {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
}
export interface FormModelResponse extends ModelFormResult { usage?: FormModelUsage; httpStatus?: number; }
export interface FormModelRequestOptions { signal?: AbortSignal; timeoutMs?: number; maxTokens?: number; }
type FailureCode = 'invalid-input' | 'cancelled' | 'timeout' | 'provider' | 'incomplete';

/** Deliberately excludes raw provider errors, response headers and request data. */
export class FormModelRequestError extends Error {
  constructor(readonly code: FailureCode, readonly httpStatus?: number) {
    const message = code === 'cancelled' ? '表单模型识别已停止。'
      : code === 'timeout' ? '表单模型识别超时，请稍后重试。'
        : code === 'invalid-input' ? '无效表单识别请求。'
          : code === 'incomplete' ? '模型没有完成纯字段映射。'
            : httpStatus === 401 || httpStatus === 403 ? '模型服务未接受本次凭据，请检查 Key 和服务地址。'
              : httpStatus === 429 ? '模型服务暂时限流或额度不足，请检查额度后重试。'
                : '模型识别请求未完成，请检查网络与模型配置后重试。';
    super(message);
    this.name = 'FormModelRequestError';
  }
}

const dashscopeHosts = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com']);
function isDashscope(model: Model<Api>): boolean {
  try { return dashscopeHosts.has(new URL(model.baseUrl).hostname.toLowerCase()); } catch { return false; }
}
function finiteBudget(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined ? fallback : Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), maximum) : fallback;
}
function usageCounts(value: unknown): FormModelUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
  if (!keys.every(key => typeof usage[key] === 'number' && Number.isFinite(usage[key]) && (usage[key] as number) >= 0)) return undefined;
  return Object.fromEntries(keys.map(key => [key, usage[key]])) as unknown as FormModelUsage;
}

/** One independent Pi request. No AgentSession, tools, personal values or persistence. */
export async function recognizeFormWithModel(
  runtime: Pick<ModelRuntime, 'completeSimple'>, model: Model<Api>, input: ModelFormInput,
  options: FormModelRequestOptions = {},
): Promise<FormModelResponse> {
  try { validateModelFormInput(input); } catch { throw new FormModelRequestError('invalid-input'); }
  if (options.signal?.aborted) throw new FormModelRequestError('cancelled');
  const controller = new AbortController();
  let abortCode: 'cancelled' | 'timeout' = 'cancelled';
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new FormModelRequestError(abortCode));
  const onCallerAbort = () => { abortCode = 'cancelled'; controller.abort(); };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeoutMs = finiteBudget(options.timeoutMs, 20_000, 20_000);
  const timer = setTimeout(() => { abortCode = 'timeout'; controller.abort(); }, timeoutMs);
  let httpStatus: number | undefined;
  try {
    const response = await Promise.race([runtime.completeSimple(model, {
      systemPrompt: FORM_MAPPING_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }], tools: [],
    }, {
      signal: controller.signal, timeoutMs, maxTokens: finiteBudget(options.maxTokens, 3_000, 3_000),
      maxRetries: 0, cacheRetention: 'none',
      onPayload: payload => isDashscope(model) && payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload, enable_thinking: false } : payload,
      onResponse: response => { if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) httpStatus = response.status; },
    }), aborted]);
    if (controller.signal.aborted) throw new FormModelRequestError(abortCode);
    if (response.stopReason === 'error') throw new FormModelRequestError('provider', httpStatus);
    if (response.stopReason !== 'stop' || response.content.some(block => block.type === 'toolCall')) throw new FormModelRequestError('incomplete', httpStatus);
    const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (text.length > 24_000) throw new FormModelRequestError('incomplete', httpStatus);
    const usage = usageCounts(response.usage);
    return { text, modelId: model.id, ...(usage ? { usage } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}) };
  } catch (error) {
    if (error instanceof FormModelRequestError) throw error;
    if (controller.signal.aborted) throw new FormModelRequestError(abortCode);
    throw new FormModelRequestError('provider', httpStatus);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
