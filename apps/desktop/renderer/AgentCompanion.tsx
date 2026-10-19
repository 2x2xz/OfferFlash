import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Volume2, VolumeX, WandSparkles } from 'lucide-react';
import { COMPANION_STATUS_HINTS, COMPANION_STATUS_LABELS, companionPreferences, companionProgress,
  type CompanionPreferences, type CompanionProgress, type CompanionStatus } from '../../../packages/ui/src/companion.js';
import { SpeedsterSprite, type SpeedsterState } from './SpeedsterSprite.js';
import { SpeedsterTrack, type FieldCompanionMotionOptions } from './SpeedsterTrack.js';
import './AgentCompanion.css';

export interface AgentCompanionProps extends CompanionProgress {
  status: CompanionStatus; message?: string;
  retry?: { attempt: number; maxAttempts: number };
  queue?: { completed: number; total: number };
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onStop?: () => void; stopDisabled?: boolean;
  runKey?: string; motionAllowed?: boolean; controlsLocked?: boolean;
  onMotionOptions?: (options: FieldCompanionMotionOptions) => void;
}
const preferenceKey = 'offeragent.companion.v1';
function readPreferences(): CompanionPreferences {
  try { return companionPreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')); } catch { return companionPreferences(null); }
}
function spriteState(status: CompanionStatus): SpeedsterState {
  if (status === 'needs-info' || status === 'waiting-login') return 'attention';
  if (status === 'completed') return 'celebrate';
  // The portrait stays parked; the running copy travels along the separate activity lane.
  return 'idle';
}

/** Mount in normal layout above the native browser holder, never as an overlay over WebContentsView. */
export function AgentCompanion({ status, message, verifiedCount, totalCount, pendingCount, retry, queue, action, onStop, stopDisabled, runKey, motionAllowed = true, controlsLocked = false, onMotionOptions }: AgentCompanionProps) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [systemReduced, setSystemReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Display preferences are optional. */ }
  }, [preferences]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setSystemReduced(query.matches);
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  const progress = companionProgress({ verifiedCount, totalCount, pendingCount });
  const active = ['reading', 'filling', 'retrying'].includes(status);
  const retryLabel = retry && Number.isSafeInteger(retry.attempt) && Number.isSafeInteger(retry.maxAttempts) && retry.attempt > 0 && retry.attempt <= retry.maxAttempts
    ? `重试 ${retry.attempt}/${retry.maxAttempts}` : '';
  const queueLabel = queue && Number.isSafeInteger(queue.completed) && Number.isSafeInteger(queue.total) && queue.total > 0 && queue.completed >= 0 && queue.completed <= queue.total
    ? `队列 ${queue.completed}/${queue.total}` : '';
  const preferenceReducedMotion = systemReduced || preferences.reducedMotion;
  const reducedMotion = preferenceReducedMotion || !motionAllowed;
  return <section className={`agent-companion${preferences.collapsed ? ' is-collapsed' : ''}${active ? ' is-working' : ''}${reducedMotion ? ' reduce-motion' : ''}`}
    data-testid="agent-companion" data-status={status} data-muted={preferences.muted} aria-label="申请小助手">
    <div className="agent-companion-portrait"><SpeedsterSprite state={spriteState(status)} className="agent-companion-sprite" /></div>
    <div className="agent-companion-content" aria-live={preferences.muted ? 'off' : 'polite'} aria-atomic="true" data-testid="companion-live">
      <div className="agent-companion-heading"><strong>{COMPANION_STATUS_LABELS[status]}</strong>{retryLabel && <small>{retryLabel}</small>}{queueLabel && <small>{queueLabel}</small>}</div>
      <p data-testid="companion-message" title={message || COMPANION_STATUS_HINTS[status]}>{preferences.collapsed ? progress.label : message || COMPANION_STATUS_HINTS[status]}</p>
      <div className="agent-companion-meter" data-testid="companion-progress" data-determinate={progress.percent !== undefined}>
        {progress.percent !== undefined ? <progress aria-label="已核实字段进度" value={progress.verified} max={progress.total} /> : <span className={`companion-activity-track${active ? ' active' : ''}`} aria-hidden="true"><i /></span>}
        <span>{progress.label}{progress.pending !== undefined && progress.pending > 0 ? ` · 待你处理 ${progress.pending} 项` : ''}</span>
      </div>
    </div>
    <div className="agent-companion-runway"><SpeedsterTrack status={status} verifiedCount={progress.verified} runKey={runKey}
      retryAttempt={retry?.attempt} reducedMotion={preferenceReducedMotion} enabled={motionAllowed} controlsLocked={controlsLocked} onMotionOptions={onMotionOptions} /></div>
    <div className="agent-companion-actions">
      {action && <button type="button" className="companion-primary" data-testid="companion-action" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
      {active && onStop && <button type="button" aria-label="停止当前填写" title="停止当前填写" disabled={stopDisabled} onClick={onStop}><Pause size={13} /></button>}
      <button type="button" title={preferences.muted ? '开启轻声提醒' : '静音提醒'} aria-label={preferences.muted ? '开启轻声提醒' : '静音提醒'} aria-pressed={preferences.muted} data-testid="companion-mute" disabled={controlsLocked} onClick={() => setPreferences(current => ({ ...current, muted: !current.muted }))}>{preferences.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
      <button type="button" aria-label={preferences.collapsed ? '展开小助手提示' : '收起小助手提示'} aria-expanded={!preferences.collapsed} data-testid="companion-collapse" disabled={controlsLocked} onClick={() => setPreferences(current => ({ ...current, collapsed: !current.collapsed }))}>{preferences.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</button>
      <button type="button" title="动态效果偏好" aria-label="动态效果偏好" disabled={controlsLocked} aria-expanded={settings} onClick={() => setSettings(value => !value)}><WandSparkles size={13} /></button>
    </div>
    {settings && <div className="companion-settings"><label><input type="checkbox" disabled={controlsLocked} checked={preferences.reducedMotion} onChange={event => setPreferences(current => ({ ...current, reducedMotion: event.target.checked }))} />减少动态效果</label><span>仅应用内提示，不播放声音、不抢焦点。</span></div>}
  </section>;
}
