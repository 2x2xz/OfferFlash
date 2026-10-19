import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CAREER_SKILLS, loadCareerSkill, loadCareerSkills, validateCareerSkillRegistry } from '../packages/agent/src/skills.js';
import { loadAgentPolicy } from '../packages/agent/src/policy.js';
import { DOMAIN_TOOL_SPECS, createDomainTools } from '../packages/agent/src/tools.js';
import { compareJobs } from '../packages/agent/src/job-comparison.js';
import type { AppState, Job, Profile } from '../packages/shared/src/contracts.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const names = DOMAIN_TOOL_SPECS.map(tool => tool.name);

test('only the application skill catalog is present initially; an explicit read yields one hashed guide', async () => {
  validateCareerSkillRegistry(CAREER_SKILLS, names);
  const policy = await loadAgentPolicy(project);
  const guides = await loadCareerSkills(project);
  for (const guide of guides) {
    assert.ok(policy.systemPrompt.includes(guide.id));
    assert.ok(!policy.systemPrompt.includes(guide.content));
    assert.equal(guide.contentHash.length, 64);
  }
  const tool = createDomainTools(async (_name, args) => loadCareerSkill(project, (args as any).skillId)).find(tool => tool.name === 'get_task_guide')!;
  const result = await (tool.execute as any)('guide-read', { skillId: 'job-comparison' }, new AbortController().signal);
  assert.equal((result.structuredContent as any).id, 'job-comparison');
  assert.deepEqual((result.structuredContent as any).requiredTools, ['query_jobs', 'compare_jobs', 'get_job_details']);
  await assert.rejects(loadCareerSkill(project, '../system'), /未知/);
  await assert.rejects((tool.execute as any)('bad-guide', { skillId: 'bash' }, new AbortController().signal), /参数/);
});

test('the skill registry rejects duplicate or incomplete entries and tools outside the actual loadout', () => {
  const valid = { ...CAREER_SKILLS[0], tools: [...CAREER_SKILLS[0].tools] };
  for (const registry of [[valid, valid], [{ ...valid, id: '' }], [{ ...valid, description: '' }], [{ ...valid, version: '' }], [{ ...valid, tools: ['submit_application'] }], [{ ...valid, file: '../system.md' }], [{ ...valid, extra: true }]]) {
    assert.throws(() => validateCareerSkillRegistry(registry, names), /清单/);
  }
});

test('skill files cannot escape the application directory or be replaced with an empty/mismatched guide', async () => {
  const root = await mkdtemp(join(tmpdir(), 'offeragent-skill-file-'));
  try {
    await cp(join(project, 'skills'), join(root, 'skills'), { recursive: true });
    const path = join(root, 'skills', CAREER_SKILLS[0].file);
    await writeFile(path, '   ');
    await assert.rejects(loadCareerSkill(root, CAREER_SKILLS[0].id), /无效/);
    await rm(path);
    const outside = join(root, 'outside.md');
    await writeFile(outside, 'OUTSIDE_APPLICATION_SKILL_MUST_NOT_READ');
    await symlink(outside, path);
    await assert.rejects(loadCareerSkill(root, CAREER_SKILLS[0].id), /越界/);
    await rm(path);
    await writeFile(path, '---\nname: wrong\ndescription: "Wrong task"\n---\nDifferent task');
    await assert.rejects(loadCareerSkill(root, CAREER_SKILLS[0].id), /无效/);
    await mkdir(join(root, 'skills', 'unregistered'), { recursive: true });
    await writeFile(join(root, 'skills', 'unregistered', 'SKILL.md'), 'UNREGISTERED');
    await assert.rejects(loadCareerSkill(root, 'unregistered'), /未知/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function world(): Pick<AppState, 'profile' | 'jobs'> {
  const profile: Profile = { fullName: '', fullNameEn: '', email: '', phone: '', school: '虚构学校', schoolEn: '', degree: '本科', major: '计算机', majorEn: '', graduationMonth: '2027-06', skills: ['Python'], cities: ['杭州'], targetRoles: ['大模型'], resumeText: '', version: 2, updatedAt: '2026-10-12T00:00:00Z' };
  const jobs: Job[] = ['first', 'second'].map((id, index) => ({ id, company: '虚构对比公司', title: '大模型研发校招', city: '杭州', type: 'campus', description: '大模型 Python', requirements: '2027届，本科及以上，Python', url: `https://example.invalid/${id}`, sourceId: 'fixture', sourceName: '虚构对比来源', publishedAt: null, observedAt: '2026-10-01T00:00:00Z', firstSeenAt: '2026-10-01T00:00:00Z', deadline: index === 0 ? '2026-10-01' : '2099-12-31', demo: true, match: { score: 100, reasons: ['stale-cache'], concerns: [], eligible: 'likely', profileVersion: 0 } }));
  return { profile, jobs };
}

test('job comparison recomputes current constraints without altering stored facts or inventing probability', () => {
  const state = world(); const before = JSON.stringify(state);
  const result = compareJobs(state, { jobIds: ['second', 'first'] }, new Date('2026-10-12T00:00:00Z'));
  assert.deepEqual(result.jobs.map(job => job.id), ['second', 'first']);
  assert.equal(result.jobs[1]!.match.eligible, 'unsuitable');
  assert.equal(result.profileVersion, 2);
  assert.ok(result.jobs.every(job => job.match.profileVersion === 2 && job.sourceName === '虚构对比来源'));
  assert.equal(result.scoreMeaning, 'rule-ranking-not-hiring-probability');
  assert.equal(JSON.stringify(state), before);
  for (const args of [{ jobIds: ['first'] }, { jobIds: ['first', 'first'] }, { jobIds: ['first', 'missing'] }, { jobIds: ['first', 'second'], submit: true }]) assert.throws(() => compareJobs(state, args));
});

test('shared tools reject a valid-shaped guide or comparison for the wrong target or profile version', async () => {
  const run = (tool: any, args: unknown) => tool.execute('wrong-target', args, new AbortController().signal);
  const guide = createDomainTools(async () => loadCareerSkill(project, 'job-comparison')).find(tool => tool.name === 'get_task_guide')!;
  await assert.rejects(run(guide, { skillId: 'application-agenda' }), /目标不一致/);
  const value = compareJobs(world(), { jobIds: ['first', 'second'] });
  const compare = createDomainTools(async () => value).find(tool => tool.name === 'compare_jobs')!;
  await assert.rejects(run(compare, { jobIds: ['second', 'first'] }), /目标或资料版本/);
  const stale = createDomainTools(async () => ({ ...value, profileVersion: value.profileVersion + 1 })).find(tool => tool.name === 'compare_jobs')!;
  await assert.rejects(run(stale, { jobIds: ['first', 'second'] }), /目标或资料版本/);
});
