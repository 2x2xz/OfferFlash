import {matchJob} from '../../packages/domain/src/matching.js';
import{retrieveJobCandidates,type JobEmbedder}from'../../packages/agent/src/job-retrieval.js';
import{randomUUID}from'node:crypto';
import type{AppState}from'../../packages/shared/src/contracts.js';
import type{JobMatchingRequest,JobMatchingState}from'../../packages/shared/src/job-matching.js';import{jobMatchingToken}from'../../packages/shared/src/job-matching.js';
import{deriveApplyFlow}from'../../packages/ui/src/apply-flow.js';import{buildJobMatchingInput,matchingInputHash,type MatchingInput,type MatchingResult}from'../../packages/agent/src/job-matching.js';
const empty=():JobMatchingState=>({status:'idle',profileVersion:null,candidateIds:[],candidateTokens:{},ranking:[],modelId:'',checkedAt:'',message:'',libraryCount:0,comparedCount:0,hardRejected:0,requests:0,usage:null});
/** Host-owned read-only task. It has no save, tracker, browser or submit capability. */
export class JobMatchingService{
 private value=empty();private controller?:AbortController;private done?:Promise<void>;
 constructor(private readonly o:{getState():Promise<AppState>;runModel(input:MatchingInput,signal:AbortSignal,taskId:string):Promise<MatchingResult>;onState(state:JobMatchingState):void;now?:()=>Date;embed?:JobEmbedder}){}
 isRunning(){return !!this.controller;}
 private publish(value:JobMatchingState){this.value=structuredClone(value);try{this.o.onState(structuredClone(value));}catch{/* UI observers never authorize actions. */}}
 async state(){const s=await this.o.getState();if(this.value.status==='completed'&&!this.current(s))this.publish({...this.value,status:'stale',ranking:[],message:'资料或岗位内容已变化，请重新匹配。'});return structuredClone(this.value);}
 private current(s:AppState){return s.profile.version===this.value.profileVersion&&(!this.value.wholeLibrary||s.jobs.filter(j=>!j.demo).length===this.value.candidateIds.length)&&this.value.candidateIds.every(id=>{const j=s.jobs.find(j=>j.id===id);return !!j&&jobMatchingToken(j)===this.value.candidateTokens[id];})&&this.value.ranking.every(id=>{const j=s.jobs.find(j=>j.id===id);return !!j&&matchJob(s.profile,j,this.o.now?.()??new Date()).eligible!=='unsuitable';});}
 async run(request:JobMatchingRequest,signal?:AbortSignal):Promise<JobMatchingState>{
  if(this.controller)throw Error('岗位匹配正在运行，请等待或停止。');
  if(!request||Object.keys(request).some(k=>!['expectedVersion','jobIds','region','includeCareerDetails','intent'].includes(k))||!Number.isInteger(request.expectedVersion)||typeof request.includeCareerDetails!=='boolean'||request.intent!==undefined&&(typeof request.intent!=='string'||request.intent.length>300||/[\u0000-\u001f\u007f]/.test(request.intent))||request.region!==undefined&&!['mainland','overseas'].includes(request.region)||request.jobIds!==undefined&&(!Array.isArray(request.jobIds)||request.jobIds.length>10000||new Set(request.jobIds).size!==request.jobIds.length||request.jobIds.some(id=>typeof id!=='string'||!id)))throw Error('请选择本轮要匹配的岗位。');
  const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),120000);this.controller=controller;let finish!:()=>void;this.done=new Promise(r=>finish=r);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{controller.signal.throwIfAborted();const state=await this.o.getState(),now=this.o.now?.()??new Date();controller.signal.throwIfAborted();
   if(state.profile.version!==request.expectedVersion||!deriveApplyFlow(state,now).profileReady)throw Error('请先保存并确认简历资料，再重新匹配。');
   const jobs=request.jobIds?request.jobIds.map(id=>{const job=state.jobs.find(j=>j.id===id&&!j.demo);if(!job)throw Error('候选岗位已变化，请重新读取。');return job;}):state.jobs.filter(j=>!j.demo);
   if(!jobs.length)throw Error('岗位库还没有本轮可匹配的候选。');
   const preferences={region:request.region??'mainland' as const,...(state.profile.acceptedRecruitmentTypes?{acceptedRecruitmentTypes:state.profile.acceptedRecruitmentTypes}:{})};
   this.publish({...empty(),status:'running',wholeLibrary:!request.jobIds,profileVersion:state.profile.version,candidateIds:jobs.map(j=>j.id),candidateTokens:Object.fromEntries(jobs.map(j=>[j.id,jobMatchingToken(j)])),libraryCount:state.jobs.filter(j=>!j.demo).length,message:`正在检索全部 ${jobs.length} 条岗位，按求职方向和已确认经历找候选。`});
   const retrieved=await retrieveJobCandidates(state.profile,jobs,{asOf:now.toISOString(),includeCareerDetails:request.includeCareerDetails,intent:request.intent,preferences,embed:this.o.embed,mode:'lexical',signal:controller.signal});
   controller.signal.throwIfAborted();const input=buildJobMatchingInput(state.profile,retrieved.jobs,now.toISOString(),{includeCareerDetails:request.includeCareerDetails,preferences});
   // The explicit goal applies to this search in both retrieval and reranking; never overwrite saved profile preferences.
   if(request.intent?.trim())input.cv.targetRoles=[request.intent.trim()];
   this.publish({...this.value,retrieval:retrieved.summary,message:`已检索全部 ${jobs.length} 条岗位，正在比较 ${retrieved.jobs.length} 条相关候选。`});
   const result=await this.o.runModel(input,controller.signal,randomUUID());controller.signal.throwIfAborted();const fresh=await this.o.getState();controller.signal.throwIfAborted();
   if(!this.current(fresh)||result.inputHash!==matchingInputHash(input)||result.ranking.length>5||new Set(result.ranking).size!==result.ranking.length||result.ranking.some(id=>!retrieved.jobs.some(j=>j.id===id)))throw Error('资料或岗位内容已变化，结果未采用，请重新匹配。');
   const currentRanking=result.ranking.filter(id=>{const j=fresh.jobs.find(j=>j.id===id)!;return matchJob(fresh.profile,j,this.o.now?.()??new Date()).eligible!=='unsuitable';});
   this.publish({...this.value,status:'completed',ranking:currentRanking,proofs:result.proofs,evidenceRejected:result.evidenceRejected?.length??0,modelId:result.modelId,checkedAt:now.toISOString(),comparedCount:retrieved.jobs.length,hardRejected:jobs.length-retrieved.summary.eligibleCount,
    requests:result.attempt.attempted?1:0,usage:result.attempt.usage,
    message:`已${this.value.wholeLibrary?'检索全库':'检索指定范围'} ${jobs.length} 条岗位，通过${retrieved.summary.mode==='hybrid'?'语义＋关键词':'关键词'}检索选出 ${retrieved.jobs.length} 条交给模型，保留 ${currentRanking.length} 条。未知条件仍待核对。${retrieved.summary.warning??''}`});
   return structuredClone(this.value);
  }catch(error){const cancelled=controller.signal.aborted;this.publish({...this.value,status:cancelled?'cancelled':'failed',ranking:[],message:cancelled?'本轮匹配已停止，未改变岗位或申请。':error instanceof Error&&/请先|候选岗位|岗位库|资料或岗位/.test(error.message)?error.message:'模型匹配未完成，请检查模型配置或稍后重试；没有把规则列表当成模型结果。'});if(cancelled)throw Error('JOB_MATCH_CANCELLED');throw Error(this.value.message);}
  finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);if(this.controller===controller)this.controller=undefined;finish();this.done=undefined;}
 }
 async cancel(){this.controller?.abort();await this.done;}
}
