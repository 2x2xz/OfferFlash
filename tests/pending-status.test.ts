import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Value } from 'typebox/value';
import { buildApplicationAgenda } from '../packages/domain/src/agenda.js';
import { createStore, type DomainStore } from '../packages/domain/src/store.js';
import { applicationStatusSchema } from '../packages/domain/src/validation.js';
import { createDomainTools } from '../packages/agent/src/tools.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Application, ApplicationInput } from '../packages/shared/src/contracts.js';

const now = new Date('2026-10-12T00:00:00Z');
function pending(id: string, deadline: string | null): Application {
  return {
    id, company: '虚构待核对企业', title: `虚构岗位 ${id}`, status: 'needs-review', deadline,
    notes: '来源待本人确认，未断言是否投递。', url: 'https://example.invalid/application', demo: false,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [],
  };
}
function execute(tool: ToolDefinition<any, any>, id: string) {
  return tool.execute(id, {}, undefined, undefined, {} as Parameters<typeof tool.execute>[4]);
}

test('pending application progress is a distinct valid status without widening unknown strings', () => {
  for (const status of ['needs-review', 'saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn']) {
    assert.equal(Value.Check(applicationStatusSchema, status), true);
  }
  for (const status of ['unknown', 'submitted', '', null]) assert.equal(Value.Check(applicationStatusSchema, status), false);
});

test('pending agenda dates remain verification tasks, not submission or employer acknowledgement', () => {
  const applications = [pending('undated', null), pending('today', '2026-10-12'), pending('past', '2020-01-01')];
  const before = structuredClone(applications);
  const result = buildApplicationAgenda({ applications, settings: { showDemo: false } }, {}, now);
  assert.equal(result.total, 3);
  for (const item of result.items) {
    assert.equal(item.status, 'needs-review');
    assert.equal(item.waitingOn, 'user');
    assert.match(item.nextStep, /具体岗位的投递记录/);
    assert.match(item.nextStep, /不表示未投递或企业已收到申请/);
    if (item.date) assert.match(item.nextStep, /仅作为核对待办/);
  }
  assert.equal(result.items.find(item => item.id === 'past')?.urgency, 'overdue');
  assert.deepEqual(applications, before);
});

test('pending progress survives SQLite reopen and only an explicit update creates applied history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-pending-status-'));
  let store: DomainStore | undefined;
  const input: ApplicationInput = {
    id: 'pending-imported-job', company: '虚构待核对企业', title: '虚构算法岗位',
    url: 'https://example.invalid/application', status: 'needs-review', deadline: null, notes: '待本人确认',
  };
  try {
    store = await createStore({ directory });
    const first = (await store.saveApplication(input)).applications[0]!;
    assert.equal(first.status, 'needs-review');
    assert.deepEqual(first.history.map(item => item.status), ['needs-review']);
    await store.close();
    store = await createStore({ directory });
    assert.equal((await store.getState()).applications[0]!.status, 'needs-review');
    const next = (await store.saveApplication({ ...input, status: 'applied', notes: '用户确认这个岗位已提交' })).applications[0]!;
    assert.deepEqual(next.history.map(item => item.status), ['needs-review', 'applied']);
  } finally {
    await store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('existing model tools accept pending progress without adding a new tool or treating it as applied', async () => {
  const records = [pending('pending-one', null)];
  const tools = createDomainTools(async name => {
    if (name === 'list_applications') return { applications: records };
    if (name === 'get_application_agenda') return buildApplicationAgenda({ applications: records, settings: { showDemo: false } }, {}, now);
    throw new Error(`Unexpected tool: ${name}`);
  });
  assert.equal(tools.filter(tool=>tool.name!=='request_user_input').length, 11);
  assert.ok(tools.some(tool=>tool.name==='request_user_input'));
  const list = await execute(tools.find(tool => tool.name === 'list_applications')!, 'pending-list');
  const agenda = await execute(tools.find(tool => tool.name === 'get_application_agenda')!, 'pending-agenda');
  assert.match(JSON.stringify(list), /needs-review/);
  assert.match(JSON.stringify(agenda), /needs-review/);
});
