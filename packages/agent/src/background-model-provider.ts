import {AsyncLocalStorage} from 'node:async_hooks';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore,type Api,type Model} from '@earendil-works/pi-ai';
import type {ModelConfig} from '../../shared/src/contracts.js';
import {JobEmbeddingClient} from './job-embedding.js';

export interface BackgroundModelAttempt {
  id:number;taskId:string;model:string;startedAt:string;durationMs:number;httpStatus?:number;
  stopReason:string;usage:{input:number;output:number;cacheRead:number;cacheWrite:number;totalTokens:number}|null;
}
/** Memory-only provider shared by independent Pi sessions, never by their histories. */
export class BackgroundModelProvider {
  private context=new AsyncLocalStorage<string>();
  private seen=new WeakSet<object>();
  private fatal=false;
  readonly attempts:BackgroundModelAttempt[]=[];
  private embeddings?:JobEmbeddingClient;
  private constructor(readonly runtime:ModelRuntime,readonly model:Model<Api>,private limit:number){}
  static async create(config:ModelConfig,limit=1600){
    if(config.mode!=='live'||config.modelId!=='qwen-flash'||config.baseURL!=='https://dashscope.aliyuncs.com/compatible-mode/v1'||!config.apiKey?.trim())throw Error('后台模型Agent当前支持百炼北京 qwen-flash，请配置专用Key。');
    const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
    runtime.registerProvider('offerflash-background',{baseUrl:config.baseURL,api:'openai-completions',apiKey:config.apiKey.trim(),models:[{id:config.modelId,name:config.modelId,reasoning:false,input:['text'],contextWindow:32768,maxTokens:1800,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const provider=new BackgroundModelProvider(runtime,runtime.getModel('offerflash-background',config.modelId)!,limit);
    provider.embeddings=new JobEmbeddingClient(config.apiKey.trim());
    for(const name of ['stream','streamSimple'] as const){
      const original=(runtime[name] as any).bind(runtime);
      (runtime as any)[name]=(model:any,context:any,options:any={})=>{
        const taskId=provider.context.getStore();if(!taskId||provider.fatal||provider.attempts.length>=limit||provider.attempts.filter(a=>a.taskId===taskId).length>=6)throw Error('BACKGROUND_MODEL_BUDGET_OR_CREDENTIAL_STOP');
        const start=performance.now(),attempt:BackgroundModelAttempt={id:provider.attempts.length+1,taskId,model:model.id,startedAt:new Date().toISOString(),durationMs:0,stopReason:'running',usage:null};
        const beforePayload=options.onPayload,beforeResponse=options.onResponse;
        const stream=original(model,context,{...options,maxTokens:Math.min(options.maxTokens??1800,1800),maxRetries:0,timeoutMs:20000,cacheRetention:'none',
          onPayload:async(payload:unknown,m:unknown)=>{const replacement=beforePayload?await beforePayload(payload,m):undefined;const body=replacement??payload;
            if(!body||typeof body!=='object'||typeof(body as any).model!=='string')throw Error('BACKGROUND_MODEL_INVALID_PAYLOAD');return {...body,enable_thinking:false};},
          onResponse:(r:any)=>{attempt.httpStatus=r.status;if(r.status===401||r.status===403)provider.fatal=true;beforeResponse?.(r);}});
        if(provider.seen.has(stream))return stream;provider.seen.add(stream);attempt.id=provider.attempts.length+1;provider.attempts.push(attempt);
        void stream.result().then((result:any)=>{attempt.durationMs=performance.now()-start;attempt.stopReason=result.stopReason;
          const u=result.usage,keys=['input','output','cacheRead','cacheWrite','totalTokens'];
          if(['stop','length','toolUse'].includes(result.stopReason)&&u&&keys.every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)&&u.totalTokens>0)attempt.usage=Object.fromEntries(keys.map(k=>[k,u[k]])) as BackgroundModelAttempt['usage'];
        },()=>{attempt.durationMs=performance.now()-start;attempt.stopReason='error';}).catch(()=>{});
        return stream;
      };
    }
    return provider;
  }
  withTask<T>(taskId:string,fn:()=>Promise<T>):Promise<T>{return this.context.run(taskId,fn);}
  isBlocked(){return this.fatal||this.attempts.length>=this.limit;}
  embedJobTexts(texts:readonly string[],signal?:AbortSignal){if(!this.embeddings||this.fatal)throw Error('JOB_EMBEDDING_NOT_CONFIGURED');return this.embeddings.embed(texts,signal);}
  close(){this.embeddings?.clear();this.embeddings=undefined;this.runtime.unregisterProvider('offerflash-background');}
}
