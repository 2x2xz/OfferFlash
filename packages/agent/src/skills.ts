import { readFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export const CAREER_SKILLS = [
  { id: 'application-agenda', description: '整理近期申请截止事项，区分用户待办和等待企业反馈。', version: '1', tools: ['get_application_agenda'], file: 'application-agenda/SKILL.md' },
  { id: 'job-comparison', description: '比较已保存岗位的资格、方向、来源和待确认条件。', version: '1', tools: ['query_jobs', 'compare_jobs', 'get_job_details'], file: 'job-comparison/SKILL.md' },
  { id: 'resume-import-review', description: '指导用户在本地导入简历并核对候选出处与冲突。', version: '1', tools: [], file: 'resume-import-review/SKILL.md' },
] as const;
export type CareerSkillId = typeof CAREER_SKILLS[number]['id'];

export function validateCareerSkillRegistry(registry: readonly { id: string; description: string; version: string; tools: readonly string[]; file: string }[], availableTools: readonly string[]): void {
  const ids = new Set<string>();
  for (const item of registry) {
    if (Object.keys(item).some(key => !['id', 'description', 'version', 'tools', 'file'].includes(key))
      || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id) || !item.description.trim()
      || !item.version.trim() || item.file !== `${item.id}/SKILL.md`
      || item.tools.some(tool => !availableTools.includes(tool)) || new Set(item.tools).size !== item.tools.length) {
      throw new Error('应用 Skill 清单不符合约定。');
    }
    ids.add(item.id);
  }
}

export async function loadCareerSkill(projectRoot: string, skillId: unknown) {
  const spec = CAREER_SKILLS.find(item => item.id === skillId);
  if (!spec) throw new Error('未知应用 Skill。只能读取已注册的求职任务。');
  const root = await realpath(join(projectRoot, 'skills'));
  const path = await realpath(join(root, spec.file));
  const within = relative(root, path);
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('应用 Skill 路径越界。');
  const text = (await readFile(path, 'utf8')).trim();
  const match = text.match(/^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: "([^"\r\n]+)"\r?\n---\r?\n([\s\S]+)$/);
  if (!match || match[1] !== spec.id || match[2] !== spec.description || !match[3]?.trim()) throw new Error('应用 Skill 名称、说明或正文无效。');
  return {
    id: spec.id, description: spec.description, version: spec.version,
    requiredTools: [...spec.tools], content: match[3].trim(),
    contentHash: createHash('sha256').update(text).digest('hex'), kind: 'application-instructions' as const,
  };
}

export async function loadCareerSkills(projectRoot: string) {
  return Promise.all(CAREER_SKILLS.map(spec => loadCareerSkill(projectRoot, spec.id)));
}

export function careerSkillCatalog(): string {
  return '# 可按需读取的求职 Skill\n\n' + CAREER_SKILLS.map(skill => `- ${skill.id}（v${skill.version}）：${skill.description}`).join('\n')
    + '\n\n需要整理申请事项、岗位比较或简历导入核对时，调用 get_task_guide 读取对应 Skill 后使用本轮实际工具。Skill 只提供操作说明，不授予新权限或安装脚本；未知名称不可读取。';
}
