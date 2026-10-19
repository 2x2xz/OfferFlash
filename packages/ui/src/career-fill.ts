import type { EducationRecord, InternshipRecord, Profile, ProjectRecord } from '../../shared/src/contracts.js';
import type { CareerFillBinding, CareerFillCollection, CareerFillOptions, CareerFillPreview } from '../../shared/src/career-form.js';

export const CAREER_FILL_COLLECTIONS = ['educations', 'internships', 'projects'] as const;
export const CAREER_FILL_LABELS: Record<CareerFillCollection, string> = {
  educations: '教育经历', internships: '实习经历', projects: '项目经历',
};
export const CAREER_FIELD_LABELS: Record<string, string> = {
  school: '学校', degree: '学历', major: '专业', organization: '公司', role: '职务 / 角色',
  name: '项目名称', startDate: '开始时间', endDate: '结束时间', description: '经历说明', url: '项目链接',
};
export type CareerFillSelection = Record<CareerFillCollection, string[]>;
export type CareerGroupChoice = { kind: 'preserve' } | { kind: 'bind'; recordId: string };
export type CareerGroupChoices = Record<string, CareerGroupChoice | undefined>;
export interface CareerSelectableRecord {
  id: string; revision: number; title: string; detail: string; collection: CareerFillCollection;
}
type CareerRecord = EducationRecord | InternshipRecord | ProjectRecord;

export function emptyCareerFillSelection(): CareerFillSelection {
  return { educations: [], internships: [], projects: [] };
}
export function confirmedCareerFillRecords(profile: Profile): Record<CareerFillCollection, CareerSelectableRecord[]> {
  return Object.fromEntries(CAREER_FILL_COLLECTIONS.map(collection => [collection,
    (profile.career?.[collection] ?? []).filter(record => record.confirmation === 'confirmed'
      && Number.isInteger(record.revision) && record.revision > 0 && record.confirmedRevision === record.revision && Boolean(record.confirmedAt))
      .map((record: CareerRecord) => {
        const title = collection === 'educations' ? [(record as EducationRecord).school, (record as EducationRecord).degree].filter(Boolean).join(' · ')
          : collection === 'internships' ? [(record as InternshipRecord).organization, (record as InternshipRecord).role].filter(Boolean).join(' · ')
          : [(record as ProjectRecord).name, (record as ProjectRecord).role].filter(Boolean).join(' · ');
        return { id: record.id, revision: record.revision, collection,
          title: title || `未命名${CAREER_FILL_LABELS[collection]}`,
          detail: [record.startDate || '开始时间未提供', record.endDate || ('current' in record && record.current || 'ongoing' in record && record.ongoing ? '至今' : '结束时间未提供')].join(' — ') };
      }),
  ])) as Record<CareerFillCollection, CareerSelectableRecord[]>;
}

export function moveCareerFillRecord(ids: readonly string[], recordId: string, direction: -1 | 1): string[] {
  const next = [...ids]; const index = next.indexOf(recordId); const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Every existing group needs an explicit decision; this helper never pairs by order or content. */
export function careerFillRequest(profile: Profile, observation: CareerFillPreview,
  selectedRecordIds: CareerFillSelection, choices: CareerGroupChoices): CareerFillOptions {
  if (observation.profileVersion !== profile.version) throw new Error('资料已变化，请重新读取网页经历组。');
  const available = confirmedCareerFillRecords(profile);
  const selected: CareerFillSelection = emptyCareerFillSelection();
  for (const collection of CAREER_FILL_COLLECTIONS) {
    const ids = selectedRecordIds[collection];
    if (new Set(ids).size !== ids.length || ids.some(id => !available[collection].some(record => record.id === id))) {
      throw new Error('所选经历已变化或尚未确认，请重新选择。');
    }
    selected[collection] = [...ids];
  }
  const bindings: CareerFillBinding[] = []; const preserveGroupIds: string[] = [];
  for (const group of observation.groups) {
    const choice = choices[group.id];
    if (!choice) throw new Error('请为每个已有网页组选择对应经历，或明确保留本组不填。');
    if (choice.kind === 'preserve') { preserveGroupIds.push(group.id); continue; }
    const record = available[group.collection].find(candidate => candidate.id === choice.recordId);
    if (!record || !selected[group.collection].includes(record.id)) throw new Error('网页组只能绑定本次选中的已确认经历。');
    if (bindings.some(binding => binding.collection === group.collection && binding.recordId === record.id)) {
      throw new Error('同一条经历不能绑定到两个网页组。');
    }
    bindings.push({ collection: group.collection, recordId: record.id, revision: record.revision,
      profileVersion: profile.version, groupId: group.id, groupSignature: group.signature });
  }
  return { profileVersion: profile.version, selectedRecordIds: selected, bindings, preserveGroupIds };
}
