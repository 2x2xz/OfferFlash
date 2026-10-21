import type {AgentQuestionRequest,AgentQuestionResult} from '../../shared/src/agent-questions.js';
import type { RuntimeEvent, RunStatus } from '../../runtime/src/runtime.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: RunStatus;
  partial?: boolean;
  error?: string;
  requestText?: string;
}
interface ActiveRequest {
  id: string;
  input: string;
  startedAt: number;
  taskId?: string;
  lastSequence: number;
  recovered?:boolean;
  text: string;
  error?: string;
}
export interface AgentUiState {
  composerDraft: string;
  messages: ChatMessage[];
  events: RuntimeEvent[];
  active?: ActiveRequest;
  retiredTaskIds: string[];
}
export type AgentUiAction =
  | {type:'resume-question';request:AgentQuestionRequest}
  | {type:'question-answer';request:AgentQuestionRequest;result:AgentQuestionResult}
  | { type: 'draft'; text: string }
  | { type: 'start'; requestId: string; input: string; startedAt: number }
  | { type: 'event'; event: RuntimeEvent }
  | { type: 'finish'; requestId: string; taskId?: string; status: RunStatus; finalText: string; error?: string }
  | { type: 'restore'; messageId: string };

export function createAgentUiState(): AgentUiState {
  return { composerDraft: '', messages: [], events: [], retiredTaskIds: [] };
}

export function agentUiReducer(state: AgentUiState, action: AgentUiAction): AgentUiState {
  if (action.type === 'draft') return { ...state, composerDraft: action.text };
  if (action.type === 'restore') {
    if (state.composerDraft.trim()) return state;
    const message = state.messages.find(item => item.id === action.messageId && item.role === 'assistant');
    if (!message?.requestText || !['failed', 'cancelled'].includes(message.status ?? '')) return state;
    return { ...state, composerDraft: message.requestText };
  }
  if (action.type === 'start') {
    if (state.active || !action.input.trim()) return state;
    return {
      ...state,
      composerDraft: state.composerDraft === action.input ? '' : state.composerDraft,
      messages: [...state.messages, { id: `${action.requestId}-user`, role: 'user', text: action.input }],
      events: [],
      active: { id: action.requestId, input: action.input, startedAt: action.startedAt, lastSequence: -1, text: '' },
    };
  }
  if(action.type==='resume-question'){
    if(state.active||state.retiredTaskIds.includes(action.request.taskId))return state;
    return {...state,active:{id:'recovered-'+action.request.taskId,input:'',startedAt:Date.parse(action.request.createdAt),taskId:action.request.taskId,lastSequence:-1,text:'',recovered:true}};
  }
  const active = state.active;
  if (!active) return state;
  if(action.type==='question-answer'){
    if(active.taskId!==action.request.taskId||state.messages.some(message=>message.id===action.request.id+'-reply'))return state;
    const prompt=[active.text.trim(),...action.request.questions.map(q=>q.prompt)].filter(Boolean).join('\n\n');
    const answer=action.result.status==='skipped'?'本次暂时跳过':action.result.answers.map(answer=>{const q=action.request.questions.find(q=>q.id===answer.questionId);return(q?q.prompt+'：':'')+answer.answer;}).join('\n');
    return {...state,messages:[...state.messages,{id:action.request.id+'-prompt',role:'assistant',text:prompt},{id:action.request.id+'-reply',role:'user',text:answer}],active:{...active,text:''}};
  }
  if (action.type === 'event') {
    const event = action.event;
    if (state.retiredTaskIds.includes(event.taskId)) return state;
    if (!active.taskId && (event.type !== 'task_started' || Date.parse(event.time) < active.startedAt)) return state;
    if (active.taskId && active.taskId !== event.taskId) return state;
    if (!Number.isFinite(Date.parse(event.time)) || event.sequence <= active.lastSequence) return state;
    if(event.type==='task_settled'&&active.recovered)return agentUiReducer(state,{type:'finish',requestId:active.id,taskId:event.taskId,status:['completed','cancelled'].includes(String(event.data.status))?event.data.status as 'completed'|'cancelled':'failed',finalText:active.text});
    return {
      ...state,
      events: [...state.events, event].slice(-350),
      active: {
        ...active, taskId: event.taskId, lastSequence: event.sequence,
        text: event.type === 'text_delta' && typeof event.data.delta === 'string' ? active.text + event.data.delta : active.text,
        error: event.type === 'task_error' && typeof event.data.message === 'string' ? event.data.message : active.error,
      },
    };
  }
  if (action.requestId !== active.id) return state;
  const mismatched = active.taskId && action.taskId && active.taskId !== action.taskId;
  const status = mismatched ? 'failed' : action.status;
  const finalText = mismatched ? '' : action.finalText;
  const error = mismatched ? '返回结果与当前任务不匹配，未确认完成。' : action.error || active.error;
  const partial = !!active.text && (status !== 'completed' || !finalText.trim());
  const fallback = status === 'cancelled' ? '本次任务已停止，没有完整文字回复。'
    : status === 'failed' ? '本次任务未完成，请查看错误和操作记录。' : '本轮已结束，但没有完整文字回复。';
  const message: ChatMessage = {
    id: action.taskId ?? active.taskId ?? `${active.id}-assistant`, role: 'assistant',
    text: finalText.trim() ? finalText : active.text || fallback,
    status, partial, ...(error ? { error } : {}), requestText: active.input,
  };
  const retired = [...state.retiredTaskIds, active.taskId, action.taskId].filter((id): id is string => !!id);
  return { ...state, active: undefined, messages: [...state.messages, message], retiredTaskIds: [...new Set(retired)].slice(-100) };
}

export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}
export function isComposerSubmitKey(key: ComposerKey): boolean {
  return key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== 229;
}
export function canSubmitComposer(draft: string, busy: boolean): boolean { return !busy && !!draft.trim(); }
export function shouldFollowChatScroll(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= 64;
}

export const AGENT_TOOL_LABELS: Record<string, string> = {
  request_user_input:'等待你的回答',
  get_profile_summary: '读取已确认职业概要', query_jobs: '查询本地岗位', refresh_jobs: '采集指定招聘来源',
  list_applications: '查看申请进度', add_to_tracker: '加入申请跟踪', open_job: '打开岗位官网',
  prepare_form_preview: '生成本地填写预览', get_job_details: '读取已保存岗位详情',
  get_task_guide: '读取任务操作说明', get_application_agenda: '整理申请截止事项', compare_jobs: '对比已保存岗位',
};
export function agentEventLabel(event: RuntimeEvent): string {
  const recordingTools:Record<string,string>={inspect_application:'读取真实表单控件',get_candidate_history:'读取已确认演示履历',plan_resume_records:'确定本次履历填写范围'};
  if(typeof event.data.toolName==='string'&&Object.hasOwn(recordingTools,event.data.toolName)&&['tool_started','tool_finished'].includes(event.type))return event.type==='tool_started'?`正在${recordingTools[event.data.toolName]}`:`${recordingTools[event.data.toolName]}${event.data.isError?'未完成':'结果已返回'}`;
  const operation = typeof event.data.toolName === 'string' && Object.hasOwn(AGENT_TOOL_LABELS, event.data.toolName)
    ? AGENT_TOOL_LABELS[event.data.toolName]! : '处理当前操作';
  switch (event.type) {
    case 'task_started': return '开始处理本次问题';
    case 'workflow_progress': return ({ profile: '正在读取已确认的求职资料', 'search-mainland': '正在查找国内官网岗位', 'search-overseas': '正在按你的要求查找海外来源',
      'search-library': '正在查询岗位库', 'track-results': '正在加入待申请', 'open-result': '正在打开所选岗位网申',
      clarify: '需要明确要处理的岗位', results: '岗位操作结果已返回', failed: '岗位操作未完成', cancelled: '岗位操作已停止' } as Record<string, string>)[String(event.data.phase)] ?? '正在执行岗位操作';
    case 'tool_started': return `正在${operation}`;
    case 'tool_finished': return event.data.isError ? `${operation}未完成` : `${operation}结果已返回`;
    case 'sdk_settled': return event.data.aborted ? '本轮生成已停止' : '本轮生成已结束';
    case 'task_error': return '本轮遇到问题';
    case 'task_settled': return event.data.status === 'cancelled' ? '任务已停止' : event.data.status === 'failed' ? '任务未完成' : '本轮回答已完成';
    default: return '任务进度已更新';
  }
}
