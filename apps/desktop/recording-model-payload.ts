type PayloadHook=(payload:unknown,model:unknown)=>unknown|Promise<unknown>;
/** Pi's session hook can be async; spreading its Promise discards model/messages/tools. */
export function bailianRecordingPayload(previous?:PayloadHook){return async(payload:unknown,model:unknown)=>{
 const replacement=previous?await previous(payload,model):undefined;const body=replacement===undefined?payload:replacement;
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof(body as any).model!=='string'||!(body as any).model.trim())throw Error('模型请求缺少model，已在发送前停止。');
 return{...body,enable_thinking:false};
};}
/** SDK zero placeholders on failed responses are not measured usage. */
export function recordingModelUsage(stopReason:string,usage:any){const names=['input','output','cacheRead','cacheWrite','totalTokens'];
 if(!['stop','length','toolUse'].includes(stopReason)||!usage||!names.every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)||usage.totalTokens<=0)return undefined;
 return Object.fromEntries(names.map(k=>[k,usage[k]])) as {input:number;output:number;cacheRead:number;cacheWrite:number;totalTokens:number};
}
