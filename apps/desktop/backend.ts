import {smokeJobMatching} from './smoke-job-matching.js';
import {createDemoModel} from '../../packages/runtime/src/demo-model.js';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {hardGateMatching} from '../../packages/agent/src/job-matching.js';
import {JobMatchingService} from './job-matching-service.js';
import {matchJobsWithModel} from '../../packages/agent/src/job-matching.js';
import { smokeIdentity, ephemeralIdentityCryptor } from './smoke-identity.js';
import { PRODUCT_NAME, LEGACY_APP_DATA_NAME } from '../../packages/shared/src/brand.js';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { TelemetryStore } from '../../packages/telemetry/src/store.js';
import { TelemetryHost } from './telemetry-host.js';
import { buildApplyDockImport } from '../../packages/profile/src/applydock.js';
import { createApplicationServices } from './application-services.js';
import { resolveApplicationWorkflowTarget } from '../../packages/domain/src/application-workflow.js';
import { buildFillPlan } from '../../packages/forms/src/index.js';
import { answerBankFieldAllowed, enrichWithConfirmedAnswers, assertPreparedAnswersCurrent, type PreparedAnswerBinding } from '../../packages/forms/src/answer-bank.js';
import type { FormModelResponse } from '../../packages/agent/src/form-model.js';
import { createStore, type DomainStore } from '../../packages/domain/src/index.js';
import { SensitiveIdentityVault } from '../../packages/domain/src/sensitive-identity.js';
import { SensitiveIdentityHost } from './sensitive-identity-host.js';
import { BrowserController } from '../../packages/browser/src/controller.js';
import { SOURCES, collectTencentJobs, attributeBrowserJobs } from '../../packages/sources/src/catalog.js';
import { persistSourceCollection } from '../../packages/sources/src/persist.js';
import { collectionOptions } from '../../packages/shared/src/source-collection.js';
import { readResume } from '../../packages/profile/src/import.js';
import { getProfileSummary } from '../../packages/agent/src/profile-summary.js';
import { createSmokeModelServer } from './smoke-model.js';
import { smokeStructuredCareer } from './smoke-career.js';
import { smokeSourceCollection } from './smoke-collection.js';
import { smokePendingStatus } from './smoke-pending-status.js';
import { smokeUINavigation } from './smoke-ui-navigation.js';
import { smokeChatUI } from './smoke-chat-ui.js';
import { smokeFocusedFlow } from './smoke-focused-flow.js';
import { smokeCustomCombobox } from './smoke-custom-combobox.js';
import { smokeFeishuCareer } from './smoke-feishu-career.js';
import { smokeCareerFillPanel } from './smoke-career-panel.js';
import { smokeTelemetry } from './smoke-telemetry.js';
import { smokeWorkspace } from './smoke-workspace.js';
import { smokeApplicationServices } from './smoke-application-services.js';
import { smokeApplicationProfile } from './smoke-application-profile.js';
import { smokePixelConsole } from './smoke-pixel-console.js';
import { smokeOnboarding } from './smoke-onboarding.js';
import { BackgroundQueueHost } from './background-queue.js';
import { ApplicationQueueTray } from './application-tray.js';
import { smokeCompanionQueue } from './smoke-companion-queue.js';
import { runBackgroundQueueDOMCheck } from './background-queue-check.js';
import { checkBackgroundQueueHost } from './background-host-check.js';
import { smokeSpeedster } from './smoke-speedster.js';
import { smokeFieldCompanion } from './smoke-field-companion.js';
import { runLiveProductCheck } from './live-product-check.js';
import {installRealSiteQA} from './real-site-qa.js';
import {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import {READ_FORM} from '../../packages/browser/src/read-scripts.js';
import {runRealSiteBatch} from './real-site-batch.js';
import {runBackgroundAgentBenchmark} from './background-agent-benchmark.js';
import { queryJobs, queryDiscoveryJobs, getJobDetails } from '../../packages/agent/src/job-query.js';
import { buildApplicationAgenda } from '../../packages/domain/src/agenda.js';
import { compareJobs } from '../../packages/agent/src/job-comparison.js';
import { loadCareerSkill } from '../../packages/agent/src/skills.js';
import { validateDomainToolArguments } from '../../packages/agent/src/tools.js';
import { recognizeModelForm, type ModelFormResult } from '../../packages/forms/src/model-recognition.js';
import type {
  AppEvent, AppState, ModelStatus, OfferAPI, JobInput, SourceDefinition, ActionRecord, ProfileInput, SourceCollectionOptions, PageCollectionOptions, SourceCollectionResult,
  FillPlan, CareerFillPreview, ApplicationWorkflowTarget,
} from '../../packages/shared/src/contracts.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const smoke = process.argv.includes('--smoke-test');
const smokeSubmodes = ['--smoke-job-matching-only', '--smoke-identity-only', '--smoke-field-companion-only', '--smoke-speedster-only', '--smoke-assistant-only', '--smoke-background-only', '--smoke-onboarding-only', '--smoke-feishu-only', '--smoke-career-ui-only', '--smoke-career-suite', '--smoke-native-pointer-only', '--smoke-telemetry-only', '--smoke-workspace-only', '--smoke-workflow-only', '--smoke-profile-only', '--smoke-pixel-only'];
const enabledSmokeSubmodes = smokeSubmodes.filter(flag => process.argv.includes(flag));
if (!smoke && enabledSmokeSubmodes.length) throw new Error('验收子模式必须同时指定隔离 smoke。');
if (enabledSmokeSubmodes.length > 1) throw new Error('一次只能选择一个隔离 smoke 子模式。');
const smokeWorkspaceOnly = enabledSmokeSubmodes.includes('--smoke-workspace-only');
const smokeTelemetryOnly = enabledSmokeSubmodes.includes('--smoke-telemetry-only');
const smokeNativePointerOnly = enabledSmokeSubmodes.includes('--smoke-native-pointer-only');
const liveProductCheck = process.argv.includes('--live-product-check');
const realSiteQA = process.argv.includes('--real-site-qa');
const backgroundAgentBenchmark=process.argv.includes('--background-agent-benchmark');
if(backgroundAgentBenchmark&&!realSiteQA)throw Error('ISOLATED_REAL_SITE_QA_REQUIRED');
if (realSiteQA && (smoke || liveProductCheck)) throw new Error('完整应用真实测评不能与样表或旧有界验收混用。');
// Read the dedicated test key before spawning any utility process, then remove
// the inherited environment entry. The key is never part of renderer state.
let liveProductKey = liveProductCheck ? process.env.OFFERAGENT_LIVE_FORM_API_KEY ?? '' : '';
if (liveProductCheck) delete process.env.OFFERAGENT_LIVE_FORM_API_KEY;
if (smoke && liveProductCheck) throw new Error('隔离样表与真实页面验收必须分别运行。');
// Preview packages can run alongside the main app without sharing career records,
// model credentials or browser cookies.
const uiPreview = /-ui\.\d+$/.test(app.getVersion());
const pixelPreview = /-pixel\.\d+$/.test(app.getVersion());
app.setName(realSiteQA ? `${PRODUCT_NAME} QA` : pixelPreview ? `${PRODUCT_NAME} Pixel Preview` : uiPreview ? `${PRODUCT_NAME} UI Preview` : PRODUCT_NAME);
const testBase = process.env.OFFERAGENT_TEST_DATA_DIR || join(projectRoot, 'runtime-home/desktop-smoke');
if (smoke || liveProductCheck || realSiteQA) await mkdir(testBase, { recursive: true, mode: 0o700 });
const stateDirectory = smoke || liveProductCheck || realSiteQA ? await mkdtemp(join(testBase, realSiteQA ? 'real-site-qa-' : liveProductCheck ? 'live-product-' : 'run-'))
  : pixelPreview ? join(app.getPath('appData'), 'OfferAgent Pixel Preview')
  : uiPreview ? join(app.getPath('appData'), 'OfferAgent UI Preview')
  : app.isPackaged ? join(app.getPath('appData'), LEGACY_APP_DATA_NAME) : join(projectRoot, 'runtime-home/desktop');
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
app.setPath('userData', stateDirectory);
app.setPath('sessionData', join(stateDirectory, 'browser-session'));
await mkdir(app.getPath('sessionData'), { recursive: true, mode: 0o700 });

let window: BrowserWindow;
let browser: BrowserController;
let identityHost: SensitiveIdentityHost;
let backgroundQueue: BackgroundQueueHost;
let queueTray: ApplicationQueueTray | undefined;
let store: DomainStore;
let telemetry: TelemetryHost;
let agent: AgentBridge;
let backgroundModelProvider:BackgroundModelProvider|undefined;
let jobMatching:JobMatchingService|undefined;
let modelConfigurationActive=false;
let shuttingDown = false;
let cleanupTask: Promise<void> | undefined;
let applicationServices: ReturnType<typeof createApplicationServices> | undefined;
let desktopMethods: Record<string, (...args: any[]) => Promise<any>> | undefined;
let realSiteQAObserver:Awaited<ReturnType<typeof installRealSiteQA>>|undefined;
let formExecutionActive = false;
let selectedWorkflowTarget: Pick<ApplicationWorkflowTarget, 'url' | 'applicationId' | 'jobId'> | undefined;
const attemptedOrdinaryPlans = new Set<string>();
const ordinaryWorkflowPlans = new Map<string, { target: ApplicationWorkflowTarget; plan: FillPlan; answers: PreparedAnswerBinding[] }>();
const careerWorkflowPlans = new Map<string, { target: ApplicationWorkflowTarget; preview: CareerFillPreview }>();
const uiPath = join(projectRoot, 'dist/renderer/index.html');
const uiURL = pathToFileURL(uiPath).href;
const send = (event: AppEvent) => { if (window && !window.isDestroyed()) window.webContents.send('offer:event', event); };
const publishState = (state: AppState) => { send({ type: 'state', state }); return state; };

let collectionActive = false;
let formPreparationActive = false;
let formPreparationCancelled = false;
function assertNoCollection(): void {
  if(modelConfigurationActive)throw Error('模型配置正在更新，请稍候。');
  if (collectionActive) throw new Error('官网采集正在进行，请等待范围报告后再导航、识别或填写。');
  if (formPreparationActive) throw new Error('表单识别正在进行，请等待结果后再导航、采集或填写。');
  if (formExecutionActive) throw new Error('正在填写并核实网页，请等待本轮结束。');
}
function assertApplicationIdle(): void {
  assertNoCollection();
  if(jobMatching?.isRunning())throw Error('岗位匹配正在使用这版资料，请先等待或停止匹配。');
  if (backgroundQueue && (backgroundQueue.hasPendingMutation() || ['running', 'paused'].includes(backgroundQueue.state().status))) throw new Error('后台队列正在使用这版资料，请先取消剩余任务再修改或确认资料。');
  if (formExecutionActive) throw new Error('正在填写网页，请等待核实结果后再修改资料或材料。');
}
async function publishWorkflow(): Promise<void> { send({ type: 'application-workflow', state: await store.workflow.workflowState() }); }
async function workflowTarget(url: string): Promise<ApplicationWorkflowTarget | undefined> {
  try {
    const choice = selectedWorkflowTarget?.url === url ? selectedWorkflowTarget : undefined;
    return resolveApplicationWorkflowTarget(await store.getState(), url, choice ? { applicationId: choice.applicationId, jobId: choice.jobId } : {});
  }
  catch { send({ type: 'error', message: '当前页面没有唯一的申请关联，填写进度暂未绑定；请在申请记录中核对网址。' }); return undefined; }
}
async function withCollection<T>(work: () => Promise<T>): Promise<T> {
  assertNoCollection(); collectionActive = true;
  try { return await work(); } finally { collectionActive = false; }
}

async function refreshSource(sourceId: string, keyword = '', options: SourceCollectionOptions = {}, signal?: AbortSignal): Promise<AppState> {
  const source = SOURCES.find(item => item.id === sourceId);
  if (!source) throw new Error('未知招聘来源。');
  if (typeof keyword !== 'string' || keyword.length > 200) throw new TypeError('关键词必须是最多200字的文本。');
  const budget = collectionOptions(options);
  return withCollection(async () => {
    let result: SourceCollectionResult;
    try {
      signal?.throwIfAborted();
      if (source.mode === 'public-api') result = await collectTencentJobs({ ...budget, keyword, signal });
      else {
        send({ type: 'navigate', page: 'browser' });
        const target = new URL(source.url);
        if (source.id === 'bytedance-campus' && keyword.trim()) target.searchParams.set('keywords', keyword.trim());
        await browser.navigate(target.href);
        result = await browser.collectSourceJobs({ sourceId, ...budget, keyword, signal });
      }
    } catch (error) {
      const aborted = signal?.aborted || error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message.slice(0, 1200) : '采集失败。';
      result = { jobs: [], report: { schemaVersion: 1, status: 'failed', query: { keyword: keyword.trim(), maxPages: budget.maxPages ?? 3, pageSize: source.mode === 'public-api' ? budget.pageSize ?? 20 : null, detailLimit: budget.detailLimit ?? 10 }, scope: { mode: source.mode === 'public-api' ? 'official-api-pages' : 'browser-list-pages', listURL: source.url, description: '采集未能开始，没有取得列表覆盖证据。' }, pagesRequested: 0, pagesSucceeded: 0, officialTotal: null, listedCount: 0, detailRequested: 0, detailSucceeded: 0, detailFailed: 0, detailResults: [], stopReason: aborted ? 'aborted' : 'request-failed', errors: [{ stage: 'list', code: aborted ? 'ABORTED' : 'START_FAILED', message }] } };
    }
    const state = publishState(await persistSourceCollection(store, result, source));
    signal?.throwIfAborted();
    return state;
  });
}

async function collectPageJobs(options: PageCollectionOptions = {}): Promise<AppState> {
  const budget = collectionOptions(options, true) as PageCollectionOptions;
  return withCollection(async () => {
    const pageURL = browser.getState().url, origin = new URL(pageURL).origin;
    if (!/^https?:/.test(pageURL)) throw new Error('请在招聘网页上采集，当前地址不是普通网页。');
    const known = SOURCES.find(item => item.mode === 'browser' && new URL(item.url).origin === origin);
    if (budget.scope === 'bounded-list') {
      if (!known) throw new Error('这个网站尚未接入受控分页；仍可采集当前页或手动保存详情。');
      return publishState(await persistSourceCollection(store, await browser.collectSourceJobs({ ...budget, sourceId: known.id }), known));
    }
    const result: SourceCollectionResult = { jobs: [], report: { schemaVersion: 1, status: 'success', query: { keyword: '', maxPages: 1, pageSize: null, detailLimit: 0 }, scope: { mode: 'visible-page', listURL: pageURL, description: '仅当前页面已显示的同源 AI / 大模型 / 算法职位链接；未翻页、未读取详情，也没有证明全列表覆盖。' }, pagesRequested: 1, pagesSucceeded: 1, officialTotal: null, listedCount: 0, detailRequested: 0, detailSucceeded: 0, detailFailed: 0, detailResults: [], stopReason: 'current-page', errors: [] } };
    try {
      result.jobs = attributeBrowserJobs((await browser.collectVisibleJobs()).filter(job => new URL(job.url).origin === origin), pageURL);
      result.report.listedCount = result.jobs.length;
    } catch (error) {
      result.report.status = 'failed'; result.report.pagesSucceeded = 0; result.report.stopReason = 'request-failed';
      result.report.errors.push({ stage: 'list', code: 'PAGE_READ_FAILED', message: error instanceof Error ? error.message.slice(0, 1200) : '当前页面采集失败。' });
    }
    return publishState(await persistSourceCollection(store, result, known ?? { id: `browser:${new URL(pageURL).hostname}`, name: browser.getState().title.slice(0, 250) || new URL(pageURL).hostname }));
  });
}

async function handleAgentTool(name: string, args: any, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  validateDomainToolArguments(name, args);
  const state = await store.getState();
  signal.throwIfAborted();
  switch (name) {
    case 'get_profile_summary': {
      return getProfileSummary(state.profile);
    }
    case 'query_jobs': return queryJobs(state, args);
    case 'get_job_details': return getJobDetails(state, args.jobId);
    case 'get_task_guide': return loadCareerSkill(projectRoot, args.skillId);
    case 'get_application_agenda': return buildApplicationAgenda(state, args);
    case 'compare_jobs': return compareJobs(state, args);
    case 'refresh_jobs': {
      if (args.sourceId === 'profile-discovery') {
        if (!applicationServices) throw new Error('岗位发现尚未准备好。');
        const cancel = () => { void applicationServices?.methods.cancelDiscovery!(); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await applicationServices.methods.discoverJobs!({ region: args.region, maxPages: args.maxPages, pageSize: args.pageSize, detailLimit: args.detailLimit });
          signal.throwIfAborted();
          const updated = await store.getState();
          return { ...queryDiscoveryJobs(updated, result.report),
            sourceRun: { id: result.report.id, sourceId: 'profile-discovery', sourceName: '按确认资料搜索已接入官网', status: result.report.status === 'success' ? 'success' : result.report.status === 'failed' ? 'failed' : 'partial', count: result.jobs.length, observedAt: result.report.finishedAt },
            discovery: { status: result.report.status, coverage: 'configured-official-sources', sourcesAttempted: result.report.sources.filter((item: { status: string }) => item.status !== 'skipped').length, unviewedSources: result.report.unviewedSources.length, completeDetails: result.report.completeDetails, scopeNote: result.report.scopeNote } };
        } finally { signal.removeEventListener('abort', cancel); }
      }
      if (typeof args.sourceId !== 'string') throw new Error('请指定招聘来源。');
      const updated = await refreshSource(args.sourceId, args.keyword ?? '', { maxPages: args.maxPages, pageSize: args.pageSize, detailLimit: args.detailLimit }, signal);
      const scoped = { ...updated, jobs: updated.jobs.filter(job => job.sourceId === args.sourceId) };
      return { ...queryJobs(scoped, {}), sourceRun: updated.sourceRuns.find(run => run.sourceId === args.sourceId) };
    }
    case 'list_applications': return { applications: state.applications.map(item => ({ id: item.id, company: item.company, title: item.title, status: item.status, deadline: item.deadline })) };
    case 'add_to_tracker': {
      if (typeof args.jobId !== 'string') throw new Error('请指定岗位 ID。');
      signal.throwIfAborted();
      const updated = await store.trackJob(args.jobId);
      publishState(updated);
      return { jobId: args.jobId, status: updated.applications.find(item => item.jobId === args.jobId)?.status };
    }
    case 'open_job': {
      assertNoCollection();
      const job = state.jobs.find(item => item.id === args.jobId);
      if (!job) throw new Error('岗位不存在。');
      const linked = state.applications.filter(item => item.jobId === job.id);
      selectedWorkflowTarget = { url: job.url, jobId: job.id, ...(linked.length === 1 ? { applicationId: linked[0]!.id } : {}) };
      send({ type: 'navigate', page: 'browser' });
      return browser.navigate(job.url);
    }
    case 'prepare_form_preview': {
      assertNoCollection();
      send({ type: 'navigate', page: 'browser' });
      if (!desktopMethods) throw new Error('填写服务尚未准备好。');
      const plan = await desktopMethods.prepareFill!() as FillPlan;
      send({ type: 'form-preview', plan });
      // Values and contact details stay in the local browser preview.
      return { planId: plan.id, url: plan.url, readyFields: plan.items.filter(item => item.status === 'ready').map(item => item.label), keptFields: plan.items.filter(item => item.status === 'skip').map(item => item.label), unresolved: plan.items.filter(item => item.status === 'review').map(item => ({ label: item.label, reason: item.reason })), previewOnly: true, next: '本次填写预览已显示在浏览器侧栏，请用户核对并选择字段后确认填写；最终提交由用户完成。' };
    }
    default: throw new Error('Agent 没有此项操作能力。');
  }
}

class AgentBridge {
  private process: UtilityProcess;
  private ready: Promise<void>;
  private requests = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private tools = new Map<string, AbortController>();
  private model: ModelStatus = { mode: 'demo', provider: 'offeragent-demo', modelId: 'offline-fixture', configured: true };
  private disposed = false;
  private closeTask?: Promise<void>;
  constructor() {
    this.process = utilityProcess.fork(join(projectRoot, 'dist/desktop/agent-worker.js'), [], {
      serviceName: `${PRODUCT_NAME} Agent`, stdio: 'pipe', env: { ...process.env, OFFERAGENT_STATE_DIR: stateDirectory },
    });
    this.ready = new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Agent 内核启动超时。')), 20_000);
      this.process.on('message', data => {
        if (data.kind === 'ready') { clearTimeout(timeout); resolveReady(); }
      });
      this.process.once('exit', () => { clearTimeout(timeout); reject(new Error('Agent 内核未能启动。')); });
    });
    void this.ready.catch(error => send({ type: 'error', message: error instanceof Error ? error.message : 'Agent 启动失败。' }));
    this.process.on('message', data => {
      if (data.kind === 'event') send({ type: 'agent', event: data.event });
      else if (data.kind === 'model') { this.model = data.status; send({ type: 'model', status: this.model }); }
      else if (data.kind === 'result') {
        const request = this.requests.get(data.id);
        if (request) {
          clearTimeout(request.timer); this.requests.delete(data.id);
          if (data.ok) request.resolve(data.data);
          else {
            const failure = data.formFailure;
            if (failure?.name === 'FormModelRequestError'
              && ['invalid-input', 'cancelled', 'timeout', 'provider', 'incomplete'].includes(failure.code)) {
              const httpStatus = Number.isInteger(failure.httpStatus) && failure.httpStatus >= 100 && failure.httpStatus <= 599
                ? failure.httpStatus as number : undefined;
              // Only fixed text and an allowlisted diagnostic cross this boundary.
              request.reject(Object.assign(new Error('表单模型识别未完成。'), {
                name: 'FormModelRequestError', code: failure.code,
                ...(httpStatus !== undefined ? { httpStatus } : {}),
              }));
            } else request.reject(new Error(data.error));
          }
        }
      } else if (data.kind === 'tool') {
        const controller = new AbortController();
        this.tools.set(data.id, controller);
        void handleAgentTool(data.name, data.args, controller.signal).then(
          value => { if (!this.disposed) this.process.postMessage({ kind: 'tool-result', id: data.id, ok: true, data: value }); },
          error => { if (!this.disposed) this.process.postMessage({ kind: 'tool-result', id: data.id, ok: false, error: error instanceof Error ? error.message : '工具失败' }); },
        ).finally(() => this.tools.delete(data.id));
      } else if(data.kind==='matching-request'){
        const controller=new AbortController();this.tools.set(data.id,controller);
        void (async()=>{assertApplicationIdle();if(!jobMatching)throw Error('岗位匹配尚未准备好。');const result=await jobMatching.run(data.args,controller.signal);await this.syncMatchingCandidates();const state=await store.getState();return {...result,jobs:result.ranking.map(id=>state.jobs.find(j=>j.id===id)).filter(Boolean)};})().then(
          value=>{if(!this.disposed)this.process.postMessage({kind:'tool-result',id:data.id,ok:true,data:value});},
          ()=>{if(!this.disposed)this.process.postMessage({kind:'tool-result',id:data.id,ok:false,error:'模型岗位匹配未完成，原规则候选仍可查看。'});}
        ).finally(()=>this.tools.delete(data.id));
      } else if (data.kind === 'tool-cancel') this.tools.get(data.id)?.abort();
    });
    this.process.on('exit', code => {
      this.disposed = true;
      for (const controller of this.tools.values()) controller.abort();
      for (const call of this.requests.values()) { clearTimeout(call.timer); call.reject(new Error(`Agent 内核已退出 (${code})`)); }
      this.requests.clear();
    });
  }
  getStatus(): ModelStatus { return this.model; }
  async syncJobCandidates(state: AppState, report: import('../../packages/shared/src/discovery.js').DiscoveryReport): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    const candidates = queryDiscoveryJobs(state, report).jobs.slice(0, 6)
      .map(job => ({ id: job.id, company: job.company, title: job.title, url: job.url }));
    this.process.postMessage({ kind: 'job-candidates', candidates });
  }
  async syncMatchingCandidates():Promise<void>{
    if(!jobMatching)return;const result=await jobMatching.state();if(result.status!=='completed')return;
    const state=await store.getState();if(state.profile.version!==result.profileVersion)return;
    const candidates=result.ranking.map(id=>state.jobs.find(j=>j.id===id)).filter((j):j is AppState['jobs'][number]=>!!j).map(j=>({id:j.id,company:j.company,title:j.title,url:j.url}));
    this.process.postMessage({kind:'job-candidates',candidates});
  }
  async request(method: string, ...args: unknown[]): Promise<any> {
    if (this.disposed) throw new Error('Agent 内核已退出，请重启应用。');
    await this.ready;
    return new Promise((resolveCall, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.requests.delete(id);
        if (method === 'run') {
          for (const controller of this.tools.values()) controller.abort();
          void this.request('cancel').then(
            () => reject(new Error('Agent 请求超时，已停止当前任务，请重试。')),
            () => reject(new Error('Agent 请求超时，取消尚未确认；请重启应用后再运行。')),
          );
        } else reject(new Error('Agent 请求超时，请停止当前任务后重试。'));
      }, method === 'run' ? 180_000 : 30_000);
      this.requests.set(id, { resolve: resolveCall, reject, timer });
      this.process.postMessage({ kind: 'request', id, method, args });
    });
  }
  async close(): Promise<void> {
    this.closeTask ??= (async () => {
      for (const controller of this.tools.values()) controller.abort();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.request('shutdown'), new Promise<void>(done => { timeout = setTimeout(done, 5_000); })]);
      } catch { /* process may already have exited */ }
      finally { clearTimeout(timeout); if (!this.disposed) this.process.kill(); }
    })();
    return this.closeTask;
  }
}

async function createApp(): Promise<void> {
  store = await createStore({ directory: join(stateDirectory, 'data') });
  telemetry = new TelemetryHost(await TelemetryStore.create(join(stateDirectory, 'telemetry')).catch(() => TelemetryStore.volatile()),
    async () => ({ url: browser?.getState().url ?? '', version: (await store.getState()).profile.version }),
    state => send({ type: 'telemetry', state }), smoke);
  window = new BrowserWindow({
    title: `${PRODUCT_NAME} v${app.getVersion()} · ${realSiteQA ? '真实官网全流程测评 · 虚构资料 · 禁止提交' : smoke ? '隔离验收（虚构资料）' : '你的求职工作台'}`, width: 1480, height: 980, minWidth: 1080, minHeight: 720,
    show: !smoke&&!backgroundAgentBenchmark, backgroundColor: '#11141b',
    // Hidden/occluded smoke renderers still need to service read-only frame
    // waits. Native actions retain their real foreground checks. Ordinary and
    // real-site runs keep Electron's normal background throttling behavior.
    webPreferences: { preload: join(projectRoot, 'apps/desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: !smoke },
  });
  window.on('page-title-updated', event => event.preventDefault());
  browser = new BrowserController({ window, onState: state => send({ type: 'browser', state }), getProfile: async () => (await store.getState()).profile,
    enableFieldCompanion: true, fillRetryLimit: 2, onRetry: event => send({ type: 'form-retry', ...event }), testFormPath: join(projectRoot, 'apps/desktop/fixtures/application.html') });
  // Smoke runs never touch the system keychain. Identity crypto is exercised with an injected test codec separately.
  const identityVault = new SensitiveIdentityVault(join(stateDirectory, 'sensitive'), smoke && enabledSmokeSubmodes.includes('--smoke-identity-only') ? ephemeralIdentityCryptor() : {
    available: () => !smoke && !liveProductCheck && !realSiteQA && safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())),
    encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
  });
  identityHost = new SensitiveIdentityHost(browser, identityVault);
  backgroundQueue = new BackgroundQueueHost({ store, qaAudit:realSiteQA,getModelProvider:()=>backgroundModelProvider,
    agentDirectory:join(stateDirectory,'background-agent'),getCurrentPage: () => ({ url: browser.getState().url }), onState: state => {
    send({ type: 'application-queue', state }); queueTray?.update(state);
  } });
  if (!smoke && !liveProductCheck&&!backgroundAgentBenchmark) {
    queueTray = new ApplicationQueueTray(join(projectRoot, 'apps/desktop/assets/icon.png'), window, () => { void backgroundQueue.cancel().catch(() => {}); });
    queueTray.update(backgroundQueue.state());
    window.on('close', event => {
      if (!shuttingDown && backgroundQueue.state().status === 'running') { event.preventDefault(); window.hide(); }
    });
  }
  agent = new AgentBridge();
  jobMatching=new JobMatchingService({getState:()=>store.getState(),onState:state=>send({type:'job-matching',state}),...(!smoke?{embed:(texts:readonly string[],signal?:AbortSignal)=>{if(!backgroundModelProvider)throw Error('JOB_EMBEDDING_NOT_CONFIGURED');return backgroundModelProvider.embedJobTexts(texts,signal);}}:{}),runModel:async(input,signal,id)=>{
    if(smoke&&enabledSmokeSubmodes.includes('--smoke-job-matching-only')){
      const demo=await createDemoModel(),id=hardGateMatching(input)[0];const raw={ranking:id?[id]:[]};
      demo.faux.setResponses([fauxAssistantMessage(JSON.stringify(raw))]);return matchJobsWithModel(demo.modelRuntime,demo.model,input,{signal,variant:'baseline-post-gate'});
    }
    const provider=backgroundModelProvider;if(!provider)throw Error('岗位模型匹配需要配置百炼北京qwen-flash。');
    return provider.withTask('job-match-'+id,()=>matchJobsWithModel(provider.runtime,provider.model,input,{signal,variant:'baseline-post-gate'}));
  }});
  applicationServices = createApplicationServices({ store, window, stateDirectory, send, publishState, assertIdle: assertApplicationIdle, withCollection,
    onDiscovery: (state, result) => agent.syncJobCandidates(state, result.report) });
  const previousDiscovery = (await store.discovery.getState()).runs[0];
  if (previousDiscovery) await agent.syncJobCandidates(await store.getState(), previousDiscovery);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== uiURL) event.preventDefault(); });
  const methods: Record<string, (...args: any[]) => Promise<any>> = {
    ...applicationServices.methods,
    sensitiveIdentityState: async () => { assertApplicationIdle(); return identityVault.status(); },
    saveSensitiveIdentity: async (input, version) => { assertApplicationIdle(); identityHost.invalidate(); formPreparationActive=true; try { return await identityVault.save(input, version); } finally { formPreparationActive=false; } },
    clearSensitiveIdentity: async version => { assertApplicationIdle(); identityHost.invalidate(); formPreparationActive=true; try { return await identityVault.clear(version); } finally { formPreparationActive=false; } },
    prepareSensitiveIdentityFill: async () => {
      assertApplicationIdle(); formPreparationActive = true;
      try { return await identityHost.prepare(); } finally { formPreparationActive = false; }
    },
    fillSensitiveIdentity: async id => {
      assertApplicationIdle(); formExecutionActive = true;
      try { return await identityHost.fill(id); } finally { formExecutionActive = false; }
    },
    cancelSensitiveIdentityFill: async id => { assertApplicationIdle(); identityHost.cancel(id); },
    queueState: async () => backgroundQueue.state(),
    enqueueApplications: async input => { assertNoCollection(); return backgroundQueue.enqueue(input); },
    startApplicationQueue: async () => { assertNoCollection(); return backgroundQueue.start(); },
    cancelApplicationQueue: async () => backgroundQueue.cancel(),
    reviewQueuedApplication: async id => { if (typeof id !== 'string') throw new Error('请选择一份队列草稿。'); backgroundQueue.review(id); },
    closeQueuedApplication: async id => { if (typeof id !== 'string') throw new Error('请选择一份队列草稿。'); return backgroundQueue.close(id); },
    selectApplicationWorkflow: async id => {
      assertApplicationIdle();
      if (typeof id !== 'string') throw new Error('请选择明确的申请记录。');
      const workflow = (await store.workflow.workflowState()).workflows.find(item => item.id === id);
      if (!workflow) throw new Error('申请进度不存在，请重新读取。');
      const target = resolveApplicationWorkflowTarget(await store.getState(), workflow.target.url,
        { applicationId: workflow.target.applicationId, jobId: workflow.target.jobId });
      selectedWorkflowTarget = target;
    },
    getState: () => store.getState(),
    saveProfile: async (value, version) => { assertApplicationIdle(); return publishState(await store.saveProfile(value, version)); },
    confirmCareerRecord: async (collection, id, version, revision) => { assertApplicationIdle(); return publishState(await store.confirmCareerRecord(collection, id, version, revision)); },
    saveJob: async value => { assertApplicationIdle(); return publishState(await store.saveJob(value)); },
    deleteJob: async id => { assertApplicationIdle(); return publishState(await store.deleteJob(id)); },
    saveApplication: async value => { assertApplicationIdle(); return publishState(await store.saveApplication(value)); },
    trackJob: async id => { assertApplicationIdle(); return publishState(await store.trackJob(id)); },
    deleteApplication: async id => { assertApplicationIdle(); return publishState(await store.deleteApplication(id)); },
    loadDemo: async () => { assertApplicationIdle(); return publishState(await store.loadDemo()); },
    clearDemo: async () => { assertApplicationIdle(); return publishState(await store.clearDemo()); },
    telemetryState: async () => telemetry.state(),
    beginMeasurement: async input => telemetry.begin(input),
    finishMeasurement: async input => {
      if (formExecutionActive) throw new Error('网页填写尚未结束，不能提前结束本轮记录。');
      const result = await telemetry.finish(input);
      for (const record of [...ordinaryWorkflowPlans.values(), ...careerWorkflowPlans.values()]) {
        if (record.target.url === browser.getState().url && !formExecutionActive) await store.workflow.finishWorkflow(record.target).catch(() => {});
      }
      ordinaryWorkflowPlans.clear(); careerWorkflowPlans.clear(); await publishWorkflow(); return result;
    },
    reviewMeasurement: async input => telemetry.review(input),
    exportTelemetry: async () => {
      const choice = await dialog.showSaveDialog(window, { title: '导出 OpenTelemetry 执行轨迹（无资料值）', defaultPath: 'offeragent-otlp.json', filters: [{ name: 'OTLP JSON', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      await writeFile(choice.filePath, JSON.stringify(telemetry.store.jsonOTLP(), null, 2), { mode: 0o600 });
      return { cancelled: false, path: choice.filePath };
    },
    importApplyDock: async () => {
      assertApplicationIdle();
      const before = (await store.getState()).profile;
      const choice = await dialog.showOpenDialog(window, { title: '导入 ApplyDock 资料（保留已有内容）',
        defaultPath: join(app.getPath('appData'), 'ApplyDock', 'archive.json'), properties: ['openFile'], filters: [{ name: 'ApplyDock JSON', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      const selected = choice.filePaths[0];
      if ((await stat(selected)).size > 2_000_000) throw new Error('资料文件过大，请选择 2MB 以内的 ApplyDock JSON。');
      const imported = buildApplyDockImport(await readFile(selected), before);
      assertApplicationIdle();
      const next = await store.saveProfile(imported.profile, before.version);
      publishState(next);
      return { cancelled: false, state: next, addedFields: imported.changes.filter(change => change.field !== 'career.sources').length, conflictCount: imported.conflicts.length, warnings: imported.warnings };
    },
    importResume: async () => {
      const choice = await dialog.showOpenDialog(window, { title: '导入简历（提取后请核对）', properties: ['openFile'], filters: [{ name: '简历', extensions: ['pdf', 'docx', 'txt', 'md'] }] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      return readResume(choice.filePaths[0]);
    },
    exportData: async () => {
      const choice = await dialog.showSaveDialog(window, { title: '导出个人求职资料', defaultPath: 'offeragent-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return { cancelled: true };
      await writeFile(choice.filePath, JSON.stringify(await store.exportState(), null, 2), { mode: 0o600 });
      return { cancelled: false, path: choice.filePath };
    },
    getSources: async () => SOURCES,
    refreshSource: (id, keyword, options) => refreshSource(id, keyword, options),
    browserNavigate: url => { assertNoCollection(); selectedWorkflowTarget = undefined; return browser.navigate(url); }, browserBack: () => { assertNoCollection(); selectedWorkflowTarget = undefined; return browser.back(); },
    browserForward: () => { assertNoCollection(); selectedWorkflowTarget = undefined; return browser.forward(); }, browserReload: () => { assertNoCollection(); selectedWorkflowTarget = undefined; return browser.reload(); },
    browserZoom: async percent => { assertNoCollection(); return browser.setZoom(percent); },
    locateApplicationField: async input => {
      assertNoCollection(); formPreparationActive = true;
      try { return await browser.locateApplicationField(input); }
      finally { formPreparationActive = false; }
    },
    locateWorkflowIssue: async input => {
      assertApplicationIdle();
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2
        ||!['workflowId','issueId'].every(key=>typeof input[key]==='string'&&input[key].length>0&&input[key].length<=300))throw new Error('请选择一个明确的待处理项。');
      formPreparationActive=true;
      try{
        const {workflows}=await store.workflow.workflowState(),workflow=workflows.find(item=>item.id===input.workflowId);
        const issue=workflow?.issues.find(item=>item.id===input.issueId&&item.status==='open');
        if(!workflow||!issue||workflow.target.url!==browser.getState().url)return {status:'stale',message:'请回到这个申请页，重新读取提示后再定位。'};
        return await browser.locateWorkflowIssue(issue,workflow.target.url,workflow.target.profileVersion);
      }finally{formPreparationActive=false;}
    },
    refreshApplicationAttention: async () => {
      assertApplicationIdle();formPreparationActive=true;
      ordinaryWorkflowPlans.clear();careerWorkflowPlans.clear();attemptedOrdinaryPlans.clear();
      try{
        const observed=await browser.readAttention(),target=await workflowTarget(observed.url);
        if(!target||target.profileVersion!==observed.profileVersion)throw new Error('页面或资料发生变化，请重新读取。');
        await store.workflow.reconcileReadOnly(target,{ordinary:observed.ordinary,...(observed.career?{career:observed.career}:{})});
        const state=await store.workflow.workflowState();send({type:'application-workflow',state});return state;
      }finally{formPreparationActive=false;}
    },
    setFieldCompanionMotion: input => browser.setFieldCompanionMotion(input),
    browserBounds: async (bounds, visible) => { browser.resize(bounds); browser.setVisible(visible === true); },
    browserState: async () => browser.getState(), capturePage: () => { assertNoCollection(); return browser.capturePage(); },
    collectPageJobs,
    prepareFill: async (options?: { useModel?: boolean; scope?: 'contacts' }) => {
      if (backgroundQueue.state().status === 'running') throw new Error('后台队列正在填写，请先取消剩余任务再使用前台填写。');
      assertNoCollection();
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => key !== 'useModel' && key !== 'scope')
        || options.useModel !== undefined && typeof options.useModel !== 'boolean'
        || options.scope !== undefined && options.scope !== 'contacts')) throw new Error('无效表单识别参数。');
      formPreparationActive = true;
      formPreparationCancelled = false;
      try {
        let preparedAnswers: PreparedAnswerBinding[] = [];
        const prepared = await browser.preparePlan(async (observation, profile) => {
          if (formPreparationCancelled) throw new Error('表单识别已停止，未继续自动填写。');
          let plan = options?.useModel ? await recognizeModelForm(observation, profile,
            agent.getStatus().mode === 'live' ? input => {
              if (formPreparationCancelled) throw new Error('表单识别已停止，未继续自动填写。');
              const model = agent.getStatus();
              return telemetry.step('model.request', async () => {
                try {
                  const response = await agent.request('identify-form', input) as FormModelResponse;
                  await telemetry.modelCall(response.usage, model.provider, model.modelId, smoke);
                  return response;
                } catch (error) {
                  await telemetry.modelCall(undefined, model.provider, model.modelId, smoke);
                  throw error;
                }
              });
            } : undefined) : buildFillPlan(observation, profile);
          if (formPreparationCancelled) throw new Error('表单识别已停止，未继续自动填写。');
          if (options?.scope === 'contacts') plan = { ...plan, items: plan.items.filter(item => item.profileKey && ['fullName', 'fullNameEn', 'email', 'phone'].includes(item.profileKey)) };
          const target = await workflowTarget(plan.url);
          if (!target?.applicationId) return plan;
          const suggestions = new Map(await Promise.all(observation.fields.filter(answerBankFieldAllowed).map(async field =>
            [field.id, await store.assets.answerSuggestions(field.label, target.applicationId!)] as const)));
          const enriched = enrichWithConfirmedAnswers(plan, observation, suggestions); preparedAnswers = enriched.bindings;
          return enriched.plan;
        });
        const target = await workflowTarget(prepared.url);
        ordinaryWorkflowPlans.clear(); attemptedOrdinaryPlans.clear();
        if (target) {
          await store.workflow.recordOrdinaryPlan(target, prepared);
          ordinaryWorkflowPlans.set(prepared.id, { target, plan: prepared, answers: preparedAnswers }); await publishWorkflow();
        }
        return prepared;
      } finally { formPreparationActive = false; }
    },
    fillApproved: async (planId, fieldIds) => {
      if (backgroundQueue.state().status === 'running') throw new Error('后台队列正在填写，请先取消剩余任务再使用前台填写。');
      assertNoCollection();
      if (formExecutionActive) throw new Error('另一轮填写尚未完成。');
      if (!Array.isArray(fieldIds) || !fieldIds.length || fieldIds.some(id => typeof id !== 'string')) throw new Error('请选择要确认填写的字段。');
      const plan = browser.getPlan(planId);
      if (!plan) throw new Error('填写预览已失效，请重新识别。');
      const progress = ordinaryWorkflowPlans.get(planId);
      if (attemptedOrdinaryPlans.has(planId)) throw new Error('本次填写计划已使用，请重新识别。');
      attemptedOrdinaryPlans.add(planId);
      const id = randomUUID(); let journaled = false, journalFinalized = false;
      // Acquire before the first await: asset edits cannot race the answer snapshot.
      formExecutionActive = true;
      try {
        if (progress?.answers.length) assertPreparedAnswersCurrent(progress.answers, (await store.assets.getState()).answers);
        await store.recordAction({ id, planId, status: 'intent', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: { url: plan.url, profileVersion: plan.profileVersion, fieldIds, selectedFields: plan.items.filter(item => fieldIds.includes(item.fieldId) && item.status === 'ready').map(item => ({ fieldId: item.fieldId, label: item.label, value: item.value })) } });
        journaled = true;
        if (progress) await store.workflow.startWorkflow(progress.target);
        const result = await browser.fillApproved(planId, fieldIds);
        await store.updateAction(id, result.unresolved.length ? 'partial' : 'verified', result);
        journalFinalized = true;
        if (progress) {
          try { await store.workflow.recordOrdinaryResult(progress.target, plan, result); await publishWorkflow(); }
          catch { send({ type: 'error', message: '网页填写结果已返回，但待处理进度未能保存，请核对网页后重新读取。' }); }
        }
        return result;
      } catch (error) {
        if (journaled && !journalFinalized) await store.updateAction(id, 'unknown', { message: error instanceof Error ? error.message : '填写结果待核实' }).catch(() => {});
        if (progress) { await store.workflow.interruptWorkflow(progress.target).catch(() => {}); await publishWorkflow(); }
        throw error;
      } finally { formExecutionActive = false; ordinaryWorkflowPlans.delete(planId); }
    },
    prepareCareerFill: async options => {
      if (backgroundQueue.state().status === 'running') throw new Error('后台队列正在填写，请先取消剩余任务再使用前台填写。');
      assertNoCollection();
      formPreparationActive = true;
      try {
        const preview = await browser.prepareCareerFill(options), target = await workflowTarget(preview.url);
        careerWorkflowPlans.clear();
        if (target) { await store.workflow.recordCareerPreview(target, preview); careerWorkflowPlans.set(preview.planId, { target, preview }); await publishWorkflow(); }
        return preview;
      }
      finally { formPreparationActive = false; }
    },
    runCareerFill: async planId => {
      if (backgroundQueue.state().status === 'running') throw new Error('后台队列正在填写，请先取消剩余任务再使用前台填写。');
      assertNoCollection();
      if (formExecutionActive) throw new Error('另一轮填写尚未完成。');
      formExecutionActive = true;
      const progress = careerWorkflowPlans.get(planId);
      const verifiedFields: Array<{ collection: import('../../packages/shared/src/career-form.js').CareerFillCollection; recordId: string; key: string }> = [];
      const actionSpans = new Map<string, ReturnType<TelemetryStore['startStep']>>();
      try {
        if (progress) await store.workflow.startWorkflow(progress.target);
        const result = await browser.runCareerFill(planId, async event => {
        if (event.phase === 'intent') {
          actionSpans.set(event.action.id, telemetry.store.startStep(event.action.kind === 'add' ? 'career.add' : 'career.fill', {
            'action.kind': event.action.kind, collection: event.action.collection, 'field.key': event.action.key }));
          const at = new Date().toISOString();
          await store.recordAction({ id: event.action.id, planId: event.action.planId, status: 'intent',
            createdAt: at, updatedAt: at, payload: { category: 'career-form', uiPlanId: planId, ...event.action } });
        } else if (event.phase === 'retry') {
          const labels: Record<string, string> = { school: '学校', degree: '学历', major: '专业', organization: '实习单位', role: '职位或项目角色', name: '项目名称', startDate: '开始时间', endDate: '结束时间', description: '经历描述', url: '项目链接' };
          send({ type: 'form-retry', kind: 'career', label: labels[event.action.key ?? ''] ?? '当前字段', attempt: event.attempt, maxAttempts: event.maxAttempts });
          await telemetry.store.startStep('career.retry', { 'action.kind': 'retry', 'field.key': event.action.key, attempt: event.attempt }).end(false);
        } else {
          if (event.status === 'verified' && event.action.kind === 'fill' && event.action.key) verifiedFields.push({ collection: event.action.collection, recordId: event.action.recordId, key: event.action.key });
          await store.updateAction(event.action.id, event.status, { kind: 'career-form',
            ...(event.reason ? { reason: event.reason } : {}), action: event.action });
          await actionSpans.get(event.action.id)?.end(event.status !== 'verified'); actionSpans.delete(event.action.id);
        }
      });
        if (progress) {
          try { await store.workflow.recordCareerOutcome(progress.target, progress.preview, result, verifiedFields); await publishWorkflow(); }
          catch { send({ type: 'error', message: '经历执行结果已返回，但待处理进度未能保存，请核对网页后重新读取。' }); }
        }
        return result;
      } catch (error) {
        if (progress) { await store.workflow.interruptWorkflow(progress.target).catch(() => {}); await publishWorkflow(); }
        throw error;
      } finally { formExecutionActive = false; careerWorkflowPlans.delete(planId); for (const span of actionSpans.values()) await span.end(true); }

    },
    cancelCareerFill: async () => { browser.cancelCareerFill(); telemetry.cancel(); },
    openTestForm: () => { assertNoCollection(); return browser.openTestForm(); },
    jobMatchingState:async()=>jobMatching!.state(),
    matchSavedJobs:async input=>{assertApplicationIdle();const result=await jobMatching!.run(input);await agent.syncMatchingCandidates();return result;},
    cancelJobMatching:async()=>jobMatching?.cancel(),
    modelStatus: async () => agent.getStatus(), configureModel: async config => {
      if(jobMatching?.isRunning())throw Error('请先停止岗位匹配再更换模型。');
      if (formPreparationActive) throw new Error('请等待表单识别完成后再更换模型。');
      if(backgroundQueue.hasPendingMutation())throw Error('请先停止后台队列再更换模型。');
      if(modelConfigurationActive)throw Error('模型配置正在更新，请稍候。');
      modelConfigurationActive=true;
      try{
      const status=await agent.request('configure', config);
      backgroundModelProvider?.close();backgroundModelProvider=undefined;
      if(config.mode==='live'&&config.modelId==='qwen-flash'&&config.baseURL==='https://dashscope.aliyuncs.com/compatible-mode/v1')backgroundModelProvider=await BackgroundModelProvider.create(config,2500);
      return status;
      }finally{modelConfigurationActive=false;}
    },
    runAgent: input => {
      if(jobMatching?.isRunning())throw Error('请先等待或停止岗位匹配，再开始聊天任务。');
      if (formPreparationActive) throw new Error('请等待表单识别完成后再运行聊天任务。');
      return agent.request('run', input);
    }, cancelAgent: async () => { await jobMatching?.cancel(); if (formPreparationActive) formPreparationCancelled = true; telemetry.cancel(); return agent.request('cancel'); },
  };
  // Observers receive counts and fixed action keys only. They never receive the
  // journal payload (which includes private values, record IDs and target URLs).
  const observedMethods = { prepareFill: 'form.recognize', fillApproved: 'form.fill', prepareCareerFill: 'career.prepare', runCareerFill: 'career.run' } as const;
  for (const [name, spanName] of Object.entries(observedMethods)) {
    const original = methods[name]!;
    methods[name] = async (...args) => telemetry.step(spanName, async () => {
      const result = await original(...args);
      if (name === 'fillApproved') await telemetry.counts(result.verified.length, result.unresolved.length);
      else if (name === 'runCareerFill') await telemetry.counts(result.verifiedCount, result.pending.length, result.addedCount, result.status === 'stopped');
      return result;
    });
  }
  desktopMethods = methods;
  if(realSiteQA) realSiteQAObserver=await installRealSiteQA({directory:join(stateDirectory,'qa-evidence'),
    session:browser.view.webContents.session,methods,
    observe:()=>browser.view.webContents.executeJavaScript(READ_FORM),telemetry:async()=>telemetry.store.jsonOTLP()});
  ipcMain.handle('offer:request', async (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('此页面没有应用权限。');
    if (!value || typeof value.method !== 'string' || !Object.hasOwn(methods, value.method) || !Array.isArray(value.args)) throw new Error('无效应用命令。');
    return methods[value.method]!(...value.args);
  });
  window.on('closed', () => { void cleanupApp(); });
  await window.loadFile(uiPath);
  if(backgroundAgentBenchmark){
    const benchFile=(name:string,fallback:string)=>{const value=process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);if(!value)return join(projectRoot,fallback);
      const path=resolve(value);if(!path.startsWith(join(projectRoot,'.backups')+'/'))throw Error('PRIVATE_QA_INPUT_REQUIRED');return path;};
    try{const report=await runBackgroundAgentBenchmark({directory:join(stateDirectory,'agent-benchmark'),resumePath:benchFile('agent-resume','qa-resume.txt'),casesPath:benchFile('agent-cases','qa-agent-cases.json'),baselineManifestPath:benchFile('agent-baseline','qa-agent-baseline.json'),
      limit:process.argv.some(a=>a.startsWith('--agent-bench-limit='))?Number(process.argv.find(a=>a.startsWith('--agent-bench-limit='))!.slice(20)):undefined,
      armIds:process.argv.find(a=>a.startsWith('--agent-bench-arms='))?.slice(19).split(','),
      methods,queue:backgroundQueue,getProvider:()=>backgroundModelProvider,notify:message=>{process.stdout.write(JSON.stringify({progress:message})+'\n');}});
      process.stdout.write(JSON.stringify({status:report.status,directory:join(stateDirectory,'agent-benchmark')})+'\n');
      await cleanupApp();app.exit(report.status==='completed'?0:1);
    }catch{await cleanupApp();process.stdout.write('BACKGROUND_AGENT_BENCHMARK_STOPPED\n');app.exit(1);}
    return;
  }
  if(realSiteQA&&process.argv.includes('--real-site-qa-batch')){
    send({type:'navigate',page:'apply'});
    void runRealSiteBatch({directory:join(stateDirectory,'batch-evidence'),resumePath:join(projectRoot,'qa-resume.txt'),replayPath:process.argv.includes('--real-site-qa-replay')?join(projectRoot,'qa-replay.json'):undefined,extendReplay:process.argv.includes('--real-site-qa-extend'),
      target:process.argv.some(s=>s.startsWith('--qa-target='))?Number(process.argv.find(s=>s.startsWith('--qa-target='))!.slice(12)):undefined,
      priorForms:process.argv.some(s=>s.startsWith('--qa-prior='))?Number(process.argv.find(s=>s.startsWith('--qa-prior='))!.slice(11)):undefined,methods,queue:backgroundQueue,
      notify:text=>{window.setTitle(`${PRODUCT_NAME} · ${text} · 虚构资料/禁止提交`);}}).catch(()=>{window.setTitle(`${PRODUCT_NAME} · 批量测评停止，请检查本地报告`);});
  }
  if (liveProductCheck) {
    let result: { ok: boolean; report: string };
    try {
      result = await runLiveProductCheck(window, browser, methods, send, stateDirectory, {
        url: process.argv.find(value => value.startsWith('--live-form-url='))?.slice('--live-form-url='.length) ?? '',
        apiKey: liveProductKey, modelId: 'qwen-flash', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
    } finally { liveProductKey = ''; }
    await cleanupApp();
    console.log(JSON.stringify(result));
    app.exit(result.ok ? 0 : 1);
    return;
  }
  if (smoke) await smokeTest(methods);
}

async function smokeTest(methods: Record<string, (...args: any[]) => Promise<any>>): Promise<void> {
  const assertions: Record<string, unknown> = {};
  try {
    if(enabledSmokeSubmodes.includes('--smoke-job-matching-only')){
      browser.setVisible(false);assertions.jobMatching=await smokeJobMatching(window,methods,send);
      await writeFile(join(stateDirectory,'smoke-report.json'),JSON.stringify({ok:true,focusedFixtureOnly:true,assertions},null,2));await cleanupApp();app.exit(0);return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-field-companion-only')) {
      browser.setVisible(false);assertions.fieldCompanion=await smokeFieldCompanion(stateDirectory);
      await writeFile(join(stateDirectory,'smoke-report.json'),JSON.stringify({ok:true,focusedFixtureOnly:true,assertions},null,2));
      await cleanupApp();app.exit(0);return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-speedster-only')) {
      browser.setVisible(false); assertions.speedster = await smokeSpeedster(window, methods, send, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-assistant-only')) {
      browser.setVisible(false);
      assertions.companionQueue = await smokeCompanionQueue(window, methods, send, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-background-only')) {
      browser.setVisible(false); assertions.backgroundDOM = await runBackgroundQueueDOMCheck();
      assertions.backgroundQueueHost = await checkBackgroundQueueHost(stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-onboarding-only')) {
      browser.setVisible(false);
      assertions.onboarding = await smokeOnboarding(window, methods, send, stateDirectory, store, projectRoot);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-pixel-only')) {
      browser.setVisible(false);
      assertions.pixelConsole = await smokePixelConsole(window, methods, send, stateDirectory);
      const pixelOK = (assertions.pixelConsole as { ok: boolean }).ok === true;
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: pixelOK, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(pixelOK ? 0 : 1); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-identity-only')) {
      browser.setVisible(false);
      assertions.identity = await smokeIdentity(window, methods, send, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok:true, focusedFixtureOnly:true, assertions },null,2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-profile-only')) {
      browser.setVisible(false);
      assertions.applicationProfile = await smokeApplicationProfile(window, methods, send, stateDirectory, store);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.includes('--smoke-workflow-only')) {
      browser.setVisible(false);
      assertions.applicationServices = await smokeApplicationServices(window, methods, send, stateDirectory, store);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (smokeWorkspaceOnly) {
      browser.setVisible(false);
      assertions.workspace = await smokeWorkspace(window, methods, send, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (smokeTelemetryOnly) {
      browser.setVisible(false);
      assertions.telemetry = await smokeTelemetry(window, methods, send, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      await cleanupApp(); app.exit(0); return;
    }
    if (enabledSmokeSubmodes.length && !smokeNativePointerOnly) {
      browser.setVisible(false);
      if (!process.argv.includes('--smoke-feishu-only')) assertions.careerPanelUI = await smokeCareerFillPanel(window, methods, send, stateDirectory);
      if (!process.argv.includes('--smoke-career-ui-only')) assertions.feishuCareer = await smokeFeishuCareer(window, stateDirectory);
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: true, focusedFixtureOnly: true, assertions }, null, 2));
      console.log(JSON.stringify({ ok: true, report: join(stateDirectory, 'smoke-report.json') }));
      await agent.close(); await store.close(); browser.dispose(); app.exit(0); return;
    }
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 600))');
    assertions.uiLoaded = await window.webContents.executeJavaScript('document.body.innerText.includes("OfferFlash") && typeof window.offer.getState === "function"');
    assertions.sqlite = await store.getState();
    const pdf = await readResume(join(projectRoot, 'apps/desktop/fixtures/resume.pdf'));
    const docx = await readResume(join(projectRoot, 'apps/desktop/fixtures/resume.docx'));
    assertions.resumeImport = { pdf: pdf.text?.includes('Fictional Resume Fixture') === true, docx: docx.text?.includes('虚构简历测试文件') === true };
    const cancelledRun = methods.runAgent!('测试初始化时取消');
    await methods.cancelAgent!();
    assertions.initialCancel = (await cancelledRun).status;
    await methods.loadDemo!();
    const state = await store.getState();
    assertions.demoJobs = state.jobs.filter(job => job.demo).length;
    const tracked = await window.webContents.executeJavaScript("window.offer.trackJob('demo-beijing-ai')");
    assertions.trackerPreservesProgress = tracked.applications.find((item: { jobId: string }) => item.jobId === 'demo-beijing-ai')?.status === 'assessment';
    const result = await methods.runAgent!('推荐适合我的岗位');
    assertions.agentStatus = result.status;
    assertions.agentText = result.finalText;
    try {
      await methods.configureModel!({ mode: 'live', provider: 'deepseek', modelId: 'definitely-not-a-model', apiKey: 'invalid-config-fixture-key' });
      throw new Error('无效模型配置意外通过');
    } catch (error) {
      if (error instanceof Error && error.message === '无效模型配置意外通过') throw error;
    }
    assertions.failedConfigPreservesDemo = (await methods.modelStatus!()).mode === 'demo'
      && (await methods.runAgent!('查看申请进度')).status === 'completed';
    const mockModel = await createSmokeModelServer();
    try {
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: mockModel.baseURL });
      const live = await methods.runAgent!('本地协议测试：查询岗位');
      assertions.compatibleProtocol = { status: live.status, text: live.finalText, ...mockModel.getStats() };
    } finally { await mockModel.close(); }
    const skillChecks: Record<string, unknown> = {};
    for (const [toolName, args] of [['get_task_guide', { skillId: 'application-agenda' }], ['get_application_agenda', {}], ['compare_jobs', { jobIds: ['demo-hangzhou-llm', 'demo-beijing-ai'] }]] as const) {
      const fixture = await createSmokeModelServer(toolName, args);
      try {
        await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: fixture.baseURL });
        const run = await methods.runAgent!(`本地协议检查：${toolName}`);
        skillChecks[toolName] = { status: run.status, ...fixture.getStats() };
      } finally { await fixture.close(); }
    }
    assertions.careerSkills = skillChecks;
    send({ type: 'navigate', page: 'applications' });
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"事项视图\"]').click()");
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assertions.agendaView = await window.webContents.executeJavaScript("Boolean(document.querySelector('.application-agenda[data-agenda-date]')) && document.querySelectorAll('.application-card[data-application-id]').length === 3");
    await writeFile(join(stateDirectory, 'agenda-screenshot.png'), (await window.webContents.capturePage()).toPNG());
    await methods.configureModel!({ mode: 'demo', provider: '', modelId: '', apiKey: '' });
    await methods.openTestForm!();
    send({ type: 'navigate', page: 'browser' });
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    browser.resize({ x: 260, y: 150, width: 800, height: 700 });
    browser.setVisible(true);
    browser.view.webContents.setZoomFactor(0.7);
    await methods.saveProfile!({
      fullName: '测试同学', fullNameEn: 'Test Applicant', email: 'applicant@example.invalid', phone: '13800000000',
      school: '演示大学', schoolEn: 'Demo University', degree: '硕士', major: '计算机', majorEn: 'Computer Science',
      graduationMonth: '2027-06', skills: ['Python', '大模型'], cities: ['杭州'], targetRoles: ['算法'], resumeText: '',
    });
    browser.setVisible(false);
    assertions.structuredCareer = await smokeStructuredCareer(window, store, join(projectRoot, 'apps/desktop/fixtures/structured-resume.md'), send);
    await writeFile(join(stateDirectory, 'career-screenshot.png'), (await window.webContents.capturePage()).toPNG());
    const careerModel = await createSmokeModelServer('get_profile_summary');
    try {
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: careerModel.baseURL });
      const run = await methods.runAgent!('本地协议测试：已确认履历概要');
      assertions.careerModelSummary = { status: run.status, ...careerModel.getStats() };
    } finally { await careerModel.close(); }
    send({ type: 'navigate', page: 'browser' });
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');
    browser.resize({ x: 260, y: 150, width: 800, height: 700 }); browser.setVisible(true);
    const previewModel = await createSmokeModelServer('prepare_form_preview');
    let planId: string | undefined;
    try {
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: previewModel.baseURL });
      const previewRun = await methods.runAgent!('本地协议测试：准备网申预览');
      const stats = previewModel.getStats();
      planId = stats.previewPlanId;
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const displayedId = await window.webContents.executeJavaScript("document.querySelector('.form-preview')?.getAttribute('data-plan-id')");
      assertions.agentFormPreview = { status: previewRun.status, displayed: displayedId === planId && !!planId, ...stats };
      assertions.previewDidNotFill = await browser.view.webContents.executeJavaScript("document.querySelector('input[type=email]').value === ''");
    } finally { await previewModel.close(); }
    await methods.configureModel!({ mode: 'demo', provider: '', modelId: '', apiKey: '' });
    const plan = planId ? browser.getPlan(planId) : undefined;
    if (!plan) throw new Error('Agent 未提供可供本地界面审查的实际计划');
    assertions.formReady = plan.items.filter(item => item.status === 'ready').length;
    assertions.formSkipped = plan.items.filter(item => item.status !== 'ready').map(item => item.label);
    const fields = plan.items.filter(item => item.status === 'ready').map(item => item.fieldId);
    window.show(); app.focus({ steal: true }); window.focus(); browser.view.webContents.focus();
    await new Promise(done => setTimeout(done, 250));
    assertions.nativeFocus = { window: window.isFocused(), page: browser.view.webContents.isFocused(), document: await browser.view.webContents.executeJavaScript('document.hasFocus()') };
    const readPointerFixture = () => browser.view.webContents.executeJavaScript(`(() => {
      const form=document.getElementById('application'),hidden=document.getElementById('fixture-hidden-state');
      const native=window.offerAgentNativeFixture,first=document.getElementById('name').getBoundingClientRect();
      const surface=document.elementFromPoint(first.x+first.width/2,innerHeight/2);
      let circular=false;try{JSON.stringify(form.id);}catch(error){circular=error instanceof TypeError;}
      return {formIdClobbered:form.id===hidden,attributeIdCorrect:form.getAttribute('id')==='application',circular,
        firstFieldBelowViewport:first.top>=innerHeight,wheelPointInsideForm:Boolean(surface&&form.contains(surface)),
        protected:{hiddenValue:hidden.value,emergency:document.getElementById('emergency').value,identity:document.getElementById('identity').value,
          existing:document.getElementById('existing').value,agreement:document.getElementById('agreement').checked,result:document.getElementById('result').textContent},
        wheels:native.wheels,trustedWheels:native.trustedWheels,scrolls:native.scrolls,maxScrollY:native.maxScrollY,
        submissions:native.submissions,submitClicks:native.submitClicks};
    })()`) as Promise<{formIdClobbered:boolean;attributeIdCorrect:boolean;circular:boolean;firstFieldBelowViewport:boolean;wheelPointInsideForm:boolean;
      protected:{hiddenValue:string;emergency:string;identity:string;existing:string;agreement:boolean;result:string};
      wheels:number;trustedWheels:number;scrolls:number;maxScrollY:number;submissions:number;submitClicks:number}>;
    const pointerBefore = await readPointerFixture();
    assertions.nativePointerClobberBefore = pointerBefore;
    if (!pointerBefore.formIdClobbered || !pointerBefore.attributeIdCorrect || !pointerBefore.circular
      || !pointerBefore.firstFieldBelowViewport || !pointerBefore.wheelPointInsideForm
      || pointerBefore.protected.hiddenValue !== 'keep-fictional-hidden-state' || pointerBefore.submissions !== 0 || pointerBefore.submitClicks !== 0) {
      throw new Error('本机命名控件循环引用或必经滚动区域未按原创样表建立。');
    }
    if (fields.length) assertions.formFill = await methods.fillApproved!(plan.id, fields);
    const fill = assertions.formFill as { verified?: unknown[] } | undefined;
    assertions.verifiedCount = fill?.verified?.length ?? 0;
    const pointerAfter = await readPointerFixture();
    assertions.nativePointerClobber = { fixtureOnly:true,realEnterpriseVerified:false,before:pointerBefore,after:pointerAfter,
      protectedUnchanged:JSON.stringify(pointerBefore.protected)===JSON.stringify(pointerAfter.protected),
      nativeWheelObserved:pointerAfter.trustedWheels>pointerBefore.trustedWheels,actualScrollObserved:pointerAfter.maxScrollY>0&&pointerAfter.scrolls>0 };
    if (assertions.verifiedCount !== 7 || !pointerAfter.formIdClobbered || !pointerAfter.attributeIdCorrect || !pointerAfter.circular
      || JSON.stringify(pointerBefore.protected)!==JSON.stringify(pointerAfter.protected)
      || pointerAfter.trustedWheels<=pointerBefore.trustedWheels || pointerAfter.maxScrollY<=0 || pointerAfter.scrolls<=0
      || pointerAfter.submissions!==0 || pointerAfter.submitClicks!==0) throw new Error('本机命名控件循环引用的七字段原生滚动回归未通过。');
    if (smokeNativePointerOnly) {
      await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok:true,focusedFixtureOnly:true,
        fixture:'native-pointer-clobber',assertions }, null, 2));
      console.log(JSON.stringify({ ok:true,report:join(stateDirectory, 'smoke-report.json') }));
      await agent.close(); await store.close(); browser.dispose(); app.exit(0); return;
    }
    assertions.browserHasAppBridge = await browser.view.webContents.executeJavaScript('typeof window.offer !== "undefined" || typeof require !== "undefined"');
    await writeFile(join(stateDirectory, 'form-screenshot.png'), (await browser.view.webContents.capturePage()).toPNG());
    assertions.sourceCollection = await smokeSourceCollection(window, browser, store, send);
    await writeFile(join(stateDirectory, 'source-collection-webpage.png'), (await browser.view.webContents.capturePage()).toPNG());
    const reportBounds = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.toast button')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const report = document.querySelector('[aria-label="采集范围报告"]');
      if (!report) throw new Error('采集报告截图目标缺失');
      report.scrollIntoView({block:'end'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = report.getBoundingClientRect();
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
      return { x, y, width: Math.min(Math.ceil(r.width), innerWidth - x), height: Math.min(Math.ceil(r.height), innerHeight - y) };
    })()`);
    await writeFile(join(stateDirectory, 'source-collection-screenshot.png'), (await window.webContents.capturePage(reportBounds)).toPNG());
    assertions.uiNavigation = await smokeUINavigation(window, methods, send, stateDirectory);
    assertions.chatUI = await smokeChatUI(window, methods, send, stateDirectory);
    browser.setVisible(false);
    send({ type: 'navigate', page: 'jobs' });
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 350))');
    const screenshot = await window.webContents.capturePage();
    await writeFile(join(stateDirectory, 'mvp-screenshot.png'), screenshot.toPNG());
    assertions.rendererHasNode = await window.webContents.executeJavaScript('typeof require !== "undefined"');
    assertions.pendingStatus = await smokePendingStatus(window, store, send);
    await writeFile(join(stateDirectory, 'pending-status-screenshot.png'), (await window.webContents.capturePage()).toPNG());
    assertions.focusedFlow = await smokeFocusedFlow(window, browser, methods, send, stateDirectory);
    assertions.customCombobox = await smokeCustomCombobox(window, browser, methods, stateDirectory);
    browser.setVisible(false);
    assertions.careerPanelUI = await smokeCareerFillPanel(window, methods, send, stateDirectory);
    assertions.feishuCareer = await smokeFeishuCareer(window, stateDirectory);
    if (!(assertions.feishuCareer as { ok: boolean }).ok) throw new Error('飞书多段履历原生验收未通过');
    if (process.argv.includes('--check-campus-source')) {
      try {
        const refreshed = await refreshSource('bytedance-campus', '算法');
        const sourceRun = refreshed.sourceRuns.find(run => run.sourceId === 'bytedance-campus');
        assertions.campusSource = { status: sourceRun?.status ?? 'failed', count: sourceRun?.count, report: sourceRun?.report, examples: refreshed.jobs.filter(job => job.sourceId === 'bytedance-campus').slice(0, 2).map(job => ({ title: job.title, company: job.company, city: job.city, type: job.type, url: job.url })) };
        const cards = await browser.view.webContents.executeJavaScript("Array.from(document.querySelectorAll('a[href*=\"/detail\"]')).slice(0,2).map(a => ({text:a.innerText,html:a.outerHTML.slice(0,12000)}))");
        await writeFile(join(stateDirectory, 'campus-source-cards.json'), JSON.stringify(cards, null, 2));
      } catch (error) {
        assertions.campusSource = { status: 'failed', error: error instanceof Error ? error.message : String(error), page: browser.getState() };
        await writeFile(join(stateDirectory, 'campus-source-screenshot.png'), (await browser.view.webContents.capturePage()).toPNG());
      }
    }
    const protocol = assertions.compatibleProtocol as { status: string; requests: number; toolResultSeen: boolean; policySeen: boolean; toolDefinitionsSeen: boolean };
    const preview = assertions.agentFormPreview as { status: string; displayed: boolean; policySeen: boolean; toolDefinitionsSeen: boolean; privateFieldValuesAbsent: boolean };
    const imports = assertions.resumeImport as { pdf: boolean; docx: boolean };
    const structured = assertions.structuredCareer as { ok: boolean };
    const careerSummary = assertions.careerModelSummary as { status: string; toolResultSeen: boolean; privateFieldValuesAbsent: boolean };
    const skillResults = Object.values(assertions.careerSkills as Record<string, { status: string; toolResultSeen: boolean; policySeen: boolean; toolDefinitionsSeen: boolean }>);
    const sourceCollection = assertions.sourceCollection as { ok: boolean };
    if (!(assertions.pendingStatus as { ok: boolean }).ok) throw new Error('待核对界面验收未通过');
    const uiNavigation = assertions.uiNavigation as { ok: boolean };
    const chatUI = assertions.chatUI as { ok: boolean };
    const ok = (assertions.customCombobox as { ok: boolean }).ok && (assertions.focusedFlow as { ok: boolean }).ok && uiNavigation.ok && chatUI.ok && sourceCollection.ok && structured.ok && careerSummary.status === 'completed' && careerSummary.toolResultSeen && careerSummary.privateFieldValuesAbsent && skillResults.length === 3 && skillResults.every(result => result.status === 'completed' && result.toolResultSeen && result.policySeen && result.toolDefinitionsSeen) && assertions.agendaView === true && assertions.uiLoaded === true && imports.pdf && imports.docx && assertions.trackerPreservesProgress === true && assertions.initialCancel === 'cancelled' && assertions.agentStatus === 'completed' && assertions.failedConfigPreservesDemo === true && protocol.status === 'completed' && protocol.requests === 2 && protocol.toolResultSeen && protocol.policySeen && protocol.toolDefinitionsSeen && preview.status === 'completed' && preview.displayed && preview.policySeen && preview.toolDefinitionsSeen && preview.privateFieldValuesAbsent && assertions.previewDidNotFill === true && Number(assertions.demoJobs) > 0 && Number(assertions.verifiedCount) >= 2 && assertions.rendererHasNode === false && assertions.browserHasAppBridge === false;
    await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok, assertions }, null, 2));
    console.log(JSON.stringify({ ok, report: join(stateDirectory, 'smoke-report.json') }));
    await agent.close(); await store.close(); browser.dispose();
    app.exit(ok ? 0 : 1);
  } catch (error) {
    await writeFile(join(stateDirectory, 'smoke-report.json'), JSON.stringify({ ok: false,
      ...(smokeNativePointerOnly ? { focusedFixtureOnly:true,fixture:'native-pointer-clobber' } : {}),
      error: error instanceof Error ? error.stack : error, assertions }, null, 2));
    console.error(error); app.exit(1);
  }
}

function cleanupApp(): Promise<void> {
  cleanupTask ??= (async () => {
    await jobMatching?.cancel();
    await backgroundQueue?.cancel();backgroundQueue?.dispose(); queueTray?.dispose();backgroundModelProvider?.close();
    await applicationServices?.close();
    identityHost?.invalidate();
    browser?.dispose();
    await agent?.close();
    await realSiteQAObserver?.flush();
    await store?.close();
    await telemetry?.store.close();
  })();
  return cleanupTask;
}

if (!smoke && !liveProductCheck && !realSiteQA && !app.requestSingleInstanceLock()) app.quit();
else {
  await app.whenReady();
  app.on('before-quit', event => {
    if (shuttingDown || smoke) return;
    event.preventDefault();
    shuttingDown = true;
    void cleanupApp().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createApp(); });
  await createApp();
}
