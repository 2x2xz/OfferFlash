import {AsyncLocalStorage} from 'node:async_hooks';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore,type Api,type Model} from '@earendil-works/pi-ai';
import type {ModelConfig} from '../../shared/src/contracts.js';
import {JobEmbeddingClient} from './job-embedding.js';
import {JobWebSearchClient} from './job-web-search.js';
import type {PublicJobSearchInput} from '../../shared/src/discovery.js';
import {projectFormRequest} from './form-context.js';

export interface BackgroundModelAttempt {
  id:number;taskId:string;model:string;startedAt:string;durationMs:number;httpStatus?:number;
  stopReason:string;usage:{input:number;output:number;cacheRead:number;cacheWrite:number;totalTokens:number}|null;
}
/** Memory-only provider shared by independent Pi sessions, never by their histories. */
export class BackgroundModelProvider {
  private context=new AsyncLocalStorage<string>();
  private seen=new WeakSet<object>();
  private fatal=false;
  private taskLimits=new Map<string,number>();
  readonly attempts:BackgroundModelAttempt[]=[];
  private embeddings?:JobEmbeddingClient;
  private webSearch?:JobWebSearchClient;
  private constructor(readonly runtime:ModelRuntime,readonly model:Model<Api>,private limit:number){}
  static async create(config:ModelConfig,limit=1600,scope:'benchmark'|'universal'='benchmark'){
    const bailian=config.modelId==='qwen-flash'&&config.baseURL==='https://dashscope.aliyuncs.com/compatible-mode/v1';
    if(config.mode!=='live'||!config.apiKey?.trim()||!config.modelId?.trim()||scope==='benchmark'&&!bailian)throw Error('请先配置可用的真实模型；原测评仅支持百炼北京 qwen-flash。');
    const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
    let model:Model<Api>|undefined;
    if(config.provider==='custom'){
      const endpoint=new URL(config.baseURL||'');if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('模型地址必须是无凭据的 HTTP(S) 地址。');
      runtime.registerProvider('offerflash-background',{baseUrl:endpoint.href,api:'openai-completions',apiKey:config.apiKey.trim(),models:[{id:config.modelId,name:config.modelId,reasoning:false,input:['text'],contextWindow:32768,maxTokens:1800,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
      model=runtime.getModel('offerflash-background',config.modelId);
    }else{
      if(!['openai','deepseek','anthropic'].includes(config.provider))throw Error('不支持的模型供应商。');
      model=runtime.getModel(config.provider,config.modelId);if(!model)throw Error('SDK中没有该模型，请核对ID或使用兼容接口。');
      await runtime.setRuntimeApiKey(config.provider,config.apiKey.trim());
    }
    if(!model)throw Error('模型未配置。');
    const provider=new BackgroundModelProvider(runtime,model,limit);
    if(bailian){provider.embeddings=new JobEmbeddingClient(config.apiKey.trim());provider.webSearch=new JobWebSearchClient(config.apiKey.trim());}
    for(const name of ['stream','streamSimple'] as const){
      const original=(runtime[name] as any).bind(runtime);
      (runtime as any)[name]=(model:any,context:any,options:any={})=>{
        const taskId=provider.context.getStore();if(!taskId||provider.fatal||provider.attempts.length>=limit||provider.attempts.filter(a=>a.taskId===taskId).length>=(provider.taskLimits.get(taskId)??6))throw Error('BACKGROUND_MODEL_BUDGET_OR_CREDENTIAL_STOP');
        const start=performance.now(),attempt:BackgroundModelAttempt={id:provider.attempts.length+1,taskId,model:model.id,startedAt:new Date().toISOString(),durationMs:0,stopReason:'running',usage:null};
        const beforePayload=options.onPayload,beforeResponse=options.onResponse;
        const stream=original(model,context,{...options,maxTokens:Math.min(options.maxTokens??1800,1800),maxRetries:0,timeoutMs:20000,cacheRetention:'none',
          onPayload:async(payload:unknown,m:unknown)=>{const replacement=beforePayload?await beforePayload(payload,m):undefined;const body=replacement??payload;
            if(!body||typeof body!=='object'||typeof(body as any).model!=='string')throw Error('BACKGROUND_MODEL_INVALID_PAYLOAD');const projected=scope==='universal'?projectFormRequest(body):body;return bailian?{...projected as object,enable_thinking:false}:projected;},
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
  async withTaskLimit<T>(taskId:string,limit:number,fn:()=>Promise<T>):Promise<T>{
    if(!Number.isInteger(limit)||limit<1||limit>20||this.taskLimits.has(taskId))throw Error('INVALID_TASK_LIMIT');
    this.taskLimits.set(taskId,limit);try{return await this.withTask(taskId,fn);}finally{this.taskLimits.delete(taskId);}
  }
  isBlocked(){return this.fatal||this.attempts.length>=this.limit;}
  embedJobTexts(texts:readonly string[],signal?:AbortSignal){if(!this.embeddings||this.fatal)throw Error('JOB_EMBEDDING_NOT_CONFIGURED');return this.embeddings.embed(texts,signal);}
  searchPublicJobs(input:PublicJobSearchInput,signal?:AbortSignal){if(!this.webSearch||this.fatal)throw Error('JOB_WEB_SEARCH_NOT_CONFIGURED');return this.webSearch.search(input,signal);}
  close(){this.webSearch?.clear();this.webSearch=undefined;this.embeddings?.clear();this.embeddings=undefined;void this.runtime.setRuntimeApiKey(this.model.provider,'');this.runtime.unregisterProvider('offerflash-background');}
}
