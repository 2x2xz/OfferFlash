import { createHash } from 'node:crypto';
import type { CareerEvidence, CareerInput, EducationInput, InternshipInput, Profile, ProfileInput, ProjectInput } from '../../shared/src/contracts.js';
import { normalizeProfile } from '../../domain/src/validation.js';
import { migrateLegacyProfile } from '../../domain/src/career.js';
import { normalizeCareerDate } from './career-import.js';
import { newCareerRecord, pickCareerInput } from './career-input.js';

export interface ApplyDockImportResult {
  profile: ProfileInput;
  changes: Array<{ field: string; recordId?: string; sourceId: string }>;
  conflicts: Array<{ field: string; recordId?: string }>;
  warnings: string[];
  sourceLabel: string;
}
interface Clip { id: string; category: string; label: string; value: string; }
type Kind = 'educations' | 'internships' | 'projects';
type RecordInput = EducationInput | InternshipInput | ProjectInput;
interface Candidate { clip: Clip; field: string; value: string; }
interface Group { kind: Kind; key: string; tag: string; candidates: Candidate[]; }
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CLIPS = 500;
const SOURCE_LABEL = 'ApplyDock 已保存资料导入';
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(): never { throw new TypeError('ApplyDock 资料格式有误、记录重复或超出导入上限。'); }
function text(value: unknown, limit = 50_000): string {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail();
  return value;
}
function items(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_CLIPS) fail();
  return value;
}
function parse(data: Uint8Array): Clip[] {
  if (!data.length || data.byteLength > MAX_BYTES) fail();
  let root: unknown;
  try { root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { fail(); }
  if (!object(root)) fail();
  const clips: Clip[] = [];
  if ('clips' in root || 'version' in root) {
    if (root.version !== 1 || !Array.isArray(root.applications)) fail();
    for (const item of items(root.clips)) {
      if (!object(item)) fail();
      clips.push({ id: text(item.id, 500), category: text(item.category, 200), label: text(item.label, 1000), value: text(item.value) });
    }
  } else {
    if (!object(root.fields) || Object.keys(root.fields).length > 100) fail();
    for (const [key, value] of Object.entries(root.fields)) {
      clips.push({ id: `basic:${key}`, category: '基本信息', label: key, value: text(value) });
    }
    const educationIds = new Set<string>();
    if (root.education !== undefined) for (const [index, item] of items(root.education).entries()) {
      if (!object(item)) fail();
      const id = item.id === undefined ? `row-${index}` : text(item.id, 300);
      if (!id.trim() || educationIds.has(id)) fail();
      educationIds.add(id);
      const tag = item.shortName === undefined ? '' : text(item.shortName, 500);
      for (const [key, value] of Object.entries(item)) {
        if (['id', 'shortName'].includes(key)) continue;
        clips.push({ id: `education:${id}:${key}`, category: '教育经历', label: `${key}${tag ? ` · ${tag}` : ''}`, value: text(value) });
      }
    }
    if (root.snippets !== undefined) for (const [index, item] of items(root.snippets).entries()) {
      if (!object(item)) fail();
      const id = item.id === undefined ? `row-${index}` : text(item.id, 500);
      clips.push({ id: `snippet:${id}`, category: /^intern/i.test(id) ? '实习经历' : /^project/i.test(id) ? '项目经历' : '技能与其他', label: text(item.label, 1000), value: text(item.value) });
    }
  }
  if (clips.length > MAX_CLIPS || clips.some(item => !item.id.trim()) || new Set(clips.map(item => item.id)).size !== clips.length) fail();
  return clips;
}

const basic: Record<string, keyof ProfileInput> = {
  name: 'fullName', fullname: 'fullName', fullnameen: 'fullNameEn', nameen: 'fullNameEn', email: 'email', phone: 'phone',
  skills: 'skills', cities: 'cities', city: 'cities', targetroles: 'targetRoles', resumetext: 'resumeText',
  姓名: 'fullName', 中文姓名: 'fullName', 英文姓名: 'fullNameEn', 邮箱: 'email', 电子邮箱: 'email', 手机号: 'phone', 手机: 'phone',
  技能: 'skills', 专业技能: 'skills', 技能清单: 'skills', 意向城市: 'cities', 目标岗位: 'targetRoles', 简历全文: 'resumeText',
};
const education: Record<string, string> = {
  school: 'school', schoolen: 'schoolEn', degree: 'degree', major: 'major', majoren: 'majorEn',
  start: 'startDate', startdate: 'startDate', end: 'endDate', enddate: 'endDate', graduation: 'endDate', description: 'description', courses: 'description',
  学校: 'school', 院校: 'school', 学校英文名: 'schoolEn', '学历/学位': 'degree', 学历: 'degree', 学位: 'degree',
  专业: 'major', 专业英文名: 'majorEn', 入学时间: 'startDate', 开始时间: 'startDate', 毕业时间: 'endDate', 结束时间: 'endDate', 核心课程: 'description',
};
const experience: Record<string, string> = {
  organization: 'organization', company: 'organization', employer: 'organization', name: 'name', projectname: 'name',
  role: 'role', title: 'role', position: 'role', jobtitle: 'role', link: 'url', url: 'url',
  start: 'startDate', startdate: 'startDate', end: 'endDate', enddate: 'endDate',
  description: 'description', responsibilities: 'description', technologies: 'technologies', techstack: 'technologies',
  公司: 'organization', 单位: 'organization', 实习单位: 'organization', 机构: 'organization', 项目名称: 'name', 项目名: 'name',
  职位: 'role', 岗位: 'role', 职务: 'role', 角色: 'role', 项目角色: 'role', 担任角色: 'role', 实习职务: 'role', 实习岗位: 'role',
  链接: 'url', 项目链接: 'url', 网址: 'url', 开始时间: 'startDate', 结束时间: 'endDate', 入职时间: 'startDate', 离职时间: 'endDate',
  职责: 'description', 工作内容: 'description', 项目描述: 'description', 描述: 'description', 技术栈: 'technologies', 使用技术: 'technologies',
};
const key = (value: string) => value.replace(/[\s_-]/g, '').toLocaleLowerCase();
function lookup<T>(table: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}
function labelParts(label: string): [string, string] {
  const match = /^\s*(.*?)\s*[·•|｜]\s*(.+?)\s*$/.exec(label);
  return match ? [match[1]!, match[2]!] : [label.trim(), ''];
}
function unsafe(clip: Clip): boolean {
  if (/密码|验证码|身份证|护照|出生|生日|微信|password|captcha|passport|birth|wechat|api.?key|secret|credential|access.?token/i.test(`${clip.id} ${clip.label}`)
    || /\b(?:sk-[\w.-]{12,}|ghp_\w{20,}|github_pat_\w{20,}|AKIA[A-Z0-9]{12,}|AIza[\w-]{20,})\b|-----BEGIN [\w ]*PRIVATE KEY-----/.test(clip.value)) return true;
  if (/^https?:\/\//i.test(clip.value.trim())) {
    try {
      const url = new URL(clip.value.trim());
      return !!(url.username || url.password) || [...url.searchParams.keys()].some(name => /^(?:api.?key|token|secret|password|authorization)$/i.test(name));
    } catch { /* Invalid URLs stay unfilled, but their ordinary source text can be retained. */ }
  }
  return false;
}
function blank(value: unknown): boolean { return typeof value === 'string' ? !value.trim() : Array.isArray(value) && value.length === 0; }
function equivalent(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' ? clean(left) === clean(right) : JSON.stringify(left) === JSON.stringify(right);
}
function words(value: string): string[] | undefined {
  const values = [...new Set(value.split(/[\n、,，;；]/).map(item => item.trim()).filter(Boolean))];
  return values.length <= 100 && values.every(item => item.length <= 120) ? values : undefined;
}
function mappedValue(field: string, raw: string): string | string[] | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (['skills', 'cities', 'targetRoles', 'technologies'].includes(field)) return words(value);
  if (field.endsWith('Date')) return normalizeCareerDate(value);
  const limit = field === 'email' ? 254 : field === 'phone' ? 60 : field === 'degree' ? 100
    : ['fullName', 'fullNameEn'].includes(field) ? 200 : field === 'url' ? 4096
      : ['description', 'resumeText'].includes(field) ? 50_000 : 500;
  if (value.length > limit || (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return undefined;
  if (field === 'url') {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(name => /^(?:api.?key|token|secret|password|authorization)$/i.test(name))) return undefined;
    } catch { return undefined; }
  }
  return value;
}

/** Local-only, non-destructive conversion. It never imports applications or confirmation state. */
export function buildApplyDockImport(data: Uint8Array, current: Profile): ApplyDockImportResult {
  const clips = parse(data);
  const { version: _version, updatedAt: _updatedAt, career: _career, ...saved } = structuredClone(current);
  const profile: ProfileInput = { ...saved, career: pickCareerInput(migrateLegacyProfile(current).career) };
  const career = profile.career!;
  const changes: ApplyDockImportResult['changes'] = [];
  const conflicts: ApplyDockImportResult['conflicts'] = [];
  const warnings = new Set<string>();
  const sourceId = `applydock-source-${digest(data)}`;
  const relevant: Clip[] = [];
  const basicCandidates: Candidate[] = [];
  const groups = new Map<string, Group>();
  const addGroup = (kind: Kind, groupKey: string, tag: string, candidate: Candidate) => {
    const group = groups.get(`${kind}:${groupKey}`) ?? { kind, key: groupKey, tag, candidates: [] };
    if (!group.tag && tag) group.tag = tag;
    group.candidates.push(candidate); groups.set(`${kind}:${groupKey}`, group);
  };
  const hasGroupedEducation = clips.some(clip => /^education:/.test(clip.id));
  for (const clip of clips) {
    if (!clip.value.trim()) continue;
    if (unsafe(clip)) { warnings.add('不支持的敏感资料或凭据已排除。'); continue; }
    const [label, tag] = labelParts(clip.label);
    const basicId = /^basic:([^:]+)$/.exec(clip.id)?.[1];
    const baseField = lookup(basic, key(basicId ?? '')) ?? (clip.category === '基本信息' || clip.category === '技能与其他' ? lookup(basic, key(label)) : undefined);
    if (baseField && baseField !== 'career') {
      basicCandidates.push({ clip, field: baseField, value: clip.value }); relevant.push(clip); continue;
    }
    const eduId = /^education:(.+):([^:]+)$/.exec(clip.id);
    const singleEducation = !hasGroupedEducation && basicId && lookup(education, key(basicId));
    const eduField = lookup(education, key(eduId?.[2] ?? (singleEducation ? basicId : label)));
    if (eduField && (eduId || singleEducation || clip.category === '教育经历') && (eduId?.[1] || singleEducation || tag)) {
      addGroup('educations', eduId?.[1] ?? (singleEducation ? 'legacy-single' : `label:${tag}`), tag, { clip, field: eduField, value: clip.value });
      relevant.push(clip); continue;
    }
    const snippetId = clip.id.replace(/^snippet:/, '');
    const expId = /^(internship|intern|project)([-_:]?[A-Za-z0-9_-]*?)[-_:]([a-zA-Z]+)$/.exec(snippetId);
    const expKind: Kind | undefined = expId ? expId[1] === 'project' ? 'projects' : 'internships'
      : clip.category === '项目经历' ? 'projects' : clip.category === '实习经历' ? 'internships' : undefined;
    const expField = lookup(experience, key(expId?.[3] ?? label));
    if (expKind && expField && !(expKind === 'internships' && ['name', 'url'].includes(expField))
      && !(expKind === 'projects' && expField === 'organization') && (expId || tag)) {
      addGroup(expKind, expId ? `${expId[1]}:${expId[2]}` : `label:${tag}`, tag, { clip, field: expField, value: clip.value });
      relevant.push(clip); continue;
    }
    if (['实习经历', '项目经历', '技能与其他'].includes(clip.category) || /^snippet:/.test(clip.id)) {
      relevant.push(clip); warnings.add('部分经历原文仅保留为资料来源；没有可靠字段对应，未自动拆分。');
    } else warnings.add('部分条目没有明确的受支持字段对应，已跳过。');
  }
  const sourceText = relevant.map(clip => `${clip.id}\n${clip.label}\n${clip.value}`).join('\n\n');
  if (sourceText.length > 500_000) fail();
  if (sourceText) {
    const source = { id: sourceId, kind: 'manual' as const, label: SOURCE_LABEL, text: sourceText, fileHash: digest(data) };
    const existing = career.sources.find(item => item.id === sourceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(source)) fail();
    if (!existing) { career.sources.push(source); changes.push({ field: 'career.sources', sourceId }); }
  }
  function conflict(field: string, recordId?: string): void {
    if (!conflicts.some(item => item.field === field && item.recordId === recordId)) conflicts.push({ field, ...(recordId ? { recordId } : {}) });
  }
  function unique(candidates: Candidate[], field: string, recordId?: string): Candidate | undefined {
    const values = candidates.filter(item => item.field === field);
    if (!values.length) return undefined;
    const first = mappedValue(field, values[0]!.value);
    if (first === undefined || values.some(item => mappedValue(field, item.value) === undefined)) {
      warnings.add('部分字段格式或日期精度不适用，已保留原文并留待核对。'); return undefined;
    }
    if (values.some(item => !equivalent(mappedValue(field, item.value), first))) { conflict(field, recordId); return undefined; }
    return values[0];
  }
  for (const field of new Set(basicCandidates.map(item => item.field))) {
    const candidate = unique(basicCandidates, field);
    if (!candidate) continue;
    const value = mappedValue(field, candidate.value)!;
    const target = profile as unknown as Record<string, unknown>;
    if (blank(target[field])) { target[field] = value; changes.push({ field, sourceId }); }
    else if (!equivalent(target[field], value)) conflict(field);
  }
  for (const group of groups.values()) {
    const identity = group.kind === 'educations' ? 'school' : group.kind === 'internships' ? 'organization' : 'name';
    const proposed = new Map<string, Candidate>();
    for (const field of new Set(group.candidates.map(item => item.field))) {
      const item = unique(group.candidates, field);
      if (item) proposed.set(field, item);
    }
    const recordId = `applydock-${group.kind}-${digest(group.key).slice(0, 24)}`;
    const records = career[group.kind] as RecordInput[];
    const identified = proposed.get(identity)?.value.trim();
    let matches = records.filter(record => record.id === recordId);
    if (!matches.length) {
      const needle = identified || group.tag;
      if (needle) matches = records.filter(record => equivalent((record as unknown as Record<string, unknown>)[identity], needle));
      if (matches.length > 1 && group.kind === 'educations') {
        const degree = proposed.get('degree');
        if (degree) matches = matches.filter(record => equivalent((record as EducationInput).degree, degree.value));
      }
    }
    if (matches.length > 1) { conflict(`${group.kind}.identity`); warnings.add('存在多条可能对应的经历，未选择、修改或新增。'); continue; }
    let record = matches[0];
    if (record && identified && !blank((record as unknown as Record<string, unknown>)[identity])
      && !equivalent((record as unknown as Record<string, unknown>)[identity], identified)) {
      conflict(identity, record.id); warnings.add('来源分组的经历名称已变化，未混合两条经历。'); continue;
    }
    if (!record) {
      // A role or a URL alone never creates a guessed company/project. The required
      // current/ongoing boolean cannot represent unknown status, so keep those as sources.
      if (!identified || group.kind !== 'educations') {
        warnings.add('部分经历缺少唯一现有对应或完整结构信息，仅保留来源。'); continue;
      }
      if (records.length >= 100) fail();
      record = newCareerRecord('educations', recordId);
      record.sourceNote = SOURCE_LABEL;
      records.push(record);
    }
    const isPrimary = record.id === career.primaryEducationId;
    const values = record as unknown as Record<string, unknown>;
    for (const [field, candidate] of proposed) {
      if (!Object.hasOwn(values, field)) continue;
      const value = mappedValue(field, candidate.value)!;
      if (blank(values[field])) {
        if (isPrimary) { warnings.add('当前默认教育保持原样；其缺失字段请在资料页核对后补充。'); continue; }
        // Keep existing current/ongoing state coherent instead of changing it implicitly.
        if (field === 'endDate' && (values.current === true || values.ongoing === true)) { conflict(field, record.id); continue; }
        values[field] = value;
        const evidence: CareerEvidence = { field, sourceId, quote: candidate.value, location: `ApplyDock 条目：${candidate.clip.id}`.slice(0, 1000), originalValue: candidate.value };
        record.evidence.push(evidence);
        changes.push({ field, recordId: record.id, sourceId });
      } else if (!equivalent(values[field], value)) conflict(field, record.id);
    }
    // Combining individually valid dates must still satisfy the existing contract.
    if (record.startDate && record.endDate && record.startDate > `${record.endDate}${record.endDate.length === 4 ? '-12-31' : record.endDate.length === 7 ? '-31' : ''}`) {
      throw new TypeError('导入日期与已有经历时间冲突，原资料未修改。');
    }
  }
  return { profile: normalizeProfile(profile), changes, conflicts, warnings: [...warnings], sourceLabel: SOURCE_LABEL };
}
