/** Session-only background drafts. No state here means an application was submitted. */
export type ApplicationQueueItemStatus = 'queued' | 'loading' | 'filling' | 'ready-for-review' | 'waiting-user' | 'cancelled';
export interface ApplicationQueueItem {
  modelRequests?:number;modelTokens?:number|null;
  enqueuedAt?:string;startedAt?:string;finishedAt?:string;durationMs?:number;
  activity?: 'reading' | 'filling' | 'retrying';
  attention?: 'login' | 'info' | 'manual';
  id: string;
  jobId: string;
  company: string;
  title: string;
  status: ApplicationQueueItemStatus;
  verifiedCount: number;
  pendingCount: number;
  message: string;
  canReview: boolean;
}
export interface ApplicationQueueState {
  concurrency?:1|3|5;
  activeItemIds?:string[];
  executionMode?:'rules'|'model-agent';
  id: string | null;
  status: 'idle' | 'running' | 'paused' | 'finished' | 'cancelled';
  profileVersion: number | null;
  items: ApplicationQueueItem[];
  completedCount: number;
  totalCount: number;
  activeItemId: string | null;
  sessionOnly: true;
  capability: string;
}
export interface ApplicationQueueStartInput {
  useModel?:boolean;
  concurrency?:1|3|5;
  /** IDs are resolved by the host; there are no renderer URLs, selectors or values. */
  jobIds: string[];
  profileVersion: number;
  acknowledgeAutosave: true;
  /** Host takes the URL from its own current browser state, never from this DTO. */
  currentPageForJobId?: string;
}
export const BACKGROUND_QUEUE_CAPABILITY = '后台支持空白普通文本、原生单选框、已确认的毕业月份，以及面壁智能已审阅旧版网申中的经历文本、学历和起止年月（含至今）。学校联想选择、新增经历、其它未适配控件、登录验证码、附件及最终提交需你处理。网页可能自动保存。草稿仅在本次应用运行期间保留。';
