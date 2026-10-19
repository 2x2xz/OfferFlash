import { randomUUID } from 'node:crypto';
import type { Profile } from '../../shared/src/contracts.js';
import { BACKGROUND_QUEUE_CAPABILITY, type ApplicationQueueState, type ApplicationQueueItem } from '../../shared/src/application-queue.js';

/** Private host target. URLs are never accepted through the queue renderer DTO. */
export interface ApplicationQueueTarget { jobId: string; company: string; title: string; url: string; }
export interface BackgroundDraftResult { verifiedCount: number; pendingCount: number; message: string; canReview: boolean; attention?: 'login'|'info'|'manual';modelRequests?:number;modelTokens?:number|null; }
export type BackgroundFailureReason = 'page-changing' | 'context-changed' | 'value-not-retained' | 'validation' | 'load-failed';
const failureMessages: Record<BackgroundFailureReason, string> = {
  'page-changing': '网页控件仍在变化，已停止并保留草稿；请等页面加载完成后重新识别。',
  'context-changed': '页面或资料版本已变化，已停止；请重新确认后继续。',
  'value-not-retained': '网页没有稳定保留输入，已停止；请检查对应字段后重新识别，不会覆盖网页修改。',
  validation: '网页格式校验未通过，已停止；请检查输入格式后继续。',
  'load-failed': '申请页未能加载，请检查网络或在浏览器中打开；尚未填写。',
};
/** Only a fixed reason is exposed; arbitrary website/transport errors stay private. */
export class BackgroundFillError extends Error {
  constructor(readonly reason: BackgroundFailureReason) { super(failureMessages[reason]); this.name = 'BackgroundFillError'; }
}
export interface BackgroundDraftPage {
  run(profile: Profile, signal: AbortSignal, progress: (verified: number, pending: number, message?:string) => void): Promise<BackgroundDraftResult>;
  dispose(): void;
  isReviewable?(): boolean;
}
interface QueueDependencies {
  getProfile(): Promise<Profile>;
  createPage(target: ApplicationQueueTarget, signal: AbortSignal): Promise<BackgroundDraftPage>;
  onState?(state: ApplicationQueueState): void;
}
export class ApplicationFillQueue {
  private state: ApplicationQueueState = { id: null, status: 'idle', profileVersion: null, items: [], completedCount: 0,
    totalCount: 0, activeItemId: null, sessionOnly: true, capability: BACKGROUND_QUEUE_CAPABILITY };
  private targets = new Map<string, ApplicationQueueTarget>();
  private pages = new Map<string, BackgroundDraftPage>();
  private aborts=new Map<string,AbortController>();
  private concurrency:1|3|5=1;
  private pumping?: Promise<void>;
  private disposed = false;
  private starting = false;
  constructor(private readonly deps: QueueDependencies) {}
  setConcurrency(value:1|3|5){if(this.isExecuting()||!([1,3,5] as number[]).includes(value))throw new Error('请在队列停止时选择1、3或5并发。');this.concurrency=value;this.state.concurrency=value;}
  getState(): ApplicationQueueState { return structuredClone(this.state); }
  getPage(itemId: string): BackgroundDraftPage | undefined { return this.pages.get(itemId); }
  isExecuting():boolean{return Boolean(this.pumping)||this.starting;}
  private publish(): void {
    this.state.activeItemIds=[...this.aborts.keys()];this.state.activeItemId=this.state.activeItemIds[0]??null;
    this.state.totalCount = this.state.items.length;
    this.state.completedCount = this.state.items.filter(item => ['ready-for-review', 'waiting-user', 'cancelled'].includes(item.status)).length;
    try { this.deps.onState?.(this.getState()); } catch { /* UI cannot alter execution. */ }
  }
  async enqueue(targets: ApplicationQueueTarget[], profileVersion: number): Promise<ApplicationQueueState> {
    if (this.disposed || this.isExecuting() || this.state.status === 'running' || this.state.status === 'paused') throw new Error('请先等待当前后台队列完全停止。');
    if (!Number.isInteger(profileVersion) || profileVersion < 0 || (await this.deps.getProfile()).version !== profileVersion) throw new Error('个人资料已变化，请重新确认后台填写。');
    if (!targets.length || targets.length > 6 || new Set(targets.map(target => target.jobId)).size !== targets.length) throw new Error('每轮请选择 1–6 个不同岗位。');
    for (const target of targets) {
      const url = new URL(target.url);
      if (url.protocol !== 'https:' || url.username || url.password || !target.jobId || !target.company || !target.title) throw new Error('后台队列仅支持已保存的 HTTPS 岗位。');
    }
    // Prior pages stay alive for explicit review; never discard filled DOM when starting another round.
    if (this.pages.size + targets.length > 12) throw new Error('已保留较多网页草稿，请先检查并关闭旧草稿再开始新一轮。');
    if (targets.some(target => this.state.items.some(item => item.jobId === target.jobId && item.canReview))) throw new Error('所选岗位已有保留草稿，请先检查，避免重复填写。');
    const items: ApplicationQueueItem[] = targets.map(target => ({ id: randomUUID(), jobId: target.jobId, company: target.company, title: target.title,enqueuedAt:new Date().toISOString(),
      status: 'queued', verifiedCount: 0, pendingCount: 0, message: '等待后台填写', canReview: false }));
    this.state = { ...this.state, id: randomUUID(), profileVersion, status: 'idle', activeItemId: null,
      items: [...this.state.items.filter(item => item.canReview), ...items] };
    this.targets.clear();
    for (const [index,item] of items.entries()) this.targets.set(item.id,targets[index]!);
    this.publish(); return this.getState();
  }
  async startPrepared(): Promise<ApplicationQueueState> {
    if (this.disposed || this.isExecuting() || this.state.status !== 'idle' || !this.state.items.some(item => item.status === 'queued')) throw new Error('请先选择后台填写岗位，或等待当前操作结束。');
    this.starting=true;
    try {
      const id=this.state.id;
      if ((await this.deps.getProfile()).version !== this.state.profileVersion) throw new Error('资料已变化，请重新确认后台队列。');
      if(this.state.status!=='idle'||this.state.id!==id||this.disposed)throw new Error('队列已取消或变化。');
      this.state.status='running';this.publish();this.launch();return this.getState();
    } finally{this.starting=false;}
  }
  async start(targets: ApplicationQueueTarget[], profileVersion: number): Promise<ApplicationQueueState> {
    await this.enqueue(targets,profileVersion);return this.startPrepared();
  }
  pause(): ApplicationQueueState {
    if (this.state.status === 'running') { this.state.status = 'paused'; for(const controller of this.aborts.values())controller.abort(); this.publish(); }
    return this.getState();
  }
  async resume(profileVersion: number): Promise<ApplicationQueueState> {
    if (this.starting || this.state.status !== 'paused') return this.getState();
    this.starting=true;
    try {
    if (profileVersion !== this.state.profileVersion || (await this.deps.getProfile()).version !== profileVersion) throw new Error('资料版本已变化，请结束本轮并重新确认队列。');
    await this.pumping;
    if(this.state.status!=='paused'||this.disposed)throw new Error('队列已取消或变化。');
    this.state.status = 'running'; this.publish(); this.launch(); return this.getState();
    } finally{this.starting=false;}
  }
  cancel(): ApplicationQueueState {
    if (this.state.status === 'running' || this.state.status === 'paused' || this.state.status==='idle'&&this.state.id) {
      this.state.status = 'cancelled'; for(const controller of this.aborts.values())controller.abort();
      for (const item of this.state.items) if (item.status === 'queued') { item.status = 'cancelled'; item.message = '已取消，未填写'; }
      this.publish();
    }
    return this.getState();
  }
  private launch(): void {
    this.pumping = Promise.all(Array.from({length:this.concurrency},()=>this.pump())).then(()=>{
      if(this.state.status==='running'){this.state.status=this.state.items.some(item=>item.status==='queued')?'paused':'finished';this.publish();}
    }).catch(() => {
      for(const controller of this.aborts.values())controller.abort();
      this.state.status='paused';this.state.activeItemId=null;this.publish();
    }).finally(() => { this.pumping = undefined; });
  }
  private async pump(): Promise<void> {
    while (!this.disposed && this.state.status === 'running') {
      const item = this.state.items.find(candidate => candidate.status === 'queued');
      if (!item) return;
      // Claim before the first await, so simultaneous workers never select one item twice.
      item.status='loading';
      item.startedAt=new Date().toISOString();const itemStart=performance.now();
      const controller = new AbortController(); this.aborts.set(item.id,controller);
      this.state.activeItemId = item.id; item.status = 'loading'; item.activity = 'reading'; item.message = '在后台打开网页'; this.publish();
      try {
        const profile=await this.deps.getProfile();
        if(this.state.status!=='running'||controller.signal.aborted)throw new BackgroundFillError('context-changed');
        if(profile.version!==this.state.profileVersion){this.state.status='paused';for(const c of this.aborts.values())c.abort();throw new BackgroundFillError('context-changed');}
        const page = await this.deps.createPage(this.targets.get(item.id)!, controller.signal);
        this.pages.set(item.id, page); item.canReview = true;
        if (controller.signal.aborted) throw new Error('aborted');
        item.status = 'filling'; item.activity = 'filling'; item.message = '识别空白普通字段并独立核对'; this.publish();
        const result = await page.run(profile, controller.signal, (verified, pending,message) => {
          item.verifiedCount = verified; item.pendingCount = pending;
          item.message = message === '重新核对并重试当前字段' ? message : `后台已核实 ${verified} 项，继续填写并核对`;
          item.activity = message === '重新核对并重试当前字段' ? 'retrying' : 'filling';
          this.publish();
        });
        if(controller.signal.aborted || (this.state as ApplicationQueueState).status!=='running')throw new Error('本轮已停止。');
        Object.assign(item, result);
        item.status = result.pendingCount ? 'waiting-user' : 'ready-for-review';
      } catch (error) {
        item.status = (this.state as ApplicationQueueState).status === 'cancelled' ? 'cancelled' : 'waiting-user';
        item.pendingCount = Math.max(1, item.pendingCount);
        item.attention = 'manual';
        item.message = controller.signal.aborted ? '已停止；保留当前草稿供你检查'
          : error instanceof BackgroundFillError && Object.hasOwn(failureMessages, error.reason) ? failureMessages[error.reason]
          : '此页未能完成核对，请打开草稿检查；已继续处理下一家。';
      } finally {
        item.finishedAt=new Date().toISOString();item.durationMs=performance.now()-itemStart;
        item.activity = undefined;
        if (this.pages.get(item.id)?.isReviewable?.() === false) {
          item.canReview = false;this.pages.get(item.id)?.dispose();this.pages.delete(item.id);
        }
        this.aborts.delete(item.id); this.publish();
      }
    }
  }
  /** Exact item only; explicit closing releases a session-only draft. */
  closePage(itemId: string): void {
    if(this.aborts.has(itemId))throw new Error('请先停止此页填写。');
    this.pages.get(itemId)?.dispose(); this.pages.delete(itemId);
    const item=this.state.items.find(candidate=>candidate.id===itemId);
    if(item){item.canReview=false;item.message='这份运行期草稿已关闭';}this.publish();
  }
  dispose(): void { this.disposed = true; this.cancel(); for (const page of this.pages.values()) page.dispose(); this.pages.clear(); }
  /** For deterministic host tests/shutdown; normal IPC starts without blocking. */
  async settled(): Promise<void> { await this.pumping; }
}
