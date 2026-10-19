/** Local user-authored answers and files. These are ordinary business data, never telemetry payloads. */
export type AnswerScope = { kind: 'general' } | { kind: 'application'; applicationId: string };
export interface ConfirmedAnswerInput {
  id?: string; questionPattern: string; answer: string; scope: AnswerScope; demo: boolean;
  risk: 'ordinary' | 'high-impact';
}
export interface ConfirmedAnswer extends ConfirmedAnswerInput {
  id: string; revision: number; createdAt: string; updatedAt: string;
  confirmedRevision: number | null; confirmedProfileVersion: number | null; confirmedAt: string | null;
}
export interface ResumeVersion {
  id: string; revision: number; label: string; directions: string[]; demo: boolean;
  /** Host-owned file identifier; never an arbitrary filesystem path from the renderer. */
  fileId: string; fileName: string; sha256: string; sizeBytes: number;
  profileVersion: number; createdAt: string; updatedAt: string;
}
export interface ResumeVersionImport { label: string; directions: string[]; demo: boolean; }
/** Host-only metadata supplied after controlled dialog, regular-file copy and hashing. */
export interface ResumeFileMetadata extends ResumeVersionImport {
  fileId: string; fileName: string; sha256: string; sizeBytes: number;
}
export interface ApplicationResumeSelection {
  applicationId: string; resumeVersionId: string | null; revision: number; updatedAt: string; demo: boolean;
}
export interface ResumeRecommendation { resumeVersionId: string; matchedDirections: string[]; }
export type CalendarEventKind = 'assessment' | 'interview' | 'other';
export interface ApplicationCalendarEventInput {
  id?: string; applicationId: string; kind: CalendarEventKind; title: string;
  startsAt: string; endsAt: string; timeZone: string; location: string; notes: string;
  status: 'scheduled' | 'cancelled';
}
export interface ApplicationCalendarEvent extends ApplicationCalendarEventInput {
  id: string; revision: number; demo: boolean; createdAt: string; updatedAt: string;
}
export interface ApplicationAssetsState {
  profileVersion: number; answers: ConfirmedAnswer[]; resumeVersions: ResumeVersion[];
  resumeSelections: ApplicationResumeSelection[]; calendarEvents: ApplicationCalendarEvent[];
  resumeRecommendations: Record<string, ResumeRecommendation[]>;
}
export interface AnswerSuggestion { answer: ConfirmedAnswer; automaticEligible: boolean; reason: string; }
export interface ApplicationAssetsAPI {
  applicationAssets(): Promise<ApplicationAssetsState>;
  saveAnswer(input: ConfirmedAnswerInput, expectedRevision: number | null): Promise<ApplicationAssetsState>;
  confirmAnswer(id: string, expectedRevision: number, expectedProfileVersion: number): Promise<ApplicationAssetsState>;
  deleteAnswer(id: string, expectedRevision: number): Promise<ApplicationAssetsState>;
  answerSuggestions(question: string, applicationId: string): Promise<AnswerSuggestion[]>;
  importResumeVersion(input: ResumeVersionImport): Promise<{ cancelled: boolean; state?: ApplicationAssetsState }>;
  saveResumeVersion(input: { id: string; label: string; directions: string[] }, expectedRevision: number): Promise<ApplicationAssetsState>;
  deleteResumeVersion(id: string, expectedRevision: number): Promise<ApplicationAssetsState>;
  exportResumeVersion(id: string): Promise<{ cancelled: boolean; path?: string }>;
  selectApplicationResume(applicationId: string, resumeVersionId: string | null, expectedRevision: number | null): Promise<ApplicationAssetsState>;
  saveCalendarEvent(input: ApplicationCalendarEventInput, expectedRevision: number | null): Promise<ApplicationAssetsState>;
  deleteCalendarEvent(applicationId: string, eventId: string, expectedRevision: number): Promise<ApplicationAssetsState>;
  exportApplicationCalendar(applicationId?: string): Promise<{ cancelled: boolean; path?: string }>;
}

function calendarParts(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
export function applicationUTCToLocal(utc: string, timeZone: string): string {
  const instant = Date.parse(utc); if (!Number.isFinite(instant)) throw new Error('时间无效'); return calendarParts(instant, timeZone).slice(0, 16);
}
/** Reject nonexistent and ambiguous DST wall times instead of silently choosing a different instant. */
export function applicationLocalTimeToUTC(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(local)) throw new Error('请填写完整日期和时间');
  const year = Number(local.slice(0, 4)); if (year < 2000 || year > 2100) throw new Error('日期须在2000至2100年之间');
  const desired = Date.parse(`${local}:00Z`); if (!Number.isFinite(desired) || new Date(desired).toISOString().slice(0, 16) !== local) throw new Error('日期或时间无效');
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = desired + hours * 3600_000;
    offsets.add(Date.parse(`${calendarParts(sample, timeZone)}Z`) - sample);
  }
  const candidates = [...offsets].map(offset => desired - offset).filter(value => calendarParts(value, timeZone).slice(0, 16) === local);
  if (candidates.length !== 1) throw new Error(candidates.length ? '该时间处于夏令时重复时段，请选择无歧义的时间' : '该时间在此时区不存在，请核对夏令时');
  return new Date(candidates[0]!).toISOString();
}
