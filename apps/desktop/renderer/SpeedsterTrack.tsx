import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Play, Square, Zap } from 'lucide-react';
import { initialSpeedsterState, updateSpeedsterState, getSpeedsterMotion, type SpeedsterInput } from '../../../packages/ui/src/speedster.js';
import { SpeedsterSprite } from './SpeedsterSprite.js';
import './SpeedsterTrack.css';

export interface FieldCompanionMotionOptions { enabled: boolean; reducedMotion: boolean; }
const key = 'offeragent.speedster.v1';
const isActive = (input: SpeedsterInput) => ['reading','filling','retrying'].includes(input.status);
export function SpeedsterTrack({ status, verifiedCount, runKey, retryAttempt, reducedMotion = false, enabled = true, controlsLocked = false, onMotionOptions }: SpeedsterInput & {reducedMotion?: boolean;enabled?: boolean;controlsLocked?: boolean;onMotionOptions?: (options: FieldCompanionMotionOptions) => void}) {
  const input: SpeedsterInput = {status,verifiedCount,runKey,retryAttempt};
  const [preference, setPreference] = useState(() => { try { return localStorage.getItem(key) !== 'off'; } catch { return true; } });
  const motionCallback = useRef(onMotionOptions); motionCallback.current = onMotionOptions;
  // Only durable user/system preferences leave the renderer. Transient layout
  // pauses must not disable the host's field companion for the next input.
  useEffect(() => { motionCallback.current?.({ enabled: preference, reducedMotion }); }, [preference, reducedMotion]);
  const [state, setState] = useState(() => updateSpeedsterState(initialSpeedsterState(), input, performance.now()));
  const [now, setNow] = useState(() => performance.now());
  const [previewUntil, setPreviewUntil] = useState(0);
  const [previewStart, setPreviewStart] = useState(0);
  const runway = useRef<HTMLDivElement>(null); const [distance, setDistance] = useState(600);
  useLayoutEffect(() => {
    const node = runway.current; if (!node) return;
    const measure = () => setDistance(Math.max(0, node.getBoundingClientRect().width-36));
    measure(); const observer=new ResizeObserver(measure); observer.observe(node); return()=>observer.disconnect();
  }, []);
  useEffect(() => { setState(previous => updateSpeedsterState(previous, input, performance.now())); setNow(performance.now()); }, [status,verifiedCount,runKey,retryAttempt]);
  useEffect(() => { if (isActive(input) || !enabled || !preference) setPreviewUntil(0); }, [status,enabled,preference]);
  const demo = enabled && preference && !isActive(input) && previewUntil > now;
  useEffect(() => {
    if (!previewUntil && state.pulseUntil <= performance.now()) return;
    const timer = setInterval(() => { const time=performance.now(); setNow(time); if (previewUntil && time >= previewUntil) setPreviewUntil(0);
      if (!previewUntil && state.pulseUntil && time >= state.pulseUntil) setState(value=>({...value,pulseUntil:0})); }, 80);
    return () => clearInterval(timer);
  }, [previewUntil,state.pulseUntil]);
  const sample: SpeedsterInput = {status: now-previewStart < 2400 ? 'filling' : now-previewStart < 3200 ? 'retrying' : 'completed',runKey:'visual-preview'};
  const motion = getSpeedsterMotion(demo ? {runKey:'visual-preview',pulseUntil:previewUntil} : state, demo ? sample : input, now, {enabled:enabled&&preference,reducedMotion});
  function preview() { if (isActive(input) || !enabled || !preference) return; const time=performance.now();setNow(time);setPreviewStart(time);setPreviewUntil(time+3800); }
  return <div className="speedster-track" data-testid="speedster-track" data-motion={motion.motion} data-animated={motion.animated} data-demo={demo} aria-label="像素闪电侠跑道">
    <div className="speedster-runway" ref={runway} style={{'--speedster-distance':`${distance}px`} as CSSProperties} aria-hidden="true"><span className="speedster-rail" /><div className="speedster-runner" data-testid="speedster-runner"><span className="speedster-lightning" /><SpeedsterSprite state={motion.spriteState} /></div></div>
    {demo && <span className="speedster-demo-label" data-testid="speedster-demo-label">效果预览 · 不填写网页</span>}
    <div className="speedster-controls"><label title={controlsLocked ? '填写完成后可调整动画' : '显示像素闪电侠跑动'}><input data-testid="speedster-enabled" type="checkbox" aria-label="显示闪电侠跑动" disabled={controlsLocked} checked={preference} onChange={event=>{if(controlsLocked)return;const value=event.target.checked;setPreference(value);setPreviewUntil(0);try{localStorage.setItem(key,value?'on':'off');}catch{}}}/><Zap size={10}/></label>
      {demo ? <button type="button" data-testid="speedster-preview-stop" aria-label="停止效果预览" title="停止预览" onClick={()=>setPreviewUntil(0)}><Square size={10}/><span>停止</span></button> : <button type="button" data-testid="speedster-preview" aria-label="预览闪电侠跑动" title="预览跑动（不填写）" disabled={isActive(input)||!enabled||!preference} onClick={preview}><Play size={10}/><span>预览</span></button>}
    </div>
  </div>;
}
