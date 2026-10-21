/** User interaction belongs to a running task; it is not a saved profile fact. */
export interface AgentQuestionOption {id:string;label:string;description?:string;}
export interface AgentQuestion {id:string;prompt:string;options?:AgentQuestionOption[];}
export interface AgentQuestionInput {questions:AgentQuestion[];}
export interface AgentQuestionContext {profileVersion:number;tabId:string;documentRevision:number;url:string;}
export interface AgentQuestionRequest extends AgentQuestionInput {id:string;taskId:string;createdAt:string;}
export interface AgentQuestionResponse {requestId:string;disposition:'answered'|'skipped';answers:Array<{questionId:string;optionId?:string;text?:string}>;}
export interface AgentQuestionResult {status:'answered'|'skipped'|'context-changed';answers:Array<{questionId:string;answer:string}>;}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const privateQuestion=/密码|验证码|密钥|身份证|护照号码|手机号码|出生日期|政治面貌|私人邮箱|password|captcha|api.?key|access.?token|passport.?number|national.?id|date.of.birth|phone.?number/i;
export function validateAgentQuestions(value:unknown):AgentQuestionInput {
 if(!exact(value,['questions'])||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>3)throw Error('每次只能提出一至三个具体问题。');
 const ids=new Set<string>();
 const questions=value.questions.map((q:unknown)=>{if(!exact(q,['id','prompt','options'])||!id(q.id)||ids.has(q.id)||!text(q.prompt,240)||privateQuestion.test(q.prompt))throw Error('请使用普通求职问题，不在问答块收集凭据或私密身份资料。');ids.add(q.id);
  let options:AgentQuestionOption[]|undefined;
  if(q.options!==undefined){if(!Array.isArray(q.options)||q.options.length<2||q.options.length>4)throw Error('选项应为二至四项，也可只询问文字。');const choices=new Set<string>();options=q.options.map((o:unknown)=>{if(!exact(o,['id','label','description'])||!id(o.id)||choices.has(o.id)||!text(o.label,64)||privateQuestion.test(o.label+String(o.description??''))||o.description!==undefined&&!text(o.description,160))throw Error('问题选项不完整或重复。');choices.add(o.id);return{id:o.id,label:o.label,...(o.description?{description:o.description as string}:{})};});}
  return{id:q.id,prompt:q.prompt,...(options?{options}:{})};});return{questions};
}
export function agentQuestionAnswer(request:AgentQuestionRequest,value:unknown):AgentQuestionResult {
 if(!exact(value,['requestId','disposition','answers'])||value.requestId!==request.id||!['answered','skipped'].includes(String(value.disposition))||!Array.isArray(value.answers))throw Error('这个问题已失效，请使用当前问答块。');
 if(value.disposition==='skipped'){if(value.answers.length)throw Error('跳过问题时不发送未确认的草稿。');return{status:'skipped',answers:[]};}
 if(value.answers.length!==request.questions.length)throw Error('请回答本组问题，或选择暂时跳过。');const used=new Set<string>();
 const answers=value.answers.map((a:unknown)=>{if(!exact(a,['questionId','optionId','text'])||!id(a.questionId)||used.has(a.questionId))throw Error('回答的问题不明确。');used.add(a.questionId);const question=request.questions.find(q=>q.id===a.questionId);if(!question||a.text!==undefined&&(typeof a.text!=='string'||a.text.length>2000))throw Error('回答与当前问题不匹配。');const option=a.optionId===undefined?undefined:question.options?.find(option=>option.id===a.optionId);if(a.optionId!==undefined&&!option)throw Error('请选择实际显示的选项。');const extra=typeof a.text==='string'?a.text.trim():'';if(!option&&!extra)throw Error('请选择选项或填写回答。');return{questionId:question.id,answer:[option?.label,extra].filter(Boolean).join('\n')};});return{status:'answered',answers};
}
