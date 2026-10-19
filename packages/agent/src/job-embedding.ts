import {createHash} from 'node:crypto';
export interface JobEmbeddingBatch {vectors:number[][];requests:number;inputTokens:number;cacheHits:number;model:string;}
/** Separate read-only embedding API; credentials and private query vectors stay in process memory. */
export class JobEmbeddingClient {
  private cache=new Map<string,number[]>();
  constructor(private key:string,private request:typeof fetch=fetch){}
  clear(){this.key='';this.cache.clear();}
  async embed(texts:readonly string[],signal?:AbortSignal):Promise<JobEmbeddingBatch>{
    if(!this.key||texts.length>10000||texts.some(s=>typeof s!=='string'||!s.trim()||s.length>6000))throw Error('JOB_EMBEDDING_INPUT');
    const model='text-embedding-v4',keys=texts.map(s=>createHash('sha256').update(model+'\n512\n'+s).digest('hex'));
    const missing=[...new Map(texts.map((text,i)=>[keys[i]!,text])).entries()].filter(([k])=>!this.cache.has(k));
    let requests=0,inputTokens=0;const pending=new Map<string,number[]>();
    // Two requests at a time; each request respects the API's ten-document limit.
    for(let start=0;start<missing.length;start+=20){
      signal?.throwIfAborted();const chunks=[missing.slice(start,start+10),missing.slice(start+10,start+20)].filter(v=>v.length);
      const results=await Promise.allSettled(chunks.map(async chunk=>{
        const r=await this.request('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',{method:'POST',redirect:'error',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{authorization:'Bearer '+this.key,'content-type':'application/json'},body:JSON.stringify({model,input:chunk.map(([,text])=>text),dimensions:512,encoding_format:'float'})});
        requests++;if(!r.ok){await r.body?.cancel();throw Error('JOB_EMBEDDING_HTTP_'+r.status);}
        if(Number(r.headers.get('content-length'))>2_000_000)throw Error('JOB_EMBEDDING_RESPONSE');
        const reader=r.body?.getReader();if(!reader)throw Error('JOB_EMBEDDING_RESPONSE');let size=0,body='';const decoder=new TextDecoder();
        try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>2_000_000)throw Error('JOB_EMBEDDING_RESPONSE');body+=decoder.decode(v.value,{stream:true});}body+=decoder.decode();}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
        let data:any;try{data=JSON.parse(body);}catch{throw Error('JOB_EMBEDDING_RESPONSE');}
        if(!Array.isArray(data.data)||data.data.length!==chunk.length||new Set(data.data.map((v:any)=>v.index)).size!==chunk.length||!Number.isSafeInteger(data.usage?.total_tokens)||data.usage.total_tokens<0)throw Error('JOB_EMBEDDING_RESPONSE');
        inputTokens+=data.usage.total_tokens;
        for(const v of data.data){if(!Number.isInteger(v.index)||v.index<0||v.index>=chunk.length||!Array.isArray(v.embedding)||v.embedding.length!==512||v.embedding.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n))||!v.embedding.some((n:number)=>n!==0))throw Error('JOB_EMBEDDING_RESPONSE');pending.set(chunk[v.index]![0],[...v.embedding]);}
      }));
      const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    }
    signal?.throwIfAborted();if(!this.key)throw Error('JOB_EMBEDDING_CLOSED');
    for(const[k,v]of pending)this.cache.set(k,v);
    // Bound the session-only cache; do not evict any vector needed by this response.
    const vectors=keys.map(k=>[...(this.cache.get(k)??[])]);if(vectors.some(v=>v.length!==512))throw Error('JOB_EMBEDDING_RESPONSE');
    if(this.cache.size>15000){const keep=new Set(keys);for(const k of this.cache.keys()){if(this.cache.size<=10000)break;if(!keep.has(k))this.cache.delete(k);}}
    return{vectors,requests,inputTokens,cacheHits:texts.length-missing.length,model};
  }
}
