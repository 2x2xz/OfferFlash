import test from 'node:test';import assert from 'node:assert/strict';
import {ApplicationQuestionBroker,runApplicationFillWorkflow,applicationReportText,questionFromResult,validateApplicationAnswer} from '../packages/ui/src/application-fill-workflow.js';
import {validQuestionDate} from '../packages/shared/src/calendar-date.js';
import type {OfferAPI} from '../packages/shared/src/contracts.js';import type {UniversalResult} from '../packages/browser/src/universal-form.js';
const context={profileVersion:1,tabId:'tab-a',documentRevision:2,url:'https://example.invalid/application'};
const missing:UniversalResult={status:'partial',verified:0,pending:1,message:'尚缺兴趣',remaining:[{label:'兴趣爱好',section:'',reason:'个人资料里没有此项',reasonCode:'missing-data',question:{key:'[OfferFlash:abc] 兴趣爱好',prompt:'兴趣爱好',context:'仅当前申请'}}]};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('one real fill workflow waits without a request, saves and confirms the answer, then automatically calls fill again',async()=>{
 let current={...context},phase=0,saved:any,confirmations=0,question:any;const reports:any[]=[];
 const api={browserState:async()=>({url:current.url,activeTabId:current.tabId,documentRevision:current.documentRevision}),getState:async()=>({profile:{version:current.profileVersion}}),applicationAssets:async()=>({profileVersion:1,answers:saved?[saved]:[]}),saveAnswer:async(input:any)=>{saved={...input,id:'answer-a',revision:1,confirmedRevision:null,confirmedProfileVersion:null,confirmedAt:null};return{answers:[saved]};},confirmAnswer:async()=>{confirmations++;saved.confirmedRevision=1;saved.confirmedProfileVersion=1;return{answers:[saved]};},runUniversalFill:async()=>{phase++;if(phase===2){assert.equal(confirmations,1);assert.equal(saved.answer,'骑行');}return phase===1?structuredClone(missing):{...missing,pending:0,remaining:[],matchedConfirmed:1};},cancelUniversalFill:async()=>{}} as unknown as OfferAPI;
 const broker=new ApplicationQuestionBroker(async()=>current,r=>question=r,()=>{}),control=new AbortController();const operation=runApplicationFillWorkflow({api,context,signal:control.signal,overwriteExisting:true,ask:(...args)=>broker.ask(...args),report:r=>reports.push(r)});
 for(let i=0;i<10&&!question;i++)await tick();assert.ok(question);assert.equal(phase,1);await tick();assert.equal(phase,1);assert.equal(saved,undefined);
 await broker.respond({requestId:question.id,disposition:'answered',answers:[{questionId:'field',text:'骑行'}]});const result=await operation;assert.equal(phase,2);assert.equal(result.pending,0);assert.equal(reports.length,2);const finalSaved=saved as unknown as {questionPattern:string;scope:{kind:string}};assert.ok(finalSaved.questionPattern.includes('[OfferFlash:abc]'));assert.equal(finalSaved.scope.kind,'general');
});
test('cancel, stale context and duplicate replies never save a draft or resume a different document',async()=>{
 let current={...context},request:any;const broker=new ApplicationQuestionBroker(async()=>current,r=>request=r,()=>{});const controller=new AbortController();const wait=broker.ask('form-a',{questions:[{id:'field',prompt:'兴趣爱好'}]},controller.signal);await tick();const id=request.id;current={...current,documentRevision:3};await assert.rejects(()=>broker.respond({requestId:id,disposition:'answered',answers:[{questionId:'field',text:'骑行'}]}),/变化/);await assert.rejects(wait,/变化/);await assert.rejects(()=>broker.respond({requestId:id,disposition:'answered',answers:[{questionId:'field',text:'骑行'}]}),/结束/);
 const next=broker.ask('form-b',{questions:[{id:'field',prompt:'兴趣爱好'}]},controller.signal);await tick();controller.abort();await assert.rejects(next,/停止/);assert.equal(broker.current(),null);
});
test('unsupported controls and unidentified career rows are reports rather than requests to invent missing data',()=>{
 const report={...missing,remaining:[{...missing.remaining![0]!,reasonCode:'fill-failed'},{...missing.remaining![0]!,question:{...missing.remaining![0]!.question!,recordUnresolved:true as const}}]};assert.equal(questionFromResult(report,new Set()),undefined);assert.equal(questionFromResult(missing,new Set(['[OfferFlash:abc] 兴趣爱好'])),undefined);
});
test('a status selection returns actual field names and reasons, bound to the page and profile',()=>{
 const report={context,checkedAt:'2026-10-23T00:00:00Z',result:{...missing,verifiedFields:[{label:'学校名称',section:'教育背景'}]}};const text=applicationReportText(report,context,'pending');assert.match(text,/兴趣爱好/);assert.match(text,/个人资料里没有此项/);assert.doesNotMatch(text,/已选择查看/);assert.match(applicationReportText(report,context,'verified'),/学校名称/);assert.match(applicationReportText(report,{...context,tabId:'different'},'pending'),/没有可用/);
});
test('a human must provide a real exact day; a month or impossible date cannot invent a day',()=>{
 assert.equal(validQuestionDate('2027-07','date'),false);assert.equal(validQuestionDate('2027-02-30','date'),false);assert.equal(validQuestionDate('2028-02-29','date'),true);
 const question={key:'date',prompt:'毕业日期',context:'仅当前申请',answerFormat:'date' as const};assert.throws(()=>validateApplicationAnswer(question,{status:'answered',answers:[{questionId:'field',answer:'2027-07'}]}),/完整日期/);validateApplicationAnswer(question,{status:'skipped',answers:[]});
});
test('none is an explicit form-only decision and never a synthetic answer',async()=>{
 let request:any;const broker=new ApplicationQuestionBroker(async()=>context,r=>request=r,()=>{});const control=new AbortController();const wait=broker.ask('form-a',{questions:[{id:'field',prompt:'兴趣爱好'}]},control.signal,{allowNone:true});await tick();await broker.respond({requestId:request.id,disposition:'none',answers:[]});assert.deepEqual(await wait,{status:'none',answers:[]});
});
