import { createHash } from 'node:crypto';
import type { CareerEvidence, CareerSourceInput, Profile, ProfileInput } from '../../shared/src/contracts.js';
import { pickCareerInput } from './career-input.js';
import { pickPersonalInput } from './personal-input.js';

export type ApplicationFactsCollection = 'educations' | 'internships' | 'projects';
export type ApplicationFactValue = string | boolean | string[];
export interface ApplicationFactsRecord { recordId?: string; [field: string]: ApplicationFactValue | undefined; }
export interface ApplicationFactsDocument {
  schemaVersion: 1; educations: ApplicationFactsRecord[]; internships: ApplicationFactsRecord[]; projects: ApplicationFactsRecord[];
}
export interface ApplicationFactCandidate {
  id: string; collection: ApplicationFactsCollection; recordIndex: number; recordId?: string; recordLabel: string;
  field: string; label: string; value: ApplicationFactValue; currentValue?: ApplicationFactValue;
  status: 'empty' | 'conflict' | 'unchanged' | 'unmatched' | 'ambiguous';
  match: 'record-id' | 'identity' | 'unmatched' | 'ambiguous'; evidence: CareerEvidence;
}
export interface ApplicationFactsPreview {
  id: string; profileVersion: number; source: CareerSourceInput; candidates: ApplicationFactCandidate[]; warnings: string[];
}
const COLLECTIONS: readonly ApplicationFactsCollection[] = ['educations', 'internships', 'projects'];
const fields = {
  educations: ['school', 'schoolEn', 'college', 'degree', 'major', 'majorEn', 'startDate', 'endDate', 'description'],
  internships: ['organization', 'role', 'startDate', 'endDate', 'current', 'description', 'technologies'],
  projects: ['name', 'role', 'startDate', 'endDate', 'ongoing', 'description', 'technologies', 'url'],
} as const;
const labels: Record<string, string> = { college: '学院 / 院系', school: '学校', schoolEn: '英文学校', degree: '学历', major: '专业', majorEn: '英文专业', startDate: '开始时间', endDate: '结束时间', description: '经历说明', organization: '实习单位', role: '职务 / 角色', current: '目前在职', name: '项目名称', ongoing: '项目进行中', technologies: '技术栈', url: '项目 / GitHub / 作品链接' };
const MAX_BYTES = 500_000, MAX_RECORDS = 100, MAX_NODES = 6000;
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
const identifier = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value);
function fail(): never { throw new TypeError('网申资料 JSON 格式、字段、链接或大小不符合模板要求。'); }

/** This is a syntax-only link check. It neither resolves DNS nor opens any URL. */
export function validateApplicationFactURL(value: string): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/u.test(value)) fail();
  let url: URL; try { url = new URL(value); } catch { fail(); }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  let fragment: string; try { fragment = decodeURIComponent(url.hash); } catch { fail(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.')
    || host.includes(':') || /^\[|\]$/u.test(host) || /^[\d.]+$/u.test(host)
    || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|arpa|localdomain)$/u.test(host)
    || [...url.searchParams.keys()].some(key => /token|password|secret|authorization|api[_-]?key|session|signature|^sig$/iu.test(key))
    || /(?:token|password|secret|authorization|api[_-]?key|session|signature)=/iu.test(fragment)) fail();
  return value;
}

interface Parsed { text: string; bytes: Uint8Array; value: ApplicationFactsDocument; locations: Map<string, string>; }
/** Small bounded JSON reader retains exact raw leaf tokens for provenance and rejects duplicate keys. */
function jsonWithLocations(text: string): { value: unknown; locations: Map<string, string> } {
  let at = text[0] === '\ufeff' ? 1 : 0, nodes = 0; const locations = new Map<string, string>();
  const whitespace = () => { while (at < text.length && /[\t\n\r ]/u.test(text[at]!)) at++; };
  const string = (): string => {
    const start = at++; let escaped = false;
    while (at < text.length) {
      const char = text[at++]!;
      if (!escaped && char === '"') { try { return JSON.parse(text.slice(start, at)) as string; } catch { fail(); } }
      if (!escaped && char === '\\') escaped = true; else escaped = false;
    }
    return fail();
  };
  const read = (path: string, depth: number): unknown => {
    if (depth > 8 || ++nodes > MAX_NODES) fail(); whitespace(); const start = at; let value: unknown;
    if (text[at] === '{') {
      at++; whitespace(); const result: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[at] !== '}') for (;;) {
        whitespace(); if (text[at] !== '"') fail(); const key = string();
        if (keys.has(key)) fail(); keys.add(key); whitespace(); if (text[at++] !== ':') fail();
        result[key] = read(path ? `${path}.${key}` : key, depth + 1); whitespace();
        if (text[at] !== ',') break; at++;
      }
      if (text[at++] !== '}') fail(); value = result;
    } else if (text[at] === '[') {
      at++; whitespace(); const result: unknown[] = [];
      if (text[at] !== ']') for (;;) {
        result.push(read(`${path}[${result.length}]`, depth + 1)); whitespace();
        if (text[at] !== ',') break; at++;
      }
      if (text[at++] !== ']') fail(); value = result;
    } else if (text[at] === '"') value = string();
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(at))?.[0];
      if (!token) fail(); at += token.length; try { value = JSON.parse(token); } catch { fail(); }
    }
    locations.set(path, text.slice(start, at)); return value;
  };
  const value = read('', 0); whitespace(); if (at !== text.length) fail(); return { value, locations };
}
function date(value: string): string {
  if (!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(value) || value.startsWith('0000')) fail();
  if (value.length === 10 && (!Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) fail();
  return value;
}
function consistent(record: ApplicationFactsRecord): void {
  const start = typeof record.startDate === 'string' ? record.startDate : '', end = typeof record.endDate === 'string' ? record.endDate : '';
  if (end && (record.current === true || record.ongoing === true)) throw new TypeError('至今 / 进行中与结束日期冲突，请明确修改状态，不会自动清除日期或状态。');
  const minimum = (value: string) => `${value}${value.length === 4 ? '-01-01' : value.length === 7 ? '-01' : ''}`;
  const maximum = (value: string) => `${value}${value.length === 4 ? '-12-31' : value.length === 7 ? '-31' : ''}`;
  if (start && end && minimum(start) > maximum(end)) throw new TypeError('结束日期不能早于开始日期。');
}
function textValue(value: unknown, field: string): string {
  const maximum = field === 'description' ? 50_000 : field === 'degree' ? 100 : field === 'url' ? 4096 : 500;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w.-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/u.test(value)) fail();
  const normalized = value.trim();
  if (!normalized) return '';
  return field === 'startDate' || field === 'endDate' ? date(normalized) : field === 'url' ? validateApplicationFactURL(normalized) : normalized;
}
function parse(data: Uint8Array | string): Parsed {
  if (!(typeof data === 'string' || data instanceof Uint8Array)) fail();
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (!bytes.length || bytes.byteLength > MAX_BYTES) fail();
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(); }
  const decoded = jsonWithLocations(text);
  if (!object(decoded.value) || decoded.value.schemaVersion !== 1 || Object.keys(decoded.value).some(key => !['schemaVersion', ...COLLECTIONS].includes(key))) fail();
  const result: ApplicationFactsDocument = { schemaVersion: 1, educations: [], internships: [], projects: [] };
  let count = 0;
  for (const collection of COLLECTIONS) {
    const records = decoded.value[collection] ?? [];
    if (!Array.isArray(records) || records.length > MAX_RECORDS || (count += records.length) > MAX_RECORDS) fail();
    const ids = new Set<string>();
    for (const record of records) {
      if (!object(record) || Object.keys(record).some(key => key !== 'recordId' && !(fields[collection] as readonly string[]).includes(key))) fail();
      const item: ApplicationFactsRecord = {};
      if (record.recordId !== undefined) {
        if (typeof record.recordId !== 'string' || record.recordId && !identifier(record.recordId) || ids.has(record.recordId)) fail();
        if (record.recordId) { ids.add(record.recordId); item.recordId = record.recordId; }
      }
      for (const field of fields[collection]) if (record[field] !== undefined) {
        if (field === 'current' || field === 'ongoing') {
          if (typeof record[field] !== 'boolean') fail(); item[field] = record[field];
        } else if (field === 'technologies') {
          if (!Array.isArray(record[field]) || record[field].length > 100) fail();
          const values = record[field].map(value => textValue(value, 'technology'));
          if (values.some(value => !value || value.length > 120) || new Set(values).size !== values.length) fail(); item[field] = values;
        } else item[field] = textValue(record[field], field);
      }
      consistent(item);
      result[collection].push(item);
    }
  }
  return { text, bytes, value: result, locations: decoded.locations };
}
export function parseApplicationFacts(data: Uint8Array | string): ApplicationFactsDocument { return parse(data).value; }

function recordIdentity(collection: ApplicationFactsCollection, record: ApplicationFactsRecord): string {
  const value = record[collection === 'educations' ? 'school' : collection === 'internships' ? 'organization' : 'name'];
  return typeof value === 'string' ? normalize(value) : '';
}
function profileInput(current: Profile): ProfileInput {
  return { fullName: current.fullName, fullNameEn: current.fullNameEn, email: current.email, phone: current.phone,
    school: current.school, schoolEn: current.schoolEn, degree: current.degree, major: current.major, majorEn: current.majorEn,
    graduationMonth: current.graduationMonth, skills: [...current.skills], cities: [...current.cities], targetRoles: [...current.targetRoles], resumeText: current.resumeText,
    ...(current.birthDate !== undefined ? { birthDate: current.birthDate } : {}), ...(current.personal ? { personal: pickPersonalInput(current.personal) } : {}),
    career: pickCareerInput(current.career) };
}
function valueEqual(left: ApplicationFactValue, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function blank(value: unknown) { return value === undefined || typeof value === 'string' && !value.trim() || Array.isArray(value) && value.length === 0; }
function previewIdentity(profile: Profile, sourceHash: string) {
  return digest(JSON.stringify([sourceHash, profile.version, COLLECTIONS.map(collection => profile.career?.[collection].map(record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'evidence' && key !== 'sourceNote'))))]));
}
export function buildApplicationFactsPreview(data: Uint8Array | string, current: Profile,
  options: { fileName?: string } = {}): ApplicationFactsPreview {
  if (!current || !Number.isSafeInteger(current.version) || current.version < 0 || Object.keys(options).some(key => key !== 'fileName')) fail();
  if (options.fileName !== undefined && (typeof options.fileName !== 'string' || !options.fileName.trim() || options.fileName.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(options.fileName))) fail();
  const parsed = parse(data), fileHash = digest(parsed.bytes), sourceId = `application-facts:${fileHash}`;
  const source: CareerSourceInput = { id: sourceId, kind: 'manual', label: '用户提供的网申资料补充', text: parsed.text, fileHash,
    ...(options.fileName ? { fileName: options.fileName } : {}) };
  const candidates: ApplicationFactCandidate[] = [], warnings = new Set<string>();
  for (const collection of COLLECTIONS) for (const [index, incoming] of parsed.value[collection].entries()) {
    if (!Object.entries(incoming).some(([field, value]) => field === 'recordId' ? Boolean(value) : typeof value === 'string' ? Boolean(value) : Array.isArray(value) ? value.length > 0 : value === true)) continue;
    const records = current.career?.[collection] ?? [];
    const identity = recordIdentity(collection, incoming);
    let matches = incoming.recordId ? records.filter(record => record.id === incoming.recordId) : identity ? records.filter(record => recordIdentity(collection, record as unknown as ApplicationFactsRecord) === identity) : [];
    if (!incoming.recordId && collection === 'educations' && matches.length > 1 && typeof incoming.degree === 'string' && incoming.degree) {
      matches = matches.filter(record => normalize((record as { degree: string }).degree) === normalize(incoming.degree as string));
    }
    const record = matches.length === 1 ? matches[0] : undefined;
    const match = record ? incoming.recordId ? 'record-id' : 'identity' : matches.length > 1 ? 'ambiguous' : 'unmatched';
    const name = incoming[collection === 'educations' ? 'school' : collection === 'internships' ? 'organization' : 'name'];
    const recordLabel = record ? collection === 'educations' ? (record as { school: string }).school : collection === 'internships' ? (record as { organization: string }).organization : (record as { name: string }).name : typeof name === 'string' && name || '尚未对应到资料记录';
    for (const field of fields[collection]) {
      const value = incoming[field]; if (value === undefined || typeof value === 'string' && !value || Array.isArray(value) && !value.length) continue;
      const location = `${collection}[${index}].${field}`, quote = parsed.locations.get(location); if (!quote || quote.length > 50_000) fail();
      const currentValue = record ? (record as unknown as Record<string, ApplicationFactValue>)[field] : undefined;
      const status = record ? valueEqual(value, currentValue) ? 'unchanged' : blank(currentValue) ? 'empty' : 'conflict' : matches.length > 1 ? 'ambiguous' : 'unmatched';
      candidates.push({ id: digest(JSON.stringify([fileHash, location])), collection, recordIndex: index, ...(record ? { recordId: record.id } : {}), recordLabel,
        field, label: labels[field]!, value: structuredClone(value), ...(currentValue !== undefined ? { currentValue: structuredClone(currentValue) } : {}), status, match,
        evidence: { field, sourceId, quote, location, originalValue: typeof value === 'string' ? value : JSON.stringify(value) } });
    }
    if (match === 'unmatched') warnings.add('有资料未对应到现有履历，请填写正确 recordId 或先在资料页建立记录；不会按顺序新增。');
    if (match === 'ambiguous') warnings.add('有同名履历无法唯一对应，请补充 recordId；不会按数组位置选择。');
    if (incoming.recordId && record && identity && identity !== recordIdentity(collection, record as unknown as ApplicationFactsRecord)) warnings.add('有明确 recordId 的名称与现有记录不同，请逐项核对冲突，不能自动覆盖。');
  }
  const targets = new Map<string, number>();
  for (const item of candidates) if (item.recordId) { const key = JSON.stringify([item.collection, item.recordId, item.field]); targets.set(key, (targets.get(key) ?? 0) + 1); }
  if ([...targets.values()].some(count => count > 1)) warnings.add('同一履历字段存在多个来源候选，每个字段最多选用一项。');
  if (!candidates.length) warnings.add('模板中没有填写可导入的资料，原资料保持。');
  return { id: previewIdentity(current, fileHash), profileVersion: current.version, source, candidates, warnings: [...warnings] };
}

/** Selected facts become a local save draft only. Existing confirmation cannot be imported or forged. */
export function applyApplicationFactsSelection(preview: ApplicationFactsPreview, current: Profile, selectedCandidateIds: string[]): ProfileInput {
  if (!preview || preview.profileVersion !== current.version || !Array.isArray(selectedCandidateIds) || selectedCandidateIds.length > 1500
    || selectedCandidateIds.some(id => typeof id !== 'string') || new Set(selectedCandidateIds).size !== selectedCandidateIds.length) fail();
  const rebuilt = buildApplicationFactsPreview(preview.source.text, current, preview.source.fileName ? { fileName: preview.source.fileName } : {});
  if (preview.id !== rebuilt.id || preview.source.fileHash !== rebuilt.source.fileHash || preview.source.id !== rebuilt.source.id
    || JSON.stringify(preview.candidates) !== JSON.stringify(rebuilt.candidates)) throw new Error('资料或导入预览已变化，请重新读取文件后核对。');
  const draft = profileInput(current), changed = new Set<string>(), touched = new Set<string>(); let newEvidenceAdded = false;
  for (const id of selectedCandidateIds) {
    const candidate = rebuilt.candidates.find(item => item.id === id);
    if (!candidate || !candidate.recordId || ['unmatched', 'ambiguous'].includes(candidate.status)) throw new Error('请先明确对应记录，再选择可导入的资料。');
    const key = JSON.stringify([candidate.collection, candidate.recordId, candidate.field]);
    if (changed.has(key)) throw new Error('同一履历字段只能选用一个候选。'); changed.add(key);
    const record = draft.career![candidate.collection].find(item => item.id === candidate.recordId); if (!record) fail();
    if (candidate.status === 'unchanged') continue;
    (record as unknown as Record<string, ApplicationFactValue>)[candidate.field] = structuredClone(candidate.value);
    touched.add(JSON.stringify([candidate.collection, candidate.recordId])); newEvidenceAdded = true;
    if (!record.evidence.some(item => item.sourceId === candidate.evidence.sourceId && item.field === candidate.field && item.location === candidate.evidence.location)) record.evidence.push(structuredClone(candidate.evidence));
    if (record.evidence.length > 200) throw new Error('本条经历来源记录已达上限，请先核对来源。');
  }
  for (const pointer of touched) { const [collection, recordId] = JSON.parse(pointer) as [ApplicationFactsCollection, string]; consistent(draft.career![collection].find(record => record.id === recordId) as unknown as ApplicationFactsRecord); }
  if (newEvidenceAdded) {
    const existing = draft.career!.sources.find(item => item.id === rebuilt.source.id);
    if (existing && (existing.text !== rebuilt.source.text || existing.fileHash !== rebuilt.source.fileHash || existing.kind !== 'manual')) throw new Error('已有资料来源不能被覆盖。');
    if (!existing) draft.career!.sources.push(structuredClone(rebuilt.source));
    if (draft.career!.sources.length > 1000) throw new Error('资料来源已达上限，请先核对来源。');
  }
  return draft;
}

/** Empty examples only: no candidate profile, IDs, dates or private facts are exported. */
export function exportApplicationFactsTemplate(): string {
  return `${JSON.stringify({ schemaVersion: 1,
    educations: [{ recordId: '', school: '', college: '', degree: '', major: '', startDate: '', endDate: '', description: '' }],
    internships: [{ recordId: '', organization: '', role: '', startDate: '', endDate: '', current: false, description: '' }],
    projects: [{ recordId: '', name: '', role: '', startDate: '', endDate: '', ongoing: false, description: '', url: '' }],
  }, null, 2)}\n`;
}
