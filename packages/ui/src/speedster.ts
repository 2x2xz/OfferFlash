import type { CompanionStatus } from './companion.js';

export interface SpeedsterInput { status: CompanionStatus; runKey?: string; verifiedCount?: number; retryAttempt?: number; }
export interface SpeedsterState { runKey?: string; verifiedCount?: number; pulseUntil: number; }
export type SpeedsterMotion = 'idle' | 'reading' | 'running' | 'sprint' | 'retry' | 'waiting' | 'completed' | 'stopped';
export type SpeedsterPose = 'idle' | 'sprint' | 'brake' | 'return' | 'attention' | 'celebrate';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function initialSpeedsterState(): SpeedsterState { return { pulseUntil: 0 }; }
/** A visual pulse is evidence of an actual same-run count increase, never of elapsed time. */
export function updateSpeedsterState(previous: SpeedsterState, input: SpeedsterInput, now: number): SpeedsterState {
  const sameRun = !!input.runKey && previous.runKey === input.runKey;
  const increased = sameRun && count(previous.verifiedCount) && count(input.verifiedCount) && input.verifiedCount > previous.verifiedCount;
  const filling = input.status === 'filling';
  const pulseUntil = !Number.isFinite(now) || !filling || !sameRun || (count(previous.verifiedCount) && count(input.verifiedCount) && input.verifiedCount < previous.verifiedCount)
    ? 0 : increased ? now + 650 : previous.pulseUntil;
  return { runKey: input.runKey, verifiedCount: count(input.verifiedCount) ? input.verifiedCount : undefined, pulseUntil };
}
export function getSpeedsterMotion(state: SpeedsterState, input: SpeedsterInput, now: number,
  preferences: {enabled: boolean;reducedMotion: boolean}): {motion:SpeedsterMotion;animated:boolean;spriteState:SpeedsterPose} {
  const base: Record<CompanionStatus, SpeedsterMotion> = { idle:'idle', reading:'reading', filling:'running', retrying:'retry',
    'needs-info':'waiting', 'waiting-login':'waiting', completed:'completed', stopped:'stopped' };
  const motion = input.status === 'filling' && !!input.runKey && state.runKey === input.runKey && Number.isFinite(now) && now < state.pulseUntil ? 'sprint' : base[input.status];
  const animated = preferences.enabled && !preferences.reducedMotion && ['reading','running','sprint','retry'].includes(motion);
  const pose: Record<SpeedsterMotion,SpeedsterPose> = { idle:'idle',reading:'sprint',running:'sprint',sprint:'sprint',retry:'return',waiting:'attention',completed:'celebrate',stopped:'brake' };
  return { motion, animated, spriteState: animated || !['reading','running','sprint','retry'].includes(motion) ? pose[motion] : 'idle' };
}
