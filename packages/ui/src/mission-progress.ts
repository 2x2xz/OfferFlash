import type { Application, ApplicationInput } from '../../shared/src/contracts.js';

export const MISSION_PREFERENCES_KEY = 'offeragent.pixel-mission.preferences.v1';
export const MISSION_LEDGER_KEY = 'offeragent.pixel-mission.seen.v1';
export const DEFAULT_MISSION_PREFERENCES = { weeklyGoal: 5, effectsEnabled: true };
export interface MissionPreferences { weeklyGoal: number; effectsEnabled: boolean; }
export interface MissionCompletion { id: string; before: Application | null; after: Application; }
export interface MissionLedger { known: Record<string, string>; rewarded: string[]; }
export interface MissionTracker { initialized: boolean; ledger: MissionLedger; }
export interface MissionAchievement { id: string; kind: 'application-recorded' | 'stage-recorded'; }
const stages = new Set(['applied', 'assessment', 'interview', 'offer']);
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

// Local UI lookup keys only: no company names, URLs or application IDs are saved.
function key(value: string): string {
  let result = 14695981039346656037n;
  for (let i = 0; i < value.length; i++) result = BigInt.asUintN(64, (result ^ BigInt(value.charCodeAt(i))) * 1099511628211n);
  return result.toString(16).padStart(16, '0');
}
function canonicalURL(value: string): string {
  try { const url = new URL(value); url.searchParams.sort(); return url.href; } catch { return value.trim(); }
}
function recordIdentity(application: Application): string {
  return application.jobId ? `job:${application.jobId}` : `record:${canonicalURL(application.url)}|${normalize(application.company)}|${normalize(application.title)}`;
}
function aliases(application: Application): string[] {
  return [key(`application:${application.id}`), key(recordIdentity(application))];
}
function firstStage(application: Application) {
  const index = application.history.findIndex(event => stages.has(event.status));
  return index < 0 ? undefined : { index, event: application.history[index]! };
}
function everEntered(application: Application): boolean { return stages.has(application.status) || !!firstStage(application); }
function token(application: Application): string {
  const first = firstStage(application);
  return key(`${application.id}|${first?.index ?? 'unknown'}|${first?.event.at ?? 'unknown'}|${first?.event.status ?? application.status}`);
}
function timestamp(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return;
  const result = Date.parse(value);
  if (!Number.isFinite(result)) return;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return date.toISOString().slice(0, 10) === value.slice(0, 10) ? result : undefined;
}
const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
function shanghaiDate(value: number): string {
  const parts = shanghaiFormatter.formatToParts(value);
  const part = (name: string) => parts.find(entry => entry.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function missionWeek(now = new Date()): { start: string; end: string } {
  if (!Number.isFinite(now.getTime())) throw new TypeError('当前日期无效。');
  const monday = new Date(`${shanghaiDate(now.getTime())}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}
export function summarizeMissionProgress(applications: readonly Application[], now = new Date()) {
  const week = missionWeek(now); const groups = new Map<string, number | undefined>();
  for (const application of applications) {
    if (application.demo) continue;
    const index = application.history.findIndex(event => event.status === 'applied');
    if (index < 0) continue;
    const event = application.history[index]!;
    const at = index === 0 && event.at !== application.createdAt ? undefined : timestamp(event.at);
    const identity = recordIdentity(application);
    if (!groups.has(identity)) groups.set(identity, at);
    else { const previous = groups.get(identity); groups.set(identity, previous === undefined || at === undefined ? undefined : Math.min(previous, at)); }
  }
  let weeklyRecorded = 0, unknownDateCount = 0;
  const today = shanghaiDate(now.getTime());
  for (const at of groups.values()) {
    if (at === undefined) { unknownDateCount++; continue; }
    const date = shanghaiDate(at);
    if (date >= week.start && date <= week.end && date <= today) weeklyRecorded++;
  }
  return { totalRecorded: groups.size, weeklyRecorded, unknownDateCount, week };
}

export function parseMissionPreferences(value: unknown): MissionPreferences {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    return { weeklyGoal: Number.isInteger(data?.weeklyGoal) && data.weeklyGoal >= 1 && data.weeklyGoal <= 100 ? data.weeklyGoal : 5,
      effectsEnabled: typeof data?.effectsEnabled === 'boolean' ? data.effectsEnabled : true };
  } catch { return { ...DEFAULT_MISSION_PREFERENCES }; }
}
export function parseMissionLedger(value: string | null): MissionLedger {
  try {
    const data = JSON.parse(value ?? 'null');
    const valid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
    if (!data || typeof data.known !== 'object' || !data.known || Array.isArray(data.known) || !Array.isArray(data.rewarded)) throw new Error();
    const known: Record<string, string> = {};
    for (const [name, entry] of Object.entries(data.known)) if (valid(name) && valid(entry)) known[name] = entry;
    return { known, rewarded: data.rewarded.filter(valid) };
  } catch { return { known: {}, rewarded: [] }; }
}
export function createMissionTracker(ledger: MissionLedger = { known: {}, rewarded: [] }): MissionTracker {
  return { initialized: false, ledger: { known: { ...ledger.known }, rewarded: [...ledger.rewarded] } };
}

/** Called only after the user's application-record save succeeds, never on state broadcasts/imports. */
export function missionCompletionFromSave(
  before: readonly Application[], after: readonly Application[], input: ApplicationInput, id: string,
): MissionCompletion | undefined {
  const matching = after.filter(application => input.id ? application.id === input.id
    : input.jobId ? application.jobId === input.jobId
      : normalize(application.company) === normalize(input.company) && normalize(application.title) === normalize(input.title)
        && canonicalURL(application.url) === canonicalURL(input.url));
  if (matching.length !== 1 || matching[0]!.demo || !stages.has(matching[0]!.status)) return;
  const completion = { id, before: before.find(application => application.id === matching[0]!.id) ?? null, after: matching[0]! };
  return saveTimestamp(completion) === undefined ? undefined : completion;
}
function saveTimestamp(completion: MissionCompletion): number | undefined {
  const { before, after } = completion;
  if (after.demo || !stages.has(after.status) || before && (before.demo || everEntered(before))) return;
  const history = after.history; const last = history.at(-1); const first = firstStage(after);
  if (!last || last.status !== after.status || first?.index !== history.length - 1) return;
  if (before) {
    if (history.length !== before.history.length + 1 || before.history.some((entry, index) => history[index]?.at !== entry.at || history[index]?.status !== entry.status)) return;
  } else if (history.length !== 1 || after.createdAt !== last.at) return;
  return timestamp(last.at);
}
export function advanceMissionProgress(tracker: MissionTracker, applications: readonly Application[], completion?: MissionCompletion, now = new Date()) {
  const known = { ...tracker.ledger.known }; const rewarded = new Set(tracker.ledger.rewarded);
  let achievement: MissionAchievement | undefined;
  const at = completion ? saveTimestamp(completion) : undefined;
  if (tracker.initialized && completion && at !== undefined && now.getTime() - at >= -5_000 && now.getTime() - at <= 5 * 60_000) {
    const current = applications.find(application => application.id === completion.after.id);
    const currentToken = token(completion.after); const identities = aliases(completion.after);
    if (current?.updatedAt === completion.after.updatedAt && current.status === completion.after.status && token(current) === currentToken
      && identities.every(identity => !known[identity] || known[identity] === currentToken) && !rewarded.has(currentToken)) {
      rewarded.add(currentToken);
      achievement = { id: completion.id, kind: completion.after.status === 'applied' ? 'application-recorded' : 'stage-recorded' };
    }
  }
  for (const application of applications) {
    if (application.demo || !everEntered(application)) continue;
    const currentToken = token(application); const identities = aliases(application);
    const remembered = identities.map(identity => known[identity]).find(Boolean) ?? currentToken;
    for (const identity of identities) known[identity] ??= remembered;
    if (!tracker.initialized) rewarded.add(currentToken);
  }
  return { tracker: { initialized: true, ledger: { known, rewarded: [...rewarded] } }, achievement };
}
export function missionEffectMode(enabled: boolean, reducedMotion: boolean): 'none' | 'static' | 'confetti' {
  return !enabled ? 'none' : reducedMotion ? 'static' : 'confetti';
}
