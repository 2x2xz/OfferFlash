import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { careerSkillCatalog, loadCareerSkills, validateCareerSkillRegistry, CAREER_SKILLS } from './skills.js';
import { DOMAIN_TOOL_SPECS } from './tools.js';

export const AGENT_POLICY_VERSION = 'offeragent-career-v3';
const POLICY_FILES = [
  'system.md', 'tasks/job-discovery.md', 'tasks/job-analysis.md',
  'tasks/application-tracking.md', 'tasks/form-preview.md',
] as const;

/** Only application-owned instructions are read. No global or project discovery. */
export async function loadAgentPolicy(projectRoot: string) {
  const parts = await Promise.all(POLICY_FILES.map(async file => {
    const text = (await readFile(join(projectRoot, 'prompts', file), 'utf8')).trim();
    if (!text) throw new Error(`应用任务规则为空：${file}`);
    return text;
  }));
  validateCareerSkillRegistry(CAREER_SKILLS, DOMAIN_TOOL_SPECS.map(tool => tool.name));
  const skills = await loadCareerSkills(projectRoot);
  const systemPrompt = [`# 任务规则版本 ${AGENT_POLICY_VERSION}`, ...parts, careerSkillCatalog()].join('\n\n');
  return {
    version: AGENT_POLICY_VERSION,
    hash: createHash('sha256').update(systemPrompt).digest('hex'),
    systemPrompt,
    files: [...POLICY_FILES],
    skillsHash: createHash('sha256').update(JSON.stringify(skills.map(skill => [skill.id, skill.version, skill.contentHash]))).digest('hex'),
  };
}
