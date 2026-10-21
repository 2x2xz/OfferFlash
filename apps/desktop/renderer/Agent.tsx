import {AgentQuestionPrompt} from './AgentQuestionPrompt.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bot, Copy, Globe, RotateCcw, Settings2, Sparkles, Square } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorMessage } from './components.js';
import { AssistantOutput } from './AssistantOutput.js';
import { ModelUsageStrip } from './ModelUsageStrip.js';
import { useWorkspace } from './context.js';
import { dateLabel, errorText } from './helpers.js';
import { agentEventLabel, canSubmitComposer, isComposerSubmitKey, shouldFollowChatScroll } from '../../../packages/ui/src/agent-state.js';
import './AgentDock.css';

export function AgentPage({ embedded = false, inputLocked = false, children }: { embedded?: boolean; inputLocked?: boolean; children?: ReactNode } = {}) {
  const { api, model, messages, events, streamText, agentBusy, runAgent, openModel, openBrowser, notify,
    composerDraft, setComposerDraft, restoreAgentRequest, navigate,agentQuestion,answerAgentQuestion } = useWorkspace();
  const [cancelling, setCancelling] = useState(false); const [following, setFollowing] = useState(true);
  const interactionLocked = embedded && inputLocked;
  const body = useRef<HTMLDivElement>(null); const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (following && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [messages.length, streamText, following]);
  useEffect(() => {
    if (!composer.current) return;
    composer.current.style.height = 'auto';
    composer.current.style.height = `${Math.min(180, composer.current.scrollHeight)}px`;
  }, [composerDraft]);
  const timeline = events.filter(event => event.type !== 'text_delta').slice(-14);
  const lastEvent = timeline.at(-1);
  const activity = agentQuestion?'正在等待你的回答':cancelling ? '正在停止，等待在途操作收尾。' : agentBusy
    ? lastEvent ? agentEventLabel(lastEvent) : '正在开始本次任务。' : '可以发送新的问题。';
  const starters = model.mode === 'demo' ? [
    { label: '查看本地岗位', text: '演示：查看本地已保存的岗位，并区分虚构记录。' },
    { label: '查看申请进度', text: '演示：查看本地申请进度。' },
  ] : [
    { label: '找新岗位', text: '根据我的已确认资料，帮我查找国内适合我的校招和实习岗位。' },
    { label: '整理申请事项', text: '整理我未来7天的申请截止事项，区分需要我处理的事项和等待企业反馈。' },
    { label: '准备填写预览', text: '为当前浏览器表单生成本地填写预览，保留已有值和待确认字段，不执行填写或提交。' },
  ];
  const dockStarters = model.mode === 'demo' ? [
    { label: '本地岗位', text: '演示：查看本地已保存的岗位，并区分虚构记录。' },
    { label: '申请进度', text: '演示：查看本地申请进度。' },
  ] : [
    { label: '识别网申', text: '请读取我的已确认履历和当前真实网申，识别输入框，准备全部教育、实习和项目的自动填写计划。随后填写并核对，不上传附件、不提交申请。' },
    { label: '找新岗位', text: '根据我的已确认资料，帮我查找国内适合我的校招和实习岗位。' },
    { label: '申请进度', text: '整理我未来7天的申请截止事项，区分需要我处理的事项和等待企业反馈。' },
  ];
  function prepareQuestion(text: string) {
    if (interactionLocked||agentQuestion) return;
    if (composerDraft.trim()) { notify('输入框已有草稿，请先保留或清空它，再准备其他问题。'); return; }
    setComposerDraft(text); composer.current?.focus();
  }
  async function send() {
    if (interactionLocked || !canSubmitComposer(composerDraft, agentBusy)) return;
    setFollowing(true); await runAgent(composerDraft);
  }
  async function cancel() {
    setCancelling(true);
    try { await api.cancelAgent(); } catch (error) { notify(errorText(error), true); } finally { setCancelling(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify('已复制文字。'); }
    catch { notify('复制失败，请选中文字后手动复制。', true); }
  }
  return <div className={embedded ? 'agent-page agent-dock' : 'agent-page'} data-testid={embedded ? 'agent-dock' : 'agent-page'} data-input-locked={interactionLocked}><div className="agent-layout">
    <section className="card chat-card">
      {embedded ? <div className="chat-heading agent-dock-heading">
        <div className="agent-dock-identity"><span className="agent-dock-mark" aria-hidden="true"><Sparkles size={18} /></span><div><h2>Agent</h2><span className="agent-dock-mode"><span className="dot" aria-hidden="true" />{model.mode === 'demo' ? '本地查询 · 未连接模型' : '在线助手'}</span></div></div>
        <button type="button" className="icon-button" disabled={agentBusy || interactionLocked} onClick={openModel} aria-label="模型设置" title="模型设置"><Settings2 size={16} /></button>
      </div> : <div className="chat-heading"><span className="row"><span className="dot" />OfferFlash 助手<Badge tone={model.mode === 'demo' ? 'amber' : 'green'}>{model.mode === 'demo' ? '离线演示' : '在线模型模式'}</Badge></span><button className="text-link" disabled={agentBusy} onClick={openModel}><Settings2 size={13} />模型设置</button></div>}
      {model.mode === 'live' && <ModelUsageStrip api={api} />}
      <div className="agent-task-starters" aria-label="准备常用问题">
        {!embedded && <span>准备问题</span>}{(embedded ? dockStarters : starters).map(starter => <button type="button" className="quick-prompt" key={starter.label} disabled={interactionLocked||!!agentQuestion} onClick={() => prepareQuestion(starter.text)} aria-label={`准备问题：${starter.label}`}>{starter.label}</button>)}
        {embedded && <button type="button" className="quick-prompt" disabled={interactionLocked||!!agentQuestion} onClick={() => navigate('browser')} aria-label="打开网申页面"><Globe size={12} />打开网申</button>}
      </div>
      <div ref={body} className="chat-body" data-testid={embedded ? 'agent-dock-messages' : undefined} role="log" aria-label="对话记录" aria-live="off" onScroll={event => { const element = event.currentTarget; setFollowing(shouldFollowChatScroll(element.scrollHeight, element.scrollTop, element.clientHeight)); }}>
        {!messages.length && !agentBusy ? embedded ? <div className="agent-dock-intro"><p>{model.mode === 'demo' ? '一键填写在右侧；这里可查询已保存的岗位与进度。' : '选岗位、看进度，或说说你的下一步。'}</p></div> : <div className="chat-intro">
          <div className="assistant-mark"><Sparkles size={25} strokeWidth={1.5} /></div><h2>需要时，一起想下一步</h2>
          <p>{model.mode === 'demo' ? '当前用固定流程查询本地岗位和申请，不理解任意请求，也不搜索实时招聘。准备一个演示问题后，核对再发送。' : '先准备一个问题，或直接描述需求。只有点击发送才会开始任务；操作记录会显示在右侧。'}</p>
          {model.mode === 'demo' && <button type="button" className="text-link" onClick={openModel}>配置自己的在线模型</button>}
        </div> : <>
          {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id} data-message-id={message.id} data-message-status={message.status}>
            <span className="message-icon">{message.role === 'assistant' ? <Bot size={15} /> : '我'}</span>
            <div className="message-content">
              {message.role === 'assistant' && (message.partial || message.status !== 'completed') && <div className="chat-message-status">
                {message.partial && <Badge tone="amber">未完成的部分回复</Badge>}
                {message.status === 'cancelled' && <Badge>本次已停止</Badge>}
                {message.status === 'failed' && <Badge tone="red">本次未完成</Badge>}
              </div>}
              {message.role === 'assistant' ? <AssistantOutput text={message.text} onOpenLink={url => { void openBrowser(url); }} /> : <div className="user-message-text">{message.text}</div>}
              {message.error && <ErrorMessage message={message.error} />}
              {message.role === 'assistant' && ['failed', 'cancelled'].includes(message.status ?? '') && <p className="chat-recovery-note">可把原问题放回输入框再修改。不会自动重试；网页与业务结果仍需核对实际记录。</p>}
              <div className="chat-message-actions">
                <button type="button" className="text-link" onClick={() => void copy(message.text)} aria-label={message.role === 'user' ? '复制问题' : message.partial ? '复制部分回复' : '复制回复'}><Copy size={12} />复制{message.partial ? '片段' : ''}</button>
                {message.role === 'assistant' && ['failed', 'cancelled'].includes(message.status ?? '') && <button type="button" className="text-link" onClick={() => { restoreAgentRequest(message.id); composer.current?.focus(); }} aria-label="把原问题放回输入框"><RotateCcw size={12} />放回输入框</button>}
              </div>
            </div>
          </div>)}
          {agentBusy && <div className="chat-message assistant" data-streaming="true"><span className="message-icon"><Bot size={15} /></span><div className="message-content"><div className="assistant-stream">{streamText || activity}</div></div></div>}
        </>}
        {children}
      </div>
      {!following && <button type="button" className="chat-jump-latest" onClick={() => setFollowing(true)}><ArrowDown size={13} />回到最新回复</button>}
      {agentQuestion&&answerAgentQuestion&&<AgentQuestionPrompt key={agentQuestion.id} request={agentQuestion} onReply={answerAgentQuestion} onStop={cancel}/>}
      <div className="chat-activity" role="status" aria-live="polite" aria-atomic="true">{interactionLocked && !agentBusy ? '正在填写网页，结束后可继续对话' : embedded && !agentBusy && !cancelling ? '准备就绪' : activity}</div>
      {!agentQuestion&&<form className="chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <div className="compose-box">
          <textarea ref={composer} aria-label="发送给助手的消息" disabled={interactionLocked||!!agentQuestion} placeholder={interactionLocked ? '网页填写中…' : agentBusy ? '可以先写下一条问题，当前任务结束后再发送…' : model.mode === 'demo' ? embedded ? '查询岗位、进度，或配置模型后自由对话…' : '准备一次本地演示查询…' : '描述你想分析或准备的事情…'} rows={2} value={composerDraft} onChange={event => setComposerDraft(event.target.value)} onKeyDown={event => {
            if (isComposerSubmitKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); void send(); }
          }} />
          {agentBusy ? <Button type="button" variant="danger" busy={cancelling} onClick={() => void cancel()} aria-label="停止当前任务">{!cancelling && <Square size={13} />}</Button> : <Button type="submit" disabled={interactionLocked || !canSubmitComposer(composerDraft, agentBusy)} aria-label="发送"><ArrowUp size={17} /></Button>}
        </div>
        <div className="compose-foot">{!embedded && <span>{model.mode === 'demo' ? '演示数据与真实招聘信息分开' : '发送后，相关任务上下文会交给你配置的模型服务'}</span>}<span>Enter 发送 · Shift + Enter 换行</span></div>
      </form>}
    </section>
    {!embedded && <aside className="agent-side">
      <div className="card model-card"><div className="model-title"><Sparkles size={15} color="#85a88e" />当前助手模式</div><Badge tone={model.mode === 'demo' ? 'amber' : 'green'}>{model.mode === 'demo' ? '离线演示 · 无需密钥' : '在线 AI · 用户自配'}</Badge><p className="model-caption">{model.mode === 'demo' ? '以固定演示响应读取本地岗位和申请；虚构记录有独立标记。' : `${model.provider} / ${model.modelId}`}</p><Button variant="secondary" className="button-full" disabled={agentBusy} onClick={openModel}><Settings2 size={13} />配置模型</Button></div>
      <div className="card event-card"><h3 className="event-title">最近操作</h3>{timeline.length ? <div className="event-timeline">{timeline.map(event => <div className={`event-item ${event.type === 'task_error' || event.type === 'tool_finished' && event.data.isError ? 'error' : ''}`} key={`${event.taskId}-${event.sequence}`} data-event-type={event.type} data-tool-name={typeof event.data.toolName === 'string' ? event.data.toolName : undefined}><div className="event-item-title">{agentEventLabel(event)}</div><div className="event-item-time">{dateLabel(event.time, true)}</div></div>)}</div> : <EmptyState compact icon={<Sparkles size={19} />} title="开始后显示实际进度" description="会区分读取、采集、预览及本轮结束；任务结束不代表投递成功。" />}</div>
      <div className="card agent-disclaimer">助手回答可作为参考。岗位条件、资料与投递状态以实际来源和你确认的记录为准。</div>
    </aside>}
  </div></div>;
}
