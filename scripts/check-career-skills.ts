import { resolve } from 'node:path';
import { CAREER_SKILLS, loadCareerSkills, validateCareerSkillRegistry } from '../packages/agent/src/skills.js';
import { DOMAIN_TOOL_SPECS } from '../packages/agent/src/tools.js';

validateCareerSkillRegistry(CAREER_SKILLS, DOMAIN_TOOL_SPECS.map(tool => tool.name));
const skills = await loadCareerSkills(resolve('.'));
console.log(JSON.stringify({ passed: true, skills: skills.map(({ id, version, contentHash, requiredTools }) => ({ id, version, contentHash, requiredTools })) }));
