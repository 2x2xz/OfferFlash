import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from '@earendil-works/pi-ai';
import { AGENT_POLICY_VERSION, loadAgentPolicy } from '../packages/agent/src/policy.js';
import { createDomainTools, DOMAIN_TOOL_SPECS } from '../packages/agent/src/tools.js';
import { createDemoModel } from '../packages/runtime/src/demo-model.js';
import { createOfferAgentRuntime, type OfferAgentRuntime } from '../packages/runtime/src/runtime.js';
import { CAREER_SKILLS } from '../packages/agent/src/skills.js';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const policyFiles = ['system.md', 'tasks/job-discovery.md', 'tasks/job-analysis.md', 'tasks/application-tracking.md', 'tasks/form-preview.md'];

async function policyFixture(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'offeragent-policy-test-'));
  try {
    await mkdir(join(root, 'prompts', 'tasks'), { recursive: true });
    for (const file of policyFiles) await writeFile(join(root, 'prompts', file), await readFile(join(sourceRoot, 'prompts', file)));
    for (const skill of CAREER_SKILLS) {
      await mkdir(join(root, 'skills', skill.id), { recursive: true });
      await writeFile(join(root, 'skills', skill.file), await readFile(join(sourceRoot, 'skills', skill.file)));
    }
    await body(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('application policy loads the approved files and changes its digest only for an active rule change', async () => {
  await policyFixture(async root => {
    const before = await loadAgentPolicy(root);
    assert.equal(before.version, AGENT_POLICY_VERSION);
    assert.deepEqual(before.files, policyFiles);
    assert.equal(before.hash, createHash('sha256').update(before.systemPrompt).digest('hex'));
    await writeFile(join(root, 'prompts', 'extra.md'), 'UNREQUESTED_RULE_MUST_NOT_LOAD');
    await writeFile(join(root, 'AGENTS.md'), 'UNREQUESTED_PROJECT_RULE_MUST_NOT_LOAD');
    const unchanged = await loadAgentPolicy(root);
    assert.deepEqual(unchanged, before);
    await writeFile(join(root, 'prompts', 'tasks', 'job-analysis.md'), `${await readFile(join(root, 'prompts', 'tasks', 'job-analysis.md'), 'utf8')}\n专用测试：读取详情后再判断正文末尾条件。\n`);
    const changed = await loadAgentPolicy(root);
    assert.notEqual(changed.hash, before.hash);
    assert.equal(changed.hash, createHash('sha256').update(changed.systemPrompt).digest('hex'));
  });
});

test('missing or empty application rules fail instead of silently falling back to a different policy', async () => {
  await policyFixture(async root => {
    const target = join(root, 'prompts', 'tasks', 'form-preview.md');
    const original = await readFile(target, 'utf8');
    await writeFile(target, '   \n');
    await assert.rejects(loadAgentPolicy(root), /任务规则为空/);
    await writeFile(target, original);
    await rm(target);
    await assert.rejects(loadAgentPolicy(root), { code: 'ENOENT' });
  });
});

// This exercises policy injection through the real SDK. Faux does not evaluate understanding or answer quality.
test('the real SDK receives the application policy and shared tools, excluding discovered bait resources', { timeout: 15_000 }, async () => {
  await policyFixture(async root => {
    const stateDir = join(root, 'isolated-state');
    const marker = 'UNTRUSTED_GLOBAL_DISCOVERY_BAIT_policy_23d7';
    for (const directory of [join(root, '.pi'), join(stateDir, 'agent')]) {
      await mkdir(join(directory, 'skills', 'bait'), { recursive: true });
      await mkdir(join(directory, 'extensions'), { recursive: true });
      await writeFile(join(directory, 'SYSTEM.md'), marker);
      await writeFile(join(directory, 'AGENTS.md'), marker);
      await writeFile(join(directory, 'settings.json'), JSON.stringify({ extensions: ['./extensions/bait.mjs'], defaultTools: ['bash'] }));
      await writeFile(join(directory, 'extensions', 'bait.mjs'), `throw new Error('${marker}');`);
      await writeFile(join(directory, 'skills', 'bait', 'SKILL.md'), `---\nname: bait\ndescription: ${marker}\n---\n${marker}`);
    }
    await writeFile(join(root, 'AGENTS.md'), marker);
    const policy = await loadAgentPolicy(root);
    const demo = await createDemoModel();
    const calls: string[] = [];
    let runtime: OfferAgentRuntime | undefined;
    let actualInstructions = '';
    try {
      runtime = await createOfferAgentRuntime({ cwd: root, stateDir, modelRuntime: demo.modelRuntime, model: demo.model,
        systemPrompt: policy.systemPrompt,
        tools: createDomainTools(async name => { calls.push(name); return { applications: [] }; }),
      });
      demo.faux.setResponses([
        context => {
          const system = context.messages.find(message => message.role === 'system');
          assert.ok(system && system.role === 'system');
          // Pi stores the application prompt as a named system section; the base content can be empty.
          const baseContent = typeof system.content === 'string' ? system.content : system.content.map(block => block.text).join('');
          const policySection = [baseContent, ...Object.values(system.sections ?? {})].find(text => text === policy.systemPrompt);
          assert.ok(policySection, 'the actual SDK request must contain the complete application-owned policy');
          actualInstructions = policySection;
          assert.ok(!JSON.stringify(context.messages).includes(marker));
          assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), DOMAIN_TOOL_SPECS.map(tool => tool.name));
          return fauxAssistantMessage(fauxToolCall('list_applications', {}), { stopReason: 'toolUse' });
        },
        context => {
          const feedback = context.messages.findLast(message => message.role === 'toolResult');
          assert.ok(feedback && feedback.role === 'toolResult');
          assert.equal(feedback.toolName, 'list_applications');
          assert.equal(feedback.isError, false);
          return fauxAssistantMessage('脚本化测试已读取空申请库；仅验证注入与工具链路。');
        },
      ]);
      const result = await runtime.run('只查看当前申请进度。');
      assert.equal(result.status, 'completed', JSON.stringify(result.events.filter(event => event.type === 'task_error')));
      assert.deepEqual(calls, ['list_applications']);
      assert.equal(demo.faux.state.callCount, 2);
      assert.equal(runtime.promptHash, policy.hash);
      assert.equal(createHash('sha256').update(actualInstructions).digest('hex'), policy.hash);
      assert.equal(result.events.find(event => event.type === 'task_started')?.data.promptHash, policy.hash);
      assert.deepEqual(runtime.getCallableToolNames(), DOMAIN_TOOL_SPECS.map(tool => tool.name));
      assert.ok(result.sessionFile);
      const persisted = await readFile(result.sessionFile, 'utf8');
      assert.ok(!persisted.includes(marker));
      assert.ok(result.events.some(event => event.type === 'tool_finished' && event.data.toolName === 'list_applications'));
    } finally { await runtime?.close(); }
  });
});
