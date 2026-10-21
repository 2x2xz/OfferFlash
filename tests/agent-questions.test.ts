import test from 'node:test';import assert from 'node:assert/strict';
import {AgentQuestionBroker} from '../apps/desktop/agent-question-broker.js';
import {validateAgentQuestions,agentQuestionAnswer,type AgentQuestionRequest} from '../packages/shared/src/agent-questions.js';
import {agentUiReducer,createAgentUiState} from '../packages/ui/src/agent-state.js';
const questions={questions:[{id:'location',prompt:'本次更倾向哪种工作安排？',options:[{id:'remote',label:'远程优先'},{id:'onsite',label:'现场工作'}]}]};
const request:AgentQuestionRequest={...questions,id:'request-one',taskId:'task-one',createdAt:'2026-10-22T04:00:00Z'};
const context={profileVersion:7,tabId:'tab-one',documentRevision:1,url:'https://fictional.invalid/apply'};
test('questions are a bounded typed interaction rather than arbitrary controls or profile collection',()=>{
 assert.deepEqual(validateAgentQuestions(questions),questions);
 assert.throws(()=>validateAgentQuestions({questions:[]}),/一至三个/);
 assert.throws(()=>validateAgentQuestions({questions:[questions.questions[0],questions.questions[0]]}),/问题/);
 assert.throws(()=>validateAgentQuestions({questions:[{id:'key',prompt:'请输入 API key'}]}),/私密/);
 assert.throws(()=>validateAgentQuestions({...questions,execute:'submit'}),/问题/);
});
test('answers must belong to the current request and observed choices, and free text remains user-authored',()=>{
 assert.deepEqual(agentQuestionAnswer(request,{requestId:request.id,disposition:'answered',answers:[{questionId:'location',optionId:'remote',text:'可协商固定到岗日'}]}),{status:'answered',answers:[{questionId:'location',answer:'远程优先\n可协商固定到岗日'}]});
 assert.throws(()=>agentQuestionAnswer(request,{requestId:'old',disposition:'answered',answers:[]}),/失效/);
 assert.throws(()=>agentQuestionAnswer(request,{requestId:request.id,disposition:'answered',answers:[{questionId:'location',optionId:'invented'}]}),/显示/);
 assert.deepEqual(agentQuestionAnswer(request,{requestId:request.id,disposition:'skipped',answers:[]}),{status:'skipped',answers:[]});
});
test('the live tool stays pending without an answer; confirmation settles it once and never saves a profile',async()=>{
 let current:AgentQuestionRequest|null=null,answered=0,settled=false;
 const broker=new AgentQuestionBroker(async()=>context,q=>{current=q;},()=>answered++),controller=new AbortController();
 const work=broker.ask('task-one',questions,controller.signal).then(result=>{settled=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.ok(current);const id=broker.current()!.id;
 const response={requestId:id,disposition:'answered' as const,answers:[{questionId:'location',optionId:'remote'}]};
 const attempts=await Promise.allSettled([broker.respond(response),broker.respond(response)]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(answered,1);assert.equal((await work).answers[0]!.answer,'远程优先');assert.equal(broker.current(),null);
});
test('cancellation removes the prompt and does not pass a draft to the model',async()=>{
 const broker=new AgentQuestionBroker(async()=>context,()=>{}),controller=new AbortController(),pending=broker.ask('task-one',questions,controller.signal);const rejection=assert.rejects(pending,/停止/);
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await rejection;assert.equal(broker.current(),null);
});
test('changed tab, document, or profile rejects stale answers before resuming execution',async()=>{
 for(const change of [{tabId:'other'},{documentRevision:2},{profileVersion:8}]){
  let current={...context},answered=0;const broker=new AgentQuestionBroker(async()=>current,()=>{},()=>answered++),work=broker.ask('task-one',questions,new AbortController().signal);
  await new Promise(resolve=>setImmediate(resolve));const id=broker.current()!.id;current={...current,...change};
  await assert.rejects(broker.respond({requestId:id,disposition:'answered',answers:[{questionId:'location',text:'示例回答'}]}),/已变化/);assert.equal((await work).status,'context-changed');assert.equal(answered,0);
 }
});
test('reply transcript is inserted during the same task, and reload recovery finishes without another send',()=>{
 let state=agentUiReducer(createAgentUiState(),{type:'resume-question',request});
 state=agentUiReducer(state,{type:'question-answer',request,result:{status:'answered',answers:[{questionId:'location',answer:'远程优先'}]}});
 assert.equal(state.messages.length,2);assert.equal(state.messages[1]!.role,'user');assert.ok(state.active);
 const repeated=agentUiReducer(state,{type:'question-answer',request,result:{status:'skipped',answers:[]}});assert.equal(repeated,state);
 state=agentUiReducer(state,{type:'event',event:{taskId:'task-one',sequence:8,time:'2026-10-22T04:01:00Z',type:'text_delta',data:{delta:'已按回答继续完成。'}}});
 state=agentUiReducer(state,{type:'event',event:{taskId:'task-one',sequence:9,time:'2026-10-22T04:01:01Z',type:'task_settled',data:{status:'completed'}}});
 assert.equal(state.active,undefined);assert.equal(state.messages.at(-1)!.text,'已按回答继续完成。');assert.equal(state.messages.at(-1)!.status,'completed');
});

test('user waiting pauses the existing execution deadline without granting more active execution time',async()=>{
 const {PausableDeadline}=await import('../apps/desktop/pausable-deadline.js');let now=0,fired=0,id=0;const timers=new Map<number,{due:number;fn:()=>void}>();
 const schedule=((fn:()=>void,ms:number)=>{const token=++id;timers.set(token,{due:now+ms,fn});return token;}) as unknown as typeof setTimeout;
 const clear=((token:number)=>timers.delete(token)) as unknown as typeof clearTimeout;
 const tick=(ms:number)=>{now+=ms;for(const[token,timer]of [...timers])if(timer.due<=now){timers.delete(token);timer.fn();}};
 const deadline=new PausableDeadline(100,()=>fired++,()=>now,schedule,clear);tick(20);deadline.pause();tick(50000);assert.equal(fired,0);deadline.pause();deadline.resume();tick(79);assert.equal(fired,0);tick(1);assert.equal(fired,1);
 const cancelled=new PausableDeadline(100,()=>fired++,()=>now,schedule,clear);cancelled.pause();cancelled.dispose();cancelled.resume();tick(50000);assert.equal(fired,1);
});
