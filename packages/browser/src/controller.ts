import { createHash, randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebContentsView, type BrowserWindow, type DownloadItem, type Event, type WebContents, type Session, type WebPreferences, type HandlerDetails, type WindowOpenHandlerResponse } from 'electron';
import type {
  BrowserBounds, BrowserState, CapturedPage, FieldObservation, FillItem, FillPlan, FillResult,
  FormObservation, JobInput, Profile,
  CareerFillOptions, CareerFillPreview, CareerFillOutcome,
  ApplicationFieldLocationInput, ApplicationFieldLocationResult,
  ApplicationWorkflowIssue,
} from '../../shared/src/contracts.js';
import {
  buildFillPlan, fieldSignature, isVerifiedValue, matchSelectOption, pageSignature, validateApprovedFields,
} from '../../forms/src/index.js';
import { READ_FORM, READ_FORM_STRUCTURE, READ_JOB_LINKS, READ_PAGE, readTarget, readLocationWheelTarget, writeObservedMonth, locationObservationSnapshot, revealObservedField } from './read-scripts.js';
import { formDiagnostic } from '../../forms/src/form-diagnostic.js';
import {READ_UNIVERSAL_FORM} from './universal-read.js';
import { readComboboxOptionTarget, readComboboxPopup } from './combobox-scripts.js';
import { FeishuCareerDriver } from './feishu-native.js';
import { createFeishuFixtureScripts } from './feishu-scripts.js';
import * as feishuScripts from './feishu-scripts.js';
import { FieldLocationRegistry, FieldLocationError, validateFieldLocationInput } from './field-location.js';
import { browserZoomPercent } from '../../ui/src/browser-viewport.js';
import { safePreparationRetry } from '../../forms/src/fill-retry.js';
import { workflowOrdinaryTarget, workflowCareerTarget } from './workflow-location.js';
import { prepareOneClickCareer } from '../../ui/src/one-click-career.js';
import { FieldCompanion, type FieldCompanionTarget } from './field-companion.js';
import {browserTabShortcut} from './tab-shortcuts.js';
import { buildCareerPlan, type CareerFillPlan } from '../../forms/src/career-plan.js';
import { runCareerPlan, type CareerRunnerJournalEvent } from '../../forms/src/career-runner.js';
import { isAllowedNavigation } from './navigation-policy.js';
import {
  browserCollectionSource, checkCollectionAborted, collectionFingerprint, collectionScopeKey,
  isCollectionDetailURL, isCollectionListURL, runBrowserCollection,
  type BrowserCollectionOptions, type BrowserListPage,
} from './collection.js';
import { READ_COLLECTION_DETAIL, READ_COLLECTION_LIST, readPaginationTarget } from './collection-scripts.js';
import { checkCollectionDetail } from './detail-observation.js';
import type { SourceCollectionResult } from '../../shared/src/contracts.js';

export interface BrowserOptions {
  window: BrowserWindow;
  onState(state: BrowserState): void;
  getProfile(): Promise<Profile>;
  testFormPath?: string;
  onNavigate?(): void;
  fillRetryLimit?: 0 | 1 | 2;
  onRetry?(event: { kind: 'ordinary' | 'career'; label: string; attempt: number; maxAttempts: number }): void;
  enableFieldCompanion?: boolean;
  /** Test-only exact loopback scope, never accepted through application IPC. */
  careerFixtureOrigin?: string;
  onNewWindow?(details:HandlerDetails):WindowOpenHandlerResponse;
  /** Host-only callbacks; none are exposed to a remote page or model. */
  confirmLeave?():Promise<{leave:boolean;approved:boolean}>;
  confirmNativeLeave?():boolean;
  popupPreferences?:WebPreferences;
  popupContents?:WebContents;
  onBrowserShortcut?(action:'new'|'close'|'next'|'previous'):void;
}
const INSTALL_DIRTY_TRACKER=`(()=>{if(window.__offerflashDirtyTracker)return;Object.defineProperty(window,'__offerflashDirtyTracker',{value:{dirty:false},configurable:false});const mark=event=>{const target=event.target;if(target instanceof Element&&target.matches('input:not([type=hidden]):not([type=search]),textarea,select,[contenteditable=true]'))window.__offerflashDirtyTracker.dirty=true;};document.addEventListener('input',mark,true);document.addEventListener('change',mark,true);})()`;
interface ObservationView { rawSnapshot?:string; observation: FormObservation; width: number; height: number; generation: number; }
interface StoredPlan { plan: FillPlan; original: FormObservation; generation: number; }
type FillExecutionStage = 'read-field' | 'focus-view' | 'settle-field' | 'reveal-field' | 'hit-field' | 'hover-field'
  | 'focus-target' | 'insert-text' | 'verify-value' | 'verify-validity';
interface ComboOption { index: number; id: string; label: string; identity: string; selected: boolean; bounds: BrowserBounds; }
interface ComboPopup { ownerIdentity: string; identity: string; fingerprint: string; options: ComboOption[]; }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('网页观察返回了无效数据。');
  return value as Record<string, unknown>;
}
function string(value: unknown, limit = 2000): string { return typeof value === 'string' ? value.slice(0, limit) : ''; }
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('网页字段坐标无效。');
  return value;
}
/** Preserve normal matching guards while attaching read-only facts to skipped existing values. */
function annotateOrdinaryPlan(plan:FillPlan,observation:FormObservation,profile:Profile):FillPlan {
  return {...plan,items:plan.items.map(item=>{
    const field=observation.fields.find(field=>field.id===item.fieldId);
    if(!field)throw new Error('计划中的字段不在本次观察中，请重新识别。');
    const inferred=item.status==='skip'&&field.value.trim()&&!item.profileKey
      ?buildFillPlan({...observation,fields:[{...field,value:''}]},profile).items[0]?.profileKey:undefined;
    return {...item,...(inferred?{profileKey:inferred}:{}),type:field.type,required:field.required,fieldSignature:field.signature};
  })};
}

/** A single remote tab, with no application preload or Node access. */
export class BrowserController {
  readonly view: WebContentsView;
  private readonly session:Session;
  private leaveApproved=false;
  private closeDecision?: (closed:boolean)=>void;
  private readonly fixtureURL?: string;
  private state: BrowserState = { url: '', title: '内置浏览器', loading: false, canGoBack: false, canGoForward: false, visible: false, zoomPercent: 100 };
  private generation = 0;
  private documentGeneration = 0;
  private disposed = false;
  private filling = false;
  private fillInterrupted = false;
  private preparing = false;
  private collecting = false;
  private collectionOrigin?: string;
  private collectionExpected?: { url: string; generation: number };
  private readonly collectionViews = new WeakMap<BrowserListPage, { generation: number; width: number; height: number }>();
  private readonly plans = new Map<string, StoredPlan>();
  private readonly careerPlans = new Map<string, { plan: CareerFillPlan; createdAt: number }>();
  private readonly locations = new FieldLocationRegistry();
  private readonly fieldCompanion?: FieldCompanion;
  private readonly clearDecoration = () => { void this.fieldCompanion?.clear(); };
  private careerAbort?: AbortController;
  private careerDiagnostic?: ReturnType<FeishuCareerDriver['getSummary']>;
  private readonly careerFixtureScripts?: ReturnType<typeof createFeishuFixtureScripts>;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 1, height: 1 };

  constructor(private readonly options: BrowserOptions) {
    this.careerFixtureScripts = options.careerFixtureOrigin ? createFeishuFixtureScripts(options.careerFixtureOrigin) : undefined;
    this.fixtureURL = options.testFormPath ? pathToFileURL(resolve(options.testFormPath)).href : undefined;
    this.view = new WebContentsView({...(options.popupContents?{webContents:options.popupContents}:{}), webPreferences: {
      ...options.popupPreferences,
      partition: 'persist:offeragent-recruiting', sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker:false,webSecurity: true,
      allowRunningInsecureContent: false,preload:undefined,webviewTag:false,additionalArguments:[],session:undefined,
    } });
    options.window.contentView.addChildView(this.view);
    this.view.setVisible(false);
    const contents = this.view.webContents;
    this.session=contents.session;
    if (options.enableFieldCompanion) {
      this.fieldCompanion = new FieldCompanion(contents);
      options.window.on('blur',this.clearDecoration);
    }
    contents.setZoomMode('isolated');
    contents.setZoomFactor(1);
    void contents.setVisualZoomLevelLimits(1, 1);
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(false);
      this.publish({ error: `网页请求的 ${permission} 权限未开启，请手动处理。` });
    });
    contents.session.on('will-download', this.onDownload);
    contents.setWindowOpenHandler(details => {
      const {url}=details;
      if(options.onNewWindow&&(this.isAllowed(url)||url==='about:blank'))return options.onNewWindow(details);
      if (!this.isAllowed(url)) {
        this.publish({ error: '已阻止不支持的新窗口地址。' });
      } else {
        void this.navigate(url).then(() => this.publish({ error: '网站的新窗口链接已在当前内置浏览器页打开。' })).catch(error => {
          this.publish({ error: error instanceof Error ? error.message : '新窗口链接打开失败。' });
        });
      }
      return { action: 'deny' };
    });
    contents.on('dom-ready',()=>{void contents.executeJavaScript(INSTALL_DIRTY_TRACKER).catch(()=>{});});
    contents.on('will-prevent-unload',event=>{
      const leave=this.leaveApproved||(options.confirmNativeLeave?.()??false);this.leaveApproved=false;
      if(leave)event.preventDefault();else this.closeDecision?.(false);
    });
    contents.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown'||!options.onBrowserShortcut)return;
      const action=browserTabShortcut(input);
      if(action){event.preventDefault();options.onBrowserShortcut(action);}
    });
    contents.on('will-navigate', (event, url) => { if (!this.isAllowed(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => {
      if (!this.isAllowed(url)) { event.preventDefault(); this.publish({ error: '网页重定向地址不受支持。' }); }
    });
    contents.on('will-frame-navigate', event => { if (!this.isAllowed(event.url)) event.preventDefault(); });
    contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame) {
        if(!inPlace)this.documentGeneration++;
        this.generation++; this.plans.clear(); this.careerPlans.clear(); this.locations.clear();
        // The tab's loading spinner also tracks background iframes. Only a
        // main-document navigation cancels the UI's current quick-fill task.
        if (!inPlace) this.publish({ loading: true, error: undefined });
      }
    });
    contents.on('did-frame-finish-load', (_event, isMainFrame) => {
      if (isMainFrame) {this.leaveApproved=false;this.publish({ loading: false });}
    });
    contents.on('did-stop-loading', () => {
      // An aborted main navigation may not emit frame-finish. Do not wait for
      // analytics/subframes, or let their spinner restart create a new task.
      if (this.state.loading && !contents.isLoadingMainFrame()) this.publish({ loading: false });
    });
    contents.on('did-navigate', () => this.publish({ error: undefined }));
    contents.on('did-navigate-in-page', () => this.publish({ error: undefined }));
    contents.on('page-title-updated', () => this.publish({}));
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.publish({ loading: false, error: `网页加载失败：${description}` });
    });
    contents.on('render-process-gone', (_event, details) => {
      this.documentGeneration++;
      this.generation++;
      this.plans.clear();
      this.careerPlans.clear(); this.locations.clear();
      this.publish({ loading: false, error: `网页进程已停止（${details.reason}），请刷新。` });
    });
  }

  private onDownload = (event: Event, item: DownloadItem, contents: WebContents): void => {
    if (contents.id !== this.view.webContents.id) return;
    if (!item.hasUserGesture()) {
      event.preventDefault();
      this.publish({ error: '网页后台下载已阻止；请由你点击需要下载的文件。' });
      return;
    }
    // Not setting savePath preserves Electron's user-controlled native save dialog.
    item.setSaveDialogOptions({ title: '保存招聘网站文件', defaultPath: basename(item.getFilename()) });
  };

  private isAllowed(raw: string): boolean {
    if (!isAllowedNavigation(raw, this.fixtureURL)) return false;
    if (this.collectionOrigin && new URL(raw).origin !== this.collectionOrigin) return false;
    return true;
  }

  private publish(update: Partial<BrowserState>): void {
    if (this.disposed) return;
    const contents = this.view.webContents;
    this.state = {
      ...this.state, ...update, url: contents.getURL(), title: contents.getTitle() || this.state.title,
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(),
    };
    try { this.options.onState(this.getState()); } catch { /* Observers cannot control the browser. */ }
  }

  getState(): BrowserState { return { ...this.state,documentRevision:this.documentGeneration }; }
  async hasUnsavedChanges():Promise<boolean>{
    if(this.disposed||!this.view.webContents||this.view.webContents.isDestroyed())return false;
    const contents=this.view.webContents,url=contents.getURL();
    // A newly allocated blank WebContents has no loaded document. Electron
    // queues executeJavaScript until load, so asking it can block quit forever.
    if(!url||url==='about:blank')return false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([contents.executeJavaScript('window.__offerflashDirtyTracker?.dirty===true').then(value=>value===true).catch(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(true),1200);})]);}
    finally{clearTimeout(timer);}
  }
  private async allowLeave():Promise<boolean>{
    const decision=await this.options.confirmLeave?.()??{leave:true,approved:false};this.leaveApproved=decision.leave&&decision.approved;return decision.leave;
  }
  async requestClose():Promise<boolean>{
    this.assertLive();if(this.filling||this.preparing||this.collecting)throw Error('请等待当前页面操作结束，再关闭标签页。');
    if(!await this.allowLeave())return false;
    const contents=this.view.webContents;
    return new Promise<boolean>(resolve=>{let settled=false;const finish=(closed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);this.closeDecision=undefined;contents.removeListener('destroyed',destroyed);resolve(closed);};const destroyed=()=>finish(true);const timer=setTimeout(()=>finish(contents.isDestroyed()),5000);this.closeDecision=finish;contents.once('destroyed',destroyed);contents.close({waitForBeforeUnload:true});});
  }
  setFieldCompanionMotion(input:{enabled:boolean;reducedMotion:boolean}):Promise<void> {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['enabled','reducedMotion'].includes(key))
      ||typeof input.enabled!=='boolean'||typeof input.reducedMotion!=='boolean')throw new Error('动画偏好无效。');
    return this.fieldCompanion?.setEnabled(input.enabled,input.reducedMotion)??Promise.resolve();
  }
  private decorate(target:FieldCompanionTarget):void {
    if(this.disposed||this.filling&&this.fillInterrupted||!this.state.visible||!this.options.window.isFocused())return;
    void this.fieldCompanion?.show(target);
  }

  setZoom(value: 80 | 90 | 100): BrowserState {
    this.assertLive();
    const percent = browserZoomPercent(value);
    if (this.preparing || this.filling || this.collecting) throw new Error('请等待当前浏览器操作结束再缩放。');
    this.applyZoom(percent);
    return this.getState();
  }
  private applyZoom(percent: 80 | 90 | 100): void {
    if (this.view.webContents.getZoomFactor() !== percent / 100) {
      // A browse preference can never reuse authorization based on old coordinates.
      this.plans.clear(); this.careerPlans.clear();
      this.view.webContents.setZoomFactor(percent / 100);
    }
    this.publish({ zoomPercent: percent });
  }

  async navigate(raw: string): Promise<BrowserState> {
    this.assertLive();
    if (this.preparing) throw new Error('正在识别网页字段，请等待识别结束再导航。');
    if (this.filling) throw new Error('正在填写，请等待本次验证结束再导航。');
    if (this.collecting) throw new Error('正在采集官网列表，请等待本次采集结束再导航。');
    const url = /^[a-z][a-z\d+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    if (!this.isAllowed(url)) throw new Error('只支持 HTTP/HTTPS 招聘网页及应用内固定测试表单。');
    if(this.state.url&&this.state.url!=='about:blank'&&!await this.allowLeave())return this.getState();
    this.options.onNavigate?.();
    this.plans.clear();
    this.publish({ error: undefined });
    try { await this.view.webContents.loadURL(url); }
    catch (error) {
      const aborted=error instanceof Error&&(/ERR_ABORTED|\(-3\)/.test(error.message)||(error as Error&{errno?:number}).errno===-3);
      this.publish(aborted?{error:undefined,loading:this.view.webContents.isLoadingMainFrame()}:{ error: error instanceof Error ? error.message : '网页加载失败。', loading: false });
    }
    this.publish({});
    return this.getState();
  }

  async openTestForm(): Promise<BrowserState> {
    if (!this.fixtureURL) throw new Error('没有配置应用内测试表单。');
    return this.navigate(this.fixtureURL);
  }

  async back(): Promise<BrowserState> {
    this.assertLive();
    if (this.preparing) throw new Error('正在识别网页字段，请等待识别结束再切换网页。');
    if (this.filling) throw new Error('填写过程中不能切换网页。');
    if (this.collecting) throw new Error('官网采集过程中不能切换网页。');
    if (this.view.webContents.navigationHistory.canGoBack()&&await this.allowLeave()) this.view.webContents.navigationHistory.goBack();
    this.publish({}); return this.getState();
  }
  async forward(): Promise<BrowserState> {
    this.assertLive();
    if (this.preparing) throw new Error('正在识别网页字段，请等待识别结束再切换网页。');
    if (this.filling) throw new Error('填写过程中不能切换网页。');
    if (this.collecting) throw new Error('官网采集过程中不能切换网页。');
    if (this.view.webContents.navigationHistory.canGoForward()&&await this.allowLeave()) this.view.webContents.navigationHistory.goForward();
    this.publish({}); return this.getState();
  }
  async reload(): Promise<BrowserState> {
    this.assertLive();
    if (this.preparing) throw new Error('正在识别网页字段，请等待识别结束再刷新。');
    if (this.filling) throw new Error('填写过程中不能刷新网页。');
    if (this.collecting) throw new Error('官网采集过程中不能刷新网页。');
    if(!await this.allowLeave())return this.getState();
    this.plans.clear(); this.view.webContents.reload(); this.publish({}); return this.getState();
  }

  resize(bounds: BrowserBounds): void {
    this.assertLive();
    for (const value of Object.values(bounds)) if (!Number.isFinite(value)) throw new Error('浏览器区域无效。');
    const area = this.options.window.getContentBounds();
    const x = Math.max(0, Math.min(Math.round(bounds.x), area.width));
    const y = Math.max(0, Math.min(Math.round(bounds.y), area.height));
    this.bounds = { x, y, width: Math.max(1, Math.min(Math.round(bounds.width), area.width - x)), height: Math.max(1, Math.min(Math.round(bounds.height), area.height - y)) };
    this.view.setBounds(this.bounds);
  }
  setVisible(visible: boolean): void {
    this.assertLive();
    if (!visible) this.clearDecoration();
    if (!visible && (this.filling || this.preparing)) { this.generation++; this.plans.clear(); }
    this.view.setVisible(visible); this.publish({ visible });
  }

  private assertLive(): void {
    if (this.disposed || !this.view.webContents || this.view.webContents.isDestroyed()) throw new Error('浏览器已关闭。');
  }
  private assertReadable(): void {
    this.assertLive();
    if (!this.isAllowed(this.view.webContents.getURL())) throw new Error('请先打开招聘网页或测试表单。');
  }

  private async observe(): Promise<ObservationView> {
    this.assertReadable();
    const generation = this.generation;
    const raw = record(await this.view.webContents.executeJavaScript(READ_FORM));
    if (generation !== this.generation || string(raw.url) !== this.view.webContents.getURL()) throw new Error('观察期间网页已跳转，请重试。');
    if (!Array.isArray(raw.fields) || raw.fields.length > 300) throw new Error('网页字段数据无效。');
    const fields = raw.fields.map((entry): FieldObservation => {
      const source = record(entry);
      const index = finite(source.index);
      if (!Number.isInteger(index) || index < 0 || index >= 300) throw new Error('字段索引无效。');
      const bounds = record(source.bounds);
      const options = Array.isArray(source.options) ? source.options.slice(0, 500).map(entry => {
        const option = record(entry); return { label: string(option.label, 240), value: string(option.value, 500) };
      }) : [];
      const field: FieldObservation = {
        id: `field-${index}`, index, label: string(source.label, 240), type: string(source.type, 30), value: string(source.value),
        editable: source.editable === true, required: source.required === true, options, section: string(source.section, 240),
        bounds: { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) }, signature: '',
        ...(['radio', 'checkbox'].includes(String(source.type)) && typeof source.checked === 'boolean' ? { checked: source.checked } : {}),
      };
      if (source.customSelect !== undefined) {
        const binding = record(source.customSelect);
        if (field.type !== 'combobox' || !['aria-single-select','local-single-select'].includes(String(binding.kind))
          || !['controls','owns','sibling'].includes(String(binding.relationship))
          || (binding.kind==='local-single-select')!==(binding.relationship==='sibling')
          || !['input-value', 'aria-valuetext'].includes(String(binding.valueSource))
          || typeof binding.popupId !== 'string' || !binding.popupId || binding.popupId.length > 240
          || /[\s\u0000-\u001f\u007f]/u.test(binding.popupId)) throw new Error('自定义下拉的关联信息无效。');
        field.customSelect = { kind:binding.kind as 'aria-single-select'|'local-single-select', relationship: binding.relationship as 'controls' | 'owns'|'sibling',
          popupId: binding.popupId, valueSource: binding.valueSource as 'input-value' | 'aria-valuetext' };
      }
      field.signature = createHash('sha256').update(`${fieldSignature(field)}|${string(source.identity, 500)}`).digest('hex');
      return field;
    });
    const viewport = record(raw.viewport);
    const observation: FormObservation = {
      id: randomUUID(), url: string(raw.url), title: string(raw.title, 500), observedAt: new Date().toISOString(), fields,
      signature: createHash('sha256').update(`${generation}:${pageSignature(fields)}`).digest('hex'),
    };
    return { rawSnapshot:locationObservationSnapshot(raw), observation, generation, width: finite(viewport.width), height: finite(viewport.height) };
  }

  async diagnoseFormReadOnly() {
    if(this.preparing||this.filling||this.collecting)throw Error('请等待当前操作结束后再诊断。');
    this.preparing=true;
    try {
      const before=await this.observe(),profile=await this.options.getProfile();
      const semanticBefore=await this.view.webContents.executeJavaScript(READ_UNIVERSAL_FORM);
      const structure=await this.view.webContents.executeJavaScript(READ_FORM_STRUCTURE);
      const semanticAfter=await this.view.webContents.executeJavaScript(READ_UNIVERSAL_FORM);
      const after=await this.observe(),latest=await this.options.getProfile();
      if(before.generation!==after.generation||before.rawSnapshot!==after.rawSnapshot||JSON.stringify(semanticBefore)!==JSON.stringify(semanticAfter)||profile.version!==latest.version)throw Error('诊断期间页面或资料变化，请重新诊断。');
      return formDiagnostic(after.observation,profile,structure,semanticAfter);
    } finally {this.preparing=false;}
  }

  async withUniversalContents<T>(operation:(contents:import('electron').WebContents,generation:()=>number,onFieldActivity:(target:FieldCompanionTarget)=>void)=>Promise<T>):Promise<T>{
    if(this.preparing||this.filling||this.collecting)throw Error('BROWSER_BUSY');
    this.filling=true;this.fillInterrupted=false;this.plans.clear();this.careerPlans.clear();this.locations.clear();this.clearDecoration();
    let active=true;const url=this.view.webContents.getURL();
    const onFieldActivity=(target:FieldCompanionTarget)=>{if(active&&this.view.webContents.getURL()===url)this.decorate(target);};
    try{return await operation(this.view.webContents,()=>this.documentGeneration,onFieldActivity);}
    finally{active=false;this.clearDecoration();this.filling=false;}
  }

  async preparePlan(resolver?: (observation: FormObservation, profile: Profile) => Promise<FillPlan>, options: {rememberLocation?:boolean} = {}): Promise<FillPlan> {
    if (this.preparing) throw new Error('已有字段识别正在执行。');
    if (this.filling) throw new Error('请等待当前填写结束。');
    if (this.collecting) throw new Error('请等待官网采集结束再准备填写。');
    this.preparing = true;
    this.plans.clear();
    try {
      this.applyZoom(100);
      const [view, profile] = await Promise.all([this.observe(), this.options.getProfile()]);
      const plan = resolver ? await resolver(structuredClone(view.observation), structuredClone(profile)) : buildFillPlan(view.observation, profile);
      const [current, latestProfile] = await Promise.all([this.observe(), this.options.getProfile()]);
      if (view.generation !== current.generation || view.observation.url !== current.observation.url
        || view.observation.signature !== current.observation.signature || profile.version !== latestProfile.version
        || view.observation.fields.some(field => current.observation.fields.find(other => other.id === field.id)?.value !== field.value)) {
        throw new Error('识别期间页面或资料变化，请重新识别字段。');
      }
      if (plan.observationId !== view.observation.id || plan.url !== view.observation.url || plan.profileVersion !== profile.version) {
        throw new Error('填写计划没有绑定当前页面和资料，请重新识别。');
      }
      plan.items=annotateOrdinaryPlan(plan,view.observation,profile).items;
      this.plans.set(plan.id, { plan: structuredClone(plan), original: structuredClone(view.observation), generation: view.generation });
      if(options.rememberLocation!==false)this.locations.rememberOrdinary(plan, view.observation, view.generation);
      return structuredClone(plan);
    } finally { this.preparing = false; }
  }
  getPlan(planId: string): FillPlan {
    const stored = this.plans.get(planId);
    if (!stored) throw new Error('填写预览已失效，请重新观察页面。');
    return structuredClone(stored.plan);
  }
  /** Host-only revocation; never exposed through the renderer API. */
  discardPlan(planId:string):void {this.plans.delete(planId);this.careerPlans.delete(planId);}

  private careerPreview(plan:CareerFillPlan):CareerFillPreview {
    const original=plan.original;
    return {planId:plan.id,url:plan.url,profileVersion:plan.profileVersion,
      groups:original.groups.map(group=>({id:group.id,collection:group.collection,signature:group.signature,
        fields:group.fields.map(field=>({id:field.id,key:field.key,type:field.type,value:field.value,signature:field.signature,
          editable:field.editable,...(field.required!==undefined?{required:field.required}:{}),
          ...(field.supportsUntilNow===true?{supportsUntilNow:true}:{} )}))})),
      bindings:structuredClone(plan.bindings),selectedRecordIds:Object.fromEntries(Object.entries(plan.options.selectedRecordIds??{}).map(([key,ids])=>[key,[...ids]])),
      preserveGroupIds:[...(plan.options.preserveGroupIds??[])],issues:structuredClone(plan.issues),
      steps:plan.steps.map(step=>step.kind==='fill-group'?{kind:step.kind,collection:step.binding.collection,
        recordId:step.binding.recordId,groupId:step.binding.groupId,items:step.items.map(item=>({...structuredClone(item),
          required:original.groups.find(group=>group.id===step.binding.groupId)?.fields.find(field=>field.id===item.fieldId)?.required}))}
        :{kind:step.kind,collection:step.collection,recordId:step.recordId})};
  }

  /** Refresh explanations only. These plans are never installed in the executable-plan maps. */
  async readAttention():Promise<{url:string;profileVersion:number;ordinary:FillPlan;career?:CareerFillPreview}> {
    if(this.preparing||this.filling||this.collecting)throw new Error('请等待当前操作结束再重新读取提示。');
    this.preparing=true;this.plans.clear();this.careerPlans.clear();
    let driver:FeishuCareerDriver|undefined;
    const deadline=Date.now()+8000;
    const bounded=<T>(read:Promise<T>)=>this.readWithinDeadline(read,deadline);
    try {
      this.applyZoom(100);
      const [view,profile]=await Promise.all([bounded(this.observe()),bounded(this.options.getProfile())]);
      let career:CareerFillPreview|undefined;
      const url=new URL(view.observation.url);
      const careerScope=!!this.careerFixtureScripts||url.protocol==='https:'&&url.hostname==='modelbest.jobs.feishu.cn'&&(!url.port||url.port==='443');
      if(careerScope){
        driver=new FeishuCareerDriver({window:this.options.window,view:this.view,getProfile:this.options.getProfile,
          getGeneration:()=>this.generation,isVisible:()=>this.state.visible,deadline:performance.now()+6000,fixtureScripts:this.careerFixtureScripts});
        const original=await bounded(driver.read());
        const initial=this.careerPreview(buildCareerPlan(profile,original,{}));
        const preparation=prepareOneClickCareer(profile,initial);
        // A read never assigns several blank groups by array order. Nonempty,
        // uniquely matching groups are the only durable facts we reconcile.
        const bindings=original.groups.flatMap(group=>{
          const choice=preparation.choices[group.id];
          if(choice?.kind!=='bind'||!group.fields.some(field=>field.value.trim()))return [];
          const records=profile.career?.[group.collection].filter(record=>record.id===choice.recordId)??[];
          return records.length===1?[{collection:group.collection,recordId:choice.recordId,revision:records[0]!.revision,
            profileVersion:profile.version,groupId:group.id,groupSignature:group.signature}]:[];
        });
        const preserveGroupIds=original.groups.filter(group=>!bindings.some(binding=>binding.groupId===group.id)).map(group=>group.id);
        const plan=buildCareerPlan(profile,original,{bindings,preserveGroupIds,selectedRecordIds:preparation.selection});
        plan.steps=plan.steps.filter(step=>step.kind==='fill-group');
        for(const collection of new Set(original.groups.filter(group=>preserveGroupIds.includes(group.id)).map(group=>group.collection))){
          if(!plan.issues.some(issue=>issue.collection===collection&&!issue.recordId))plan.issues.push({collection,reason:'网页经历尚未能唯一对应到已确认资料，请核对区块；不会按空白组顺序猜测。'});
        }
        const latest=await bounded(driver.read());
        if(JSON.stringify(latest.groups)!==JSON.stringify(original.groups)||JSON.stringify(latest.protectedFields)!==JSON.stringify(original.protectedFields)
          ||latest.signature!==original.signature||latest.generation!==view.generation)throw new Error('读取期间页面变化，请再试一次。');
        career=this.careerPreview(plan);
      }
      const plan=annotateOrdinaryPlan(buildFillPlan(view.observation,profile),view.observation,profile);
      plan.items=plan.items.filter(item=>!careerScope||!!item.profileKey&&['fullName','fullNameEn','email','phone'].includes(item.profileKey));
      const [latest,latestProfile]=await Promise.all([bounded(this.observe()),bounded(this.options.getProfile())]);
      if(latestProfile.version!==profile.version||latest.generation!==view.generation||latest.observation.signature!==view.observation.signature
        ||latest.observation.url!==view.observation.url||JSON.stringify(latest.observation.fields.map(({id,value,checked})=>({id,value,checked})))
          !==JSON.stringify(view.observation.fields.map(({id,value,checked})=>({id,value,checked}))))throw new Error('读取期间网页或资料变化，请重新读取。');
      return {url:plan.url,profileVersion:profile.version,ordinary:plan,...(career?{career}:{})};
    } finally {driver?.dispose();this.preparing=false;}
  }

  /** Resolve one persisted issue from fresh host observations, never from a renderer selector. */
  async locateWorkflowIssue(issue:ApplicationWorkflowIssue,url:string,profileVersion:number):Promise<ApplicationFieldLocationResult>{
    if(this.preparing||this.filling||this.collecting)return {status:'blocked',message:'请等待当前操作结束再定位。'};
    this.preparing=true;let driver:FeishuCareerDriver|undefined;let input:ApplicationFieldLocationInput;let initialValues:string|undefined;
    const deadline=Date.now()+8000;
    const bounded=<T>(read:Promise<T>)=>this.readWithinDeadline(read,deadline);
    try{
      this.assertReadable();this.assertScrollVisible();this.applyZoom(100);
      const generation=this.generation,profile=await bounded(this.options.getProfile());
      if(this.view.webContents.getURL()!==url||profile.version!==profileVersion)throw new FieldLocationError('stale','页面或资料已变化，请重新读取提示。');
      if(issue.collection){
        driver=new FeishuCareerDriver({window:this.options.window,view:this.view,getProfile:this.options.getProfile,
          getGeneration:()=>this.generation,isVisible:()=>this.state.visible,deadline:performance.now()+6000,fixtureScripts:this.careerFixtureScripts});
        const current=await bounded(driver.read()),target=workflowCareerTarget(issue,current,profile);
        initialValues=JSON.stringify({groups:current.groups.map(group=>({id:group.id,fields:group.fields.map(field=>({id:field.id,value:field.value}))})),protected:current.protectedFields});
        const plan=buildCareerPlan(profile,current,{});
        this.locations.rememberCareer(plan);
        input={kind:'career',planId:plan.id,...target};
      }else{
        const current=await bounded(this.observe()),field=workflowOrdinaryTarget(issue,current.observation,profile),plan=buildFillPlan(current.observation,profile);
        initialValues=JSON.stringify(current.observation.fields.map(({id,value,checked})=>({id,value,checked})));
        this.locations.rememberOrdinary(plan,current.observation,current.generation);
        input={kind:'ordinary',planId:plan.id,fieldId:field.id};
      }
      if(generation!==this.generation||this.view.webContents.getURL()!==url||(await bounded(this.options.getProfile())).version!==profileVersion)
        throw new FieldLocationError('stale','页面或资料已变化，请重新读取提示。');
    }catch(error){return error instanceof FieldLocationError?{status:error.status,message:error.message}
      :{status:'blocked',message:'无法安全确定这个字段，请重新读取提示后再定位。'};
    }finally{driver?.dispose();this.preparing=false;}
    return this.locateApplicationField(input,initialValues);
  }

  /** Reveal a trusted observed field. This path has no click, key, value setter or write-plan creation. */
  async locateApplicationField(value: ApplicationFieldLocationInput, initialValues?:string): Promise<ApplicationFieldLocationResult> {
    let input: ApplicationFieldLocationInput;
    try { input = validateFieldLocationInput(value); }
    catch (error) { return { status: 'unsupported', message: error instanceof FieldLocationError ? error.message : '定位参数无效。' }; }
    if (this.preparing || this.filling || this.collecting) return { status: 'blocked', message: '请等待当前操作结束，再定位待处理字段。' };
    this.preparing = true;
    this.clearDecoration();
    const deadline = Date.now() + 6500, generation = this.generation, url = this.view.webContents.getURL();
    let blurred = false, driver: FeishuCareerDriver | undefined;
    const onBlur = () => { blurred = true; };
    this.options.window.on('blur', onBlur);
    const viewport = { ...this.bounds };
    // Only a host-resolved durable issue supplies this snapshot. IPC forwards
    // one argument; renderer parameters cannot replace the current-value guard.
    let baseline=initialValues, profileVersion: number | undefined;
    const guard = () => {
      this.assertReadable(); this.assertScrollVisible();
      if (blurred || Date.now() >= deadline || this.generation !== generation || this.view.webContents.getURL() !== url
        || this.bounds.x !== viewport.x || this.bounds.y !== viewport.y || this.bounds.width !== viewport.width || this.bounds.height !== viewport.height
        || this.view.webContents.getZoomFactor() !== 1) throw new FieldLocationError('blocked', '页面位置、焦点或可用区域变化，已停止定位。');
    };
    type Frame = { bounds: BrowserBounds; width: number; height: number; id: string; index?: number; value: string; values: string };
    try {
      this.assertReadable(); this.assertScrollVisible();
      this.applyZoom(100);
      if (input.kind === 'career') driver = new FeishuCareerDriver({ window: this.options.window, view: this.view,
        getProfile: this.options.getProfile, getGeneration: () => this.generation, isVisible: () => this.state.visible,
        deadline: performance.now() + 6200, fixtureScripts: this.careerFixtureScripts });
      const code = this.careerFixtureScripts ?? feishuScripts;
      const read = async (): Promise<Frame> => {
        guard();
        const profile = await this.readWithinDeadline(this.options.getProfile(), deadline);
        if (profileVersion !== undefined && profileVersion !== profile.version) throw new FieldLocationError('stale', '资料已变化，请重新读取待处理项。');
        profileVersion = profile.version;
        let frame: Frame;
        if (input.kind === 'ordinary') {
          const current = await this.readWithinDeadline(this.observe(), deadline);
          const field = this.locations.ordinaryTarget(input, current.observation, current.generation, profile.version);
          frame = { bounds: field.bounds, width: current.width, height: current.height, id: field.id, index: field.index, value: field.value,
            values: JSON.stringify(current.observation.fields.map(({ id, value, checked }) => ({ id, value, checked }))) };
        } else {
          const current = await this.readWithinDeadline(driver!.read(), deadline);
          const id = this.locations.careerTarget(input, current, profile.version);
          const target = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(code.readFeishuCareerTarget(id, 0, 0)), deadline));
          if (target.exists !== true || string(target.url) !== url) throw new FieldLocationError('stale', '这个字段已不在原来的网页位置，请重新读取。');
          const raw = record(target.field), bounds = record(raw.bounds);
          frame = { id, value: string(raw.value), bounds: { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) },
            width: this.bounds.width, height: this.bounds.height,
            values: JSON.stringify({ groups: current.groups.map(group => ({ id: group.id, fields: group.fields.map(field => ({ id: field.id, value: field.value })) })), protected: current.protectedFields }) };
        }
        baseline ??= frame.values;
        if (frame.values !== baseline || (await this.readWithinDeadline(this.options.getProfile(), deadline)).version !== profileVersion) {
          throw new FieldLocationError('stale', '定位期间网页内容或资料变化，已停止，请重新读取。');
        }
        guard(); return frame;
      };
      const uncovered = async (frame: Frame): Promise<boolean> => {
        guard(); const { bounds, width, height } = frame;
        const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        if (bounds.width <= 0 || bounds.height <= 0) throw new FieldLocationError('unsupported', '字段当前不可见，请重新读取页面。');
        const target = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(input.kind === 'ordinary'
          ? readTarget(frame.index!, x, y) : code.readFeishuCareerTarget(frame.id, x, y)), deadline));
        const currentValue = input.kind === 'ordinary' ? string(target.value) : string(record(target.field).value);
        if (target.exists !== true || string(target.url) !== url || currentValue !== frame.value) throw new FieldLocationError('stale', '字段内容已变化，请重新读取。');
        const fits=bounds.height>height-16||bounds.y>=8&&bounds.y+bounds.height<=height-8;
        guard(); return x>=0&&x<width&&y>=0&&y<height&&fits&&target.uncovered===true;
      };
      const sameLocation = (before: Frame, after: Frame) => before.id===after.id&&before.index===after.index
        &&before.width===after.width&&before.height===after.height
        &&(['x','y','width','height'] as const).every(key=>Math.abs(before.bounds[key]-after.bounds[key])<=.5);
      const confirmLocation = async (stable: Frame):Promise<Frame> => {
        const final=await read();
        if(!sameLocation(stable,final))throw new FieldLocationError('blocked','定位完成前字段又移动了，请重新定位。');
        if(!await uncovered(final))throw new FieldLocationError('blocked','目标被网页浮层遮挡，请先关闭菜单或弹窗再定位。');
        const confirmed=await read();
        if(!sameLocation(final,confirmed))throw new FieldLocationError('blocked','最终核对时字段位置变化，请重新定位。');
        guard();return confirmed;
      };
      const settledLocation = async (initial:Frame):Promise<Frame> => {
        let stableSince=Date.now(),previous=initial;const settleDeadline=Math.min(deadline,Date.now()+1400);
        while(Date.now()<settleDeadline){
          await delay(65);const current=await read();
          if(current.width!==previous.width||current.height!==previous.height
            ||Math.abs(current.bounds.width-previous.bounds.width)>1||Math.abs(current.bounds.height-previous.bounds.height)>1)
            throw new FieldLocationError('blocked','定位期间网页布局变化，请重新读取。');
          if(Math.abs(current.bounds.x-previous.bounds.x)>.5||Math.abs(current.bounds.y-previous.bounds.y)>.5)stableSince=Date.now();
          previous=current;
          if(Date.now()-stableSince>=130)return confirmLocation(current);
        }
        throw new FieldLocationError('blocked','页面仍在滚动，请等动画结束后再定位。');
      };
      let frame = await read();
      if(typeof this.view.webContents.executeJavaScriptInIsolatedWorld==='function'){
        // Viewport-only action, bound to this immediate whole-form observation.
        // The page gets no application bridge and no focus, click, key or value setter.
        const raw=await this.readWithinDeadline(this.view.webContents.executeJavaScript(input.kind==='ordinary'?READ_FORM:code.READ_FEISHU_CAREER),deadline);
        frame=await read();guard();
        const script=input.kind==='ordinary'?revealObservedField(frame.index!,locationObservationSnapshot(raw))
          :code.revealFeishuCareerField(frame.id,locationObservationSnapshot(raw));
        const response=record(await this.readWithinDeadline(this.view.webContents.executeJavaScriptInIsolatedWorld(9468,[{code:script}],false),deadline));
        guard();
        if(response.url!==url||response.reason==='changed'||response.reason==='missing')throw new FieldLocationError('stale','字段位置或内容已变化，请重新读取提示。');
        if(response.scrolled!==true)throw new FieldLocationError('blocked','这个字段暂时无法滚动定位，请先关闭弹层或展开对应区块。');
        const final=await settledLocation(frame);this.decorate({phase:'attention',bounds:final.bounds});
        return {status:'located',message:'已滚动并框出对应字段；没有修改网页内容。'};
      }
      if (await uncovered(frame)) { const final=await settledLocation(frame);this.decorate({phase:'attention',bounds:final.bounds});return { status: 'located', message: '已定位到这个字段，请在网页中处理；没有改写内容。' }; }
      this.view.webContents.focus(); // Only transfer focus within this already foreground application.
      for (let step = 0; step < 8; step++) {
        guard();
        if (!this.view.webContents.isFocused()) throw new FieldLocationError('blocked', '网页失去焦点，已停止定位。');
        const distance = frame.bounds.y + frame.bounds.height / 2 - frame.height / 2;
        if (Math.abs(distance) < 2) throw new FieldLocationError('blocked', '目标字段被浮层遮挡，请先关闭网页弹层再定位。');
        const surface = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(readLocationWheelTarget()), deadline));
        if (surface.exists !== true || string(surface.url) !== url) throw new FieldLocationError('blocked', '没有安全的网页滚动位置，请先点网页空白处或关闭下拉菜单。');
        const x = finite(surface.x), y = finite(surface.y);
        guard(); this.view.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
        await delay(25);
        const before = await read();
        const hover = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(readLocationWheelTarget({ x, y })), deadline));
        if (Math.abs(before.bounds.y - frame.bounds.y) > 1 || Math.abs(before.bounds.x - frame.bounds.x) > 1
          || hover.exists !== true || hover.url !== url || hover.pointerIdentity !== surface.pointerIdentity) throw new FieldLocationError('blocked', '滚动位置变化，已停止定位。');
        guard();
        if (!this.view.webContents.isFocused()) throw new FieldLocationError('blocked', '网页失去焦点，已停止定位。');
        this.view.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0,
          deltaY: -Math.max(-400, Math.min(400, distance)), hasPreciseScrollingDeltas: true });
        const settleDeadline = Math.min(deadline, Date.now() + 1100);
        let moved = false, settled = false, stableSince = Date.now(), stableY = before.bounds.y;
        while (Date.now() < settleDeadline) {
          await delay(65); frame = await read();
          if (Math.abs(frame.bounds.x - before.bounds.x) > 1 || Math.abs(frame.bounds.width - before.bounds.width) > 1
            || Math.abs(frame.bounds.height - before.bounds.height) > 1) throw new FieldLocationError('blocked', '网页布局变化，已停止定位。');
          moved ||= Math.abs(frame.bounds.y - before.bounds.y) > 1;
          if (Math.abs(frame.bounds.y - stableY) > 0.5) { stableY = frame.bounds.y; stableSince = Date.now(); }
          if (moved && Date.now() - stableSince >= 130) { settled = true; break; }
        }
        if (moved && !settled) throw new FieldLocationError('blocked', '页面仍在滚动，尚未完成定位；请等待动画结束再试。');
        if (settled && await uncovered(frame)) {
          const final=await confirmLocation(frame);this.decorate({phase:'attention',bounds:final.bounds});return { status: 'located', message: '已滚动到这个字段，请在网页中处理；没有改写内容。' };
        }
        if (!moved || Math.abs(frame.bounds.y + frame.bounds.height / 2 - frame.height / 2) >= Math.abs(distance) - 1) {
          throw new FieldLocationError('blocked', '网页没有继续滚动，请先关闭弹层或手动滚动后再定位。');
        }
      }
      return { status: 'blocked', message: '已到本次定位滚动上限，请手动接近这段经历后再点定位。' };
    } catch (error) {
      return error instanceof FieldLocationError ? { status: error.status, message: error.message }
        : { status: 'blocked', message: '当前页面未能安全定位，请保持申请页在前台，重新读取后再试。' };
    } finally {
      driver?.dispose(); this.options.window.removeListener('blur', onBlur); this.preparing = false;
    }
  }

  private careerOptions(value: CareerFillOptions | undefined, profile: Profile): CareerFillOptions {
    const kinds = ['educations', 'internships', 'projects'] as const;
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['profileVersion', 'selectedRecordIds', 'bindings', 'preserveGroupIds'].includes(key))
      || value.profileVersion !== profile.version)) throw new Error('履历参数或资料版本已变化，请重新核对。');
    const options = value ?? { profileVersion: profile.version };
    const ids = (entries: unknown, maximum = 30): entries is string[] => Array.isArray(entries) && entries.length <= maximum
      && entries.every(id => typeof id === 'string' && id.length > 0 && id.length <= 300) && new Set(entries).size === entries.length;
    if (options.selectedRecordIds !== undefined && (!options.selectedRecordIds || typeof options.selectedRecordIds !== 'object'
      || Array.isArray(options.selectedRecordIds) || Object.keys(options.selectedRecordIds).some(key => !kinds.includes(key as typeof kinds[number]))
      || Object.values(options.selectedRecordIds).some(entries => !ids(entries)))) throw new Error('所选履历列表无效。');
    if (options.preserveGroupIds !== undefined && !ids(options.preserveGroupIds, 90)) throw new Error('保留的网页经历组无效。');
    if (options.bindings !== undefined && (!Array.isArray(options.bindings) || options.bindings.length > 90
      || options.bindings.some(binding => !binding || typeof binding !== 'object' || Array.isArray(binding)
        || Object.keys(binding).length !== 6 || !kinds.includes(binding.collection)
        || !ids([binding.recordId]) || !ids([binding.groupId]) || !Number.isInteger(binding.revision) || binding.revision < 1
        || binding.profileVersion !== profile.version || typeof binding.groupSignature !== 'string'
        || !/^[a-f0-9]{64}$/u.test(binding.groupSignature)))) throw new Error('网页与履历的对应关系无效。');
    const selectedRecordIds = Object.fromEntries(kinds.map(kind => [kind, options.selectedRecordIds?.[kind]
      ?? (options.selectedRecordIds !== undefined ? [] : profile.career?.[kind].filter(item => item.confirmation === 'confirmed' && item.confirmedRevision === item.revision
        && !!item.confirmedAt).map(item => item.id) ?? [])]));
    return structuredClone({ profileVersion: profile.version, selectedRecordIds,
      bindings: options.bindings ?? [], preserveGroupIds: options.preserveGroupIds ?? [] });
  }

  async prepareCareerFill(options?: CareerFillOptions): Promise<CareerFillPreview> {
    if (this.preparing || this.filling || this.collecting) throw new Error('请等待当前浏览器操作结束。');
    this.careerDiagnostic = undefined;
    this.preparing = true; this.careerPlans.clear(); this.plans.clear();
    const preparation = new AbortController(); this.careerAbort = preparation;
    let activeDriver: FeishuCareerDriver | undefined;
    try {
      this.applyZoom(100);
      const driver = new FeishuCareerDriver({ window: this.options.window, view: this.view,
        getProfile: this.options.getProfile, getGeneration: () => this.generation, isVisible: () => this.state.visible,
        signal: preparation.signal, deadline: performance.now() + 6000, fixtureScripts: this.careerFixtureScripts });
      activeDriver = driver;
      const profile = await driver.getProfile();
      const settings = this.careerOptions(options, profile);
      const original = await driver.read();
      const plan = buildCareerPlan(profile, original, settings);
      const latest = await driver.read();
      if (latest.signature !== original.signature || JSON.stringify(latest.groups) !== JSON.stringify(original.groups)
        || JSON.stringify(latest.addControls) !== JSON.stringify(original.addControls)
        || JSON.stringify(latest.protectedFields) !== JSON.stringify(original.protectedFields)
        || (await driver.getProfile()).version !== plan.profileVersion) throw new Error('准备期间网页或资料变化，请重新核对。');
      if (preparation.signal.aborted) throw new Error('履历识别已停止，请重新读取。');
      this.careerPlans.set(plan.id, { plan, createdAt: Date.now() });
      this.locations.rememberCareer(plan);
      return { planId: plan.id, url: plan.url, profileVersion: plan.profileVersion,
        groups: original.groups.map(group => ({ id: group.id, collection: group.collection, signature: group.signature,
          fields: group.fields.map(field => ({ id: field.id, key: field.key, type: field.type, value: field.value,
            signature: field.signature,
            editable: field.editable, ...(field.required !== undefined ? { required: field.required } : {}),
            ...(field.supportsUntilNow === true ? { supportsUntilNow: true } : {}) })) })),
        bindings: structuredClone(plan.bindings), selectedRecordIds: settings.selectedRecordIds ?? {},
        preserveGroupIds: settings.preserveGroupIds ?? [], issues: structuredClone(plan.issues),
        steps: plan.steps.map(step => step.kind === 'fill-group'
          ? { kind: step.kind, collection: step.binding.collection, recordId: step.binding.recordId,
            groupId: step.binding.groupId, items: step.items.map(item=>({...structuredClone(item),required:original.groups.find(group=>group.id===step.binding.groupId)?.fields.find(field=>field.id===item.fieldId)?.required})) }
          : { kind: step.kind, collection: step.collection, recordId: step.recordId }) };
    } finally {
      preparation.abort(); this.careerDiagnostic = activeDriver?.getSummary(); activeDriver?.dispose();
      if (this.careerAbort === preparation) this.careerAbort = undefined;
      this.preparing = false;
    }
  }

  cancelCareerFill(): void { this.careerPlans.clear(); this.careerAbort?.abort(); }

  /** Local host diagnostics only; not exposed over IPC or to a model. */
  getCareerDiagnostics(): ReturnType<FeishuCareerDriver['getSummary']> | undefined {
    return this.careerDiagnostic ? structuredClone(this.careerDiagnostic) : undefined;
  }

  async runCareerFill(planId: string, journal?: (event: CareerRunnerJournalEvent) => Promise<void>): Promise<CareerFillOutcome> {
    if (typeof planId !== 'string' || this.preparing || this.filling || this.collecting) throw new Error('请等待当前浏览器操作结束。');
    this.careerDiagnostic = undefined;
    const stored = this.careerPlans.get(planId);
    if (!stored || Date.now() - stored.createdAt > 10 * 60_000) throw new Error('履历预览已失效，请重新核对。');
    if (!this.state.visible || !this.options.window.isFocused()) throw new Error('请先将目标申请页保持在前台。');
    this.careerPlans.delete(planId); this.plans.clear();
    this.filling = true; this.fillInterrupted = false;
    const controller = new AbortController(); this.careerAbort = controller;
    const onBlur = () => { this.fillInterrupted = true; controller.abort(); };
    this.options.window.on('blur', onBlur);
    const deadline = performance.now() + 600_000;
    let activeDriver: FeishuCareerDriver | undefined;
    try {
      const driver = new FeishuCareerDriver({ window: this.options.window, view: this.view,
        getProfile: this.options.getProfile, getGeneration: () => this.generation, isVisible: () => this.state.visible,
        signal: controller.signal, deadline, fixtureScripts: this.careerFixtureScripts, onFieldActivity: target => this.decorate(target) });
      activeDriver = driver;
      const current = await driver.read(), profile = await driver.getProfile(), previous = stored.plan.original;
      if (profile.version !== stored.plan.profileVersion || current.url !== previous.url || current.generation !== previous.generation
        || current.signature !== previous.signature || JSON.stringify(current.groups) !== JSON.stringify(previous.groups)
        || JSON.stringify(current.addControls) !== JSON.stringify(previous.addControls)
        || JSON.stringify(current.protectedFields) !== JSON.stringify(previous.protectedFields)) throw new Error('网页或履历在预览后变化，请重新核对。');
      await driver.start();
      const result = await runCareerPlan({ read: () => driver.read(), getProfile: () => driver.getProfile(),
        assertActive: () => { this.assertScrollVisible(); driver.assertActive(); }, signal: controller.signal,
        add: (step, plan) => driver.add(step, plan), fill: (step, item, plan) => driver.fill(step, item, plan), journal },
      { ...stored.plan.options, maxActions: 100, maxFillRetries: this.options.fillRetryLimit ?? 0, timeoutMs: Math.max(1, deadline - performance.now()) });
      const failure = driver.getSummary().lastFailure;
      this.locations.bindCareerResult(planId, result.bindings);
      return { status: result.status, addedCount: result.added.length, verifiedCount: result.verified.length,
        ...(result.retriesAttempted ? { retryCount: result.retriesAttempted } : {}),
        pending: result.pending, bindings: result.bindings, ...(result.stopReason ? { stopReason: result.stopReason } : {}),
        ...(result.status !== 'completed' && failure && failure.reason !== 'unclassified' ? { failureMessage: failure.reason } : {}) };
    } finally {
      this.clearDecoration(); controller.abort(); this.careerDiagnostic = activeDriver?.getSummary(); activeDriver?.dispose(); this.options.window.removeListener('blur', onBlur);
      this.careerAbort = undefined;
      if (activeDriver?.hasPendingMutation() && !this.view.webContents.isDestroyed()) {
        // A timeout cannot cancel an insert already handed to Electron. Keep all
        // later agent writes locked until that exact native promise settles or
        // its destination is destroyed; never reuse its authorization.
        const unlock = () => { this.filling = false; this.view.webContents.removeListener('destroyed', unlock); };
        this.view.webContents.once('destroyed', unlock);
        void activeDriver.waitForPendingMutation().then(unlock);
      } else this.filling = false;
    }
  }

  private async approvedField(stored: StoredPlan, fieldId: string, original: FieldObservation, currentValue: string): Promise<{ view: ObservationView; field: FieldObservation }> {
    const profile = await this.options.getProfile();
    const view = await this.observe();
    const field = view.observation.fields.find(candidate => candidate.id === fieldId);
    if (profile.version !== stored.plan.profileVersion || view.generation !== stored.generation
      || view.observation.url !== stored.plan.url || view.observation.signature !== stored.original.signature
      || !field || field.signature !== original.signature || !field.editable || field.value !== currentValue) {
      throw new Error('资料或页面在填写期间变化，请重新预览剩余字段。');
    }
    return { view, field };
  }

  private assertScrollVisible(): void {
    // A click in the application renderer may not yet give the remote view
    // focus on macOS. Wheel input needs the visible foreground window; the
    // stricter remote-view and element focus checks still guard all typing.
    if ((this.filling && this.fillInterrupted) || !this.state.visible || !this.options.window.isFocused()) {
      throw new Error('浏览器已隐藏或失去焦点，请重新确认后操作。');
    }
  }

  /** Popup transitions cannot hide changes to any other field's current value. */
  private async comboGuard(stored: StoredPlan, original: FieldObservation, value: string, baseline: ObservationView) {
    this.assertScrollVisible();
    if (!this.view.webContents.isFocused()) throw new Error('选择期间网页失去原生焦点，请核实后重新预览。');
    const current = await this.approvedField(stored, original.id, original, value);
    if (current.view.width !== baseline.width || current.view.height !== baseline.height
      || baseline.observation.fields.some(before => before.id !== original.id
        && current.view.observation.fields.find(field => field.id === before.id)?.value !== before.value)) {
      throw new Error('展开或选择期间其他字段内容或浏览器尺寸变化，请重新预览。');
    }
    this.assertScrollVisible();
    if (!this.view.webContents.isFocused()) throw new Error('选择期间网页失去原生焦点，请重新预览。');
    return current;
  }

  private async comboPopup(original: FieldObservation, url: string, value: string): Promise<ComboPopup | undefined> {
    const binding = original.customSelect;
    if (!binding) throw new Error('自定义下拉没有可核实的单选关联。');
    const raw = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(
      readComboboxPopup(original.index, binding.popupId)), Date.now() + 700));
    const owner = record(raw.owner);
    if (string(raw.url) !== url || owner.exists !== true || owner.disabled !== false
      || owner.popupId !== binding.popupId || owner.value !== value
      || typeof owner.identity !== 'string' || !owner.identity || owner.identity.length > 4000) {
      throw new Error('自定义下拉的关联、原值或页面变化，请重新预览。');
    }
    if (raw.popup === null) return undefined;
    const popup = record(raw.popup);
    if (owner.expanded !== true || popup.id !== binding.popupId || popup.multi !== false
      || typeof popup.identity !== 'string' || !popup.identity || popup.identity.length > 8000
      || !Array.isArray(popup.options) || popup.options.length > 500) throw new Error('无法核实唯一关联的单选菜单。');
    const indexes = new Set<number>();
    const options: ComboOption[] = [];
    for (const entry of popup.options) {
      const option = record(entry);
      // The DOM reader omits disabled entries. Still enforce this boundary in the host.
      if (option.disabled === true) continue;
      const index = finite(option.index), bounds = record(option.bounds);
      if (option.disabled !== false || !Number.isInteger(index) || index < 0 || index >= 500 || indexes.has(index)
        || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 240
        || typeof option.identity !== 'string' || !option.identity || option.identity.length > 16000
        || typeof option.id !== 'string' || option.id.length > 500) throw new Error('自定义下拉选项数据无效。');
      indexes.add(index);
      const area = { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) };
      if (area.width <= 0 || area.height <= 0) throw new Error('自定义下拉选项没有可点击的范围。');
      options.push({ index, id: option.id, label: option.label, identity: option.identity, selected: option.selected === true, bounds: area });
    }
    const identity = popup.identity;
    const fingerprint = createHash('sha256').update(JSON.stringify([owner.identity, identity,
      options.map(({ index, id, label, identity, selected }) => ({ index, id, label, identity, selected }))])).digest('hex');
    return { ownerIdentity: owner.identity, identity, fingerprint, options };
  }

  /** A bounded native click/observe/click/verify cycle, within one approved field. */
  private async chooseCustomSelect(stored: StoredPlan, item: FillItem, original: FieldObservation, baseline: ObservationView): Promise<void> {
    const binding = original.customSelect;
    if (!binding) throw new Error('此自定义下拉暂不支持安全选择。');
    const deadline = Date.now() + 700;
    let popup: ComboPopup | undefined;
    for (let attempt = 0; attempt < 12 && Date.now() <= deadline; attempt++) {
      await this.comboGuard(stored, original, item.currentValue, baseline);
      popup = await this.comboPopup(original, stored.plan.url, item.currentValue);
      if (popup?.options.length) break;
      await delay(50);
    }
    if (!popup?.options.length) throw new Error('没有在限定时间内读到可核实的真实单选菜单，请手动选择。');
    // Only the real label can match a profile value, never an invented option index.
    const match = matchSelectOption(item.value, popup.options.map(option => ({ label: option.label, value: option.label })), item.profileKey);
    const chosen = match && popup.options.find(option => option.label === match.label);
    if (!chosen) throw new Error('没有唯一匹配的真实菜单选项，未选择任何选项。');
    const { bounds } = chosen, x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    if (x <= 0 || y <= 0 || x >= baseline.width || y >= baseline.height) throw new Error('匹配选项不在可核实的可见范围内，请手动滚动菜单。');
    const target = async () => record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(
      readComboboxOptionTarget(original.index, binding.popupId, chosen.index, x, y)), Date.now() + 700));
    const verifyHit = (hit: Record<string, unknown>) => {
      if (hit.exists !== true || hit.uncovered !== true || hit.expanded !== true
        || hit.url !== stored.plan.url || hit.value !== item.currentValue || hit.identity !== chosen.identity
        || hit.ownerIdentity !== popup!.ownerIdentity || hit.popupIdentity !== popup!.identity
        || hit.popupId !== binding.popupId || hit.label !== chosen.label || hit.id !== chosen.id) {
        throw new Error('真实菜单选项的身份、遮挡或原值变化，没有继续点击。');
      }
    };
    verifyHit(await target());
    await this.comboGuard(stored, original, item.currentValue, baseline);
    const zoom = this.view.webContents.getZoomFactor();
    const point = { x: Math.round(x * zoom), y: Math.round(y * zoom), button: 'left' as const, clickCount: 1 };
    this.assertScrollVisible();
    this.view.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    await delay(35);
    await this.comboGuard(stored, original, item.currentValue, baseline);
    const hovered = await this.comboPopup(original, stored.plan.url, item.currentValue);
    const hoveredOption = hovered?.options.find(option => option.index === chosen.index);
    if (!hovered || hovered.fingerprint !== popup.fingerprint || !hoveredOption
      || (['x', 'y', 'width', 'height'] as const).some(key => Math.abs(hoveredOption.bounds[key] - bounds[key]) > 0.5)) {
      throw new Error('移动指针后菜单选项或布局变化，没有继续点击。');
    }
    await this.comboGuard(stored, original, item.currentValue, baseline);
    // Recheck the hit after all asynchronous page/profile guards, immediately
    // before native input; a vanished menu must never expose an underlying button.
    verifyHit(await target());
    this.assertScrollVisible();
    if (!this.view.webContents.isFocused() || this.generation !== stored.generation
      || this.view.webContents.getURL() !== stored.plan.url) throw new Error('点击选项前页面或焦点变化，没有继续点击。');
    this.view.webContents.sendInputEvent({ type: 'mouseDown', ...point });
    this.view.webContents.sendInputEvent({ type: 'mouseUp', ...point });
    const commitDeadline = Date.now() + 700;
    let stableSince: number | undefined;
    for (let attempt = 0; attempt < 12 && Date.now() <= commitDeadline; attempt++) {
      await delay(50);
      this.assertScrollVisible();
      const current = await this.observe();
      const field = current.observation.fields.find(candidate => candidate.id === original.id);
      if (!field || field.value !== item.currentValue && !isVerifiedValue(field.value, chosen.label, 'combobox')) throw new Error('网页在选择后出现了非预期值，请人工核实。');
      await this.comboGuard(stored, original, field.value, baseline);
      if (!isVerifiedValue(field.value, chosen.label, 'combobox')) { stableSince = undefined; continue; }
      stableSince ??= Date.now();
      const final = record(await this.readWithinDeadline(this.view.webContents.executeJavaScript(
        readComboboxPopup(original.index, binding.popupId)), commitDeadline));
      const owner = record(final.owner);
      const expanded = owner.expanded === true;
      const stillPopup = final.popup === null ? undefined : record(final.popup);
      const selected = stillPopup && Array.isArray(stillPopup.options) && stillPopup.options.some(entry => {
        const candidate = record(entry); return candidate.index === chosen.index && candidate.label === chosen.label && candidate.selected === true;
      });
      if (final.url !== stored.plan.url || owner.exists !== true || owner.disabled !== false
        || owner.identity !== popup.ownerIdentity || owner.popupId !== binding.popupId || owner.value !== field.value
        || expanded && (!stillPopup || stillPopup.id !== binding.popupId || stillPopup.multi !== false || !selected)) {
        throw new Error('网页未确认这次菜单选择，请人工核实。');
      }
      const validity = record(await this.readTargetChecked(original.index,
        field.bounds.x + field.bounds.width / 2, field.bounds.y + field.bounds.height / 2, 'verify-validity'));
      await this.comboGuard(stored, original, field.value, baseline);
      if (validity.url !== stored.plan.url || validity.value !== field.value || validity.valid !== true) throw new Error('网页将已选内容标记为无效，请核实。');
      if (Date.now() - stableSince >= 120) return;
    }
    throw new Error('网页没有保留已点击的真实选项，结果需要人工核实。');
  }

  private samePosition(a: { view: ObservationView; field: FieldObservation }, b: typeof a): boolean {
    return a.view.width === b.view.width && a.view.height === b.view.height
      && (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(a.field.bounds[key] - b.field.bounds[key]) <= 0.5);
  }

  private async readWithinDeadline<T>(read: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('网页没有在限定时间内完成焦点检查，没有发送个人资料。')), Math.max(0, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }

  /** A failed target read is diagnosed once, never recovered into an input authorization. */
  private async readTargetChecked(index: number, x: number, y: number, stage: FillExecutionStage = 'hit-field'): Promise<unknown> {
    const source = readTarget(index, x, y);
    try { return await this.view.webContents.executeJavaScript(source); }
    catch {
      let errorName = '未知', line = 0, illegalInvocation = false;
      try {
        // The original reader is embedded verbatim. Its result (including any
        // field value or URL) is discarded; only fixed diagnostic fields leave
        // this page-local catch. Anonymous line numbers refer to this wrapper.
        const diagnostic = await this.readWithinDeadline(this.view.webContents.executeJavaScript(`(() => { /* offeragent-read-target-diagnostic */
          try {
            ${source};
            return { errorName: 'NotReproduced', line: 0, illegalInvocation: false };
          } catch (error) {
            const names = ['TypeError','ReferenceError','SyntaxError','RangeError','EvalError','URIError','Error','DOMException','SecurityError','InvalidStateError','NotAllowedError','AbortError','TimeoutError'];
            const name = error && typeof error.name === 'string' && names.includes(error.name) ? error.name : 'Unknown';
            const stack = error && typeof error.stack === 'string' ? error.stack.slice(0, 4000) : '';
            const location = /(?:^|[\\s(])(?:<anonymous>|VM\\d+):(\\d{1,6}):\\d{1,6}(?:\\)|\\s|$)/m.exec(stack);
            const line = location ? Number(location[1]) : 0;
            const illegalInvocation = Boolean(error && typeof error.message === 'string' && error.message.includes('Illegal invocation'));
            return { errorName: name, line, illegalInvocation };
          }
        })()`), Date.now() + 1500);
        if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
          const data = diagnostic as Record<string, unknown>;
          const names = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError', 'URIError', 'Error', 'DOMException',
            'SecurityError', 'InvalidStateError', 'NotAllowedError', 'AbortError', 'TimeoutError'];
          errorName = data.errorName === 'NotReproduced' ? '未复现' : typeof data.errorName === 'string' && names.includes(data.errorName) ? data.errorName : '未知';
          line = Number.isInteger(data.line) && Number(data.line) > 0 && Number(data.line) <= 999999 ? Number(data.line) : 0;
          illegalInvocation = data.illegalInvocation === true;
        }
      } catch { /* A second read failure contributes no raw error information. */ }
      throw new Error(`网页目标读取失败（阶段：${stage}；类型：${errorName}；行号：${line || '未知'}${illegalInvocation ? '；代码：ILLEGAL_INVOCATION' : ''}）。已停止此项填写。`);
    }
  }

  /** Only observe a fixed viewport point; never invoke page code or alter DOM. */
  private async pointerSurface(x: number, y: number, url: string): Promise<string> {
    const hit = record(await this.view.webContents.executeJavaScript(`(() => {
      const hit = document.elementFromPoint(${x}, ${y});
      const path = []; let node = hit;
      for (let depth = 0; node && depth < 24; depth++, node = node.parentElement) {
        const tagName = typeof node.tagName === 'string' ? node.tagName : '';
        path.push([tagName, node.getAttribute('id') || '', node.parentElement ? Array.from(node.parentElement.children).indexOf(node) : -1]);
      }
      return { exists: Boolean(hit), pointerIdentity: JSON.stringify(path), url: location.href };
    })()`));
    if (hit.exists !== true || string(hit.url) !== url || this.view.webContents.getURL() !== url || typeof hit.pointerIdentity !== 'string') {
      throw new Error('无法核实原生滚动位置的网页内容，请重新预览。');
    }
    return hit.pointerIdentity;
  }

  private async waitForViewFocus(stored: StoredPlan, original: FieldObservation, currentValue: string): Promise<void> {
    const deadline = Date.now() + 600;
    for (let sample = 0; sample < 25; sample++) {
      this.assertScrollVisible();
      await this.readWithinDeadline(this.approvedField(stored, original.id, original, currentValue), deadline);
      this.assertScrollVisible();
      if (Date.now() > deadline) break;
      if (this.view.webContents.isFocused()) return;
      if (sample === 24 || Date.now() >= deadline) break;
      await delay(Math.min(25, deadline - Date.now()));
    }
    throw new Error('网页没有在限定时间内获得原生焦点，没有发送个人资料。');
  }

  /** Native Tab/focus may scroll a control that is already in the viewport. */
  private async waitForFieldPosition(stored: StoredPlan, original: FieldObservation, currentValue: string,
    initial: { view: ObservationView; field: FieldObservation }): Promise<typeof initial> {
    const deadline = Date.now() + 1600;
    let stableY = initial.field.bounds.y, stableSince = Date.now();
    for (let sample = 0; sample < 33; sample++) {
      this.assertScrollVisible();
      if (!this.view.webContents.isFocused()) throw new Error('等待字段位置稳定期间网页失去原生焦点，请重新预览剩余字段。');
      const current = await this.readWithinDeadline(this.approvedField(stored, original.id, original, currentValue), deadline);
      const profile = await this.readWithinDeadline(this.options.getProfile(), deadline);
      this.assertScrollVisible();
      if (!this.view.webContents.isFocused()) throw new Error('等待字段位置稳定期间网页失去原生焦点，请重新预览剩余字段。');
      if (profile.version !== stored.plan.profileVersion || this.generation !== stored.generation || this.view.webContents.getURL() !== stored.plan.url) {
        throw new Error('等待字段位置稳定期间资料或页面变化，请重新预览剩余字段。');
      }
      if (current.view.width !== initial.view.width || current.view.height !== initial.view.height
        || (['x', 'width', 'height'] as const).some(key => Math.abs(current.field.bounds[key] - initial.field.bounds[key]) > 0.5)) {
        throw new Error('等待字段位置稳定期间页面布局变化，请重新预览剩余字段。');
      }
      if (Math.abs(current.field.bounds.y - stableY) > 0.5) { stableY = current.field.bounds.y; stableSince = Date.now(); }
      if (Date.now() > deadline) break;
      if (Date.now() - stableSince >= 120) return current;
      if (sample === 32 || Date.now() >= deadline) break;
      await delay(Math.min(50, deadline - Date.now()));
    }
    throw new Error('字段位置在限定时间内仍未稳定，没有继续移动指针或填写。');
  }

  private async waitForTargetFocus(stored: StoredPlan, original: FieldObservation, currentValue: string,
    initial: { view: ObservationView; field: FieldObservation }): Promise<typeof initial> {
    const deadline = Date.now() + 600;
    let stablePosition = initial, stableSince = Date.now();
    for (let sample = 0; sample < 25; sample++) {
      this.assertScrollVisible();
      const current = await this.readWithinDeadline(this.approvedField(stored, original.id, original, currentValue), deadline);
      const { field } = current, x = field.bounds.x + field.bounds.width / 2, y = field.bounds.y + field.bounds.height / 2;
      const target = record(await this.readWithinDeadline(this.readTargetChecked(field.index, x, y, 'focus-target'), deadline));
      this.assertScrollVisible();
      if (target.exists !== true || string(target.url) !== stored.plan.url || string(target.value) !== currentValue) {
        throw new Error('获得焦点期间页面或字段原值变化，没有发送个人资料。');
      }
      if (!this.samePosition(stablePosition, current)) { stablePosition = current; stableSince = Date.now(); }
      if (Date.now() > deadline) break;
      if (target.focused === true && target.uncovered === true && this.view.webContents.isFocused()
        && Date.now() - stableSince >= 35) return current;
      if (sample === 24 || Date.now() >= deadline) break;
      await delay(Math.min(25, deadline - Date.now()));
    }
    throw new Error('无法在限定时间内确认稳定的字段焦点，没有发送个人资料。');
  }

  /** Reveal only this approved control through bounded native wheel input. */
  private async revealApprovedField(stored: StoredPlan, original: FieldObservation, currentValue: string,
    initial: { view: ObservationView; field: FieldObservation }): Promise<{ view: ObservationView; field: FieldObservation }> {
    let current = initial;
    const inspect = async ({ view, field }: typeof initial): Promise<{ distance: number; uncovered: boolean }> => {
      this.assertScrollVisible();
      const centerX = field.bounds.x + field.bounds.width / 2;
      const centerY = field.bounds.y + field.bounds.height / 2;
      if (view.width < 4 || view.height < 4 || field.bounds.width <= 0 || field.bounds.height <= 0
        || centerX < 0 || centerX >= view.width) throw new Error('字段横向位置或浏览器区域无效，请手动处理。');
      const hit = record(await this.readTargetChecked(field.index, centerX, centerY, 'reveal-field'));
      if (hit.exists !== true || string(hit.url) !== stored.plan.url || string(hit.value) !== currentValue
        || this.generation !== stored.generation || this.view.webContents.getURL() !== stored.plan.url
        || (await this.options.getProfile()).version !== stored.plan.profileVersion) {
        throw new Error('滚动期间页面、字段原值或资料变化，请重新预览剩余字段。');
      }
      this.assertScrollVisible();
      return { distance: Math.abs(centerY - view.height / 2),
        uncovered: centerY >= 0 && centerY < view.height && hit.uncovered === true };
    };
    let target = await inspect(current);
    if (target.uncovered) return current;
    for (let attempt = 0; attempt < 8; attempt++) {
      const remaining = target.distance;
      if (remaining <= 2) throw new Error('字段滚到可见区域中间后仍被遮挡，请手动处理。');
      this.assertScrollVisible();
      const { view, field } = current;
      const centerY = field.bounds.y + field.bounds.height / 2;
      const pixels = Math.max(-400, Math.min(400, centerY - view.height / 2));
      const zoom = this.view.webContents.getZoomFactor();
      const pointerX = field.bounds.x + field.bounds.width / 2, pointerY = view.height / 2;
      const surface = await this.pointerSurface(pointerX, pointerY, stored.plan.url);
      this.assertScrollVisible();
      this.view.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(pointerX * zoom), y: Math.round(pointerY * zoom) });
      await delay(20);
      const hovered = await this.approvedField(stored, original.id, original, currentValue);
      this.assertScrollVisible();
      if (!this.view.webContents.isFocused()) throw new Error('移动指针后网页原生焦点变化，请重新预览剩余字段。');
      if (!this.samePosition(current, hovered)) throw new Error('移动指针后待填字段位置或浏览器尺寸变化，请重新预览剩余字段。');
      if (await this.pointerSurface(pointerX, pointerY, stored.plan.url) !== surface) {
        throw new Error('移动指针后滚动点命中的网页元素变化，请重新预览剩余字段。');
      }
      if ((await this.options.getProfile()).version !== stored.plan.profileVersion) throw new Error('移动指针后资料版本变化，请重新预览剩余字段。');
      if (this.generation !== stored.generation) throw new Error('移动指针后网页导航代次变化，请重新预览剩余字段。');
      if (this.view.webContents.getURL() !== stored.plan.url) throw new Error('移动指针后网页地址变化，请重新预览剩余字段。');
      this.assertScrollVisible();
      // Electron wheel deltas are opposite document scroll offsets. Precise
      // pixel deltas avoid macOS converting this into large line/page steps.
      this.view.webContents.sendInputEvent({ type: 'mouseWheel',
        x: Math.round((field.bounds.x + field.bounds.width / 2) * zoom), y: Math.round(view.height / 2 * zoom),
        deltaX: 0, deltaY: -pixels, hasPreciseScrollingDeltas: true });
      // Some sites animate native wheels (for example Lenis). A queued or still
      // moving frame is neither failed scrolling nor a stable place to click.
      // Observe within a fixed deadline; all original guards remain active at
      // every sample, and no additional wheel is sent until this one settles.
      const settleDeadline = Date.now() + 2000;
      let stableSince = Date.now(), stableY = field.bounds.y, moved = false, settled = false;
      for (let sample = 0; sample < 20 && Date.now() < settleDeadline; sample++) {
        this.assertScrollVisible();
        await delay(Math.min(100, Math.max(1, settleDeadline - Date.now())));
        const next = await this.approvedField(stored, original.id, original, currentValue);
        this.assertScrollVisible();
        if (next.view.width !== view.width || next.view.height !== view.height
          || Math.abs(next.field.bounds.width - field.bounds.width) > 1 || Math.abs(next.field.bounds.height - field.bounds.height) > 1
          || Math.abs(next.field.bounds.x - field.bounds.x) > 1) throw new Error('滚动期间页面布局变化，请重新预览剩余字段。');
        target = await inspect(next);
        moved ||= Math.abs(next.field.bounds.y - field.bounds.y) > 1;
        if (Math.abs(next.field.bounds.y - stableY) > 0.5) {
          stableY = next.field.bounds.y;
          stableSince = Date.now();
        }
        current = next;
        if (moved && Date.now() <= settleDeadline && Date.now() - stableSince >= 200) { settled = true; break; }
      }
      if (!settled) {
        if (!moved) throw new Error('原生滚动没有使字段接近可见区域中间，请手动滚动后重新预览。');
        throw new Error('原生滚动等待后字段位置仍未稳定，请手动处理并重新预览。');
      }
      if (target.distance >= remaining - 1) throw new Error('原生滚动没有使字段接近可见区域中间，请手动滚动后重新预览。');
      if (target.uncovered) return current;
    }
    throw new Error('已达到本字段的原生滚动次数上限，请手动滚动后重新预览。');
  }

  async fillApproved(planId: string, fieldIds: string[]): Promise<FillResult> {
    if (this.preparing) throw new Error('请等待字段识别结束再填写。');
    if (this.filling) throw new Error('已有填写任务正在执行。');
    if (this.collecting) throw new Error('请等待官网采集结束再填写。');
    if (this.view.webContents.getZoomFactor() !== 1) throw new Error('网页缩放已变化，请重新识别后填写。');
    const stored = this.plans.get(planId);
    if (!stored || Date.now() - Date.parse(stored.plan.createdAt) > 10 * 60_000) throw new Error('填写预览已过期，请重新生成。');
    if (!this.state.visible) throw new Error('请先显示浏览器，再执行你批准的字段。');
    this.filling = true;
    this.fillInterrupted = false;
    const onBlur = () => { this.fillInterrupted = true; };
    this.options.window.on?.('blur', onBlur);
    const result: FillResult = { planId, verified: [], unresolved: [] };
    try {
      const current = await this.observe();
      const profile = await this.options.getProfile();
      if (stored.generation !== current.generation) throw new Error('网页已重新加载，请生成新预览。');
      const selected = validateApprovedFields(stored.plan, stored.original, current.observation, profile.version, fieldIds);
      this.plans.delete(planId); // A preview is used once, including partial/uncertain outcomes.
      this.assertScrollVisible();
      this.options.window.focus();
      this.view.webContents.focus();
      let startupFocus: Promise<void> | undefined;
      fieldsLoop: for (const { item, field: originalField } of selected) {
        for (let attempt = 0; ; attempt++) {
        let stage: FillExecutionStage = 'read-field';
        let attemptBaseline: FormObservation | undefined;
        try {
          const initial = await this.approvedField(stored, item.fieldId, originalField, item.currentValue);
          attemptBaseline = initial.view.observation;
          if (initial.field.type === 'date') {
            result.unresolved.push({ fieldId: item.fieldId, label: item.label, reason: '这是原生分段日期控件，此版尚未验证其区域格式，请手动填写；不会补出未知日期。' });
            continue fieldsLoop;
          }
          if (initial.field.type === 'combobox' && !initial.field.customSelect) throw new Error('此自定义下拉没有可核实的单选关联，请手动选择。');
          stage = 'focus-view';
          await (startupFocus ??= this.waitForViewFocus(stored, originalField, item.currentValue));
          stage = 'settle-field';
          const positioned = await this.waitForFieldPosition(stored, originalField, item.currentValue,
            await this.approvedField(stored, item.fieldId, originalField, item.currentValue));
          stage = 'reveal-field';
          const revealed = await this.revealApprovedField(stored, originalField, item.currentValue, positioned);
          let { field } = revealed;
          const { x, y, width, height } = field.bounds;
          const centerX = x + width / 2;
          const centerY = y + height / 2;
          stage = 'hit-field';
          const before = record(await this.readTargetChecked(field.index, centerX, centerY, 'hit-field'));
          if (before.uncovered !== true) throw new Error('字段被其他内容遮挡，请手动处理。');
          const zoom = this.view.webContents.getZoomFactor();
          const point = { x: Math.round(centerX * zoom), y: Math.round(centerY * zoom), button: 'left' as const, clickCount: 1 };
          this.assertScrollVisible();
          if (!this.view.webContents.isFocused()) throw new Error('网页失去原生焦点，没有继续填写。');
          stage = 'hover-field';
          this.view.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
          await delay(20);
          const hovered = await this.approvedField(stored, originalField.id, originalField, item.currentValue);
          const hoverHit = record(await this.readTargetChecked(field.index, centerX, centerY, 'hover-field'));
          this.assertScrollVisible();
          if (!this.view.webContents.isFocused() || !this.samePosition(revealed, hovered) || hoverHit.uncovered !== true
            || string(hoverHit.url) !== stored.plan.url || string(hoverHit.value) !== item.currentValue
            || (await this.options.getProfile()).version !== stored.plan.profileVersion
            || this.generation !== stored.generation || this.view.webContents.getURL() !== stored.plan.url) {
            throw new Error('移动指针后字段位置、遮挡或焦点变化，没有继续填写。');
          }
          if (field.type === 'combobox') await this.comboGuard(stored, originalField, item.currentValue, initial.view);
          this.decorate({phase:'approach',bounds:field.bounds});
          this.assertScrollVisible();
          const alreadyOpen = field.type === 'combobox' && await this.comboPopup(originalField, stored.plan.url, item.currentValue);
          if (!alreadyOpen) {
            if (field.type === 'combobox') {
              const guarded = await this.comboGuard(stored, originalField, item.currentValue, initial.view);
              if (!this.samePosition(hovered, guarded)) throw new Error('展开菜单前字段位置变化，没有继续点击。');
              const triggerHit = record(await this.readWithinDeadline(this.readTargetChecked(field.index, centerX, centerY, 'hit-field'), Date.now() + 700));
              this.assertScrollVisible();
              if (triggerHit.exists !== true || triggerHit.uncovered !== true || triggerHit.url !== stored.plan.url
                || triggerHit.value !== item.currentValue || !this.view.webContents.isFocused()
                || this.generation !== stored.generation || this.view.webContents.getURL() !== stored.plan.url) {
                throw new Error('展开菜单前字段被遮挡或页面、焦点变化，没有继续点击。');
              }
            }
            this.view.webContents.sendInputEvent({ type: 'mouseDown', ...point });
            this.view.webContents.sendInputEvent({ type: 'mouseUp', ...point });
          }
          if (field.type === 'combobox') {
            await this.chooseCustomSelect(stored, item, originalField, initial.view);
            result.verified.push({ fieldId: item.fieldId, label: item.label });
            this.decorate({phase:'verified',bounds:field.bounds});
            continue fieldsLoop;
          }
          stage = 'focus-target';
          field = (await this.waitForTargetFocus(stored, originalField, item.currentValue, hovered)).field;
          const focusedX = field.bounds.x + field.bounds.width / 2, focusedY = field.bounds.y + field.bounds.height / 2;
          if ((await this.options.getProfile()).version !== stored.plan.profileVersion
            || this.generation !== stored.generation || this.view.webContents.getURL() !== stored.plan.url) {
            throw new Error('获得焦点后资料或页面已变化，没有发送个人资料。');
          }
          this.assertScrollVisible();
          if (!this.state.visible || !this.options.window.isFocused() || !this.view.webContents.isFocused()) {
            throw new Error('浏览器已隐藏或失去焦点，请重新确认后操作。');
          }
          stage = 'insert-text';
          this.decorate({phase:'typing',bounds:field.bounds});
          if (field.type === 'select') {
            const matching = field.options.filter(option => option.value === item.value);
            const option = matching[0];
            if (matching.length !== 1 || !option?.label || field.options.filter(other => other.label === option.label).length !== 1
              || [...option.label].some(character => character.codePointAt(0)! > 0xffff || /[\u0000-\u001f\u007f]/u.test(character))) {
              throw new Error('下拉选项不唯一或不能用原生字符定位，请手动选择。');
            }
            // Chromium's native select typeahead accepts real character input,
            // including Chinese labels. No value setter or submit/Enter is used.
            for (const character of option.label) {
              this.assertScrollVisible();
              const target = record(await this.readTargetChecked(field.index, focusedX, focusedY, 'insert-text'));
              const live = await this.observe();
              if (!this.state.visible || !this.options.window.isFocused() || !this.view.webContents.isFocused()
                || target.focused !== true || target.uncovered !== true || string(target.url) !== stored.plan.url
                || live.observation.signature !== stored.original.signature || live.generation !== stored.generation
                || (await this.options.getProfile()).version !== stored.plan.profileVersion) {
                throw new Error('选择期间焦点、页面或资料变化，停止发送剩余按键，请核实当前选项。');
              }
              this.assertScrollVisible();
              this.view.webContents.sendInputEvent({ type: 'char', keyCode: character });
              await delay(15);
            }
          } else if(field.type==='month'){
            // A segmented date editor ignores insertText; use an exact ISO-month operation,
            // retaining the same approved observation, target focus and foreground checks.
            const monthView=await this.approvedField(stored,item.fieldId,originalField,item.currentValue);
            if(!monthView.view.rawSnapshot||(await this.options.getProfile()).version!==stored.plan.profileVersion)throw new Error('月份授权或资料变化。');
            this.assertScrollVisible();
            if(!this.view.webContents.isFocused()||this.generation!==stored.generation||this.view.webContents.getURL()!==stored.plan.url)throw new Error('月份填写前网页失焦或变化。');
            const written=record(await this.view.webContents.executeJavaScriptInIsolatedWorld(9469,[{code:writeObservedMonth(field.index,stored.plan.url,item.value,monthView.view.rawSnapshot)}],false));
            if(!written.written||!written.stable||!written.valid)throw new Error('月份输入未稳定通过网页核对，已停止后续填写。');
          } else {
            await this.view.webContents.insertText(item.value);
          }
          // A native Tab commits ordinary input events without pressing submit/Enter.
          this.assertScrollVisible();
          if (!this.view.webContents.isFocused()) throw new Error('网页失去原生焦点，请核实已填写内容。');
          this.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
          this.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
          await delay(90);
          stage = 'verify-value';
          const after = await this.observe();
          const verified = after.observation.fields.find(candidate => candidate.id === item.fieldId);
          if (!verified || verified.signature !== originalField.signature || after.observation.url !== stored.plan.url
            || !isVerifiedValue(verified.value, item.value, field.type)) throw new Error('网页没有保留预期值，结果需要人工核实。');
          stage = 'verify-validity';
          const validity = record(await this.readTargetChecked(field.index, focusedX, focusedY, 'verify-validity'));
          if (validity.valid !== true) throw new Error('网页将当前值标记为无效，需要人工核实。');
          result.verified.push({ fieldId: item.fieldId, label: item.label });
          this.decorate({phase:'verified',bounds:verified.bounds});
          continue fieldsLoop;
        } catch (error) {
          if (attemptBaseline && safePreparationRetry(stage, originalField.type, attempt, this.options.fillRetryLimit ?? 0)) {
            try {
              this.assertScrollVisible();
              if (!this.view.webContents.isFocused()) throw new Error('inactive');
              await delay(150);
              const recovery = await this.approvedField(stored, item.fieldId, originalField, item.currentValue);
              const values = (observation: FormObservation) => JSON.stringify(observation.fields.map(({ bounds: _bounds, ...field }) => field));
              if (values(attemptBaseline) !== values(recovery.view.observation)) throw new Error('changed');
              this.assertScrollVisible();
              if (!this.view.webContents.isFocused()) throw new Error('inactive');
              result.retryCount = (result.retryCount ?? 0) + 1;
              this.options.onRetry?.({ kind: 'ordinary', label: item.label, attempt: attempt + 2, maxAttempts: (this.options.fillRetryLimit ?? 0) + 1 });
              continue;
            } catch { /* Never retry if current data, foreground or identity cannot be proven unchanged. */ }
          }
          const rawReason = error instanceof Error ? error.message : '操作结果需要核实。';
          const reason = rawReason === 'Script failed to execute, this normally means an error was thrown. Check the renderer console for the error.'
            ? `网页检查失败（${stage}）。` : rawReason;
          result.unresolved.push({ fieldId: item.fieldId, label: item.label, reason });
          if (originalField.type === 'combobox' || ['insert-text', 'verify-value', 'verify-validity'].includes(stage)) {
            // An uncertain popup must not leave a later field typing under it.
            for (const remaining of selected) {
              if (!result.verified.some(entry => entry.fieldId === remaining.item.fieldId)
                && !result.unresolved.some(entry => entry.fieldId === remaining.item.fieldId)) {
                result.unresolved.push({ fieldId: remaining.item.fieldId, label: remaining.item.label, reason: '前一个字段的结果尚未核实，后续字段已停止；请核实后重新识别。' });
              }
            }
            break fieldsLoop;
          }
          continue fieldsLoop;
        }
        }
      }
      if(result.verified.length){
        // Read-only final reconciliation catches delayed page rollbacks. Never retry uncertain writes.
        await delay(180);
        const finalView=await this.observe(),latestProfile=await this.options.getProfile();
        const sameContext=finalView.generation===stored.generation&&finalView.observation.url===stored.plan.url&&latestProfile.version===stored.plan.profileVersion;
        result.verified=result.verified.filter(entry=>{
          const original=selected.find(row=>row.item.fieldId===entry.fieldId),actual=finalView.observation.fields.find(f=>f.id===entry.fieldId);
          if(sameContext&&original&&actual&&actual.signature===original.field.signature&&(isVerifiedValue(actual.value,original.item.value,actual.type)||actual.type==='combobox'&&!!matchSelectOption(original.item.value,[{label:actual.value,value:actual.value}],original.item.profileKey)))return true;
          result.unresolved.push({...entry,reason:'最终复核时页面未保留该值或上下文已变化；请检查后重新识别，不自动重试已发送的输入。'});return false;
        });
      }
      return result;
    } finally { this.clearDecoration(); this.options.window.removeListener?.('blur', onBlur); this.filling = false; }
  }

  async capturePage(): Promise<CapturedPage> {
    this.assertReadable();
    const generation = this.generation;
    const raw = record(await this.view.webContents.executeJavaScript(READ_PAGE));
    if (generation !== this.generation || string(raw.url) !== this.view.webContents.getURL()) throw new Error('读取期间网页变化，请重新读取。');
    return { url: string(raw.url), title: string(raw.title, 500), text: string(raw.text, 12000) };
  }

  async collectVisibleJobs(): Promise<JobInput[]> {
    if (this.preparing || this.filling) throw new Error('请等待字段识别或填写结束再采集岗位。');
    if (this.collecting) throw new Error('已有官网分页采集正在执行。');
    this.assertReadable();
    const generation = this.generation;
    const raw = record(await this.view.webContents.executeJavaScript(READ_JOB_LINKS));
    if (generation !== this.generation || string(raw.url) !== this.view.webContents.getURL()) throw new Error('采集期间网页变化，请重新采集。');
    if (!Array.isArray(raw.anchors)) throw new Error('网页没有可读取的岗位链接。');
    const sourceURL = string(raw.url);
    const source = new URL(sourceURL);
    if (source.protocol !== 'http:' && source.protocol !== 'https:') return [];
    const seen = new Set<string>();
    const jobs: JobInput[] = [];
    for (const entry of raw.anchors) {
      const anchor = record(entry);
      const title = string(anchor.title, 140);
      if (!/(算法|大模型|机器学习|人工智能|深度学习|aigc|\bAI\b|\bML\b|machine learning|data scientist|research scientist)/i.test(title)) continue;
      const url = string(anchor.url);
      if (!this.isAllowed(url) || !/^https?:/.test(url) || seen.has(url)) continue;
      seen.add(url);
      const context = string(anchor.context, 1400);
      const explicitCity = string(anchor.city, 160);
      const recruitmentLabel = string(anchor.recruitmentLabel, 40);
      const cityMatch = context.match(/(?:工作地点|城市|地点)\s*[:：]\s*(北京|上海|广州|深圳|杭州|成都|南京|武汉|西安|苏州|天津|重庆)/);
      const campusPath = /\/(?:campus|campus-recruitment|campus-recruiting)(?:\/|$)/i;
      const campus = campusPath.test(source.pathname) || campusPath.test(new URL(url).pathname) || /校招|校园招聘|campus recruitment/i.test(context);
      jobs.push({
        company: '企业名称待确认', title, city: explicitCity || cityMatch?.[1] || '城市待确认',
        type: /实习|\bintern(?:ship)?\b/i.test(`${title} ${recruitmentLabel}`) ? 'internship' : campus ? 'campus' : 'unknown',
        description: context, requirements: '', url, sourceId: `browser:${source.hostname}`,
        sourceName: string(raw.title, 250) || source.hostname, observedAt: new Date().toISOString(),
        publishedAt: null, deadline: null, demo: false,
      });
      if (jobs.length >= 80) break;
    }
    return jobs;
  }

  private assertCollectionExpected(): void {
    this.assertReadable();
    if (this.collectionExpected && (this.collectionExpected.url !== this.view.webContents.getURL() || this.collectionExpected.generation !== this.generation)) {
      const error = new Error('网页在采集期间由其他操作改变，保留已有结果。'); error.name = 'ScopeChangedError'; throw error;
    }
  }

  private async observeCollectionList(sourceId: string, signal?: AbortSignal): Promise<BrowserListPage> {
    checkCollectionAborted(signal); this.assertReadable();
    const generation = this.generation;
    const raw = record(await this.view.webContents.executeJavaScript(READ_COLLECTION_LIST));
    checkCollectionAborted(signal);
    if (generation !== this.generation || string(raw.url) !== this.view.webContents.getURL()) throw new Error('列表观察期间网页变化，请重新采集。');
    if (!Array.isArray(raw.anchors) || raw.anchors.length > 3000) throw new Error('列表数据格式变化。');
    const source = browserCollectionSource(sourceId);
    const links: string[] = [], jobs: JobInput[] = [];
    const seen = new Set<string>();
    for (const entry of raw.anchors) {
      const anchor = record(entry), url = string(anchor.url), title = string(anchor.title, 140);
      if (!isCollectionDetailURL(url, sourceId) || seen.has(url)) continue;
      seen.add(url); links.push(url);
      if (!/(算法|大模型|机器学习|人工智能|深度学习|aigc|\bAI\b|\bML\b|machine learning|data scientist|research scientist)/i.test(title) || jobs.length >= 80) continue;
      const context = string(anchor.context, 1400), recruitmentLabel = string(anchor.recruitmentLabel, 40);
      const city = string(anchor.city, 160) || context.match(/(?:工作地点|城市|地点)\s*[:：]\s*(北京|上海|广州|深圳|杭州|成都|南京|武汉|西安|苏州|天津|重庆)/)?.[1] || '城市待确认';
      jobs.push({ company: source.company, title, city,
        type: /实习|\bintern(?:ship)?\b/i.test(`${title} ${recruitmentLabel}`) ? 'internship' : 'campus',
        description: context, requirements: '', url, sourceId, sourceName: source.name,
        observedAt: new Date().toISOString(), publishedAt: null, deadline: null, demo: false });
    }
    let next: BrowserListPage['next'] = null;
    if (raw.next !== null && raw.next !== undefined) {
      const target = record(raw.next), bounds = record(target.bounds), index = finite(target.index);
      if (!Number.isInteger(index) || index < 0 || index >= 4000) throw new Error('分页控件索引无效。');
      next = { index, signature: createHash('sha256').update(string(target.identity, 2000)).digest('hex'), disabled: target.disabled === true,
        href: string(target.href), bounds: { x: finite(bounds.x), y: finite(bounds.y), width: finite(bounds.width), height: finite(bounds.height) } };
    }
    const url = string(raw.url), viewport = record(raw.viewport);
    const page: BrowserListPage = { url, title: string(raw.title, 500),
      recognized: isCollectionListURL(url, sourceId) && (links.length > 0 || raw.listMarker === true),
      fingerprint: collectionFingerprint(links, jobs), scopeKey: collectionScopeKey(url, string(raw.filters, 10000)), jobs, links, next };
    this.collectionViews.set(page, { generation, width: finite(viewport.width), height: finite(viewport.height) });
    this.collectionExpected = { url, generation };
    return page;
  }

  private async waitInitialCollectionList(sourceId: string, signal?: AbortSignal): Promise<BrowserListPage> {
    const initialURL = this.view.webContents.getURL();
    const until = Date.now() + 8_000;
    for (;;) {
      checkCollectionAborted(signal);
      if (this.view.webContents.getURL() !== initialURL) { const error = new Error('首次列表等待期间网页地址变化，未继续采集。'); error.name = 'ScopeChangedError'; throw error; }
      const page = await this.observeCollectionList(sourceId, signal);
      if (page.recognized || !isCollectionListURL(page.url, sourceId) || Date.now() >= until) return page;
      await delay(180);
    }
  }

  private async advanceCollection(page: BrowserListPage, sourceId: string, signal?: AbortSignal): Promise<BrowserListPage> {
    checkCollectionAborted(signal); this.assertCollectionExpected();
    if (!page.next || page.next.disabled) throw new Error('没有可执行的下一页控件。');
    if (page.next.href && !isCollectionListURL(page.next.href, sourceId)) throw new Error('下一页链接不属于本次官网职位列表。');
    if (!this.state.visible) throw new Error('请显示内置浏览器，才能通过原生输入翻页。');
    this.options.window.focus(); this.view.webContents.focus();
    let latest = await this.observeCollectionList(sourceId, signal);
    if (latest.fingerprint !== page.fingerprint || latest.scopeKey !== page.scopeKey || latest.next?.signature !== page.next.signature) throw new Error('列表或分页控件变化，没有执行翻页。');
    // Scroll with native wheel input if the observed next control is below the viewport.
    for (let attempt = 0; attempt < 12; attempt++) {
      checkCollectionAborted(signal);
      const view = this.collectionViews.get(latest)!;
      const target = latest.next!, centerY = target.bounds.y + target.bounds.height / 2;
      if (centerY >= 0 && centerY < view.height) break;
      if (!this.options.window.isFocused() || !this.view.webContents.isFocused() || !this.state.visible) throw new Error('浏览器失去焦点，没有继续翻页。');
      this.view.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(view.width / 2), y: Math.round(view.height / 2), deltaY: centerY < 0 ? -600 : 600 });
      await delay(100);
      latest = await this.observeCollectionList(sourceId, signal);
      if (latest.fingerprint !== page.fingerprint || latest.scopeKey !== page.scopeKey || latest.next?.signature !== page.next.signature) throw new Error('滚动期间列表或分页控件变化，没有执行翻页。');
    }
    const view = this.collectionViews.get(latest)!, target = latest.next!;
    const x = target.bounds.x + target.bounds.width / 2, y = target.bounds.y + target.bounds.height / 2;
    if (x < 0 || y < 0 || x >= view.width || y >= view.height || target.bounds.width <= 0 || target.bounds.height <= 0) throw new Error('下一页控件不在可见区域，没有执行翻页。');
    this.assertCollectionExpected();
    const hit = record(await this.view.webContents.executeJavaScript(readPaginationTarget(target.index, x, y)));
    if (hit.uncovered !== true || string(hit.url) !== latest.url || createHash('sha256').update(string(hit.identity, 2000)).digest('hex') !== target.signature
      || !this.options.window.isFocused() || !this.view.webContents.isFocused() || !this.state.visible) throw new Error('下一页控件变化、被遮挡或网页失去焦点，没有执行翻页。');
    const zoom = this.view.webContents.getZoomFactor();
    const point = { x: Math.round(x * zoom), y: Math.round(y * zoom), button: 'left' as const, clickCount: 1 };
    checkCollectionAborted(signal); this.assertCollectionExpected();
    this.view.webContents.sendInputEvent({ type: 'mouseDown', ...point });
    this.view.webContents.sendInputEvent({ type: 'mouseUp', ...point });
    const until = Date.now() + 12_000;
    let changed: BrowserListPage | undefined, stable = 0;
    while (Date.now() < until) {
      checkCollectionAborted(signal); await delay(180);
      if (this.view.webContents.isLoading()) continue;
      const observed = await this.observeCollectionList(sourceId, signal);
      if (observed.scopeKey !== page.scopeKey || !isCollectionListURL(observed.url, sourceId)) return observed;
      if (observed.fingerprint === page.fingerprint) { changed = undefined; stable = 0; continue; }
      if (changed?.fingerprint === observed.fingerprint) stable++; else { changed = observed; stable = 1; }
      if (stable >= 2 && observed.recognized) return observed;
    }
    throw new Error('翻页后列表未在等待期限内变化，保留已采集岗位。');
  }

  private async readCollectionDetail(job: JobInput, sourceId: string, signal?: AbortSignal): Promise<Partial<JobInput>> {
    checkCollectionAborted(signal); this.assertCollectionExpected();
    if (!isCollectionDetailURL(job.url, sourceId)) throw new Error('详情链接不在本次官网已知职位路径内。');
    // Navigating a known public GET detail page does not invoke application controls.
    const contents = this.view.webContents;
    await new Promise<void>((resolveLoad, rejectLoad) => {
      const fail = (error: Error) => { if (!contents.isDestroyed()) contents.stop(); rejectLoad(error); };
      const timer = setTimeout(() => fail(new Error('岗位详情加载超时，保留列表候选。')), 15_000);
      const abort = () => fail(new DOMException('采集已取消。', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { clearTimeout(timer); signal.removeEventListener('abort', abort); abort(); return; }
      void contents.loadURL(job.url).then(resolveLoad, rejectLoad).finally(() => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      });
    });
    checkCollectionAborted(signal);
    if (this.view.webContents.getURL() !== job.url) { const error = new Error('岗位详情重定向到其他页面，未保存其正文。'); error.name = 'ScopeChangedError'; throw error; }
    this.collectionExpected = { url: job.url, generation: this.generation };
    const until = Date.now() + 8_000;
    for (;;) {
      checkCollectionAborted(signal); this.assertCollectionExpected();
      const generation = this.generation, raw = record(await this.view.webContents.executeJavaScript(READ_COLLECTION_DETAIL));
      if (generation !== this.generation || string(raw.url) !== job.url) throw new Error('岗位详情读取期间网页变化。');
      const checked = checkCollectionDetail(job.title, raw);
      if (checked.ready) return { description: checked.description, requirements: checked.requirements };
      if (checked.permanent || Date.now() >= until) throw new Error(checked.reason);
      await delay(180);
    }
  }

  async collectSourceJobs(options: BrowserCollectionOptions): Promise<SourceCollectionResult> {
    if (this.preparing || this.filling || this.collecting) throw new Error('已有浏览器任务正在执行。');
    this.assertReadable();
    const source = browserCollectionSource(options.sourceId);
    if (new URL(this.view.webContents.getURL()).origin !== source.origin) throw new Error('请先打开这个来源的官网职位列表。');
    this.collecting = true; this.collectionOrigin = source.origin; this.collectionExpected = undefined; this.plans.clear();
    try {
      return await runBrowserCollection(options, {
        observeList: signal => this.waitInitialCollectionList(options.sourceId, signal),
        advance: (page, signal) => this.advanceCollection(page, options.sourceId, signal),
        readDetail: (job, signal) => this.readCollectionDetail(job, options.sourceId, signal),
      });
    } finally { this.collecting = false; this.collectionOrigin = undefined; this.collectionExpected = undefined; this.publish({}); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if(this.fieldCompanion)this.options.window.removeListener('blur',this.clearDecoration);
    void this.fieldCompanion?.dispose();
    this.plans.clear();
    this.locations.clear();
    this.careerAbort?.abort(); this.careerPlans.clear();
    this.session.removeListener('will-download', this.onDownload);
    if (!this.options.window.isDestroyed()) this.options.window.contentView.removeChildView(this.view);
    if (this.view.webContents&&!this.view.webContents.isDestroyed()) this.view.webContents.close({ waitForBeforeUnload: false });
  }
}
