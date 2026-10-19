import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_TOOL_LABELS, agentEventLabel, agentUiReducer, canSubmitComposer, createAgentUiState,
  isComposerSubmitKey, shouldFollowChatScroll, type AgentUiState,
} from '../packages/ui/src/agent-state.js';
import { DOMAIN_TOOL_SPECS } from '../packages/agent/src/tools.js';
import type { RuntimeEvent } from '../packages/runtime/src/runtime.js';

const epoch = Date.parse('2026-10-12T10:00:00Z');
function event(taskId: string, type: RuntimeEvent['type'], sequence: number, data: Record<string, unknown> = {}, time = epoch + sequence): RuntimeEvent {
  return { taskId, type, sequence, data, time: new Date(time).toISOString() };
}
function begin(input = '分析本地岗位', id = 'request-1'): AgentUiState {
  const draft = agentUiReducer(createAgentUiState(), { type: 'draft', text: input });
  const started = agentUiReducer(draft, { type: 'start', requestId: id, input, startedAt: epoch });
  return agentUiReducer(started, { type: 'event', event: event(`${id}-task`, 'task_started', 1) });
}
function delta(state: AgentUiState, text: string, sequence = 2): AgentUiState {
  return agentUiReducer(state, { type: 'event', event: event(state.active!.taskId!, 'text_delta', sequence, { delta: text }) });
}

test('a running request preserves the next draft when its final reply arrives', () => {
  let state = begin('原问题\n第二行');
  assert.equal(state.composerDraft, '');
  state = agentUiReducer(state, { type: 'draft', text: '下一条尚未发送的草稿\n保留原文' });
  state = delta(state, '临时说明');
  state = agentUiReducer(state, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '完整答复' });
  assert.equal(state.composerDraft, '下一条尚未发送的草稿\n保留原文');
  assert.equal(state.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(state.messages.at(-1)?.text, '完整答复');
  assert.equal(state.messages.at(-1)?.partial, false);
  assert.equal(state.active, undefined);
});

test('draft preparation creates no request and double start cannot add a second user message', () => {
  const prepared = agentUiReducer(createAgentUiState(), { type: 'draft', text: '演示：查看本地申请进度。' });
  assert.equal(prepared.messages.length, 0);
  assert.equal(prepared.events.length, 0);
  assert.equal(prepared.active, undefined);
  const started = agentUiReducer(prepared, { type: 'start', requestId: 'one', input: prepared.composerDraft, startedAt: epoch });
  const duplicate = agentUiReducer(started, { type: 'start', requestId: 'two', input: '另一条问题', startedAt: epoch });
  assert.equal(duplicate, started);
  assert.equal(duplicate.messages.length, 1);
  assert.equal(duplicate.active?.id, 'one');
});

test('task binding rejects deltas before start and stale task_started timestamps', () => {
  const state = agentUiReducer(createAgentUiState(), { type: 'start', requestId: 'new', input: '新问题', startedAt: epoch });
  assert.equal(agentUiReducer(state, { type: 'event', event: event('old', 'text_delta', 50, { delta: '旧文字' }) }), state);
  assert.equal(agentUiReducer(state, { type: 'event', event: event('old', 'task_started', 49, {}, epoch - 1) }), state);
  const bound = agentUiReducer(state, { type: 'event', event: event('new-task', 'task_started', 1) });
  assert.equal(bound.active?.taskId, 'new-task');
  assert.equal(agentUiReducer(bound, { type: 'event', event: event('another-task', 'text_delta', 60, { delta: '无关文字' }) }), bound);
});

test('duplicate and out-of-order deltas do not duplicate text or corrupt current progress', () => {
  const state = delta(begin(), '只保留一次', 4);
  assert.equal(agentUiReducer(state, { type: 'event', event: event('request-1-task', 'text_delta', 4, { delta: '重复' }) }), state);
  assert.equal(agentUiReducer(state, { type: 'event', event: event('request-1-task', 'text_delta', 3, { delta: '晚到旧片段' }) }), state);
  assert.equal(state.active?.text, '只保留一次');
});

test('failure keeps seen partial output and error but does not treat it as a completed reply', () => {
  let state = delta(begin(), '已查看本地列表，接下来');
  state = agentUiReducer(state, { type: 'event', event: event('request-1-task', 'task_error', 3, { message: '本地fixture连接中断' }) });
  state = agentUiReducer(state, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'failed', finalText: '' });
  const message = state.messages.at(-1)!;
  assert.equal(message.text, '已查看本地列表，接下来');
  assert.equal(message.partial, true);
  assert.equal(message.status, 'failed');
  assert.equal(message.error, '本地fixture连接中断');
  assert.equal(state.active, undefined);
});

test('cancelled output and exact request text remain available without automatically retrying', () => {
  let state = delta(begin('  核对问题\n    保留缩进\n'), '已开始读取资料');
  state = agentUiReducer(state, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'cancelled', finalText: '' });
  const cancelled = state.messages.at(-1)!;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.partial, true);
  assert.equal(state.composerDraft, '');
  const restored = agentUiReducer(state, { type: 'restore', messageId: cancelled.id });
  assert.equal(restored.composerDraft, '  核对问题\n    保留缩进\n');
  assert.equal(restored.active, undefined);
  assert.equal(restored.messages, state.messages);
  assert.equal(restored.events, state.events);
});

test('manual recovery never replaces a newer draft and completed messages cannot restore a request', () => {
  const failed = agentUiReducer(begin(), { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'failed', finalText: '', error: '模拟错误' });
  const newDraft = agentUiReducer(failed, { type: 'draft', text: '新的问题还没发送' });
  assert.equal(agentUiReducer(newDraft, { type: 'restore', messageId: failed.messages.at(-1)!.id }), newDraft);
  const completed = agentUiReducer(begin(), { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '已回答' });
  assert.equal(agentUiReducer(completed, { type: 'restore', messageId: completed.messages.at(-1)!.id }), completed);
});

test('late old events and old responses cannot append to or finish a new request', () => {
  const old = agentUiReducer(begin(), { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'cancelled', finalText: '' });
  const fresh = agentUiReducer(old, { type: 'start', requestId: 'request-2', input: '新的问题', startedAt: epoch });
  assert.equal(agentUiReducer(fresh, { type: 'event', event: event('request-1-task', 'task_started', 60) }), fresh);
  const bound = agentUiReducer(fresh, { type: 'event', event: event('request-2-task', 'task_started', 1) });
  assert.equal(agentUiReducer(bound, { type: 'event', event: event('request-1-task', 'text_delta', 61, { delta: '旧输出' }) }), bound);
  assert.equal(agentUiReducer(bound, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '旧结果' }), bound);
  assert.equal(bound.active?.id, 'request-2');
  assert.equal(bound.active?.text, '');
});

test('a response with the wrong runtime task identity is not accepted as success', () => {
  const state = agentUiReducer(delta(begin(), '当前已看到的片段'), { type: 'finish', requestId: 'request-1', taskId: 'unrelated-task', status: 'completed', finalText: '不能使用的另一任务答案' });
  assert.equal(state.messages.at(-1)?.status, 'failed');
  assert.equal(state.messages.at(-1)?.text, '当前已看到的片段');
  assert.equal(state.messages.at(-1)?.partial, true);
  assert.match(state.messages.at(-1)?.error ?? '', /不匹配/);
});

test('a final answer replaces earlier progress once and an empty final does not erase seen text', () => {
  const started = delta(begin(), '先做检查。');
  const finished = agentUiReducer(started, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '最终结论。' });
  assert.equal(finished.messages.at(-1)?.text, '最终结论。');
  assert.equal(finished.messages.length, 2);
  assert.equal(agentUiReducer(finished, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '重复回复' }), finished);
  const empty = agentUiReducer(started, { type: 'finish', requestId: 'request-1', taskId: 'request-1-task', status: 'completed', finalText: '' });
  assert.equal(empty.messages.at(-1)?.text, '先做检查。');
  assert.equal(empty.messages.at(-1)?.partial, true);
});

test('Chinese composition, legacy keyCode 229, Shift Enter and busy state do not submit', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(isComposerSubmitKey(enter), true);
  assert.equal(isComposerSubmitKey({ ...enter, isComposing: true }), false);
  assert.equal(isComposerSubmitKey({ ...enter, keyCode: 229 }), false);
  assert.equal(isComposerSubmitKey({ ...enter, shiftKey: true }), false);
  assert.equal(isComposerSubmitKey({ ...enter, key: 'Escape' }), false);
  assert.equal(canSubmitComposer('真实准备的问题', true), false);
  assert.equal(canSubmitComposer(' \n ', false), false);
  assert.equal(canSubmitComposer('真实准备的问题', false), true);
});

test('scroll following only stays active near the bottom, allowing a reader to examine older output', () => {
  assert.equal(shouldFollowChatScroll(2000, 1500, 500), true);
  assert.equal(shouldFollowChatScroll(2000, 1450, 500), true);
  assert.equal(shouldFollowChatScroll(2000, 1100, 500), false);
  assert.equal(shouldFollowChatScroll(3000, 1100, 500), false);
  assert.equal(shouldFollowChatScroll(3000, 2500, 500), true);
});

test('progress covers current domain tools and never calls tool return or model completion a successful application', () => {
  assert.deepEqual(Object.keys(AGENT_TOOL_LABELS).sort(), DOMAIN_TOOL_SPECS.map(tool => tool.name).sort());
  assert.equal(new Set(Object.values(AGENT_TOOL_LABELS)).size, DOMAIN_TOOL_SPECS.length);
  for (const tool of DOMAIN_TOOL_SPECS) {
    const label = agentEventLabel(event('task', 'tool_finished', 1, { toolName: tool.name, isError: false }));
    assert.match(label, /结果已返回/);
    assert.doesNotMatch(label, /投递成功|申请成功/);
  }
  assert.match(agentEventLabel(event('task', 'tool_finished', 1, { toolName: 'query_jobs', isError: true })), /未完成/);
  assert.match(agentEventLabel(event('task', 'task_settled', 2, { status: 'cancelled' })), /已停止/);
  assert.doesNotMatch(agentEventLabel(event('task', 'task_settled', 3, { status: 'completed' })), /投递成功|申请成功/);
  for (const name of ['unknown_tool', 'toString', 'constructor']) {
    assert.equal(agentEventLabel(event('task', 'tool_started', 1, { toolName: name })), '正在处理当前操作');
  }
});

test('actual host failure results take precedence over an earlier promise-only streaming fragment', () => {
  let state = createAgentUiState();
  state = agentUiReducer(state, { type: 'start', requestId: 'host-result', input: '帮我找岗位', startedAt: 1 });
  state = agentUiReducer(state, { type: 'event', event: { sequence: 1, taskId: 'host-task', time: new Date(2).toISOString(), type: 'task_started', data: {} } });
  state = agentUiReducer(state, { type: 'event', event: { sequence: 2, taskId: 'host-task', time: new Date(3).toISOString(), type: 'text_delta', data: { delta: '请稍等，正在获取' } } });
  state = agentUiReducer(state, { type: 'finish', requestId: 'host-result', taskId: 'host-task', status: 'failed', finalText: '实际访问的来源未完成，不能确认有合适岗位。' });
  assert.equal(state.messages.at(-1)?.text, '实际访问的来源未完成，不能确认有合适岗位。');
  assert.equal(state.messages.at(-1)?.status, 'failed');
});
