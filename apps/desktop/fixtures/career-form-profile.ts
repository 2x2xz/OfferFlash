import type { CareerRecordState, Profile } from '../../../packages/shared/src/contracts.js';

const confirmed: CareerRecordState = {
  revision: 1, confirmation: 'confirmed', confirmedRevision: 1, confirmedAt: '2026-10-18T00:00:00Z',
};
const provenance = { evidence: [], sourceNote: '完全虚构的隔离表单测试资料，不属于真实求职者。' };

/** Original fictional records. Never loaded from the user's private career store. */
export function createCareerFormFixtureProfile(): Profile {
  return {
    version: 1, updatedAt: '2026-10-18T00:00:00Z',
    fullName: '虚构表单验证员', fullNameEn: 'OfferAgent Fictional Validator',
    email: 'career-form-validation@example.invalid', phone: '2025550100',
    school: '虚构南城科技大学', schoolEn: 'Fictional Southbridge Institute', degree: '硕士',
    major: '人工智能', majorEn: 'Artificial Intelligence', graduationMonth: '2027-06',
    skills: ['Python', '虚构检索评估'], cities: ['虚构测试城'], targetRoles: ['虚构算法验证岗'],
    resumeText: '',
    career: {
      schemaVersion: 1, sources: [], primaryEducationId: 'fictional-education-master',
      educations: [
        { id: 'fictional-education-master', ...structuredClone(provenance), ...confirmed,
          school: '虚构南城科技大学', schoolEn: 'Fictional Southbridge Institute', degree: '硕士', major: '人工智能', majorEn: 'Artificial Intelligence',
          startDate: '2025-09', endDate: '2027-06', description: '虚构硕士经历：完成合成文档检索与评估课程项目。' },
        { id: 'fictional-education-bachelor', ...structuredClone(provenance), ...confirmed,
          school: '虚构北城工程大学', schoolEn: 'Fictional Northbridge University', degree: '本科', major: '计算机科学与技术', majorEn: 'Computer Science',
          startDate: '2021-09', endDate: '2025-06', description: '虚构本科经历：完成合成数据结构与软件工程课程。' },
      ],
      internships: [
        { id: 'fictional-internship-search', ...structuredClone(provenance), ...confirmed,
          organization: '虚构星河智能实验室', role: '算法实习生', startDate: '2025-07', endDate: '2025-08', current: false,
          description: '虚构实习甲：构建合成语料检索评估脚本，记录离线测试结果。', technologies: ['Python', '合成检索'] },
        { id: 'fictional-internship-platform', ...structuredClone(provenance), ...confirmed,
          organization: '虚构云杉软件研究院', role: '研发实习生', startDate: '2026-06', endDate: '2026-08', current: false,
          description: '虚构实习乙：维护合成任务队列与演示用日志界面。', technologies: ['TypeScript', '合成任务队列'] },
      ],
      projects: [
        { id: 'fictional-project-retrieval', ...structuredClone(provenance), ...confirmed,
          name: '虚构合成文档检索项目', role: '项目开发者', startDate: '2025-10', endDate: '2026-02', ongoing: false,
          description: '虚构项目甲：使用完全合成文档演示检索、排序与结果核对。', technologies: ['Python', '合成语料'],
          url: 'https://example.invalid/offeragent-fictional-retrieval' },
        { id: 'fictional-project-workflow', ...structuredClone(provenance), ...confirmed,
          name: '虚构流程回放工具', role: '工具开发者', startDate: '2026-03', endDate: '2026-05', ongoing: false,
          description: '虚构项目乙：回放演示任务步骤并核对合成字段，未连接任何真实业务。', technologies: ['TypeScript', '合成流程'],
          url: 'https://example.invalid/offeragent-fictional-workflow' },
      ],
      publications: [],
    },
  };
}

/** Values only, never provenance IDs or private state. Useful for query-write guards. */
export function fixtureStrings(profile: Profile): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { if (value.trim()) found.add(value.trim()); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!['id', 'sourceId', 'primaryEducationId', 'sourceNote', 'confirmation', 'confirmedAt', 'updatedAt', 'sources', 'evidence'].includes(key)) visit(child);
      }
    }
  };
  visit(profile);
  return [...found];
}
