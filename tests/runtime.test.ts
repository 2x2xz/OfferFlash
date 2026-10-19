import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import {
  fauxAssistantMessage, fauxToolCall, getCurrentTools,
  type ToolResultMessage, type TranscriptContext,
} from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import { createDemoModel, makeJobSearchResponses } from '../packages/runtime/src/demo-model.js';
import {
  createOfferAgentRuntime, type CreateRuntimeOptions, type OfferAgentRuntime, type RuntimeEvent,
} from '../packages/runtime/src/runtime.js';
import {
  createDemoJobsTool, demoJobsResultSchema,
} from '../packages/runtime/src/tools/demo-jobs.js';

type DemoModel = Awaited<ReturnType<typeof createDemoModel>>;

interface Fixture {
  root: string;
  cwd: string;
  stateDir: string;
  demo: DemoModel;
  open(tools: CreateRuntimeOptions['tools'], sessionFile?: string): Promise<OfferAgentRuntime>;
}

async function withFixture(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'offeragent-runtime-test-'));
  const cwd = join(root, 'workspace');
  const stateDir = join(root, 'state');
  const runtimes: OfferAgentRuntime[] = [];
  try {
    await mkdir(cwd, { recursive: true });
    const demo = await createDemoModel();
    await body({
      root, cwd, stateDir, demo,
      async open(tools, sessionFile) {
        const runtime = await createOfferAgentRuntime({
          cwd, stateDir, tools,
          modelRuntime: demo.modelRuntime, model: demo.model,
          ...(sessionFile === undefined ? {} : { sessionFile }),
        });
        runtimes.push(runtime);
        return runtime;
      },
    });
  } finally {
    try {
      for (const runtime of runtimes.reverse()) await runtime.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function resultsIn(context: TranscriptContext): ToolResultMessage[] {
  return context.messages.filter(
    (message): message is ToolResultMessage => message.role === 'toolResult',
  );
}

function textIn(result: ToolResultMessage): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}

function assertToolFailure(events: RuntimeEvent[], callId: string): void {
  const started = events.find(event => event.type === 'tool_started' && event.data.callId === callId);
  const finished = events.find(event => event.type === 'tool_finished' && event.data.callId === callId);
  assert.ok(started, `missing tool_started for ${callId}`);
  assert.ok(finished, `missing tool_finished for ${callId}`);
  assert.equal(finished.data.isError, true);
  assert.ok(started.sequence < finished.sequence);
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('sync and async observer failures cannot stop tool execution or session persistence', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { executions++; } })]);
    runtime.subscribe(() => { throw new Error('BROKEN_SYNC_OBSERVER'); });
    runtime.subscribe(async () => { throw new Error('BROKEN_ASYNC_OBSERVER'); });
    demo.faux.setResponses(makeJobSearchResponses());
    const result = await runtime.run('检查界面观察器故障时的工具与保存。');
    await nextTurn();
    assert.equal(result.status, 'completed');
    assert.equal(executions, 1);
    assert.ok(result.sessionFile);
    const saved = await readFile(result.sessionFile, 'utf8');
    assert.match(saved, /fixture-hangzhou-llm-1/);
    assert.equal(result.events.at(-1)?.type, 'task_settled');
  });
});

async function waitFor(promise: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`Timed out waiting for ${label}`)); }, 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('real SDK sends one tool result back to the faux model and publishes ordered settlement', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { executions++; } })]);
    const observed: RuntimeEvent[] = [];
    const unsubscribe = runtime.subscribe(event => { observed.push(event); });
    let feedback: ToolResultMessage | undefined;
    const responses = makeJobSearchResponses();
    const followup = responses[1];
    assert.equal(typeof followup, 'function');
    if (typeof followup !== 'function') throw new Error('Demo response factory is missing');
    const first = responses[0];
    assert.ok(first);
    demo.faux.setResponses([
      first,
      (context, options, state, model) => {
        assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ['search_demo_jobs']);
        feedback = resultsIn(context).findLast(result => result.toolName === 'search_demo_jobs');
        return followup(context, options, state, model);
      },
    ]);

    const result = await runtime.run('找杭州的大模型岗位，使用演示数据验证工具。');
    unsubscribe();
    assert.equal(executions, 1);
    assert.equal(demo.faux.state.callCount, 2);
    assert.ok(feedback);
    assert.equal(feedback.isError, false);
    const parsed: unknown = JSON.parse(textIn(feedback));
    assert.ok(Value.Check(demoJobsResultSchema, parsed));
    if (!Value.Check(demoJobsResultSchema, parsed)) throw new Error('Invalid job result');
    assert.equal(parsed.jobs.length, 2);
    assert.ok(parsed.jobs.every(job => job.city === '杭州' && job.publishedAt === null));
    assert.equal(result.status, 'completed');
    assert.match(result.finalText, /虚构/);
    assert.match(result.finalText, /2 个岗位/);
    assert.ok(result.sessionFile);
    assert.equal(result.sessionId, runtime.sessionId);
    assert.deepEqual(observed, result.events);
    assert.equal(result.events[0]?.type, 'task_started');
    assert.equal(result.events.at(-1)?.type, 'task_settled');
    assert.ok(result.events.some(event => event.type === 'text_delta'));
    assert.ok(result.events.some(event => event.type === 'sdk_settled'));
    assert.ok(result.events.every(event => event.taskId === result.taskId));
    for (let index = 1; index < result.events.length; index++) {
      assert.ok(result.events[index]!.sequence > result.events[index - 1]!.sequence);
    }
  });
});

test('the allowlist rejects model requests for coding, discovery, and MCP capabilities', { timeout: 15_000 }, async () => {
  await withFixture(async ({ root, demo, open }) => {
    let executions = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { executions++; } })]);
    assert.deepEqual(runtime.getActiveToolNames(), ['search_demo_jobs']);
    assert.deepEqual(runtime.getCallableToolNames(), ['search_demo_jobs']);
    const forbidden = ['bash', 'read', 'codemode', 'tool_search', 'mcp__bait__read'];
    const sentinel = join(root, 'forbidden-command-executed');
    demo.faux.setResponses([
      context => {
        assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ['search_demo_jobs']);
        return fauxAssistantMessage(forbidden.map((name, index) => fauxToolCall(
          name,
          { command: `touch '${sentinel}'`, path: sentinel },
          { id: `forbidden-${index}` },
        )), { stopReason: 'toolUse' });
      },
      context => {
        const results = resultsIn(context);
        assert.equal(results.length, forbidden.length);
        assert.ok(results.every(result => result.isError));
        return fauxAssistantMessage('这些操作被拒绝，没有执行招聘以外的工具。');
      },
    ]);
    const result = await runtime.run('验证工具名单。');
    assert.equal(executions, 0);
    for (let index = 0; index < forbidden.length; index++) assertToolFailure(result.events, `forbidden-${index}`);
    await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
    assert.equal(result.events.at(-1)?.type, 'task_settled');
  });
});

test('a missing required argument returns error feedback without entering the tool body', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let starts = 0;
    let cleanups = 0;
    const runtime = await open([createDemoJobsTool({
      onStart: () => { starts++; }, onCleanup: () => { cleanups++; },
    })]);
    demo.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('search_demo_jobs', { keyword: '大模型' }, { id: 'missing-city' }), { stopReason: 'toolUse' }),
      context => {
        const result = resultsIn(context).find(result => result.toolCallId === 'missing-city');
        assert.ok(result?.isError);
        assert.match(textIn(result), /city|validation|required/i);
        return fauxAssistantMessage('搜索参数缺少城市，没有确认任何岗位结果。');
      },
    ]);
    const result = await runtime.run('验证缺少必填字段。');
    assert.equal(starts, 0);
    assert.equal(cleanups, 0);
    assertToolFailure(result.events, 'missing-city');
    assert.match(result.finalText, /没有确认/);
  });
});

test('length-truncated output never executes even schema-valid tool arguments', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { executions++; } })]);
    demo.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('search_demo_jobs', { city: '杭州', keyword: '大' }, { id: 'truncated-call' }), { stopReason: 'length' }),
      context => {
        const result = resultsIn(context).find(result => result.toolCallId === 'truncated-call');
        assert.ok(result?.isError);
        assert.match(textIn(result), /output token limit|truncat/i);
        return fauxAssistantMessage('参数输出被截断，没有执行搜索。');
      },
    ]);
    const result = await runtime.run('验证输出截断。');
    assert.equal(executions, 0);
    assertToolFailure(result.events, 'truncated-call');
    assert.match(result.finalText, /没有执行/);
  });
});

test('a throwing tool settles as an error and the model receives that failure', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const base = createDemoJobsTool();
    const failingTool: ReturnType<typeof createDemoJobsTool> = {
      ...base,
      async execute() {
        executions++;
        throw new Error('SCRIPTED_SEARCH_UNAVAILABLE');
      },
    };
    const runtime = await open([failingTool]);
    demo.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('search_demo_jobs', { city: '杭州', keyword: '大模型' }, { id: 'failed-search' }), { stopReason: 'toolUse' }),
      context => {
        const result = resultsIn(context).find(result => result.toolCallId === 'failed-search');
        assert.ok(result?.isError);
        assert.match(textIn(result), /SCRIPTED_SEARCH_UNAVAILABLE/);
        return fauxAssistantMessage('搜索失败，当前没有经过确认的岗位。');
      },
    ]);
    const result = await runtime.run('验证工具失败。');
    assert.equal(executions, 1);
    assertToolFailure(result.events, 'failed-search');
    // SDK completion and a successful job search are deliberately different facts.
    assert.equal(result.status, 'completed');
    assert.match(result.finalText, /搜索失败/);
    assert.equal(result.events.at(-1)?.data.status, 'completed');
  });
});

test('normal session reopening preserves completed tool history without replaying the body', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const tool = createDemoJobsTool({ onStart: () => { executions++; } });
    const initial = await open([tool]);
    demo.faux.setResponses(makeJobSearchResponses());
    const first = await initial.run('搜索杭州的大模型演示岗位。');
    assert.equal(first.status, 'completed');
    assert.ok(first.sessionFile);
    const saved = await readFile(first.sessionFile, 'utf8');
    const entries = saved.trim().split('\n').map(line => JSON.parse(line) as { type?: string; message?: { role?: string } });
    assert.equal(entries.filter(entry => entry.type === 'message' && entry.message?.role === 'toolResult').length, 1);
    await initial.close();
    const restored = await open([tool], first.sessionFile);
    assert.equal(restored.sessionId, first.sessionId);
    demo.faux.setResponses([
      context => {
        const history = resultsIn(context).filter(result => result.toolName === 'search_demo_jobs');
        assert.equal(history.length, 1);
        assert.equal(history[0]?.isError, false);
        assert.match(textIn(history[0]!), /fixture-hangzhou-llm-1/);
        return fauxAssistantMessage('已从保存的工具结果继续，本轮没有再次搜索。');
      },
    ]);
    const second = await restored.run('根据已有结果继续，先不要重新搜索。');
    assert.equal(second.status, 'completed');
    assert.equal(executions, 1);
    assert.ok(second.sessionFile);
    assert.equal(await realpath(second.sessionFile), await realpath(first.sessionFile));
    assert.ok(!second.events.some(event => event.type === 'tool_started'));
    assert.match(second.finalText, /没有再次搜索/);
  });
});

test('one process rejects a second owner of a live session file and releases it on close', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const tool = createDemoJobsTool({ onStart: () => { executions++; } });
    const initial = await open([tool]);
    demo.faux.setResponses(makeJobSearchResponses());
    const first = await initial.run('保存一个仍由当前运行时持有的搜索会话。');
    assert.equal(first.status, 'completed');
    assert.ok(first.sessionFile);
    assert.equal(executions, 1);

    await assert.rejects(open([tool], first.sessionFile), /already open/i);
    assert.equal(executions, 1);
    assert.equal(demo.faux.state.callCount, 2);

    await initial.close();
    const reopened = await open([tool], first.sessionFile);
    assert.equal(reopened.sessionId, first.sessionId);
    demo.faux.setResponses([
      context => {
        const history = resultsIn(context).filter(result => result.toolName === 'search_demo_jobs');
        assert.equal(history.length, 1);
        assert.equal(history[0]?.isError, false);
        return fauxAssistantMessage('前一个运行时关闭后，保存的会话可以继续使用。');
      },
    ]);
    const result = await reopened.run('使用保存的结果继续。');
    assert.equal(result.status, 'completed');
    assert.equal(executions, 1);
    assert.ok(!result.events.some(event => event.type === 'tool_started'));
  });
});

test('cancel waits for cooperative cleanup and prevents later calls from starting', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    const started = deferred();
    const cleanupStarted = deferred();
    const releaseCleanup = deferred();
    let executions = 0;
    let cleaned = false;
    const runtime = await open([createDemoJobsTool({
      delayMs: 60_000,
      onStart: () => { executions++; started.resolve(); },
      onCleanup: async () => {
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        cleaned = true;
      },
    })]);
    demo.faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('search_demo_jobs', { city: '杭州', keyword: '大模型' }, { id: 'cancel-first' }),
        fauxToolCall('search_demo_jobs', { city: '北京', keyword: '大模型' }, { id: 'cancel-second' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('THIS_FOLLOWUP_MUST_NOT_RUN'),
    ]);
    const pending = runtime.run('运行一个可以取消的搜索。');
    let cancelled: Promise<void> | undefined;
    let cancelSettled = false;
    try {
      await waitFor(started.promise, 'the first tool body');
      cancelled = runtime.cancel().then(() => { cancelSettled = true; });
      await waitFor(cleanupStarted.promise, 'abort cleanup');
      await nextTurn();
      assert.equal(cancelSettled, false);
      assert.equal(cleaned, false);
      assert.equal(executions, 1);
    } finally {
      releaseCleanup.resolve();
      if (cancelled === undefined) cancelled = runtime.cancel();
      await cancelled;
    }
    const result = await pending;
    assert.equal(cleaned, true);
    assert.equal(result.status, 'cancelled');
    assert.equal(executions, 1);
    assert.equal(demo.faux.state.callCount, 1);
    assert.equal(result.events.at(-1)?.data.status, 'cancelled');
    demo.faux.setResponses([fauxAssistantMessage('取消后的新任务可以正常开始。')]);
    const next = await runtime.run('开始一个新的只读任务。');
    assert.equal(next.status, 'completed');
    assert.ok(next.taskId !== result.taskId);
  });
});

test('project and runtime-home bait resources are neither loaded nor injected into requests', { timeout: 15_000 }, async () => {
  await withFixture(async ({ cwd, stateDir, demo, open }) => {
    const marker = 'UNTRUSTED_DISCOVERY_BAIT_7d7f3';
    for (const directory of [join(cwd, '.pi'), join(stateDir, 'agent')]) {
      await mkdir(join(directory, 'extensions'), { recursive: true });
      await mkdir(join(directory, 'skills', 'bait'), { recursive: true });
      await mkdir(join(directory, 'prompts'), { recursive: true });
      await writeFile(join(directory, 'extensions', 'bait.mjs'), `export default () => { throw new Error('${marker}'); };\n`);
      await writeFile(join(directory, 'skills', 'bait', 'SKILL.md'), `---\nname: bait\ndescription: ${marker}\n---\n${marker}\n`);
      await writeFile(join(directory, 'prompts', 'bait.md'), `${marker}\n`);
      await writeFile(join(directory, 'AGENTS.md'), `${marker}\n`);
      await writeFile(join(directory, 'settings.json'), JSON.stringify({
        extensions: ['./extensions/bait.mjs'], defaultTools: ['bash', 'read'],
      }));
    }
    await writeFile(join(cwd, 'AGENTS.md'), `${marker}\n`);
    const runtime = await open([createDemoJobsTool()]);
    demo.faux.setResponses([
      context => {
        assert.ok(!JSON.stringify(context.messages).includes(marker));
        assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ['search_demo_jobs']);
        return fauxAssistantMessage('仅使用宿主提供的配置。');
      },
    ]);
    const result = await runtime.run('检查资源隔离。');
    assert.equal(result.status, 'completed');
    assert.deepEqual(runtime.getActiveToolNames(), ['search_demo_jobs']);
    assert.deepEqual(runtime.getCallableToolNames(), ['search_demo_jobs']);
  });
});

test('cancelling from task_started prevents the initial model request and tool dispatch', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    let executions = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { executions++; } })]);
    demo.faux.setResponses(makeJobSearchResponses());
    let cancellation: Promise<void> | undefined;
    const unsubscribe = runtime.subscribe(event => {
      if (event.type === 'task_started') cancellation = runtime.cancel();
    });
    const result = await runtime.run('此任务启动时立即取消。');
    unsubscribe();
    assert.ok(cancellation);
    await cancellation;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.finalText, '');
    assert.equal(executions, 0);
    assert.equal(demo.faux.state.callCount, 0);
    assert.equal(result.events[0]?.type, 'task_started');
    assert.equal(result.events.at(-1)?.type, 'task_settled');
    assert.equal(result.events.at(-1)?.data.status, 'cancelled');
    assert.ok(!result.events.some(event => event.type === 'tool_started'));
  });
});

test('a terminal model error is failed even when the SDK prompt promise resolves', { timeout: 15_000 }, async () => {
  await withFixture(async ({ demo, open }) => {
    const runtime = await open([createDemoJobsTool()]);
    demo.faux.setResponses([
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'SCRIPTED_MODEL_FAILURE' }),
    ]);
    const result = await runtime.run('验证模型失败结算。');
    assert.equal(result.status, 'failed');
    assert.equal(result.finalText, '');
    assert.equal(demo.faux.state.callCount, 1);
    assert.ok(result.events.some(event => event.type === 'task_error' && event.data.message === 'SCRIPTED_MODEL_FAILURE'));
    assert.equal(result.events.at(-1)?.type, 'task_settled');
    assert.equal(result.events.at(-1)?.data.status, 'failed');
    assert.ok(!result.events.some(event => event.type === 'tool_started'));
  });
});

test('a promise-only model stop cannot replace actual host job results and cannot trigger another search', async () => {
  await withFixture(async ({ demo, open }) => {
    let toolExecutions = 0, workflows = 0;
    const runtime = await open([createDemoJobsTool({ onStart: () => { toolExecutions++; } })]);
    demo.faux.setResponses([context => {
      assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), []);
      assert.ok(JSON.stringify(context.messages).includes('actual-mainland-result'));
      return fauxAssistantMessage('请稍等，我正在获取相关信息……');
    }]);
    const result = await runtime.run('能帮我查查适合我的岗位吗？', { workflow: async ({ progress }) => {
      workflows++; progress('profile'); progress('search-mainland'); progress('results');
      return { status: 'completed', summary: '实际查询2个国内来源，找到1条候选（部分范围）。', context: '{"result":"actual-mainland-result"}' };
    } });
    assert.equal(workflows, 1); assert.equal(toolExecutions, 0); assert.equal(demo.faux.state.callCount, 1);
    assert.match(result.finalText, /^实际查询2个国内来源/);
    assert.ok(result.events.some(event => event.type === 'workflow_progress' && event.data.phase === 'results'));
    assert.ok(!result.events.some(event => event.type === 'tool_started'));
    assert.deepEqual(runtime.getActiveToolNames(), ['search_demo_jobs']);
    const saved = await readFile(result.sessionFile!, 'utf8');
    assert.match(saved, /offeragent-job-search/); assert.match(saved, /actual-mainland-result/);
    assert.ok(!saved.includes('"role":"toolResult"'));
  });
});

test('failed host search persists evidence without spending a model request or presenting a successful task', async () => {
  await withFixture(async ({ demo, open }) => {
    const runtime = await open([]);
    const result = await runtime.run('找岗位', { workflow: async () => ({ status: 'failed', summary: '来源未完成。', context: '{"status":"failed"}' }) });
    assert.equal(result.status, 'failed'); assert.equal(result.finalText, '来源未完成。'); assert.equal(demo.faux.state.callCount, 0);
  });
});

test('cancelling a host workflow waits for its cleanup and never starts the model', async () => {
  await withFixture(async ({ demo, open }) => {
    const runtime = await open([]), started = deferred(), cleanup = deferred();
    const running = runtime.run('找岗位', { workflow: async ({ signal }) => {
      started.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      await cleanup.promise; return { status: 'cancelled', summary: '查找已停止。', context: '{"status":"cancelled"}' };
    } });
    await started.promise; let finished = false; const cancelling = runtime.cancel().then(() => { finished = true; });
    await nextTurn(); assert.equal(finished, false); cleanup.resolve(); await cancelling;
    assert.equal((await running).status, 'cancelled'); assert.equal(demo.faux.state.callCount, 0);
  });
});
