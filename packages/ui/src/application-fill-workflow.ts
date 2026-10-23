import type {OfferAPI} from '../../shared/src/contracts.js';
import {agentQuestionAnswer,validateAgentQuestions,type AgentQuestionContext,type AgentQuestionInput,type AgentQuestionRequest,type AgentQuestionResponse,type AgentQuestionResult} from '../../shared/src/agent-questions.js';
import type {UniversalResult} from '../../browser/src/universal-form.js';
import type {UniversalQuestion} from '../../forms/src/universal-answers.js';
import {validQuestionDate} from '../../shared/src/calendar-date.js';
import {answerForReview,answerForSave} from './answer-review.js';
import {savedApplicationAnswer} from './companion.js';

export const APPLICATION_REPORT_KEY='offerflash.application-report.v1';
export const APPLICATION_ACTIVE_KEY='offerflash.application-fill.active.v1';
export const APPLICATION_LOCATE_KEY='offerflash.application-fill.locate.v1';
export const APPLICATION_READONLY_KEY='offerflash.application-fill.readonly.v1';
export const APPLICATION_UI_READY_KEY='offerflash.application-fill.ui.v1';
export interface ApplicationReport {context:AgentQuestionContext;checkedAt:string;result:UniversalResult;}
export type ApplicationReportKind='pending'|'verified'|'exceptions';
export const sameApplicationContext=(a:AgentQuestionContext,b:AgentQuestionContext)=>a.profileVersion===b.profileVersion&&a.tabId===b.tabId&&a.documentRevision===b.documentRevision&&a.url===b.url;
export async function applicationContext(api:Pick<OfferAPI,'browserState'|'getState'>):Promise<AgentQuestionContext>{const [page,state]=await Promise.all([api.browserState(),api.getState()]);return{profileVersion:state.profile.version,tabId:page.activeTabId??'legacy',documentRevision:page.documentRevision??0,url:page.url};}

/** Local human wait; no browser/model call or deadline runs while this promise waits. */
export class ApplicationQuestionBroker {
 private pending?:{request:AgentQuestionRequest;context:AgentQuestionContext;resolve:(result:AgentQuestionResult)=>void;reject:(error:Error)=>void;cleanup:()=>void;validate?:(result:AgentQuestionResult)=>void};
 constructor(private context:()=>Promise<AgentQuestionContext>,private publish:(request:AgentQuestionRequest|null)=>void,private answered:(request:AgentQuestionRequest,result:AgentQuestionResult)=>void){}
 current(){return this.pending?.request??null;}
 async ask(taskId:string,input:AgentQuestionInput,signal:AbortSignal,form:AgentQuestionRequest['form']={},validate?:(result:AgentQuestionResult)=>void){
  signal.throwIfAborted();if(this.pending)throw Error('请先回答当前问题。');const questions=validateAgentQuestions(input),context=await this.context();signal.throwIfAborted();if(this.pending)throw Error('请先回答当前问题。');
  const request:AgentQuestionRequest={...questions,id:crypto.randomUUID(),taskId,createdAt:new Date().toISOString(),form};
  return new Promise<AgentQuestionResult>((resolve,reject)=>{const cancel=()=>this.cancel();this.pending={request,context,resolve,reject,validate,cleanup:()=>signal.removeEventListener('abort',cancel)};signal.addEventListener('abort',cancel,{once:true});this.publish(request);});
 }
 async respond(response:AgentQuestionResponse){
  const entry=this.pending;if(!entry||response.requestId!==entry.request.id)throw Error('这个问题已结束。');const result=agentQuestionAnswer(entry.request,response),context=await this.context();
  if(this.pending!==entry)throw Error('这个问题已结束。');if(!sameApplicationContext(context,entry.context)){this.cancel('网页或资料已变化，旧回答未保存，也未继续填写。');throw Error('网页或资料已变化，旧回答未保存，也未继续填写。');}
  entry.validate?.(result);this.pending=undefined;entry.cleanup();this.answered(entry.request,result);this.publish(null);entry.resolve(result);
 }
 cancel(message='填写任务已停止，未保存未确认的回答。'){const entry=this.pending;if(!entry)return;this.pending=undefined;entry.cleanup();this.publish(null);entry.reject(new DOMException(message,'AbortError'));}
}

export function questionFromResult(result:UniversalResult,asked:ReadonlySet<string>):UniversalQuestion|undefined{
 for(const item of result.remaining??[]){const q=item.question;if(!q||q.recordUnresolved||asked.has(q.key)||!['missing-data','date-precision'].includes(item.reasonCode??''))continue;
  try{validateAgentQuestions({questions:[{id:'field',prompt:q.prompt.slice(0,220)}]});return q;}catch{/* Private/ambiguous questions stay in the real report, never a prompt. */}
 }
}
export function validateApplicationAnswer(question:UniversalQuestion,result:AgentQuestionResult){if(result.status!=='answered')return;const value=result.answers[0]?.answer.trim()??'';
 if(question.answerFormat&&!validQuestionDate(value,question.answerFormat))throw Error(question.answerFormat==='date'?'请填写真实的完整日期 YYYY-MM-DD；不知道可暂时跳过，不会替你补日期。':'请填写真实月份 YYYY-MM。');
 if(question.options?.length&&!question.options.includes(value))throw Error('请使用这个字段实际提供的选项原文；不确定可暂时跳过。');
}

/** One actual fill operation spans bounded execution phases and unbounded human waits. */
export async function runApplicationFillWorkflow(options:{api:OfferAPI;context:AgentQuestionContext;signal:AbortSignal;overwriteExisting:boolean;retryFailed?:boolean;ask:(taskId:string,input:AgentQuestionInput,signal:AbortSignal,form?:AgentQuestionRequest['form'],validate?:(result:AgentQuestionResult)=>void)=>Promise<AgentQuestionResult>;report:(report:ApplicationReport)=>void;now?:()=>number;activeBudgetMs?:number;onActive?:(context:AgentQuestionContext|null)=>void}):Promise<UniversalResult>{
 const {api,signal}=options,now=options.now??Date.now,budget=options.activeBudgetMs??180000,workflowId='form-'+crypto.randomUUID(),asked=new Set<string>();let activeMs=0,last:UniversalResult|undefined;
 const assertCurrent=async()=>{signal.throwIfAborted();if(!sameApplicationContext(await applicationContext(api),options.context))throw Error('网页或资料已变化，本次填写已停止。');signal.throwIfAborted();};
 const cancel=()=>void api.cancelUniversalFill?.();signal.addEventListener('abort',cancel,{once:true});
 try{for(let phase=0;phase<8;phase++){
  await assertCurrent();if(activeMs>=budget)throw Error('本次填写的执行预算已用完；已保留页面和核对结果。');
  options.onActive?.(options.context);const started=now(),timer=setTimeout(()=>{void api.cancelUniversalFill?.();},Math.max(1,budget-activeMs));
  try{if(!api.runUniversalFill)throw Error('安装包缺少填写接口。');last=await api.runUniversalFill({profileVersion:options.context.profileVersion,overwriteExisting:options.overwriteExisting,...(options.retryFailed&&phase===0?{retryFailed:true}:{})});}
  finally{clearTimeout(timer);activeMs+=Math.max(0,now()-started);options.onActive?.(null);}
  await assertCurrent();options.report({context:options.context,checkedAt:new Date().toISOString(),result:last});if(last.status==='failed'||last.status==='cancelled')return last;
  const question=questionFromResult(last,asked);if(!question)return last;
  if(activeMs>=budget)return{...last,status:'partial',message:last.message+'本次执行预算已用完，可稍后继续。'};asked.add(question.key);
  const assets=await api.applicationAssets();await assertCurrent();if(assets.profileVersion!==options.context.profileVersion)throw Error('资料已变化。');
  const prior=answerForReview(assets.answers,question),shown=(question.options??[]).filter(label=>label.length<=64).slice(0,3);const prompt=question.prompt.slice(0,180)+(question.answerFormat==='date'?'（请填 YYYY-MM-DD；不知道可跳过）':question.answerFormat==='month'?'（请填 YYYY-MM）':'');
  const response=await options.ask(workflowId,{questions:[{id:'field',prompt,...(shown.length>=2?{options:shown.map((label,index)=>({id:'choice-'+index,label:label.slice(0,64)}))}:{})}]},signal,{allowNone:!question.answerFormat,initialAnswers:prior?{field:prior.answer}:undefined},answer=>validateApplicationAnswer(question,answer));
  await assertCurrent();
  if(response.status==='skipped'||response.status==='none'){
   if(!api.setQuestionDecision)throw Error('安装包缺少本次跳过记录接口。');await api.setQuestionDecision({url:options.context.url,key:question.key,prompt:question.prompt,disposition:response.status==='none'?'none':'skip',profileVersion:options.context.profileVersion});continue;
  }
  if(response.status!=='answered')throw Error('回答上下文已失效。');const value=response.answers[0]!.answer.trim();const fresh=await api.applicationAssets();await assertCurrent();
  const previous=answerForSave(fresh.answers,question,false),request={...(previous?{id:previous.id}:{}),questionPattern:question.key,contextLabel:question.context,answer:value,scope:{kind:'general' as const},demo:false,risk:'ordinary' as const};
  const saved=await api.saveAnswer(request,previous?.revision??null);await assertCurrent();const stored=savedApplicationAnswer(fresh.answers,saved.answers,request);if(!stored)throw Error('未核对到保存的回答，未继续填写。');
  const confirmed=await api.confirmAnswer(stored.id,stored.revision,options.context.profileVersion);await assertCurrent();if(!confirmed.answers.some(a=>a.id===stored.id&&a.confirmedRevision===a.revision&&a.confirmedProfileVersion===options.context.profileVersion))throw Error('回答尚未确认，未继续填写。');
 }
 return{...last!,status:'partial',message:last!.message+'本轮已达到补充阶段上限，其余事项列在待处理项中。'};
 }catch(error){if(error instanceof DOMException&&error.name==='AbortError'&&last)return{...last,status:'cancelled',message:'填写已停止，页面与已确认回答保留。'};throw error;}
 finally{signal.removeEventListener('abort',cancel);options.onActive?.(null);}
}

const clean=(s:string)=>s.replace(/[\n\r]/g,' ').replace(/[\\`*_<>\[\]]/g,'\\$&');
export function applicationReportText(report:ApplicationReport|undefined,context:AgentQuestionContext,kind:ApplicationReportKind):string{
 if(!report||!sameApplicationContext(report.context,context))return '当前页面还没有可用的填写核对回执。请先执行一次自动填写；我不会把其它页面或旧资料版本的结果当成当前结果。';
 const r=report.result,title={pending:'待处理项',verified:'已核实项',exceptions:'异常与需人工处理项'}[kind];const header=`### ${title}\n\n最近一次真实核对：${new Date(report.checkedAt).toLocaleString('zh-CN',{hour12:false})}。以下是该次回执，未提交申请。\n\n`;
 if(kind==='verified')return header+(r.verifiedFields?.length?r.verifiedFields.map((f,i)=>`${i+1}. ${clean([f.section,f.label].filter(Boolean).join(' · '))}`).join('\n'):`该回执记录 ${r.matchedConfirmed??0} 项匹配；未提供逐项明细，不编造列表。`);
 const rows=(r.remaining??[]).filter(f=>kind==='pending'||['fill-failed','user-action','date-precision','unsupported','record-binding'].includes(f.reasonCode??''));
 const review=(r.drafts??[]).filter(d=>d.retained&&d.needsReview);const reviewText=review.length?'\n\n待你核对的已有草稿：\n'+review.map((d,i)=>`${i+1}. **${clean([d.section,d.label].filter(Boolean).join(' · '))}**：${clean(d.reason)}`).join('\n'):(r.pendingReview?'\n\n另有 '+r.pendingReview+' 项草稿待人工核对；此回执没有逐项明细。':'');
 return header+(rows.length?rows.map((f,i)=>`${i+1}. **${clean([f.section,f.label].filter(Boolean).join(' · '))}**：${clean(f.reason)}`).join('\n'):kind==='pending'&&r.pending?'回执仍有未解决事项，但没有逐字段明细，请在填写详情核对。':'该回执没有列出这类事项。')+reviewText+(r.missingRecords?`\n\n另有 ${r.missingRecords} 段经历未能对应，不能当作已完成。`:'');
}
export function applicationReportIntent(text:string):ApplicationReportKind|undefined{const s=text.trim().replace(/[。！!？?]/g,'');if(/^(?:请|帮我)?(?:查看|列出|显示|看看|看一下)?(?:当前|本页|真实的|本轮的)?待处理项$/.test(s))return'pending';if(/^(?:请|帮我)?(?:查看|列出|显示|看看)?已核实项$/.test(s))return'verified';if(/^(?:请)?(?:查看|列出|显示|看看)?异常$/.test(s))return'exceptions';}
