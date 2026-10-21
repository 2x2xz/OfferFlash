import test from 'node:test';
import assert from 'node:assert/strict';
import { assessJobSearchExecution, classifyJobSearchIntent, createJobSearchTask, JOB_SEARCH_DEADLINE_MS,
  JOB_SEARCH_DISCOVERY_BUDGET, type JobSearchExecutionEvidence } from '../packages/agent/src/job-search-intent.js';

const fresh = [
  '能帮我查查适合我的岗位吗？', '帮我找一下适合我的岗位', '根据我的简历推荐岗位',
  '帮我搜一搜国内最新的算法职位', '有什么岗位适合我？', '帮我匹配职位',
  '别只查本地，帮我去官网找新岗位', '不要只查岗位库，帮我找新的岗位',
  '不要回复“请稍等”，现在帮我查适合的岗位', '帮我找“算法工程师”岗位',
  '请用 MCP 帮我找岗位', 'Can you help me find suitable jobs?', 'Find ML roles that match my resume.',
];
const local = [
  '只查本地岗位，不用联网', '帮我看看岗位库里适合我的职位', '查询已经保存的岗位',
  '查询已保存的岗位', '推荐我收藏的职位', '不要联网，帮我找适合的岗位',
  '帮我查适合的岗位；不要访问官网', '只从当前库推荐岗位',
  'Show my saved jobs.', 'Search the local database for jobs.', 'Find jobs offline.',
];
const noSearch = [
  '', '你好', '解释一下你如何找岗位', '你怎么帮我找岗位的？', '怎么找到适合自己的职位？',
  'MCP 可以自动找岗位吗？', '怎么配置 MCP 查找岗位？', 'Can MCP find jobs?',
  '比较这几个岗位哪个适合我', '帮我看看上面的岗位', 'Compare these jobs to my resume.',
  '不要再找岗位了', '不用给我找职位', '先别查询岗位', "Don't search for jobs.",
  '“帮我找岗位”这句话是什么意思？', '请解释 `帮我查适合岗位` 这个意图',
  '> 帮我找适合的岗位\n解释上面这句话', '```text\n帮我找岗位\n```\n这只是一个例子',
  '如果用户说帮我找岗位，应该怎么处理？', '用户输入：帮我找岗位；你会如何识别？',
  '不要联网，解释一下 MCP 的原理', '帮我写一份找岗位的方法介绍',
];

test('natural job requests without an explicit new keyword default to fresh mainland discovery', () => {
  for (const input of fresh) assert.equal(classifyJobSearchIntent(input), 'fresh', input);
});
test('explicit local scope and no-network constraints never silently become fresh discovery', () => {
  for (const input of local) assert.equal(classifyJobSearchIntent(input), 'local', input);
});
test('methods, MCP questions, given-job comparison, denials and quotations do not authorize discovery', () => {
  for (const input of noSearch) assert.equal(classifyJobSearchIntent(input), null, input);
});
test('fresh task is bounded, mainland-scoped, and cannot mutate the shared default budget', () => {
  const task = createJobSearchTask('能帮我查查适合我的岗位吗？')!;
  assert.equal(task.scope, 'mainland-official'); assert.equal(task.deadlineMs, 120_000);
  assert.deepEqual(task.discoveryOptions, { maxSources: 8, maxPages: 2, pageSize: 20, detailLimit: 10, includeExperienced: false });
  assert.notEqual(task.discoveryOptions, JOB_SEARCH_DISCOVERY_BUDGET);
  Object.assign(task.discoveryOptions!, { maxPages: 5 });
  assert.equal(JOB_SEARCH_DISCOVERY_BUDGET.maxPages, 2);
});
test('local task has no discovery budget and an unrelated request creates no host task', () => {
  const task = createJobSearchTask('只查本地岗位')!;
  assert.equal(task.intent, 'local'); assert.equal(task.scope, 'local-snapshot'); assert.equal(task.discoveryOptions, undefined);
  assert.equal(task.deadlineMs, JOB_SEARCH_DEADLINE_MS); assert.equal(createJobSearchTask('讲讲 Agent loop'), null);
});
test('requests beyond the saved library stay online while an explicit no-network constraint remains local', () => {
  assert.equal(classifyJobSearchIntent('能不能帮我找一下不止简历库里的？'), 'fresh');
  assert.equal(classifyJobSearchIntent('帮我搜索更多算法岗位，不要只限于岗位库'), 'fresh');
  assert.equal(classifyJobSearchIntent('帮我找岗位，不局限于本地库'), 'fresh');
  assert.equal(classifyJobSearchIntent('不要联网，帮我搜索更多算法岗位，不要只限于岗位库'), 'local');
});
const evidence = (input: Partial<JobSearchExecutionEvidence> = {}): JobSearchExecutionEvidence => ({
  intent: 'fresh', profileRead: true, searchStatus: 'completed', scope: 'mainland-official', jobCount: 3, attemptedSources: 2, unviewedSources: 0, ...input,
});
test('a text-only promise or a profile-only step cannot be assessed as a completed search', () => {
  assert.equal(assessJobSearchExecution(evidence({ profileRead: false, searchStatus: 'not-started', attemptedSources: 0, jobCount: 0 })), 'not-started');
  assert.equal(assessJobSearchExecution(evidence({ searchStatus: 'not-started', attemptedSources: 0, jobCount: 0 })), 'not-started');
  assert.equal(assessJobSearchExecution(evidence({ profileRead: false })), 'failed');
});
test('local results or zero attempted sources cannot masquerade as completed fresh domestic discovery', () => {
  assert.equal(assessJobSearchExecution(evidence({ scope: 'local-snapshot' })), 'failed');
  assert.equal(assessJobSearchExecution(evidence({ attemptedSources: 0, jobCount: 0 })), 'failed');
  assert.equal(assessJobSearchExecution(evidence({ attemptedSources: undefined })), 'failed');
  assert.equal(assessJobSearchExecution(evidence({ scope: 'overseas' } as never)), 'failed');
});
test('partial coverage, provider failure and cancellation remain distinct even when some jobs were returned', () => {
  assert.equal(assessJobSearchExecution(evidence({ searchStatus: 'partial' })), 'partial');
  assert.equal(assessJobSearchExecution(evidence({ unviewedSources: 3 })), 'partial');
  assert.equal(assessJobSearchExecution(evidence({ searchStatus: 'failed' })), 'failed');
  assert.equal(assessJobSearchExecution(evidence({ searchStatus: 'cancelled', profileRead: false })), 'cancelled');
});
test('a completed zero-result search is legitimate when its actual scope was executed', () => {
  assert.equal(assessJobSearchExecution(evidence({ jobCount: 0 })), 'completed');
  assert.equal(assessJobSearchExecution(evidence({ intent: 'local', scope: 'local-snapshot', attemptedSources: 0, jobCount: 0 })), 'completed');
});
test('malformed execution metadata fails closed and bounded invalid inputs do not create a task', () => {
  assert.equal(classifyJobSearchIntent('查岗位'.repeat(7000)), null);
  assert.equal(classifyJobSearchIntent(undefined as never), null);
  for (const input of [evidence({ jobCount: NaN }), evidence({ jobCount: -1 }), evidence({ attemptedSources: 9 }), evidence({ unviewedSources: 61 })]) assert.equal(assessJobSearchExecution(input), 'failed');
});

test('overseas scope needs explicit positive words, never a negation or a quoted example', () => {
  for (const input of ['帮我找国外的算法岗位', '帮我查海外职位', 'Find overseas jobs']) assert.equal(createJobSearchTask(input)?.region, 'overseas', input);
  for (const input of ['帮我找岗位，不要国外', '不找海外，帮我找适合岗位', '帮我找国内岗位，不考虑国外', '帮我找岗位，“国外”只是例子']) assert.equal(createJobSearchTask(input)?.region, 'mainland', input);
});
