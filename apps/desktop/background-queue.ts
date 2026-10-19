import { BrowserWindow, WebContentsView, type Event, type DownloadItem, type WebContents,type Session } from 'electron';
import { ApplicationFillQueue, BackgroundFillError, type ApplicationQueueTarget, type BackgroundDraftPage } from '../../packages/domain/src/application-queue.js';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { ApplicationQueueStartInput, ApplicationQueueState } from '../../packages/shared/src/application-queue.js';
import { BACKGROUND_READ_FORM, backgroundWriteScript } from '../../packages/browser/src/background-scripts.js';
import { runBackgroundOrdinaryFill,type BackgroundFormTransport } from '../../packages/browser/src/background-executor.js';
import {waitForBackgroundNavigationReady} from '../../packages/browser/src/background-readiness.js';
import { backgroundCareerWriteScript, runBackgroundCareerFill } from '../../packages/browser/src/background-career.js';
import { READ_FEISHU_CAREER,readFeishuMonthPopup,readFeishuSelectPopup } from '../../packages/browser/src/feishu-scripts.js';
import { backgroundCareerActionScript } from '../../packages/browser/src/background-career-actions.js';
import {READ_FORM} from '../../packages/browser/src/read-scripts.js';
import {COMBOBOX_READ_HELPERS} from '../../packages/browser/src/combobox-scripts.js';
import {BackgroundModelProvider} from '../../packages/agent/src/background-model-provider.js';
import {runBackgroundFormAgent,type BackgroundAgentEvidence} from '../../packages/agent/src/background-form-agent.js';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** One isolated view per draft: moving to the next company never throws away the previous DOM. */
export class BackgroundPage implements BackgroundDraftPage {
  readonly view:WebContentsView;
  private generation = 0;
  private disposed = false;
  private reviewWindow?: BrowserWindow;
  private writePending=false;
  private qaInitial?:unknown;
  private qaWriteStatuses:{index:number;status:string;label?:string;type?:string}[]=[];
  private qaGuardStops:{reason:string;planned:boolean}[]=[];
  private readonly session:Session;
  private agentEvidence?:BackgroundAgentEvidence;
  constructor(private readonly target: ApplicationQueueTarget, private readonly store: DomainStore,private readonly qaAudit=false,
    private readonly modelTask?:{provider:BackgroundModelProvider;directory:string;taskId:string;variant:'baseline'|'improved';baselineRunner?:typeof runBackgroundFormAgent},partition?:string) {
    this.view=new WebContentsView({webPreferences:{partition:partition??'persist:offeragent-recruiting',sandbox:true,contextIsolation:true,
      nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false}});
    this.view.setVisible(false); this.view.setBounds({x:0,y:0,width:1280,height:900});
    const contents = this.view.webContents, origin = new URL(target.url).origin;
    this.session=contents.session;
    contents.setWindowOpenHandler(() => ({action:'deny'}));
    contents.on('will-navigate', (event, url) => { if (!this.allowed(url, origin)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!this.allowed(url, origin)) event.preventDefault(); });
    contents.on('will-frame-navigate', event => { if (!this.allowed(event.url, origin)) event.preventDefault(); });
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) this.generation++; });
    this.session.on('will-download', this.blockDownload);
  }
  private allowed(raw: string, origin: string): boolean {
    try { const url = new URL(raw); return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password; }
    catch { return false; }
  }
  private blockDownload = (event: Event, _item: DownloadItem, contents: WebContents): void => {
    if (contents.id === this.view.webContents.id) event.preventDefault();
  };
  private async bounded<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { this.dispose(); reject(new Error('后台页面超时，已关闭执行上下文。')); }, ms);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  async load(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('已取消。');
    await this.bounded(this.view.webContents.loadURL(this.target.url), 15_000);
    if (signal.aborted) throw new Error('已取消。');
    if(this.modelTask?.variant!=='baseline')await waitForBackgroundNavigationReady(()=>({url:this.view.webContents.getURL(),generation:this.generation,
      loading:this.view.webContents.isLoadingMainFrame()}),signal);
  }
  async run(profile: Parameters<BackgroundDraftPage['run']>[0], signal: AbortSignal,
    progress: Parameters<BackgroundDraftPage['run']>[2]): ReturnType<BackgroundDraftPage['run']> {
    const contents = this.view.webContents;
    if(this.qaAudit)this.qaInitial=await this.readQAAudit();
    const interrupt=()=>{if(this.writePending)this.dispose();};
    signal.addEventListener('abort',interrupt);
    const reviewedCareer=new URL(contents.getURL()).hostname==='modelbest.jobs.feishu.cn';
    const write=async <T>(source:string):Promise<T>=>{
      if(signal.aborted)throw new Error('已取消。');this.writePending=true;
      try{return await this.bounded(contents.executeJavaScript(source),1800);}
      finally{this.writePending=false;}
    };
    const getProfile=async () => (await this.store.getState()).profile;
    const transport:BackgroundFormTransport={read: () => this.bounded(contents.executeJavaScript(BACKGROUND_READ_FORM), 1800),
      write: async input => {
        const target=this.qaAudit?(await this.bounded<any>(contents.executeJavaScript(BACKGROUND_READ_FORM),1800)).fields.find((f:any)=>f.index===input.index):undefined;
        const result=await write<{status:'written'|'stale'|'unsupported'|'nonempty'}>(backgroundWriteScript(input));
        if(this.qaAudit)this.qaWriteStatuses.push({index:input.index,status:result.status,label:target?.label,type:target?.type});
        return result;
      }, getURL: () => contents.getURL(), getGeneration: () => this.generation,
      interruptPending:interrupt,
      getProfile,...(this.qaAudit?{onGuardStop:(reason:string,planned:boolean)=>this.qaGuardStops.push({reason,planned})}:{})};
    try {
      if(this.modelTask){const result=await (this.modelTask.baselineRunner??runBackgroundFormAgent)({...this.modelTask,transport,profile,signal,progress,
        onEvidence:e=>{this.agentEvidence=e;}});
        const attempts=this.modelTask.provider.attempts.filter(a=>a.taskId===this.modelTask!.taskId);
        return {...result,modelRequests:attempts.length,modelTokens:attempts.every(a=>!!a.usage)?attempts.reduce((n,a)=>n+a.usage!.totalTokens,0):null};}
      const ordinary=await runBackgroundOrdinaryFill(transport, profile, signal, progress, {contactsOnly:reviewedCareer});
      if(!reviewedCareer||ordinary.message.includes('登录')||ordinary.message.includes('超出后台'))return ordinary;
      const career=await runBackgroundCareerFill({read:()=>this.bounded(contents.executeJavaScript(READ_FEISHU_CAREER),1800),
        write:input=>write(backgroundCareerWriteScript(input)),action:input=>write(backgroundCareerActionScript(input)),
        popup:async(fieldId,type)=>{
          if(signal.aborted)throw new Error('已取消。');
          const side=/^(.*):(start|end)$/.exec(fieldId);
          const code=type==='combobox'?readFeishuSelectPopup(fieldId):side?readFeishuMonthPopup(side[1]!,side[2] as 'start'|'end'):'';
          if(!code)throw new Error('控件端点无效。');
          const result=await this.bounded(contents.executeJavaScript(code),1800);return result.popup;
        },getProfile,getURL:()=>contents.getURL(),getGeneration:()=>this.generation},profile,signal,
        (verified,pending)=>progress(ordinary.verifiedCount+verified,ordinary.pendingCount+pending));
      return {verifiedCount:ordinary.verifiedCount+career.verifiedCount,pendingCount:ordinary.pendingCount+career.pendingCount,
        canReview:true,message:`已核对 ${ordinary.verifiedCount+career.verifiedCount} 项；${career.message}，未提交`};
    }
    finally{signal.removeEventListener('abort',interrupt);}
  }
  isReviewable():boolean{return !this.disposed&&!this.view.webContents.isDestroyed();}
  async readQAAudit():Promise<any>{
    if(!this.qaAudit)throw new Error('仅独立测评实例可读取该审计。');
    return {backgroundRaw:await this.view.webContents.executeJavaScript(BACKGROUND_READ_FORM),observation:await this.view.webContents.executeJavaScript(READ_FORM),structure:await this.view.webContents.executeJavaScript(`(()=>{${COMBOBOX_READ_HELPERS};return formControls(document).slice(0,300).map((target,index)=>{const parents=[];for(let p=target.parentElement;p&&parents.length<8;p=p.parentElement)parents.push({tag:p.tagName,ownLabel:p.tagName==='LABEL'?p.control===target:null,labelControls:p.tagName==='LABEL'?formControls(p).length:null});return {index,parents};});})()`),protected:await this.view.webContents.executeJavaScript("Array.from(document.querySelectorAll('input[type=checkbox],input[type=radio],input[type=file]')).map((e,index)=>({index,type:e.type,checked:e.checked,files:e.files?.length??0}))")};
  }
  async qaEvidence(){return {before:this.qaInitial,after:await this.readQAAudit(),writeStatuses:this.qaWriteStatuses.map(item=>({...item})),guardStops:this.qaGuardStops.map(item=>({...item})),agent:this.agentEvidence};}
  showForReview(): void {
    if (this.disposed || this.view.webContents.isDestroyed()) throw new Error('这份草稿已关闭，请重新打开岗位。');
    if (this.reviewWindow && !this.reviewWindow.isDestroyed()) { this.reviewWindow.show(); return; }
    const window = new BrowserWindow({show:false,width:1320,height:920,minWidth:900,minHeight:600,
      title:`OfferAgent · 检查草稿 · ${this.target.company}`,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window.setMenuBarVisibility(false); window.contentView.addChildView(this.view); this.view.setVisible(true);
    const resize = () => {const {width,height}=window.getContentBounds();this.view.setBounds({x:0,y:0,width,height});};
    resize(); window.on('resize', resize);
    window.on('close', () => {window.contentView.removeChildView(this.view);this.view.setVisible(false);this.reviewWindow=undefined;});
    this.reviewWindow=window; window.show();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed=true;
    this.session.removeListener('will-download', this.blockDownload);
    if (this.reviewWindow && !this.reviewWindow.isDestroyed()) { this.reviewWindow.contentView.removeChildView(this.view);this.reviewWindow.destroy(); }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close({waitForBeforeUnload:false});
  }
}

/** Host validates saved jobs and the explicitly linked current page before creating views. */
export class BackgroundQueueHost {
  private readonly queue: ApplicationFillQueue;
  private starting=false;
  private useModel=false;
  private benchmarkVariant:'baseline'|'improved'='improved';
  private benchmarkPartition?:string;
  private benchmarkRunner?:typeof runBackgroundFormAgent;
  constructor(private readonly options: {store: DomainStore; getCurrentPage(): {url: string;jobId?: string};onState(state:ApplicationQueueState):void;qaAudit?:boolean;
    getModelProvider?():BackgroundModelProvider|undefined;agentDirectory?:string;agentVariant?:'baseline'|'improved'}) {
    if(options.agentVariant==='baseline'&&!options.qaAudit)throw Error('Baseline ablation is isolated QA only');
    this.benchmarkVariant=options.agentVariant??'improved';
    this.queue = new ApplicationFillQueue({getProfile:async () => (await options.store.getState()).profile,
      createPage: async (target,signal) => {
        const provider=this.useModel?options.getModelProvider?.():undefined;
        if(this.useModel&&!provider)throw Error('请先连接后台模型Agent；不会回退规则填写。');
        const taskId=randomUUID();const page=new BackgroundPage(target,options.store,options.qaAudit,provider?{provider,taskId,
          directory:join(options.agentDirectory!,taskId),variant:this.benchmarkVariant,
          ...(this.benchmarkVariant==='baseline'&&this.benchmarkRunner?{baselineRunner:this.benchmarkRunner}:{})}:undefined,this.benchmarkPartition);
        try {await page.load(signal);return page;} catch(error) {page.dispose();throw error instanceof BackgroundFillError?error:new BackgroundFillError('load-failed');}
      }, onState: state=>options.onState({...state,executionMode:this.useModel?'model-agent':'rules'})});
  }
  /** QA only; no renderer IPC can change an execution variant or browser partition. */
  setBenchmarkContext(variant:'baseline'|'improved',partition:string,baselineRunner?:typeof runBackgroundFormAgent){
    if(!this.options.qaAudit||this.queue.isExecuting()||this.state().items.some(i=>i.canReview)||!/^offerflash-agent-bench-[a-z0-9-]{1,100}$/.test(partition))throw Error('ISOLATED_IDLE_BENCHMARK_REQUIRED');
    this.benchmarkVariant=variant;this.benchmarkPartition=partition;this.benchmarkRunner=baselineRunner;
  }
  state(): ApplicationQueueState {return {...this.queue.getState(),executionMode:this.useModel?'model-agent':'rules'};}
  async qaEvidence(id:string){if(!this.options.qaAudit)throw new Error('非测评实例。');const page=this.queue.getPage(id);if(!(page instanceof BackgroundPage))return null;return page.qaEvidence();}
  async enqueue(input:ApplicationQueueStartInput):Promise<ApplicationQueueState> {
    if(this.starting)throw new Error('正在准备后台队列。');this.starting=true;
    try {
      if(!input || input.acknowledgeAutosave!==true || !Array.isArray(input.jobIds) || input.jobIds.length<1 || input.jobIds.length>6
        || input.jobIds.some(id=>typeof id!=='string'||!id||id.length>200) || new Set(input.jobIds).size!==input.jobIds.length
        || !Number.isInteger(input.profileVersion))throw new Error('请明确选择 1–6 个岗位并确认网页可能自动保存。');
      if(input.useModel!==undefined&&typeof input.useModel!=='boolean'||input.concurrency!==undefined&&!([1,3,5] as number[]).includes(input.concurrency))throw Error('请选择规则或模型，以及1、3、5并发。');
      if(this.queue.isExecuting()||this.queue.getState().status==='paused')throw Error('请先停止当前队列。');
      if(input.useModel&&(!this.options.getModelProvider?.()||!this.options.agentDirectory))throw Error('请先在模型设置连接后台模型Agent，模型失败不会回退规则。');
      const state=await this.options.store.getState();
      if(state.profile.version!==input.profileVersion)throw new Error('资料已变化，请重新确认。');
      const current=this.options.getCurrentPage();
      if(input.currentPageForJobId && (!input.jobIds.includes(input.currentPageForJobId)||current.jobId && current.jobId!==input.currentPageForJobId))throw new Error('当前网页没有与所选岗位明确关联。');
      const targets=input.jobIds.map(jobId=>{
        const job=state.jobs.find(candidate=>candidate.id===jobId);
        if(!job || job.demo)throw new Error('只能选择当前岗位库中的真实岗位。');
        let url=job.url;
        if(input.currentPageForJobId===jobId){
          const active=new URL(current.url),original=new URL(job.url);
          if(active.protocol!=='https:'||active.origin!==original.origin||active.username||active.password)throw new Error('当前申请页与岗位官网不一致。');
          url=active.href;
        }
        return {jobId,company:job.company,title:job.title,url};
      });
      await this.queue.enqueue(targets,input.profileVersion);this.useModel=input.useModel===true;this.queue.setConcurrency(input.concurrency??1);
      return this.state();
    } finally {this.starting=false;}
  }
  async start():Promise<ApplicationQueueState>{await this.queue.startPrepared();return this.state();}
  pause():ApplicationQueueState{this.queue.pause();return this.state();}
  async resume():Promise<ApplicationQueueState>{await this.queue.resume((await this.options.store.getState()).profile.version);return this.state();}
  async cancel():Promise<ApplicationQueueState>{this.queue.cancel();await this.queue.settled();return this.state();}
  hasPendingMutation():boolean{return this.queue.isExecuting();}
  close(itemId:string):ApplicationQueueState{this.queue.closePage(itemId);return this.state();}
  review(itemId:string):void{
    if(this.queue.getState().activeItemIds?.includes(itemId))throw new Error('请等待此页填写结束后再检查。');
    const page=this.queue.getPage(itemId);
    if(!(page instanceof BackgroundPage))throw new Error('这份网页草稿尚不可查看。');page.showForReview();
  }
  dispose():void{this.queue.dispose();}
}
