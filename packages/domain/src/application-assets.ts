import {createQuestionDecisionStore,readQuestionDecisions} from './question-decisions.js';
import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import type { Application, AppSettings, Profile } from '../../shared/src/contracts.js';
import type { AnswerSuggestion, ApplicationAssetsAPI, ApplicationAssetsState, ApplicationCalendarEvent, ApplicationCalendarEventInput, ApplicationResumeSelection,
  ConfirmedAnswer, ConfirmedAnswerInput, ResumeFileMetadata, ResumeVersion } from '../../shared/src/application-assets.js';
import { deleteDocument, readDocument, readDocuments, writeDocument, type DatabaseFile } from './sqlite.js';

const kinds = { answer: 'confirmed_answer', resume: 'resume_version', selection: 'application_resume', event: 'application_event' } as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
function text(value: unknown, name: string, max = 1000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /\u0000/u.test(value)) throw new Error(`${name}无效`);
  return value.trim();
}
function id(value: unknown): string {
  const valueId = text(value, '记录ID', 160);
  if (!/^[\w:.-]+$/u.test(valueId)) throw new Error('记录ID无效'); return valueId;
}
function revision(value: unknown, existing?: { revision: number }): void {
  if (!existing && value === null) return;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || !existing || existing.revision !== value) throw new Error('记录已被更新或删除，请刷新后重试');
}
function profile(db: Database): Profile { const result = readDocument<Profile>(db, 'profile', 'current'); if (!result) throw new Error('个人资料缺失'); return result; }
function application(db: Database, value: unknown): Application {
  const result = readDocument<Application>(db, 'application', id(value)); if (!result) throw new Error('申请已被删除或不存在'); return result;
}
function directions(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error('岗位方向无效');
  const values = input.map(value => text(value, '岗位方向', 80));
  if (values.some(value => !/[\p{L}\p{N}]/u.test(value))) throw new Error('岗位方向不能只有符号');
  return [...new Set(values)];
}
export function normalizeAnswerQuestion(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim().replace(/[?？:：。.!！]+$/gu, '').trim();
}
/** These decisions always need question-specific review, even when an exact stored answer exists. */
export function isHighImpactQuestion(question: string): boolean {
  return /(薪资|薪酬|工资|期望收入|待遇|政治|党派|党员|国籍|民族|宗教|健康|残疾|疾病|病史|犯罪|刑事|处分|征信|婚姻|婚育|性别|性取向|身份证|护照|证件|签证|工作许可|授权|保密|竞业|利益冲突|亲属|关联关系|背景调查|真实性|承诺|同意|协议|薪水|薪金|法律|诉讼|他人|第三人|家属|担保|财务|银行|债务|雇佣资格|salary|compensation|religion|politic|citizenship|nationality|disabilit|health|criminal|convict|marital|gender|sexual|passport|identity|visa|work.?authori|sponsor|conflicts?[\s-]*of[\s-]*interest|relatives?|background.?check|consent|agree|declar|certif|legal|lawsuit|third.?party|guarantee|bank.?account|debt)/iu.test(question);
}
function answerInput(db: Database, input: ConfirmedAnswerInput): ConfirmedAnswerInput {
  const questionPattern = text(input.questionPattern, '问题', 1000), answer = text(input.answer, '答案', 20_000);
  if (typeof input.demo !== 'boolean' || !['ordinary', 'high-impact'].includes(input.risk)) throw new Error('答案类型无效');
  if (!input.scope || !['general', 'application'].includes(input.scope.kind)) throw new Error('答案适用范围无效');
  const scope = input.scope.kind === 'general' ? { kind: 'general' as const } : { kind: 'application' as const, applicationId: application(db, input.scope.applicationId).id };
  if (scope.kind === 'application' && application(db, scope.applicationId).demo !== input.demo) throw new Error('演示资料与真实申请必须分开');
  if (!/[\p{L}\p{N}]/u.test(questionPattern)) throw new Error('问题不能只有符号');
  return { ...(input.id ? { id: id(input.id) } : {}),...(input.contextLabel!==undefined?{contextLabel:text(input.contextLabel,'回答适用说明',500)}:{}), questionPattern, answer, scope, demo: input.demo,
    risk: isHighImpactQuestion(questionPattern) ? 'high-impact' : input.risk };
}
function visibleState(db: Database): ApplicationAssetsState {
  const current = profile(db); const showDemo = readDocument<AppSettings>(db, 'settings', 'current')?.showDemo === true;
  const applications = readDocuments<Application>(db, 'application').filter(item => !item.demo || showDemo);
  const byId = new Map(applications.map(item => [item.id, item]));
  const answers = readDocuments<ConfirmedAnswer>(db, kinds.answer).filter(item => (!item.demo || showDemo)
    && (item.scope.kind === 'general' || byId.get(item.scope.applicationId)?.demo === item.demo));
  const resumeVersions = readDocuments<ResumeVersion>(db, kinds.resume).filter(item => !item.demo || showDemo);
  const resumeById = new Map(resumeVersions.map(item => [item.id, item]));
  const resumeSelections = readDocuments<ApplicationResumeSelection>(db, kinds.selection).filter(item => byId.get(item.applicationId)?.demo === item.demo
    && (!item.resumeVersionId || resumeById.get(item.resumeVersionId)?.demo === item.demo));
  const calendarEvents = readDocuments<ApplicationCalendarEvent>(db, kinds.event).filter(item => byId.get(item.applicationId)?.demo === item.demo)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const resumeRecommendations = Object.fromEntries(applications.map(item => {
    const title = normalizeAnswerQuestion(item.title);
    return [item.id, resumeVersions.filter(resume => resume.demo === item.demo).map(resume => ({ resumeVersionId: resume.id,
      matchedDirections: resume.directions.filter(direction => title.includes(normalizeAnswerQuestion(direction))) }))
      .filter(recommendation => recommendation.matchedDirections.length > 0).sort((a, b) => b.matchedDirections.length - a.matchedDirections.length || a.resumeVersionId.localeCompare(b.resumeVersionId))];
  }));
  return { profileVersion: current.version, questionDecisions:readQuestionDecisions(db), answers, resumeVersions, resumeSelections, calendarEvents, resumeRecommendations };
}
export function removeApplicationAssets(db: Database, applicationId: string): void {
  for (const answer of readDocuments<ConfirmedAnswer>(db, kinds.answer)) if (answer.scope.kind === 'application' && answer.scope.applicationId === applicationId) deleteDocument(db, kinds.answer, answer.id);
  for (const event of readDocuments<ApplicationCalendarEvent>(db, kinds.event)) if (event.applicationId === applicationId) deleteDocument(db, kinds.event, event.id);
  deleteDocument(db, kinds.selection, applicationId);
}
function timeZone(value: unknown): string {
  const zone = text(value, '时区', 80); try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { throw new Error('请选择有效的IANA时区'); } return zone;
}
function instant(value: unknown): string {
  const utc = text(value, '时间', 40); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(utc)) throw new Error('开始与结束时间必须是明确的UTC时间');
  const date = new Date(utc); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== utc.slice(0, 19)) throw new Error('日历时间无效'); return date.toISOString();
}
function escapeICS(value: string): string { return value.replace(/\\/gu, '\\\\').replace(/\r\n|\r|\n/gu, '\\n').replace(/,/gu, '\\,').replace(/;/gu, '\\;'); }
/** RFC5545 folding uses UTF-8 bytes and never splits a codepoint. */
function foldICS(line: string): string {
  let result = '', current = ''; let bytes = 0;
  for (const character of line) { const size = Buffer.byteLength(character); if (bytes + size > 75) { result += `${current}\r\n`; current = ' '; bytes = 1; } current += character; bytes += size; }
  return result + current;
}
export function buildApplicationICS(events: ApplicationCalendarEvent[], applications: Application[], now = new Date()): string {
  const byId = new Map(applications.map(item => [item.id, item])); const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OfferAgent//Local application calendar//ZH', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    const owner = byId.get(event.applicationId); if (!owner || owner.demo !== event.demo) continue;
    lines.push('BEGIN:VEVENT', `UID:${event.id}@offeragent.local`, `DTSTAMP:${stamp}`, `SEQUENCE:${event.revision}`,
      `DTSTART:${event.startsAt.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '')}`, `DTEND:${event.endsAt.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '')}`,
      `SUMMARY:${escapeICS(`${owner.company} · ${event.title}`)}`, `LOCATION:${escapeICS(event.location)}`, `DESCRIPTION:${escapeICS(event.notes)}`,
      `X-OFFERAGENT-TIMEZONE:${escapeICS(event.timeZone)}`, `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(foldICS).join('\r\n') + '\r\n';
}
export interface ApplicationAssetsStore extends Omit<ApplicationAssetsAPI, 'applicationAssets' | 'importResumeVersion' | 'exportApplicationCalendar' | 'exportResumeVersion'> {
  getState(): Promise<ApplicationAssetsState>;
  importResumeVersion(metadata: ResumeFileMetadata): Promise<ApplicationAssetsState>;
  exportCalendar(applicationId?: string): Promise<string>;
}
export function createApplicationAssetsStore(file: DatabaseFile): ApplicationAssetsStore {
  const mutation = (operation: (db: Database, now: string) => void) => file.transact(db => { operation(db, new Date().toISOString()); return visibleState(db); });
  return {
    getState: () => file.read(visibleState),
    async setQuestionDecision(input){await createQuestionDecisionStore(file).save(input);return file.read(visibleState);},
    saveAnswer(input: ConfirmedAnswerInput, expectedRevision: number | null) {
      return mutation((db, now) => {
        const value = answerInput(db, input); const old = value.id ? readDocument<ConfirmedAnswer>(db, kinds.answer, value.id) : undefined;
        if (value.id && !old) throw new Error('答案已被删除，请刷新后重试');
        revision(expectedRevision, old); if (old && old.demo !== value.demo) throw new Error('不能更改答案的演示归属');
        if (!old && readDocuments(db, kinds.answer).length >= 1000) throw new Error('答案库已达上限');
        const next: ConfirmedAnswer = { ...value, risk: old?.risk === 'high-impact' ? 'high-impact' : value.risk, id: old?.id ?? value.id ?? randomUUID(), revision: (old?.revision ?? 0) + 1,
          createdAt: old?.createdAt ?? now, updatedAt: now, confirmedRevision: null, confirmedProfileVersion: null, confirmedAt: null };
        writeDocument(db, kinds.answer, next.id, next, now);
      });
    },
    confirmAnswer(answerId: string, expectedRevision: number, expectedProfileVersion: number) {
      return mutation((db, now) => {
        const old = readDocument<ConfirmedAnswer>(db, kinds.answer, id(answerId)); revision(expectedRevision, old);
        if (!Number.isSafeInteger(expectedProfileVersion) || profile(db).version !== expectedProfileVersion) throw new Error('个人资料已变化，请重新核对答案');
        answerInput(db, old!);
        const nextRevision = old!.revision + 1;
        writeDocument(db, kinds.answer, old!.id, { ...old, revision: nextRevision, confirmedRevision: nextRevision, confirmedProfileVersion: expectedProfileVersion, confirmedAt: now, updatedAt: now }, now);
      });
    },
    deleteAnswer(answerId: string, expectedRevision: number) {
      return mutation((db) => { const old = readDocument<ConfirmedAnswer>(db, kinds.answer, id(answerId)); revision(expectedRevision, old); deleteDocument(db, kinds.answer, old!.id); });
    },
    answerSuggestions(question: string, applicationId: string): Promise<AnswerSuggestion[]> {
      return file.read(db => {
        const owner = application(db, applicationId); const current = profile(db); const normalized = normalizeAnswerQuestion(text(question, '问题', 1000));
        if (!normalized) return [];
        const matches = readDocuments<ConfirmedAnswer>(db, kinds.answer).filter(answer => answer.demo === owner.demo
          && (answer.scope.kind === 'general' || answer.scope.applicationId === owner.id)
          && normalizeAnswerQuestion(answer.questionPattern) === normalized);
        const exact = matches.filter(answer => answer.scope.kind === 'application'); const applicable = exact.length ? exact : matches;
        return applicable.map(answer => {
          const confirmed = answer.confirmedRevision === answer.revision && answer.confirmedProfileVersion === current.version;
          const highImpact = answer.risk === 'high-impact' || isHighImpactQuestion(question);
          return { answer, automaticEligible: confirmed && !highImpact && applicable.length === 1,
            reason: !confirmed ? '答案或个人资料已变化，需要重新确认' : highImpact ? '高影响问题，请针对本题人工核对' : applicable.length > 1 ? '存在多个精确答案，请选择' : '当前资料版本已确认，问题精确匹配' };
        });
      });
    },
    importResumeVersion(metadata: ResumeFileMetadata) {
      return mutation((db, now) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(metadata.fileId)
          || !/^[0-9a-f]{64}$/u.test(metadata.sha256) || typeof metadata.demo !== 'boolean') throw new Error('简历文件元数据无效');
        const fileName = text(metadata.fileName, '文件名', 240);
        if (/[/\\\u0000-\u001f\u007f]/u.test(fileName) || !/\.(pdf|docx)$/iu.test(fileName) || !Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 1 || metadata.sizeBytes > MAX_FILE_BYTES) throw new Error('仅接受不超过20MB的PDF或DOCX常规文件');
        if (readDocuments<ResumeVersion>(db, kinds.resume).some(item => item.fileId === metadata.fileId)) throw new Error('文件标识已存在');
        if (readDocuments(db, kinds.resume).length >= 100) throw new Error('简历版本已达上限');
        const value: ResumeVersion = { id: randomUUID(), revision: 1, label: text(metadata.label, '版本名称', 120), directions: directions(metadata.directions), demo: metadata.demo,
          fileId: metadata.fileId, fileName, sha256: metadata.sha256, sizeBytes: metadata.sizeBytes, profileVersion: profile(db).version, createdAt: now, updatedAt: now };
        writeDocument(db, kinds.resume, value.id, value, now);
      });
    },
    saveResumeVersion(input: { id: string; label: string; directions: string[] }, expectedRevision: number) {
      return mutation((db, now) => { const old = readDocument<ResumeVersion>(db, kinds.resume, id(input.id)); revision(expectedRevision, old);
        writeDocument(db, kinds.resume, old!.id, { ...old, label: text(input.label, '版本名称', 120), directions: directions(input.directions), revision: old!.revision + 1, updatedAt: now }, now); });
    },
    deleteResumeVersion(resumeId: string, expectedRevision: number) {
      return mutation((db, now) => { const old = readDocument<ResumeVersion>(db, kinds.resume, id(resumeId)); revision(expectedRevision, old); deleteDocument(db, kinds.resume, old!.id);
        for (const selection of readDocuments<ApplicationResumeSelection>(db, kinds.selection)) if (selection.resumeVersionId === old!.id) writeDocument(db, kinds.selection, selection.applicationId, { ...selection, resumeVersionId: null, revision: selection.revision + 1, updatedAt: now }, now);
      });
    },
    selectApplicationResume(applicationId: string, resumeVersionId: string | null, expectedRevision: number | null) {
      return mutation((db, now) => { const owner = application(db, applicationId); const old = readDocument<ApplicationResumeSelection>(db, kinds.selection, owner.id); revision(expectedRevision, old);
        if (resumeVersionId !== null) { const resume = readDocument<ResumeVersion>(db, kinds.resume, id(resumeVersionId)); if (!resume || resume.demo !== owner.demo) throw new Error('简历版本不存在或与申请演示归属不同'); }
        writeDocument(db, kinds.selection, owner.id, { applicationId: owner.id, resumeVersionId, revision: (old?.revision ?? 0) + 1, demo: owner.demo, updatedAt: now } satisfies ApplicationResumeSelection, now);
      });
    },
    saveCalendarEvent(input: ApplicationCalendarEventInput, expectedRevision: number | null) {
      return mutation((db, now) => {
        const owner = application(db, input.applicationId); const old = input.id ? readDocument<ApplicationCalendarEvent>(db, kinds.event, id(input.id)) : undefined;
        if (input.id && !old) throw new Error('日历事项已被删除，请刷新后重试');
        revision(expectedRevision, old); if (old && (old.applicationId !== owner.id || old.demo !== owner.demo)) throw new Error('不能把日历事项移动到另一申请');
        if (!['assessment', 'interview', 'other'].includes(input.kind) || !['scheduled', 'cancelled'].includes(input.status)) throw new Error('事项类型或状态无效');
        const startsAt = instant(input.startsAt), endsAt = instant(input.endsAt);
        if (Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(endsAt) - Date.parse(startsAt) > 14 * 86400_000) throw new Error('结束须晚于开始，单项时长不能超过14天');
        if (!old && readDocuments(db, kinds.event).length >= 5000) throw new Error('日历事项已达上限');
        const next: ApplicationCalendarEvent = { id: old?.id ?? randomUUID(), applicationId: owner.id, kind: input.kind, title: text(input.title, '事项名称', 240), startsAt, endsAt,
          timeZone: timeZone(input.timeZone), location: text(input.location, '地点', 2000, true), notes: text(input.notes, '事项备注', 10_000, true), status: input.status,
          demo: owner.demo, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? now, updatedAt: now };
        writeDocument(db, kinds.event, next.id, next, now);
      });
    },
    deleteCalendarEvent(applicationId: string, eventId: string, expectedRevision: number) {
      return mutation(db => { const owner = application(db, applicationId); const old = readDocument<ApplicationCalendarEvent>(db, kinds.event, id(eventId)); revision(expectedRevision, old);
        if (old!.applicationId !== owner.id || old!.demo !== owner.demo) throw new Error('日历事项不属于当前申请'); deleteDocument(db, kinds.event, old!.id); });
    },
    exportCalendar(applicationId?: string): Promise<string> {
      return file.read(db => { const state = visibleState(db);
        const requestedId = applicationId === undefined ? undefined : application(db, applicationId).id;
        const events = state.calendarEvents.filter(event => requestedId === undefined || event.applicationId === requestedId);
        return buildApplicationICS(events, readDocuments<Application>(db, 'application'));
      });
    },
  };
}
