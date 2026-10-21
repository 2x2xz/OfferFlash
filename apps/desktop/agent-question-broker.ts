import {randomUUID} from 'node:crypto';
import {agentQuestionAnswer,validateAgentQuestions,type AgentQuestionContext,type AgentQuestionRequest,type AgentQuestionResponse,type AgentQuestionResult} from '../../packages/shared/src/agent-questions.js';
/** One pending human turn. No model calls, profile writes, or browser writes. */
export class AgentQuestionBroker {
 private pending?:{request:AgentQuestionRequest;context:AgentQuestionContext;resolve:(result:AgentQuestionResult)=>void;reject:(error:Error)=>void;cleanup:()=>void};
 constructor(private context:()=>Promise<AgentQuestionContext>,private publish:(request:AgentQuestionRequest|null)=>void,private answered:(request:AgentQuestionRequest,result:AgentQuestionResult)=>void=()=>{}){}
 current(){return this.pending?structuredClone(this.pending.request):null;}
 async ask(taskId:string,input:unknown,signal:AbortSignal):Promise<AgentQuestionResult>{
  signal.throwIfAborted();if(this.pending)throw Error('请先回答当前问题。');const validated=validateAgentQuestions(input),context=await this.context();signal.throwIfAborted();if(this.pending)throw Error('请先回答当前问题。');
  const request={...validated,id:randomUUID(),taskId,createdAt:new Date().toISOString()};
  return new Promise((resolve,reject)=>{const abort=()=>this.cancel();this.pending={request,context,resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)};signal.addEventListener('abort',abort,{once:true});this.publish(structuredClone(request));});
 }
 async respond(input:AgentQuestionResponse){
  const entry=this.pending;if(!entry||entry.request.id!==input?.requestId)throw Error('这个问题已结束，请勿重复确认。');
  const result=agentQuestionAnswer(entry.request,input),context=await this.context();if(this.pending!==entry)throw Error('这个问题已结束。');
  if(JSON.stringify(context)!==JSON.stringify(entry.context)){this.settle(entry,{status:'context-changed',answers:[]});throw Error('网页或资料已变化，旧回答未交给 Agent，请重新核对。');}
  this.answered(structuredClone(entry.request),result);this.settle(entry,result);return{accepted:true as const};
 }
 private settle(entry:NonNullable<AgentQuestionBroker['pending']>,result:AgentQuestionResult){if(this.pending!==entry)return;this.pending=undefined;entry.cleanup();this.publish(null);entry.resolve(result);}
 cancel(){const entry=this.pending;if(!entry)return;this.pending=undefined;entry.cleanup();this.publish(null);entry.reject(Error('任务已停止，未发送问答草稿。'));}
}
