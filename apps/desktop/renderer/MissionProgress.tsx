import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AppState } from '../../../packages/shared/src/contracts.js';
import {
  advanceMissionProgress, createMissionTracker, missionEffectMode, parseMissionLedger, parseMissionPreferences,
  summarizeMissionProgress, MISSION_LEDGER_KEY, MISSION_PREFERENCES_KEY,
  type MissionAchievement, type MissionCompletion, type MissionPreferences,
} from '../../../packages/ui/src/mission-progress.js';

const PREFERENCES_EVENT = 'offeragent:pixel-mission-preferences';
function readPreferences() { try { return parseMissionPreferences(localStorage.getItem(MISSION_PREFERENCES_KEY)); } catch { return parseMissionPreferences(null); } }
function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const receive = (event: Event) => setPreferences(parseMissionPreferences((event as CustomEvent).detail));
    const stored = (event: StorageEvent) => { if (event.key === MISSION_PREFERENCES_KEY) setPreferences(parseMissionPreferences(event.newValue)); };
    window.addEventListener(PREFERENCES_EVENT, receive); window.addEventListener('storage', stored);
    return () => { window.removeEventListener(PREFERENCES_EVENT, receive); window.removeEventListener('storage', stored); };
  }, []);
  function save(next: MissionPreferences): boolean {
    let persisted = true;
    try { localStorage.setItem(MISSION_PREFERENCES_KEY, JSON.stringify(next)); } catch { persisted = false; }
    setPreferences(next); window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: next })); return persisted;
  }
  return { preferences, save };
}
function useMissionClock() {
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 60_000); return () => clearInterval(timer); }, []);
  return new Date();
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
function WeekBar({ count, goal }: { count: number; goal: number }) {
  return <div className="mission-weekly-progress" data-testid="mission-weekly-progress" role="progressbar" aria-label="本周已记录投递目标" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(count, goal)} aria-valuetext={`本周已记录 ${count}，目标 ${goal}`}><span style={{ width: `${Math.min(100, count / goal * 100)}%` }} /></div>;
}

function MissionParticles({ testId }: { testId: 'mission-confetti' | 'mission-preview-confetti' }) {
  return <div className="mission-confetti" data-testid={testId} aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i className="mission-pixel" key={index} style={{ '--mission-origin-x': `${index % 2 ? 172 : -172}px`, '--mission-x': `${(index % 2 ? 1 : -1) * (35 + index % 9 * 12)}px`, '--mission-y': `${-42 - index % 4 * 30}px`, '--mission-rotate': `${index % 2 ? 180 : -180}deg`, '--mission-delay': `${index % 3 * 40}ms` } as CSSProperties} />)}</div>;
}

/** An explicit visual sample; it never receives application data or touches the award tracker. */
function MissionCelebrationPreview() {
  const reduced = useReducedMotion(); const [preview, setPreview] = useState(0);
  useEffect(() => {
    if (!preview) return;
    const timeout = setTimeout(() => setPreview(0), 3500);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setPreview(0); } };
    window.addEventListener('keydown', escape);
    return () => { clearTimeout(timeout); window.removeEventListener('keydown', escape); };
  }, [preview]);
  const mode = missionEffectMode(true, reduced);
  return <>
    <div className="mission-preview-controls"><button type="button" data-testid="mission-preview" onClick={() => setPreview(value => value + 1)}>预览庆祝</button><span>仅体验效果，不改变投递记录或本周进度。</span></div>
    {preview > 0 && <div key={preview} className={`mission-celebration mission-preview-layer is-${mode}`} data-testid="mission-preview-layer" data-motion={mode}>
      <div className="mission-achievement mission-preview-card" data-testid="mission-preview-note" role="region" aria-label="庆祝效果预览" aria-live="polite">
        <span className="mission-achievement-mark" aria-hidden="true">◆</span><div><span className="mission-preview-label">效果预览 / PREVIEW</span><strong>又向 Offer 迈进一步！（示例）</strong><span>仅预览，不新增申请，不计本周目标。</span></div><button type="button" aria-label="关闭庆祝预览" data-testid="mission-preview-close" onClick={() => setPreview(0)}>关闭</button>
      </div>
      {mode === 'confetti' && <MissionParticles testId="mission-preview-confetti" />}
    </div>}
  </>;
}

export function MissionProgress({ state, completion }: { state: AppState; completion?: MissionCompletion }) {
  const { preferences } = usePreferences(); const now = useMissionClock(); const reduced = useReducedMotion();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const summary = useMemo(() => summarizeMissionProgress(state.applications, now), [state.applications, day]);
  const tracker = useRef<ReturnType<typeof createMissionTracker> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [achievement, setAchievement] = useState<MissionAchievement>();
  useEffect(() => {
    if (!tracker.current) { let value = null; try { value = localStorage.getItem(MISSION_LEDGER_KEY); } catch { /* Session-only fallback. */ } tracker.current = createMissionTracker(parseMissionLedger(value)); }
    const next = advanceMissionProgress(tracker.current, state.applications, completion);
    tracker.current = next.tracker;
    try { localStorage.setItem(MISSION_LEDGER_KEY, JSON.stringify(next.tracker.ledger)); } catch { /* The in-memory ledger still prevents repeats in this session. */ }
    if (!preferences.effectsEnabled) { clearTimeout(timer.current); setAchievement(undefined); return; }
    if (next.achievement) {
      clearTimeout(timer.current); setAchievement(next.achievement);
      timer.current = setTimeout(() => setAchievement(undefined), 1_800);
    }
  }, [state.applications, completion, preferences.effectsEnabled]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mode = missionEffectMode(preferences.effectsEnabled, reduced);
  return <>
    <div className="mission-progress" data-testid="mission-progress" title={`${summary.week.start} 至 ${summary.week.end} · 上海时间 · 按现有申请历史统计`}>
      <span className="mission-progress-label">本周已记录投递</span><strong data-testid="mission-completed-count">{summary.weeklyRecorded}</strong><span className="mission-progress-goal">/ {preferences.weeklyGoal}</span>
      <WeekBar count={summary.weeklyRecorded} goal={preferences.weeklyGoal} />
    </div>
    {achievement && mode !== 'none' && <div className={`mission-celebration is-${mode}`} style={{ pointerEvents: 'none' }}>
      <div className="mission-achievement" data-testid="mission-achievement" data-achievement-id={achievement.id} data-motion={mode} role="status" aria-live="polite">
        <span className="mission-achievement-mark" aria-hidden="true">◆</span><div><strong>{achievement.kind === 'application-recorded' ? '又向 Offer 迈进一步！' : '申请阶段已记录'}</strong><span>投递状态已记录 · 企业接收请以官网为准</span></div>
      </div>
      {mode === 'confetti' && <MissionParticles testId="mission-confetti" />}
    </div>}
  </>;
}

export function MissionWeeklyCard({ state }: { state: AppState }) {
  const { preferences, save } = usePreferences(); const now = useMissionClock();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const summary = useMemo(() => summarizeMissionProgress(state.applications, now), [state.applications, day]); const week = summary.week;
  const [goal, setGoal] = useState(String(preferences.weeklyGoal)); const [notice, setNotice] = useState('');
  useEffect(() => setGoal(String(preferences.weeklyGoal)), [preferences.weeklyGoal]);
  function saveGoal() {
    const value = Number(goal);
    if (!Number.isInteger(value) || value < 1 || value > 100) { setNotice('目标请填 1 至 100 的整数。'); return; }
    setNotice(save({ ...preferences, weeklyGoal: value }) ? '本机目标已保存。' : '目标本次会话可用，本机存储暂不可用。');
  }
  return <section className="mission-weekly-card" data-testid="mission-weekly-card">
    <div className="mission-card-heading"><span className="mission-section-label">WEEKLY MISSION</span><h2>每一格，都是你的行动</h2><p>{week.start} — {week.end} · 上海时间</p></div>
    <div className="mission-weekly-total"><strong>{summary.weeklyRecorded}</strong><span>/ {preferences.weeklyGoal} 本周已记录投递</span></div><WeekBar count={summary.weeklyRecorded} goal={preferences.weeklyGoal} />
    <p className="mission-record-boundary">按首次“已投递”记录统计，演示不计入。{summary.unknownDateCount > 0 && `另有 ${summary.unknownDateCount} 条日期不明，未计入本周。`}</p>
    <div className="mission-preferences"><label>每周目标<input data-testid="mission-weekly-goal" aria-label="每周投递记录目标" type="number" min={1} max={100} step={1} value={goal} onChange={event => setGoal(event.target.value)} /></label><button type="button" onClick={saveGoal}>保存目标</button><label className="mission-effects-option"><input type="checkbox" data-testid="mission-effects-toggle" checked={preferences.effectsEnabled} onChange={event => { setNotice(save({ ...preferences, effectsEnabled: event.target.checked }) ? '本机成就效果设置已保存。' : '本次会话设置已更新，本机存储暂不可用。'); }} />完成记录时显示像素成就</label></div>
    <MissionCelebrationPreview />
    {notice && <p className="mission-preference-notice" role="status">{notice}</p>}
  </section>;
}
