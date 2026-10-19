import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobResultActionWorkflow, type JobResultActionHost, type JobResultCandidate } from '../packages/agent/src/job-result-actions.js';
import type { ApplicationStatus } from '../packages/shared/src/contracts.js';

const candidates = (count = 3): JobResultCandidate[] => Array.from({ length: count }, (_, i) => ({
  id: `job-${i + 1}`, company: `Example ${i + 1}`, title: `AI role ${i + 1}`, url: `https://careers.example.com/jobs/${i + 1}`,
}));
type Call = { name: 'add_to_tracker' | 'open_job'; args: { jobId: string } };
const browserReceipt = (url: string) => ({ url, title: 'Example careers', loading: true, canGoBack: false, canGoForward: false, visible: true });
function hostFor(jobs: JobResultCandidate[], calls: Call[], status: ApplicationStatus = 'saved'): JobResultActionHost {
  return async (name, args) => {
    calls.push({ name, args });
    return name === 'add_to_tracker' ? { jobId: args.jobId, status } : browserReceipt(jobs.find(job => job.id === args.jobId)!.url);
  };
}
async function run(input: string, jobs: readonly JobResultCandidate[] | undefined = candidates(), customHost?: JobResultActionHost, signal = new AbortController().signal) {
  const calls: Call[] = [], phases: string[] = [];
  const workflow = createJobResultActionWorkflow(input, jobs, customHost ?? hostFor([...(jobs ?? [])], calls));
  const output = workflow ? await workflow({ signal, progress: phase => phases.push(phase) }) : undefined;
  return { workflow, output, calls, phases, evidence: output ? JSON.parse(output.context) : undefined };
}

test('explicit ordinal tracking uses only the displayed result IDs and preserves the requested order', async () => {
  for (const [input, expected] of [
    ['把第一个加入待申请', ['job-1']], ['把第1个加入待投递', ['job-1']],
    ['把第一、第三个加入跟踪', ['job-1', 'job-3']], ['跟踪第三个和第一个', ['job-3', 'job-1']],
    ['把第１、３个加入待申请', ['job-1', 'job-3']], ['把第一个和第一个加入待申请', ['job-1']],
  ] as const) {
    const value = await run(input);
    assert.equal(value.output?.status, 'completed', input);
    assert.deepEqual(value.calls, expected.map(jobId => ({ name: 'add_to_tracker', args: { jobId } })), input);
    assert.match(value.output!.summary, /已加入待申请/); assert.equal(value.evidence.didNotRequestSubmission, true);
  }
});
test('recent-result plural selection uses the six displayed candidates, never a whole-library query', async () => {
  for (const input of ['把这些全部加入待申请', '上面几个加入待投递', '把这些岗位都加入跟踪']) {
    const value = await run(input, candidates(6));
    assert.deepEqual(value.calls.map(call => call.args.jobId), candidates(6).map(job => job.id), input);
    assert.ok(value.calls.every(call => call.name === 'add_to_tracker')); assert.equal(value.calls.length, 6);
  }
  const unscoped = await run('把所有岗位全部加入待申请');
  assert.equal(unscoped.calls.length, 0); assert.equal(unscoped.evidence.operation, 'clarify');
});
test('a descriptive ordinal in another clause does not retarget the actual instruction', async () => {
  const value = await run('第一个已经投了，把第二个加入待申请');
  assert.deepEqual(value.calls, [{ name: 'add_to_tracker', args: { jobId: 'job-2' } }]);
});
test('open explicitly opens one saved official candidate and makes no tracker or fill request', async () => {
  const value = await run('打开第一个网申');
  assert.deepEqual(value.calls, [{ name: 'open_job', args: { jobId: 'job-1' } }]);
  assert.deepEqual(value.phases, ['open-result', 'results']);
  assert.match(value.output!.summary, /已打开岗位页面/); assert.match(value.output!.summary, /登录后点击“自动填写”/);
  assert.doesNotMatch(value.output!.summary, /表单已就绪|申请成功|已提交/);
});
test('an explicit apply request tracks then opens the same single candidate without claiming submission', async () => {
  for (const input of ['帮我申请第一个', '开始申请第二个', '申请第二个']) {
    const value = await run(input);
    const jobId = input.includes('第二') ? 'job-2' : 'job-1';
    assert.deepEqual(value.calls, [{ name: 'add_to_tracker', args: { jobId } }, { name: 'open_job', args: { jobId } }], input);
    assert.match(value.output!.summary, /已加入待申请/); assert.match(value.output!.summary, /已打开/);
    assert.equal(value.evidence.confirmed.length, 2); assert.equal(value.evidence.didNotRequestFill, true);
    assert.equal(value.evidence.didNotRequestSubmission, true);
  }
});
test('already-tracked statuses remain truthful and are never described as reset to pending', async () => {
  for (const status of ['needs-review', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'] as const) {
    const calls: Call[] = [], jobs = candidates();
    const value = await run('申请第二个', jobs, hostFor(jobs, calls, status));
    assert.equal(value.output!.status, 'completed');
    assert.match(value.output!.summary, /已在进度中，保留原状态/); assert.doesNotMatch(value.output!.summary, /已加入待申请/);
    assert.equal(value.evidence.confirmed[0].applicationStatus, status); assert.equal(calls.length, 2);
    assert.ok(calls.every(call => Object.keys(call.args).join(',') === 'jobId'));
  }
});
test('no available, empty, oversized, ambiguous or invalid displayed list can authorize a mutation', async () => {
  const bad: Array<readonly JobResultCandidate[] | undefined> = [
    undefined, [], candidates(7), [candidates()[0]!, candidates()[0]!],
    [{ ...candidates()[0]!, id: '' }], [{ ...candidates()[0]!, id: ' job-1' }],
    [{ ...candidates()[0]!, title: '' }], [{ ...candidates()[0]!, url: 'javascript:alert(1)' }],
    [{ ...candidates()[0]!, url: 'https://user:password@example.com/job' }],
  ];
  for (const list of bad) {
    let called = false;
    const workflow = createJobResultActionWorkflow('把第一个加入待申请', list, async () => { called = true; return undefined; })!;
    const value = await workflow({ signal: new AbortController().signal, progress() {} });
    assert.equal(called, false); assert.equal(JSON.parse(value.context).operation, 'clarify');
  }
});
test('zero, out-of-range, multi-open, ranges and alternative selections are clarified rather than guessed', async () => {
  for (const input of [
    '第0个加入待申请', '第０个加入待申请', '第十一个加入待申请', '第 10 个加入待申请', '第100个加入待申请',
    '把第四个加入待申请', '把第一个或第三个加入待申请', '除了第一个，其余全部加入待申请',
    '第1.5个加入待申请', '第1e2个加入待申请', '第1foo加入待申请', '第一个半加入待申请', '第1.5个和第二个加入待申请',
    '把第一到第三个加入待申请', '把第1-3个加入待申请', '把前两个加入待申请',
    '随便选一个加入待申请', '把最后一个加入待申请', '打开第一、第三个网申', '申请这些全部',
    '把第一个和这些全部加入待申请', '把第一个加入待申请，然后打开第二个',
  ]) {
    const value = await run(input);
    assert.equal(value.calls.length, 0, input); assert.equal(value.evidence?.operation, 'clarify', input);
  }
});
test('negations, methods, hypothetical and quoted commands never call a host tool', async () => {
  for (const input of [
    '先别把第一个加入待申请', '不要打开第一个，只介绍一下', '不是让你申请第二个', '第一个不要，第二个加入待申请',
    '暂时不申请第二个', '不申请第二个', '不打开第一个', '暂不把第一个加入待申请', '我不打算申请第一个',
    '怎么把第一个加入待申请？', '如何打开第一个网申？', '如果用户说申请第二个，你会怎么办？',
    '“申请第二个”是什么意思？', '解释 `打开第一个网申` 这句话', '‘把第一个加入待申请’',
    '```\n打开第一个网申\n```', '> 把第一个加入待申请\n解释上面这句', '用户输入：申请第二个',
    '你需要什么工具打开第一个网申？', 'MCP 可以打开第一个网申吗？',
  ]) {
    const value = await run(input);
    assert.equal(value.calls.length, 0, input); assert.ok(!value.output || value.evidence.operation === 'clarify', input);
  }
});
test('a safe no-submit constraint is compatible with opening, but requesting submission is not', async () => {
  const value = await run('不要提交申请，打开第一个网申');
  assert.deepEqual(value.calls, [{ name: 'open_job', args: { jobId: 'job-1' } }]);
  const apply = await run('帮我申请第一个，但不提交申请');
  assert.deepEqual(apply.calls.map(call => call.name), ['add_to_tracker', 'open_job']);
  const open = await run('打开第二个网申，不提交');
  assert.deepEqual(open.calls, [{ name: 'open_job', args: { jobId: 'job-2' } }]);
  for (const input of ['打开第一个并提交申请', '帮我申请第一个然后自动填写', '帮我直接投递第一个并打开网申']) {
    const rejected = await run(input);
    assert.equal(rejected.calls.length, 0, input); assert.equal(rejected.evidence.operation, 'clarify', input);
  }
});
test('unrelated discussion does not create an action workflow and user-provided IDs cannot target records', async () => {
  for (const input of ['', '你好', '这些岗位哪个更适合我？', '帮我查查适合我的岗位', '我的申请进度怎么样']) {
    assert.equal(createJobResultActionWorkflow(input, candidates(), async () => assert.fail('no call')), undefined, input);
  }
  for (const input of ['把 job-1 加入待申请', '打开 job-2 网申', '把这个加入待申请']) {
    const value = await run(input);
    assert.equal(value.calls.length, 0, input); assert.equal(value.evidence.operation, 'clarify', input);
  }
});
test('an explicit new search with a follow-up cannot act on the previous numbered snapshot', () => {
  for (const input of ['重新帮我找岗位，再申请第一个', '找新岗位然后打开第一个', '先查岗位库，然后把第一个加入待申请']) {
    assert.equal(createJobResultActionWorkflow(input, candidates(), async () => assert.fail('must search first')), undefined, input);
  }
});
test('candidate data is captured once, so caller mutation cannot change the selected ID or official URL', async () => {
  const jobs = candidates(), calls: Call[] = [];
  const workflow = createJobResultActionWorkflow('申请第一个', jobs, async (name, args) => {
    calls.push({ name, args });
    return name === 'add_to_tracker' ? { jobId: args.jobId, status: 'saved' } : browserReceipt('https://careers.example.com/jobs/1');
  })!;
  jobs[0]!.id = 'unrelated'; jobs[0]!.url = 'https://unrelated.example/'; jobs.reverse();
  const value = await workflow({ signal: new AbortController().signal, progress() {} });
  assert.equal(value.status, 'completed'); assert.deepEqual(calls.map(call => call.args.jobId), ['job-1', 'job-1']);
});
test('a wrong-ID or unknown tracking receipt is unconfirmed and stops before later candidates or opening', async () => {
  for (const receipt of [{ jobId: 'job-2', status: 'saved' }, { jobId: 'job-1', status: 'invented' }, { jobId: 'job-1' }, null]) {
    const calls: string[] = [];
    const value = await run('申请第一个', candidates(), async name => { calls.push(name); return receipt; });
    assert.equal(value.output!.status, 'failed'); assert.deepEqual(calls, ['add_to_tracker']);
    assert.deepEqual(value.evidence.confirmed, []); assert.deepEqual(value.evidence.unconfirmedIndices, [1]);
    assert.doesNotMatch(value.output!.summary, /已加入待申请|已打开/);
  }
});
test('a failed later tracking receipt preserves the verified prefix without retrying or advancing', async () => {
  const calls: string[] = [];
  const value = await run('这些全部加入待申请', candidates(), async (_name, { jobId }) => {
    calls.push(jobId); return { jobId, status: jobId === 'job-1' ? 'saved' : 'unknown' };
  });
  assert.equal(value.output!.status, 'failed'); assert.deepEqual(calls, ['job-1', 'job-2']);
  assert.deepEqual(value.evidence.confirmed.map((item: { jobId: string }) => item.jobId), ['job-1']);
  assert.deepEqual(value.evidence.unconfirmedIndices, [2]); assert.deepEqual(value.evidence.unstartedSteps, [{ index: 3, action: 'track' }]);
  assert.match(value.output!.summary, /第1个：已加入待申请/); assert.doesNotMatch(value.output!.summary, /第2个：已加入待申请/);
});
test('opening only verifies the returned official URL, distinguishing a same-origin redirect from an exact match', async () => {
  const value = await run('打开第二个网申', candidates(), async () => browserReceipt('https://careers.example.com/login?token=private-example'));
  assert.equal(value.output!.status, 'completed'); assert.match(value.output!.summary, /已触发打开/);
  assert.doesNotMatch(value.output!.summary, /已打开岗位页面|表单已就绪/);
  assert.equal(value.evidence.confirmed[0].opening, 'same-origin-redirect');
  assert.doesNotMatch(value.output!.context, /private-example|token=|\/login/);
});
test('wrong-ID, cross-origin, missing, credential or errored open receipts cannot report success', async () => {
  for (const receipt of [
    { ...browserReceipt('https://careers.example.com/jobs/1'), jobId: 'job-2' },
    browserReceipt('https://unrelated.example/jobs/1'), {}, browserReceipt('javascript:alert(1)'),
    browserReceipt('https://user:password@careers.example.com/jobs/1'),
    { ...browserReceipt('https://careers.example.com/jobs/1'), error: 'private error data' },
  ]) {
    const value = await run('打开第一个网申', candidates(), async () => receipt);
    assert.equal(value.output!.status, 'failed'); assert.deepEqual(value.evidence.confirmed, []);
    assert.doesNotMatch(value.output!.summary, /已打开|已触发打开/);
    assert.doesNotMatch(value.output!.context, /private error data|password|unrelated\.example/);
  }
});
test('apply failure after a successful tracker receipt does not erase the actual saved state', async () => {
  const calls: string[] = [];
  const value = await run('申请第二个', candidates(), async (name, { jobId }) => {
    calls.push(name); return name === 'add_to_tracker' ? { jobId, status: 'interview' } : { url: 'https://unrelated.example/' };
  });
  assert.deepEqual(calls, ['add_to_tracker', 'open_job']); assert.equal(value.output!.status, 'failed');
  assert.equal(value.evidence.confirmed[0].applicationStatus, 'interview');
  assert.deepEqual(value.evidence.unconfirmedSteps, [{ index: 2, action: 'open' }]);
  assert.match(value.output!.summary, /保留原状态（面试）/); assert.doesNotMatch(value.output!.summary, /已打开/);
});
test('a signal cancelled before execution makes no call and leaves all steps unstarted', async () => {
  const controller = new AbortController(); controller.abort();
  const value = await run('这些全部加入待申请', candidates(), undefined, controller.signal);
  assert.equal(value.output!.status, 'cancelled'); assert.equal(value.calls.length, 0);
  assert.equal(value.evidence.unstartedSteps.length, 3); assert.deepEqual(value.phases, ['cancelled']);
});
test('cancellation after an in-flight success keeps that actual receipt and stops later work', async () => {
  for (const input of ['这些全部加入待申请', '申请第一个']) {
    const controller = new AbortController(), calls: string[] = [];
    const value = await run(input, candidates(), async (name, { jobId }) => {
      calls.push(name); controller.abort(); return { jobId, status: 'saved' };
    }, controller.signal);
    assert.equal(value.output!.status, 'cancelled'); assert.deepEqual(calls, ['add_to_tracker']);
    assert.equal(value.evidence.confirmed[0].jobId, 'job-1'); assert.deepEqual(value.evidence.unconfirmedIndices, []);
    assert.match(value.output!.summary, /第1个：已加入待申请/); assert.doesNotMatch(value.output!.summary, /已打开/);
  }
});
test('cancellation with a rejected in-flight operation is explicitly unconfirmed, with no automatic retry', async () => {
  const controller = new AbortController(), calls: string[] = [];
  const value = await run('这些全部加入待申请', candidates(), async (_name, { jobId }) => {
    calls.push(jobId);
    if (jobId === 'job-1') return { jobId, status: 'saved' };
    controller.abort(); throw new Error('private details must not be exported');
  }, controller.signal);
  assert.equal(value.output!.status, 'cancelled'); assert.deepEqual(calls, ['job-1', 'job-2']);
  assert.equal(value.evidence.confirmed.length, 1); assert.deepEqual(value.evidence.unconfirmedIndices, [2]);
  assert.deepEqual(value.evidence.unstartedSteps, [{ index: 3, action: 'track' }]);
  assert.doesNotMatch(value.output!.context, /private details/); assert.match(value.output!.summary, /没有.*自动重试/);
});
test('a workflow closure is one-shot even if invoked twice concurrently', async () => {
  const jobs = candidates(), calls: Call[] = [];
  const workflow = createJobResultActionWorkflow('申请第一个', jobs, hostFor(jobs, calls))!;
  const context = { signal: new AbortController().signal, progress() {} };
  const [first, second] = await Promise.all([workflow(context), workflow(context)]);
  assert.equal(first.status, 'completed'); assert.equal(JSON.parse(second.context).reason, 'already-consumed');
  assert.deepEqual(calls.map(call => call.name), ['add_to_tracker', 'open_job']);
});
