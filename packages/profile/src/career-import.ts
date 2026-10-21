import { createHash } from 'node:crypto';
import type { CareerCollection, CareerEvidence, CareerInput, CareerRecordInput, EducationInput, InternshipInput, ProjectInput, PublicationInput } from '../../shared/src/contracts.js';
import type { ResumeBlock } from './docx.js';

export interface CareerCandidateOptions {
  text: string; fileName: string; fileHash: string; blocks?: ResumeBlock[];
}
export interface CareerCandidateResult { career: CareerInput; warnings: string[]; }
interface Line extends ResumeBlock { sectionStart?: boolean; }
type Candidate = EducationInput | InternshipInput | ProjectInput | PublicationInput;

const sections: Array<[CareerCollection, RegExp]> = [
  ['educations', /^(?:教育背景|教育经历|教育信息|学历背景|Education(?:al Background| Background| Experience)?|Academic Background)$/i],
  ['internships', /^(?:实习经历|实习经验|实习背景|Internships?|Internship Experience)$/i],
  ['projects', /^(?:项目经历|项目经验|科研项目|研究项目|Projects?|Project Experience|Research Projects?)$/i],
  ['publications', /^(?:论文|论文成果|论文发表|论文与研究成果|科研成果|发表论文|学术论文|Publications?|Research Publications?|Papers?)$/i],
];
const otherSection = /^(?:专业技能|技能|个人技能|技能清单|个人信息|基本信息|联系方式|自我评价|个人总结|荣誉奖项|奖项|竞赛经历|兴趣爱好|证书|工作经历|Skills?|Technical Skills|Contact|Personal Information|Summary|Awards?|Honors?|Certificates?|Work Experience)$/i;
const narrative = /^(?:[-*•·]\s*)?(?:参与|负责|使用|开发|研究|协助|完成|实现|支持|通过|与|在|主要|团队|项目中|就读于|曾在|Worked\b|Responsible\b|Implemented\b|Developed\b|Collaborated\b|Using\b|Assisted\b|Designed\b)/i;
const dateToken = String.raw`(?:19|20)\d{2}(?:(?:[-/.]\s*\d{1,2}(?:[-/.]\s*\d{1,2})?)|(?:年(?:\s*\d{1,2}月(?:\s*\d{1,2}日)?)?))?`;
const dateRange = new RegExp(String.raw`(?<!\d)(${dateToken})\s*(?:至(?!今)|到|[-–—~～]|\bto\b|(?=至今))\s*(${dateToken}|至今|现在|present|current|ongoing)(?!\d)`, 'i');
const degreeToken = /(?:本科|硕士|博士|大专|学士|Bachelor(?:'s)?|Master(?:'s)?|Ph\.?D\.?|B\.?Sc\.?|M\.?Sc\.?)/i;
const identityLabels: Record<CareerCollection, string[]> = {
  educations: ['学校', '院校', '毕业院校', 'school', 'university'],
  internships: ['公司', '实习单位', '单位', '机构', 'organization', 'company', 'employer'],
  projects: ['项目名称', '项目名', '项目', 'project name', 'project'],
  publications: ['论文标题', '论文名称', '题目', '标题', 'paper title', 'title'],
};
const labels: Record<string, string[]> = {
  school: identityLabels.educations, schoolEn: ['学校英文名', '院校英文名', 'school in english', 'english school name'],
  college: ['学院', '学院名称', '院系', '所属院系', 'faculty', 'department'],
  degree: ['学历', '学位', 'degree'], major: ['专业', 'major'], majorEn: ['专业英文名', 'major in english', 'english major name'],
  organization: identityLabels.internships, role: ['职位', '岗位', '实习职位', '实习职位名称', '职位名称', '职务', '担任角色', '项目角色', '项目中担任的角色', '你的角色', '角色', 'role', 'position', 'job title'],
  name: identityLabels.projects, title: identityLabels.publications,
  startDate: ['开始时间', '开始日期', '入学时间', '入学日期', '入职时间', 'start date', 'start'],
  endDate: ['结束时间', '结束日期', '毕业时间', '毕业年月', '预计毕业时间', '离职时间', 'end date', 'graduation date', 'end'],
  range: ['时间', '起止时间', '日期', 'duration', 'dates', 'period'],
  description: ['描述', '职责', '工作内容', '项目描述', '项目内容', '研究内容', 'description', 'responsibilities'],
  technologies: ['技术栈', '使用技术', 'technologies', 'tech stack'],
  url: ['链接', '网址', '项目链接', '项目地址', '论文链接', 'GitHub', 'GitHub链接', 'GitHub 链接', 'GitHub地址', 'GitHub 地址', 'GitHub URL', '代码仓库', '代码仓库地址', '仓库地址', '作品链接', '作品集', 'url', 'link'],
  authors: ['作者', 'authors?', 'author list'], venue: ['会议', '期刊', '刊物', '发表载体', 'venue', 'journal', 'conference'],
  publicationDate: ['发表日期', '发表时间', '出版日期', 'publication date'],
  status: ['论文状态', '发表状态', '状态', 'status'], doi: ['DOI'],
};
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function labelPattern(name: string): string {
  return name === 'authors?' ? 'authors?' : name.split(/[ \u00a0]+/).map(escape).join('[ \\u00a0]+');
}
function labelled(raw: string, names: string[]): string | undefined {
  // DOCX table rows can use either label:value or label<TAB>value. Values never cross the next cell.
  const alternatives = names.map(labelPattern).join('|');
  const match = new RegExp(`(?:^|[\\t|｜])\\s*(?:${alternatives})\\s*(?:[:：]\\s*|\\t\\s*)([^\\t|｜]*)`, 'i').exec(raw);
  return match?.[1]?.trim();
}
function labelledValues(raw: string, names: string[]): string[] {
  const alternatives = names.map(labelPattern).join('|');
  return [...raw.matchAll(new RegExp(`(?:^|[\\t|｜])\\s*(?:${alternatives})\\s*(?:[:：]\\s*|\\t\\s*)([^\\t|｜]*)`, 'gi'))]
    .map(match => match[1]!.trim());
}
function cleanHeading(raw: string): string {
  return raw.trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*(.*?)\*\*$/, '$1').replace(/[：:]\s*$/, '').trim();
}
function section(raw: string): CareerCollection | undefined {
  const clean = cleanHeading(raw);
  return sections.find(([, pattern]) => pattern.test(clean))?.[0];
}
function endsCareerSection(raw: string): boolean {
  const clean = cleanHeading(raw);
  if (otherSection.test(clean)) return true;
  // An explicit unknown Markdown heading or a short standalone section label cannot inherit
  // the previous collection. Ordinary record titles and labelled field values remain intact.
  if (/^\s*#{1,6}\s+\S/.test(raw)) return true;
  const fieldLabel = Object.values(labels).some(names => names.some(name => new RegExp(`^${labelPattern(name)}$`, 'i').test(clean)));
  if (fieldLabel) return false;
  if (clean.length > 0 && clean.length <= 40 && /[：:]\s*$/.test(raw)) return true;
  return clean.length <= 40 && /^(?:[^：:\t|｜。；]{1,25}(?:经历|经验|背景|信息|成果|技能|活动|服务|评价|荣誉|奖项|能力|证书)|志愿服务|个人简介|个人介绍|研究方向|相关课程|Other Experience|Volunteer(?:ing)?|Activities|Interests|Relevant Courses)$/i.test(clean);
}
function primaryField(kind: CareerCollection): 'school' | 'organization' | 'name' | 'title' {
  return ({ educations: 'school', internships: 'organization', projects: 'name', publications: 'title' } as const)[kind];
}
function looksLikeHeader(kind: CareerCollection, line: Line, afterBlank: boolean): boolean {
  const raw = line.text.trim();
  if (!raw || raw.length > 220 || narrative.test(raw) || /[。；]/.test(raw)) return false;
  if (labelled(raw, identityLabels[kind]) !== undefined) return true;
  // A field such as "角色：算法实习生" belongs to the current record, not to a new title.
  if (Object.values(labels).some(names => labelled(raw, names) !== undefined)) return false;
  if (kind === 'educations') {
    const school = /大学|学院|\bUniversity\b|\bCollege\b|\bInstitute\b/i.test(raw);
    return school && !/来自|合作|提到|介绍|成员|团队/.test(raw) && (dateRange.test(raw) || degreeToken.test(raw) || ((line.sectionStart || afterBlank) && raw.length <= 100));
  }
  if (kind === 'internships') return /实习生|实习岗位|\bIntern(?:ship)?\b/i.test(raw) || (dateRange.test(raw) && /[|｜\t]|公司|研究院|\b(?:Ltd|Inc|Company)\b/i.test(raw));
  if (/^(?:\[\d+\]|\d+[.)、]|项目[一二三四五六七八九十\d]+[：:]|Project\s+\d+\s*[:.])\s*\S/i.test(raw)) return true;
  if (dateRange.test(raw) && /[|｜\t]/.test(raw)) return true;
  return Boolean((line.sectionStart || afterBlank) && raw.length <= 160 && !/[:：]/.test(raw) && !/提到|介绍|团队来自|例如/.test(raw));
}

/** Preserve the precision in the source. Invalid or unsupported wording remains unknown. */
export function normalizeCareerDate(raw: string): string | undefined {
  const match = /^\s*((?:19|20)\d{2})(?:\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})\s*日?)?\s*月?)?\s*年?\s*$/.exec(raw);
  if (!match) return undefined;
  const year = Number(match[1]), month = match[2] === undefined ? undefined : Number(match[2]), day = match[3] === undefined ? undefined : Number(match[3]);
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  if (day !== undefined && (month === undefined || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return undefined;
  return `${match[1]}${month === undefined ? '' : `-${String(month).padStart(2, '0')}`}${day === undefined ? '' : `-${String(day).padStart(2, '0')}`}`;
}

function previewLines(text: string, blocks?: ResumeBlock[]): Line[] {
  if (!blocks) return text.split(/\n/).map((value, i) => ({ text: value, source: `文本第 ${i + 1} 行` }));
  const visible: ResumeBlock[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const position = text.indexOf(block.text, cursor);
    if (position >= 0) { visible.push(block); cursor = position + block.text.length; continue; }
    // Only the last partially visible block can be used; later DOCX parts are outside the preview.
    const remainder = text.slice(cursor).trimStart();
    if (remainder && block.text.startsWith(remainder)) visible.push({ text: remainder, source: block.source });
    break;
  }
  return visible.flatMap(block => block.text.split(/\n/).map(value => ({ text: value, source: block.source })));
}

function newRecord(kind: CareerCollection, id: string, sourceNote: string): Candidate {
  const common: CareerRecordInput = { id, evidence: [], sourceNote };
  if (kind === 'educations') return { ...common, school: '', schoolEn: '', college: '', degree: '', major: '', majorEn: '', startDate: '', endDate: '', description: '' };
  if (kind === 'internships') return { ...common, organization: '', role: '', startDate: '', endDate: '', current: false, description: '', technologies: [] };
  if (kind === 'projects') return { ...common, name: '', role: '', startDate: '', endDate: '', ongoing: false, description: '', technologies: [], url: '' };
  return { ...common, title: '', authors: '', venue: '', publicationDate: '', status: 'in-progress', doi: '', url: '' };
}
function statusFromText(raw: string): PublicationInput['status'] | undefined {
  const found = new Set<PublicationInput['status']>();
  const uncertainPrefix = /(?:未|尚未|还未|不|拟|计划|准备|将|待|预计|希望)[^，,。；;\n]{0,16}$|\b(?:not|never|no|will|would|may|might|could|expected|planned|planning|intend(?:ed)?|awaiting|pending|waiting|hasn't|haven't|isn't|wasn't|won't)(?:\s+(?:yet|been|be|to|being|for|have|become)){0,4}\s*$/i;
  const uncertainSuffix = /^\s*(?:[:：(-]\s*)?(?:not\b|pending\b|未|尚未|待确认|计划|预计)/i;
  const positive = (pattern: RegExp) => {
    for (const clause of raw.split(/[，,。；;\n]/)) for (const match of clause.matchAll(pattern)) {
      const before = clause.slice(0, match.index).split(/但是|不过|然而|但|\b(?:but|however)\b/i).at(-1)!;
      const after = clause.slice(match.index + match[0].length);
      if (!uncertainPrefix.test(before) && !uncertainSuffix.test(after)) return true;
    }
    return false;
  };
  if (positive(/已发表|已出版|正式发表|\bpublished\b/gi)) found.add('published');
  if (positive(/已录用|已接收|\baccepted\b/gi)) found.add('accepted');
  if (positive(/预印本|\bpreprint\b/gi)) found.add('preprint');
  if (positive(/已投稿|已提交|投稿中|\bsubmitted\b|under review/gi)) found.add('submitted');
  if (positive(/撰写中|进行中|准备中|在研|\bin[- ]progress\b|\bin preparation\b/gi)) found.add('in-progress');
  return found.size === 1 ? [...found][0] : undefined;
}

function parseRecord(kind: CareerCollection, lines: Line[], sourceId: string, warnings: string[]): Candidate {
  const rawBlock = lines.map(line => line.text).join('\n');
  const id = `resume-${kind}-${createHash('sha256').update(`${sourceId}\n${lines[0]!.source}\n${rawBlock}`).digest('hex').slice(0, 24)}`;
  const record = newRecord(kind, id, `简历导入候选，需逐项核对；${[...new Set(lines.map(line => line.source))].join('；').slice(0, 800)}`);
  const values = record as unknown as Record<string, unknown>;
  const conflicts = new Set<string>();
  let publicationStatusSeen = false;
  let publicationStatusConflict = false;
  const description: string[] = [];
  function evidence(field: string, originalValue: string, line: Line): void {
    const index = Math.max(0, line.text.indexOf(originalValue));
    const start = Math.max(0, index - 80);
    const quote = line.text.slice(start, Math.min(line.text.length, Math.max(index + Math.min(originalValue.length, 400), start + 500)));
    const value: CareerEvidence = { field, sourceId, quote, location: line.source, originalValue: originalValue.slice(0, 50_000) };
    if (record.evidence.length < 40) record.evidence.push(value);
  }
  function set(field: string, value: unknown, originalValue: string, line: Line): void {
    evidence(field, originalValue, line);
    const limit = field === 'degree' ? 100 : ['url'].includes(field) ? 4096 : field === 'authors' ? 3000 : ['title', 'venue'].includes(field) ? 1000 : 500;
    if (typeof value === 'string' && value.length > limit) { warnings.push(`经历字段 ${field} 过长，保留原文出处并留空待核对。`); return; }
    if (field === 'url') {
      try { const url = new URL(String(value)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported'); }
      catch { warnings.push('经历链接不是有效的无凭据网页地址，留空待核对。'); return; }
    }
    if (conflicts.has(field)) return;
    const old = values[field];
    if (old !== '' && old !== false && old !== undefined && !(Array.isArray(old) && old.length === 0) && JSON.stringify(old) !== JSON.stringify(value)) {
      values[field] = Array.isArray(old) ? [] : typeof old === 'boolean' ? false : '';
      conflicts.add(field); warnings.push(`一条${kind === 'educations' ? '教育' : kind === 'internships' ? '实习' : kind === 'projects' ? '项目' : '论文'}候选内的 ${field} 存在冲突，保留出处并留空待核对。`); return;
    }
    values[field] = value;
  }
  function date(field: string, raw: string, line: Line): void {
    if (/^(?:至今|现在|present|current|ongoing)$/i.test(raw)) {
      if (field === 'endDate' && kind !== 'educations' && kind !== 'publications') set(kind === 'projects' ? 'ongoing' : 'current', true, raw, line);
      else { evidence(field, raw, line); warnings.push('有一项经历日期未明确，未推测结束日期。'); }
      return;
    }
    const normalized = normalizeCareerDate(raw);
    if (normalized === undefined) { evidence(field, raw, line); warnings.push(`经历日期“${raw.slice(0, 60)}”未能明确识别，留空待核对。`); }
    else set(field, normalized, raw, line);
  }
  function publicationStatus(raw: string, line: Line): void {
    const normalized = statusFromText(raw);
    evidence('status', raw, line);
    if (!normalized) { warnings.push(`论文状态“${raw.slice(0, 60)}”不明确，按待完成候选保存，需核对。`); return; }
    const publication = record as PublicationInput;
    if (publicationStatusConflict || (publicationStatusSeen && publication.status !== normalized)) {
      publication.status = 'in-progress'; publicationStatusConflict = true;
      warnings.push('一篇论文有不同状态表述，暂按待完成候选保存，请核对原文。');
    } else publication.status = normalized;
    publicationStatusSeen = true;
  }
  for (const [index, line] of lines.entries()) {
    const raw = line.text.trim();
    let recognized = false;
    for (const [field, names] of Object.entries(labels)) {
      // Several explicit role/link cells can occur on one table row. Preserve
      // all values so contradictory aliases use the existing conflict review.
      const fieldValues = field === 'role' || field === 'url' ? labelledValues(raw, names) : [labelled(raw, names)];
      for (const value of fieldValues) {
        if (value === undefined || value === '' || field === 'range' || field === 'description' || !(field in record)) continue;
        recognized = true;
        if (['startDate', 'endDate', 'publicationDate'].includes(field)) date(field, value, line);
        else if (field === 'status') publicationStatus(value, line);
        else if (field === 'technologies') {
          if (/不会|未掌握|尚未|不熟悉|计划学习|待学习|\b(?:not|never|planned|unfamiliar)\b/i.test(value)) {
            evidence(field, value, line); warnings.push('技术栈含否定或计划学习表述，未自动加入技术候选。');
          } else {
            const technologies = value.split(/[,，、;；/]/).map(value => value.trim()).filter(Boolean);
            if (technologies.some(item => item.length > 120)) warnings.push('有一项技术栈文字过长，未自动作为技术词保存。');
            set(field, technologies.filter(item => item.length <= 120).slice(0, 40), value, line);
          }
        } else set(field, value, value, line);
      }
    }
    const header = looksLikeHeader(kind, line, index === 0);
    const period = labelled(raw, labels.range!);
    const bareRange = raw.match(dateRange);
    const dateOnly = bareRange?.[0] === raw;
    const range = (period !== undefined ? period : header || dateOnly ? raw : '').match(dateRange);
    if (range && kind !== 'publications') { date('startDate', range[1]!, line); date('endDate', range[2]!, line); recognized = true; }
    else if (period !== undefined) { recognized = true; warnings.push('经历起止时间未能明确识别，未补充日期。'); evidence(kind === 'publications' ? 'publicationDate' : 'startDate', period, line); }
    if (header && labelled(raw, identityLabels[kind]) === undefined) {
      let title = raw.replace(/^(?:\[\d+\]|\d+[.)、]|项目[一二三四五六七八九十\d]+[：:]|Project\s+\d+\s*[:.])\s*/i, '').replace(dateRange, '').trim();
      const parts = title.split(/[|｜\t]/).map(value => value.trim()).filter(Boolean);
      if (kind === 'educations') {
        const school = parts.find(value => /大学|学院|\bUniversity\b|\bCollege\b|\bInstitute\b/i.test(value));
        if (school) {
          // Unlabelled continuous text is kept as a title candidate; it is not split into a guessed major.
          const schoolOnly = /^(.*?(?:大学|学院))(?:\s+.*)?$/.exec(school)?.[1] ?? school;
          set('school', schoolOnly, schoolOnly, line);
        }
        const degree = raw.match(degreeToken)?.[0];
        if (degree) set('degree', degree, degree, line);
      } else if (parts[0]) {
        set(primaryField(kind), parts[0], raw, line);
        if (kind === 'internships' && parts[1] && /实习生|\bIntern\b/i.test(parts[1])) set('role', parts[1], parts[1], line);
        if (kind === 'publications') {
          for (const part of parts.slice(1)) if (statusFromText(part)) publicationStatus(part, line);
        }
      }
      recognized = true;
    }
    if (kind === 'publications' && /^(?:论文)?(?:已发表|已出版|已录用|已接收|已投稿|已提交|撰写中|进行中|预印本|published|accepted|submitted|preprint|in[- ]progress|in preparation)[。.!]?$/i.test(raw)) publicationStatus(raw, line);
    const explicitDescription = labelled(raw, labels.description!);
    if (explicitDescription) description.push(explicitDescription);
    else if (!recognized) description.push(line.text);
  }
  if ('description' in record) {
    const original = description.join('\n').trim();
    record.description = original.slice(0, 8_000);
    if (original.length > 8_000) warnings.push('一条经历的描述较长，候选仅保留前 8000 字符；完整预览仍可核对。');
    for (const line of lines.filter(line => description.some(value => value === line.text || line.text.includes(value)))) evidence('description', line.text, line);
  }
  if (!values[primaryField(kind)]) {
    warnings.push('有一段经历缺少明确名称，保留为待核对候选；请补充学校、单位、项目名或论文标题。');
    if (!record.evidence.length) evidence(primaryField(kind), lines[0]!.text, lines[0]!);
  }
  if ('startDate' in record) {
    const minimum = (value: string) => `${value}${value.length === 4 ? '-01-01' : value.length === 7 ? '-01' : ''}`;
    const maximum = (value: string) => `${value}${value.length === 4 ? '-12-31' : value.length === 7 ? '-31' : ''}`;
    if (record.startDate && record.endDate && minimum(record.startDate) > maximum(record.endDate)) {
      record.endDate = ''; warnings.push('一条经历的结束日期早于开始日期，结束日期留空待核对。');
    }
    if ((('current' in record && record.current) || ('ongoing' in record && record.ongoing)) && record.endDate) {
      record.endDate = ''; if ('current' in record) record.current = false; if ('ongoing' in record) record.ongoing = false;
      warnings.push('一条经历同时包含结束日期和进行中表述，结束状态留空待核对。');
    }
  }
  if (kind === 'publications' && !publicationStatusSeen) warnings.push('有一篇论文的状态未明确，暂按待完成候选保存；不表示已经发表。');
  return record;
}

/** A bounded, deterministic import helper for labelled/common layouts, not a general resume parser. */
export function parseCareerCandidates(options: CareerCandidateOptions): CareerCandidateResult {
  const text = options.text.slice(0, 80_000);
  const sourceId = `resume:v1:${options.fileHash}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
  const career: CareerInput = {
    schemaVersion: 1, sources: [{ id: sourceId, kind: 'resume', label: options.fileName, fileName: options.fileName, fileHash: options.fileHash, text }],
    educations: [], internships: [], projects: [], publications: [], primaryEducationId: null,
  };
  const warnings: string[] = [];
  let active: CareerCollection | undefined, pending: Line[] = [], blank = false, firstInSection = false;
  function flush(): void {
    if (active && pending.length) {
      if (career[active].length < 50) {
        const candidate = parseRecord(active, pending, sourceId, warnings);
        if (active === 'educations') career.educations.push(candidate as EducationInput);
        else if (active === 'internships') career.internships.push(candidate as InternshipInput);
        else if (active === 'projects') career.projects.push(candidate as ProjectInput);
        else career.publications.push(candidate as PublicationInput);
      } else warnings.push('某类经历超过 50 条，仅导入前 50 条候选；请核对其余原文。');
    }
    pending = [];
  }
  const lines = previewLines(text, options.blocks);
  for (const line of lines) {
    const kind = section(line.text);
    if (kind) { flush(); active = kind; blank = false; firstInSection = true; continue; }
    if (endsCareerSection(line.text)) { flush(); active = undefined; continue; }
    if (!active) continue;
    if (!line.text.trim()) { blank = true; continue; }
    const current = { ...line, sectionStart: firstInSection };
    const header = looksLikeHeader(active, current, blank);
    const oldIdentity = pending.some(value => looksLikeHeader(active!, value, false));
    if (header && oldIdentity) flush();
    pending.push(current); firstInSection = false; blank = false;
  }
  flush();
  // Older one-school resumes may have only explicit flat labels. Keep those as one pending
  // education candidate; free prose mentioning a school is never used by this fallback.
  if (!career.educations.length && !lines.some(line => section(line.text) === 'educations')) {
    const fields = ['school', 'schoolEn', 'college', 'degree', 'major', 'majorEn', 'startDate', 'endDate'];
    let flat: Line[] = [], inCareerSection = false;
    const saveFlat = () => {
      if (flat.some(line => labelled(line.text, labels.school!) !== undefined) && career.educations.length < 50) career.educations.push(parseRecord('educations', flat, sourceId, warnings) as EducationInput);
      flat = [];
    };
    for (const line of lines) {
      if (section(line.text)) { saveFlat(); inCareerSection = true; continue; }
      if (endsCareerSection(line.text)) { saveFlat(); inCareerSection = false; continue; }
      if (inCareerSection) continue;
      if (!fields.some(field => labelled(line.text, labels[field]!) !== undefined)) continue;
      if (labelled(line.text, labels.school!) !== undefined && flat.some(value => labelled(value.text, labels.school!) !== undefined)) saveFlat();
      flat.push(line);
    }
    saveFlat();
  }
  return { career, warnings: [...new Set(warnings)] };
}
