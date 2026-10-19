import {useEffect,useState} from 'react';
import type {OfferAPI,TelemetryState} from '../../../packages/shared/src/contracts.js';
import {telemetryTokenLabel} from '../../../packages/ui/src/telemetry.js';
/** Only actual host telemetry, never predicted token counts or synthetic tool events. */
export function ModelUsageStrip({api}:{api:OfferAPI}){
 const[state,setState]=useState<TelemetryState>({runs:[]});useEffect(()=>{let alive=true;const off=api.onEvent(e=>{if(alive&&e.type==='telemetry')setState(e.state);});void api.telemetryState().then(s=>{if(alive&&s&&Array.isArray(s.runs))setState(s);}).catch(()=>{});return()=>{alive=false;off();};},[api]);
 const run=state.runs.find(r=>r.id===state.activeRunId)??state.runs.at(-1);if(!run?.modelCalls)return null;
 return <div data-testid="live-model-usage" style={{padding:'8px 14px',fontSize:11,color:'var(--text-secondary)',borderBottom:'1px solid var(--border)',display:'flex',gap:12,flexWrap:'wrap'}}><span>真实 API · {run.modelCalls} 次</span><span>Token · {telemetryTokenLabel(run)}</span></div>;
}
