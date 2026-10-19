import type { EducationRecord, InternshipRecord, Profile, ProjectRecord } from '../../shared/src/contracts.js';
import type { CareerFillCollection, CareerFillField, CareerFillOptions, CareerFillPreview } from '../../shared/src/career-form.js';
import {
  CAREER_FILL_COLLECTIONS, careerFillRequest, confirmedCareerFillRecords, emptyCareerFillSelection,
  type CareerFillSelection, type CareerGroupChoices,
} from './career-fill.js';

type CareerRecord = EducationRecord | InternshipRecord | ProjectRecord;
export interface OneClickCareerIssue {
  collection: CareerFillCollection;
  groupId?: string;
  reason: 'unknown-group' | 'ambiguous-group' | 'duplicate-binding' | 'duplicate-record';
  candidateRecordIds: string[];
}
interface OneClickCareerBase { selection: CareerFillSelection; choices: CareerGroupChoices; }
export type OneClickCareerPreparation =
  | (OneClickCareerBase & { status: 'ready'; options: CareerFillOptions })
  | (OneClickCareerBase & { status: 'review'; issues: OneClickCareerIssue[] })
  | (OneClickCareerBase & { status: 'no-data' });

const allowedKeys: Record<CareerFillCollection, readonly string[]> = {
  educations: ['school', 'degree', 'major', 'startDate', 'endDate', 'description'],
  internships: ['organization', 'role', 'startDate', 'endDate', 'description'],
  projects: ['name', 'role', 'startDate', 'endDate', 'description', 'url'],
};
const text = (value: string): string => value.trim().normalize('NFC');
// Keep the existing forms/index.ts degree dictionary: no additional degree guesses.
// Importing that module in the renderer would also import its node:crypto dependency.
const degreeGroups = [
  ['本科', '学士', 'bachelor', 'bachelors', "bachelor's", "bachelor's degree", 'bachelordegree'],
  ['硕士', 'master', 'masters', "master's", "master's degree", 'masterdegree'],
  ['博士', 'phd', 'ph.d.', 'doctorate', 'doctoral'],
  ['专科', '大专', 'associate', 'associate degree'],
];
const degreeLabel = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s_*✱∗:：()（）\[\]【】.\-\/]/g, '').trim();
function sameDegree(left: string, right: string): boolean {
  if (text(left) === text(right)) return true;
  const leftLabel = degreeLabel(left); const rightLabel = degreeLabel(right);
  return degreeGroups.some(group => group.some(value => degreeLabel(value) === leftLabel)
    && group.some(value => degreeLabel(value) === rightLabel));
}
function matches(field: CareerFillField, record: CareerRecord, collection: CareerFillCollection): boolean {
  if (!allowedKeys[collection].includes(field.key)) return false;
  const expected = (record as unknown as Record<string, unknown>)[field.key];
  if (field.key === 'endDate' && text(field.value) === '至今') {
    const ongoing = collection === 'internships' && 'current' in record && record.current === true
      || collection === 'projects' && 'ongoing' in record && record.ongoing === true;
    // A real selected value can match the confirmed flag. This does not authorize
    // selecting an unobserved option or turn other blank facts into wildcards.
    return field.type === 'feishu-month' && ongoing && typeof expected === 'string' && !text(expected);
  }
  if (typeof expected !== 'string' || !text(expected)) return false;
  return field.key === 'degree' ? sameDegree(field.value, expected) : text(field.value) === text(expected);
}

/**
 * Derive this click's explicit record order and group bindings from confirmed local data.
 * Nonempty groups must uniquely match every existing value. Any unresolved group blocks
 * the whole automatic request, so another click cannot silently add a duplicate record.
 */
export function prepareOneClickCareer(profile: Profile, observation: CareerFillPreview): OneClickCareerPreparation {
  if (observation.profileVersion !== profile.version) throw new Error('资料已变化，请重新读取网页经历组。');
  if (new Set(observation.groups.map(group => group.id)).size !== observation.groups.length) throw new Error('网页履历组身份重复，请重新读取。');
  const available = confirmedCareerFillRecords(profile);
  const selection = emptyCareerFillSelection(); const choices: CareerGroupChoices = {};
  for (const collection of CAREER_FILL_COLLECTIONS) selection[collection] = available[collection].map(record => record.id);
  const primary = profile.career?.primaryEducationId;
  if (primary && selection.educations.includes(primary)) {
    selection.educations = [primary, ...selection.educations.filter(id => id !== primary)];
  }
  if (!CAREER_FILL_COLLECTIONS.some(collection => selection[collection].length)) return { status: 'no-data', selection, choices };

  const issues: OneClickCareerIssue[] = [];
  for (const collection of CAREER_FILL_COLLECTIONS) {
    const ids = selection[collection]; const allRecords = profile.career?.[collection] ?? [];
    const records = allRecords.filter(record => ids.includes(record.id));
    const duplicatedIds = allRecords.map(record => record.id).filter((id, index, all) => all.indexOf(id) !== index && ids.includes(id));
    if (duplicatedIds.length) {
      issues.push({ collection, reason: 'duplicate-record', candidateRecordIds: [...new Set(duplicatedIds)] });
      continue;
    }
    const groups = observation.groups.filter(group => group.collection === collection);
    const nonempty = groups.filter(group => group.fields.some(field => text(field.value)));
    const candidates = new Map(nonempty.map(group => [group.id, records.filter(record =>
      group.fields.filter(field => text(field.value)).every(field => matches(field, record, collection))).map(record => record.id)]));
    const assigned = new Set<string>();
    for (const group of nonempty) {
      const possible = candidates.get(group.id)!;
      if (possible.length !== 1) {
        issues.push({ collection, groupId: group.id, reason: possible.length ? 'ambiguous-group' : 'unknown-group', candidateRecordIds: possible });
        continue;
      }
      const recordId = possible[0]!;
      if (nonempty.some(other => other.id !== group.id && candidates.get(other.id)?.length === 1 && candidates.get(other.id)![0] === recordId)) {
        issues.push({ collection, groupId: group.id, reason: 'duplicate-binding', candidateRecordIds: [recordId] });
        continue;
      }
      choices[group.id] = { kind: 'bind', recordId }; assigned.add(recordId);
    }
    // Reserve all proven nonempty matches before assigning any blank group.
    if (issues.some(issue => issue.collection === collection)) continue;
    const remaining = ids.filter(id => !assigned.has(id));
    for (const group of groups.filter(group => !group.fields.some(field => text(field.value)))) {
      const recordId = remaining.shift();
      choices[group.id] = recordId ? { kind: 'bind', recordId } : { kind: 'preserve' };
    }
  }
  if (issues.length) return { status: 'review', selection, choices, issues };
  return { status: 'ready', selection, choices, options: careerFillRequest(profile, observation, selection, choices) };
}
