import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, fauxAssistantMessage, fauxToolCall, type Model, type Api, type FauxResponseStep } from '@earendil-works/pi-ai';
import type { ModelConfig, ModelStatus } from '../../packages/shared/src/contracts.js';
import { createOfferAgentRuntime, type OfferAgentRuntime, type RuntimeRunOptions } from '../../packages/runtime/src/runtime.js';
import { createDemoModel } from '../../packages/runtime/src/demo-model.js';
import { createDomainTools } from '../../packages/agent/src/tools.js';
import { loadAgentPolicy } from '../../packages/agent/src/policy.js';
import { FormModelRequestError, recognizeFormWithModel } from '../../packages/agent/src/form-model.js';
import { validateModelFormInput } from '../../packages/forms/src/model-recognition.js';
import { jobSearchWorkflow } from '../../packages/agent/src/job-search-workflow.js';
import { createJobResultActionWorkflow, type JobResultCandidate } from '../../packages/agent/src/job-result-actions.js';

const port = (process as NodeJS.Process & { parentPort: { on(name: string, listener: (event: { data: any }) => void): void; postMessage(value: unknown): void } }).parentPort;
const stateDir = process.env.OFFERAGENT_STATE_DIR!;
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; cleanup: () => void }>();
let counter = 0;
let runtime: OfferAgentRuntime | undefined;
let demoModel: Awaited<ReturnType<typeof createDemoModel>> | undefined;
let running = false;
let configuring = false;
let cancelRequested = false;
let runDone: Promise<void> | undefined;
let liveKey = '';
let formModelRuntime: ModelRuntime | undefined;
let formModel: Model<Api> | undefined;
let formController: AbortController | undefined;
let formDone: Promise<void> | undefined;
let status: ModelStatus = { mode: 'demo', provider: 'offeragent-demo', modelId: 'offline-fixture', configured: true };
let lastJobCandidates: JobResultCandidate[] = [];

function redact(message: string): string { return liveKey ? message.split(liveKey).join('[密钥已隐藏]') : message; }
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  return value;
}
const send = (value: unknown) => port.postMessage(redactValue(value));
function hostTool(name: string, args: unknown, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `tool-${++counter}`;
    if (signal?.aborted) { reject(new Error('任务已取消')); return; }
    const onAbort = () => send({ kind: 'tool-cancel', id });
    const cleanup = () => { if(timer)clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    const timer = name==='request_user_input'?undefined:setTimeout(() => {
      send({ kind: 'tool-cancel', id });
      cleanup(); pending.delete(id); reject(new Error('操作等待超时，请检查网页或停止任务。'));
    }, 45_000);
    // Wait for the host operation to settle after cancellation, so the SDK does
    // not report a finished task while its local write is still in flight.
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, { resolve, reject, cleanup });
    send(name==='match_profile_jobs'?{kind:'matching-request',id,args}:{ kind: 'tool', id, name, args });
  });
}

async function configure(config: ModelConfig, initializing = false): Promise<ModelStatus> {
  if ((running && !initializing) || formController) throw new Error('请先等待或停止当前任务，再更换模型。');
  if (configuring) throw new Error('模型配置正在更新，请稍候。');
  if (!config || !['demo', 'live'].includes(config.mode)) throw new Error('无效模型模式。');
  configuring = true;
  let candidate: OfferAgentRuntime | undefined;
  try {
  let modelRuntime: ModelRuntime;
  let model: Model<Api>;
  let nextDemo: Awaited<ReturnType<typeof createDemoModel>> | undefined;
  let nextStatus: ModelStatus;
  let nextKey = '';
  if (config.mode === 'demo') {
    nextDemo = await createDemoModel();
    ({ modelRuntime, model } = nextDemo);
    nextStatus = { mode: 'demo', provider: 'offeragent-demo', modelId: model.id, configured: true };
  } else {
    if (!config.apiKey?.trim() || !config.modelId?.trim()) throw new Error('请输入模型 ID 和本次会话使用的 API key。');
    modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const provider = config.provider;
    if (!['deepseek', 'openai', 'anthropic', 'custom'].includes(provider)) throw new Error('不支持的模型供应商。');
    if (provider === 'custom') {
      const endpoint = new URL(config.baseURL || '');
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('模型地址必须为 HTTP(S)，不能在 URL 中放凭据。');
      modelRuntime.registerProvider('offeragent-compatible', {
        baseUrl: endpoint.href, api: 'openai-completions', apiKey: config.apiKey.trim(),
        models: [{ id: config.modelId, name: config.modelId, reasoning: false, input: ['text'], contextWindow: 32_768, maxTokens: 4_096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      });
      model = modelRuntime.getModel('offeragent-compatible', config.modelId)!;
    } else {
      model = modelRuntime.getModel(provider, config.modelId)!;
      if (!model) throw new Error('SDK 中未找到该模型 ID；请核对名称，或使用自定义兼容接口。');
      await modelRuntime.setRuntimeApiKey(provider, config.apiKey.trim());
    }
    if (!model) throw new Error('模型配置未建立。');
    nextKey = config.apiKey.trim();
    nextStatus = { mode: 'live', provider: model.provider, modelId: model.id, configured: true };
  }
  const policy = await loadAgentPolicy(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  candidate = await createOfferAgentRuntime({
    stateDir: join(stateDir, 'agent'), modelRuntime, model, tools: createDomainTools(hostTool),
    systemPrompt: policy.systemPrompt,
  });
  // An invalid candidate leaves the current working session intact.
  await runtime?.close();
  runtime = candidate;
  candidate = undefined;
  demoModel = nextDemo;
  liveKey = nextKey;
  status = nextStatus;
  formModelRuntime = modelRuntime;
  formModel = model;
  runtime.subscribe(event => {
    send({ kind: 'event', event });
    if (event.type === 'task_started' && cancelRequested) void runtime?.cancel().catch(() => {});
  });
  send({ kind: 'model', status });
  return status;
  } finally {
    await candidate?.close();
    configuring = false;
  }
}

async function identifyForm(input: unknown): Promise<Awaited<ReturnType<typeof recognizeFormWithModel>>> {
  if (running || configuring || formController) throw new Error('当前已有模型任务，请稍后再识别表单。');
  if (status.mode !== 'live' || !formModelRuntime || !formModel) throw new Error('请先配置在线模型。');
  validateModelFormInput(input);
  const modelRuntime = formModelRuntime, model = formModel;
  const controller = new AbortController();
  formController = controller;
  let finish!: () => void;
  formDone = new Promise<void>(resolve => { finish = resolve; });
  try {
    const response = await recognizeFormWithModel(modelRuntime, model, input, { signal: controller.signal });
    return response;
  } finally {
    if (formController === controller) formController = undefined;
    finish(); formDone = undefined;
  }
}

function demoResponses(input: string): FauxResponseStep[] {
  const tracking = /进度|申请|面试|笔试/.test(input) && !/找|推荐|岗位/.test(input);
  return [
    fauxAssistantMessage(tracking ? fauxToolCall('list_applications', {}) : [fauxToolCall('get_profile_summary', {}), fauxToolCall('query_jobs', {})], { stopReason: 'toolUse' }),
    context => {
      const results = context.messages.filter(message => message.role === 'toolResult');
      const last = results.at(-1);
      const text = last?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
      if (last?.isError) return fauxAssistantMessage(`离线演示：工具报告错误，未确认业务成功。${text}`);
      const value = JSON.parse(text || '{}');
      if (tracking) {
        const records = Array.isArray(value) ? value : value.applications ?? [];
        return fauxAssistantMessage(`离线演示已读取 ${records.length} 条申请记录。${records.map((a: any) => `${a.company} · ${a.title}：${a.status}`).slice(0, 6).join('；')}。这是脚本化演示；任意自然语言分析请配置真实模型。`);
      }
      const jobs = Array.isArray(value) ? value : value.jobs ?? [];
      if (!jobs.length) return fauxAssistantMessage('离线演示：岗位库目前为空。先刷新招聘来源、保存当前岗位，或明确载入虚构演示数据，再运行分析。');
      return fauxAssistantMessage(`离线演示根据实际岗位库返回 ${jobs.length} 个候选：\n${jobs.slice(0, 5).map((j: any) => `• ${j.company} · ${j.title} · ${j.city || '城市待确认'}，规则匹配 ${j.match?.score ?? 0} 分${j.demo ? '（虚构演示）' : ''}`).join('\n')}\n分数用于排序，不是录用概率。此模式不会理解任意请求；启用真实模型后可进行自然语言分析。`);
    },
  ];
}

port.on('message', ({ data }) => {
  if (data.kind === 'job-candidates') {
    if (Array.isArray(data.candidates) && data.candidates.length <= 6) lastJobCandidates = data.candidates
      .filter((job: any) => typeof job?.id === 'string' && typeof job.company === 'string' && typeof job.title === 'string' && typeof job.url === 'string')
      .map((job: JobResultCandidate) => ({ id: job.id, company: job.company, title: job.title, url: job.url }));
    return;
  }
  if (data.kind === 'tool-result') {
    const call = pending.get(data.id);
    if (call) { call.cleanup(); pending.delete(data.id); data.ok ? call.resolve(data.data) : call.reject(new Error(data.error)); }
    return;
  }
  if (data.kind !== 'request') return;
  void (async () => {
    try {
      let result: unknown;
      if (data.method === 'configure') result = await configure(data.args[0]);
      else if (data.method === 'status') result = status;
      else if (data.method === 'identify-form') result = await identifyForm(data.args[0]);
      else if (data.method === 'cancel') { cancelRequested = true; formController?.abort(); await runtime?.cancel(); await runDone; await formDone; result = null; }
      else if (data.method === 'run') {
        if (running) throw new Error('当前任务还在运行。');
        if (configuring) throw new Error('模型配置正在更新，请稍候。');
        if (formController) throw new Error('表单模型识别正在进行，请稍候。');
        running = true;
        cancelRequested = false;
        let finish!: () => void;
        runDone = new Promise<void>(done => { finish = done; });
        try {
          if (!runtime) await configure({ mode: 'demo', provider: '', modelId: '', apiKey: '' }, true);
          if (demoModel) demoModel.faux.setResponses(demoResponses(data.args[0]));
          const input = data.args[0];
          let workflow: RuntimeRunOptions['workflow'] = status.mode === 'live' ? createJobResultActionWorkflow(input, lastJobCandidates, hostTool) : undefined;
          if (!workflow && status.mode === 'live') {
            const search = jobSearchWorkflow(input, hostTool, {modelMatching:true});
            if (search) workflow = async context => {
              lastJobCandidates = [];
              const found = await search(context);
              if (found.status === 'completed') {
                const values = JSON.parse(found.context).jobs;
                if (Array.isArray(values)) lastJobCandidates = values.filter((job: any) => typeof job?.id === 'string'
                  && typeof job.company === 'string' && typeof job.title === 'string' && typeof job.url === 'string').slice(0, 6)
                  .map((job: JobResultCandidate) => ({ id: job.id, company: job.company, title: job.title, url: job.url }));
              }
              return found;
            };
          }
          result = await runtime!.run(input, { workflow });
        } finally { running = false; finish(); runDone = undefined; }
      } else if (data.method === 'shutdown') { cancelRequested = true; formController?.abort(); await runtime?.cancel(); await runDone; await formDone; await runtime?.close(); result = null; }
      else throw new Error('未知 Agent 命令。');
      send({ kind: 'result', id: data.id, ok: true, data: result });
    } catch (error) {
      send({ kind: 'result', id: data.id, ok: false, error: redact(error instanceof Error ? error.message : 'Agent 执行失败'), ...(error instanceof FormModelRequestError ? { formFailure: { name: 'FormModelRequestError', code: error.code, ...(Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! <= 599 ? { httpStatus: error.httpStatus } : {}) } } : {}) });
    }
  })();
});
send({ kind: 'ready' });
