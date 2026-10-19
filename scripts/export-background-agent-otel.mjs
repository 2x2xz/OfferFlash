/** OTLP derived only from actual SDK tool events and observed provider intervals. */
import{readFile,writeFile}from'node:fs/promises';import{dirname,join}from'node:path';import{createHash}from'node:crypto';
const prefix=process.argv[3]??'docs/release/background-agent';
const p=process.argv[2];if(!p)throw Error('Provide completed benchmark progress.json');
const r=JSON.parse(await readFile(p,'utf8'));if(r.status!=='completed')throw Error('Completed run required');
const hash=(x,n)=>createHash('sha256').update(x).digest('hex').slice(0,n),ns=t=>String(BigInt(Math.round(t*1e6)));
const value=x=>typeof x==='boolean'?{boolValue:x}:Number.isInteger(x)?{intValue:String(x)}:typeof x==='number'?{doubleValue:x}:{stringValue:String(x)};
const attributes=o=>Object.entries(o).filter(([,v])=>v!==undefined&&v!==null).map(([key,v])=>({key,value:value(v)}));
const spans=[];let missingTaskTraces=0;
for(const arm of r.arms)for(const[i,entry]of arm.results.entries()){
 const raw=JSON.parse(await readFile(join(dirname(p),`${arm.id}-${i}.private.json`),'utf8')),e=raw.audit?.agent;
 if(!e?.events?.length||!e.taskId){missingTaskTraces++;continue;}
 const requests=r.modelAttempts.filter(a=>a.taskId===e.taskId),traceId=hash(e.taskId,32),rootId=hash(e.taskId+':root',16);
 const times=[...e.events.map(x=>Date.parse(x.time)),...requests.flatMap(a=>[Date.parse(a.startedAt),Date.parse(a.startedAt)+a.durationMs])];
 const start=Math.min(...times),end=Math.max(...times);
 spans.push({traceId,spanId:rootId,name:'background.agent.observed',kind:1,startTimeUnixNano:ns(start),endTimeUnixNano:ns(end),
  status:{code:entry.status==='completed'?1:2},attributes:attributes({'experiment.arm':arm.id,'experiment.case':i,'agent.completed':entry.status==='completed','agent.failure':entry.failure,'agent.verified_fields':e.verified,'agent.model_calls':e.modelCalls})});
 const starts=new Map();for(const event of e.events){if(event.type==='tool_started')starts.set(event.data.callId,event);
  if(event.type==='tool_finished'){const begin=starts.get(event.data.callId);if(!begin)continue;
   spans.push({traceId,spanId:hash(e.taskId+':tool:'+event.data.callId,16),parentSpanId:rootId,name:'tool.'+begin.data.toolName,kind:1,
    startTimeUnixNano:ns(Date.parse(begin.time)),endTimeUnixNano:ns(Date.parse(event.time)),status:{code:event.data.isError?2:1},attributes:attributes({'tool.name':begin.data.toolName,'tool.sdk_error':event.data.isError})});}}
 for(const a of requests){const usage=a.usage,failed=['error','aborted'].includes(a.stopReason)||(a.httpStatus??0)>=400;
  spans.push({traceId,spanId:hash(e.taskId+':model:'+a.id,16),parentSpanId:rootId,name:'model.request',kind:3,
   startTimeUnixNano:ns(Date.parse(a.startedAt)),endTimeUnixNano:ns(Date.parse(a.startedAt)+a.durationMs),status:{code:failed?2:1},
   attributes:attributes({'model.id':a.model,'http.response.status_code':a.httpStatus,'model.stop_reason':a.stopReason,'model.usage_known':!!usage,
    'model.input_tokens':usage?.input,'model.output_tokens':usage?.output,'model.cache_read_tokens':usage?.cacheRead,'model.cache_write_tokens':usage?.cacheWrite,'model.total_tokens':usage?.totalTokens})});}
}
const ids=new Set(spans.map(s=>s.traceId+':'+s.spanId));if(ids.size!==spans.length)throw Error('Duplicate span identity');
for(const span of spans){if(span.parentSpanId&&!ids.has(span.traceId+':'+span.parentSpanId))throw Error('Missing parent');if(BigInt(span.endTimeUnixNano)<BigInt(span.startTimeUnixNano))throw Error('Reversed observed interval');}
const otlp={resourceSpans:[{resource:{attributes:attributes({'service.name':'offerflash-background-agent-benchmark','experiment.scope':'real-model-sdk-events; derived observation window; not full DOM mutation audit'})},scopeSpans:[{scope:{name:'offerflash-real-agent-observer',version:'1.0.0'},spans}]}]};
await writeFile(prefix+'-otel.json',JSON.stringify(otlp,null,2)+'\n');
const index={traces:new Set(spans.map(s=>s.traceId)).size,spans:spans.length,roots:spans.filter(s=>!s.parentSpanId).length,
 modelSpans:spans.filter(s=>s.name==='model.request').length,toolSpans:spans.filter(s=>s.name.startsWith('tool.')).length,missingParents:0,missingTaskTraces,
 source:'actual timestamped SDK events and provider starts/durations; no invented field input spans'};
await writeFile(prefix+'-otel-index.json',JSON.stringify(index,null,2)+'\n');console.log(JSON.stringify(index));
